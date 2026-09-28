#![forbid(unsafe_code)]

//! Local resource sampling and JSONL history for the Rust backend.
//!
//! The host collector uses Linux procfs and fixed-argument `df`/optional
//! `nvidia-smi` invocations. Unsupported host metrics remain JSON `null`.
//! Sampling is owned by a [`SamplingTask`]; the server must await
//! [`SamplingTask::shutdown`] during graceful shutdown.

mod history;
mod metrics;

use std::env;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{self, Instant, MissedTickBehavior};

/// Configuration for one process-local resource monitor.
#[derive(Clone, Debug)]
pub struct ObservabilityConfig {
    /// Logical service name written to snapshots and the log filename.
    pub service_name: String,
    /// Sampling frequency in seconds; values below one are clamped to one.
    pub interval_seconds: f64,
    /// Runtime data root. Its `logs/` child is the observability log directory.
    pub runtime_data_dir: PathBuf,
    /// Whether periodic sampling is enabled.
    pub enabled: bool,
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        let runtime_data_dir = env::var_os("THESIS_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_runtime_data_directory);
        let service_name = env::var("THESIS_SERVICE_NAME")
            .ok()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "backend".to_owned());
        let interval_seconds = env::var("THESIS_PERFORMANCE_SAMPLE_SECONDS")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite())
            .unwrap_or(5.0)
            .max(1.0);
        let enabled = !matches!(
            env::var("THESIS_OBSERVABILITY_ENABLED").as_deref(),
            Ok("0" | "false" | "False" | "")
        );
        Self {
            service_name,
            interval_seconds,
            runtime_data_dir,
            enabled,
        }
    }
}

/// Resolve the same repository-root `runtime-data` default as the Python logger.
pub fn default_runtime_data_directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new("."))
        .join("runtime-data")
}

/// Process-local resource sampler and hidden observability response source.
#[derive(Clone)]
pub struct Observability {
    inner: Arc<Inner>,
}

struct Inner {
    config: ObservabilityConfig,
    runtime_log_dir: PathBuf,
    log_path: PathBuf,
    running: AtomicBool,
    latest: Mutex<Option<Value>>,
    event_loop_lag_ms: Mutex<Option<f64>>,
    cpu_sampler: metrics::CpuSampler,
}

impl Observability {
    /// Create an observer with explicit configuration.
    pub fn new(mut config: ObservabilityConfig) -> Self {
        if config.service_name.is_empty() {
            config.service_name = "backend".to_owned();
        }
        if !config.interval_seconds.is_finite() {
            config.interval_seconds = 1.0;
        }
        config.interval_seconds = config.interval_seconds.max(1.0);
        if Duration::try_from_secs_f64(config.interval_seconds).is_err() {
            config.interval_seconds = 1.0;
        }
        let runtime_log_dir = config.runtime_data_dir.join("logs");
        let safe_service_name = config
            .service_name
            .chars()
            .map(|character| {
                if character.is_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let log_path = runtime_log_dir.join(format!(
            "performance_{}_{}.jsonl",
            safe_service_name,
            std::process::id()
        ));
        Self {
            inner: Arc::new(Inner {
                config,
                runtime_log_dir,
                log_path,
                running: AtomicBool::new(false),
                latest: Mutex::new(None),
                event_loop_lag_ms: Mutex::new(None),
                cpu_sampler: metrics::CpuSampler::new(),
            }),
        }
    }

    /// Read the same process environment keys used by the Python resource monitor.
    pub fn from_env() -> Self {
        Self::new(ObservabilityConfig::default())
    }

    /// Return the effective resource-monitor configuration.
    pub fn config(&self) -> &ObservabilityConfig {
        &self.inner.config
    }

    /// Return the performance JSONL path for this process.
    pub fn log_path(&self) -> &Path {
        &self.inner.log_path
    }

    /// Report whether the owned sampler task is currently running.
    pub fn is_running(&self) -> bool {
        self.inner.running.load(Ordering::Acquire)
    }

    /// Start periodic sampling and return the cancellation/join handle.
    ///
    /// Returns `None` when sampling is disabled or already running. The caller
    /// must retain the handle and await [`SamplingTask::shutdown`] at shutdown.
    pub fn start_sampling(&self) -> Option<SamplingTask> {
        if !self.inner.config.enabled
            || self
                .inner
                .running
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return None;
        }
        let (cancel, cancellation) = oneshot::channel();
        let join = tokio::spawn(run_sampler(self.clone(), cancellation));
        Some(SamplingTask {
            cancel: Some(cancel),
            join: Some(join),
        })
    }

    /// Collect a fresh resource snapshot away from the async executor thread.
    pub async fn resources(&self) -> Result<Value, ObservabilityError> {
        let observer = self.clone();
        run_blocking(move || observer.collect_snapshot()).await
    }

    /// Read recent performance records across recursively discovered JSONL files.
    pub async fn performance(
        &self,
        limit: usize,
        since_minutes: u16,
    ) -> Result<Value, ObservabilityError> {
        let observer = self.clone();
        run_blocking(move || {
            history::performance_payload(&observer.inner.runtime_log_dir, limit, since_minutes)
        })
        .await
    }

    /// Return process runtime facts and metadata for existing JSONL files.
    pub async fn runtime(&self) -> Result<Value, ObservabilityError> {
        let observer = self.clone();
        run_blocking(move || observer.runtime_payload()).await
    }

    /// Report sampler health and the latest known or freshly collected snapshot.
    pub async fn health(&self) -> Result<Value, ObservabilityError> {
        let observer = self.clone();
        run_blocking(move || observer.health_payload()).await
    }

    fn collect_snapshot(&self) -> Value {
        let event_loop_lag_ms = *self
            .inner
            .event_loop_lag_ms
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let snapshot = self.inner.cpu_sampler.snapshot(
            &self.inner.config.service_name,
            std::process::id(),
            event_loop_lag_ms,
        );
        *self
            .inner
            .latest
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(snapshot.clone());
        snapshot
    }

    fn latest_or_collect(&self) -> Value {
        let latest = self
            .inner
            .latest
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        latest.unwrap_or_else(|| self.collect_snapshot())
    }

    fn sample_and_append(&self) {
        let snapshot = self.collect_snapshot();
        if let Err(error) = history::append_jsonl(&self.inner.log_path, &snapshot) {
            tracing::warn!(
                path = %self.inner.log_path.display(),
                %error,
                "Could not write performance sample"
            );
        }
    }

    fn runtime_payload(&self) -> Value {
        let _ = fs::create_dir_all(&self.inner.config.runtime_data_dir);
        let _ = fs::create_dir_all(&self.inner.runtime_log_dir);
        let facts = metrics::runtime_metadata();
        json!({
            "timestamp": history::utc_isoformat(),
            "service": self.inner.config.service_name,
            "pid": std::process::id(),
            "python": null,
            "runtime_language": "rust",
            "os": facts["os"],
            "platform": facts["platform"],
            "machine": facts["machine"],
            "processor": facts["processor"],
            "runtime_data_dir": self.inner.config.runtime_data_dir.to_string_lossy(),
            "runtime_log_dir": self.inner.runtime_log_dir.to_string_lossy(),
            "resource_monitor": {
                "enabled": self.inner.config.enabled,
                "running": self.is_running(),
                "interval_seconds": self.inner.config.interval_seconds,
                "log_path": self.inner.log_path.to_string_lossy(),
            },
            "log_files": history::runtime_log_files(&self.inner.runtime_log_dir),
        })
    }

    fn health_payload(&self) -> Value {
        json!({
            "status": if self.is_running() { "healthy" } else { "degraded" },
            "monitor_running": self.is_running(),
            "performance_log_exists": self.inner.log_path.exists(),
            "performance_log_path": self.inner.log_path.to_string_lossy(),
            "latest_sample": self.latest_or_collect(),
        })
    }

    fn set_event_loop_lag(&self, scheduled: Instant) {
        let lag_ms = Instant::now()
            .saturating_duration_since(scheduled)
            .as_secs_f64()
            * 1000.0;
        *self
            .inner
            .event_loop_lag_ms
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(lag_ms.max(0.0));
    }
}

/// Cancellation handle for the sampler task.
pub struct SamplingTask {
    cancel: Option<oneshot::Sender<()>>,
    join: Option<JoinHandle<()>>,
}

impl SamplingTask {
    /// Cancel sampling, wait for any active blocking sample to finish, and join.
    pub async fn shutdown(mut self) {
        if let Some(cancel) = self.cancel.take() {
            let _ = cancel.send(());
        }
        if let Some(join) = self.join.take() {
            if let Err(error) = join.await {
                tracing::warn!(%error, "Resource sampler exited abnormally");
            }
        }
    }
}

impl Drop for SamplingTask {
    fn drop(&mut self) {
        if let Some(cancel) = self.cancel.take() {
            let _ = cancel.send(());
        }
    }
}

/// Background-task join failure without exposing runtime details in HTTP responses.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ObservabilityError;

impl fmt::Display for ObservabilityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("observability blocking task failed")
    }
}

impl std::error::Error for ObservabilityError {}

async fn run_blocking<T, F>(operation: F) -> Result<T, ObservabilityError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| ObservabilityError)
}

struct RunningGuard(Arc<Inner>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::Release);
    }
}

async fn run_sampler(observer: Observability, mut cancellation: oneshot::Receiver<()>) {
    let _running_guard = RunningGuard(Arc::clone(&observer.inner));
    let interval = Duration::from_secs_f64(observer.inner.config.interval_seconds);
    let mut samples = time::interval(interval);
    samples.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut lag_samples = time::interval(Duration::from_secs(1));
    lag_samples.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = &mut cancellation => break,
            scheduled = lag_samples.tick() => observer.set_event_loop_lag(scheduled),
            _ = samples.tick() => {
                let sample_observer = observer.clone();
                let mut sample = tokio::task::spawn_blocking(move || sample_observer.sample_and_append());
                loop {
                    tokio::select! {
                        _ = &mut cancellation => {
                            if let Err(error) = sample.await {
                                tracing::warn!(%error, "Resource sampling task failed during shutdown");
                            }
                            return;
                        }
                        scheduled = lag_samples.tick() => observer.set_event_loop_lag(scheduled),
                        result = &mut sample => {
                            if let Err(error) = result {
                                tracing::warn!(%error, "Resource sampling task failed");
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::time::Duration;

    use chrono::{DateTime, FixedOffset};

    use super::{default_runtime_data_directory, Observability, ObservabilityConfig};

    fn config(runtime_data_dir: &Path, enabled: bool) -> ObservabilityConfig {
        ObservabilityConfig {
            service_name: "test-service".to_owned(),
            interval_seconds: 1.0,
            runtime_data_dir: runtime_data_dir.to_path_buf(),
            enabled,
        }
    }

    #[tokio::test]
    async fn resource_projection_exposes_current_linux_metrics_and_utc_time() {
        let directory = tempfile::tempdir().expect("temp dir");
        let monitor = Observability::new(config(directory.path(), false));
        let snapshot = monitor.resources().await.expect("resource snapshot");

        assert_eq!(snapshot["kind"], "resource_sample");
        assert_eq!(snapshot["service"], "test-service");
        assert!(snapshot["pid"].as_u64().is_some());
        assert!(snapshot["process"].is_object());
        assert!(snapshot["system"].is_object());
        assert!(snapshot["disk"].is_object());
        assert!(snapshot["network"].is_object());
        assert!(snapshot["gpus"].is_array());
        for key in [
            "cpu_percent",
            "rss_bytes",
            "vms_bytes",
            "thread_count",
            "open_file_descriptors",
            "read_bytes",
            "write_bytes",
            "event_loop_lag_ms",
        ] {
            assert!(
                snapshot["process"].get(key).is_some(),
                "missing process.{key}"
            );
        }
        for key in [
            "cpu_percent",
            "cpu_count_logical",
            "cpu_count_physical",
            "load_average",
            "memory_total_bytes",
            "memory_available_bytes",
            "memory_used_percent",
            "swap_used_bytes",
            "swap_used_percent",
        ] {
            assert!(
                snapshot["system"].get(key).is_some(),
                "missing system.{key}"
            );
        }
        for key in [
            "total_bytes",
            "used_bytes",
            "free_bytes",
            "used_percent",
            "read_bytes",
            "write_bytes",
            "read_count",
            "write_count",
        ] {
            assert!(snapshot["disk"].get(key).is_some(), "missing disk.{key}");
        }
        for key in [
            "bytes_sent",
            "bytes_received",
            "packets_sent",
            "packets_received",
        ] {
            assert!(
                snapshot["network"].get(key).is_some(),
                "missing network.{key}"
            );
        }
        let timestamp =
            DateTime::parse_from_rfc3339(snapshot["timestamp"].as_str().expect("timestamp string"))
                .expect("valid timestamp");
        assert_eq!(
            timestamp.offset(),
            &FixedOffset::east_opt(0).expect("UTC offset")
        );
        #[cfg(target_os = "linux")]
        {
            assert!(snapshot["process"]["rss_bytes"].as_u64().is_some());
            assert!(snapshot["system"]["memory_total_bytes"].as_u64().is_some());
            assert!(snapshot["network"]["bytes_sent"].as_u64().is_some());
        }
    }

    #[tokio::test]
    async fn performance_response_aggregates_recent_nested_files_and_applies_limit() {
        let directory = tempfile::tempdir().expect("temp dir");
        let log_directory = directory.path().join("logs");
        fs::create_dir_all(log_directory.join("nested")).expect("nested logs");
        let now = chrono::Utc::now();
        let old = (now - chrono::Duration::hours(2)).to_rfc3339();
        let first = (now - chrono::Duration::seconds(10)).to_rfc3339();
        let second = (now - chrono::Duration::seconds(5)).to_rfc3339();
        fs::write(
            log_directory.join("performance_a.jsonl"),
            format!(
                "{{\"timestamp\":\"{old}\",\"value\":\"old\"}}\n{{\"timestamp\":\"{first}\",\"value\":1}}\n"
            ),
        )
        .expect("write root history");
        fs::write(
            log_directory.join("nested/performance_b.jsonl"),
            format!(
                "bad json\n{{\"timestamp\":\"{second}\",\"value\":2}}\n{{\"timestamp\":\"{second}\",\"value\":3}}\n"
            ),
        )
        .expect("write nested history");
        fs::write(log_directory.join("unrelated.jsonl"), "{}\n").expect("write unrelated");
        let monitor = Observability::new(config(directory.path(), false));

        let response = monitor.performance(2, 30).await.expect("history response");

        assert_eq!(response["since_minutes"], 30);
        assert_eq!(response["returned"], 2);
        assert_eq!(response["files"].as_array().expect("file paths").len(), 2);
        assert_eq!(response["samples"][0]["value"], 2);
        assert_eq!(response["samples"][1]["value"], 3);
        assert!(response["generated_at"].as_str().is_some());
    }

    #[tokio::test]
    async fn runtime_response_uses_repository_defaults_and_reports_existing_jsonl_files() {
        let expected_default = default_runtime_data_directory();
        assert_eq!(
            expected_default,
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(3)
                .expect("project root")
                .join("runtime-data")
        );
        let default_monitor = Observability::new(ObservabilityConfig {
            service_name: "backend".to_owned(),
            interval_seconds: 5.0,
            runtime_data_dir: expected_default.clone(),
            enabled: false,
        });
        assert_eq!(
            default_monitor.log_path(),
            expected_default.join(format!(
                "logs/performance_backend_{}.jsonl",
                std::process::id()
            ))
        );

        let directory = tempfile::tempdir().expect("temp dir");
        let log_directory = directory.path().join("logs");
        fs::create_dir_all(&log_directory).expect("log directory");
        let history_path = log_directory.join("debug_sample.jsonl");
        fs::write(&history_path, "{}\n").expect("write runtime log");
        let monitor = Observability::new(config(directory.path(), false));

        let response = monitor.runtime().await.expect("runtime response");

        assert_eq!(response["service"], "test-service");
        assert_eq!(
            response["pid"].as_u64(),
            Some(u64::from(std::process::id()))
        );
        assert_eq!(
            response["runtime_data_dir"],
            directory.path().to_string_lossy().as_ref()
        );
        assert_eq!(
            response["runtime_log_dir"],
            log_directory.to_string_lossy().as_ref()
        );
        assert_eq!(response["resource_monitor"]["enabled"], false);
        assert_eq!(response["resource_monitor"]["running"], false);
        assert_eq!(response["resource_monitor"]["interval_seconds"], 1.0);
        assert!(response["resource_monitor"]["log_path"].as_str().is_some());
        let file = response["log_files"]
            .as_array()
            .expect("log files")
            .iter()
            .find(|file| file["path"] == history_path.to_string_lossy().as_ref())
            .expect("existing JSONL file");
        assert_eq!(file["size_bytes"], 3);
        assert!(file["modified_at"].as_str().is_some());
        if cfg!(target_os = "linux") {
            assert_eq!(response["os"], "Linux");
        }
        assert!(response["os"].as_str().is_some());
        assert!(response["platform"].as_str().is_some());
        assert!(response["machine"].as_str().is_some());
        assert!(response["processor"].is_string());
        assert_eq!(response["runtime_language"], "rust");
        assert!(response["python"].is_null());
    }

    #[tokio::test]
    async fn health_tracks_running_state_log_presence_and_latest_sample() {
        let directory = tempfile::tempdir().expect("temp dir");
        let monitor = Observability::new(config(directory.path(), true));
        let initially_degraded = monitor.health().await.expect("health response");
        assert_eq!(initially_degraded["status"], "degraded");
        assert_eq!(initially_degraded["monitor_running"], false);
        assert_eq!(initially_degraded["performance_log_exists"], false);
        assert!(initially_degraded["latest_sample"]["process"].is_object());

        let sampler = monitor.start_sampling().expect("enabled sampler");
        assert!(monitor.start_sampling().is_none());
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let health = monitor.health().await.expect("running health");
                if health["performance_log_exists"] == true {
                    break health;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("first sample was persisted");
        let running = monitor.health().await.expect("running health");
        assert_eq!(running["status"], "healthy");
        assert_eq!(running["monitor_running"], true);
        assert_eq!(running["performance_log_exists"], true);
        assert!(running["latest_sample"]["system"].is_object());

        sampler.shutdown().await;
        let stopped = monitor.health().await.expect("stopped health");
        assert_eq!(stopped["status"], "degraded");
        assert_eq!(stopped["monitor_running"], false);
        assert_eq!(stopped["performance_log_exists"], true);
    }

    #[tokio::test]
    async fn disabled_monitor_does_not_create_a_sampler_task() {
        let directory = tempfile::tempdir().expect("temp dir");
        let monitor = Observability::new(config(directory.path(), false));
        assert!(monitor.start_sampling().is_none());
        assert!(!monitor.is_running());
    }

    #[tokio::test]
    async fn performance_file_reader_skips_malformed_lines_and_objects() {
        let directory = tempfile::tempdir().expect("temp dir");
        let log_directory = directory.path().join("logs");
        fs::create_dir_all(&log_directory).expect("log directory");
        fs::write(
            log_directory.join("performance_malformed.jsonl"),
            "{\"value\":1}\nnot json\n[]\n{\"value\":2}\n",
        )
        .expect("write malformed history");
        let monitor = Observability::new(config(directory.path(), false));

        let response = monitor.performance(10, 30).await.expect("history response");

        assert_eq!(response["returned"], 2);
        assert_eq!(response["samples"][0]["value"], 1);
        assert_eq!(response["samples"][1]["value"], 2);
    }
}
