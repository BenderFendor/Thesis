use std::collections::{BTreeMap, HashMap};

use axum::extract::{Query, State};
use axum::http::header::{HeaderValue, CACHE_CONTROL, VARY};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use thesis_db::{
    NewsArticleRecord, NewsCursor, NewsFilter, NewsIndexRequest, NewsPageRequest, NewsSortOrder,
    RecentNewsRequest,
};
use utoipa::openapi::schema::{
    AdditionalProperties, AnyOfBuilder, ArrayBuilder, ObjectBuilder, Type,
};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

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

fn free_form_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

fn optional_free_form_object_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(free_form_object_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 500;

/// The persisted article response deliberately keeps the aliases consumed by
/// existing frontend clients while giving required fields explicit Rust types.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = PersistedNewsArticle)]
pub(super) struct NewsArticleResponse {
    pub id: i64,
    pub title: String,
    pub link: String,
    pub description: String,
    pub published: String,
    pub source: String,
    pub author: Option<String>,
    pub authors: Vec<String>,
    pub author_urls: Vec<String>,
    #[schema(required = false, default = "general")]
    pub category: String,
    pub country: Option<String>,
    pub image: Option<String>,
    pub mentioned_countries: Vec<String>,
    pub source_id: Option<String>,
    pub credibility: Option<String>,
    pub bias: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub image_url: Option<String>,
    pub published_at: String,
    pub url: String,
    pub tags: Vec<String>,
    pub original_language: Option<String>,
    pub translated: bool,
    pub chroma_id: Option<String>,
    pub embedding_generated: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub source_country: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = PaginatedResponse)]
pub(super) struct PaginatedNewsResponse {
    #[schema(schema_with = free_form_articles_schema)]
    pub articles: Vec<NewsArticleResponse>,
    pub total: i64,
    pub limit: i64,
    pub next_cursor: Option<String>,
    pub prev_cursor: Option<String>,
    #[schema(required = false, default = false)]
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = BrowseIndexResponse)]
pub(super) struct BrowseIndexNewsResponse {
    #[schema(schema_with = free_form_articles_schema)]
    pub articles: Vec<NewsArticleResponse>,
    pub total: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = RecentPageResponse)]
pub(super) struct RecentNewsResponse {
    #[schema(schema_with = free_form_articles_schema)]
    pub articles: Vec<NewsArticleResponse>,
    pub limit: i64,
    pub next_cursor: Option<String>,
    #[schema(required = false, default = false)]
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceInfo)]
pub(super) struct NewsSourceResponse {
    pub id: Option<String>,
    pub slug: Option<String>,
    pub name: String,
    pub url: String,
    pub category: String,
    #[schema(required = false, default = "US")]
    pub country: String,
    pub funding_type: Option<String>,
    pub source_type: Option<String>,
    #[schema(required = false, default = false)]
    pub is_paywalled: bool,
    pub bias_rating: Option<String>,
    pub ownership_label: Option<String>,
    pub factual_rating: Option<String>,
    pub credibility_score: Option<f64>,
    #[schema(required = false, schema_with = optional_free_form_object_schema)]
    pub extra: Option<BTreeMap<String, Value>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(super) struct CategoriesResponse {
    pub categories: Vec<String>,
}

/// OpenAPI marker matching FastAPI's `dict[str, list[str]]` response schema.
#[derive(Debug)]
pub(super) struct CategoriesMapSchema;

impl PartialSchema for CategoriesMapSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ArrayBuilder::new().items(String::schema())))
            .build()
            .into()
    }
}

impl ToSchema for CategoriesMapSchema {}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct NewsPageParameters {
    #[param(required = false, minimum = 1, maximum = 500, default = 50)]
    limit: Option<i64>,
    #[param(required = false, nullable = true)]
    cursor: Option<String>,
    #[param(required = false, nullable = true)]
    category: Option<String>,
    #[param(required = false, nullable = true)]
    source: Option<String>,
    #[param(required = false, nullable = true)]
    sources: Option<String>,
    #[param(required = false, nullable = true)]
    search: Option<String>,
    #[param(required = false, default = "desc")]
    sort_order: Option<String>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct RecentNewsParameters {
    #[param(required = false, minimum = 1, maximum = 500, default = 50)]
    limit: Option<i64>,
    #[param(required = false, nullable = true)]
    cursor: Option<String>,
    #[param(required = false, nullable = true)]
    category: Option<String>,
    #[param(required = false, nullable = true)]
    source: Option<String>,
}

#[derive(Clone, Debug)]
struct ParsedBrowseQuery {
    limit: i64,
    cursor: Option<NewsCursor>,
    filter: NewsFilter,
    sort_order: NewsSortOrder,
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

fn query_string(params: &HashMap<String, String>, field: &str) -> Option<String> {
    params
        .get(field)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
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

fn normalize_category(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.eq_ignore_ascii_case("all"))
}

fn parse_sources(params: &HashMap<String, String>) -> Vec<String> {
    if let Some(values) = params.get("sources") {
        let selected = values
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .fold(Vec::new(), |mut selected, value| {
                if !selected.iter().any(|existing| existing == &value) {
                    selected.push(value);
                }
                selected
            });
        if !selected.is_empty() {
            return selected;
        }
    }
    query_string(params, "source").into_iter().collect()
}

fn parse_sort_order(
    params: &HashMap<String, String>,
) -> Result<NewsSortOrder, HttpValidationError> {
    let raw = params
        .get("sort_order")
        .map(String::as_str)
        .unwrap_or("desc");
    match raw {
        "asc" => Ok(NewsSortOrder::Asc),
        "desc" => Ok(NewsSortOrder::Desc),
        _ => Err(query_error(
            "sort_order",
            Value::String(raw.to_owned()),
            "literal_error",
            "Input should be 'asc' or 'desc'",
        )),
    }
}

fn parse_browse_query(
    params: &HashMap<String, String>,
    include_pagination: bool,
    include_search: bool,
) -> Result<ParsedBrowseQuery, HttpValidationError> {
    let limit = if include_pagination {
        parse_limit(params)?
    } else {
        DEFAULT_LIMIT
    };
    let cursor = if include_pagination {
        match query_string(params, "cursor") {
            Some(raw) => Some(decode_cursor(&raw).map_err(|message| {
                query_error("cursor", Value::String(raw), "value_error", &message)
            })?),
            None => None,
        }
    } else {
        None
    };
    let search = if include_search {
        query_string(params, "search")
            .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
    } else {
        None
    };
    Ok(ParsedBrowseQuery {
        limit,
        cursor,
        filter: NewsFilter {
            category: normalize_category(query_string(params, "category")),
            sources: parse_sources(params),
            search,
        },
        sort_order: if include_pagination {
            parse_sort_order(params)?
        } else {
            NewsSortOrder::Desc
        },
    })
}

fn timestamp(value: &DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::AutoSi, false)
}

fn description(article: &NewsArticleRecord) -> String {
    article
        .summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            article
                .content
                .as_deref()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_default()
        .to_owned()
}

fn article_response(article: NewsArticleRecord) -> NewsArticleResponse {
    let published = timestamp(&article.published_at);
    let article_description = description(&article);
    NewsArticleResponse {
        id: article.id,
        title: article.title,
        link: article.url.clone(),
        description: article_description,
        published: published.clone(),
        source: article.source,
        author: article.author,
        authors: article.authors,
        author_urls: article.author_urls,
        category: article.category,
        country: article.country.clone(),
        image: article.image_url.clone(),
        mentioned_countries: article.mentioned_countries,
        source_id: article.source_id,
        credibility: article.credibility,
        bias: article.bias,
        summary: article.summary,
        content: article.content,
        image_url: article.image_url,
        published_at: published,
        url: article.url,
        tags: article.tags,
        original_language: article.original_language,
        translated: article.translated,
        chroma_id: article.chroma_id,
        embedding_generated: article.embedding_generated,
        created_at: article.created_at.as_ref().map(timestamp),
        updated_at: article.updated_at.as_ref().map(timestamp),
        source_country: article.country,
    }
}

fn slug(value: &str) -> String {
    value
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join("-")
}

fn source_url(domain: Option<&str>) -> String {
    let Some(domain) = domain.map(str::trim).filter(|value| !value.is_empty()) else {
        return String::new();
    };
    if domain.starts_with("http://") || domain.starts_with("https://") {
        domain.to_owned()
    } else {
        format!("https://{domain}")
    }
}

fn source_response(source: thesis_db::NewsSourceRecord) -> NewsSourceResponse {
    let source_slug = slug(&source.name);
    NewsSourceResponse {
        id: Some(source_slug.clone()),
        slug: Some(source_slug),
        name: source.name,
        url: source_url(source.domain.as_deref()),
        category: source.category,
        country: source.country,
        funding_type: source.funding_type,
        source_type: source.source_type,
        is_paywalled: source.is_paywalled,
        bias_rating: source.bias_rating,
        ownership_label: source.ownership_label,
        factual_rating: source.factual_rating,
        credibility_score: source.credibility_score,
        extra: None,
    }
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

fn encode_cursor(cursor: &NewsCursor) -> String {
    let payload = json!({
        "published_at": timestamp(&cursor.published_at),
        "id": cursor.article_id,
        "search_rank": cursor.search_rank,
    });
    encode_base64(&serde_json::to_vec(&payload).expect("cursor JSON is serializable"))
}

fn decode_cursor(raw: &str) -> Result<NewsCursor, String> {
    let bytes = decode_base64(raw).ok_or_else(|| "Invalid cursor encoding".to_owned())?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid cursor JSON".to_owned())?;
    let object = value
        .as_object()
        .ok_or_else(|| "Cursor must be a JSON object".to_owned())?;
    let published_at = object
        .get("published_at")
        .and_then(Value::as_str)
        .ok_or_else(|| "Cursor is missing published_at".to_owned())?;
    let published_at = parse_timestamp(published_at)
        .ok_or_else(|| "Cursor published_at must be an RFC 3339 timestamp".to_owned())?;
    let article_id = object
        .get("id")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| "Cursor id must be a positive integer".to_owned())?;
    let search_rank = match object.get("search_rank") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let rank = value
                .as_f64()
                .filter(|rank| rank.is_finite())
                .ok_or_else(|| "Cursor search_rank must be finite".to_owned())?;
            Some(rank)
        }
    };
    Ok(NewsCursor {
        published_at,
        article_id,
        search_rank,
    })
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"]
                .iter()
                .find_map(|format| {
                    NaiveDateTime::parse_from_str(value, format)
                        .ok()
                        .map(|parsed| Utc.from_utc_datetime(&parsed))
                })
        })
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0] as usize;
        output.push(ALPHABET[first >> 2] as char);
        let second = if chunk.len() > 1 {
            chunk[1] as usize
        } else {
            0
        };
        output.push(ALPHABET[((first & 0x03) << 4) | (second >> 4)] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[((second & 0x0f) << 2) | (chunk[2] as usize >> 6)] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[chunk[2] as usize & 0x3f] as char);
        } else {
            output.push('=');
        }
    }
    output
}

fn decode_base64(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.len() % 4 == 1 {
        return None;
    }
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut padding = false;
    for byte in value.bytes() {
        if byte == b'=' {
            padding = true;
            continue;
        }
        if padding {
            return None;
        }
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        } as u32;
        buffer = (buffer << 6) | digit;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            if bits > 0 {
                buffer &= (1 << bits) - 1;
            } else {
                buffer = 0;
            }
        }
    }
    Some(output)
}

#[utoipa::path(
    get,
    path = "/news/page",
    operation_id = "get_news_paginated_news_page_get",
    params(NewsPageParameters),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedNewsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_news_paginated(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let parsed = match parse_browse_query(&params, true, true) {
        Ok(parsed) => parsed,
        Err(error) => return error.into_response(),
    };
    let result = state
        .database
        .list_news_page(NewsPageRequest {
            limit: parsed.limit,
            cursor: parsed.cursor,
            filter: parsed.filter,
            sort_order: parsed.sort_order,
        })
        .await;
    match result {
        Ok(page) => with_cache_headers(
            Json(PaginatedNewsResponse {
                articles: page.articles.into_iter().map(article_response).collect(),
                total: page.total,
                limit: parsed.limit,
                next_cursor: page.next_cursor.as_ref().map(encode_cursor),
                prev_cursor: None,
                has_more: page.has_more,
            })
            .into_response(),
            "public, max-age=30, stale-while-revalidate=60",
        ),
        Err(error) => {
            tracing::error!(%error, "persisted news page query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/news/index",
    operation_id = "get_browse_index_news_index_get",
    params(
        ("category" = Option<String>, Query, nullable = true),
        ("source" = Option<String>, Query, nullable = true),
        ("sources" = Option<String>, Query, nullable = true),
        ("search" = Option<String>, Query, nullable = true)
    ),
    responses(
        (status = 200, description = "Successful Response", body = BrowseIndexNewsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_browse_index(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let parsed = match parse_browse_query(&params, false, true) {
        Ok(parsed) => parsed,
        Err(error) => return error.into_response(),
    };
    match state
        .database
        .list_news_index(NewsIndexRequest {
            filter: parsed.filter,
        })
        .await
    {
        Ok(articles) => with_cache_headers(
            Json(BrowseIndexNewsResponse {
                total: articles.len() as i64,
                articles: articles.into_iter().map(article_response).collect(),
            })
            .into_response(),
            "public, max-age=30, stale-while-revalidate=60",
        ),
        Err(error) => {
            tracing::error!(%error, "persisted news index query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/news/recent",
    operation_id = "get_recent_news_news_recent_get",
    params(RecentNewsParameters),
    responses(
        (status = 200, description = "Successful Response", body = RecentNewsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_recent_news(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let parsed = match parse_browse_query(&params, true, false) {
        Ok(parsed) => parsed,
        Err(error) => return error.into_response(),
    };
    let source = parsed.filter.sources.first().cloned();
    match state
        .database
        .list_recent_news(RecentNewsRequest {
            limit: parsed.limit,
            cursor: parsed.cursor,
            category: parsed.filter.category,
            source,
        })
        .await
    {
        Ok(page) => Json(RecentNewsResponse {
            articles: page.articles.into_iter().map(article_response).collect(),
            limit: parsed.limit,
            next_cursor: page.next_cursor.as_ref().map(encode_cursor),
            has_more: page.has_more,
        })
        .into_response(),
        Err(error) => {
            tracing::error!(%error, "persisted recent news query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/news/sources",
    operation_id = "get_sources_news_sources_get",
    responses(
        (status = 200, description = "Successful Response", body = [NewsSourceResponse])
    )
)]
pub(crate) async fn get_sources(State(state): State<AppState>) -> Response {
    match state.database.list_news_sources().await {
        Ok(sources) => {
            Json(sources.into_iter().map(source_response).collect::<Vec<_>>()).into_response()
        }
        Err(error) => {
            tracing::error!(%error, "persisted news sources query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/news/categories",
    operation_id = "get_categories_news_categories_get",
    responses(
        (status = 200, description = "Successful Response", body = inline(CategoriesMapSchema))
    )
)]
pub(crate) async fn get_categories(State(state): State<AppState>) -> Response {
    match state.database.list_news_categories().await {
        Ok(categories) => Json(CategoriesResponse { categories }).into_response(),
        Err(error) => {
            tracing::error!(%error, "persisted news categories query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}
