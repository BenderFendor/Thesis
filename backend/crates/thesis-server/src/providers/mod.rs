pub(crate) mod article_analysis;
pub(crate) mod chat;
pub(crate) mod entity_research;
pub(crate) mod gdelt;
pub(crate) mod llm_logs;
pub(crate) mod news_research;
pub(crate) mod safe_http;
pub(crate) mod source_catalog;
pub(crate) mod verification;
pub(crate) mod wiki;

pub(crate) use chat::{ChatClientError, ChatCompletionClient};
pub(crate) use safe_http::{SafeHttpError, SafeHttpFetcher, SafeHttpResponse};
pub(crate) use llm_logs::LlmCallLogger;
use std::env;
use std::fmt;
use std::time::Duration;

use reqwest::Client;
use reqwest::redirect::Policy;
use thesis_api::chroma::{ChromaClient, ChromaConfig};
use thesis_api::embedding::{EmbeddingClient, EmbeddingConfig};

use crate::queue_digest_provider::QueueDigestHttpProvider;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_CHROMA_TIMEOUT_SECONDS: u64 = 15;
const DEFAULT_EMBEDDING_TIMEOUT_SECONDS: u64 = 30;
const SERVICE_USER_AGENT: &str = "ThesisRustShadow/0.1";

/// One process-owned HTTP client and the typed upstream clients built from its clones.
#[derive(Clone)]
pub(crate) struct ProviderClients {
    pub(crate) http: Client,
    pub(crate) chroma: ChromaClient,
    pub(crate) embedding: EmbeddingClient,
    pub(crate) queue_digest: Option<QueueDigestHttpProvider>,
    pub(crate) chat: Option<ChatCompletionClient>,
    pub(crate) safe_http: SafeHttpFetcher,
    pub(crate) llm_logs: LlmCallLogger,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProviderClientError {
    InvalidChromaPort,
    InvalidChromaConfig,
    InvalidEmbeddingConfig,
    HttpClient,
}

impl fmt::Display for ProviderClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidChromaPort => "CHROMA_PORT must be a valid TCP port",
            Self::InvalidChromaConfig => "Chroma configuration is invalid",
            Self::InvalidEmbeddingConfig => "embedding service configuration is invalid",
            Self::HttpClient => "shared HTTP client could not be constructed",
        })
    }
}

impl std::error::Error for ProviderClientError {}

impl ProviderClients {
    pub(crate) fn from_env() -> Result<Self, ProviderClientError> {
        let client = fixed_upstream_client()?;
        let llm_logs = LlmCallLogger::from_env();
        let chroma_host = env::var("CHROMA_HOST").unwrap_or_else(|_| "localhost".to_owned());
        let chroma_port = env::var("CHROMA_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| ProviderClientError::InvalidChromaPort)?
            .unwrap_or(8001);
        let chroma_url = match env::var("CHROMA_URL") {
            Ok(url) => url,
            Err(_) => format!("http://{chroma_host}:{chroma_port}"),
        };
        let chroma_timeout = duration_from_env(
            "CHROMA_REQUEST_TIMEOUT_SECONDS",
            DEFAULT_CHROMA_TIMEOUT_SECONDS,
        )?;
        let chroma_config = ChromaConfig::new(
            &chroma_url,
            env::var("CHROMA_TENANT").unwrap_or_else(|_| "default_tenant".to_owned()),
            env::var("CHROMA_DATABASE").unwrap_or_else(|_| "default_database".to_owned()),
            env::var("CHROMA_COLLECTION").unwrap_or_else(|_| "news_articles".to_owned()),
            chroma_timeout,
        )
        .map_err(|_| ProviderClientError::InvalidChromaConfig)?;

        let embedding_url = env::var("EMBEDDING_SERVICE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8002".to_owned());
        let embedding_timeout = duration_from_env(
            "EMBEDDING_SERVICE_TIMEOUT_SECONDS",
            DEFAULT_EMBEDDING_TIMEOUT_SECONDS,
        )?;
        let embedding_config = EmbeddingConfig::new(&embedding_url, embedding_timeout)
            .map_err(|_| ProviderClientError::InvalidEmbeddingConfig)?;

        Ok(Self {
            chroma: ChromaClient::new(client.clone(), chroma_config),
            embedding: EmbeddingClient::new(client.clone(), embedding_config),
            queue_digest: QueueDigestHttpProvider::from_env(client.clone(), llm_logs.clone()),
            chat: ChatCompletionClient::from_env(client.clone(), llm_logs.clone()),
            safe_http: SafeHttpFetcher::new(),
            llm_logs,
            http: client,
        })
    }

    pub(crate) async fn probe_dependencies(&self) -> ProviderDependencyHealth {
        let (chroma, embedding) = tokio::join!(self.chroma.heartbeat(), self.embedding.health());
        ProviderDependencyHealth {
            chroma: chroma.is_ok(),
            embedding: embedding.is_ok_and(|health| health.ok && health.loaded),
            queue_digest: self.queue_digest.is_some(),
            chat: self.chat.is_some(),
        }
    }
}

fn fixed_upstream_client() -> Result<Client, ProviderClientError> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(DEFAULT_REQUEST_TIMEOUT)
        .user_agent(SERVICE_USER_AGENT)
        .build()
        .map_err(|_| ProviderClientError::HttpClient)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProviderDependencyHealth {
    pub(crate) chroma: bool,
    pub(crate) embedding: bool,
    pub(crate) chat: bool,
}

fn duration_from_env(name: &str, default: u64) -> Result<Duration, ProviderClientError> {
    let error = timeout_error(name);
    parse_duration_seconds(env::var(name).ok(), default, error)
}

fn timeout_error(name: &str) -> ProviderClientError {
    if name == "CHROMA_REQUEST_TIMEOUT_SECONDS" {
        ProviderClientError::InvalidChromaConfig
    } else {
        ProviderClientError::InvalidEmbeddingConfig
    }
}

fn parse_duration_seconds(
    raw: Option<String>,
    default: u64,
    error: ProviderClientError,
) -> Result<Duration, ProviderClientError> {
    let seconds = raw
        .map(|value| value.parse::<u64>())
        .transpose()
        .map_err(|_| error)?
        .unwrap_or(default);
    if seconds == 0 {
        return Err(error);
    }
    Ok(Duration::from_secs(seconds))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{parse_duration_seconds, ProviderClientError};

    #[test]
    fn service_timeouts_default_to_their_documented_values() {
        assert_eq!(
            parse_duration_seconds(None, 15, ProviderClientError::InvalidChromaConfig),
            Ok(Duration::from_secs(15))
        );
        assert_eq!(
            parse_duration_seconds(None, 30, ProviderClientError::InvalidEmbeddingConfig),
            Ok(Duration::from_secs(30))
        );
    }

    #[test]
    fn timeout_parser_rejects_zero_and_non_integer_values() {
        for raw in [Some("0".to_owned()), Some("1.5".to_owned())] {
            assert_eq!(
                parse_duration_seconds(
                    raw,
                    15,
                    ProviderClientError::InvalidChromaConfig
                ),
                Err(ProviderClientError::InvalidChromaConfig)
            );
        }
    }
}
