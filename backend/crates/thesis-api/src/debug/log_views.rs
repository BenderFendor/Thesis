use crate::models::Rejection;
use std::collections::{BTreeSet, HashMap};
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};

use super::providers::DebugRuntimeSnapshot;
use super::{DebugState, FreeFormObjectSchema};

const LOG_LEVELS: &[&str] = &["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
const DEFAULT_LOG_LIMIT: i64 = 100;
const MAX_LOG_LIMIT: i64 = 1_000;

pub(super) fn router(state: DebugState) -> Router {
    Router::new()
        .route("/debug/logs/report", get(get_debug_report))
        .route("/debug/logs/streams", get(get_streams))
        .route("/debug/logs/slow", get(get_slow_operations))
        .route("/debug/logs/performance", get(get_performance_summary))
        .route("/debug/logs/llm", get(get_llm_logs))
        .route("/debug/logs/errors", get(get_debug_errors))
        .route("/debug/loglevel", get(get_log_level).post(set_log_level))
        .with_state(state)
}

async fn runtime_snapshot(
    state: &DebugState,
    operation: &str,
) -> Result<DebugRuntimeSnapshot, Rejection> {
    let Some(provider) = state.providers.runtime.as_ref() else {
        return Err(Rejection::from(super::provider_unavailable(
            "Runtime debug provider is unavailable",
        )));
    };
    provider
        .snapshot()
        .await
        .map_err(|error| super::provider_failed(error, operation).into())
}

#[utoipa::path(
    get,
    path = "/debug/logs/report",
    operation_id = "get_debug_report_debug_logs_report_get",
    tag = "debug",
    responses(
        (status = 200, description = "Comprehensive runtime debug report", body = inline(FreeFormObjectSchema)),
        (status = 500, description = "Runtime debug provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Runtime debug provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_debug_report(State(state): State<DebugState>) -> Response {
    let snapshot = match runtime_snapshot(&state, "failed to read runtime debug report").await {
        Ok(snapshot) => snapshot,
        Err(response) => return response.into_response(),
    };

    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false);
    let recommendations = generate_recommendations(&snapshot);
    let active_streams = snapshot.logger.active_streams;
    let hang_suspects = active_streams
        .values()
        .filter(|stream| stream.get("is_potentially_hung").is_some_and(json_truthy))
        .cloned()
        .collect::<Vec<_>>();
    let recent_events = last_values(&snapshot.logger.events, 50);
    let mut recent_errors = snapshot
        .logger
        .events
        .iter()
        .rev()
        .filter(|event| event.get("error").is_some_and(|error| !error.is_null()))
        .take(20)
        .cloned()
        .collect::<Vec<_>>();
    recent_errors.reverse();

    Json(json!({
        "timestamp": timestamp,
        "generated_at": timestamp,
        "session_id": snapshot.logger.session_id,
        "performance_summary": snapshot.logger.performance_summary,
        "active_streams": active_streams,
        "slow_operations": snapshot.logger.slow_operations,
        "recent_events": recent_events,
        "recent_errors": recent_errors,
        "frontend_reports": snapshot.logger.frontend_reports,
        "hang_suspects": hang_suspects,
        "recommendations": recommendations,
    }))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/streams",
    operation_id = "get_streams_debug_logs_streams_get",
    tag = "debug",
    responses(
        (status = 200, description = "Active logger and stream-manager streams", body = inline(FreeFormObjectSchema)),
        (status = 500, description = "Runtime debug provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Runtime debug provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_streams(State(state): State<DebugState>) -> Response {
    let snapshot = match runtime_snapshot(&state, "failed to read runtime streams").await {
        Ok(snapshot) => snapshot,
        Err(response) => return response.into_response(),
    };
    Json(json!({
        "active_streams": snapshot.logger.active_streams,
        "stream_manager_streams": snapshot.streams.stream_manager_streams,
    }))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/slow",
    operation_id = "get_slow_operations_debug_logs_slow_get",
    tag = "debug",
    responses(
        (status = 200, description = "Detected slow operations", body = inline(FreeFormObjectSchema)),
        (status = 500, description = "Runtime debug provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Runtime debug provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_slow_operations(State(state): State<DebugState>) -> Response {
    let snapshot = match runtime_snapshot(&state, "failed to read slow operations").await {
        Ok(snapshot) => snapshot,
        Err(response) => return response.into_response(),
    };
    let operations = snapshot.logger.slow_operations;
    Json(json!({
        "count": operations.len(),
        "operations": operations,
        "thresholds": {
            "request_slow": "5.0s",
            "db_query_slow": "1.0s",
            "rss_fetch_slow": "10.0s",
            "stream_event_gap": "5.0s",
        }
    }))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/performance",
    operation_id = "get_performance_summary_debug_logs_performance_get",
    tag = "debug",
    responses(
        (status = 200, description = "Runtime performance summary", body = inline(FreeFormObjectSchema)),
        (status = 500, description = "Runtime debug provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Runtime debug provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_performance_summary(State(state): State<DebugState>) -> Response {
    let snapshot = match runtime_snapshot(&state, "failed to read performance summary").await {
        Ok(snapshot) => snapshot,
        Err(response) => return response.into_response(),
    };
    Json(snapshot.logger.performance_summary).into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/llm",
    operation_id = "get_llm_logs_debug_logs_llm_get",
    tag = "debug",
    params(
        ("limit" = Option<i64>, Query, description = "Maximum entries to return (default: 100)", minimum = 1, maximum = 1000, example = 100),
        ("offset" = Option<i64>, Query, description = "Number of newest matching entries to skip", minimum = 0, example = 0),
        ("service" = Option<String>, Query, description = "Filter by service name", nullable = true),
        ("success" = Option<bool>, Query, description = "Filter by success status", nullable = true)
    ),
    responses(
        (status = 200, description = "Paginated LLM call log entries", body = inline(FreeFormObjectSchema)),
        (status = 400, description = "Invalid log path", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = super::HttpValidationError),
        (status = 500, description = "Failed to read session log file", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_llm_logs(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let (limit, offset) = match parse_pagination(&params) {
        Ok(pagination) => pagination,
        Err(response) => return response.into_response(),
    };
    let success_filter = match parse_optional_bool(&params, "success") {
        Ok(value) => value,
        Err(response) => return response.into_response(),
    };
    let service = params.get("service").cloned();
    let service_filter = service.as_deref().filter(|value| !value.is_empty());
    let path = match session_log_file_path(&state.config.session_log_directory, "llm_calls.log") {
        Ok(path) => path,
        Err(response) => return response.into_response(),
    };
    let payload = match read_jsonl_tail(&path, limit, offset, |entry| {
        let matches_service = match service_filter {
            Some(service) => entry.get("service").and_then(Value::as_str) == Some(service),
            None => true,
        };
        let matches_success = match success_filter {
            Some(success) => entry.get("success").is_some_and(json_truthy) == success,
            None => true,
        };
        matches_service && matches_success
    }) {
        Ok(payload) => payload,
        Err(response) => return response.into_response(),
    };
    let mut payload = payload;
    payload["service"] = service.map_or(Value::Null, Value::String);
    payload["success_filter"] = success_filter.map_or(Value::Null, Value::Bool);
    Json(payload).into_response()
}

#[utoipa::path(
    get,
    path = "/debug/logs/errors",
    operation_id = "get_debug_errors_debug_logs_errors_get",
    tag = "debug",
    params(
        ("limit" = Option<i64>, Query, description = "Maximum entries to return (default: 100)", minimum = 1, maximum = 1000, example = 100),
        ("offset" = Option<i64>, Query, description = "Number of newest file entries to skip", minimum = 0, example = 0),
        ("include_request_stream_events" = Option<bool>, Query, description = "Include recent in-memory request and stream errors (default: true)", example = true)
    ),
    responses(
        (status = 200, description = "Error log file and recent runtime request/stream errors", body = inline(FreeFormObjectSchema)),
        (status = 400, description = "Invalid log path", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = super::HttpValidationError),
        (status = 500, description = "Runtime debug provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Runtime debug provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_debug_errors(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let (limit, offset) = match parse_pagination(&params) {
        Ok(pagination) => pagination,
        Err(response) => return response.into_response(),
    };
    let include_request_stream_events =
        match parse_optional_bool(&params, "include_request_stream_events") {
            Ok(value) => value.unwrap_or(true),
            Err(response) => return response.into_response(),
        };
    let recent_request_stream_errors = if include_request_stream_events {
        let snapshot =
            match runtime_snapshot(&state, "failed to read recent request and stream errors").await
            {
                Ok(snapshot) => snapshot,
                Err(response) => return response.into_response(),
            };
        let mut errors = snapshot
            .logger
            .events
            .iter()
            .rev()
            .take(limit.saturating_mul(4))
            .filter(|event| {
                matches!(
                    event.get("event_type").and_then(Value::as_str),
                    Some("request_error" | "stream_error")
                )
            })
            .take(limit)
            .cloned()
            .collect::<Vec<_>>();
        errors.reverse();
        errors
    } else {
        Vec::new()
    };

    let path = match session_log_file_path(&state.config.session_log_directory, "api_errors.log") {
        Ok(path) => path,
        Err(response) => return response.into_response(),
    };
    let log_file = match read_jsonl_tail(&path, limit, offset, |_| true) {
        Ok(payload) => payload,
        Err(response) => return response.into_response(),
    };
    Json(json!({
        "log_file": log_file,
        "recent_request_stream_errors": recent_request_stream_errors,
        "returned_recent_errors": recent_request_stream_errors.len(),
        "include_request_stream_events": include_request_stream_events,
    }))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/loglevel",
    operation_id = "get_log_level_debug_loglevel_get",
    tag = "debug",
    responses(
        (status = 200, description = "Current runtime log level", body = inline(FreeFormObjectSchema)),
        (status = 500, description = "Log-level provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Log-level provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_log_level(State(state): State<DebugState>) -> Response {
    let Some(provider) = state.providers.log_level.as_ref() else {
        return super::provider_unavailable("Log-level provider is unavailable");
    };
    match provider.current_level() {
        Ok(level) => Json(json!({"level": level})).into_response(),
        Err(error) => super::provider_failed(error, "failed to read runtime log level"),
    }
}

#[utoipa::path(
    post,
    path = "/debug/loglevel",
    operation_id = "set_log_level_debug_loglevel_post",
    tag = "debug",
    params(
        ("level" = String, Query, description = "Log level: DEBUG, INFO, WARNING, ERROR, or CRITICAL")
    ),
    responses(
        (status = 200, description = "Updated runtime log level", body = inline(FreeFormObjectSchema)),
        (status = 400, description = "Invalid log level", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = super::HttpValidationError),
        (status = 500, description = "Log-level provider failed", body = inline(FreeFormObjectSchema)),
        (status = 503, description = "Log-level provider unavailable", body = inline(FreeFormObjectSchema))
    )
)]
pub(crate) async fn set_log_level(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(raw_level) = params.get("level") else {
        return super::query_validation_response(super::HttpValidationError {
            detail: vec![super::ValidationError {
                loc: vec![
                    super::ValidationLocation::Text("query".to_owned()),
                    super::ValidationLocation::Text("level".to_owned()),
                ],
                msg: "Field required".to_owned(),
                error_type: "missing".to_owned(),
                input: Value::Null,
                ctx: None,
            }],
        });
    };
    let level = raw_level.to_ascii_uppercase();
    if !LOG_LEVELS.contains(&level.as_str()) {
        return super::bad_request(&format!(
            "Invalid log level. Must be one of: {}",
            LOG_LEVELS.join(", ")
        ));
    }
    let Some(provider) = state.providers.log_level.as_ref() else {
        return super::provider_unavailable("Log-level provider is unavailable");
    };
    match provider.set_level(&level) {
        Ok(()) => Json(json!({
            "message": format!("Log level set to {level}"),
            "level": level,
        }))
        .into_response(),
        Err(error) => super::provider_failed(error, "failed to update runtime log level"),
    }
}

fn parse_pagination(params: &HashMap<String, String>) -> Result<(usize, usize), Rejection> {
    let limit =
        match super::parse_integer_query(params, "limit", DEFAULT_LOG_LIMIT, 1, MAX_LOG_LIMIT) {
            Ok(value) => value,
            Err(error) => return Err(Rejection::from(super::query_validation_response(error))),
        };
    let offset = match super::parse_integer_query(params, "offset", 0, 0, i64::MAX) {
        Ok(value) => value,
        Err(error) => return Err(Rejection::from(super::query_validation_response(error))),
    };
    Ok((limit as usize, offset as usize))
}

fn parse_optional_bool(
    params: &HashMap<String, String>,
    field: &str,
) -> Result<Option<bool>, Rejection> {
    let Some(raw) = params.get(field) else {
        return Ok(None);
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" | "t" | "y" => Ok(Some(true)),
        "0" | "false" | "no" | "off" | "f" | "n" => Ok(Some(false)),
        _ => Err(Rejection::from(super::query_validation_response(
            super::debug_query_error(
                field,
                raw,
                "bool_parsing",
                "Input should be a valid boolean",
                None,
                None,
            ),
        ))),
    }
}

fn session_log_file_path(directory: &Path, filename: &'static str) -> Result<PathBuf, Rejection> {
    let canonical_directory = match fs::canonicalize(directory) {
        Ok(path) => Some(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(_) => {
            return Err(Rejection::from(super::internal_error(
                "Failed to resolve session log directory",
            )))
        }
    };
    let path = canonical_directory
        .as_deref()
        .unwrap_or(directory)
        .join(filename);
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(Rejection::from(super::bad_request(
                    "Invalid session log path",
                )));
            }
            let canonical_path = fs::canonicalize(&path)
                .map_err(|_| super::internal_error("Failed to resolve session log path"))?;
            let Some(session_directory) = canonical_directory else {
                return Err(Rejection::from(super::internal_error(
                    "Failed to resolve session log directory",
                )));
            };
            if canonical_path.parent() != Some(session_directory.as_path())
                || canonical_path.file_name() != Some(OsStr::new(filename))
            {
                return Err(Rejection::from(super::bad_request(
                    "Invalid session log path",
                )));
            }
            Ok(canonical_path)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(path),
        Err(_) => Err(Rejection::from(super::internal_error(
            "Failed to inspect session log path",
        ))),
    }
}

fn read_jsonl_tail(
    path: &Path,
    limit: usize,
    offset: usize,
    predicate: impl Fn(&Value) -> bool,
) -> Result<Value, Rejection> {
    let display_path = path.to_string_lossy().into_owned();
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(json!({
                "available": false,
                "path": display_path,
                "returned": 0,
                "total": 0,
                "entries": [],
            }));
        }
        Err(_) => {
            return Err(Rejection::from(super::internal_error(
                "Failed to read session log file",
            )))
        }
    };

    let entries = contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry.is_object() && predicate(entry))
        .collect::<Vec<_>>();
    let total = entries.len();
    let end = total.saturating_sub(offset);
    let start = end.saturating_sub(limit);
    let entries = entries
        .into_iter()
        .skip(start)
        .take(end - start)
        .collect::<Vec<_>>();
    let returned = entries.len();
    Ok(json!({
        "available": true,
        "path": display_path,
        "returned": returned,
        "total": total,
        "entries": entries,
    }))
}

fn last_values(values: &[Value], count: usize) -> Vec<Value> {
    let mut recent = values.iter().rev().take(count).cloned().collect::<Vec<_>>();
    recent.reverse();
    recent
}

fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn generate_recommendations(snapshot: &DebugRuntimeSnapshot) -> Vec<String> {
    let mut recommendations = Vec::new();
    for (stream_id, stream) in &snapshot.logger.active_streams {
        let gap = stream
            .get("is_potentially_hung")
            .filter(|value| json_truthy(value))
            .and_then(|_| stream.get("event_gap_s"))
            .and_then(Value::as_f64);
        if let Some(gap) = gap {
            recommendations.push(format!(
                "Stream {stream_id} may be hung - gap of {gap:.1}s since last event. Check ThreadPoolExecutor shutdown and RSS fetch timeouts."
            ));
        }
    }

    if snapshot.logger.slow_operations.len() > 5 {
        let mut counts = Vec::<(String, usize)>::new();
        for operation in &snapshot.logger.slow_operations {
            let component = operation
                .get("component")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if let Some((_, count)) = counts
                .iter_mut()
                .find(|(name, _)| name.as_str() == component)
            {
                *count += 1;
            } else {
                counts.push((component.to_owned(), 1));
            }
        }
        recommendations.extend(counts.into_iter().map(|(component, count)| {
            format!(
                "Multiple slow {component} operations detected ({count}). Consider optimizing {component} layer."
            )
        }));
    }

    let mut error_types = BTreeSet::new();
    for event in snapshot
        .logger
        .events
        .iter()
        .filter(|event| event.get("error").is_some_and(|error| !error.is_null()))
        .rev()
        .take(10)
    {
        if let Some(error_type) = event
            .get("error_type")
            .and_then(Value::as_str)
            .filter(|error_type| !error_type.is_empty())
        {
            error_types.insert(error_type);
        }
    }
    if !error_types.is_empty() {
        recommendations.push(format!(
            "Recent errors detected: {}. Check stack traces in debug log.",
            error_types.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }

    if recommendations.is_empty() {
        recommendations.push("No critical issues detected. System appears healthy.".to_owned());
    }
    recommendations
}
#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;

    use super::{parse_optional_bool, session_log_file_path};

    #[test]
    fn session_log_files_use_the_exact_per_process_directory() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after the Unix epoch")
            .as_nanos();
        let session_directory = std::env::temp_dir().join(format!(
            "thesis-debug-session-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&session_directory).expect("create session directory");
        let canonical_directory =
            fs::canonicalize(&session_directory).expect("canonicalize session directory");

        for filename in ["llm_calls.log", "api_errors.log"] {
            fs::write(session_directory.join(filename), "").expect("create session log");
            let path = match session_log_file_path(&session_directory, filename) {
                Ok(path) => path,
                Err(_) => panic!("resolve session log path"),
            };
            assert_eq!(path, canonical_directory.join(filename));
        }

        fs::remove_dir_all(session_directory).expect("remove session directory");
    }

    #[test]
    fn optional_boolean_query_accepts_pydantic_y_and_n_literals() {
        let truthy = HashMap::from([("success".to_owned(), " y ".to_owned())]);
        let falsy = HashMap::from([("success".to_owned(), "N".to_owned())]);

        assert!(matches!(
            parse_optional_bool(&truthy, "success"),
            Ok(Some(true))
        ));
        assert!(matches!(
            parse_optional_bool(&falsy, "success"),
            Ok(Some(false))
        ));
        assert!(matches!(
            parse_optional_bool(&HashMap::new(), "success"),
            Ok(None)
        ));
    }
}
