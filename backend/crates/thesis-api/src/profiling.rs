//! Typed observability boundary for the B09 profiling operations.
//!
//! The default state owns an active process-local collector. Its Axum middleware
//! records request counts, durations, histograms, and server-error outcomes;
//! query and startup measurements use explicit hooks on [`ProfilingState`].
//! The collector does not synthesize live metrics or substitute host-resource
//! snapshots for FastAPI's per-process profiling measurements.
//!
//! The response projections retain FastAPI's successful 200 shapes, `limit`
//! behavior, reset response, and no-auth route semantics. Invalid observations
//! are rejected with a 500 response so malformed metrics cannot become health
//! or Prometheus claims.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use axum::body::Body;
use axum::extract::{RawQuery, State};
use axum::http::header::CONTENT_TYPE;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const OBSERVER_UNAVAILABLE_DETAIL: &str = "Profiling observer is not available";

/// Future returned by a runtime profiling adapter.
pub(crate) type ProfilingFuture<T> =
    Pin<Box<dyn Future<Output = Result<T, ProfilingError>> + Send>>;

/// Runtime failures that can be projected without exposing provider internals.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ProfilingError {
    /// The process that owns profiling state is not connected to this router.
    Unavailable,
    /// A connected observer failed; the public response remains generic.
    Failed(String),
}

/// One endpoint timing row from the process-local profiler.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EndpointMetric {
    pub(crate) endpoint: String,
    pub(crate) call_count: i64,
    pub(crate) total_time_ms: f64,
    pub(crate) avg_time_ms: f64,
    pub(crate) min_time_ms: f64,
    pub(crate) max_time_ms: f64,
    pub(crate) p50_ms: f64,
    pub(crate) p95_ms: f64,
    pub(crate) p99_ms: f64,
    pub(crate) errors: i64,
    pub(crate) errors_percent: f64,
}

/// One normalized query row from the profiling session.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct QueryMetric {
    pub(crate) query: String,
    pub(crate) call_count: i64,
    pub(crate) total_time_ms: f64,
    pub(crate) avg_time_ms: f64,
    pub(crate) min_time_ms: f64,
    pub(crate) max_time_ms: f64,
    pub(crate) errors: i64,
}

/// One external-call row from the profiling session.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ExternalCallMetric {
    pub(crate) service: String,
    pub(crate) operation: String,
    pub(crate) call_count: i64,
    pub(crate) total_time_ms: f64,
    pub(crate) avg_time_ms: f64,
    pub(crate) min_time_ms: f64,
    pub(crate) max_time_ms: f64,
    pub(crate) timeouts: i64,
    pub(crate) errors: i64,
}

/// Memory aggregate emitted by the profiler when sampling was enabled.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MemorySummary {
    pub(crate) samples: i64,
    pub(crate) rss_avg_mb: f64,
    pub(crate) rss_max_mb: f64,
    pub(crate) rss_min_mb: f64,
}

/// The full profiling-session observation needed by the public projections.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProfilingSummary {
    pub(crate) session_name: String,
    pub(crate) duration_seconds: f64,
    pub(crate) endpoints: Vec<EndpointMetric>,
    pub(crate) queries: Vec<QueryMetric>,
    pub(crate) external_calls: Vec<ExternalCallMetric>,
    pub(crate) memory: Option<MemorySummary>,
}

/// One slow database query from the dedicated query profiler.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SlowQuery {
    pub(crate) duration_ms: f64,
    pub(crate) statement: String,
    pub(crate) timestamp: String,
}

/// Dedicated query-profiler statistics exposed by `/profiling/queries`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct QueryStats {
    pub(crate) total_queries: i64,
    pub(crate) total_time_ms: f64,
    pub(crate) avg_time_ms: f64,
    pub(crate) slow_query_count: i64,
    pub(crate) slow_queries: Vec<SlowQuery>,
}

/// One startup event from the local startup recorder.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StartupEvent {
    pub(crate) name: String,
    pub(crate) started_at: String,
    pub(crate) completed_at: String,
    pub(crate) duration_seconds: f64,
    pub(crate) detail: Option<String>,
    pub(crate) metadata: BTreeMap<String, Value>,
}

/// Startup recorder state exposed by `/profiling/startup`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StartupStats {
    pub(crate) started_at: Option<String>,
    pub(crate) completed_at: Option<String>,
    pub(crate) duration_seconds: Option<f64>,
    pub(crate) events: Vec<StartupEvent>,
    pub(crate) notes: BTreeMap<String, Value>,
}

/// One complete read of all profiling sources.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProfilingObservation {
    pub(crate) summary: ProfilingSummary,
    pub(crate) query_stats: QueryStats,
    pub(crate) startup: StartupStats,
}

/// Runtime observer for measurements collected by the Rust API process.
///
/// Implementations return an internally coherent observation. They must not claim
/// provider, worker, or process metrics that they did not read. The HTTP handlers
/// validate numeric invariants before serialization.
pub(crate) trait ProfilingObserver: Send + Sync {
    fn observe(&self) -> ProfilingFuture<ProfilingObservation>;
    fn reset(&self) -> ProfilingFuture<()>;
}

const ENDPOINT_HISTOGRAM_CAPACITY: usize = 10_000;
const QUERY_SLOW_THRESHOLD_MS: f64 = 100.0;

/// Cloneable handle to the active process-local profiling collector.
///
/// The default state records actual HTTP request durations and status outcomes.
/// Query and startup measurements are recorded through explicit hooks below; the
/// collector does not synthesize live metrics or sample unrelated host resources.
#[derive(Clone)]
pub struct ProfilingState {
    observer: Arc<RuntimeProfiler>,
}

impl Default for ProfilingState {
    fn default() -> Self {
        Self::new()
    }
}

impl ProfilingState {
    /// Create an active process-local profiling collector.
    pub fn new() -> Self {
        let state = Self {
            observer: Arc::new(RuntimeProfiler::default()),
        };
        state.start();
        state
    }

    /// Whether the profiler is accepting measurements and serving observations.
    pub fn is_available(&self) -> bool {
        self.observer.is_available()
    }

    /// Start a new profiling session and startup lifecycle.
    pub fn start(&self) {
        self.observer.start();
    }

    /// Mark application startup as complete without stopping profiling.
    pub fn mark_app_completed(&self) {
        self.observer.mark_app_completed();
    }

    /// Stop accepting profiling measurements.
    pub fn stop(&self) {
        self.observer.stop();
    }

    /// Record one database query, including its measured duration and outcome.
    ///
    /// SQL text is retained only as the same truncated statement exposed by
    /// FastAPI; bound parameter values are not accepted or recorded.
    pub fn record_query(
        &self,
        query_type: &str,
        statement: &str,
        duration: Duration,
        success: bool,
    ) {
        self.observer
            .record_query(query_type, statement, duration, success);
    }

    /// Record an explicitly measured external call.
    pub fn record_external_call(
        &self,
        service: &str,
        operation: &str,
        duration: Duration,
        success: bool,
        timeout: bool,
    ) {
        self.observer
            .record_external_call(service, operation, duration, success, timeout);
    }

    /// Record a completed startup event measured by the caller.
    pub fn record_startup_event(
        &self,
        name: impl Into<String>,
        started_at: SystemTime,
        detail: Option<String>,
        metadata: BTreeMap<String, Value>,
    ) {
        self.observer
            .record_startup_event(name.into(), started_at, detail, metadata);
    }

    /// Add or replace one startup note.
    pub fn add_startup_note(&self, key: impl Into<String>, value: Value) {
        self.observer.add_startup_note(key.into(), value);
    }
}

#[derive(Default)]
struct RuntimeProfiler {
    data: Mutex<ProfilingData>,
}

#[derive(Default)]
struct ProfilingData {
    active: bool,
    session_started: Option<Instant>,
    session_stopped: Option<Instant>,
    endpoints: Vec<EndpointAccumulator>,
    endpoint_indexes: HashMap<String, usize>,
    queries: Vec<QueryAccumulator>,
    query_indexes: HashMap<String, usize>,
    external_calls: Vec<ExternalCallAccumulator>,
    external_indexes: HashMap<(String, String), usize>,
    query_stats: QueryStatsAccumulator,
    startup: StartupAccumulator,
}

#[derive(Clone, Default)]
struct EndpointAccumulator {
    endpoint: String,
    call_count: i64,
    total_time_ms: f64,
    min_time_ms: Option<f64>,
    max_time_ms: f64,
    samples_ms: VecDeque<f64>,
    errors: i64,
}

impl EndpointAccumulator {
    fn record(&mut self, duration_ms: f64, success: bool) {
        self.call_count = self.call_count.saturating_add(1);
        self.total_time_ms += duration_ms;
        self.min_time_ms = Some(
            self.min_time_ms
                .map_or(duration_ms, |min| min.min(duration_ms)),
        );
        self.max_time_ms = self.max_time_ms.max(duration_ms);
        if self.samples_ms.len() == ENDPOINT_HISTOGRAM_CAPACITY {
            self.samples_ms.pop_front();
        }
        self.samples_ms.push_back(duration_ms);
        if !success {
            self.errors = self.errors.saturating_add(1);
        }
    }

    fn metric(self) -> EndpointMetric {
        let mut samples = self.samples_ms.into_iter().collect::<Vec<_>>();
        samples.sort_by(f64::total_cmp);
        EndpointMetric {
            endpoint: self.endpoint,
            call_count: self.call_count,
            total_time_ms: round2(self.total_time_ms),
            avg_time_ms: if self.call_count == 0 {
                0.0
            } else {
                round2(self.total_time_ms / self.call_count as f64)
            },
            min_time_ms: round2(self.min_time_ms.unwrap_or(0.0)),
            max_time_ms: round2(self.max_time_ms),
            p50_ms: percentile(&samples, 50),
            p95_ms: percentile(&samples, 95),
            p99_ms: percentile(&samples, 99),
            errors: self.errors,
            errors_percent: if self.call_count == 0 {
                0.0
            } else {
                round2(self.errors as f64 / self.call_count as f64 * 100.0)
            },
        }
    }
}

#[derive(Default)]
struct QueryAccumulator {
    query: String,
    call_count: i64,
    total_time_ms: f64,
    min_time_ms: Option<f64>,
    max_time_ms: f64,
    errors: i64,
}

impl QueryAccumulator {
    fn record(&mut self, duration_ms: f64, success: bool) {
        self.call_count = self.call_count.saturating_add(1);
        self.total_time_ms += duration_ms;
        self.min_time_ms = Some(
            self.min_time_ms
                .map_or(duration_ms, |min| min.min(duration_ms)),
        );
        self.max_time_ms = self.max_time_ms.max(duration_ms);
        if !success {
            self.errors = self.errors.saturating_add(1);
        }
    }

    fn metric(&self) -> QueryMetric {
        QueryMetric {
            query: self.query.clone(),
            call_count: self.call_count,
            total_time_ms: round2(self.total_time_ms),
            avg_time_ms: if self.call_count == 0 {
                0.0
            } else {
                round2(self.total_time_ms / self.call_count as f64)
            },
            min_time_ms: round2(self.min_time_ms.unwrap_or(0.0)),
            max_time_ms: round2(self.max_time_ms),
            errors: self.errors,
        }
    }
}

#[derive(Default)]
struct ExternalCallAccumulator {
    service: String,
    operation: String,
    call_count: i64,
    total_time_ms: f64,
    min_time_ms: Option<f64>,
    max_time_ms: f64,
    timeouts: i64,
    errors: i64,
}

impl ExternalCallAccumulator {
    fn record(&mut self, duration_ms: f64, success: bool, timeout: bool) {
        self.call_count = self.call_count.saturating_add(1);
        self.total_time_ms += duration_ms;
        self.min_time_ms = Some(
            self.min_time_ms
                .map_or(duration_ms, |min| min.min(duration_ms)),
        );
        self.max_time_ms = self.max_time_ms.max(duration_ms);
        if timeout {
            self.timeouts = self.timeouts.saturating_add(1);
        } else if !success {
            self.errors = self.errors.saturating_add(1);
        }
    }

    fn metric(&self) -> ExternalCallMetric {
        ExternalCallMetric {
            service: self.service.clone(),
            operation: self.operation.clone(),
            call_count: self.call_count,
            total_time_ms: round2(self.total_time_ms),
            avg_time_ms: if self.call_count == 0 {
                0.0
            } else {
                round2(self.total_time_ms / self.call_count as f64)
            },
            min_time_ms: round2(self.min_time_ms.unwrap_or(0.0)),
            max_time_ms: round2(self.max_time_ms),
            timeouts: self.timeouts,
            errors: self.errors,
        }
    }
}

#[derive(Default)]
struct QueryStatsAccumulator {
    total_queries: i64,
    total_time_ms: f64,
    slow_query_count: i64,
    slow_queries: Vec<SlowQuery>,
}

impl QueryStatsAccumulator {
    fn record(&mut self, statement: &str, duration_ms: f64, timestamp: SystemTime) {
        self.total_queries = self.total_queries.saturating_add(1);
        self.total_time_ms += duration_ms;
        if duration_ms >= QUERY_SLOW_THRESHOLD_MS {
            self.slow_query_count = self.slow_query_count.saturating_add(1);
            let query = SlowQuery {
                duration_ms,
                statement: truncate_chars(statement, 200),
                timestamp: system_time_isoformat(timestamp),
            };
            let index = self
                .slow_queries
                .iter()
                .position(|existing| existing.duration_ms < duration_ms)
                .unwrap_or(self.slow_queries.len());
            if index < 20 {
                self.slow_queries.insert(index, query);
                self.slow_queries.truncate(20);
            }
        }
    }

    fn stats(&self) -> QueryStats {
        QueryStats {
            total_queries: self.total_queries,
            total_time_ms: round2(self.total_time_ms),
            avg_time_ms: if self.total_queries == 0 {
                0.0
            } else {
                round2(self.total_time_ms / self.total_queries as f64)
            },
            slow_query_count: self.slow_query_count,
            slow_queries: self.slow_queries.clone(),
        }
    }
}

#[derive(Default)]
struct StartupAccumulator {
    started_at: Option<SystemTime>,
    completed_at: Option<SystemTime>,
    duration_seconds: Option<f64>,
    events: Vec<StartupEvent>,
    notes: BTreeMap<String, Value>,
}

impl StartupAccumulator {
    fn stats(&self) -> StartupStats {
        StartupStats {
            started_at: self.started_at.map(system_time_isoformat),
            completed_at: self.completed_at.map(system_time_isoformat),
            duration_seconds: self.duration_seconds,
            events: self.events.clone(),
            notes: self.notes.clone(),
        }
    }
}

impl RuntimeProfiler {
    fn is_available(&self) -> bool {
        self.data.lock().expect("profiling state lock").active
    }

    fn start(&self) {
        let now = SystemTime::now();
        let mut data = self.data.lock().expect("profiling state lock");
        data.active = true;
        data.session_started = Some(Instant::now());
        data.session_stopped = None;
        data.startup.started_at = Some(now);
        data.startup.completed_at = None;
        data.startup.duration_seconds = None;
        data.startup.events.clear();
        data.startup.notes.clear();
    }

    fn mark_app_completed(&self) {
        let now = SystemTime::now();
        let mut data = self.data.lock().expect("profiling state lock");
        data.startup.completed_at = Some(now);
        data.startup.duration_seconds = data.startup.started_at.and_then(|started| {
            now.duration_since(started)
                .ok()
                .map(|duration| duration.as_secs_f64())
        });
    }

    fn stop(&self) {
        let now = SystemTime::now();
        let mut data = self.data.lock().expect("profiling state lock");
        data.active = false;
        data.session_stopped = Some(Instant::now());
        data.startup.completed_at = Some(now);
        data.startup.duration_seconds = data.startup.started_at.and_then(|started| {
            now.duration_since(started)
                .ok()
                .map(|duration| duration.as_secs_f64())
        });
    }

    fn record_request(&self, method: &str, path: &str, duration: Duration, success: bool) {
        let mut data = self.data.lock().expect("profiling state lock");
        if !data.active {
            return;
        }
        let endpoint = format!("{method}:{path}");
        let index = match data.endpoint_indexes.get(&endpoint) {
            Some(index) => *index,
            None => {
                let index = data.endpoints.len();
                data.endpoint_indexes.insert(endpoint.clone(), index);
                data.endpoints.push(EndpointAccumulator {
                    endpoint,
                    ..EndpointAccumulator::default()
                });
                index
            }
        };
        data.endpoints[index].record(duration.as_secs_f64() * 1000.0, success);
    }

    fn record_query(&self, query_type: &str, statement: &str, duration: Duration, success: bool) {
        let duration_ms = duration.as_secs_f64() * 1000.0;
        let summary_statement = truncate_chars(statement, 100);
        let query = format!("{query_type}:{summary_statement}");
        let now = SystemTime::now();
        let mut data = self.data.lock().expect("profiling state lock");
        if !data.active {
            return;
        }
        let index = match data.query_indexes.get(&query) {
            Some(index) => *index,
            None => {
                let index = data.queries.len();
                data.query_indexes.insert(query.clone(), index);
                data.queries.push(QueryAccumulator {
                    query,
                    ..QueryAccumulator::default()
                });
                index
            }
        };
        data.queries[index].record(duration_ms, success);
        data.query_stats.record(statement, duration_ms, now);
    }

    fn record_external_call(
        &self,
        service: &str,
        operation: &str,
        duration: Duration,
        success: bool,
        timeout: bool,
    ) {
        let key = (service.to_owned(), operation.to_owned());
        let mut data = self.data.lock().expect("profiling state lock");
        if !data.active {
            return;
        }
        let index = match data.external_indexes.get(&key) {
            Some(index) => *index,
            None => {
                let index = data.external_calls.len();
                data.external_indexes.insert(key.clone(), index);
                data.external_calls.push(ExternalCallAccumulator {
                    service: key.0,
                    operation: key.1,
                    ..ExternalCallAccumulator::default()
                });
                index
            }
        };
        data.external_calls[index].record(duration.as_secs_f64() * 1000.0, success, timeout);
    }

    fn record_startup_event(
        &self,
        name: String,
        started_at: SystemTime,
        detail: Option<String>,
        metadata: BTreeMap<String, Value>,
    ) {
        let completed_at = SystemTime::now();
        let duration_seconds = completed_at
            .duration_since(started_at)
            .map_or(0.0, |duration| duration.as_secs_f64());
        self.data
            .lock()
            .expect("profiling state lock")
            .startup
            .events
            .push(StartupEvent {
                name,
                started_at: system_time_isoformat(started_at),
                completed_at: system_time_isoformat(completed_at),
                duration_seconds,
                detail,
                metadata,
            });
    }

    fn add_startup_note(&self, key: String, value: Value) {
        self.data
            .lock()
            .expect("profiling state lock")
            .startup
            .notes
            .insert(key, value);
    }

    fn observation(&self) -> Result<ProfilingObservation, ProfilingError> {
        let (
            duration_seconds,
            endpoint_accumulators,
            mut queries,
            mut external_calls,
            query_stats,
            startup,
        ) = {
            let data = self.data.lock().expect("profiling state lock");
            if !data.active {
                return Err(ProfilingError::Unavailable);
            }
            let duration_seconds = match (data.session_started, data.session_stopped) {
                (Some(started), Some(stopped)) => stopped.duration_since(started).as_secs_f64(),
                _ => 0.0,
            };
            let mut queries = data
                .queries
                .iter()
                .map(QueryAccumulator::metric)
                .collect::<Vec<_>>();
            queries.sort_by(|left, right| {
                right
                    .avg_time_ms
                    .partial_cmp(&left.avg_time_ms)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut external_calls = data
                .external_calls
                .iter()
                .map(ExternalCallAccumulator::metric)
                .collect::<Vec<_>>();
            external_calls.sort_by(|left, right| {
                right
                    .avg_time_ms
                    .partial_cmp(&left.avg_time_ms)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            (
                duration_seconds,
                data.endpoints.clone(),
                queries,
                external_calls,
                data.query_stats.stats(),
                data.startup.stats(),
            )
        };
        let mut endpoints = endpoint_accumulators
            .into_iter()
            .map(EndpointAccumulator::metric)
            .collect::<Vec<_>>();
        endpoints.sort_by(|left, right| {
            right
                .avg_time_ms
                .partial_cmp(&left.avg_time_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(ProfilingObservation {
            summary: ProfilingSummary {
                session_name: "default".to_owned(),
                duration_seconds: round2(duration_seconds),
                endpoints,
                queries,
                external_calls,
                memory: None,
            },
            query_stats,
            startup,
        })
    }
}

impl ProfilingObserver for RuntimeProfiler {
    fn observe(&self) -> ProfilingFuture<ProfilingObservation> {
        Box::pin(std::future::ready(self.observation()))
    }

    fn reset(&self) -> ProfilingFuture<()> {
        let result = {
            let mut data = self.data.lock().expect("profiling state lock");
            if !data.active {
                Err(ProfilingError::Unavailable)
            } else {
                data.session_started = Some(Instant::now());
                data.session_stopped = None;
                data.query_stats = QueryStatsAccumulator::default();
                Ok(())
            }
        };
        Box::pin(std::future::ready(result))
    }
}

/// Axum request middleware layer that records process-local HTTP measurements.
pub fn middleware_layer(
    state: ProfilingState,
) -> axum::middleware::FromFnLayer<
    fn(
        State<ProfilingState>,
        axum::extract::Request,
        axum::middleware::Next,
    ) -> ProfilingMiddlewareFuture,
    ProfilingState,
    (State<ProfilingState>, axum::extract::Request),
> {
    axum::middleware::from_fn_with_state(state, record_request as _)
}

pub type ProfilingMiddlewareFuture = Pin<Box<dyn Future<Output = Response> + Send>>;

fn record_request(
    State(state): State<ProfilingState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> ProfilingMiddlewareFuture {
    Box::pin(async move {
        let path = request.uri().path();
        if matches!(path, "/health" | "/favicon.ico" | "/metrics" | "/static/") {
            return next.run(request).await;
        }
        let method = request.method().as_str().to_owned();
        let path = path.to_owned();
        let started = Instant::now();
        let response = next.run(request).await;
        state.observer.record_request(
            &method,
            &path,
            started.elapsed(),
            response.status().as_u16() < 500,
        );
        response
    })
}

fn percentile(samples: &[f64], percentile: usize) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let index = (samples.len() * percentile / 100).min(samples.len() - 1);
    round2(samples[index])
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn system_time_isoformat(timestamp: SystemTime) -> String {
    chrono::DateTime::<Utc>::from(timestamp).to_rfc3339_opts(SecondsFormat::Micros, false)
}

/// OpenAPI marker for FastAPI's anonymous `dict[str, Any]` responses.
#[derive(Debug)]
pub(crate) struct ProfilingObjectSchema;

impl PartialSchema for ProfilingObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for ProfilingObjectSchema {}

/// OpenAPI marker for FastAPI's `dict[str, str]` reset response.
#[derive(Debug)]
pub(crate) struct ProfilingStringMapSchema;

impl PartialSchema for ProfilingStringMapSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
            .build()
            .into()
    }
}

impl ToSchema for ProfilingStringMapSchema {}

#[derive(Clone, Debug, Serialize)]
struct ProfilingSummaryResponse {
    session_name: String,
    duration_seconds: f64,
    endpoints: Vec<EndpointMetricResponse>,
    queries: Vec<QueryMetricResponse>,
    external_calls: Vec<ExternalCallMetricResponse>,
    memory: Option<MemorySummaryResponse>,
    total_requests: i64,
    total_errors: i64,
}

#[derive(Clone, Debug, Serialize)]
struct EndpointMetricResponse {
    endpoint: String,
    call_count: i64,
    total_time_ms: f64,
    avg_time_ms: f64,
    min_time_ms: f64,
    max_time_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    errors: i64,
    errors_percent: f64,
}

impl From<&EndpointMetric> for EndpointMetricResponse {
    fn from(value: &EndpointMetric) -> Self {
        Self {
            endpoint: value.endpoint.clone(),
            call_count: value.call_count,
            total_time_ms: value.total_time_ms,
            avg_time_ms: value.avg_time_ms,
            min_time_ms: value.min_time_ms,
            max_time_ms: value.max_time_ms,
            p50_ms: value.p50_ms,
            p95_ms: value.p95_ms,
            p99_ms: value.p99_ms,
            errors: value.errors,
            errors_percent: value.errors_percent,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct QueryMetricResponse {
    query: String,
    call_count: i64,
    total_time_ms: f64,
    avg_time_ms: f64,
    min_time_ms: f64,
    max_time_ms: f64,
    errors: i64,
}

impl From<&QueryMetric> for QueryMetricResponse {
    fn from(value: &QueryMetric) -> Self {
        Self {
            query: value.query.clone(),
            call_count: value.call_count,
            total_time_ms: value.total_time_ms,
            avg_time_ms: value.avg_time_ms,
            min_time_ms: value.min_time_ms,
            max_time_ms: value.max_time_ms,
            errors: value.errors,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct ExternalCallMetricResponse {
    service: String,
    operation: String,
    call_count: i64,
    total_time_ms: f64,
    avg_time_ms: f64,
    min_time_ms: f64,
    max_time_ms: f64,
    timeouts: i64,
    errors: i64,
}

impl From<&ExternalCallMetric> for ExternalCallMetricResponse {
    fn from(value: &ExternalCallMetric) -> Self {
        Self {
            service: value.service.clone(),
            operation: value.operation.clone(),
            call_count: value.call_count,
            total_time_ms: value.total_time_ms,
            avg_time_ms: value.avg_time_ms,
            min_time_ms: value.min_time_ms,
            max_time_ms: value.max_time_ms,
            timeouts: value.timeouts,
            errors: value.errors,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct MemorySummaryResponse {
    samples: i64,
    rss_avg_mb: f64,
    rss_max_mb: f64,
    rss_min_mb: f64,
}

impl From<&MemorySummary> for MemorySummaryResponse {
    fn from(value: &MemorySummary) -> Self {
        Self {
            samples: value.samples,
            rss_avg_mb: value.rss_avg_mb,
            rss_max_mb: value.rss_max_mb,
            rss_min_mb: value.rss_min_mb,
        }
    }
}

impl From<&ProfilingSummary> for ProfilingSummaryResponse {
    fn from(value: &ProfilingSummary) -> Self {
        Self {
            session_name: value.session_name.clone(),
            duration_seconds: value.duration_seconds,
            endpoints: value
                .endpoints
                .iter()
                .map(EndpointMetricResponse::from)
                .collect(),
            queries: value
                .queries
                .iter()
                .map(QueryMetricResponse::from)
                .collect(),
            external_calls: value
                .external_calls
                .iter()
                .map(ExternalCallMetricResponse::from)
                .collect(),
            memory: value.memory.as_ref().map(MemorySummaryResponse::from),
            total_requests: value.endpoints.iter().map(|item| item.call_count).sum(),
            total_errors: value.endpoints.iter().map(|item| item.errors).sum(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct QueryStatsResponse {
    total_queries: i64,
    total_time_ms: f64,
    avg_time_ms: f64,
    slow_query_count: i64,
    slow_queries: Vec<SlowQueryResponse>,
}

#[derive(Clone, Debug, Serialize)]
struct SlowQueryResponse {
    duration_ms: f64,
    statement: String,
    timestamp: String,
}

impl From<&QueryStats> for QueryStatsResponse {
    fn from(value: &QueryStats) -> Self {
        Self {
            total_queries: value.total_queries,
            total_time_ms: value.total_time_ms,
            avg_time_ms: value.avg_time_ms,
            slow_query_count: value.slow_query_count,
            slow_queries: value
                .slow_queries
                .iter()
                .take(20)
                .map(|query| SlowQueryResponse {
                    duration_ms: query.duration_ms,
                    statement: query.statement.chars().take(200).collect(),
                    timestamp: query.timestamp.clone(),
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct StartupStatsResponse {
    started_at: Option<String>,
    completed_at: Option<String>,
    duration_seconds: Option<f64>,
    events: Vec<StartupEventResponse>,
    notes: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize)]
struct StartupEventResponse {
    name: String,
    started_at: String,
    completed_at: String,
    duration_seconds: f64,
    detail: Option<String>,
    metadata: BTreeMap<String, Value>,
}

impl From<&StartupStats> for StartupStatsResponse {
    fn from(value: &StartupStats) -> Self {
        Self {
            started_at: value.started_at.clone(),
            completed_at: value.completed_at.clone(),
            duration_seconds: value.duration_seconds,
            events: value
                .events
                .iter()
                .map(|event| StartupEventResponse {
                    name: event.name.clone(),
                    started_at: event.started_at.clone(),
                    completed_at: event.completed_at.clone(),
                    duration_seconds: event.duration_seconds,
                    detail: event.detail.clone(),
                    metadata: event.metadata.clone(),
                })
                .collect(),
            notes: value.notes.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct SlowEndpointsResponse {
    timestamp: String,
    endpoints: Vec<EndpointMetricResponse>,
}

#[derive(Clone, Debug, Serialize)]
struct ResetResponse {
    status: &'static str,
}

#[derive(Clone, Debug, Serialize)]
struct ProfilingHealthResponse {
    status: &'static str,
    total_requests: i64,
    total_errors: i64,
    error_rate_percent: f64,
    avg_latency_ms: f64,
    p95_latency_ms: f64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct SlowEndpointsParameters {
    #[param(required = false, default = 5)]
    limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
struct BottleneckSummary {
    timestamp: String,
    bottleneck_count: usize,
    bottlenecks: Vec<Bottleneck>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
enum Bottleneck {
    Endpoint {
        #[serde(rename = "type")]
        kind: &'static str,
        target: String,
        p95_ms: f64,
        call_count: i64,
        severity: &'static str,
    },
    Query {
        #[serde(rename = "type")]
        kind: &'static str,
        target: String,
        avg_ms: f64,
        call_count: i64,
        severity: &'static str,
    },
    External {
        #[serde(rename = "type")]
        kind: &'static str,
        target: String,
        avg_ms: f64,
        timeouts: i64,
        severity: &'static str,
    },
}

#[utoipa::path(
    get,
    path = "/profiling/metrics",
    operation_id = "metrics_profiling_metrics_get",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(Value)))
)]
pub(crate) async fn metrics(State(state): State<ProfilingState>) -> Response {
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    prometheus_response(&observation.summary)
}

#[utoipa::path(
    get,
    path = "/profiling/summary",
    operation_id = "profiling_summary_profiling_summary_get",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(ProfilingObjectSchema)))
)]
pub(crate) async fn profiling_summary(State(state): State<ProfilingState>) -> Response {
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    Json(ProfilingSummaryResponse::from(&observation.summary)).into_response()
}

#[utoipa::path(
    get,
    path = "/profiling/bottlenecks",
    operation_id = "bottlenecks_profiling_bottlenecks_get",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(ProfilingObjectSchema)))
)]
pub(crate) async fn bottlenecks(State(state): State<ProfilingState>) -> Response {
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    Json(bottleneck_summary(&observation.summary)).into_response()
}

#[utoipa::path(
    get,
    path = "/profiling/queries",
    operation_id = "query_stats_profiling_queries_get",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(ProfilingObjectSchema)))
)]
pub(crate) async fn query_stats(State(state): State<ProfilingState>) -> Response {
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    Json(QueryStatsResponse::from(&observation.query_stats)).into_response()
}

#[utoipa::path(
    get,
    path = "/profiling/startup",
    operation_id = "startup_stats_profiling_startup_get",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(ProfilingObjectSchema)))
)]
pub(crate) async fn startup_stats(State(state): State<ProfilingState>) -> Response {
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    Json(StartupStatsResponse::from(&observation.startup)).into_response()
}

#[utoipa::path(
    get,
    path = "/profiling/slow-endpoints",
    operation_id = "slow_endpoints_profiling_slow_endpoints_get",
    tag = "profiling",
    params(SlowEndpointsParameters),
    responses(
        (status = 200, description = "Successful Response", body = inline(ProfilingObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn slow_endpoints(
    State(state): State<ProfilingState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let parameters = match parse_limit(raw_query.as_deref()) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let limit = parameters.limit.unwrap_or(5);
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    let endpoints = slice_like_python(&observation.summary.endpoints, limit)
        .iter()
        .map(EndpointMetricResponse::from)
        .collect();
    Json(SlowEndpointsResponse {
        timestamp: utc_isoformat(),
        endpoints,
    })
    .into_response()
}

#[utoipa::path(
    post,
    path = "/profiling/reset",
    operation_id = "reset_profiling_profiling_reset_post",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(ProfilingStringMapSchema)))
)]
pub(crate) async fn reset_profiling(State(state): State<ProfilingState>) -> Response {
    match state.observer.reset().await {
        Ok(()) => Json(ResetResponse { status: "reset" }).into_response(),
        Err(error) => profiling_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/profiling/health",
    operation_id = "profiling_health_profiling_health_get",
    tag = "profiling",
    responses((status = 200, description = "Successful Response", body = inline(ProfilingObjectSchema)))
)]
pub(crate) async fn profiling_health(State(state): State<ProfilingState>) -> Response {
    let observation = match observe(&state).await {
        Ok(observation) => observation,
        Err(error) => return profiling_error_response(error),
    };
    Json(health_response(&observation.summary)).into_response()
}

pub(crate) async fn observe(
    state: &ProfilingState,
) -> Result<ProfilingObservation, ProfilingError> {
    let observation = state.observer.observe().await?;
    validate_observation(&observation).map_err(|detail| {
        tracing::error!(%detail, "profiling observer returned invalid metrics");
        ProfilingError::Failed(detail)
    })?;
    Ok(observation)
}

fn profiling_error_response(error: ProfilingError) -> Response {
    match error {
        ProfilingError::Unavailable => observer_unavailable_response(),
        ProfilingError::Failed(detail) => {
            tracing::error!(%detail, "profiling observer failed");
            internal_server_error()
        }
    }
}

fn observer_unavailable_response() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": OBSERVER_UNAVAILABLE_DETAIL})),
    )
        .into_response()
}

fn internal_server_error() -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
}

fn validate_observation(observation: &ProfilingObservation) -> Result<(), String> {
    finite_nonnegative(
        "summary.duration_seconds",
        observation.summary.duration_seconds,
    )?;
    for endpoint in &observation.summary.endpoints {
        nonnegative_count("endpoint.call_count", endpoint.call_count)?;
        nonnegative_count("endpoint.errors", endpoint.errors)?;
        if endpoint.errors > endpoint.call_count {
            return Err("endpoint.errors exceeds endpoint.call_count".to_owned());
        }
        for (name, value) in [
            ("endpoint.total_time_ms", endpoint.total_time_ms),
            ("endpoint.avg_time_ms", endpoint.avg_time_ms),
            ("endpoint.min_time_ms", endpoint.min_time_ms),
            ("endpoint.max_time_ms", endpoint.max_time_ms),
            ("endpoint.p50_ms", endpoint.p50_ms),
            ("endpoint.p95_ms", endpoint.p95_ms),
            ("endpoint.p99_ms", endpoint.p99_ms),
            ("endpoint.errors_percent", endpoint.errors_percent),
        ] {
            finite_nonnegative(name, value)?;
        }
    }
    for query in &observation.summary.queries {
        nonnegative_count("query.call_count", query.call_count)?;
        nonnegative_count("query.errors", query.errors)?;
        if query.errors > query.call_count {
            return Err("query.errors exceeds query.call_count".to_owned());
        }
        for (name, value) in [
            ("query.total_time_ms", query.total_time_ms),
            ("query.avg_time_ms", query.avg_time_ms),
            ("query.min_time_ms", query.min_time_ms),
            ("query.max_time_ms", query.max_time_ms),
        ] {
            finite_nonnegative(name, value)?;
        }
    }
    for call in &observation.summary.external_calls {
        for name in [
            "external.call_count",
            "external.timeouts",
            "external.errors",
        ] {
            let count = match name {
                "external.call_count" => call.call_count,
                "external.timeouts" => call.timeouts,
                _ => call.errors,
            };
            nonnegative_count(name, count)?;
        }
        if call.errors > call.call_count || call.timeouts > call.call_count {
            return Err("external error counters exceed external.call_count".to_owned());
        }
        for (name, value) in [
            ("external.total_time_ms", call.total_time_ms),
            ("external.avg_time_ms", call.avg_time_ms),
            ("external.min_time_ms", call.min_time_ms),
            ("external.max_time_ms", call.max_time_ms),
        ] {
            finite_nonnegative(name, value)?;
        }
    }
    if let Some(memory) = observation.summary.memory.as_ref() {
        nonnegative_count("memory.samples", memory.samples)?;
        for (name, value) in [
            ("memory.rss_avg_mb", memory.rss_avg_mb),
            ("memory.rss_max_mb", memory.rss_max_mb),
            ("memory.rss_min_mb", memory.rss_min_mb),
        ] {
            finite_nonnegative(name, value)?;
        }
    }
    nonnegative_count(
        "query_stats.total_queries",
        observation.query_stats.total_queries,
    )?;
    nonnegative_count(
        "query_stats.slow_query_count",
        observation.query_stats.slow_query_count,
    )?;
    for (name, value) in [
        (
            "query_stats.total_time_ms",
            observation.query_stats.total_time_ms,
        ),
        (
            "query_stats.avg_time_ms",
            observation.query_stats.avg_time_ms,
        ),
    ] {
        finite_nonnegative(name, value)?;
    }
    for query in &observation.query_stats.slow_queries {
        finite_nonnegative("slow_query.duration_ms", query.duration_ms)?;
    }
    if let Some(duration) = observation.startup.duration_seconds {
        finite_nonnegative("startup.duration_seconds", duration)?;
    }
    for event in &observation.startup.events {
        finite_nonnegative("startup.event.duration_seconds", event.duration_seconds)?;
    }
    Ok(())
}

fn finite_nonnegative(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and non-negative"))
    }
}

fn nonnegative_count(name: &str, value: i64) -> Result<(), String> {
    if value >= 0 {
        Ok(())
    } else {
        Err(format!("{name} must be non-negative"))
    }
}

fn prometheus_response(summary: &ProfilingSummary) -> Response {
    let mut lines = vec![
        "# HELP http_requests_total Total HTTP requests".to_owned(),
        "# TYPE http_requests_total counter".to_owned(),
    ];
    for endpoint in &summary.endpoints {
        let endpoint_name = endpoint.endpoint.replace(['/', ':'], "_");
        let endpoint_name = escape_prometheus_label(&endpoint_name);
        lines.push(format!(
            "http_requests_total{{endpoint=\"{endpoint_name}\"}} {}",
            endpoint.call_count
        ));
        for (quantile, value) in [
            ("0.50", endpoint.p50_ms),
            ("0.95", endpoint.p95_ms),
            ("0.99", endpoint.p99_ms),
        ] {
            lines.push(format!(
                "http_request_duration_seconds{{endpoint=\"{endpoint_name}\",quantile=\"{quantile}\"}} {}",
                prometheus_number(value / 1000.0)
            ));
        }
    }
    if let Some(memory) = summary.memory.as_ref() {
        lines.push(format!(
            "process_resident_memory_bytes{{metric=\"rss\"}} {}",
            (memory.rss_max_mb.max(0.0) * 1024.0 * 1024.0) as u64
        ));
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(lines.join("\n")))
        .expect("valid Prometheus response")
}

fn escape_prometheus_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn prometheus_number(value: f64) -> String {
    let mut text = value.to_string();
    if !text.contains('.') && !text.contains('e') && !text.contains('E') {
        text.push_str(".0");
    }
    text
}

fn bottleneck_summary(summary: &ProfilingSummary) -> BottleneckSummary {
    let mut bottlenecks = Vec::new();
    for endpoint in &summary.endpoints {
        if endpoint.p95_ms > 1000.0 {
            bottlenecks.push(Bottleneck::Endpoint {
                kind: "high_latency_endpoint",
                target: endpoint.endpoint.clone(),
                p95_ms: endpoint.p95_ms,
                call_count: endpoint.call_count,
                severity: if endpoint.p95_ms > 5000.0 {
                    "critical"
                } else {
                    "warning"
                },
            });
        }
    }
    for query in &summary.queries {
        if query.avg_time_ms > 100.0 {
            bottlenecks.push(Bottleneck::Query {
                kind: "slow_query",
                target: query.query.chars().take(100).collect(),
                avg_ms: query.avg_time_ms,
                call_count: query.call_count,
                severity: if query.avg_time_ms > 500.0 {
                    "critical"
                } else {
                    "warning"
                },
            });
        }
    }
    for call in &summary.external_calls {
        if call.avg_time_ms > 1000.0 || call.timeouts > 0 {
            bottlenecks.push(Bottleneck::External {
                kind: "slow_external_call",
                target: format!("{}:{}", call.service, call.operation),
                avg_ms: call.avg_time_ms,
                timeouts: call.timeouts,
                severity: if call.timeouts > 0 {
                    "critical"
                } else {
                    "warning"
                },
            });
        }
    }
    bottlenecks.sort_by(|left, right| {
        bottleneck_sort_value(right)
            .partial_cmp(&bottleneck_sort_value(left))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    BottleneckSummary {
        timestamp: utc_isoformat(),
        bottleneck_count: bottlenecks.len(),
        bottlenecks,
    }
}

fn bottleneck_sort_value(item: &Bottleneck) -> f64 {
    match item {
        Bottleneck::Endpoint { p95_ms, .. } => *p95_ms,
        Bottleneck::Query { avg_ms, .. } | Bottleneck::External { avg_ms, .. } => *avg_ms,
    }
}

fn health_response(summary: &ProfilingSummary) -> ProfilingHealthResponse {
    let total_requests: i64 = summary.endpoints.iter().map(|item| item.call_count).sum();
    let total_errors: i64 = summary.endpoints.iter().map(|item| item.errors).sum();
    let avg_latency_ms = mean_rounded(
        summary
            .endpoints
            .iter()
            .map(|item| item.avg_time_ms)
            .collect::<Vec<_>>(),
    );
    let p95_latency_ms = mean_rounded(
        summary
            .endpoints
            .iter()
            .map(|item| item.p95_ms)
            .collect::<Vec<_>>(),
    );
    ProfilingHealthResponse {
        status: if total_errors == 0 {
            "healthy"
        } else {
            "degraded"
        },
        total_requests,
        total_errors,
        error_rate_percent: if total_requests > 0 {
            round2(total_errors as f64 / total_requests as f64 * 100.0)
        } else {
            0.0
        },
        avg_latency_ms,
        p95_latency_ms,
    }
}

fn mean_rounded(values: Vec<f64>) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        round2(values.iter().sum::<f64>() / values.len() as f64)
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn utc_isoformat() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

fn slice_like_python<T: Clone>(values: &[T], limit: i64) -> Vec<T> {
    if limit >= 0 {
        values.iter().take(limit as usize).cloned().collect()
    } else {
        let omitted = limit.checked_abs().unwrap_or(i64::MAX) as usize;
        values[..values.len().saturating_sub(omitted)].to_vec()
    }
}

fn parse_limit(raw_query: Option<&str>) -> Result<SlowEndpointsParameters, HttpValidationError> {
    let mut limit = None;
    for pair in raw_query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query_component(raw_key)
            .map_err(|_| query_error(raw_key, "query_string_parsing"))?;
        if key != "limit" {
            continue;
        }
        let value = decode_query_component(raw_value)
            .map_err(|_| query_error(raw_value, "query_string_parsing"))?;
        limit = Some(
            value
                .trim()
                .parse::<i64>()
                .map_err(|_| HttpValidationError {
                    detail: vec![ValidationError {
                        loc: vec![
                            ValidationLocation::Text("query".to_owned()),
                            ValidationLocation::Text("limit".to_owned()),
                        ],
                        msg:
                            "Input should be a valid integer, unable to parse string as an integer"
                                .to_owned(),
                        error_type: "int_parsing".to_owned(),
                        input: Value::String(value),
                        ctx: None,
                    }],
                })?,
        );
    }
    Ok(SlowEndpointsParameters { limit })
}

fn query_error(input: &str, error_type: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text("limit".to_owned()),
            ],
            msg: "Query string could not be parsed".to_owned(),
            error_type: error_type.to_owned(),
            input: Value::String(input.to_owned()),
            ctx: None,
        }],
    }
}

fn decode_query_component(input: &str) -> Result<String, ()> {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => decoded.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let high = hex_digit(bytes[index + 1]).ok_or(())?;
                let low = hex_digit(bytes[index + 2]).ok_or(())?;
                decoded.push((high << 4) | low);
                index += 2;
            }
            b'%' => return Err(()),
            byte => decoded.push(byte),
        }
        index += 1;
    }
    String::from_utf8(decoded).map_err(|_| ())
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request};
    use axum::routing::{get, post};
    use axum::Router;
    use serde_json::json;
    use std::time::UNIX_EPOCH;
    use tower::ServiceExt;

    async fn request(app: &Router, method: Method, uri: &str) -> (StatusCode, Vec<u8>) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("valid test request"),
            )
            .await
            .expect("infallible Axum response");
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("collect test response body");
        (status, body.to_vec())
    }

    fn response_json(body: &[u8]) -> Value {
        serde_json::from_slice(body).expect("valid profiling JSON")
    }

    async fn measured_success() -> StatusCode {
        std::thread::sleep(Duration::from_millis(20));
        StatusCode::OK
    }

    #[tokio::test]
    async fn runtime_routes_report_measured_requests_queries_and_lifecycle() {
        let state = ProfilingState::default();
        state.record_query(
            "execute",
            "SELECT * FROM articles WHERE id = $1",
            Duration::from_millis(150),
            true,
        );
        let long_statement = format!("UPDATE articles SET body = '{}'", "x".repeat(240));
        state.record_query(
            "execute",
            &long_statement,
            Duration::from_millis(300),
            false,
        );
        state.record_external_call(
            "embedding",
            "request",
            Duration::from_millis(1_500),
            false,
            true,
        );
        state.record_startup_event(
            "database_connected",
            SystemTime::now()
                .checked_sub(Duration::from_millis(20))
                .expect("valid startup timestamp"),
            Some("local runtime".to_owned()),
            BTreeMap::from([("pool_size".to_owned(), json!(4))]),
        );
        state.add_startup_note("worker_role", json!("leader"));
        state.mark_app_completed();

        let app = Router::new()
            .route("/work", get(measured_success))
            .route(
                "/failure",
                get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .route("/health", get(|| async { StatusCode::OK }))
            .route("/favicon.ico", get(|| async { StatusCode::OK }))
            .route("/metrics", get(|| async { StatusCode::OK }))
            .route("/static/", get(|| async { StatusCode::OK }))
            .route("/profiling/metrics", get(metrics))
            .route("/profiling/summary", get(profiling_summary))
            .route("/profiling/bottlenecks", get(bottlenecks))
            .route("/profiling/queries", get(query_stats))
            .route("/profiling/startup", get(startup_stats))
            .route("/profiling/slow-endpoints", get(slow_endpoints))
            .route("/profiling/reset", post(reset_profiling))
            .route("/profiling/health", get(profiling_health))
            .layer(middleware_layer(state.clone()))
            .with_state(state.clone());

        assert_eq!(request(&app, Method::GET, "/work").await.0, StatusCode::OK);
        assert_eq!(
            request(&app, Method::GET, "/failure").await.0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        for skipped in ["/health", "/favicon.ico", "/metrics", "/static/"] {
            assert_eq!(request(&app, Method::GET, skipped).await.0, StatusCode::OK);
        }

        let (status, body) = request(&app, Method::GET, "/profiling/summary").await;
        assert_eq!(status, StatusCode::OK);
        let summary = response_json(&body);
        assert_eq!(summary["total_requests"], 2);
        assert_eq!(summary["total_errors"], 1);
        assert_eq!(summary["memory"], Value::Null);
        let endpoints = summary["endpoints"].as_array().expect("endpoint rows");
        let work = endpoints
            .iter()
            .find(|endpoint| endpoint["endpoint"] == "GET:/work")
            .expect("measured work endpoint");
        assert_eq!(work["call_count"], 1);
        assert_eq!(work["errors"], 0);
        assert!(work["total_time_ms"].as_f64().unwrap() >= 15.0);
        assert!(work["p50_ms"].as_f64().unwrap() > 0.0);
        assert!(work["p95_ms"].as_f64().unwrap() >= work["p50_ms"].as_f64().unwrap());
        let failure = endpoints
            .iter()
            .find(|endpoint| endpoint["endpoint"] == "GET:/failure")
            .expect("measured failed endpoint");
        assert_eq!(failure["call_count"], 1);
        assert_eq!(failure["errors"], 1);
        assert_eq!(failure["errors_percent"], 100.0);
        assert!(!endpoints.iter().any(|endpoint| {
            matches!(
                endpoint["endpoint"].as_str(),
                Some("GET:/health" | "GET:/favicon.ico" | "GET:/metrics" | "GET:/static/")
            )
        }));
        assert_eq!(summary["queries"].as_array().unwrap().len(), 2);
        assert_eq!(
            summary["queries"][0]["query"],
            format!(
                "execute:{}",
                long_statement.chars().take(100).collect::<String>()
            )
        );
        assert_eq!(summary["queries"][0]["errors"], 1);
        assert_eq!(summary["external_calls"][0]["timeouts"], 1);

        let (status, body) = request(&app, Method::GET, "/profiling/metrics").await;
        assert_eq!(status, StatusCode::OK);
        let metrics_text = String::from_utf8(body).expect("Prometheus UTF-8");
        assert!(metrics_text.contains("# TYPE http_requests_total counter"));
        assert!(metrics_text.contains("http_requests_total{endpoint=\"GET__work\"} 1"));
        assert!(metrics_text
            .contains("http_request_duration_seconds{endpoint=\"GET__work\",quantile=\"0.50\"}"));

        let (status, body) = request(&app, Method::GET, "/profiling/bottlenecks").await;
        assert_eq!(status, StatusCode::OK);
        let bottlenecks = response_json(&body);
        assert!(bottlenecks["bottleneck_count"].as_u64().unwrap() >= 3);
        assert_eq!(bottlenecks["bottlenecks"][0]["target"], "embedding:request");

        let (status, body) = request(&app, Method::GET, "/profiling/queries").await;
        assert_eq!(status, StatusCode::OK);
        let queries = response_json(&body);
        assert_eq!(queries["total_queries"], 2);
        assert_eq!(queries["total_time_ms"], 450.0);
        assert_eq!(queries["avg_time_ms"], 225.0);
        assert_eq!(queries["slow_query_count"], 2);
        assert_eq!(queries["slow_queries"][0]["duration_ms"], 300.0);
        assert_eq!(
            queries["slow_queries"][0]["statement"]
                .as_str()
                .unwrap()
                .len(),
            200
        );
        assert_eq!(
            queries["slow_queries"][1]["statement"],
            "SELECT * FROM articles WHERE id = $1"
        );

        let (status, body) = request(&app, Method::GET, "/profiling/startup").await;
        assert_eq!(status, StatusCode::OK);
        let startup = response_json(&body);
        assert!(startup["started_at"].is_string());
        assert!(startup["completed_at"].is_string());
        assert_eq!(startup["notes"]["worker_role"], "leader");
        assert_eq!(startup["events"][0]["name"], "database_connected");
        assert_eq!(startup["events"][0]["metadata"]["pool_size"], 4);

        let (status, body) = request(&app, Method::GET, "/profiling/slow-endpoints?limit=1").await;
        assert_eq!(status, StatusCode::OK);
        let slow = response_json(&body);
        assert_eq!(slow["endpoints"].as_array().unwrap().len(), 1);
        assert_eq!(slow["endpoints"][0]["endpoint"], "GET:/work");
        assert!(slow["timestamp"].is_string());
        assert_eq!(
            request(&app, Method::GET, "/profiling/slow-endpoints?limit=invalid")
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );

        let (_, summary_body) = request(&app, Method::GET, "/profiling/summary").await;
        let expected_negative_limit = response_json(&summary_body)["endpoints"]
            .as_array()
            .unwrap()
            .len()
            .saturating_sub(1);
        let (status, body) = request(&app, Method::GET, "/profiling/slow-endpoints?limit=-1").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            response_json(&body)["endpoints"].as_array().unwrap().len(),
            expected_negative_limit
        );

        let (status, body) = request(&app, Method::POST, "/profiling/reset").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(response_json(&body), json!({"status": "reset"}));
        let (status, body) = request(&app, Method::GET, "/profiling/queries").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(response_json(&body)["total_queries"], 0);
        let (status, body) = request(&app, Method::GET, "/profiling/summary").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(response_json(&body)["total_errors"], 1);

        let (status, body) = request(&app, Method::GET, "/profiling/health").await;
        assert_eq!(status, StatusCode::OK);
        let health = response_json(&body);
        assert_eq!(health["status"], "degraded");
        assert_eq!(health["total_errors"], 1);
        assert!(health["error_rate_percent"].as_f64().unwrap() > 0.0);

        state.stop();
        assert!(!state.is_available());
        assert_eq!(
            request(&app, Method::GET, "/profiling/summary").await.0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        state.start();
        assert!(state.is_available());
        let (status, body) = request(&app, Method::GET, "/profiling/startup").await;
        assert_eq!(status, StatusCode::OK);
        assert!(response_json(&body)["events"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn endpoint_percentiles_use_fastapi_index_and_rounding() {
        let mut endpoint = EndpointAccumulator {
            endpoint: "GET:/sample".to_owned(),
            ..EndpointAccumulator::default()
        };
        endpoint.record(1.0, true);
        endpoint.record(2.0, false);
        endpoint.record(3.0, true);

        let metric = endpoint.metric();
        assert_eq!(metric.call_count, 3);
        assert_eq!(metric.errors, 1);
        assert_eq!(metric.p50_ms, 2.0);
        assert_eq!(metric.p95_ms, 3.0);
        assert_eq!(metric.p99_ms, 3.0);
    }

    #[test]
    fn endpoint_histograms_keep_the_recent_ten_thousand_samples() {
        let mut endpoint = EndpointAccumulator {
            endpoint: "GET:/sample".to_owned(),
            ..EndpointAccumulator::default()
        };
        for duration_ms in 0_u32..=10_000 {
            endpoint.record(f64::from(duration_ms), true);
        }

        let metric = endpoint.metric();
        assert_eq!(metric.call_count, 10_001);
        assert_eq!(metric.min_time_ms, 0.0);
        assert_eq!(metric.max_time_ms, 10_000.0);
        assert_eq!(metric.p50_ms, 5_001.0);
        assert_eq!(metric.p95_ms, 9_501.0);
        assert_eq!(metric.p99_ms, 9_901.0);
    }

    #[test]
    fn query_stats_count_all_slow_queries_and_return_the_twenty_slowest() {
        let mut accumulator = QueryStatsAccumulator::default();
        for duration_ms in 99_u32..=124 {
            accumulator.record("SELECT $1", f64::from(duration_ms), UNIX_EPOCH);
        }

        let response = QueryStatsResponse::from(&accumulator.stats());
        assert_eq!(response.total_queries, 26);
        assert_eq!(response.slow_query_count, 25);
        assert_eq!(response.slow_queries.len(), 20);
        assert_eq!(response.slow_queries[0].duration_ms, 124.0);
        assert_eq!(response.slow_queries[19].duration_ms, 105.0);
    }
    #[test]
    fn profiling_startup_timestamp_formatter_uses_utc_offset() {
        assert!(system_time_isoformat(UNIX_EPOCH).ends_with("+00:00"));
    }
}
