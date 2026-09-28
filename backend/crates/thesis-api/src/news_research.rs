//! HTTP contract for news research and model selection.
//!
//! Article retrieval and the agent graph depend on Chroma, SQL, external search,
//! and provider SDKs that are not part of `thesis-api`. The sidecar boundary keeps
//! those semantics explicit; absent integrations fail instead of returning a
//! fabricated answer. Streaming bodies are passed through so dropping the response
//! body drops the provider stream and its in-flight work.

use std::env;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::RawQuery;
use axum::http::header::{CACHE_CONTROL, CONNECTION, CONTENT_TYPE};
use axum::http::{Response, StatusCode};
use axum::response::{IntoResponse, Response as AxumResponse};
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, ArrayBuilder, ObjectBuilder};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, ToSchema};

use crate::cache_stream::CacheStreamEmptyResponseSchema;
use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const OPENROUTER_DEFAULT_MODEL: &str = "z-ai/glm-4.5-air:free";
const OPENCODE_DEFAULT_MODEL: &str = "mimo-v2.5-free";
const LLAMACPP_DEFAULT_MODEL: &str = "local";

/// A future returned by the news-research integration.
pub type NewsResearchFuture<T> = Pin<Box<dyn Future<Output = Result<T, NewsResearchError>> + Send>>;

/// A failure from the agent or retrieval integration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NewsResearchError {
    /// The required retrieval or provider integration is not configured.
    ProviderUnavailable,
    /// A configured integration failed. The message is used only in stream error events.
    ProviderFailed(String),
}

impl NewsResearchError {
    fn message(&self) -> &str {
        match self {
            Self::ProviderUnavailable => "Research agent provider is not available",
            Self::ProviderFailed(message) => message,
        }
    }
}

/// Request accepted by `POST /api/news/research`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = NewsResearchRequest)]
pub struct NewsResearchRequest {
    /// User's research question.
    pub query: String,
    /// Include provider reasoning steps in the response.
    #[serde(default = "default_include_thinking")]
    #[schema(required = false, default = true)]
    pub include_thinking: bool,
    /// Optional configured research model id.
    #[serde(default)]
    #[schema(required = false)]
    pub model: Option<String>,
}

const fn default_include_thinking() -> bool {
    true
}

/// A thinking step returned by the research agent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = ThinkingStep)]
pub struct ThinkingStep {
    pub r#type: String,
    pub content: String,
    pub timestamp: String,
}

/// A response from the non-streaming research operation.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[schema(as = NewsResearchResponse)]
pub struct NewsResearchResponse {
    pub success: bool,
    pub query: String,
    pub answer: String,
    #[serde(default)]
    #[schema(required = false)]
    pub thinking_steps: Vec<ThinkingStep>,
    #[serde(default)]
    #[schema(required = false, default = 0)]
    pub articles_searched: i64,
    #[serde(default)]
    #[schema(required = false, schema_with = research_articles_schema)]
    pub referenced_articles: Vec<Value>,
    #[serde(default)]
    #[schema(required = false)]
    pub source_providers: Vec<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub error: Option<String>,
}

/// One model exposed by the research-model catalog.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = ResearchModelOption)]
pub struct ResearchModelOption {
    pub id: String,
    pub label: String,
    pub model: String,
    pub provider: String,
}

/// Models configured for the active research provider.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[schema(as = ResearchModelCatalog)]
pub struct ResearchModelCatalog {
    #[serde(default)]
    #[schema(required = false)]
    pub default: Option<String>,
    #[serde(default)]
    #[schema(required = false)]
    pub models: Vec<ResearchModelOption>,
    pub provider: String,
}

impl ResearchModelCatalog {
    /// Read only the active provider's public model settings from process environment.
    /// Credentials are used to determine availability and are never returned.
    pub fn from_environment() -> Self {
        research_model_catalog(|name| env::var(name).ok())
    }
}

/// Articles found by the retrieval sidecar before agent synthesis.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResearchArticleSnapshot {
    /// Articles in semantic, keyword, then recent retrieval order, deduplicated by the sidecar.
    pub articles: Vec<Value>,
}

/// Input to the non-streaming research agent after retrieval.
#[derive(Clone, Debug, PartialEq)]
pub struct ResearchAgentInput {
    pub query: String,
    pub articles: Vec<Value>,
    pub include_thinking: bool,
    pub model: Option<String>,
}

/// Parsed query input to the streaming research operation.
#[derive(Clone, Debug, PartialEq)]
pub struct NewsResearchStreamRequest {
    pub query: String,
    pub include_thinking: bool,
    /// Valid JSON history, matching Python's behavior of ignoring malformed JSON.
    pub history: Option<Value>,
    pub model: Option<String>,
}

/// Runtime integration for research retrieval, synthesis, and incremental SSE generation.
///
/// Implementations must preserve `news_research.py` retrieval order/deduplication,
/// `news_research_agent.py` model selection and tool behavior, and the existing
/// `data: <json>\\n\\n` stream framing. The body must be lazy: its first emitted
/// chunk is the starting status event, before article retrieval or model work.
/// Each later event is yielded incrementally with bounded backpressure. Dropping
/// the body must cancel its request and provider stream without detached tasks.
pub trait NewsResearchProvider: Send + Sync {
    /// Load semantic, keyword, and recent articles for one query.
    fn retrieve_articles(&self, query: String) -> NewsResearchFuture<ResearchArticleSnapshot>;

    /// Run the configured research agent against retrieved articles.
    fn research(&self, input: ResearchAgentInput) -> NewsResearchFuture<NewsResearchResponse>;

    /// Construct a lazy, incremental event stream for one request.
    fn stream(&self, input: NewsResearchStreamRequest) -> Body;
    /// Whether configured retrieval and model providers are available.
    fn is_configured(&self) -> bool {
        true
    }
}

/// State needed by the research routes.
#[derive(Clone)]
pub struct NewsResearchState {
    catalog: ResearchModelCatalog,
    provider: Option<Arc<dyn NewsResearchProvider>>,
}

impl NewsResearchState {
    /// Build state with explicit catalog and optional live provider.
    pub fn new(
        catalog: ResearchModelCatalog,
        provider: Option<Arc<dyn NewsResearchProvider>>,
    ) -> Self {
        Self { catalog, provider }
    }

    /// Build state with the process-configured catalog and no research provider.
    pub fn unavailable() -> Self {
        Self::new(ResearchModelCatalog::from_environment(), None)
    }

    /// Build state with the process-configured catalog and a research provider.
    pub fn with_provider(provider: impl NewsResearchProvider + 'static) -> Self {
        Self::new(
            ResearchModelCatalog::from_environment(),
            Some(Arc::new(provider)),
        )
    }
    /// Whether a research provider is configured.
    pub fn is_configured(&self) -> bool {
        self.provider
            .as_ref()
            .is_some_and(|provider| provider.is_configured())
    }
}

impl Default for NewsResearchState {
    fn default() -> Self {
        Self::unavailable()
    }
}

/// Construct the three news-research routes with their runtime provider state.
pub(crate) fn router(state: NewsResearchState) -> Router {
    Router::new()
        .route("/api/news/research/models", get(research_models_endpoint))
        .route(
            "/api/news/research/stream",
            get(news_research_stream_endpoint),
        )
        .route("/api/news/research", post(news_research_endpoint))
        .with_state(state)
}

fn research_articles_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(
            ObjectBuilder::new()
                .additional_properties(Some(AdditionalProperties::FreeForm(true)))
                .build(),
        )
        .build()
        .into()
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ResearchStreamParameters {
    pub query: String,
    #[param(required = false, default = true)]
    pub include_thinking: Option<bool>,
    #[param(required = false, nullable = true)]
    pub history: Option<String>,
    #[param(required = false, nullable = true)]
    pub model: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/news/research/models",
    operation_id = "research_models_endpoint_api_news_research_models_get",
    tag = "news-research",
    summary = "Research Models Endpoint",
    description = "List models configured for the research agent.",
    responses((status = 200, description = "Successful Response", body = ResearchModelCatalog))
)]
pub(crate) async fn research_models_endpoint(
    axum::extract::State(state): axum::extract::State<NewsResearchState>,
) -> Json<ResearchModelCatalog> {
    Json(state.catalog)
}

#[utoipa::path(
    get,
    path = "/api/news/research/stream",
    operation_id = "news_research_stream_endpoint_api_news_research_stream_get",
    tag = "news-research",
    summary = "News Research Stream Endpoint",
    description = "News Research Stream Endpoint.",
    params(ResearchStreamParameters),
    responses(
        (status = 200, description = "Successful Response", body = CacheStreamEmptyResponseSchema),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn news_research_stream_endpoint(
    axum::extract::State(state): axum::extract::State<NewsResearchState>,
    RawQuery(raw_query): RawQuery,
) -> AxumResponse {
    let input = match parse_stream_query(raw_query.as_deref()) {
        Ok(input) => input,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider.filter(|provider| provider.is_configured()) else {
        return stream_response(stream_error_body(
            &NewsResearchError::ProviderUnavailable,
            input.model.as_deref(),
        ));
    };
    stream_response(provider.stream(input))
}

#[utoipa::path(
    post,
    path = "/api/news/research",
    operation_id = "news_research_endpoint_api_news_research_post",
    tag = "news-research",
    summary = "News Research Endpoint",
    description = "News Research Endpoint.",
    request_body = NewsResearchRequest,
    responses(
        (status = 200, description = "Successful Response", body = NewsResearchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn news_research_endpoint(
    axum::extract::State(state): axum::extract::State<NewsResearchState>,
    body: Bytes,
) -> AxumResponse {
    let request = match parse_research_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider.filter(|provider| provider.is_configured()) else {
        tracing::error!("news research provider is not configured");
        return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
    };
    let articles = match provider.retrieve_articles(request.query.clone()).await {
        Ok(articles) => articles,
        Err(error) => {
            tracing::error!(message = %error.message(), "news research article retrieval failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let mut response = match provider
        .research(ResearchAgentInput {
            query: request.query,
            articles: articles.articles,
            include_thinking: request.include_thinking,
            model: request.model,
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::error!(message = %error.message(), "news research agent failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    if !request.include_thinking {
        response.thinking_steps.clear();
    }
    Json(response).into_response()
}

fn stream_response(body: Body) -> AxumResponse {
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/event-stream")
        .header(CACHE_CONTROL, "no-cache")
        .header(CONNECTION, "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(body)
        .expect("valid news-research stream response")
}

fn stream_error_body(error: &NewsResearchError, model: Option<&str>) -> Body {
    let (code, message, retryable) = match error {
        NewsResearchError::ProviderUnavailable => (
            "provider_unavailable",
            "Research agent provider is not available",
            false,
        ),
        NewsResearchError::ProviderFailed(message) => {
            let lower_message = message.to_lowercase();
            let rate_limited = ["rate limit", "quota", "429", "too many requests"]
                .iter()
                .any(|needle| lower_message.contains(needle));
            let timed_out = lower_message.contains("timeout");
            let upstream_unavailable = ["503", "502", "endpoint is unavailable"]
                .iter()
                .any(|needle| lower_message.contains(needle));
            let friendly_message = if rate_limited {
                "The selected model is rate-limited. Choose another model or try again later."
            } else if timed_out {
                "Request Timeout: The research took too long. Try a simpler query."
            } else if upstream_unavailable {
                "The model provider is temporarily unavailable. Your research activity has been kept. Retry or choose another model."
            } else {
                message
            };
            (
                if rate_limited {
                    "rate_limit"
                } else {
                    "research_error"
                },
                friendly_message,
                rate_limited || timed_out || upstream_unavailable,
            )
        }
    };
    let starting = json!({
        "type": "status",
        "message": "Starting research.",
        "model": model,
        "timestamp": Utc::now().to_rfc3339(),
    });
    let payload = json!({
        "type": "error",
        "message": message,
        "code": code,
        "model": model,
        "retryable": retryable,
        "timestamp": Utc::now().to_rfc3339(),
    });
    Body::from(format!("data: {starting}\n\ndata: {payload}\n\n"))
}

fn research_model_catalog(get: impl Fn(&str) -> Option<String>) -> ResearchModelCatalog {
    let provider = get("LLM_BACKEND").unwrap_or_else(|| "openrouter".to_owned());
    let models = match provider.as_str() {
        "opencode" if get("OPENCODE_API_KEY").is_some_and(|key| !key.is_empty()) => {
            let default_model =
                get("OPENCODE_MODEL").unwrap_or_else(|| OPENCODE_DEFAULT_MODEL.to_owned());
            let mut candidates = vec![default_model];
            if let Some(additional) = get("OPENCODE_RESEARCH_MODELS") {
                candidates.extend(
                    additional
                        .split(',')
                        .map(str::trim)
                        .filter(|model| !model.is_empty())
                        .map(str::to_owned),
                );
            }
            let mut models = Vec::with_capacity(candidates.len());
            for model in candidates {
                if !model.is_empty()
                    && !models
                        .iter()
                        .any(|item: &ResearchModelOption| item.model == model)
                {
                    models.push(model_option("opencode", model, "OpenCode Zen"));
                }
            }
            models
        }
        "openrouter" if get("OPEN_ROUTER_API_KEY").is_some_and(|key| !key.is_empty()) => {
            vec![model_option(
                "openrouter",
                get("OPEN_ROUTER_MODEL").unwrap_or_else(|| OPENROUTER_DEFAULT_MODEL.to_owned()),
                "OpenRouter",
            )]
        }
        "gemini" if get("GEMINI_API_KEY").is_some_and(|key| !key.is_empty()) => vec![model_option(
            "gemini",
            get("GEMINI_MODEL").unwrap_or_else(|| "gemini-3-flash-preview".to_owned()),
            "Google Gemini",
        )],
        "llamacpp" => vec![model_option(
            "llamacpp",
            get("LLAMACPP_MODEL").unwrap_or_else(|| LLAMACPP_DEFAULT_MODEL.to_owned()),
            "Local llama.cpp",
        )],
        _ => Vec::new(),
    };
    let default = models.first().map(|model| model.id.clone());
    ResearchModelCatalog {
        default,
        models,
        provider,
    }
}

fn model_option(provider: &str, model: String, label: &str) -> ResearchModelOption {
    ResearchModelOption {
        id: format!("{provider}:{model}"),
        label: label.to_owned(),
        model,
        provider: provider.to_owned(),
    }
}

fn parse_research_request(body: &[u8]) -> Result<NewsResearchRequest, HttpValidationError> {
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
    let query = fields.get("query").ok_or_else(|| {
        HttpValidationError::field(value.clone(), "query", "missing", "Field required")
    })?;
    let Some(query) = query.as_str() else {
        return Err(HttpValidationError::field(
            query.clone(),
            "query",
            "string_type",
            "Input should be a valid string",
        ));
    };
    let include_thinking = match fields.get("include_thinking") {
        None => true,
        Some(Value::Bool(value)) => *value,
        Some(input) => {
            return Err(HttpValidationError::field(
                input.clone(),
                "include_thinking",
                "bool_type",
                "Input should be a valid boolean",
            ));
        }
    };
    let model = match fields.get("model") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(input) => {
            return Err(HttpValidationError::field(
                input.clone(),
                "model",
                "string_type",
                "Input should be a valid string",
            ));
        }
    };
    Ok(NewsResearchRequest {
        query: query.to_owned(),
        include_thinking,
        model,
    })
}

fn parse_stream_query(
    raw_query: Option<&str>,
) -> Result<NewsResearchStreamRequest, HttpValidationError> {
    let mut query: Option<String> = None;
    let mut include_thinking: Option<String> = None;
    let mut history: Option<String> = None;
    let mut model: Option<String> = None;
    for pair in raw_query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query_component(raw_key).map_err(|_| {
            stream_query_error(
                "query",
                Value::String(raw_key.to_owned()),
                "query_string_parsing",
                "Invalid query string",
            )
        })?;
        let value = decode_query_component(raw_value).map_err(|_| {
            stream_query_error(
                &key,
                Value::String(raw_value.to_owned()),
                "query_string_parsing",
                "Invalid query string",
            )
        })?;
        match key.as_str() {
            "query" => query = Some(value),
            "include_thinking" => include_thinking = Some(value),
            "history" => history = Some(value),
            "model" => model = Some(value),
            _ => {}
        }
    }
    let query = query
        .ok_or_else(|| stream_query_error("query", Value::Null, "missing", "Field required"))?;
    let include_thinking = match include_thinking.as_deref() {
        None => true,
        Some("1" | "true" | "t" | "yes" | "y" | "on") => true,
        Some("0" | "false" | "f" | "no" | "n" | "off") => false,
        Some(value) => match value.to_ascii_lowercase().as_str() {
            "1" | "true" | "t" | "yes" | "y" | "on" => true,
            "0" | "false" | "f" | "no" | "n" | "off" => false,
            _ => {
                return Err(stream_query_error(
                    "include_thinking",
                    Value::String(value.to_owned()),
                    "bool_parsing",
                    "Input should be a valid boolean, unable to interpret input",
                ));
            }
        },
    };
    let history = history
        .filter(|history| !history.is_empty())
        .and_then(|history| serde_json::from_str(&history).ok());
    Ok(NewsResearchStreamRequest {
        query,
        include_thinking,
        history,
        model,
    })
}

fn stream_query_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
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

fn decode_query_component(value: &str) -> Result<String, ()> {
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
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use axum::body::{to_bytes, Body};
    use axum::http::header::CONTENT_TYPE;
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use super::{
        parse_research_request, parse_stream_query, research_model_catalog, NewsResearchFuture,
        NewsResearchProvider, NewsResearchResponse, NewsResearchState, NewsResearchStreamRequest,
        ResearchAgentInput, ResearchArticleSnapshot, ResearchModelCatalog, ResearchModelOption,
        ThinkingStep,
    };

    const FIXTURE_ARTICLE: &str = "Carbon pricing lowered emissions";

    struct FixtureResearchProvider {
        configured: bool,
    }

    impl NewsResearchProvider for FixtureResearchProvider {
        fn retrieve_articles(&self, query: String) -> NewsResearchFuture<ResearchArticleSnapshot> {
            Box::pin(async move {
                let query_terms = query
                    .to_lowercase()
                    .split_ascii_whitespace()
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                let article = json!({
                    "id": 21,
                    "title": FIXTURE_ARTICLE,
                    "source": "Climate Review",
                    "summary": "The report found emissions fell after carbon pricing began.",
                    "url": "https://example.test/carbon-pricing"
                });
                let haystack = format!(
                    "{} {}",
                    article["title"].as_str().unwrap_or_default(),
                    article["summary"].as_str().unwrap_or_default()
                )
                .to_lowercase();
                let articles = if query_terms.iter().all(|term| haystack.contains(term)) {
                    vec![article]
                } else {
                    Vec::new()
                };
                Ok(ResearchArticleSnapshot { articles })
            })
        }

        fn research(&self, input: ResearchAgentInput) -> NewsResearchFuture<NewsResearchResponse> {
            Box::pin(async move {
                let referenced_articles = input
                    .articles
                    .first()
                    .cloned()
                    .into_iter()
                    .collect::<Vec<_>>();
                let answer = referenced_articles
                    .first()
                    .and_then(|article| article["summary"].as_str())
                    .map(|summary| format!("The archive reports: {summary}"))
                    .unwrap_or_else(|| "No matching archive article was found.".to_owned());
                let thinking_steps = if input.include_thinking {
                    vec![ThinkingStep {
                        r#type: "thought".to_owned(),
                        content: "Checked the local article archive.".to_owned(),
                        timestamp: "2026-09-25T00:00:00+00:00".to_owned(),
                    }]
                } else {
                    Vec::new()
                };
                Ok(NewsResearchResponse {
                    success: !referenced_articles.is_empty(),
                    query: input.query,
                    answer,
                    thinking_steps,
                    articles_searched: input.articles.len() as i64,
                    referenced_articles,
                    source_providers: if input.articles.is_empty() {
                        Vec::new()
                    } else {
                        vec!["internal".to_owned()]
                    },
                    error: None,
                })
            })
        }

        fn stream(&self, _input: NewsResearchStreamRequest) -> Body {
            Body::empty()
        }
        fn is_configured(&self) -> bool {
            self.configured
        }
    }

    fn catalog_fixture() -> ResearchModelCatalog {
        ResearchModelCatalog {
            default: Some("openrouter:fixture-model".to_owned()),
            models: vec![ResearchModelOption {
                id: "openrouter:fixture-model".to_owned(),
                label: "OpenRouter".to_owned(),
                model: "fixture-model".to_owned(),
                provider: "openrouter".to_owned(),
            }],
            provider: "openrouter".to_owned(),
        }
    }
    #[test]
    fn research_state_reports_provider_configuration() {
        assert!(!NewsResearchState::new(catalog_fixture(), None).is_configured());
        assert!(NewsResearchState::new(
            catalog_fixture(),
            Some(Arc::new(FixtureResearchProvider { configured: true })),
        )
        .is_configured());
        assert!(!NewsResearchState::new(
            catalog_fixture(),
            Some(Arc::new(FixtureResearchProvider { configured: false })),
        )
        .is_configured());
    }

    #[test]
    fn model_catalog_tracks_only_models_available_for_the_active_provider() {
        let settings = BTreeMap::from([
            ("LLM_BACKEND", "opencode"),
            ("OPENCODE_API_KEY", "secret"),
            ("OPENCODE_MODEL", "zen-default"),
            ("OPENCODE_RESEARCH_MODELS", "zen-default, zen-extra,,"),
            ("OPEN_ROUTER_API_KEY", "stale-secret"),
            ("OPEN_ROUTER_MODEL", "stale-model"),
        ]);
        let catalog =
            research_model_catalog(|name| settings.get(name).map(|value| value.to_string()));
        assert_eq!(catalog.provider, "opencode");
        assert_eq!(catalog.default.as_deref(), Some("opencode:zen-default"));
        assert_eq!(
            catalog
                .models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["opencode:zen-default", "opencode:zen-extra"]
        );
    }

    #[tokio::test]
    async fn models_route_returns_the_configured_catalog_shape() {
        let response = super::router(NewsResearchState::new(catalog_fixture(), None))
            .oneshot(
                Request::get("/api/news/research/models")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("body"),
        )
        .expect("JSON");
        assert_eq!(
            payload,
            json!({
                "default": "openrouter:fixture-model",
                "models": [{
                    "id": "openrouter:fixture-model",
                    "label": "OpenRouter",
                    "model": "fixture-model",
                    "provider": "openrouter"
                }],
                "provider": "openrouter"
            })
        );
    }

    #[test]
    fn research_request_is_strict_for_known_fields_and_defaults_thinking() {
        let request = parse_research_request(br#"{"query":"carbon pricing","future":true}"#)
            .expect("valid request");
        assert!(request.include_thinking);
        assert_eq!(request.model, None);
        assert!(
            parse_research_request(br#"{"query":"carbon","include_thinking":"true"}"#).is_err()
        );
        assert!(parse_research_request(br#"{"query":4}"#).is_err());
    }

    #[test]
    fn stream_query_accepts_history_and_pydantic_boolean_forms() {
        let request = parse_stream_query(Some(
            "query=carbon+pricing&include_thinking=NO&history=%5B%7B%22type%22%3A%22user%22%7D%5D&model=opencode%3Azen",
        ))
        .expect("valid stream query");
        assert_eq!(request.query, "carbon pricing");
        assert!(!request.include_thinking);
        assert_eq!(request.history, Some(json!([{"type":"user"}])));
        assert_eq!(request.model.as_deref(), Some("opencode:zen"));
        assert!(parse_stream_query(Some("query=x&include_thinking=maybe")).is_err());
        assert_eq!(
            parse_stream_query(Some("query=x&history=not-json"))
                .expect("bad history is ignored")
                .history,
            None
        );
    }

    #[tokio::test]
    async fn post_research_runs_retrieval_and_projects_fixture_evidence() {
        let app = super::router(NewsResearchState::new(
            catalog_fixture(),
            Some(Arc::new(FixtureResearchProvider { configured: true })),
        ));
        let response = app
            .oneshot(
                Request::post("/api/news/research")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"query":"carbon pricing emissions","include_thinking":false,"model":"openrouter:fixture-model"}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("body"),
        )
        .expect("JSON response");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["articles_searched"], 1);
        assert_eq!(payload["thinking_steps"], json!([]));
        assert_eq!(payload["referenced_articles"][0]["id"], 21);
        assert_eq!(payload["source_providers"], json!(["internal"]));
    }

    #[tokio::test]
    async fn missing_or_unconfigured_post_fails_without_returning_a_canned_answer() {
        let providers = [
            None,
            Some(Arc::new(FixtureResearchProvider { configured: false })
                as Arc<dyn NewsResearchProvider>),
        ];
        for provider in providers {
            let response = super::router(NewsResearchState::new(catalog_fixture(), provider))
                .oneshot(
                    Request::post("/api/news/research")
                        .header("content-type", "application/json")
                        .body(Body::from(r#"{"query":"anything"}"#))
                        .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("body")
                    .as_ref(),
                b"Internal Server Error"
            );
        }
    }

    #[tokio::test]
    async fn configured_stream_sets_sse_response_headers() {
        let response = super::router(NewsResearchState::new(
            catalog_fixture(),
            Some(Arc::new(FixtureResearchProvider { configured: true })),
        ))
        .oneshot(
            Request::get("/api/news/research/stream?query=carbon")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "text/event-stream");
        assert_eq!(response.headers()["cache-control"], "no-cache");
        assert_eq!(response.headers()["connection"], "keep-alive");
        assert_eq!(response.headers()["x-accel-buffering"], "no");
    }

    #[tokio::test]
    async fn unconfigured_stream_emits_start_then_provider_error() {
        let response = super::router(NewsResearchState::new(
            catalog_fixture(),
            Some(Arc::new(FixtureResearchProvider { configured: false })),
        ))
        .oneshot(
            Request::get("/api/news/research/stream?query=carbon")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("SSE error body");
        let body = std::str::from_utf8(&bytes).expect("UTF-8 SSE error");
        let frames = body
            .split("\n\n")
            .filter(|frame| !frame.is_empty())
            .collect::<Vec<_>>();
        assert_eq!(frames.len(), 2);
        let starting: Value = serde_json::from_str(frames[0].trim_start_matches("data: "))
            .expect("starting event JSON");
        assert_eq!(starting["type"], "status");
        assert_eq!(starting["message"], "Starting research.");
        let error: Value =
            serde_json::from_str(frames[1].trim_start_matches("data: ")).expect("SSE error JSON");
        assert_eq!(error["type"], "error");
        assert_eq!(error["code"], "provider_unavailable");
        assert_eq!(error["retryable"], false);
    }

    #[test]
    fn stream_query_parse_error_has_fastapi_query_location() {
        let error = parse_stream_query(None).expect_err("missing query");
        assert_eq!(error.detail[0].error_type, "missing");
        assert!(matches!(
            error.detail[0].loc.as_slice(),
            [super::ValidationLocation::Text(location), super::ValidationLocation::Text(field)]
                if location == "query" && field == "query"
        ));
    }

    #[tokio::test]
    async fn stream_error_events_preserve_provider_error_classification() {
        for (body, expected_code, retryable) in [
            (
                super::stream_error_body(
                    &super::NewsResearchError::ProviderFailed("429 rate limit".to_owned()),
                    Some("opencode:model"),
                ),
                "rate_limit",
                true,
            ),
            (
                super::stream_error_body(
                    &super::NewsResearchError::ProviderFailed("Request timeout".to_owned()),
                    None,
                ),
                "research_error",
                true,
            ),
            (
                super::stream_error_body(
                    &super::NewsResearchError::ProviderFailed("HTTP 503".to_owned()),
                    None,
                ),
                "research_error",
                true,
            ),
            (
                super::stream_error_body(&super::NewsResearchError::ProviderUnavailable, None),
                "provider_unavailable",
                false,
            ),
        ] {
            let bytes = to_bytes(body, usize::MAX).await.expect("SSE error body");
            let body = std::str::from_utf8(&bytes).expect("UTF-8 SSE");
            let error_frame = body
                .split("\n\n")
                .filter(|frame| !frame.is_empty())
                .nth(1)
                .expect("second SSE frame");
            let payload: Value =
                serde_json::from_str(error_frame.trim_start_matches("data: ")).expect("error JSON");
            assert_eq!(payload["code"], expected_code);
            assert_eq!(payload["retryable"], retryable);
        }
    }
}
