use std::collections::BTreeSet;

use chrono::{NaiveDateTime, Timelike};
use serde_json::{json, Map, Value};
use sqlx::types::Json;
use sqlx::{FromRow, Postgres, Transaction};
use thesis_evidence::ownership::{
    compute_indirect_interest, InterestRange, InterestType, OwnershipEdge, OwnershipMathError,
    DEFAULT_MAX_INTEREST_PATHS,
};
use thesis_evidence::{evaluate_acceptance, ObservationEvidence};

use super::{root_ids_by_claim, AtlasSourceLineageRecord, MaterializeClaimError};
use crate::{Database, RelationshipRecord};

#[derive(Debug, FromRow)]
struct MaterializableClaim {
    id: String,
    subject_entity_id: String,
    predicate: String,
    object_entity_id: Option<String>,
    object_value: Option<Json<Value>>,
    qualifiers: Json<Value>,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    recorded_at: NaiveDateTime,
    retracted_at: Option<NaiveDateTime>,
    evidence_class: String,
    status: String,
}

#[derive(Debug, FromRow)]
struct EvaluationEvidenceRow {
    observation_id: String,
    evidence_class: String,
    document_id: String,
    entailment: String,
    reviewed_by: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct RelationshipCandidate {
    id: String,
    predicate: String,
    object_entity_id: String,
    qualifiers: Json<Value>,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
}

#[derive(Debug, FromRow)]
struct MaterializedRelationshipRow {
    id: String,
    subject_entity_id: String,
    predicate: String,
    object_entity_id: String,
    qualifiers: Json<Value>,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    recorded_at: NaiveDateTime,
    retracted_at: Option<NaiveDateTime>,
    materialized_at: NaiveDateTime,
    materialized_by: Option<String>,
    acceptance_policy_version: String,
    status: String,
}

#[derive(Debug, FromRow)]
struct OwnershipRelationshipRow {
    id: String,
    subject_entity_id: String,
    object_entity_id: String,
    qualifiers: Json<Value>,
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn json_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value.as_f64().is_some_and(|number| number != 0.0),
        Some(Value::String(value)) => !value.is_empty(),
        Some(Value::Array(value)) => !value.is_empty(),
        Some(Value::Object(value)) => !value.is_empty(),
    }
}

fn claim_band(qualifiers: &Value) -> Option<(f64, f64)> {
    let number = |value: &Value| value_text(value)?.parse::<f64>().ok();
    if let Some(point) = qualifiers.get("pct").and_then(number) {
        return Some((point, point));
    }
    let raw = qualifiers.get("pct_band")?;
    let (lower, upper) = if let Some(object) = raw.as_object() {
        (object.get("lower")?, object.get("upper")?)
    } else if let Some(values) = raw.as_array().filter(|values| values.len() == 2) {
        (&values[0], &values[1])
    } else {
        return None;
    };
    Some((number(lower)?, number(upper)?))
}

fn normalized_band(qualifiers: &Value) -> Option<Value> {
    let render = |value: &Value| value_text(value).map(Value::String);
    if let Some(point) = qualifiers.get("pct").and_then(render) {
        return Some(Value::Array(vec![point.clone(), point]));
    }
    let raw = qualifiers.get("pct_band")?;
    let (lower, upper) = if let Some(object) = raw.as_object() {
        (object.get("lower")?, object.get("upper")?)
    } else if let Some(values) = raw.as_array().filter(|values| values.len() == 2) {
        (&values[0], &values[1])
    } else {
        return None;
    };
    Some(Value::Array(vec![render(lower)?, render(upper)?]))
}

fn dimension_view(
    predicate: &str,
    object_entity_id: Option<&str>,
    object_value: Option<&Value>,
    qualifiers: &Value,
) -> Value {
    let mut dimensions = Map::new();
    dimensions.insert("predicate".to_owned(), Value::String(predicate.to_owned()));
    dimensions.insert(
        "object".to_owned(),
        object_entity_id
            .map(|id| Value::String(id.to_owned()))
            .or_else(|| object_value.cloned())
            .unwrap_or(Value::Null),
    );
    for (key, source_key) in [
        ("share_class", "security_class"),
        ("interest", "interest"),
        ("direct", "direct"),
        ("txn_status", "txn_status"),
        ("jurisdiction", "jurisdiction"),
        ("scope", "legal_entity_scope"),
    ] {
        dimensions.insert(
            key.to_owned(),
            qualifiers.get(source_key).cloned().unwrap_or(Value::Null),
        );
    }
    dimensions.insert(
        "band".to_owned(),
        normalized_band(qualifiers).unwrap_or(Value::Null),
    );
    Value::Object(dimensions)
}

fn temporal_overlap(
    left_from: Option<NaiveDateTime>,
    left_to: Option<NaiveDateTime>,
    right_from: Option<NaiveDateTime>,
    right_to: Option<NaiveDateTime>,
) -> bool {
    let start = left_from.into_iter().chain(right_from).max();
    let end = left_to.into_iter().chain(right_to).min();
    start.zip(end).is_none_or(|(start, end)| start <= end)
}

fn compare_relationship(
    claim: &MaterializableClaim,
    candidate: &RelationshipCandidate,
) -> Option<(Value, String)> {
    let left = &claim.qualifiers.0;
    let right = &candidate.qualifiers.0;
    // Only "apparently conflicting" comparisons block materialization; share-class,
    // dimension, temporal, and transaction-status differences are separate claims
    // (`_NON_CONFLICTING_CLASSIFICATIONS` in app/services/evidence_spine.py).
    let left_class = left.get("security_class");
    let right_class = right.get("security_class");
    if json_truthy(left_class) && json_truthy(right_class) && left_class != right_class {
        return None;
    }
    for key in ["interest", "direct", "jurisdiction", "legal_entity_scope"] {
        let left_value = left.get(key);
        let right_value = right.get(key);
        if left_value.is_some_and(|value| !value.is_null())
            && right_value.is_some_and(|value| !value.is_null())
            && left_value != right_value
        {
            return None;
        }
    }
    if !temporal_overlap(
        claim.valid_from,
        claim.valid_to,
        candidate.valid_from,
        candidate.valid_to,
    ) {
        return None;
    }
    let left_status = left.get("txn_status");
    let right_status = right.get("txn_status");
    let allowed_status = |value: Option<&Value>| {
        value.is_none_or(|value| {
            value.is_null()
                || matches!(
                    value.as_str(),
                    Some("announced" | "completed" | "abandoned" | "blocked")
                )
        })
    };
    if left_status != right_status && allowed_status(left_status) && allowed_status(right_status) {
        return None;
    }
    let normalized = json!({
        "left": dimension_view(
            &claim.predicate,
            claim.object_entity_id.as_deref(),
            claim.object_value.as_ref().map(|value| &value.0),
            left,
        ),
        "right": dimension_view(
            &candidate.predicate,
            Some(&candidate.object_entity_id),
            None,
            right,
        ),
    });
    if claim.object_entity_id.as_deref() != Some(candidate.object_entity_id.as_str()) {
        return Some((
            normalized,
            "different objects compete for the same subject, predicate, and overlapping valid time"
                .to_owned(),
        ));
    }
    if let (Some(left_band), Some(right_band)) = (claim_band(left), claim_band(right)) {
        if left_band.0.max(right_band.0) > left_band.1.min(right_band.1) {
            return Some((
                normalized,
                "percentage ranges conflict for the same normalized relation".to_owned(),
            ));
        }
    }
    None
}

fn stable_hash_parts(parts: &[Value]) -> String {
    let canonical = parts
        .iter()
        .map(crate::wiki::canonical_json)
        .collect::<Vec<_>>()
        .join("\u{001f}");
    crate::wiki::sha256_hex(canonical.as_bytes())
}

fn datetime_iso(value: NaiveDateTime) -> String {
    let mut formatted = value.format("%Y-%m-%dT%H:%M:%S").to_string();
    let micros = value.nanosecond() / 1_000;
    if micros != 0 {
        formatted.push_str(&format!(".{micros:06}"));
    }
    formatted
}

fn relationship_digest(claim: &MaterializableClaim) -> String {
    stable_hash_parts(&[
        Value::String(claim.subject_entity_id.clone()),
        Value::String(claim.predicate.clone()),
        Value::String(claim.object_entity_id.clone().unwrap_or_default()),
        claim.qualifiers.0.clone(),
        claim
            .valid_from
            .map(datetime_iso)
            .map(Value::String)
            .unwrap_or(Value::Null),
        claim
            .valid_to
            .map(datetime_iso)
            .map(Value::String)
            .unwrap_or(Value::Null),
    ])
}

fn ensure_qualifiers_object(qualifiers: &Value) -> Result<(), MaterializeClaimError> {
    if qualifiers.is_object() {
        Ok(())
    } else {
        Err(MaterializeClaimError::EvidenceSpine(
            "claim qualifiers must be a JSON object".to_owned(),
        ))
    }
}

fn validate_interest_claim(claim: &MaterializableClaim) -> Result<(), MaterializeClaimError> {
    if !matches!(claim.predicate.as_str(), "owns_equity_in" | "directly_owns") {
        return Ok(());
    }
    validate_interest_range(&claim.qualifiers.0)?;
    Ok(())
}

async fn evaluate_claim(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &MaterializableClaim,
    complete_control_path: bool,
) -> Result<thesis_evidence::AcceptanceDecision, MaterializeClaimError> {
    let evidence_rows = sqlx::query_as::<_, EvaluationEvidenceRow>(
        "SELECT observation.id AS observation_id, \
                COALESCE(document.source_class, $2) AS evidence_class, \
                snapshot.document_id, observation.entailment, observation.reviewed_by \
         FROM claim_evidence_links AS link \
         JOIN evidence_observations AS observation ON observation.id = link.observation_id \
         JOIN document_snapshots AS snapshot ON snapshot.id = observation.snapshot_id \
         LEFT JOIN evidence_documents AS document ON document.id = snapshot.document_id \
         WHERE link.claim_id = $1 ORDER BY observation.id",
    )
    .bind(&claim.id)
    .bind(&claim.evidence_class)
    .fetch_all(&mut **transaction)
    .await?;
    let lineage = sqlx::query_as::<_, AtlasSourceLineageRecord>(
        "SELECT parent_document_id, child_document_id FROM source_lineage",
    )
    .fetch_all(&mut **transaction)
    .await?;
    let roots = super::lineage_root_map(&lineage);
    let evidence = evidence_rows
        .into_iter()
        .map(|row| ObservationEvidence {
            observation_id: row.observation_id,
            evidence_class: row.evidence_class,
            root_id: roots
                .get(&row.document_id)
                .cloned()
                .unwrap_or(row.document_id),
            entailment: row.entailment,
            reviewed_by: row.reviewed_by,
        })
        .collect::<Vec<_>>();
    Ok(evaluate_acceptance(
        &claim.predicate,
        &evidence,
        complete_control_path,
    ))
}

async fn existing_by_hash(
    transaction: &mut Transaction<'_, Postgres>,
    digest: &str,
) -> Result<Option<RelationshipCandidate>, sqlx::Error> {
    sqlx::query_as::<_, RelationshipCandidate>(
        "SELECT id, predicate, object_entity_id, qualifiers, valid_from, valid_to \
         FROM accepted_relationships WHERE relationship_hash = $1 AND retracted_at IS NULL LIMIT 1",
    )
    .bind(digest)
    .fetch_optional(&mut **transaction)
    .await
}

async fn save_adjudication_item(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &MaterializableClaim,
    relationship_id: &str,
    normalized_dimensions: Value,
    reason: &str,
) -> Result<String, sqlx::Error> {
    let id = format!(
        "adj_{}",
        stable_hash_parts(&[
            Value::String(claim.id.clone()),
            Value::String(relationship_id.to_owned()),
        ])[..32]
            .to_owned()
    );
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM adjudication_items WHERE id = $1)",
    )
    .bind(&id)
    .fetch_one(&mut **transaction)
    .await?;
    if !exists {
        let mut entity_ids = vec![Value::String(claim.subject_entity_id.clone())];
        if let Some(object_id) = &claim.object_entity_id {
            entity_ids.push(Value::String(object_id.clone()));
        }
        sqlx::query(
            "INSERT INTO adjudication_items \
             (id, item_type, claim_ids, entity_ids, normalized_dimensions, reason, status, created_at) \
             VALUES ($1, 'claim_contradiction', $2, $3, $4, $5, 'open', $6)",
        )
        .bind(&id)
        .bind(Json(json!([claim.id])))
        .bind(Json(Value::Array(entity_ids)))
        .bind(Json(normalized_dimensions))
        .bind(reason)
        .bind(chrono::Utc::now().naive_utc())
        .execute(&mut **transaction)
        .await?;
    }
    Ok(id)
}

async fn conflict_with_relationship(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &MaterializableClaim,
) -> Result<Option<(String, Value, String)>, sqlx::Error> {
    let candidates = sqlx::query_as::<_, RelationshipCandidate>(
        "SELECT id, predicate, object_entity_id, qualifiers, valid_from, valid_to \
         FROM accepted_relationships WHERE subject_entity_id = $1 AND predicate = $2 \
           AND retracted_at IS NULL ORDER BY id",
    )
    .bind(&claim.subject_entity_id)
    .bind(&claim.predicate)
    .fetch_all(&mut **transaction)
    .await?;
    for candidate in candidates {
        if let Some((dimensions, reason)) = compare_relationship(claim, &candidate) {
            return Ok(Some((candidate.id, dimensions, reason)));
        }
    }
    Ok(None)
}

async fn claim_relationship_ids(
    transaction: &mut Transaction<'_, Postgres>,
    relationship_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT claim_id FROM relationship_claim_links WHERE relationship_id = $1 ORDER BY claim_id",
    )
    .bind(relationship_id)
    .fetch_all(&mut **transaction)
    .await
}

async fn load_relationship_record(
    transaction: &mut Transaction<'_, Postgres>,
    relationship_id: &str,
) -> Result<RelationshipRecord, sqlx::Error> {
    let row = sqlx::query_as::<_, MaterializedRelationshipRow>(
        "SELECT id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, valid_to, \
                recorded_at, retracted_at, materialized_at, materialized_by, acceptance_policy_version, status \
         FROM accepted_relationships WHERE id = $1",
    )
    .bind(relationship_id)
    .fetch_one(&mut **transaction)
    .await?;
    let claim_ids = claim_relationship_ids(transaction, relationship_id).await?;
    let evidence_root_count = if claim_ids.is_empty() {
        0
    } else {
        let lineage = sqlx::query_as::<_, AtlasSourceLineageRecord>(
            "SELECT parent_document_id, child_document_id FROM source_lineage",
        )
        .fetch_all(&mut **transaction)
        .await?;
        root_ids_by_claim(transaction, &claim_ids, &lineage)
            .await?
            .into_values()
            .flatten()
            .collect::<BTreeSet<_>>()
            .len()
    };
    Ok(RelationshipRecord {
        id: row.id,
        subject_entity_id: row.subject_entity_id,
        predicate: row.predicate,
        object_entity_id: row.object_entity_id,
        qualifiers: row.qualifiers.0,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        recorded_at: row.recorded_at,
        retracted_at: row.retracted_at,
        materialized_at: row.materialized_at,
        materialized_by: row.materialized_by,
        acceptance_policy_version: row.acceptance_policy_version,
        status: row.status,
        claim_ids,
        evidence_root_count,
    })
}

fn validate_interest_range(
    qualifiers: &Value,
) -> Result<Option<InterestRange>, MaterializeClaimError> {
    let parse =
        |lower: &Value, upper: &Value| -> Result<Option<InterestRange>, MaterializeClaimError> {
            let (Some(lower), Some(upper)) = (value_text(lower), value_text(upper)) else {
                return Ok(None);
            };
            match InterestRange::from_percentages(&lower, &upper) {
                Ok(range) => Ok(Some(range)),
                Err(OwnershipMathError::InvalidOwnershipNumber { .. }) => Ok(None),
                Err(error) => Err(MaterializeClaimError::EvidenceSpine(format!(
                    "invalid ownership interest qualifiers: {error}"
                ))),
            }
        };
    if let Some(point) = qualifiers.get("pct") {
        return parse(point, point);
    }
    match qualifiers.get("pct_band") {
        Some(Value::Object(values)) => match values.get("lower").zip(values.get("upper")) {
            Some((lower, upper)) => parse(lower, upper),
            None => Ok(None),
        },
        Some(Value::Array(values)) if values.len() == 2 => parse(&values[0], &values[1]),
        _ => Ok(None),
    }
}

async fn persist_interest_trace(
    transaction: &mut Transaction<'_, Postgres>,
    claim: &MaterializableClaim,
    relationship_id: &str,
) -> Result<(), MaterializeClaimError> {
    let Some(_interest) = validate_interest_range(&claim.qualifiers.0)? else {
        return Ok(());
    };
    let rows = sqlx::query_as::<_, OwnershipRelationshipRow>(
        "SELECT id, subject_entity_id, object_entity_id, qualifiers FROM accepted_relationships \
         WHERE predicate IN ('directly_owns', 'owns_equity_in') AND retracted_at IS NULL ORDER BY id",
    )
    .fetch_all(&mut **transaction)
    .await?;
    let mut edges = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(edge_interest) = validate_interest_range(&row.qualifiers.0)? else {
            continue;
        };
        let qualifiers = &row.qualifiers.0;
        let interest_type = qualifiers
            .get("interest")
            .and_then(Value::as_str)
            .unwrap_or("economic");
        let interest_type = InterestType::try_from(interest_type).map_err(|error| {
            MaterializeClaimError::EvidenceSpine(format!(
                "invalid ownership interest qualifiers: {error}"
            ))
        })?;
        let mut edge = OwnershipEdge::new(
            row.object_entity_id,
            row.subject_entity_id,
            edge_interest,
            interest_type,
        )
        .with_direct(
            qualifiers
                .get("direct")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        )
        .with_claim_id(row.id);
        if let Some(class) = qualifiers.get("security_class").and_then(Value::as_str) {
            edge = edge.with_security_class(class.to_owned());
        }
        if let Some(group) = qualifiers.get("disjoint_group").and_then(Value::as_str) {
            edge = edge.with_disjoint_group(group.to_owned());
        }
        edges.push(edge);
    }
    let qualifiers = &claim.qualifiers.0;
    let interest_type = qualifiers
        .get("interest")
        .and_then(Value::as_str)
        .unwrap_or("economic");
    let interest_type = InterestType::try_from(interest_type).map_err(|error| {
        MaterializeClaimError::EvidenceSpine(format!(
            "invalid ownership interest qualifiers: {error}"
        ))
    })?;
    let security_class = qualifiers.get("security_class").and_then(Value::as_str);
    let calculation = compute_indirect_interest(
        &edges,
        &claim.object_entity_id.as_deref().unwrap_or_default(),
        &claim.subject_entity_id,
        interest_type,
        security_class,
        DEFAULT_MAX_INTEREST_PATHS,
    )
    .map_err(|error| {
        MaterializeClaimError::EvidenceSpine(format!(
            "invalid ownership interest qualifiers: {error}"
        ))
    })?;
    let trace_id = format!(
        "calc_{}",
        stable_hash_parts(&[
            Value::String(relationship_id.to_owned()),
            Value::String(claim.object_entity_id.clone().unwrap_or_default()),
            Value::String(claim.subject_entity_id.clone()),
            Value::String(interest_type.as_str().to_owned()),
        ])[..32]
            .to_owned()
    );
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM calculation_traces WHERE id = $1)",
    )
    .bind(&trace_id)
    .fetch_one(&mut **transaction)
    .await?;
    if exists {
        return Ok(());
    }
    let subgraph = json!({
        "edges": edges.iter().map(|edge| format!("{}->{}", edge.owner_id, edge.owned_id)).collect::<Vec<_>>()
    });
    let result = serde_json::to_value(calculation.trace())
        .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    sqlx::query(
        "INSERT INTO calculation_traces \
         (id, relationship_id, measurement_name, input_claim_ids, subgraph, algorithm_version, result, created_at) \
         VALUES ($1, $2, 'ownership_interest', $3, $4, $5, $6, $7)",
    )
    .bind(&trace_id)
    .bind(relationship_id)
    .bind(Json(json!([claim.id])))
    .bind(Json(subgraph))
    .bind(calculation.algorithm_version)
    .bind(Json(result))
    .bind(chrono::Utc::now().naive_utc())
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

impl Database {
    pub async fn materialize_claim(
        &self,
        claim_id: &str,
        reviewer: &str,
        complete_control_path: bool,
    ) -> Result<RelationshipRecord, MaterializeClaimError> {
        let reviewer = reviewer.trim();
        if reviewer.is_empty() {
            return Err(MaterializeClaimError::EvidenceSpine(
                "materialization requires a non-empty reviewer identity".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let claim = sqlx::query_as::<_, MaterializableClaim>(
            "SELECT id, subject_entity_id, predicate, object_entity_id, object_value, qualifiers, \
                    valid_from, valid_to, recorded_at, retracted_at, evidence_class, status \
             FROM evidence_claims WHERE id = $1 FOR UPDATE",
        )
        .bind(claim_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| {
            MaterializeClaimError::EvidenceSpine(format!("claim {claim_id:?} does not exist"))
        })?;
        let Some(object_entity_id) = claim.object_entity_id.as_deref() else {
            return Err(MaterializeClaimError::EvidenceSpine(
                "only entity-to-entity claims materialize as relationships".to_owned(),
            ));
        };
        if claim.retracted_at.is_some()
            || matches!(claim.status.as_str(), "rejected" | "superseded")
        {
            return Err(MaterializeClaimError::EvidenceSpine(
                "retracted or rejected claims cannot materialize".to_owned(),
            ));
        }
        ensure_qualifiers_object(&claim.qualifiers.0)?;
        let decision = evaluate_claim(&mut transaction, &claim, complete_control_path).await?;
        if !decision.accepted {
            return Err(MaterializeClaimError::EvidenceSpine(
                decision.reasons.join("; "),
            ));
        }
        validate_interest_claim(&claim)?;
        let digest = relationship_digest(&claim);
        if let Some(existing) = existing_by_hash(&mut transaction, &digest).await? {
            sqlx::query(
                "INSERT INTO relationship_claim_links \
                 (relationship_id, claim_id, derivation_role, added_at) \
                 VALUES ($1, $2, 'supporting', $3) ON CONFLICT (relationship_id, claim_id) DO NOTHING",
            )
            .bind(&existing.id)
            .bind(&claim.id)
            .bind(chrono::Utc::now().naive_utc())
            .execute(&mut *transaction)
            .await?;
            let record = load_relationship_record(&mut transaction, &existing.id).await?;
            transaction.commit().await?;
            return Ok(record);
        }
        if let Some((conflicting_relationship_id, dimensions, reason)) =
            conflict_with_relationship(&mut transaction, &claim).await?
        {
            let adjudication_id = save_adjudication_item(
                &mut transaction,
                &claim,
                &conflicting_relationship_id,
                dimensions,
                &reason,
            )
            .await?;
            transaction.commit().await?;
            return Err(MaterializeClaimError::EvidenceSpine(format!(
                "claim contradicts accepted relationship {conflicting_relationship_id} ({reason}); opened adjudication item {adjudication_id}"
            )));
        }
        let qualifiers = &claim.qualifiers.0;
        let lifecycle_state = qualifiers
            .get("lifecycle_state")
            .and_then(Value::as_str)
            .unwrap_or("current")
            .to_ascii_lowercase();
        let lifecycle_state = match lifecycle_state.as_str() {
            "current" | "historical" | "proposed" | "pending" | "disputed" | "rejected"
            | "superseded" => lifecycle_state,
            _ => "current".to_owned(),
        };
        let relationship_id = format!("rel_{}", &digest[..32]);
        let now = chrono::Utc::now().naive_utc();
        sqlx::query(
            "INSERT INTO accepted_relationships \
             (id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, valid_to, \
              recorded_at, retracted_at, materialized_at, materialized_by, acceptance_policy_version, \
              status, lifecycle_state, relationship_hash) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11, 'accepted', $12, $13)",
        )
        .bind(&relationship_id)
        .bind(&claim.subject_entity_id)
        .bind(&claim.predicate)
        .bind(object_entity_id)
        .bind(Json(qualifiers))
        .bind(claim.valid_from)
        .bind(claim.valid_to)
        .bind(claim.recorded_at)
        .bind(now)
        .bind(reviewer)
        .bind(&decision.policy_version)
        .bind(&lifecycle_state)
        .bind(&digest)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO relationship_claim_links \
             (relationship_id, claim_id, derivation_role, added_at) \
             VALUES ($1, $2, 'primary', $3)",
        )
        .bind(&relationship_id)
        .bind(&claim.id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("UPDATE evidence_claims SET status = 'accepted' WHERE id = $1")
            .bind(&claim.id)
            .execute(&mut *transaction)
            .await?;
        persist_interest_trace(&mut transaction, &claim, &relationship_id).await?;
        let record = load_relationship_record(&mut transaction, &relationship_id).await?;
        transaction.commit().await?;
        Ok(record)
    }
}

#[cfg(test)]
mod tests {
    use super::{compare_relationship, MaterializableClaim, RelationshipCandidate};
    use chrono::NaiveDateTime;
    use serde_json::json;
    use sqlx::types::Json;

    fn test_claim(qualifiers: serde_json::Value, object: &str) -> MaterializableClaim {
        MaterializableClaim {
            id: "claim".to_owned(),
            subject_entity_id: "subject".to_owned(),
            predicate: "directly_owns".to_owned(),
            object_entity_id: Some(object.to_owned()),
            object_value: None,
            qualifiers: Json(qualifiers),
            valid_from: None,
            valid_to: None,
            recorded_at: NaiveDateTime::MIN,
            retracted_at: None,
            evidence_class: "registry_filing".to_owned(),
            status: "candidate".to_owned(),
        }
    }

    fn candidate(qualifiers: serde_json::Value, object: &str) -> RelationshipCandidate {
        RelationshipCandidate {
            id: "relationship".to_owned(),
            predicate: "directly_owns".to_owned(),
            object_entity_id: object.to_owned(),
            qualifiers: Json(qualifiers),
            valid_from: None,
            valid_to: None,
        }
    }

    #[test]
    fn conflict_check_preserves_disjoint_share_classes_and_transaction_statuses() {
        let claim = test_claim(json!({"security_class":"Class A"}), "owner");
        assert!(compare_relationship(
            &claim,
            &candidate(json!({"security_class":"Class B"}), "other-owner")
        )
        .is_none());

        let claim = test_claim(json!({"txn_status":"completed"}), "owner");
        assert!(compare_relationship(
            &claim,
            &candidate(json!({"txn_status":"announced"}), "other-owner")
        )
        .is_none());
    }

    #[test]
    fn conflict_check_rejects_competing_objects_only_when_validity_overlaps() {
        let mut claim = test_claim(json!({}), "owner-a");
        claim.valid_from = Some(
            NaiveDateTime::parse_from_str("2025-01-01 00:00:00", "%Y-%m-%d %H:%M:%S").unwrap(),
        );
        claim.valid_to = Some(
            NaiveDateTime::parse_from_str("2025-12-31 00:00:00", "%Y-%m-%d %H:%M:%S").unwrap(),
        );
        assert!(compare_relationship(&claim, &candidate(json!({}), "owner-b")).is_some());

        let mut later = candidate(json!({}), "owner-b");
        later.valid_from = Some(
            NaiveDateTime::parse_from_str("2026-01-01 00:00:00", "%Y-%m-%d %H:%M:%S").unwrap(),
        );
        assert!(compare_relationship(&claim, &later).is_none());
    }
}
