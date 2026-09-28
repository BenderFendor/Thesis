//! Deterministic B10 job lifecycle and image transport boundaries.
//!
//! This module owns the public protocol, production Reqwest image adapters, and
//! the canonical OpenGraph parser boundary. Refresh work remains an injected
//! worker; missing providers are explicit errors, never fabricated results.

use std::collections::{BTreeMap, VecDeque};
use std::convert::Infallible;
use std::future::{poll_fn, Future};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::future::{select, Either};
use futures_util::stream;
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::{StatusCode as HttpStatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thesis_ingest::html_extract::extract_og_image_from_html;
use thesis_runtime::{
    CancellationReason, EventCursor, FencedJobCommand, JobCommand, JobEvent, JobId, JobPhase,
    JobRecord, SequencedEvent,
};
use tokio::time::sleep;
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const CACHE_MAX_AGE_SECONDS: u64 = 86_400;
const CACHE_STALE_WHILE_REVALIDATE_SECONDS: u64 = 3_600;
const DEFAULT_CACHE_DIR: &str = "/tmp/thesis_image_cache";
const MAX_REDIRECTS: u8 = 3;
const MAX_URL_LENGTH: usize = 2_048;
const IMAGE_FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const OG_FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_OG_RESPONSE_SIZE: usize = 100_000;
const MAX_JOB_EVENTS: usize = 256;
const MAX_JOB_STREAMS: usize = 64;
const JOB_STREAM_KEEPALIVE: Duration = Duration::from_secs(30);
const IMAGE_TRANSPORT_UNAVAILABLE_DETAIL: &str = "Image transport is not available";
const IMAGE_CACHE_UNAVAILABLE_DETAIL: &str = "Image cache is not available";
const OG_PROVIDER_UNAVAILABLE_DETAIL: &str = "OpenGraph image provider is not available";
const REFRESH_WORKER_UNAVAILABLE_DETAIL: &str = "Refresh job worker is not available";

/// Preserve the FastAPI image proxy limit at the Rust boundary.
pub(crate) const MAX_IMAGE_SIZE: usize = 10 * 1024 * 1024;

const SCOOP_BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (compatible; ScoopNewsBot/1.0; +https://github.com/anomalyco/Thesis)";

const ALLOWED_CONTENT_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
];
pub use thesis_runtime::{Generation, JobCommandError};

/// Provider futures keep networking, database, and background work outside the
/// API crate while giving handlers an awaitable contract.
pub type ImageTransportFuture =
    Pin<Box<dyn Future<Output = Result<ImagePayload, ImageTransportError>> + Send>>;
pub type OgImageFuture =
    Pin<Box<dyn Future<Output = Result<Option<OgImagePayload>, ImageTransportError>> + Send>>;
pub type ImageCacheFuture<T> = Pin<Box<dyn Future<Output = Result<T, ImageCacheError>> + Send>>;

/// A cache entry returned by the shared image-cache provider.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageCacheEntry {
    pub bytes: Bytes,
    pub content_type: String,
    pub stored_at: DateTime<Utc>,
}

/// Shared-cache counters matching `/image/cache/stats`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageCacheStats {
    pub total_files: i64,
    pub total_size_bytes: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageCacheError(pub String);

/// Shared persistence boundary for all image proxy handlers and API instances.
pub trait ImageCache: Send + Sync {
    fn get(&self, url: String) -> ImageCacheFuture<Option<ImageCacheEntry>>;
    fn put(&self, url: String, entry: ImageCacheEntry) -> ImageCacheFuture<()>;
    fn stats(&self) -> ImageCacheFuture<ImageCacheStats>;
    fn clear(&self) -> ImageCacheFuture<u64>;
}

/// Database-backed adapter used by the production router composition.
#[derive(Clone)]
pub struct DatabaseImageCache {
    database: thesis_db::Database,
}

impl DatabaseImageCache {
    pub fn new(database: thesis_db::Database) -> Self {
        Self { database }
    }
}

impl ImageCache for DatabaseImageCache {
    fn get(&self, url: String) -> ImageCacheFuture<Option<ImageCacheEntry>> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .get_cached_image(&url)
                .await
                .map(|record| {
                    record.map(|record| ImageCacheEntry {
                        bytes: Bytes::from(record.bytes),
                        content_type: record.content_type,
                        stored_at: record.stored_at,
                    })
                })
                .map_err(|error| ImageCacheError(error.to_string()))
        })
    }

    fn put(&self, url: String, entry: ImageCacheEntry) -> ImageCacheFuture<()> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .put_cached_image(&url, &entry.bytes, &entry.content_type, entry.stored_at)
                .await
                .map_err(|error| ImageCacheError(error.to_string()))
        })
    }

    fn stats(&self) -> ImageCacheFuture<ImageCacheStats> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .image_cache_stats()
                .await
                .map(|stats| ImageCacheStats {
                    total_files: stats.total_files,
                    total_size_bytes: stats.total_size_bytes,
                })
                .map_err(|error| ImageCacheError(error.to_string()))
        })
    }

    fn clear(&self) -> ImageCacheFuture<u64> {
        let database = self.database.clone();
        Box::pin(async move {
            database
                .clear_image_cache()
                .await
                .map_err(|error| ImageCacheError(error.to_string()))
        })
    }
}

/// A detached refresh worker admitted by the lifecycle reducer.
///
/// Implementations own task creation and provider/database work. The router
/// passes a clone of the shared state so workers can publish progress and
/// terminal updates using the supplied generation.
/// Why a refresh worker could not start a job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefreshWorkerError {
    /// No worker is configured or it cannot accept jobs.
    Unavailable,
    /// The worker rejected the job with a detail message.
    Failed(String),
}

pub trait RefreshJobWorker: Send + Sync {
    fn launch(
        &self,
        job_id: String,
        generation: Generation,
        state: JobsImageState,
    ) -> Result<(), RefreshWorkerError>;
}

/// External image transport sidecar.
///
/// It must honor timeout, redirect, and byte limits and return every resolved
/// address from the original request and each redirect hop. It must reject
/// unsafe addresses before connecting, not only after returning this trace.
pub trait ImageTransport: Send + Sync {
    fn fetch(&self, request: ImageFetchRequest) -> ImageTransportFuture;
}

/// OpenGraph extraction sidecar. The provider returns traces for the article
/// fetch and for resolving the exposed image URL; both are checked before use.
pub trait OgImageProvider: Send + Sync {
    fn fetch(&self, request: OgImageFetchRequest) -> OgImageFuture;
}

/// Production HTTP transport. Each hop is resolved and pinned to its vetted
/// addresses before the request is sent, preventing DNS rebinding across redirects.
#[derive(Clone, Copy, Debug, Default)]
pub struct ReqwestImageTransport;

impl ImageTransport for ReqwestImageTransport {
    fn fetch(&self, request: ImageFetchRequest) -> ImageTransportFuture {
        Box::pin(async move {
            let fetched = fetch_http(
                &request.url,
                request.timeout,
                request.max_redirects,
                request.max_bytes,
                request.user_agent,
                false,
            )
            .await?;
            if !fetched.status.is_success() {
                return Err(ImageTransportError::HttpStatus(fetched.status.as_u16()));
            }
            Ok(ImagePayload {
                bytes: fetched.bytes,
                content_type: fetched.content_type,
                final_url: fetched.final_url,
                redirect_count: fetched.redirect_count,
                resolved_addresses: fetched.resolved_addresses,
            })
        })
    }
}

/// Production OpenGraph provider using the canonical `thesis-ingest` HTML parser.
#[derive(Clone, Copy, Debug, Default)]
pub struct ReqwestOgImageProvider;

impl OgImageProvider for ReqwestOgImageProvider {
    fn fetch(&self, request: OgImageFetchRequest) -> OgImageFuture {
        Box::pin(async move {
            let original_url = parse_safe_url(&request.article_url)?;
            let fetched = match fetch_http(
                &request.article_url,
                request.timeout,
                request.max_redirects,
                request.max_bytes,
                request.user_agent,
                true,
            )
            .await
            {
                Ok(fetched) => fetched,
                Err(error @ ImageTransportError::UnsafeUrl(_)) => return Err(error),
                Err(_) => return Ok(None),
            };
            if fetched.status != HttpStatusCode::OK
                || !fetched
                    .content_type
                    .split(';')
                    .next()
                    .is_some_and(|media_type| media_type.trim().eq_ignore_ascii_case("text/html"))
            {
                return Ok(None);
            }

            let html = String::from_utf8_lossy(&fetched.bytes);
            let extraction = extract_og_image_from_html(&html);
            for candidate in extraction.candidates {
                let Some(image_url) = normalize_og_candidate(&original_url, &candidate.url) else {
                    continue;
                };
                let Ok((_, addresses)) =
                    resolve_public_addresses(&image_url, request.timeout).await
                else {
                    continue;
                };
                let image_url = image_url.as_str().to_owned();
                return Ok(Some(OgImagePayload {
                    image_url: image_url.clone(),
                    article_trace: FetchTrace {
                        final_url: fetched.final_url,
                        redirect_count: fetched.redirect_count,
                        resolved_addresses: fetched.resolved_addresses,
                    },
                    image_trace: FetchTrace {
                        final_url: image_url,
                        redirect_count: 0,
                        resolved_addresses: addresses,
                    },
                }));
            }
            Ok(None)
        })
    }
}

struct FetchedHttpResponse {
    bytes: Bytes,
    content_type: String,
    final_url: String,
    redirect_count: u8,
    resolved_addresses: Vec<IpAddr>,
    status: HttpStatusCode,
}

async fn fetch_http(
    initial_url: &str,
    timeout: Duration,
    max_redirects: u8,
    max_bytes: usize,
    user_agent: &'static str,
    truncate_at_limit: bool,
) -> Result<FetchedHttpResponse, ImageTransportError> {
    let mut current_url = parse_safe_url(initial_url)?;
    let mut redirect_count = 0_u8;
    let mut all_addresses = Vec::new();

    loop {
        let (socket_addresses, ip_addresses) =
            resolve_public_addresses(&current_url, timeout).await?;
        all_addresses.extend(ip_addresses);

        let host = current_url
            .host_str()
            .ok_or_else(|| ImageTransportError::UnsafeUrl("URL host is missing".to_owned()))?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .user_agent(user_agent)
            .resolve_to_addrs(host, &socket_addresses)
            .build()
            .map_err(map_reqwest_error)?;
        let mut response = client
            .get(current_url.clone())
            .send()
            .await
            .map_err(map_reqwest_error)?;

        if response.status().is_redirection() {
            if let Some(location) = response.headers().get(LOCATION) {
                let location = location.to_str().map_err(|error| {
                    ImageTransportError::Failed(format!("Invalid redirect location: {error}"))
                })?;
                if redirect_count >= max_redirects {
                    return Err(ImageTransportError::Failed(format!(
                        "Exceeded maximum of {max_redirects} redirects"
                    )));
                }
                let redirected = current_url.join(location).map_err(|error| {
                    ImageTransportError::UnsafeUrl(format!("IMAGE_UNSAFE_REDIRECT: {error}"))
                })?;
                validate_http_url(redirected.as_str())
                    .map_err(|detail| ImageTransportError::UnsafeUrl(detail.to_owned()))?;
                current_url = redirected;
                redirect_count += 1;
                continue;
            }
        }

        let status = response.status();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let is_html_response = content_type.to_ascii_lowercase().contains("text/html");
        if !status.is_success()
            || (truncate_at_limit && (status != HttpStatusCode::OK || !is_html_response))
        {
            return Ok(FetchedHttpResponse {
                bytes: Bytes::new(),
                content_type,
                final_url: current_url.to_string(),
                redirect_count,
                resolved_addresses: all_addresses,
                status,
            });
        }
        if !truncate_at_limit {
            let media_type = content_type.split(';').next().unwrap_or_default().trim();
            if !ALLOWED_CONTENT_TYPES
                .iter()
                .any(|allowed| media_type.eq_ignore_ascii_case(allowed))
            {
                return Err(ImageTransportError::UnsupportedContentType(
                    media_type.to_owned(),
                ));
            }
        }
        let capacity = response
            .content_length()
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or_default()
            .min(max_bytes);
        let mut bytes = Vec::with_capacity(capacity);
        while let Some(chunk) = response.chunk().await.map_err(map_reqwest_error)? {
            let size = bytes.len().saturating_add(chunk.len());
            if size > max_bytes {
                if truncate_at_limit {
                    let remaining = max_bytes.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&chunk[..remaining]);
                    break;
                }
                return Err(ImageTransportError::TooLarge(size));
            }
            bytes.extend_from_slice(&chunk);
        }

        return Ok(FetchedHttpResponse {
            bytes: Bytes::from(bytes),
            content_type,
            final_url: current_url.to_string(),
            redirect_count,
            resolved_addresses: all_addresses,
            status,
        });
    }
}

async fn resolve_public_addresses(
    url: &Url,
    timeout: Duration,
) -> Result<(Vec<SocketAddr>, Vec<IpAddr>), ImageTransportError> {
    let host = url
        .host_str()
        .ok_or_else(|| ImageTransportError::UnsafeUrl("URL host is missing".to_owned()))?;
    if host.parse::<IpAddr>().is_ok() {
        return Err(ImageTransportError::UnsafeUrl(
            "IP-literal URL hosts are not accepted".to_owned(),
        ));
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| ImageTransportError::UnsafeUrl("URL port is missing".to_owned()))?;
    let resolved = tokio::time::timeout(timeout, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| ImageTransportError::Timeout)?
        .map_err(map_io_error)?;
    let socket_addresses: Vec<_> = resolved.collect();
    let ip_addresses: Vec<_> = socket_addresses.iter().map(SocketAddr::ip).collect();
    validate_resolved_addresses(&ip_addresses)
        .map_err(|detail| ImageTransportError::UnsafeUrl(detail.to_owned()))?;
    Ok((socket_addresses, ip_addresses))
}

fn parse_safe_url(value: &str) -> Result<Url, ImageTransportError> {
    validate_http_url(value).map_err(|detail| ImageTransportError::UnsafeUrl(detail.to_owned()))?;
    Url::parse(value).map_err(|error| ImageTransportError::UnsafeUrl(error.to_string()))
}

fn normalize_og_candidate(article_url: &Url, candidate: &str) -> Option<Url> {
    let candidate = candidate.trim();
    let candidate = if candidate.starts_with("//") {
        format!("https:{candidate}")
    } else {
        candidate.to_owned()
    };
    let image_url = article_url.join(&candidate).ok()?;
    validate_http_url(image_url.as_str()).ok()?;
    let normalized = image_url.as_str().to_ascii_lowercase();
    if normalized.ends_with(".svg") || normalized.contains("placeholder") {
        return None;
    }
    Some(image_url)
}

fn map_reqwest_error(error: reqwest::Error) -> ImageTransportError {
    if error.is_timeout() {
        ImageTransportError::Timeout
    } else {
        ImageTransportError::Failed(error.to_string())
    }
}

fn map_io_error(error: std::io::Error) -> ImageTransportError {
    ImageTransportError::Failed(error.to_string())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ImageTransportError {
    Unavailable,
    Timeout,
    HttpStatus(u16),
    UnsafeUrl(String),
    UnsupportedContentType(String),
    TooLarge(usize),
    Failed(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageFetchRequest {
    pub url: String,
    pub timeout: Duration,
    pub max_redirects: u8,
    pub max_bytes: usize,
    pub user_agent: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OgImageFetchRequest {
    pub article_url: String,
    pub timeout: Duration,
    pub max_redirects: u8,
    pub max_bytes: usize,
    pub user_agent: &'static str,
}

/// The payload returned by an image transport adapter.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImagePayload {
    pub bytes: Bytes,
    pub content_type: String,
    pub final_url: String,
    pub redirect_count: u8,
    /// Addresses observed for the original host and every redirect hop.
    pub resolved_addresses: Vec<IpAddr>,
}

/// A checked trace for one HTTP(S) fetch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FetchTrace {
    pub final_url: String,
    pub redirect_count: u8,
    pub resolved_addresses: Vec<IpAddr>,
}

/// A provider result for `/image/og`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OgImagePayload {
    pub image_url: String,
    pub article_trace: FetchTrace,
    pub image_trace: FetchTrace,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobMutationError {
    NotFound,
    StaleGeneration {
        expected: Generation,
        received: Generation,
    },
    Runtime(JobCommandError),
    EventSequenceExhausted,
    InvalidProgress(String),
}

/// Monotonic progress published by an installed refresh worker.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, ToSchema)]
pub struct JobProgress {
    pub sources_completed: u64,
    pub total_sources: u64,
    pub articles_fetched: u64,
}

impl JobProgress {
    pub fn validate_against(&self, previous: &Self) -> Result<(), JobMutationError> {
        if self.sources_completed < previous.sources_completed
            || self.total_sources < previous.total_sources
            || self.articles_fetched < previous.articles_fetched
        {
            return Err(JobMutationError::InvalidProgress(
                "Job progress counters must be monotonic".to_owned(),
            ));
        }
        if self.total_sources > 0 && self.sources_completed > self.total_sources {
            return Err(JobMutationError::InvalidProgress(
                "sources_completed cannot exceed total_sources".to_owned(),
            ));
        }
        Ok(())
    }

    fn as_map(&self) -> BTreeMap<String, Value> {
        BTreeMap::from([
            (
                "articles_fetched".to_owned(),
                Value::from(self.articles_fetched),
            ),
            (
                "sources_completed".to_owned(),
                Value::from(self.sources_completed),
            ),
            ("total_sources".to_owned(), Value::from(self.total_sources)),
        ])
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = JobStartResponse)]
pub(crate) struct JobStartResponse {
    pub(crate) job_id: String,
    pub(crate) status: String,
    pub(crate) stream_url: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = JobStatus)]
pub(crate) struct JobStatusResponse {
    pub(crate) job_id: String,
    pub(crate) status: String,
    pub(crate) started_at: String,
    #[schema(additional_properties = true)]
    pub(crate) progress: BTreeMap<String, Value>,
    #[schema(required = false)]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageUrlParameters {
    url: String,
}

#[derive(Clone, Debug)]
struct ValidatedUrl {
    value: String,
    host: String,
}

struct JobEntry {
    record: JobRecord,
    started_at: String,
    progress: JobProgress,
    error: Option<String>,
    event_cursor: EventCursor,
    events: VecDeque<SequencedEvent<Value>>,
    next_event_sequence: u64,
    history_truncated: bool,
    next_subscriber_id: u64,
    subscribers: BTreeMap<u64, Option<Waker>>,
}

impl JobEntry {
    fn new(id: JobId) -> Self {
        Self {
            record: JobRecord::initial(id),
            started_at: utc_isoformat(),
            progress: JobProgress::default(),
            error: None,
            event_cursor: EventCursor::new(),
            events: VecDeque::new(),
            next_event_sequence: 0,
            history_truncated: false,
            next_subscriber_id: 1,
            subscribers: BTreeMap::new(),
        }
    }

    fn emit(&mut self, payload: Value) -> Result<(), JobMutationError> {
        let event = self
            .event_cursor
            .issue(payload)
            .map_err(|_| JobMutationError::EventSequenceExhausted)?;
        self.next_event_sequence = event.sequence().value().saturating_add(1);
        self.events.push_back(event);
        if self.events.len() > MAX_JOB_EVENTS {
            self.events.pop_front();
            self.history_truncated = true;
        }
        for waker in self.subscribers.values().flatten() {
            waker.wake_by_ref();
        }
        Ok(())
    }
}

struct JobsImageInner {
    next_job_id: u64,
    jobs: BTreeMap<String, JobEntry>,
}

impl Default for JobsImageInner {
    fn default() -> Self {
        Self {
            next_job_id: 1,
            jobs: BTreeMap::new(),
        }
    }
}

/// Runtime state shared by all seven B10 handlers.
#[derive(Clone)]
pub struct JobsImageState {
    inner: Arc<Mutex<JobsImageInner>>,
    refresh_worker: Option<Arc<dyn RefreshJobWorker>>,
    image_transport: Option<Arc<dyn ImageTransport>>,
    og_provider: Option<Arc<dyn OgImageProvider>>,
    image_cache: Option<Arc<dyn ImageCache>>,
    stream_keepalive: Duration,
}

impl Default for JobsImageState {
    fn default() -> Self {
        Self::build(None, None, None, None)
    }
}

impl JobsImageState {
    fn build(
        refresh_worker: Option<Arc<dyn RefreshJobWorker>>,
        image_transport: Option<Arc<dyn ImageTransport>>,
        og_provider: Option<Arc<dyn OgImageProvider>>,
        image_cache: Option<Arc<dyn ImageCache>>,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobsImageInner::default())),
            refresh_worker,
            image_transport,
            og_provider,
            image_cache,
            stream_keepalive: JOB_STREAM_KEEPALIVE,
        }
    }

    /// Attach the shared cache provider used by proxy, stats, and clear routes.
    pub fn with_cache(mut self, image_cache: Arc<dyn ImageCache>) -> Self {
        self.image_cache = Some(image_cache);
        self
    }

    /// Use the database-backed cache unless a cache was already supplied.
    pub(crate) fn with_database_cache_default(self, database: &thesis_db::Database) -> Self {
        if self.image_cache.is_some() {
            return self;
        }
        self.with_cache(Arc::new(DatabaseImageCache::new(database.clone())))
    }
    #[cfg(test)]
    fn with_test_keepalive(mut self, interval: Duration) -> Self {
        self.stream_keepalive = interval;
        self
    }

    pub fn with_refresh_worker(mut self, worker: Arc<dyn RefreshJobWorker>) -> Self {
        self.refresh_worker = Some(worker);
        self
    }

    pub fn with_image_transport(mut self, transport: Arc<dyn ImageTransport>) -> Self {
        self.image_transport = Some(transport);
        self
    }

    pub fn with_og_provider(mut self, provider: Arc<dyn OgImageProvider>) -> Self {
        self.og_provider = Some(provider);
        self
    }

    fn lock(&self) -> MutexGuard<'_, JobsImageInner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn reserve_job(&self) -> StartDecision {
        let mut inner = self.lock();
        if let Some((job_id, _)) = inner
            .jobs
            .iter()
            .find(|(_, entry)| !entry.record.is_terminal())
        {
            return StartDecision::Existing(JobStartResponse {
                job_id: job_id.clone(),
                status: "already_running".to_owned(),
                stream_url: stream_url(job_id),
            });
        }

        let numeric_id = inner.next_job_id;
        let Some(next_id) = numeric_id.checked_add(1) else {
            return StartDecision::Unavailable;
        };
        inner.next_job_id = next_id;
        let runtime_id = JobId::new(numeric_id);
        let job_id = format!("refresh-{numeric_id}");
        let mut entry = JobEntry::new(runtime_id);
        let generation = entry.record.generation();
        let command = FencedJobCommand::new(generation, JobCommand::<(), String>::Start);
        if entry.record.apply(command).is_err() {
            return StartDecision::Unavailable;
        }
        inner.jobs.insert(job_id.clone(), entry);
        StartDecision::New {
            job_id,
            generation,
            worker: self.refresh_worker.clone(),
        }
    }

    fn fail_job(&self, job_id: &str, generation: Generation, detail: String) {
        let _ = self.complete_job(job_id, generation, Err(detail));
    }

    /// Update typed counters and publish one deterministic progress event.
    pub fn update_progress(
        &self,
        job_id: &str,
        generation: Generation,
        progress: JobProgress,
    ) -> Result<(), JobMutationError> {
        let mut inner = self.lock();
        let entry = inner
            .jobs
            .get_mut(job_id)
            .ok_or(JobMutationError::NotFound)?;
        if entry.record.generation() != generation {
            return Err(JobMutationError::StaleGeneration {
                expected: entry.record.generation(),
                received: generation,
            });
        }
        if entry.record.phase() != JobPhase::Running {
            return Err(JobMutationError::Runtime(
                JobCommandError::InvalidTransition {
                    phase: entry.record.phase(),
                    action: thesis_runtime::JobActionKind::Complete,
                },
            ));
        }
        progress.validate_against(&entry.progress)?;
        entry.progress = progress.clone();
        entry.emit(json!({
            "type": "progress",
            "progress": progress.as_map(),
            "timestamp": utc_isoformat(),
        }))
    }

    /// Publish FastAPI's per-source progress event and monotonic job counters.
    pub fn source_completed(
        &self,
        job_id: &str,
        generation: Generation,
        source: Option<String>,
        article_count: usize,
        source_stat: Value,
        progress: JobProgress,
    ) -> Result<(), JobMutationError> {
        let mut inner = self.lock();
        let entry = inner
            .jobs
            .get_mut(job_id)
            .ok_or(JobMutationError::NotFound)?;
        if entry.record.generation() != generation {
            return Err(JobMutationError::StaleGeneration {
                expected: entry.record.generation(),
                received: generation,
            });
        }
        if entry.record.phase() != JobPhase::Running {
            return Err(JobMutationError::Runtime(
                JobCommandError::InvalidTransition {
                    phase: entry.record.phase(),
                    action: thesis_runtime::JobActionKind::Complete,
                },
            ));
        }
        progress.validate_against(&entry.progress)?;
        entry.progress = progress;
        entry.emit(json!({
            "type": "source_complete",
            "source": source,
            "article_count": article_count,
            "source_stat": source_stat,
            "timestamp": utc_isoformat(),
        }))
    }

    /// Complete one worker generation, preserving stale-result fencing.
    pub fn complete_job(
        &self,
        job_id: &str,
        generation: Generation,
        result: Result<(), String>,
    ) -> Result<(), JobMutationError> {
        self.complete_job_inner(job_id, generation, result, None)
    }

    /// Complete a successful refresh with FastAPI's final cache summary.
    pub fn complete_job_with_summary(
        &self,
        job_id: &str,
        generation: Generation,
        total_articles: usize,
        source_stats: Value,
    ) -> Result<(), JobMutationError> {
        self.complete_job_inner(
            job_id,
            generation,
            Ok(()),
            Some((total_articles, source_stats)),
        )
    }

    fn complete_job_inner(
        &self,
        job_id: &str,
        generation: Generation,
        result: Result<(), String>,
        summary: Option<(usize, Value)>,
    ) -> Result<(), JobMutationError> {
        let detail = result.as_ref().err().cloned();
        let mut inner = self.lock();
        let entry = inner
            .jobs
            .get_mut(job_id)
            .ok_or(JobMutationError::NotFound)?;
        if entry.record.generation() != generation {
            return Err(JobMutationError::StaleGeneration {
                expected: entry.record.generation(),
                received: generation,
            });
        }
        let transition = entry
            .record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::Complete(result),
            ))
            .map_err(JobMutationError::Runtime)?;
        match transition.into_event() {
            Some(JobEvent::Succeeded(())) => {
                entry.error = None;
                let payload = match summary {
                    Some((total_articles, source_stats)) => json!({
                        "type": "complete",
                        "total_articles": total_articles,
                        "source_stats": source_stats,
                        "timestamp": utc_isoformat(),
                    }),
                    None => json!({
                        "type": "complete",
                        "timestamp": utc_isoformat(),
                    }),
                };
                entry.emit(payload)?;
            }
            Some(JobEvent::Failed(error)) => {
                entry.error = Some(error.clone());
                entry.emit(json!({
                    "type": "error",
                    "message": error,
                    "timestamp": utc_isoformat(),
                }))?;
            }
            _ => {
                entry.error = detail;
            }
        }
        Ok(())
    }

    /// Request cooperative cancellation for a running generation.
    pub fn request_cancel(
        &self,
        job_id: &str,
        generation: Generation,
    ) -> Result<(), JobMutationError> {
        let mut inner = self.lock();
        let entry = inner
            .jobs
            .get_mut(job_id)
            .ok_or(JobMutationError::NotFound)?;
        if entry.record.generation() != generation {
            return Err(JobMutationError::StaleGeneration {
                expected: entry.record.generation(),
                received: generation,
            });
        }
        let transition = entry
            .record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<(), String>::RequestCancel {
                    reason: CancellationReason::Requested,
                },
            ))
            .map_err(JobMutationError::Runtime)?;
        if matches!(transition.event(), Some(JobEvent::CancellationRequested(_))) {
            entry.emit(json!({
                "type": "cancelling",
                "timestamp": utc_isoformat(),
            }))?;
        }
        Ok(())
    }

    /// A worker acknowledges a cooperative cancellation request.
    pub fn acknowledge_cancel(
        &self,
        job_id: &str,
        generation: Generation,
    ) -> Result<(), JobMutationError> {
        let mut inner = self.lock();
        let entry = inner
            .jobs
            .get_mut(job_id)
            .ok_or(JobMutationError::NotFound)?;
        if entry.record.generation() != generation {
            return Err(JobMutationError::StaleGeneration {
                expected: entry.record.generation(),
                received: generation,
            });
        }
        let transition = entry
            .record
            .apply(FencedJobCommand::new(
                generation,
                JobCommand::<(), String>::AcknowledgeCancellation,
            ))
            .map_err(JobMutationError::Runtime)?;
        if matches!(transition.event(), Some(JobEvent::Cancelled(_))) {
            entry.error = Some("Refresh job cancelled".to_owned());
            entry.emit(json!({
                "type": "cancelled",
                "message": "Refresh job cancelled",
                "timestamp": utc_isoformat(),
            }))?;
        }
        Ok(())
    }

    fn status(&self, job_id: &str) -> Option<JobStatusResponse> {
        let inner = self.lock();
        let entry = inner.jobs.get(job_id)?;
        Some(status_response(job_id, entry))
    }

    fn subscribe_to_job(
        &self,
        job_id: &str,
    ) -> Result<(JobStatusResponse, JobEventSubscription), JobStreamOpenError> {
        let mut inner = self.lock();
        let Some(entry) = inner.jobs.get_mut(job_id) else {
            return Err(JobStreamOpenError::NotFound);
        };
        if entry.subscribers.len() >= MAX_JOB_STREAMS {
            return Err(JobStreamOpenError::TooManySubscribers);
        }
        let subscriber_id = entry.next_subscriber_id;
        let Some(next_subscriber_id) = subscriber_id.checked_add(1) else {
            return Err(JobStreamOpenError::TooManySubscribers);
        };
        entry.next_subscriber_id = next_subscriber_id;
        let first_sequence = entry
            .events
            .front()
            .map_or(entry.next_event_sequence, |event| event.sequence().value());
        let history_truncated = entry.history_truncated;
        let status = status_response(job_id, entry);
        entry.subscribers.insert(subscriber_id, None);
        Ok((
            status,
            JobEventSubscription {
                state: self.clone(),
                job_id: job_id.to_owned(),
                subscriber_id,
                next_sequence: first_sequence,
                history_truncated,
            },
        ))
    }

    fn image_cache(&self) -> Option<Arc<dyn ImageCache>> {
        self.image_cache.clone()
    }
}

struct JobEventSubscription {
    state: JobsImageState,
    job_id: String,
    subscriber_id: u64,
    next_sequence: u64,
    history_truncated: bool,
}

impl JobEventSubscription {
    async fn next_event(&mut self) -> Result<Option<SequencedEvent<Value>>, JobStreamReadError> {
        poll_fn(|context| self.poll_next_event(context)).await
    }

    fn poll_next_event(
        &mut self,
        context: &mut Context<'_>,
    ) -> Poll<Result<Option<SequencedEvent<Value>>, JobStreamReadError>> {
        if self.history_truncated {
            self.history_truncated = false;
            return Poll::Ready(Err(JobStreamReadError::HistoryTruncated));
        }

        let mut inner = self.state.lock();
        let Some(entry) = inner.jobs.get_mut(&self.job_id) else {
            return Poll::Ready(Ok(None));
        };
        let first_sequence = entry
            .events
            .front()
            .map_or(entry.next_event_sequence, |event| event.sequence().value());
        if self.next_sequence < first_sequence {
            return Poll::Ready(Err(JobStreamReadError::HistoryTruncated));
        }
        let event_offset = self.next_sequence.saturating_sub(first_sequence) as usize;
        if let Some(event) = entry.events.get(event_offset) {
            self.next_sequence = self.next_sequence.saturating_add(1);
            if let Some(waker) = entry.subscribers.get_mut(&self.subscriber_id) {
                *waker = None;
            }
            return Poll::Ready(Ok(Some(event.clone())));
        }
        if entry.record.is_terminal() {
            return Poll::Ready(Ok(None));
        }
        let Some(waker) = entry.subscribers.get_mut(&self.subscriber_id) else {
            return Poll::Ready(Ok(None));
        };
        if !waker
            .as_ref()
            .is_some_and(|registered| registered.will_wake(context.waker()))
        {
            *waker = Some(context.waker().clone());
        }
        Poll::Pending
    }

    fn is_terminal(&self) -> bool {
        self.state
            .lock()
            .jobs
            .get(&self.job_id)
            .is_none_or(|entry| entry.record.is_terminal())
    }
}

impl Drop for JobEventSubscription {
    fn drop(&mut self) {
        if let Some(entry) = self.state.lock().jobs.get_mut(&self.job_id) {
            entry.subscribers.remove(&self.subscriber_id);
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum JobStreamOpenError {
    NotFound,
    TooManySubscribers,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum JobStreamReadError {
    HistoryTruncated,
}

enum StartDecision {
    Existing(JobStartResponse),
    New {
        job_id: String,
        generation: Generation,
        worker: Option<Arc<dyn RefreshJobWorker>>,
    },
    Unavailable,
}

#[derive(Debug)]
pub(crate) struct ImageObjectSchema;

impl PartialSchema for ImageObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for ImageObjectSchema {}

#[derive(Debug)]
pub(crate) struct StringObjectSchema;

impl PartialSchema for StringObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
            .build()
            .into()
    }
}

impl ToSchema for StringObjectSchema {}

#[utoipa::path(
    post,
    path = "/jobs/refresh",
    operation_id = "start_refresh_job_jobs_refresh_post",
    tag = "jobs",
    responses((status = 200, description = "Successful Response", body = JobStartResponse))
)]
pub(crate) async fn start_refresh_job(State(state): State<JobsImageState>) -> Response {
    let decision = state.reserve_job();
    let (job_id, status) = match decision {
        StartDecision::Existing(response) => return Json(response).into_response(),
        StartDecision::Unavailable => {
            return service_unavailable(REFRESH_WORKER_UNAVAILABLE_DETAIL);
        }
        StartDecision::New {
            job_id,
            generation,
            worker,
        } => {
            let status = match worker {
                None => {
                    state.fail_job(
                        &job_id,
                        generation,
                        REFRESH_WORKER_UNAVAILABLE_DETAIL.to_owned(),
                    );
                    "error"
                }
                Some(worker) => match worker.launch(job_id.clone(), generation, state.clone()) {
                    Ok(()) => "started",
                    Err(RefreshWorkerError::Unavailable) => {
                        state.fail_job(
                            &job_id,
                            generation,
                            REFRESH_WORKER_UNAVAILABLE_DETAIL.to_owned(),
                        );
                        "error"
                    }
                    Err(RefreshWorkerError::Failed(detail)) => {
                        state.fail_job(&job_id, generation, detail);
                        "error"
                    }
                },
            };
            (job_id, status)
        }
    };
    let stream_url = stream_url(&job_id);
    Json(JobStartResponse {
        job_id,
        status: status.to_owned(),
        stream_url,
    })
    .into_response()
}

#[utoipa::path(
    get,
    path = "/jobs/{job_id}/stream",
    operation_id = "stream_job_progress_jobs__job_id__stream_get",
    tag = "jobs",
    params(("job_id" = String, Path, description = "Job id")),
    responses(
        (status = 200, description = "Successful Response", body = serde_json::Value),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn stream_job_progress(
    State(state): State<JobsImageState>,
    Path(job_id): Path<String>,
) -> Response {
    let (status, subscription) = match state.subscribe_to_job(&job_id) {
        Ok(subscription) => subscription,
        Err(JobStreamOpenError::NotFound) => {
            return not_found(format!("Job {job_id} not found"));
        }
        Err(JobStreamOpenError::TooManySubscribers) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"detail": "Too many job progress stream subscribers"})),
            )
                .into_response();
        }
    };
    let body = live_job_stream(status, subscription, state.stream_keepalive);
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .header("x-job-id", job_id.as_str())
        .body(body)
        .expect("valid SSE response headers")
}

#[utoipa::path(
    get,
    path = "/jobs/{job_id}/status",
    operation_id = "get_job_status_jobs__job_id__status_get",
    tag = "jobs",
    params(("job_id" = String, Path, description = "Job id")),
    responses(
        (status = 200, description = "Successful Response", body = JobStatusResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_job_status(
    State(state): State<JobsImageState>,
    Path(job_id): Path<String>,
) -> Response {
    match state.status(&job_id) {
        Some(status) => Json(status).into_response(),
        None => not_found(format!("Job {job_id} not found")),
    }
}

#[utoipa::path(
    get,
    path = "/image/proxy",
    operation_id = "proxy_image_image_proxy_get",
    tag = "images",
    params(("url" = String, Query, description = "URL of the image to proxy")),
    responses(
        (status = 200, description = "Successful Response", body = serde_json::Value),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn proxy_image(State(state): State<JobsImageState>, uri: Uri) -> Response {
    let parameters = match parse_image_query(&uri) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    if parameters.url.is_empty() {
        return bad_request("URL is required");
    }
    let validated = match validate_http_url(&parameters.url) {
        Ok(url) => url,
        Err(detail) => return bad_request(detail),
    };
    // Like FastAPI's disk cache, the cache only short-circuits fetches; a
    // missing or failing cache falls through to the transport.
    let cache = state.image_cache();
    if let Some(cache) = &cache {
        match cache.get(validated.value.clone()).await {
            Ok(Some(cached)) => {
                let age = Utc::now()
                    .signed_duration_since(cached.stored_at)
                    .num_seconds()
                    .max(0) as u64;
                if age < CACHE_MAX_AGE_SECONDS {
                    return image_response(cached.bytes, cached.content_type, "HIT", Some(age));
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(url = %validated.value, error = %error.0, "image cache read failed");
            }
        }
    }

    let Some(transport) = state.image_transport.clone() else {
        return service_unavailable(IMAGE_TRANSPORT_UNAVAILABLE_DETAIL);
    };
    let payload = match transport
        .fetch(ImageFetchRequest {
            url: validated.value.clone(),
            timeout: IMAGE_FETCH_TIMEOUT,
            max_redirects: MAX_REDIRECTS,
            max_bytes: MAX_IMAGE_SIZE,
            user_agent: SCOOP_BROWSER_USER_AGENT,
        })
        .await
    {
        Ok(payload) => payload,
        Err(error) => return image_transport_error(error),
    };
    let content_type = match validate_image_payload(&validated, &payload) {
        Ok(content_type) => content_type,
        Err(detail) => return bad_request(detail),
    };
    let bytes = payload.bytes;
    if let Some(cache) = cache {
        let entry = ImageCacheEntry {
            bytes: bytes.clone(),
            content_type: content_type.clone(),
            stored_at: Utc::now(),
        };
        if let Err(error) = cache.put(validated.value, entry).await {
            tracing::warn!(error = %error.0, "image cache write failed");
        }
    }
    image_response(bytes, content_type, "MISS", None)
}

#[utoipa::path(
    get,
    path = "/image/cache/stats",
    operation_id = "get_cache_stats_image_cache_stats_get",
    tag = "images",
    responses((status = 200, description = "Successful Response", body = inline(ImageObjectSchema)))
)]
pub(crate) async fn get_cache_stats(State(state): State<JobsImageState>) -> Response {
    let Some(cache) = state.image_cache() else {
        return service_unavailable(IMAGE_CACHE_UNAVAILABLE_DETAIL);
    };
    let stats = match cache.stats().await {
        Ok(stats) => stats,
        Err(error) => {
            return Json(BTreeMap::from([(
                "error".to_owned(),
                Value::String(error.0),
            )]))
            .into_response();
        }
    };
    let total_size_bytes = stats.total_size_bytes.max(0);
    Json(BTreeMap::from([
        (
            "cache_dir".to_owned(),
            Value::String(configured_cache_dir()),
        ),
        (
            "max_age_seconds".to_owned(),
            Value::from(CACHE_MAX_AGE_SECONDS),
        ),
        (
            "total_files".to_owned(),
            Value::from(stats.total_files.max(0)),
        ),
        ("total_size_bytes".to_owned(), Value::from(total_size_bytes)),
        (
            "total_size_mb".to_owned(),
            Value::from(round_two(total_size_bytes as f64 / (1024.0 * 1024.0))),
        ),
    ]))
    .into_response()
}

#[utoipa::path(
    delete,
    path = "/image/cache/clear",
    operation_id = "clear_cache_image_cache_clear_delete",
    tag = "images",
    responses((status = 200, description = "Successful Response", body = inline(ImageObjectSchema)))
)]
pub(crate) async fn clear_cache(State(state): State<JobsImageState>) -> Response {
    let Some(cache) = state.image_cache() else {
        return service_unavailable(IMAGE_CACHE_UNAVAILABLE_DETAIL);
    };
    let cleared = match cache.clear().await {
        Ok(cleared) => cleared.saturating_mul(2),
        Err(error) => return internal_server_error(error.0),
    };
    Json(BTreeMap::from([
        ("cleared".to_owned(), Value::from(cleared)),
        (
            "message".to_owned(),
            Value::String(format!("Cleared {cleared} cached files")),
        ),
    ]))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/image/og",
    operation_id = "get_og_image_image_og_get",
    tag = "images",
    params((
        "url" = String,
        Query,
        description = "URL of the article to fetch OpenGraph image from"
    )),
    responses(
        (status = 200, description = "Successful Response", body = inline(StringObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_og_image(State(state): State<JobsImageState>, uri: Uri) -> Response {
    let parameters = match parse_image_query(&uri) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    if parameters.url.is_empty() {
        return bad_request("URL is required");
    }
    let article_url = match validate_http_url(&parameters.url) {
        Ok(url) => url,
        Err(detail) => return bad_request(detail),
    };
    let Some(provider) = state.og_provider.clone() else {
        return service_unavailable(OG_PROVIDER_UNAVAILABLE_DETAIL);
    };
    let result = match provider
        .fetch(OgImageFetchRequest {
            article_url: article_url.value,
            timeout: OG_FETCH_TIMEOUT,
            max_redirects: MAX_REDIRECTS,
            max_bytes: MAX_OG_RESPONSE_SIZE,
            user_agent: SCOOP_BROWSER_USER_AGENT,
        })
        .await
    {
        Ok(result) => result,
        Err(error) => return image_transport_error(error),
    };
    let Some(result) = result else {
        return not_found("No OpenGraph image found");
    };
    if let Err(detail) = validate_fetch_trace(&result.article_trace) {
        return bad_request(detail);
    }
    let image_url = match validate_http_url(&result.image_url) {
        Ok(url) => url,
        Err(detail) => return bad_request(detail),
    };
    if let Err(detail) = validate_fetch_trace(&result.image_trace) {
        return bad_request(detail);
    }
    if result.image_trace.final_url != image_url.value {
        return bad_request("IMAGE_UNSAFE_REDIRECT: image URL does not match final URL");
    }
    Json(BTreeMap::from([("image_url".to_owned(), image_url.value)])).into_response()
}

fn status_response(job_id: &str, entry: &JobEntry) -> JobStatusResponse {
    JobStatusResponse {
        job_id: job_id.to_owned(),
        status: status_name(entry.record.phase()).to_owned(),
        started_at: entry.started_at.clone(),
        progress: entry.progress.as_map(),
        error: entry.error.clone(),
    }
}

fn status_name(phase: JobPhase) -> &'static str {
    match phase {
        JobPhase::Queued => "starting",
        JobPhase::Running => "running",
        JobPhase::Cancelling => "cancelling",
        JobPhase::Succeeded => "complete",
        JobPhase::Failed => "error",
        JobPhase::Cancelled => "cancelled",
    }
}

fn live_job_stream(
    status: JobStatusResponse,
    subscription: JobEventSubscription,
    keepalive_interval: Duration,
) -> Body {
    let initial = encode_initial_sse(&status);
    let body_stream = stream::unfold(
        (Some(initial), subscription, false),
        move |(initial, mut subscription, finished)| async move {
            if let Some(initial) = initial {
                return Some((Ok::<_, Infallible>(initial), (None, subscription, false)));
            }
            if finished {
                return None;
            }

            // Finish the race before matching so the pending `next_event`
            // future, which borrows `subscription`, is dropped first.
            let next = {
                let next_event = Box::pin(subscription.next_event());
                let keepalive = Box::pin(sleep(keepalive_interval));
                match select(next_event, keepalive).await {
                    Either::Left((result, _)) => Some(result),
                    Either::Right(_) => None,
                }
            };
            match next {
                Some(Ok(Some(event))) => {
                    let is_terminal = event
                        .payload()
                        .get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|event_type| {
                            matches!(event_type, "complete" | "error" | "cancelled")
                        });
                    Some((
                        Ok(encode_job_event_sse(&event)),
                        (None, subscription, is_terminal),
                    ))
                }
                Some(Ok(None)) => None,
                Some(Err(JobStreamReadError::HistoryTruncated)) => {
                    let error = json!({
                        "type": "error",
                        "message": "Job progress event history exceeded its retention limit",
                        "timestamp": utc_isoformat(),
                    });
                    Some((
                        Ok(encode_sse_data(None, false, &error)),
                        (None, subscription, true),
                    ))
                }
                None => {
                    if subscription.is_terminal() {
                        None
                    } else {
                        Some((
                            Ok(Bytes::from_static(b": keepalive\n\n")),
                            (None, subscription, false),
                        ))
                    }
                }
            }
        },
    );
    Body::from_stream(body_stream)
}

fn encode_initial_sse(status: &JobStatusResponse) -> Bytes {
    let payload = json!({
        "status": status.status,
        "started_at": status.started_at,
        "progress": status.progress,
    });
    encode_sse_data(Some(1), true, &payload)
}

fn encode_job_event_sse(event: &SequencedEvent<Value>) -> Bytes {
    encode_sse_data(
        Some(event.sequence().value().saturating_add(2)),
        false,
        event.payload(),
    )
}

fn encode_sse_data(event_id: Option<u64>, retry: bool, payload: &Value) -> Bytes {
    let data = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_owned());
    let mut frame = String::new();
    if let Some(event_id) = event_id {
        frame.push_str(&format!("id: {event_id}\n"));
    }
    if retry {
        frame.push_str("retry: 3000\n");
    }
    frame.push_str(&format!("data: {data}\n\n"));
    Bytes::from(frame)
}

fn parse_image_query(uri: &Uri) -> Result<ImageUrlParameters, HttpValidationError> {
    Query::<ImageUrlParameters>::try_from_uri(uri)
        .map(|Query(parameters)| parameters)
        .map_err(|_| HttpValidationError {
            detail: vec![ValidationError {
                loc: vec![
                    ValidationLocation::Text("query".to_owned()),
                    ValidationLocation::Text("url".to_owned()),
                ],
                msg: "Field required".to_owned(),
                error_type: "missing".to_owned(),
                input: Value::String(uri.query().unwrap_or_default().to_owned()),
                ctx: None,
            }],
        })
}

fn validate_http_url(value: &str) -> Result<ValidatedUrl, &'static str> {
    if value.chars().count() > MAX_URL_LENGTH {
        return Err("URL is too long");
    }
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return Err("Invalid URL scheme");
    }
    if value
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("URL must not contain whitespace or control characters");
    }
    if value.contains('#') {
        return Err("URL fragments are not accepted");
    }
    let Some((_, rest)) = value.split_once("://") else {
        return Err("Invalid URL scheme");
    };
    let authority = rest.split(['/', '?']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return Err("URL must contain a host and must not contain credentials");
    }

    let host = if let Some(stripped) = authority.strip_prefix('[') {
        let Some(end) = stripped.find(']') else {
            return Err("URL host is not allowed");
        };
        let host = &stripped[..end];
        if host.parse::<Ipv6Addr>().is_err() {
            return Err("URL host is not allowed");
        }
        let suffix = &stripped[end + 1..];
        if !suffix.is_empty() {
            let Some(port) = suffix.strip_prefix(':') else {
                return Err("URL port is not allowed");
            };
            if port.is_empty() || port.parse::<u16>().is_err() {
                return Err("URL port is not allowed");
            }
        }
        return Err("IP-literal URL hosts are not accepted");
    } else {
        if authority.matches(':').count() > 1 {
            return Err("URL host is not allowed");
        }
        let (host, port) = authority
            .rsplit_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)));
        if let Some(port) = port {
            if port.is_empty() || port.parse::<u16>().is_err() {
                return Err("URL port is not allowed");
            }
        }
        host
    };

    if host.is_empty() || host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("URL host is not allowed");
    }
    if host.parse::<IpAddr>().is_ok() {
        return Err("IP-literal URL hosts are not accepted");
    }
    if host.ends_with('.')
        || host.contains("..")
        || host.contains('[')
        || host.contains(']')
        || host.contains('\\')
        || host.contains('%')
    {
        return Err("URL host is not allowed");
    }
    Ok(ValidatedUrl {
        value: value.to_owned(),
        host: host.to_ascii_lowercase(),
    })
}

fn validate_image_payload(
    requested: &ValidatedUrl,
    payload: &ImagePayload,
) -> Result<String, String> {
    if payload.redirect_count > MAX_REDIRECTS {
        return Err("IMAGE_REDIRECT_UNSAFE: redirect limit exceeded".to_owned());
    }
    let final_url = validate_http_url(&payload.final_url)
        .map_err(|_| "IMAGE_UNSAFE_REDIRECT: final URL is not safe".to_owned())?;
    validate_resolved_addresses(&payload.resolved_addresses)?;
    let content_type = normalize_content_type(&payload.content_type)
        .ok_or_else(|| "IMAGE_UNSUPPORTED_TYPE: missing content type".to_owned())?;
    if !ALLOWED_CONTENT_TYPES.contains(&content_type.as_str()) {
        return Err(format!("IMAGE_UNSUPPORTED_TYPE: {content_type}"));
    }
    if payload.bytes.len() > MAX_IMAGE_SIZE {
        return Err(format!(
            "IMAGE_TOO_LARGE: {} bytes exceeds {MAX_IMAGE_SIZE}",
            payload.bytes.len()
        ));
    }
    if requested.host.is_empty() || final_url.host.is_empty() {
        return Err("IMAGE_UNSAFE_REDIRECT: empty host".to_owned());
    }
    Ok(content_type)
}

fn validate_fetch_trace(trace: &FetchTrace) -> Result<(), String> {
    if trace.redirect_count > MAX_REDIRECTS {
        return Err("IMAGE_REDIRECT_UNSAFE: redirect limit exceeded".to_owned());
    }
    validate_http_url(&trace.final_url)
        .map_err(|_| "IMAGE_UNSAFE_REDIRECT: final URL is not safe".to_owned())?;
    validate_resolved_addresses(&trace.resolved_addresses)
}

fn validate_resolved_addresses(addresses: &[IpAddr]) -> Result<(), String> {
    if addresses.is_empty() {
        return Err("IMAGE_UNSAFE_URL: host resolution was not provided".to_owned());
    }
    if addresses.iter().any(|address| !is_public_ip(*address)) {
        return Err("IMAGE_UNSAFE_URL: private or reserved address rejected".to_owned());
    }
    Ok(())
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 100 && (64..=127).contains(&b)
        || a == 127
        || a == 169 && b == 254
        || a == 172 && (16..=31).contains(&b)
        || a == 192 && (b == 0 || b == 168)
        || a == 198 && (20..=51).contains(&b)
        || a == 203 && b == 0 && c == 113
        || a >= 224)
}
fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    let first = segments[0];
    let is_ipv4_mapped = segments[..5].iter().all(|segment| *segment == 0) && segments[5] == 0xffff;
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (first & 0xfe00 == 0xfc00)
        || (first & 0xffc0 == 0xfe80)
        || (first == 0x2001 && segments[1] == 0x0db8)
        || is_ipv4_mapped)
}

fn normalize_content_type(value: &str) -> Option<String> {
    let normalized = value.split(';').next()?.trim().to_ascii_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

fn configured_cache_dir() -> String {
    std::env::var("IMAGE_CACHE_DIR").unwrap_or_else(|_| DEFAULT_CACHE_DIR.to_owned())
}

fn image_response(
    bytes: Bytes,
    content_type: String,
    cache_status: &str,
    cached_age: Option<u64>,
) -> Response {
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", content_type)
        .header(
            "cache-control",
            format!(
                "public, max-age={CACHE_MAX_AGE_SECONDS}, stale-while-revalidate={CACHE_STALE_WHILE_REVALIDATE_SECONDS}"
            ),
        )
        .header("content-length", bytes.len().to_string())
        .header("x-cache", cache_status);
    if let Some(cached_age) = cached_age {
        builder = builder.header("x-cache-age", cached_age.to_string());
    }
    builder
        .body(Body::from(bytes))
        .expect("valid image response headers")
}
fn image_transport_error(error: ImageTransportError) -> Response {
    match error {
        ImageTransportError::Unavailable => service_unavailable(IMAGE_TRANSPORT_UNAVAILABLE_DETAIL),
        ImageTransportError::Timeout => gateway_timeout("IMAGE_FETCH_TIMEOUT"),
        ImageTransportError::HttpStatus(status) => {
            bad_gateway(format!("IMAGE_FETCH_FAILED: HTTP {status}"))
        }
        ImageTransportError::UnsafeUrl(detail) => bad_request(detail),
        ImageTransportError::UnsupportedContentType(content_type) => {
            bad_request(format!("IMAGE_UNSUPPORTED_TYPE: {content_type}"))
        }
        ImageTransportError::TooLarge(size) => bad_request(format!(
            "IMAGE_TOO_LARGE: {size} bytes exceeds {MAX_IMAGE_SIZE}"
        )),
        ImageTransportError::Failed(detail) => bad_gateway(format!("IMAGE_FETCH_FAILED: {detail}")),
    }
}

fn stream_url(job_id: &str) -> String {
    format!("/api/jobs/{job_id}/stream")
}

fn utc_isoformat() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

fn round_two(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn bad_request(detail: impl Into<String>) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"detail": detail.into()})),
    )
        .into_response()
}

fn bad_gateway(detail: impl Into<String>) -> Response {
    (
        StatusCode::BAD_GATEWAY,
        Json(json!({"detail": detail.into()})),
    )
        .into_response()
}

fn gateway_timeout(detail: impl Into<String>) -> Response {
    (
        StatusCode::GATEWAY_TIMEOUT,
        Json(json!({"detail": detail.into()})),
    )
        .into_response()
}

fn service_unavailable(detail: impl Into<String>) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": detail.into()})),
    )
        .into_response()
}

fn internal_server_error(detail: impl Into<String>) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"detail": detail.into()})),
    )
        .into_response()
}
fn not_found(detail: impl Into<String>) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"detail": detail.into()})),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request, StatusCode};
    use axum::response::Response;
    use axum::routing::{delete, get, post};
    use axum::Router;
    use futures_util::StreamExt;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::Generation;
    use super::{
        clear_cache, get_cache_stats, get_job_status, get_og_image, normalize_og_candidate,
        proxy_image, start_refresh_job, stream_job_progress, FetchTrace, ImageCache,
        ImageCacheEntry, ImageCacheError, ImageCacheFuture, ImageCacheStats, ImageFetchRequest,
        ImagePayload, ImageTransport, ImageTransportError, ImageTransportFuture, JobProgress,
        JobsImageState, OgImageFetchRequest, OgImageFuture, OgImagePayload, OgImageProvider,
        RefreshJobWorker, RefreshWorkerError, MAX_IMAGE_SIZE, MAX_JOB_EVENTS,
    };

    const IMAGE_URL: &str = "https://images.example.test/picture.png";
    const IMAGE_URI: &str = "/image/proxy?url=https%3A%2F%2Fimages.example.test%2Fpicture.png";
    const ARTICLE_URL: &str = "https://news.example.test/story";
    const ARTICLE_URI: &str = "/image/og?url=https%3A%2F%2Fnews.example.test%2Fstory";

    fn app(state: JobsImageState) -> Router {
        Router::new()
            .route("/jobs/refresh", post(start_refresh_job))
            .route("/jobs/{job_id}/stream", get(stream_job_progress))
            .route("/jobs/{job_id}/status", get(get_job_status))
            .route("/image/proxy", get(proxy_image))
            .route("/image/cache/stats", get(get_cache_stats))
            .route("/image/cache/clear", delete(clear_cache))
            .route("/image/og", get(get_og_image))
            .with_state(state)
    }

    #[test]
    fn og_candidates_use_canonical_priority_and_reject_placeholders() {
        let article_url = super::Url::parse(ARTICLE_URL).expect("article URL");
        let html = r#"
            <html><head>
                <meta property="og:image" content="/placeholder.svg">
                <meta property="og:image" content="../images/cover.webp">
                <meta name="twitter:image" content="https://cdn.example.test/fallback.jpg">
            </head></html>
        "#;
        let extracted = super::extract_og_image_from_html(html);
        let selected = extracted
            .candidates
            .iter()
            .find_map(|candidate| normalize_og_candidate(&article_url, &candidate.url));

        assert_eq!(
            selected.expect("valid canonical candidate").as_str(),
            "https://news.example.test/images/cover.webp"
        );
        assert!(normalize_og_candidate(&article_url, "javascript:alert(1)").is_none());
    }

    async fn call(app: &Router, method: Method, uri: &str) -> Response {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("router response")
    }

    async fn json_body(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), 1_048_576)
            .await
            .expect("response body");
        serde_json::from_slice(&bytes).expect("JSON response")
    }

    fn public_ip() -> std::net::IpAddr {
        "8.8.8.8".parse().expect("public fixture IP")
    }

    fn image_payload(bytes: impl Into<axum::body::Bytes>, content_type: &str) -> ImagePayload {
        ImagePayload {
            bytes: bytes.into(),
            content_type: content_type.to_owned(),
            final_url: IMAGE_URL.to_owned(),
            redirect_count: 0,
            resolved_addresses: vec![public_ip()],
        }
    }

    #[derive(Default)]
    struct FixtureCache {
        entries: Mutex<BTreeMap<String, ImageCacheEntry>>,
        fail_get: AtomicBool,
        fail_put: AtomicBool,
        fail_stats: AtomicBool,
        fail_clear: AtomicBool,
    }

    impl ImageCache for FixtureCache {
        fn get(&self, url: String) -> ImageCacheFuture<Option<ImageCacheEntry>> {
            let result = if self.fail_get.load(Ordering::SeqCst) {
                Err(ImageCacheError("fixture cache read failed".to_owned()))
            } else {
                Ok(self.entries.lock().expect("cache lock").get(&url).cloned())
            };
            Box::pin(async move { result })
        }

        fn put(&self, url: String, entry: ImageCacheEntry) -> ImageCacheFuture<()> {
            let result = if self.fail_put.load(Ordering::SeqCst) {
                Err(ImageCacheError("fixture cache write failed".to_owned()))
            } else {
                self.entries.lock().expect("cache lock").insert(url, entry);
                Ok(())
            };
            Box::pin(async move { result })
        }

        fn stats(&self) -> ImageCacheFuture<ImageCacheStats> {
            let result = if self.fail_stats.load(Ordering::SeqCst) {
                Err(ImageCacheError("fixture stats failed".to_owned()))
            } else {
                let entries = self.entries.lock().expect("cache lock");
                Ok(ImageCacheStats {
                    total_files: entries.len() as i64,
                    total_size_bytes: entries.values().map(|entry| entry.bytes.len() as i64).sum(),
                })
            };
            Box::pin(async move { result })
        }

        fn clear(&self) -> ImageCacheFuture<u64> {
            let result = if self.fail_clear.load(Ordering::SeqCst) {
                Err(ImageCacheError("fixture clear failed".to_owned()))
            } else {
                let mut entries = self.entries.lock().expect("cache lock");
                let count = entries.len() as u64;
                entries.clear();
                Ok(count)
            };
            Box::pin(async move { result })
        }
    }

    #[derive(Clone)]
    struct FixtureTransport {
        result: Result<ImagePayload, ImageTransportError>,
        requests: Arc<Mutex<Vec<ImageFetchRequest>>>,
    }

    impl FixtureTransport {
        fn new(result: Result<ImagePayload, ImageTransportError>) -> Self {
            Self {
                result,
                requests: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    impl ImageTransport for FixtureTransport {
        fn fetch(&self, request: ImageFetchRequest) -> ImageTransportFuture {
            self.requests
                .lock()
                .expect("transport requests")
                .push(request);
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }

    #[derive(Clone)]
    struct FixtureOgProvider {
        result: Result<Option<OgImagePayload>, ImageTransportError>,
        requests: Arc<Mutex<Vec<OgImageFetchRequest>>>,
    }

    impl FixtureOgProvider {
        fn new(result: Result<Option<OgImagePayload>, ImageTransportError>) -> Self {
            Self {
                result,
                requests: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    impl OgImageProvider for FixtureOgProvider {
        fn fetch(&self, request: OgImageFetchRequest) -> OgImageFuture {
            self.requests.lock().expect("OG requests").push(request);
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }

    #[derive(Clone)]
    struct JobHandle {
        job_id: String,
        generation: Generation,
        state: JobsImageState,
    }

    impl JobHandle {
        fn source_completed(&self, source: &str, count: usize, progress: JobProgress) {
            self.state
                .source_completed(
                    &self.job_id,
                    self.generation,
                    Some(source.to_owned()),
                    count,
                    json!({"name": source, "status": "ok"}),
                    progress,
                )
                .expect("source progress");
        }

        fn complete(&self) {
            self.state
                .complete_job_with_summary(
                    &self.job_id,
                    self.generation,
                    3,
                    json!([{"name": "fixture", "article_count": 3}]),
                )
                .expect("complete refresh");
        }

        fn fail(&self, detail: &str) {
            self.state
                .complete_job(&self.job_id, self.generation, Err(detail.to_owned()))
                .expect("fail refresh");
        }
    }

    #[derive(Default)]
    struct FixtureWorker {
        handle: Mutex<Option<JobHandle>>,
        launches: AtomicUsize,
    }

    impl FixtureWorker {
        fn handle(&self) -> JobHandle {
            self.handle
                .lock()
                .expect("worker handle")
                .clone()
                .expect("worker launched")
        }
    }

    impl RefreshJobWorker for FixtureWorker {
        fn launch(
            &self,
            job_id: String,
            generation: Generation,
            state: JobsImageState,
        ) -> Result<(), RefreshWorkerError> {
            self.launches.fetch_add(1, Ordering::SeqCst);
            *self.handle.lock().expect("worker handle") = Some(JobHandle {
                job_id,
                generation,
                state,
            });
            Ok(())
        }
    }

    fn test_state(
        worker: Option<Arc<FixtureWorker>>,
        transport: Option<Arc<FixtureTransport>>,
        og: Option<Arc<FixtureOgProvider>>,
        cache: Arc<FixtureCache>,
    ) -> JobsImageState {
        let mut state = JobsImageState::default().with_cache(cache);
        if let Some(worker) = worker {
            state = state.with_refresh_worker(worker);
        }
        if let Some(transport) = transport {
            state = state.with_image_transport(transport);
        }
        if let Some(og) = og {
            state = state.with_og_provider(og);
        }
        state
    }

    #[tokio::test]
    async fn refresh_status_and_sse_stream_progress_before_terminal_completion() {
        let worker = Arc::new(FixtureWorker::default());
        let state = test_state(
            Some(worker.clone()),
            None,
            None,
            Arc::new(FixtureCache::default()),
        );
        let app = app(state.clone());

        let started = call(&app, Method::POST, "/jobs/refresh").await;
        assert_eq!(started.status(), StatusCode::OK);
        let started = json_body(started).await;
        assert_eq!(started["status"], "started");
        let job_id = started["job_id"].as_str().expect("job id");
        let status_uri = format!("/jobs/{job_id}/status");

        let status = json_body(call(&app, Method::GET, &status_uri).await).await;
        assert_eq!(status["status"], "running");
        assert_eq!(status["progress"]["sources_completed"], 0);

        let already_running = json_body(call(&app, Method::POST, "/jobs/refresh").await).await;
        assert_eq!(already_running["status"], "already_running");
        assert_eq!(already_running["job_id"], job_id);
        assert_eq!(worker.launches.load(Ordering::SeqCst), 1);

        let stream_uri = format!("/jobs/{job_id}/stream");
        let stream_response = call(&app, Method::GET, &stream_uri).await;
        assert_eq!(stream_response.status(), StatusCode::OK);
        assert_eq!(
            stream_response.headers()["content-type"],
            "text/event-stream"
        );
        assert_eq!(stream_response.headers()["x-job-id"], job_id);
        let mut stream = stream_response.into_body().into_data_stream();

        let first = stream
            .next()
            .await
            .expect("initial SSE chunk")
            .expect("chunk");
        let first = String::from_utf8(first.to_vec()).expect("SSE UTF-8");
        assert!(first.starts_with("id: 1\nretry: 3000\ndata: "));
        assert!(first.contains(r#""status":"running""#));
        assert_eq!(
            json_body(call(&app, Method::GET, &status_uri).await).await["status"],
            "running"
        );

        let handle = worker.handle();
        handle.source_completed(
            "Wire fixture",
            2,
            JobProgress {
                sources_completed: 1,
                total_sources: 2,
                articles_fetched: 2,
            },
        );
        let progress = stream.next().await.expect("source event").expect("chunk");
        let progress = String::from_utf8(progress.to_vec()).expect("SSE UTF-8");
        assert!(progress.starts_with("id: 2\ndata: "));
        assert!(progress.contains(r#""type":"source_complete""#));
        assert!(progress.contains(r#""source":"Wire fixture""#));

        let status = json_body(call(&app, Method::GET, &status_uri).await).await;
        assert_eq!(status["progress"]["sources_completed"], 1);
        assert_eq!(status["progress"]["articles_fetched"], 2);
        handle.complete();

        let complete = stream.next().await.expect("complete event").expect("chunk");
        let complete = String::from_utf8(complete.to_vec()).expect("SSE UTF-8");
        assert!(complete.starts_with("id: 3\ndata: "));
        assert!(complete.contains(r#""type":"complete""#));
        assert!(complete.contains(r#""total_articles":3"#));
        assert!(stream.next().await.is_none());

        let status = json_body(call(&app, Method::GET, &status_uri).await).await;
        assert_eq!(status["status"], "complete");
    }

    #[tokio::test]
    async fn stream_keepalive_and_disconnect_release_subscription_without_canceling_job() {
        let worker = Arc::new(FixtureWorker::default());
        let state = test_state(
            Some(worker.clone()),
            None,
            None,
            Arc::new(FixtureCache::default()),
        )
        .with_test_keepalive(Duration::from_millis(5));
        let app = app(state.clone());
        let started = json_body(call(&app, Method::POST, "/jobs/refresh").await).await;
        let job_id = started["job_id"].as_str().expect("job id").to_owned();
        let response = call(&app, Method::GET, &format!("/jobs/{job_id}/stream")).await;
        let mut body = response.into_body().into_data_stream();

        let initial = body.next().await.expect("initial event").expect("chunk");
        assert!(String::from_utf8(initial.to_vec())
            .expect("SSE UTF-8")
            .contains(r#""status":"running""#));
        assert_eq!(
            state
                .lock()
                .jobs
                .get(&job_id)
                .expect("job")
                .subscribers
                .len(),
            1
        );
        let keepalive = tokio::time::timeout(Duration::from_secs(1), body.next())
            .await
            .expect("keepalive deadline")
            .expect("keepalive frame")
            .expect("keepalive body");
        assert_eq!(keepalive, b": keepalive\n\n"[..]);

        drop(body);
        assert_eq!(
            state
                .lock()
                .jobs
                .get(&job_id)
                .expect("job")
                .subscribers
                .len(),
            0
        );
        worker.handle().complete();
        let status =
            json_body(call(&app, Method::GET, &format!("/jobs/{job_id}/status")).await).await;
        assert_eq!(status["status"], "complete");
    }

    #[tokio::test]
    async fn image_proxy_uses_shared_cache_and_forwards_body_and_headers() {
        let expected_bytes = axum::body::Bytes::from_static(b"\x89PNG\r\nfixture");
        let transport = Arc::new(FixtureTransport::new(Ok(ImagePayload {
            bytes: expected_bytes.clone(),
            content_type: "image/png; charset=binary".to_owned(),
            final_url: IMAGE_URL.to_owned(),
            redirect_count: 0,
            resolved_addresses: vec![public_ip()],
        })));
        let cache = Arc::new(FixtureCache::default());
        let app = app(test_state(
            None,
            Some(transport.clone()),
            None,
            cache.clone(),
        ));

        let miss = call(&app, Method::GET, IMAGE_URI).await;
        assert_eq!(miss.status(), StatusCode::OK);
        assert_eq!(miss.headers()["content-type"], "image/png");
        assert_eq!(
            miss.headers()["cache-control"],
            "public, max-age=86400, stale-while-revalidate=3600"
        );
        assert_eq!(
            miss.headers()["content-length"],
            expected_bytes.len().to_string()
        );
        assert_eq!(miss.headers()["x-cache"], "MISS");
        assert!(!miss.headers().contains_key("x-cache-age"));
        let bytes = to_bytes(miss.into_body(), 1024).await.expect("image body");
        assert_eq!(bytes, expected_bytes);

        let hit = call(&app, Method::GET, IMAGE_URI).await;
        assert_eq!(hit.status(), StatusCode::OK);
        assert_eq!(hit.headers()["x-cache"], "HIT");
        assert_eq!(hit.headers()["x-cache-age"], "0");
        assert_eq!(
            to_bytes(hit.into_body(), 1024).await.expect("cached body"),
            expected_bytes
        );
        {
            // Release the guard before the next request reaches the transport.
            let requests = transport.requests.lock().expect("requests");
            assert_eq!(requests.len(), 1);
            let request = &requests[0];
            assert_eq!(request.url, IMAGE_URL);
            assert_eq!(request.timeout, Duration::from_secs(10));
            assert_eq!(request.max_redirects, 3);
            assert_eq!(request.max_bytes, MAX_IMAGE_SIZE);
            assert!(request.user_agent.contains("ScoopNewsBot"));
        }

        let stats = json_body(call(&app, Method::GET, "/image/cache/stats").await).await;
        assert_eq!(stats["total_files"], 1);
        assert_eq!(stats["total_size_bytes"], expected_bytes.len());
        assert_eq!(stats["max_age_seconds"], 86_400);

        let cleared = json_body(call(&app, Method::DELETE, "/image/cache/clear").await).await;
        assert_eq!(cleared["cleared"], 2);
        assert_eq!(cleared["message"], "Cleared 2 cached files");
        assert!(cache.entries.lock().expect("cache entries").is_empty());
        assert_eq!(
            json_body(call(&app, Method::GET, "/image/cache/stats").await).await["total_files"],
            0
        );
        let after_clear = call(&app, Method::GET, IMAGE_URI).await;
        assert_eq!(after_clear.headers()["x-cache"], "MISS");
        assert_eq!(transport.requests.lock().expect("requests").len(), 2);
    }

    #[tokio::test]
    async fn cache_read_failure_falls_through_but_stats_and_clear_report_database_errors() {
        let transport = Arc::new(FixtureTransport::new(Ok(image_payload(
            axum::body::Bytes::from_static(b"image"),
            "image/png",
        ))));
        let cache = Arc::new(FixtureCache::default());
        cache.fail_get.store(true, Ordering::SeqCst);
        cache.fail_stats.store(true, Ordering::SeqCst);
        cache.fail_clear.store(true, Ordering::SeqCst);
        let app = app(test_state(None, Some(transport), None, cache));

        let proxy = call(&app, Method::GET, IMAGE_URI).await;
        assert_eq!(proxy.status(), StatusCode::OK);
        assert_eq!(proxy.headers()["x-cache"], "MISS");
        let stats_response = call(&app, Method::GET, "/image/cache/stats").await;
        assert_eq!(stats_response.status(), StatusCode::OK);
        assert_eq!(
            json_body(stats_response).await["error"],
            "fixture stats failed"
        );
        let clear_response = call(&app, Method::DELETE, "/image/cache/clear").await;
        assert_eq!(clear_response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            json_body(clear_response).await["detail"],
            "fixture clear failed"
        );
    }

    #[tokio::test]
    async fn proxy_and_og_preserve_timeout_error_and_metadata_boundaries() {
        let timeout_transport = Arc::new(FixtureTransport::new(Err(ImageTransportError::Timeout)));
        let cache = Arc::new(FixtureCache::default());
        let timeout_app = app(test_state(
            None,
            Some(timeout_transport),
            None,
            cache.clone(),
        ));
        let timeout = call(&timeout_app, Method::GET, IMAGE_URI).await;
        assert_eq!(timeout.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(json_body(timeout).await["detail"], "IMAGE_FETCH_TIMEOUT");

        let http_error_app = app(test_state(
            None,
            Some(Arc::new(FixtureTransport::new(Err(
                ImageTransportError::HttpStatus(503),
            )))),
            None,
            cache.clone(),
        ));
        let http_error = call(&http_error_app, Method::GET, IMAGE_URI).await;
        assert_eq!(http_error.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            json_body(http_error).await["detail"],
            "IMAGE_FETCH_FAILED: HTTP 503"
        );

        let unsafe_app = app(test_state(
            None,
            Some(Arc::new(FixtureTransport::new(Err(
                ImageTransportError::UnsafeUrl(
                    "IMAGE_UNSAFE_URL: private or reserved address rejected".to_owned(),
                ),
            )))),
            None,
            cache.clone(),
        ));
        let unsafe_response = call(&unsafe_app, Method::GET, IMAGE_URI).await;
        assert_eq!(unsafe_response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(unsafe_response).await["detail"],
            "IMAGE_UNSAFE_URL: private or reserved address rejected"
        );

        let too_large_app = app(test_state(
            None,
            Some(Arc::new(FixtureTransport::new(Err(
                ImageTransportError::TooLarge(MAX_IMAGE_SIZE + 1),
            )))),
            None,
            cache.clone(),
        ));
        let too_large = call(&too_large_app, Method::GET, IMAGE_URI).await;
        assert_eq!(too_large.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(too_large).await["detail"],
            format!(
                "IMAGE_TOO_LARGE: {} bytes exceeds {}",
                MAX_IMAGE_SIZE + 1,
                MAX_IMAGE_SIZE
            )
        );

        let unsupported_app = app(test_state(
            None,
            Some(Arc::new(FixtureTransport::new(Err(
                ImageTransportError::UnsupportedContentType("text/html".to_owned()),
            )))),
            None,
            cache.clone(),
        ));
        let unsupported = call(&unsupported_app, Method::GET, IMAGE_URI).await;
        assert_eq!(unsupported.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(unsupported).await["detail"],
            "IMAGE_UNSUPPORTED_TYPE: text/html"
        );

        let no_image_app = app(test_state(
            None,
            None,
            Some(Arc::new(FixtureOgProvider::new(Ok(None)))),
            cache.clone(),
        ));
        let no_image = call(&no_image_app, Method::GET, ARTICLE_URI).await;
        assert_eq!(no_image.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            json_body(no_image).await["detail"],
            "No OpenGraph image found"
        );

        let image_url = "https://cdn.example.test/image.png";
        let og = Arc::new(FixtureOgProvider::new(Ok(Some(OgImagePayload {
            image_url: image_url.to_owned(),
            article_trace: FetchTrace {
                final_url: ARTICLE_URL.to_owned(),
                redirect_count: 0,
                resolved_addresses: vec![public_ip()],
            },
            image_trace: FetchTrace {
                final_url: image_url.to_owned(),
                redirect_count: 1,
                resolved_addresses: vec![public_ip()],
            },
        }))));
        let og_app = app(test_state(None, None, Some(og.clone()), cache));
        let found = call(&og_app, Method::GET, ARTICLE_URI).await;
        assert_eq!(found.status(), StatusCode::OK);
        assert_eq!(json_body(found).await["image_url"], image_url);
        let requests = og.requests.lock().expect("OG requests");
        let request = &requests[0];
        assert_eq!(request.article_url, ARTICLE_URL);
        assert_eq!(request.timeout, Duration::from_secs(10));
        assert_eq!(request.max_bytes, 100_000);
    }

    #[tokio::test]
    async fn job_worker_failure_is_exposed_as_error_status_and_terminal_stream_event() {
        let worker = Arc::new(FixtureWorker::default());
        let app = app(test_state(
            Some(worker.clone()),
            None,
            None,
            Arc::new(FixtureCache::default()),
        ));
        let started = json_body(call(&app, Method::POST, "/jobs/refresh").await).await;
        let job_id = started["job_id"].as_str().expect("job id").to_owned();
        worker.handle().fail("fixture refresh failed");

        let status =
            json_body(call(&app, Method::GET, &format!("/jobs/{job_id}/status")).await).await;
        assert_eq!(status["status"], "error");
        assert_eq!(status["error"], "fixture refresh failed");

        let response = call(&app, Method::GET, &format!("/jobs/{job_id}/stream")).await;
        let mut stream = response.into_body().into_data_stream();
        let initial = stream.next().await.expect("initial event").expect("chunk");
        assert!(String::from_utf8(initial.to_vec())
            .expect("SSE UTF-8")
            .contains(r#""status":"error""#));
        let error = stream.next().await.expect("error event").expect("chunk");
        let error = String::from_utf8(error.to_vec()).expect("SSE UTF-8");
        assert!(error.starts_with("id: 2\ndata: "));
        assert!(error.contains(r#""type":"error""#));
        assert!(error.contains("fixture refresh failed"));
        assert!(stream.next().await.is_none());
    }

    #[tokio::test]
    async fn bounded_job_event_history_reports_overrun_instead_of_silently_dropping_progress() {
        let worker = Arc::new(FixtureWorker::default());
        let state = test_state(
            Some(worker.clone()),
            None,
            None,
            Arc::new(FixtureCache::default()),
        );
        let app = app(state.clone());
        let started = json_body(call(&app, Method::POST, "/jobs/refresh").await).await;
        let job_id = started["job_id"].as_str().expect("job id").to_owned();
        let handle = worker.handle();
        for completed in 1..=(MAX_JOB_EVENTS as u64 + 1) {
            state
                .update_progress(
                    &job_id,
                    handle.generation,
                    JobProgress {
                        sources_completed: completed,
                        total_sources: 0,
                        articles_fetched: completed,
                    },
                )
                .expect("monotonic progress");
        }
        assert_eq!(
            state.lock().jobs.get(&job_id).expect("job").events.len(),
            MAX_JOB_EVENTS
        );

        let response = call(&app, Method::GET, &format!("/jobs/{job_id}/stream")).await;
        let mut stream = response.into_body().into_data_stream();
        assert!(stream.next().await.expect("initial event").is_ok());
        let error = stream.next().await.expect("overrun event").expect("chunk");
        let error = String::from_utf8(error.to_vec()).expect("SSE UTF-8");
        assert!(error.contains(r#""type":"error""#));
        assert!(error.contains("history exceeded its retention limit"));
        assert!(stream.next().await.is_none());
    }

    #[tokio::test]
    async fn image_proxy_rejects_private_addresses_and_oversized_or_non_image_payloads() {
        let private = call(
            &app(JobsImageState::default()),
            Method::GET,
            "/image/proxy?url=http%3A%2F%2F127.0.0.1%2Fprivate",
        )
        .await;
        assert_eq!(private.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(private).await["detail"],
            "IP-literal URL hosts are not accepted"
        );

        let cache = Arc::new(FixtureCache::default());
        let oversized = ImagePayload {
            bytes: axum::body::Bytes::from(vec![b'x'; MAX_IMAGE_SIZE + 1]),
            content_type: "image/png".to_owned(),
            final_url: IMAGE_URL.to_owned(),
            redirect_count: 0,
            resolved_addresses: vec![public_ip()],
        };
        let oversized_app = app(test_state(
            None,
            Some(Arc::new(FixtureTransport::new(Ok(oversized)))),
            None,
            cache.clone(),
        ));
        let oversized_response = call(&oversized_app, Method::GET, IMAGE_URI).await;
        assert_eq!(oversized_response.status(), StatusCode::BAD_REQUEST);
        assert!(json_body(oversized_response).await["detail"]
            .as_str()
            .expect("error detail")
            .starts_with("IMAGE_TOO_LARGE:"));

        let html_app = app(test_state(
            None,
            Some(Arc::new(FixtureTransport::new(Ok(image_payload(
                axum::body::Bytes::from_static(b"<html></html>"),
                "text/html",
            ))))),
            None,
            cache,
        ));
        let html_response = call(&html_app, Method::GET, IMAGE_URI).await;
        assert_eq!(html_response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(html_response).await["detail"],
            "IMAGE_UNSUPPORTED_TYPE: text/html"
        );
    }
    #[tokio::test]
    async fn missing_shared_cache_is_not_silently_replaced_by_process_local_state() {
        let response = call(
            &app(JobsImageState::default()),
            Method::GET,
            "/image/cache/stats",
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            json_body(response).await["detail"],
            "Image cache is not available"
        );
    }
}
