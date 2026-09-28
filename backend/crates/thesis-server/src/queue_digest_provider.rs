use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, USER_AGENT};
use reqwest::{Client, RequestBuilder};
use serde::Deserialize;
use serde_json::{json, Value};
use thesis_api::queue_digest::{QueueDigestError, QueueDigestFuture, QueueDigestProvider};

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL: &str = "z-ai/glm-4.5-air:free";
const LLAMACPP_BASE_URL: &str = "http://localhost:8080/v1";
const LLAMACPP_DEFAULT_KEY: &str = "no-key";
const OPENCODE_BASE_URL: &str = "https://opencode.ai/zen/v1";
const OPENCODE_DEFAULT_MODEL: &str = "mimo-v2.5-free";
const OPENCODE_USER_AGENT: &str = "ScoopNewsBot/1.0 (https://github.com/anomalyco/Thesis)";

const OPENAI_DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const OPENCODE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

static OPENCODE_SESSION: LazyLock<String> = LazyLock::new(|| {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("scoop-{}-{timestamp}", std::process::id())
});
static OPENCODE_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LlmBackend {
    OpenRouter,
    LlamaCpp,
    OpenCode,
}

struct ProviderConfiguration {
    backend: LlmBackend,
    base_url: String,
    api_key: String,
    model: String,
    request_timeout: Duration,
}

/// OpenAI-compatible HTTP adapter for the queue digest provider.
#[derive(Clone)]
pub(crate) struct QueueDigestHttpProvider {
    client: Client,
    configuration: Arc<ProviderConfiguration>,
}

impl QueueDigestHttpProvider {
    pub(crate) fn from_env(client: Client) -> Option<Self> {
        let backend = env::var("LLM_BACKEND").unwrap_or_else(|_| "openrouter".to_owned());
        let configuration = configuration_from_env(&backend, |name| env::var(name).ok())?;
        Some(Self::new(client, configuration))
    }

    fn new(client: Client, configuration: ProviderConfiguration) -> Self {
        Self {
            client,
            configuration: Arc::new(configuration),
        }
    }

    async fn generate_request(
        &self,
        system_prompt: String,
        user_prompt: String,
    ) -> Result<String, QueueDigestError> {
        let endpoint = format!(
            "{}/chat/completions",
            self.configuration.base_url.trim_end_matches('/')
        );
        let body = request_body(
            self.configuration.backend,
            &self.configuration.model,
            system_prompt,
            user_prompt,
        );
        let mut request = self
            .client
            .post(endpoint)
            .timeout(self.configuration.request_timeout)
            .header(
                AUTHORIZATION,
                format!("Bearer {}", self.configuration.api_key),
            )
            .json(&body);
        if self.configuration.backend == LlmBackend::OpenCode {
            request = opencode_headers(request);
        }

        let response = request
            .send()
            .await
            .map_err(|_| QueueDigestError)?
            .error_for_status()
            .map_err(|_| QueueDigestError)?;
        let completion: ChatCompletionResponse =
            response.json().await.map_err(|_| QueueDigestError)?;
        let choice = completion
            .choices
            .into_iter()
            .next()
            .ok_or(QueueDigestError)?;
        Ok(choice.message.content.unwrap_or_default())
    }
}

impl QueueDigestProvider for QueueDigestHttpProvider {
    fn generate(&self, system_prompt: String, user_prompt: String) -> QueueDigestFuture<String> {
        let provider = self.clone();
        Box::pin(async move { provider.generate_request(system_prompt, user_prompt).await })
    }
}

fn configuration_from_env(
    backend: &str,
    get: impl Fn(&str) -> Option<String>,
) -> Option<ProviderConfiguration> {
    let openrouter_model =
        || get("OPEN_ROUTER_MODEL").unwrap_or_else(|| OPENROUTER_DEFAULT_MODEL.to_owned());
    match backend {
        "llamacpp" => Some(ProviderConfiguration {
            backend: LlmBackend::LlamaCpp,
            base_url: get("LLAMACPP_BASE_URL").unwrap_or_else(|| LLAMACPP_BASE_URL.to_owned()),
            api_key: get("LLAMACPP_API_KEY").unwrap_or_else(|| LLAMACPP_DEFAULT_KEY.to_owned()),
            // This matches generate_queue_digest's explicit resolve_opencode_model call.
            // LLAMACPP_MODEL is intentionally not consulted for this operation.
            model: openrouter_model(),
            request_timeout: OPENAI_DEFAULT_REQUEST_TIMEOUT,
        }),
        "opencode" => Some(ProviderConfiguration {
            backend: LlmBackend::OpenCode,
            base_url: get("OPENCODE_BASE_URL").unwrap_or_else(|| OPENCODE_BASE_URL.to_owned()),
            api_key: get("OPENCODE_API_KEY").filter(|key| !key.is_empty())?,
            model: get("OPENCODE_MODEL").unwrap_or_else(|| OPENCODE_DEFAULT_MODEL.to_owned()),
            request_timeout: OPENCODE_REQUEST_TIMEOUT,
        }),
        _ => Some(ProviderConfiguration {
            backend: LlmBackend::OpenRouter,
            base_url: OPENROUTER_BASE_URL.to_owned(),
            api_key: get("OPEN_ROUTER_API_KEY").filter(|key| !key.is_empty())?,
            model: openrouter_model(),
            request_timeout: OPENAI_DEFAULT_REQUEST_TIMEOUT,
        }),
    }
}

fn request_body(
    backend: LlmBackend,
    model: &str,
    system_prompt: String,
    user_prompt: String,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    });
    if backend == LlmBackend::LlamaCpp {
        let fields = body.as_object_mut().expect("chat request is an object");
        fields.insert("temperature".to_owned(), json!(1.0));
        fields.insert("top_p".to_owned(), json!(0.95));
        fields.insert("presence_penalty".to_owned(), json!(1.5));
        fields.insert("top_k".to_owned(), json!(20));
        fields.insert("min_p".to_owned(), json!(0.0));
        fields.insert("repetition_penalty".to_owned(), json!(1.0));
    }
    body
}

fn opencode_headers(request: RequestBuilder) -> RequestBuilder {
    let sequence = OPENCODE_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let request_id = format!("{}-{sequence}", OPENCODE_SESSION.as_str());
    request
        .header(USER_AGENT, OPENCODE_USER_AGENT)
        .header("x-opencode-client", "scoop")
        .header("x-opencode-request", request_id)
        .header("x-opencode-session", OPENCODE_SESSION.as_str())
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use axum::body::{to_bytes, Body};
    use axum::extract::State;
    use axum::http::{HeaderMap, Method, Request, StatusCode, Uri};
    use axum::response::{IntoResponse, Response};
    use axum::routing::any;
    use axum::Json;
    use serde_json::{json, Value};
    use tokio::net::TcpListener;

    use super::{
        configuration_from_env, LlmBackend, ProviderConfiguration, QueueDigestHttpProvider,
        QueueDigestProvider, OPENCODE_BASE_URL, OPENCODE_DEFAULT_MODEL, OPENCODE_USER_AGENT,
        OPENROUTER_BASE_URL, OPENROUTER_DEFAULT_MODEL,
    };

    #[derive(Clone)]
    struct FixtureState {
        requests: Arc<Mutex<Vec<CapturedRequest>>>,
        status: StatusCode,
        payload: Value,
    }

    #[derive(Clone)]
    struct CapturedRequest {
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Value,
    }

    struct FixtureServer {
        base_url: String,
        requests: Arc<Mutex<Vec<CapturedRequest>>>,
        task: tokio::task::JoinHandle<()>,
    }

    impl FixtureServer {
        async fn close(self) {
            self.task.abort();
            let _ = self.task.await;
        }
    }

    async fn capture_request(
        State(state): State<FixtureState>,
        request: Request<Body>,
    ) -> Response {
        let (parts, body) = request.into_parts();
        let bytes = to_bytes(body, usize::MAX).await.expect("request body");
        let body = serde_json::from_slice(&bytes).expect("request JSON");
        state
            .requests
            .lock()
            .expect("request capture lock")
            .push(CapturedRequest {
                method: parts.method,
                uri: parts.uri,
                headers: parts.headers,
                body,
            });
        (state.status, Json(state.payload)).into_response()
    }

    async fn fixture_server(status: StatusCode) -> FixtureServer {
        fixture_server_with_payload(
            status,
            json!({"choices": [{"message": {"content": "  fixture digest  "}}]}),
        )
        .await
    }

    async fn fixture_server_with_payload(status: StatusCode, payload: Value) -> FixtureServer {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture listener");
        let address = listener.local_addr().expect("fixture address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = FixtureState {
            requests: requests.clone(),
            status,
            payload,
        };
        let app = axum::Router::new()
            .fallback(any(capture_request))
            .with_state(state);
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("fixture server");
        });
        FixtureServer {
            base_url: format!("http://{address}/v1"),
            requests,
            task,
        }
    }

    fn provider(
        backend: LlmBackend,
        base_url: String,
        api_key: &str,
        model: &str,
    ) -> QueueDigestHttpProvider {
        QueueDigestHttpProvider::new(
            reqwest::Client::new(),
            ProviderConfiguration {
                backend,
                base_url,
                api_key: api_key.to_owned(),
                model: model.to_owned(),
                request_timeout: Duration::from_secs(30),
            },
        )
    }

    fn captured(server: &FixtureServer) -> Vec<CapturedRequest> {
        server.requests.lock().expect("request lock").clone()
    }

    #[test]
    fn environment_configuration_keeps_backend_defaults_and_llama_model_selection_quirk() {
        let openrouter = configuration_from_env("openrouter", |name| match name {
            "OPEN_ROUTER_API_KEY" => Some("test-key".to_owned()),
            _ => None,
        })
        .expect("OpenRouter configuration");
        assert_eq!(openrouter.backend, LlmBackend::OpenRouter);
        assert_eq!(openrouter.base_url, OPENROUTER_BASE_URL);
        assert_eq!(openrouter.model, OPENROUTER_DEFAULT_MODEL);

        let llama = configuration_from_env("llamacpp", |name| match name {
            "OPEN_ROUTER_MODEL" => Some("openrouter-model".to_owned()),
            "LLAMACPP_MODEL" => Some("must-not-be-used".to_owned()),
            _ => None,
        })
        .expect("llama.cpp configuration");
        assert_eq!(llama.backend, LlmBackend::LlamaCpp);
        assert_eq!(llama.base_url, "http://localhost:8080/v1");
        assert_eq!(llama.api_key, "no-key");
        assert_eq!(llama.model, "openrouter-model");

        let opencode = configuration_from_env("opencode", |name| match name {
            "OPENCODE_API_KEY" => Some("test-key".to_owned()),
            _ => None,
        })
        .expect("OpenCode configuration");
        assert_eq!(opencode.backend, LlmBackend::OpenCode);
        assert_eq!(opencode.base_url, OPENCODE_BASE_URL);
        assert_eq!(opencode.model, OPENCODE_DEFAULT_MODEL);
        assert!(configuration_from_env("opencode", |_| None).is_none());
    }

    #[tokio::test]
    async fn openrouter_sends_the_configured_chat_completion_request() {
        let fixture = fixture_server(StatusCode::OK).await;
        let provider = provider(
            LlmBackend::OpenRouter,
            fixture.base_url.clone(),
            "fixture-secret",
            "glm-model",
        );
        let result = provider
            .generate("system prompt".to_owned(), "user prompt".to_owned())
            .await;

        assert_eq!(result.expect("completion"), "  fixture digest  ");
        let requests = captured(&fixture);
        assert_eq!(requests.len(), 1);
        let request = requests.first().expect("captured request");
        assert_eq!(request.method, Method::POST);
        assert_eq!(request.uri.path(), "/v1/chat/completions");
        assert_eq!(request.headers["authorization"], "Bearer fixture-secret");
        assert_eq!(request.headers["content-type"], "application/json");
        assert_eq!(
            request.body,
            json!({
                "model": "glm-model",
                "messages": [
                    {"role": "system", "content": "system prompt"},
                    {"role": "user", "content": "user prompt"}
                ]
            })
        );
        fixture.close().await;
    }

    #[tokio::test]
    async fn opencode_sends_attributed_requests_with_stable_session_and_unique_request_ids() {
        let fixture = fixture_server(StatusCode::OK).await;
        let provider = provider(
            LlmBackend::OpenCode,
            fixture.base_url.clone(),
            "fixture-secret",
            "mimo-v2.5-free",
        );
        for _ in 0..2 {
            let result = provider
                .generate("system prompt".to_owned(), "user prompt".to_owned())
                .await;
            assert_eq!(result.expect("completion"), "  fixture digest  ");
        }
        let requests = captured(&fixture);
        assert_eq!(requests.len(), 2);
        for request in &requests {
            assert_eq!(request.method, Method::POST);
            assert_eq!(request.uri.path(), "/v1/chat/completions");
            assert_eq!(request.headers["authorization"], "Bearer fixture-secret");
            assert_eq!(request.headers["user-agent"], OPENCODE_USER_AGENT);
            assert_eq!(request.headers["x-opencode-client"], "scoop");
            assert_eq!(request.headers["content-type"], "application/json");
            assert_eq!(request.body["model"], "mimo-v2.5-free");
            assert_eq!(request.body["messages"][0]["content"], "system prompt");
            assert_eq!(request.body["messages"][1]["content"], "user prompt");
        }
        let first_session = requests[0].headers["x-opencode-session"]
            .to_str()
            .expect("session header");
        let second_session = requests[1].headers["x-opencode-session"]
            .to_str()
            .expect("session header");
        let first_request = requests[0].headers["x-opencode-request"]
            .to_str()
            .expect("request header");
        let second_request = requests[1].headers["x-opencode-request"]
            .to_str()
            .expect("request header");
        assert!(!first_session.is_empty());
        assert_eq!(first_session, second_session);
        assert_ne!(first_request, second_request);
        fixture.close().await;
    }

    #[tokio::test]
    async fn llamacpp_request_uses_openrouter_model_and_root_level_sampling_fields() {
        let fixture = fixture_server(StatusCode::OK).await;
        let provider = provider(
            LlmBackend::LlamaCpp,
            fixture.base_url.clone(),
            "no-key",
            "openrouter-model",
        );
        let _ = provider
            .generate("system".to_owned(), "user".to_owned())
            .await
            .expect("completion");
        let requests = captured(&fixture);
        let request = requests.first().expect("captured request");
        assert_eq!(request.method, Method::POST);
        assert_eq!(request.uri.path(), "/v1/chat/completions");
        assert_eq!(request.headers["authorization"], "Bearer no-key");
        assert_eq!(request.body["model"], "openrouter-model");
        assert_eq!(request.body["temperature"], 1.0);
        assert_eq!(request.body["top_p"], 0.95);
        assert_eq!(request.body["presence_penalty"], 1.5);
        assert_eq!(request.body["top_k"], 20);
        assert_eq!(request.body["min_p"], 0.0);
        assert_eq!(request.body["repetition_penalty"], 1.0);
        assert!(request.body.get("extra_body").is_none());
        fixture.close().await;
    }

    #[tokio::test]
    async fn opencode_upstream_failure_is_generic_and_is_not_retried() {
        let fixture = fixture_server(StatusCode::INTERNAL_SERVER_ERROR).await;
        let provider = provider(
            LlmBackend::OpenCode,
            fixture.base_url.clone(),
            "fixture-secret",
            "mimo-v2.5-free",
        );
        let result = provider
            .generate(
                "private system prompt".to_owned(),
                "private user prompt".to_owned(),
            )
            .await;
        assert!(result.is_err());
        assert_eq!(captured(&fixture).len(), 1);
        fixture.close().await;
    }

    #[tokio::test]
    async fn malformed_completion_response_is_a_provider_failure() {
        let fixture = fixture_server_with_payload(StatusCode::OK, json!({"choices": []})).await;
        let provider = provider(
            LlmBackend::OpenRouter,
            fixture.base_url.clone(),
            "fixture-secret",
            "glm-model",
        );
        let result = provider
            .generate("system".to_owned(), "user".to_owned())
            .await;
        assert!(result.is_err());
        assert_eq!(captured(&fixture).len(), 1);
        fixture.close().await;
    }
}
