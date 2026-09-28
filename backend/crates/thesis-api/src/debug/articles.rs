use std::collections::{BTreeSet, HashMap, HashSet};
use std::num::NonZeroUsize;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use serde::Serialize;
use serde_json::{json, Value};
use thesis_db::DebugArticleRequest;
use utoipa::{IntoParams, ToSchema};

use crate::chroma::{ChromaGetRequest, ChromaInclude};
use crate::models::HttpValidationError;

use super::{
    debug_query_error, parse_integer_query, provider_unavailable, query_validation_response,
    DebugState,
};

pub(super) fn router(state: DebugState) -> Router {
    Router::new()
        .route("/debug/chromadb/articles", get(list_chromadb_articles))
        .route("/debug/cache/delta", get(get_cache_db_delta))
        .route("/debug/storage/drift", get(get_storage_drift))
        .with_state(state)
}

#[derive(Clone, Debug, IntoParams)]
struct ChromaArticlesQuery {
    #[param(minimum = 1, maximum = 500, example = 50)]
    limit: Option<i64>,
    #[param(minimum = 0, example = 0)]
    offset: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/debug/chromadb/articles",
    operation_id = "list_chromadb_articles_debug_chromadb_articles_get",
    tag = "debug",
    params(ChromaArticlesQuery),
    responses(
        (status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 503, description = "Vector store unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn list_chromadb_articles(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = match parse_integer_query(&params, "limit", 50, 1, 500) {
        Ok(limit) => limit as usize,
        Err(error) => return query_validation_response(error),
    };
    let offset = match parse_integer_query(&params, "offset", 0, 0, i64::MAX) {
        Ok(offset) => offset as usize,
        Err(error) => return query_validation_response(error),
    };
    let Some(chroma) = state.providers.chroma.as_ref() else {
        return provider_unavailable("Vector store unavailable");
    };
    let collection = match chroma.get_collection().await {
        Ok(collection) => collection,
        Err(error) => {
            tracing::error!(%error, "failed to resolve debug Chroma collection");
            return chroma_failed();
        }
    };
    let total = match collection.count().await {
        Ok(total) => total,
        Err(error) => {
            tracing::error!(%error, "failed to count debug Chroma articles");
            return chroma_failed();
        }
    };
    let page = match collection
        .get(ChromaGetRequest {
            limit: Some(limit),
            offset: Some(offset),
            include: vec![ChromaInclude::Metadatas, ChromaInclude::Documents],
            ..ChromaGetRequest::default()
        })
        .await
    {
        Ok(page) => page,
        Err(error) => {
            tracing::error!(%error, "failed to read debug Chroma articles");
            return chroma_failed();
        }
    };
    let mut metadatas = page.metadatas.map(Vec::into_iter);
    let mut documents = page.documents.map(Vec::into_iter);
    let articles = page
        .ids
        .into_iter()
        .map(|chroma_id| {
            let metadata = match metadatas.as_mut().and_then(|items| items.next()) {
                Some(Some(metadata)) => Value::Object(metadata),
                Some(None) => Value::Null,
                None => json!({}),
            };
            let preview = match documents.as_mut().and_then(|items| items.next()) {
                Some(Some(document)) => document.chars().take(200).collect::<String>(),
                Some(None) => "None".to_owned(),
                None => String::new(),
            };
            json!({"id": chroma_id, "metadata": metadata, "preview": preview})
        })
        .collect::<Vec<_>>();
    Json(json!({
        "limit": limit,
        "offset": offset,
        "returned": articles.len(),
        "total": total,
        "articles": articles
    }))
    .into_response()
}

fn chroma_failed() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"detail": "Vector store request failed"})),
    )
        .into_response()
}

#[derive(Clone, Debug, IntoParams)]
struct DatabaseArticlesQuery {
    #[param(
        required = false,
        minimum = 1,
        maximum = 200,
        default = 50,
        example = 50
    )]
    limit: Option<i64>,
    #[param(required = false, minimum = 0, default = 0, example = 0)]
    offset: Option<i64>,
    /// Filter by RSS source key.
    #[param(required = false, nullable = true)]
    source: Option<String>,
    /// Return only articles without generated embeddings.
    #[param(required = false, default = false)]
    missing_embeddings_only: Option<bool>,
    /// Sort by publication date (`asc` or `desc`).
    #[param(required = false, default = "desc")]
    sort_direction: Option<String>,
    /// Include articles published at or before this timestamp.
    #[param(required = false, nullable = true)]
    published_before: Option<DateTime<chrono::FixedOffset>>,
    /// Include articles published at or after this timestamp.
    #[param(required = false, nullable = true)]
    published_after: Option<DateTime<chrono::FixedOffset>>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = DatabaseDebugArticle)]
struct DatabaseDebugArticleResponse {
    id: i64,
    title: String,
    source: String,
    url: String,
    #[schema(required = false)]
    chroma_id: Option<String>,
    #[schema(required = false)]
    content: Option<String>,
    #[schema(required = false)]
    image_url: Option<String>,
    #[schema(required = false)]
    published_at: Option<String>,
    #[schema(required = false)]
    summary: Option<String>,
    #[schema(required = false)]
    embedding_generated: Option<bool>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = DatabaseDebugResponse)]
struct DatabaseDebugArticlesResponse {
    articles: Vec<DatabaseDebugArticleResponse>,
    limit: i64,
    offset: i64,
    #[schema(required = false)]
    source: Option<String>,
    missing_embeddings_only: bool,
    sort_direction: String,
    #[schema(required = false)]
    published_before: Option<String>,
    #[schema(required = false)]
    published_after: Option<String>,
    total: i64,
    returned: i64,
    #[schema(required = false)]
    oldest_published: Option<String>,
    #[schema(required = false)]
    newest_published: Option<String>,
}

struct ParsedDateBound {
    sql: NaiveDateTime,
    echo: String,
}

fn parse_bool_query(
    params: &HashMap<String, String>,
    field: &str,
    default: bool,
) -> Result<bool, HttpValidationError> {
    let Some(raw) = params.get(field) else {
        return Ok(default);
    };
    if raw == "1"
        || raw.eq_ignore_ascii_case("true")
        || raw.eq_ignore_ascii_case("t")
        || raw.eq_ignore_ascii_case("yes")
        || raw.eq_ignore_ascii_case("y")
        || raw.eq_ignore_ascii_case("on")
    {
        Ok(true)
    } else if raw == "0"
        || raw.eq_ignore_ascii_case("false")
        || raw.eq_ignore_ascii_case("f")
        || raw.eq_ignore_ascii_case("no")
        || raw.eq_ignore_ascii_case("n")
        || raw.eq_ignore_ascii_case("off")
    {
        Ok(false)
    } else {
        Err(debug_query_error(
            field,
            raw,
            "bool_parsing",
            "Input should be a valid boolean",
            None,
            None,
        ))
    }
}

fn parse_date_bound(
    params: &HashMap<String, String>,
    field: &str,
) -> Result<Option<ParsedDateBound>, HttpValidationError> {
    let Some(raw) = params.get(field) else {
        return Ok(None);
    };
    if let Some(aware) = parse_aware_datetime(raw) {
        return Ok(Some(ParsedDateBound {
            sql: aware.naive_utc(),
            echo: format_datetime_with_offset(aware),
        }));
    }
    let naive = [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H",
        "%Y-%m-%d %H",
    ]
    .into_iter()
    .find_map(|format| NaiveDateTime::parse_from_str(raw, format).ok())
    .or_else(|| {
        NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .ok()
            .and_then(|date| date.and_hms_opt(0, 0, 0))
    })
    .ok_or_else(|| {
        debug_query_error(
            field,
            raw,
            "datetime_parsing",
            "Input should be a valid datetime",
            None,
            None,
        )
    })?;
    Ok(Some(ParsedDateBound {
        echo: format_naive_datetime(naive),
        sql: naive,
    }))
}
fn parse_aware_datetime(raw: &str) -> Option<DateTime<chrono::FixedOffset>> {
    DateTime::parse_from_rfc3339(raw).ok().or_else(|| {
        [
            "%Y-%m-%dT%H:%M:%S%.f%:z",
            "%Y-%m-%d %H:%M:%S%.f%:z",
            "%Y-%m-%dT%H:%M%:z",
            "%Y-%m-%d %H:%M%:z",
            "%Y-%m-%dT%H%:z",
            "%Y-%m-%d %H%:z",
            "%Y-%m-%dT%H:%M:%S%.f%z",
            "%Y-%m-%d %H:%M:%S%.f%z",
            "%Y-%m-%dT%H:%M%z",
            "%Y-%m-%d %H:%M%z",
            "%Y-%m-%dT%H%z",
            "%Y-%m-%d %H%z",
        ]
        .into_iter()
        .find_map(|format| DateTime::parse_from_str(raw, format).ok())
    })
}

fn format_naive_datetime(value: NaiveDateTime) -> String {
    let base = value.format("%Y-%m-%dT%H:%M:%S");
    let microseconds = value.and_utc().timestamp_subsec_micros();
    if microseconds == 0 {
        base.to_string()
    } else {
        format!("{base}.{microseconds:06}")
    }
}

fn format_datetime_with_offset(value: DateTime<chrono::FixedOffset>) -> String {
    format!(
        "{}{}",
        format_naive_datetime(value.naive_local()),
        value.offset()
    )
}

#[utoipa::path(
    get,
    path = "/debug/database/articles",
    operation_id = "list_database_articles_debug_database_articles_get",
    tag = "debug",
    params(DatabaseArticlesQuery),
    responses(
        (status = 200, description = "Successful Response", body = DatabaseDebugArticlesResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError)
    )
)]
pub(crate) async fn list_database_articles(
    State(state): State<crate::AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = match parse_integer_query(&params, "limit", 50, 1, 200) {
        Ok(limit) => limit,
        Err(error) => return query_validation_response(error),
    };
    let offset = match parse_integer_query(&params, "offset", 0, 0, i64::MAX) {
        Ok(offset) => offset,
        Err(error) => return query_validation_response(error),
    };
    let missing_embeddings_only = match parse_bool_query(&params, "missing_embeddings_only", false)
    {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    let published_before = match parse_date_bound(&params, "published_before") {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    let published_after = match parse_date_bound(&params, "published_after") {
        Ok(value) => value,
        Err(error) => return query_validation_response(error),
    };
    let source = params.get("source").cloned();
    let sort_direction = params
        .get("sort_direction")
        .map_or_else(|| "desc".to_owned(), |value| value.to_ascii_lowercase());
    if sort_direction != "asc" && sort_direction != "desc" {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"detail": "sort_direction must be 'asc' or 'desc'"})),
        )
            .into_response();
    }
    if !state.database_enabled {
        return provider_unavailable("Database unavailable");
    }
    let request = DebugArticleRequest {
        source: source.clone(),
        missing_embeddings_only,
        published_before: published_before.as_ref().map(|bound| bound.sql),
        published_after: published_after.as_ref().map(|bound| bound.sql),
        sort_desc: sort_direction == "desc",
        limit,
        offset,
    };
    let page = match state.database.debug_articles(request).await {
        Ok(page) => page,
        Err(error) => {
            tracing::error!(%error, "failed to read debug database articles");
            return database_failed();
        }
    };
    let articles = page
        .articles
        .into_iter()
        .map(|article| DatabaseDebugArticleResponse {
            id: article.id,
            title: article.title,
            source: article.source,
            url: article.url,
            chroma_id: article.chroma_id,
            content: article.content,
            image_url: article.image_url,
            published_at: Some(format_naive_datetime(article.published_at)),
            summary: article.summary,
            embedding_generated: article.embedding_generated,
        })
        .collect();
    Json(DatabaseDebugArticlesResponse {
        limit,
        offset,
        source,
        missing_embeddings_only,
        sort_direction,
        published_before: published_before.map(|bound| bound.echo),
        published_after: published_after.map(|bound| bound.echo),
        articles,
        total: page.total,
        returned: page.returned,
        oldest_published: page.oldest_published.map(format_naive_datetime),
        newest_published: page.newest_published.map(format_naive_datetime),
    })
    .into_response()
}

fn database_failed() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"detail": "Database request failed"})),
    )
        .into_response()
}

#[derive(Clone, Debug, IntoParams)]
struct CacheDeltaQuery {
    #[param(minimum = 10, maximum = 1000, example = 200)]
    sample_limit: Option<i64>,
    #[param(minimum = 0, example = 0)]
    sample_offset: Option<i64>,
    source: Option<String>,
    #[param(minimum = 0, maximum = 200, example = 50)]
    sample_preview_limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/debug/cache/delta",
    operation_id = "get_cache_db_delta_debug_cache_delta_get",
    tag = "debug",
    params(CacheDeltaQuery),
    responses(
        (status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 503, description = "Database unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_cache_db_delta(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let sample_limit = match parse_integer_query(&params, "sample_limit", 200, 10, 1000) {
        Ok(value) => value as usize,
        Err(error) => return query_validation_response(error),
    };
    let sample_offset = match parse_integer_query(&params, "sample_offset", 0, 0, i64::MAX) {
        Ok(value) => value as usize,
        Err(error) => return query_validation_response(error),
    };
    let sample_preview_limit =
        match parse_integer_query(&params, "sample_preview_limit", 50, 0, 200) {
            Ok(value) => value as usize,
            Err(error) => return query_validation_response(error),
        };
    if !state.config.enable_database {
        return provider_unavailable("Database unavailable");
    }
    let source = params.get("source").cloned();
    let cache_snapshot = state.cache_stream.snapshot();
    let cached = cache_snapshot
        .articles
        .iter()
        .filter(|article| {
            source
                .as_deref()
                .filter(|source| !source.is_empty())
                .is_none_or(|source| article.get("source").and_then(Value::as_str) == Some(source))
        })
        .collect::<Vec<_>>();
    let cache_total = cached.len();
    let urls = cached
        .iter()
        .skip(sample_offset)
        .take(sample_limit)
        .filter_map(|article| article.get("link").and_then(Value::as_str))
        .filter(|url| !url.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Json(json!({
            "cache_total": cache_total,
            "cache_sampled": 0,
            "db_total": 0,
            "missing_in_db_count": 0,
            "missing_in_db_sample": [],
            "source": source
        }))
        .into_response();
    }
    let db_total = match state
        .database
        .count_articles_for_source(source.as_deref())
        .await
    {
        Ok(total) => total,
        Err(error) => {
            tracing::error!(%error, "failed to count debug database articles");
            return database_failed();
        }
    };
    let matched = match state.database.article_urls_exist(&urls).await {
        Ok(urls) => urls.into_iter().collect::<HashSet<_>>(),
        Err(error) => {
            tracing::error!(%error, "failed to check debug database article URLs");
            return database_failed();
        }
    };
    let missing = urls
        .iter()
        .filter(|url| !matched.contains(*url))
        .cloned()
        .collect::<Vec<_>>();
    Json(json!({
        "cache_total": cache_total,
        "cache_sampled": urls.len(),
        "db_total": db_total,
        "missing_in_db_count": missing.len(),
        "missing_in_db_sample": missing.into_iter().take(sample_preview_limit).collect::<Vec<_>>(),
        "source": source,
        "sample_offset": sample_offset,
        "sample_limit": sample_limit
    }))
    .into_response()
}

#[derive(Clone, Debug, IntoParams)]
struct StorageDriftQuery {
    #[param(minimum = 5, maximum = 500, example = 50)]
    sample_limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/debug/storage/drift",
    operation_id = "get_storage_drift_debug_storage_drift_get",
    tag = "debug",
    params(StorageDriftQuery),
    responses(
        (status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 503, description = "Storage provider unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_storage_drift(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let sample_limit = match parse_integer_query(&params, "sample_limit", 50, 5, 500) {
        Ok(value) => value as usize,
        Err(error) => return query_validation_response(error),
    };
    let Some(chroma) = state.providers.chroma.as_ref() else {
        return provider_unavailable("Vector store unavailable");
    };
    if !state.config.enable_database {
        return provider_unavailable("Database unavailable");
    }
    let mappings = match state.database.debug_article_chroma_mappings().await {
        Ok(mappings) => mappings,
        Err(error) => {
            tracing::error!(%error, "failed to read debug Chroma mappings");
            return database_failed();
        }
    };
    let collection = match chroma.get_collection().await {
        Ok(collection) => collection,
        Err(error) => {
            tracing::error!(%error, "failed to resolve debug Chroma collection");
            return chroma_failed();
        }
    };
    let chroma_ids = match collection
        .list_all_ids(NonZeroUsize::new(1_000).expect("non-zero Chroma page size"))
        .await
    {
        Ok(ids) => ids.into_iter().collect::<BTreeSet<_>>(),
        Err(error) => {
            tracing::error!(%error, "failed to enumerate debug Chroma IDs");
            return chroma_failed();
        }
    };
    let db_chroma_ids = mappings
        .iter()
        .filter_map(|mapping| mapping.chroma_id.as_deref().filter(|id| !id.is_empty()))
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let missing_embedding = mappings
        .iter()
        .filter(|mapping| mapping.chroma_id.as_deref().is_none_or(str::is_empty))
        .collect::<Vec<_>>();
    let missing_chroma = mappings
        .iter()
        .filter(|mapping| {
            mapping
                .chroma_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .is_some_and(|id| !chroma_ids.contains(id))
        })
        .collect::<Vec<_>>();
    let dangling = chroma_ids
        .difference(&db_chroma_ids)
        .take(sample_limit)
        .cloned()
        .collect::<Vec<_>>();
    let missing_in_chroma = missing_chroma
        .iter()
        .take(sample_limit)
        .map(|mapping| {
            json!({
                "id": mapping.id,
                "chroma_id": mapping.chroma_id,
                "embedding_generated": mapping.embedding_generated
            })
        })
        .collect::<Vec<_>>();
    Json(json!({
        "database_total_articles": mappings.len(),
        "database_with_embeddings": db_chroma_ids.len(),
        "database_missing_embeddings": missing_embedding.len(),
        "vector_total_documents": chroma_ids.len(),
        "missing_in_chroma": missing_in_chroma,
        "dangling_in_chroma": dangling,
        "missing_in_chroma_count": missing_chroma.len(),
        "dangling_in_chroma_count": chroma_ids.difference(&db_chroma_ids).count()
    }))
    .into_response()
}
#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::{NaiveDate, NaiveDateTime};

    use super::{parse_bool_query, parse_date_bound};

    #[test]
    fn timezone_aware_bounds_normalize_for_sql_and_preserve_offset_echo() {
        let params = HashMap::from([(
            "published_before".to_owned(),
            "2026-06-01T12:30:00.001000+02:00".to_owned(),
        )]);

        let bound = parse_date_bound(&params, "published_before")
            .expect("valid datetime")
            .expect("present datetime");

        assert_eq!(
            bound.sql,
            NaiveDate::from_ymd_opt(2026, 6, 1)
                .expect("date")
                .and_hms_micro_opt(10, 30, 0, 1_000)
                .expect("time")
        );
        assert_eq!(bound.echo, "2026-06-01T12:30:00.001000+02:00");
    }

    #[test]
    fn space_separated_timezone_bounds_preserve_python_isoformat() {
        let params = HashMap::from([(
            "published_after".to_owned(),
            "2026-06-01 12:30:00.001000+02:00".to_owned(),
        )]);

        let bound = parse_date_bound(&params, "published_after")
            .expect("valid datetime")
            .expect("present datetime");

        assert_eq!(
            bound.sql,
            NaiveDate::from_ymd_opt(2026, 6, 1)
                .expect("date")
                .and_hms_micro_opt(10, 30, 0, 1_000)
                .expect("time")
        );
        assert_eq!(bound.echo, "2026-06-01T12:30:00.001000+02:00");
    }

    #[test]
    fn date_only_bounds_use_midnight_without_timezone() {
        let params = HashMap::from([("published_after".to_owned(), "2026-06-01".to_owned())]);

        let bound = parse_date_bound(&params, "published_after")
            .expect("valid date")
            .expect("present date");

        assert_eq!(
            bound.sql,
            NaiveDateTime::new(
                NaiveDate::from_ymd_opt(2026, 6, 1).expect("date"),
                chrono::NaiveTime::MIN,
            )
        );
        assert_eq!(bound.echo, "2026-06-01T00:00:00");
    }

    #[test]
    fn boolean_query_accepts_pydantic_literals_and_rejects_unknown_values() {
        let truthy = HashMap::from([("missing_embeddings_only".to_owned(), "yes".to_owned())]);
        let falsy = HashMap::from([("missing_embeddings_only".to_owned(), "0".to_owned())]);
        let invalid =
            HashMap::from([("missing_embeddings_only".to_owned(), "sometimes".to_owned())]);

        assert!(parse_bool_query(&truthy, "missing_embeddings_only", false).expect("true value"));
        let uppercase = HashMap::from([("missing_embeddings_only".to_owned(), "TRUE".to_owned())]);
        assert!(!parse_bool_query(&falsy, "missing_embeddings_only", true).expect("false value"));
        assert!(parse_bool_query(&uppercase, "missing_embeddings_only", false).expect("uppercase"));
        let error =
            parse_bool_query(&invalid, "missing_embeddings_only", false).expect_err("invalid bool");
        assert_eq!(error.detail.len(), 1);
        assert_eq!(error.detail[0].loc.len(), 2);
        assert!(matches!(
            &error.detail[0].loc[0],
            crate::models::ValidationLocation::Text(location) if location == "query"
        ));
        assert!(matches!(
            &error.detail[0].loc[1],
            crate::models::ValidationLocation::Text(location) if location == "missing_embeddings_only"
        ));
        assert_eq!(error.detail[0].error_type, "bool_parsing");
        assert_eq!(
            error.detail[0].input,
            serde_json::Value::String("sometimes".to_owned())
        );
    }
    #[test]
    fn boolean_query_rejects_surrounding_whitespace_like_fastapi() {
        for raw in [" true", "true "] {
            let params = HashMap::from([("missing_embeddings_only".to_owned(), raw.to_owned())]);
            let error = parse_bool_query(&params, "missing_embeddings_only", false)
                .expect_err("surrounding whitespace is invalid");
            assert_eq!(error.detail[0].error_type, "bool_parsing");
            assert_eq!(
                error.detail[0].input,
                serde_json::Value::String(raw.to_owned())
            );
        }
    }
}
