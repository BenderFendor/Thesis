use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;
use serde_json::{json, Value};
use thesis_db::AtlasProjectionData;

use super::super::super::{
    AtlasDirection, AtlasEdgeResponse, AtlasFactStatus, AtlasLifecycleState, AtlasRelationType,
};
use super::super::stable_source_id;

pub(super) const LEGACY_PUBLICATION_KINDS: &[&str] = &["publication", "digital_property", "feed"];
pub(super) const EVIDENCE_PUBLICATION_KINDS: &[&str] = &[
    "publication",
    "publication_brand",
    "digital_property",
    "feed",
    "broadcast_station",
];
pub(super) const LEGACY_ORGANIZATION_KINDS: &[&str] =
    &["legal_entity", "organization_without_legal_identity"];
pub(super) const EVIDENCE_ORGANIZATION_KINDS: &[&str] = &[
    "legal_entity",
    "organization_without_legal_identity",
    "public_company",
    "nonprofit",
    "family_control_group",
    "trust",
    "government_award",
    "seller_account",
];
pub(super) const OWNERSHIP_PREDICATES: &[&str] = &[
    "directly_owns",
    "owns_equity_in",
    "controls",
    "brand_of",
    "operated_by",
    "successor_of",
    "founded_by",
    "employed_by",
    "authored_by",
    "publishes",
    "distributed_by",
    "syndicated_by",
    "authorizes_inventory_seller",
    "sponsors_content",
    "political_ad_purchase",
    "advertising_inventory_sold_by",
    "funds",
];
pub(super) const BYLINE_PREDICATES: &[&str] = &["authored_by", "employed_by"];
pub(super) const INTEREST_PREDICATES: &[&str] = &["directly_owns", "owns_equity_in"];

#[derive(Clone, Copy)]
pub(super) struct Entity<'a> {
    pub(super) id: &'a str,
    pub(super) record_kind: &'a str,
    pub(super) entity_kind: &'a str,
    pub(super) canonical_name: &'a str,
    pub(super) status: &'a str,
    pub(super) updated_at: NaiveDateTime,
}

pub(super) fn entities(data: &AtlasProjectionData) -> Vec<Entity<'_>> {
    data.entities
        .iter()
        .map(|row| Entity {
            id: &row.id,
            record_kind: &row.record_kind,
            entity_kind: &row.entity_kind,
            canonical_name: &row.canonical_name,
            status: &row.status,
            updated_at: row.updated_at,
        })
        .collect()
}

pub(super) fn survivor_map(data: &AtlasProjectionData) -> HashMap<String, String> {
    let mut direct = HashMap::<String, String>::new();
    for resolution in &data.entity_resolutions {
        if resolution.decision == "same_as" && resolution.status == "accepted" {
            direct.insert(
                resolution.left_entity_id.clone(),
                resolution.right_entity_id.clone(),
            );
        }
    }
    let mut survivors = HashMap::new();
    for entity_id in direct.keys() {
        let mut current = entity_id.as_str();
        let mut seen = HashSet::new();
        while let Some(next) = direct.get(current) {
            if !seen.insert(current) {
                break;
            }
            current = next;
        }
        survivors.insert(entity_id.clone(), current.to_owned());
    }
    survivors
}

pub(super) fn live_entities<'a>(
    entities: &[Entity<'a>],
    survivors: &HashMap<String, String>,
    record_kinds: &[&str],
) -> Vec<Entity<'a>> {
    entities
        .iter()
        .copied()
        .filter(|entity| {
            record_kinds.contains(&entity.record_kind)
                && entity.status != "merged"
                && !survivors.contains_key(entity.id)
        })
        .collect()
}

pub(super) fn canonical_entity_id<'a>(
    entity_id: &'a str,
    survivors: &'a HashMap<String, String>,
) -> &'a str {
    survivors
        .get(entity_id)
        .map(String::as_str)
        .unwrap_or(entity_id)
}

pub(super) fn external_id_map(data: &AtlasProjectionData, scheme: &str) -> HashMap<String, String> {
    let mut external_ids = HashMap::new();
    for external_id in &data.external_ids {
        if external_id.scheme == scheme {
            external_ids.insert(external_id.entity_id.clone(), external_id.value.clone());
        }
    }
    external_ids
}

pub(super) fn outlet_node_ids(
    publications: &[Entity<'_>],
    data: &AtlasProjectionData,
) -> HashMap<String, String> {
    let external_ids = external_id_map(data, "rss_catalog_key");
    publications
        .iter()
        .map(|entity| {
            let node_id = external_ids
                .get(entity.id)
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| stable_source_id(entity.canonical_name));
            (entity.id.to_owned(), node_id)
        })
        .collect()
}

pub(super) fn reporter_entity_map(
    data: &AtlasProjectionData,
    survivors: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut reporters = HashMap::new();
    for external_id in &data.external_ids {
        if external_id.scheme == "scoop_reporter_id" {
            reporters.insert(
                canonical_entity_id(&external_id.entity_id, survivors).to_owned(),
                format!("reporter:{}", external_id.value),
            );
        }
    }
    reporters
}

pub(super) fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

pub(super) fn edge_base(
    id: String,
    source_id: String,
    target_id: String,
    relation_type: AtlasRelationType,
    predicate: Option<&str>,
    display_group: Option<&str>,
    raw_relation_type: Option<&str>,
) -> AtlasEdgeResponse {
    let raw_relation_type = raw_relation_type.map(str::to_owned);
    AtlasEdgeResponse {
        id,
        source_id,
        target_id,
        relation_type,
        predicate: predicate
            .map(str::to_owned)
            .or_else(|| raw_relation_type.clone())
            .unwrap_or_default(),
        display_group: display_group.unwrap_or("other").to_owned(),
        relation_type_deprecated: true,
        direction: AtlasDirection::Directed,
        weight: 1.0,
        ownership_percentage: None,
        voting_interest: None,
        economic_interest: None,
        beneficial_interest: None,
        confidence: None,
        confidence_tier: None,
        evidence_count: 0,
        evidence_preview: Vec::new(),
        valid_from: None,
        valid_to: None,
        last_verified_at: None,
        is_inferred: false,
        raw_relation_type,
        fact_status: AtlasFactStatus::Candidate,
        lifecycle_state: AtlasLifecycleState::Current,
        accepted_fact: false,
        qualifiers: json!({}),
        claim_ids: Vec::new(),
        recorded_at: None,
        retracted_at: None,
        acceptance_policy_version: None,
        evidence_root_count: 0,
    }
}
