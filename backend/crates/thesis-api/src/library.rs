use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_db::{LibraryError, SavedArticleCreateResult, SavedArticleItem, SavedArticleRecord};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

// FastAPI exposes these collections globally: the route dependencies provide only a
// database session and the shared schema has no user identity column. Do not infer
// authorization here; the integrator must add an explicit boundary before changing
// the persistence contract.
struct FreeFormObject;

impl utoipa::PartialSchema for FreeFormObject {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::Object)
            .additional_properties(Some(
                utoipa::openapi::schema::AdditionalProperties::FreeForm(true),
            ))
            .build()
            .into()
    }
}

impl utoipa::ToSchema for FreeFormObject {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("FreeFormObject")
    }
}
/// Request body shared by bookmark and liked-article creation.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct BookmarkCreateRequest {
    pub article_id: i32,
}

/// A bookmark list entry with its canonical article metadata.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct BookmarkEntry {
    pub article_id: i32,
    pub bookmark_id: i32,
    pub category: String,
    #[schema(required = false)]
    pub created_at: Option<String>,
    #[schema(required = false)]
    pub image: Option<String>,
    #[schema(required = false)]
    pub published: Option<String>,
    pub source: String,
    #[schema(required = false)]
    pub summary: Option<String>,
    pub title: String,
    pub url: String,
}

/// The bookmark list response.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct BookmarkListResponse {
    pub bookmarks: Vec<BookmarkEntry>,
    #[schema(value_type = i64)]
    pub total: usize,
}

/// A liked-article list entry with its canonical article metadata.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct LikedEntry {
    pub article_id: i32,
    pub category: String,
    #[schema(required = false)]
    pub created_at: Option<String>,
    #[schema(required = false)]
    pub image: Option<String>,
    pub liked_id: i32,
    #[schema(required = false)]
    pub published: Option<String>,
    pub source: String,
    #[schema(required = false)]
    pub summary: Option<String>,
    pub title: String,
    pub url: String,
}

/// The liked-article list response.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct LikedListResponse {
    pub liked: Vec<LikedEntry>,
    #[schema(value_type = i64)]
    pub total: usize,
}

fn isoformat_or_none(value: Option<DateTime<Utc>>) -> Option<String> {
    value.map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::AutoSi, false))
}

fn bookmark_entry(row: SavedArticleRecord) -> Result<BookmarkEntry, &'static str> {
    Ok(BookmarkEntry {
        article_id: row.article_id,
        bookmark_id: row.id,
        category: row.category.ok_or("bookmark article category is null")?,
        created_at: isoformat_or_none(row.created_at),
        image: row.image_url,
        published: isoformat_or_none(row.published_at),
        source: row.source,
        summary: row.summary,
        title: row.title,
        url: row.url,
    })
}

fn liked_entry(row: SavedArticleRecord) -> Result<LikedEntry, &'static str> {
    Ok(LikedEntry {
        article_id: row.article_id,
        category: row.category.ok_or("liked article category is null")?,
        created_at: isoformat_or_none(row.created_at),
        image: row.image_url,
        liked_id: row.id,
        published: isoformat_or_none(row.published_at),
        source: row.source,
        summary: row.summary,
        title: row.title,
        url: row.url,
    })
}

fn detail_value(row: SavedArticleRecord, id_field: &str) -> Result<Value, &'static str> {
    let category = row.category.ok_or("saved article category is null")?;
    let mut payload = serde_json::json!({
        "article_id": row.article_id,
        "title": row.title,
        "source": row.source,
        "summary": row.summary,
        "image": row.image_url,
        "published": isoformat_or_none(row.published_at),
        "category": category,
        "url": row.url,
        "created_at": isoformat_or_none(row.created_at),
    });
    let Value::Object(object) = &mut payload else {
        return Err("saved article detail did not serialize as an object");
    };
    object.insert(id_field.to_owned(), Value::from(row.id));
    Ok(payload)
}

fn item_value(item: SavedArticleItem, id_field: &str, flag: &str, value: bool) -> Value {
    let mut payload = serde_json::json!({
        "article_id": item.article_id,
        "created_at": isoformat_or_none(item.created_at),
    });
    let Value::Object(object) = &mut payload else {
        return Value::Null;
    };
    object.insert(id_field.to_owned(), Value::from(item.id));
    object.insert(flag.to_owned(), Value::Bool(value));
    payload
}

fn deleted_value(article_id: i32) -> Value {
    serde_json::json!({"deleted": true, "article_id": article_id})
}

fn contract_error(error: &str) -> Response {
    tracing::error!(%error, "saved article violates its response contract");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
}

fn database_error(error: impl std::fmt::Display, context: &'static str) -> Response {
    tracing::error!(%error, context, "saved article database operation failed");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
}

fn not_found(detail: &'static str) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"detail": detail})),
    )
        .into_response()
}

fn library_error(error: LibraryError, article_missing_detail: &'static str) -> Response {
    match error {
        LibraryError::ArticleNotFound => not_found(article_missing_detail),
        LibraryError::Database(error) => database_error(error, "saved article write"),
    }
}

fn invalid_path_integer(value: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("path".to_owned()),
                ValidationLocation::Text("article_id".to_owned()),
            ],
            msg: "Input should be a valid integer, unable to parse string as an integer".to_owned(),
            error_type: "int_parsing".to_owned(),
            input: Value::String(value.to_owned()),
            ctx: None,
        }],
    }
}

fn parse_article_id(value: &str) -> Result<i32, HttpValidationError> {
    value
        .parse::<i32>()
        .map_err(|_| invalid_path_integer(value))
}

fn invalid_body_integer(value: &Value) -> HttpValidationError {
    HttpValidationError::field(
        value.clone(),
        "article_id",
        "int_type",
        "Input should be a valid integer",
    )
}

fn parse_bookmark_request(body: &[u8]) -> Result<BookmarkCreateRequest, HttpValidationError> {
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
    let Some(fields) = value.as_object() else {
        return Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    };
    let Some(article_id) = fields.get("article_id") else {
        return Err(HttpValidationError::field(
            value,
            "article_id",
            "missing",
            "Field required",
        ));
    };
    let Some(number) = article_id.as_i64() else {
        return Err(invalid_body_integer(article_id));
    };
    let Ok(article_id) = i32::try_from(number) else {
        return Err(invalid_body_integer(article_id));
    };
    Ok(BookmarkCreateRequest { article_id })
}

#[utoipa::path(
    get,
    path = "/api/bookmarks",
    operation_id = "list_bookmarks_api_bookmarks_get",
    tag = "bookmarks",
    responses((status = 200, description = "Successful Response", body = BookmarkListResponse))
)]
pub(crate) async fn list_bookmarks(State(state): State<AppState>) -> Response {
    let rows = match state.database.list_bookmarks().await {
        Ok(rows) => rows,
        Err(error) => return database_error(error, "bookmark list"),
    };
    let bookmarks = match rows
        .into_iter()
        .map(bookmark_entry)
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(bookmarks) => bookmarks,
        Err(error) => return contract_error(error),
    };
    Json(BookmarkListResponse {
        total: bookmarks.len(),
        bookmarks,
    })
    .into_response()
}

#[utoipa::path(
    post,
    path = "/api/bookmarks",
    operation_id = "create_bookmark_api_bookmarks_post",
    tag = "bookmarks",
    request_body = BookmarkCreateRequest,
    responses(
        (status = 201, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn create_bookmark(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_bookmark_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    match state.database.create_bookmark(request.article_id).await {
        Ok(SavedArticleCreateResult { item, created }) => (
            StatusCode::CREATED,
            Json(item_value(item, "bookmark_id", "created", created)),
        )
            .into_response(),
        Err(error) => library_error(error, "Article not found"),
    }
}

#[utoipa::path(
    get,
    path = "/api/bookmarks/{article_id}",
    operation_id = "get_bookmark_api_bookmarks__article_id__get",
    tag = "bookmarks",
    params(("article_id" = i32, Path, description = "Article id")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_bookmark(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Response {
    let article_id = match parse_article_id(&article_id) {
        Ok(article_id) => article_id,
        Err(error) => return error.into_response(),
    };
    match state.database.get_bookmark(article_id).await {
        Ok(Some(row)) => match detail_value(row, "bookmark_id") {
            Ok(value) => Json(value).into_response(),
            Err(error) => contract_error(error),
        },
        Ok(None) => not_found("Bookmark not found"),
        Err(error) => database_error(error, "bookmark detail"),
    }
}

#[utoipa::path(
    put,
    path = "/api/bookmarks/{article_id}",
    operation_id = "update_bookmark_api_bookmarks__article_id__put",
    tag = "bookmarks",
    params(("article_id" = i32, Path, description = "Article id")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn update_bookmark(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Response {
    let article_id = match parse_article_id(&article_id) {
        Ok(article_id) => article_id,
        Err(error) => return error.into_response(),
    };
    match state.database.get_bookmark_item(article_id).await {
        Ok(Some(item)) => Json(item_value(item, "bookmark_id", "updated", true)).into_response(),
        Ok(None) => not_found("Bookmark not found"),
        Err(error) => database_error(error, "bookmark update"),
    }
}

#[utoipa::path(
    delete,
    path = "/api/bookmarks/{article_id}",
    operation_id = "delete_bookmark_api_bookmarks__article_id__delete",
    tag = "bookmarks",
    params(("article_id" = i32, Path, description = "Article id")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn delete_bookmark(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Response {
    let article_id = match parse_article_id(&article_id) {
        Ok(article_id) => article_id,
        Err(error) => return error.into_response(),
    };
    match state.database.delete_bookmark(article_id).await {
        Ok(Some(_)) => Json(deleted_value(article_id)).into_response(),
        Ok(None) => not_found("Bookmark not found"),
        Err(error) => database_error(error, "bookmark delete"),
    }
}

#[utoipa::path(
    get,
    path = "/api/liked",
    operation_id = "list_liked_articles_api_liked_get",
    tag = "liked",
    responses((status = 200, description = "Successful Response", body = LikedListResponse))
)]
pub(crate) async fn list_liked_articles(State(state): State<AppState>) -> Response {
    let rows = match state.database.list_liked_articles().await {
        Ok(rows) => rows,
        Err(error) => return database_error(error, "liked list"),
    };
    let liked = match rows
        .into_iter()
        .map(liked_entry)
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(liked) => liked,
        Err(error) => return contract_error(error),
    };
    Json(LikedListResponse {
        total: liked.len(),
        liked,
    })
    .into_response()
}

#[utoipa::path(
    post,
    path = "/api/liked",
    operation_id = "create_liked_article_api_liked_post",
    tag = "liked",
    request_body = BookmarkCreateRequest,
    responses(
        (status = 201, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn create_liked_article(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_bookmark_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    match state
        .database
        .create_liked_article(request.article_id)
        .await
    {
        Ok(SavedArticleCreateResult { item, created }) => (
            StatusCode::CREATED,
            Json(item_value(item, "liked_id", "created", created)),
        )
            .into_response(),
        Err(error) => library_error(error, "Article not found"),
    }
}

#[utoipa::path(
    get,
    path = "/api/liked/{article_id}",
    operation_id = "get_liked_article_api_liked__article_id__get",
    tag = "liked",
    params(("article_id" = i32, Path, description = "Article id")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_liked_article(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Response {
    let article_id = match parse_article_id(&article_id) {
        Ok(article_id) => article_id,
        Err(error) => return error.into_response(),
    };
    match state.database.get_liked_article(article_id).await {
        Ok(Some(row)) => match detail_value(row, "liked_id") {
            Ok(value) => Json(value).into_response(),
            Err(error) => contract_error(error),
        },
        Ok(None) => not_found("Liked article not found"),
        Err(error) => database_error(error, "liked detail"),
    }
}

#[utoipa::path(
    delete,
    path = "/api/liked/{article_id}",
    operation_id = "delete_liked_article_api_liked__article_id__delete",
    tag = "liked",
    params(("article_id" = i32, Path, description = "Article id")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObject)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn delete_liked_article(
    State(state): State<AppState>,
    Path(article_id): Path<String>,
) -> Response {
    let article_id = match parse_article_id(&article_id) {
        Ok(article_id) => article_id,
        Err(error) => return error.into_response(),
    };
    match state.database.delete_liked_article(article_id).await {
        Ok(Some(_)) => Json(deleted_value(article_id)).into_response(),
        Ok(None) => not_found("Liked article not found"),
        Err(error) => database_error(error, "liked delete"),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_article_id, parse_bookmark_request};
    use serde_json::json;

    #[test]
    fn request_parser_is_strict_and_ignores_unknown_fields_like_fastapi() {
        let request = parse_bookmark_request(br#"{"article_id":7,"extra":"ignored"}"#)
            .expect("valid bookmark request");
        assert_eq!(request.article_id, 7);
        for body in [
            br#"{}"#.as_slice(),
            br#"{"article_id":"7"}"#.as_slice(),
            br#"{"article_id":true}"#.as_slice(),
            br#"{"article_id":7.0}"#.as_slice(),
            br#"{"article_id":null}"#.as_slice(),
        ] {
            assert_eq!(
                serde_json::to_value(
                    &parse_bookmark_request(body)
                        .expect_err("invalid article id")
                        .detail[0]
                        .loc
                )
                .expect("validation location JSON"),
                serde_json::json!(["body", "article_id"])
            );
        }
    }

    #[test]
    fn malformed_json_and_non_object_body_match_validation_boundaries() {
        let malformed = parse_bookmark_request(br#"{"#).expect_err("malformed json");
        assert_eq!(malformed.detail[0].error_type, "json_invalid");
        let scalar = parse_bookmark_request(br#"[]"#).expect_err("array body");
        assert_eq!(scalar.detail[0].error_type, "model_type");
        assert_eq!(scalar.detail[0].input, json!([]));
    }

    #[test]
    fn path_integer_overflow_is_rejected_before_database_access() {
        let error = parse_article_id("2147483648").expect_err("i32 overflow");
        assert_eq!(error.detail[0].error_type, "int_parsing");
        assert_eq!(error.detail[0].loc.len(), 2);
    }
}
