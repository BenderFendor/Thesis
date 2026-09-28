use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use utoipa::IntoParams;

use crate::models::HttpValidationError;
use crate::{wiki, AppState};

use super::graph::{build_response, casefold, normalize_entity_label, project};
use super::{
    AtlasEntityType, AtlasGraphFiltersInput, AtlasNodeResponse, AtlasSearchItemResponse,
    AtlasSearchResponse,
};

struct RankedNode {
    rank: u8,
    folded_label: String,
    node: AtlasNodeResponse,
}

fn match_rank(node: &AtlasNodeResponse, query: &str) -> Option<u8> {
    let label = normalize_entity_label(&node.label);
    if label == query {
        return Some(0);
    }
    if label.starts_with(query) {
        return Some(1);
    }
    if label.contains(query) {
        return Some(2);
    }

    let mut metadata = String::new();
    for value in [
        node.subtitle.as_deref(),
        node.country_code.as_deref(),
        node.funding_type.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|value| !value.is_empty())
    {
        if !metadata.is_empty() {
            metadata.push(' ');
        }
        metadata.push_str(value);
    }
    normalize_entity_label(&metadata)
        .contains(query)
        .then_some(3)
}

fn search_item(node: AtlasNodeResponse) -> AtlasSearchItemResponse {
    AtlasSearchItemResponse {
        id: node.id,
        entity_type: node.entity_type,
        label: node.label,
        subtitle: node.subtitle,
        country_code: node.country_code,
        confidence_tier: node.confidence_tier,
        profile_path: node.profile_path,
        current_parent: None,
        pending_change: None,
        evidence_coverage: "not researched".to_owned(),
        freshness: "unknown".to_owned(),
        unresolved_gap: None,
    }
}

fn search_nodes(nodes: Vec<AtlasNodeResponse>, query: &str, limit: i64) -> AtlasSearchResponse {
    let normalized_query = normalize_entity_label(query);
    let mut ranked = nodes
        .into_iter()
        .filter_map(|node| {
            let rank = match_rank(&node, &normalized_query)?;
            Some(RankedNode {
                rank,
                folded_label: casefold(&node.label),
                node,
            })
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| right.node.connection_count.cmp(&left.node.connection_count))
            .then_with(|| left.folded_label.cmp(&right.folded_label))
    });

    let limit = usize::try_from(limit).expect("query_search validates the Atlas search limit");
    let mut response = AtlasSearchResponse {
        query: query.to_owned(),
        outlets: Vec::new(),
        organizations: Vec::new(),
        people: Vec::new(),
        reporters: Vec::new(),
    };
    for candidate in ranked {
        let bucket = match candidate.node.entity_type {
            AtlasEntityType::Outlet => &mut response.outlets,
            AtlasEntityType::Organization => &mut response.organizations,
            AtlasEntityType::Person => &mut response.people,
            AtlasEntityType::Reporter => &mut response.reporters,
        };
        if bucket.len() < limit {
            bucket.push(search_item(candidate.node));
        }
    }
    response
}

/// OpenAPI query parameters for Atlas entity search.
#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
struct AtlasSearchParameters {
    /// Entity search query
    #[param(min_length = 1, max_length = 200)]
    q: String,
    /// Maximum number of results per entity type
    #[param(required = false, default = 8, minimum = 1, maximum = 20)]
    limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/search",
    operation_id = "search_atlas_entities_api_wiki_atlas_search_get",
    params(AtlasSearchParameters),
    responses(
        (status = 200, description = "Successful Response", body = AtlasSearchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki-atlas",
    summary = "Search Atlas Entities",
    description = "Search Atlas entities by label and metadata, grouped by entity type."
)]
pub(crate) async fn get_atlas_search(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match wiki::query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let (query, limit) = match super::query_search(&values) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };

    let generated_at = Utc::now();
    let as_of = generated_at.naive_utc();
    let known_at = as_of;
    let filters = AtlasGraphFiltersInput {
        entity_types: vec![
            AtlasEntityType::Outlet,
            AtlasEntityType::Organization,
            AtlasEntityType::Person,
            AtlasEntityType::Reporter,
        ],
        limit_nodes: None,
        limit_edges: 2500,
        include_evidence_preview: false,
        ..AtlasGraphFiltersInput::default()
    };

    let projection = match state
        .database
        .load_atlas_projection_data(as_of, known_at, None)
        .await
    {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let graph = build_response(
        project(&projection, &filters, as_of, known_at),
        filters,
        generated_at,
    );
    Json(search_nodes(graph.nodes, &query, limit)).into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashMap};

    use super::*;

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

    fn ids(items: &[AtlasSearchItemResponse]) -> Vec<&str> {
        items.iter().map(|item| item.id.as_str()).collect()
    }

    #[test]
    fn label_match_precedence_then_connection_count_controls_order() {
        let mut exact = node("exact", "ACME", AtlasEntityType::Outlet);
        exact.connection_count = 0;
        let mut prefix_low = node("prefix-low", "Acme Weekly", AtlasEntityType::Outlet);
        prefix_low.connection_count = 2;
        let mut prefix_high = node("prefix-high", "Acme News", AtlasEntityType::Outlet);
        prefix_high.connection_count = 20;
        let mut substring = node("substring", "The Acme Journal", AtlasEntityType::Outlet);
        substring.connection_count = 100;
        let mut metadata = node("metadata", "Global Journal", AtlasEntityType::Outlet);
        metadata.subtitle = Some("Acme coverage".to_owned());
        metadata.connection_count = 200;

        let response = search_nodes(
            vec![metadata, substring, prefix_low, exact, prefix_high],
            "Acme",
            8,
        );
        assert_eq!(
            ids(&response.outlets),
            vec![
                "exact",
                "prefix-high",
                "prefix-low",
                "substring",
                "metadata"
            ]
        );
    }

    #[test]
    fn metadata_substring_matches_subtitle_country_and_funding_fields() {
        let mut subtitle = node("subtitle", "Morning Journal", AtlasEntityType::Outlet);
        subtitle.subtitle = Some("Regional Acme desk".to_owned());
        let mut country = node("country", "Evening Journal", AtlasEntityType::Outlet);
        country.country_code = Some("ACME".to_owned());
        let mut funding = node("funding", "Weekly Journal", AtlasEntityType::Outlet);
        funding.funding_type = Some("Acme Foundation".to_owned());

        let response = search_nodes(vec![subtitle, country, funding], "acme", 8);
        let mut found = ids(&response.outlets);
        found.sort_unstable();
        assert_eq!(found, vec!["country", "funding", "subtitle"]);
    }

    #[test]
    fn equal_rank_and_connection_count_use_python_casefolded_label_order() {
        let mut ascii = node("ascii", "AZ", AtlasEntityType::Outlet);
        ascii.connection_count = 3;
        let mut sharp_s = node("sharp-s", "aß", AtlasEntityType::Outlet);
        sharp_s.connection_count = 3;

        let response = search_nodes(vec![ascii, sharp_s], "a", 8);
        assert_eq!(ids(&response.outlets), vec!["sharp-s", "ascii"]);
    }

    #[test]
    fn limit_applies_independently_to_each_entity_type_group() {
        let mut outlet_low = node("outlet-low", "North Outlet A", AtlasEntityType::Outlet);
        outlet_low.connection_count = 1;
        let mut outlet_high = node("outlet-high", "North Outlet B", AtlasEntityType::Outlet);
        outlet_high.connection_count = 9;
        let organization = node("organization", "North Group", AtlasEntityType::Organization);
        let person = node("person", "North Reporter", AtlasEntityType::Person);
        let reporter = node("reporter", "North Writer", AtlasEntityType::Reporter);

        let response = search_nodes(
            vec![outlet_low, organization, person, reporter, outlet_high],
            "north",
            1,
        );
        assert_eq!(ids(&response.outlets), vec!["outlet-high"]);
        assert_eq!(ids(&response.organizations), vec!["organization"]);
        assert_eq!(ids(&response.people), vec!["person"]);
        assert_eq!(ids(&response.reporters), vec!["reporter"]);
    }

    #[test]
    fn response_echoes_query_projects_contract_fields_and_keeps_pydantic_defaults() {
        let mut source = node("outlet:1", "Acme News", AtlasEntityType::Outlet);
        source.subtitle = Some("Daily".to_owned());
        source.country_code = Some("GB".to_owned());
        source.confidence_tier = Some(super::super::AtlasConfidenceTier::Strong);
        source.profile_path = Some("/wiki/source/Acme News".to_owned());
        source.current_parent = Some("Acme Holdings".to_owned());
        source.pending_change = Some("pending: Other Owner".to_owned());
        source.evidence_coverage = "4 cited observations".to_owned();
        source.freshness = "2026-09-27T12:00:00".to_owned();
        source.unresolved_gap = Some("chain incomplete".to_owned());

        let response = search_nodes(vec![source], "AcMe", 8);
        assert_eq!(response.query, "AcMe");
        let item = &response.outlets[0];
        assert_eq!(item.id, "outlet:1");
        assert!(matches!(item.entity_type, AtlasEntityType::Outlet));
        assert_eq!(item.label, "Acme News");
        assert_eq!(item.subtitle.as_deref(), Some("Daily"));
        assert_eq!(item.country_code.as_deref(), Some("GB"));
        assert!(matches!(
            item.confidence_tier,
            Some(super::super::AtlasConfidenceTier::Strong)
        ));
        assert_eq!(item.profile_path.as_deref(), Some("/wiki/source/Acme News"));
        assert_eq!(item.current_parent, None);
        assert_eq!(item.pending_change, None);
        assert_eq!(item.evidence_coverage, "not researched");
        assert_eq!(item.freshness, "unknown");
        assert_eq!(item.unresolved_gap, None);
    }

    #[test]
    fn shared_query_search_enforces_unicode_query_and_limit_bounds() {
        let mut values = HashMap::new();
        assert!(super::super::query_search(&values).is_err());

        values.insert("q".to_owned(), String::new());
        assert!(super::super::query_search(&values).is_err());

        let query_200 = "é".repeat(200);
        values.insert("q".to_owned(), query_200.clone());
        let (query, limit) = super::super::query_search(&values).expect("200 Unicode characters");
        assert_eq!(query, query_200);
        assert_eq!(limit, 8);

        values.insert("q".to_owned(), "é".repeat(201));
        assert!(super::super::query_search(&values).is_err());

        values.insert("q".to_owned(), "search".to_owned());
        for (raw_limit, expected_limit) in [("1", 1), ("20", 20)] {
            values.insert("limit".to_owned(), raw_limit.to_owned());
            let (_, limit) =
                super::super::query_search(&values).expect("limit boundary is accepted");
            assert_eq!(limit, expected_limit);
        }
        for raw_limit in ["0", "21"] {
            values.insert("limit".to_owned(), raw_limit.to_owned());
            assert!(super::super::query_search(&values).is_err());
        }
    }
}
