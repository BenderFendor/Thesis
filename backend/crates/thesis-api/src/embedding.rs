//! Typed HTTP client for the repository's supported embedding sidecar.
//!
//! The client reuses an injected `reqwest::Client` and targets the checked-in
//! sidecar contract: `POST /embed` and `GET /health`.

use std::fmt;
use std::time::Duration;

use reqwest::{StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

const DEFAULT_MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_BATCH_SIZE: usize = 256;

/// Validated base URL and request/response bounds for the embedding sidecar.
#[derive(Clone, Debug)]
pub struct EmbeddingConfig {
    base_url: Url,
    request_timeout: Duration,
    max_response_bytes: usize,
}

impl EmbeddingConfig {
    /// Validate the configured root service URL and timeout.
    pub fn new(base_url: &str, request_timeout: Duration) -> Result<Self, EmbeddingError> {
        let base_url = validated_base_url(base_url)?;
        if request_timeout.is_zero() {
            return Err(EmbeddingError::InvalidConfig(
                "request timeout must be greater than zero",
            ));
        }
        Ok(Self {
            base_url,
            request_timeout,
            max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
        })
    }

    /// Set the maximum bytes retained from any sidecar response body.
    pub fn with_max_response_bytes(
        mut self,
        max_response_bytes: usize,
    ) -> Result<Self, EmbeddingError> {
        if max_response_bytes == 0 {
            return Err(EmbeddingError::InvalidConfig(
                "maximum response body size must be greater than zero",
            ));
        }
        self.max_response_bytes = max_response_bytes;
        Ok(self)
    }
}

/// Cloneable access to the real configured embedding sidecar.
#[derive(Clone, Debug)]
pub struct EmbeddingClient {
    http: reqwest::Client,
    config: EmbeddingConfig,
}

impl EmbeddingClient {
    /// Bind the shared HTTP client to the validated sidecar configuration.
    pub fn new(http: reqwest::Client, config: EmbeddingConfig) -> Self {
        Self { http, config }
    }

    /// Embed a non-empty batch and verify every returned vector against sidecar evidence.
    pub async fn embed(
        &self,
        texts: &[String],
        batch_size: usize,
    ) -> Result<EmbeddingResponse, EmbeddingError> {
        if texts.is_empty() {
            return Err(EmbeddingError::InvalidRequest("texts must not be empty"));
        }
        if !(1..=MAX_BATCH_SIZE).contains(&batch_size) {
            return Err(EmbeddingError::InvalidRequest(
                "batch_size must be between 1 and 256",
            ));
        }

        let url = self.endpoint("embed")?;
        let body = EmbedRequest { texts, batch_size };
        let response: EmbeddingResponse = self
            .send_json(
                self.http.post(url).timeout(self.config.request_timeout),
                &body,
            )
            .await?;
        response.validate(texts.len())?;
        Ok(response)
    }

    /// Read the sidecar's typed health and model-load state.
    pub async fn health(&self) -> Result<EmbeddingHealth, EmbeddingError> {
        let url = self.endpoint("health")?;
        self.send(self.http.get(url).timeout(self.config.request_timeout))
            .await
    }

    fn endpoint(&self, path: &str) -> Result<Url, EmbeddingError> {
        let mut url = self.config.base_url.clone();
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| EmbeddingError::InvalidConfig("base URL cannot accept path segments"))?;
        segments.pop_if_empty();
        segments.push(path);
        drop(segments);
        Ok(url)
    }

    async fn send<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, EmbeddingError> {
        read_json_response(
            request.send().await.map_err(EmbeddingError::Http)?,
            self.config.max_response_bytes,
        )
        .await
    }

    async fn send_json<T: DeserializeOwned, B: Serialize>(
        &self,
        request: reqwest::RequestBuilder,
        body: &B,
    ) -> Result<T, EmbeddingError> {
        self.send(request.json(body)).await
    }
}

#[derive(Serialize)]
struct EmbedRequest<'a> {
    texts: &'a [String],
    batch_size: usize,
}

/// Exact response body returned by `POST /embed`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct EmbeddingResponse {
    pub embeddings: Vec<Vec<f64>>,
    pub model: String,
    pub count: usize,
    pub dimension: usize,
}

impl EmbeddingResponse {
    fn validate(&self, expected_count: usize) -> Result<(), EmbeddingError> {
        if self.count != expected_count || self.embeddings.len() != expected_count {
            return Err(EmbeddingError::InvalidResponse {
                message: "embedding count does not match submitted texts".into(),
                body: String::new(),
            });
        }
        if self.dimension == 0
            || self.embeddings.iter().any(|row| {
                row.len() != self.dimension || row.iter().any(|value| !value.is_finite())
            })
        {
            return Err(EmbeddingError::InvalidResponse {
                message: "embedding vectors do not match the reported finite dimension".into(),
                body: String::new(),
            });
        }
        Ok(())
    }
}

/// Exact typed response returned by `GET /health`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct EmbeddingHealth {
    pub ok: bool,
    pub model: String,
    pub loaded: bool,
    pub resource_monitor_running: bool,
}

/// Failures from the embedding sidecar, preserving bounded HTTP error bodies.
pub enum EmbeddingError {
    InvalidConfig(&'static str),
    InvalidRequest(&'static str),
    Http(reqwest::Error),
    HttpStatus { status: StatusCode, body: String },
    BodyTooLarge { status: StatusCode, limit: usize },
    InvalidResponse { message: String, body: String },
}

impl fmt::Debug for EmbeddingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfig(message) => formatter
                .debug_tuple("InvalidConfig")
                .field(message)
                .finish(),
            Self::InvalidRequest(message) => formatter
                .debug_tuple("InvalidRequest")
                .field(message)
                .finish(),
            Self::Http(error) => formatter.debug_tuple("Http").field(error).finish(),
            Self::HttpStatus { status, body } => formatter
                .debug_struct("HttpStatus")
                .field("status", status)
                .field("body_bytes", &body.len())
                .finish(),
            Self::BodyTooLarge { status, limit } => formatter
                .debug_struct("BodyTooLarge")
                .field("status", status)
                .field("limit", limit)
                .finish(),
            Self::InvalidResponse { message, body } => formatter
                .debug_struct("InvalidResponse")
                .field("message", message)
                .field("body_bytes", &body.len())
                .finish(),
        }
    }
}

impl EmbeddingError {
    /// Whether the request exceeded its configured deadline.
    pub fn is_timeout(&self) -> bool {
        matches!(self, Self::Http(error) if error.is_timeout())
    }
}

impl fmt::Display for EmbeddingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfig(message) => {
                write!(formatter, "invalid embedding config: {message}")
            }
            Self::InvalidRequest(message) => {
                write!(formatter, "invalid embedding request: {message}")
            }
            Self::Http(error) => write!(formatter, "embedding HTTP request failed: {error}"),
            Self::HttpStatus { status, .. } => {
                write!(formatter, "embedding service returned HTTP {status}")
            }
            Self::BodyTooLarge { status, limit } => write!(
                formatter,
                "embedding HTTP {status} response exceeded the {limit}-byte limit"
            ),
            Self::InvalidResponse { message, .. } => {
                write!(formatter, "invalid embedding response: {message}")
            }
        }
    }
}

impl std::error::Error for EmbeddingError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Http(error) => Some(error),
            _ => None,
        }
    }
}

async fn read_json_response<T: DeserializeOwned>(
    mut response: reqwest::Response,
    max_response_bytes: usize,
) -> Result<T, EmbeddingError> {
    let status = response.status();
    let body = read_bounded_body(&mut response, max_response_bytes, status).await?;
    if !status.is_success() {
        return Err(EmbeddingError::HttpStatus {
            status,
            body: String::from_utf8_lossy(&body).into_owned(),
        });
    }
    serde_json::from_slice(&body).map_err(|error| EmbeddingError::InvalidResponse {
        message: error.to_string(),
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

async fn read_bounded_body(
    response: &mut reqwest::Response,
    limit: usize,
    status: StatusCode,
) -> Result<Vec<u8>, EmbeddingError> {
    if response
        .content_length()
        .is_some_and(|content_length| content_length > limit as u64)
    {
        return Err(EmbeddingError::BodyTooLarge { status, limit });
    }

    let mut body = Vec::new();
    if let Some(content_length) = response.content_length() {
        body.reserve(content_length as usize);
    }
    while let Some(chunk) = response.chunk().await.map_err(EmbeddingError::Http)? {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(EmbeddingError::BodyTooLarge { status, limit });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn validated_base_url(raw: &str) -> Result<Url, EmbeddingError> {
    let mut url =
        Url::parse(raw).map_err(|_| EmbeddingError::InvalidConfig("base URL is invalid"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(EmbeddingError::InvalidConfig(
            "base URL must be an HTTP(S) origin without credentials, path, query, or fragment",
        ));
    }
    url.set_path("");
    Ok(url)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use std::time::Duration;

    use serde_json::{json, Value};

    use super::{
        EmbeddingClient, EmbeddingConfig, EmbeddingError, EmbeddingHealth, EmbeddingResponse,
    };

    struct FixtureResponse {
        status: u16,
        reason: &'static str,
        body: Vec<u8>,
        delay: Duration,
    }

    impl FixtureResponse {
        fn json(status: u16, reason: &'static str, body: &str) -> Self {
            Self {
                status,
                reason,
                body: body.as_bytes().to_vec(),
                delay: Duration::ZERO,
            }
        }
    }

    #[derive(Debug)]
    struct CapturedRequest {
        method: String,
        path: String,
        headers: std::collections::HashMap<String, String>,
        body: Vec<u8>,
    }

    fn fixture(
        responses: Vec<FixtureResponse>,
    ) -> (String, thread::JoinHandle<Vec<CapturedRequest>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("fixture listener binds");
        let address = listener.local_addr().expect("fixture address is available");
        let handle = thread::spawn(move || {
            let mut captured = Vec::with_capacity(responses.len());
            for response in responses {
                let (mut stream, _) = listener.accept().expect("fixture accepts request");
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .expect("fixture read timeout sets");
                let request = read_request(&mut stream);
                thread::sleep(response.delay);
                let head = format!(
                    "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    response.status,
                    response.reason,
                    response.body.len(),
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&response.body);
                captured.push(request);
            }
            captured
        });
        (format!("http://{address}"), handle)
    }

    fn read_request(stream: &mut TcpStream) -> CapturedRequest {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        let header_end = loop {
            let count = stream.read(&mut chunk).expect("fixture reads request");
            assert_ne!(count, 0, "request closes before headers finish");
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break position + 4;
            }
        };
        let header_text = String::from_utf8_lossy(&bytes[..header_end]);
        let mut lines = header_text.split("\r\n");
        let mut request_line = lines
            .next()
            .expect("request line exists")
            .split_whitespace();
        let method = request_line.next().expect("method exists").to_owned();
        let path = request_line.next().expect("path exists").to_owned();
        let headers = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_owned()))
            .collect::<std::collections::HashMap<_, _>>();
        let content_length = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let count = stream.read(&mut chunk).expect("fixture reads request body");
            assert_ne!(count, 0, "request closes before body finishes");
            bytes.extend_from_slice(&chunk[..count]);
        }
        CapturedRequest {
            method,
            path,
            headers,
            body: bytes[header_end..header_end + content_length].to_vec(),
        }
    }

    fn client(base_url: &str, timeout: Duration) -> EmbeddingClient {
        let config =
            EmbeddingConfig::new(base_url, timeout).expect("fixture embedding config validates");
        EmbeddingClient::new(reqwest::Client::new(), config)
    }

    #[tokio::test]
    async fn embed_uses_exact_sidecar_request_and_validates_response_vectors() {
        let (base_url, server) = fixture(vec![FixtureResponse::json(
            200,
            "OK",
            r#"{"embeddings":[[0.1,0.2,0.3],[0.4,0.5,0.6]],"model":"all-MiniLM-L6-v2","count":2,"dimension":3}"#,
        )]);
        let client = client(&base_url, Duration::from_secs(2));
        let texts = vec!["first text".to_owned(), "second text".to_owned()];
        let response = client
            .embed(&texts, 8)
            .await
            .expect("valid embedding batch parses");
        assert_eq!(response.count, 2);
        assert_eq!(response.dimension, 3);
        assert_eq!(response.model, "all-MiniLM-L6-v2");
        assert_eq!(response.embeddings[1], [0.4, 0.5, 0.6]);

        let requests = server.join().expect("fixture completes");
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].path, "/embed");
        assert_eq!(
            requests[0].headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).expect("embed body is JSON"),
            json!({"texts":["first text","second text"],"batch_size":8})
        );
    }

    #[tokio::test]
    async fn health_uses_exact_path_and_deserializes_supported_health_shape() {
        let (base_url, server) = fixture(vec![FixtureResponse::json(
            200,
            "OK",
            r#"{"ok":true,"model":"all-MiniLM-L6-v2","loaded":true,"resource_monitor_running":true}"#,
        )]);
        let health = client(&base_url, Duration::from_secs(2))
            .health()
            .await
            .expect("health response parses");
        assert_eq!(
            health,
            EmbeddingHealth {
                ok: true,
                model: "all-MiniLM-L6-v2".into(),
                loaded: true,
                resource_monitor_running: true,
            }
        );
        let requests = server.join().expect("fixture completes");
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path, "/health");
        assert!(requests[0].body.is_empty());
    }

    #[tokio::test]
    async fn malformed_count_and_dimension_response_are_rejected() {
        let (base_url, server) = fixture(vec![
            FixtureResponse::json(
                200,
                "OK",
                r#"{"embeddings":[[0.1,0.2]],"model":"m","count":0,"dimension":2}"#,
            ),
            FixtureResponse::json(
                200,
                "OK",
                r#"{"embeddings":[[0.1]],"model":"m","count":1,"dimension":2}"#,
            ),
        ]);
        let client = client(&base_url, Duration::from_secs(2));
        let texts = vec!["query".to_owned()];
        assert!(matches!(
            client.embed(&texts, 1).await,
            Err(EmbeddingError::InvalidResponse { .. })
        ));
        assert!(matches!(
            client.embed(&texts, 1).await,
            Err(EmbeddingError::InvalidResponse { .. })
        ));
        assert_eq!(server.join().expect("fixture completes").len(), 2);
    }

    #[tokio::test]
    async fn invalid_batch_inputs_do_not_make_http_requests() {
        let client = client("http://127.0.0.1:1", Duration::from_secs(1));
        assert!(matches!(
            client.embed(&[], 1).await,
            Err(EmbeddingError::InvalidRequest(_))
        ));
        let texts = vec!["query".to_owned()];
        for invalid_size in [0, 257] {
            assert!(matches!(
                client.embed(&texts, invalid_size).await,
                Err(EmbeddingError::InvalidRequest(_))
            ));
        }
    }

    #[tokio::test]
    async fn status_body_and_response_size_limit_are_preserved() {
        let (base_url, server) = fixture(vec![FixtureResponse::json(
            503,
            "Service Unavailable",
            r#"{"detail":"private query text"}"#,
        )]);
        let texts = vec!["private query text".to_owned()];
        let error = client(&base_url, Duration::from_secs(2))
            .embed(&texts, 1)
            .await
            .expect_err("non-success status must remain an error");
        assert!(!error.to_string().contains("private query text"));
        assert!(!format!("{error:?}").contains("private query text"));
        match error {
            EmbeddingError::HttpStatus { status, body } => {
                assert_eq!(status.as_u16(), 503);
                assert!(body.contains("private query text"));
            }
            other => panic!("unexpected error: {other}"),
        }
        let requests = server.join().expect("fixture completes");
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].path, "/embed");
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).expect("error request is JSON"),
            json!({"texts":["private query text"],"batch_size":1})
        );

        let (base_url, server) = fixture(vec![FixtureResponse::json(
            200,
            "OK",
            r#"{"ok":true,"model":"all-MiniLM-L6-v2","loaded":true,"resource_monitor_running":true}"#,
        )]);
        let config = EmbeddingConfig::new(&base_url, Duration::from_secs(2))
            .expect("fixture config validates")
            .with_max_response_bytes(8)
            .expect("positive body cap");
        let error = EmbeddingClient::new(reqwest::Client::new(), config)
            .health()
            .await
            .expect_err("oversized body must not be retained");
        assert!(matches!(
            error,
            EmbeddingError::BodyTooLarge { limit: 8, .. }
        ));
        let _ = server.join().expect("fixture completes");
    }

    #[tokio::test]
    async fn configured_request_deadline_is_enforced() {
        let mut delayed = FixtureResponse::json(
            200,
            "OK",
            r#"{"ok":true,"model":"m","loaded":true,"resource_monitor_running":true}"#,
        );
        delayed.delay = Duration::from_millis(400);
        let (base_url, server) = fixture(vec![delayed]);
        let error = client(&base_url, Duration::from_millis(100))
            .health()
            .await
            .expect_err("slow sidecar request times out");
        assert!(error.is_timeout(), "expected a timeout, got {error}");
        let _ = server.join().expect("fixture completes after delay");
    }

    #[test]
    fn invalid_service_url_and_response_limits_are_rejected() {
        assert!(
            EmbeddingConfig::new("http://localhost:8002/embed", Duration::from_secs(1)).is_err()
        );
        assert!(EmbeddingConfig::new("http://u:p@localhost:8002", Duration::from_secs(1)).is_err());
        assert!(EmbeddingConfig::new("http://localhost:8002", Duration::ZERO).is_err());
        assert!(
            EmbeddingConfig::new("http://localhost:8002", Duration::from_secs(1))
                .expect("base config validates")
                .with_max_response_bytes(0)
                .is_err()
        );
    }

    #[test]
    fn response_validation_rejects_non_finite_or_zero_dimension_vectors() {
        let valid = EmbeddingResponse {
            embeddings: vec![vec![f64::NAN]],
            model: "model".into(),
            count: 1,
            dimension: 1,
        };
        assert!(valid.validate(1).is_err());
        let empty = EmbeddingResponse {
            embeddings: vec![Vec::new()],
            model: "model".into(),
            count: 1,
            dimension: 0,
        };
        assert!(empty.validate(1).is_err());
    }
}
