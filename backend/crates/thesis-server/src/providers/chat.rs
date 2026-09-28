mod gemini;
mod openai;
mod stream;
#[cfg(test)]
mod stream_tests;

use std::env;
use std::fmt;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::stream::unfold;
use futures_util::Stream;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, RequestBuilder, Response};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::llm_logs::{next_request_id, LlmCallLogger};

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL: &str = "z-ai/glm-4.5-air:free";
const LLAMACPP_BASE_URL: &str = "http://localhost:8080/v1";
const LLAMACPP_DEFAULT_KEY: &str = "no-key";
const OPENCODE_BASE_URL: &str = "https://opencode.ai/zen/v1";
const OPENCODE_DEFAULT_MODEL: &str = "mimo-v2.5-free";
const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_MODEL: &str = "gemini-3-flash-preview";
const OPENCODE_USER_AGENT: &str = "ScoopNewsBot/1.0 (https://github.com/anomalyco/Thesis)";
const OPENAI_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const OPENCODE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const LLAMACPP_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CHAT_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_MODEL_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_UPSTREAM_ERROR_BYTES: usize = 16 * 1024;
const MAX_UPSTREAM_ERROR_MESSAGE_CHARS: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChatBackend {
    OpenRouter,
    LlamaCpp,
    OpenCode,
    Gemini,
}

impl ChatBackend {
    const fn provider_name(self) -> &'static str {
        match self {
            Self::OpenRouter => "openrouter",
            Self::LlamaCpp => "llamacpp",
            Self::OpenCode => "opencode",
            Self::Gemini => "gemini",
        }
    }
}

struct ChatConfiguration {
    backend: ChatBackend,
    base_url: String,
    api_key: String,
    model: String,
    openrouter_model: String,
    timeout: Duration,
}

/// Typed chat request shared by research, article analysis, and provider scoring.
#[derive(Clone, Debug)]
pub(crate) struct ChatCompletionRequest {
    pub service: String,
    pub provider: String,
    pub model: String,
    pub session_id: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ChatTool>,
    pub tool_choice: Option<Value>,
    pub parallel_tool_calls: Option<bool>,
    pub response_format: Option<Value>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChatMessage {
    pub role: ChatRole,
    pub content: Option<String>,
    pub tool_calls: Vec<ChatToolCall>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

impl ChatRole {
    const fn openai_name(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChatTool {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChatToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ChatCompletion {
    pub content: Option<String>,
    pub tool_calls: Vec<ChatToolCall>,
    pub finish_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ChatStreamEvent {
    ContentDelta {
        message_id: Option<String>,
        content: String,
        reasoning: String,
    },
    ToolCallDelta {
        index: usize,
        id: Option<String>,
        name: Option<String>,
        arguments: String,
    },
    Finished {
        finish_reason: Option<String>,
        tool_calls: Vec<ChatToolCall>,
    },
}

pub(crate) type ChatCompletionStream =
    Pin<Box<dyn Stream<Item = Result<ChatStreamEvent, ChatClientError>> + Send>>;

/// OpenAI-compatible or Gemini chat client for a single configured provider.
///
/// Provider/model overrides are explicit per request. The client never switches
/// providers or retries an upstream request on the caller's behalf.
#[derive(Clone)]
pub(crate) struct ChatCompletionClient {
    client: Client,
    backend: ChatBackend,
    base_url: String,
    api_key: String,
    model: Arc<RwLock<String>>,
    openrouter_model: String,
    timeout: Duration,
    default_session_id: Arc<str>,
    logs: LlmCallLogger,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ChatClientError {
    InvalidConfiguration,
    InvalidRequest,
    ProviderMismatch,
    Request,
    Timeout,
    UpstreamStatus { status: u16, message: Option<String> },
    InvalidResponse,
    UnsupportedContentType,
    UnsupportedResponseFormat,
    ResponseTooLarge,
    Logging,
}

impl ChatClientError {
    pub(crate) fn upstream_status(&self) -> Option<u16> {
        match self {
            Self::UpstreamStatus { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// Sanitized, bounded upstream error text suitable for provider-specific policy.
    pub(crate) fn upstream_message(&self) -> Option<&str> {
        match self {
            Self::UpstreamStatus { message, .. } => message.as_deref(),
            _ => None,
        }
    }

    fn error_type(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "InvalidConfiguration",
            Self::InvalidRequest => "InvalidRequest",
            Self::ProviderMismatch => "ProviderMismatch",
            Self::Request => "RequestError",
            Self::Timeout => "TimeoutError",
            Self::UpstreamStatus { .. } => "UpstreamStatus",
            Self::InvalidResponse => "InvalidResponse",
            Self::UnsupportedContentType => "UnsupportedContentType",
            Self::UnsupportedResponseFormat => "UnsupportedResponseFormat",
            Self::ResponseTooLarge => "ResponseTooLarge",
            Self::Logging => "LoggingError",
        }
    }
}

impl fmt::Display for ChatClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "chat backend configuration is invalid",
            Self::InvalidRequest => "chat completion request is invalid",
            Self::ProviderMismatch => "requested chat provider is not the configured backend",
            Self::Request => "chat completion request failed",
            Self::Timeout => "chat completion request timed out",
            Self::UpstreamStatus { status, .. } => {
                return write!(formatter, "chat completion upstream returned HTTP {status}");
            }
            Self::InvalidResponse => "chat completion upstream returned an invalid response",
            Self::UnsupportedContentType => "chat completion response has an unsupported content type",
            Self::UnsupportedResponseFormat => "chat completion response format is unsupported by this provider",
            Self::ResponseTooLarge => "chat completion response exceeded its byte limit",
            Self::Logging => "chat completion could not be recorded in the LLM session log",
        })
    }
}

impl std::error::Error for ChatClientError {}

impl ChatCompletionClient {
    pub(crate) fn from_env(client: Client, logs: LlmCallLogger) -> Option<Self> {
        let backend = env::var("LLM_BACKEND").unwrap_or_else(|_| "openrouter".to_owned());
        let configuration = configuration_from_env(&backend, |name| env::var(name).ok())?;
        let base_url = Url::parse(&configuration.base_url).ok()?;
        if !matches!(base_url.scheme(), "http" | "https")
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.host_str().is_none()
        {
            return None;
        }

        Some(Self::new(client, configuration, logs))
    }

    fn new(client: Client, configuration: ChatConfiguration, logs: LlmCallLogger) -> Self {
        Self {
            client,
            backend: configuration.backend,
            base_url: configuration.base_url.trim_end_matches('/').to_owned(),
            api_key: configuration.api_key,
            model: Arc::new(RwLock::new(configuration.model)),
            openrouter_model: configuration.openrouter_model,
            timeout: configuration.timeout,
            default_session_id: Arc::from(Uuid::new_v4().to_string()),
            logs,
        }
    }

    pub(crate) fn active_provider(&self) -> &'static str {
        self.backend.provider_name()
    }

    /// Resolve the Python shared-client model for service-specific defaults.
    pub(crate) async fn resolve_service_model(
        &self,
        openrouter_default: &str,
    ) -> Result<String, ChatClientError> {
        let model = match self.backend {
            ChatBackend::OpenRouter => {
                if openrouter_default == OPENROUTER_DEFAULT_MODEL {
                    self.openrouter_model.clone()
                } else {
                    openrouter_default.to_owned()
                }
            }
            ChatBackend::LlamaCpp | ChatBackend::OpenCode | ChatBackend::Gemini => {
                self.model.read().await.clone()
            }
        };
        self.resolve_model(&model).await
    }

    /// Refresh llama.cpp's configured model from its `/models` endpoint.
    pub(crate) async fn resolve_llamacpp_model(&self) -> Result<String, ChatClientError> {
        if self.backend != ChatBackend::LlamaCpp {
            return Err(ChatClientError::ProviderMismatch);
        }
        let model = discover_llamacpp_model(&self.client, &self.base_url)
            .await?
            .ok_or(ChatClientError::InvalidResponse)?;
        *self.model.write().await = model.clone();
        Ok(model)
    }

    pub(crate) async fn complete(
        &self,
        request: ChatCompletionRequest,
    ) -> Result<ChatCompletion, ChatClientError> {
        self.validate_request(&request)?;
        let model = self.resolve_model(&request.model).await?;
        let request_id = next_request_id();
        let messages = request
            .messages
            .iter()
            .map(openai::message_json)
            .collect::<Vec<_>>();
        let started = Instant::now();
        let result = self
            .send_completion(&request, &model, &request_id)
            .await;
        let duration_ms = elapsed_millis(started);
        match result {
            Ok(completion) => {
                self.logs
                    .success(
                        &request_id,
                        &request.service,
                        &model,
                        &messages,
                        duration_ms,
                        completion.finish_reason.as_deref(),
                    )
                    .map_err(|_| ChatClientError::Logging)?;
                Ok(completion)
            }
            Err(error) => {
                self.record_failure(
                    &request_id,
                    &request.service,
                    &model,
                    &messages,
                    duration_ms,
                    &error,
                )?;
                Err(error)
            }
        }
    }

    /// Return a lazy response-body stream. Dropping the stream drops reqwest's
    /// response and immediately cancels the upstream transfer.
    pub(crate) fn stream(&self, request: ChatCompletionRequest) -> ChatCompletionStream {
        let state = stream::ChatStreamState::new(self.clone(), request);
        Box::pin(unfold(state, |mut state| async move {
            state.next_event().await.map(|event| (event, state))
        }))
    }

    async fn send_completion(
        &self,
        request: &ChatCompletionRequest,
        model: &str,
        request_id: &str,
    ) -> Result<ChatCompletion, ChatClientError> {
        let body = self.request_body(request, model)?;
        let response = self
            .request_builder(request, model, request_id, false, body)?
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let response = self.check_status(response).await?;
        let bytes = read_json_response(response, MAX_CHAT_RESPONSE_BYTES).await?;
        let payload: Value = serde_json::from_slice(&bytes).map_err(|_| ChatClientError::InvalidResponse)?;
        match self.backend {
            ChatBackend::Gemini => gemini::parse_completion(&payload, request_id),
            ChatBackend::OpenRouter | ChatBackend::LlamaCpp | ChatBackend::OpenCode => {
                openai::parse_completion(&payload, request_id)
            }
        }
    }

    async fn check_status(&self, response: Response) -> Result<Response, ChatClientError> {
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status().as_u16();
        let body = read_error_body(response).await;
        Err(ChatClientError::UpstreamStatus {
            status,
            message: body.map(|body| sanitize_upstream_message(&body, &self.api_key)),
        })
    }

    fn validate_request(&self, request: &ChatCompletionRequest) -> Result<(), ChatClientError> {
        if request.provider != self.backend.provider_name() {
            return Err(ChatClientError::ProviderMismatch);
        }
        if request.service.trim().is_empty() || request.model.trim().is_empty() {
            return Err(ChatClientError::InvalidRequest);
        }
        if request
            .response_format
            .as_ref()
            .is_some_and(|format| format.get("type").and_then(Value::as_str) != Some("json_object"))
            && self.backend == ChatBackend::Gemini
        {
            return Err(ChatClientError::UnsupportedResponseFormat);
        }
        Ok(())
    }

    async fn resolve_model(&self, model: &str) -> Result<String, ChatClientError> {
        if self.backend == ChatBackend::LlamaCpp && model == "local" {
            return self.resolve_llamacpp_model().await;
        }
        Ok(model.to_owned())
    }

    fn request_body(
        &self,
        request: &ChatCompletionRequest,
        model: &str,
    ) -> Result<Value, ChatClientError> {
        match self.backend {
            ChatBackend::Gemini => gemini::request_body(request, model),
            ChatBackend::OpenRouter | ChatBackend::LlamaCpp | ChatBackend::OpenCode => {
                Ok(openai::request_body(request, model))
            }
        }
    }

    fn request_builder(
        &self,
        request: &ChatCompletionRequest,
        model: &str,
        request_id: &str,
        streaming: bool,
        mut body: Value,
    ) -> Result<RequestBuilder, ChatClientError> {
        if streaming && self.backend != ChatBackend::Gemini {
            body.as_object_mut()
                .ok_or(ChatClientError::InvalidRequest)?
                .insert("stream".to_owned(), Value::Bool(true));
        }
        let builder = match self.backend {
            ChatBackend::Gemini => {
                let url = gemini::endpoint(&self.base_url, model, &self.api_key, streaming)?;
                self.client.post(url).timeout(self.timeout).json(&body)
            }
            ChatBackend::OpenRouter | ChatBackend::LlamaCpp | ChatBackend::OpenCode => {
                let endpoint = format!("{}/chat/completions", self.base_url);
                let mut builder = self
                    .client
                    .post(endpoint)
                    .timeout(self.timeout)
                    .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
                    .json(&body);
                if self.backend == ChatBackend::OpenCode {
                    builder = opencode_headers(
                        builder,
                        request.session_id.as_deref().unwrap_or(&self.default_session_id),
                        request_id,
                    );
                }
                builder
            }
        };
        Ok(builder)
    }

    fn record_failure(
        &self,
        request_id: &str,
        service: &str,
        model: &str,
        messages: &[Value],
        duration_ms: u64,
        error: &ChatClientError,
    ) -> Result<(), ChatClientError> {
        let message = error_log_message(error);
        self.logs
            .failure(
                request_id,
                service,
                model,
                messages,
                duration_ms,
                error.error_type(),
                &message,
            )
            .map_err(|_| ChatClientError::Logging)
    }
}

fn configuration_from_env(
    backend: &str,
    get: impl Fn(&str) -> Option<String>,
) -> Option<ChatConfiguration> {
    let openrouter_model = get("OPEN_ROUTER_MODEL").unwrap_or_else(|| OPENROUTER_DEFAULT_MODEL.to_owned());
    match backend {
        "openrouter" => Some(ChatConfiguration {
            backend: ChatBackend::OpenRouter,
            base_url: OPENROUTER_BASE_URL.to_owned(),
            api_key: get("OPEN_ROUTER_API_KEY").filter(|key| !key.is_empty())?,
            model: openrouter_model.clone(),
            openrouter_model,
            timeout: OPENAI_REQUEST_TIMEOUT,
        }),
        "llamacpp" => Some(ChatConfiguration {
            backend: ChatBackend::LlamaCpp,
            base_url: get("LLAMACPP_BASE_URL").unwrap_or_else(|| LLAMACPP_BASE_URL.to_owned()),
            api_key: get("LLAMACPP_API_KEY").unwrap_or_else(|| LLAMACPP_DEFAULT_KEY.to_owned()),
            model: get("LLAMACPP_MODEL").unwrap_or_else(|| "local".to_owned()),
            openrouter_model,
            timeout: OPENAI_REQUEST_TIMEOUT,
        }),
        "opencode" => Some(ChatConfiguration {
            backend: ChatBackend::OpenCode,
            base_url: get("OPENCODE_BASE_URL").unwrap_or_else(|| OPENCODE_BASE_URL.to_owned()),
            api_key: get("OPENCODE_API_KEY").filter(|key| !key.is_empty())?,
            model: get("OPENCODE_MODEL").unwrap_or_else(|| OPENCODE_DEFAULT_MODEL.to_owned()),
            openrouter_model,
            timeout: OPENCODE_REQUEST_TIMEOUT,
        }),
        "gemini" => Some(ChatConfiguration {
            backend: ChatBackend::Gemini,
            base_url: get("GEMINI_BASE_URL").unwrap_or_else(|| GEMINI_BASE_URL.to_owned()),
            api_key: get("GEMINI_API_KEY").filter(|key| !key.is_empty())?,
            model: get("GEMINI_MODEL").unwrap_or_else(|| GEMINI_DEFAULT_MODEL.to_owned()),
            openrouter_model,
            timeout: OPENAI_REQUEST_TIMEOUT,
        }),
        _ => None,
    }
}



fn opencode_headers(
    request: RequestBuilder,
    session_id: &str,
    request_id: &str,
) -> RequestBuilder {
    request
        .header(USER_AGENT, OPENCODE_USER_AGENT)
        .header("x-opencode-client", "scoop")
        .header("x-opencode-request", request_id)
        .header("x-opencode-session", session_id)
}

async fn discover_llamacpp_model(
    client: &Client,
    base_url: &str,
) -> Result<Option<String>, ChatClientError> {
    let endpoint = format!("{}/models", base_url.trim_end_matches('/'));
    let response = client
        .get(endpoint)
        .timeout(LLAMACPP_DISCOVERY_TIMEOUT)
        .send()
        .await
        .map_err(map_reqwest_error)?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = read_json_response(response, MAX_MODEL_RESPONSE_BYTES).await?;
    let payload: Value = serde_json::from_slice(&bytes).map_err(|_| ChatClientError::InvalidResponse)?;
    Ok(openai::first_model_id(&payload))
}


async fn read_json_response(
    response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, ChatClientError> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ChatClientError::UnsupportedContentType)?;
    if !content_type.eq_ignore_ascii_case("application/json") && !content_type.ends_with("+json") {
        return Err(ChatClientError::UnsupportedContentType);
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(ChatClientError::ResponseTooLarge);
    }
    read_limited_body(response, max_bytes).await
}

async fn read_error_body(response: Response) -> Option<String> {
    let bytes = read_limited_body(response, MAX_UPSTREAM_ERROR_BYTES).await.ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

async fn read_limited_body(
    response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, ChatClientError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(ChatClientError::ResponseTooLarge);
    }
    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .map_or(max_bytes.min(4096), |length| length.min(max_bytes));
    let mut bytes = Vec::with_capacity(capacity);
    let mut response = response;
    while let Some(chunk) = response.chunk().await.map_err(|error| map_reqwest_error(&error))? {
        if bytes
            .len()
            .checked_add(chunk.len())
            .is_none_or(|length| length > max_bytes)
        {
            return Err(ChatClientError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn sanitize_upstream_message(body: &str, api_key: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/message"))
        .and_then(Value::as_str)
        .unwrap_or(body);
    let redacted = if api_key.is_empty() {
        message.to_owned()
    } else {
        message.replace(api_key, "[redacted]")
    };
    let sanitized = redacted
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .take(MAX_UPSTREAM_ERROR_MESSAGE_CHARS)
        .collect::<String>()
        .trim()
        .to_owned();
    sanitized
}

fn map_reqwest_error(error: &reqwest::Error) -> ChatClientError {
    if error.is_timeout() {
        ChatClientError::Timeout
    } else {
        ChatClientError::Request
    }
}

fn elapsed_millis(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn error_log_message(error: &ChatClientError) -> String {
    error
        .upstream_message()
        .map(str::to_owned)
        .unwrap_or_else(|| error.to_string())
}


#[cfg(test)]
mod tests {
    use super::{
        configuration_from_env, gemini, openai, ChatBackend, ChatCompletionRequest, ChatMessage,
        ChatRole, ChatTool, ChatToolCall, OPENCODE_DEFAULT_MODEL, OPENROUTER_DEFAULT_MODEL,
    };
    use serde_json::json;
    use std::time::Duration;
    pub(super) fn request(provider: &str) -> ChatCompletionRequest {
        ChatCompletionRequest {
            service: "news_research".to_owned(),
            provider: provider.to_owned(),
            model: "selected-model".to_owned(),
            session_id: Some("research-session".to_owned()),
            messages: vec![
                ChatMessage {
                    role: ChatRole::System,
                    content: Some("system prompt".to_owned()),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    name: None,
                },
                ChatMessage {
                    role: ChatRole::User,
                    content: Some("user prompt".to_owned()),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    name: None,
                },
            ],
            tools: vec![ChatTool {
                name: "search_articles".to_owned(),
                description: "Find articles".to_owned(),
                parameters: json!({"type": "object", "properties": {"query": {"type": "string"}}}),
            }],
            tool_choice: Some(json!("required")),
            parallel_tool_calls: Some(false),
            response_format: Some(json!({"type": "json_object"})),
            max_tokens: Some(500),
            temperature: Some(0.2),
        }
    }

    #[test]
    fn configured_backends_are_explicit_and_reject_unknown_provider_names() {
        let openrouter = configuration_from_env("openrouter", |name| match name {
            "OPEN_ROUTER_API_KEY" => Some("router-key".to_owned()),
            _ => None,
        })
        .expect("OpenRouter is configured");
        assert_eq!(openrouter.backend, ChatBackend::OpenRouter);
        assert_eq!(openrouter.base_url, "https://openrouter.ai/api/v1");
        assert_eq!(openrouter.model, OPENROUTER_DEFAULT_MODEL);
        assert_eq!(openrouter.timeout, Duration::from_secs(600));
        assert_eq!(openrouter.api_key, "router-key");

        let llamacpp = configuration_from_env("llamacpp", |name| match name {
            "LLAMACPP_MODEL" => Some("local-model".to_owned()),
            _ => None,
        })
        .expect("llama.cpp is available without an external key");
        assert_eq!(llamacpp.backend, ChatBackend::LlamaCpp);
        assert_eq!(llamacpp.base_url, "http://localhost:8080/v1");
        assert_eq!(llamacpp.api_key, "no-key");
        assert_eq!(llamacpp.model, "local-model");

        let opencode = configuration_from_env("opencode", |name| match name {
            "OPENCODE_API_KEY" => Some("zen-key".to_owned()),
            _ => None,
        })
        .expect("OpenCode is configured");
        assert_eq!(opencode.backend, ChatBackend::OpenCode);
        assert_eq!(opencode.model, OPENCODE_DEFAULT_MODEL);
        assert_eq!(opencode.timeout, Duration::from_secs(30));
        assert!(configuration_from_env("opencode", |_| None).is_none());

        let gemini = configuration_from_env("gemini", |name| match name {
            "GEMINI_API_KEY" => Some("gemini-key".to_owned()),
            _ => None,
        })
        .expect("Gemini is configured");
        assert_eq!(gemini.backend, ChatBackend::Gemini);
        assert_eq!(gemini.model, "gemini-3-flash-preview");
        assert!(configuration_from_env("unexpected", |_| None).is_none());
    }

    #[test]
    fn openai_body_preserves_tool_protocol_json_mode_and_request_model() {
        let request = request("opencode");
        let body = openai::request_body(&request, "chosen:exact");
        assert_eq!(body["model"], "chosen:exact");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "user prompt");
        assert_eq!(body["tool_choice"], "required");
        assert_eq!(body["parallel_tool_calls"], false);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["tools"][0]["function"]["name"], "search_articles");
        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["max_tokens"], 500);
    }

    #[test]
    fn gemini_body_maps_system_turns_tools_and_json_mode() {
        let mut request = request("gemini");
        request.messages.extend([
            ChatMessage {
                role: ChatRole::Assistant,
                content: None,
                tool_calls: vec![ChatToolCall {
                    id: "call-1".to_owned(),
                    name: "search_articles".to_owned(),
                    arguments: json!({"query": "climate"}),
                }],
                tool_call_id: None,
                name: None,
            },
            ChatMessage {
                role: ChatRole::Tool,
                content: Some("two results".to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-1".to_owned()),
                name: Some("search_articles".to_owned()),
            },
        ]);
        let body = gemini::request_body(&request, "gemini-model").expect("Gemini request body");
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "system prompt");
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(body["contents"][1]["parts"][0]["functionCall"]["name"], "search_articles");
        assert_eq!(body["contents"][2]["parts"][0]["functionResponse"]["response"]["id"], "call-1");
        assert_eq!(body["toolConfig"]["functionCallingConfig"]["mode"], "ANY");
        assert_eq!(body["generationConfig"]["responseMimeType"], "application/json");
        assert_eq!(body["generationConfig"]["temperature"], 0.2);
    }

    #[test]
    fn openai_response_preserves_complete_tool_calls_and_finish_reason() {
        let response = openai::parse_completion(
            &json!({
                "choices": [{
                    "finish_reason": "tool_calls",
                    "message": {
                        "content": null,
                        "tool_calls": [{
                            "id": "call-1",
                            "function": {
                                "name": "search_articles",
                                "arguments": "{\"query\":\"climate\"}"
                            }
                        }]
                    }
                }]
            }),
            "request-1",
        )
        .expect("normalized completion");
        assert_eq!(response.content, None);
        assert_eq!(response.finish_reason.as_deref(), Some("tool_calls"));
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "call-1");
        assert_eq!(response.tool_calls[0].arguments, json!({"query": "climate"}));
    }

    #[test]
    fn gemini_response_normalizes_reasoning_and_function_calls() {
        let response = gemini::parse_completion(
            &json!({
                "candidates": [{
                    "finishReason": "STOP",
                    "content": {"parts": [
                        {"text": "thinking", "thought": true},
                        {"text": "answer"},
                        {"functionCall": {"name": "search_articles", "args": {"query": "climate"}}}
                    ]}
                }]
            }),
            "request-2",
        )
        .expect("normalized Gemini response");
        assert_eq!(response.content.as_deref(), Some("answer"));
        assert_eq!(response.finish_reason.as_deref(), Some("STOP"));
        assert_eq!(response.tool_calls[0].id, "request-2-2");
        assert_eq!(response.tool_calls[0].arguments, json!({"query": "climate"}));
    }

    #[test]
    fn llama_model_discovery_accepts_supported_wire_shapes() {
        assert_eq!(openai::first_model_id(&json!({"data": [{"id": "server-model"}]})), Some("server-model".to_owned()));
        assert_eq!(openai::first_model_id(&json!({"models": [{"name": "local-model"}]})), Some("local-model".to_owned()));
        assert_eq!(openai::first_model_id(&json!({"models": [{"model": "llama"}]})), Some("llama".to_owned()));
        assert_eq!(openai::first_model_id(&json!({"data": []})), None);
    }

}
