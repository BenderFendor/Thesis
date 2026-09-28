use std::collections::{BTreeSet, HashMap};

use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Transaction};

#[derive(Clone, Debug)]
pub struct RelationshipRecord {
    pub id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: String,
    pub qualifiers: Value,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
    pub recorded_at: NaiveDateTime,
    pub retracted_at: Option<NaiveDateTime>,
    pub materialized_at: NaiveDateTime,
    pub materialized_by: Option<String>,
    pub acceptance_policy_version: String,
    pub status: String,
    pub claim_ids: Vec<String>,
    pub evidence_root_count: usize,
}

#[derive(Debug, FromRow)]
struct RelationshipRow {
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
struct RelationshipClaimRow {
    relationship_id: String,
    claim_id: String,
}

#[derive(Debug, FromRow)]
struct EvidenceDocumentRow {
    claim_id: String,
    document_id: String,
}

pub(super) async fn list_relationships(
    pool: &PgPool,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
    predicates: Option<Vec<String>>,
    entity_id: Option<String>,
) -> Result<Vec<RelationshipRecord>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let rows = fetch_relationship_rows(
        &mut transaction,
        as_of,
        known_at,
        predicates.as_deref(),
        entity_id.as_deref(),
    )
    .await?;
    let relationship_ids = rows.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let claim_ids_by_relationship =
        fetch_relationship_claim_ids(&mut transaction, &relationship_ids).await?;
    let claim_ids = claim_ids_by_relationship
        .values()
        .flatten()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let root_ids_by_claim = fetch_root_ids_by_claim(&mut transaction, &claim_ids).await?;
    let records = assemble_relationship_records(rows, claim_ids_by_relationship, root_ids_by_claim);
    transaction.commit().await?;
    Ok(records)
}

async fn fetch_relationship_rows(
    transaction: &mut Transaction<'_, Postgres>,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
    predicates: Option<&[String]>,
    entity_id: Option<&str>,
) -> Result<Vec<RelationshipRow>, sqlx::Error> {
    let predicates = predicates.filter(|values| !values.is_empty());
    let entity_id = entity_id.filter(|value| !value.is_empty());
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, \
            valid_to, recorded_at, retracted_at, materialized_at, materialized_by, \
            acceptance_policy_version, status \
         FROM accepted_relationships \
         WHERE (valid_from IS NULL OR valid_from <= ",
    );
    query
        .push_bind(as_of)
        .push(") AND (valid_to IS NULL OR valid_to >= ")
        .push_bind(as_of)
        .push(") AND recorded_at <= ")
        .push_bind(known_at)
        .push(" AND (retracted_at IS NULL OR retracted_at > ")
        .push_bind(known_at)
        .push(")");

    if let Some(predicates) = predicates {
        query.push(" AND predicate IN (");
        let mut values = query.separated(", ");
        for predicate in predicates {
            values.push_bind(predicate);
        }
        values.push_unseparated(")");
    }
    if let Some(entity_id) = entity_id {
        query
            .push(" AND (subject_entity_id = ")
            .push_bind(entity_id)
            .push(" OR object_entity_id = ")
            .push_bind(entity_id)
            .push(")");
    }

    let relationship_rows = query
        .build_query_as::<RelationshipRow>()
        .fetch_all(&mut **transaction)
        .await?;
    Ok(relationship_rows)
}

async fn fetch_relationship_claim_ids(
    transaction: &mut Transaction<'_, Postgres>,
    relationship_ids: &[String],
) -> Result<HashMap<String, Vec<String>>, sqlx::Error> {
    if relationship_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let links = sqlx::query_as::<_, RelationshipClaimRow>(
        "SELECT relationship_id, claim_id FROM relationship_claim_links \
         WHERE relationship_id = ANY($1)",
    )
    .bind(relationship_ids)
    .fetch_all(&mut **transaction)
    .await?;

    let mut claim_ids_by_relationship = HashMap::<String, Vec<String>>::new();
    for link in links {
        claim_ids_by_relationship
            .entry(link.relationship_id)
            .or_default()
            .push(link.claim_id);
    }
    for claim_ids in claim_ids_by_relationship.values_mut() {
        claim_ids.sort();
    }
    Ok(claim_ids_by_relationship)
}

async fn fetch_root_ids_by_claim(
    transaction: &mut Transaction<'_, Postgres>,
    claim_ids: &[String],
) -> Result<HashMap<String, BTreeSet<String>>, sqlx::Error> {
    let mut root_ids_by_claim = HashMap::<String, BTreeSet<String>>::new();
    if claim_ids.is_empty() {
        return Ok(root_ids_by_claim);
    }

    let evidence_documents = sqlx::query_as::<_, EvidenceDocumentRow>(
        "SELECT ce.claim_id, s.document_id \
         FROM claim_evidence_links ce \
         JOIN evidence_observations o ON o.id = ce.observation_id \
         JOIN document_snapshots s ON s.id = o.snapshot_id \
         WHERE ce.claim_id = ANY($1)",
    )
    .bind(claim_ids)
    .fetch_all(&mut **transaction)
    .await?;
    if evidence_documents.is_empty() {
        return Ok(root_ids_by_claim);
    }

    let lineage = sqlx::query_as::<_, super::LineageRow>(
        "SELECT parent_document_id, child_document_id FROM source_lineage",
    )
    .fetch_all(&mut **transaction)
    .await?;
    let mut parents = HashMap::<String, BTreeSet<String>>::new();
    for row in lineage {
        parents
            .entry(row.child_document_id)
            .or_default()
            .insert(row.parent_document_id);
    }
    for evidence in evidence_documents {
        root_ids_by_claim
            .entry(evidence.claim_id)
            .or_default()
            .insert(super::lineage_root(&evidence.document_id, &parents));
    }
    Ok(root_ids_by_claim)
}

fn assemble_relationship_records(
    rows: Vec<RelationshipRow>,
    mut claim_ids_by_relationship: HashMap<String, Vec<String>>,
    root_ids_by_claim: HashMap<String, BTreeSet<String>>,
) -> Vec<RelationshipRecord> {
    let mut records = rows
        .into_iter()
        .map(|row| {
            let claim_ids = claim_ids_by_relationship
                .remove(&row.id)
                .unwrap_or_default();
            let root_count = claim_ids
                .iter()
                .filter_map(|claim_id| root_ids_by_claim.get(claim_id))
                .flatten()
                .collect::<BTreeSet<_>>()
                .len();
            RelationshipRecord {
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
                evidence_root_count: root_count,
            }
        })
        .collect::<Vec<_>>();
    records.sort_by(|left, right| {
        (
            &left.predicate,
            &left.subject_entity_id,
            &left.object_entity_id,
            &left.id,
        )
            .cmp(&(
                &right.predicate,
                &right.subject_entity_id,
                &right.object_entity_id,
                &right.id,
            ))
    });

    records
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap};

    use super::super::lineage_root;

    #[test]
    fn lineage_cycle_with_terminal_parent_uses_the_terminal_root() {
        let mut parents = HashMap::new();
        parents.insert(
            "a".to_owned(),
            BTreeSet::from(["b".to_owned(), "z".to_owned()]),
        );
        parents.insert("b".to_owned(), BTreeSet::from(["a".to_owned()]));

        assert_eq!(lineage_root("a", &parents), "z");
        assert_eq!(lineage_root("b", &parents), "z");
        assert_eq!(lineage_root("z", &parents), "z");
    }
}
