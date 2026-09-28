use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::io::{Cursor, Read};
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, NaiveDateTime, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use thesis_db::GdeltEventRecord;
use thesis_ingest::gdelt::parse_gdelt_tsv;
pub use thesis_ingest::gdelt::GdeltRecord;
use utoipa::openapi::schema::{AdditionalProperties, ArrayBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};
use zip::{CompressionMethod, ZipArchive};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

/// Maximum count accepted by the GDELT sync route and export parser.
pub const MAX_GDELT_SYNC_EVENT_LIMIT: usize = 1_000;
/// Maximum compressed archive size accepted; fetchers enforce it while streaming.
pub const MAX_GDELT_EXPORT_ARCHIVE_BYTES: usize = 32 * 1024 * 1024;
/// Maximum number of central-directory entries accepted in a GDELT export.
pub const MAX_GDELT_EXPORT_ENTRIES: usize = 16;
/// Maximum uncompressed CSV/TSV bytes read from one GDELT export entry.
pub const MAX_GDELT_EXPORT_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

// Headerless GDELT event rows use this 58-column order. The first generated
// header field uses the spelling expected by the shared ingest parser.
const GDELT_EXPORT_FIELD_COUNT: usize = 58;
const GDELT_EXPORT_COLUMNS: [&str; GDELT_EXPORT_FIELD_COUNT] = [
    "GlobalEventID",
    "SQLDATE",
    "MonthYear",
    "Year",
    "FractionDate",
    "Actor1Code",
    "Actor1Name",
    "Actor1CountryCode",
    "Actor1KnownGroupCode",
    "Actor1EthnicCode",
    "Actor1Religion1Code",
    "Actor1Religion2Code",
    "Actor1Type1Code",
    "Actor1Type2Code",
    "Actor1Type3Code",
    "Actor2Code",
    "Actor2Name",
    "Actor2CountryCode",
    "Actor2KnownGroupCode",
    "Actor2EthnicCode",
    "Actor2Religion1Code",
    "Actor2Religion2Code",
    "Actor2Type1Code",
    "Actor2Type2Code",
    "Actor2Type3Code",
    "IsRootEvent",
    "EventCode",
    "EventBaseCode",
    "EventRootCode",
    "QuadClass",
    "GoldsteinScale",
    "NumMentions",
    "NumSources",
    "NumArticles",
    "AvgTone",
    "Actor1Geo_Type",
    "Actor1Geo_FullName",
    "Actor1Geo_CountryCode",
    "Actor1Geo_ADM1Code",
    "Actor1Geo_Lat",
    "Actor1Geo_Long",
    "Actor1Geo_FeatureID",
    "Actor2Geo_Type",
    "Actor2Geo_FullName",
    "Actor2Geo_CountryCode",
    "Actor2Geo_ADM1Code",
    "Actor2Geo_Lat",
    "Actor2Geo_Long",
    "Actor2Geo_FeatureID",
    "ActionGeo_Type",
    "ActionGeo_FullName",
    "ActionGeo_CountryCode",
    "ActionGeo_ADM1Code",
    "ActionGeo_Lat",
    "ActionGeo_Long",
    "ActionGeo_FeatureID",
    "DATEADDED",
    "SOURCEURL",
];

/// Rejection reason for malformed, oversized, or unsupported GDELT exports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GdeltExportParseError {
    InvalidLimit,
    ArchiveTooLarge {
        max_bytes: usize,
    },
    TooManyArchiveEntries {
        max_entries: usize,
    },
    InvalidArchive(String),
    MissingExportEntry,
    MultipleDataEntries,
    UnexpectedEntryName,
    UnsupportedCompression,
    EntryTooLarge {
        max_bytes: u64,
    },
    EntryRead(String),
    EntrySizeMismatch,
    InvalidUtf8,
    UnexpectedHeader,
    InvalidRowFieldCount {
        line: usize,
        expected: usize,
        actual: usize,
    },
}

impl fmt::Display for GdeltExportParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLimit => write!(
                formatter,
                "event limit must be between 1 and {MAX_GDELT_SYNC_EVENT_LIMIT}"
            ),
            Self::ArchiveTooLarge { max_bytes } => {
                write!(
                    formatter,
                    "compressed GDELT archive exceeds {max_bytes} bytes"
                )
            }
            Self::TooManyArchiveEntries { max_entries } => {
                write!(formatter, "GDELT archive exceeds {max_entries} entries")
            }
            Self::InvalidArchive(detail) => {
                write!(formatter, "invalid GDELT ZIP archive: {detail}")
            }
            Self::MissingExportEntry => {
                formatter.write_str("GDELT archive contains no export CSV entry")
            }
            Self::MultipleDataEntries => {
                formatter.write_str("GDELT archive contains multiple data entries")
            }
            Self::UnexpectedEntryName => {
                formatter.write_str("GDELT archive contains an unexpected data entry")
            }
            Self::UnsupportedCompression => {
                formatter.write_str("GDELT export entry uses unsupported compression")
            }
            Self::EntryTooLarge { max_bytes } => {
                write!(
                    formatter,
                    "uncompressed GDELT entry exceeds {max_bytes} bytes"
                )
            }
            Self::EntryRead(detail) => {
                write!(formatter, "failed reading GDELT ZIP entry: {detail}")
            }
            Self::EntrySizeMismatch => {
                formatter.write_str("GDELT ZIP entry size does not match its declared size")
            }
            Self::UnexpectedHeader => {
                formatter.write_str("GDELT export unexpectedly contains a header row")
            }
            Self::InvalidRowFieldCount {
                line,
                expected,
                actual,
            } => write!(
                formatter,
                "GDELT row {line} has {actual} fields; expected {expected}"
            ),
        }
    }
}

impl std::error::Error for GdeltExportParseError {}

/// Read and parse the single `.export.CSV` entry from a bounded GDELT ZIP.
///
/// The source entry is headerless. This helper adds names for its 58 columns,
/// maps `GLOBALEVENTID` to the shared parser's `GlobalEventID`, and adds only
/// an empty `DocumentIdentifier` field before delegating row parsing.
pub fn parse_gdelt_export_zip(
    archive_bytes: &[u8],
    limit: usize,
) -> Result<Vec<GdeltRecord>, GdeltExportParseError> {
    parse_gdelt_export_zip_with_limits(
        archive_bytes,
        limit,
        MAX_GDELT_EXPORT_ARCHIVE_BYTES,
        MAX_GDELT_EXPORT_ENTRY_BYTES,
        MAX_GDELT_EXPORT_ENTRIES,
    )
}

fn parse_gdelt_export_zip_with_limits(
    archive_bytes: &[u8],
    limit: usize,
    max_archive_bytes: usize,
    max_entry_bytes: u64,
    max_archive_entries: usize,
) -> Result<Vec<GdeltRecord>, GdeltExportParseError> {
    if limit == 0 || limit > MAX_GDELT_SYNC_EVENT_LIMIT {
        return Err(GdeltExportParseError::InvalidLimit);
    }
    if archive_bytes.len() > max_archive_bytes {
        return Err(GdeltExportParseError::ArchiveTooLarge {
            max_bytes: max_archive_bytes,
        });
    }

    let mut archive = ZipArchive::new(Cursor::new(archive_bytes))
        .map_err(|error| GdeltExportParseError::InvalidArchive(error.to_string()))?;
    if archive.len() > max_archive_entries {
        return Err(GdeltExportParseError::TooManyArchiveEntries {
            max_entries: max_archive_entries,
        });
    }

    let mut export_index = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| GdeltExportParseError::InvalidArchive(error.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        if !entry.is_file() || !is_gdelt_export_entry_name(entry.name()) {
            return Err(GdeltExportParseError::UnexpectedEntryName);
        }
        if export_index.replace(index).is_some() {
            return Err(GdeltExportParseError::MultipleDataEntries);
        }
    }
    let export_index = export_index.ok_or(GdeltExportParseError::MissingExportEntry)?;
    let mut entry = archive
        .by_index(export_index)
        .map_err(|error| GdeltExportParseError::InvalidArchive(error.to_string()))?;
    let declared_size = entry.size();
    if declared_size > max_entry_bytes {
        return Err(GdeltExportParseError::EntryTooLarge {
            max_bytes: max_entry_bytes,
        });
    }
    if !matches!(
        entry.compression(),
        CompressionMethod::Stored | CompressionMethod::Deflated
    ) {
        return Err(GdeltExportParseError::UnsupportedCompression);
    }

    let capacity =
        usize::try_from(declared_size).map_err(|_| GdeltExportParseError::EntryTooLarge {
            max_bytes: max_entry_bytes,
        })?;
    let mut content = Vec::with_capacity(capacity);
    entry
        .take(max_entry_bytes.saturating_add(1))
        .read_to_end(&mut content)
        .map_err(|error| GdeltExportParseError::EntryRead(error.to_string()))?;
    let actual_size = u64::try_from(content.len()).unwrap_or(u64::MAX);
    if actual_size > max_entry_bytes {
        return Err(GdeltExportParseError::EntryTooLarge {
            max_bytes: max_entry_bytes,
        });
    }
    if actual_size != declared_size {
        return Err(GdeltExportParseError::EntrySizeMismatch);
    }

    let content = String::from_utf8(content).map_err(|_| GdeltExportParseError::InvalidUtf8)?;
    let normalized = headerless_export_for_parser(&content)?;
    Ok(parse_gdelt_tsv(&normalized, limit))
}

fn headerless_export_for_parser(tsv: &str) -> Result<String, GdeltExportParseError> {
    let tsv = tsv.strip_prefix('\u{feff}').unwrap_or(tsv);
    if tsv
        .lines()
        .next()
        .and_then(|line| line.split('\t').next())
        .is_some_and(|first_column| first_column.eq_ignore_ascii_case("GLOBALEVENTID"))
    {
        return Err(GdeltExportParseError::UnexpectedHeader);
    }

    let header_bytes = GDELT_EXPORT_COLUMNS
        .iter()
        .map(|column| column.len())
        .sum::<usize>()
        + GDELT_EXPORT_COLUMNS.len()
        + "DocumentIdentifier".len()
        + 1;
    let row_count = tsv.lines().count();
    let mut normalized = String::with_capacity(tsv.len() + header_bytes + row_count + 1);
    for (index, column) in GDELT_EXPORT_COLUMNS.iter().enumerate() {
        if index > 0 {
            normalized.push('\t');
        }
        normalized.push_str(column);
    }
    normalized.push_str("\tDocumentIdentifier\n");

    for (index, row) in tsv.lines().enumerate() {
        if row.is_empty() {
            continue;
        }
        let actual = row.split('\t').count();
        if actual != GDELT_EXPORT_FIELD_COUNT {
            return Err(GdeltExportParseError::InvalidRowFieldCount {
                line: index + 1,
                expected: GDELT_EXPORT_FIELD_COUNT,
                actual,
            });
        }
        normalized.push_str(row);
        normalized.push_str("\t\n");
    }
    Ok(normalized)
}

fn is_gdelt_export_entry_name(name: &str) -> bool {
    // Live lastupdate entries use timestamps; retain legacy daily export names.
    let Some(date_or_timestamp) = name.strip_suffix(".export.CSV") else {
        return false;
    };

    matches!(date_or_timestamp.len(), 8 | 14)
        && date_or_timestamp.bytes().all(|byte| byte.is_ascii_digit())
}

/// Future returned by an integration that fetches, matches, and persists GDELT events.
pub type GdeltSyncFuture<T> = Pin<Box<dyn Future<Output = Result<T, GdeltSyncError>> + Send>>;

/// Failure while syncing the external GDELT feed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GdeltSyncError {
    /// No live provider or persistent database integration is configured.
    Unavailable,
    /// A configured fetch, match, or persistence operation failed.
    Failed(String),
}

/// Counts returned only after one GDELT sync batch has been persisted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GdeltSyncResult {
    pub matched: i64,
    pub total: i64,
}

/// Integration boundary for the GDELT last-update export and persistent matching.
/// Implementations must read the GDELT v2 `lastupdate.txt` export listing, pass
/// each `.export.CSV.zip` body through [`parse_gdelt_export_zip`], match by URL
/// before vector similarity, and persist each `gdelt_id` idempotently. A
/// successful result may be returned only after the database transaction commits.
pub trait GdeltSyncProvider: Send + Sync {
    fn sync(&self, minutes: i64, limit: i64) -> GdeltSyncFuture<GdeltSyncResult>;
}

/// Optional live GDELT integration supplied by the module router owner.
#[derive(Clone, Default)]
pub struct GdeltSyncState {
    provider: Option<Arc<dyn GdeltSyncProvider>>,
}

impl GdeltSyncState {
    /// Build a state with a provider that can fetch and persist events.
    pub fn with_provider(provider: impl GdeltSyncProvider + 'static) -> Self {
        Self {
            provider: Some(Arc::new(provider)),
        }
    }

    /// Build a state where GDELT sync is explicitly unavailable.
    pub fn unavailable() -> Self {
        Self::default()
    }

    /// Whether a live sync provider is attached; this does not probe its dependencies.
    pub fn is_configured(&self) -> bool {
        self.provider.is_some()
    }
}
#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct GdeltArticleQueryParameters {
    #[param(minimum = 1, maximum = 200, default = 50)]
    limit: Option<i64>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct GdeltStatsQueryParameters {
    #[param(minimum = 1, maximum = 168, default = 24)]
    hours: Option<i64>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct GdeltRecentQueryParameters {
    #[param(minimum = 1, maximum = 200, default = 50)]
    limit: Option<i64>,
    /// Include events not matched to clusters.
    #[param(default = false)]
    include_unmatched: Option<bool>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
#[expect(
    dead_code,
    reason = "OpenAPI metadata; handlers preserve raw query parsing"
)]
struct GdeltSyncQueryParameters {
    #[param(minimum = 1, maximum = 60, default = 15)]
    minutes: Option<i64>,
    #[param(minimum = 1, maximum = 1000, default = 250)]
    limit: Option<i64>,
}

/// OpenAPI marker for the dynamically shaped GDELT object responses.
#[derive(Debug)]
pub(crate) struct GdeltObjectSchema;

impl PartialSchema for GdeltObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for GdeltObjectSchema {}

/// OpenAPI marker for a list of dynamically shaped GDELT event objects.
#[derive(Debug)]
pub(crate) struct GdeltEventListSchema;

impl PartialSchema for GdeltEventListSchema {
    fn schema() -> RefOr<Schema> {
        ArrayBuilder::new()
            .items(
                ObjectBuilder::new()
                    .schema_type(Type::Object)
                    .additional_properties(Some(AdditionalProperties::FreeForm(true)))
                    .build(),
            )
            .build()
            .into()
    }
}

impl ToSchema for GdeltEventListSchema {}

#[derive(Clone, Debug, Serialize)]
struct GdeltArticleEventResponse {
    id: i64,
    gdelt_id: String,
    url: Option<String>,
    title: Option<String>,
    source: Option<String>,
    published_at: Option<String>,
    event_code: Option<String>,
    event_root_code: Option<String>,
    actor1_name: Option<String>,
    actor2_name: Option<String>,
    tone: Option<f64>,
    goldstein_scale: Option<f64>,
    match_method: Option<String>,
    similarity_score: Option<f64>,
    matched_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct GdeltArticleResponse {
    article_id: i32,
    total_external_events: i64,
    events: Vec<GdeltArticleEventResponse>,
}

/// Build the GDELT endpoints with an explicitly configured or unavailable sync provider.
pub(crate) fn router(sync_state: GdeltSyncState) -> Router<AppState> {
    Router::new()
        .merge(sync_router(sync_state))
        .route("/gdelt/article/{article_id}", get(get_article_gdelt_events))
        .route("/gdelt/stats", get(get_gdelt_stats))
        .route("/gdelt/recent", get(get_recent_gdelt_events))
}

fn sync_router(sync_state: GdeltSyncState) -> Router<AppState> {
    Router::new()
        .route("/gdelt/sync", post(trigger_gdelt_sync))
        .layer(Extension(sync_state))
}

#[utoipa::path(
    post,
    path = "/gdelt/sync",
    operation_id = "trigger_gdelt_sync_gdelt_sync_post",
    tag = "gdelt",
    summary = "Trigger Gdelt Sync",
    description = "Fetch, match, and persist recent GDELT events.",
    params(GdeltSyncQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = inline(GdeltObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn trigger_gdelt_sync(
    Extension(state): Extension<GdeltSyncState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let minutes = match parse_integer_query(&params, "minutes", 15, 1, 60) {
        Ok(minutes) => minutes,
        Err(error) => return error.into_response(),
    };
    let limit =
        match parse_integer_query(&params, "limit", 250, 1, MAX_GDELT_SYNC_EVENT_LIMIT as i64) {
            Ok(limit) => limit,
            Err(error) => return error.into_response(),
        };

    let Some(provider) = state.provider else {
        return gdelt_sync_unavailable();
    };
    match provider.sync(minutes, limit).await {
        Ok(result) if result.matched >= 0 && result.matched <= result.total => Json(json!({
            "success": true,
            "matched": result.matched,
            "total": result.total,
            "window_minutes": minutes,
            "timestamp": Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string(),
        }))
        .into_response(),
        Ok(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"detail": "GDELT sync failed: provider returned invalid counts"})),
        )
            .into_response(),
        Err(GdeltSyncError::Unavailable) => gdelt_sync_unavailable(),
        Err(GdeltSyncError::Failed(detail)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"detail": format!("GDELT sync failed: {detail}")})),
        )
            .into_response(),
    }
}

fn gdelt_sync_unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": "GDELT sync provider is not available"})),
    )
        .into_response()
}
#[derive(Clone, Debug, Serialize)]
struct GdeltTopArticleResponse {
    article_id: i64,
    gdelt_event_count: i64,
}

#[derive(Clone, Debug, Serialize)]
struct GdeltStatsResponse {
    window_hours: i64,
    total_events: i64,
    matched_events: i64,
    match_rate: f64,
    match_breakdown: GdeltMatchBreakdownResponse,
    top_articles_by_coverage: Vec<GdeltTopArticleResponse>,
}

#[derive(Clone, Debug, Serialize)]
struct GdeltMatchBreakdownResponse {
    url_match: i64,
    embedding_match: i64,
}

#[derive(Clone, Debug, Serialize)]
struct GdeltRecentEventResponse {
    id: i64,
    gdelt_id: String,
    url: Option<String>,
    title: Option<String>,
    source: Option<String>,
    published_at: Option<String>,
    event_code: Option<String>,
    tone: Option<f64>,
    article_id: Option<i64>,
    match_method: Option<String>,
    created_at: Option<String>,
}

#[utoipa::path(
    get,
    path = "/gdelt/article/{article_id}",
    operation_id = "get_article_gdelt_events_gdelt_article__article_id__get",
    tag = "gdelt",
    summary = "Get Article Gdelt Events",
    description = "Get GDELT events matched to a specific article.\n\nArgs:\n    article_id: Article ID to query\n    limit: Maximum events to return\n    session: Database session\n\nReturns:\n    Cluster info with matched GDELT events",
    params(
        ("article_id" = i32, Path, description = "Article ID to query"),
        GdeltArticleQueryParameters
    ),
    responses(
        (status = 200, description = "Successful Response", body = inline(GdeltObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_article_gdelt_events(
    State(state): State<AppState>,
    Path(raw_article_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let article_id = match raw_article_id.trim().parse::<i32>() {
        Ok(article_id) => article_id,
        Err(_) => {
            return parameter_error(
                "path",
                "article_id",
                Value::String(raw_article_id),
                "int_parsing",
                "Input should be a valid integer, unable to parse string as an integer",
                None,
            )
            .into_response();
        }
    };
    let limit = match parse_integer_query(&params, "limit", 50, 1, 200) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };

    match state
        .database
        .list_article_gdelt_events(article_id, limit)
        .await
    {
        Ok((events, total_external_events)) => Json(GdeltArticleResponse {
            article_id,
            total_external_events,
            events: events.into_iter().map(article_event_response).collect(),
        })
        .into_response(),
        Err(error) => {
            tracing::error!(%error, "GDELT article event query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/gdelt/stats",
    operation_id = "get_gdelt_stats_gdelt_stats_get",
    tag = "gdelt",
    summary = "Get Gdelt Stats",
    description = "Get GDELT coverage statistics.\n\nArgs:\n    hours: Time window in hours\n    session: Database session\n\nReturns:\n    Statistics about GDELT coverage",
    params(GdeltStatsQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = inline(GdeltObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_gdelt_stats(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let hours = match parse_integer_query(&params, "hours", 24, 1, 168) {
        Ok(hours) => hours,
        Err(error) => return error.into_response(),
    };
    let since = Utc::now().naive_utc() - Duration::hours(hours);

    match state.database.load_gdelt_stats(since).await {
        Ok((stats, top_articles)) => {
            let match_rate = if stats.total_events == 0 {
                0.0
            } else {
                ((stats.matched_events as f64 / stats.total_events as f64) * 100.0)
                    .round_ties_even()
                    / 100.0
            };
            Json(GdeltStatsResponse {
                window_hours: hours,
                total_events: stats.total_events,
                matched_events: stats.matched_events,
                match_rate,
                match_breakdown: GdeltMatchBreakdownResponse {
                    url_match: stats.url_matched,
                    embedding_match: stats.embedding_matched,
                },
                top_articles_by_coverage: top_articles
                    .into_iter()
                    .map(|article| GdeltTopArticleResponse {
                        article_id: article.article_id,
                        gdelt_event_count: article.event_count,
                    })
                    .collect(),
            })
            .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "GDELT coverage stats query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/gdelt/recent",
    operation_id = "get_recent_gdelt_events_gdelt_recent_get",
    tag = "gdelt",
    summary = "Get Recent Gdelt Events",
    description = "Get recently fetched GDELT events.\n\nArgs:\n    limit: Maximum events to return\n    include_unmatched: Whether to include events without cluster matches\n    session: Database session\n\nReturns:\n    List of GDELT events",
    params(GdeltRecentQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = inline(GdeltEventListSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_recent_gdelt_events(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let limit = match parse_integer_query(&params, "limit", 50, 1, 200) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let include_unmatched = match parse_boolean_query(&params, "include_unmatched", false) {
        Ok(include_unmatched) => include_unmatched,
        Err(error) => return error.into_response(),
    };

    match state
        .database
        .list_recent_gdelt_events(limit, include_unmatched)
        .await
    {
        Ok(events) => Json(
            events
                .into_iter()
                .map(recent_event_response)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(%error, "recent GDELT event query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

fn article_event_response(event: GdeltEventRecord) -> GdeltArticleEventResponse {
    GdeltArticleEventResponse {
        id: event.id,
        gdelt_id: event.gdelt_id,
        url: event.url,
        title: event.title,
        source: event.source,
        published_at: timestamp(event.published_at),
        event_code: event.event_code,
        event_root_code: event.event_root_code,
        actor1_name: event.actor1_name,
        actor2_name: event.actor2_name,
        tone: event.tone,
        goldstein_scale: event.goldstein_scale,
        match_method: event.match_method,
        similarity_score: event.similarity_score,
        matched_at: timestamp(event.matched_at),
    }
}

fn recent_event_response(event: GdeltEventRecord) -> GdeltRecentEventResponse {
    GdeltRecentEventResponse {
        id: event.id,
        gdelt_id: event.gdelt_id,
        url: event.url,
        title: event.title,
        source: event.source,
        published_at: timestamp(event.published_at),
        event_code: event.event_code,
        tone: event.tone,
        article_id: event.article_id,
        match_method: event.match_method,
        created_at: timestamp(event.created_at),
    }
}

fn timestamp(value: Option<NaiveDateTime>) -> Option<String> {
    value.map(|value| value.format("%Y-%m-%dT%H:%M:%S%.f").to_string())
}

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
    let parsed = raw.trim().parse::<i64>().map_err(|_| {
        parameter_error(
            "query",
            field,
            Value::String(raw.clone()),
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
            None,
        )
    })?;
    if parsed < minimum {
        return Err(parameter_error(
            "query",
            field,
            json!(parsed),
            "greater_than_equal",
            &format!("Input should be greater than or equal to {minimum}"),
            Some(Map::from_iter([("ge".to_owned(), json!(minimum))])),
        ));
    }
    if parsed > maximum {
        return Err(parameter_error(
            "query",
            field,
            json!(parsed),
            "less_than_equal",
            &format!("Input should be less than or equal to {maximum}"),
            Some(Map::from_iter([("le".to_owned(), json!(maximum))])),
        ));
    }
    Ok(parsed)
}

fn parse_boolean_query(
    params: &HashMap<String, String>,
    field: &str,
    default: bool,
) -> Result<bool, HttpValidationError> {
    let Some(raw) = params.get(field) else {
        return Ok(default);
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "on" | "t" | "true" | "y" | "yes" => Ok(true),
        "0" | "off" | "f" | "false" | "n" | "no" => Ok(false),
        _ => Err(parameter_error(
            "query",
            field,
            Value::String(raw.clone()),
            "bool_parsing",
            "Input should be a valid boolean, unable to interpret input",
            None,
        )),
    }
}

fn parameter_error(
    location: &str,
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    context: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text(location.to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: context,
        }],
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{parse_boolean_query, parse_integer_query};

    #[test]
    fn integer_query_defaults_and_bounds_match_gdelt_contract() {
        let params = HashMap::new();
        assert_eq!(
            parse_integer_query(&params, "limit", 50, 1, 200).expect("default limit"),
            50
        );

        let params = HashMap::from([(String::from("limit"), String::from("1"))]);
        assert_eq!(
            parse_integer_query(&params, "limit", 50, 1, 200).expect("minimum limit"),
            1
        );
        let params = HashMap::from([(String::from("limit"), String::from("200"))]);
        assert_eq!(
            parse_integer_query(&params, "limit", 50, 1, 200).expect("maximum limit"),
            200
        );

        let params = HashMap::from([(String::from("limit"), String::from("0"))]);
        let error = parse_integer_query(&params, "limit", 50, 1, 200).unwrap_err();
        assert_eq!(error.detail[0].error_type, "greater_than_equal");
        let params = HashMap::from([(String::from("limit"), String::from("201"))]);
        let error = parse_integer_query(&params, "limit", 50, 1, 200).unwrap_err();
        assert_eq!(error.detail[0].error_type, "less_than_equal");
    }

    #[test]
    fn boolean_query_accepts_fastapi_boolean_forms_and_rejects_others() {
        let params = HashMap::new();
        assert!(!parse_boolean_query(&params, "include_unmatched", false)
            .expect("default boolean value"));
        let params = HashMap::from([(String::from("include_unmatched"), String::from("YES"))]);
        assert!(
            parse_boolean_query(&params, "include_unmatched", false).expect("true boolean form")
        );
        let params = HashMap::from([(String::from("include_unmatched"), String::from("off"))]);
        assert!(
            !parse_boolean_query(&params, "include_unmatched", true).expect("false boolean form")
        );
        let params = HashMap::from([(String::from("include_unmatched"), String::from("maybe"))]);
        let error = parse_boolean_query(&params, "include_unmatched", false).unwrap_err();
        assert_eq!(error.detail[0].error_type, "bool_parsing");
    }
}
#[cfg(test)]
mod b13_sync_tests {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::{
        sync_router, GdeltSyncError, GdeltSyncFuture, GdeltSyncProvider, GdeltSyncResult,
        GdeltSyncState,
    };

    #[derive(Clone)]
    struct FixtureEvent {
        id: &'static str,
        matched: bool,
    }

    #[derive(Clone)]
    struct PersistingFixtureProvider {
        events: Arc<Vec<FixtureEvent>>,
        persisted: Arc<Mutex<HashSet<String>>>,
        requests: Arc<Mutex<Vec<(i64, i64)>>>,
        error: Option<GdeltSyncError>,
    }

    impl GdeltSyncProvider for PersistingFixtureProvider {
        fn sync(&self, minutes: i64, limit: i64) -> GdeltSyncFuture<GdeltSyncResult> {
            let events = self.events.clone();
            let persisted = self.persisted.clone();
            let requests = self.requests.clone();
            let error = self.error.clone();
            Box::pin(async move {
                requests
                    .lock()
                    .expect("fixture request lock")
                    .push((minutes, limit));
                if let Some(error) = error {
                    return Err(error);
                }
                let selected = events.iter().take(limit as usize).collect::<Vec<_>>();
                let total = selected.len() as i64;
                let matched = selected.iter().filter(|event| event.matched).count() as i64;
                let mut persisted = persisted.lock().expect("fixture persistence lock");
                for event in selected {
                    persisted.insert(event.id.to_owned());
                }
                Ok(GdeltSyncResult { matched, total })
            })
        }
    }

    fn fixture_provider(error: Option<GdeltSyncError>) -> PersistingFixtureProvider {
        PersistingFixtureProvider {
            events: Arc::new(vec![
                FixtureEvent {
                    id: "gdelt-1",
                    matched: true,
                },
                FixtureEvent {
                    id: "gdelt-2",
                    matched: false,
                },
            ]),
            persisted: Arc::new(Mutex::new(HashSet::new())),
            requests: Arc::new(Mutex::new(Vec::new())),
            error,
        }
    }

    fn app(state: GdeltSyncState) -> Router {
        sync_router(state).with_state(())
    }

    async fn post(app: &Router, uri: &str) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::post(uri)
                    .body(Body::empty())
                    .expect("POST request"),
            )
            .await
            .expect("POST response");
        let status = response.status();
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("GDELT sync response body");
        (
            status,
            serde_json::from_slice(&body).expect("GDELT sync response JSON"),
        )
    }

    #[tokio::test]
    async fn sync_validates_bounds_before_reporting_provider_unavailable() {
        let app = app(GdeltSyncState::unavailable());
        let (status, body) = post(&app, "/gdelt/sync?minutes=61").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body["detail"][0]["loc"],
            serde_json::json!(["query", "minutes"])
        );
        assert_eq!(body["detail"][0]["type"], "less_than_equal");

        let (status, body) = post(&app, "/gdelt/sync").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            body,
            serde_json::json!({"detail": "GDELT sync provider is not available"})
        );
    }

    #[tokio::test]
    async fn sync_persists_idempotently_and_projects_fastapi_response_fields() {
        let fixture = fixture_provider(None);
        let app = app(GdeltSyncState::with_provider(fixture.clone()));

        for _ in 0..2 {
            let (status, body) = post(&app, "/gdelt/sync?minutes=4&limit=2").await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["success"], true);
            assert_eq!(body["matched"], 1);
            assert_eq!(body["total"], 2);
            assert_eq!(body["window_minutes"], 4);
            let timestamp = body["timestamp"].as_str().expect("timestamp field");
            assert!(chrono::DateTime::parse_from_rfc3339(timestamp).is_ok());
        }

        assert_eq!(
            fixture
                .persisted
                .lock()
                .expect("fixture persistence lock")
                .len(),
            2
        );
        assert_eq!(
            fixture
                .requests
                .lock()
                .expect("fixture request lock")
                .as_slice(),
            &[(4, 2), (4, 2)]
        );
    }

    #[tokio::test]
    async fn sync_uses_python_defaults_and_preserves_provider_failures() {
        let fixture = fixture_provider(None);
        let app = app(GdeltSyncState::with_provider(fixture.clone()));
        let (status, body) = post(&app, "/gdelt/sync").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["window_minutes"], 15);
        assert_eq!(
            fixture
                .requests
                .lock()
                .expect("fixture request lock")
                .as_slice(),
            &[(15, 250)]
        );

        let app = app(GdeltSyncState::with_provider(fixture_provider(Some(
            GdeltSyncError::Failed("export fetch failed".to_owned()),
        ))));
        let (status, body) = post(&app, "/gdelt/sync").await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["detail"], "GDELT sync failed: export fetch failed");
    }
}

#[cfg(test)]
mod gdelt_export_zip_tests {
    use std::io::{Cursor, Write};

    use super::{
        parse_gdelt_export_zip, parse_gdelt_export_zip_with_limits, GdeltExportParseError,
        GdeltRecord, GDELT_EXPORT_COLUMNS, GDELT_EXPORT_FIELD_COUNT, MAX_GDELT_EXPORT_ENTRIES,
        MAX_GDELT_SYNC_EVENT_LIMIT,
    };
    use thesis_ingest::gdelt::parse_gdelt_tsv;
    use zip::write::{SimpleFileOptions, ZipWriter};
    use zip::CompressionMethod;

    type RecordSignature<'a> = (
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
        &'a str,
    );

    fn event_row(
        id: &str,
        sql_date: &str,
        source_url: &str,
        event_code: &str,
        event_root_code: &str,
        actor1_name: &str,
        actor1_country: &str,
        actor2_name: &str,
        actor2_country: &str,
        tone: &str,
        goldstein_scale: &str,
    ) -> String {
        let mut fields = [""; GDELT_EXPORT_FIELD_COUNT];
        fields[0] = id;
        fields[1] = sql_date;
        fields[6] = actor1_name;
        fields[7] = actor1_country;
        fields[16] = actor2_name;
        fields[17] = actor2_country;
        fields[26] = event_code;
        fields[28] = event_root_code;
        fields[30] = goldstein_scale;
        fields[34] = tone;
        fields[57] = source_url;
        fields.join("\t")
    }

    fn fixture_rows() -> [String; 3] {
        [
            event_row(
                "", "20240922", "", "010", "01", "Ignored", "USA", "", "", "0", "0",
            ),
            event_row(
                "123",
                "20240923",
                "https://www.example.org/story",
                "010",
                "01",
                "Actor One",
                "USA",
                "Actor Two",
                "GBR",
                "1.5",
                "2.0",
            ),
            event_row(
                "124",
                "20240924",
                "https://example.net/article",
                "020",
                "02",
                "Actor Three",
                "CAN",
                "Actor Four",
                "FRA",
                "-1.25",
                "-2.0",
            ),
        ]
    }

    fn record_signatures(records: &[GdeltRecord]) -> Vec<RecordSignature<'_>> {
        records
            .iter()
            .map(|record| {
                (
                    record.global_event_id.as_str(),
                    record.sql_date.as_str(),
                    record.source_url.as_str(),
                    record.document_identifier.as_str(),
                    record.event_code.as_str(),
                    record.event_root_code.as_str(),
                    record.actor1_name.as_str(),
                    record.actor1_country_code.as_str(),
                    record.actor2_name.as_str(),
                    record.actor2_country_code.as_str(),
                    record.avg_tone.as_str(),
                    record.goldstein_scale.as_str(),
                )
            })
            .collect()
    }

    fn zip_files(entries: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, content) in entries {
            archive
                .start_file(name, options)
                .expect("start fixture export entry");
            archive
                .write_all(content.as_bytes())
                .expect("write fixture export entry");
        }
        archive
            .finish()
            .expect("finish fixture ZIP archive")
            .into_inner()
    }

    fn expected_parser_input(rows: &[String]) -> String {
        let mut input = GDELT_EXPORT_COLUMNS.join("\t");
        input.push_str("\tDocumentIdentifier\n");
        for row in rows {
            input.push_str(row);
            input.push_str("\t\n");
        }
        input
    }

    fn rows_as_tsv() -> String {
        fixture_rows().join("\n")
    }

    #[test]
    fn headerless_58_column_zip_rows_match_shared_parser_and_obey_event_limit() {
        let rows = fixture_rows();
        assert!(rows
            .iter()
            .all(|row| row.split('\t').count() == GDELT_EXPORT_FIELD_COUNT));
        let raw_export = rows.join("\n");
        let archive = zip_files(&[("20260926190000.export.CSV", raw_export.as_str())]);
        let parsed = parse_gdelt_export_zip(&archive, 10).expect("parse headerless export");
        let expected = parse_gdelt_tsv(&expected_parser_input(&rows), 10);
        assert_eq!(record_signatures(&parsed), record_signatures(&expected));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].global_event_id, "123");
        assert_eq!(parsed[0].sql_date, "20240923");
        assert_eq!(parsed[0].source_url, "https://www.example.org/story");
        assert_eq!(parsed[0].document_identifier, "");
        assert_eq!(parsed[0].event_code, "010");
        assert_eq!(parsed[0].event_root_code, "01");
        assert_eq!(parsed[0].actor1_name, "Actor One");
        assert_eq!(parsed[0].actor1_country_code, "USA");
        assert_eq!(parsed[0].actor2_name, "Actor Two");
        assert_eq!(parsed[0].actor2_country_code, "GBR");
        assert_eq!(parsed[0].avg_tone, "1.5");
        assert_eq!(parsed[0].goldstein_scale, "2.0");

        let limited = parse_gdelt_export_zip(&archive, 1).expect("parse bounded rows");
        assert_eq!(
            record_signatures(&limited),
            record_signatures(&expected[..1])
        );

        let empty = zip_files(&[("20240923.export.CSV", "")]);
        assert!(parse_gdelt_export_zip(&empty, 1)
            .expect("parse empty export")
            .is_empty());
    }

    #[test]
    fn zip_parser_rejects_malformed_headered_and_wrong_width_rows() {
        assert!(matches!(
            parse_gdelt_export_zip(b"not a ZIP archive", 1),
            Err(GdeltExportParseError::InvalidArchive(_))
        ));

        let mut header_columns = GDELT_EXPORT_COLUMNS;
        header_columns[0] = "GLOBALEVENTID";
        let source_header = header_columns.join("\t");
        let headered = zip_files(&[("20240923.export.CSV", source_header.as_str())]);
        assert_eq!(
            parse_gdelt_export_zip(&headered, 1).expect_err("reject source header"),
            GdeltExportParseError::UnexpectedHeader
        );

        let malformed = zip_files(&[("20240923.export.CSV", "1\t20240923\thttps://example.org\n")]);
        assert_eq!(
            parse_gdelt_export_zip(&malformed, 1).expect_err("reject wrong row width"),
            GdeltExportParseError::InvalidRowFieldCount {
                line: 1,
                expected: GDELT_EXPORT_FIELD_COUNT,
                actual: 3,
            }
        );

        let raw_export = rows_as_tsv();
        let valid_archive = zip_files(&[("20240923.export.CSV", raw_export.as_str())]);
        assert_eq!(
            parse_gdelt_export_zip(&valid_archive, 0).expect_err("reject zero event limit"),
            GdeltExportParseError::InvalidLimit
        );
        assert_eq!(
            parse_gdelt_export_zip(&valid_archive, MAX_GDELT_SYNC_EVENT_LIMIT + 1)
                .expect_err("reject event limit above cap"),
            GdeltExportParseError::InvalidLimit
        );
    }

    #[test]
    fn zip_parser_rejects_multiple_or_unexpected_data_entries() {
        let raw_export = rows_as_tsv();
        let multiple = zip_files(&[
            ("20240923.export.CSV", raw_export.as_str()),
            ("20240924.export.CSV", raw_export.as_str()),
        ]);
        assert_eq!(
            parse_gdelt_export_zip(&multiple, 1).expect_err("reject multiple data entries"),
            GdeltExportParseError::MultipleDataEntries
        );

        let unexpected = zip_files(&[("readme.txt", raw_export.as_str())]);
        assert_eq!(
            parse_gdelt_export_zip(&unexpected, 1).expect_err("reject unexpected entry name"),
            GdeltExportParseError::UnexpectedEntryName
        );
    }

    #[test]
    fn zip_parser_enforces_archive_entry_and_uncompressed_byte_bounds() {
        let raw_export = rows_as_tsv();
        let archive = zip_files(&[("20240923.export.CSV", raw_export.as_str())]);
        assert_eq!(
            parse_gdelt_export_zip_with_limits(
                &archive,
                1,
                archive.len() - 1,
                u64::MAX,
                MAX_GDELT_EXPORT_ENTRIES,
            )
            .expect_err("reject oversized archive"),
            GdeltExportParseError::ArchiveTooLarge {
                max_bytes: archive.len() - 1,
            }
        );

        let at_exact_bounds = parse_gdelt_export_zip_with_limits(
            &archive,
            1,
            archive.len(),
            raw_export.len() as u64,
            MAX_GDELT_EXPORT_ENTRIES,
        )
        .expect("accept archive and entry at byte bounds");
        assert_eq!(at_exact_bounds.len(), 1);

        assert_eq!(
            parse_gdelt_export_zip_with_limits(
                &archive,
                1,
                archive.len(),
                raw_export.len() as u64 - 1,
                MAX_GDELT_EXPORT_ENTRIES,
            )
            .expect_err("reject oversized uncompressed entry"),
            GdeltExportParseError::EntryTooLarge {
                max_bytes: raw_export.len() as u64 - 1,
            }
        );

        let too_many_entries = zip_files(&[
            ("20240923.export.CSV", raw_export.as_str()),
            ("20240924.export.CSV", raw_export.as_str()),
        ]);
        assert_eq!(
            parse_gdelt_export_zip_with_limits(
                &too_many_entries,
                1,
                too_many_entries.len(),
                u64::MAX,
                1,
            )
            .expect_err("reject too many archive entries"),
            GdeltExportParseError::TooManyArchiveEntries { max_entries: 1 }
        );
    }
}
