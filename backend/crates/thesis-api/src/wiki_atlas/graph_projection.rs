use std::collections::HashMap;

use chrono::NaiveDateTime;
use thesis_db::AtlasProjectionData;

use super::super::{AtlasEdgeResponse, AtlasGraphFiltersInput};
use super::GraphData;

#[path = "graph_projection/evidence.rs"]
mod evidence;
#[path = "graph_projection/legacy.rs"]
mod legacy;
#[path = "graph_projection/shared.rs"]
mod shared;

fn edge_is_better(candidate: &AtlasEdgeResponse, current: &AtlasEdgeResponse) -> bool {
    candidate
        .accepted_fact
        .cmp(&current.accepted_fact)
        .then_with(|| {
            candidate
                .confidence
                .unwrap_or(0.0)
                .total_cmp(&current.confidence.unwrap_or(0.0))
        })
        .then_with(|| {
            candidate
                .evidence_root_count
                .cmp(&current.evidence_root_count)
        })
        .then_with(|| candidate.evidence_count.cmp(&current.evidence_count))
        .is_gt()
}

fn dedupe_edges(edges: Vec<AtlasEdgeResponse>) -> Vec<AtlasEdgeResponse> {
    let mut best = Vec::new();
    let mut index_by_key = HashMap::<(String, String, String), usize>::new();
    for edge in edges {
        let relation = edge
            .raw_relation_type
            .clone()
            .unwrap_or_else(|| super::relation_type_name(edge.relation_type).to_owned());
        let key = (edge.source_id.clone(), edge.target_id.clone(), relation);
        if let Some(index) = index_by_key.get(&key).copied() {
            if edge_is_better(&edge, &best[index]) {
                best[index] = edge;
            }
        } else {
            index_by_key.insert(key, best.len());
            best.push(edge);
        }
    }
    best
}

pub(super) fn project(
    data: &AtlasProjectionData,
    filters: &AtlasGraphFiltersInput,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
) -> GraphData {
    let mut graph = legacy::project(data, filters);
    let evidence = evidence::project(data, as_of, known_at, filters.include_evidence_preview);
    graph.nodes.extend(evidence.nodes);
    graph.edges.extend(evidence.edges);
    graph.edges = dedupe_edges(graph.edges);
    graph
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;

    fn empty_projection_data() -> AtlasProjectionData {
        AtlasProjectionData {
            source_metadata: Vec::new(),
            source_analysis_scores: Vec::new(),
            article_counts: Vec::new(),
            wiki_index_statuses: Vec::new(),
            reporters: Vec::new(),
            reporter_byline_counts: Vec::new(),
            entities: Vec::new(),
            entity_resolutions: Vec::new(),
            external_ids: Vec::new(),
            claims: Vec::new(),
            claim_evidence_links: Vec::new(),
            observations: Vec::new(),
            snapshots: Vec::new(),
            documents: Vec::new(),
            accepted_relationships: Vec::new(),
            relationship_claim_links: Vec::new(),
            source_lineage: Vec::new(),
            claim_evidence_root_counts: Vec::new(),
            relationship_evidence_root_counts: Vec::new(),
            calculation_traces: Vec::new(),
        }
    }

    #[test]
    fn fresh_database_projects_the_configured_outlet_catalog() {
        let now = NaiveDate::from_ymd_opt(2026, 1, 1)
            .expect("test date is valid")
            .and_hms_opt(0, 0, 0)
            .expect("test time is valid");
        let filters = AtlasGraphFiltersInput::default();
        let graph = project(&empty_projection_data(), &filters, now, now);
        let bbc = graph
            .nodes
            .iter()
            .find(|node| node.label == "BBC")
            .expect("configured BBC outlet is present");

        assert_eq!(bbc.id, "outlet:0fbe2a58568b");
        assert_eq!(bbc.country_code.as_deref(), Some("GB"));
        assert_eq!(bbc.funding_type.as_deref(), Some("Public"));
        assert_eq!(bbc.bias_rating.as_deref(), Some("Center"));
        assert_eq!(bbc.factual_reporting.as_deref(), Some("high"));
        assert!(graph.edges.is_empty());
    }
}
