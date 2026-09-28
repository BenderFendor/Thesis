//! Trending clusters, snapshots, and cluster-level evidence routes.

use std::collections::{BTreeMap, BTreeSet};

use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Map, Value};
use utoipa::{IntoParams, ToSchema};

use super::{
    ensure_positive_id, ensure_positive_id_option, free_form_object_schema, invalid_query,
    not_found_response, parse_integer_path_id, parse_integer_query, provider_error_response,
    scalar_query, unavailable_response, validate_finite, DiscoveryError, DiscoveryState,
    CLUSTER_SNAPSHOT_UNAVAILABLE_DETAIL, VECTOR_STORE_UNAVAILABLE_DETAIL,
};
use crate::models::HttpValidationError;

pub(super) fn router(state: DiscoveryState) -> Router {
    Router::new()
        .route("/trending", get(get_trending))
        .route("/trending/breaking", get(get_breaking))
        .route("/trending/clusters", get(get_all_clusters))
        .route("/trending/clusters/{cluster_id}", get(get_cluster_detail))
        .route(
            "/trending/clusters/{cluster_id}/contradictions",
            get(get_cluster_contradictions),
        )
        .route(
            "/trending/clusters/{cluster_id}/lineage",
            get(get_cluster_lineage),
        )
        .route("/trending/stats", get(get_trending_stats))
        .with_state(state)
}
/// One GDELT cameo aggregate.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct GdeltTopCameo {
    pub code: Option<String>,
    pub label: Option<String>,
    pub count: i64,
}

/// GDELT event context attached to a cluster or article.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct GdeltContext {
    pub total_events: i64,
    #[schema(required = false)]
    pub top_cameo: Vec<GdeltTopCameo>,
    pub goldstein_avg: Option<f64>,
    pub goldstein_min: Option<f64>,
    pub goldstein_max: Option<f64>,
    pub goldstein_bucket: Option<String>,
    pub tone_avg: Option<f64>,
    pub tone_baseline_avg: Option<f64>,
    pub tone_delta_vs_cluster: Option<f64>,
}

/// Article information included in cluster payloads.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct ClusterArticle {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub source_id: Option<String>,
    pub url: String,
    pub image_url: Option<String>,
    pub published_at: Option<String>,
    pub summary: Option<String>,
    pub similarity: Option<f64>,
    pub author: Option<String>,
    #[schema(required = false)]
    pub authors: Vec<String>,
    pub gdelt_context: Option<GdeltContext>,
}

/// Trending cluster with velocity metrics.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct TrendingCluster {
    pub cluster_id: i64,
    #[schema(required = true)]
    pub label: Option<String>,
    pub keywords: Vec<String>,
    pub article_count: i64,
    pub window_count: i64,
    pub source_diversity: i64,
    pub trending_score: f64,
    pub velocity: f64,
    pub representative_article: Option<ClusterArticle>,
    #[schema(required = false)]
    pub articles: Vec<ClusterArticle>,
    pub gdelt_context: Option<GdeltContext>,
}

/// Response for `GET /trending`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct TrendingResponse {
    pub window: String,
    pub clusters: Vec<TrendingCluster>,
    #[schema(value_type = i64)]
    pub total: usize,
}

/// Breaking cluster with recent spike metrics.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct BreakingCluster {
    pub cluster_id: i64,
    #[schema(required = true)]
    pub label: Option<String>,
    pub keywords: Vec<String>,
    pub article_count_3h: i64,
    pub source_count_3h: i64,
    pub spike_magnitude: f64,
    pub is_new_story: bool,
    pub representative_article: Option<ClusterArticle>,
    #[schema(required = false)]
    pub articles: Vec<ClusterArticle>,
    pub gdelt_context: Option<GdeltContext>,
}

/// Response for `GET /trending/breaking`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct BreakingResponse {
    pub window_hours: i64,
    pub clusters: Vec<BreakingCluster>,
    #[schema(value_type = i64)]
    pub total: usize,
}

/// One cluster in the precomputed all-clusters snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct AllCluster {
    pub cluster_id: i64,
    #[schema(required = true)]
    pub label: Option<String>,
    pub keywords: Vec<String>,
    pub article_count: i64,
    pub window_count: i64,
    pub source_diversity: i64,
    pub representative_article: Option<ClusterArticle>,
    #[schema(required = false)]
    pub articles: Vec<ClusterArticle>,
    pub gdelt_context: Option<GdeltContext>,
}

/// Snapshot row provided by the independent cache boundary.
#[derive(Clone, Debug, PartialEq)]
pub struct ClusterSnapshot {
    /// Snapshot clusters as stored by the background worker.
    pub clusters: Vec<AllCluster>,
    /// ISO timestamp of the last computation, if recorded.
    pub computed_at: Option<String>,
}

/// Response for `GET /trending/clusters`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct AllClustersResponse {
    pub window: String,
    pub clusters: Vec<AllCluster>,
    #[schema(value_type = i64)]
    pub total: usize,
    pub computed_at: Option<String>,
    pub status: Option<String>,
}

/// Cluster detail shared by detail, contradictions, and lineage provider calls.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct ClusterDetail {
    pub id: i64,
    #[schema(required = true)]
    pub label: Option<String>,
    pub keywords: Vec<String>,
    pub article_count: i64,
    #[schema(required = true)]
    pub first_seen: Option<String>,
    #[schema(required = true)]
    pub last_seen: Option<String>,
    pub is_active: bool,
    #[schema(required = false)]
    pub articles: Vec<ClusterArticle>,
    pub gdelt_context: Option<GdeltContext>,
}

/// Contradiction evidence excerpt.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct ContradictionEvidence {
    pub source: String,
    pub article_url: String,
    pub stance: String,
    pub snippet: String,
}

/// A claim and its supporting/contradicting evidence.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct ContradictionClaim {
    pub claim: String,
    pub status: String,
    #[schema(required = false)]
    pub evidence: Vec<ContradictionEvidence>,
}

/// A fact reported consistently across the cluster.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct AgreedFact {
    pub claim: String,
    #[schema(required = false)]
    pub evidence: Vec<ContradictionEvidence>,
}

/// Response for `GET /trending/clusters/{cluster_id}/contradictions`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct ContradictionPanel {
    pub status: String,
    pub reason: Option<String>,
    #[schema(required = false)]
    pub claims: Vec<ContradictionClaim>,
    #[schema(required = false)]
    pub agreed_facts: Vec<AgreedFact>,
    #[schema(required = false)]
    pub unconfirmed_gaps: Vec<String>,
    pub source_count: i64,
    pub article_count: i64,
}

/// Durable story object for a topic cluster.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct LineageStory {
    pub id: i64,
    pub external_cluster_id: i64,
    pub label: Option<String>,
    #[schema(required = false)]
    pub keywords: Vec<String>,
    pub first_seen_at: Option<String>,
    pub last_seen_at: Option<String>,
    pub earliest_article_id: Option<i64>,
    pub current_summary: Option<String>,
    pub confidence: Option<f64>,
}

/// An article-to-article lineage edge.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct LineageArticleEdge {
    pub id: Option<i64>,
    pub from_article_id: i64,
    pub to_article_id: i64,
    pub from_title: String,
    pub to_title: String,
    pub relation: String,
    #[schema(required = false, schema_with = free_form_object_schema)]
    pub evidence: BTreeMap<String, Value>,
    pub confidence: Option<f64>,
}

/// An extracted claim in a lineage.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct LineageClaim {
    pub id: Option<i64>,
    pub article_id: i64,
    pub claim_text: String,
    pub claim_type: String,
    pub checkability: String,
    pub evidence_span: Option<String>,
    #[schema(required = false)]
    pub numbers: Vec<String>,
}

/// A claim-to-claim lineage edge.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct LineageClaimEdge {
    pub id: Option<i64>,
    pub from_claim_id: i64,
    pub to_claim_id: i64,
    pub relation: String,
    #[schema(required = false, schema_with = free_form_object_schema)]
    pub evidence: BTreeMap<String, Value>,
    pub confidence: Option<f64>,
}

/// A correction-watch result connected to a lineage.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct LineageCorrection {
    pub id: i64,
    pub source: String,
    pub article_id: Option<i64>,
    pub correction_url: Option<String>,
    pub correction_text: String,
    pub corrected_claim_id: Option<i64>,
    #[schema(required = false)]
    pub downstream_article_ids: Vec<i64>,
    pub published_at: Option<String>,
}

/// Response for `GET /trending/clusters/{cluster_id}/lineage`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct StoryLineage {
    pub status: String,
    pub reason: Option<String>,
    pub story: Option<LineageStory>,
    #[schema(required = false)]
    pub article_edges: Vec<LineageArticleEdge>,
    #[schema(required = false)]
    pub claims: Vec<LineageClaim>,
    #[schema(required = false)]
    pub claim_edges: Vec<LineageClaimEdge>,
    #[schema(required = false)]
    pub corrections: Vec<LineageCorrection>,
}

/// Trending system counters and threshold.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct TrendingStats {
    pub active_clusters: i64,
    pub baseline_days: i64,
    pub breaking_window_hours: i64,
    pub recent_spikes: i64,
    pub similarity_threshold: f64,
    pub total_article_assignments: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct TrendingQuery {
    #[param(required = false, default = "1d", pattern = "^(1d|1w|1m)$")]
    window: String,
    #[param(required = false, default = 10, minimum = 1, maximum = 50)]
    limit: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct BreakingQuery {
    #[param(required = false, default = 5, minimum = 1, maximum = 20)]
    limit: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct WindowQuery {
    #[param(required = false, default = "1d", pattern = "^(1d|1w|1m)$")]
    window: String,
}
#[utoipa::path(
    get,
    path = "/trending",
    operation_id = "get_trending_trending_get",
    tag = "trending",
    params(TrendingQuery),
    responses(
        (status = 200, description = "Successful Response", body = TrendingResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_trending(
    State(state): State<DiscoveryState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let TrendingQuery { window, limit } = match parse_trending_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => {
            return cache_response(
                error.into_response(),
                "public, max-age=60, stale-while-revalidate=120",
            )
        }
    };
    let Some(provider) = state.provider else {
        return cache_response(
            unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL),
            "public, max-age=60, stale-while-revalidate=120",
        );
    };
    let clusters = match provider.trending_clusters(window.clone(), limit).await {
        Ok(clusters) => clusters,
        Err(DiscoveryError::VectorStoreUnavailable) => Vec::new(),
        Err(error) => {
            return cache_response(
                provider_error_response(error),
                "public, max-age=60, stale-while-revalidate=120",
            )
        }
    };
    if let Err(error) = validate_trending_clusters(&clusters) {
        return cache_response(
            provider_error_response(error),
            "public, max-age=60, stale-while-revalidate=120",
        );
    }
    cache_response(
        Json(TrendingResponse {
            window,
            total: clusters.len(),
            clusters,
        })
        .into_response(),
        "public, max-age=60, stale-while-revalidate=120",
    )
}

#[utoipa::path(
    get,
    path = "/trending/breaking",
    operation_id = "get_breaking_trending_breaking_get",
    tag = "trending",
    params(BreakingQuery),
    responses(
        (status = 200, description = "Successful Response", body = BreakingResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_breaking(
    State(state): State<DiscoveryState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let BreakingQuery { limit } =
        match parse_integer_query(raw_query.as_deref(), "limit", 5, Some(1), Some(20)) {
            Ok(limit) => BreakingQuery { limit },
            Err(error) => {
                return cache_response(
                    error.into_response(),
                    "public, max-age=30, stale-while-revalidate=60",
                )
            }
        };
    let Some(provider) = state.provider else {
        return cache_response(
            unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL),
            "public, max-age=30, stale-while-revalidate=60",
        );
    };
    let clusters = match provider.breaking_clusters(limit).await {
        Ok(clusters) => clusters,
        Err(DiscoveryError::VectorStoreUnavailable) => Vec::new(),
        Err(error) => {
            return cache_response(
                provider_error_response(error),
                "public, max-age=30, stale-while-revalidate=60",
            )
        }
    };
    if let Err(error) = validate_breaking_clusters(&clusters) {
        return cache_response(
            provider_error_response(error),
            "public, max-age=30, stale-while-revalidate=60",
        );
    }
    cache_response(
        Json(BreakingResponse {
            window_hours: 3,
            total: clusters.len(),
            clusters,
        })
        .into_response(),
        "public, max-age=30, stale-while-revalidate=60",
    )
}

#[utoipa::path(
    get,
    path = "/trending/clusters",
    operation_id = "get_all_clusters_trending_clusters_get",
    tag = "trending",
    params(WindowQuery),
    responses(
        (status = 200, description = "Successful Response", body = AllClustersResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_all_clusters(
    State(state): State<DiscoveryState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let WindowQuery { window } = match parse_window_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => {
            return cache_response(
                error.into_response(),
                "public, max-age=60, stale-while-revalidate=120",
            )
        }
    };
    let Some(cache) = state.snapshots else {
        return cache_response(
            unavailable_response(CLUSTER_SNAPSHOT_UNAVAILABLE_DETAIL),
            "public, max-age=60, stale-while-revalidate=120",
        );
    };
    let snapshot = match cache.latest_snapshot(window.clone()).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return cache_response(
                provider_error_response(error),
                "public, max-age=60, stale-while-revalidate=120",
            )
        }
    };
    let response = match snapshot {
        None => AllClustersResponse {
            window,
            clusters: Vec::new(),
            total: 0,
            computed_at: None,
            status: Some("initializing".to_owned()),
        },
        Some(snapshot) => {
            if let Err(error) = validate_all_clusters(&snapshot.clusters) {
                return cache_response(
                    provider_error_response(error),
                    "public, max-age=60, stale-while-revalidate=120",
                );
            }
            let total = snapshot.clusters.len();
            AllClustersResponse {
                window,
                clusters: snapshot.clusters,
                total,
                computed_at: snapshot.computed_at,
                status: Some("ok".to_owned()),
            }
        }
    };
    cache_response(
        Json(response).into_response(),
        "public, max-age=60, stale-while-revalidate=120",
    )
}

#[utoipa::path(
    get,
    path = "/trending/clusters/{cluster_id}",
    operation_id = "get_cluster_detail_trending_clusters__cluster_id__get",
    tag = "trending",
    params(("cluster_id" = i64, Path, description = "Cluster ID")),
    responses(
        (status = 200, description = "Successful Response", body = ClusterDetail),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_cluster_detail(
    State(state): State<DiscoveryState>,
    Path(raw_cluster_id): Path<String>,
) -> Response {
    let cluster_id = match parse_integer_path_id(&raw_cluster_id, "cluster_id") {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return unavailable_response("Topic discovery provider is not available");
    };
    match provider.cluster_detail(cluster_id).await {
        Ok(Some(detail)) => match validate_cluster_detail(&detail, cluster_id) {
            Ok(()) => Json(detail).into_response(),
            Err(error) => provider_error_response(error),
        },
        Ok(None) => not_found_response("Cluster not found"),
        Err(error) => provider_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/trending/clusters/{cluster_id}/contradictions",
    operation_id = "get_cluster_contradictions_trending_clusters__cluster_id__contradictions_get",
    tag = "trending",
    params(("cluster_id" = i64, Path, description = "Cluster ID")),
    responses(
        (status = 200, description = "Successful Response", body = ContradictionPanel),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_cluster_contradictions(
    State(state): State<DiscoveryState>,
    Path(raw_cluster_id): Path<String>,
) -> Response {
    let cluster_id = match parse_integer_path_id(&raw_cluster_id, "cluster_id") {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return unavailable_response("Topic discovery provider is not available");
    };
    let detail = match provider.cluster_detail(cluster_id).await {
        Ok(Some(detail)) => detail,
        Ok(None) => return not_found_response("Cluster not found"),
        Err(error) => return provider_error_response(error),
    };
    if let Err(error) = validate_cluster_detail(&detail, cluster_id) {
        return provider_error_response(error);
    }
    Json(build_contradiction_panel(&detail)).into_response()
}

const CONTRADICTION_NEGATION_TERMS: &[&str] = &[
    "no", "not", "never", "none", "without", "denied", "deny", "false",
];

const CONTRADICTION_STOP_WORDS: &[&str] = &[
    "about", "after", "again", "against", "also", "amid", "among", "and", "are", "article",
    "because", "been", "before", "being", "between", "but", "could", "from", "has", "have", "into",
    "more", "news", "over", "said", "says", "that", "the", "their", "this", "through", "under",
    "will", "with", "would",
];

fn build_contradiction_panel(detail: &ClusterDetail) -> ContradictionPanel {
    let source_names = detail
        .articles
        .iter()
        .map(|article| {
            if article.source.is_empty() {
                "Unknown source"
            } else {
                article.source.as_str()
            }
        })
        .collect::<BTreeSet<_>>();
    if source_names.len() < 3 || detail.articles.len() < 3 {
        return ContradictionPanel {
            status: "insufficient_source_diversity".to_owned(),
            reason: Some(
                "Contradiction-first analysis needs at least three source-diverse articles."
                    .to_owned(),
            ),
            claims: Vec::new(),
            agreed_facts: Vec::new(),
            unconfirmed_gaps: Vec::new(),
            source_count: source_names.len() as i64,
            article_count: detail.articles.len() as i64,
        };
    }

    let mut token_counts: Vec<(String, usize)> = Vec::new();
    let mut snippets_by_keyword: Vec<(String, Vec<ContradictionEvidence>)> = Vec::new();
    for article in &detail.articles {
        let sentences = contradiction_sentence_candidates(article);
        for sentence in &sentences {
            for token in contradiction_tokens(sentence) {
                if let Some((_, count)) = token_counts.iter_mut().find(|(word, _)| word == &token) {
                    *count += 1;
                } else {
                    token_counts.push((token, 1));
                }
            }
        }

        let mut ranked_keywords = token_counts.clone();
        ranked_keywords.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
        ranked_keywords.truncate(12);

        for sentence in sentences {
            let sentence_tokens = contradiction_tokens(&sentence);
            for (keyword, _) in &ranked_keywords {
                if sentence_tokens.iter().any(|token| token == keyword) {
                    let index = snippets_by_keyword
                        .iter()
                        .position(|(known, _)| known == keyword)
                        .unwrap_or_else(|| {
                            snippets_by_keyword.push((keyword.clone(), Vec::new()));
                            snippets_by_keyword.len() - 1
                        });
                    let source = if article.source.is_empty() {
                        "Unknown source".to_owned()
                    } else {
                        article.source.clone()
                    };
                    snippets_by_keyword[index].1.push(ContradictionEvidence {
                        source,
                        article_url: article.url.clone(),
                        stance: "mentions".to_owned(),
                        snippet: sentence.chars().take(320).collect(),
                    });
                }
            }
        }
    }

    let mut claims = Vec::new();
    let mut agreed_facts = Vec::new();
    let mut unconfirmed_gaps = Vec::new();
    for (keyword, snippets) in snippets_by_keyword {
        let source_count = snippets
            .iter()
            .map(|snippet| snippet.source.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        if source_count < 2 {
            continue;
        }
        if has_numeric_conflict(&snippets) || has_negation_conflict(&snippets) {
            claims.push(ContradictionClaim {
                claim: format!("Sources diverge on details involving {keyword}."),
                status: "disputed".to_owned(),
                evidence: snippets.into_iter().take(6).collect(),
            });
        } else if source_count >= 3 && agreed_facts.len() < 3 {
            agreed_facts.push(AgreedFact {
                claim: format!("Multiple sources mention {keyword}."),
                evidence: snippets.into_iter().take(4).collect(),
            });
        } else if unconfirmed_gaps.len() < 3 {
            unconfirmed_gaps.push(format!(
                "Only {source_count} sources mention {keyword}; check primary evidence before treating it as settled."
            ));
        }
        if claims.len() >= 5 {
            break;
        }
    }

    ContradictionPanel {
        status: "ok".to_owned(),
        reason: None,
        claims,
        agreed_facts,
        unconfirmed_gaps,
        source_count: source_names.len() as i64,
        article_count: detail.articles.len() as i64,
    }
}

fn contradiction_sentence_candidates(article: &ClusterArticle) -> Vec<String> {
    let mut text = article.title.clone();
    if let Some(summary) = &article.summary {
        text.push(' ');
        text.push_str(summary);
    }

    let mut sentences = Vec::new();
    let mut start = 0;
    for (index, character) in text.char_indices() {
        if !matches!(character, '.' | '!' | '?') {
            continue;
        }
        let after_punctuation = index + character.len_utf8();
        let mut end = after_punctuation;
        let mut has_whitespace = false;
        for (offset, next) in text[after_punctuation..].char_indices() {
            if !next.is_whitespace() {
                break;
            }
            end = after_punctuation + offset + next.len_utf8();
            has_whitespace = true;
        }
        if has_whitespace {
            let sentence = text[start..after_punctuation].trim();
            if !sentence.is_empty() {
                sentences.push(sentence.to_owned());
                if sentences.len() == 5 {
                    return sentences;
                }
            }
            start = end;
        }
    }
    let sentence = text[start..].trim();
    if !sentence.is_empty() && sentences.len() < 5 {
        sentences.push(sentence.to_owned());
    }
    sentences
}

fn contradiction_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut characters = text.char_indices().peekable();
    let mut previous = None;
    while let Some((start, character)) = characters.next() {
        if !character.is_ascii_alphabetic() || previous.is_some_and(is_word_character) {
            previous = Some(character);
            continue;
        }

        let mut last_alpha_end = start + character.len_utf8();
        let mut last_consumed = character;
        while let Some((_, next)) = characters.peek().copied() {
            if !next.is_ascii_alphabetic() && next != '\'' && next != '-' {
                break;
            }
            characters.next();
            last_consumed = next;
            if next.is_ascii_alphabetic() {
                let (index, _) = characters
                    .clone()
                    .peek()
                    .copied()
                    .unwrap_or((text.len(), '\0'));
                last_alpha_end = index;
            }
        }

        let token = &text[start..last_alpha_end];
        let has_word_boundary = text[last_alpha_end..]
            .chars()
            .next()
            .is_none_or(|next| !is_word_character(next));
        if token.len() >= 3 && has_word_boundary {
            let lowered = token.to_ascii_lowercase();
            if !CONTRADICTION_STOP_WORDS.contains(&lowered.as_str()) {
                tokens.push(lowered);
            }
        }
        previous = Some(last_consumed);
    }
    tokens
}

fn has_numeric_conflict(snippets: &[ContradictionEvidence]) -> bool {
    let number_sets = snippets
        .iter()
        .map(|snippet| contradiction_numbers(&snippet.snippet))
        .filter(|numbers| !numbers.is_empty())
        .collect::<BTreeSet<_>>();
    number_sets.len() > 1
}

fn has_negation_conflict(snippets: &[ContradictionEvidence]) -> bool {
    snippets
        .iter()
        .map(|snippet| {
            let tokens = contradiction_tokens(&snippet.snippet);
            tokens
                .iter()
                .any(|token| CONTRADICTION_NEGATION_TERMS.contains(&token.as_str()))
        })
        .collect::<BTreeSet<_>>()
        .len()
        > 1
}

fn contradiction_numbers(text: &str) -> BTreeSet<String> {
    let mut numbers = BTreeSet::new();
    let mut characters = text.char_indices().peekable();
    let mut previous = None;
    while let Some((start, character)) = characters.peek().copied() {
        if !character.is_ascii_digit() || previous.is_some_and(is_word_character) {
            characters.next();
            previous = Some(character);
            continue;
        }

        characters.next();
        let mut end = start + character.len_utf8();
        while let Some((_, next)) = characters.peek().copied() {
            if !next.is_ascii_digit() {
                break;
            }
            characters.next();
            end += next.len_utf8();
        }
        while let Some((_, separator @ ('.' | ','))) = characters.peek().copied() {
            let mut lookahead = characters.clone();
            lookahead.next();
            if !lookahead
                .peek()
                .is_some_and(|(_, next)| next.is_ascii_digit())
            {
                break;
            }
            characters.next();
            end += separator.len_utf8();
            while let Some((_, next)) = characters.peek().copied() {
                if !next.is_ascii_digit() {
                    break;
                }
                characters.next();
                end += next.len_utf8();
            }
        }

        let mut last_matched = text[start..end].chars().next_back().unwrap_or(character);
        if characters.peek().is_some_and(|(_, next)| *next == '%') {
            let mut lookahead = characters.clone();
            lookahead.next();
            if lookahead
                .peek()
                .is_some_and(|(_, next)| is_word_character(*next))
            {
                characters.next();
                end += '%'.len_utf8();
                last_matched = '%';
            }
        }
        let has_word_boundary = characters
            .peek()
            .is_none_or(|(_, next)| is_word_character(last_matched) != is_word_character(*next));
        if has_word_boundary {
            numbers.insert(text[start..end].to_owned());
        }
        previous = Some(last_matched);
    }
    numbers
}

fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[utoipa::path(
    get,
    path = "/trending/clusters/{cluster_id}/lineage",
    operation_id = "get_cluster_lineage_trending_clusters__cluster_id__lineage_get",
    tag = "trending",
    params(("cluster_id" = i64, Path, description = "Cluster ID")),
    responses(
        (status = 200, description = "Successful Response", body = StoryLineage),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_cluster_lineage(
    State(state): State<DiscoveryState>,
    Path(raw_cluster_id): Path<String>,
) -> Response {
    let cluster_id = match parse_integer_path_id(&raw_cluster_id, "cluster_id") {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return unavailable_response("Topic discovery provider is not available");
    };
    let detail = match provider.cluster_detail(cluster_id).await {
        Ok(Some(detail)) => detail,
        Ok(None) => return not_found_response("Cluster not found"),
        Err(error) => return provider_error_response(error),
    };
    if let Err(error) = validate_cluster_detail(&detail, cluster_id) {
        return provider_error_response(error);
    }
    match provider.story_lineage(detail).await {
        Ok(lineage) => match validate_story_lineage(&lineage, cluster_id) {
            Ok(()) => Json(lineage).into_response(),
            Err(error) => provider_error_response(error),
        },
        Err(error) => provider_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/trending/stats",
    operation_id = "get_trending_stats_trending_stats_get",
    tag = "trending",
    responses((status = 200, description = "Successful Response", body = TrendingStats))
)]
async fn get_trending_stats(State(state): State<DiscoveryState>) -> Response {
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    match provider.trending_stats().await {
        Ok(stats) if stats.similarity_threshold.is_finite() => Json(stats).into_response(),
        Ok(_) => provider_error_response(DiscoveryError::InvalidData(
            "trending similarity_threshold is not finite".to_owned(),
        )),
        Err(DiscoveryError::VectorStoreUnavailable) => Json(empty_trending_stats()).into_response(),
        Err(error) => provider_error_response(error),
    }
}
fn empty_trending_stats() -> TrendingStats {
    TrendingStats {
        active_clusters: 0,
        baseline_days: 0,
        breaking_window_hours: 3,
        recent_spikes: 0,
        similarity_threshold: 0.0,
        total_article_assignments: 0,
    }
}
fn validate_gdelt(context: Option<&GdeltContext>) -> Result<(), DiscoveryError> {
    if let Some(context) = context {
        for (value, label) in [
            (context.goldstein_avg, "goldstein_avg"),
            (context.goldstein_min, "goldstein_min"),
            (context.goldstein_max, "goldstein_max"),
            (context.tone_avg, "tone_avg"),
            (context.tone_baseline_avg, "tone_baseline_avg"),
            (context.tone_delta_vs_cluster, "tone_delta_vs_cluster"),
        ] {
            validate_finite(value, label)?;
        }
    }
    Ok(())
}

fn validate_cluster_article(article: &ClusterArticle) -> Result<(), DiscoveryError> {
    ensure_positive_id(article.id, "cluster article id")?;
    validate_finite(article.similarity, "article similarity")?;
    validate_gdelt(article.gdelt_context.as_ref())
}

fn validate_trending_clusters(clusters: &[TrendingCluster]) -> Result<(), DiscoveryError> {
    for cluster in clusters {
        ensure_positive_id(cluster.cluster_id, "trending cluster id")?;
        validate_finite(Some(cluster.trending_score), "trending score")?;
        validate_finite(Some(cluster.velocity), "trending velocity")?;
        validate_gdelt(cluster.gdelt_context.as_ref())?;
        if let Some(article) = cluster.representative_article.as_ref() {
            validate_cluster_article(article)?;
        }
        for article in &cluster.articles {
            validate_cluster_article(article)?;
        }
    }
    Ok(())
}

fn validate_breaking_clusters(clusters: &[BreakingCluster]) -> Result<(), DiscoveryError> {
    for cluster in clusters {
        ensure_positive_id(cluster.cluster_id, "breaking cluster id")?;
        validate_finite(Some(cluster.spike_magnitude), "breaking spike magnitude")?;
        validate_gdelt(cluster.gdelt_context.as_ref())?;
        if let Some(article) = cluster.representative_article.as_ref() {
            validate_cluster_article(article)?;
        }
        for article in &cluster.articles {
            validate_cluster_article(article)?;
        }
    }
    Ok(())
}

fn validate_all_clusters(clusters: &[AllCluster]) -> Result<(), DiscoveryError> {
    for cluster in clusters {
        ensure_positive_id(cluster.cluster_id, "snapshot cluster id")?;
        validate_gdelt(cluster.gdelt_context.as_ref())?;
        if let Some(article) = cluster.representative_article.as_ref() {
            validate_cluster_article(article)?;
        }
        for article in &cluster.articles {
            validate_cluster_article(article)?;
        }
    }
    Ok(())
}

fn validate_cluster_detail(
    detail: &ClusterDetail,
    requested_cluster_id: i64,
) -> Result<(), DiscoveryError> {
    if detail.id != requested_cluster_id {
        return Err(DiscoveryError::InvalidData(
            "cluster provider returned a detail for a different cluster id".to_owned(),
        ));
    }
    ensure_positive_id(detail.id, "cluster detail id")?;
    validate_gdelt(detail.gdelt_context.as_ref())?;
    for article in &detail.articles {
        validate_cluster_article(article)?;
    }
    Ok(())
}

fn validate_story_lineage(
    lineage: &StoryLineage,
    requested_cluster_id: i64,
) -> Result<(), DiscoveryError> {
    if let Some(story) = lineage.story.as_ref() {
        ensure_positive_id(story.id, "lineage story id")?;
        ensure_positive_id(story.external_cluster_id, "lineage cluster id")?;
        if story.external_cluster_id != requested_cluster_id {
            return Err(DiscoveryError::InvalidData(
                "lineage story belongs to a different cluster id".to_owned(),
            ));
        }
        ensure_positive_id_option(story.earliest_article_id, "lineage earliest article id")?;
        validate_finite(story.confidence, "lineage story confidence")?;
    }
    for edge in &lineage.article_edges {
        ensure_positive_id_option(edge.id, "lineage article-edge id")?;
        ensure_positive_id(edge.from_article_id, "lineage source article id")?;
        ensure_positive_id(edge.to_article_id, "lineage target article id")?;
        validate_finite(edge.confidence, "lineage article-edge confidence")?;
    }
    for claim in &lineage.claims {
        ensure_positive_id_option(claim.id, "lineage claim id")?;
        ensure_positive_id(claim.article_id, "lineage claim article id")?;
    }
    for edge in &lineage.claim_edges {
        ensure_positive_id_option(edge.id, "lineage claim-edge id")?;
        ensure_positive_id(edge.from_claim_id, "lineage source claim id")?;
        ensure_positive_id(edge.to_claim_id, "lineage target claim id")?;
        validate_finite(edge.confidence, "lineage claim-edge confidence")?;
    }
    for correction in &lineage.corrections {
        ensure_positive_id(correction.id, "lineage correction id")?;
        ensure_positive_id_option(correction.article_id, "lineage correction article id")?;
        ensure_positive_id_option(correction.corrected_claim_id, "lineage corrected claim id")?;
        for article_id in &correction.downstream_article_ids {
            ensure_positive_id(*article_id, "lineage downstream article id")?;
        }
    }
    Ok(())
}
fn cache_response(mut response: Response, cache_control: &'static str) -> Response {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    response
}
fn parse_trending_query(raw_query: Option<&str>) -> Result<TrendingQuery, HttpValidationError> {
    let window = scalar_query(raw_query, "window")?.unwrap_or_else(|| "1d".to_owned());
    if !matches!(window.as_str(), "1d" | "1w" | "1m") {
        return Err(invalid_query(
            "window",
            Value::String(window),
            "string_pattern_mismatch",
            "String should match pattern '^(1d|1w|1m)$'",
            Some(Map::from_iter([(
                "pattern".to_owned(),
                Value::String("^(1d|1w|1m)$".to_owned()),
            )])),
        ));
    }
    let limit = parse_integer_query(raw_query, "limit", 10, Some(1), Some(50))?;
    Ok(TrendingQuery { window, limit })
}

fn parse_window_query(raw_query: Option<&str>) -> Result<WindowQuery, HttpValidationError> {
    let window = scalar_query(raw_query, "window")?.unwrap_or_else(|| "1d".to_owned());
    if !matches!(window.as_str(), "1d" | "1w" | "1m") {
        return Err(invalid_query(
            "window",
            Value::String(window),
            "string_pattern_mismatch",
            "String should match pattern '^(1d|1w|1m)$'",
            Some(Map::from_iter([(
                "pattern".to_owned(),
                Value::String("^(1d|1w|1m)$".to_owned()),
            )])),
        ));
    }
    Ok(WindowQuery { window })
}
