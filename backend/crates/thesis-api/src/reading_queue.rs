use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_db::{
    DailyDigestRecord, QueueOverviewRecord, ReadingQueueCreate, ReadingQueueError,
    ReadingQueueItemRecord, ReadingQueueUpdate, ReadingShelfCreate, ReadingShelfRecord,
    ReadingShelfUpdate,
};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

/// The request body accepted by `POST /api/queue/add`.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct AddToQueueRequest {
    pub article_id: i32,
    pub article_title: String,
    pub article_url: String,
    pub article_source: String,
    #[schema(required = false)]
    pub article_image: Option<String>,
    #[serde(default = "default_queue_type")]
    #[schema(required = false, default = "daily")]
    pub queue_type: String,
    #[schema(required = false)]
    pub why_saved: Option<String>,
    #[schema(required = false)]
    pub unresolved_question: Option<String>,
    #[schema(required = false)]
    pub shelf_id: Option<i32>,
}

/// The partial update body accepted by `PATCH /api/queue/{queue_id}`.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct UpdateQueueItemRequest {
    #[schema(required = false)]
    pub read_status: Option<String>,
    #[schema(required = false)]
    pub queue_type: Option<String>,
    #[schema(required = false)]
    pub position: Option<i32>,
    #[schema(required = false)]
    pub archived_at: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub why_saved: Option<String>,
    #[schema(required = false)]
    pub unresolved_question: Option<String>,
    #[schema(required = false)]
    pub shelf_id: Option<i32>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct ReadingQueueItem {
    #[schema(required = false)]
    pub id: Option<i32>,
    #[schema(required = false)]
    pub user_id: Option<i32>,
    pub article_id: i32,
    pub article_title: String,
    pub article_url: String,
    pub article_source: String,
    #[schema(required = false)]
    pub article_image: Option<String>,
    #[schema(required = false, default = "daily")]
    pub queue_type: String,
    #[schema(required = false, default = 0)]
    pub position: i32,
    #[schema(required = false, default = "unread")]
    pub read_status: String,
    pub added_at: DateTime<Utc>,
    #[schema(required = false)]
    pub archived_at: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub created_at: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub updated_at: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub word_count: Option<i32>,
    #[schema(required = false)]
    pub estimated_read_time_minutes: Option<i32>,
    #[schema(required = false)]
    pub full_text: Option<String>,
    #[schema(required = false)]
    pub why_saved: Option<String>,
    #[schema(required = false)]
    pub unresolved_question: Option<String>,
    #[schema(required = false)]
    pub shelf_id: Option<i32>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct QueueResponse {
    pub items: Vec<ReadingQueueItem>,
    pub daily_count: i64,
    pub permanent_count: i64,
    pub total_count: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct QueueOverviewResponse {
    pub total_items: i64,
    pub daily_items: i64,
    pub permanent_items: i64,
    pub unread_count: i64,
    pub reading_count: i64,
    pub completed_count: i64,
    pub estimated_total_read_time_minutes: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct ReadingShelf {
    #[schema(required = false)]
    pub id: Option<i32>,
    #[schema(required = false, default = 1)]
    pub user_id: Option<i32>,
    pub name: String,
    #[schema(required = false)]
    pub description: Option<String>,
    #[schema(required = false)]
    pub created_at: Option<DateTime<Utc>>,
    #[schema(required = false)]
    pub updated_at: Option<DateTime<Utc>>,
}

/// OpenAPI marker for FastAPI's `dict[str, object]` responses.
#[derive(Debug)]
pub(crate) struct QueueFreeFormObjectSchema;

impl PartialSchema for QueueFreeFormObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for QueueFreeFormObjectSchema {}

/// OpenAPI marker for FastAPI's `dict[str, str]` maintenance responses.
#[derive(Debug)]
pub(crate) struct QueueStringMapSchema;

impl PartialSchema for QueueStringMapSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
            .build()
            .into()
    }
}

impl ToSchema for QueueStringMapSchema {}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct CreateShelfRequest {
    pub name: String,
    #[schema(required = false)]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct UpdateShelfRequest {
    #[schema(required = false)]
    pub name: Option<String>,
    #[schema(required = false)]
    pub description: Option<String>,
}

fn default_queue_type() -> String {
    "daily".to_owned()
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::AutoSi, false)
}

fn queue_item_response(item: ReadingQueueItemRecord) -> ReadingQueueItem {
    ReadingQueueItem {
        id: Some(item.id),
        user_id: item.user_id,
        article_id: item.article_id,
        article_title: item.article_title,
        article_url: item.article_url,
        article_source: item.article_source,
        article_image: item.article_image,
        queue_type: item.queue_type,
        position: item.position,
        read_status: item.read_status,
        added_at: item.added_at,
        archived_at: item.archived_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
        word_count: item.word_count,
        estimated_read_time_minutes: item.estimated_read_time_minutes,
        full_text: item.full_text,
        why_saved: item.why_saved,
        unresolved_question: item.unresolved_question,
        shelf_id: item.shelf_id,
    }
}

fn shelf_response(shelf: ReadingShelfRecord) -> ReadingShelf {
    ReadingShelf {
        id: Some(shelf.id),
        user_id: shelf.user_id,
        name: shelf.name,
        description: shelf.description,
        created_at: shelf.created_at,
        updated_at: shelf.updated_at,
    }
}

fn overview_response(value: QueueOverviewRecord) -> QueueOverviewResponse {
    QueueOverviewResponse {
        total_items: value.total_items,
        daily_items: value.daily_items,
        permanent_items: value.permanent_items,
        unread_count: value.unread_count,
        reading_count: value.reading_count,
        completed_count: value.completed_count,
        estimated_total_read_time_minutes: value.estimated_total_read_time_minutes,
    }
}

fn database_error(error: impl std::fmt::Display, context: &'static str) -> Response {
    tracing::error!(%error, context, "reading queue database operation failed");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
}

fn not_found(detail: &'static str) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"detail": detail})),
    )
        .into_response()
}

fn bad_request(detail: &'static str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({"detail": detail})),
    )
        .into_response()
}

fn queue_write_error(error: ReadingQueueError, context: &'static str) -> Response {
    match error {
        ReadingQueueError::ShelfNotFound => HttpValidationError::field(
            Value::Null,
            "shelf_id",
            "value_error",
            "Shelf does not belong to the current user",
        )
        .into_response(),
        ReadingQueueError::EmptyShelfName => bad_request("Shelf name is required"),
        ReadingQueueError::Database(error) => database_error(error, context),
    }
}

fn invalid_json(error: serde_json::Error) -> HttpValidationError {
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

fn parse_object(body: &[u8]) -> Result<Map<String, Value>, HttpValidationError> {
    let value: Value = serde_json::from_slice(body).map_err(invalid_json)?;
    match value {
        Value::Object(fields) => Ok(fields),
        value => Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        )),
    }
}

fn missing(fields: &Map<String, Value>, field: &str) -> HttpValidationError {
    HttpValidationError::field(
        Value::Object(fields.clone()),
        field,
        "missing",
        "Field required",
    )
}

fn invalid_field(
    value: &Value,
    field: &str,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    HttpValidationError::field(value.clone(), field, error_type, message)
}

fn required_i32(fields: &Map<String, Value>, field: &str) -> Result<i32, HttpValidationError> {
    let value = fields.get(field).ok_or_else(|| missing(fields, field))?;
    let Some(number) = value.as_i64() else {
        return Err(invalid_field(
            value,
            field,
            "int_type",
            "Input should be a valid integer",
        ));
    };
    i32::try_from(number).map_err(|_| {
        invalid_field(
            value,
            field,
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
        )
    })
}

fn optional_i32(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<Option<i32>, HttpValidationError> {
    let Some(value) = fields.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(number) = value.as_i64() else {
        return Err(invalid_field(
            value,
            field,
            "int_type",
            "Input should be a valid integer",
        ));
    };
    i32::try_from(number).map(Some).map_err(|_| {
        invalid_field(
            value,
            field,
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
        )
    })
}

fn required_string(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<String, HttpValidationError> {
    let value = fields.get(field).ok_or_else(|| missing(fields, field))?;
    value.as_str().map(str::to_owned).ok_or_else(|| {
        invalid_field(
            value,
            field,
            "string_type",
            "Input should be a valid string",
        )
    })
}

fn optional_string(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, HttpValidationError> {
    let Some(value) = fields.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(|value| Some(value.to_owned()))
        .ok_or_else(|| {
            invalid_field(
                value,
                field,
                "string_type",
                "Input should be a valid string",
            )
        })
}

fn required_or_default_string(
    fields: &Map<String, Value>,
    field: &str,
    default: &str,
) -> Result<String, HttpValidationError> {
    match fields.get(field) {
        None => Ok(default.to_owned()),
        Some(value) => value.as_str().map(str::to_owned).ok_or_else(|| {
            invalid_field(
                value,
                field,
                "string_type",
                "Input should be a valid string",
            )
        }),
    }
}

fn optional_datetime(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<Option<DateTime<Utc>>, HttpValidationError> {
    let Some(value) = fields.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(raw) = value.as_str() else {
        return Err(invalid_field(
            value,
            field,
            "datetime_type",
            "Input should be a valid datetime",
        ));
    };
    DateTime::parse_from_rfc3339(raw)
        .map(|value| Some(value.with_timezone(&Utc)))
        .map_err(|_| {
            invalid_field(
                value,
                field,
                "datetime_parsing",
                "Input should be a valid datetime",
            )
        })
}

fn parse_add_request(body: &[u8]) -> Result<AddToQueueRequest, HttpValidationError> {
    let fields = parse_object(body)?;
    let article_id = required_i32(&fields, "article_id")?;
    if article_id <= 0 {
        return Err(invalid_field(
            fields.get("article_id").expect("required field"),
            "article_id",
            "greater_than",
            "Input should be greater than 0",
        ));
    }
    Ok(AddToQueueRequest {
        article_id,
        article_title: required_string(&fields, "article_title")?,
        article_url: required_string(&fields, "article_url")?,
        article_source: required_string(&fields, "article_source")?,
        article_image: optional_string(&fields, "article_image")?,
        queue_type: required_or_default_string(&fields, "queue_type", "daily")?,
        why_saved: optional_string(&fields, "why_saved")?,
        unresolved_question: optional_string(&fields, "unresolved_question")?,
        shelf_id: optional_i32(&fields, "shelf_id")?,
    })
}

fn parse_update_request(body: &[u8]) -> Result<UpdateQueueItemRequest, HttpValidationError> {
    let fields = parse_object(body)?;
    Ok(UpdateQueueItemRequest {
        read_status: optional_string(&fields, "read_status")?,
        queue_type: optional_string(&fields, "queue_type")?,
        position: optional_i32(&fields, "position")?,
        archived_at: optional_datetime(&fields, "archived_at")?,
        why_saved: optional_string(&fields, "why_saved")?,
        unresolved_question: optional_string(&fields, "unresolved_question")?,
        shelf_id: optional_i32(&fields, "shelf_id")?,
    })
}

fn parse_create_shelf_request(body: &[u8]) -> Result<CreateShelfRequest, HttpValidationError> {
    let fields = parse_object(body)?;
    Ok(CreateShelfRequest {
        name: required_string(&fields, "name")?,
        description: optional_string(&fields, "description")?,
    })
}

fn parse_update_shelf_request(body: &[u8]) -> Result<UpdateShelfRequest, HttpValidationError> {
    let fields = parse_object(body)?;
    Ok(UpdateShelfRequest {
        name: optional_string(&fields, "name")?,
        description: optional_string(&fields, "description")?,
    })
}

fn parse_path_i32(value: &str, field: &str) -> Result<i32, HttpValidationError> {
    value.parse::<i32>().map_err(|_| HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("path".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: "Input should be a valid integer, unable to parse string as an integer".to_owned(),
            error_type: "int_parsing".to_owned(),
            input: Value::String(value.to_owned()),
            ctx: None,
        }],
    })
}

fn validate_queue_type(value: &str, field: &str) -> Result<(), HttpValidationError> {
    if matches!(value, "daily" | "permanent") {
        return Ok(());
    }
    Err(HttpValidationError::field(
        Value::String(value.to_owned()),
        field,
        "literal_error",
        "Input should be 'daily' or 'permanent'",
    ))
}

fn validate_read_status(value: &str) -> Result<(), HttpValidationError> {
    if matches!(value, "unread" | "reading" | "completed") {
        return Ok(());
    }
    Err(HttpValidationError::field(
        Value::String(value.to_owned()),
        "read_status",
        "literal_error",
        "Input should be 'unread', 'reading' or 'completed'",
    ))
}

#[utoipa::path(
    post,
    path = "/api/queue/add",
    operation_id = "add_to_queue_api_queue_add_post",
    tag = "reading_queue",
    request_body = AddToQueueRequest,
    responses(
        (status = 200, description = "Successful Response", body = ReadingQueueItem),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn add_to_queue(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_add_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    if let Err(error) = validate_queue_type(&request.queue_type, "queue_type") {
        return error.into_response();
    }
    let request = ReadingQueueCreate {
        article_id: request.article_id,
        article_title: request.article_title,
        article_url: request.article_url,
        article_source: request.article_source,
        article_image: request.article_image,
        queue_type: request.queue_type,
        why_saved: request.why_saved,
        unresolved_question: request.unresolved_question,
        shelf_id: request.shelf_id,
    };
    match state.database.add_reading_queue_item(request).await {
        Ok(item) => Json(queue_item_response(item)).into_response(),
        Err(error) => queue_write_error(error, "reading queue add"),
    }
}

#[utoipa::path(
    delete,
    path = "/api/queue/{queue_id}",
    operation_id = "remove_from_queue_api_queue__queue_id__delete",
    tag = "reading_queue",
    params(("queue_id" = i32, Path, description = "Queue id")),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn remove_from_queue(
    State(state): State<AppState>,
    Path(queue_id): Path<String>,
) -> Response {
    let queue_id = match parse_path_i32(&queue_id, "queue_id") {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    match state.database.remove_reading_queue_item(queue_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Queue item not found"),
        Err(error) => database_error(error, "reading queue remove"),
    }
}

#[utoipa::path(
    patch,
    path = "/api/queue/{queue_id}",
    operation_id = "update_queue_item_api_queue__queue_id__patch",
    tag = "reading_queue",
    params(("queue_id" = i32, Path, description = "Queue id")),
    request_body = UpdateQueueItemRequest,
    responses(
        (status = 200, description = "Successful Response", body = ReadingQueueItem),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn update_queue_item(
    State(state): State<AppState>,
    Path(queue_id): Path<String>,
    body: Bytes,
) -> Response {
    let queue_id = match parse_path_i32(&queue_id, "queue_id") {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let request = match parse_update_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    if let Some(queue_type) = request.queue_type.as_deref() {
        if let Err(error) = validate_queue_type(queue_type, "queue_type") {
            return error.into_response();
        }
    }
    if let Some(read_status) = request.read_status.as_deref() {
        if let Err(error) = validate_read_status(read_status) {
            return error.into_response();
        }
    }
    let request = ReadingQueueUpdate {
        read_status: request.read_status,
        queue_type: request.queue_type,
        position: request.position,
        archived_at: request.archived_at,
        why_saved: request.why_saved,
        unresolved_question: request.unresolved_question,
        shelf_id: request.shelf_id,
    };
    match state
        .database
        .update_reading_queue_item(queue_id, request)
        .await
    {
        Ok(Some(item)) => Json(queue_item_response(item)).into_response(),
        Ok(None) => not_found("Queue item not found"),
        Err(error) => queue_write_error(error, "reading queue update"),
    }
}

#[utoipa::path(
    delete,
    path = "/api/queue/url/{article_url}",
    operation_id = "remove_from_queue_by_url_api_queue_url__article_url__delete",
    tag = "reading_queue",
    params(("article_url" = String, Path, description = "Article URL")),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn remove_from_queue_by_url(
    State(state): State<AppState>,
    Path(article_url): Path<String>,
) -> Response {
    match state
        .database
        .remove_reading_queue_item_by_url(&article_url)
        .await
    {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Article not found in queue"),
        Err(error) => database_error(error, "reading queue URL remove"),
    }
}

#[utoipa::path(
    get,
    path = "/api/queue",
    operation_id = "get_queue_api_queue_get",
    tag = "reading_queue",
    responses((status = 200, description = "Successful Response", body = QueueResponse))
)]
pub(crate) async fn get_queue(State(state): State<AppState>) -> Response {
    let items = match state.database.list_reading_queue().await {
        Ok(items) => items,
        Err(error) => return database_error(error, "reading queue list"),
    };
    let daily_count = items
        .iter()
        .filter(|item| item.queue_type == "daily")
        .count() as i64;
    let permanent_count = items
        .iter()
        .filter(|item| item.queue_type == "permanent")
        .count() as i64;
    let items = items
        .into_iter()
        .map(queue_item_response)
        .collect::<Vec<_>>();
    Json(QueueResponse {
        total_count: items.len() as i64,
        daily_count,
        permanent_count,
        items,
    })
    .into_response()
}

#[utoipa::path(
    post,
    path = "/api/queue/maintenance/move-expired",
    operation_id = "move_expired_items_api_queue_maintenance_move_expired_post",
    tag = "reading_queue",
    responses((status = 200, description = "Successful Response", body = inline(QueueStringMapSchema)))
)]
pub(crate) async fn move_expired_items(State(state): State<AppState>) -> Response {
    match state.database.move_expired_reading_queue_items().await {
        Ok(count) => Json(serde_json::json!({
            "message": format!("Moved {count} items to permanent queue")
        }))
        .into_response(),
        Err(error) => database_error(error, "reading queue expiration maintenance"),
    }
}

#[utoipa::path(
    get,
    path = "/api/queue/overview",
    operation_id = "get_queue_overview_api_queue_overview_get",
    tag = "reading_queue",
    responses((status = 200, description = "Successful Response", body = QueueOverviewResponse))
)]
pub(crate) async fn get_queue_overview(State(state): State<AppState>) -> Response {
    match state.database.reading_queue_overview().await {
        Ok(value) => Json(overview_response(value)).into_response(),
        Err(error) => database_error(error, "reading queue overview"),
    }
}

#[utoipa::path(
    get,
    path = "/api/queue/shelves",
    operation_id = "get_shelves_api_queue_shelves_get",
    tag = "reading_queue",
    responses((status = 200, description = "Successful Response", body = [ReadingShelf]))
)]
pub(crate) async fn get_shelves(State(state): State<AppState>) -> Response {
    match state.database.list_reading_shelves().await {
        Ok(shelves) => {
            Json(shelves.into_iter().map(shelf_response).collect::<Vec<_>>()).into_response()
        }
        Err(error) => database_error(error, "reading shelves list"),
    }
}

#[utoipa::path(
    post,
    path = "/api/queue/shelves",
    operation_id = "create_shelf_api_queue_shelves_post",
    tag = "reading_queue",
    request_body = CreateShelfRequest,
    responses(
        (status = 200, description = "Successful Response", body = ReadingShelf),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn create_shelf(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_create_shelf_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    match state
        .database
        .create_reading_shelf(ReadingShelfCreate {
            name: request.name,
            description: request.description,
        })
        .await
    {
        Ok(shelf) => Json(shelf_response(shelf)).into_response(),
        Err(error) => queue_write_error(error, "reading shelf create"),
    }
}

#[utoipa::path(
    patch,
    path = "/api/queue/shelves/{shelf_id}",
    operation_id = "update_shelf_api_queue_shelves__shelf_id__patch",
    tag = "reading_queue",
    params(("shelf_id" = i32, Path, description = "Shelf id")),
    request_body = UpdateShelfRequest,
    responses(
        (status = 200, description = "Successful Response", body = ReadingShelf),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn update_shelf(
    State(state): State<AppState>,
    Path(shelf_id): Path<String>,
    body: Bytes,
) -> Response {
    let shelf_id = match parse_path_i32(&shelf_id, "shelf_id") {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let request = match parse_update_shelf_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    match state
        .database
        .update_reading_shelf(
            shelf_id,
            ReadingShelfUpdate {
                name: request.name,
                description: request.description,
            },
        )
        .await
    {
        Ok(Some(shelf)) => Json(shelf_response(shelf)).into_response(),
        Ok(None) => not_found("Shelf not found"),
        Err(error) => queue_write_error(error, "reading shelf update"),
    }
}

#[utoipa::path(
    post,
    path = "/api/queue/maintenance/archive",
    operation_id = "archive_completed_items_api_queue_maintenance_archive_post",
    tag = "reading_queue",
    responses((status = 200, description = "Successful Response", body = inline(QueueStringMapSchema)))
)]
pub(crate) async fn archive_completed_items(State(state): State<AppState>) -> Response {
    match state.database.archive_completed_reading_queue_items().await {
        Ok(count) => Json(serde_json::json!({
            "message": format!("Archived {count} completed items")
        }))
        .into_response(),
        Err(error) => database_error(error, "reading queue archive maintenance"),
    }
}

#[utoipa::path(
    get,
    path = "/api/queue/{queue_id}/content",
    operation_id = "get_queue_item_content_api_queue__queue_id__content_get",
    tag = "reading_queue",
    params(("queue_id" = i32, Path, description = "Queue id")),
    responses(
        (status = 200, description = "Successful Response", body = inline(QueueFreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_queue_item_content(
    State(state): State<AppState>,
    Path(queue_id): Path<String>,
) -> Response {
    let queue_id = match parse_path_i32(&queue_id, "queue_id") {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let item = match state.database.get_reading_queue_item(queue_id).await {
        Ok(Some(item)) => item,
        Ok(None) => return not_found("Queue item not found"),
        Err(error) => return database_error(error, "reading queue content"),
    };
    Json(serde_json::json!({
        "id": item.id,
        "article_url": item.article_url,
        "article_title": item.article_title,
        "article_source": item.article_source,
        "full_text": item.full_text.unwrap_or_default(),
        "word_count": item.word_count,
        "estimated_read_time_minutes": item.estimated_read_time_minutes,
        "read_status": item.read_status,
    }))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/api/queue/digest/daily",
    operation_id = "get_daily_digest_api_queue_digest_daily_get",
    tag = "reading_queue",
    responses((status = 200, description = "Successful Response", body = inline(QueueFreeFormObjectSchema)))
)]
pub(crate) async fn get_daily_digest(State(state): State<AppState>) -> Response {
    let DailyDigestRecord {
        digest_items,
        total_items,
        estimated_read_time_minutes,
        generated_at,
    } = match state.database.daily_reading_queue_digest().await {
        Ok(value) => value,
        Err(error) => return database_error(error, "reading queue daily digest"),
    };
    let digest_items = digest_items
        .into_iter()
        .map(queue_item_response)
        .collect::<Vec<_>>();
    Json(serde_json::json!({
        "digest_items": digest_items,
        "total_items": total_items,
        "estimated_read_time_minutes": estimated_read_time_minutes,
        "generated_at": timestamp(generated_at),
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::{parse_add_request, parse_path_i32, parse_update_request, validate_queue_type};

    #[test]
    fn add_parser_keeps_required_fields_and_default_queue_type() {
        let request = parse_add_request(
            br#"{"article_id":7,"article_title":"Story","article_url":"https://example.test/story","article_source":"Example"}"#,
        )
        .expect("valid request");
        assert_eq!(request.article_id, 7);
        assert_eq!(request.queue_type, "daily");
    }

    #[test]
    fn queue_parser_rejects_non_integral_numbers_and_invalid_queue_types() {
        assert!(parse_add_request(
            br#"{"article_id":7.0,"article_title":"Story","article_url":"https://example.test/story","article_source":"Example"}"#,
        )
        .is_err());
        assert!(validate_queue_type("later", "queue_type").is_err());
    }

    #[test]
    fn update_parser_accepts_empty_partial_body_and_datetime() {
        let request = parse_update_request(br#"{"archived_at":"2026-09-01T12:00:00Z"}"#)
            .expect("valid update");
        assert!(request.read_status.is_none());
        assert!(request.archived_at.is_some());
    }

    #[test]
    fn path_integer_overflow_is_reported_as_validation() {
        assert!(parse_path_i32("2147483648", "queue_id").is_err());
    }
}
