//! Schema-hidden resource-observability routes for local Rust runtime evidence.
//!
//! The server owns the sampler lifecycle: construct [`Observability`], merge
//! [`router`] into the Axum app, retain the optional [`SamplingTask`], and await
//! its `shutdown()` after the server stops. These routes intentionally have no
//! Utoipa annotations and are excluded from the generated API document.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{Map, Value};
use thesis_observe::ObservabilityError;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
pub use thesis_observe::{Observability, ObservabilityConfig, SamplingTask};

const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 5_000;
const DEFAULT_SINCE_MINUTES: i64 = 30;
const MAX_SINCE_MINUTES: i64 = 24 * 60;

/// Build the four hidden observability routes with one shared process monitor.
pub fn router(observer: Observability) -> Router {
    Router::new()
        .route("/debug/observability/resources", get(resources))
        .route("/debug/observability/performance", get(performance))
        .route("/debug/observability/runtime", get(runtime))
        .route("/debug/observability/health", get(health))
        .with_state(observer)
}

async fn resources(State(observer): State<Observability>) -> Response {
    match observer.resources().await {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn performance(
    State(observer): State<Observability>,
    Query(parameters): Query<HashMap<String, String>>,
) -> Response {
    let limit = match parse_integer_query(&parameters, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT) {
        Ok(limit) => limit as usize,
        Err(error) => return error.into_response(),
    };
    let since_minutes = match parse_integer_query(
        &parameters,
        "since_minutes",
        DEFAULT_SINCE_MINUTES,
        1,
        MAX_SINCE_MINUTES,
    ) {
        Ok(minutes) => minutes as u16,
        Err(error) => return error.into_response(),
    };
    match observer.performance(limit, since_minutes).await {
        Ok(history) => Json(history).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn runtime(State(observer): State<Observability>) -> Response {
    match observer.runtime().await {
        Ok(runtime) => Json(runtime).into_response(),
        Err(error) => internal_error(error),
    }
}

async fn health(State(observer): State<Observability>) -> Response {
    match observer.health().await {
        Ok(health) => Json(health).into_response(),
        Err(error) => internal_error(error),
    }
}

fn parse_integer_query(
    parameters: &HashMap<String, String>,
    field: &str,
    default: i64,
    minimum: i64,
    maximum: i64,
) -> Result<i64, HttpValidationError> {
    let Some(raw) = parameters.get(field) else {
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

fn internal_error(error: ObservabilityError) -> Response {
    tracing::error!(%error, "Observability request failed");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
}

#[cfg(test)]
mod tests {
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tower::ServiceExt;

    use super::{router, Observability, ObservabilityConfig};
    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "thesis-observe-api-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create unique test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn observer(directory: &Path, enabled: bool) -> Observability {
        Observability::new(ObservabilityConfig {
            service_name: "api-test".to_owned(),
            interval_seconds: 5.0,
            runtime_data_dir: directory.to_path_buf(),
            enabled,
        })
    }

    async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, Value) {
        let response = app
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body bytes");
        let payload = serde_json::from_slice(&body).expect("JSON payload");
        (status, payload)
    }

    #[tokio::test]
    async fn resources_runtime_and_health_use_the_real_observer_path() {
        let directory = TestDirectory::new();
        let app = router(observer(directory.path(), false));

        let (resource_status, resources) =
            get_json(app.clone(), "/debug/observability/resources").await;
        assert_eq!(resource_status, StatusCode::OK);
        assert_eq!(resources["kind"], "resource_sample");
        assert!(
            resources["process"]["rss_bytes"].is_number()
                || resources["process"]["rss_bytes"].is_null()
        );
        assert!(resources["system"].get("memory_total_bytes").is_some());
        assert!(resources["disk"].get("total_bytes").is_some());
        assert!(resources["network"].get("bytes_received").is_some());
        assert!(resources["gpus"].is_array());

        let (runtime_status, runtime) = get_json(app.clone(), "/debug/observability/runtime").await;
        assert_eq!(runtime_status, StatusCode::OK);
        assert_eq!(runtime["service"], "api-test");
        assert_eq!(runtime["resource_monitor"]["running"], false);
        assert!(runtime["platform"].as_str().is_some());
        assert!(runtime["log_files"].is_array());

        let (health_status, health) = get_json(app, "/debug/observability/health").await;
        assert_eq!(health_status, StatusCode::OK);
        assert_eq!(health["status"], "degraded");
        assert_eq!(health["monitor_running"], false);
        assert_eq!(health["performance_log_exists"], false);
        assert!(health["latest_sample"]["system"].is_object());
    }

    #[tokio::test]
    async fn performance_route_aggregates_files_and_applies_fastapi_query_bounds() {
        let directory = TestDirectory::new();
        let logs = directory.path().join("logs");
        fs::create_dir_all(logs.join("nested")).expect("nested logs");
        let now = chrono::Utc::now();
        let first = (now - chrono::Duration::seconds(10)).to_rfc3339();
        let second = now.to_rfc3339();
        fs::write(
            logs.join("performance_a.jsonl"),
            format!("{{\"timestamp\":\"{first}\",\"value\":1}}\n"),
        )
        .expect("write root file");
        fs::write(
            logs.join("nested/performance_b.jsonl"),
            format!("bad json\n{{\"timestamp\":\"{second}\",\"value\":2}}\n"),
        )
        .expect("write nested file");
        let app = router(observer(directory.path(), false));

        let (status, response) = get_json(app.clone(), "/debug/observability/performance").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(response["since_minutes"], 30);
        assert_eq!(response["returned"], 2);
        assert_eq!(response["samples"][0]["value"], 1);
        assert_eq!(response["samples"][1]["value"], 2);
        assert_eq!(response["files"].as_array().expect("paths").len(), 2);
        assert!(response["generated_at"].as_str().is_some());
        let (max_status, max_response) = get_json(
            app.clone(),
            "/debug/observability/performance?limit=5000&since_minutes=1440",
        )
        .await;
        assert_eq!(max_status, StatusCode::OK);
        assert_eq!(max_response["returned"], 2);
        let (min_status, min_response) = get_json(
            app.clone(),
            "/debug/observability/performance?limit=1&since_minutes=1",
        )
        .await;
        assert_eq!(min_status, StatusCode::OK);
        assert_eq!(min_response["returned"], 1);
        assert_eq!(min_response["samples"][0]["value"], 2);

        for (uri, field, error_type) in [
            (
                "/debug/observability/performance?limit=0",
                "limit",
                "greater_than_equal",
            ),
            (
                "/debug/observability/performance?limit=5001",
                "limit",
                "less_than_equal",
            ),
            (
                "/debug/observability/performance?since_minutes=0",
                "since_minutes",
                "greater_than_equal",
            ),
            (
                "/debug/observability/performance?since_minutes=1441",
                "since_minutes",
                "less_than_equal",
            ),
            (
                "/debug/observability/performance?limit=invalid",
                "limit",
                "int_parsing",
            ),
        ] {
            let (status, error) = get_json(app.clone(), uri).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
            assert_eq!(error["detail"][0]["loc"], json!(["query", field]));
            assert_eq!(error["detail"][0]["type"], error_type);
        }
    }
}
