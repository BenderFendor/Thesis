use std::env;
use std::fmt;
use std::net::SocketAddr;
use std::time::Duration;

use reqwest::Url;

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:8120";
const DEFAULT_SHUTDOWN_TIMEOUT_SECONDS: u64 = 30;
const DEFAULT_READINESS_INTERVAL_SECONDS: u64 = 5;
const MAX_SHUTDOWN_TIMEOUT_SECONDS: u64 = 300;
const MAX_READINESS_INTERVAL_SECONDS: u64 = 60;

/// Database URL whose credentials are never included in debug output.
#[derive(Clone)]
pub(crate) struct DatabaseUrl(String);

impl DatabaseUrl {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for DatabaseUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

/// Validated settings for the opt-in Rust host runtime.
#[derive(Clone)]
pub(crate) struct RuntimeConfig {
    pub(crate) database_url: DatabaseUrl,
    pub(crate) bind_address: SocketAddr,
    pub(crate) shutdown_timeout: Duration,
    pub(crate) readiness_interval: Duration,
}

impl fmt::Debug for RuntimeConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RuntimeConfig")
            .field("database_url", &self.database_url)
            .field("bind_address", &self.bind_address)
            .field("shutdown_timeout", &self.shutdown_timeout)
            .field("readiness_interval", &self.readiness_interval)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RuntimeConfigError {
    MissingDatabaseUrl,
    InvalidDatabaseUrl,
    InvalidBindAddress,
    InvalidShutdownTimeout,
    InvalidReadinessInterval,
}

impl fmt::Display for RuntimeConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::MissingDatabaseUrl => "set THESIS_RUST_DATABASE_URL or a database URL",
            Self::InvalidDatabaseUrl => "database URL must be a valid PostgreSQL URL",
            Self::InvalidBindAddress => "THESIS_RUST_BIND must be a socket address",
            Self::InvalidShutdownTimeout => {
                "THESIS_RUST_SHUTDOWN_TIMEOUT_SECONDS must be between 1 and 300"
            }
            Self::InvalidReadinessInterval => {
                "THESIS_RUST_READINESS_INTERVAL_SECONDS must be between 1 and 60"
            }
        })
    }
}

impl std::error::Error for RuntimeConfigError {}

impl RuntimeConfig {
    pub(crate) fn from_env() -> Result<Self, RuntimeConfigError> {
        Self::from_lookup(|name| env::var(name).ok())
    }

    fn from_lookup(
        get: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, RuntimeConfigError> {
        let raw_database_url = get("THESIS_RUST_DATABASE_URL")
            .or_else(|| get("THESIS_DATABASE_URL"))
            .or_else(|| get("DATABASE_URL"))
            .ok_or(RuntimeConfigError::MissingDatabaseUrl)?;
        let normalized_database_url = raw_database_url.replace(
            "postgresql+asyncpg://",
            "postgresql://",
        );
        let parsed_database_url =
            Url::parse(&normalized_database_url).map_err(|_| RuntimeConfigError::InvalidDatabaseUrl)?;
        if !matches!(parsed_database_url.scheme(), "postgres" | "postgresql")
            || parsed_database_url.host_str().is_none()
        {
            return Err(RuntimeConfigError::InvalidDatabaseUrl);
        }

        let bind_address = get("THESIS_RUST_BIND")
            .unwrap_or_else(|| DEFAULT_BIND_ADDRESS.to_owned())
            .parse::<SocketAddr>()
            .map_err(|_| RuntimeConfigError::InvalidBindAddress)?;
        let shutdown_seconds = parse_bounded_seconds(
            get("THESIS_RUST_SHUTDOWN_TIMEOUT_SECONDS"),
            DEFAULT_SHUTDOWN_TIMEOUT_SECONDS,
            MAX_SHUTDOWN_TIMEOUT_SECONDS,
        )
        .ok_or(RuntimeConfigError::InvalidShutdownTimeout)?;
        let readiness_seconds = parse_bounded_seconds(
            get("THESIS_RUST_READINESS_INTERVAL_SECONDS"),
            DEFAULT_READINESS_INTERVAL_SECONDS,
            MAX_READINESS_INTERVAL_SECONDS,
        )
        .ok_or(RuntimeConfigError::InvalidReadinessInterval)?;

        Ok(Self {
            database_url: DatabaseUrl(normalized_database_url),
            bind_address,
            shutdown_timeout: Duration::from_secs(shutdown_seconds),
            readiness_interval: Duration::from_secs(readiness_seconds),
        })
    }
}

fn parse_bounded_seconds(
    raw: Option<String>,
    default: u64,
    maximum: u64,
) -> Option<u64> {
    let Some(raw) = raw else {
        return Some(default);
    };
    let seconds = raw.parse::<u64>().ok()?;
    (1..=maximum).contains(&seconds).then_some(seconds)
}

#[cfg(test)]
mod tests {
    use super::{DatabaseUrl, RuntimeConfig, RuntimeConfigError};

    fn config_with(database_url: &str) -> RuntimeConfig {
        RuntimeConfig::from_lookup(|name| match name {
            "THESIS_RUST_DATABASE_URL" => Some(database_url.to_owned()),
            _ => None,
        })
        .expect("runtime config")
    }

    #[test]
    fn config_redacts_database_credentials_from_debug_output() {
        let config = config_with("postgresql://reader:secret-token@database.example/thesis");
        let debug = format!("{config:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains("secret-token"));
        assert!(!debug.contains("reader"));
    }

    #[test]
    fn asyncpg_database_scheme_is_normalized_for_sqlx() {
        let config = config_with("postgresql+asyncpg://reader:secret-token@database.example/thesis");
        assert_eq!(
            config.database_url.as_str(),
            "postgresql://reader:secret-token@database.example/thesis"
        );
        assert!(!format!("{:?}", config.database_url).contains("secret-token"));
    }

    #[test]
    fn rust_database_url_takes_precedence_over_python_fallbacks() {
        let config = RuntimeConfig::from_lookup(|name| match name {
            "THESIS_RUST_DATABASE_URL" => Some("postgres://rust@db/thesis".to_owned()),
            "THESIS_DATABASE_URL" => Some("postgres://python@db/thesis".to_owned()),
            _ => None,
        })
        .expect("runtime config");
        assert_eq!(config.database_url.as_str(), "postgres://rust@db/thesis");
    }

    #[test]
    fn rejects_invalid_database_bind_and_unbounded_timeouts() {
        let missing_database = RuntimeConfig::from_lookup(|_| None);
        assert!(matches!(
            missing_database,
            Err(RuntimeConfigError::MissingDatabaseUrl)
        ));

        let invalid_database = RuntimeConfig::from_lookup(|name| match name {
            "THESIS_RUST_DATABASE_URL" => Some("https://db.example/thesis".to_owned()),
            _ => None,
        });
        assert!(matches!(
            invalid_database,
            Err(RuntimeConfigError::InvalidDatabaseUrl)
        ));

        let invalid_bind = RuntimeConfig::from_lookup(|name| match name {
            "THESIS_RUST_DATABASE_URL" => Some("postgres://db/thesis".to_owned()),
            "THESIS_RUST_BIND" => Some("0.0.0.0".to_owned()),
            _ => None,
        });
        assert!(matches!(
            invalid_bind,
            Err(RuntimeConfigError::InvalidBindAddress)
        ));

        let unbounded_timeout = RuntimeConfig::from_lookup(|name| match name {
            "THESIS_RUST_DATABASE_URL" => Some("postgres://db/thesis".to_owned()),
            "THESIS_RUST_SHUTDOWN_TIMEOUT_SECONDS" => Some("301".to_owned()),
            _ => None,
        });
        assert!(matches!(
            unbounded_timeout,
            Err(RuntimeConfigError::InvalidShutdownTimeout)
        ));
    }

    #[test]
    fn database_url_debug_is_redacted_without_a_runtime_config() {
        let url = DatabaseUrl("postgres://reader:secret@db/thesis".to_owned());
        assert_eq!(format!("{url:?}"), "[REDACTED]");
    }
}
