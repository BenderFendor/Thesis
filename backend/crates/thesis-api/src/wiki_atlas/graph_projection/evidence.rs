use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use chrono::NaiveDateTime;
use serde_json::{json, Map, Value};
use thesis_db::AtlasProjectionData;

use super::super::super::{
    AtlasConfidenceTier, AtlasDirection, AtlasEdgeResponse, AtlasEntityType,
    AtlasEvidenceRefResponse, AtlasFactStatus, AtlasLifecycleState, AtlasNodeResponse,
    AtlasRelationType,
};
use super::super::{edge_id, GraphData};
use super::shared::{
    canonical_entity_id, edge_base, entities, json_truthy, live_entities, outlet_node_ids,
    reporter_entity_map, survivor_map, Entity, BYLINE_PREDICATES, EVIDENCE_ORGANIZATION_KINDS,
    EVIDENCE_PUBLICATION_KINDS, INTEREST_PREDICATES, OWNERSHIP_PREDICATES,
};

fn entity_nodes(
    organizations: &[Entity<'_>],
    people: &[Entity<'_>],
    reporter_map: &HashMap<String, String>,
) -> Vec<AtlasNodeResponse> {
    let mut nodes = Vec::with_capacity(organizations.len() + people.len());
    for entity in organizations {
        nodes.push(AtlasNodeResponse {
            id: format!("organization:{}", entity.id),
            entity_type: AtlasEntityType::Organization,
            label: entity.canonical_name.to_owned(),
            subtitle: Some(entity.entity_kind.replace('_', " ")),
            country_code: None,
            funding_type: None,
            bias_rating: None,
            factual_reporting: None,
            credibility_score: None,
            analysis_scores: BTreeMap::new(),
            article_count: 0,
            connection_count: 0,
            ownership_connection_count: 0,
            status: Some(entity.status.to_owned()),
            confidence_tier: Some(if entity.status == "accepted" {
                AtlasConfidenceTier::Verified
            } else {
                AtlasConfidenceTier::Unresolved
            }),
            profile_path: Some(format!("/wiki/organization/{}", entity.id)),
            updated_at: Some(entity.updated_at),
            flags: if entity.status == "accepted" {
                Vec::new()
            } else {
                vec!["candidate-entity".to_owned()]
            },
            current_parent: None,
            pending_change: None,
            evidence_coverage: "not researched".to_owned(),
            freshness: "unknown".to_owned(),
            unresolved_gap: None,
        });
    }
    for entity in people {
        if reporter_map.contains_key(entity.id) {
            continue;
        }
        nodes.push(AtlasNodeResponse {
            id: format!("person:{}", entity.id),
            entity_type: AtlasEntityType::Person,
            label: entity.canonical_name.to_owned(),
            subtitle: Some("Person".to_owned()),
            country_code: None,
            funding_type: None,
            bias_rating: None,
            factual_reporting: None,
            credibility_score: None,
            analysis_scores: BTreeMap::new(),
            article_count: 0,
            connection_count: 0,
            ownership_connection_count: 0,
            status: Some(entity.status.to_owned()),
            confidence_tier: Some(if entity.status == "accepted" {
                AtlasConfidenceTier::Verified
            } else {
                AtlasConfidenceTier::Unresolved
            }),
            profile_path: Some(format!("/wiki/person/{}", entity.id)),
            updated_at: Some(entity.updated_at),
            flags: if entity.status == "accepted" {
                Vec::new()
            } else {
                vec!["candidate-entity".to_owned()]
            },
            current_parent: None,
            pending_change: None,
            evidence_coverage: "not researched".to_owned(),
            freshness: "unknown".to_owned(),
            unresolved_gap: None,
        });
    }
    nodes
}

fn entity_node_ids(
    organizations: &[Entity<'_>],
    people: &[Entity<'_>],
    publications: &[Entity<'_>],
    outlet_ids: &HashMap<String, String>,
    reporter_map: &HashMap<String, String>,
    survivors: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut node_ids = HashMap::new();
    for entity in organizations {
        node_ids.insert(
            entity.id.to_owned(),
            format!("organization:{}", canonical_entity_id(entity.id, survivors)),
        );
    }
    for entity in people {
        let canonical_id = canonical_entity_id(entity.id, survivors);
        node_ids.insert(
            entity.id.to_owned(),
            reporter_map
                .get(canonical_id)
                .cloned()
                .unwrap_or_else(|| format!("person:{canonical_id}")),
        );
    }
    for entity in publications {
        if let Some(outlet_id) = outlet_ids.get(entity.id) {
            node_ids.insert(entity.id.to_owned(), outlet_id.clone());
        }
    }
    node_ids
}

#[derive(Clone, Copy)]
struct Claim<'a> {
    evidence_class: &'a str,
    status: &'a str,
}

#[derive(Clone, Copy)]
struct Observation<'a> {
    snapshot_id: &'a str,
    locator: &'a Value,
    quoted_text: Option<&'a str>,
    entailment: &'a str,
}

#[derive(Clone, Copy)]
struct Snapshot<'a> {
    document_id: &'a str,
    sha256_raw: &'a str,
    retrieved_at: NaiveDateTime,
}

#[derive(Clone, Copy)]
struct Document<'a> {
    source_url: &'a str,
    title: Option<&'a str>,
    source_class: &'a str,
}

/// Bitemporal cut and evidence-preview setting for one projection.
#[derive(Clone, Copy)]
struct ProjectionView {
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
    include_preview: bool,
}

struct EvidenceContext<'a> {
    claims: HashMap<&'a str, Claim<'a>>,
    observation_ids_by_claim: HashMap<&'a str, Vec<&'a str>>,
    observations: HashMap<&'a str, Observation<'a>>,
    snapshots: HashMap<&'a str, Snapshot<'a>>,
    documents: HashMap<&'a str, Document<'a>>,
    claim_root_counts: HashMap<&'a str, i64>,
    relationship_root_counts: HashMap<&'a str, i64>,
    claim_ids_by_relationship: HashMap<&'a str, Vec<&'a str>>,
    ownership_traces: HashMap<&'a str, &'a Value>,
}

impl<'a> EvidenceContext<'a> {
    fn from_projection(data: &'a AtlasProjectionData) -> Self {
        let claims = data
            .claims
            .iter()
            .map(|row| {
                (
                    row.id.as_str(),
                    Claim {
                        evidence_class: &row.evidence_class,
                        status: &row.status,
                    },
                )
            })
            .collect();
        let mut observation_ids_by_claim = HashMap::<&str, Vec<&str>>::new();
        for link in &data.claim_evidence_links {
            observation_ids_by_claim
                .entry(link.claim_id.as_str())
                .or_default()
                .push(link.observation_id.as_str());
        }
        for observation_ids in observation_ids_by_claim.values_mut() {
            observation_ids.sort_unstable();
        }
        let observations = data
            .observations
            .iter()
            .map(|row| {
                (
                    row.id.as_str(),
                    Observation {
                        snapshot_id: &row.snapshot_id,
                        locator: &row.locator.0,
                        quoted_text: row.quoted_text.as_deref(),
                        entailment: &row.entailment,
                    },
                )
            })
            .collect();
        let snapshots = data
            .snapshots
            .iter()
            .map(|row| {
                (
                    row.id.as_str(),
                    Snapshot {
                        document_id: &row.document_id,
                        sha256_raw: &row.sha256_raw,
                        retrieved_at: row.retrieved_at,
                    },
                )
            })
            .collect();
        let documents = data
            .documents
            .iter()
            .map(|row| {
                (
                    row.id.as_str(),
                    Document {
                        source_url: &row.source_url,
                        title: row.title.as_deref(),
                        source_class: &row.source_class,
                    },
                )
            })
            .collect();
        let claim_root_counts = data
            .claim_evidence_root_counts
            .iter()
            .map(|row| (row.claim_id.as_str(), row.evidence_root_count))
            .collect();
        let relationship_root_counts = data
            .relationship_evidence_root_counts
            .iter()
            .map(|row| (row.relationship_id.as_str(), row.evidence_root_count))
            .collect();
        let mut claim_ids_by_relationship = HashMap::<&str, Vec<&str>>::new();
        for link in &data.relationship_claim_links {
            claim_ids_by_relationship
                .entry(link.relationship_id.as_str())
                .or_default()
                .push(link.claim_id.as_str());
        }
        for claim_ids in claim_ids_by_relationship.values_mut() {
            claim_ids.sort_unstable();
        }
        let ownership_traces = data
            .calculation_traces
            .iter()
            .filter(|trace| trace.measurement_name == "ownership_interest")
            .filter_map(|trace| {
                trace
                    .relationship_id
                    .as_deref()
                    .map(|relationship_id| (relationship_id, &trace.result.0))
            })
            .collect();
        Self {
            claims,
            observation_ids_by_claim,
            observations,
            snapshots,
            documents,
            claim_root_counts,
            relationship_root_counts,
            claim_ids_by_relationship,
            ownership_traces,
        }
    }
}

fn evidence_refs_for_claim(
    claim_id: &str,
    context: &EvidenceContext<'_>,
    policy_version: Option<&str>,
    acceptance_decision: Option<&str>,
) -> Vec<AtlasEvidenceRefResponse> {
    let Some(claim) = context.claims.get(claim_id) else {
        return Vec::new();
    };
    context
        .observation_ids_by_claim
        .get(claim_id)
        .into_iter()
        .flatten()
        .filter_map(|observation_id| {
            let observation = context.observations.get(*observation_id)?;
            let snapshot = context.snapshots.get(observation.snapshot_id);
            let document =
                snapshot.and_then(|snapshot| context.documents.get(snapshot.document_id));
            let locator = if json_truthy(observation.locator) {
                observation.locator.clone()
            } else {
                json!({})
            };
            Some(AtlasEvidenceRefResponse {
                id: format!("evidence-observation:{observation_id}"),
                source_type: document.map_or_else(
                    || "snapshot".to_owned(),
                    |document| document.source_class.to_owned(),
                ),
                source_name: document.and_then(|document| document.title.map(str::to_owned)),
                source_url: document.map(|document| document.source_url.to_owned()),
                retrieved_at: snapshot.map(|snapshot| snapshot.retrieved_at),
                excerpt: observation.quoted_text.map(str::to_owned),
                snapshot_sha256: snapshot.map(|snapshot| snapshot.sha256_raw.to_owned()),
                locator,
                entailment: Some(observation.entailment.to_owned()),
                evidence_class: Some(claim.evidence_class.to_owned()),
                policy_version: policy_version.map(str::to_owned),
                acceptance_decision: acceptance_decision
                    .map(str::to_owned)
                    .or_else(|| Some(claim.status.to_owned())),
                contradictions: Vec::new(),
            })
        })
        .collect()
}

fn evidence_preview(
    evidence: &[AtlasEvidenceRefResponse],
    include_preview: bool,
) -> Vec<AtlasEvidenceRefResponse> {
    if include_preview {
        evidence.iter().take(3).cloned().collect()
    } else {
        Vec::new()
    }
}

fn python_scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::Null | Value::Array(_) | Value::Object(_) => None,
        Value::Bool(value) => Some(if *value { "True" } else { "False" }.to_owned()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
    }
}

fn decimal_interest(qualifiers: &Map<String, Value>, key: &str) -> Option<Value> {
    let raw = qualifiers.get(key)?;
    if let Some(object) = raw.as_object() {
        let lower = object.get("lower").filter(|value| !value.is_null())?;
        let upper = object.get("upper").filter(|value| !value.is_null())?;
        return Some(json!({
            "lower": python_scalar_string(lower)?,
            "upper": python_scalar_string(upper)?,
        }));
    }
    if raw.is_array() || raw.is_object() || raw.is_null() {
        return None;
    }
    Some(json!({ "exact": python_scalar_string(raw)? }))
}

fn number_as_python_float(value: &Value) -> Option<f64> {
    match value {
        Value::Bool(value) => Some(f64::from(*value)),
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.parse().ok(),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    }
}

fn ownership_percentage(qualifiers: &Map<String, Value>) -> Option<f64> {
    qualifiers.get("pct").and_then(|value| match value {
        Value::Bool(value) => Some(f64::from(*value)),
        Value::Number(value) => value.as_f64(),
        _ => None,
    })
}

fn qualifiers_with_trace(qualifiers: &Value, trace: Option<&Value>) -> Map<String, Value> {
    let mut result = qualifiers.as_object().cloned().unwrap_or_default();
    let Some(aggregate) = trace
        .and_then(|trace| trace.get("aggregate"))
        .filter(|aggregate| json_truthy(aggregate))
    else {
        return result;
    };
    let Some(lower) = aggregate.get("lower").and_then(number_as_python_float) else {
        return result;
    };
    let Some(upper) = aggregate.get("upper").and_then(number_as_python_float) else {
        return result;
    };
    if let Some(range) = json!({ "lower": lower, "upper": upper }).as_object() {
        result.insert("pct_range".to_owned(), Value::Object(range.clone()));
    }
    result
}

fn lifecycle_state(value: Option<&Value>) -> AtlasLifecycleState {
    let raw = value
        .filter(|value| json_truthy(value))
        .and_then(python_scalar_string)
        .unwrap_or_else(|| "current".to_owned());
    match raw.to_lowercase().as_str() {
        "announced" | "proposed" => AtlasLifecycleState::Proposed,
        "approved" | "pending" => AtlasLifecycleState::Pending,
        "closed" | "historical" => AtlasLifecycleState::Historical,
        "disputed" => AtlasLifecycleState::Disputed,
        "rejected" => AtlasLifecycleState::Rejected,
        "superseded" => AtlasLifecycleState::Superseded,
        _ => AtlasLifecycleState::Current,
    }
}

fn relation_type(predicate: &str) -> AtlasRelationType {
    if predicate == "founded_by" {
        AtlasRelationType::FoundedBy
    } else {
        AtlasRelationType::Ownership
    }
}

fn display_group(predicate: &str) -> &'static str {
    match predicate {
        "directly_owns" | "owns_equity_in" | "controls" | "brand_of" | "operated_by"
        | "successor_of" | "ownership" => "ownership_control",
        "employed_by" | "current_outlet" | "coauthor" | "shared_outlet" | "founded_by" => {
            "newsroom_people"
        }
        "publishes" | "distributed_by" | "syndicated_by" => "publishing_distribution",
        "authorizes_inventory_seller"
        | "sponsors_content"
        | "political_ad_purchase"
        | "advertising_inventory_sold_by" => "advertising_sponsorship",
        "funds" => "funding_government_awards",
        _ => "other",
    }
}

fn as_of_visible(
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    recorded_at: NaiveDateTime,
    retracted_at: Option<NaiveDateTime>,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
) -> bool {
    valid_from.is_none_or(|value| value <= as_of)
        && valid_to.is_none_or(|value| value >= as_of)
        && recorded_at <= known_at
        && retracted_at.is_none_or(|value| value > known_at)
}

fn relationship_claim_ids(relationship_id: &str, context: &EvidenceContext<'_>) -> Vec<String> {
    context
        .claim_ids_by_relationship
        .get(relationship_id)
        .into_iter()
        .flatten()
        .map(|claim_id| (*claim_id).to_owned())
        .collect()
}

fn accepted_edges(
    data: &AtlasProjectionData,
    context: &EvidenceContext<'_>,
    node_id_by_entity: &HashMap<String, String>,
    survivors: &HashMap<String, String>,
    reporter_map: &HashMap<String, String>,
    view: ProjectionView,
) -> Vec<AtlasEdgeResponse> {
    let mut edges = Vec::new();
    for relationship in &data.accepted_relationships {
        if !OWNERSHIP_PREDICATES.contains(&relationship.predicate.as_str())
            || !as_of_visible(
                relationship.valid_from,
                relationship.valid_to,
                relationship.recorded_at,
                relationship.retracted_at,
                view.as_of,
                view.known_at,
            )
        {
            continue;
        }
        let predicate = relationship.predicate.as_str();
        let subject = canonical_entity_id(&relationship.subject_entity_id, survivors);
        if BYLINE_PREDICATES.contains(&predicate) && reporter_map.contains_key(subject) {
            continue;
        }
        let object = canonical_entity_id(&relationship.object_entity_id, survivors);
        let (Some(source_id), Some(target_id)) = (
            node_id_by_entity.get(object),
            node_id_by_entity.get(subject),
        ) else {
            continue;
        };
        let claim_ids = relationship_claim_ids(&relationship.id, context);
        let evidence = claim_ids
            .iter()
            .flat_map(|claim_id| {
                evidence_refs_for_claim(
                    claim_id,
                    context,
                    Some(&relationship.acceptance_policy_version),
                    Some("accepted"),
                )
            })
            .collect::<Vec<_>>();
        let raw_qualifiers = &relationship.qualifiers.0;
        let ownership_percentage = raw_qualifiers.as_object().and_then(ownership_percentage);
        let qualifiers = qualifiers_with_trace(
            raw_qualifiers,
            context
                .ownership_traces
                .get(relationship.id.as_str())
                .copied(),
        );
        let last_verified_at = evidence
            .iter()
            .filter_map(|reference| reference.retrieved_at)
            .max()
            .or(Some(relationship.materialized_at));
        let mut edge = edge_base(
            format!("evidence-edge:{}", relationship.id),
            source_id.clone(),
            target_id.clone(),
            relation_type(predicate),
            Some(predicate),
            Some(display_group(predicate)),
            Some(predicate),
        );
        edge.ownership_percentage = ownership_percentage;
        edge.voting_interest = decimal_interest(&qualifiers, "voting_interest");
        edge.economic_interest = decimal_interest(&qualifiers, "economic_interest")
            .or_else(|| decimal_interest(&qualifiers, "pct_range"))
            .or_else(|| decimal_interest(&qualifiers, "pct"));
        edge.beneficial_interest = decimal_interest(&qualifiers, "beneficial_interest");
        edge.confidence = Some(1.0);
        edge.confidence_tier = Some(AtlasConfidenceTier::Verified);
        edge.evidence_count = i64::try_from(evidence.len()).unwrap_or(i64::MAX);
        edge.evidence_preview = evidence_preview(&evidence, view.include_preview);
        edge.valid_from = relationship.valid_from;
        edge.valid_to = relationship.valid_to;
        edge.last_verified_at = last_verified_at;
        edge.fact_status = AtlasFactStatus::Accepted;
        edge.lifecycle_state =
            lifecycle_state(Some(&Value::String(relationship.lifecycle_state.clone())));
        edge.accepted_fact = true;
        edge.qualifiers = Value::Object(qualifiers);
        edge.claim_ids = claim_ids;
        edge.recorded_at = Some(relationship.recorded_at);
        edge.retracted_at = relationship.retracted_at;
        edge.acceptance_policy_version = Some(relationship.acceptance_policy_version.clone());
        edge.evidence_root_count = context
            .relationship_root_counts
            .get(relationship.id.as_str())
            .copied()
            .unwrap_or_default();
        edges.push(edge);
    }
    edges
}

fn candidate_edges(
    data: &AtlasProjectionData,
    context: &EvidenceContext<'_>,
    node_id_by_entity: &HashMap<String, String>,
    survivors: &HashMap<String, String>,
    reporter_map: &HashMap<String, String>,
    view: ProjectionView,
) -> Vec<AtlasEdgeResponse> {
    let mut edges = Vec::new();
    for claim in &data.claims {
        if claim.status != "candidate"
            || !OWNERSHIP_PREDICATES.contains(&claim.predicate.as_str())
            || !as_of_visible(
                claim.valid_from,
                claim.valid_to,
                claim.recorded_at,
                claim.retracted_at,
                view.as_of,
                view.known_at,
            )
        {
            continue;
        }
        let Some(object_entity_id) = claim.object_entity_id.as_deref() else {
            continue;
        };
        let predicate = claim.predicate.as_str();
        let subject = canonical_entity_id(&claim.subject_entity_id, survivors);
        if BYLINE_PREDICATES.contains(&predicate) && reporter_map.contains_key(subject) {
            continue;
        }
        let object = canonical_entity_id(object_entity_id, survivors);
        let (Some(source_id), Some(target_id)) = (
            node_id_by_entity.get(object),
            node_id_by_entity.get(subject),
        ) else {
            continue;
        };
        let evidence = evidence_refs_for_claim(&claim.id, context, None, Some(&claim.status));
        let qualifiers_value = &claim.qualifiers.0;
        let qualifiers = qualifiers_value.as_object().cloned().unwrap_or_default();
        let ownership_percentage = ownership_percentage(&qualifiers);
        let lifecycle_marker = qualifiers
            .get("lifecycle_state")
            .filter(|value| json_truthy(value))
            .or_else(|| qualifiers.get("txn_status"));
        let mut edge = edge_base(
            format!("evidence-candidate-edge:{}", claim.id),
            source_id.clone(),
            target_id.clone(),
            relation_type(predicate),
            Some(predicate),
            Some(display_group(predicate)),
            Some(predicate),
        );
        edge.ownership_percentage = ownership_percentage;
        edge.voting_interest = decimal_interest(&qualifiers, "voting_interest");
        edge.economic_interest = decimal_interest(&qualifiers, "economic_interest")
            .or_else(|| decimal_interest(&qualifiers, "pct_range"))
            .or_else(|| decimal_interest(&qualifiers, "pct"));
        edge.beneficial_interest = decimal_interest(&qualifiers, "beneficial_interest");
        edge.confidence_tier = Some(AtlasConfidenceTier::Unresolved);
        edge.evidence_count = i64::try_from(evidence.len()).unwrap_or(i64::MAX);
        edge.evidence_preview = evidence_preview(&evidence, view.include_preview);
        edge.valid_from = claim.valid_from;
        edge.valid_to = claim.valid_to;
        edge.last_verified_at = evidence
            .iter()
            .filter_map(|reference| reference.retrieved_at)
            .max();
        edge.is_inferred = true;
        edge.lifecycle_state = lifecycle_state(lifecycle_marker);
        edge.qualifiers = Value::Object(qualifiers);
        edge.claim_ids = vec![claim.id.clone()];
        edge.recorded_at = Some(claim.recorded_at);
        edge.retracted_at = claim.retracted_at;
        edge.evidence_root_count = context
            .claim_root_counts
            .get(claim.id.as_str())
            .copied()
            .unwrap_or_default();
        edges.push(edge);
    }
    edges
}

fn accepted_interest_index(edges: &[AtlasEdgeResponse]) -> HashMap<String, usize> {
    let mut index = HashMap::<String, usize>::new();
    for (edge_index, edge) in edges.iter().enumerate() {
        if !edge.accepted_fact
            || !edge
                .raw_relation_type
                .as_deref()
                .is_some_and(|predicate| INTEREST_PREDICATES.contains(&predicate))
        {
            continue;
        }
        let replace = index.get(&edge.target_id).is_none_or(|existing_index| {
            edge.ownership_percentage.unwrap_or(0.0)
                > edges[*existing_index].ownership_percentage.unwrap_or(0.0)
        });
        if replace {
            index.insert(edge.target_id.clone(), edge_index);
        }
    }
    index
}

fn sibling_edges(
    outlet_ids: &HashMap<String, String>,
    accepted: &[AtlasEdgeResponse],
) -> Vec<AtlasEdgeResponse> {
    let edge_by_owned = accepted_interest_index(accepted);
    let outlet_ids = outlet_ids.values().cloned().collect::<BTreeSet<_>>();
    let mut groups = BTreeMap::<String, Vec<(String, Vec<String>)>>::new();
    for outlet_id in outlet_ids {
        let mut current = outlet_id.as_str();
        let mut seen = HashSet::from([current.to_owned()]);
        let mut chain = Vec::<&AtlasEdgeResponse>::new();
        while chain.len() < 12 {
            let Some(edge_index) = edge_by_owned.get(current) else {
                break;
            };
            let edge = &accepted[*edge_index];
            if seen.contains(&edge.source_id) {
                break;
            }
            chain.push(edge);
            current = &edge.source_id;
            seen.insert(current.to_owned());
        }
        if chain.is_empty() {
            continue;
        }
        let root = chain
            .last()
            .map_or_else(|| outlet_id.clone(), |edge| edge.source_id.clone());
        let claim_ids = chain
            .iter()
            .flat_map(|edge| edge.claim_ids.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        groups.entry(root).or_default().push((outlet_id, claim_ids));
    }

    let mut edges = Vec::new();
    for (root, mut members) in groups {
        if members.len() < 2 {
            continue;
        }
        members.sort_by(|left, right| left.0.cmp(&right.0));
        for left_index in 0..members.len() {
            for right_index in left_index + 1..members.len() {
                let (left_id, left_claims) = &members[left_index];
                let (right_id, right_claims) = &members[right_index];
                let claim_ids = left_claims
                    .iter()
                    .chain(right_claims)
                    .cloned()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>();
                let mut edge = edge_base(
                    edge_id(left_id, right_id, "sibling_via_owner", &root),
                    left_id.clone(),
                    right_id.clone(),
                    AtlasRelationType::SiblingViaOwner,
                    None,
                    None,
                    Some("sibling_via_owner_rollup"),
                );
                edge.direction = AtlasDirection::Undirected;
                edge.confidence = Some(0.75);
                edge.confidence_tier = Some(AtlasConfidenceTier::Strong);
                edge.evidence_count = i64::try_from(claim_ids.len()).unwrap_or(i64::MAX);
                edge.is_inferred = true;
                edge.qualifiers = json!({ "ultimate_owner_id": root });
                edge.claim_ids = claim_ids;
                edges.push(edge);
            }
        }
    }
    edges
}

fn evidence_projection(
    data: &AtlasProjectionData,
    all_entities: &[Entity<'_>],
    survivors: &HashMap<String, String>,
    reporter_map: &HashMap<String, String>,
    outlet_ids: &HashMap<String, String>,
    view: ProjectionView,
) -> (Vec<AtlasNodeResponse>, Vec<AtlasEdgeResponse>) {
    let organizations = live_entities(all_entities, survivors, EVIDENCE_ORGANIZATION_KINDS);
    let people = live_entities(all_entities, survivors, &["person"]);
    if organizations.is_empty() && people.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let publications = live_entities(all_entities, survivors, EVIDENCE_PUBLICATION_KINDS);
    let nodes = entity_nodes(&organizations, &people, reporter_map);
    let node_id_by_entity = entity_node_ids(
        &organizations,
        &people,
        &publications,
        outlet_ids,
        reporter_map,
        survivors,
    );
    let context = EvidenceContext::from_projection(data);
    let accepted = accepted_edges(
        data,
        &context,
        &node_id_by_entity,
        survivors,
        reporter_map,
        view,
    );
    let candidates = candidate_edges(
        data,
        &context,
        &node_id_by_entity,
        survivors,
        reporter_map,
        view,
    );
    let siblings = sibling_edges(outlet_ids, &accepted);
    let mut edges = accepted;
    edges.extend(candidates);
    edges.extend(siblings);
    (nodes, edges)
}

pub(super) fn project(
    data: &AtlasProjectionData,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
    include_preview: bool,
) -> GraphData {
    let survivors = survivor_map(data);
    let all_entities = entities(data);
    let publications = live_entities(&all_entities, &survivors, EVIDENCE_PUBLICATION_KINDS);
    let outlet_ids = outlet_node_ids(&publications, data);
    let reporter_map = reporter_entity_map(data, &survivors);
    let (nodes, edges) = evidence_projection(
        data,
        &all_entities,
        &survivors,
        &reporter_map,
        &outlet_ids,
        ProjectionView {
            as_of,
            known_at,
            include_preview,
        },
    );
    GraphData { nodes, edges }
}
