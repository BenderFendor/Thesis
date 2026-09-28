use crate::models::Rejection;
use std::collections::{BTreeMap, BTreeSet};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use utoipa::ToSchema;

use crate::profiling::{ProfilingError, ProfilingState, StartupEvent, StartupStats};

use super::{provider_failed, provider_unavailable, DebugProviderError, DebugState};

pub(super) fn router(state: DebugState) -> Router {
    Router::new()
        .route("/debug/streams", get(get_stream_status))
        .route("/debug/metrics/pipeline", get(get_pipeline_metrics))
        .route("/debug/system/status", get(get_system_status))
        .route("/debug/jobs", get(list_active_jobs))
        .route("/debug/updates/subscribers", get(get_updates_subscribers))
        .with_state(state)
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = StartupMetricsResponse)]
pub(crate) struct StartupMetricsResponse {
    #[schema(required = false)]
    completed_at: Option<String>,
    #[schema(required = false)]
    duration_seconds: Option<f64>,
    events: Vec<StartupEventResponse>,
    #[schema(schema_with = super::free_form_object_schema)]
    notes: BTreeMap<String, Value>,
    #[schema(required = false)]
    started_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct StartupEventResponse {
    #[schema(required = false)]
    completed_at: Option<String>,
    #[schema(required = false)]
    detail: Option<String>,
    #[schema(required = false)]
    duration_seconds: Option<f64>,
    #[schema(required = false, schema_with = super::optional_free_form_object_schema)]
    metadata: Option<BTreeMap<String, Value>>,
    name: String,
    #[schema(required = false)]
    started_at: Option<String>,
}

impl From<StartupStats> for StartupMetricsResponse {
    fn from(stats: StartupStats) -> Self {
        Self {
            completed_at: stats.completed_at,
            duration_seconds: stats.duration_seconds,
            events: stats
                .events
                .into_iter()
                .map(StartupEventResponse::from)
                .collect(),
            notes: stats.notes,
            started_at: stats.started_at,
        }
    }
}

impl From<StartupEvent> for StartupEventResponse {
    fn from(event: StartupEvent) -> Self {
        Self {
            completed_at: Some(event.completed_at),
            detail: event.detail,
            duration_seconds: Some(event.duration_seconds),
            metadata: Some(event.metadata),
            name: event.name,
            started_at: Some(event.started_at),
        }
    }
}

async fn observe_startup(state: &ProfilingState) -> Result<StartupMetricsResponse, Rejection> {
    match crate::profiling::observe(state).await {
        Ok(observation) => Ok(observation.startup.into()),
        Err(ProfilingError::Unavailable) => Err(Rejection::from(provider_unavailable(
            "Profiling observer is not available",
        ))),
        Err(ProfilingError::Failed(message)) => {
            tracing::error!(%message, "startup metrics observer failed");
            Err(Rejection::from(
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"detail": "Debug provider request failed"})),
                )
                    .into_response(),
            ))
        }
    }
}

#[utoipa::path(
    get,
    path = "/debug/streams",
    operation_id = "get_stream_status_debug_streams_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)), (status = 503, description = "Debug runtime provider is not available", body = inline(super::FreeFormObjectSchema)))
)]
pub(crate) async fn get_stream_status(State(state): State<DebugState>) -> Response {
    match state.runtime_snapshot().await {
        Ok(snapshot) => Json(json!({
            "active_streams": snapshot.streams.active_streams,
            "total_streams_created": snapshot.streams.total_streams_created,
            "streams": snapshot.streams.streams,
            "source_throttling": snapshot.streams.source_throttling
        }))
        .into_response(),
        Err(error) => provider_failed(error, "Debug runtime provider is not available"),
    }
}

#[utoipa::path(
    get,
    path = "/debug/metrics/pipeline",
    operation_id = "get_pipeline_metrics_debug_metrics_pipeline_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)), (status = 503, description = "Debug runtime provider is not available", body = inline(super::FreeFormObjectSchema)))
)]
pub(crate) async fn get_pipeline_metrics(State(state): State<DebugState>) -> Response {
    match state.runtime_snapshot().await {
        Ok(snapshot) => Json(json!({
            "success": true,
            "metrics": snapshot.pipeline_metrics
        }))
        .into_response(),
        Err(error) => provider_failed(error, "Debug runtime provider is not available"),
    }
}

#[utoipa::path(
    get,
    path = "/debug/startup",
    operation_id = "get_startup_metrics_debug_startup_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = StartupMetricsResponse))
)]
pub(crate) async fn get_startup_metrics(State(state): State<ProfilingState>) -> Response {
    match observe_startup(&state).await {
        Ok(response) => Json(response).into_response(),
        Err(response) => response.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/debug/system/status",
    operation_id = "get_system_status_debug_system_status_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)))
)]
pub(crate) async fn get_system_status(State(state): State<DebugState>) -> Json<Value> {
    let cache = state.cache_stream.snapshot();
    let cache_status = state.cache_stream.status();
    let sources_tracked = cache
        .articles
        .iter()
        .filter_map(|article| article.get("source").and_then(Value::as_str))
        .collect::<BTreeSet<_>>()
        .len();
    let (pipeline, embedding_queue_depth) = match state.runtime_snapshot().await {
        Ok(snapshot) => (snapshot.pipeline_metrics, snapshot.embedding_queue_depth),
        Err(error) => {
            if let DebugProviderError::Failed(message) = error {
                tracing::warn!(%message, "debug runtime provider unavailable for system status");
            }
            (
                json!({"available": false, "detail": "Debug runtime provider is not available"}),
                None,
            )
        }
    };
    let startup = match observe_startup(&state.profiling).await {
        Ok(startup) => serde_json::to_value(startup).unwrap_or_else(|error| {
            tracing::error!(%error, "failed to serialize startup metrics");
            json!({"available": false, "detail": "Startup metrics could not be serialized"})
        }),
        Err(_) => json!({
            "available": false,
            "detail": "Startup metrics are not available"
        }),
    };
    let embedding_queue = json!({
        "available": embedding_queue_depth.is_some(),
        "depth": embedding_queue_depth,
        "batch_size": state.config.embedding_batch_size,
        "max_per_minute": state.config.embedding_max_per_minute
    });
    let components = json!({
        "cache": {
            "healthy": true,
            "article_count": cache.articles.len(),
            "source_count": cache.source_stats.len(),
            "last_updated": cache.last_updated.as_str(),
            "age_seconds": cache.cache_age_seconds,
            "update_in_progress": cache_status.update_in_progress,
            "update_count": null,
            "update_count_available": false,
            "incremental_enabled": state.config.enable_incremental_cache,
            "sources_tracked": sources_tracked
        },
        "database": {
            "healthy": state.config.enable_database,
            "enabled": state.config.enable_database
        },
        "vector_store": {
            "healthy": state.providers.chroma.is_some()
        },
        "embedding_queue": embedding_queue
    });
    let runtime = json!({
        "rust_version": env!("CARGO_PKG_VERSION"),
        "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        "pid": std::process::id(),
        "working_dir": std::env::current_dir().ok().map(|path| path.to_string_lossy().into_owned())
    });
    Json(json!({
        "startup": startup,
        "components": components,
        "pipeline": pipeline,
        "runtime": runtime,
        "config": {
            "debug_mode": state.config.debug_mode,
            "enable_database": state.config.enable_database,
            "chroma_host": state.config.chroma_host,
            "chroma_port": state.config.chroma_port
        },
        "timestamp": Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
    }))
}

#[utoipa::path(
    get,
    path = "/debug/jobs",
    operation_id = "list_active_jobs_debug_jobs_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)), (status = 503, description = "Debug runtime provider is not available", body = inline(super::FreeFormObjectSchema)))
)]
pub(crate) async fn list_active_jobs(State(state): State<DebugState>) -> Response {
    match state.runtime_snapshot().await {
        Ok(snapshot) => {
            let jobs = snapshot
                .jobs
                .into_iter()
                .map(|(job_id, job)| {
                    let projected = ["status", "started_at", "progress", "error"]
                        .into_iter()
                        .map(|field| {
                            (
                                field.to_owned(),
                                job.get(field).cloned().unwrap_or(Value::Null),
                            )
                        })
                        .collect::<Map<_, _>>();
                    (job_id, Value::Object(projected))
                })
                .collect::<Map<_, _>>();
            Json(json!({"active_jobs": jobs.len(), "jobs": jobs})).into_response()
        }
        Err(error) => provider_failed(error, "Debug runtime provider is not available"),
    }
}

#[utoipa::path(
    get,
    path = "/debug/updates/subscribers",
    operation_id = "get_updates_subscribers_debug_updates_subscribers_get",
    tag = "debug",
    responses((status = 200, description = "Successful Response", body = inline(super::FreeFormObjectSchema)), (status = 503, description = "Debug runtime provider is not available", body = inline(super::FreeFormObjectSchema)))
)]
pub(crate) async fn get_updates_subscribers(State(state): State<DebugState>) -> Response {
    match state.runtime_snapshot().await {
        Ok(snapshot) => Json(json!({
            "subscriber_count": snapshot.update_subscribers.subscriber_count,
            "total_events_sent": snapshot.update_subscribers.total_events_sent
        }))
        .into_response(),
        Err(error) => provider_failed(error, "Debug runtime provider is not available"),
    }
}
