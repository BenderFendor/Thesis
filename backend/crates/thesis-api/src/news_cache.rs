use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::header::{HeaderValue, CACHE_CONTROL, VARY};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::openapi::schema::{AdditionalProperties, ArrayBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, ToSchema};

use crate::cache_stream::CacheSnapshot;
use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::source_catalog::{configured_catalog, SourceCatalogEntry};
use crate::AppState;

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 500;

fn free_form_articles_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(
            ObjectBuilder::new()
                .schema_type(Type::Object)
                .additional_properties(Some(AdditionalProperties::FreeForm(true)))
                .build(),
        )
        .build()
        .into()
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[schema(as = NewsArticle)]
pub(crate) struct CachedNewsArticleResponse {
    #[serde(default)]
    #[schema(required = false)]
    pub id: Option<i64>,
    pub title: String,
    pub link: String,
    pub description: String,
    pub published: String,
    pub source: String,
    #[serde(default)]
    #[schema(required = false)]
    pub author: Option<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub authors: Vec<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub author_urls: Vec<String>,
    #[serde(default = "general_category")]
    #[schema(required = false, default = "general")]
    pub category: String,
    #[serde(default)]
    #[schema(required = false)]
    pub country: Option<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub image: Option<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub mentioned_countries: Vec<String>,
}

fn general_category() -> String {
    "general".to_owned()
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = PaginatedResponse)]
pub(crate) struct CachedPaginatedNewsResponse {
    #[schema(schema_with = free_form_articles_schema)]
    pub articles: Vec<Value>,
    pub total: i64,
    pub limit: i64,
    pub next_cursor: Option<String>,
    pub prev_cursor: Option<String>,
    #[schema(required = false, default = false)]
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BrowseIndexResponse)]
pub(crate) struct CachedBrowseIndexResponse {
    #[schema(schema_with = free_form_articles_schema)]
    pub articles: Vec<Value>,
    pub total: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = NewsResponse)]
pub(crate) struct CachedNewsResponse {
    pub articles: Vec<CachedNewsArticleResponse>,
    pub total: i64,
    pub sources: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[schema(as = CacheDebugArticle)]
pub(crate) struct CacheDebugArticleResponse {
    #[serde(default = "general_category")]
    #[schema(required = true)]
    pub category: String,
    #[serde(default)]
    #[schema(required = false)]
    pub country: Option<String>,
    pub description: String,
    #[serde(default)]
    #[schema(required = false)]
    pub id: Option<i64>,
    #[serde(default)]
    #[schema(required = false)]
    pub image: Option<String>,
    pub link: String,
    pub published: String,
    pub source: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = CacheDebugResponse)]
pub(crate) struct CacheDebugArticlesResponse {
    pub articles: Vec<CacheDebugArticleResponse>,
    pub limit: i64,
    pub offset: i64,
    pub returned: i64,
    #[schema(required = false)]
    pub source: Option<String>,
    pub total: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[schema(as = SourceStats)]
pub(crate) struct CachedSourceStats {
    pub article_count: i64,
    #[serde(default)]
    #[schema(required = false)]
    pub bias_rating: Option<String>,
    pub category: String,
    pub country: String,
    #[serde(default)]
    #[schema(required = false)]
    pub error_message: Option<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub funding_type: Option<String>,
    #[schema(value_type = String)]
    pub last_checked: Value,
    pub name: String,
    pub status: String,
    #[schema(value_type = String)]
    pub url: Value,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceStatsList)]
pub(crate) struct CachedSourceStatsList {
    pub sources: Vec<CachedSourceStats>,
    pub total_sources: i64,
}
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct CachedPageBounds {
    #[param(required = false, minimum = 1, maximum = 500, default = 50)]
    limit: i64,
    #[param(required = false, minimum = 0, default = 0)]
    offset: i64,
}

fn query_error(field: &str, input: Value, error_type: &str, message: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: None,
        }],
    }
}

fn parse_limit(params: &HashMap<String, String>) -> Result<i64, HttpValidationError> {
    let Some(value) = params.get("limit") else {
        return Ok(DEFAULT_LIMIT);
    };
    let parsed = value.parse::<i64>().map_err(|_| {
        query_error(
            "limit",
            Value::String(value.clone()),
            "int_parsing",
            "Input should be a valid integer",
        )
    })?;
    if parsed < 1 {
        return Err(query_error(
            "limit",
            Value::String(value.clone()),
            "greater_than_equal",
            "Input should be greater than or equal to 1",
        ));
    }
    if parsed > MAX_LIMIT {
        return Err(query_error(
            "limit",
            Value::String(value.clone()),
            "less_than_equal",
            "Input should be less than or equal to 500",
        ));
    }
    Ok(parsed)
}

fn parse_offset(params: &HashMap<String, String>) -> Result<i64, HttpValidationError> {
    let Some(value) = params.get("offset") else {
        return Ok(0);
    };
    let offset = value.parse::<i64>().map_err(|_| {
        query_error(
            "offset",
            Value::String(value.clone()),
            "int_parsing",
            "Input should be a valid integer",
        )
    })?;
    if offset < 0 {
        return Err(query_error(
            "offset",
            Value::String(value.clone()),
            "greater_than_equal",
            "Input should be greater than or equal to 0",
        ));
    }
    Ok(offset)
}

fn parse_page_bounds(
    params: &HashMap<String, String>,
) -> Result<CachedPageBounds, HttpValidationError> {
    Ok(CachedPageBounds {
        limit: parse_limit(params)?,
        offset: parse_offset(params)?,
    })
}

#[utoipa::path(
    get,
    path = "/debug/cache/articles",
    operation_id = "list_cached_articles_debug_cache_articles_get",
    tag = "debug",
    summary = "List Cached Articles",
    description = "List Cached Articles.",
    params(
        CachedPageBounds,
        (
            "source" = Option<String>,
            Query,
            nullable = true,
            description = "Filter by RSS source key"
        )
    ),
    responses(
        (
            status = 200,
            description = "Successful Response",
            body = CacheDebugArticlesResponse
        ),
        (
            status = 422,
            description = "Validation Error",
            body = HttpValidationError
        )
    )
)]
pub(crate) async fn list_cached_articles_debug(
    State(state): State<AppState>,
    Query(mut params): Query<HashMap<String, String>>,
) -> Response {
    let bounds = match parse_page_bounds(&params) {
        Ok(bounds) => bounds,
        Err(error) => return error.into_response(),
    };
    let source = params.remove("source");
    let source_filter = source.as_deref().filter(|source| !source.is_empty());
    let snapshot = state.cache_stream.snapshot();
    let limit = bounds.limit as usize;
    let mut total = 0_i64;
    let mut articles = Vec::with_capacity(limit.min(snapshot.articles.len()));

    for value in &snapshot.articles {
        let article = match CacheDebugArticleResponse::deserialize(value) {
            Ok(article) => article,
            Err(_) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
                    .into_response();
            }
        };
        if source_filter.is_some_and(|expected| article.source.as_str() != expected) {
            continue;
        }
        if total >= bounds.offset && articles.len() < limit {
            articles.push(article);
        }
        total += 1;
    }

    let returned = articles.len() as i64;
    Json(CacheDebugArticlesResponse {
        articles,
        limit: bounds.limit,
        offset: bounds.offset,
        returned,
        source,
        total,
    })
    .into_response()
}

fn cached_category(params: &HashMap<String, String>) -> Option<String> {
    params
        .get("category")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"))
        .map(str::to_owned)
}

fn resolve_cached_source(candidate: &str, catalog: &[SourceCatalogEntry]) -> Option<String> {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return None;
    }
    if let Some(source) = catalog.iter().find(|source| source.name == candidate) {
        return Some(source.name.clone());
    }
    if let Some(source) = catalog
        .iter()
        .find(|source| source.name.eq_ignore_ascii_case(candidate))
    {
        return Some(source.name.clone());
    }
    if let Some(source) = catalog
        .iter()
        .find(|source| source.slug.eq_ignore_ascii_case(candidate))
    {
        return Some(source.name.clone());
    }
    Some(candidate.to_owned())
}

fn cached_sources(params: &HashMap<String, String>, catalog: &[SourceCatalogEntry]) -> Vec<String> {
    let mut selected = params
        .get("sources")
        .filter(|sources| !sources.is_empty())
        .map(|sources| {
            sources
                .split(',')
                .filter_map(|candidate| resolve_cached_source(candidate, catalog))
                .fold(Vec::new(), |mut selected, source| {
                    if !selected.contains(&source) {
                        selected.push(source);
                    }
                    selected
                })
        })
        .unwrap_or_default();
    if selected.is_empty() {
        if let Some(source) = params
            .get("source")
            .and_then(|source| resolve_cached_source(source, catalog))
        {
            selected.push(source);
        }
    }
    selected
}

fn cached_articles(
    snapshot: &CacheSnapshot,
    category: Option<&str>,
    selected_sources: &[String],
    search: Option<&str>,
) -> Result<Vec<CachedNewsArticleResponse>, ()> {
    let search = search.map(str::to_lowercase);
    let mut matched = Vec::new();
    for value in &snapshot.articles {
        let article = CachedNewsArticleResponse::deserialize(value).map_err(|_| ())?;
        let matches_category = category.is_none_or(|category| article.category == category);
        let matches_source =
            selected_sources.is_empty() || selected_sources.contains(&article.source);
        let matches_search = search.as_ref().is_none_or(|search| {
            article.title.to_lowercase().contains(search)
                || article.description.to_lowercase().contains(search)
        });
        if matches_category && matches_source && matches_search {
            matched.push(article);
        }
    }
    Ok(matched)
}

fn cached_article_page_value(article: &CachedNewsArticleResponse) -> Value {
    let mut source_id = String::with_capacity(article.source.len());
    for (index, word) in article.source.split_whitespace().enumerate() {
        if index > 0 {
            source_id.push('-');
        }
        source_id.extend(word.chars().flat_map(char::to_lowercase));
    }
    json!({
        "id": article.id,
        "article_id": article.id,
        "title": article.title,
        "source": article.source,
        "source_id": source_id,
        "country": article.country,
        "credibility": "UNKNOWN",
        "bias": "UNKNOWN",
        "summary": article.description,
        "content": Value::Null,
        "image": article.image,
        "image_url": article.image,
        "published_at": article.published,
        "category": article.category,
        "url": article.link,
        "author": article.author,
        "authors": article.authors,
        "author_urls": article.author_urls,
        "tags": Value::Null,
        "mentioned_countries": article.mentioned_countries,
        "original_language": Value::Null,
        "translated": false,
        "is_persisted": article.id.is_some(),
    })
}

fn cached_source_stats(snapshot: &CacheSnapshot) -> Result<Vec<CachedSourceStats>, ()> {
    let mut by_name = HashMap::new();
    for value in &snapshot.source_stats {
        let stats = CachedSourceStats::deserialize(value).map_err(|_| ())?;
        by_name.insert(stats.name.clone(), stats);
    }

    configured_catalog()
        .iter()
        .map(|source| {
            if let Some(stats) = by_name.remove(&source.name) {
                return Ok(stats);
            }
            Ok(CachedSourceStats {
                article_count: 0,
                bias_rating: Some(source.bias_rating.clone()),
                category: source.category.clone(),
                country: source.country.clone(),
                error_message: None,
                funding_type: Some(source.funding_type.clone()),
                last_checked: Value::Null,
                name: source.name.clone(),
                status: "pending".to_owned(),
                url: serde_json::to_value(&source.url).map_err(|_| ())?,
            })
        })
        .collect()
}

fn with_cache_headers(mut response: Response, cache_control: &'static str) -> Response {
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
    response
        .headers_mut()
        .insert(VARY, HeaderValue::from_static("Accept-Encoding"));
    response
}

#[utoipa::path(
    get,
    path = "/news/page/cached",
    operation_id = "get_cached_news_paginated_news_page_cached_get",
    params(
        CachedPageBounds,
        ("category" = Option<String>, Query, nullable = true),
        ("source" = Option<String>, Query, nullable = true),
        (
            "sources" = Option<String>,
            Query,
            nullable = true,
            description = "Comma-separated source names for multi-select"
        ),
        ("search" = Option<String>, Query, nullable = true)
    ),
    responses(
        (status = 200, description = "Successful Response", body = CachedPaginatedNewsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_cached_news_paginated(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let bounds = match parse_page_bounds(&params) {
        Ok(bounds) => bounds,
        Err(error) => return error.into_response(),
    };
    let limit = bounds.limit;
    let offset = bounds.offset;
    let selected_sources = cached_sources(&params, configured_catalog());
    let category = cached_category(&params);
    let snapshot = state.cache_stream.snapshot();
    let articles = match cached_articles(
        snapshot.as_ref(),
        category.as_deref(),
        &selected_sources,
        params.get("search").map(String::as_str),
    ) {
        Ok(articles) => articles,
        Err(()) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let total = articles.len() as i64;
    let next_offset = offset.saturating_add(limit);
    let has_more = next_offset < total;
    let next_cursor = has_more.then(|| next_offset.to_string());
    let articles = articles
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|article| cached_article_page_value(&article))
        .collect();
    Json(CachedPaginatedNewsResponse {
        articles,
        total,
        limit,
        next_cursor,
        prev_cursor: None,
        has_more,
    })
    .into_response()
}

#[utoipa::path(
    get,
    path = "/news/index/cached",
    operation_id = "get_cached_browse_index_news_index_cached_get",
    params(
        ("category" = Option<String>, Query, nullable = true),
        ("source" = Option<String>, Query, nullable = true),
        (
            "sources" = Option<String>,
            Query,
            nullable = true,
            description = "Comma-separated source names for multi-select"
        ),
        ("search" = Option<String>, Query, nullable = true)
    ),
    responses(
        (status = 200, description = "Successful Response", body = CachedBrowseIndexResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_cached_browse_index(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let selected_sources = cached_sources(&params, configured_catalog());
    let category = cached_category(&params);
    let snapshot = state.cache_stream.snapshot();
    let articles = match cached_articles(
        snapshot.as_ref(),
        category.as_deref(),
        &selected_sources,
        params.get("search").map(String::as_str),
    ) {
        Ok(articles) => articles,
        Err(()) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    with_cache_headers(
        Json(CachedBrowseIndexResponse {
            total: articles.len() as i64,
            articles: articles.iter().map(cached_article_page_value).collect(),
        })
        .into_response(),
        "public, max-age=5, stale-while-revalidate=15",
    )
}

#[utoipa::path(
    get,
    path = "/news/source/{source_name}",
    operation_id = "get_news_by_source_news_source__source_name__get",
    params(("source_name" = String, Path)),
    responses(
        (status = 200, description = "Successful Response", body = [CachedNewsArticleResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_news_by_source(
    State(state): State<AppState>,
    Path(source_name): Path<String>,
) -> Response {
    if !configured_catalog()
        .iter()
        .any(|source| source.name == source_name)
    {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"detail": "Source not found"})),
        )
            .into_response();
    }
    let snapshot = state.cache_stream.snapshot();
    let articles = match cached_articles(snapshot.as_ref(), None, &[source_name], None) {
        Ok(articles) => articles,
        Err(()) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    Json(articles).into_response()
}

#[utoipa::path(
    get,
    path = "/news/category/{category_name}",
    operation_id = "get_news_by_category_news_category__category_name__get",
    params(("category_name" = String, Path)),
    responses(
        (status = 200, description = "Successful Response", body = CachedNewsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_news_by_category(
    State(state): State<AppState>,
    Path(category_name): Path<String>,
) -> Response {
    let snapshot = state.cache_stream.snapshot();
    let articles = match cached_articles(snapshot.as_ref(), Some(&category_name), &[], None) {
        Ok(articles) => articles,
        Err(()) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let mut sources = Vec::new();
    for article in &articles {
        if !sources.contains(&article.source) {
            sources.push(article.source.clone());
        }
    }
    Json(CachedNewsResponse {
        total: articles.len() as i64,
        articles,
        sources,
    })
    .into_response()
}

#[utoipa::path(
    get,
    path = "/news/sources/stats",
    operation_id = "get_source_stats_news_sources_stats_get",
    responses(
        (status = 200, description = "Successful Response", body = CachedSourceStatsList)
    )
)]
pub(crate) async fn get_source_stats(State(state): State<AppState>) -> Response {
    let snapshot = state.cache_stream.snapshot();
    let sources = match cached_source_stats(snapshot.as_ref()) {
        Ok(sources) => sources,
        Err(()) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    if sources
        .iter()
        .any(|source| source.last_checked.as_str().is_none() || source.url.as_str().is_none())
    {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
    }

    Json(CachedSourceStatsList {
        total_sources: sources.len() as i64,
        sources,
    })
    .into_response()
}
