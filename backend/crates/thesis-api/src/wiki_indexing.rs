//! Synchronous wiki indexing boundary for the Rust API.
//!
//! FastAPI awaits both index operations before responding. Production providers
//! must likewise finish their persisted work and report its result before the
//! handler returns; the API never creates an untracked background job or
//! reports success when no provider is configured.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, LazyLock};

use axum::extract::{Extension, Path};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use utoipa::{IntoParams, ToSchema};

use crate::models::HttpValidationError;

const RSS_SOURCE_CATALOG: &str = include_str!("../../../app/data/rss_sources.json");

const UNAVAILABLE_DETAIL: &str = "Wiki indexing provider is not available";

/// Future returned by a wiki index provider.
pub type WikiIndexFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// Provider failures distinguish unavailable integrations from failed work.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WikiIndexError {
    /// Required indexer/provider integration is not configured.
    Unavailable,
    /// The configured indexer failed to complete persisted work.
    Failed(String),
}

/// Source metadata passed to the source indexer, when the name exists in the RSS catalog.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WikiSourceIndexConfig {
    pub url: Value,
    pub site_url: Option<String>,
    pub country: String,
    pub funding_type: String,
    pub bias_rating: String,
    pub category: String,
    pub factual_reporting: String,
}

impl From<&Map<String, Value>> for WikiSourceIndexConfig {
    fn from(source: &Map<String, Value>) -> Self {
        Self {
            url: source.get("url").cloned().unwrap_or(Value::Null),
            site_url: source
                .get("site_url")
                .and_then(Value::as_str)
                .map(str::to_owned),
            country: source
                .get("country")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            funding_type: source
                .get("funding_type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            bias_rating: source
                .get("bias_rating")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            category: source
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("general")
                .to_owned(),
            factual_reporting: source
                .get("factual_reporting")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        }
    }
}

/// Input to one synchronous source indexing operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WikiSourceIndexRequest {
    pub source_name: String,
    /// `None` preserves FastAPI's blank country/funding/bias fallback for unknown sources.
    pub source_config: Option<WikiSourceIndexConfig>,
}

/// Reporter indexing operation selected by the existing API's `mode` query parameter.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum WikiReporterIndexMode {
    All,
    Unresolved,
    Sparql,
}

impl WikiReporterIndexMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Unresolved => "unresolved",
            Self::Sparql => "sparql",
        }
    }
}

/// Input to the synchronous reporter indexing operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WikiReporterIndexRequest {
    pub limit: i64,
    pub mode: WikiReporterIndexMode,
}

/// Counts returned by one reporter indexing phase.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct WikiReporterIndexPhase {
    pub total: i64,
    pub resolved: i64,
    pub failed: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

impl WikiReporterIndexPhase {
    fn skipped_phase() -> Self {
        Self {
            total: 0,
            resolved: 0,
            failed: 0,
            skipped: None,
            completed_at: None,
        }
    }
}

/// Result of both reporter indexing phases; disabled phases use FastAPI's zero-count shape.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct WikiReporterIndexResult {
    pub sparql_seed: WikiReporterIndexPhase,
    pub unresolved_author_index: WikiReporterIndexPhase,
}

/// Synchronous indexing implementation that owns provider calls and persisted index side effects.
///
/// Implementations must use idempotent upserts for profiles/index records and persist status
/// transitions before returning. Source indexing returns `false` for the legacy service's
/// unsuccessful result; reporter phases preserve the service's concrete counters and timestamps.
pub trait WikiIndexer: Send + Sync {
    /// Research, persist and mark one source indexed before resolving this future.
    fn index_source(
        &self,
        request: WikiSourceIndexRequest,
    ) -> WikiIndexFuture<Result<bool, WikiIndexError>>;

    /// Seed Wikidata and/or unresolved reporters, persist each operation, and return their results.
    fn index_reporters(
        &self,
        request: WikiReporterIndexRequest,
    ) -> WikiIndexFuture<Result<WikiReporterIndexResult, WikiIndexError>>;
}

/// Provider state attached only to wiki indexing routes.
#[derive(Clone, Default)]
pub struct WikiIndexingState {
    provider: Option<Arc<dyn WikiIndexer>>,
}

impl WikiIndexingState {
    /// Construct indexing state with the provider actually available in this process.
    pub fn new(provider: Option<Arc<dyn WikiIndexer>>) -> Self {
        Self { provider }
    }
}

impl WikiIndexingState {
    /// True only when an implementation is attached to run and persist indexing work.
    pub fn is_configured(&self) -> bool {
        self.provider.is_some()
    }

    pub(super) fn routes(&self) -> Router<()> {
        Router::new()
            .route("/api/wiki/index/{source_name}", post(trigger_source_index))
            .route("/api/wiki/index/reporters", post(trigger_reporter_index))
            .layer(Extension(self.clone()))
    }
}

/// Input to read-time reporter enrichment.
#[derive(Clone, Debug, PartialEq)]
pub struct ReporterEnrichmentRequest {
    pub reporter_id: i64,
    pub reporter_name: String,
    pub institutional_affiliations: Option<Value>,
    /// The same twenty newest article summaries supplied to FastAPI's activity builder.
    pub recent_articles: Vec<Value>,
}

/// Read-time reporter enrichments computed from persisted bylines, Atlas evidence, and article pages.
#[derive(Clone, Debug, PartialEq)]
pub struct ReporterEnrichment {
    pub career_timeline: Value,
    pub activity_summary: Value,
}

/// Failure while building real reporter dossier enrichments.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReporterEnrichmentError {
    /// Required database, Atlas, or article-page provider is not configured.
    Unavailable,
    /// A configured dependency failed.
    Failed(String),
}

/// Provider for the activity and career-timeline enrichments on reporter dossiers.
///
/// Implementations must return data derived from all stored bylines and accepted Atlas ownership
/// evidence, plus article-page author signals; unavailable inputs must be errors, not empty data.
pub trait ReporterEnrichmentProvider: Send + Sync {
    /// Build both read-time reporter enrichments for the persisted dossier inputs.
    fn enrich_reporter(
        &self,
        request: ReporterEnrichmentRequest,
    ) -> WikiIndexFuture<Result<ReporterEnrichment, ReporterEnrichmentError>>;
}

/// Optional reporter-enrichment integration state.
#[derive(Clone, Default)]
pub struct ReporterEnrichmentState {
    provider: Option<Arc<dyn ReporterEnrichmentProvider>>,
}

impl ReporterEnrichmentState {
    /// Construct read-enrichment state with the provider actually available in this process.
    pub fn new(provider: Option<Arc<dyn ReporterEnrichmentProvider>>) -> Self {
        Self { provider }
    }

    /// True only when real reporter enrichment is available.
    pub fn is_configured(&self) -> bool {
        self.provider.is_some()
    }
}

impl ReporterEnrichmentState {
    pub(super) async fn enrich(
        &self,
        request: ReporterEnrichmentRequest,
    ) -> Result<ReporterEnrichment, ReporterEnrichmentError> {
        let Some(provider) = &self.provider else {
            return Err(ReporterEnrichmentError::Unavailable);
        };
        provider.enrich_reporter(request).await
    }
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct ReporterIndexParameters {
    #[param(required = false, default = 500, minimum = 1, maximum = 2000)]
    limit: i64,
    /// all, unresolved, or sparql
    #[param(required = false, default = "all")]
    mode: WikiReporterIndexMode,
}

#[utoipa::path(
    post,
    path = "/api/wiki/index/{source_name}",
    operation_id = "trigger_source_index_api_wiki_index__source_name__post",
    params(("source_name" = String, Path, description = "Source name")),
    responses(
        (status = 200, description = "Successful Response", body = WikiSourceIndexResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 500, description = "Failed to index source"),
        (status = 503, description = "Wiki index provider unavailable")
    ),
    tag = "wiki",
    summary = "Trigger Source Index",
    description = "Trigger indexing for a specific source (admin endpoint)."
)]
pub(crate) async fn trigger_source_index(
    Extension(state): Extension<WikiIndexingState>,
    Path(source_name): Path<String>,
) -> Response {
    let Some(provider) = state.provider else {
        return unavailable_response();
    };
    let source_config = source_index_config(&source_name);
    let request = WikiSourceIndexRequest {
        source_name: source_name.clone(),
        source_config,
    };

    match provider.index_source(request).await {
        Ok(true) => Json(WikiSourceIndexResponse {
            status: "complete".to_owned(),
            source: source_name,
        })
        .into_response(),
        Ok(false) | Err(WikiIndexError::Failed(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "detail": format!("Failed to index {source_name}") })),
        )
            .into_response(),
        Err(WikiIndexError::Unavailable) => unavailable_response(),
    }
}

#[utoipa::path(
    post,
    path = "/api/wiki/index/reporters",
    operation_id = "trigger_reporter_index_api_wiki_index_reporters_post",
    params(ReporterIndexParameters),
    responses(
        (status = 200, description = "Successful Response", body = WikiReporterIndexResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError),
        (status = 500, description = "Reporter indexing failed"),
        (status = 503, description = "Wiki index provider unavailable")
    ),
    tag = "wiki",
    summary = "Trigger Reporter Index",
    description = "Trigger reporter indexing (admin endpoint).\n\nmode=all: Run both SPARQL seed and unresolved author indexing.\nmode=unresolved: Only index unresolved article authors.\nmode=sparql: Only run Wikidata SPARQL seed."
)]
pub(crate) async fn trigger_reporter_index(
    Extension(state): Extension<WikiIndexingState>,
    uri: Uri,
) -> Response {
    let values = match super::query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match super::parse_integer_parameter(&values, "limit", 500, 1, Some(2000)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let mode = match parse_mode(values.get("mode")) {
        Ok(mode) => mode,
        Err(error) => return error.into_response(),
    };
    let params = ReporterIndexParameters { limit, mode };

    let Some(provider) = state.provider else {
        return unavailable_response();
    };
    let request = WikiReporterIndexRequest {
        limit: params.limit,
        mode,
    };
    let result = match provider.index_reporters(request).await {
        Ok(result) => result,
        Err(WikiIndexError::Unavailable) => return unavailable_response(),
        Err(WikiIndexError::Failed(error)) => {
            tracing::error!(%error, "wiki reporter index provider failed");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let result = reporter_index_response(mode, result);
    Json(result).into_response()
}

/// Successful source indexing response matching the legacy route payload.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct WikiSourceIndexResponse {
    pub status: String,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct WikiReporterIndexResponse {
    pub status: String,
    pub mode: String,
    pub sparql_seed: WikiReporterIndexPhase,
    pub unresolved_author_index: WikiReporterIndexPhase,
}

fn reporter_index_response(
    mode: WikiReporterIndexMode,
    mut result: WikiReporterIndexResult,
) -> WikiReporterIndexResponse {
    if mode == WikiReporterIndexMode::Unresolved {
        result.sparql_seed = WikiReporterIndexPhase::skipped_phase();
    } else if mode == WikiReporterIndexMode::Sparql {
        result.unresolved_author_index = WikiReporterIndexPhase {
            skipped: Some(0),
            ..WikiReporterIndexPhase::skipped_phase()
        };
    }
    WikiReporterIndexResponse {
        status: "complete".to_owned(),
        mode: mode.as_str().to_owned(),
        sparql_seed: result.sparql_seed,
        unresolved_author_index: result.unresolved_author_index,
    }
}

fn catalog_base_name(name: &str) -> &str {
    name.split_once(" - ")
        .map(|(base, _)| base.trim())
        .unwrap_or(name)
}
static RAW_RSS_SOURCES: LazyLock<OrderedSourceCatalog> = LazyLock::new(|| {
    serde_json::from_str(RSS_SOURCE_CATALOG).expect("checked-in RSS source catalog must be valid")
});

fn source_index_config(source_name: &str) -> Option<WikiSourceIndexConfig> {
    let catalog_entry = crate::source_catalog::configured_catalog()
        .iter()
        .find(|entry| catalog_base_name(&entry.name).eq_ignore_ascii_case(source_name))?;
    let raw_config = RAW_RSS_SOURCES
        .0
        .iter()
        .find(|(name, _)| catalog_base_name(name).eq_ignore_ascii_case(source_name))?
        .1
        .as_object()?;
    let mut config = WikiSourceIndexConfig::from(raw_config);
    config.url = match &catalog_entry.url {
        crate::source_catalog::SourceUrlValue::String(url) => json!(url),
        crate::source_catalog::SourceUrlValue::List(urls) => json!(urls),
    };
    config.site_url = config
        .site_url
        .filter(|site_url| !site_url.is_empty())
        .or_else(|| normalized_site_url(&config.url));
    Some(config)
}

fn normalized_site_url(url_value: &Value) -> Option<String> {
    let urls = match url_value {
        Value::String(url) if !url.trim().is_empty() => vec![url.as_str()],
        Value::Array(urls) => urls
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .collect(),
        _ => return None,
    };

    for candidate in urls {
        let Ok(url) = reqwest::Url::parse(candidate) else {
            continue;
        };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let host = url.host_str()?.to_owned();
        let normalized_host = host.to_lowercase().replace("www.", "");
        if normalized_host == "news.google.com" {
            for (key, value) in url.query_pairs() {
                if !key.eq_ignore_ascii_case("q") {
                    continue;
                }
                for token in value.split_ascii_whitespace() {
                    let Some((operator, site)) = token.split_once(':') else {
                        continue;
                    };
                    if !operator.eq_ignore_ascii_case("site") {
                        continue;
                    }
                    let site = site.to_lowercase().replace("www.", "");
                    if !site.is_empty() {
                        return Some(format!("https://{site}"));
                    }
                }
            }
        }

        if let Some(site_host) = ["feeds.", "rss."]
            .iter()
            .find_map(|prefix| normalized_host.strip_prefix(prefix))
        {
            return Some(format!("https://{site_host}"));
        }
        let netloc = match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host,
        };
        return Some(format!("{}://{netloc}", url.scheme()));
    }
    None
}

struct EmployerSource {
    name: String,
    display_name: String,
    config: Value,
}

static EMPLOYER_SOURCES: LazyLock<Vec<EmployerSource>> = LazyLock::new(|| {
    let mut sources: Vec<EmployerSource> = Vec::new();
    for entry in crate::source_catalog::configured_catalog() {
        let base_name = catalog_base_name(&entry.name).to_owned();
        let key = base_name.to_lowercase();
        let factual_reporting = RAW_RSS_SOURCES
            .0
            .iter()
            .find(|(name, _)| name == &entry.name)
            .or_else(|| {
                RAW_RSS_SOURCES
                    .0
                    .iter()
                    .find(|(name, _)| catalog_base_name(name) == base_name)
            })
            .and_then(|(_, config)| config.get("factual_reporting"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let config = json!({
            "funding_type": entry.funding_type,
            "bias_rating": entry.bias_rating,
            "country": entry.country,
            "category": entry.category,
            "factual_reporting": factual_reporting,
        });
        if let Some(existing) = sources.iter_mut().find(|source| source.name == key) {
            existing.display_name = base_name;
            existing.config = config;
        } else {
            sources.push(EmployerSource {
                name: key,
                display_name: base_name,
                config,
            });
        }
    }
    sources
});

/// Match reporter career-history organizations against the Python RSS employer catalog.
pub(super) fn employer_context(career_history: Option<&Value>) -> Option<Value> {
    let history = career_history.and_then(Value::as_array)?;
    let employers: Vec<String> = history
        .iter()
        .filter_map(|entry| entry.as_object()?.get("organization"))
        .filter_map(python_truthy_string)
        .collect();
    if employers.is_empty() {
        return None;
    }

    let mut matched = Vec::new();
    for employer in &employers {
        let normalized = employer.to_lowercase();
        let source = EMPLOYER_SOURCES
            .iter()
            .find(|source| source.name == normalized)
            .or_else(|| {
                EMPLOYER_SOURCES.iter().find(|source| {
                    source.name.contains(&normalized) || normalized.contains(&source.name)
                })
            });
        if let Some(source) = source {
            matched.push(json!({
                "rss_name": source.display_name,
                "funding_type": source.config.get("funding_type").and_then(Value::as_str).unwrap_or(""),
                "bias_rating": source.config.get("bias_rating").and_then(Value::as_str).unwrap_or(""),
                "country": source.config.get("country").and_then(Value::as_str).unwrap_or(""),
                "category": source.config.get("category").and_then(Value::as_str).unwrap_or("general"),
                "factual_reporting": source.config.get("factual_reporting").and_then(Value::as_str).unwrap_or(""),
            }));
        }
    }
    let primary = matched.first()?.clone();
    Some(json!({
        "employers_matched": matched.len(),
        "primary_outlet": primary["rss_name"],
        "funding_type": primary["funding_type"],
        "bias_rating": primary["bias_rating"],
        "country": primary["country"],
        "category": primary["category"],
        "factual_reporting": primary["factual_reporting"],
        "all_matches": matched.into_iter().take(5).collect::<Vec<_>>(),
    }))
}

fn python_truthy_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Number(value) if value.as_f64().is_some_and(|number| number != 0.0) => {
            Some(value.to_string())
        }
        Value::Bool(true) => Some("True".to_owned()),
        Value::Array(items) if !items.is_empty() => Some(value.to_string()),
        Value::Object(fields) if !fields.is_empty() => Some(value.to_string()),
        _ => None,
    }
}

struct OrderedSourceCatalog(Vec<(String, Value)>);

impl<'de> Deserialize<'de> for OrderedSourceCatalog {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct CatalogVisitor;

        impl<'de> Visitor<'de> for CatalogVisitor {
            type Value = OrderedSourceCatalog;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an RSS source catalog object")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut entries = Vec::new();
                while let Some((name, config)) = map.next_entry::<String, Value>()? {
                    if let Some((_, existing)) =
                        entries.iter_mut().find(|(known, _)| known == &name)
                    {
                        *existing = config;
                    } else {
                        entries.push((name, config));
                    }
                }
                Ok(OrderedSourceCatalog(entries))
            }
        }

        deserializer.deserialize_map(CatalogVisitor)
    }
}

fn parse_mode(value: Option<&String>) -> Result<WikiReporterIndexMode, HttpValidationError> {
    match value.map(String::as_str).unwrap_or("all") {
        "all" => Ok(WikiReporterIndexMode::All),
        "unresolved" => Ok(WikiReporterIndexMode::Unresolved),
        "sparql" => Ok(WikiReporterIndexMode::Sparql),
        invalid => Err(super::query_validation_error(
            "mode",
            Value::String(invalid.to_owned()),
            "literal_error",
            "Input should be 'all', 'unresolved' or 'sparql'".to_owned(),
            Some(serde_json::Map::from_iter([(
                "expected".to_owned(),
                Value::String("'all', 'unresolved' or 'sparql'".to_owned()),
            )])),
        )),
    }
}

fn unavailable_response() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "detail": UNAVAILABLE_DETAIL })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        catalog_base_name, employer_context, parse_mode, reporter_index_response,
        source_index_config, WikiIndexError, WikiIndexFuture, WikiIndexer, WikiReporterIndexMode,
        WikiReporterIndexPhase, WikiReporterIndexRequest, WikiReporterIndexResult,
        WikiSourceIndexRequest,
    };
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tower::ServiceExt;

    #[derive(Default)]
    struct DeterministicIndexer {
        sources: Arc<Mutex<Vec<WikiSourceIndexRequest>>>,
        reporters: Arc<Mutex<Vec<WikiReporterIndexRequest>>>,
        fail_source: bool,
        fail_reporters: bool,
    }

    impl WikiIndexer for DeterministicIndexer {
        fn index_source(
            &self,
            request: WikiSourceIndexRequest,
        ) -> WikiIndexFuture<Result<bool, WikiIndexError>> {
            let sources = self.sources.clone();
            let fail_source = self.fail_source;
            Box::pin(async move {
                sources.lock().await.push(request);
                Ok(!fail_source)
            })
        }

        fn index_reporters(
            &self,
            request: WikiReporterIndexRequest,
        ) -> WikiIndexFuture<Result<WikiReporterIndexResult, WikiIndexError>> {
            let reporters = self.reporters.clone();
            let fail_reporters = self.fail_reporters;
            Box::pin(async move {
                reporters.lock().await.push(request);
                if fail_reporters {
                    return Err(WikiIndexError::Failed(
                        "deterministic reporter failure".to_owned(),
                    ));
                }
                Ok(WikiReporterIndexResult {
                    sparql_seed: WikiReporterIndexPhase {
                        total: 3,
                        resolved: 2,
                        failed: 1,
                        skipped: None,
                        completed_at: Some("2026-09-25T12:00:00+00:00".to_owned()),
                    },
                    unresolved_author_index: WikiReporterIndexPhase {
                        total: 4,
                        resolved: 1,
                        failed: 1,
                        skipped: Some(2),
                        completed_at: Some("2026-09-25T12:00:01+00:00".to_owned()),
                    },
                })
            })
        }
    }

    async fn json_response(response: axum::response::Response) -> Value {
        let bytes = to_bytes(response.into_body(), 4096)
            .await
            .expect("read response body");
        serde_json::from_slice(&bytes).expect("valid response JSON")
    }

    #[test]
    fn reporter_mode_parser_rejects_values_outside_fastapi_literal() {
        assert_eq!(parse_mode(None).unwrap(), WikiReporterIndexMode::All);
        assert_eq!(
            parse_mode(Some(&"sparql".to_owned())).unwrap(),
            WikiReporterIndexMode::Sparql
        );
        let error = parse_mode(Some(&"daily".to_owned())).unwrap_err();
        assert_eq!(error.detail[0].error_type, "literal_error");
        assert_eq!(error.detail[0].loc.len(), 2);
        assert_eq!(
            error.detail[0].ctx.as_ref().unwrap()["expected"],
            "'all', 'unresolved' or 'sparql'"
        );
    }

    #[test]
    fn catalog_source_alias_resolution_preserves_fastapi_base_name_rule() {
        assert_eq!(catalog_base_name("BBC News - Home"), "BBC News");
        assert_eq!(catalog_base_name("BBC News"), "BBC News");
    }

    #[test]
    fn source_config_uses_fastapi_flattened_urls_and_normalized_site_url() {
        let config = source_index_config("Bloomberg").expect("configured Bloomberg source");

        assert_eq!(
            config.url,
            json!([
                "https://feeds.bloomberg.com/markets/news.rss",
                "https://feeds.bloomberg.com/politics/news.rss",
                "https://feeds.bloomberg.com/technology/news.rss",
                "https://feeds.bloomberg.com/wealth/news.rss"
            ])
        );
        assert_eq!(config.site_url.as_deref(), Some("https://bloomberg.com"));
        assert_eq!(config.factual_reporting, "high");
        assert!(source_index_config("Unknown Outlet").is_none());
    }

    #[test]
    fn employer_context_uses_last_base_name_config_and_returns_none_without_matches() {
        let context = employer_context(Some(&json!([
            {"organization": "BBC News"},
            {"organization": "unconfigured newsroom"}
        ])))
        .expect("BBC is present in the RSS catalog");
        assert_eq!(context["employers_matched"], 1);
        assert_eq!(context["primary_outlet"], "BBC News");
        assert_eq!(context["funding_type"], "Public");
        assert_eq!(context["bias_rating"], "Center");
        assert_eq!(context["country"], "GB");
        assert_eq!(context["category"], "BBC News - World");
        assert_eq!(context["factual_reporting"], "high");
        assert_eq!(
            context["all_matches"][0],
            json!({
                "rss_name": "BBC News",
                "funding_type": "Public",
                "bias_rating": "Center",
                "country": "GB",
                "category": "BBC News - World",
                "factual_reporting": "high"
            })
        );
        assert!(
            employer_context(Some(&json!([{"organization": "unconfigured newsroom"}]))).is_none()
        );
        assert!(employer_context(Some(&json!([]))).is_none());
    }

    #[test]
    fn disabled_reporter_phase_uses_the_legacy_zero_count_shape() {
        let result = reporter_index_response(
            WikiReporterIndexMode::Unresolved,
            WikiReporterIndexResult {
                sparql_seed: WikiReporterIndexPhase {
                    total: 8,
                    resolved: 7,
                    failed: 1,
                    skipped: None,
                    completed_at: Some("not-used".to_owned()),
                },
                unresolved_author_index: WikiReporterIndexPhase {
                    total: 1,
                    resolved: 1,
                    failed: 0,
                    skipped: Some(0),
                    completed_at: None,
                },
            },
        );
        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["mode"], "unresolved");
        assert_eq!(
            serialized["sparql_seed"],
            json!({"total":0,"resolved":0,"failed":0})
        );
        assert_eq!(serialized["unresolved_author_index"]["total"], 1);
    }

    #[tokio::test]
    async fn source_index_route_uses_catalog_config_and_requires_provider_success() {
        let indexer = Arc::new(DeterministicIndexer::default());
        let app = super::WikiIndexingState::new(Some(indexer.clone())).routes();
        let response = app
            .oneshot(
                Request::post("/api/wiki/index/BBC%20News")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            json_response(response).await,
            json!({"status":"complete","source":"BBC News"})
        );
        let calls = indexer.sources.lock().await;
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].source_name, "BBC News");
        let config = calls[0].source_config.as_ref().unwrap();
        assert_eq!(config.country, "GB");
        assert_eq!(config.funding_type, "Public");
        assert_eq!(config.url, json!("http://feeds.bbci.co.uk/news/rss.xml"));
        assert_eq!(config.site_url.as_deref(), Some("https://www.bbc.com"));
        assert_eq!(config.factual_reporting, "high");

        let failed = super::WikiIndexingState::new(Some(Arc::new(DeterministicIndexer {
            fail_source: true,
            ..DeterministicIndexer::default()
        })))
        .routes()
        .oneshot(
            Request::post("/api/wiki/index/Unknown%20Outlet")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            json_response(failed).await["detail"],
            "Failed to index Unknown Outlet"
        );
    }

    #[tokio::test]
    async fn reporter_index_route_preserves_mode_limit_results_and_errors() {
        let indexer = Arc::new(DeterministicIndexer::default());
        let app = super::WikiIndexingState::new(Some(indexer.clone())).routes();
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/wiki/index/reporters?limit=12&mode=unresolved")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_response(response).await;
        assert_eq!(body["status"], "complete");
        assert_eq!(body["mode"], "unresolved");
        assert_eq!(
            body["sparql_seed"],
            json!({"total":0,"resolved":0,"failed":0})
        );
        assert_eq!(body["unresolved_author_index"]["total"], 4);
        let calls = indexer.reporters.lock().await;
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].limit, 12);
        assert_eq!(calls[0].mode, WikiReporterIndexMode::Unresolved);
        drop(calls);

        let invalid_limit = app
            .clone()
            .oneshot(
                Request::post("/api/wiki/index/reporters?limit=2001&mode=daily")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_limit.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let error = json_response(invalid_limit).await;
        assert_eq!(error["detail"][0]["loc"], json!(["query", "limit"]));

        let invalid_mode = app
            .oneshot(
                Request::post("/api/wiki/index/reporters?limit=500&mode=daily")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_mode.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let error = json_response(invalid_mode).await;
        assert_eq!(error["detail"][0]["loc"], json!(["query", "mode"]));
        assert_eq!(indexer.reporters.lock().await.len(), 1);

        let failed_provider = Arc::new(DeterministicIndexer {
            fail_reporters: true,
            ..DeterministicIndexer::default()
        });
        let failed = super::WikiIndexingState::new(Some(failed_provider))
            .routes()
            .oneshot(
                Request::post("/api/wiki/index/reporters?mode=all")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let unavailable = super::WikiIndexingState::new(None)
            .routes()
            .oneshot(
                Request::post("/api/wiki/index/reporters")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
