use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};

const NVIDIA_QUERY: &str =
    "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw";
const GPU_TIMEOUT: Duration = Duration::from_millis(1_500);
const SECTOR_BYTES: u64 = 512;

#[derive(Clone, Copy)]
struct CpuCounters {
    total: u64,
    idle: u64,
    process: u64,
    logical_cpu_count: Option<usize>,
}

/// Stateful CPU counters used to calculate interval percentages.
pub(super) struct CpuSampler {
    previous: Mutex<Option<CpuCounters>>,
}

impl CpuSampler {
    pub(super) fn new() -> Self {
        Self {
            previous: Mutex::new(read_cpu_counters()),
        }
    }

    pub(super) fn snapshot(
        &self,
        service: &str,
        pid: u32,
        event_loop_lag_ms: Option<f64>,
    ) -> Value {
        let counters = read_cpu_counters();
        let cpu_count_logical = counters
            .and_then(|counters| counters.logical_cpu_count)
            .or_else(logical_cpu_count);
        let (system_cpu_percent, process_cpu_percent) =
            self.percentages(counters, cpu_count_logical);
        let process_status = process_status();
        let process_io = process_io();
        let memory = memory_info();
        let swap = swap_info();
        let disk_usage = disk_usage();
        let disk_io = disk_io();
        let network_io = network_io();

        json!({
            "timestamp": utc_isoformat(),
            "kind": "resource_sample",
            "service": service,
            "pid": pid,
            "process": {
                "cpu_percent": process_cpu_percent,
                "rss_bytes": process_status.rss_bytes,
                "vms_bytes": process_status.vms_bytes,
                "thread_count": process_status.thread_count,
                "open_file_descriptors": open_file_descriptor_count(),
                "read_bytes": process_io.0,
                "write_bytes": process_io.1,
                "event_loop_lag_ms": event_loop_lag_ms,
            },
            "system": {
                "cpu_percent": system_cpu_percent,
                "cpu_count_logical": cpu_count_logical,
                "cpu_count_physical": physical_cpu_count(),
                "load_average": load_average(),
                "memory_total_bytes": memory.0,
                "memory_available_bytes": memory.1,
                "memory_used_percent": memory_used_percent(memory.0, memory.1),
                "swap_used_bytes": swap.0,
                "swap_used_percent": swap.1,
            },
            "disk": {
                "total_bytes": disk_usage.map(|usage| usage.0),
                "used_bytes": disk_usage.map(|usage| usage.1),
                "free_bytes": disk_usage.map(|usage| usage.2),
                "used_percent": disk_usage.map(|usage| usage.3),
                "read_bytes": disk_io.map(|usage| usage.0),
                "write_bytes": disk_io.map(|usage| usage.1),
                "read_count": disk_io.map(|usage| usage.2),
                "write_count": disk_io.map(|usage| usage.3),
            },
            "network": {
                "bytes_sent": network_io.map(|usage| usage.0),
                "bytes_received": network_io.map(|usage| usage.1),
                "packets_sent": network_io.map(|usage| usage.2),
                "packets_received": network_io.map(|usage| usage.3),
            },
            "gpus": gpu_snapshot(),
        })
    }

    fn percentages(
        &self,
        current: Option<CpuCounters>,
        logical_cpu_count: Option<usize>,
    ) -> (Option<f64>, Option<f64>) {
        let Some(current) = current else {
            return (None, None);
        };
        let mut previous = self
            .previous
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(previous_counters) = previous.replace(current) else {
            return (Some(0.0), Some(0.0));
        };
        let total_delta = current.total.saturating_sub(previous_counters.total);
        if total_delta == 0 {
            return (Some(0.0), Some(0.0));
        }
        let idle_delta = current
            .idle
            .saturating_sub(previous_counters.idle)
            .min(total_delta);
        let system_percent =
            round_percent((total_delta - idle_delta) as f64 * 100.0 / total_delta as f64);
        let process_percent = logical_cpu_count.map(|count| {
            round_percent(
                current.process.saturating_sub(previous_counters.process) as f64
                    * count as f64
                    * 100.0
                    / total_delta as f64,
            )
        });
        (Some(system_percent), process_percent)
    }
}

#[derive(Default)]
struct ProcessStatus {
    rss_bytes: Option<u64>,
    vms_bytes: Option<u64>,
    thread_count: Option<u64>,
}

fn utc_isoformat() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

fn round_percent(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn read_cpu_counters() -> Option<CpuCounters> {
    #[cfg(target_os = "linux")]
    {
        let stat = fs::read_to_string("/proc/stat").ok()?;
        let cpu_line = stat.lines().find(|line| line.starts_with("cpu "))?;
        let mut total = 0_u64;
        let mut idle = 0_u64;
        let mut field_count = 0;
        for (index, field) in cpu_line.split_whitespace().skip(1).take(8).enumerate() {
            let value = field.parse::<u64>().ok()?;
            total = total.saturating_add(value);
            match index {
                3 => idle = value,
                4 => idle = idle.saturating_add(value),
                _ => {}
            }
            field_count = index + 1;
        }
        if field_count < 4 {
            return None;
        }
        let process = fs::read_to_string("/proc/self/stat")
            .ok()
            .and_then(|contents| parse_process_ticks(&contents))?;
        Some(CpuCounters {
            total,
            idle,
            process,
            logical_cpu_count: logical_cpu_count_from_stat(&stat),
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn parse_process_ticks(stat: &str) -> Option<u64> {
    let command_end = stat.rfind(')')?;
    let mut fields = stat.get(command_end + 1..)?.split_whitespace();
    let user = fields.nth(11)?.parse::<u64>().ok()?;
    let system = fields.next()?.parse::<u64>().ok()?;
    Some(user.saturating_add(system))
}

fn logical_cpu_count() -> Option<usize> {
    #[cfg(target_os = "linux")]
    {
        let contents = fs::read_to_string("/proc/stat").ok()?;
        logical_cpu_count_from_stat(&contents)
    }
    #[cfg(not(target_os = "linux"))]
    {
        std::thread::available_parallelism().ok().map(usize::from)
    }
}

fn logical_cpu_count_from_stat(stat: &str) -> Option<usize> {
    let count = stat
        .lines()
        .filter(|line| {
            line.strip_prefix("cpu")
                .is_some_and(|suffix| suffix.as_bytes().first().is_some_and(u8::is_ascii_digit))
        })
        .count();
    (count > 0).then_some(count)
}

fn physical_cpu_count() -> Option<usize> {
    #[cfg(target_os = "linux")]
    {
        let contents = fs::read_to_string("/proc/cpuinfo").ok()?;
        let mut identifiers = BTreeSet::new();
        for processor in contents.split("\n\n") {
            let mut physical_id = None;
            let mut core_id = None;
            for line in processor.lines() {
                let Some((key, value)) = line.split_once(':') else {
                    continue;
                };
                match key.trim() {
                    "physical id" => physical_id = value.trim().parse::<u32>().ok(),
                    "core id" => core_id = value.trim().parse::<u32>().ok(),
                    _ => {}
                }
            }
            if let (Some(package), Some(core)) = (physical_id, core_id) {
                identifiers.insert((package, core));
            }
        }
        (!identifiers.is_empty()).then_some(identifiers.len())
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn process_status() -> ProcessStatus {
    #[cfg(target_os = "linux")]
    {
        let Ok(contents) = fs::read_to_string("/proc/self/status") else {
            return ProcessStatus::default();
        };
        let mut status = ProcessStatus::default();
        for line in contents.lines() {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let parsed = value
                .split_whitespace()
                .next()
                .and_then(|number| number.parse::<u64>().ok());
            match key {
                "VmRSS" => status.rss_bytes = parsed.map(kibibytes_to_bytes),
                "VmSize" => status.vms_bytes = parsed.map(kibibytes_to_bytes),
                "Threads" => status.thread_count = parsed,
                _ => {}
            }
        }
        status
    }
    #[cfg(not(target_os = "linux"))]
    {
        ProcessStatus::default()
    }
}

fn process_io() -> (Option<u64>, Option<u64>) {
    #[cfg(target_os = "linux")]
    {
        let Ok(contents) = fs::read_to_string("/proc/self/io") else {
            return (None, None);
        };
        let mut read = None;
        let mut written = None;
        for line in contents.lines() {
            if let Some(value) = line.strip_prefix("read_bytes:") {
                read = value.trim().parse::<u64>().ok();
            } else if let Some(value) = line.strip_prefix("write_bytes:") {
                written = value.trim().parse::<u64>().ok();
            }
        }
        (read, written)
    }
    #[cfg(not(target_os = "linux"))]
    {
        (None, None)
    }
}

fn open_file_descriptor_count() -> Option<usize> {
    #[cfg(target_os = "linux")]
    {
        fs::read_dir("/proc/self/fd")
            .ok()
            .map(|entries| entries.filter_map(Result::ok).count().saturating_sub(1))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn memory_info() -> (Option<u64>, Option<u64>) {
    #[cfg(target_os = "linux")]
    {
        let Ok(contents) = fs::read_to_string("/proc/meminfo") else {
            return (None, None);
        };
        (
            meminfo_value(&contents, "MemTotal"),
            meminfo_value(&contents, "MemAvailable"),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        (None, None)
    }
}

fn meminfo_value(contents: &str, name: &str) -> Option<u64> {
    let value = contents
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key == name).then_some(value)
        })?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()?;
    Some(kibibytes_to_bytes(value))
}

fn memory_used_percent(total: Option<u64>, available: Option<u64>) -> Option<f64> {
    let (total, available) = (total?, available?);
    if total == 0 {
        return None;
    }
    let used = total.saturating_sub(available);
    Some(round_percent(used as f64 * 100.0 / total as f64))
}

fn swap_info() -> (Option<u64>, Option<f64>) {
    #[cfg(target_os = "linux")]
    {
        let Ok(contents) = fs::read_to_string("/proc/meminfo") else {
            return (None, None);
        };
        let total = meminfo_value(&contents, "SwapTotal");
        let free = meminfo_value(&contents, "SwapFree");
        match (total, free) {
            (Some(total), Some(free)) => {
                let used = total.saturating_sub(free);
                let percent = if total == 0 {
                    0.0
                } else {
                    round_percent(used as f64 * 100.0 / total as f64)
                };
                (Some(used), Some(percent))
            }
            _ => (None, None),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        (None, None)
    }
}

fn load_average() -> Option<Vec<f64>> {
    #[cfg(target_os = "linux")]
    {
        let contents = fs::read_to_string("/proc/loadavg").ok()?;
        let mut values = contents.split_whitespace().take(3).map(str::parse::<f64>);
        Some(vec![
            values.next()?.ok()?,
            values.next()?.ok()?,
            values.next()?.ok()?,
        ])
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn disk_usage() -> Option<(u64, u64, u64, f64)> {
    let output = Command::new("df")
        .args(["--output=size,used,avail,pcent", "-B1", "/"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let fields = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .nth(1)?;
    let mut values = fields.split_whitespace();
    let total = values.next()?.parse::<u64>().ok()?;
    let used = values.next()?.parse::<u64>().ok()?;
    let free = values.next()?.parse::<u64>().ok()?;
    let percent = values.next()?.strip_suffix('%')?.parse::<f64>().ok()?;
    Some((total, used, free, percent))
}
fn disk_io() -> Option<(u64, u64, u64, u64)> {
    #[cfg(target_os = "linux")]
    {
        if !Path::new("/sys/class/block").is_dir() {
            return None;
        }
        let contents = fs::read_to_string("/proc/diskstats").ok()?;
        let mut total = (0_u64, 0_u64, 0_u64, 0_u64);
        let mut found = false;
        for line in contents.lines() {
            let mut fields = line.split_whitespace();
            let Some(name) = fields.nth(2) else {
                continue;
            };
            let partition_path = Path::new("/sys/class/block").join(name).join("partition");
            if fs::metadata(partition_path).is_ok() {
                continue;
            }
            let (Some(read_count), Some(read_sectors), Some(write_count), Some(write_sectors)) = (
                fields.next().and_then(|field| field.parse::<u64>().ok()),
                fields.nth(1).and_then(|field| field.parse::<u64>().ok()),
                fields.nth(1).and_then(|field| field.parse::<u64>().ok()),
                fields.nth(1).and_then(|field| field.parse::<u64>().ok()),
            ) else {
                continue;
            };
            total.0 = total
                .0
                .saturating_add(read_sectors.saturating_mul(SECTOR_BYTES));
            total.1 = total
                .1
                .saturating_add(write_sectors.saturating_mul(SECTOR_BYTES));
            total.2 = total.2.saturating_add(read_count);
            total.3 = total.3.saturating_add(write_count);
            found = true;
        }
        found.then_some(total)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn network_io() -> Option<(u64, u64, u64, u64)> {
    #[cfg(target_os = "linux")]
    {
        let contents = fs::read_to_string("/proc/net/dev").ok()?;
        let mut total = (0_u64, 0_u64, 0_u64, 0_u64);
        let mut found = false;
        for line in contents.lines().skip(2) {
            let Some((_, counters)) = line.split_once(':') else {
                continue;
            };
            let mut fields = counters.split_whitespace();
            let (
                Some(bytes_received),
                Some(packets_received),
                Some(bytes_sent),
                Some(packets_sent),
            ) = (
                fields.next().and_then(|field| field.parse::<u64>().ok()),
                fields.next().and_then(|field| field.parse::<u64>().ok()),
                fields.nth(6).and_then(|field| field.parse::<u64>().ok()),
                fields.next().and_then(|field| field.parse::<u64>().ok()),
            )
            else {
                continue;
            };
            total.0 = total.0.saturating_add(bytes_sent);
            total.1 = total.1.saturating_add(bytes_received);
            total.2 = total.2.saturating_add(packets_sent);
            total.3 = total.3.saturating_add(packets_received);
            found = true;
        }
        found.then_some(total)
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn gpu_snapshot() -> Vec<Value> {
    let Some(executable) = find_executable("nvidia-smi") else {
        return Vec::new();
    };
    let mut child = match Command::new(executable)
        .args([
            format!("--query-gpu={NVIDIA_QUERY}"),
            "--format=csv,noheader,nounits".to_owned(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Vec::new(),
    };
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < GPU_TIMEOUT => thread::sleep(Duration::from_millis(20)),
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Vec::new();
            }
        }
    };
    if !status.is_some_and(|status| status.success()) {
        return Vec::new();
    }
    let mut output = String::new();
    if child
        .stdout
        .take()
        .is_none_or(|mut stdout| stdout.read_to_string(&mut output).is_err())
    {
        return Vec::new();
    }
    parse_gpu_rows(&output)
}

fn find_executable(name: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|path| {
            let Ok(metadata) = fs::metadata(path) else {
                return false;
            };
            if !metadata.is_file() {
                return false;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                metadata.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                true
            }
        })
}

fn parse_gpu_rows(output: &str) -> Vec<Value> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split(',').map(str::trim);
            let index = fields.next()?;
            let name = fields.next()?;
            let utilization = fields.next()?;
            let memory_used = parse_gpu_number(fields.next()?);
            let memory_total = parse_gpu_number(fields.next()?);
            let temperature = fields.next()?;
            let power = fields.next()?;
            if fields.next().is_some() {
                return None;
            }
            Some(json!({
                "index": index.parse::<u64>().map_or_else(
                    |_| Value::String(index.to_owned()),
                    Value::from,
                ),
                "name": name,
                "utilization_percent": parse_gpu_number(utilization),
                "memory_used_bytes": memory_used.map(mibibytes_to_bytes),
                "memory_total_bytes": memory_total.map(mibibytes_to_bytes),
                "temperature_celsius": parse_gpu_number(temperature),
                "power_watts": parse_gpu_number(power),
            }))
        })
        .collect()
}

fn parse_gpu_number(value: &str) -> Option<f64> {
    if value.is_empty() || matches!(value, "N/A" | "[Not Supported]") {
        return None;
    }
    value
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite() && *number >= 0.0)
}

fn mibibytes_to_bytes(value: f64) -> u64 {
    (value * 1024.0 * 1024.0) as u64
}

fn kibibytes_to_bytes(value: u64) -> u64 {
    value.saturating_mul(1024)
}

pub(super) fn runtime_metadata() -> Value {
    let os = match std::env::consts::OS {
        "linux" => "Linux",
        "macos" => "macOS",
        "windows" => "Windows",
        other => other,
    };
    let release = fs::read_to_string("/proc/sys/kernel/osrelease")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let platform = release.as_ref().map_or_else(
        || format!("{os}-{}", std::env::consts::ARCH),
        |release| format!("{os}-{release}-{}", std::env::consts::ARCH),
    );
    let processor = fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|contents| {
            contents.lines().find_map(|line| {
                let (key, value) = line.split_once(':')?;
                matches!(key.trim(), "model name" | "Hardware")
                    .then(|| value.trim().to_owned())
                    .filter(|value| !value.is_empty())
            })
        });
    let processor = processor.unwrap_or_default();
    json!({
        "os": os,
        "platform": platform,
        "machine": std::env::consts::ARCH,
        "processor": processor,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_gpu_rows, parse_process_ticks};
    use serde_json::json;

    #[test]
    fn gpu_rows_preserve_nullable_metrics_and_convert_memory_units() {
        assert_eq!(
            parse_gpu_rows("0, NVIDIA GPU, 84, 1024, 12288, 71, 120.5\n1, Test, N/A, N/A, 4096, [Not Supported], N/A\n"),
            vec![
                json!({
                    "index": 0,
                    "name": "NVIDIA GPU",
                    "utilization_percent": 84.0,
                    "memory_used_bytes": 1024 * 1024 * 1024_u64,
                    "memory_total_bytes": 12 * 1024 * 1024 * 1024_u64,
                    "temperature_celsius": 71.0,
                    "power_watts": 120.5,
                }),
                json!({
                    "index": 1,
                    "name": "Test",
                    "utilization_percent": null,
                    "memory_used_bytes": null,
                    "memory_total_bytes": 4096 * 1024 * 1024_u64,
                    "temperature_celsius": null,
                    "power_watts": null,
                }),
            ]
        );
    }

    #[test]
    fn process_cpu_ticks_are_parsed_after_a_parenthesized_command() {
        let stat = "42 (worker command ) with spaces) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22";
        assert_eq!(parse_process_ticks(stat), Some(23));
    }
}
