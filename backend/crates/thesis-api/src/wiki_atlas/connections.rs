use std::cmp::{Ordering, Reverse};
use std::collections::{HashMap, HashSet};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde_json::json;

use super::super::{
    AtlasConnectionResponse, AtlasEntityType, AtlasGraphFiltersInput, AtlasGraphResponse,
    AtlasLifecycleState,
};
use super::{build_response, casefold, project, GraphData};
use crate::AppState;

#[derive(Clone, Copy, Debug)]
struct ConfidenceOrder(f64);

impl PartialEq for ConfidenceOrder {
    fn eq(&self, other: &Self) -> bool {
        self.0.total_cmp(&other.0).is_eq()
    }
}

impl Eq for ConfidenceOrder {}

impl PartialOrd for ConfidenceOrder {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ConfidenceOrder {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

fn normalize_entity_id_alias(entity_id: String) -> String {
    if let Some(digest) = entity_id.strip_prefix("source:") {
        format!("outlet:{digest}")
    } else {
        entity_id
    }
}

fn connection_filters(entity_id: &str) -> AtlasGraphFiltersInput {
    let mut filters = AtlasGraphFiltersInput::default();
    filters.entity_types = vec![
        AtlasEntityType::Outlet,
        AtlasEntityType::Organization,
        AtlasEntityType::Person,
        AtlasEntityType::Reporter,
    ];
    filters.selected = Some(entity_id.to_owned());
    filters.neighbors = 2;
    filters.limit_nodes = Some(350);
    filters.limit_edges = 1500;
    filters.include_evidence_preview = true;
    filters
}

fn collect_connections(graph: AtlasGraphResponse, entity_id: &str) -> Vec<AtlasConnectionResponse> {
    let AtlasGraphResponse { nodes, edges, .. } = graph;
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let owner_ids = edges
        .iter()
        .filter(|edge| {
            edge.target_id == entity_id
                && edge.accepted_fact
                && matches!(edge.lifecycle_state, AtlasLifecycleState::Current)
                && matches!(
                    edge.predicate.as_str(),
                    "directly_owns" | "owns_equity_in" | "controls" | "brand_of" | "operated_by"
                )
                && node_by_id.contains_key(edge.source_id.as_str())
        })
        .map(|edge| edge.source_id.clone())
        .collect::<HashSet<_>>();

    let mut direct_edge_ids = HashSet::<String>::new();
    let mut pending_edge_ids = HashSet::<String>::new();
    let mut direct_connections = Vec::new();
    let mut pending_connections = Vec::new();
    for edge in edges {
        let direct_related_id = if edge.source_id == entity_id {
            Some(edge.target_id.as_str())
        } else if edge.target_id == entity_id {
            Some(edge.source_id.as_str())
        } else {
            None
        };
        if let Some(related_id) = direct_related_id {
            if direct_edge_ids.contains(edge.id.as_str()) {
                continue;
            }
            let Some(entity) = node_by_id.get(related_id).copied() else {
                continue;
            };
            direct_edge_ids.insert(edge.id.clone());
            direct_connections.push(AtlasConnectionResponse {
                edge,
                entity: entity.clone(),
            });
            continue;
        }

        if !matches!(
            edge.lifecycle_state,
            AtlasLifecycleState::Proposed
                | AtlasLifecycleState::Pending
                | AtlasLifecycleState::Disputed
        ) {
            continue;
        }
        let source_is_owner = owner_ids.contains(edge.source_id.as_str());
        let target_is_owner = owner_ids.contains(edge.target_id.as_str());
        if (!source_is_owner && !target_is_owner)
            || direct_edge_ids.contains(edge.id.as_str())
            || pending_edge_ids.contains(edge.id.as_str())
        {
            continue;
        }
        let related_id = if source_is_owner {
            edge.target_id.as_str()
        } else {
            edge.source_id.as_str()
        };
        let Some(entity) = node_by_id.get(related_id).copied() else {
            continue;
        };
        pending_edge_ids.insert(edge.id.clone());
        pending_connections.push(AtlasConnectionResponse {
            edge,
            entity: entity.clone(),
        });
    }

    pending_connections.retain(|connection| !direct_edge_ids.contains(connection.edge.id.as_str()));
    direct_connections.extend(pending_connections);
    direct_connections.sort_by_cached_key(|connection| {
        (
            Reverse(ConfidenceOrder(connection.edge.confidence.unwrap_or(0.0))),
            Reverse(connection.edge.evidence_count),
            casefold(&connection.entity.label),
        )
    });
    direct_connections
}

fn entity_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"detail": "Atlas entity not found"})),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/entities/{entity_id}/connections",
    operation_id = "get_atlas_entity_connections_api_wiki_atlas_entities__entity_id__connections_get",
    params(("entity_id" = String, Path, description = "Atlas entity ID")),
    responses(
        (status = 200, description = "Successful Response", body = [AtlasConnectionResponse]),
        (status = 404, description = "Atlas entity not found"),
        (status = 500, description = "Database error")
    ),
    tag = "wiki-atlas",
    summary = "Get Atlas Entity Connections",
    description = "Return the neighboring entities and edges connected to one Atlas entity."
)]
pub(crate) async fn get_connections(
    State(state): State<AppState>,
    Path(raw_entity_id): Path<String>,
) -> Response {
    let entity_id = normalize_entity_id_alias(raw_entity_id);
    let generated_at = Utc::now();
    let as_of = generated_at.naive_utc();
    let known_at = generated_at.naive_utc();
    let filters = connection_filters(&entity_id);
    let reporter_limit = filters.limit_nodes.map(|limit| limit.clamp(50, 600));
    let projection = match state
        .database
        .load_atlas_projection_data(as_of, known_at, reporter_limit)
        .await
    {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let data = project(&projection, &filters, as_of, known_at);
    let graph = build_response(data, filters, generated_at);

    // A projected catalog outlet is a known entity even without an evidence row.
    if !graph.nodes.iter().any(|node| node.id == entity_id) {
        return entity_not_found();
    }
    Json(collect_connections(graph, &entity_id)).into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;
    use crate::wiki_atlas::{
        AtlasDirection, AtlasEdgeResponse, AtlasFactStatus, AtlasNodeResponse, AtlasRelationType,
    };

    fn node(id: &str, label: &str, entity_type: AtlasEntityType) -> AtlasNodeResponse {
        AtlasNodeResponse {
            id: id.to_owned(),
            entity_type,
            label: label.to_owned(),
            subtitle: None,
            country_code: None,
            funding_type: None,
            bias_rating: None,
            factual_reporting: None,
            credibility_score: None,
            analysis_scores: BTreeMap::new(),
            article_count: 0,
            connection_count: 0,
            ownership_connection_count: 0,
            status: None,
            confidence_tier: None,
            profile_path: None,
            updated_at: None,
            flags: Vec::new(),
            current_parent: None,
            pending_change: None,
            evidence_coverage: "not researched".to_owned(),
            freshness: "unknown".to_owned(),
            unresolved_gap: None,
        }
    }

    #[derive(Clone, Copy)]
    struct EdgeAttributes {
        confidence: Option<f64>,
        evidence_count: i64,
        lifecycle_state: AtlasLifecycleState,
        accepted_fact: bool,
    }

    fn edge_attributes(
        confidence: Option<f64>,
        evidence_count: i64,
        lifecycle_state: AtlasLifecycleState,
        accepted_fact: bool,
    ) -> EdgeAttributes {
        EdgeAttributes {
            confidence,
            evidence_count,
            lifecycle_state,
            accepted_fact,
        }
    }

    fn edge(
        id: &str,
        source_id: &str,
        target_id: &str,
        predicate: &str,
        attributes: EdgeAttributes,
    ) -> AtlasEdgeResponse {
        let EdgeAttributes {
            confidence,
            evidence_count,
            lifecycle_state,
            accepted_fact,
        } = attributes;
        AtlasEdgeResponse {
            id: id.to_owned(),
            source_id: source_id.to_owned(),
            target_id: target_id.to_owned(),
            relation_type: AtlasRelationType::Ownership,
            predicate: predicate.to_owned(),
            display_group: "ownership".to_owned(),
            relation_type_deprecated: false,
            direction: AtlasDirection::Directed,
            weight: 1.0,
            ownership_percentage: None,
            voting_interest: None,
            economic_interest: None,
            beneficial_interest: None,
            confidence,
            confidence_tier: None,
            evidence_count,
            evidence_preview: Vec::new(),
            valid_from: None,
            valid_to: None,
            last_verified_at: None,
            is_inferred: false,
            raw_relation_type: Some(predicate.to_owned()),
            fact_status: if accepted_fact {
                AtlasFactStatus::Accepted
            } else {
                AtlasFactStatus::Candidate
            },
            lifecycle_state,
            accepted_fact,
            qualifiers: json!({}),
            claim_ids: Vec::new(),
            recorded_at: None,
            retracted_at: None,
            acceptance_policy_version: None,
            evidence_root_count: 0,
        }
    }

    fn selected_response(
        entity_id: &str,
        nodes: Vec<AtlasNodeResponse>,
        edges: Vec<AtlasEdgeResponse>,
    ) -> AtlasGraphResponse {
        let filters = connection_filters(entity_id);
        build_response(GraphData { nodes, edges }, filters, Utc::now())
    }

    #[test]
    fn includes_direct_and_current_owner_pending_edges_only() {
        let selected = "outlet:selected";
        let nodes = vec![
            node(selected, "Selected", AtlasEntityType::Outlet),
            node("organization:owner", "Owner", AtlasEntityType::Organization),
            node("person:pending-a", "Pending A", AtlasEntityType::Person),
            node("person:pending-b", "Pending B", AtlasEntityType::Person),
            node("person:pending-c", "Pending C", AtlasEntityType::Person),
            node("person:direct", "Direct", AtlasEntityType::Person),
            node(
                "organization:reverse",
                "Reverse",
                AtlasEntityType::Organization,
            ),
            node(
                "person:reverse-pending",
                "Reverse Pending",
                AtlasEntityType::Person,
            ),
            node(
                "organization:bad-predicate",
                "Bad Predicate",
                AtlasEntityType::Organization,
            ),
            node(
                "person:bad-predicate-pending",
                "Bad Predicate Pending",
                AtlasEntityType::Person,
            ),
            node(
                "organization:historical",
                "Historical",
                AtlasEntityType::Organization,
            ),
            node(
                "person:historical-pending",
                "Historical Pending",
                AtlasEntityType::Person,
            ),
            node(
                "organization:candidate",
                "Candidate",
                AtlasEntityType::Organization,
            ),
            node(
                "person:candidate-pending",
                "Candidate Pending",
                AtlasEntityType::Person,
            ),
            node("person:unrelated", "Unrelated", AtlasEntityType::Person),
        ];
        let direct = edge(
            "direct-neighbor",
            selected,
            "person:direct",
            "authored_by",
            edge_attributes(Some(0.6), 1, AtlasLifecycleState::Current, false),
        );
        let edges = vec![
            edge(
                "owner-current",
                "organization:owner",
                selected,
                "controls",
                edge_attributes(Some(0.9), 2, AtlasLifecycleState::Current, true),
            ),
            direct.clone(),
            direct,
            edge(
                "owner-proposed",
                "organization:owner",
                "person:pending-a",
                "controls",
                edge_attributes(Some(0.7), 3, AtlasLifecycleState::Proposed, false),
            ),
            edge(
                "owner-pending",
                "person:pending-b",
                "organization:owner",
                "controls",
                edge_attributes(Some(0.65), 4, AtlasLifecycleState::Pending, false),
            ),
            edge(
                "owner-disputed",
                "organization:owner",
                "person:pending-c",
                "controls",
                edge_attributes(Some(0.5), 5, AtlasLifecycleState::Disputed, false),
            ),
            edge(
                "owner-current-lifecycle",
                "organization:owner",
                "person:pending-a",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Current, false),
            ),
            edge(
                "reverse-owner-direct",
                selected,
                "organization:reverse",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Current, true),
            ),
            edge(
                "reverse-owner-pending",
                "organization:reverse",
                "person:reverse-pending",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Proposed, false),
            ),
            edge(
                "bad-predicate-direct",
                "organization:bad-predicate",
                selected,
                "authored_by",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Current, true),
            ),
            edge(
                "bad-predicate-pending",
                "organization:bad-predicate",
                "person:bad-predicate-pending",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Proposed, false),
            ),
            edge(
                "historical-owner-direct",
                "organization:historical",
                selected,
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Historical, true),
            ),
            edge(
                "historical-owner-pending",
                "organization:historical",
                "person:historical-pending",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Disputed, false),
            ),
            edge(
                "candidate-owner-direct",
                "organization:candidate",
                selected,
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Current, false),
            ),
            edge(
                "candidate-owner-pending",
                "organization:candidate",
                "person:candidate-pending",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Pending, false),
            ),
            edge(
                "unrelated-pending",
                "person:unrelated",
                "person:pending-a",
                "controls",
                edge_attributes(Some(0.8), 1, AtlasLifecycleState::Proposed, false),
            ),
            edge(
                "missing-related-node",
                selected,
                "person:absent",
                "authored_by",
                edge_attributes(Some(0.4), 1, AtlasLifecycleState::Current, false),
            ),
        ];
        let response = selected_response(selected, nodes, edges);
        let connections = collect_connections(response, selected);
        let ids = connections
            .iter()
            .map(|connection| connection.edge.id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(
            ids,
            HashSet::from([
                "owner-current",
                "direct-neighbor",
                "owner-proposed",
                "owner-pending",
                "owner-disputed",
                "reverse-owner-direct",
                "bad-predicate-direct",
                "historical-owner-direct",
                "candidate-owner-direct",
            ])
        );
        assert_eq!(
            ids.len(),
            connections.len(),
            "direct edges are deduplicated"
        );
    }

    #[test]
    fn sorts_by_confidence_then_evidence_then_casefolded_label() {
        let selected = "outlet:selected";
        let nodes = vec![
            node(selected, "Selected", AtlasEntityType::Outlet),
            node("organization:zulu", "Zulu", AtlasEntityType::Organization),
            node("organization:alpha", "Alpha", AtlasEntityType::Organization),
            node("organization:beta", "beta", AtlasEntityType::Organization),
            node(
                "organization:strasse",
                "Straße",
                AtlasEntityType::Organization,
            ),
            node("organization:sugar", "sugar", AtlasEntityType::Organization),
        ];
        let edges = vec![
            edge(
                "zulu",
                selected,
                "organization:zulu",
                "authored_by",
                edge_attributes(Some(0.8), 2, AtlasLifecycleState::Current, false),
            ),
            edge(
                "alpha",
                selected,
                "organization:alpha",
                "authored_by",
                edge_attributes(Some(0.8), 3, AtlasLifecycleState::Current, false),
            ),
            edge(
                "beta",
                selected,
                "organization:beta",
                "authored_by",
                edge_attributes(Some(0.8), 3, AtlasLifecycleState::Current, false),
            ),
            edge(
                "strasse",
                selected,
                "organization:strasse",
                "authored_by",
                edge_attributes(Some(0.7), 9, AtlasLifecycleState::Current, false),
            ),
            edge(
                "sugar",
                selected,
                "organization:sugar",
                "authored_by",
                edge_attributes(Some(0.7), 9, AtlasLifecycleState::Current, false),
            ),
        ];
        let response = selected_response(selected, nodes, edges);
        let labels = collect_connections(response, selected)
            .into_iter()
            .map(|connection| connection.entity.label)
            .collect::<Vec<_>>();

        assert_eq!(labels, ["Alpha", "beta", "Zulu", "Straße", "sugar"]);
    }

    #[test]
    fn source_alias_resolves_to_the_outlet_id() {
        assert_eq!(
            normalize_entity_id_alias("source:abcd".to_owned()),
            "outlet:abcd"
        );
        assert_eq!(
            normalize_entity_id_alias("organization:abcd".to_owned()),
            "organization:abcd"
        );
    }
}
