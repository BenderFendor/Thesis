//! Rust shadow routes for debug-log file inspection and frontend reports.
//!
//! The routes share the Python runtime's `DEBUG_LOG_DIR` path convention. The
//! report buffer is process-local, matching the existing debug logger's
//! in-memory retention; accepted reports are also appended to this process's
//! JSONL session file.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{
    AdditionalProperties, AnyOfBuilder, ArrayBuilder, ObjectBuilder, Type,
};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
mod articles;
mod backfill;
mod log_views;
mod overview;
mod parser;
mod providers;

use crate::cache_stream::CacheStreamState;
use crate::jobs_image::JobsImageState;
use crate::profiling::ProfilingState;
use crate::source_catalog::SourceCatalogState;
use thesis_db::Database;

pub(crate) use articles::{
    get_cache_db_delta, get_storage_drift, list_chromadb_articles, list_database_articles,
};
pub(crate) use backfill::{backfill_article_images, backfill_article_mentions};
pub(crate) use log_views::{
    get_debug_errors, get_debug_report, get_llm_logs, get_log_level, get_performance_summary,
    get_slow_operations, get_streams, set_log_level,
};
pub(crate) use overview::{
    get_pipeline_metrics, get_startup_metrics, get_stream_status, get_system_status,
    get_updates_subscribers, list_active_jobs, StartupEventResponse, StartupMetricsResponse,
};
pub(crate) use parser::{get_source_debug_data, test_article_parser, test_rss_parser};
pub use providers::{
    ArticleImageParseResult, CountryAliases, DebugConfig, DebugFuture, DebugImageBackfillProvider,
    DebugLogLevelProvider, DebugLoggerSnapshot, DebugParsingProvider, DebugProviderError,
    DebugProviders, DebugRuntimeProvider, DebugRuntimeSnapshot, DebugStreamsSnapshot,
    DebugUpdateSubscribers, ImageBackfillResult, InspectedSourceFeed, MissingImageArticle,
    ParsedFeed,
};

#[derive(Clone)]
pub struct DebugState {
    pub(crate) database: Database,
    pub(crate) cache_stream: CacheStreamState,
    pub(crate) jobs_image: JobsImageState,
    pub(crate) source_catalog: SourceCatalogState,
    pub(crate) profiling: ProfilingState,
    pub(crate) config: DebugConfig,
    pub(crate) providers: DebugProviders,
    logger: Arc<Mutex<DebugLoggerState>>,
}

struct DebugLoggerState {
    session_id: String,
    log_file: PathBuf,
    event_counter: u64,
    log_header_written: bool,
    frontend_reports: VecDeque<FrontendDebugReport>,
    events: VecDeque<Value>,
}

impl DebugState {
    pub fn build(
        database: Database,
        cache_stream: CacheStreamState,
        jobs_image: JobsImageState,
        source_catalog: SourceCatalogState,
        profiling: ProfilingState,
        config: DebugConfig,
        providers: DebugProviders,
    ) -> Self {
        let session_id = format!(
            "{}_{}",
            Utc::now().format("%Y%m%d_%H%M%S"),
            std::process::id()
        );
        let log_file = config
            .debug_log_directory
            .join(format!("{LOG_FILE_PREFIX}{session_id}{LOG_FILE_SUFFIX}"));
        let mut logger = DebugLoggerState {
            session_id,
            log_file,
            event_counter: 0,
            log_header_written: false,
            frontend_reports: VecDeque::new(),
            events: VecDeque::new(),
        };
        if let Err(error) = initialize_debug_log_file(&config.debug_log_directory, &mut logger) {
            tracing::error!(%error, "failed to initialize frontend debug log file");
        }
        Self {
            database,
            cache_stream,
            jobs_image,
            source_catalog,
            profiling,
            config,
            providers,
            logger: Arc::new(Mutex::new(logger)),
        }
    }

    #[cfg(test)]
    fn with_log_directory(log_directory: impl Into<PathBuf>) -> Self {
        Self::with_log_directory_and_providers(log_directory, DebugProviders::default())
    }

    #[cfg(test)]
    fn with_log_directory_and_providers(
        log_directory: impl Into<PathBuf>,
        providers: DebugProviders,
    ) -> Self {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        Self::build(
            database,
            CacheStreamState::new(),
            JobsImageState::default(),
            SourceCatalogState::default(),
            ProfilingState::default(),
            DebugConfig::for_test(log_directory),
            providers,
        )
    }

    fn logger(&self) -> MutexGuard<'_, DebugLoggerState> {
        self.logger
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    async fn runtime_snapshot(&self) -> Result<DebugRuntimeSnapshot, DebugProviderError> {
        self.providers
            .runtime
            .as_ref()
            .ok_or(DebugProviderError::Unavailable)?
            .snapshot()
            .await
    }
}

pub fn router(state: DebugState) -> Router {
    let file_routes = Router::new()
        .route(
            "/debug/logs/frontend",
            get(get_frontend_debug_reports).post(ingest_frontend_debug_report),
        )
        .route("/debug/logs/events", get(get_debug_events))
        .route(
            "/debug/logs/files",
            get(list_debug_log_files).delete(clear_old_log_files),
        )
        .route("/debug/logs/file/{filename}", get(read_debug_log_file))
        .with_state(state.clone());
    Router::new()
        .merge(file_routes)
        .merge(articles::router(state.clone()))
        .merge(backfill::router(state.clone()))
        .merge(log_views::router(state.clone()))
        .merge(overview::router(state.clone()))
        .merge(parser::router(state))
}

fn provider_unavailable(detail: &str) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": detail})),
    )
        .into_response()
}

fn provider_failed(error: DebugProviderError, detail: &str) -> Response {
    match error {
        DebugProviderError::Unavailable => provider_unavailable(detail),
        DebugProviderError::Failed(message) => {
            tracing::error!(%message, "{detail}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"detail": "Debug provider request failed"})),
            )
                .into_response()
        }
    }
}

fn debug_query_error(
    field: &str,
    raw: &str,
    error_type: &str,
    message: &str,
    minimum: Option<i64>,
    maximum: Option<i64>,
) -> HttpValidationError {
    let mut context = Map::new();
    if let Some(minimum) = minimum {
        context.insert("ge".to_owned(), Value::from(minimum));
    }
    if let Some(maximum) = maximum {
        context.insert("le".to_owned(), Value::from(maximum));
    }
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input: Value::String(raw.to_owned()),
            ctx: (!context.is_empty()).then_some(context),
        }],
    }
}

fn query_validation_response(error: HttpValidationError) -> Response {
    (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response()
}

const MAX_FRONTEND_REPORTS: usize = 20;
const MAX_DEBUG_EVENTS: usize = 1_000;
const DEFAULT_LOG_LIMIT: i64 = 100;
const MAX_LOG_LIMIT: i64 = 1_000;
const LOG_FILE_PREFIX: &str = "debug_";
const LOG_FILE_SUFFIX: &str = ".jsonl";
const DEBUG_EVENT_TYPES: &[&str] = &[
    "request_start",
    "request_end",
    "request_error",
    "stream_start",
    "stream_event",
    "stream_end",
    "stream_error",
    "stream_client_disconnect",
    "db_query_start",
    "db_query_end",
    "db_query_error",
    "cache_hit",
    "cache_miss",
    "cache_update",
    "rss_fetch_start",
    "rss_fetch_end",
    "rss_fetch_error",
    "rss_parse_error",
    "executor_submit",
    "executor_complete",
    "executor_timeout",
    "performance_warning",
    "bottleneck_detected",
    "hang_suspected",
    "custom",
];

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = FrontendDebugReport)]
pub(crate) struct FrontendDebugReport {
    /// Frontend performance session ID.
    pub session_id: String,
    #[schema(schema_with = free_form_object_schema)]
    pub summary: BTreeMap<String, Value>,
    #[schema(required = false, schema_with = free_form_object_array_schema)]
    pub recent_events: Vec<BTreeMap<String, Value>>,
    #[schema(required = false, schema_with = free_form_object_array_schema)]
    pub slow_operations: Vec<BTreeMap<String, Value>>,
    #[schema(required = false, schema_with = free_form_object_array_schema)]
    pub errors: Vec<BTreeMap<String, Value>>,
    #[schema(required = false, schema_with = optional_free_form_object_schema)]
    pub dom_stats: Option<BTreeMap<String, Value>>,
    #[schema(required = false)]
    pub location: Option<String>,
    #[schema(required = false)]
    pub user_agent: Option<String>,
    #[schema(required = false)]
    pub generated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct FrontendDebugReportsResponse {
    count: usize,
    reports: Vec<FrontendDebugReport>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
struct FrontendDebugAcceptedResponse {
    status: String,
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

fn free_form_object_array_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(free_form_object_schema())
        .build()
        .into()
}

#[utoipa::path(
    get,
    path = "/debug/logs/frontend",
    operation_id = "get_frontend_debug_reports_debug_logs_frontend_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = FrontendDebugReportsResponse))
)]
pub(crate) async fn get_frontend_debug_reports(
    State(state): State<DebugState>,
) -> Json<FrontendDebugReportsResponse> {
    let logger = state.logger();
    let reports = logger.frontend_reports.iter().cloned().collect::<Vec<_>>();
    let count = reports.len();
    Json(FrontendDebugReportsResponse { count, reports })
}

#[utoipa::path(
    post,
    path = "/debug/logs/frontend",
    operation_id = "ingest_frontend_debug_report_debug_logs_frontend_post",
    tag = "debug",
    request_body = FrontendDebugReport,
    responses(
        (status = 200, description = "Successful Response", body = FrontendDebugAcceptedResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn ingest_frontend_debug_report(
    State(state): State<DebugState>,
    body: Bytes,
) -> Response {
    let report = match parse_frontend_debug_report(&body) {
        Ok(report) => report,
        Err(error) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response(),
    };
    let report_value = match serde_json::to_value(&report) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, "failed to serialize frontend debug report");
            return internal_error("Failed to serialize frontend debug report");
        }
    };

    let mut logger = state.logger();
    logger.frontend_reports.push_back(report.clone());
    if logger.frontend_reports.len() > MAX_FRONTEND_REPORTS {
        logger.frontend_reports.pop_front();
    }
    logger.event_counter = logger.event_counter.saturating_add(1);
    let timestamp = utc_timestamp();
    let event = json!({
        "event_id": format!("evt_{}_{:06}", logger.session_id.as_str(), logger.event_counter),
        "event_type": "custom",
        "timestamp": timestamp,
        "component": "frontend",
        "operation": "debug_report",
        "duration_ms": null,
        "start_time": null,
        "request_id": null,
        "stream_id": null,
        "source_name": null,
        "category": null,
        "message": "Frontend debug report received",
        "details": report_value,
        "metrics": {},
        "error": null,
        "error_type": null,
        "stack_trace": null,
        "is_slow": false,
        "is_bottleneck": false,
        "threshold_exceeded": null
    });
    logger.events.push_back(event.clone());
    if logger.events.len() > MAX_DEBUG_EVENTS {
        logger.events.pop_front();
    }
    if let Err(error) =
        append_frontend_event(&state.config.debug_log_directory, &mut logger, &event)
    {
        tracing::error!(%error, "failed to write frontend debug report event");
    }

    Json(FrontendDebugAcceptedResponse {
        status: "ok".to_owned(),
    })
    .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/events",
    operation_id = "get_debug_events_debug_logs_events_get",
    tag = "debug",
    params(
        ("limit" = Option<i64>, Query, description = "Maximum number of recent events to return (default: 100)", minimum = 1, maximum = 1000, example = 100),
        ("event_type" = Option<String>, Query, description = "Filter by event type", nullable = true)
    ),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 400, description = "Invalid event type", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError),
        (status = 503, description = "Debug runtime provider is not available", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_debug_events(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = match parse_integer_query(&params, "limit", DEFAULT_LOG_LIMIT, 1, MAX_LOG_LIMIT) {
        Ok(value) => value as usize,
        Err(error) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response(),
    };
    let event_type = params.get("event_type").cloned();
    if let Some(filter) = event_type.as_deref().filter(|filter| !filter.is_empty()) {
        if !DEBUG_EVENT_TYPES.contains(&filter) {
            return bad_request(&format!(
                "Invalid event_type. Must be one of: {}",
                DEBUG_EVENT_TYPES.join(", ")
            ));
        }
    }

    let runtime = match state.runtime_snapshot().await {
        Ok(runtime) => runtime,
        Err(error) => return provider_failed(error, "Debug runtime provider is not available"),
    };
    let mut events = runtime.logger.events;
    {
        let logger = state.logger();
        events.extend(logger.events.iter().cloned());
    }
    events.sort_by_key(|event| {
        event
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|timestamp| DateTime::parse_from_rfc3339(timestamp).ok())
            .map(|timestamp| timestamp.timestamp_micros())
            .unwrap_or_default()
    });
    let mut event_ids = HashSet::new();
    events.retain(|event| {
        let Some(event_id) = event.get("event_id").and_then(Value::as_str) else {
            return true;
        };
        event_ids.insert(event_id.to_owned())
    });
    events.retain(|event| match event_type.as_deref() {
        Some(filter) if !filter.is_empty() => {
            event.get("event_type").and_then(Value::as_str) == Some(filter)
        }
        _ => true,
    });
    if events.len() > limit {
        events.drain(..events.len() - limit);
    }
    let count = events.len();
    Json(json!({
        "count": count,
        "limit": limit,
        "filter": event_type,
        "events": events
    }))
    .into_response()
}

fn parse_frontend_debug_report(body: &[u8]) -> Result<FrontendDebugReport, HttpValidationError> {
    let input = std::str::from_utf8(body)
        .map(str::to_owned)
        .unwrap_or_else(|_| String::from_utf8_lossy(body).into_owned());
    let value = serde_json::from_slice::<Value>(body).map_err(|error| {
        let mut context = Map::new();
        context.insert("error".to_owned(), Value::String(error.to_string()));
        HttpValidationError {
            detail: vec![ValidationError {
                loc: vec![
                    ValidationLocation::Text("body".to_owned()),
                    ValidationLocation::Index(error.column().saturating_sub(1) as i64),
                ],
                msg: "JSON decode error".to_owned(),
                error_type: "json_invalid".to_owned(),
                input: Value::String(input),
                ctx: Some(context),
            }],
        }
    })?;
    let Some(object) = value.as_object() else {
        return Err(body_error(
            vec![ValidationLocation::Text("body".to_owned())],
            value,
            "model_attributes_type",
            "Input should be a valid dictionary or object to extract fields from",
            None,
        ));
    };

    let mut validation_errors = Vec::new();
    let session_id = capture_validation(
        required_string(object, "session_id"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    let summary = capture_validation(required_object(object, "summary"), &mut validation_errors)
        .unwrap_or_default();
    let recent_events = capture_validation(
        optional_object_array(object, "recent_events"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    let slow_operations = capture_validation(
        optional_object_array(object, "slow_operations"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    let errors = capture_validation(
        optional_object_array(object, "errors"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    let dom_stats = capture_validation(
        optional_nullable_object(object, "dom_stats"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    let location = capture_validation(optional_string(object, "location"), &mut validation_errors)
        .unwrap_or_default();
    let user_agent = capture_validation(
        optional_string(object, "user_agent"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    let generated_at = capture_validation(
        optional_string(object, "generated_at"),
        &mut validation_errors,
    )
    .unwrap_or_default();
    if !validation_errors.is_empty() {
        return Err(HttpValidationError {
            detail: validation_errors,
        });
    }

    Ok(FrontendDebugReport {
        session_id,
        summary,
        recent_events,
        slow_operations,
        errors,
        dom_stats,
        location,
        user_agent,
        generated_at,
    })
}

fn capture_validation<T>(
    result: Result<T, HttpValidationError>,
    validation_errors: &mut Vec<ValidationError>,
) -> Option<T> {
    match result {
        Ok(value) => Some(value),
        Err(error) => {
            validation_errors.extend(error.detail);
            None
        }
    }
}

fn required_string(
    object: &Map<String, Value>,
    field: &str,
) -> Result<String, HttpValidationError> {
    match object.get(field) {
        Some(Value::String(value)) => Ok(value.clone()),
        Some(value) => Err(field_type_error(
            field,
            value.clone(),
            "string_type",
            "Input should be a valid string",
        )),
        None => Err(missing_field_error(field, Value::Object(object.clone()))),
    }
}

fn required_object(
    object: &Map<String, Value>,
    field: &str,
) -> Result<BTreeMap<String, Value>, HttpValidationError> {
    match object.get(field) {
        Some(Value::Object(value)) => Ok(value
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()),
        Some(value) => Err(field_type_error(
            field,
            value.clone(),
            "dict_type",
            "Input should be a valid dictionary",
        )),
        None => Err(missing_field_error(field, Value::Object(object.clone()))),
    }
}

fn optional_nullable_object(
    object: &Map<String, Value>,
    field: &str,
) -> Result<Option<BTreeMap<String, Value>>, HttpValidationError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(value)) => Ok(Some(
            value
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        )),
        Some(value) => Err(field_type_error(
            field,
            value.clone(),
            "dict_type",
            "Input should be a valid dictionary",
        )),
    }
}

fn optional_string(
    object: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, HttpValidationError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(value) => Err(field_type_error(
            field,
            value.clone(),
            "string_type",
            "Input should be a valid string",
        )),
    }
}

fn optional_object_array(
    object: &Map<String, Value>,
    field: &str,
) -> Result<Vec<BTreeMap<String, Value>>, HttpValidationError> {
    let Some(value) = object.get(field) else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(field_type_error(
            field,
            value.clone(),
            "list_type",
            "Input should be a valid list",
        ));
    };
    let mut parsed = Vec::with_capacity(items.len());
    let mut validation_errors = Vec::new();
    for (index, value) in items.iter().enumerate() {
        if let Some(object) = value.as_object() {
            parsed.push(
                object
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            );
        } else {
            validation_errors.extend(
                body_error(
                    vec![
                        ValidationLocation::Text("body".to_owned()),
                        ValidationLocation::Text(field.to_owned()),
                        ValidationLocation::Index(index as i64),
                    ],
                    value.clone(),
                    "dict_type",
                    "Input should be a valid dictionary",
                    None,
                )
                .detail,
            );
        }
    }
    if validation_errors.is_empty() {
        Ok(parsed)
    } else {
        Err(HttpValidationError {
            detail: validation_errors,
        })
    }
}

fn missing_field_error(field: &str, input: Value) -> HttpValidationError {
    field_type_error(field, input, "missing", "Field required")
}

fn field_type_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    body_error(
        vec![
            ValidationLocation::Text("body".to_owned()),
            ValidationLocation::Text(field.to_owned()),
        ],
        input,
        error_type,
        message,
        None,
    )
}

fn body_error(
    loc: Vec<ValidationLocation>,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc,
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx,
        }],
    }
}

fn append_frontend_event(
    directory: &Path,
    logger: &mut DebugLoggerState,
    event: &Value,
) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    if !logger.log_header_written {
        append_json_line(&logger.log_file, &session_start_event(logger))?;
        logger.log_header_written = true;
    }
    append_json_line(&logger.log_file, event)
}

fn initialize_debug_log_file(directory: &Path, logger: &mut DebugLoggerState) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    match fs::remove_file(&logger.log_file) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    append_json_line(&logger.log_file, &session_start_event(logger))?;
    logger.log_header_written = true;
    Ok(())
}

fn session_start_event(logger: &DebugLoggerState) -> Value {
    json!({
        "type": "session_start",
        "session_id": logger.session_id.as_str(),
        "timestamp": utc_timestamp(),
        "thresholds": {
            "request_slow": 5.0,
            "db_query_slow": 1.0,
            "rss_fetch_slow": 10.0,
            "stream_event_gap": 5.0,
            "cache_miss_threshold": 0.5
        }
    })
}

fn append_json_line(path: &Path, value: &Value) -> io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    serde_json::to_writer(&mut file, value).map_err(io::Error::other)?;
    file.write_all(b"\n")
}

fn utc_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

#[utoipa::path(
    get,
    path = "/debug/logs/files",
    operation_id = "list_debug_log_files_debug_logs_files_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)))
)]
pub(crate) async fn list_debug_log_files(State(state): State<DebugState>) -> Response {
    let log_files = match debug_log_files(&state.config.debug_log_directory) {
        Ok(files) => files,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return internal_error(&format!("Failed to list debug log files: {error}")),
    };
    let file_count = log_files.len();
    let files = match log_files
        .iter()
        .take(20)
        .map(|path| log_file_details(path))
        .collect::<io::Result<Vec<_>>>()
    {
        Ok(files) => files,
        Err(error) => return internal_error(&format!("Failed to inspect debug log file: {error}")),
    };
    Json(json!({
        "log_directory": state.config.debug_log_directory.to_string_lossy(),
        "file_count": file_count,
        "files": files
    }))
    .into_response()
}

#[utoipa::path(
    delete,
    path = "/debug/logs/files",
    operation_id = "clear_old_log_files_debug_logs_files_delete",
    tag = "debug",
    params(("keep_recent" = Option<i64>, Query, description = "Number of recent files to keep (default: 5)", minimum = 1, maximum = 20, example = 5)),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn clear_old_log_files(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let keep_recent = match parse_integer_query(&params, "keep_recent", 5, 1, 20) {
        Ok(value) => value as usize,
        Err(error) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response(),
    };
    let log_files = match debug_log_files(&state.config.debug_log_directory) {
        Ok(files) => files,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Json(json!({"message": "No log directory exists", "deleted": 0}))
                .into_response();
        }
        Err(error) => return internal_error(&format!("Failed to list debug log files: {error}")),
    };
    let mut deleted = Vec::new();
    for log_file in log_files.iter().skip(keep_recent) {
        let filename = log_file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        match fs::symlink_metadata(log_file) {
            Ok(metadata) => match fs::remove_file(log_file) {
                Ok(()) => deleted.push(json!({"filename": filename, "size_bytes": metadata.len()})),
                Err(error) => {
                    deleted.push(json!({"filename": filename, "error": error.to_string()}))
                }
            },
            Err(error) => deleted.push(json!({"filename": filename, "error": error.to_string()})),
        }
    }
    Json(json!({
        "message": format!("Deleted {} old log files", deleted.len()),
        "kept": keep_recent,
        "deleted": deleted
    }))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/file/{filename}",
    operation_id = "read_debug_log_file_debug_logs_file__filename__get",
    tag = "debug",
    params(
        ("filename" = String, Path, description = "Debug JSONL filename"),
        ("limit" = Option<i64>, Query, description = "Maximum number of events to return (default: 100)", minimum = 1, maximum = 1000, example = 100),
        ("offset" = Option<i64>, Query, description = "Number of events to skip (default: 0)", minimum = 0, example = 0),
        ("event_type" = Option<String>, Query, description = "Filter by event type", nullable = true)
    ),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn read_debug_log_file(
    State(state): State<DebugState>,
    AxumPath(filename): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = match parse_integer_query(&params, "limit", DEFAULT_LOG_LIMIT, 1, MAX_LOG_LIMIT) {
        Ok(value) => value as usize,
        Err(error) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response(),
    };
    let offset = match parse_integer_query(&params, "offset", 0, 0, i64::MAX) {
        Ok(value) => value as usize,
        Err(error) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response(),
    };
    let event_type = params.get("event_type").cloned();
    let path = match valid_debug_log_path(&state.config.debug_log_directory, &filename) {
        Ok(path) => path,
        Err(DebugLogPathError::InvalidFilename) => {
            return bad_request("Invalid log file name");
        }
        Err(DebugLogPathError::NotFound) => {
            return not_found(&format!("Log file not found: {filename}"));
        }
        Err(DebugLogPathError::Io(error)) => {
            return internal_error(&format!("Failed to read log file: {error}"));
        }
    };
    let (total_lines, events) = match read_debug_events(&path, offset, limit, event_type.as_deref())
    {
        Ok(events) => events,
        Err(error) => return internal_error(&format!("Failed to read log file: {error}")),
    };
    Json(json!({
        "filename": filename,
        "total_lines": total_lines,
        "offset": offset,
        "limit": limit,
        "returned": events.len(),
        "filter": event_type,
        "events": events
    }))
    .into_response()
}

#[derive(Debug)]
struct FreeFormObjectSchema;

impl PartialSchema for FreeFormObjectSchema {
    fn schema() -> RefOr<Schema> {
        free_form_object_schema()
    }
}

impl ToSchema for FreeFormObjectSchema {}

fn parse_integer_query(
    params: &HashMap<String, String>,
    field: &str,
    default: i64,
    minimum: i64,
    maximum: i64,
) -> Result<i64, HttpValidationError> {
    let Some(raw) = params.get(field) else {
        return Ok(default);
    };
    let value = raw.trim().parse::<i64>().map_err(|_| {
        query_error(
            field,
            Value::String(raw.clone()),
            "int_parsing",
            "Input should be a valid integer",
            None,
        )
    })?;
    if value < minimum {
        let mut context = Map::new();
        context.insert("ge".to_owned(), Value::from(minimum));
        return Err(query_error(
            field,
            Value::String(raw.clone()),
            "greater_than_equal",
            &format!("Input should be greater than or equal to {minimum}"),
            Some(context),
        ));
    }
    if value > maximum {
        let mut context = Map::new();
        context.insert("le".to_owned(), Value::from(maximum));
        return Err(query_error(
            field,
            Value::String(raw.clone()),
            "less_than_equal",
            &format!("Input should be less than or equal to {maximum}"),
            Some(context),
        ));
    }
    Ok(value)
}

fn query_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx,
        }],
    }
}

fn debug_log_files(directory: &Path) -> io::Result<Vec<PathBuf>> {
    let entries = fs::read_dir(directory)?;
    let mut log_files = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(LOG_FILE_PREFIX) || !name.ends_with(LOG_FILE_SUFFIX) {
            continue;
        }
        if fs::symlink_metadata(&path)?.file_type().is_file() {
            log_files.push(path);
        }
    }
    log_files.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    Ok(log_files)
}

fn log_file_details(path: &Path) -> io::Result<Value> {
    let metadata = fs::symlink_metadata(path)?;
    let size_bytes = metadata.len();
    let size_kb = ((size_bytes as f64 / 1024.0) * 100.0).round() / 100.0;
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(json!({
        "filename": filename,
        "size_bytes": size_bytes,
        "size_kb": size_kb,
        "modified": modified_timestamp(&metadata),
        "created": changed_timestamp(&metadata)
    }))
}

#[cfg(unix)]
fn modified_timestamp(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    timestamp_from_unix(metadata.mtime(), metadata.mtime_nsec())
}

#[cfg(not(unix))]
fn modified_timestamp(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Micros, true))
}

#[cfg(unix)]
fn changed_timestamp(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    timestamp_from_unix(metadata.ctime(), metadata.ctime_nsec())
}

#[cfg(not(unix))]
fn changed_timestamp(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .created()
        .ok()
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Micros, true))
}

#[cfg(unix)]
fn timestamp_from_unix(seconds: i64, nanoseconds: i64) -> Option<String> {
    let nanoseconds = u32::try_from(nanoseconds).ok()?;
    DateTime::<Utc>::from_timestamp(seconds, nanoseconds)
        .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Micros, false))
}

#[derive(Debug)]
enum DebugLogPathError {
    InvalidFilename,
    NotFound,
    Io(io::Error),
}

fn valid_debug_log_path(directory: &Path, filename: &str) -> Result<PathBuf, DebugLogPathError> {
    let path_name = Path::new(filename);
    if path_name.components().count() != 1
        || !matches!(path_name.components().next(), Some(Component::Normal(_)))
    {
        return Err(DebugLogPathError::InvalidFilename);
    }
    let path = directory.join(filename);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(DebugLogPathError::NotFound);
        }
        Err(error) => return Err(DebugLogPathError::Io(error)),
    };
    if !filename.starts_with(LOG_FILE_PREFIX)
        || !filename.ends_with(LOG_FILE_SUFFIX)
        || !metadata.file_type().is_file()
    {
        return Err(DebugLogPathError::InvalidFilename);
    }
    Ok(path)
}

fn read_debug_events(
    path: &Path,
    offset: usize,
    limit: usize,
    event_type: Option<&str>,
) -> io::Result<(usize, Vec<Value>)> {
    let file = File::open(path)?;
    let mut events = Vec::new();
    let mut total_lines = 0;
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        total_lines += 1;
        if index < offset || events.len() >= limit {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(object) = value.as_object() else {
            continue;
        };
        if let Some(event_type) = event_type.filter(|value| !value.is_empty()) {
            if object.get("event_type") != Some(&Value::String(event_type.to_owned())) {
                continue;
            }
        }
        events.push(value);
    }
    Ok((total_lines, events))
}

fn bad_request(detail: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"detail": detail}))).into_response()
}

fn not_found(detail: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({"detail": detail}))).into_response()
}

fn internal_error(detail: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"detail": detail})),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::{
        router, DebugFuture, DebugLoggerSnapshot, DebugProviders, DebugRuntimeProvider,
        DebugRuntimeSnapshot, DebugState, DebugStreamsSnapshot, DebugUpdateSubscribers,
    };

    #[derive(Default)]
    struct TestRuntimeProvider {
        events: Vec<Value>,
    }

    impl DebugRuntimeProvider for TestRuntimeProvider {
        fn snapshot(&self) -> DebugFuture<DebugRuntimeSnapshot> {
            let events = self.events.clone();
            Box::pin(async move {
                Ok(DebugRuntimeSnapshot {
                    pipeline_metrics: json!({}),
                    streams: DebugStreamsSnapshot {
                        active_streams: 0,
                        total_streams_created: 0,
                        streams: BTreeMap::new(),
                        source_throttling: BTreeMap::new(),
                        stream_manager_streams: BTreeMap::new(),
                    },
                    logger: DebugLoggerSnapshot {
                        session_id: "test-session".to_owned(),
                        events,
                        active_streams: BTreeMap::new(),
                        active_requests: 0,
                        slow_operations: Vec::new(),
                        performance_summary: json!({}),
                        frontend_reports: Vec::new(),
                    },
                    jobs: BTreeMap::new(),
                    update_subscribers: DebugUpdateSubscribers {
                        subscriber_count: 0,
                        total_events_sent: 0,
                    },
                    embedding_queue_depth: None,
                })
            })
        }
    }
    static NEXT_TEMP_DIR: AtomicUsize = AtomicUsize::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "thesis-debug-routes-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create isolated debug route test directory");
            Self(path)
        }

        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, Value) {
        request_json(app, "GET", uri).await
    }

    async fn request_json(app: axum::Router, method: &str, uri: &str) -> (StatusCode, Value) {
        let response = app
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("build test request"),
            )
            .await
            .expect("execute test request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read test response body");
        (
            status,
            serde_json::from_slice(&bytes).expect("JSON response"),
        )
    }

    #[tokio::test]
    async fn file_listing_only_exposes_direct_jsonl_files_and_reports_metadata() {
        let directory = TestDirectory::new();
        fs::write(directory.path().join("debug_20260925.jsonl"), "{}\n")
            .expect("write valid fixture");
        fs::write(directory.path().join("other.jsonl"), "{}\n").expect("write ignored fixture");
        fs::create_dir(directory.path().join("debug_directory.jsonl"))
            .expect("create ignored directory");
        let app = router(DebugState::with_log_directory(directory.path()));

        let (status, payload) = get_json(app, "/debug/logs/files").await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["file_count"], 2);
        let files = payload["files"].as_array().expect("file list");
        let fixture = files
            .iter()
            .find(|file| file["filename"] == "debug_20260925.jsonl")
            .expect("test fixture is listed");
        assert_eq!(fixture["size_bytes"], 3);
        assert!(fixture["modified"].is_string());
        assert!(fixture["created"].is_string());
    }

    #[tokio::test]
    async fn file_reader_filters_and_pages_jsonl_events_and_rejects_traversal() {
        let directory = TestDirectory::new();
        fs::write(
            directory.path().join("debug_session.jsonl"),
            "{\"type\":\"session_start\"}\n{\"event_type\":\"request_start\",\"id\":1}\n{\"event_type\":\"request_error\",\"id\":2}\nnot json\n",
        )
        .expect("write JSONL fixture");
        let app = router(DebugState::with_log_directory(directory.path()));

        let (status, payload) = get_json(
            app.clone(),
            "/debug/logs/file/debug_session.jsonl?limit=1&offset=1&event_type=request_error",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["total_lines"], 4);
        assert_eq!(payload["returned"], 1);
        assert_eq!(payload["events"][0]["id"], 2);
        assert_eq!(payload["filter"], "request_error");

        let (status, payload) = get_json(app.clone(), "/debug/logs/file/debug_missing.jsonl").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(payload["detail"], "Log file not found: debug_missing.jsonl");

        let (status, payload) =
            get_json(app, "/debug/logs/file/%2e%2e%2fdebug_session.jsonl").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(payload["detail"], "Invalid log file name");
    }

    #[tokio::test]
    async fn clearing_old_logs_keeps_newest_names_and_validates_bounds() {
        let directory = TestDirectory::new();
        for name in [
            "debug_20260923.jsonl",
            "debug_20260924.jsonl",
            "debug_20260925.jsonl",
        ] {
            fs::write(directory.path().join(name), "{}\n").expect("write log fixture");
        }
        let state = DebugState::with_log_directory(directory.path());
        let startup_log = state.logger().log_file.clone();
        fs::remove_file(startup_log).expect("remove startup log from isolated fixture");
        let app = router(state);
        let (status, payload) =
            request_json(app.clone(), "DELETE", "/debug/logs/files?keep_recent=0").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(payload["detail"][0]["loc"], json!(["query", "keep_recent"]));

        let response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/debug/logs/files?keep_recent=1")
                    .body(Body::empty())
                    .expect("build clear request"),
            )
            .await
            .expect("execute clear request");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read clear response");
        let payload: Value = serde_json::from_slice(&body).expect("JSON response");
        assert_eq!(payload["kept"], 1);
        assert_eq!(payload["deleted"].as_array().map(Vec::len), Some(2));
        assert!(directory.path().join("debug_20260925.jsonl").exists());
        assert!(!directory.path().join("debug_20260924.jsonl").exists());
        assert!(!directory.path().join("debug_20260923.jsonl").exists());
    }
    #[tokio::test]
    async fn clearing_logs_without_a_directory_returns_an_empty_result() {
        let directory = TestDirectory::new();
        let missing_directory = directory.path().join("missing");
        let state = DebugState::with_log_directory(missing_directory.clone());
        let startup_log = state.logger().log_file.clone();
        fs::remove_file(startup_log).expect("remove startup log from isolated fixture");
        fs::remove_dir(&missing_directory).expect("remove isolated log directory");
        let app = router(state);
        let (status, payload) = request_json(app, "DELETE", "/debug/logs/files").await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            payload,
            json!({"message": "No log directory exists", "deleted": 0})
        );
    }

    #[tokio::test]
    async fn frontend_report_retention_is_capped_at_twenty_reports() {
        let directory = TestDirectory::new();
        let app = router(DebugState::with_log_directory(directory.path()));
        for index in 0..=20 {
            let body = serde_json::to_vec(&json!({
                "session_id": format!("frontend-{index}"),
                "summary": {}
            }))
            .expect("serialize frontend report");
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/debug/logs/frontend")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .expect("build frontend report request"),
                )
                .await
                .expect("execute frontend report request");
            assert_eq!(response.status(), StatusCode::OK);
        }

        let (status, payload) = get_json(app, "/debug/logs/frontend").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["count"], 20);
        assert_eq!(payload["reports"][0]["session_id"], "frontend-1");
        assert_eq!(payload["reports"][19]["session_id"], "frontend-20");
    }

    #[tokio::test]
    async fn frontend_report_is_normalized_retained_and_logged() {
        let directory = TestDirectory::new();
        let app = router(DebugState::with_log_directory_and_providers(
            directory.path(),
            DebugProviders {
                runtime: Some(Arc::new(TestRuntimeProvider)),
                ..DebugProviders::default()
            },
        ));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/debug/logs/frontend")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"session_id":"frontend-1","summary":{"duration_ms":14},"recent_events":[{"name":"load"}]}"#,
                    ))
                    .expect("build frontend report request"),
            )
            .await
            .expect("execute frontend report request");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read ingestion response");
        assert_eq!(
            serde_json::from_slice::<Value>(&body).expect("JSON response")["status"],
            "ok"
        );

        let (status, payload) = get_json(app.clone(), "/debug/logs/frontend").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["count"], 1);
        assert_eq!(payload["reports"][0]["recent_events"][0]["name"], "load");
        assert_eq!(payload["reports"][0]["slow_operations"], json!([]));
        assert_eq!(payload["reports"][0]["dom_stats"], Value::Null);

        let (status, events) =
            get_json(app.clone(), "/debug/logs/events?limit=1&event_type=custom").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(events["count"], 1);
        assert_eq!(events["limit"], 1);
        assert_eq!(events["filter"], "custom");
        assert_eq!(events["events"][0]["operation"], "debug_report");

        let log_files = fs::read_dir(directory.path())
            .expect("read report log directory")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect log entries");
        assert_eq!(log_files.len(), 1);
        let log = fs::read_to_string(log_files[0].path()).expect("read report event log");
        let mut lines = log.lines();
        let header: Value = serde_json::from_str(lines.next().expect("session header"))
            .expect("session header JSON");
        assert_eq!(header["type"], "session_start");
        assert!(header["timestamp"].as_str().unwrap().ends_with("+00:00"));
        assert_eq!(
            header["thresholds"],
            json!({
                "request_slow": 5.0,
                "db_query_slow": 1.0,
                "rss_fetch_slow": 10.0,
                "stream_event_gap": 5.0,
                "cache_miss_threshold": 0.5
            })
        );
        let event: Value = serde_json::from_str(lines.next().expect("frontend event"))
            .expect("frontend event JSON");
        assert!(lines.next().is_none());
        assert!(event["timestamp"].as_str().unwrap().ends_with("+00:00"));
        assert_eq!(
            event,
            json!({
                "event_id": format!(
                    "evt_{}_000001",
                    header["session_id"].as_str().expect("session ID")
                ),
                "event_type": "custom",
                "timestamp": event["timestamp"].clone(),
                "component": "frontend",
                "operation": "debug_report",
                "duration_ms": null,
                "start_time": null,
                "request_id": null,
                "stream_id": null,
                "source_name": null,
                "category": null,
                "message": "Frontend debug report received",
                "details": payload["reports"][0].clone(),
                "metrics": {},
                "error": null,
                "error_type": null,
                "stack_trace": null,
                "is_slow": false,
                "is_bottleneck": false,
                "threshold_exceeded": null
            })
        );
    }

    #[tokio::test]
    async fn frontend_report_validation_keeps_fastapi_status_and_error_shape() {
        let directory = TestDirectory::new();
        let app = router(DebugState::with_log_directory(directory.path()));
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/debug/logs/frontend")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("build invalid report request"),
            )
            .await
            .expect("execute invalid report request");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read validation response");
        let payload: Value = serde_json::from_slice(&body).expect("JSON validation response");
        assert_eq!(payload["detail"].as_array().map(Vec::len), Some(2));
        assert_eq!(payload["detail"][0]["loc"], json!(["body", "session_id"]));
        assert_eq!(payload["detail"][1]["loc"], json!(["body", "summary"]));
        assert_eq!(payload["detail"][0]["type"], "missing");
        assert_eq!(payload["detail"][1]["type"], "missing");
    }

    #[tokio::test]
    async fn debug_event_route_validates_limits_and_event_types() {
        let directory = TestDirectory::new();
        let app = router(DebugState::with_log_directory(directory.path()));

        let (status, payload) = get_json(app.clone(), "/debug/logs/events?limit=0").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(payload["detail"][0]["loc"], json!(["query", "limit"]));

        let (status, payload) = get_json(app, "/debug/logs/events?event_type=unknown").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            payload["detail"],
            "Invalid event_type. Must be one of: request_start, request_end, request_error, stream_start, stream_event, stream_end, stream_error, stream_client_disconnect, db_query_start, db_query_end, db_query_error, cache_hit, cache_miss, cache_update, rss_fetch_start, rss_fetch_end, rss_fetch_error, rss_parse_error, executor_submit, executor_complete, executor_timeout, performance_warning, bottleneck_detected, hang_suspected, custom"
        );
    }

    #[tokio::test]
    async fn debug_events_include_shared_runtime_events_and_require_the_provider() {
        let directory = TestDirectory::new();
        let provider = TestRuntimeProvider {
            events: vec![json!({
                "event_id": "runtime-event-1",
                "event_type": "request_start",
                "timestamp": "2026-01-01T00:00:00+00:00",
                "operation": "list_articles"
            })],
        };
        let app = router(DebugState::with_log_directory_and_providers(
            directory.path(),
            DebugProviders {
                runtime: Some(Arc::new(provider)),
                ..DebugProviders::default()
            },
        ));

        let (status, events) = get_json(app, "/debug/logs/events?event_type=request_start").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(events["count"], 1);
        assert_eq!(events["events"][0]["event_id"], "runtime-event-1");
        assert_eq!(events["events"][0]["operation"], "list_articles");

        let missing_directory = TestDirectory::new();
        let app = router(DebugState::with_log_directory(missing_directory.path()));
        let (status, unavailable) = get_json(app, "/debug/logs/events").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            unavailable["detail"],
            "Debug runtime provider is not available"
        );
    }

    #[tokio::test]
    async fn missing_debug_integrations_return_unavailable_instead_of_empty_data() {
        let directory = TestDirectory::new();
        let app = router(DebugState::with_log_directory(directory.path()));
        let requests = [
            ("GET", "/debug/logs/report"),
            ("GET", "/debug/logs/streams"),
            ("GET", "/debug/logs/slow"),
            ("GET", "/debug/logs/performance"),
            ("GET", "/debug/logs/errors"),
            ("GET", "/debug/streams"),
            ("GET", "/debug/metrics/pipeline"),
            ("GET", "/debug/jobs"),
            ("GET", "/debug/updates/subscribers"),
            (
                "GET",
                "/debug/parser/test/rss?url=https%3A%2F%2Fexample.com%2Frss",
            ),
            (
                "POST",
                "/debug/parser/test/article?url=https%3A%2F%2Fexample.com",
            ),
            ("GET", "/debug/chromadb/articles"),
            ("GET", "/debug/storage/drift"),
            ("GET", "/debug/loglevel"),
            ("POST", "/debug/loglevel?level=INFO"),
            ("POST", "/debug/backfill/images"),
            ("POST", "/debug/backfill/mentioned-countries"),
        ];

        for (method, uri) in requests {
            let (status, payload) = request_json(app.clone(), method, uri).await;
            assert_eq!(
                status,
                StatusCode::SERVICE_UNAVAILABLE,
                "{method} {uri} unexpectedly succeeded: {payload}"
            );
            assert!(payload["detail"].is_string(), "{method} {uri}: {payload}");
        }

        let (status, payload) = get_json(app, "/debug/system/status").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(payload["pipeline"]["available"], false);
        assert_eq!(payload["components"]["embedding_queue"]["available"], false);
        assert_eq!(payload["components"]["vector_store"]["healthy"], false);
        assert_eq!(
            payload["components"]["cache"]["update_count_available"],
            false
        );
    }
}
