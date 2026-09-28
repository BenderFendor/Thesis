//! Rust-side contract assembly for article extraction and analysis.
//!
//! Fetching publisher pages and invoking an LLM are external provider concerns. This
//! module therefore accepts explicit sidecars instead of embedding a network client or
//! inventing an analysis fallback. It owns validation, deterministic language
//! diagnostics, response shaping, and the public status/null/error contract.

use std::collections::BTreeMap;
use std::future::Future;
use std::iter::FromIterator;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{
    AdditionalProperties, AnyOfBuilder, ArrayBuilder, ObjectBuilder, Type,
};
use utoipa::openapi::{RefOr, Schema};
use utoipa::ToSchema;

use crate::discovery::FreeFormObjectResponseSchema;
use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

/// A future returned by an article-analysis sidecar.
pub type SidecarFuture<T> = Pin<Box<dyn Future<Output = Result<T, SidecarError>> + Send>>;

/// A provider failure that can safely cross the sidecar boundary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidecarError {
    message: String,
}

impl SidecarError {
    /// Create a sidecar error with the public error message to return to clients.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    fn message_or<'a>(&'a self, fallback: &'a str) -> &'a str {
        if self.message.trim().is_empty() {
            fallback
        } else {
            &self.message
        }
    }
}

/// Canonical extraction data returned by the external fetch/parser sidecar.
///
/// The sidecar is responsible for fetching a URL and may use the deterministic
/// `thesis-ingest` extractor. It must not claim success without non-whitespace text.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ArticleExtractionPayload {
    /// Whether extraction succeeded.
    pub success: bool,
    /// Article body text when extraction succeeds.
    pub text: Option<String>,
    /// Article title, when present.
    #[serde(default)]
    pub title: Option<String>,
    /// Author names, in source order.
    #[serde(default)]
    pub authors: Vec<String>,
    /// Publication date, when present.
    #[serde(default)]
    pub publish_date: Option<String>,
    /// Public extraction error when `success` is false.
    #[serde(default)]
    pub error: Option<String>,
}

/// Input supplied to the external article-analysis provider.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArticleAnalysisInput {
    /// URL of the article being analyzed.
    pub article_url: String,
    /// Extracted full text.
    pub full_text: String,
    /// Extracted title, when present.
    pub title: Option<String>,
    /// Extracted authors.
    pub authors: Vec<String>,
    /// Extracted publication date, when present.
    pub publish_date: Option<String>,
    /// Client-provided source name, when present.
    pub source_name: Option<String>,
}

/// Sidecar boundary for URL fetching and deterministic article extraction.
///
/// Implementations own HTTP(S)-only validation, redirect limits, timeout,
/// content-type checks, SSRF protection, and any cache policy. This crate does
/// not make a network request or silently fall back to a different provider.
pub trait ArticleExtractionSidecar: Send + Sync {
    /// Fetch and extract one URL without performing network work in this crate.
    fn extract(&self, url: String) -> SidecarFuture<ArticleExtractionPayload>;
    /// Whether the fetch and extraction provider is configured.
    fn is_configured(&self) -> bool {
        true
    }
}

/// Sidecar boundary for external article analysis providers.
pub trait ArticleAnalysisSidecar: Send + Sync {
    /// Analyze extracted article data and return the provider's decoded JSON object.
    fn analyze(&self, input: ArticleAnalysisInput) -> SidecarFuture<Value>;
    /// Whether the article-analysis model provider is configured.
    fn is_configured(&self) -> bool {
        true
    }
}

/// State required by the two article-analysis operations.
#[derive(Clone)]
pub struct ArticleAnalysisState {
    /// External extraction/fetch sidecar.
    pub extraction: Arc<dyn ArticleExtractionSidecar>,
    /// External analysis/LLM sidecar.
    pub analysis: Arc<dyn ArticleAnalysisSidecar>,
}

impl ArticleAnalysisState {
    /// Build state with explicit extraction and analysis providers.
    pub fn new(
        extraction: Arc<dyn ArticleExtractionSidecar>,
        analysis: Arc<dyn ArticleAnalysisSidecar>,
    ) -> Self {
        Self {
            extraction,
            analysis,
        }
    }

    /// Build a state whose sidecars fail explicitly rather than inventing results.
    ///
    /// Use this when the router exposes article-analysis routes without configured
    /// extraction or analysis providers. Constructing a state with real sidecars
    /// remains unchanged.
    pub fn unavailable() -> Self {
        Self::new(
            Arc::new(UnavailableArticleExtraction),
            Arc::new(UnavailableArticleAnalysis),
        )
    }

    /// Whether the fetch and extraction provider is configured.
    pub fn is_extraction_configured(&self) -> bool {
        self.extraction.is_configured()
    }

    /// Whether the article-analysis model provider is configured.
    pub fn is_analysis_configured(&self) -> bool {
        self.analysis.is_configured()
    }

    /// Whether both article-analysis providers are configured.
    pub fn is_configured(&self) -> bool {
        self.is_extraction_configured() && self.is_analysis_configured()
    }
}

struct UnavailableArticleExtraction;

impl ArticleExtractionSidecar for UnavailableArticleExtraction {
    fn extract(&self, _url: String) -> SidecarFuture<ArticleExtractionPayload> {
        Box::pin(async {
            Err(SidecarError::new(
                "Article extraction sidecar is unavailable",
            ))
        })
    }
    fn is_configured(&self) -> bool {
        false
    }
}

struct UnavailableArticleAnalysis;

impl ArticleAnalysisSidecar for UnavailableArticleAnalysis {
    fn analyze(&self, _input: ArticleAnalysisInput) -> SidecarFuture<Value> {
        Box::pin(async { Err(SidecarError::new("Article analysis sidecar is unavailable")) })
    }
    fn is_configured(&self) -> bool {
        false
    }
}

/// FastAPI-compatible request body for article analysis.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct ArticleAnalysisRequest {
    /// Article URL to fetch and analyze.
    pub url: String,
    /// Optional display/source name passed to the provider.
    #[serde(default)]
    pub source_name: Option<String>,
}

/// FastAPI-compatible request body for article language diagnostics.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct LanguageDiagnosticsRequest {
    /// Article URL used when text must be extracted.
    pub url: String,
    /// Text supplied directly by the caller, when available.
    #[serde(default)]
    pub text: Option<String>,
    /// Optional title used in diagnostics.
    #[serde(default)]
    pub title: Option<String>,
    /// Optional source label accepted by the FastAPI contract.
    #[serde(default)]
    pub source_name: Option<String>,
}

/// Severity emitted by language diagnostics.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = ArticleAnalysisDiagnosticStatus)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DiagnosticStatus {
    /// Below the medium threshold.
    Low,
    /// At least the medium threshold and below high.
    Medium,
    /// At least the high threshold.
    High,
}

/// One sentence example in a language diagnostic metric.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = ArticleAnalysisDiagnosticExample)]
pub(crate) struct LanguageDiagnosticExample {
    /// Matching sentence.
    pub sentence: String,
    /// Matched term, when applicable.
    pub term: Option<String>,
    /// Matched pattern, when applicable.
    pub pattern: Option<String>,
    /// Diagnostic category, when applicable.
    pub category: Option<String>,
}

/// One language diagnostic metric.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[schema(as = ArticleAnalysisDiagnosticMetric)]
pub(crate) struct LanguageDiagnosticMetric {
    /// Number of matching examples.
    #[schema(value_type = i64)]
    pub count: usize,
    /// Match rate over sentences.
    pub rate: f64,
    /// Severity for this metric.
    pub status: DiagnosticStatus,
    /// Bounded example list.
    pub examples: Vec<LanguageDiagnosticExample>,
}

/// Aggregate language diagnostic score and summary.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[schema(as = ArticleAnalysisDiagnosticOverall)]
pub(crate) struct LanguageDiagnosticOverall {
    /// Weighted score.
    pub score: f64,
    /// Aggregate severity.
    pub status: DiagnosticStatus,
    /// User-facing summary.
    pub summary: String,
}

/// FastAPI-compatible language diagnostics nested in the analysis response.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[schema(as = ArticleAnalysisLanguageDiagnosticsResponse)]
pub(crate) struct LanguageDiagnosticsResponse {
    /// Whether diagnostics succeeded.
    pub success: bool,
    /// URL associated with diagnostics.
    pub article_url: String,
    /// Article title, when present.
    pub title: Option<String>,
    /// Number of sentences.
    #[schema(required = false, default = 0, value_type = i64)]
    pub sentence_count: usize,
    /// Number of words.
    #[schema(required = false, default = 0, value_type = i64)]
    pub word_count: usize,
    /// Passive-voice metric.
    pub passive_voice: Option<LanguageDiagnosticMetric>,
    /// Actor-omission metric.
    pub actor_omission: Option<LanguageDiagnosticMetric>,
    /// Euphemism metric.
    pub euphemisms: Option<LanguageDiagnosticMetric>,
    /// Sanitized-language metric.
    pub sanitized_language: Option<LanguageDiagnosticMetric>,
    /// Aggregate result.
    pub overall: Option<LanguageDiagnosticOverall>,
    /// Diagnostics error, when unsuccessful.
    pub error: Option<String>,
}

/// FastAPI-compatible article-analysis response.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub(crate) struct ArticleAnalysisResponse {
    /// Whether the complete analysis succeeded.
    pub success: bool,
    /// URL supplied by the caller.
    pub article_url: String,
    /// Extracted full text, when available.
    pub full_text: Option<String>,
    /// Extracted title, when available.
    pub title: Option<String>,
    /// Extracted authors, when available.
    #[schema(schema_with = optional_string_array_schema)]
    pub authors: Option<Vec<String>>,
    /// Extracted publication date, when available.
    pub publish_date: Option<String>,
    /// Provider source analysis.
    #[schema(schema_with = optional_free_form_object_schema)]
    pub source_analysis: Option<BTreeMap<String, Value>>,
    /// Provider reporter analysis.
    #[schema(schema_with = optional_free_form_object_schema)]
    pub reporter_analysis: Option<BTreeMap<String, Value>>,
    /// Provider framing/bias analysis.
    #[schema(schema_with = optional_free_form_object_schema)]
    pub bias_analysis: Option<BTreeMap<String, Value>>,
    /// Provider fact-check suggestions.
    #[schema(schema_with = optional_string_array_schema)]
    pub fact_check_suggestions: Option<Vec<String>>,
    /// Provider fact-check result objects.
    #[schema(schema_with = optional_free_form_object_array_schema)]
    pub fact_check_results: Option<Vec<BTreeMap<String, Value>>>,
    /// Provider grounding metadata.
    #[schema(schema_with = optional_free_form_object_schema)]
    pub grounding_metadata: Option<BTreeMap<String, Value>>,
    /// Deterministic language diagnostics.
    pub language_diagnostics: Option<LanguageDiagnosticsResponse>,
    /// Provider summary.
    pub summary: Option<String>,
    /// Public error, when analysis failed.
    pub error: Option<String>,
}

/// Free-form object response shape used by `GET /article/extract`.
pub(crate) type ArticleExtractHttpResponse = BTreeMap<String, Value>;

fn free_form_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

fn free_form_object_array_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(free_form_object_schema())
        .build()
        .into()
}

fn optional_free_form_object_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(free_form_object_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn optional_free_form_object_array_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(free_form_object_array_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn optional_string_array_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ArrayBuilder::new()
                    .items(ObjectBuilder::new().schema_type(Type::String).build())
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

#[utoipa::path(
    get,
    path = "/article/extract",
    operation_id = "extract_article_text_article_extract_get",
    tag = "article-analysis",
    params(("url" = String, Query, description = "Article URL")),
    responses(
        (status = 200, description = "Successful Response", body = inline(FreeFormObjectResponseSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_article_extract(
    State(state): State<ArticleAnalysisState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let url = match parse_extract_query(raw_query.as_deref()) {
        Ok(url) => url,
        Err(error) => return error.into_response(),
    };

    let extraction_result = if state.extraction.is_configured() {
        state.extraction.extract(url.clone()).await
    } else {
        Err(SidecarError::new(
            "Article extraction sidecar is unavailable",
        ))
    };
    let payload = match extraction_result {
        Ok(payload) => payload,
        Err(error) => {
            return extraction_failure_response(url, error.message_or("Failed to extract article"));
        }
    };
    if !payload.success {
        let error = payload
            .error
            .as_deref()
            .unwrap_or("No article text extracted");
        return extraction_failure_response(url, error);
    }

    let response = ArticleExtractHttpResponse::from_iter([
        ("success".to_owned(), Value::Bool(true)),
        ("url".to_owned(), Value::String(url)),
        ("text".to_owned(), json!(payload.text)),
        ("title".to_owned(), json!(payload.title)),
        ("authors".to_owned(), json!(payload.authors)),
        ("publish_date".to_owned(), json!(payload.publish_date)),
    ]);
    Json(response).into_response()
}

#[utoipa::path(
    post,
    path = "/api/article/analyze",
    operation_id = "analyze_article_api_article_analyze_post",
    tag = "article-analysis",
    request_body = ArticleAnalysisRequest,
    responses(
        (status = 200, description = "Successful Response", body = ArticleAnalysisResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn post_article_analysis(
    State(state): State<ArticleAnalysisState>,
    body: Bytes,
) -> Response {
    let request = match parse_analysis_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let article_url = request.url.clone();
    let extraction_result = if state.extraction.is_configured() {
        state.extraction.extract(article_url.clone()).await
    } else {
        Err(SidecarError::new(
            "Article extraction sidecar is unavailable",
        ))
    };
    let payload = match extraction_result {
        Ok(payload) => payload,
        Err(error) => {
            return Json(failed_analysis_response(
                article_url,
                error.message_or("Failed to extract article content"),
            ))
            .into_response();
        }
    };
    if !payload.success {
        let error = payload
            .error
            .as_deref()
            .unwrap_or("Failed to extract article content");
        return Json(failed_analysis_response(article_url, error)).into_response();
    }

    let full_text = payload.text.clone();
    let diagnostics = build_language_diagnostics(
        &article_url,
        payload.title.as_deref(),
        full_text.as_deref().unwrap_or(""),
    );
    let provider_input = ArticleAnalysisInput {
        article_url: article_url.clone(),
        full_text: full_text.clone().unwrap_or_default(),
        title: payload.title.clone(),
        authors: payload.authors.clone(),
        publish_date: payload.publish_date.clone(),
        source_name: request.source_name,
    };
    let analysis_result = state.analysis.analyze(provider_input).await;
    let analysis_value = match analysis_result {
        Ok(value) => value,
        Err(error) => {
            return Json(failed_analysis_with_extraction(
                article_url,
                full_text,
                payload,
                diagnostics,
                error.message_or("Article analysis provider failed"),
            ))
            .into_response();
        }
    };
    let analysis = match parse_provider_analysis(analysis_value) {
        Ok(analysis) => analysis,
        Err(error) => {
            return Json(failed_analysis_with_extraction(
                article_url,
                full_text,
                payload,
                diagnostics,
                error.message_or("Invalid analysis response"),
            ))
            .into_response();
        }
    };

    Json(ArticleAnalysisResponse {
        success: true,
        article_url,
        full_text,
        title: payload.title,
        authors: Some(payload.authors),
        publish_date: payload.publish_date,
        source_analysis: analysis.source_analysis,
        reporter_analysis: analysis.reporter_analysis,
        bias_analysis: analysis.bias_analysis,
        fact_check_suggestions: analysis.fact_check_suggestions,
        fact_check_results: analysis.fact_check_results,
        grounding_metadata: analysis.grounding_metadata,
        language_diagnostics: Some(diagnostics),
        summary: analysis.summary,
        error: None,
    })
    .into_response()
}

#[utoipa::path(
    post,
    path = "/api/article/language-diagnostics",
    operation_id = "analyze_article_language_api_article_language_diagnostics_post",
    tag = "article-analysis",
    request_body = LanguageDiagnosticsRequest,
    responses(
        (status = 200, description = "Successful Response", body = LanguageDiagnosticsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn post_article_language_diagnostics(
    State(state): State<ArticleAnalysisState>,
    body: Bytes,
) -> Response {
    let request = match parse_language_diagnostics_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let LanguageDiagnosticsRequest {
        url,
        text,
        title,
        source_name: _,
    } = request;

    if let Some(text) = text.filter(|text| !text.is_empty()) {
        return Json(build_language_diagnostics(&url, title.as_deref(), &text)).into_response();
    }

    let extraction_result = if state.extraction.is_configured() {
        state.extraction.extract(url.clone()).await
    } else {
        Err(SidecarError::new(
            "Article extraction sidecar is unavailable",
        ))
    };
    let payload = match extraction_result {
        Ok(payload) if payload.success => payload,
        Ok(payload) => {
            return Json(language_diagnostics_failure_response(
                url,
                title,
                payload
                    .error
                    .as_deref()
                    .unwrap_or("Failed to extract article content"),
            ))
            .into_response();
        }
        Err(error) => {
            return Json(language_diagnostics_failure_response(
                url,
                title,
                error.message_or("Failed to extract article content"),
            ))
            .into_response();
        }
    };
    let text = payload.text.unwrap_or_default();
    let title = title.filter(|title| !title.is_empty()).or(payload.title);

    Json(build_language_diagnostics(&url, title.as_deref(), &text)).into_response()
}

fn language_diagnostics_failure_response(
    article_url: String,
    title: Option<String>,
    error: &str,
) -> LanguageDiagnosticsResponse {
    LanguageDiagnosticsResponse {
        success: false,
        article_url,
        title,
        sentence_count: 0,
        word_count: 0,
        passive_voice: None,
        actor_omission: None,
        euphemisms: None,
        sanitized_language: None,
        overall: None,
        error: Some(error.to_owned()),
    }
}

fn extraction_failure_response(url: String, error: &str) -> Response {
    let payload = ArticleExtractHttpResponse::from_iter([
        ("success".to_owned(), Value::Bool(false)),
        ("url".to_owned(), Value::String(url)),
        ("error".to_owned(), Value::String(error.to_owned())),
    ]);
    Json(payload).into_response()
}

fn failed_analysis_response(url: String, error: &str) -> ArticleAnalysisResponse {
    ArticleAnalysisResponse {
        success: false,
        article_url: url,
        full_text: None,
        title: None,
        authors: None,
        publish_date: None,
        source_analysis: None,
        reporter_analysis: None,
        bias_analysis: None,
        fact_check_suggestions: None,
        fact_check_results: None,
        grounding_metadata: None,
        language_diagnostics: None,
        summary: None,
        error: Some(error.to_owned()),
    }
}

fn failed_analysis_with_extraction(
    article_url: String,
    full_text: Option<String>,
    payload: ArticleExtractionPayload,
    diagnostics: LanguageDiagnosticsResponse,
    error: &str,
) -> ArticleAnalysisResponse {
    ArticleAnalysisResponse {
        success: false,
        article_url,
        full_text,
        title: payload.title,
        authors: Some(payload.authors),
        publish_date: payload.publish_date,
        source_analysis: None,
        reporter_analysis: None,
        bias_analysis: None,
        fact_check_suggestions: None,
        fact_check_results: None,
        grounding_metadata: None,
        language_diagnostics: Some(diagnostics),
        summary: None,
        error: Some(error.to_owned()),
    }
}

#[derive(Debug, Deserialize)]
struct ProviderAnalysis {
    #[serde(default)]
    source_analysis: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    reporter_analysis: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    bias_analysis: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    fact_check_suggestions: Option<Vec<String>>,
    #[serde(default)]
    fact_check_results: Option<Vec<BTreeMap<String, Value>>>,
    #[serde(default)]
    grounding_metadata: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    summary: Option<String>,
}

fn parse_provider_analysis(value: Value) -> Result<ProviderAnalysis, SidecarError> {
    let Some(object) = value.as_object() else {
        return Err(SidecarError::new("Invalid analysis response"));
    };

    // Python's route treats the parse-error sentinel as a successful empty
    // analysis because `raw_response` is present.
    if object.contains_key("error") && !object.contains_key("raw_response") {
        let message = object
            .get("error")
            .and_then(Value::as_str)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or("Invalid analysis response");
        return Err(SidecarError::new(message));
    }

    serde_json::from_value(value).map_err(|_| SidecarError::new("Invalid analysis response"))
}

fn build_language_diagnostics(
    article_url: &str,
    title: Option<&str>,
    text: &str,
) -> LanguageDiagnosticsResponse {
    let payload = thesis_search::language_diagnostics::analyze_language_diagnostics(text, title);
    LanguageDiagnosticsResponse {
        success: true,
        article_url: article_url.to_owned(),
        title: title.map(str::to_owned),
        sentence_count: payload.sentence_count,
        word_count: payload.word_count,
        passive_voice: Some(convert_metric(&payload.passive_voice)),
        actor_omission: Some(convert_metric(&payload.actor_omission)),
        euphemisms: Some(convert_metric(&payload.euphemisms)),
        sanitized_language: Some(convert_metric(&payload.sanitized_language)),
        overall: Some(LanguageDiagnosticOverall {
            score: payload.overall.score,
            status: convert_status(payload.overall.status),
            summary: payload.overall.summary,
        }),
        error: None,
    }
}

fn convert_metric(
    metric: &thesis_search::language_diagnostics::DiagnosticMetric,
) -> LanguageDiagnosticMetric {
    LanguageDiagnosticMetric {
        count: metric.count,
        rate: metric.rate,
        status: convert_status(metric.status),
        examples: metric
            .examples
            .iter()
            .map(|example| LanguageDiagnosticExample {
                sentence: example.sentence.clone(),
                term: example.term.clone(),
                pattern: example.pattern.clone(),
                category: example.category.clone(),
            })
            .collect(),
    }
}

fn convert_status(
    status: thesis_search::language_diagnostics::DiagnosticStatus,
) -> DiagnosticStatus {
    match status {
        thesis_search::language_diagnostics::DiagnosticStatus::Low => DiagnosticStatus::Low,
        thesis_search::language_diagnostics::DiagnosticStatus::Medium => DiagnosticStatus::Medium,
        thesis_search::language_diagnostics::DiagnosticStatus::High => DiagnosticStatus::High,
    }
}

fn parse_language_diagnostics_request(
    body: &[u8],
) -> Result<LanguageDiagnosticsRequest, HttpValidationError> {
    let value: Value = serde_json::from_slice(body).map_err(|error| HttpValidationError {
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
    })?;
    let Some(fields) = value.as_object() else {
        return Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    };
    let Some(url) = fields.get("url") else {
        return Err(HttpValidationError::field(
            value,
            "url",
            "missing",
            "Field required",
        ));
    };
    let Some(url) = url.as_str() else {
        return Err(HttpValidationError::field(
            url.clone(),
            "url",
            "string_type",
            "Input should be a valid string",
        ));
    };

    let text = parse_optional_string(fields, "text")?;
    let title = parse_optional_string(fields, "title")?;
    let source_name = parse_optional_string(fields, "source_name")?;
    Ok(LanguageDiagnosticsRequest {
        url: url.to_owned(),
        text,
        title,
        source_name,
    })
}

fn parse_optional_string(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, HttpValidationError> {
    match fields.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(value) => Err(HttpValidationError::field(
            value.clone(),
            field,
            "string_type",
            "Input should be a valid string",
        )),
    }
}

fn parse_analysis_request(body: &[u8]) -> Result<ArticleAnalysisRequest, HttpValidationError> {
    let value: Value = serde_json::from_slice(body).map_err(|error| HttpValidationError {
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
    })?;
    let Some(fields) = value.as_object() else {
        return Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    };
    let Some(url) = fields.get("url") else {
        return Err(HttpValidationError::field(
            value,
            "url",
            "missing",
            "Field required",
        ));
    };
    let Some(url) = url.as_str() else {
        return Err(HttpValidationError::field(
            url.clone(),
            "url",
            "string_type",
            "Input should be a valid string",
        ));
    };
    let source_name = match fields.get("source_name") {
        None | Some(Value::Null) => None,
        Some(value) => Some(
            value
                .as_str()
                .ok_or_else(|| {
                    HttpValidationError::field(
                        value.clone(),
                        "source_name",
                        "string_type",
                        "Input should be a valid string",
                    )
                })?
                .to_owned(),
        ),
    };
    Ok(ArticleAnalysisRequest {
        url: url.to_owned(),
        source_name,
    })
}

fn parse_extract_query(raw_query: Option<&str>) -> Result<String, HttpValidationError> {
    let Some(raw_query) = raw_query else {
        return Err(query_error(Value::Null, "url", "missing", "Field required"));
    };

    let mut url = None;
    for pair in raw_query.split('&').filter(|pair| !pair.is_empty()) {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = percent_decode_query_component(raw_key).map_err(|_| {
            query_error(
                Value::String(raw_key.to_owned()),
                "url",
                "query_string_parsing",
                "Invalid query string",
            )
        })?;
        if key != "url" {
            continue;
        }
        let value = percent_decode_query_component(raw_value).map_err(|_| {
            query_error(
                Value::String(raw_value.to_owned()),
                "url",
                "query_string_parsing",
                "Invalid query string",
            )
        })?;
        url = Some(value);
    }
    url.ok_or_else(|| query_error(Value::Null, "url", "missing", "Field required"))
}

fn query_error(input: Value, field: &str, error_type: &str, message: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
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

fn percent_decode_query_component(value: &str) -> Result<String, ()> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let high = hex_digit(bytes[index + 1]).ok_or(())?;
                let low = hex_digit(bytes[index + 2]).ok_or(())?;
                decoded.push((high << 4) | low);
                index += 3;
            }
            b'%' => return Err(()),
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
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
    use std::sync::Arc;

    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::routing::{get, post};
    use axum::Router;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::{
        get_article_extract, parse_analysis_request, parse_extract_query,
        parse_language_diagnostics_request, post_article_analysis,
        post_article_language_diagnostics, ArticleAnalysisInput, ArticleAnalysisSidecar,
        ArticleAnalysisState, ArticleExtractionPayload, ArticleExtractionSidecar, SidecarError,
        SidecarFuture,
    };

    struct CapturedExtraction {
        payload: ArticleExtractionPayload,
    }

    impl ArticleExtractionSidecar for CapturedExtraction {
        fn extract(&self, _url: String) -> SidecarFuture<ArticleExtractionPayload> {
            let payload = self.payload.clone();
            Box::pin(async move { Ok(payload) })
        }
    }

    struct CapturedAnalysis {
        payload: Value,
    }

    impl ArticleAnalysisSidecar for CapturedAnalysis {
        fn analyze(&self, _input: ArticleAnalysisInput) -> SidecarFuture<Value> {
            let payload = self.payload.clone();
            Box::pin(async move { Ok(payload) })
        }
    }

    struct FailingAnalysis {
        error: String,
    }

    impl ArticleAnalysisSidecar for FailingAnalysis {
        fn analyze(&self, _input: ArticleAnalysisInput) -> SidecarFuture<Value> {
            let error = self.error.clone();
            Box::pin(async move { Err(SidecarError::new(error)) })
        }
    }

    struct UnconfiguredAnalysis;

    impl ArticleAnalysisSidecar for UnconfiguredAnalysis {
        fn analyze(&self, _input: ArticleAnalysisInput) -> SidecarFuture<Value> {
            Box::pin(async { Err(SidecarError::new("OpenRouter API key not configured")) })
        }

        fn is_configured(&self) -> bool {
            false
        }
    }

    fn state(extraction: ArticleExtractionPayload, analysis: Value) -> ArticleAnalysisState {
        ArticleAnalysisState::new(
            Arc::new(CapturedExtraction {
                payload: extraction,
            }),
            Arc::new(CapturedAnalysis { payload: analysis }),
        )
    }

    fn valid_extraction() -> ArticleExtractionPayload {
        ArticleExtractionPayload {
            success: true,
            text: Some("The captured article body.".to_owned()),
            title: Some("Captured title".to_owned()),
            authors: vec!["Jane Doe".to_owned()],
            publish_date: Some("2026-09-20".to_owned()),
            error: None,
        }
    }
    #[test]
    fn article_analysis_state_reports_each_provider_configuration() {
        let configured = state(valid_extraction(), serde_json::json!({}));
        assert!(configured.is_extraction_configured());
        assert!(configured.is_analysis_configured());
        assert!(configured.is_configured());

        let unavailable = ArticleAnalysisState::unavailable();
        assert!(!unavailable.is_extraction_configured());
        assert!(!unavailable.is_analysis_configured());
        assert!(!unavailable.is_configured());
    }

    #[test]
    fn extract_query_accepts_encoded_urls_and_ignores_unknown_fields() {
        assert_eq!(
            parse_extract_query(Some("ignored=1&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc"))
                .expect("query"),
            "https://example.com/a?b=c"
        );
        let error = parse_extract_query(None).expect_err("missing url");
        assert_eq!(error.detail[0].error_type, "missing");
        assert!(matches!(
            &error.detail[0].loc[0],
            super::ValidationLocation::Text(location) if location == "query"
        ));
    }

    #[test]
    fn analysis_request_preserves_strict_string_and_nullable_source_validation() {
        assert_eq!(
            parse_analysis_request(br#"{"url":"https://example.com","source_name":null}"#)
                .expect("request")
                .source_name,
            None
        );
        for body in [
            br#"{}"#.as_slice(),
            br#"{"url":null}"#.as_slice(),
            br#"{"url":4}"#.as_slice(),
        ] {
            assert_eq!(
                parse_analysis_request(body)
                    .expect_err("invalid request")
                    .detail
                    .len(),
                1
            );
        }
    }

    #[tokio::test]
    async fn extraction_route_keeps_fastapi_success_and_failure_shapes() {
        let router = Router::new()
            .route("/article/extract", get(get_article_extract))
            .with_state(state(valid_extraction(), serde_json::json!({})));
        let response = router
            .clone()
            .oneshot(
                Request::get("/article/extract?url=https%3A%2F%2Fexample.com%2Fstory")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["url"], "https://example.com/story");
        assert_eq!(payload["authors"][0], "Jane Doe");

        let failure_router = Router::new()
            .route("/article/extract", get(get_article_extract))
            .with_state(state(
                ArticleExtractionPayload {
                    success: false,
                    text: None,
                    title: None,
                    authors: Vec::new(),
                    publish_date: None,
                    error: Some("No article text extracted".to_owned()),
                },
                serde_json::json!({}),
            ));
        let failure = failure_router
            .oneshot(
                Request::get("/article/extract?url=https%3A%2F%2Fexample.com%2Fstory")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(failure.status(), StatusCode::OK);
        let body = to_bytes(failure.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(
            payload,
            serde_json::json!({
                "success": false,
                "url": "https://example.com/story",
                "error": "No article text extracted"
            })
        );
    }

    #[tokio::test]
    async fn unavailable_sidecars_return_explicit_fastapi_compatible_failures() {
        let router = Router::new()
            .route("/article/extract", get(get_article_extract))
            .route("/api/article/analyze", post(post_article_analysis))
            .with_state(ArticleAnalysisState::unavailable());

        let extraction_response = router
            .clone()
            .oneshot(
                Request::get("/article/extract?url=https%3A%2F%2Fexample.com%2Fstory")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(extraction_response.status(), StatusCode::OK);
        let body = to_bytes(extraction_response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(
            payload,
            serde_json::json!({
                "success": false,
                "url": "https://example.com/story",
                "error": "Article extraction sidecar is unavailable"
            })
        );

        let analysis_response = router
            .oneshot(
                Request::post("/api/article/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"url":"https://example.com/story"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(analysis_response.status(), StatusCode::OK);
        let body = to_bytes(analysis_response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(
            payload,
            serde_json::json!({
                "success": false,
                "article_url": "https://example.com/story",
                "full_text": null,
                "title": null,
                "authors": null,
                "publish_date": null,
                "source_analysis": null,
                "reporter_analysis": null,
                "bias_analysis": null,
                "fact_check_suggestions": null,
                "fact_check_results": null,
                "grounding_metadata": null,
                "language_diagnostics": null,
                "summary": null,
                "error": "Article extraction sidecar is unavailable"
            })
        );
    }

    #[tokio::test]
    async fn unconfigured_analysis_returns_the_fastapi_configuration_error() {
        let state = ArticleAnalysisState::new(
            Arc::new(CapturedExtraction {
                payload: valid_extraction(),
            }),
            Arc::new(UnconfiguredAnalysis),
        );
        assert!(!state.is_analysis_configured());
        let router = Router::new()
            .route("/api/article/analyze", post(post_article_analysis))
            .with_state(state);
        let response = router
            .oneshot(
                Request::post("/api/article/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"url":"https://example.com/story"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], false);
        assert_eq!(payload["full_text"], "The captured article body.");
        assert_eq!(payload["error"], "OpenRouter API key not configured");
    }
    #[tokio::test]
    async fn analysis_route_returns_diagnostics_and_null_optional_fields() {
        let router = Router::new()
            .route("/api/article/analyze", post(post_article_analysis))
            .with_state(state(
                valid_extraction(),
                serde_json::json!({"summary": "Captured summary"}),
            ));
        let response = router
            .oneshot(
                Request::post("/api/article/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"url":"https://example.com/story","source_name":null,"extra":true}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["summary"], "Captured summary");
        assert!(payload["language_diagnostics"].is_object());
        assert!(payload["source_analysis"].is_null());
        assert!(payload["error"].is_null());
    }

    #[tokio::test]
    async fn analysis_sidecar_failure_preserves_extraction_and_null_analysis_fields() {
        let router = Router::new()
            .route("/api/article/analyze", post(post_article_analysis))
            .with_state(ArticleAnalysisState {
                extraction: Arc::new(CapturedExtraction {
                    payload: valid_extraction(),
                }),
                analysis: Arc::new(FailingAnalysis {
                    error: "OpenRouter API key not configured".to_owned(),
                }),
            });
        let response = router
            .oneshot(
                Request::post("/api/article/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"url":"https://example.com/story"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], false);
        assert_eq!(payload["article_url"], "https://example.com/story");
        assert_eq!(payload["full_text"], "The captured article body.");
        assert_eq!(payload["title"], "Captured title");
        assert_eq!(payload["authors"], serde_json::json!(["Jane Doe"]));
        assert_eq!(payload["publish_date"], "2026-09-20");
        assert_eq!(payload["error"], "OpenRouter API key not configured");
        assert_eq!(payload["language_diagnostics"]["success"], true);
        for field in [
            "source_analysis",
            "reporter_analysis",
            "bias_analysis",
            "fact_check_suggestions",
            "fact_check_results",
            "grounding_metadata",
            "summary",
        ] {
            assert!(payload[field].is_null(), "{field} must remain null");
        }
    }

    #[tokio::test]
    async fn raw_response_parse_error_matches_fastapi_success_with_null_analysis() {
        let router = Router::new()
            .route("/api/article/analyze", post(post_article_analysis))
            .with_state(state(
                valid_extraction(),
                serde_json::json!({
                    "error": "Failed to parse analysis results",
                    "raw_response": "not-json"
                }),
            ));
        let response = router
            .oneshot(
                Request::post("/api/article/analyze")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"url":"https://example.com/story"}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], true);
        assert!(payload["error"].is_null());
        assert!(payload["summary"].is_null());
        assert!(payload["source_analysis"].is_null());
        assert!(payload["raw_response"].is_null());
    }

    #[tokio::test]
    async fn language_diagnostics_uses_caller_text_without_fetching() {
        let router = Router::new()
            .route(
                "/api/article/language-diagnostics",
                post(post_article_language_diagnostics),
            )
            .with_state(ArticleAnalysisState::unavailable());
        let response = router
            .oneshot(
                Request::post("/api/article/language-diagnostics")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"url":"https://example.com/story","text":"The article states the new policy was approved.","title":"Caller title"}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["article_url"], "https://example.com/story");
        assert_eq!(payload["title"], "Caller title");
        assert_eq!(payload["word_count"], 8);
        assert_eq!(payload["sentence_count"], 1);
        assert!(payload["overall"].is_object());
    }

    #[tokio::test]
    async fn language_diagnostics_extracts_falsey_text_and_uses_extracted_title() {
        let router = Router::new()
            .route(
                "/api/article/language-diagnostics",
                post(post_article_language_diagnostics),
            )
            .with_state(state(valid_extraction(), serde_json::json!({})));
        let response = router
            .oneshot(
                Request::post("/api/article/language-diagnostics")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"url":"https://example.com/story","text":"","title":""}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["article_url"], "https://example.com/story");
        assert_eq!(payload["title"], "Captured title");
        assert_eq!(payload["word_count"], 4);
        assert_eq!(payload["sentence_count"], 1);
    }

    #[tokio::test]
    async fn language_diagnostics_extraction_failure_returns_fastapi_null_fields() {
        let router = Router::new()
            .route(
                "/api/article/language-diagnostics",
                post(post_article_language_diagnostics),
            )
            .with_state(ArticleAnalysisState::unavailable());
        let response = router
            .oneshot(
                Request::post("/api/article/language-diagnostics")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"url":"https://example.com/story","title":"Requested title"}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let payload: Value = serde_json::from_slice(&body).expect("JSON");
        assert_eq!(
            payload,
            serde_json::json!({
                "success": false,
                "article_url": "https://example.com/story",
                "title": "Requested title",
                "sentence_count": 0,
                "word_count": 0,
                "passive_voice": null,
                "actor_omission": null,
                "euphemisms": null,
                "sanitized_language": null,
                "overall": null,
                "error": "Article extraction sidecar is unavailable"
            })
        );
    }
}
