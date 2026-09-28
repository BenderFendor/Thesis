//! Deterministic protocol boundary for the B03 cache and stream operations.
//!
//! FastAPI remains the public application server.  This module owns only the
//! local cache snapshot, invalidation sequencing, bounded refresh admission,
//! and response/SSE framing that can be checked without an RSS provider.  It
//! deliberately does not create an HTTP client, a background worker, or a
//! fabricated live feed.  An integrator may reserve a refresh slot with
//! `begin_refresh(true)`, perform provider work outside this module, then call
//! `complete_refresh` with the provider result.
//!
//! The legacy Python refresh route returns HTTP 200 even when its detached
//! worker later fails.  The Rust boundary keeps the documented 200 operation
//! status but returns `status: "error"` and an explicit message when no
//! provider is available.  This is an intentional, observable strengthening:
//! a provider failure cannot be reported as a successful refresh.  The news
//! and cache-refresh SSE operations use the same in-band error convention,
//! while the updates stream emits only locally published invalidations.

use std::collections::{BTreeMap, VecDeque};
use std::convert::Infallible;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

use axum::extract::{RawQuery, State};
use axum::http::header::{HeaderValue, CONNECTION};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response as AxumResponse};
use axum::Json;
use chrono::{SecondsFormat, Utc};
use futures_util::stream::{poll_fn, Stream};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use thesis_runtime::{
    Backpressure, EventCursor, QueueAccounting, QueueError, QueueLimits, ShutdownCommand,
    ShutdownController, ShutdownPhase,
};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, SchemaType, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationLocation};

const MAX_PENDING_INVALIDATIONS: usize = 100;
const MAX_REFRESH_EVENTS: usize = 100;
const MAX_NEWS_EVENTS: usize = 100;
/// Maximum concurrent source fetches the live-news adapter may run per stream.
pub const NEWS_STREAM_MAX_CONCURRENT_SOURCES: usize = 5;
const MAX_ACTIVE_NEWS_STREAMS: u32 = 5;
const MAX_IN_FLIGHT_REFRESHES: u32 = 1;
const DEFAULT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
const INITIAL_LAST_UPDATED: &str = "1970-01-01T00:00:00+00:00";
const PROVIDER_UNAVAILABLE_MESSAGE: &str = "Cache refresh provider is not available";
const NEWS_STREAM_UNAVAILABLE_MESSAGE: &str = "News live stream provider is not available";

/// A local cache payload supplied by a completed refresh or a deterministic fixture.
#[derive(Clone, Debug, PartialEq)]
pub struct CacheSnapshot {
    /// Article objects retained at the cache boundary.
    pub articles: Vec<Value>,
    /// Source-stat objects retained at the cache boundary.
    pub source_stats: Vec<Value>,
    /// Age supplied by the cache owner rather than guessed from provider time.
    pub cache_age_seconds: f64,
    /// ISO-8601 timestamp supplied by the cache owner.
    pub last_updated: String,
}

impl Default for CacheSnapshot {
    fn default() -> Self {
        Self::empty()
    }
}

impl CacheSnapshot {
    /// Construct an empty snapshot with a stable, valid timestamp.
    pub fn empty() -> Self {
        Self {
            articles: Vec::new(),
            source_stats: Vec::new(),
            cache_age_seconds: 0.0,
            last_updated: INITIAL_LAST_UPDATED.to_owned(),
        }
    }

    /// Construct a snapshot from local article and source records.
    pub fn new(
        articles: Vec<Value>,
        source_stats: Vec<Value>,
        cache_age_seconds: f64,
        last_updated: impl Into<String>,
    ) -> Self {
        Self {
            articles,
            source_stats,
            cache_age_seconds: cache_age_seconds.max(0.0),
            last_updated: last_updated.into(),
        }
    }

    fn filtered_articles(&self, category: Option<&str>) -> Vec<Value> {
        self.articles
            .iter()
            .filter(|article| {
                category.is_none_or(|expected| {
                    article
                        .get("category")
                        .and_then(Value::as_str)
                        .is_some_and(|actual| actual == expected)
                })
            })
            .cloned()
            .collect()
    }

    fn is_fresh_for(&self, category: Option<&str>) -> bool {
        self.cache_age_seconds < 120.0 && !self.filtered_articles(category).is_empty()
    }

    fn category_breakdown(&self) -> BTreeMap<String, i64> {
        let mut counts = BTreeMap::new();
        for article in &self.articles {
            let Some(category) = article.get("category").and_then(Value::as_str) else {
                continue;
            };
            let entry = counts.entry(category.to_owned()).or_insert(0);
            *entry += 1;
        }
        counts
    }

    fn source_count_with_articles(&self) -> i64 {
        self.source_stats
            .iter()
            .filter(|source| {
                source
                    .get("article_count")
                    .and_then(Value::as_i64)
                    .is_some_and(|count| count > 0)
            })
            .count() as i64
    }

    fn source_count_by_status(&self, status: &str) -> i64 {
        self.source_stats
            .iter()
            .filter(|source| source.get("status").and_then(Value::as_str) == Some(status))
            .count() as i64
    }
}

/// FastAPI-compatible `/cache/status` payload.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq)]
#[schema(as = CacheStatus)]
pub struct CacheStatusResponse {
    pub cache_age_seconds: f64,
    #[schema(schema_with = category_breakdown_schema)]
    pub category_breakdown: BTreeMap<String, i64>,
    pub last_updated: String,
    pub sources_with_errors: i64,
    pub sources_with_warnings: i64,
    pub sources_working: i64,
    pub total_articles: i64,
    pub total_sources: i64,
    pub update_in_progress: bool,
}

fn category_breakdown_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(ObjectBuilder::new().schema_type(Type::Integer)))
        .build()
        .into()
}

/// FastAPI-compatible body for `/cache/refresh`.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct CacheRefreshResponse {
    pub message: String,
    pub status: String,
}

/// FastAPI-compatible body for `/updates/status`.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct UpdatesStatusResponse {
    pub active_subscribers: i64,
    pub total_events_sent: i64,
}

/// OpenAPI marker for FastAPI's unconstrained stream response schema.
#[derive(Debug)]
pub struct CacheStreamEmptyResponseSchema;

impl PartialSchema for CacheStreamEmptyResponseSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(SchemaType::AnyValue)
            .build()
            .into()
    }
}

impl ToSchema for CacheStreamEmptyResponseSchema {}

/// OpenAPI marker for FastAPI's `dict[str, str]` refresh response.
#[derive(Debug)]
pub struct CacheRefreshStringMapSchema;

impl PartialSchema for CacheRefreshStringMapSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
            .build()
            .into()
    }
}

impl ToSchema for CacheRefreshStringMapSchema {}

/// OpenAPI marker for FastAPI's free-form updates status response.
#[derive(Debug)]
pub struct UpdatesStatusFreeFormSchema;

impl PartialSchema for UpdatesStatusFreeFormSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for UpdatesStatusFreeFormSchema {}

/// A completed provider result.  Provider fetching and parsing stay outside the
/// API crate; only decoded local values cross this boundary.
#[derive(Clone, Debug, PartialEq)]
pub struct RefreshResult {
    pub snapshot: CacheSnapshot,
}

/// Why a local cache operation could not be completed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CacheStreamError {
    /// No configured provider can perform a refresh.
    ProviderUnavailable,
    /// The caller attempted a live news operation without a live provider.
    LiveStreamUnavailable,
    /// The bounded invalidation or refresh queue rejected admission.
    Backpressure(Backpressure),
    /// Shutdown has closed refresh admission.
    Shutdown(ShutdownPhase),
    /// The local queue reducer reached an impossible transition.
    QueueInvariant(QueueError),
    /// A monotonic event sequence cannot advance.
    EventSequenceExhausted,
    /// A completion was received without an admitted refresh.
    NoRefreshInFlight,
    /// A streaming client disconnected before a live news operation completed.
    SubscriberDisconnected,
    /// The provider or integration returned an explicit failure.
    ProviderFailed(String),
}
impl fmt::Display for CacheStreamError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProviderUnavailable => formatter.write_str(PROVIDER_UNAVAILABLE_MESSAGE),
            Self::LiveStreamUnavailable => formatter.write_str(NEWS_STREAM_UNAVAILABLE_MESSAGE),
            Self::Backpressure(reason) => reason.fmt(formatter),
            Self::Shutdown(phase) => {
                write!(formatter, "Cache refresh is unavailable during {phase:?}")
            }
            Self::QueueInvariant(error) => {
                write!(formatter, "cache stream queue invariant failed: {error}")
            }
            Self::EventSequenceExhausted => formatter.write_str("cache event sequence exhausted"),
            Self::NoRefreshInFlight => formatter.write_str("no cache refresh is in progress"),
            Self::SubscriberDisconnected => formatter.write_str("news stream client disconnected"),
            Self::ProviderFailed(error) => formatter.write_str(error),
        }
    }
}

/// Result of trying to reserve one refresh worker slot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RefreshAdmission {
    /// A refresh was admitted and the integrator may invoke its provider.
    Started,
    /// A refresh already owns the sole worker slot.
    AlreadyRunning,
}

/// Clock used for public stream/cache timestamps.
pub trait CacheStreamClock: Send + Sync {
    /// Return the current UTC timestamp in ISO-8601 form.
    fn timestamp(&self) -> String;
}

struct SystemCacheStreamClock;

impl CacheStreamClock for SystemCacheStreamClock {
    fn timestamp(&self) -> String {
        Utc::now().to_rfc3339_opts(SecondsFormat::AutoSi, false)
    }
}

/// Publisher for the FastAPI-compatible WebSocket cache-updated event.
pub trait CacheUpdatePublisher: Send + Sync {
    /// Broadcast one already-shaped cache-updated JSON object.
    fn publish_cache_updated(&self, event: &Value);
}

/// Runtime refresh adapter. `launch` must return promptly after scheduling
/// bounded provider work; the worker reports progress and completion through
/// the observer and must continue after the SSE client disconnects.
pub trait CacheRefreshProvider: Send + Sync {
    /// Start one refresh worker with its progress/completion observer.
    fn launch(&self, observer: CacheRefreshObserver) -> Result<(), CacheStreamError>;
}

#[derive(Default)]
struct RefreshProgress {
    processed_sources: usize,
    failed_sources: usize,
}

struct CacheRefreshObserverInner {
    state: CacheStreamState,
    sender: Option<BoundedSender<RefreshMessage>>,
    progress: Mutex<RefreshProgress>,
    completed: AtomicBool,
}

/// Bounded reporting handle supplied to a cache refresh worker.
#[derive(Clone)]
pub struct CacheRefreshObserver {
    inner: Arc<CacheRefreshObserverInner>,
}

impl CacheRefreshObserver {
    fn new(state: CacheStreamState, sender: Option<BoundedSender<RefreshMessage>>) -> Self {
        Self {
            inner: Arc::new(CacheRefreshObserverInner {
                state,
                sender,
                progress: Mutex::new(RefreshProgress::default()),
                completed: AtomicBool::new(false),
            }),
        }
    }

    /// Publish one completed source while preserving provider completion order.
    pub fn source_complete(
        &self,
        source: Option<String>,
        article_count: usize,
        source_stat: Value,
    ) {
        let (processed_sources, failed_sources) = {
            let mut progress = self.inner.progress.lock().expect("refresh progress lock");
            progress.processed_sources += 1;
            if source_stat.get("status").and_then(Value::as_str) == Some("error") {
                progress.failed_sources += 1;
            }
            (progress.processed_sources, progress.failed_sources)
        };
        if let Some(sender) = &self.inner.sender {
            let frame = SseFrame::data(json!({
                "status": "source_complete",
                "source": source,
                "articles_from_source": article_count,
                "total_sources_processed": processed_sources,
                "failed_sources": failed_sources,
                "source_stat": source_stat,
                "timestamp": self.inner.state.clock.timestamp(),
            }));
            let _ = sender.send(RefreshMessage::Frame(frame));
        }
    }

    /// Complete the refresh, commit its cache snapshot, and publish terminal progress.
    pub fn finish(
        &self,
        result: Result<RefreshResult, CacheStreamError>,
    ) -> Result<(), CacheStreamError> {
        if self.inner.completed.swap(true, Ordering::AcqRel) {
            return Err(CacheStreamError::NoRefreshInFlight);
        }
        let frame = match result {
            Ok(result) => match self.inner.state.complete_refresh(Ok(result)) {
                Ok(()) => {
                    let snapshot = self.inner.state.snapshot();
                    let successful_sources = snapshot
                        .source_stats
                        .iter()
                        .filter(|source| {
                            source.get("status").and_then(Value::as_str) == Some("success")
                        })
                        .count();
                    let failed_sources = snapshot
                        .source_stats
                        .iter()
                        .filter(|source| {
                            source.get("status").and_then(Value::as_str) == Some("error")
                        })
                        .count();
                    SseFrame::data(json!({
                        "status": "complete",
                        "message": format!(
                            "Cache refresh completed: {} total articles",
                            snapshot.articles.len()
                        ),
                        "total_articles": snapshot.articles.len(),
                        "total_sources_processed": snapshot.source_stats.len(),
                        "successful_sources": successful_sources,
                        "failed_sources": failed_sources,
                        "warning_sources": snapshot
                            .source_stats
                            .iter()
                            .filter(|source| {
                                source.get("status").and_then(Value::as_str) == Some("warning")
                            })
                            .count(),
                        "timestamp": snapshot.last_updated.as_str(),
                    }))
                }
                Err(error) => error_frame(
                    &format!("Error during cache refresh: {error}"),
                    self.inner.state.clock.timestamp(),
                ),
            },
            Err(error) => {
                let _ = self.inner.state.complete_refresh(Err(error.clone()));
                error_frame(
                    &format!("Error during cache refresh: {error}"),
                    self.inner.state.clock.timestamp(),
                )
            }
        };
        if let Some(sender) = &self.inner.sender {
            let _ = sender.send(RefreshMessage::Frame(frame));
            let _ = sender.send(RefreshMessage::End);
        }
        Ok(())
    }
}

/// Source request passed to a live-news provider.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewsStreamRequest {
    /// Unique identifier projected into every event for this stream.
    pub stream_id: String,
    /// Whether the request permits an early fresh-cache completion.
    pub use_cache: bool,
    /// Normalized category filter, or `None` for all categories.
    pub category: Option<String>,
}

/// Cancellation handle for pending live-news provider work.
pub trait NewsStreamCancellation: Send + Sync {
    /// Cancel pending source work after the client disconnects.
    fn cancel(&self);
}

/// Metadata returned when the news provider starts its bounded source work.
pub struct NewsStreamOperation {
    /// Number of sources eligible for this request.
    pub total_sources: usize,
    cancellation: Option<Arc<dyn NewsStreamCancellation>>,
}

impl NewsStreamOperation {
    /// Create an operation whose provider work is cancelled by the given handle.
    pub fn new(total_sources: usize, cancellation: Arc<dyn NewsStreamCancellation>) -> Self {
        Self {
            total_sources,
            cancellation: Some(cancellation),
        }
    }

    /// Create an operation with no provider work requiring explicit cancellation.
    pub fn without_cancellation(total_sources: usize) -> Self {
        Self {
            total_sources,
            cancellation: None,
        }
    }
}

/// Runtime provider for source-by-source live news stream results. Each
/// operation must cap concurrent source fetches at
/// [`NEWS_STREAM_MAX_CONCURRENT_SOURCES`] and return promptly with its
/// cancellation handle.
pub trait NewsStreamProvider: Send + Sync {
    fn launch(
        &self,
        request: NewsStreamRequest,
        observer: NewsStreamObserver,
    ) -> Result<NewsStreamOperation, CacheStreamError>;
}

/// Bounded reporting handle supplied to a live-news provider.
#[derive(Clone)]
pub struct NewsStreamObserver {
    sender: BoundedSender<NewsMessage>,
}

impl NewsStreamObserver {
    fn new(sender: BoundedSender<NewsMessage>) -> Self {
        Self { sender }
    }

    /// Publish one source's completed articles and source metadata.
    pub fn source_complete(
        &self,
        source: String,
        articles: Vec<Value>,
        source_stat: Value,
    ) -> Result<(), CacheStreamError> {
        self.sender
            .send(NewsMessage::SourceComplete {
                source,
                articles,
                source_stat,
            })
            .map_err(|_| CacheStreamError::SubscriberDisconnected)
    }

    /// Publish one source-level failure.
    pub fn source_error(&self, source: String, error: String) -> Result<(), CacheStreamError> {
        self.sender
            .send(NewsMessage::SourceError { source, error })
            .map_err(|_| CacheStreamError::SubscriberDisconnected)
    }

    /// Mark all source work complete so the stream can emit its terminal event.
    pub fn complete(&self) -> Result<(), CacheStreamError> {
        self.sender
            .send(NewsMessage::Complete)
            .map_err(|_| CacheStreamError::SubscriberDisconnected)
    }
}

struct CacheStreamInner {
    cache: Arc<CacheSnapshot>,
    refresh_queue: QueueAccounting,
    shutdown: ShutdownController,
    update_cursor: EventCursor,
    subscribers: BTreeMap<u64, BoundedSender<SseFrame>>,
    total_events_sent: u64,
    next_subscriber_id: u64,
    active_news_streams: u32,
    next_stream_id: u64,
}

/// Shared local cache and bounded transport state for cache/news/update routes.
#[derive(Clone)]
pub struct CacheStreamState {
    inner: Arc<Mutex<CacheStreamInner>>,
    refresh_provider: Option<Arc<dyn CacheRefreshProvider>>,
    news_provider: Option<Arc<dyn NewsStreamProvider>>,
    update_publisher: Option<Arc<dyn CacheUpdatePublisher>>,
    clock: Arc<dyn CacheStreamClock>,
    keepalive_interval: Duration,
}

impl Default for CacheStreamState {
    fn default() -> Self {
        Self::new()
    }
}

impl CacheStreamState {
    /// Create an empty state with no external provider attached.
    pub fn new() -> Self {
        let mut update_cursor = EventCursor::new();
        update_cursor
            .issue(Value::Null)
            .expect("connection sequence is available");
        Self {
            inner: Arc::new(Mutex::new(CacheStreamInner {
                cache: Arc::new(CacheSnapshot::empty()),
                refresh_queue: QueueAccounting::new(
                    QueueLimits::new(1, MAX_IN_FLIGHT_REFRESHES)
                        .expect("refresh queue limits are non-zero"),
                ),
                shutdown: ShutdownController::new(),
                update_cursor,
                subscribers: BTreeMap::new(),
                total_events_sent: 0,
                next_subscriber_id: 1,
                active_news_streams: 0,
                next_stream_id: 1,
            })),
            refresh_provider: None,
            news_provider: None,
            update_publisher: None,
            clock: Arc::new(SystemCacheStreamClock),
            keepalive_interval: DEFAULT_KEEPALIVE_INTERVAL,
        }
    }

    /// Attach a bounded detached-worker provider for cache refreshes.
    pub fn with_refresh_provider(mut self, provider: Arc<dyn CacheRefreshProvider>) -> Self {
        self.refresh_provider = Some(provider);
        self
    }

    /// Attach the source-by-source live-news provider.
    pub fn with_news_provider(mut self, provider: Arc<dyn NewsStreamProvider>) -> Self {
        self.news_provider = Some(provider);
        self
    }

    /// Attach the shared WebSocket broadcaster for cache-updated events.
    pub fn with_update_publisher(mut self, publisher: Arc<dyn CacheUpdatePublisher>) -> Self {
        self.update_publisher = Some(publisher);
        self
    }

    /// Use an injected clock for cache and SSE timestamps.
    pub fn with_clock(mut self, clock: Arc<dyn CacheStreamClock>) -> Self {
        self.clock = clock;
        self
    }

    /// Override the default 30-second updates-stream keepalive interval.
    pub fn with_keepalive_interval(mut self, interval: Duration) -> Self {
        self.keepalive_interval = interval;
        self
    }

    /// Replace the local cache from a trusted decoded snapshot.
    pub fn replace_cache(&self, snapshot: CacheSnapshot) {
        let mut inner = self.inner.lock().expect("cache state lock");
        inner.cache = Arc::new(snapshot);
    }

    /// Read a shared immutable snapshot without copying its cached payload.
    pub fn snapshot(&self) -> Arc<CacheSnapshot> {
        Arc::clone(&self.inner.lock().expect("cache state lock").cache)
    }

    /// Return the FastAPI-compatible cache status payload.
    pub fn status(&self) -> CacheStatusResponse {
        let inner = self.inner.lock().expect("cache state lock");
        CacheStatusResponse {
            cache_age_seconds: inner.cache.cache_age_seconds,
            category_breakdown: inner.cache.category_breakdown(),
            last_updated: inner.cache.last_updated.clone(),
            sources_with_errors: inner.cache.source_count_by_status("error"),
            sources_with_warnings: inner.cache.source_count_by_status("warning"),
            sources_working: inner.cache.source_count_with_articles(),
            total_articles: inner.cache.articles.len() as i64,
            total_sources: inner.cache.source_stats.len() as i64,
            update_in_progress: !inner.refresh_queue.snapshot().is_idle(),
        }
    }

    /// Reserve the single refresh slot after confirming a provider is configured.
    pub fn begin_refresh(
        &self,
        provider_available: bool,
    ) -> Result<RefreshAdmission, CacheStreamError> {
        let mut inner = self.inner.lock().expect("cache state lock");
        if !inner.refresh_queue.snapshot().is_idle() {
            return Ok(RefreshAdmission::AlreadyRunning);
        }
        if !inner.shutdown.accepts_new_work() {
            return Err(CacheStreamError::Shutdown(inner.shutdown.phase()));
        }
        if !provider_available {
            return Err(CacheStreamError::ProviderUnavailable);
        }
        inner.refresh_queue.enqueue().map_err(map_queue_error)?;
        inner.refresh_queue.start().map_err(map_queue_error)?;
        Ok(RefreshAdmission::Started)
    }

    fn launch_cache_refresh(
        &self,
        sender: Option<BoundedSender<RefreshMessage>>,
    ) -> Result<RefreshAdmission, CacheStreamError> {
        let admission = self.begin_refresh(self.refresh_provider.is_some())?;
        if admission == RefreshAdmission::AlreadyRunning {
            return Ok(admission);
        }
        let provider = self
            .refresh_provider
            .as_ref()
            .expect("admission requires a configured refresh provider")
            .clone();
        let observer = CacheRefreshObserver::new(self.clone(), sender);
        if let Err(error) = provider.launch(observer.clone()) {
            let _ = self.complete_refresh(Err(error.clone()));
            return Err(error);
        }
        Ok(admission)
    }

    /// Commit a provider result or retain the prior cache on provider failure.
    pub fn complete_refresh(
        &self,
        result: Result<RefreshResult, CacheStreamError>,
    ) -> Result<(), CacheStreamError> {
        let timestamp = self.clock.timestamp();
        let cache_updated = {
            let mut inner = self.inner.lock().expect("cache state lock");
            if inner.refresh_queue.snapshot().in_flight() == 0 {
                return Err(CacheStreamError::NoRefreshInFlight);
            }
            match result {
                Ok(result) => {
                    inner.refresh_queue.complete().map_err(map_queue_error)?;
                    let mut snapshot = result.snapshot;
                    snapshot.cache_age_seconds = 0.0;
                    snapshot.last_updated.clone_from(&timestamp);
                    let total_articles = snapshot.articles.len();
                    let sources_processed = snapshot.source_stats.len();
                    inner.cache = Arc::new(snapshot);
                    let event = json!({
                        "type": "cache_updated",
                        "message": "News cache has been updated",
                        "timestamp": timestamp,
                        "stats": {
                            "total_articles": total_articles,
                            "sources_processed": sources_processed,
                        },
                    });
                    issue_update_locked(
                        &mut inner,
                        "invalidate",
                        Some(json!({
                            "reason": "cache_refresh_complete",
                            "total_articles": total_articles,
                            "sources_processed": sources_processed,
                        })),
                        timestamp,
                    )?;
                    Some(event)
                }
                Err(error) => {
                    inner
                        .refresh_queue
                        .cancel_in_flight()
                        .map_err(map_queue_error)?;
                    return Err(error);
                }
            }
        };
        if let (Some(publisher), Some(event)) = (&self.update_publisher, cache_updated) {
            publisher.publish_cache_updated(&event);
        }
        Ok(())
    }

    /// Publish one local invalidation event with a contiguous sequence number.
    pub fn publish_update(
        &self,
        event_type: &str,
        data: Option<Value>,
    ) -> Result<u64, CacheStreamError> {
        let timestamp = self.clock.timestamp();
        let mut inner = self.inner.lock().expect("cache state lock");
        issue_update_locked(&mut inner, event_type, data, timestamp)
    }
    /// Start graceful shutdown.  Existing refresh work may finish.
    pub fn begin_drain(&self) -> Result<ShutdownPhase, CacheStreamError> {
        let mut inner = self.inner.lock().expect("cache state lock");
        inner
            .shutdown
            .apply(ShutdownCommand::BeginDrain)
            .map(|transition| transition.current())
            .map_err(|_| CacheStreamError::Shutdown(inner.shutdown.phase()))
    }

    /// Request cancellation of pending refresh work.
    pub fn cancel_pending(&self) -> Result<ShutdownPhase, CacheStreamError> {
        let mut inner = self.inner.lock().expect("cache state lock");
        inner
            .shutdown
            .apply(ShutdownCommand::CancelPending)
            .map(|transition| transition.current())
            .map_err(|_| CacheStreamError::Shutdown(inner.shutdown.phase()))
    }

    /// Stop all future refresh admission.
    pub fn stop(&self) -> Result<ShutdownPhase, CacheStreamError> {
        let mut inner = self.inner.lock().expect("cache state lock");
        inner
            .shutdown
            .apply(ShutdownCommand::Stop)
            .map(|transition| transition.current())
            .map_err(|_| CacheStreamError::Shutdown(inner.shutdown.phase()))
    }

    fn stream_id(&self) -> String {
        let mut inner = self.inner.lock().expect("cache state lock");
        let id = inner.next_stream_id;
        inner.next_stream_id = inner.next_stream_id.checked_add(1).unwrap_or(id);
        format!("stream_{id}")
    }
    fn subscribe_updates(&self) -> UpdateSubscription {
        let timestamp = self.clock.timestamp();
        let (sender, receiver) = bounded_channel(MAX_PENDING_INVALIDATIONS);
        let mut inner = self.inner.lock().expect("cache state lock");
        let subscriber_id = inner.next_subscriber_id;
        inner.next_subscriber_id = inner
            .next_subscriber_id
            .checked_add(1)
            .unwrap_or(subscriber_id);
        inner.subscribers.insert(subscriber_id, sender);
        UpdateSubscription {
            state: self.clone(),
            subscriber_id,
            receiver,
            connection: Some(SseFrame::connection(timestamp)),
        }
    }

    fn remove_subscriber(&self, subscriber_id: u64) {
        self.inner
            .lock()
            .expect("cache state lock")
            .subscribers
            .remove(&subscriber_id);
    }

    fn begin_news_stream(&self) -> Result<u32, u32> {
        let mut inner = self.inner.lock().expect("cache state lock");
        if inner.active_news_streams >= MAX_ACTIVE_NEWS_STREAMS {
            return Err(inner.active_news_streams);
        }
        inner.active_news_streams += 1;
        Ok(inner.active_news_streams)
    }

    fn finish_news_stream(&self) {
        let mut inner = self.inner.lock().expect("cache state lock");
        inner.active_news_streams = inner.active_news_streams.saturating_sub(1);
    }

    fn updates_status(&self) -> UpdatesStatusResponse {
        let inner = self.inner.lock().expect("cache state lock");
        UpdatesStatusResponse {
            active_subscribers: inner.subscribers.len() as i64,
            total_events_sent: inner.total_events_sent as i64,
        }
    }
}

struct UpdateSubscription {
    state: CacheStreamState,
    subscriber_id: u64,
    receiver: BoundedReceiver<SseFrame>,
    connection: Option<SseFrame>,
}

impl UpdateSubscription {
    fn poll_next(&mut self, context: &mut Context<'_>) -> Poll<Option<SseFrame>> {
        if let Some(frame) = self.connection.take() {
            return Poll::Ready(Some(frame));
        }
        self.receiver.poll_recv(context)
    }
}
impl Drop for UpdateSubscription {
    fn drop(&mut self) {
        self.state.remove_subscriber(self.subscriber_id);
    }
}

fn map_queue_error(error: QueueError) -> CacheStreamError {
    match error {
        QueueError::Backpressure(reason) => CacheStreamError::Backpressure(reason),
        invariant => CacheStreamError::QueueInvariant(invariant),
    }
}

fn issue_update_locked(
    inner: &mut CacheStreamInner,
    event_type: &str,
    data: Option<Value>,
    timestamp: String,
) -> Result<u64, CacheStreamError> {
    let total_events_sent = inner
        .total_events_sent
        .checked_add(1)
        .ok_or(CacheStreamError::EventSequenceExhausted)?;
    let issued = inner
        .update_cursor
        .issue(Value::Null)
        .map_err(|_| CacheStreamError::EventSequenceExhausted)?;
    let sequence = issued.sequence().value();
    let mut payload = Map::new();
    if let Some(Value::Object(fields)) = data {
        payload.extend(fields);
    }
    payload.insert("id".to_owned(), json!(sequence));
    payload.insert("type".to_owned(), json!(event_type));
    payload.insert("timestamp".to_owned(), json!(timestamp));
    let frame = SseFrame::with_id(sequence, Value::Object(payload));
    let mut disconnected = Vec::new();
    for (subscriber_id, sender) in &inner.subscribers {
        if sender.try_send(frame.clone()).is_err() {
            disconnected.push(*subscriber_id);
        }
    }
    for subscriber_id in disconnected {
        inner.subscribers.remove(&subscriber_id);
    }
    inner.total_events_sent = total_events_sent;
    Ok(sequence)
}

struct ChannelWake {
    waker: Mutex<Option<Waker>>,
}

impl ChannelWake {
    fn register(&self, waker: &Waker) {
        let mut current = self.waker.lock().expect("stream channel waker lock");
        if current
            .as_ref()
            .is_none_or(|registered| !registered.will_wake(waker))
        {
            *current = Some(waker.clone());
        }
    }

    fn wake(&self) {
        let waker = self.waker.lock().expect("stream channel waker lock").take();
        if let Some(waker) = waker {
            waker.wake();
        }
    }
    fn clear(&self) {
        let waker = self.waker.lock().expect("stream channel waker lock").take();
        drop(waker);
    }
}

struct BoundedSender<T> {
    sender: Option<SyncSender<T>>,
    wake: Arc<ChannelWake>,
}

impl<T> Clone for BoundedSender<T> {
    fn clone(&self) -> Self {
        Self {
            sender: Some(self.sender.as_ref().expect("live stream sender").clone()),
            wake: self.wake.clone(),
        }
    }
}

impl<T> Drop for BoundedSender<T> {
    fn drop(&mut self) {
        drop(self.sender.take());
        self.wake.wake();
    }
}

impl<T> BoundedSender<T> {
    fn send(&self, value: T) -> Result<(), T> {
        match self
            .sender
            .as_ref()
            .expect("live stream sender")
            .send(value)
        {
            Ok(()) => {
                self.wake.wake();
                Ok(())
            }
            Err(error) => Err(error.0),
        }
    }

    fn try_send(&self, value: T) -> Result<(), TrySendError<T>> {
        let result = self
            .sender
            .as_ref()
            .expect("live stream sender")
            .try_send(value);
        if result.is_ok() {
            self.wake.wake();
        }
        result
    }
}

struct BoundedReceiver<T> {
    receiver: Receiver<T>,
    wake: Arc<ChannelWake>,
}

impl<T> BoundedReceiver<T> {
    fn poll_recv(&self, context: &mut Context<'_>) -> Poll<Option<T>> {
        self.wake.register(context.waker());
        match self.receiver.try_recv() {
            Ok(value) => {
                self.wake.clear();
                Poll::Ready(Some(value))
            }
            Err(TryRecvError::Empty) => Poll::Pending,
            Err(TryRecvError::Disconnected) => {
                self.wake.clear();
                Poll::Ready(None)
            }
        }
    }
}

impl<T> Drop for BoundedReceiver<T> {
    fn drop(&mut self) {
        self.wake.clear();
    }
}

fn bounded_channel<T>(capacity: usize) -> (BoundedSender<T>, BoundedReceiver<T>) {
    let (sender, receiver) = mpsc::sync_channel(capacity);
    let wake = Arc::new(ChannelWake {
        waker: Mutex::new(None),
    });
    (
        BoundedSender {
            sender: Some(sender),
            wake: wake.clone(),
        },
        BoundedReceiver { receiver, wake },
    )
}

enum RefreshMessage {
    Frame(SseFrame),
    End,
}

enum NewsMessage {
    SourceComplete {
        source: String,
        articles: Vec<Value>,
        source_stat: Value,
    },
    SourceError {
        source: String,
        error: String,
    },
    Complete,
}

#[derive(Clone, Debug, PartialEq)]
struct SseFrame {
    id: Option<u64>,
    retry_ms: Option<u32>,
    data: Value,
}

impl SseFrame {
    fn data(data: Value) -> Self {
        Self {
            id: None,
            retry_ms: None,
            data,
        }
    }

    fn connection(timestamp: String) -> Self {
        Self {
            id: Some(0),
            retry_ms: Some(5000),
            data: json!({"type": "connected", "timestamp": timestamp}),
        }
    }

    fn with_id(id: u64, data: Value) -> Self {
        Self {
            id: Some(id),
            retry_ms: None,
            data,
        }
    }

    fn event(&self) -> Event {
        let data = serde_json::to_string(&self.data)
            .expect("serde_json::Value must serialize as SSE data");
        let mut event = Event::default().data(data);
        if let Some(id) = self.id {
            event = event.id(id.to_string());
        }
        if let Some(retry_ms) = self.retry_ms {
            event = event.retry(Duration::from_millis(u64::from(retry_ms)));
        }
        event
    }
}

fn sse_response<S>(stream: S, keepalive_interval: Option<Duration>) -> AxumResponse
where
    S: Stream<Item = Result<Event, Infallible>> + Send + 'static,
{
    match keepalive_interval {
        Some(interval) => Sse::new(stream)
            .keep_alive(KeepAlive::new().interval(interval).text("keepalive"))
            .into_response(),
        None => Sse::new(stream).into_response(),
    }
}

fn error_frame(message: &str, timestamp: String) -> SseFrame {
    SseFrame::data(json!({
        "status": "error",
        "message": message,
        "timestamp": timestamp,
    }))
}

fn status_response(message: impl Into<String>, status: impl Into<String>) -> CacheRefreshResponse {
    CacheRefreshResponse {
        message: message.into(),
        status: status.into(),
    }
}

fn map_query_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![crate::models::ValidationError {
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

fn decode_query_component(raw: &str) -> Result<String, ()> {
    let bytes = raw.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => decoded.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let high = (bytes[index + 1] as char).to_digit(16).ok_or(())?;
                let low = (bytes[index + 2] as char).to_digit(16).ok_or(())?;
                decoded.push(((high << 4) | low) as u8);
                index += 2;
            }
            b'%' => return Err(()),
            byte => decoded.push(byte),
        }
        index += 1;
    }
    String::from_utf8(decoded).map_err(|_| ())
}

fn parse_pydantic_bool(value: &str) -> Option<bool> {
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "on" | "yes" | "y" | "t" => Some(true),
        "false" | "0" | "off" | "no" | "n" | "f" => Some(false),
        _ => None,
    }
}

#[derive(Debug, Deserialize, IntoParams, PartialEq, Eq)]
#[into_params(parameter_in = Query)]
struct NewsStreamParameters {
    #[param(required = false, default = true)]
    #[serde(default = "default_use_cache")]
    use_cache: bool,
    #[param(required = false, nullable = true)]
    #[serde(default)]
    category: Option<String>,
}

fn default_use_cache() -> bool {
    true
}

fn parse_news_stream_query(
    raw_query: Option<&str>,
) -> Result<NewsStreamParameters, HttpValidationError> {
    let mut use_cache = true;
    let mut category = None;
    for pair in raw_query
        .unwrap_or_default()
        .split('&')
        .filter(|part| !part.is_empty())
    {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query_component(raw_key).map_err(|_| {
            map_query_error(
                "query",
                Value::String(raw_key.to_owned()),
                "query_string_parsing",
                "Could not parse query string",
            )
        })?;
        let value = decode_query_component(raw_value).map_err(|_| {
            map_query_error(
                &key,
                Value::String(raw_value.to_owned()),
                "query_string_parsing",
                "Could not parse query string",
            )
        })?;
        match key.as_str() {
            "use_cache" => {
                use_cache = parse_pydantic_bool(&value).ok_or_else(|| {
                    map_query_error(
                        "use_cache",
                        Value::String(value.clone()),
                        "bool_parsing",
                        "Input should be a valid boolean, unable to interpret input",
                    )
                })?;
            }
            "category" => category = Some(value),
            _ => {}
        }
    }
    let category = category
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"));
    Ok(NewsStreamParameters {
        use_cache,
        category,
    })
}

fn refresh_event_stream(
    prefix: Vec<SseFrame>,
    receiver: BoundedReceiver<RefreshMessage>,
    state: CacheStreamState,
) -> impl Stream<Item = Result<Event, Infallible>> + Send {
    let mut prefix = VecDeque::from(prefix);
    let mut ended = false;
    poll_fn(move |context| {
        if let Some(frame) = prefix.pop_front() {
            return Poll::Ready(Some(Ok(frame.event())));
        }
        if ended {
            return Poll::Ready(None);
        }
        match receiver.poll_recv(context) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(RefreshMessage::Frame(frame))) => Poll::Ready(Some(Ok(frame.event()))),
            Poll::Ready(Some(RefreshMessage::End)) => {
                ended = true;
                Poll::Ready(None)
            }
            Poll::Ready(None) => {
                ended = true;
                if state.status().update_in_progress {
                    let message = "Cache refresh provider ended without completion";
                    let error = CacheStreamError::ProviderFailed(message.to_owned());
                    let _ = state.complete_refresh(Err(error));
                    Poll::Ready(Some(Ok(
                        error_frame(message, state.clock.timestamp()).event()
                    )))
                } else {
                    Poll::Ready(None)
                }
            }
        }
    })
}

fn news_progress(completed: usize, total: usize) -> Value {
    let percentage = if total == 0 {
        100.0
    } else {
        ((completed as f64 / total as f64) * 100.0 * 10.0).round() / 10.0
    };
    json!({
        "completed": completed,
        "total": total,
        "percentage": percentage,
    })
}

fn news_initial_frames(
    state: &CacheStreamState,
    parameters: &NewsStreamParameters,
    stream_id: &str,
    active_streams: u32,
) -> (Vec<SseFrame>, bool) {
    let snapshot = state.snapshot();
    let articles = snapshot.filtered_articles(parameters.category.as_deref());
    let article_count = articles.len();
    let mut frames = Vec::new();
    if !articles.is_empty() {
        frames.push(SseFrame::data(json!({
            "status": "initial",
            "stream_id": stream_id,
            "articles": articles,
            "source_stats": snapshot.source_stats.as_slice(),
            "cache_age_seconds": snapshot.cache_age_seconds,
            "message": format!("Loaded {article_count} cached articles instantly"),
            "timestamp": state.clock.timestamp(),
        })));
    }
    frames.push(SseFrame::data(json!({
        "status": "starting",
        "stream_id": stream_id,
        "message": format!("Initializing news stream (use_cache={})...", parameters.use_cache),
        "timestamp": state.clock.timestamp(),
        "active_streams": active_streams,
    })));
    let cache_is_fresh =
        parameters.use_cache && snapshot.is_fresh_for(parameters.category.as_deref());
    if cache_is_fresh {
        frames.push(SseFrame::data(json!({
            "status": "complete",
            "stream_id": stream_id,
            "message": "Used fresh cached data",
            "cache_age_seconds": snapshot.cache_age_seconds,
            "timestamp": state.clock.timestamp(),
        })));
    }
    (frames, cache_is_fresh)
}

struct NewsAggregate {
    completed: usize,
    total_articles: usize,
    source_stats: usize,
    successful_sources: usize,
    failed_sources: usize,
}

impl NewsAggregate {
    fn new() -> Self {
        Self {
            completed: 0,
            total_articles: 0,
            source_stats: 0,
            successful_sources: 0,
            failed_sources: 0,
        }
    }
}

struct NewsStreamGuard {
    state: CacheStreamState,
    cancellation: Option<Arc<dyn NewsStreamCancellation>>,
    finished: bool,
}

impl NewsStreamGuard {
    fn finish(&mut self) {
        if !self.finished {
            self.finished = true;
            self.state.finish_news_stream();
        }
    }

    fn cancel_and_finish(&mut self) {
        if !self.finished {
            if let Some(cancellation) = &self.cancellation {
                cancellation.cancel();
            }
            self.finish();
        }
    }
}

impl Drop for NewsStreamGuard {
    fn drop(&mut self) {
        self.cancel_and_finish();
    }
}

fn news_event_stream(
    prefix: Vec<SseFrame>,
    receiver: Option<BoundedReceiver<NewsMessage>>,
    mut guard: NewsStreamGuard,
    total_sources: usize,
    stream_id: String,
    state: CacheStreamState,
    started_at: Instant,
) -> impl Stream<Item = Result<Event, Infallible>> + Send {
    let mut prefix = VecDeque::from(prefix);
    let mut receiver = receiver;
    let mut aggregate = NewsAggregate::new();
    let mut ended = false;
    poll_fn(move |context| {
        if let Some(frame) = prefix.pop_front() {
            return Poll::Ready(Some(Ok(frame.event())));
        }
        if ended {
            guard.finish();
            return Poll::Ready(None);
        }
        let Some(receiver) = receiver.as_ref() else {
            guard.finish();
            ended = true;
            return Poll::Ready(None);
        };
        match receiver.poll_recv(context) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(NewsMessage::SourceComplete {
                source,
                articles,
                source_stat,
            })) => {
                aggregate.completed += 1;
                aggregate.total_articles += articles.len();
                aggregate.source_stats += 1;
                match source_stat.get("status").and_then(Value::as_str) {
                    Some("success") => aggregate.successful_sources += 1,
                    Some("error") => aggregate.failed_sources += 1,
                    _ => {}
                }
                let frame = SseFrame::data(json!({
                    "status": "source_complete",
                    "stream_id": stream_id,
                    "source": source,
                    "articles": articles.into_iter().take(20).collect::<Vec<_>>(),
                    "source_stat": source_stat,
                    "progress": news_progress(aggregate.completed, total_sources),
                    "timestamp": state.clock.timestamp(),
                }));
                Poll::Ready(Some(Ok(frame.event())))
            }
            Poll::Ready(Some(NewsMessage::SourceError { source, error })) => {
                aggregate.completed += 1;
                let frame = SseFrame::data(json!({
                    "status": "source_error",
                    "stream_id": stream_id,
                    "source": source,
                    "error": error,
                    "progress": news_progress(aggregate.completed, total_sources),
                    "timestamp": state.clock.timestamp(),
                }));
                Poll::Ready(Some(Ok(frame.event())))
            }
            Poll::Ready(Some(NewsMessage::Complete)) => {
                let frame = SseFrame::data(json!({
                    "status": "complete",
                    "stream_id": stream_id,
                    "message": format!(
                        "Successfully loaded {} articles from {} sources",
                        aggregate.total_articles, aggregate.source_stats
                    ),
                    "total_articles": aggregate.total_articles,
                    "successful_sources": aggregate.successful_sources,
                    "failed_sources": aggregate.failed_sources,
                    "progress": news_progress(total_sources, total_sources),
                    "duration_ms": started_at.elapsed().as_secs_f64() * 1000.0,
                    "timestamp": state.clock.timestamp(),
                }));
                guard.finish();
                ended = true;
                Poll::Ready(Some(Ok(frame.event())))
            }
            Poll::Ready(None) => {
                guard.cancel_and_finish();
                ended = true;
                let frame = SseFrame::data(json!({
                    "status": "error",
                    "stream_id": stream_id,
                    "error": "News live stream provider ended without completion",
                    "timestamp": state.clock.timestamp(),
                }));
                Poll::Ready(Some(Ok(frame.event())))
            }
        }
    })
}

#[utoipa::path(
    post,
    path = "/cache/refresh",
    operation_id = "manual_cache_refresh_cache_refresh_post",
    tag = "cache",
    responses((
        status = 200,
        description = "Successful Response",
        body = CacheRefreshStringMapSchema
    ))
)]
pub(crate) async fn manual_cache_refresh(State(state): State<CacheStreamState>) -> AxumResponse {
    let payload = match state.launch_cache_refresh(None) {
        Ok(RefreshAdmission::AlreadyRunning) => {
            status_response("Cache refresh already in progress", "in_progress")
        }
        Ok(RefreshAdmission::Started) => status_response("Cache refresh started", "started"),
        Err(error) => status_response(error.to_string(), "error"),
    };
    Json(payload).into_response()
}

#[utoipa::path(
    post,
    path = "/cache/refresh/stream",
    operation_id = "stream_cache_refresh_cache_refresh_stream_post",
    tag = "cache",
    responses((
        status = 200,
        description = "Successful Response",
        body = CacheStreamEmptyResponseSchema
    ))
)]
pub(crate) async fn stream_cache_refresh(State(state): State<CacheStreamState>) -> AxumResponse {
    let (sender, receiver) = bounded_channel(MAX_REFRESH_EVENTS);
    let start_result = state.launch_cache_refresh(Some(sender));
    let prefix = match start_result {
        Ok(RefreshAdmission::Started) => vec![SseFrame::data(json!({
            "status": "starting",
            "message": "Starting cache refresh...",
        }))],
        Ok(RefreshAdmission::AlreadyRunning) => vec![error_frame(
            "Cache refresh already in progress",
            state.clock.timestamp(),
        )],
        Err(error) => vec![
            SseFrame::data(json!({
                "status": "starting",
                "message": "Starting cache refresh...",
            })),
            error_frame(&error.to_string(), state.clock.timestamp()),
        ],
    };
    sse_response(refresh_event_stream(prefix, receiver, state), None)
}

#[utoipa::path(
    get,
    path = "/cache/status",
    operation_id = "get_cache_status_cache_status_get",
    tag = "cache",
    responses((status = 200, description = "Successful Response", body = CacheStatusResponse))
)]
pub(crate) async fn get_cache_status(
    State(state): State<CacheStreamState>,
) -> Json<CacheStatusResponse> {
    Json(state.status())
}

#[utoipa::path(
    get,
    path = "/news/stream",
    operation_id = "stream_news_news_stream_get",
    tag = "news-stream",
    params(NewsStreamParameters),
    responses(
        (status = 200, description = "Successful Response", body = CacheStreamEmptyResponseSchema),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn stream_news(
    State(state): State<CacheStreamState>,
    RawQuery(raw_query): RawQuery,
) -> AxumResponse {
    let parameters = match parse_news_stream_query(raw_query.as_deref()) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let stream_id = state.stream_id();
    let started_at = Instant::now();
    let active_streams = match state.begin_news_stream() {
        Ok(active_streams) => active_streams,
        Err(active_streams) => {
            let message =
                format!("Too many active streams ({active_streams}). Please try again later.");
            let frame = SseFrame::data(json!({"status": "error", "message": message}));
            let guard = NewsStreamGuard {
                state: state.clone(),
                cancellation: None,
                finished: true,
            };
            let stream =
                news_event_stream(vec![frame], None, guard, 0, stream_id, state, started_at);
            return sse_response(stream, None);
        }
    };

    let (mut prefix, cached_fresh) =
        news_initial_frames(&state, &parameters, &stream_id, active_streams);
    let mut receiver = None;
    let mut total_sources = 0;
    let mut cancellation = None;
    if !cached_fresh {
        if let Some(provider) = &state.news_provider {
            let (sender, news_receiver) = bounded_channel(MAX_NEWS_EVENTS);
            let observer = NewsStreamObserver::new(sender);
            match provider.launch(
                NewsStreamRequest {
                    stream_id: stream_id.clone(),
                    use_cache: parameters.use_cache,
                    category: parameters.category.clone(),
                },
                observer,
            ) {
                Ok(operation) => {
                    total_sources = operation.total_sources;
                    cancellation = operation.cancellation;
                    receiver = Some(news_receiver);
                }
                Err(error) => {
                    drop(news_receiver);
                    let message = error.to_string();
                    prefix.push(SseFrame::data(json!({
                        "status": "error",
                        "stream_id": stream_id,
                        "error": message,
                        "message": message,
                        "timestamp": state.clock.timestamp(),
                    })));
                }
            }
        } else {
            let message = CacheStreamError::LiveStreamUnavailable.to_string();
            prefix.push(SseFrame::data(json!({
                "status": "error",
                "stream_id": stream_id,
                "error": message,
                "message": message,
                "timestamp": state.clock.timestamp(),
            })));
        }
    }
    let guard = NewsStreamGuard {
        state: state.clone(),
        cancellation,
        finished: false,
    };
    let stream = news_event_stream(
        prefix,
        receiver,
        guard,
        total_sources,
        stream_id.clone(),
        state,
        started_at,
    );
    let mut response = sse_response(stream, None);
    response
        .headers_mut()
        .insert(CONNECTION, HeaderValue::from_static("keep-alive"));
    response
        .headers_mut()
        .insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    response.headers_mut().insert(
        "X-Stream-ID",
        HeaderValue::from_str(&stream_id).expect("stream id is a valid HTTP header"),
    );
    response
}

#[utoipa::path(
    get,
    path = "/updates/stream",
    operation_id = "updates_stream_updates_stream_get",
    tag = "updates",
    responses((
        status = 200,
        description = "Successful Response",
        body = CacheStreamEmptyResponseSchema
    ))
)]
pub(crate) async fn updates_stream(State(state): State<CacheStreamState>) -> AxumResponse {
    let mut subscription = state.subscribe_updates();
    let keepalive_interval = state.keepalive_interval;
    let stream = poll_fn(move |context| match subscription.poll_next(context) {
        Poll::Ready(Some(frame)) => Poll::Ready(Some(Ok(frame.event()))),
        Poll::Ready(None) => Poll::Ready(None),
        Poll::Pending => Poll::Pending,
    });
    let mut response = sse_response(stream, Some(keepalive_interval));
    response
        .headers_mut()
        .insert(CONNECTION, HeaderValue::from_static("keep-alive"));
    response
        .headers_mut()
        .insert("X-Accel-Buffering", HeaderValue::from_static("no"));
    response
}

#[utoipa::path(
    get,
    path = "/updates/status",
    operation_id = "get_updates_status_updates_status_get",
    tag = "updates",
    responses((
        status = 200,
        description = "Successful Response",
        body = UpdatesStatusFreeFormSchema
    ))
)]
pub(crate) async fn get_updates_status(
    State(state): State<CacheStreamState>,
) -> Json<UpdatesStatusResponse> {
    Json(state.updates_status())
}

#[cfg(test)]
mod tests {
    use super::{
        parse_news_stream_query, CacheRefreshObserver, CacheRefreshProvider, CacheSnapshot,
        CacheStreamClock, CacheStreamError, CacheStreamState, CacheUpdatePublisher,
        NewsStreamCancellation, NewsStreamObserver, NewsStreamOperation, NewsStreamProvider,
        NewsStreamRequest, RefreshAdmission, RefreshResult,
    };
    use axum::body::{to_bytes, Body, HttpBody};
    use axum::http::{Method, Request, StatusCode};
    use axum::response::Response;
    use axum::Router;
    use serde_json::{json, Value};
    use std::future::poll_fn;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use thesis_db::Database;
    use thesis_runtime::ShutdownPhase;
    use tower::ServiceExt;

    use crate::{router_with_sidecars, RouterSidecars};

    const TEST_TIMESTAMP: &str = "2026-09-25T12:00:00+00:00";

    struct FixedClock;

    impl CacheStreamClock for FixedClock {
        fn timestamp(&self) -> String {
            TEST_TIMESTAMP.to_owned()
        }
    }

    #[derive(Clone, Default)]
    struct CapturedPublisher {
        events: Arc<Mutex<Vec<Value>>>,
    }

    impl CacheUpdatePublisher for CapturedPublisher {
        fn publish_cache_updated(&self, event: &Value) {
            self.events
                .lock()
                .expect("publisher capture lock")
                .push(event.clone());
        }
    }

    #[derive(Clone, Default)]
    struct HeldRefreshProvider {
        observer: Arc<Mutex<Option<CacheRefreshObserver>>>,
    }

    impl HeldRefreshProvider {
        fn observer(&self) -> CacheRefreshObserver {
            self.observer
                .lock()
                .expect("refresh observer lock")
                .as_ref()
                .expect("refresh worker launched")
                .clone()
        }
    }

    impl CacheRefreshProvider for HeldRefreshProvider {
        fn launch(&self, observer: CacheRefreshObserver) -> Result<(), CacheStreamError> {
            *self.observer.lock().expect("refresh observer lock") = Some(observer);
            Ok(())
        }
    }

    struct CountCancellation(Arc<AtomicUsize>);

    impl NewsStreamCancellation for CountCancellation {
        fn cancel(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct HeldNewsProvider {
        observer: Arc<Mutex<Option<NewsStreamObserver>>>,
        cancellation_count: Arc<AtomicUsize>,
        total_sources: usize,
    }

    impl HeldNewsProvider {
        fn new(total_sources: usize) -> Self {
            Self {
                observer: Arc::new(Mutex::new(None)),
                cancellation_count: Arc::new(AtomicUsize::new(0)),
                total_sources,
            }
        }

        fn observer(&self) -> NewsStreamObserver {
            self.observer
                .lock()
                .expect("news observer lock")
                .as_ref()
                .expect("news provider launched")
                .clone()
        }
    }

    impl NewsStreamProvider for HeldNewsProvider {
        fn launch(
            &self,
            _request: NewsStreamRequest,
            observer: NewsStreamObserver,
        ) -> Result<NewsStreamOperation, CacheStreamError> {
            *self.observer.lock().expect("news observer lock") = Some(observer);
            Ok(NewsStreamOperation::new(
                self.total_sources,
                Arc::new(CountCancellation(self.cancellation_count.clone())),
            ))
        }
    }

    fn fixture_snapshot() -> CacheSnapshot {
        CacheSnapshot::new(
            vec![
                json!({"category": "World", "title": "One"}),
                json!({"category": "Science", "title": "Two"}),
                json!({"category": "World", "title": "Three"}),
            ],
            vec![
                json!({"name": "Wire", "status": "success", "article_count": 2}),
                json!({"name": "Slow", "status": "warning", "article_count": 0}),
                json!({"name": "Down", "status": "error", "article_count": 0}),
            ],
            15.0,
            TEST_TIMESTAMP,
        )
    }

    fn test_database() -> Database {
        Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL")
    }

    fn app(state: CacheStreamState) -> Router {
        router_with_sidecars(
            test_database(),
            RouterSidecars::default().with_cache_stream(state),
        )
    }

    async fn request(app: &Router, method: Method, uri: &str) -> Response {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("HTTP request"),
            )
            .await
            .expect("HTTP response")
    }

    async fn next_chunk(body: &mut Body) -> Option<String> {
        let frame = poll_fn(|context| Pin::new(&mut *body).poll_frame(context))
            .await?
            .expect("SSE body frame");
        Some(
            String::from_utf8(frame.into_data().expect("SSE data frame").to_vec())
                .expect("SSE frame UTF-8"),
        )
    }

    async fn next_event(body: &mut Body) -> (String, Value) {
        let chunk = next_chunk(body).await.expect("SSE stream event");
        let payload = chunk
            .lines()
            .find_map(|line| line.strip_prefix("data:"))
            .expect("SSE data line");
        let payload = serde_json::from_str(payload.trim()).expect("SSE JSON event");
        (chunk, payload)
    }

    fn assert_sse_field(chunk: &str, field: &str, value: &str) {
        let compact = format!("{field}:{value}");
        let spaced = format!("{field}: {value}");
        assert!(
            chunk
                .lines()
                .any(|line| line == compact.as_str() || line == spaced.as_str()),
            "missing {field} field in {chunk:?}"
        );
    }

    #[tokio::test]
    async fn dropping_last_bounded_sender_wakes_pending_receiver() {
        let (sender, receiver) = super::bounded_channel::<u8>(1);
        let (pending_sender, pending_receiver) = tokio::sync::oneshot::channel();
        let mut pending_sender = Some(pending_sender);
        let mut receiver_task = tokio::spawn(async move {
            poll_fn(move |context| match receiver.poll_recv(context) {
                std::task::Poll::Pending => {
                    if let Some(pending_sender) = pending_sender.take() {
                        let _ = pending_sender.send(());
                    }
                    std::task::Poll::Pending
                }
                std::task::Poll::Ready(item) => std::task::Poll::Ready(item),
            })
            .await
        });
        tokio::time::timeout(Duration::from_secs(1), pending_receiver)
            .await
            .expect("receiver was polled and registered its waker")
            .expect("pending signal");
        drop(sender);

        let result = tokio::time::timeout(Duration::from_secs(1), &mut receiver_task).await;
        let disconnected = matches!(result, Ok(Ok(None)));
        if !disconnected {
            receiver_task.abort();
        }
        assert!(disconnected, "channel closure must wake its receiver");
    }

    #[test]
    fn cache_status_is_derived_from_one_immutable_snapshot() {
        let state = CacheStreamState::new();
        state.replace_cache(fixture_snapshot());
        assert_eq!(state.status().total_articles, 3);
        assert_eq!(state.status().total_sources, 3);
        assert_eq!(state.status().sources_working, 1);
        assert_eq!(state.status().sources_with_warnings, 1);
        assert_eq!(state.status().sources_with_errors, 1);
        assert_eq!(state.status().category_breakdown["World"], 2);
        assert!(!state.status().update_in_progress);
    }

    #[test]
    fn snapshot_reads_share_the_cached_payload_allocation() {
        let state = CacheStreamState::new();
        state.replace_cache(fixture_snapshot());

        let first = state.snapshot();
        let second = state.snapshot();

        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn unavailable_provider_never_admits_a_refresh() {
        let state = CacheStreamState::new();
        assert_eq!(
            state.begin_refresh(false),
            Err(CacheStreamError::ProviderUnavailable)
        );
        assert!(!state.status().update_in_progress);
    }

    #[test]
    fn failed_refresh_retains_old_cache_and_clears_worker_slot() {
        let state = CacheStreamState::new();
        state.replace_cache(fixture_snapshot());
        assert_eq!(state.begin_refresh(true), Ok(RefreshAdmission::Started));
        let before = state.snapshot();
        let result = state.complete_refresh(Err(CacheStreamError::ProviderFailed(
            "upstream failed".to_owned(),
        )));
        assert_eq!(
            result,
            Err(CacheStreamError::ProviderFailed(
                "upstream failed".to_owned()
            ))
        );
        assert_eq!(state.snapshot(), before);
        assert!(!state.status().update_in_progress);
    }

    #[test]
    fn completion_without_admission_is_rejected() {
        let state = CacheStreamState::new();
        assert_eq!(
            state.complete_refresh(Err(CacheStreamError::ProviderFailed(
                "late provider response".to_owned()
            ))),
            Err(CacheStreamError::NoRefreshInFlight)
        );
    }

    #[test]
    fn shutdown_cancels_pending_work_and_closes_admission() {
        let state = CacheStreamState::new();
        assert_eq!(state.begin_drain(), Ok(ShutdownPhase::Draining));
        assert_eq!(state.cancel_pending(), Ok(ShutdownPhase::Cancelling));
        assert_eq!(state.stop(), Ok(ShutdownPhase::Stopped));
        assert_eq!(
            state.begin_refresh(true),
            Err(CacheStreamError::Shutdown(ShutdownPhase::Stopped))
        );
    }

    #[test]
    fn query_parser_matches_fastapi_defaults_and_category_normalization() {
        assert_eq!(
            parse_news_stream_query(Some("use_cache=0&category=%20all%20")).expect("query"),
            super::NewsStreamParameters {
                use_cache: false,
                category: None,
            }
        );
        assert_eq!(
            parse_news_stream_query(Some("category=World%20")).expect("trimmed category"),
            super::NewsStreamParameters {
                use_cache: true,
                category: Some("World".to_owned()),
            }
        );
        assert_eq!(
            parse_news_stream_query(None).expect("defaults"),
            super::NewsStreamParameters {
                use_cache: true,
                category: None,
            }
        );
    }

    #[tokio::test]
    async fn cache_refresh_stream_is_incremental_ordered_and_broadcasts_completion() {
        let provider = Arc::new(HeldRefreshProvider::default());
        let publisher = CapturedPublisher::default();
        let state = CacheStreamState::new()
            .with_refresh_provider(provider.clone())
            .with_update_publisher(Arc::new(publisher.clone()))
            .with_clock(Arc::new(FixedClock));
        let app = app(state.clone());

        let update_response = request(&app, Method::GET, "/updates/stream").await;
        let mut update_body = update_response.into_body();
        let connection = next_chunk(&mut update_body)
            .await
            .expect("updates connection event");
        assert_sse_field(&connection, "id", "0");
        assert_sse_field(&connection, "retry", "5000");

        let refresh_response = request(&app, Method::POST, "/cache/refresh/stream").await;
        assert_eq!(refresh_response.status(), StatusCode::OK);
        assert!(refresh_response.headers()["content-type"]
            .to_str()
            .expect("SSE content type")
            .starts_with("text/event-stream"));
        let mut refresh_body = refresh_response.into_body();
        let (first_chunk, starting) = next_event(&mut refresh_body).await;
        assert!(first_chunk.starts_with("data:"));
        assert_eq!(starting["status"], "starting");
        assert!(state.status().update_in_progress);

        let observer = provider.observer();
        observer.source_complete(
            Some("Wire".to_owned()),
            2,
            json!({"name": "Wire", "status": "success", "article_count": 2}),
        );
        let (source_chunk, source_event) = next_event(&mut refresh_body).await;
        assert!(source_chunk.starts_with("data:"));
        assert_eq!(source_event["status"], "source_complete");
        assert_eq!(source_event["source"], "Wire");
        assert_eq!(source_event["total_sources_processed"], 1);

        observer
            .finish(Ok(RefreshResult {
                snapshot: fixture_snapshot(),
            }))
            .expect("refresh completion");
        let (_, complete) = next_event(&mut refresh_body).await;
        assert_eq!(complete["status"], "complete");
        assert_eq!(complete["total_articles"], 3);
        assert_eq!(complete["timestamp"], TEST_TIMESTAMP);
        assert!(next_chunk(&mut refresh_body).await.is_none());
        assert!(!state.status().update_in_progress);
        assert_eq!(state.snapshot().cache_age_seconds, 0.0);

        let (invalidation_chunk, invalidation) = next_event(&mut update_body).await;
        assert_sse_field(&invalidation_chunk, "id", "1");
        assert_eq!(invalidation["type"], "invalidate");
        assert_eq!(invalidation["reason"], "cache_refresh_complete");
        assert_eq!(invalidation["total_articles"], 3);
        assert_eq!(invalidation["sources_processed"], 3);
        assert_eq!(invalidation["timestamp"], TEST_TIMESTAMP);
        drop(update_body);

        let events = publisher.events.lock().expect("publisher capture lock");
        assert_eq!(
            events.as_slice(),
            &[json!({
                "type": "cache_updated",
                "message": "News cache has been updated",
                "timestamp": TEST_TIMESTAMP,
                "stats": {
                    "total_articles": 3,
                    "sources_processed": 3,
                },
            })]
        );
    }

    #[tokio::test]
    async fn refresh_failure_is_streamed_and_retains_the_last_cache() {
        let provider = Arc::new(HeldRefreshProvider::default());
        let state = CacheStreamState::new()
            .with_refresh_provider(provider.clone())
            .with_clock(Arc::new(FixedClock));
        state.replace_cache(fixture_snapshot());
        let previous_cache = state.snapshot();
        let app = app(state.clone());
        let response = request(&app, Method::POST, "/cache/refresh/stream").await;
        let mut body = response.into_body();
        assert_eq!(next_event(&mut body).await.1["status"], "starting");

        provider
            .observer()
            .finish(Err(CacheStreamError::ProviderFailed(
                "upstream failed".to_owned(),
            )))
            .expect("refresh error reported");
        let (_, error) = next_event(&mut body).await;
        assert_eq!(error["status"], "error");
        assert_eq!(
            error["message"],
            "Error during cache refresh: upstream failed"
        );
        assert!(next_chunk(&mut body).await.is_none());
        assert_eq!(state.snapshot(), previous_cache);
        assert!(!state.status().update_in_progress);
    }

    #[tokio::test]
    async fn manual_refresh_returns_after_provider_launch() {
        let provider = Arc::new(HeldRefreshProvider::default());
        let state = CacheStreamState::new()
            .with_refresh_provider(provider.clone())
            .with_clock(Arc::new(FixedClock));
        let app = app(state.clone());
        let response = request(&app, Method::POST, "/cache/refresh").await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("manual refresh response");
        let payload: Value = serde_json::from_slice(&body).expect("refresh JSON response");
        assert_eq!(payload["status"], "started");
        assert_eq!(payload["message"], "Cache refresh started");
        assert!(state.status().update_in_progress);

        provider
            .observer()
            .finish(Err(CacheStreamError::ProviderFailed(
                "upstream failed".to_owned(),
            )))
            .expect("manual refresh worker can finish");
        assert!(!state.status().update_in_progress);
    }
    #[tokio::test]
    async fn cache_refresh_continues_after_its_sse_client_disconnects() {
        let provider = Arc::new(HeldRefreshProvider::default());
        let publisher = CapturedPublisher::default();
        let state = CacheStreamState::new()
            .with_refresh_provider(provider.clone())
            .with_update_publisher(Arc::new(publisher.clone()))
            .with_clock(Arc::new(FixedClock));
        let app = app(state.clone());
        let response = request(&app, Method::POST, "/cache/refresh/stream").await;
        let mut body = response.into_body();
        let (_, starting) = next_event(&mut body).await;
        assert_eq!(starting["status"], "starting");
        let observer = provider.observer();

        drop(body);
        observer.source_complete(
            Some("Wire".to_owned()),
            2,
            json!({"name": "Wire", "status": "success", "article_count": 2}),
        );
        observer
            .finish(Ok(RefreshResult {
                snapshot: fixture_snapshot(),
            }))
            .expect("detached refresh completion");

        assert_eq!(state.snapshot().articles.len(), 3);
        assert!(!state.status().update_in_progress);
        assert_eq!(
            publisher
                .events
                .lock()
                .expect("publisher capture lock")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn news_stream_emits_cached_then_live_source_frames_in_order() {
        let provider = Arc::new(HeldNewsProvider::new(2));
        let state = CacheStreamState::new()
            .with_news_provider(provider.clone())
            .with_clock(Arc::new(FixedClock));
        state.replace_cache(fixture_snapshot());
        let app = app(state);
        let response = request(
            &app,
            Method::GET,
            "/news/stream?use_cache=false&category=all",
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-stream-id"));
        let mut body = response.into_body();

        let (initial_chunk, initial) = next_event(&mut body).await;
        assert!(initial_chunk.starts_with("data:"));
        assert_eq!(initial["status"], "initial");
        let (starting_chunk, starting) = next_event(&mut body).await;
        assert!(starting_chunk.starts_with("data:"));
        assert_eq!(starting["status"], "starting");
        assert_eq!(starting["active_streams"], 1);

        let observer = provider.observer();
        observer
            .source_complete(
                "Wire".to_owned(),
                vec![json!({"title": "Fresh headline"})],
                json!({"name": "Wire", "status": "success", "article_count": 1}),
            )
            .expect("source event accepted");
        let (source_chunk, source) = next_event(&mut body).await;
        assert!(source_chunk.starts_with("data:"));
        assert_eq!(source["status"], "source_complete");
        assert_eq!(source["source"], "Wire");
        assert_eq!(source["articles"][0]["title"], "Fresh headline");
        assert_eq!(source["progress"]["completed"], 1);
        assert_eq!(source["progress"]["total"], 2);
        assert_eq!(source["progress"]["percentage"], 50.0);

        observer
            .source_error("Down".to_owned(), "feed failed".to_owned())
            .expect("source error accepted");
        let (error_chunk, source_error) = next_event(&mut body).await;
        assert!(error_chunk.starts_with("data:"));
        assert_eq!(source_error["status"], "source_error");
        assert_eq!(source_error["source"], "Down");
        assert_eq!(source_error["error"], "feed failed");
        assert_eq!(source_error["progress"]["completed"], 2);
        assert_eq!(source_error["progress"]["percentage"], 100.0);

        observer.complete().expect("news completion accepted");
        let (_, complete) = next_event(&mut body).await;
        assert_eq!(complete["status"], "complete");
        assert_eq!(complete["total_articles"], 1);
        assert_eq!(complete["successful_sources"], 1);
        assert!(next_chunk(&mut body).await.is_none());
    }

    #[tokio::test]
    async fn fresh_news_cache_completes_without_launching_live_sources() {
        let provider = Arc::new(HeldNewsProvider::new(1));
        let state = CacheStreamState::new()
            .with_news_provider(provider.clone())
            .with_clock(Arc::new(FixedClock));
        state.replace_cache(fixture_snapshot());
        let app = app(state);
        let response = request(&app, Method::GET, "/news/stream").await;
        let mut body = response.into_body();

        let (initial_chunk, initial) = next_event(&mut body).await;
        let (starting_chunk, starting) = next_event(&mut body).await;
        let (complete_chunk, complete) = next_event(&mut body).await;
        assert!(initial_chunk.starts_with("data:"));
        assert!(starting_chunk.starts_with("data:"));
        assert!(complete_chunk.starts_with("data:"));
        assert_eq!(initial["status"], "initial");
        assert_eq!(starting["status"], "starting");
        assert_eq!(complete["status"], "complete");
        assert_eq!(complete["cache_age_seconds"], 15.0);
        assert!(next_chunk(&mut body).await.is_none());
        assert!(provider
            .observer
            .lock()
            .expect("news observer lock")
            .is_none());
    }

    #[tokio::test]
    async fn news_disconnect_cancels_pending_sources_and_releases_stream_capacity() {
        let provider = Arc::new(HeldNewsProvider::new(1));
        let state = CacheStreamState::new()
            .with_news_provider(provider.clone())
            .with_clock(Arc::new(FixedClock));
        state.replace_cache(fixture_snapshot());
        let app = app(state);

        let response = request(&app, Method::GET, "/news/stream?use_cache=false").await;
        let mut body = response.into_body();
        assert_eq!(next_event(&mut body).await.1["status"], "initial");
        assert_eq!(next_event(&mut body).await.1["status"], "starting");
        drop(body);
        assert_eq!(provider.cancellation_count.load(Ordering::SeqCst), 1);

        let next_response = request(&app, Method::GET, "/news/stream?use_cache=false").await;
        let mut next_body = next_response.into_body();
        assert_eq!(next_event(&mut next_body).await.1["status"], "initial");
        let (_, next_starting) = next_event(&mut next_body).await;
        assert_eq!(next_starting["active_streams"], 1);
        drop(next_body);
        assert_eq!(provider.cancellation_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn news_stream_rejects_requests_above_active_stream_limit() {
        let provider = Arc::new(HeldNewsProvider::new(1));
        let state = CacheStreamState::new().with_news_provider(provider.clone());
        let app = app(state);
        let mut active_bodies = Vec::new();
        for _ in 0..super::MAX_ACTIVE_NEWS_STREAMS {
            let response = request(&app, Method::GET, "/news/stream?use_cache=false").await;
            assert_eq!(response.status(), StatusCode::OK);
            active_bodies.push(response.into_body());
        }

        let rejected = request(&app, Method::GET, "/news/stream?use_cache=false").await;
        assert_eq!(rejected.status(), StatusCode::OK);
        assert!(!rejected.headers().contains_key("x-stream-id"));
        let mut rejected_body = rejected.into_body();
        let (_, event) = next_event(&mut rejected_body).await;
        assert_eq!(event["status"], "error");
        assert_eq!(
            event["message"],
            "Too many active streams (5). Please try again later."
        );
        assert!(next_chunk(&mut rejected_body).await.is_none());

        drop(active_bodies);
        assert_eq!(
            provider.cancellation_count.load(Ordering::SeqCst),
            super::MAX_ACTIVE_NEWS_STREAMS as usize
        );
    }

    #[tokio::test]
    async fn updates_stream_has_ids_retry_keepalive_no_replay_and_disconnect_cleanup() {
        let state = CacheStreamState::new()
            .with_clock(Arc::new(FixedClock))
            .with_keepalive_interval(Duration::from_millis(100));
        assert_eq!(
            state.publish_update("invalidate", Some(json!({"reason": "before"}))),
            Ok(1)
        );
        let app = app(state.clone());
        let response = request(&app, Method::GET, "/updates/stream").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-accel-buffering"], "no");
        let mut body = response.into_body();

        let (connection_chunk, connected) = next_event(&mut body).await;
        assert_sse_field(&connection_chunk, "id", "0");
        assert_sse_field(&connection_chunk, "retry", "5000");
        assert_eq!(connected["type"], "connected");
        assert_eq!(connected["timestamp"], TEST_TIMESTAMP);
        assert_eq!(state.updates_status().active_subscribers, 1);

        assert_eq!(
            state.publish_update("invalidate", Some(json!({"reason": "after"}))),
            Ok(2)
        );
        let (update_chunk, update) = next_event(&mut body).await;
        assert_sse_field(&update_chunk, "id", "2");
        assert_eq!(update["id"], 2);
        assert_eq!(update["type"], "invalidate");
        assert_eq!(update["reason"], "after");
        assert_eq!(update["timestamp"], TEST_TIMESTAMP);

        let keepalive = tokio::time::timeout(Duration::from_secs(1), next_chunk(&mut body))
            .await
            .expect("keepalive arrives while stream stays open")
            .expect("updates stream remains open");
        assert!(keepalive.contains("keepalive"));
        drop(body);
        assert_eq!(state.updates_status().active_subscribers, 0);
        assert_eq!(state.updates_status().total_events_sent, 2);
    }

    #[tokio::test]
    async fn full_update_subscriber_is_evicted_at_the_bounded_queue_limit() {
        let state = CacheStreamState::new().with_clock(Arc::new(FixedClock));
        let app = app(state.clone());
        let response = request(&app, Method::GET, "/updates/stream").await;
        let body = response.into_body();
        assert_eq!(state.updates_status().active_subscribers, 1);

        for sequence in 1..=super::MAX_PENDING_INVALIDATIONS + 1 {
            assert_eq!(
                state.publish_update("invalidate", Some(json!({"sequence": sequence}))),
                Ok(sequence as u64)
            );
        }
        assert_eq!(state.updates_status().active_subscribers, 0);
        assert_eq!(
            state.updates_status().total_events_sent,
            (super::MAX_PENDING_INVALIDATIONS + 1) as i64
        );
        drop(body);
    }

    #[tokio::test]
    async fn missing_providers_are_in_band_but_invalid_query_is_http_422() {
        let app = app(CacheStreamState::new().with_clock(Arc::new(FixedClock)));

        let refresh = request(&app, Method::POST, "/cache/refresh/stream").await;
        assert_eq!(refresh.status(), StatusCode::OK);
        let mut refresh_body = refresh.into_body();
        assert_eq!(next_event(&mut refresh_body).await.1["status"], "starting");
        let (_, refresh_error) = next_event(&mut refresh_body).await;
        assert_eq!(refresh_error["status"], "error");
        assert_eq!(
            refresh_error["message"],
            "Cache refresh provider is not available"
        );
        assert!(next_chunk(&mut refresh_body).await.is_none());

        let news = request(&app, Method::GET, "/news/stream?use_cache=false").await;
        assert_eq!(news.status(), StatusCode::OK);
        let mut news_body = news.into_body();
        assert_eq!(next_event(&mut news_body).await.1["status"], "starting");
        let (_, news_error) = next_event(&mut news_body).await;
        assert_eq!(news_error["status"], "error");
        assert_eq!(
            news_error["error"],
            "News live stream provider is not available"
        );
        assert!(next_chunk(&mut news_body).await.is_none());

        let invalid_query = request(&app, Method::GET, "/news/stream?use_cache=invalid").await;
        assert_eq!(invalid_query.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}
