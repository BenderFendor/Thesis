use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fmt::Write as _;

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, NaiveDateTime, Timelike, Utc};
#[cfg(test)]
use serde_json::json;
use thesis_db::{sha256_hex, AtlasProjectionData};

use crate::models::HttpValidationError;
use crate::{wiki, AppState};

use super::{
    AtlasCoverageMetricResponse, AtlasDirection, AtlasEdgeResponse, AtlasEntityType,
    AtlasFactStatus, AtlasGraphFiltersInput, AtlasGraphQueryParameters, AtlasGraphResponse,
    AtlasGraphStatsResponse, AtlasLifecycleState, AtlasNodeResponse, AtlasRelationType,
};

#[path = "connections.rs"]
mod connections;
#[path = "graph/ids.rs"]
mod ids;
#[path = "graph_projection.rs"]
mod projection;

pub(super) use self::connections::get_connections;

pub(super) use self::ids::{
    casefold, confidence_tier, edge_id, normalize_entity_label, stable_source_id,
};
#[cfg(test)]
use self::ids::{hex_prefix, sha1_digest};

#[derive(Clone, Debug, Default)]
pub(super) struct GraphData {
    pub(super) nodes: Vec<AtlasNodeResponse>,
    pub(super) edges: Vec<AtlasEdgeResponse>,
}

/// Build the complete graph projection and response from one snapshot of Atlas inputs.
pub(super) fn project(
    data: &AtlasProjectionData,
    filters: &AtlasGraphFiltersInput,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
) -> GraphData {
    projection::project(data, filters, as_of, known_at)
}

fn entity_type_name(value: AtlasEntityType) -> &'static str {
    match value {
        AtlasEntityType::Outlet => "outlet",
        AtlasEntityType::Organization => "organization",
        AtlasEntityType::Person => "person",
        AtlasEntityType::Reporter => "reporter",
    }
}

fn relation_type_name(value: AtlasRelationType) -> &'static str {
    match value {
        AtlasRelationType::Ownership => "ownership",
        AtlasRelationType::OwnedBy => "owned_by",
        AtlasRelationType::ParentOrg => "parent_org",
        AtlasRelationType::PartOf => "part_of",
        AtlasRelationType::Publishes => "publishes",
        AtlasRelationType::EmployedBy => "employed_by",
        AtlasRelationType::CurrentOutlet => "current_outlet",
        AtlasRelationType::Coauthor => "coauthor",
        AtlasRelationType::SharedOutlet => "shared_outlet",
        AtlasRelationType::FoundedBy => "founded_by",
        AtlasRelationType::SiblingViaOwner => "sibling_via_owner",
    }
}

fn fact_status_name(value: AtlasFactStatus) -> &'static str {
    match value {
        AtlasFactStatus::Candidate => "candidate",
        AtlasFactStatus::Accepted => "accepted",
        AtlasFactStatus::Disputed => "disputed",
        AtlasFactStatus::Rejected => "rejected",
        AtlasFactStatus::Superseded => "superseded",
    }
}

fn lifecycle_state_name(value: AtlasLifecycleState) -> &'static str {
    match value {
        AtlasLifecycleState::Current => "current",
        AtlasLifecycleState::Historical => "historical",
        AtlasLifecycleState::Proposed => "proposed",
        AtlasLifecycleState::Pending => "pending",
        AtlasLifecycleState::Disputed => "disputed",
        AtlasLifecycleState::Rejected => "rejected",
        AtlasLifecycleState::Superseded => "superseded",
    }
}

fn datetime_iso(value: NaiveDateTime) -> String {
    let base = value.format("%Y-%m-%dT%H:%M:%S").to_string();
    let microseconds = value.nanosecond() / 1_000;
    if microseconds == 0 {
        base
    } else {
        format!("{base}.{microseconds:06}")
    }
}

fn append_python_json_string(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{20}'..='\u{7e}' => output.push(character),
            '\u{00}'..='\u{1f}' | '\u{7f}'..='\u{ffff}' => {
                write!(output, "\\u{:04x}", character as u32).expect("String writes cannot fail");
            }
            _ => {
                let codepoint = character as u32 - 0x1_0000;
                let high = 0xd800 + (codepoint >> 10);
                let low = 0xdc00 + (codepoint & 0x3ff);
                write!(output, "\\u{high:04x}\\u{low:04x}").expect("String writes cannot fail");
            }
        }
    }
    output.push('"');
}

fn graph_version(nodes: &[AtlasNodeResponse], edges: &[AtlasEdgeResponse]) -> String {
    let mut node_versions = nodes
        .iter()
        .map(|node| {
            (
                node.id.clone(),
                node.updated_at.map(datetime_iso).unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    node_versions.sort();
    let mut edge_versions = edges
        .iter()
        .map(|edge| {
            (
                edge.id.clone(),
                fact_status_name(edge.fact_status).to_owned(),
                edge.last_verified_at.map(datetime_iso).unwrap_or_default(),
                edge.recorded_at.map(datetime_iso).unwrap_or_default(),
                edge.retracted_at.map(datetime_iso).unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    edge_versions.sort();

    let mut payload = String::from("{\"nodes\":[");
    for (index, (id, updated_at)) in node_versions.iter().enumerate() {
        if index > 0 {
            payload.push(',');
        }
        payload.push('[');
        append_python_json_string(&mut payload, id);
        payload.push(',');
        append_python_json_string(&mut payload, updated_at);
        payload.push(']');
    }
    payload.push_str("],\"edges\":[");
    for (index, (id, status, verified, recorded, retracted)) in edge_versions.iter().enumerate() {
        if index > 0 {
            payload.push(',');
        }
        payload.push('[');
        for (part_index, part) in [id, status, verified, recorded, retracted]
            .into_iter()
            .enumerate()
        {
            if part_index > 0 {
                payload.push(',');
            }
            append_python_json_string(&mut payload, part);
        }
        payload.push(']');
    }
    payload.push_str("]}");
    sha256_hex(payload.as_bytes())[..20].to_owned()
}

fn matches_filter_value(value: Option<&str>, expected: &[String]) -> bool {
    if expected.is_empty() {
        return true;
    }
    let actual = casefold(value.unwrap_or(""));
    expected.iter().any(|item| casefold(item) == actual)
}

fn node_matches(
    node: &AtlasNodeResponse,
    filters: &AtlasGraphFiltersInput,
    selected: bool,
) -> bool {
    if !filters.entity_types.is_empty()
        && !filters
            .entity_types
            .iter()
            .any(|entity_type| entity_type_name(*entity_type) == entity_type_name(node.entity_type))
    {
        return false;
    }
    if !matches_filter_value(node.country_code.as_deref(), &filters.country)
        || !matches_filter_value(node.funding_type.as_deref(), &filters.funding)
        || !matches_filter_value(node.bias_rating.as_deref(), &filters.bias)
    {
        return false;
    }
    let Some(query) = filters.q.as_deref().filter(|_| !selected) else {
        return true;
    };
    let query = casefold(query.trim());
    if query.is_empty() {
        return true;
    }
    let search = [
        Some(node.label.as_str()),
        node.subtitle.as_deref(),
        node.country_code.as_deref(),
        node.funding_type.as_deref(),
        node.bias_rating.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    casefold(&search).contains(&query)
}

fn edge_matches(edge: &AtlasEdgeResponse, filters: &AtlasGraphFiltersInput) -> bool {
    if !filters.relation_types.is_empty()
        && !filters.relation_types.iter().any(|relation_type| {
            relation_type_name(*relation_type) == relation_type_name(edge.relation_type)
        })
    {
        return false;
    }
    if filters.accepted_only && !edge.accepted_fact {
        return false;
    }
    match edge.confidence {
        Some(confidence) => confidence >= filters.min_confidence,
        None => filters.min_confidence <= 0.0,
    }
}

fn collect_neighborhood(
    selected: &str,
    neighbors: i64,
    edges: &[AtlasEdgeResponse],
) -> HashSet<String> {
    let mut adjacency = HashMap::<String, HashSet<String>>::new();
    for edge in edges {
        adjacency
            .entry(edge.source_id.clone())
            .or_default()
            .insert(edge.target_id.clone());
        adjacency
            .entry(edge.target_id.clone())
            .or_default()
            .insert(edge.source_id.clone());
    }
    let mut visible = HashSet::from([selected.to_owned()]);
    let mut queue = VecDeque::from([(selected.to_owned(), 0_i64)]);
    while let Some((node_id, depth)) = queue.pop_front() {
        if depth >= neighbors {
            continue;
        }
        if let Some(related_nodes) = adjacency.get(&node_id) {
            for related_id in related_nodes {
                if visible.insert(related_id.clone()) {
                    queue.push_back((related_id.clone(), depth + 1));
                }
            }
        }
    }
    visible
}

fn filter_graph(
    nodes: &[AtlasNodeResponse],
    edges: &[AtlasEdgeResponse],
    filters: &AtlasGraphFiltersInput,
) -> GraphData {
    let selected = filters
        .selected
        .as_deref()
        .is_some_and(|value| !value.is_empty());
    let nodes = nodes
        .iter()
        .filter(|node| node_matches(node, filters, selected))
        .cloned()
        .collect::<Vec<_>>();
    let node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut edges = edges
        .iter()
        .filter(|edge| {
            edge_matches(edge, filters)
                && node_ids.contains(edge.source_id.as_str())
                && node_ids.contains(edge.target_id.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();

    if selected
        && filters.neighbors > 0
        && node_ids.contains(filters.selected.as_deref().unwrap_or_default())
    {
        let visible = collect_neighborhood(
            filters.selected.as_deref().unwrap_or_default(),
            filters.neighbors.clamp(0, 2),
            &edges,
        );
        edges.retain(|edge| visible.contains(&edge.source_id) && visible.contains(&edge.target_id));
        return GraphData {
            nodes: nodes
                .into_iter()
                .filter(|node| visible.contains(&node.id))
                .collect(),
            edges,
        };
    }
    GraphData { nodes, edges }
}

fn entity_type_priority(entity_type: AtlasEntityType) -> u8 {
    match entity_type {
        AtlasEntityType::Organization => 0,
        AtlasEntityType::Outlet => 1,
        AtlasEntityType::Person => 2,
        AtlasEntityType::Reporter => 3,
    }
}

fn rank_nodes(
    mut nodes: Vec<AtlasNodeResponse>,
    edges: &[AtlasEdgeResponse],
    selected: Option<&str>,
) -> Vec<AtlasNodeResponse> {
    let node_labels = nodes
        .iter()
        .map(|node| (node.id.as_str(), node.label.as_str()))
        .collect::<HashMap<_, _>>();
    let mut degree = HashMap::<String, i64>::new();
    let mut ownership_degree = HashMap::<String, i64>::new();
    let mut evidence_counts = HashMap::<String, i64>::new();
    let mut verified_at = HashMap::<String, NaiveDateTime>::new();
    let mut current_parent = HashMap::<String, String>::new();
    let mut current_parent_id = HashMap::<String, String>::new();
    let mut current_parent_order = Vec::<String>::new();
    let mut pending_change = HashMap::<String, String>::new();

    for edge in edges {
        *degree.entry(edge.source_id.clone()).or_default() += 1;
        *degree.entry(edge.target_id.clone()).or_default() += 1;
        if matches!(
            edge.relation_type,
            AtlasRelationType::Ownership
                | AtlasRelationType::OwnedBy
                | AtlasRelationType::ParentOrg
        ) {
            *ownership_degree.entry(edge.source_id.clone()).or_default() += 1;
            *ownership_degree.entry(edge.target_id.clone()).or_default() += 1;
        }
        if matches!(
            edge.predicate.as_str(),
            "directly_owns" | "owns_equity_in" | "controls" | "brand_of" | "operated_by"
        ) {
            if let Some(owner_label) = node_labels.get(edge.source_id.as_str()) {
                if edge.accepted_fact
                    && matches!(edge.lifecycle_state, AtlasLifecycleState::Current)
                {
                    if !current_parent_id.contains_key(&edge.target_id) {
                        current_parent_order.push(edge.target_id.clone());
                    }
                    current_parent.insert(edge.target_id.clone(), (*owner_label).to_owned());
                    current_parent_id.insert(edge.target_id.clone(), edge.source_id.clone());
                } else if matches!(
                    edge.lifecycle_state,
                    AtlasLifecycleState::Proposed
                        | AtlasLifecycleState::Pending
                        | AtlasLifecycleState::Disputed
                ) {
                    pending_change.insert(
                        edge.target_id.clone(),
                        format!(
                            "{}: {owner_label}",
                            lifecycle_state_name(edge.lifecycle_state)
                        ),
                    );
                }
            }
        }
        for entity_id in [&edge.source_id, &edge.target_id] {
            *evidence_counts.entry(entity_id.clone()).or_default() += edge.evidence_count;
            if let Some(timestamp) = edge.last_verified_at {
                verified_at
                    .entry(entity_id.clone())
                    .and_modify(|current| *current = (*current).max(timestamp))
                    .or_insert(timestamp);
            }
        }
    }

    for edge in edges {
        if !matches!(
            edge.lifecycle_state,
            AtlasLifecycleState::Proposed
                | AtlasLifecycleState::Pending
                | AtlasLifecycleState::Disputed
        ) {
            continue;
        }
        for child_id in &current_parent_order {
            let Some(parent_id) = current_parent_id.get(child_id) else {
                continue;
            };
            if parent_id != &edge.source_id && parent_id != &edge.target_id {
                continue;
            }
            let other_id = if edge.source_id == *parent_id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if let Some(other_label) = node_labels.get(other_id.as_str()) {
                pending_change.insert(
                    child_id.clone(),
                    format!(
                        "{}: {other_label}",
                        lifecycle_state_name(edge.lifecycle_state)
                    ),
                );
            }
        }
    }

    for node in &mut nodes {
        let evidence_count = evidence_counts.get(&node.id).copied().unwrap_or_default();
        node.connection_count = degree.get(&node.id).copied().unwrap_or_default();
        node.ownership_connection_count =
            ownership_degree.get(&node.id).copied().unwrap_or_default();
        node.current_parent = current_parent.get(&node.id).cloned();
        node.pending_change = pending_change.get(&node.id).cloned();
        node.evidence_coverage = if evidence_count > 0 {
            format!("{evidence_count} cited observations")
        } else {
            "not researched".to_owned()
        };
        node.freshness = verified_at
            .get(&node.id)
            .copied()
            .map(datetime_iso)
            .unwrap_or_else(|| "unknown".to_owned());
        node.unresolved_gap = if matches!(node.entity_type, AtlasEntityType::Outlet)
            && !current_parent.contains_key(&node.id)
        {
            Some("chain incomplete".to_owned())
        } else {
            None
        };
    }

    nodes.sort_by_cached_key(|node| {
        (
            if selected.is_some_and(|selected_id| selected_id == node.id) {
                0_u8
            } else {
                1_u8
            },
            Reverse(node.connection_count),
            Reverse(node.article_count),
            entity_type_priority(node.entity_type),
            casefold(&node.label),
        )
    });
    nodes
}

fn edge_priority(left: &AtlasEdgeResponse, right: &AtlasEdgeResponse) -> std::cmp::Ordering {
    right
        .accepted_fact
        .cmp(&left.accepted_fact)
        .then_with(|| {
            right
                .confidence
                .unwrap_or(0.0)
                .total_cmp(&left.confidence.unwrap_or(0.0))
        })
        .then_with(|| right.evidence_root_count.cmp(&left.evidence_root_count))
        .then_with(|| right.evidence_count.cmp(&left.evidence_count))
        .then_with(|| left.id.cmp(&right.id))
}

fn truncate_graph(
    filtered: GraphData,
    filters: &AtlasGraphFiltersInput,
) -> (
    Vec<AtlasNodeResponse>,
    Vec<AtlasEdgeResponse>,
    bool,
    Vec<&'static str>,
) {
    let mut nodes = rank_nodes(filtered.nodes, &filtered.edges, filters.selected.as_deref());
    let mut truncated = false;
    let mut reasons = Vec::new();
    if let Some(limit) = filters.limit_nodes {
        let limit = usize::try_from(limit).unwrap_or_default();
        if nodes.len() > limit {
            nodes.truncate(limit);
            truncated = true;
            reasons.push("node_limit");
        }
    }
    let visible_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut edges = filtered
        .edges
        .into_iter()
        .filter(|edge| {
            visible_ids.contains(edge.source_id.as_str())
                && visible_ids.contains(edge.target_id.as_str())
        })
        .collect::<Vec<_>>();
    let edge_limit = usize::try_from(filters.limit_edges).unwrap_or_default();
    if edges.len() > edge_limit {
        edges.sort_by(edge_priority);
        edges.truncate(edge_limit);
        truncated = true;
        reasons.push("edge_limit");
    }
    (nodes, edges, truncated, reasons)
}

fn graph_stats(
    all_nodes: &[AtlasNodeResponse],
    all_edges: &[AtlasEdgeResponse],
    visible_edges: &[AtlasEdgeResponse],
    visible_nodes: &[AtlasNodeResponse],
    filters: &AtlasGraphFiltersInput,
) -> AtlasGraphStatsResponse {
    let mut total_types = HashMap::<&'static str, i64>::new();
    let mut visible_types = HashMap::<&'static str, i64>::new();
    let mut outlet_ids = HashSet::<&str>::new();
    for node in all_nodes {
        let entity_type = entity_type_name(node.entity_type);
        *total_types.entry(entity_type).or_default() += 1;
        if entity_type == "outlet" {
            outlet_ids.insert(node.id.as_str());
        }
    }
    for node in visible_nodes {
        *visible_types
            .entry(entity_type_name(node.entity_type))
            .or_default() += 1;
    }
    let outlets_with_owner = all_edges
        .iter()
        .filter(|edge| {
            outlet_ids.contains(edge.target_id.as_str())
                && edge.valid_to.is_none()
                && edge.retracted_at.is_none()
                && (edge.accepted_fact || !filters.accepted_only)
        })
        .map(|edge| edge.target_id.as_str())
        .collect::<HashSet<_>>();
    let mut current_relationships = 0_i64;
    let mut accepted_relationships = 0_i64;
    let mut candidate_relationships = 0_i64;
    let mut disputed_relationships = 0_i64;
    for edge in all_edges {
        if edge.valid_to.is_none() && edge.retracted_at.is_none() {
            current_relationships += 1;
        }
        if edge.accepted_fact {
            accepted_relationships += 1;
        }
        match edge.fact_status {
            AtlasFactStatus::Candidate => candidate_relationships += 1,
            AtlasFactStatus::Disputed => disputed_relationships += 1,
            AtlasFactStatus::Accepted | AtlasFactStatus::Rejected | AtlasFactStatus::Superseded => {
            }
        }
    }
    let total_outlets = total_types.get("outlet").copied().unwrap_or_default();
    let mut stats = AtlasGraphStatsResponse::default();
    stats.total_outlets = total_outlets;
    stats.total_organizations = total_types.get("organization").copied().unwrap_or_default();
    stats.total_people = total_types.get("person").copied().unwrap_or_default();
    stats.total_reporters = total_types.get("reporter").copied().unwrap_or_default();
    stats.visible_outlets = visible_types.get("outlet").copied().unwrap_or_default();
    stats.visible_organizations = visible_types
        .get("organization")
        .copied()
        .unwrap_or_default();
    stats.visible_people = visible_types.get("person").copied().unwrap_or_default();
    stats.visible_reporters = visible_types.get("reporter").copied().unwrap_or_default();
    stats.visible_relationships = i64::try_from(visible_edges.len()).unwrap_or(i64::MAX);
    stats.current_relationships = current_relationships;
    stats.accepted_relationships = accepted_relationships;
    stats.candidate_relationships = candidate_relationships;
    stats.disputed_relationships = disputed_relationships;
    stats.ownership_coverage = AtlasCoverageMetricResponse {
        numerator: i64::try_from(outlets_with_owner.len()).unwrap_or(i64::MAX),
        denominator: total_outlets,
    };
    stats.evidence_coverage = AtlasCoverageMetricResponse {
        numerator: i64::try_from(
            visible_edges
                .iter()
                .filter(|edge| edge.evidence_count > 0)
                .count(),
        )
        .unwrap_or(i64::MAX),
        denominator: i64::try_from(visible_edges.len()).unwrap_or(i64::MAX),
    };
    stats.unresolved_source_links =
        total_outlets.saturating_sub(i64::try_from(outlets_with_owner.len()).unwrap_or(i64::MAX));
    stats
}

pub(super) fn build_response(
    data: GraphData,
    filters: AtlasGraphFiltersInput,
    generated_at: DateTime<Utc>,
) -> AtlasGraphResponse {
    let filtered = filter_graph(&data.nodes, &data.edges, &filters);
    let (nodes, edges, truncated, reasons) = truncate_graph(filtered, &filters);
    let stats = graph_stats(&data.nodes, &data.edges, &edges, &nodes, &filters);
    AtlasGraphResponse {
        graph_version: graph_version(&data.nodes, &data.edges),
        generated_at,
        nodes,
        edges,
        stats,
        applied_filters: filters.clone(),
        truncated,
        truncation_reason: (!reasons.is_empty()).then(|| reasons.join(",")),
        next_expansion_token: if truncated {
            filters.selected.filter(|selected| !selected.is_empty())
        } else {
            None
        },
    }
}

fn normalized_filter_datetime(raw: &str) -> String {
    if let Ok(value) = DateTime::parse_from_rfc3339(raw) {
        return format!("{}{}", datetime_iso(value.naive_local()), value.offset());
    }
    super::parse_datetime(raw)
        .map(datetime_iso)
        .unwrap_or_else(|| raw.to_owned())
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/graph",
    operation_id = "get_atlas_graph_api_wiki_atlas_graph_get",
    params(AtlasGraphQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = AtlasGraphResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki-atlas",
    summary = "Get Atlas Graph",
    description = "Build the bounded Atlas graph from the legacy outlet/reporter projection and the evidence spine."
)]
pub(crate) async fn get_graph(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match wiki::query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let mut filters = match super::query_graph_filters(&values) {
        Ok(filters) => filters,
        Err(response) => return response,
    };
    let generated_at = Utc::now();
    filters.as_of = filters
        .as_of
        .map(|value| normalized_filter_datetime(&value));
    filters.known_at = filters
        .known_at
        .map(|value| normalized_filter_datetime(&value));
    let as_of = filters
        .as_of
        .as_deref()
        .and_then(super::parse_datetime)
        .unwrap_or_else(|| generated_at.naive_utc());
    let known_at = filters
        .known_at
        .as_deref()
        .and_then(super::parse_datetime)
        .unwrap_or_else(|| generated_at.naive_utc());
    let reporters_enabled = filters.entity_types.is_empty()
        || filters
            .entity_types
            .iter()
            .any(|entity_type| matches!(entity_type, AtlasEntityType::Reporter))
        || filters
            .selected
            .as_deref()
            .is_some_and(|selected| selected.starts_with("reporter:"));
    let reporter_limit = if reporters_enabled {
        filters.limit_nodes.map(|limit| limit.clamp(50, 600))
    } else {
        Some(0)
    };
    let projection = match state
        .database
        .load_atlas_projection_data(as_of, known_at, reporter_limit)
        .await
    {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let graph = project(&projection, &filters, as_of, known_at);
    Json(build_response(graph, filters, generated_at)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(
        id: &str,
        entity_type: AtlasEntityType,
        label: &str,
        article_count: i64,
    ) -> AtlasNodeResponse {
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
            article_count,
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

    fn edge(
        id: &str,
        source_id: &str,
        target_id: &str,
        relation_type: AtlasRelationType,
        confidence: Option<f64>,
        accepted_fact: bool,
        evidence_count: i64,
    ) -> AtlasEdgeResponse {
        AtlasEdgeResponse {
            id: id.to_owned(),
            source_id: source_id.to_owned(),
            target_id: target_id.to_owned(),
            relation_type,
            predicate: "directly_owns".to_owned(),
            display_group: "ownership_control".to_owned(),
            relation_type_deprecated: true,
            direction: AtlasDirection::Directed,
            weight: 1.0,
            ownership_percentage: None,
            voting_interest: None,
            economic_interest: None,
            beneficial_interest: None,
            confidence,
            confidence_tier: Some(confidence_tier(confidence)),
            evidence_count,
            evidence_preview: Vec::new(),
            valid_from: None,
            valid_to: None,
            last_verified_at: None,
            is_inferred: !accepted_fact,
            raw_relation_type: Some("directly_owns".to_owned()),
            fact_status: if accepted_fact {
                AtlasFactStatus::Accepted
            } else {
                AtlasFactStatus::Candidate
            },
            lifecycle_state: AtlasLifecycleState::Current,
            accepted_fact,
            qualifiers: json!({}),
            claim_ids: Vec::new(),
            recorded_at: None,
            retracted_at: None,
            acceptance_policy_version: None,
            evidence_root_count: 0,
        }
    }

    #[test]
    fn sha1_ids_match_the_python_digest_contract() {
        assert_eq!(
            hex_prefix(&sha1_digest(b""), 20),
            "da39a3ee5e6b4b0d3255bfef95601890afd80709"
        );
        assert_eq!(
            hex_prefix(&sha1_digest(b"abc"), 20),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(stable_source_id("BBC"), "outlet:0fbe2a58568b");
    }

    #[test]
    fn casefold_matches_python_full_unicode_semantics() {
        assert_eq!(casefold("Straße"), "strasse");
        assert_eq!(casefold("\u{0390}"), "\u{03b9}\u{0308}\u{0301}");
        assert_eq!(casefold("\u{13a0}\u{ab70}"), "\u{13a0}\u{13a0}");
    }

    #[test]
    fn filters_neighborhood_rank_and_stats_use_the_production_path() {
        let mut filters = AtlasGraphFiltersInput::default();
        filters.q = Some("not present".to_owned());
        filters.selected = Some("outlet:beta".to_owned());
        filters.neighbors = 0;
        filters.limit_nodes = Some(2);
        filters.limit_edges = 1;
        filters.accepted_only = true;
        let data = GraphData {
            nodes: vec![
                node("outlet:alpha", AtlasEntityType::Outlet, "Alpha", 50),
                node("outlet:beta", AtlasEntityType::Outlet, "Beta", 10),
                node(
                    "organization:owner",
                    AtlasEntityType::Organization,
                    "Owner",
                    0,
                ),
            ],
            edges: vec![
                edge(
                    "accepted-owner",
                    "organization:owner",
                    "outlet:beta",
                    AtlasRelationType::Ownership,
                    Some(0.95),
                    true,
                    2,
                ),
                edge(
                    "candidate-owner",
                    "organization:owner",
                    "outlet:alpha",
                    AtlasRelationType::Ownership,
                    Some(0.99),
                    false,
                    9,
                ),
            ],
        };

        let response = build_response(data, filters, Utc::now());
        assert_eq!(
            response.nodes.first().map(|node| node.id.as_str()),
            Some("outlet:beta")
        );
        assert_eq!(response.nodes.len(), 2);
        assert_eq!(response.edges.len(), 1);
        assert_eq!(response.edges[0].id, "accepted-owner");
        assert_eq!(response.stats.total_outlets, 2);
        assert_eq!(response.stats.visible_relationships, 1);
        assert_eq!(response.stats.ownership_coverage.numerator, 1);
        assert_eq!(response.stats.ownership_coverage.denominator, 2);
        assert!(response.truncated);
        assert_eq!(response.truncation_reason.as_deref(), Some("node_limit"));
        assert_eq!(
            response.next_expansion_token.as_deref(),
            Some("outlet:beta")
        );
    }
}
