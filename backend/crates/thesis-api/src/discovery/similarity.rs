//! Similarity search, novelty scoring, and article-topic routes.

use std::collections::{BTreeMap, BTreeSet};

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{json, Map, Value};
use utoipa::{IntoParams, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

use super::{
    ensure_positive_id, missing_query, not_found_response, parse_integer_path_id,
    parse_integer_query, provider_error_response, scalar_query, unavailable_response,
    validate_finite, DiscoveryError, DiscoveryState, FreeFormObjectResponseSchema,
    VECTOR_STORE_UNAVAILABLE_DETAIL,
};

pub(super) fn router(state: DiscoveryState) -> Router {
    Router::new()
        .route(
            "/api/similarity/related/{article_id}",
            get(get_related_articles),
        )
        .route(
            "/api/similarity/search-suggestions",
            get(get_search_suggestions),
        )
        .route("/api/similarity/source-coverage", get(get_source_coverage))
        .route("/api/similarity/novelty-score", post(compute_novelty_score))
        .route(
            "/api/similarity/article-topics/{article_id}",
            get(get_article_topics),
        )
        .route(
            "/api/similarity/bulk-article-topics",
            post(get_bulk_article_topics),
        )
        .with_state(state)
}
/// Free-form JSON object returned by the source-coverage provider.
pub type SourceCoveragePayload = BTreeMap<String, Value>;

/// Persisted article details projected after provider ranking.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct SimilarityArticle {
    pub id: i64,
    pub title: String,
    pub source: String,
    #[serde(rename = "sourceId")]
    pub source_id: Option<String>,
    pub summary: Option<String>,
    pub image: Option<String>,
    #[serde(rename = "publishedAt")]
    pub published_at: Option<String>,
    pub category: Option<String>,
    pub url: String,
}

/// Ranked vector hit returned by the similarity provider.
#[derive(Clone, Debug, PartialEq)]
pub struct RelatedHit {
    /// Article id encoded by the Chroma row.
    pub article_id: i64,
    /// Chroma-derived similarity score.
    pub similarity_score: f64,
}

/// Vector hits and article records returned by one provider operation.
#[derive(Clone, Debug, PartialEq)]
pub struct RelatedSnapshot {
    /// Confirms that the source article existed when the provider queried SQL.
    pub source_article_id: i64,
    /// Provider-ranked hits in Chroma's original order.
    pub hits: Vec<RelatedHit>,
    /// SQL rows keyed by their persisted article ids.
    pub articles: BTreeMap<i64, SimilarityArticle>,
}

/// One response item for the related-articles endpoint.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct RelatedArticle {
    pub id: i64,
    pub title: String,
    pub source: String,
    #[serde(rename = "sourceId")]
    pub source_id: Option<String>,
    pub summary: Option<String>,
    pub image: Option<String>,
    #[serde(rename = "publishedAt")]
    pub published_at: Option<String>,
    pub category: Option<String>,
    pub url: String,
    pub similarity_score: f64,
}

/// Response for `GET /api/similarity/related/{article_id}`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct RelatedArticlesResponse {
    pub article_id: i64,
    pub related: Vec<RelatedArticle>,
    pub total: usize,
}

/// One cluster suggestion ranked against the query embedding.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct SearchSuggestion {
    pub cluster_id: i64,
    pub label: String,
    pub relevance: f64,
}

/// Response for `GET /api/similarity/search-suggestions`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct SearchSuggestionsResponse {
    pub query: String,
    pub suggestions: Vec<SearchSuggestion>,
}

/// Stored embedding row with explicit identity provenance.
#[derive(Clone, Debug, PartialEq)]
pub struct ArticleEmbedding {
    /// Persisted article id represented by this embedding row.
    pub article_id: i64,
    /// Embedding values in provider order.
    pub values: Vec<f64>,
}

/// Response for novelty scoring, including only the documented reason-specific fields.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct NoveltyResponse {
    pub article_id: i64,
    pub novelty_score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub max_similarity_to_history: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub avg_similarity_to_history: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub history_size: Option<usize>,
}

/// One topic assignment for an article.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct ArticleTopic {
    pub cluster_id: i64,
    pub label: Option<String>,
    pub similarity: Option<f64>,
    pub keywords: Vec<String>,
}

/// Response for `GET /api/similarity/article-topics/{article_id}`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct ArticleTopicsResponse {
    pub article_id: i64,
    pub topics: Vec<ArticleTopic>,
}

/// Response for `POST /api/similarity/bulk-article-topics`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
struct BulkArticleTopicsResponse {
    pub articles: BTreeMap<i64, Vec<ArticleTopic>>,
}
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct RelatedQuery {
    #[param(required = false, default = 5, maximum = 20)]
    limit: i64,
    #[param(required = false, default = true)]
    exclude_same_source: bool,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct SearchSuggestionsQuery {
    #[param(min_length = 2)]
    query: String,
    #[param(required = false, default = 5, maximum = 10)]
    limit: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct SourceCoverageQuery {
    /// Comma-separated source IDs.
    source_ids: String,
    #[param(required = false, default = 100, maximum = 500)]
    sample_size: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct NoveltyQuery {
    article_id: i64,
}

#[utoipa::path(
    get,
    path = "/api/similarity/related/{article_id}",
    operation_id = "get_related_articles_api_similarity_related__article_id__get",
    tag = "similarity",
    params(
        ("article_id" = i64, Path, description = "Article ID"),
        RelatedQuery
    ),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_related_articles(
    State(state): State<DiscoveryState>,
    Path(raw_article_id): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let article_id = match parse_integer_path_id(&raw_article_id, "article_id") {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let RelatedQuery {
        limit,
        exclude_same_source,
    } = match parse_related_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    let snapshot = match provider
        .related_articles(article_id, limit, exclude_same_source)
        .await
    {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => return not_found_response("Article not found"),
        Err(DiscoveryError::VectorStoreUnavailable) => {
            return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL)
        }
        Err(error) => return provider_error_response(error),
    };
    match project_related_response(article_id, snapshot) {
        Ok(response) => Json(response).into_response(),
        Err(error) => provider_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/api/similarity/search-suggestions",
    operation_id = "get_search_suggestions_api_similarity_search_suggestions_get",
    tag = "similarity",
    params(SearchSuggestionsQuery),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_search_suggestions(
    State(state): State<DiscoveryState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let SearchSuggestionsQuery { query, limit } =
        match parse_search_suggestions_query(raw_query.as_deref()) {
            Ok(query) => query,
            Err(error) => return error.into_response(),
        };
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    let suggestions = match provider.search_suggestions(query.clone(), limit).await {
        Ok(suggestions) => suggestions,
        Err(DiscoveryError::VectorStoreUnavailable) => {
            return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL)
        }
        Err(error) => return provider_error_response(error),
    };
    if let Some(error) = suggestions.iter().find_map(|item| {
        ensure_positive_id(item.cluster_id, "search suggestion cluster id")
            .and_then(|()| validate_finite(Some(item.relevance), "search suggestion relevance"))
            .err()
    }) {
        return provider_error_response(error);
    }
    Json(SearchSuggestionsResponse { query, suggestions }).into_response()
}

#[utoipa::path(
    get,
    path = "/api/similarity/source-coverage",
    operation_id = "get_source_coverage_api_similarity_source_coverage_get",
    tag = "similarity",
    params(SourceCoverageQuery),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_source_coverage(
    State(state): State<DiscoveryState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let SourceCoverageQuery {
        source_ids,
        sample_size,
    } = match parse_source_coverage_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let source_ids = source_ids
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if source_ids.len() < 2 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"detail": "Provide at least 2 source IDs to compare"})),
        )
            .into_response();
    }
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    let coverage = match provider.source_coverage(source_ids, sample_size).await {
        Ok(coverage) => coverage,
        Err(DiscoveryError::VectorStoreUnavailable) => {
            return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL)
        }
        Err(error) => return provider_error_response(error),
    };
    Json(coverage).into_response()
}

#[utoipa::path(
    post,
    path = "/api/similarity/novelty-score",
    operation_id = "compute_novelty_score_api_similarity_novelty_score_post",
    tag = "similarity",
    params(NoveltyQuery),
    request_body(content = Vec<i64>, content_type = "application/json"),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn compute_novelty_score(
    State(state): State<DiscoveryState>,
    RawQuery(raw_query): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let article_id = match parse_required_integer_query(raw_query.as_deref(), "article_id") {
        Ok(NoveltyQuery { article_id }) => article_id,
        Err(error) => return error.into_response(),
    };
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let history = match parse_article_id_array(&body, content_type) {
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    if history.is_empty() {
        return Json(empty_history_novelty(article_id)).into_response();
    }
    let article_rows = match provider.embeddings(vec![article_id]).await {
        Ok(rows) => rows,
        Err(DiscoveryError::VectorStoreUnavailable) => {
            return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL)
        }
        Err(error) => return provider_error_response(error),
    };
    let article_embedding = match single_embedding(article_id, article_rows) {
        Ok(Some(embedding)) => embedding,
        Ok(None) => return not_found_response("Article not in vector store"),
        Err(error) => return provider_error_response(error),
    };
    let mut seen_history_ids = BTreeSet::new();
    let requested_history = history
        .into_iter()
        .take(50)
        .filter(|article_id| seen_history_ids.insert(*article_id))
        .collect::<Vec<_>>();
    let history_rows = match provider.embeddings(requested_history.clone()).await {
        Ok(rows) => rows,
        Err(DiscoveryError::VectorStoreUnavailable) => {
            return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL)
        }
        Err(error) => return provider_error_response(error),
    };
    let ordered_history = match order_embeddings(&requested_history, history_rows) {
        Ok(rows) => rows,
        Err(error) => return provider_error_response(error),
    };
    if ordered_history.is_empty() {
        return Json(no_history_novelty(article_id)).into_response();
    }
    match compute_novelty(article_id, &article_embedding, &ordered_history) {
        Ok(response) => Json(response).into_response(),
        Err(error) => provider_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/api/similarity/article-topics/{article_id}",
    operation_id = "get_article_topics_api_similarity_article_topics__article_id__get",
    tag = "similarity",
    params(("article_id" = i64, Path, description = "Article ID")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_article_topics(
    State(state): State<DiscoveryState>,
    Path(raw_article_id): Path<String>,
) -> Response {
    let article_id = match parse_integer_path_id(&raw_article_id, "article_id") {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    match provider.article_topics(article_id).await {
        Ok(topics) => match validate_topics(&topics) {
            Ok(()) => Json(ArticleTopicsResponse { article_id, topics }).into_response(),
            Err(error) => provider_error_response(error),
        },
        Err(DiscoveryError::VectorStoreUnavailable) => Json(ArticleTopicsResponse {
            article_id,
            topics: Vec::new(),
        })
        .into_response(),
        Err(error) => provider_error_response(error),
    }
}

#[utoipa::path(
    post,
    path = "/api/similarity/bulk-article-topics",
    operation_id = "get_bulk_article_topics_api_similarity_bulk_article_topics_post",
    tag = "similarity",
    request_body(content = Vec<i64>, content_type = "application/json"),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
async fn get_bulk_article_topics(
    State(state): State<DiscoveryState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let article_ids = match parse_article_id_array(&body, content_type) {
        Ok(ids) => ids,
        Err(error) => return error.into_response(),
    };
    if article_ids.is_empty() {
        return Json(BulkArticleTopicsResponse {
            articles: BTreeMap::new(),
        })
        .into_response();
    }
    let Some(provider) = state.provider else {
        return unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL);
    };
    let mut seen_ids = BTreeSet::new();
    let unique_ids = article_ids
        .iter()
        .copied()
        .filter(|article_id| seen_ids.insert(*article_id))
        .collect::<Vec<_>>();
    let mut articles = match provider.bulk_article_topics(unique_ids.clone()).await {
        Ok(articles) => articles,
        Err(DiscoveryError::VectorStoreUnavailable) => {
            return Json(BulkArticleTopicsResponse {
                articles: BTreeMap::new(),
            })
            .into_response()
        }
        Err(error) => return provider_error_response(error),
    };
    if articles.keys().any(|id| !unique_ids.contains(id)) {
        return provider_error_response(DiscoveryError::InvalidData(
            "bulk topic provider returned an unrequested article id".to_owned(),
        ));
    }
    if let Some(error) = articles
        .values()
        .find_map(|topics| validate_topics(topics).err())
    {
        return provider_error_response(error);
    }
    for article_id in unique_ids {
        articles.entry(article_id).or_default();
    }
    Json(BulkArticleTopicsResponse { articles }).into_response()
}
fn empty_history_novelty(article_id: i64) -> NoveltyResponse {
    NoveltyResponse {
        article_id,
        novelty_score: 1.0,
        reason: Some("empty_history".to_owned()),
        max_similarity_to_history: None,
        avg_similarity_to_history: None,
        history_size: None,
    }
}

fn no_history_novelty(article_id: i64) -> NoveltyResponse {
    NoveltyResponse {
        article_id,
        novelty_score: 1.0,
        reason: Some("no_history_embeddings".to_owned()),
        max_similarity_to_history: None,
        avg_similarity_to_history: None,
        history_size: None,
    }
}

fn project_related_response(
    article_id: i64,
    snapshot: RelatedSnapshot,
) -> Result<RelatedArticlesResponse, DiscoveryError> {
    if snapshot.source_article_id != article_id {
        return Err(DiscoveryError::InvalidData(
            "related provider source article id does not match request".to_owned(),
        ));
    }
    let mut seen = BTreeSet::new();
    let mut related = Vec::with_capacity(snapshot.hits.len());
    for hit in snapshot.hits {
        if hit.article_id <= 0 {
            return Err(DiscoveryError::InvalidData(
                "related provider returned a non-positive article id".to_owned(),
            ));
        }
        if !hit.similarity_score.is_finite() {
            return Err(DiscoveryError::InvalidData(
                "related similarity scores must be finite".to_owned(),
            ));
        }
        if !seen.insert(hit.article_id) {
            return Err(DiscoveryError::InvalidData(
                "related provider returned a duplicate article id".to_owned(),
            ));
        }
        let Some(article) = snapshot.articles.get(&hit.article_id) else {
            // Python skips vector hits whose persisted article row was deleted.
            continue;
        };
        if article.id != hit.article_id {
            return Err(DiscoveryError::InvalidData(
                "related article map key does not match persisted article id".to_owned(),
            ));
        }
        related.push(RelatedArticle {
            id: article.id,
            title: article.title.clone(),
            source: article.source.clone(),
            source_id: article.source_id.clone(),
            summary: article.summary.clone(),
            image: article.image.clone(),
            published_at: article.published_at.clone(),
            category: article.category.clone(),
            url: article.url.clone(),
            similarity_score: hit.similarity_score,
        });
    }
    Ok(RelatedArticlesResponse {
        article_id,
        total: related.len(),
        related,
    })
}

fn single_embedding(
    expected_id: i64,
    rows: Vec<ArticleEmbedding>,
) -> Result<Option<Vec<f64>>, DiscoveryError> {
    if rows.iter().any(|row| row.article_id != expected_id) {
        return Err(DiscoveryError::InvalidData(
            "embedding provider returned a row for an unrequested article id".to_owned(),
        ));
    }
    if rows.len() > 1 {
        return Err(DiscoveryError::InvalidData(
            "embedding provider returned duplicate article ids".to_owned(),
        ));
    }
    rows.into_iter()
        .next()
        .map(|row| validate_embedding(row.values))
        .transpose()
}

fn order_embeddings(
    requested_ids: &[i64],
    rows: Vec<ArticleEmbedding>,
) -> Result<Vec<Vec<f64>>, DiscoveryError> {
    let positions = requested_ids
        .iter()
        .enumerate()
        .map(|(position, id)| (*id, position))
        .collect::<BTreeMap<_, _>>();
    let mut ordered = vec![None; requested_ids.len()];
    for row in rows {
        let Some(position) = positions.get(&row.article_id).copied() else {
            return Err(DiscoveryError::InvalidData(
                "embedding provider returned an unrequested article id".to_owned(),
            ));
        };
        if ordered[position].is_some() {
            return Err(DiscoveryError::InvalidData(
                "embedding provider returned duplicate article ids".to_owned(),
            ));
        }
        ordered[position] = Some(validate_embedding(row.values)?);
    }
    Ok(ordered.into_iter().flatten().collect())
}

fn validate_embedding(values: Vec<f64>) -> Result<Vec<f64>, DiscoveryError> {
    if values.is_empty() || values.iter().any(|value| !value.is_finite()) {
        return Err(DiscoveryError::InvalidData(
            "embeddings must contain finite values".to_owned(),
        ));
    }
    if values.iter().all(|value| *value == 0.0) {
        return Err(DiscoveryError::InvalidData(
            "zero-norm embeddings cannot be scored".to_owned(),
        ));
    }
    Ok(values)
}

fn compute_novelty(
    article_id: i64,
    article: &[f64],
    history: &[Vec<f64>],
) -> Result<NoveltyResponse, DiscoveryError> {
    let article_norm = article
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    if !article_norm.is_finite() || article_norm == 0.0 {
        return Err(DiscoveryError::InvalidData(
            "article embedding norm must be finite and nonzero".to_owned(),
        ));
    }
    let mut similarities = Vec::with_capacity(history.len());
    for embedding in history {
        if embedding.len() != article.len() {
            return Err(DiscoveryError::InvalidData(
                "article and history embeddings have different dimensions".to_owned(),
            ));
        }
        let norm = embedding
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt();
        if !norm.is_finite() || norm == 0.0 {
            return Err(DiscoveryError::InvalidData(
                "history embedding norm must be finite and nonzero".to_owned(),
            ));
        }
        let dot = embedding
            .iter()
            .zip(article)
            .map(|(left, right)| left * right)
            .sum::<f64>();
        let similarity = (dot / (norm * article_norm)).clamp(-1.0, 1.0);
        if !similarity.is_finite() {
            return Err(DiscoveryError::InvalidData(
                "cosine similarity must be finite".to_owned(),
            ));
        }
        similarities.push(similarity);
    }
    if similarities.is_empty() {
        return Ok(no_history_novelty(article_id));
    }
    let max_similarity = similarities
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let average_similarity = similarities.iter().sum::<f64>() / similarities.len() as f64;
    Ok(NoveltyResponse {
        article_id,
        novelty_score: round_three(1.0 - max_similarity),
        reason: None,
        max_similarity_to_history: Some(round_three(max_similarity)),
        avg_similarity_to_history: Some(round_three(average_similarity)),
        history_size: Some(similarities.len()),
    })
}

fn round_three(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}
fn validate_topics(topics: &[ArticleTopic]) -> Result<(), DiscoveryError> {
    for topic in topics {
        ensure_positive_id(topic.cluster_id, "topic cluster id")?;
        validate_finite(topic.similarity, "topic similarity")?;
    }
    Ok(())
}
fn parse_related_query(raw_query: Option<&str>) -> Result<RelatedQuery, HttpValidationError> {
    let limit = parse_integer_query(raw_query, "limit", 5, None, Some(20))?;
    let exclude_same_source = match scalar_query(raw_query, "exclude_same_source")? {
        None => true,
        Some(value) => parse_bool(&value).ok_or_else(|| {
            invalid_query(
                "exclude_same_source",
                Value::String(value),
                "bool_parsing",
                "Input should be a valid boolean, unable to interpret input",
                None,
            )
        })?,
    };
    Ok(RelatedQuery {
        limit,
        exclude_same_source,
    })
}

fn parse_search_suggestions_query(
    raw_query: Option<&str>,
) -> Result<SearchSuggestionsQuery, HttpValidationError> {
    let Some(query) = scalar_query(raw_query, "query")? else {
        return Err(missing_query("query"));
    };
    if query.chars().count() < 2 {
        return Err(invalid_query(
            "query",
            Value::String(query),
            "string_too_short",
            "String should have at least 2 characters",
            Some(Map::from_iter([("min_length".to_owned(), Value::from(2))])),
        ));
    }
    let limit = parse_integer_query(raw_query, "limit", 5, None, Some(10))?;
    Ok(SearchSuggestionsQuery { query, limit })
}

fn parse_source_coverage_query(
    raw_query: Option<&str>,
) -> Result<SourceCoverageQuery, HttpValidationError> {
    let Some(source_ids) = scalar_query(raw_query, "source_ids")? else {
        return Err(missing_query("source_ids"));
    };
    let sample_size = parse_integer_query(raw_query, "sample_size", 100, None, Some(500))?;
    Ok(SourceCoverageQuery {
        source_ids,
        sample_size,
    })
}

fn parse_required_integer_query(
    raw_query: Option<&str>,
    field: &str,
) -> Result<NoveltyQuery, HttpValidationError> {
    let Some(raw) = scalar_query(raw_query, field)? else {
        return Err(missing_query(field));
    };
    let article_id = raw.trim().parse::<i64>().map_err(|_| {
        invalid_query(
            field,
            Value::String(raw),
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
            None,
        )
    })?;
    Ok(NoveltyQuery { article_id })
}
fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "t" | "yes" | "y" | "on" => Some(true),
        "0" | "false" | "f" | "no" | "n" | "off" => Some(false),
        _ => None,
    }
}
fn parse_article_id_array(
    body: &[u8],
    content_type: Option<&str>,
) -> Result<Vec<i64>, HttpValidationError> {
    if body.is_empty() {
        return Err(HttpValidationError::body(
            Value::Null,
            "missing",
            "Field required",
        ));
    }
    if !content_type.is_some_and(is_json_content_type) {
        return Err(HttpValidationError::body(
            Value::String(String::from_utf8_lossy(body).into_owned()),
            "list_type",
            "Input should be a valid list",
        ));
    }
    let value: Value = serde_json::from_slice(body).map_err(|error| HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![ValidationLocation::Text("body".to_owned())],
            msg: "JSON decode error".to_owned(),
            error_type: "json_invalid".to_owned(),
            input: Value::Null,
            ctx: Some(Map::from_iter([(
                "error".to_owned(),
                Value::String(error.to_string()),
            )])),
        }],
    })?;
    let Some(items) = value.as_array() else {
        return Err(HttpValidationError::body(
            value,
            "list_type",
            "Input should be a valid list",
        ));
    };

    let mut article_ids = Vec::with_capacity(items.len());
    let mut errors = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if let Some(article_id) = parse_article_id_value(item) {
            article_ids.push(article_id);
        } else {
            let (error_type, message) = article_id_parse_error(item);
            errors.push(ValidationError {
                loc: vec![
                    ValidationLocation::Text("body".to_owned()),
                    ValidationLocation::Index(index as i64),
                ],
                msg: message.to_owned(),
                error_type: error_type.to_owned(),
                input: item.clone(),
                ctx: None,
            });
        }
    }
    if errors.is_empty() {
        Ok(article_ids)
    } else {
        Err(HttpValidationError { detail: errors })
    }
}

fn is_json_content_type(content_type: &str) -> bool {
    let media_type = content_type.split(';').next().unwrap_or_default().trim();
    let Some((main_type, subtype)) = media_type.split_once('/') else {
        return false;
    };
    let subtype = subtype.trim();
    main_type.trim().eq_ignore_ascii_case("application")
        && (subtype.eq_ignore_ascii_case("json")
            || subtype
                .get(subtype.len().saturating_sub(5)..)
                .is_some_and(|suffix| suffix.eq_ignore_ascii_case("+json")))
}
fn parse_article_id_value(value: &Value) -> Option<i64> {
    if let Some(boolean) = value.as_bool() {
        return Some(if boolean { 1 } else { 0 });
    }

    if let Some(article_id) = value.as_i64() {
        return Some(article_id);
    }
    if let Some(article_id) = value.as_u64() {
        return i64::try_from(article_id).ok();
    }
    if let Some(raw) = value.as_str() {
        return raw.trim().parse().ok();
    }
    let article_id = value.as_f64()?;
    (article_id.is_finite()
        && article_id.fract() == 0.0
        && article_id >= i64::MIN as f64
        && article_id < -(i64::MIN as f64))
        .then_some(article_id as i64)
}

fn article_id_parse_error(value: &Value) -> (&'static str, &'static str) {
    match value {
        Value::Number(number)
            if number
                .as_f64()
                .is_some_and(|value| value.is_finite() && value.fract() != 0.0) =>
        {
            (
                "int_from_float",
                "Input should be a valid integer, got a number with a fractional part",
            )
        }
        Value::String(_) => (
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
        ),
        Value::Number(_) => ("int_parsing_size", "Unable to parse input as an integer"),
        _ => ("int_type", "Input should be a valid integer"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_novelty, order_embeddings, project_related_response, ArticleEmbedding,
        RelatedArticle, RelatedHit, RelatedSnapshot, SimilarityArticle,
    };
    use std::collections::BTreeMap;

    fn embedding(article_id: i64, values: &[f64]) -> ArticleEmbedding {
        ArticleEmbedding {
            article_id,
            values: values.to_vec(),
        }
    }

    #[test]
    fn history_rows_are_joined_by_identity_then_restored_to_request_order() {
        let ordered = order_embeddings(
            &[11, 22],
            vec![embedding(22, &[0.0, 1.0]), embedding(11, &[1.0, 0.0])],
        )
        .expect("valid shuffled provider rows");
        let response = compute_novelty(7, &[1.0, 0.0], &ordered).expect("finite novelty");
        assert_eq!(response.history_size, Some(2));
        assert_eq!(response.max_similarity_to_history, Some(1.0));
        assert_eq!(response.avg_similarity_to_history, Some(0.5));
    }

    #[test]
    fn novelty_rejects_unrequested_duplicate_zero_norm_and_non_finite_rows() {
        assert!(order_embeddings(&[11], vec![embedding(22, &[1.0])]).is_err());
        assert!(order_embeddings(
            &[11],
            vec![embedding(11, &[1.0]), embedding(11, &[0.0, 1.0])]
        )
        .is_err());
        assert!(order_embeddings(&[11], vec![embedding(11, &[0.0, 0.0])]).is_err());
        assert!(order_embeddings(&[11], vec![embedding(11, &[f64::NAN])]).is_err());
        assert!(compute_novelty(7, &[1.0], &[vec![1.0, 2.0]]).is_err());
    }

    #[test]
    fn related_projection_keeps_provider_order_and_skips_deleted_articles() {
        let response = project_related_response(
            9,
            RelatedSnapshot {
                source_article_id: 9,
                hits: vec![
                    RelatedHit {
                        article_id: 2,
                        similarity_score: 0.8,
                    },
                    RelatedHit {
                        article_id: 3,
                        similarity_score: 0.7,
                    },
                    RelatedHit {
                        article_id: 1,
                        similarity_score: 0.6,
                    },
                ],
                articles: BTreeMap::from([
                    (
                        1,
                        SimilarityArticle {
                            id: 1,
                            title: "One".to_owned(),
                            source: "S".to_owned(),
                            source_id: None,
                            summary: None,
                            image: None,
                            published_at: None,
                            category: None,
                            url: "u1".to_owned(),
                        },
                    ),
                    (
                        2,
                        SimilarityArticle {
                            id: 2,
                            title: "Two".to_owned(),
                            source: "S".to_owned(),
                            source_id: None,
                            summary: None,
                            image: None,
                            published_at: None,
                            category: None,
                            url: "u2".to_owned(),
                        },
                    ),
                ]),
            },
        )
        .expect("valid identities");
        assert_eq!(response.total, 2);
        assert_eq!(
            response
                .related
                .iter()
                .map(|item: &RelatedArticle| item.id)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    #[test]
    fn related_projection_rejects_identity_mismatch_and_non_finite_scores() {
        let article = SimilarityArticle {
            id: 1,
            title: "One".to_owned(),
            source: "S".to_owned(),
            source_id: None,
            summary: None,
            image: None,
            published_at: None,
            category: None,
            url: "u1".to_owned(),
        };
        let mut articles = BTreeMap::new();
        articles.insert(1, article);
        assert!(project_related_response(
            9,
            RelatedSnapshot {
                source_article_id: 8,
                hits: Vec::new(),
                articles: articles.clone(),
            }
        )
        .is_err());
        assert!(project_related_response(
            9,
            RelatedSnapshot {
                source_article_id: 9,
                hits: vec![RelatedHit {
                    article_id: 1,
                    similarity_score: f64::INFINITY
                }],
                articles,
            }
        )
        .is_err());
    }
}
