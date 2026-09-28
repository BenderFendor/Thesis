//! Typed HTTP boundary for verification operations.
//!
//! This module owns the HTTP contracts and delegates verification, cache, and workspace work to
//! adapters supplied by the host application. It fails closed when those integrations are absent.

use std::convert::Infallible;
use std::env;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONNECTION, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{
    AdditionalProperties, ArrayBuilder, ObjectBuilder, SchemaType, Type,
};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const DEFAULT_VERIFICATION_DOMAINS: &str = "reuters.com,apnews.com,bbc.com,bbc.co.uk,npr.org,pbs.org,factcheck.org,snopes.com,politifact.com,mediabiasfactcheck.com,nytimes.com,washingtonpost.com,theguardian.com,wsj.com,economist.com,nature.com,science.org,gov.uk,usa.gov,who.int,un.org,wikipedia.org,en.wikipedia.org";
const VERIFICATION_DISABLED_DETAIL: &str = "Verification is disabled";
const VERIFICATION_PROVIDER_UNAVAILABLE: &str = "Verification provider is not available";
const CACHE_PROVIDER_UNAVAILABLE: &str = "Verification cache provider is not available";
const WORKSPACE_CLEANER_UNAVAILABLE: &str = "Verification workspace cleanup is not available";
const INVALID_PROVIDER_RESULT: &str = "Invalid verification provider result";

/// Future returned by a verification or cache adapter.
pub type VerificationFuture<T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'static>>;

/// Verification limits and source policy reflected by FastAPI's settings.
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationConfig {
    pub enabled: bool,
    pub max_duration_seconds: i64,
    pub max_claims: i64,
    pub max_sources_per_claim: i64,
    pub cache_ttl_hours: i64,
    pub recheck_threshold: f64,
    pub allowed_domains: Vec<String>,
}

impl VerificationConfig {
    /// Read the settings used by the Python verification routes from process environment.
    ///
    /// Like the Python settings module, malformed integer or float settings fail during startup
    /// rather than silently changing the verification policy.
    pub fn from_environment() -> Self {
        Self {
            enabled: env_enabled("ENABLE_VERIFICATION", "1"),
            max_duration_seconds: env_parse("VERIFICATION_MAX_DURATION_SECONDS", "15"),
            max_claims: env_parse("VERIFICATION_MAX_CLAIMS", "10"),
            max_sources_per_claim: env_parse("VERIFICATION_MAX_SOURCES_PER_CLAIM", "5"),
            cache_ttl_hours: env_parse("VERIFICATION_CACHE_TTL_HOURS", "24"),
            recheck_threshold: env_parse("VERIFICATION_RECHECK_THRESHOLD", "0.4"),
            allowed_domains: parse_domain_list(
                env::var("VERIFICATION_ALLOWED_DOMAINS")
                    .unwrap_or_else(|_| DEFAULT_VERIFICATION_DOMAINS.to_owned()),
            ),
        }
    }
}

impl Default for VerificationConfig {
    fn default() -> Self {
        Self::from_environment()
    }
}

fn env_enabled(name: &str, default: &str) -> bool {
    let value = env::var(name).unwrap_or_else(|_| default.to_owned());
    !matches!(value.as_str(), "0" | "false" | "False" | "")
}

fn env_parse<T>(name: &str, default: &str) -> T
where
    T: std::str::FromStr,
    T::Err: std::fmt::Debug,
{
    env::var(name)
        .unwrap_or_else(|_| default.to_owned())
        .parse()
        .unwrap_or_else(|error| panic!("invalid {name}: {error:?}"))
}

fn parse_domain_list(raw: String) -> Vec<String> {
    raw.split(',')
        .map(python_trim)
        .filter(|domain| !domain.is_empty())
        .map(str::to_owned)
        .collect()
}

fn python_trim(value: &str) -> &str {
    value.trim_matches(|character: char| {
        character.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&character)
    })
}

/// True when a URL's parsed network location matches an allowlisted domain or subdomain.
///
/// This retains the Python sandbox's exact boundary rule: lowercase the URL network location,
/// take the portion before the first colon, then match the configured domain exactly or after a
/// dot label boundary. Configured domains are not normalized.
pub fn is_domain_allowed(url: &str, allowed_domains: &[String]) -> bool {
    let remainder = if let Some((scheme, after_colon)) = url.split_once(':') {
        if scheme.is_empty()
            || !scheme.chars().enumerate().all(|(index, character)| {
                character.is_ascii_alphabetic()
                    || (index > 0 && (character.is_ascii_digit() || "+-.".contains(character)))
            })
        {
            return false;
        }
        after_colon.strip_prefix("//").unwrap_or("")
    } else if let Some(after_slashes) = url.strip_prefix("//") {
        after_slashes
    } else {
        return false;
    };
    let netloc = remainder
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let domain = netloc.split(':').next().unwrap_or_default();
    if domain.is_empty() {
        return false;
    }
    allowed_domains.iter().any(|allowed| {
        domain == allowed
            || domain
                .strip_suffix(allowed)
                .is_some_and(|prefix| prefix.ends_with('.'))
    })
}

/// External verification implementation, including source search, credibility scoring, and cache use.
///
/// Implementations must use `config.allowed_domains` for external search results and preserve the
/// configured claim/source limits, cache TTL, recheck threshold, and duration limit. The standard
/// `/verify` HTTP route additionally imposes an outer `max_duration_seconds + 5` timeout.
pub trait VerificationProvider: Send + Sync {
    fn verify(
        &self,
        request: VerificationRequest,
        config: VerificationConfig,
    ) -> VerificationFuture<VerificationResult>;
}

/// Adapter for deleting expired rows from the shared verification cache table.
///
/// Implementations delete and commit rows with `expires_at < now`, returning the affected row
/// count. Database failures should be returned so the route can log them and report zero.
pub trait VerificationCache: Send + Sync {
    fn clear_expired(&self) -> VerificationFuture<usize>;
}

/// Adapter that schedules Python-equivalent stale sandbox workspace cleanup.
pub trait VerificationWorkspaceCleaner: Send + Sync {
    /// Enqueue cleanup of workspaces older than this many hours.
    fn schedule_stale_cleanup(&self, max_age_hours: i64);
}

/// Providers and configuration used by the verification router.
#[derive(Clone)]
pub struct VerificationState {
    config: VerificationConfig,
    provider: Option<Arc<dyn VerificationProvider>>,
    cache: Option<Arc<dyn VerificationCache>>,
    workspace_cleaner: Option<Arc<dyn VerificationWorkspaceCleaner>>,
}

impl VerificationState {
    /// Build a state with no provider or cache integration.
    pub fn unavailable(config: VerificationConfig) -> Self {
        Self {
            config,
            provider: None,
            cache: None,
            workspace_cleaner: None,
        }
    }

    /// Attach only the adapters that have a real implementation in the hosting application.
    pub fn with_adapters(
        config: VerificationConfig,
        provider: Option<Arc<dyn VerificationProvider>>,
        cache: Option<Arc<dyn VerificationCache>>,
        workspace_cleaner: Option<Arc<dyn VerificationWorkspaceCleaner>>,
    ) -> Self {
        Self {
            config,
            provider,
            cache,
            workspace_cleaner,
        }
    }

    /// Build the default shadow state from process environment, with integrations unavailable.
    pub fn from_environment() -> Self {
        Self::unavailable(VerificationConfig::from_environment())
    }
}

impl Default for VerificationState {
    fn default() -> Self {
        Self::from_environment()
    }
}

/// Request shape accepted by FastAPI's verification routes.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[schema(
    title = "VerificationRequest",
    description = "Input to the verification agent with the research findings to check."
)]
pub struct VerificationRequest {
    pub query: String,
    #[serde(default)]
    #[schema(required = false, schema_with = free_form_object_array_schema)]
    pub main_findings: Vec<Value>,
    #[serde(default)]
    #[schema(required = false)]
    pub main_answer: Option<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub previous_claims: Vec<VerifiedClaim>,
}

/// Confidence tier assigned to a verified claim.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[schema(
    title = "ConfidenceLevel",
    description = "Ordinal confidence tier assigned to a verified claim."
)]
pub enum ConfidenceLevel {
    High,
    Medium,
    Low,
    VeryLow,
}

impl ConfidenceLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
            Self::VeryLow => "very_low",
        }
    }
}

/// Organizational classification for a verification source.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[schema(as = SourceType, title = "SourceType", description = "Classification of a source's organizational nature.")]
pub enum VerificationSourceType {
    Wire,
    Newspaper,
    Magazine,
    Broadcast,
    Nonprofit,
    FactChecker,
    Government,
    Academic,
    Blog,
    Social,
    #[default]
    Unknown,
}

impl VerificationSourceType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Wire => "wire",
            Self::Newspaper => "newspaper",
            Self::Magazine => "magazine",
            Self::Broadcast => "broadcast",
            Self::Nonprofit => "nonprofit",
            Self::FactChecker => "fact_checker",
            Self::Government => "government",
            Self::Academic => "academic",
            Self::Blog => "blog",
            Self::Social => "social",
            Self::Unknown => "unknown",
        }
    }
}

/// Metadata for one supporting or conflicting verification source.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[schema(as = app__models__verification__SourceInfo, title = "SourceInfo", description = "Metadata for a single supporting or conflicting source.")]
pub struct VerificationSourceInfo {
    pub id: String,
    pub url: String,
    #[serde(default)]
    #[schema(required = false)]
    pub title: Option<String>,
    pub domain: String,
    #[schema(minimum = 0.0, maximum = 1.0)]
    pub credibility_score: f64,
    #[serde(default = "default_source_type")]
    #[schema(required = false, default = "unknown")]
    pub source_type: VerificationSourceType,
    #[serde(default)]
    #[schema(required = false)]
    pub published_at: Option<String>,
    #[serde(default = "default_supports_claim")]
    #[schema(required = false, default = true)]
    pub supports_claim: bool,
    #[serde(default)]
    #[schema(required = false)]
    pub excerpt: Option<String>,
}

fn default_supports_claim() -> bool {
    true
}
fn default_source_type() -> VerificationSourceType {
    VerificationSourceType::Unknown
}

/// One claim checked against local and external sources.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[schema(
    title = "VerifiedClaim",
    description = "A single claim that has been cross-referenced against sources."
)]
pub struct VerifiedClaim {
    pub id: String,
    pub claim_text: String,
    #[schema(minimum = 0.0, maximum = 1.0)]
    pub confidence: f64,
    pub confidence_level: ConfidenceLevel,
    #[serde(default)]
    #[schema(required = false)]
    pub supporting_sources: Vec<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub conflicting_sources: Vec<String>,
    #[serde(default)]
    #[schema(required = false, schema_with = integer_array_schema)]
    pub footnotes: Vec<Value>,
    #[serde(default)]
    #[schema(required = false, default = false)]
    pub needs_recheck: bool,
    #[serde(default)]
    #[schema(required = false)]
    pub recheck_reason: Option<String>,
}

/// Complete verification response.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq)]
#[schema(
    title = "VerificationResult",
    description = "Aggregated result containing all verified claims and their sources."
)]
pub struct VerificationResult {
    pub query: String,
    #[schema(minimum = 0.0, maximum = 1.0)]
    pub overall_confidence: f64,
    pub overall_confidence_level: ConfidenceLevel,
    #[schema(required = false)]
    pub verified_claims: Vec<VerifiedClaim>,
    #[schema(required = false)]
    pub sources: std::collections::BTreeMap<String, VerificationSourceInfo>,
    #[schema(required = false, default = "")]
    pub markdown_report: String,
    #[schema(required = false)]
    pub generated_at: String,
    #[schema(required = false, default = 0)]
    pub duration_ms: i64,
    #[schema(required = false)]
    pub error: Option<String>,
}

/// Event payload serialized in the verification SSE stream.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq)]
pub struct VerificationStreamEvent {
    #[schema(value_type = String)]
    pub r#type: String,
    #[schema(required = false)]
    pub content: Option<String>,
    #[schema(required = false)]
    pub claim: Option<VerifiedClaim>,
    #[schema(required = false)]
    pub source: Option<VerificationSourceInfo>,
    #[schema(required = false)]
    pub result: Option<VerificationResult>,
    #[schema(required = false)]
    pub progress: Option<f64>,
}

/// Free-form object response marker used by Python endpoints returning `dict[str, Any]`.
#[derive(Debug)]
pub struct VerificationObjectResponseSchema;

impl PartialSchema for VerificationObjectResponseSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for VerificationObjectResponseSchema {}

/// Unconstrained response marker used by FastAPI's stream OpenAPI response.
#[derive(Debug)]
pub struct VerificationStreamResponseSchema;

impl PartialSchema for VerificationStreamResponseSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(SchemaType::AnyValue)
            .build()
            .into()
    }
}

impl ToSchema for VerificationStreamResponseSchema {}

fn free_form_object_array_schema() -> RefOr<Schema> {
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

fn integer_array_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(ObjectBuilder::new().schema_type(Type::Integer).build())
        .build()
        .into()
}

/// Status snapshot matching the Python route's settings projection.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq)]
pub struct VerificationStatusResponse {
    pub enabled: bool,
    pub max_duration_seconds: i64,
    pub max_claims: i64,
    pub max_sources_per_claim: i64,
    pub cache_ttl_hours: i64,
    pub recheck_threshold: f64,
    pub allowed_domains_count: usize,
}

/// The configured allowlist used by verification source searches.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct AllowedVerificationDomainsResponse {
    pub count: usize,
    pub domains: Vec<String>,
}

/// Cache cleanup result.
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct VerificationCacheClearResponse {
    pub deleted_cache_entries: usize,
    pub workspace_cleanup: String,
}

#[utoipa::path(
    get,
    path = "/api/verification/status",
    operation_id = "get_verification_status_api_verification_status_get",
    tag = "verification",
    summary = "Get Verification Status",
    description = "Check verification agent status and configuration.",
    responses((status = 200, description = "Successful Response", body = VerificationObjectResponseSchema))
)]
pub async fn get_verification_status(
    State(state): State<VerificationState>,
) -> Json<VerificationStatusResponse> {
    Json(VerificationStatusResponse {
        enabled: state.config.enabled,
        max_duration_seconds: state.config.max_duration_seconds,
        max_claims: state.config.max_claims,
        max_sources_per_claim: state.config.max_sources_per_claim,
        cache_ttl_hours: state.config.cache_ttl_hours,
        recheck_threshold: state.config.recheck_threshold,
        allowed_domains_count: state.config.allowed_domains.len(),
    })
}

#[utoipa::path(
    get,
    path = "/api/verification/domains",
    operation_id = "list_allowed_domains_api_verification_domains_get",
    tag = "verification",
    summary = "List Allowed Domains",
    description = "List domains allowed for verification source searches.",
    responses((status = 200, description = "Successful Response", body = VerificationObjectResponseSchema))
)]
pub async fn list_allowed_domains(
    State(state): State<VerificationState>,
) -> Json<AllowedVerificationDomainsResponse> {
    Json(AllowedVerificationDomainsResponse {
        count: state.config.allowed_domains.len(),
        domains: state.config.allowed_domains,
    })
}

#[utoipa::path(
    post,
    path = "/api/verification/verify",
    operation_id = "verify_claims_api_verification_verify_post",
    tag = "verification",
    summary = "Verify Claims",
    description = "Verify claims from research output.\n\nRequest body:\n- query: The original research query\n- main_answer: The research agent's response text\n- main_findings: Optional list of structured findings\n\nReturns verification result with overall confidence, verified claims, sources, and a markdown report.",
    request_body = VerificationRequest,
    responses(
        (status = 200, description = "Successful Response", body = VerificationResult),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub async fn verify_claims(State(state): State<VerificationState>, body: Bytes) -> Response {
    let request = match parse_verification_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    if !state.config.enabled {
        return http_detail(
            StatusCode::SERVICE_UNAVAILABLE,
            VERIFICATION_DISABLED_DETAIL,
        );
    }

    let timeout_seconds = state.config.max_duration_seconds.saturating_add(5).max(0) as u64;
    match tokio::time::timeout(
        Duration::from_secs(timeout_seconds),
        run_verification(&state, request),
    )
    .await
    {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(error)) => {
            tracing::error!(%error, "verification failed at the provider boundary");
            http_detail(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Verification failed: {error}"),
            )
        }
        Err(_) => http_detail(StatusCode::GATEWAY_TIMEOUT, "Verification timed out"),
    }
}

#[utoipa::path(
    post,
    path = "/api/verification/verify/stream",
    operation_id = "verify_claims_stream_api_verification_verify_stream_post",
    tag = "verification",
    summary = "Verify Claims Stream",
    description = "Stream verification progress as Server-Sent Events, with claim progress fields.\n\nEvents include started, claim (with progress), complete, and error.",
    request_body = VerificationRequest,
    responses(
        (status = 200, description = "Successful Response", body = VerificationStreamResponseSchema),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub async fn verify_claims_stream(State(state): State<VerificationState>, body: Bytes) -> Response {
    let request = match parse_verification_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    if !state.config.enabled {
        return http_detail(
            StatusCode::SERVICE_UNAVAILABLE,
            VERIFICATION_DISABLED_DETAIL,
        );
    }

    let query = request.query.clone();
    let verification: VerificationFuture<VerificationResult> =
        Box::pin(async move { run_verification(&state, request).await });
    // Pull-based streaming keeps one frame at a time and cancels provider work when the body drops.
    let stream = futures_util::stream::unfold(
        Some(VerificationStreamStep::Started {
            query,
            verification,
        }),
        |step| async move {
            let step = step?;
            let (frame, next_step) = match step {
                VerificationStreamStep::Started {
                    query,
                    verification,
                } => (
                    sse_frame(&json!({"type": "started", "query": query})),
                    Some(VerificationStreamStep::Verify(verification)),
                ),
                VerificationStreamStep::Verify(verification) => match verification.await {
                    Ok(result) if result.verified_claims.is_empty() => {
                        (sse_frame(&complete_stream_event(result)), None)
                    }
                    Ok(result) => {
                        let event = claim_stream_event(
                            &result.verified_claims[0],
                            1.0 / result.verified_claims.len() as f64,
                        );
                        (
                            sse_frame(&event),
                            Some(VerificationStreamStep::Claim { result, index: 1 }),
                        )
                    }
                    Err(error) => (sse_frame(&error_stream_event(error)), None),
                },
                VerificationStreamStep::Claim { result, index } => {
                    let count = result.verified_claims.len();
                    let event = claim_stream_event(
                        &result.verified_claims[index],
                        (index + 1) as f64 / count as f64,
                    );
                    let next_step = if index + 1 == count {
                        Some(VerificationStreamStep::Complete(result))
                    } else {
                        Some(VerificationStreamStep::Claim {
                            result,
                            index: index + 1,
                        })
                    };
                    (sse_frame(&event), next_step)
                }
                VerificationStreamStep::Complete(result) => {
                    (sse_frame(&complete_stream_event(result)), None)
                }
            };
            Some((Ok::<Bytes, Infallible>(frame), next_step))
        },
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/event-stream")
        .header(CACHE_CONTROL, "no-cache")
        .header(CONNECTION, "keep-alive")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(stream))
        .expect("verification SSE response headers are valid")
}

enum VerificationStreamStep {
    Started {
        query: String,
        verification: VerificationFuture<VerificationResult>,
    },
    Verify(VerificationFuture<VerificationResult>),
    Claim {
        result: VerificationResult,
        index: usize,
    },
    Complete(VerificationResult),
}

fn claim_stream_event(claim: &VerifiedClaim, progress: f64) -> VerificationStreamEvent {
    VerificationStreamEvent {
        r#type: "claim".to_owned(),
        content: None,
        claim: Some(claim.clone()),
        source: None,
        result: None,
        progress: Some(progress),
    }
}

fn complete_stream_event(result: VerificationResult) -> VerificationStreamEvent {
    VerificationStreamEvent {
        r#type: "complete".to_owned(),
        content: None,
        claim: None,
        source: None,
        result: Some(result),
        progress: None,
    }
}

fn error_stream_event(error: String) -> VerificationStreamEvent {
    VerificationStreamEvent {
        r#type: "error".to_owned(),
        content: Some(error),
        claim: None,
        source: None,
        result: None,
        progress: None,
    }
}

fn sse_frame(payload: &impl Serialize) -> Bytes {
    let mut frame = Vec::with_capacity(128);
    frame.extend_from_slice(b"data: ");
    serde_json::to_writer(&mut frame, payload).expect("verification SSE event serializes");
    frame.extend_from_slice(b"\n\n");
    Bytes::from(frame)
}

#[utoipa::path(
    post,
    path = "/api/verification/verify/json",
    operation_id = "verify_claims_json_api_verification_verify_json_post",
    tag = "verification",
    summary = "Verify Claims Json",
    description = "Verify claims and return structured JSON response.\n\nReturns a summary-focused format for frontend widgets.",
    request_body = VerificationRequest,
    responses(
        (status = 200, description = "Successful Response", body = VerificationObjectResponseSchema),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub async fn verify_claims_json(State(state): State<VerificationState>, body: Bytes) -> Response {
    let request = match parse_verification_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    if !state.config.enabled {
        return http_detail(
            StatusCode::SERVICE_UNAVAILABLE,
            VERIFICATION_DISABLED_DETAIL,
        );
    }
    match run_verification(&state, request).await {
        Ok(result) => Json(format_json_response(&result)).into_response(),
        Err(error) => {
            tracing::error!(%error, "JSON verification failed at the provider boundary");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

fn format_json_response(result: &VerificationResult) -> Value {
    let high_count = result
        .verified_claims
        .iter()
        .filter(|claim| claim.confidence_level == ConfidenceLevel::High)
        .count();
    let medium_count = result
        .verified_claims
        .iter()
        .filter(|claim| claim.confidence_level == ConfidenceLevel::Medium)
        .count();
    let low_count = result
        .verified_claims
        .iter()
        .filter(|claim| {
            matches!(
                claim.confidence_level,
                ConfidenceLevel::Low | ConfidenceLevel::VeryLow
            )
        })
        .count();

    let claims = result
        .verified_claims
        .iter()
        .map(|claim| {
            json!({
                "id": claim.id,
                "text": claim.claim_text,
                "confidence": claim.confidence,
                "level": claim.confidence_level.as_str(),
                "supporting_sources": claim.supporting_sources,
                "conflicting_sources": claim.conflicting_sources,
                "needs_recheck": claim.needs_recheck,
                "recheck_reason": claim.recheck_reason,
            })
        })
        .collect::<Vec<_>>();
    let sources = result
        .sources
        .iter()
        .map(|(id, source)| {
            (
                id.clone(),
                json!({
                    "id": source.id,
                    "url": source.url,
                    "title": source.title,
                    "domain": source.domain,
                    "credibility": source.credibility_score,
                    "type": source.source_type.as_str(),
                    "supports_claim": source.supports_claim,
                    "excerpt": source.excerpt,
                }),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();

    json!({
        "summary": {
            "overall_confidence": result.overall_confidence,
            "overall_level": confidence_level(result.overall_confidence).as_str(),
            "total_claims": result.verified_claims.len(),
            "high_confidence": high_count,
            "medium_confidence": medium_count,
            "low_confidence": low_count,
            "total_sources": result.sources.len(),
        },
        "claims": claims,
        "sources": sources,
    })
}

fn confidence_level(confidence: f64) -> ConfidenceLevel {
    if confidence >= 0.8 {
        ConfidenceLevel::High
    } else if confidence >= 0.5 {
        ConfidenceLevel::Medium
    } else if confidence >= 0.2 {
        ConfidenceLevel::Low
    } else {
        ConfidenceLevel::VeryLow
    }
}

#[utoipa::path(
    delete,
    path = "/api/verification/cache",
    operation_id = "clear_cache_api_verification_cache_delete",
    tag = "verification",
    summary = "Clear Cache",
    description = "Clear expired verification cache entries.\n\nAlso cleans up stale sandbox workspaces.",
    responses((status = 200, description = "Successful Response", body = VerificationObjectResponseSchema))
)]
pub async fn clear_cache(State(state): State<VerificationState>) -> Response {
    let Some(cache) = state.cache else {
        return http_detail(StatusCode::SERVICE_UNAVAILABLE, CACHE_PROVIDER_UNAVAILABLE);
    };
    let Some(workspace_cleaner) = state.workspace_cleaner else {
        return http_detail(
            StatusCode::SERVICE_UNAVAILABLE,
            WORKSPACE_CLEANER_UNAVAILABLE,
        );
    };

    let deleted_cache_entries = match cache.clear_expired().await {
        Ok(deleted) => deleted,
        Err(error) => {
            tracing::warn!(%error, "expired verification cache cleanup failed");
            0
        }
    };
    workspace_cleaner.schedule_stale_cleanup(24);
    Json(VerificationCacheClearResponse {
        deleted_cache_entries,
        workspace_cleanup: "scheduled".to_owned(),
    })
    .into_response()
}

/// Build the router exposing all six verification HTTP operations.
///
/// The host supplies the provider, cache, and workspace-cleaner adapters through
/// [`VerificationState::with_adapters`].
pub fn router(state: VerificationState) -> Router {
    Router::new()
        .route("/api/verification/status", get(get_verification_status))
        .route("/api/verification/domains", get(list_allowed_domains))
        .route("/api/verification/verify", post(verify_claims))
        .route(
            "/api/verification/verify/stream",
            post(verify_claims_stream),
        )
        .route("/api/verification/verify/json", post(verify_claims_json))
        .route("/api/verification/cache", delete(clear_cache))
        .with_state(state)
}

async fn run_verification(
    state: &VerificationState,
    request: VerificationRequest,
) -> Result<VerificationResult, String> {
    let Some(provider) = &state.provider else {
        return Err(VERIFICATION_PROVIDER_UNAVAILABLE.to_owned());
    };
    let expected_query = request.query.clone();
    let result = provider.verify(request, state.config.clone()).await?;
    validate_provider_result(&result, &expected_query, &state.config)?;
    Ok(result)
}

fn validate_provider_result(
    result: &VerificationResult,
    expected_query: &str,
    config: &VerificationConfig,
) -> Result<(), String> {
    if result.query != expected_query
        || !valid_confidence(result.overall_confidence)
        || result
            .verified_claims
            .iter()
            .any(|claim| !valid_confidence(claim.confidence))
        || result
            .sources
            .iter()
            .any(|(id, source)| id != &source.id || !valid_confidence(source.credibility_score))
    {
        return Err(INVALID_PROVIDER_RESULT.to_owned());
    }
    if result.sources.values().any(|source| {
        !source.id.starts_with("internal_")
            && !is_domain_allowed(&source.url, &config.allowed_domains)
    }) {
        return Err(INVALID_PROVIDER_RESULT.to_owned());
    }
    Ok(())
}

fn valid_confidence(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn http_detail(status: StatusCode, detail: &str) -> Response {
    (status, Json(json!({"detail": detail}))).into_response()
}

fn parse_verification_request(body: &[u8]) -> Result<VerificationRequest, HttpValidationError> {
    let input: Value = serde_json::from_slice(body).map_err(json_decode_error)?;
    let Some(fields) = input.as_object() else {
        return Err(HttpValidationError {
            detail: vec![validation_error(
                vec![ValidationLocation::Text("body".to_owned())],
                input,
                "model_type",
                "Input should be a valid dictionary or instance of VerificationRequest",
                None,
            )],
        });
    };
    let mut errors = Vec::new();
    let query = required_string(fields, "query", &input, vec![body_location()], &mut errors);
    let main_findings = parse_main_findings(fields, &input, &mut errors);
    let main_answer = optional_string(
        fields,
        "main_answer",
        &input,
        vec![body_location()],
        &mut errors,
    );
    let previous_claims = parse_previous_claims(fields, &input, &mut errors);
    if !errors.is_empty() {
        return Err(HttpValidationError { detail: errors });
    }
    Ok(VerificationRequest {
        query: query.expect("validated required query"),
        main_findings: main_findings.expect("validated main_findings"),
        main_answer,
        previous_claims: previous_claims.expect("validated previous_claims"),
    })
}

fn json_decode_error(error: serde_json::Error) -> HttpValidationError {
    HttpValidationError {
        detail: vec![validation_error(
            vec![body_location()],
            Value::Null,
            "json_invalid",
            "JSON decode error",
            Some(Map::from_iter([(
                "error".to_owned(),
                Value::String(error.to_string()),
            )])),
        )],
    }
}

fn body_location() -> ValidationLocation {
    ValidationLocation::Text("body".to_owned())
}

fn validation_error(
    loc: Vec<ValidationLocation>,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> ValidationError {
    ValidationError {
        loc,
        msg: message.to_owned(),
        error_type: error_type.to_owned(),
        input,
        ctx,
    }
}

fn field_location(mut prefix: Vec<ValidationLocation>, field: &str) -> Vec<ValidationLocation> {
    prefix.push(ValidationLocation::Text(field.to_owned()));
    prefix
}

fn required_string(
    fields: &Map<String, Value>,
    name: &str,
    whole_input: &Value,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<String> {
    match fields.get(name) {
        None => {
            errors.push(validation_error(
                field_location(prefix, name),
                whole_input.clone(),
                "missing",
                "Field required",
                None,
            ));
            None
        }
        Some(Value::String(value)) => Some(value.clone()),
        Some(value) => {
            errors.push(validation_error(
                field_location(prefix, name),
                value.clone(),
                "string_type",
                "Input should be a valid string",
                None,
            ));
            None
        }
    }
}

fn optional_string(
    fields: &Map<String, Value>,
    name: &str,
    _whole_input: &Value,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<String> {
    match fields.get(name) {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(value) => {
            errors.push(validation_error(
                field_location(prefix, name),
                value.clone(),
                "string_type",
                "Input should be a valid string",
                None,
            ));
            None
        }
    }
}

fn parse_main_findings(
    fields: &Map<String, Value>,
    _whole_input: &Value,
    errors: &mut Vec<ValidationError>,
) -> Option<Vec<Value>> {
    let Some(value) = fields.get("main_findings") else {
        return Some(Vec::new());
    };
    let Some(items) = value.as_array() else {
        errors.push(validation_error(
            field_location(vec![body_location()], "main_findings"),
            value.clone(),
            "list_type",
            "Input should be a valid list",
            None,
        ));
        return None;
    };
    let mut findings = Vec::with_capacity(items.len());
    let mut valid = true;
    for (index, item) in items.iter().enumerate() {
        if item.is_object() {
            findings.push(item.clone());
        } else {
            errors.push(validation_error(
                vec![
                    body_location(),
                    ValidationLocation::Text("main_findings".to_owned()),
                    ValidationLocation::Index(index as i64),
                ],
                item.clone(),
                "dict_type",
                "Input should be a valid dictionary",
                None,
            ));
            valid = false;
        }
    }
    valid.then_some(findings)
}

fn parse_previous_claims(
    fields: &Map<String, Value>,
    _whole_input: &Value,
    errors: &mut Vec<ValidationError>,
) -> Option<Vec<VerifiedClaim>> {
    let Some(value) = fields.get("previous_claims") else {
        return Some(Vec::new());
    };
    let Some(items) = value.as_array() else {
        errors.push(validation_error(
            field_location(vec![body_location()], "previous_claims"),
            value.clone(),
            "list_type",
            "Input should be a valid list",
            None,
        ));
        return None;
    };
    let mut claims = Vec::with_capacity(items.len());
    let mut valid = true;
    for (index, item) in items.iter().enumerate() {
        match parse_verified_claim(item, index) {
            Ok(claim) => claims.push(claim),
            Err(mut nested_errors) => {
                errors.append(&mut nested_errors);
                valid = false;
            }
        }
    }
    valid.then_some(claims)
}

fn parse_verified_claim(
    value: &Value,
    index: usize,
) -> Result<VerifiedClaim, Vec<ValidationError>> {
    let prefix = vec![
        body_location(),
        ValidationLocation::Text("previous_claims".to_owned()),
        ValidationLocation::Index(index as i64),
    ];
    let Some(fields) = value.as_object() else {
        return Err(vec![validation_error(
            prefix,
            value.clone(),
            "model_type",
            "Input should be a valid dictionary or instance of VerifiedClaim",
            None,
        )]);
    };
    let mut errors = Vec::new();
    let id = required_string(fields, "id", value, prefix.clone(), &mut errors);
    let claim_text = required_string(fields, "claim_text", value, prefix.clone(), &mut errors);
    let confidence = required_confidence(fields, "confidence", value, prefix.clone(), &mut errors);
    let confidence_level = required_confidence_level(fields, value, prefix.clone(), &mut errors);
    let supporting_sources =
        parse_string_array(fields, "supporting_sources", prefix.clone(), &mut errors);
    let conflicting_sources =
        parse_string_array(fields, "conflicting_sources", prefix.clone(), &mut errors);
    let footnotes = parse_integer_array(fields, prefix.clone(), &mut errors);
    let needs_recheck = parse_bool_default(fields, "needs_recheck", prefix.clone(), &mut errors);
    let recheck_reason = optional_string(fields, "recheck_reason", value, prefix, &mut errors);
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(VerifiedClaim {
        id: id.expect("validated required claim id"),
        claim_text: claim_text.expect("validated required claim text"),
        confidence: confidence.expect("validated claim confidence"),
        confidence_level: confidence_level.expect("validated claim confidence level"),
        supporting_sources: supporting_sources.expect("validated supporting_sources"),
        conflicting_sources: conflicting_sources.expect("validated conflicting_sources"),
        footnotes: footnotes.expect("validated footnotes"),
        needs_recheck: needs_recheck.expect("validated needs_recheck"),
        recheck_reason,
    })
}

fn required_confidence(
    fields: &Map<String, Value>,
    name: &str,
    whole_input: &Value,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<f64> {
    let Some(value) = fields.get(name) else {
        errors.push(validation_error(
            field_location(prefix, name),
            whole_input.clone(),
            "missing",
            "Field required",
            None,
        ));
        return None;
    };
    let Some(number) = value.as_f64() else {
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            "float_type",
            "Input should be a valid number",
            None,
        ));
        return None;
    };
    if !(0.0..=1.0).contains(&number) {
        let lower_bound = number < 0.0;
        let bound = if lower_bound { "ge" } else { "le" };
        let error_type = if lower_bound {
            "greater_than_equal"
        } else {
            "less_than_equal"
        };
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            error_type,
            if lower_bound {
                "Input should be greater than or equal to 0"
            } else {
                "Input should be less than or equal to 1"
            },
            Some(Map::from_iter([(
                bound.to_owned(),
                json!(if lower_bound { 0.0 } else { 1.0 }),
            )])),
        ));
        return None;
    }
    Some(number)
}

fn required_confidence_level(
    fields: &Map<String, Value>,
    whole_input: &Value,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<ConfidenceLevel> {
    let name = "confidence_level";
    let Some(value) = fields.get(name) else {
        errors.push(validation_error(
            field_location(prefix, name),
            whole_input.clone(),
            "missing",
            "Field required",
            None,
        ));
        return None;
    };
    let Some(level) = value.as_str() else {
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            "string_type",
            "Input should be a valid string",
            None,
        ));
        return None;
    };
    let parsed = match level {
        "high" => Some(ConfidenceLevel::High),
        "medium" => Some(ConfidenceLevel::Medium),
        "low" => Some(ConfidenceLevel::Low),
        "very_low" => Some(ConfidenceLevel::VeryLow),
        _ => None,
    };
    if parsed.is_none() {
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            "enum",
            "Input should be 'high', 'medium', 'low' or 'very_low'",
            Some(Map::from_iter([(
                "expected".to_owned(),
                Value::String("'high', 'medium', 'low' or 'very_low'".to_owned()),
            )])),
        ));
    }
    parsed
}

fn parse_string_array(
    fields: &Map<String, Value>,
    name: &str,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<Vec<String>> {
    let Some(value) = fields.get(name) else {
        return Some(Vec::new());
    };
    let Some(items) = value.as_array() else {
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            "list_type",
            "Input should be a valid list",
            None,
        ));
        return None;
    };
    let mut output = Vec::with_capacity(items.len());
    let mut valid = true;
    for (index, item) in items.iter().enumerate() {
        if let Some(value) = item.as_str() {
            output.push(value.to_owned());
        } else {
            let mut location = field_location(prefix.clone(), name);
            location.push(ValidationLocation::Index(index as i64));
            errors.push(validation_error(
                location,
                item.clone(),
                "string_type",
                "Input should be a valid string",
                None,
            ));
            valid = false;
        }
    }
    valid.then_some(output)
}

fn parse_integer_array(
    fields: &Map<String, Value>,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<Vec<Value>> {
    let name = "footnotes";
    let Some(value) = fields.get(name) else {
        return Some(Vec::new());
    };
    let Some(items) = value.as_array() else {
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            "list_type",
            "Input should be a valid list",
            None,
        ));
        return None;
    };
    let field_path = field_location(prefix, name);
    let mut output = Vec::with_capacity(items.len());
    let mut valid = true;
    for (index, item) in items.iter().enumerate() {
        let is_integer = item
            .as_number()
            .is_some_and(|number| number.as_i64().is_some() || number.as_u64().is_some());
        if is_integer {
            output.push(item.clone());
        } else {
            let mut location = field_path.clone();
            location.push(ValidationLocation::Index(index as i64));
            errors.push(validation_error(
                location,
                item.clone(),
                "int_type",
                "Input should be a valid integer",
                None,
            ));
            valid = false;
        }
    }
    valid.then_some(output)
}

fn parse_bool_default(
    fields: &Map<String, Value>,
    name: &str,
    prefix: Vec<ValidationLocation>,
    errors: &mut Vec<ValidationError>,
) -> Option<bool> {
    let Some(value) = fields.get(name) else {
        return Some(false);
    };
    if let Some(boolean) = value.as_bool() {
        Some(boolean)
    } else {
        errors.push(validation_error(
            field_location(prefix, name),
            value.clone(),
            "bool_type",
            "Input should be a valid boolean",
            None,
        ));
        None
    }
}
#[cfg(test)]
mod tests {
    use super::{
        clear_cache, is_domain_allowed, router, verify_claims, verify_claims_json, ConfidenceLevel,
        VerificationCache, VerificationConfig, VerificationFuture, VerificationRequest,
        VerificationResult, VerificationSourceInfo, VerificationSourceType, VerificationState,
        VerificationWorkspaceCleaner, VerifiedClaim, INVALID_PROVIDER_RESULT,
    };
    use axum::body::{to_bytes, Body, Bytes};
    use axum::extract::State;
    use axum::http::{Request, StatusCode};
    use axum::response::Response;
    use serde_json::{json, Value};
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;
    use utoipa::OpenApi;

    #[derive(utoipa::OpenApi)]
    #[openapi(paths(
        super::get_verification_status,
        super::verify_claims,
        super::verify_claims_stream,
        super::verify_claims_json,
        super::clear_cache,
        super::list_allowed_domains
    ))]
    struct VerificationOperationsDoc;

    fn config(enabled: bool) -> VerificationConfig {
        VerificationConfig {
            enabled,
            max_duration_seconds: 15,
            max_claims: 10,
            max_sources_per_claim: 5,
            cache_ttl_hours: 24,
            recheck_threshold: 0.4,
            allowed_domains: vec!["reuters.com".to_owned(), "apnews.com".to_owned()],
        }
    }

    fn fixture_result(query: String, source_url: &str) -> VerificationResult {
        let source = VerificationSourceInfo {
            id: "fixture-source-1".to_owned(),
            url: source_url.to_owned(),
            title: Some("Local verification fixture".to_owned()),
            domain: "www.reuters.com".to_owned(),
            credibility_score: 0.95,
            source_type: VerificationSourceType::Wire,
            published_at: Some("2024-05-17T00:00:00".to_owned()),
            supports_claim: true,
            excerpt: Some("A deterministic local source record.".to_owned()),
        };
        let claim = VerifiedClaim {
            id: "fixture-claim-1".to_owned(),
            claim_text: "A court published its decision on May 17, 2024.".to_owned(),
            confidence: 0.9,
            confidence_level: ConfidenceLevel::High,
            supporting_sources: vec![source.id.clone()],
            conflicting_sources: Vec::new(),
            footnotes: vec![json!(1)],
            needs_recheck: false,
            recheck_reason: None,
        };
        VerificationResult {
            query,
            overall_confidence: 0.9,
            overall_confidence_level: ConfidenceLevel::High,
            verified_claims: vec![claim],
            sources: BTreeMap::from([(source.id.clone(), source)]),
            markdown_report: "Fixture report".to_owned(),
            generated_at: "2024-05-17T12:00:00.000000".to_owned(),
            duration_ms: 12,
            error: None,
        }
    }

    struct LocalFixtureProvider {
        source_url: String,
    }

    impl super::VerificationProvider for LocalFixtureProvider {
        fn verify(
            &self,
            request: VerificationRequest,
            _config: VerificationConfig,
        ) -> VerificationFuture<VerificationResult> {
            let result = fixture_result(request.query, &self.source_url);
            Box::pin(async move { Ok(result) })
        }
    }

    struct PendingProvider;

    impl super::VerificationProvider for PendingProvider {
        fn verify(
            &self,
            _request: VerificationRequest,
            _config: VerificationConfig,
        ) -> VerificationFuture<VerificationResult> {
            Box::pin(std::future::pending())
        }
    }

    fn state_with_fixture(source_url: &str) -> VerificationState {
        VerificationState::with_adapters(
            config(true),
            Some(Arc::new(LocalFixtureProvider {
                source_url: source_url.to_owned(),
            })),
            None,
            None,
        )
    }

    async fn response_json(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        let body = serde_json::from_slice(&bytes).expect("JSON body");
        (status, body)
    }

    async fn response_text(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        (
            status,
            String::from_utf8(bytes.to_vec()).expect("UTF-8 response body"),
        )
    }

    #[tokio::test]
    async fn status_and_domain_routes_reflect_supplied_runtime_settings() {
        let app = router(VerificationState::unavailable(config(false)));
        let status = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/verification/status")
                    .body(Body::empty())
                    .expect("status request"),
            )
            .await
            .expect("status response");
        let (status_code, status_body) = response_json(status).await;
        assert_eq!(status_code, StatusCode::OK);
        assert_eq!(
            status_body,
            json!({
                "enabled": false,
                "max_duration_seconds": 15,
                "max_claims": 10,
                "max_sources_per_claim": 5,
                "cache_ttl_hours": 24,
                "recheck_threshold": 0.4,
                "allowed_domains_count": 2
            })
        );

        let domains = app
            .oneshot(
                Request::builder()
                    .uri("/api/verification/domains")
                    .body(Body::empty())
                    .expect("domains request"),
            )
            .await
            .expect("domains response");
        let (status_code, domains_body) = response_json(domains).await;
        assert_eq!(status_code, StatusCode::OK);
        assert_eq!(
            domains_body,
            json!({
                "count": 2,
                "domains": ["reuters.com", "apnews.com"]
            })
        );
    }

    #[test]
    fn allowlist_requires_an_exact_host_or_dot_delimited_subdomain() {
        let domains = vec!["reuters.com".to_owned(), "apnews.com".to_owned()];
        assert!(is_domain_allowed(
            "https://REUTERS.com:443/article",
            &domains
        ));
        assert!(is_domain_allowed(
            "https://world.reuters.com/story",
            &domains
        ));
        assert!(is_domain_allowed("//apnews.com/path", &domains));
        assert!(!is_domain_allowed(
            "https://reuters.com.attacker.invalid/story",
            &domains
        ));
        assert!(!is_domain_allowed(
            "https://not-allowed.invalid/story",
            &domains
        ));
        assert!(!is_domain_allowed("reuters.com/story", &domains));
    }

    #[test]
    fn domain_configuration_keeps_order_duplicates_and_python_whitespace() {
        assert_eq!(
            super::parse_domain_list(
                "\u{1c}reuters.com\u{1f}, apnews.com ,reuters.com,".to_owned()
            ),
            vec!["reuters.com", "apnews.com", "reuters.com"]
        );
    }

    #[tokio::test]
    async fn verification_handlers_validate_before_disabled_status_and_preserve_defaults() {
        let disabled = VerificationState::unavailable(config(false));
        let invalid = verify_claims(
            State(disabled.clone()),
            Bytes::from_static(br#"{"query":7}"#),
        )
        .await;
        let (status, body) = response_json(invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["detail"][0]["loc"], json!(["body", "query"]));
        assert_eq!(body["detail"][0]["type"], "string_type");

        let nested_invalid = verify_claims(
            State(disabled.clone()),
            Bytes::from_static(
                br#"{"query":"court decision","previous_claims":[{"id":"prior","claim_text":"A prior claim.","confidence":1.5,"confidence_level":"high"}]}"#,
            ),
        )
        .await;
        let (status, body) = response_json(nested_invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body["detail"][0]["loc"],
            json!(["body", "previous_claims", 0, "confidence"])
        );
        assert_eq!(body["detail"][0]["type"], "less_than_equal");
        assert_eq!(body["detail"][0]["ctx"]["le"], 1.0);

        let disabled_response = verify_claims(
            State(disabled),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_json(disabled_response).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body, json!({"detail": "Verification is disabled"}));

        let request =
            super::parse_verification_request(br#"{"query":"court decision","ignored":true}"#)
                .expect("valid request with defaulted fields");
        assert!(request.main_findings.is_empty());
        assert!(request.main_answer.is_none());
        assert!(request.previous_claims.is_empty());
    }

    #[tokio::test]
    async fn verify_handler_returns_provider_result_and_rejects_disallowed_sources() {
        let success = verify_claims(
            State(state_with_fixture("https://world.reuters.com/story")),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_json(success).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["query"], "court decision");
        assert_eq!(body["verified_claims"][0]["id"], "fixture-claim-1");
        assert_eq!(
            body["sources"]["fixture-source-1"]["credibility_score"],
            0.95
        );

        let rejected = verify_claims(
            State(state_with_fixture(
                "https://reuters.com.attacker.invalid/story",
            )),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_json(rejected).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["detail"],
            format!("Verification failed: {INVALID_PROVIDER_RESULT}")
        );
    }

    #[tokio::test]
    async fn verify_route_enforces_the_outer_timeout() {
        let mut runtime_config = config(true);
        runtime_config.max_duration_seconds = -5;
        let state = VerificationState::with_adapters(
            runtime_config,
            Some(Arc::new(PendingProvider)),
            None,
            None,
        );
        let response = verify_claims(
            State(state),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_json(response).await;
        assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(body, json!({"detail": "Verification timed out"}));
    }

    #[tokio::test]
    async fn json_handler_builds_summary_claim_and_source_projection() {
        let response = verify_claims_json(
            State(state_with_fixture("https://reuters.com/story")),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_json(response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["summary"],
            json!({
                "overall_confidence": 0.9,
                "overall_level": "high",
                "total_claims": 1,
                "high_confidence": 1,
                "medium_confidence": 0,
                "low_confidence": 0,
                "total_sources": 1
            })
        );
        assert_eq!(
            body["claims"][0]["text"],
            "A court published its decision on May 17, 2024."
        );
        assert!(body["claims"][0].get("footnotes").is_none());
        assert_eq!(body["sources"]["fixture-source-1"]["type"], "wire");
        assert_eq!(body["sources"]["fixture-source-1"]["credibility"], 0.95);
    }

    #[tokio::test]
    async fn missing_providers_fail_explicitly_without_success_shaped_results() {
        let state = VerificationState::unavailable(config(true));
        let verify = verify_claims(
            State(state.clone()),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_json(verify).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["detail"],
            "Verification failed: Verification provider is not available"
        );

        let json_result = verify_claims_json(
            State(state.clone()),
            Bytes::from_static(br#"{"query":"court decision"}"#),
        )
        .await;
        let (status, body) = response_text(json_result).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body, "Internal Server Error");

        let cache = clear_cache(State(state)).await;
        let (status, body) = response_json(cache).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            body["detail"],
            "Verification cache provider is not available"
        );
    }

    struct LocalExpiredCache {
        expired_rows: Arc<Mutex<Vec<bool>>>,
    }

    impl VerificationCache for LocalExpiredCache {
        fn clear_expired(&self) -> VerificationFuture<usize> {
            let rows = self.expired_rows.clone();
            Box::pin(async move {
                let mut rows = rows.lock().expect("cache rows");
                let initial = rows.len();
                rows.retain(|expired| !expired);
                Ok(initial - rows.len())
            })
        }
    }

    struct FailingCache;

    impl VerificationCache for FailingCache {
        fn clear_expired(&self) -> VerificationFuture<usize> {
            Box::pin(async { Err("database unavailable".to_owned()) })
        }
    }

    struct LocalWorkspaceScheduler(Arc<AtomicI64>);

    impl VerificationWorkspaceCleaner for LocalWorkspaceScheduler {
        fn schedule_stale_cleanup(&self, max_age_hours: i64) {
            self.0.store(max_age_hours, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn cache_route_deletes_expired_rows_and_schedules_workspace_cleanup() {
        let rows = Arc::new(Mutex::new(vec![true, false, true]));
        let scheduled_age = Arc::new(AtomicI64::new(0));
        let state = VerificationState::with_adapters(
            config(true),
            None,
            Some(Arc::new(LocalExpiredCache {
                expired_rows: rows.clone(),
            })),
            Some(Arc::new(LocalWorkspaceScheduler(scheduled_age.clone()))),
        );
        let (status, body) = response_json(clear_cache(State(state)).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"deleted_cache_entries": 2, "workspace_cleanup": "scheduled"})
        );
        assert_eq!(*rows.lock().expect("remaining cache rows"), vec![false]);
        assert_eq!(scheduled_age.load(Ordering::SeqCst), 24);
    }

    #[tokio::test]
    async fn cache_cleanup_error_matches_python_zero_count_and_still_schedules_workspaces() {
        let scheduled_age = Arc::new(AtomicI64::new(0));
        let state = VerificationState::with_adapters(
            config(true),
            None,
            Some(Arc::new(FailingCache)),
            Some(Arc::new(LocalWorkspaceScheduler(scheduled_age.clone()))),
        );
        let (status, body) = response_json(clear_cache(State(state)).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"deleted_cache_entries": 0, "workspace_cleanup": "scheduled"})
        );
        assert_eq!(scheduled_age.load(Ordering::SeqCst), 24);
    }

    #[test]
    fn module_annotations_retain_all_six_requested_contracts() {
        let document = serde_json::to_value(VerificationOperationsDoc::openapi())
            .expect("verification OpenAPI JSON");
        for (path, method, operation_id) in [
            (
                "/api/verification/status",
                "get",
                "get_verification_status_api_verification_status_get",
            ),
            (
                "/api/verification/verify",
                "post",
                "verify_claims_api_verification_verify_post",
            ),
            (
                "/api/verification/verify/stream",
                "post",
                "verify_claims_stream_api_verification_verify_stream_post",
            ),
            (
                "/api/verification/verify/json",
                "post",
                "verify_claims_json_api_verification_verify_json_post",
            ),
            (
                "/api/verification/cache",
                "delete",
                "clear_cache_api_verification_cache_delete",
            ),
            (
                "/api/verification/domains",
                "get",
                "list_allowed_domains_api_verification_domains_get",
            ),
        ] {
            assert_eq!(document["paths"][path][method]["operationId"], operation_id);
        }

        for path in [
            "/api/verification/verify",
            "/api/verification/verify/stream",
            "/api/verification/verify/json",
        ] {
            let operation = &document["paths"][path]["post"];
            assert_eq!(
                operation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
                "#/components/schemas/VerificationRequest",
                "{path} request schema"
            );
            let has_response_schema = operation["responses"]["200"]["content"]
                .as_object()
                .and_then(|content| content.values().find_map(|media| media.get("schema")))
                .is_some_and(|schema| schema.is_object());
            assert!(has_response_schema, "{path} successful response schema");
            assert_eq!(
                operation["responses"]["422"]["content"]["application/json"]["schema"]["$ref"],
                "#/components/schemas/HTTPValidationError",
                "{path} validation error schema"
            );
        }
        assert_eq!(
            document["paths"]["/api/verification/verify"]["post"]["responses"]["200"]["content"]
                ["application/json"]["schema"]["$ref"],
            "#/components/schemas/VerificationResult"
        );

        let cache_operation = &document["paths"]["/api/verification/cache"]["delete"];
        assert!(cache_operation["requestBody"].is_null());
        let has_cache_response_schema = cache_operation["responses"]["200"]["content"]
            .as_object()
            .and_then(|content| content.values().find_map(|media| media.get("schema")))
            .is_some_and(|schema| schema.is_object());
        assert!(has_cache_response_schema);
    }
    mod route_tests {
        include!("../../../tests/test_rust_verification_routes.rs");
    }
}
