use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use thesis_db::WikiIndexStatusRecord;
use tokio::sync::Mutex;

use crate::AppState;

use super::{
    AtlasCoverageMetricResponse, AtlasEntityType, AtlasGraphFiltersInput, AtlasGraphResponse,
    AtlasNodeResponse, AtlasStatsResponse,
};

const STATS_CACHE_TTL: Duration = Duration::from_secs(300);
const AUTO_INGEST_ENTITY_TYPE: &str = "auto_ingest";
const AUTO_INGEST_ENTITY_NAME: &str = "atlas_pipeline";
const AUTO_INGEST_SUCCESS_STATUS: &str = "complete";
const MAX_STATS_EDGES: i64 = 2_500;

struct CachedStats {
    response: AtlasStatsResponse,
    network_ingest_success_at: Option<NaiveDateTime>,
    expires_at: Instant,
}
impl CachedStats {
    fn is_fresh_at(&self, now: Instant, network_ingest_success_at: Option<NaiveDateTime>) -> bool {
        now < self.expires_at && self.network_ingest_success_at == network_ingest_success_at
    }
}

static STATS_CACHE: LazyLock<Mutex<Option<CachedStats>>> = LazyLock::new(|| Mutex::new(None));

fn stats_filters() -> AtlasGraphFiltersInput {
    AtlasGraphFiltersInput {
        q: None,
        entity_types: vec![
            AtlasEntityType::Outlet,
            AtlasEntityType::Organization,
            AtlasEntityType::Person,
            AtlasEntityType::Reporter,
        ],
        relation_types: Vec::new(),
        country: Vec::new(),
        funding: Vec::new(),
        bias: Vec::new(),
        min_confidence: 0.0,
        selected: None,
        neighbors: 0,
        layout: super::default_layout(),
        limit_nodes: None,
        limit_edges: MAX_STATS_EDGES,
        include_evidence_preview: false,
        as_of: None,
        known_at: None,
        accepted_only: false,
    }
}

fn network_ingest_success_at(rows: &[WikiIndexStatusRecord]) -> Option<NaiveDateTime> {
    rows.iter()
        .filter(|row| {
            row.entity_type == AUTO_INGEST_ENTITY_TYPE
                && row.entity_name == AUTO_INGEST_ENTITY_NAME
                && row.status.as_deref() == Some(AUTO_INGEST_SUCCESS_STATUS)
        })
        .filter_map(|row| row.last_indexed_at)
        .max()
}

fn coverage_metrics(
    nodes: &[AtlasNodeResponse],
) -> (
    AtlasCoverageMetricResponse,
    BTreeMap<String, AtlasCoverageMetricResponse>,
) {
    let mut coverage_by_type = BTreeMap::<&'static str, AtlasCoverageMetricResponse>::new();
    let mut researched_count = 0_i64;

    for node in nodes {
        let metric = coverage_by_type
            .entry(super::graph::entity_type_name(node.entity_type))
            .or_default();
        metric.denominator = metric.denominator.saturating_add(1);
        if node.evidence_coverage != "not researched" {
            metric.numerator = metric.numerator.saturating_add(1);
            researched_count = researched_count.saturating_add(1);
        }
    }

    let denominator = i64::try_from(nodes.len()).unwrap_or(i64::MAX);
    let coverage_by_entity_type = coverage_by_type
        .into_iter()
        .map(|(entity_type, metric)| (entity_type.to_owned(), metric))
        .collect();
    (
        AtlasCoverageMetricResponse {
            numerator: researched_count,
            denominator,
        },
        coverage_by_entity_type,
    )
}

fn status_summary(
    rows: &[WikiIndexStatusRecord],
) -> (BTreeMap<String, i64>, Option<NaiveDateTime>, bool) {
    let mut counts = HashMap::<&str, i64>::new();
    let mut last_indexed_at = None;
    let mut indexing_active = false;

    for row in rows {
        let status = row.status.as_deref().unwrap_or("None");
        let count = counts.entry(status).or_default();
        *count = count.saturating_add(1);
        indexing_active |= status == "indexing";
        if let Some(indexed_at) = row.last_indexed_at {
            last_indexed_at =
                Some(last_indexed_at.map_or(indexed_at, |current| current.max(indexed_at)));
        }
    }

    let by_index_status = counts
        .into_iter()
        .map(|(status, count)| (status.to_owned(), count))
        .collect();
    (by_index_status, last_indexed_at, indexing_active)
}

fn stats_response(
    graph: AtlasGraphResponse,
    index_statuses: &[WikiIndexStatusRecord],
) -> AtlasStatsResponse {
    let AtlasGraphResponse {
        graph_version,
        generated_at,
        nodes,
        edges,
        stats,
        ..
    } = graph;

    let mut relation_counts = BTreeMap::<&'static str, i64>::new();
    for edge in &edges {
        let count = relation_counts
            .entry(super::graph::relation_type_name(edge.relation_type))
            .or_default();
        *count = count.saturating_add(1);
    }
    let by_relation_type = relation_counts
        .into_iter()
        .map(|(relation_type, count)| (relation_type.to_owned(), count))
        .collect();
    let by_entity_type = BTreeMap::from([
        ("outlet".to_owned(), stats.total_outlets),
        ("organization".to_owned(), stats.total_organizations),
        ("person".to_owned(), stats.total_people),
        ("reporter".to_owned(), stats.total_reporters),
    ]);
    let (by_index_status, last_indexed_at, indexing_active) = status_summary(index_statuses);
    let (research_coverage, research_coverage_by_entity_type) = coverage_metrics(&nodes);

    AtlasStatsResponse {
        graph_version,
        generated_at,
        stats,
        by_entity_type,
        by_relation_type,
        by_index_status,
        last_indexed_at,
        indexing_active,
        research_coverage,
        research_coverage_by_entity_type,
    }
}

async fn build_stats_response(state: &AppState) -> Result<AtlasStatsResponse, sqlx::Error> {
    let generated_at = Utc::now();
    let as_of = generated_at.naive_utc();
    let projection = state
        .database
        .load_atlas_projection_data(as_of, as_of, None)
        .await?;
    let filters = stats_filters();
    let graph_data = super::graph::project(&projection, &filters, as_of, as_of);
    let graph = super::graph::build_response(graph_data, filters, generated_at);
    Ok(stats_response(graph, &projection.wiki_index_statuses))
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/stats",
    operation_id = "get_atlas_stats_api_wiki_atlas_stats_get",
    responses((status = 200, description = "Successful Response", body = AtlasStatsResponse)),
    tag = "wiki-atlas",
    summary = "Get Atlas Statistics",
    description = "Return aggregate Atlas graph statistics without node or edge payloads."
)]
pub(crate) async fn get_atlas_stats(State(state): State<AppState>) -> Response {
    let marker_rows = match state
        .database
        .wiki_index_entries(Some(AUTO_INGEST_ENTITY_TYPE))
        .await
    {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let network_ingest_success_at = network_ingest_success_at(&marker_rows);

    let mut cache = STATS_CACHE.lock().await;
    let now = Instant::now();
    if let Some(cached) = cache
        .as_ref()
        .filter(|cached| cached.is_fresh_at(now, network_ingest_success_at))
    {
        return Json(cached.response.clone()).into_response();
    }

    let response = match build_stats_response(&state).await {
        Ok(response) => response,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    *cache = Some(CachedStats {
        response: response.clone(),
        network_ingest_success_at,
        expires_at: Instant::now() + STATS_CACHE_TTL,
    });
    Json(response).into_response()
}

#[cfg(test)]
mod tests {
    use super::super::{
        AtlasDirection, AtlasEdgeResponse, AtlasFactStatus, AtlasGraphStatsResponse,
        AtlasLifecycleState, AtlasRelationType,
    };
    use super::*;
    use chrono::{DateTime, NaiveDate};

    fn timestamp(day: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 9, day)
            .expect("valid test date")
            .and_hms_opt(12, 0, 0)
            .expect("valid test time")
    }

    fn index_status(
        entity_type: &str,
        entity_name: &str,
        status: Option<&str>,
        last_indexed_at: Option<NaiveDateTime>,
    ) -> WikiIndexStatusRecord {
        WikiIndexStatusRecord {
            entity_type: entity_type.to_owned(),
            entity_name: entity_name.to_owned(),
            status: status.map(str::to_owned),
            last_indexed_at,
        }
    }

    fn node(
        entity_type: AtlasEntityType,
        label: &str,
        evidence_coverage: &str,
    ) -> AtlasNodeResponse {
        AtlasNodeResponse {
            id: format!(
                "{}:{label}",
                super::super::graph::entity_type_name(entity_type)
            ),
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
            evidence_coverage: evidence_coverage.to_owned(),
            freshness: "unknown".to_owned(),
            unresolved_gap: None,
        }
    }

    fn edge(
        relation_type: AtlasRelationType,
        source_id: &str,
        target_id: &str,
    ) -> AtlasEdgeResponse {
        AtlasEdgeResponse {
            id: format!("{source_id}-{target_id}"),
            source_id: source_id.to_owned(),
            target_id: target_id.to_owned(),
            relation_type,
            predicate: "test relation".to_owned(),
            display_group: "test".to_owned(),
            relation_type_deprecated: false,
            direction: AtlasDirection::Directed,
            weight: 1.0,
            ownership_percentage: None,
            voting_interest: None,
            economic_interest: None,
            beneficial_interest: None,
            confidence: Some(1.0),
            confidence_tier: None,
            evidence_count: 1,
            evidence_preview: Vec::new(),
            valid_from: None,
            valid_to: None,
            last_verified_at: None,
            is_inferred: false,
            raw_relation_type: None,
            fact_status: AtlasFactStatus::Accepted,
            lifecycle_state: AtlasLifecycleState::Current,
            accepted_fact: true,
            qualifiers: serde_json::Value::Null,
            claim_ids: Vec::new(),
            recorded_at: None,
            retracted_at: None,
            acceptance_policy_version: None,
            evidence_root_count: 1,
        }
    }

    fn graph_response() -> AtlasGraphResponse {
        let mut stats = AtlasGraphStatsResponse::default();
        stats.total_outlets = 1;
        stats.total_people = 1;
        AtlasGraphResponse {
            graph_version: "stats-test-version".to_owned(),
            generated_at: DateTime::<Utc>::from_timestamp(1_790_000_000, 0)
                .expect("valid test timestamp"),
            nodes: vec![
                node(AtlasEntityType::Outlet, "Outlet A", "researched"),
                node(AtlasEntityType::Person, "Person B", "not researched"),
            ],
            edges: vec![
                edge(AtlasRelationType::Ownership, "outlet:a", "person:b"),
                edge(AtlasRelationType::EmployedBy, "person:b", "outlet:a"),
            ],
            stats,
            applied_filters: stats_filters(),
            truncated: false,
            truncation_reason: None,
            next_expansion_token: None,
        }
    }

    #[test]
    fn stats_response_summarizes_graph_edges_coverage_and_index_statuses() {
        let indexed_at = timestamp(20);
        let indexing_at = timestamp(21);
        let marker_at = timestamp(22);
        let statuses = vec![
            index_status("outlet", "Outlet A", Some("complete"), Some(indexed_at)),
            index_status("organization", "Org A", Some("indexing"), Some(indexing_at)),
            index_status(
                AUTO_INGEST_ENTITY_TYPE,
                AUTO_INGEST_ENTITY_NAME,
                Some(AUTO_INGEST_SUCCESS_STATUS),
                Some(marker_at),
            ),
        ];

        let response = stats_response(graph_response(), &statuses);

        assert_eq!(response.graph_version, "stats-test-version");
        assert_eq!(response.stats.total_outlets, 1);
        assert_eq!(response.stats.total_people, 1);
        assert_eq!(
            response.by_entity_type,
            BTreeMap::from([
                ("outlet".to_owned(), 1),
                ("organization".to_owned(), 0),
                ("person".to_owned(), 1),
                ("reporter".to_owned(), 0),
            ])
        );
        assert_eq!(
            response.by_relation_type,
            BTreeMap::from([("employed_by".to_owned(), 1), ("ownership".to_owned(), 1),])
        );
        assert_eq!(
            response.by_index_status,
            BTreeMap::from([("complete".to_owned(), 2), ("indexing".to_owned(), 1)])
        );
        assert_eq!(response.last_indexed_at, Some(marker_at));
        assert!(response.indexing_active);
        assert_eq!(response.research_coverage.numerator, 1);
        assert_eq!(response.research_coverage.denominator, 2);
        let outlet_coverage = &response.research_coverage_by_entity_type["outlet"];
        assert_eq!(outlet_coverage.numerator, 1);
        assert_eq!(outlet_coverage.denominator, 1);
        let person_coverage = &response.research_coverage_by_entity_type["person"];
        assert_eq!(person_coverage.numerator, 0);
        assert_eq!(person_coverage.denominator, 1);
    }

    #[test]
    fn auto_ingest_cache_marker_tracks_only_completed_network_runs() {
        let completed_at = timestamp(20);
        let rows = vec![
            index_status(
                AUTO_INGEST_ENTITY_TYPE,
                AUTO_INGEST_ENTITY_NAME,
                Some(AUTO_INGEST_SUCCESS_STATUS),
                Some(completed_at),
            ),
            index_status(
                AUTO_INGEST_ENTITY_TYPE,
                AUTO_INGEST_ENTITY_NAME,
                Some("indexing"),
                Some(timestamp(21)),
            ),
            index_status(
                "outlet",
                AUTO_INGEST_ENTITY_NAME,
                Some(AUTO_INGEST_SUCCESS_STATUS),
                Some(timestamp(22)),
            ),
        ];

        assert_eq!(network_ingest_success_at(&rows), Some(completed_at));
        assert_eq!(
            network_ingest_success_at(&rows[1..]),
            None,
            "an incomplete run or another entity type must not invalidate stats"
        );
    }

    #[test]
    fn stats_cache_expires_at_ttl_and_after_network_success_changes() {
        let marker = timestamp(20);
        let now = Instant::now();
        let cached = CachedStats {
            response: stats_response(graph_response(), &[]),
            network_ingest_success_at: Some(marker),
            expires_at: now + STATS_CACHE_TTL,
        };

        assert!(cached.is_fresh_at(now, Some(marker)));
        assert!(!cached.is_fresh_at(now, Some(timestamp(21))));
        assert!(!cached.is_fresh_at(cached.expires_at, Some(marker)));
    }
}
