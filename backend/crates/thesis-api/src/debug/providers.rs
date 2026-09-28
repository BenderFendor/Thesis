use std::path::PathBuf;

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;
pub use thesis_search::country_mentions::CountryAliases;

#[derive(Clone)]
pub struct DebugConfig {
    pub debug_log_directory: PathBuf,
    /// Exact per-process session directory; its log files are stored directly here.
    pub session_log_directory: PathBuf,
    pub rss_sources: Arc<BTreeMap<String, Value>>,
    pub debug_mode: bool,
    pub enable_database: bool,
    pub enable_incremental_cache: bool,
    pub embedding_batch_size: usize,
    pub embedding_max_per_minute: usize,
    pub chroma_host: Option<String>,
    pub chroma_port: Option<u16>,
}

impl DebugConfig {
    #[cfg(test)]
    pub(crate) fn for_test(log_directory: impl Into<PathBuf>) -> Self {
        let log_directory = log_directory.into();
        Self {
            debug_log_directory: log_directory.clone(),
            session_log_directory: log_directory,
            rss_sources: Arc::new(BTreeMap::new()),
            debug_mode: false,
            enable_database: true,
            enable_incremental_cache: false,
            embedding_batch_size: 0,
            embedding_max_per_minute: 0,
            chroma_host: None,
            chroma_port: None,
        }
    }
}

pub type DebugFuture<T> = Pin<Box<dyn Future<Output = Result<T, DebugProviderError>> + Send>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DebugProviderError {
    Unavailable,
    Failed(String),
}

#[derive(Clone, Debug)]
pub struct DebugRuntimeSnapshot {
    pub pipeline_metrics: Value,
    pub streams: DebugStreamsSnapshot,
    pub logger: DebugLoggerSnapshot,
    pub jobs: BTreeMap<String, Value>,
    pub update_subscribers: DebugUpdateSubscribers,
    pub embedding_queue_depth: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct DebugStreamsSnapshot {
    pub active_streams: u64,
    pub total_streams_created: u64,
    pub streams: BTreeMap<String, Value>,
    pub source_throttling: BTreeMap<String, Value>,
    pub stream_manager_streams: BTreeMap<String, Value>,
}

#[derive(Clone, Debug)]
pub struct DebugLoggerSnapshot {
    pub session_id: String,
    pub events: Vec<Value>,
    pub active_streams: BTreeMap<String, Value>,
    pub active_requests: u64,
    pub slow_operations: Vec<Value>,
    pub performance_summary: Value,
    pub frontend_reports: Vec<Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DebugUpdateSubscribers {
    pub subscriber_count: u64,
    pub total_events_sent: u64,
}

/// Shared application-side observation for state that Rust does not own.
///
/// Implementations must read the same logger, stream manager, jobs registry,
/// update subscribers, and pipeline counters used by the application routes.
/// The event vector must be the bounded recent-event window in insertion order
/// and include every debug event type, not only frontend report ingestion. An
/// implementation that cannot read one of these stores must return
/// `DebugProviderError::Unavailable` instead of fabricating an empty value.
pub trait DebugRuntimeProvider: Send + Sync {
    fn snapshot(&self) -> DebugFuture<DebugRuntimeSnapshot>;
}

#[derive(Clone, Debug)]
pub struct ParsedFeed {
    pub source_stats: BTreeMap<String, Value>,
    pub articles: Vec<BTreeMap<String, Value>>,
}

#[derive(Clone, Debug)]
pub struct InspectedSourceFeed {
    pub raw_feed: String,
    pub parsed: ParsedFeed,
}

#[derive(Clone, Debug)]
pub struct ArticleImageParseResult {
    pub image_url: Option<String>,
    pub candidates: Vec<Value>,
    pub error: Option<String>,
    pub error_details: Option<String>,
}

/// Feed and article extraction boundary. It owns HTTP, Rust RSS parsing, and
/// OpenGraph candidate extraction; handlers own FastAPI response projection.
pub trait DebugParsingProvider: Send + Sync {
    fn inspect_source(
        &self,
        source_name: String,
        rss_url: String,
    ) -> DebugFuture<InspectedSourceFeed>;
    fn parse_feed(&self, url: String, workers: usize) -> DebugFuture<ParsedFeed>;
    fn parse_article(&self, url: String) -> DebugFuture<ArticleImageParseResult>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MissingImageArticle {
    pub id: i64,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageBackfillResult {
    /// Every requested article id must be present. `None` means extraction
    /// failed and the Python contract persists the literal `none` marker.
    pub image_by_article_id: BTreeMap<i64, Option<String>>,
}

/// OG-image adapter for backfill. Implementations preserve the service's cache,
/// timeout, per-domain concurrency, and failure-to-`none` semantics. Cache
/// updates target the same live article cache used by application routes.
pub trait DebugImageBackfillProvider: Send + Sync {
    fn fetch_batch(&self, articles: Vec<MissingImageArticle>) -> DebugFuture<ImageBackfillResult>;
    /// Apply only successful image URLs; failed rows are marked `none` in the
    /// database but are not written into the live cache.
    fn update_cached_images(
        &self,
        updated_images: &BTreeMap<i64, String>,
    ) -> Result<(), DebugProviderError>;
}

/// Dynamic process log-level controller shared with the server's logger setup.
pub trait DebugLogLevelProvider: Send + Sync {
    fn current_level(&self) -> Result<String, DebugProviderError>;
    fn set_level(&self, level: &str) -> Result<(), DebugProviderError>;
}

#[derive(Clone, Default)]
pub struct DebugProviders {
    pub runtime: Option<Arc<dyn DebugRuntimeProvider>>,
    pub parsing: Option<Arc<dyn DebugParsingProvider>>,
    pub image_backfill: Option<Arc<dyn DebugImageBackfillProvider>>,
    pub log_level: Option<Arc<dyn DebugLogLevelProvider>>,
    pub country_aliases: Option<Arc<CountryAliases>>,
    pub chroma: Option<Arc<crate::chroma::ChromaClient>>,
}
