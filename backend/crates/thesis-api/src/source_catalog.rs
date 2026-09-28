//! RSS source catalog behavior and injectable runtime contracts.
//!
//! The checked-in catalog serves database-independent reads. When a store is
//! present, route reads use its configured-plus-persisted catalog; promotion
//! requires durable storage rather than a static fallback.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const RSS_SOURCE_CATALOG: &str = include_str!("../../../app/data/rss_sources.json");
const CREDIBILITY_CACHE_TTL: Duration = Duration::from_secs(86_400);

/// A future returned by a runtime source-catalog integration.
pub type SourceCatalogFuture<T> =
    Pin<Box<dyn Future<Output = Result<T, SourceCatalogIntegrationError>> + Send>>;

/// Runtime failures that are safe to project at the public API boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceCatalogIntegrationError {
    /// The corresponding runtime dependency is not configured in this process.
    Unavailable,
    /// A configured dependency returned a public-safe failure message.
    Failed(String),
    /// Atomic promotion rejected an already-cataloged source name.
    AlreadyExists(String),
}

impl SourceCatalogIntegrationError {
    fn message_or<'a>(&'a self, fallback: &'a str) -> &'a str {
        match self {
            Self::Unavailable | Self::AlreadyExists(_) => fallback,
            Self::Failed(message) if message.trim().is_empty() => fallback,
            Self::Failed(message) => message,
        }
    }
}

/// Input to the external RSS parser sidecar.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RssValidationInput {
    /// Normalized HTTP(S) feed URL.
    pub url: String,
    /// Name derived from the URL using the FastAPI catalog convention.
    pub source_name: String,
}

/// One article summary returned by the RSS parser sidecar.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub struct SampleArticle {
    pub title: String,
    pub url: String,
    pub source: String,
}

/// Decoded RSS parser output needed by the public validation response.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RssFeedSnapshot {
    /// Response name from the URL-derived source and first-five article sources.
    pub feed_title: String,
    pub article_count: usize,
    pub status: String,
    pub error_message: Option<String>,
    pub sample_articles: Vec<SampleArticle>,
}

/// RSS feed parser boundary. This crate never performs a network request.
pub trait RssFeedProvider: Send + Sync {
    fn validate(&self, input: RssValidationInput) -> SourceCatalogFuture<RssFeedSnapshot>;
}

/// Source record handed to an atomic promotion store.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PromotedSource {
    pub name: String,
    pub url: String,
    pub category: String,
    pub country: String,
    pub source_type: String,
    pub funding_type: String,
    pub bias_rating: String,
    pub ownership_label: String,
    pub factual_reporting: String,
    pub is_paywalled: bool,
}

/// Persistence boundary for source listing and promotion.
///
/// `list` returns configured sources followed by persisted promotions in
/// FastAPI catalog order. Implementations make `promote` atomic and report
/// duplicate names as `AlreadyExists`, including concurrent duplicate attempts.
pub trait SourceCatalogStore: Send + Sync {
    fn list(&self) -> SourceCatalogFuture<Vec<SourceCatalogEntry>>;
    fn promote(&self, source: PromotedSource) -> SourceCatalogFuture<()>;
}

/// Persisted six-dimension credibility profile provider.
pub trait SourceCredibilityProvider: Send + Sync {
    fn compute(&self, domain: String) -> SourceCatalogFuture<Value>;
}

/// Runtime state needed by the source-catalog handlers.
#[derive(Clone)]
pub struct SourceCatalogState {
    pub(crate) rss_provider: Option<Arc<dyn RssFeedProvider>>,
    pub(crate) catalog_store: Option<Arc<dyn SourceCatalogStore>>,
    pub(crate) credibility_provider: Option<Arc<dyn SourceCredibilityProvider>>,
    credibility_cache: Arc<Mutex<BTreeMap<String, (Value, Instant)>>>,
}

/// Runtime availability for the three source-catalog dependencies.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourceCatalogAvailability {
    /// Whether RSS fetching and parsing are configured.
    pub rss_feed_provider: bool,
    /// Whether mutable catalog persistence is configured.
    pub catalog_store: bool,
    /// Whether persisted credibility scoring is configured.
    pub credibility_provider: bool,
}

impl Default for SourceCatalogState {
    fn default() -> Self {
        Self::new(None, None, None)
    }
}

impl SourceCatalogState {
    /// Construct handlers with the runtime's source-catalog dependencies.
    pub fn new(
        rss_provider: Option<Arc<dyn RssFeedProvider>>,
        catalog_store: Option<Arc<dyn SourceCatalogStore>>,
        credibility_provider: Option<Arc<dyn SourceCredibilityProvider>>,
    ) -> Self {
        Self {
            rss_provider,
            catalog_store,
            credibility_provider,
            credibility_cache: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    /// Report which adapters are configured so readiness can name missing dependencies.
    pub fn availability(&self) -> SourceCatalogAvailability {
        SourceCatalogAvailability {
            rss_feed_provider: self.rss_provider.is_some(),
            catalog_store: self.catalog_store.is_some(),
            credibility_provider: self.credibility_provider.is_some(),
        }
    }

    /// Whether all adapters required by the source-catalog routes are configured.
    pub fn is_configured(&self) -> bool {
        let availability = self.availability();
        availability.rss_feed_provider
            && availability.catalog_store
            && availability.credibility_provider
    }
}

/// String or string-array URL value emitted by the source catalog.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(untagged)]
pub enum SourceUrlValue {
    String(String),
    List(Vec<String>),
}

/// One configured source in the public `/sources` response.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub struct SourceCatalogEntry {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub url: SourceUrlValue,
    #[serde(rename = "rssUrl")]
    pub rss_url: SourceUrlValue,
    pub category: String,
    pub country: String,
    pub source_type: String,
    pub is_paywalled: bool,
    pub funding_type: String,
    pub bias_rating: String,
    pub ownership_label: String,
}

/// FastAPI's `AddRssRequest` body.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct AddRssRequest {
    pub url: String,
}

/// FastAPI's `PromoteRssRequest` body.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct PromoteRssRequest {
    pub url: String,
    #[serde(default)]
    pub name: Option<String>,
    #[schema(required = false, default = "general")]
    #[serde(default = "default_category")]
    pub category: String,
    #[schema(required = false, default = "")]
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    #[schema(required = false, default = "")]
    pub funding_type: String,
    #[serde(default)]
    #[schema(required = false, default = "")]
    pub bias_rating: String,
    #[serde(default)]
    #[schema(required = false, default = "")]
    pub ownership_label: String,
    #[serde(default = "default_factual_reporting")]
    #[schema(required = false, default = "unknown")]
    pub factual_reporting: String,
    #[serde(default)]
    #[schema(required = false, default = false)]
    pub is_paywalled: bool,
}

fn default_category() -> String {
    "general".to_owned()
}

fn default_factual_reporting() -> String {
    "unknown".to_owned()
}

/// One duplicate catalog candidate.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct DuplicateCandidate {
    pub name: String,
    pub url: String,
}

/// Inferred metadata emitted by RSS validation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct InferredSource {
    pub domain: String,
    pub source_type: Option<String>,
    pub category: String,
    pub country: String,
    pub is_paywalled: bool,
}

/// Public response shared by RSS validation and promotion.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct RssValidationResponse {
    pub success: bool,
    pub name: String,
    pub url: String,
    pub article_count: usize,
    pub status: String,
    pub sample_articles: Vec<SampleArticle>,
    pub duplicate_candidates: Vec<DuplicateCandidate>,
    pub inferred: InferredSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promoted: Option<bool>,
}

/// OpenAPI marker matching FastAPI's `dict[str, Any]` response schema.
#[derive(Debug)]
pub(crate) struct FreeFormObjectSchema;

impl PartialSchema for FreeFormObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for FreeFormObjectSchema {}

#[utoipa::path(
    get,
    path = "/sources",
    operation_id = "get_sources_sources_get",
    tag = "sources",
    responses(
        (status = 200, description = "Successful Response", body = [FreeFormObjectSchema])
    )
)]
pub(crate) async fn get_sources(State(state): State<SourceCatalogState>) -> Response {
    match current_catalog(&state).await {
        Ok(entries) => Json(entries).into_response(),
        Err(error) => integration_failure_response(error),
    }
}

#[utoipa::path(
    post,
    path = "/sources/add-rss",
    operation_id = "add_rss_source_sources_add_rss_post",
    tag = "sources",
    request_body = AddRssRequest,
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn add_rss_source(
    State(state): State<SourceCatalogState>,
    body: Bytes,
) -> Response {
    let request = match parse_add_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    promote_request(
        &state,
        PromoteRssRequest {
            url: request.url,
            name: None,
            category: default_category(),
            country: String::new(),
            source_type: None,
            funding_type: String::new(),
            bias_rating: String::new(),
            ownership_label: String::new(),
            factual_reporting: default_factual_reporting(),
            is_paywalled: false,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/sources/rss/validate",
    operation_id = "validate_rss_source_sources_rss_validate_post",
    tag = "sources",
    request_body = AddRssRequest,
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn validate_rss_source(
    State(state): State<SourceCatalogState>,
    body: Bytes,
) -> Response {
    let request = match parse_add_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let url = match normalize_source_url(&request.url) {
        Ok(url) => url,
        Err(detail) => return bad_request_response(detail),
    };
    match validate_normalized_url(&state, url).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => error.into_response(),
    }
}

#[utoipa::path(
    post,
    path = "/sources/rss/promote",
    operation_id = "promote_rss_source_sources_rss_promote_post",
    tag = "sources",
    request_body = PromoteRssRequest,
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn promote_rss_source(
    State(state): State<SourceCatalogState>,
    body: Bytes,
) -> Response {
    let request = match parse_promote_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    promote_request(&state, request).await
}

#[utoipa::path(
    get,
    path = "/sources/{domain}/credibility",
    operation_id = "get_source_credibility_sources__domain__credibility_get",
    tag = "sources",
    params(("domain" = String, Path, description = "Source domain")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_source_credibility(
    State(state): State<SourceCatalogState>,
    Path(domain): Path<String>,
) -> Response {
    let normalized_domain = normalize_domain(&domain);
    if let Some(cached) = cached_profile(&state, &normalized_domain) {
        return Json(cached).into_response();
    }
    let Some(provider) = state.credibility_provider.as_ref() else {
        return internal_server_error("source credibility provider is not configured");
    };
    match provider.compute(normalized_domain.clone()).await {
        Ok(profile) => {
            cache_profile(&state, normalized_domain, profile.clone());
            Json(profile).into_response()
        }
        Err(error) => internal_server_error(error.message_or("source credibility provider failed")),
    }
}

async fn promote_request(state: &SourceCatalogState, request: PromoteRssRequest) -> Response {
    let url = match normalize_source_url(&request.url) {
        Ok(url) => url,
        Err(detail) => return bad_request_response(detail),
    };
    let validation = match validate_normalized_url(state, url).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let feed_title = request.name.as_deref().unwrap_or(&validation.name).trim();
    let feed_title = if feed_title.is_empty() {
        validation.name.clone()
    } else {
        feed_title.to_owned()
    };

    let catalog = match current_catalog(state).await {
        Ok(catalog) => catalog,
        Err(error) => return integration_failure_response(error),
    };
    if catalog.iter().any(|entry| entry.name == feed_title) {
        return conflict_response(format!("Source '{feed_title}' already exists"));
    }

    let Some(store) = state.catalog_store.as_ref() else {
        return internal_server_error("source catalog persistence is not configured");
    };
    let source = PromotedSource {
        name: feed_title.clone(),
        url: validation.url.clone(),
        category: if request.category.is_empty() {
            default_category()
        } else {
            request.category
        },
        country: request.country,
        source_type: request.source_type.unwrap_or_default(),
        funding_type: request.funding_type,
        bias_rating: request.bias_rating,
        ownership_label: request.ownership_label,
        factual_reporting: request.factual_reporting,
        is_paywalled: request.is_paywalled,
    };
    if let Err(error) = store.promote(source).await {
        return match error {
            SourceCatalogIntegrationError::AlreadyExists(name) => {
                conflict_response(format!("Source '{name}' already exists"))
            }
            error => integration_failure_response(error),
        };
    }

    let mut response = validation;
    response.name = feed_title;
    response.promoted = Some(true);
    Json(response).into_response()
}

#[derive(Debug)]
enum NormalizedUrlValidationError {
    Catalog(SourceCatalogIntegrationError),
    Provider(SourceCatalogIntegrationError),
    FeedRejected(SourceCatalogIntegrationError),
}

impl IntoResponse for NormalizedUrlValidationError {
    fn into_response(self) -> Response {
        match self {
            Self::Catalog(error) => integration_failure_response(error),
            Self::Provider(error) => rss_validation_failure_response(error),
            Self::FeedRejected(error) => rss_feed_rejected_response(error),
        }
    }
}

async fn validate_normalized_url(
    state: &SourceCatalogState,
    url: String,
) -> Result<RssValidationResponse, NormalizedUrlValidationError> {
    let catalog = match current_catalog(state).await {
        Ok(catalog) => catalog,
        Err(error) => return Err(NormalizedUrlValidationError::Catalog(error)),
    };
    let source_name = derive_source_name(&url);
    let Some(provider) = state.rss_provider.as_ref() else {
        return Err(NormalizedUrlValidationError::Provider(
            SourceCatalogIntegrationError::Unavailable,
        ));
    };
    let snapshot = match provider
        .validate(RssValidationInput {
            url: url.clone(),
            source_name,
        })
        .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => return Err(NormalizedUrlValidationError::Provider(error)),
    };
    if snapshot.status == "error" && snapshot.article_count == 0 {
        let error = SourceCatalogIntegrationError::Failed(
            snapshot
                .error_message
                .unwrap_or_else(|| "Could not parse any articles from this feed".to_owned()),
        );
        return Err(NormalizedUrlValidationError::FeedRejected(error));
    }
    let feed_domain = domain_for_url(&url);
    let feed_title = if snapshot.feed_title.is_empty() {
        derive_source_name(&url)
    } else {
        snapshot.feed_title
    };
    let mut sample_articles = snapshot
        .sample_articles
        .into_iter()
        .take(5)
        .collect::<Vec<_>>();
    for article in &mut sample_articles {
        if article.source.is_empty() {
            article.source.clone_from(&feed_title);
        }
    }
    let duplicates = duplicate_candidates(&catalog, &feed_domain, &url);
    Ok(RssValidationResponse {
        success: true,
        name: feed_title,
        url,
        article_count: snapshot.article_count,
        status: snapshot.status,
        sample_articles,
        duplicate_candidates: duplicates,
        inferred: InferredSource {
            domain: feed_domain,
            source_type: None,
            category: default_category(),
            country: String::new(),
            is_paywalled: false,
        },
        promoted: None,
    })
}

async fn current_catalog(
    state: &SourceCatalogState,
) -> Result<Cow<'static, [SourceCatalogEntry]>, SourceCatalogIntegrationError> {
    match state.catalog_store.as_ref() {
        Some(store) => store.list().await.map(Cow::Owned),
        None => Ok(Cow::Borrowed(configured_catalog())),
    }
}

/// Static configured RSS sources used by FastAPI's database-independent catalog read.
///
/// Runtime catalog stores merge this baseline with persisted promotions.
pub fn configured_catalog() -> &'static [SourceCatalogEntry] {
    static SOURCES: LazyLock<Vec<SourceCatalogEntry>> = LazyLock::new(parse_catalog);
    SOURCES.as_slice()
}
struct CatalogObject(Vec<(String, Value)>);

impl<'de> Deserialize<'de> for CatalogObject {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct CatalogVisitor;

        impl<'de> Visitor<'de> for CatalogVisitor {
            type Value = CatalogObject;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an RSS source catalog object")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut entries = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Value>()? {
                    if let Some(index) = entries
                        .iter()
                        .position(|(existing_key, _)| existing_key == &key)
                    {
                        entries[index].1 = value;
                    } else {
                        entries.push((key, value));
                    }
                }
                Ok(CatalogObject(entries))
            }
        }

        deserializer.deserialize_map(CatalogVisitor)
    }
}

fn parse_catalog() -> Vec<SourceCatalogEntry> {
    let catalog: CatalogObject = serde_json::from_str(RSS_SOURCE_CATALOG)
        .expect("checked-in RSS catalog must be valid JSON");
    let mut entries = Vec::new();
    for (name, value) in catalog.0 {
        let Some(config) = value.as_object() else {
            continue;
        };
        let Some(url_value) = config.get("url") else {
            continue;
        };
        let urls = match url_value {
            Value::String(url) if !url.trim().is_empty() => vec![url.trim().to_owned()],
            Value::Array(urls) => urls
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|url| !url.is_empty())
                .map(str::to_owned)
                .collect(),
            _ => Vec::new(),
        };
        if urls.is_empty() {
            continue;
        }
        let consolidate = python_truthy(config.get("consolidate"));
        if consolidate && matches!(url_value, Value::Array(_)) {
            entries.push(source_entry(&name, config, SourceUrlValue::List(urls)));
        } else if matches!(url_value, Value::Array(_)) {
            for (index, url) in urls.into_iter().enumerate() {
                let display_name = format!("{name} - {}", index + 1);
                entries.push(source_entry(
                    &display_name,
                    config,
                    SourceUrlValue::String(url),
                ));
            }
        } else {
            entries.push(source_entry(
                &name,
                config,
                SourceUrlValue::String(urls[0].clone()),
            ));
        }
    }
    entries
}

fn source_entry(
    name: &str,
    config: &Map<String, Value>,
    url: SourceUrlValue,
) -> SourceCatalogEntry {
    SourceCatalogEntry {
        id: source_slug(name),
        slug: source_slug(name),
        name: name.to_owned(),
        rss_url: url.clone(),
        url,
        category: string_or(config.get("category"), "general"),
        country: string_or(config.get("country"), ""),
        source_type: string_or(config.get("source_type"), ""),
        is_paywalled: python_truthy(config.get("is_paywalled")),
        funding_type: string_or(config.get("funding_type"), ""),
        bias_rating: string_or(config.get("bias_rating"), ""),
        ownership_label: string_or(config.get("ownership_label"), ""),
    }
}

fn source_slug(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .to_lowercase()
}

fn string_or(value: Option<&Value>, default: &str) -> String {
    value.and_then(Value::as_str).unwrap_or(default).to_owned()
}

fn python_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value.as_f64().is_some_and(|value| value != 0.0),
        Some(Value::String(value)) => !value.is_empty(),
        Some(Value::Array(value)) => !value.is_empty(),
        Some(Value::Object(value)) => !value.is_empty(),
    }
}

fn duplicate_candidates(
    catalog: &[SourceCatalogEntry],
    feed_domain: &str,
    url: &str,
) -> Vec<DuplicateCandidate> {
    let mut candidates = Vec::new();
    for source in catalog {
        let urls = match &source.url {
            SourceUrlValue::String(url) => std::slice::from_ref(url),
            SourceUrlValue::List(urls) => urls.as_slice(),
        };
        for existing_url in urls {
            if existing_url == url || domain_for_url(existing_url) == feed_domain {
                candidates.push(DuplicateCandidate {
                    name: source.name.clone(),
                    url: existing_url.clone(),
                });
            }
        }
    }
    candidates
}

fn normalize_source_url(url: &str) -> Result<String, &'static str> {
    let normalized = url.trim();
    if normalized.is_empty() {
        return Err("URL is required");
    }
    if !normalized.starts_with("http://") && !normalized.starts_with("https://") {
        return Err("URL must start with http:// or https://");
    }
    Ok(normalized.to_owned())
}

fn normalize_domain(domain: &str) -> String {
    let normalized = domain.trim();
    if normalized.contains("://") {
        let host = hostname_for_url(normalized).unwrap_or_default();
        return strip_www_prefix(host).to_ascii_lowercase();
    }
    let normalized = normalized
        .split('/')
        .next()
        .unwrap_or(normalized)
        .split(':')
        .next()
        .unwrap_or(normalized)
        .trim();
    strip_www_prefix(normalized).to_ascii_lowercase()
}

fn strip_www_prefix(host: &str) -> &str {
    if host
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("www."))
    {
        &host[4..]
    } else {
        host
    }
}

fn domain_for_url(url: &str) -> String {
    normalize_domain(url)
}

fn derive_source_name(url: &str) -> String {
    let host = hostname_for_url(url).unwrap_or(url);
    let host = strip_www_prefix(host);
    let parts = host.split('.').collect::<Vec<_>>();
    let value = if parts.len() >= 2
        && matches!(parts[parts.len() - 2], "co" | "com" | "org" | "net" | "gov")
    {
        parts
            .get(parts.len().saturating_sub(3))
            .copied()
            .unwrap_or(host)
    } else {
        parts.first().copied().unwrap_or(host)
    };
    title_case(&value.replace('-', " "))
}

fn hostname_for_url(url: &str) -> Option<&str> {
    let (_, remainder) = url.split_once("://")?;
    let authority = remainder.split(['/', '?', '#']).next().unwrap_or(remainder);
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    if let Some(host) = host_port.strip_prefix('[') {
        return host.split(']').next();
    }
    Some(host_port.split(':').next().unwrap_or(host_port))
}

fn title_case(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let first = first.to_uppercase().collect::<String>();
                    format!("{first}{}", chars.as_str().to_lowercase())
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_add_request(body: &[u8]) -> Result<AddRssRequest, HttpValidationError> {
    let value = parse_json(body)?;
    let fields = object_fields(&value)?;
    let url = required_string(&value, fields, "url")?;
    Ok(AddRssRequest { url })
}

fn parse_promote_request(body: &[u8]) -> Result<PromoteRssRequest, HttpValidationError> {
    let value = parse_json(body)?;
    let fields = object_fields(&value)?;
    let url = required_string(&value, fields, "url")?;
    let name = nullable_string(fields, "name")?;
    let category = defaulted_string(fields, "category", "general")?;
    let country = defaulted_string(fields, "country", "")?;
    let source_type = nullable_string(fields, "source_type")?;
    let funding_type = defaulted_string(fields, "funding_type", "")?;
    let bias_rating = defaulted_string(fields, "bias_rating", "")?;
    let ownership_label = defaulted_string(fields, "ownership_label", "")?;
    let factual_reporting = defaulted_string(fields, "factual_reporting", "unknown")?;
    let is_paywalled = match fields.get("is_paywalled") {
        None => false,
        Some(value) => parse_bool(value).ok_or_else(|| {
            let error_type = if value.is_string() || value.is_number() {
                "bool_parsing"
            } else {
                "bool_type"
            };
            HttpValidationError::field(
                value.clone(),
                "is_paywalled",
                error_type,
                if error_type == "bool_parsing" {
                    "Input should be a valid boolean, unable to interpret input"
                } else {
                    "Input should be a valid boolean"
                },
            )
        })?,
    };
    Ok(PromoteRssRequest {
        url,
        name,
        category,
        country,
        source_type,
        funding_type,
        bias_rating,
        ownership_label,
        factual_reporting,
        is_paywalled,
    })
}

fn parse_json(body: &[u8]) -> Result<Value, HttpValidationError> {
    serde_json::from_slice(body).map_err(|error| HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![ValidationLocation::Text("body".to_owned())],
            msg: "JSON decode error".to_owned(),
            error_type: "json_invalid".to_owned(),
            input: Value::Null,
            ctx: Some(Map::from_iter([(
                "error".to_owned(),
                Value::String(error.to_string()),
            )])),
        }],
    })
}

fn object_fields(value: &Value) -> Result<&Map<String, Value>, HttpValidationError> {
    value.as_object().ok_or_else(|| {
        HttpValidationError::body(
            value.clone(),
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        )
    })
}

fn required_string(
    value: &Value,
    fields: &Map<String, Value>,
    field: &str,
) -> Result<String, HttpValidationError> {
    let Some(input) = fields.get(field) else {
        return Err(HttpValidationError::field(
            value.clone(),
            field,
            "missing",
            "Field required",
        ));
    };
    input.as_str().map(str::to_owned).ok_or_else(|| {
        HttpValidationError::field(
            input.clone(),
            field,
            "string_type",
            "Input should be a valid string",
        )
    })
}

fn nullable_string(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, HttpValidationError> {
    match fields.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(input) => input
            .as_str()
            .map(|value| Some(value.to_owned()))
            .ok_or_else(|| {
                HttpValidationError::field(
                    input.clone(),
                    field,
                    "string_type",
                    "Input should be a valid string",
                )
            }),
    }
}

fn defaulted_string(
    fields: &Map<String, Value>,
    field: &str,
    default: &str,
) -> Result<String, HttpValidationError> {
    match fields.get(field) {
        None => Ok(default.to_owned()),
        Some(input) => input.as_str().map(str::to_owned).ok_or_else(|| {
            HttpValidationError::field(
                input.clone(),
                field,
                "string_type",
                "Input should be a valid string",
            )
        }),
    }
}

fn parse_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(number) => {
            if number.as_i64() == Some(1) || number.as_f64() == Some(1.0) {
                Some(true)
            } else if number.as_i64() == Some(0) || number.as_f64() == Some(0.0) {
                Some(false)
            } else {
                None
            }
        }
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "t" | "yes" | "y" | "on" => Some(true),
            "0" | "false" | "f" | "no" | "n" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn cached_profile(state: &SourceCatalogState, domain: &str) -> Option<Value> {
    let cache = state.credibility_cache.lock().ok()?;
    let (value, cached_at) = cache.get(domain)?;
    (cached_at.elapsed() < CREDIBILITY_CACHE_TTL).then(|| value.clone())
}

fn cache_profile(state: &SourceCatalogState, domain: String, value: Value) {
    if let Ok(mut cache) = state.credibility_cache.lock() {
        let now = Instant::now();
        cache.retain(|_, (_, cached_at)| cached_at.elapsed() < CREDIBILITY_CACHE_TTL);
        cache.insert(domain, (value, now));
    }
}

fn bad_request_response(detail: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"detail": detail}))).into_response()
}

fn conflict_response(detail: String) -> Response {
    (StatusCode::CONFLICT, Json(json!({"detail": detail}))).into_response()
}

fn rss_validation_failure_response(error: SourceCatalogIntegrationError) -> Response {
    let detail = format!(
        "Failed to parse RSS feed: {}",
        error.message_or("RSS validation provider is not available")
    );
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"detail": detail})),
    )
        .into_response()
}

fn rss_feed_rejected_response(error: SourceCatalogIntegrationError) -> Response {
    let detail = error
        .message_or("Could not parse any articles from this feed")
        .to_owned();
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"detail": detail})),
    )
        .into_response()
}

fn integration_failure_response(error: SourceCatalogIntegrationError) -> Response {
    tracing::error!(
        message = %error.message_or("source catalog integration failed"),
        "source catalog integration failed"
    );
    internal_server_error(error.message_or("source catalog integration failed"))
}

fn internal_server_error(message: &str) -> Response {
    tracing::error!(%message, "source catalog operation unavailable");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request, StatusCode};
    use axum::response::Response;
    use axum::routing::{get, post};
    use axum::Router;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::{
        add_rss_source, configured_catalog, derive_source_name, domain_for_url,
        get_source_credibility, get_sources, normalize_source_url, promote_rss_source, source_slug,
        validate_rss_source, CatalogObject, PromotedSource, RssFeedProvider, RssFeedSnapshot,
        RssValidationInput, SampleArticle, SourceCatalogAvailability, SourceCatalogEntry,
        SourceCatalogFuture, SourceCatalogIntegrationError, SourceCatalogState, SourceCatalogStore,
        SourceCredibilityProvider, SourceUrlValue,
    };

    #[derive(Clone)]
    struct FixedFeedProvider {
        result: Result<RssFeedSnapshot, SourceCatalogIntegrationError>,
        inputs: Arc<Mutex<Vec<RssValidationInput>>>,
    }

    impl FixedFeedProvider {
        fn new(result: Result<RssFeedSnapshot, SourceCatalogIntegrationError>) -> Self {
            Self {
                result,
                inputs: Arc::default(),
            }
        }
    }

    impl RssFeedProvider for FixedFeedProvider {
        fn validate(&self, input: RssValidationInput) -> SourceCatalogFuture<RssFeedSnapshot> {
            self.inputs.lock().expect("feed input lock").push(input);
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }

    #[derive(Default)]
    struct MemoryCatalogStore {
        entries: Mutex<Vec<SourceCatalogEntry>>,
        list_error: Mutex<Option<String>>,
        promoted: Mutex<Vec<PromotedSource>>,
        force_conflict: Mutex<bool>,
    }

    impl MemoryCatalogStore {
        fn with_entries(entries: Vec<SourceCatalogEntry>) -> Self {
            Self {
                entries: Mutex::new(entries),
                list_error: Mutex::new(None),
                promoted: Mutex::default(),
                force_conflict: Mutex::new(false),
            }
        }

        fn entries(&self) -> Vec<SourceCatalogEntry> {
            self.entries.lock().expect("catalog entries lock").clone()
        }

        fn fail_listing(&self, message: &str) {
            *self.list_error.lock().expect("catalog error lock") = Some(message.to_owned());
        }

        fn promoted(&self) -> Vec<PromotedSource> {
            self.promoted.lock().expect("promoted source lock").clone()
        }

        fn reject_next_promotion(&self) {
            *self.force_conflict.lock().expect("promotion conflict lock") = true;
        }

        fn promote_now(&self, source: PromotedSource) -> Result<(), SourceCatalogIntegrationError> {
            let mut entries = self.entries.lock().map_err(|_| test_store_failure())?;
            if entries.iter().any(|entry| entry.name == source.name) {
                return Err(SourceCatalogIntegrationError::AlreadyExists(
                    source.name.clone(),
                ));
            }
            let forced_conflict = {
                let mut force_conflict = self
                    .force_conflict
                    .lock()
                    .map_err(|_| test_store_failure())?;
                std::mem::take(&mut *force_conflict)
            };
            if forced_conflict {
                return Err(SourceCatalogIntegrationError::AlreadyExists(
                    source.name.clone(),
                ));
            }
            entries.push(entry_from_promoted(&source));
            self.promoted
                .lock()
                .map_err(|_| test_store_failure())?
                .push(source);
            Ok(())
        }
    }

    impl SourceCatalogStore for MemoryCatalogStore {
        fn list(&self) -> SourceCatalogFuture<Vec<SourceCatalogEntry>> {
            let list_error = self
                .list_error
                .lock()
                .map(|error| error.clone())
                .map_err(|_| test_store_failure());
            let result = match list_error {
                Ok(Some(message)) => Err(SourceCatalogIntegrationError::Failed(message)),
                Ok(None) => self
                    .entries
                    .lock()
                    .map(|entries| entries.clone())
                    .map_err(|_| test_store_failure()),
                Err(error) => Err(error),
            };
            Box::pin(async move { result })
        }

        fn promote(&self, source: PromotedSource) -> SourceCatalogFuture<()> {
            let result = self.promote_now(source);
            Box::pin(async move { result })
        }
    }

    #[tokio::test]
    async fn configured_store_failure_does_not_fall_back_to_static_catalog() {
        let store = Arc::new(MemoryCatalogStore::default());
        store.fail_listing("database unavailable");
        let app = source_router(source_state(None, Some(store), None));

        let response = request(&app, Method::GET, "/sources", None).await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            to_bytes(response.into_body(), 16_384)
                .await
                .expect("store failure response")
                .as_ref(),
            b"Internal Server Error"
        );
    }

    #[derive(Clone, Default)]
    struct ScoredCredibilityProvider {
        domains: Arc<Mutex<Vec<String>>>,
    }

    impl SourceCredibilityProvider for ScoredCredibilityProvider {
        fn compute(&self, domain: String) -> SourceCatalogFuture<Value> {
            self.domains
                .lock()
                .expect("credibility domain lock")
                .push(domain.clone());
            let score = if domain == "example.invalid" {
                82.5
            } else {
                17.5
            };
            let profile = json!({
                "domain": domain,
                "dimensions": {
                    "funding_transparency": {"score": score, "status": "data_available"},
                    "source_network_diversity": {"score": score, "status": "data_available"},
                    "political_orientation_disclosure": {"score": score, "status": "data_available"},
                    "correction_record": {"score": score, "status": "data_available"},
                    "methodology_transparency": {"score": score, "status": "data_available"},
                    "cross_verification_alignment": {"score": score, "status": "data_available"}
                },
                "data_quality": {
                    "dimensions_available": 6,
                    "dimensions_total": 6,
                    "completeness_pct": 100.0,
                    "last_updated": "2026-09-25T00:00:00+00:00"
                },
                "status": "data_available"
            });
            Box::pin(async move { Ok(profile) })
        }
    }

    fn test_store_failure() -> SourceCatalogIntegrationError {
        SourceCatalogIntegrationError::Failed("test store lock poisoned".to_owned())
    }

    fn source_entry(name: &str, url: &str) -> SourceCatalogEntry {
        let url = SourceUrlValue::String(url.to_owned());
        SourceCatalogEntry {
            id: source_slug(name),
            slug: source_slug(name),
            name: name.to_owned(),
            url: url.clone(),
            rss_url: url,
            category: "general".to_owned(),
            country: String::new(),
            source_type: String::new(),
            is_paywalled: false,
            funding_type: String::new(),
            bias_rating: String::new(),
            ownership_label: String::new(),
        }
    }

    fn entry_from_promoted(source: &PromotedSource) -> SourceCatalogEntry {
        let mut entry = source_entry(&source.name, &source.url);
        entry.category.clone_from(&source.category);
        entry.country.clone_from(&source.country);
        entry.source_type.clone_from(&source.source_type);
        entry.is_paywalled = source.is_paywalled;
        entry.funding_type.clone_from(&source.funding_type);
        entry.bias_rating.clone_from(&source.bias_rating);
        entry.ownership_label.clone_from(&source.ownership_label);
        entry
    }

    fn feed_snapshot(
        feed_title: &str,
        status: &str,
        article_count: usize,
        error: Option<&str>,
    ) -> RssFeedSnapshot {
        RssFeedSnapshot {
            feed_title: feed_title.to_owned(),
            article_count,
            status: status.to_owned(),
            error_message: error.map(str::to_owned),
            sample_articles: (0..6)
                .map(|index| SampleArticle {
                    title: format!("Fixture story {index}"),
                    url: format!("https://feed-fixture.invalid/story/{index}"),
                    source: if index == 0 {
                        String::new()
                    } else {
                        feed_title.to_owned()
                    },
                })
                .collect(),
        }
    }

    fn source_state(
        feed: Option<Arc<FixedFeedProvider>>,
        store: Option<Arc<MemoryCatalogStore>>,
        credibility: Option<Arc<ScoredCredibilityProvider>>,
    ) -> SourceCatalogState {
        SourceCatalogState::new(
            feed.map(|provider| provider as Arc<dyn RssFeedProvider>),
            store.map(|store| store as Arc<dyn SourceCatalogStore>),
            credibility.map(|provider| provider as Arc<dyn SourceCredibilityProvider>),
        )
    }

    fn source_router(state: SourceCatalogState) -> Router {
        Router::new()
            .route("/sources", get(get_sources))
            .route("/sources/add-rss", post(add_rss_source))
            .route("/sources/rss/validate", post(validate_rss_source))
            .route("/sources/rss/promote", post(promote_rss_source))
            .route("/sources/{domain}/credibility", get(get_source_credibility))
            .with_state(state)
    }

    async fn request(app: &Router, method: Method, uri: &str, body: Option<Value>) -> Response {
        let builder = Request::builder().method(method).uri(uri);
        let request = match body {
            Some(body) => builder
                .header("content-type", "application/json")
                .body(Body::from(body.to_string())),
            None => builder.body(Body::empty()),
        }
        .expect("valid test request");
        app.clone()
            .oneshot(request)
            .await
            .expect("source-catalog route response")
    }

    async fn response_json(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("source-catalog response body");
        serde_json::from_slice(&bytes).expect("source-catalog JSON response")
    }

    #[test]
    fn source_projection_uses_fastapi_slug_and_name_rules() {
        assert_eq!(source_slug("BBC News - World"), "bbc-news---world");
        assert_eq!(
            derive_source_name("https://feeds.example.com/news.xml"),
            "Feeds"
        );
        assert_eq!(derive_source_name("https://example.org/feed"), "Example");
    }

    #[test]
    fn source_url_normalization_preserves_path_and_rejects_non_http() {
        assert_eq!(
            normalize_source_url(" https://example.com/feed ").unwrap(),
            "https://example.com/feed"
        );
        assert_eq!(normalize_source_url(" "), Err("URL is required"));
        assert_eq!(
            normalize_source_url("ftp://example.com/feed"),
            Err("URL must start with http:// or https://")
        );
    }

    #[test]
    fn source_domain_normalization_matches_credibility_lookup() {
        assert_eq!(
            domain_for_url("https://WWW.Example.com:443/feed"),
            "example.com"
        );
        assert_eq!(
            derive_source_name("https://WWW.Example.com:443/feed"),
            "Example"
        );
    }

    #[test]
    fn catalog_object_uses_last_duplicate_value_and_first_position() {
        let catalog: CatalogObject = serde_json::from_str(
            r#"{"First":{"value":1},"MercoPress":{"value":2},"Last":{"value":3},"MercoPress":{"value":4}}"#,
        )
        .expect("synthetic catalog with duplicate source key");

        assert_eq!(
            catalog
                .0
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["First", "MercoPress", "Last"]
        );
        assert_eq!(catalog.0[1].1["value"], serde_json::json!(4));
    }

    #[test]
    fn configured_catalog_names_are_unique() {
        let mut names = HashSet::new();
        for source in configured_catalog() {
            assert!(
                names.insert(source.name.as_str()),
                "duplicate configured source name: {}",
                source.name
            );
        }
    }

    #[tokio::test]
    async fn source_list_uses_fastapi_static_catalog_without_database_store() {
        let state = SourceCatalogState::default();
        assert_eq!(
            state.availability(),
            SourceCatalogAvailability {
                rss_feed_provider: false,
                catalog_store: false,
                credibility_provider: false,
            }
        );
        assert!(!state.is_configured());

        let app = source_router(state);
        let response = request(&app, Method::GET, "/sources", None).await;
        assert_eq!(response.status(), StatusCode::OK);
        let sources = response_json(response).await;
        let sources = sources.as_array().expect("source list array");
        assert!(!sources.is_empty());
        assert_eq!(sources.len(), configured_catalog().len());
        assert!(sources[0]["id"].is_string());
        assert!(sources[0]["rssUrl"].is_string() || sources[0]["rssUrl"].is_array());
    }

    #[tokio::test]
    async fn validation_filters_duplicate_candidates_in_catalog_order_without_mutating() {
        let store = Arc::new(MemoryCatalogStore::with_entries(vec![
            source_entry("Matching First", "https://www.example.invalid/feed"),
            source_entry("Not Matching", "https://other.invalid/feed"),
            source_entry("Matching Second", "https://example.invalid/alternate"),
        ]));
        let provider = Arc::new(FixedFeedProvider::new(Ok(feed_snapshot(
            "Example", "warning", 6, None,
        ))));
        let app = source_router(source_state(
            Some(provider.clone()),
            Some(store.clone()),
            None,
        ));

        let response = request(
            &app,
            Method::POST,
            "/sources/rss/validate",
            Some(json!({"url": " https://example.invalid/new-feed "})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response_json(response).await;
        assert_eq!(payload["url"], "https://example.invalid/new-feed");
        assert_eq!(payload["name"], "Example");
        assert_eq!(payload["status"], "warning");
        assert_eq!(payload["article_count"], 6);
        assert_eq!(payload["inferred"]["domain"], "example.invalid");
        assert_eq!(payload["sample_articles"].as_array().unwrap().len(), 5);
        assert_eq!(payload["sample_articles"][0]["source"], "Example");
        assert_eq!(
            payload["duplicate_candidates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|candidate| candidate["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["Matching First", "Matching Second"]
        );
        assert_eq!(store.entries().len(), 3);
        let inputs = provider.inputs.lock().expect("feed input lock");
        assert_eq!(inputs.len(), 1);
        assert_eq!(inputs[0].source_name, "Example");
    }

    #[tokio::test]
    async fn add_and_promote_persist_in_order_and_only_exact_name_conflicts() {
        let store = Arc::new(MemoryCatalogStore::with_entries(vec![source_entry(
            "Existing Source",
            "https://same-feed.invalid/old",
        )]));
        let provider = Arc::new(FixedFeedProvider::new(Ok(feed_snapshot(
            "Same Feed",
            "success",
            6,
            None,
        ))));
        let app = source_router(source_state(Some(provider), Some(store.clone()), None));

        let add_response = request(
            &app,
            Method::POST,
            "/sources/add-rss",
            Some(json!({"url": "https://same-feed.invalid/rss"})),
        )
        .await;
        assert_eq!(add_response.status(), StatusCode::OK);
        let added = response_json(add_response).await;
        assert_eq!(added["name"], "Same Feed");
        assert_eq!(added["promoted"], true);

        let promotions = store.promoted();
        assert_eq!(promotions.len(), 1);
        assert_eq!(promotions[0].category, "general");
        assert_eq!(promotions[0].factual_reporting, "unknown");
        assert!(!promotions[0].is_paywalled);

        let repeated = request(
            &app,
            Method::POST,
            "/sources/add-rss",
            Some(json!({"url": "https://same-feed.invalid/rss"})),
        )
        .await;
        assert_eq!(repeated.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(repeated).await["detail"],
            "Source 'Same Feed' already exists"
        );

        let alias = request(
            &app,
            Method::POST,
            "/sources/rss/promote",
            Some(json!({
                "url": "https://same-feed.invalid/rss",
                "name": "Alias Source",
                "category": "world",
                "country": "GB",
                "source_type": "wire",
                "funding_type": "public",
                "bias_rating": "Center",
                "ownership_label": "public broadcaster",
                "factual_reporting": "high",
                "is_paywalled": true
            })),
        )
        .await;
        assert_eq!(alias.status(), StatusCode::OK);
        assert_eq!(response_json(alias).await["promoted"], true);
        let promotions = store.promoted();
        assert_eq!(promotions.len(), 2);
        assert_eq!(promotions[1].name, "Alias Source");
        assert_eq!(promotions[1].url, "https://same-feed.invalid/rss");
        assert_eq!(promotions[1].category, "world");
        assert_eq!(promotions[1].country, "GB");
        assert_eq!(promotions[1].source_type, "wire");
        assert_eq!(promotions[1].funding_type, "public");
        assert_eq!(promotions[1].bias_rating, "Center");
        assert_eq!(promotions[1].ownership_label, "public broadcaster");
        assert_eq!(promotions[1].factual_reporting, "high");
        assert!(promotions[1].is_paywalled);

        let listed = request(&app, Method::GET, "/sources", None).await;
        assert_eq!(listed.status(), StatusCode::OK);
        let listed = response_json(listed).await;
        let listed = listed.as_array().expect("mutable source list");
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[0]["name"], "Existing Source");
        assert_eq!(listed[1]["name"], "Same Feed");
        assert_eq!(listed[2]["name"], "Alias Source");
    }

    #[tokio::test]
    async fn atomic_duplicate_name_race_returns_fastapi_conflict() {
        let store = Arc::new(MemoryCatalogStore::default());
        store.reject_next_promotion();
        let provider = Arc::new(FixedFeedProvider::new(Ok(feed_snapshot(
            "Race Fixture",
            "success",
            1,
            None,
        ))));
        let app = source_router(source_state(Some(provider), Some(store.clone()), None));

        let response = request(
            &app,
            Method::POST,
            "/sources/rss/promote",
            Some(json!({
                "url": "https://race-fixture.invalid/rss",
                "name": "Racing Source"
            })),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            response_json(response).await["detail"],
            "Source 'Racing Source' already exists"
        );
        assert!(store.entries().is_empty());
    }

    #[tokio::test]
    async fn validation_rejects_empty_parse_failures_but_preserves_partial_results() {
        let store = Arc::new(MemoryCatalogStore::default());
        let rejected_provider = Arc::new(FixedFeedProvider::new(Ok(feed_snapshot(
            "Parse Fixture",
            "error",
            0,
            None,
        ))));
        let rejected_app = source_router(source_state(
            Some(rejected_provider),
            Some(store.clone()),
            None,
        ));
        let rejected = request(
            &rejected_app,
            Method::POST,
            "/sources/rss/validate",
            Some(json!({"url": "https://parse-fixture.invalid/rss"})),
        )
        .await;
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response_json(rejected).await["detail"],
            "Could not parse any articles from this feed"
        );

        let partial_provider = Arc::new(FixedFeedProvider::new(Ok(feed_snapshot(
            "Parse Fixture",
            "error",
            1,
        ))));
        let partial_app = source_router(source_state(Some(partial_provider), Some(store), None));
        let partial = request(
            &partial_app,
            Method::POST,
            "/sources/rss/validate",
            Some(json!({"url": "https://parse-fixture.invalid/rss"})),
        )
        .await;
        assert_eq!(partial.status(), StatusCode::OK);
        let partial = response_json(partial).await;
        assert_eq!(partial["status"], "error");
        assert_eq!(partial["article_count"], 1);
    }

    #[tokio::test]
    async fn parser_transport_failures_keep_fastapi_422_detail_prefix() {
        let store = Arc::new(MemoryCatalogStore::default());
        let provider = Arc::new(FixedFeedProvider::new(Err(
            SourceCatalogIntegrationError::Failed("fixture fetch failed".to_owned()),
        )));
        let app = source_router(source_state(Some(provider), Some(store), None));
        let response = request(
            &app,
            Method::POST,
            "/sources/rss/validate",
            Some(json!({"url": "https://parse-fixture.invalid/rss"})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response_json(response).await["detail"],
            "Failed to parse RSS feed: fixture fetch failed"
        );
    }

    #[tokio::test]
    async fn credibility_normalizes_domain_and_reuses_the_scored_profile_cache() {
        let provider = Arc::new(ScoredCredibilityProvider::default());
        let app = source_router(source_state(None, None, Some(provider.clone())));

        for _ in 0..2 {
            let response = request(
                &app,
                Method::GET,
                "/sources/WWW.Example.invalid/credibility",
                None,
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            let profile = response_json(response).await;
            assert_eq!(profile["domain"], "example.invalid");
            assert_eq!(profile["dimensions"]["funding_transparency"]["score"], 82.5);
            assert_eq!(profile["data_quality"]["dimensions_available"], 6);
        }

        assert_eq!(
            *provider.domains.lock().expect("credibility domain lock"),
            vec!["example.invalid"]
        );
    }

    #[tokio::test]
    async fn missing_parser_or_store_never_claims_validation_or_promotion_success() {
        let default_app = source_router(SourceCatalogState::default());
        let validation = request(
            &default_app,
            Method::POST,
            "/sources/rss/validate",
            Some(json!({"url": "https://unconfigured.invalid/rss"})),
        )
        .await;
        assert_eq!(validation.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let provider = Arc::new(FixedFeedProvider::new(Ok(feed_snapshot(
            "Unconfigured",
            "success",
            1,
            None,
        ))));
        let no_store_app = source_router(source_state(Some(provider), None, None));
        let promotion = request(
            &no_store_app,
            Method::POST,
            "/sources/rss/promote",
            Some(json!({
                "url": "https://unconfigured.invalid/rss",
                "name": "Unpersisted Source"
            })),
        )
        .await;
        assert_eq!(promotion.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            to_bytes(promotion.into_body(), 16_384)
                .await
                .expect("unconfigured promotion error")
                .as_ref(),
            b"Internal Server Error"
        );

        let no_credibility_app = source_router(SourceCatalogState::default());
        let credibility = request(
            &no_credibility_app,
            Method::GET,
            "/sources/unconfigured.invalid/credibility",
            None,
        )
        .await;
        assert_eq!(credibility.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
