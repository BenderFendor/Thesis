//! HTTP contract and response shaping for persisted reader highlights.
//!
//! The public FastAPI routes remain the migration oracle: all five operation
//! IDs, paths, request fields, response shapes, status codes, and implicit
//! single-user authentication are retained here.  The handler deliberately
//! does not call a provider or keep process-local state.
//!
//! Two formal integrity rules are stronger than the legacy Python service:
//! storage rejects empty/range-invalid highlights and the database serializes
//! duplicate creates.  An explicit nullable `note` in a Rust patch clears the
//! note; Python currently treats that value like an omitted field.  These
//! divergences are intentional and are covered by the persistence module's
//! invariants rather than hidden in the HTTP layer.

use std::fmt;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_db::{
    HighlightCreate, HighlightError, HighlightPatch, HighlightRecord, DEFAULT_HIGHLIGHT_USER_ID,
};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

/// FastAPI-compatible request body for highlight creation.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct CreateHighlightRequest {
    pub article_url: String,
    pub highlighted_text: String,
    #[serde(default = "default_color")]
    #[schema(required = false, default = "yellow")]
    pub color: String,
    #[schema(required = false)]
    pub note: Option<String>,
    pub character_start: i32,
    pub character_end: i32,
}

/// FastAPI-compatible request body for highlight updates.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct UpdateHighlightRequest {
    #[schema(required = false)]
    pub color: Option<String>,
    #[schema(required = false)]
    pub note: Option<String>,
}

/// The public highlight response.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = Highlight)]
pub(crate) struct HighlightResponse {
    #[schema(required = false)]
    pub id: Option<i32>,
    #[schema(required = false)]
    pub user_id: Option<i32>,
    pub article_url: String,
    pub highlighted_text: String,
    #[schema(required = false, default = "yellow")]
    pub color: String,
    #[schema(required = false)]
    pub note: Option<String>,
    pub character_start: i32,
    pub character_end: i32,
    #[schema(required = false)]
    pub created_at: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub updated_at: Option<DateTime<Utc>>,
}

fn default_color() -> String {
    "yellow".to_owned()
}

impl From<HighlightRecord> for HighlightResponse {
    fn from(record: HighlightRecord) -> Self {
        Self {
            id: record.id,
            user_id: record.user_id,
            article_url: record.article_url,
            highlighted_text: record.highlighted_text,
            color: record.color,
            note: record.note,
            character_start: record.character_start,
            character_end: record.character_end,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

fn json_decode_error(error: serde_json::Error) -> HttpValidationError {
    HttpValidationError {
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
    }
}

fn parse_object(body: &[u8]) -> Result<Value, HttpValidationError> {
    let value = serde_json::from_slice::<Value>(body).map_err(json_decode_error)?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ))
    }
}

fn missing_field(value: &Value, field: &'static str) -> HttpValidationError {
    HttpValidationError::field(value.clone(), field, "missing", "Field required")
}

fn wrong_type(value: &Value, field: &'static str, message: &'static str) -> HttpValidationError {
    HttpValidationError::field(value.clone(), field, "string_type", message)
}

fn required_string(
    object: &Map<String, Value>,
    whole: &Value,
    field: &'static str,
) -> Result<String, HttpValidationError> {
    let Some(value) = object.get(field) else {
        return Err(missing_field(whole, field));
    };
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| wrong_type(value, field, "Input should be a valid string"))
}

fn optional_string(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<Option<String>, HttpValidationError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(|text| Some(text.to_owned()))
            .ok_or_else(|| wrong_type(value, field, "Input should be a valid string")),
    }
}

fn required_i32(
    object: &Map<String, Value>,
    whole: &Value,
    field: &'static str,
) -> Result<i32, HttpValidationError> {
    let Some(value) = object.get(field) else {
        return Err(missing_field(whole, field));
    };
    let Some(number) = value.as_i64() else {
        return Err(HttpValidationError::field(
            value.clone(),
            field,
            "int_type",
            "Input should be a valid integer",
        ));
    };
    i32::try_from(number).map_err(|_| {
        HttpValidationError::field(
            value.clone(),
            field,
            "int_type",
            "Input should be a valid integer",
        )
    })
}

fn invalid_value(value: Value, field: &'static str, message: &'static str) -> HttpValidationError {
    HttpValidationError::field(value, field, "value_error", message)
}

fn validate_create_request(
    whole: &Value,
    request: &CreateHighlightRequest,
) -> Result<(), HttpValidationError> {
    if request.article_url.trim().is_empty() {
        return Err(invalid_value(
            whole.clone(),
            "article_url",
            "Value must not be empty",
        ));
    }
    if request.highlighted_text.trim().is_empty() {
        return Err(invalid_value(
            whole.clone(),
            "highlighted_text",
            "Value must not be empty",
        ));
    }
    if request.color.trim().is_empty() {
        return Err(invalid_value(
            whole.clone(),
            "color",
            "Value must not be empty",
        ));
    }
    if request.character_start < 0 {
        return Err(invalid_value(
            whole.clone(),
            "character_start",
            "Value must be greater than or equal to 0",
        ));
    }
    if request.character_end <= request.character_start {
        return Err(invalid_value(
            whole.clone(),
            "character_end",
            "Value must be greater than character_start",
        ));
    }
    Ok(())
}

fn parse_create_request(body: &[u8]) -> Result<CreateHighlightRequest, HttpValidationError> {
    let value = parse_object(body)?;
    let object = value
        .as_object()
        .expect("parse_object returned an object value");
    let request = CreateHighlightRequest {
        article_url: required_string(object, &value, "article_url")?,
        highlighted_text: required_string(object, &value, "highlighted_text")?,
        color: match object.get("color") {
            None => default_color(),
            Some(value) => value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| wrong_type(value, "color", "Input should be a valid string"))?,
        },
        note: optional_string(object, "note")?,
        character_start: required_i32(object, &value, "character_start")?,
        character_end: required_i32(object, &value, "character_end")?,
    };
    validate_create_request(&value, &request)?;
    Ok(request)
}

fn parse_update_request(body: &[u8]) -> Result<HighlightPatch, HttpValidationError> {
    let value = parse_object(body)?;
    let object = value
        .as_object()
        .expect("parse_object returned an object value");
    let color = optional_string(object, "color")?;
    let note = if object.contains_key("note") {
        Some(optional_string(object, "note")?)
    } else {
        None
    };
    if color
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invalid_value(value, "color", "Value must not be empty"));
    }
    Ok(HighlightPatch { color, note })
}

fn invalid_path_integer(value: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("path".to_owned()),
                ValidationLocation::Text("highlight_id".to_owned()),
            ],
            msg: "Input should be a valid integer, unable to parse string as an integer".to_owned(),
            error_type: "int_parsing".to_owned(),
            input: Value::String(value.to_owned()),
            ctx: None,
        }],
    }
}

fn parse_highlight_id(value: &str) -> Result<i32, HttpValidationError> {
    value
        .parse::<i32>()
        .map_err(|_| invalid_path_integer(value))
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"detail": "Highlight not found"})),
    )
        .into_response()
}

fn server_error(error: impl fmt::Display, detail: &'static str) -> Response {
    tracing::error!(%error, detail, "highlight database operation failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"detail": detail})),
    )
        .into_response()
}

fn persistence_error(error: HighlightError, detail: &'static str) -> Response {
    match error {
        HighlightError::InvalidInput { field, message } => {
            HttpValidationError::field(Value::Null, field, "value_error", message).into_response()
        }
        HighlightError::Database(error) => server_error(error, detail),
    }
}

#[utoipa::path(
    get,
    path = "/api/queue/highlights",
    operation_id = "get_all_highlights_api_queue_highlights_get",
    tag = "reading_queue",
    responses(
        (status = 200, description = "Successful Response", body = [HighlightResponse])
    )
)]
pub(crate) async fn get_all_highlights(State(state): State<AppState>) -> Response {
    let records = match state
        .database
        .list_highlights(DEFAULT_HIGHLIGHT_USER_ID)
        .await
    {
        Ok(records) => records,
        Err(error) => return server_error(error, "Failed to fetch highlights"),
    };
    Json(
        records
            .into_iter()
            .map(HighlightResponse::from)
            .collect::<Vec<_>>(),
    )
    .into_response()
}

#[utoipa::path(
    post,
    path = "/api/queue/highlights",
    operation_id = "create_highlight_api_queue_highlights_post",
    tag = "reading_queue",
    request_body = CreateHighlightRequest,
    responses(
        (status = 200, description = "Successful Response", body = HighlightResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn create_highlight(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_create_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let request = HighlightCreate {
        article_url: request.article_url,
        highlighted_text: request.highlighted_text,
        color: request.color,
        note: request.note,
        character_start: request.character_start,
        character_end: request.character_end,
    };
    match state
        .database
        .create_highlight(DEFAULT_HIGHLIGHT_USER_ID, request)
        .await
    {
        Ok(record) => Json(HighlightResponse::from(record)).into_response(),
        Err(error) => persistence_error(error, "Failed to create highlight"),
    }
}

#[utoipa::path(
    get,
    path = "/api/queue/highlights/article/{article_url}",
    operation_id = "get_article_highlights_api_queue_highlights_article__article_url__get",
    tag = "reading_queue",
    params(("article_url" = String, Path, description = "Article URL")),
    responses(
        (status = 200, description = "Successful Response", body = [HighlightResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_article_highlights(
    State(state): State<AppState>,
    Path(article_url): Path<String>,
) -> Response {
    let records = match state
        .database
        .list_highlights_for_article(DEFAULT_HIGHLIGHT_USER_ID, &article_url)
        .await
    {
        Ok(records) => records,
        Err(error) => return server_error(error, "Failed to fetch highlights"),
    };
    Json(
        records
            .into_iter()
            .map(HighlightResponse::from)
            .collect::<Vec<_>>(),
    )
    .into_response()
}

#[utoipa::path(
    patch,
    path = "/api/queue/highlights/{highlight_id}",
    operation_id = "update_highlight_api_queue_highlights__highlight_id__patch",
    tag = "reading_queue",
    params(("highlight_id" = i32, Path, description = "Highlight id")),
    request_body = UpdateHighlightRequest,
    responses(
        (status = 200, description = "Successful Response", body = HighlightResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn update_highlight(
    State(state): State<AppState>,
    Path(highlight_id): Path<String>,
    body: Bytes,
) -> Response {
    let highlight_id = match parse_highlight_id(&highlight_id) {
        Ok(highlight_id) => highlight_id,
        Err(error) => return error.into_response(),
    };
    let patch = match parse_update_request(&body) {
        Ok(patch) => patch,
        Err(error) => return error.into_response(),
    };
    match state
        .database
        .update_highlight(DEFAULT_HIGHLIGHT_USER_ID, highlight_id, patch)
        .await
    {
        Ok(Some(record)) => Json(HighlightResponse::from(record)).into_response(),
        Ok(None) => not_found(),
        Err(error) => persistence_error(error, "Failed to update highlight"),
    }
}

#[utoipa::path(
    delete,
    path = "/api/queue/highlights/{highlight_id}",
    operation_id = "delete_highlight_api_queue_highlights__highlight_id__delete",
    tag = "reading_queue",
    params(("highlight_id" = i32, Path, description = "Highlight id")),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn delete_highlight(
    State(state): State<AppState>,
    Path(highlight_id): Path<String>,
) -> Response {
    let highlight_id = match parse_highlight_id(&highlight_id) {
        Ok(highlight_id) => highlight_id,
        Err(error) => return error.into_response(),
    };
    match state
        .database
        .delete_highlight(DEFAULT_HIGHLIGHT_USER_ID, highlight_id)
        .await
    {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found(),
        Err(error) => server_error(error, "Failed to delete highlight"),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_create_request, parse_highlight_id, parse_update_request};

    #[test]
    fn create_parser_defaults_color_and_ignores_frontend_metadata() {
        let request = parse_create_request(
            br#"{"article_url":"https://example.test/story","highlighted_text":"A sentence","character_start":0,"character_end":10,"client_id":"local-1"}"#,
        )
        .expect("valid create request");
        assert_eq!(request.color, "yellow");
        assert_eq!(request.character_end, 10);
    }

    #[test]
    fn update_parser_distinguishes_note_clear_from_note_omission() {
        assert!(parse_update_request(br#"{}"#)
            .expect("empty patch")
            .note
            .is_none());
        assert_eq!(
            parse_update_request(br#"{"note":null}"#)
                .expect("null note patch")
                .note,
            Some(None)
        );
    }

    #[test]
    fn malformed_and_invalid_inputs_use_validation_boundaries() {
        assert_eq!(
            parse_create_request(br#"{"article_url":"x"}"#)
                .expect_err("missing fields")
                .detail[0]
                .error_type,
            "missing"
        );
        assert_eq!(
            parse_update_request(br#"[]"#)
                .expect_err("array body")
                .detail[0]
                .error_type,
            "model_type"
        );
        assert!(parse_highlight_id("2147483648").is_err());
    }
}
