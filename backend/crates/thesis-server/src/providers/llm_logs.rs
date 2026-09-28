use std::env;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{Local, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;

static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(crate) struct LlmCallLogger {
    inner: Arc<Mutex<Option<LlmLogFiles>>>,
    session_directory: Arc<PathBuf>,
}

struct LlmLogFiles {
    calls: File,
    errors: File,
}

#[derive(Debug)]
pub(crate) struct LlmLoggingError(io::Error);

impl fmt::Display for LlmLoggingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "LLM session log write failed: {}", self.0)
    }
}

impl std::error::Error for LlmLoggingError {}

impl LlmCallLogger {
    /// Reserve this process's Python-compatible session path without creating files.
    pub(crate) fn from_env() -> Self {
        let manifest_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repository_root = manifest_directory
            .ancestors()
            .nth(3)
            .map(PathBuf::from)
            .unwrap_or(manifest_directory);
        let runtime_directory = env::var_os("THESIS_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| repository_root.join("runtime-data"));
        let default_logs = runtime_directory.join("logs");
        let log_directory = env::var_os("LOG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| default_logs.join("sessions"));
        let session_name = format!(
            "{}_{}",
            Local::now().format("%Y-%m-%d_%H-%M-%S"),
            std::process::id()
        );
        Self::for_session_directory(log_directory.join(session_name))
    }

    pub(crate) fn for_session_directory(session_directory: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            session_directory: Arc::new(session_directory),
        }
    }

    pub(crate) fn session_directory(&self) -> PathBuf {
        self.session_directory.as_ref().clone()
    }

    pub(crate) fn success(
        &self,
        request_id: &str,
        service: &str,
        model: &str,
        messages: &[Value],
        duration_ms: u64,
        finish_reason: Option<&str>,
    ) -> Result<(), LlmLoggingError> {
        self.append(
            json_line(LlmCallLog {
                timestamp: timestamp(),
                request_id,
                service,
                model,
                messages,
                duration_ms,
                success: true,
                finish_reason,
                error_type: None,
                error_message: None,
            })?,
            None,
        )
    }

    pub(crate) fn failure(
        &self,
        request_id: &str,
        service: &str,
        model: &str,
        messages: &[Value],
        duration_ms: u64,
        error_type: &str,
        error_message: &str,
    ) -> Result<(), LlmLoggingError> {
        let calls = json_line(LlmCallLog {
            timestamp: timestamp(),
            request_id,
            service,
            model,
            messages,
            duration_ms,
            success: false,
            finish_reason: None,
            error_type: Some(error_type),
            error_message: Some(error_message),
        })?;
        let errors = json_line(ApiErrorLog {
            timestamp: timestamp(),
            request_id,
            service,
            model,
            error_type,
            error_message,
        })?;
        self.append(calls, Some(errors))
    }

    fn append(
        &self,
        call_line: Vec<u8>,
        error_line: Option<Vec<u8>>,
    ) -> Result<(), LlmLoggingError> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if inner.is_none() {
            *inner = Some(open_log_files(&self.session_directory)?);
        }
        let files = inner.as_mut().expect("log files are initialized");
        append_line(&mut files.calls, &call_line).map_err(LlmLoggingError)?;
        if let Some(error_line) = error_line {
            append_line(&mut files.errors, &error_line).map_err(LlmLoggingError)?;
        }
        Ok(())
    }
}

fn open_log_files(session_directory: &PathBuf) -> Result<LlmLogFiles, LlmLoggingError> {
    fs::create_dir_all(session_directory).map_err(LlmLoggingError)?;
    let calls = OpenOptions::new()
        .create(true)
        .append(true)
        .open(session_directory.join("llm_calls.log"))
        .map_err(LlmLoggingError)?;
    let errors = OpenOptions::new()
        .create(true)
        .append(true)
        .open(session_directory.join("api_errors.log"))
        .map_err(LlmLoggingError)?;
    Ok(LlmLogFiles { calls, errors })
}

pub(crate) fn next_request_id() -> String {
    format!(
        "{:08x}",
        REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed) as u32
    )
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::AutoSi, false)
}

fn json_line(value: impl Serialize) -> Result<Vec<u8>, LlmLoggingError> {
    let mut bytes = serde_json::to_vec(&value).map_err(|error| LlmLoggingError(io::Error::other(error)))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn append_line(file: &mut File, line: &[u8]) -> io::Result<()> {
    let written = file.write(line)?;
    if written != line.len() {
        return Err(io::Error::new(
            io::ErrorKind::WriteZero,
            "LLM JSONL append was incomplete",
        ));
    }
    file.flush()
}

#[derive(Serialize)]
struct LlmCallLog<'a> {
    timestamp: String,
    request_id: &'a str,
    service: &'a str,
    model: &'a str,
    messages: &'a [Value],
    duration_ms: u64,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    finish_reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_type: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<&'a str>,
}

#[derive(Serialize)]
struct ApiErrorLog<'a> {
    timestamp: String,
    request_id: &'a str,
    service: &'a str,
    model: &'a str,
    error_type: &'a str,
    error_message: &'a str,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::thread;

    use serde_json::json;

    use super::{next_request_id, LlmCallLogger};

    #[test]
    fn concurrent_call_and_error_logs_are_lazy_append_only_jsonl() {
        let directory = std::env::temp_dir().join(format!(
            "thesis-llm-logs-{}-{}",
            std::process::id(),
            next_request_id()
        ));
        let logger = LlmCallLogger::for_session_directory(directory.clone());
        assert!(!directory.exists(), "opening the logger must not create Python's lazy files");

        let mut workers = Vec::new();
        for index in 0..16 {
            let logger = logger.clone();
            workers.push(thread::spawn(move || {
                let request_id = format!("{index:08x}");
                let messages = vec![
                    json!({"role": "system", "content": "system"}),
                    json!({"role": "user", "content": format!("user {index}")}),
                ];
                if index % 2 == 0 {
                    logger
                        .success(
                            &request_id,
                            "test_service",
                            "test-model",
                            &messages,
                            12,
                            Some("stop"),
                        )
                        .expect("success log");
                } else {
                    logger
                        .failure(
                            &request_id,
                            "test_service",
                            "test-model",
                            &messages,
                            12,
                            "UpstreamError",
                            "upstream failed",
                        )
                        .expect("failure log");
                }
            }));
        }
        for worker in workers {
            worker.join().expect("logger worker");
        }
        drop(logger);

        let call_entries = read_json_lines(&directory.join("llm_calls.log"));
        assert_eq!(call_entries.len(), 16);
        assert!(call_entries.iter().all(|entry| {
            entry["timestamp"].is_string()
                && entry["request_id"].is_string()
                && entry["service"] == "test_service"
                && entry["model"] == "test-model"
                && entry["messages"].is_array()
                && entry["duration_ms"] == 12
        }));
        assert!(call_entries.iter().any(|entry| {
            entry["success"] == true && entry["finish_reason"] == "stop"
        }));
        assert!(call_entries.iter().any(|entry| {
            entry["success"] == false
                && entry["error_type"] == "UpstreamError"
                && entry["error_message"] == "upstream failed"
        }));

        let error_entries = read_json_lines(&directory.join("api_errors.log"));
        assert_eq!(error_entries.len(), 8);
        assert!(error_entries.iter().all(|entry| {
            entry["timestamp"].is_string()
                && entry["request_id"].is_string()
                && entry["service"] == "test_service"
                && entry["model"] == "test-model"
                && entry["error_type"] == "UpstreamError"
                && entry["error_message"] == "upstream failed"
        }));
        fs::remove_dir_all(directory).expect("remove test log directory");
    }

    fn read_json_lines(path: &PathBuf) -> Vec<serde_json::Value> {
        fs::read_to_string(path)
            .expect("log file")
            .lines()
            .map(|line| serde_json::from_str(line).expect("valid JSONL"))
            .collect()
    }
}
