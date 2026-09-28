use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, NaiveDateTime, SecondsFormat, Utc};
use serde_json::{json, Value};

const DEFAULT_MAX_BYTES: u64 = 25 * 1024 * 1024;
const DEFAULT_BACKUP_COUNT: usize = 3;

struct RecordEntry {
    timestamp: String,
    sequence: u64,
    record: Value,
}

impl PartialEq for RecordEntry {
    fn eq(&self, other: &Self) -> bool {
        self.timestamp == other.timestamp && self.sequence == other.sequence
    }
}

impl Eq for RecordEntry {}

impl PartialOrd for RecordEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for RecordEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        self.timestamp
            .cmp(&other.timestamp)
            .then_with(|| self.sequence.cmp(&other.sequence))
    }
}

pub(super) fn performance_payload(log_directory: &Path, limit: usize, since_minutes: u16) -> Value {
    let _ = fs::create_dir_all(log_directory);
    let paths = matching_files(log_directory, "performance_");
    let since = Utc::now() - ChronoDuration::minutes(i64::from(since_minutes));
    let samples = read_jsonl_records(&paths, limit, Some(&since));
    json!({
        "generated_at": utc_isoformat(),
        "since_minutes": since_minutes,
        "returned": samples.len(),
        "files": paths.iter().map(|path| path_string(path)).collect::<Vec<_>>(),
        "samples": samples,
    })
}

pub(super) fn runtime_log_files(log_directory: &Path) -> Vec<Value> {
    let _ = fs::create_dir_all(log_directory);
    matching_files(log_directory, "")
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            let modified_at = metadata.modified().ok().map(|modified| {
                DateTime::<Utc>::from(modified).to_rfc3339_opts(SecondsFormat::Micros, false)
            });
            Some(json!({
                "path": path_string(&path),
                "size_bytes": metadata.len(),
                "modified_at": modified_at,
            }))
        })
        .collect()
}

pub(super) fn append_jsonl(path: &Path, value: &Value) -> std::io::Result<()> {
    let line = serde_json::to_vec(value)?;
    let max_bytes = positive_env_u64("THESIS_LOG_MAX_BYTES", DEFAULT_MAX_BYTES);
    let backup_count = positive_env_usize("THESIS_LOG_BACKUP_COUNT", DEFAULT_BACKUP_COUNT);
    fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new(".")))?;

    let current_size = fs::metadata(path).map_or(0, |metadata| metadata.len());
    if current_size > 0 && current_size.saturating_add(line.len() as u64 + 1) > max_bytes {
        rotate(path, backup_count)?;
    }

    let mut output = OpenOptions::new().create(true).append(true).open(path)?;
    output.write_all(&line)?;
    output.write_all(b"\n")
}

pub(super) fn utc_isoformat() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)
}

fn rotate(path: &Path, backup_count: usize) -> std::io::Result<()> {
    if backup_count == 0 {
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }
    let oldest = backup_path(path, backup_count);
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }
    for index in (1..backup_count).rev() {
        let source = backup_path(path, index);
        if source.exists() {
            fs::rename(&source, backup_path(path, index + 1))?;
        }
    }
    if path.exists() {
        fs::rename(path, backup_path(path, 1))?;
    }
    Ok(())
}

fn backup_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path
        .file_stem()
        .map_or_else(|| path.as_os_str().to_owned(), |stem| stem.to_os_string());
    name.push(format!(".{index}"));
    if let Some(extension) = path.extension() {
        name.push(".");
        name.push(extension);
    }
    path.with_file_name(name)
}

fn positive_env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn positive_env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn matching_files(log_directory: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut pending = vec![log_directory.to_path_buf()];
    let mut paths = Vec::new();
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            let is_file = file_type.is_file()
                || (file_type.is_symlink() && fs::metadata(&path).is_ok_and(|meta| meta.is_file()));
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if is_file && name.starts_with(prefix) && name.ends_with(".jsonl") {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths
}

fn read_jsonl_records(
    paths: &[PathBuf],
    limit: usize,
    since: Option<&DateTime<Utc>>,
) -> Vec<Value> {
    if limit == 0 {
        return Vec::new();
    }
    let mut latest = BinaryHeap::<Reverse<RecordEntry>>::with_capacity(limit);
    let mut sequence = 0_u64;
    for path in paths {
        let Ok(file) = File::open(path) else {
            continue;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(record) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if !record.is_object() || !record_is_recent(&record, since) {
                continue;
            }
            let timestamp = record
                .get("timestamp")
                .map_or_else(String::new, |value| match value {
                    Value::String(timestamp) => timestamp.clone(),
                    Value::Null => "None".to_owned(),
                    _ => value.to_string(),
                });
            let entry = RecordEntry {
                timestamp,
                sequence,
                record,
            };
            sequence = sequence.saturating_add(1);
            if latest.len() < limit {
                latest.push(Reverse(entry));
            } else if latest.peek().is_some_and(|oldest| entry > oldest.0) {
                latest.pop();
                latest.push(Reverse(entry));
            }
        }
    }
    let mut records = latest
        .into_vec()
        .into_iter()
        .map(|entry| entry.0)
        .collect::<Vec<_>>();
    records.sort();
    records.into_iter().map(|entry| entry.record).collect()
}

fn record_is_recent(record: &Value, since: Option<&DateTime<Utc>>) -> bool {
    let Some(since) = since else {
        return true;
    };
    record_timestamp(record)
        .as_ref()
        .is_none_or(|timestamp| timestamp >= since)
}

fn record_timestamp(record: &Value) -> Option<DateTime<Utc>> {
    let raw = record.get("timestamp")?.as_str()?;
    let normalized = raw
        .strip_suffix('Z')
        .map_or_else(|| raw.to_owned(), |without_z| format!("{without_z}+00:00"));
    if let Ok(timestamp) = DateTime::parse_from_rfc3339(&normalized) {
        return Some(timestamp.with_timezone(&Utc));
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(timestamp) = NaiveDateTime::parse_from_str(raw, format) {
            return Some(timestamp.and_utc());
        }
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|timestamp| timestamp.and_utc())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{matching_files, read_jsonl_records};
    use chrono::{DateTime, Utc};
    use serde_json::json;
    use std::fs;

    #[test]
    fn recursively_matches_performance_files_in_sorted_path_order() {
        let directory = tempfile::tempdir().expect("temp dir");
        fs::create_dir_all(directory.path().join("nested")).expect("nested directory");
        fs::write(directory.path().join("performance_z.jsonl"), "").expect("root file");
        fs::write(directory.path().join("nested/performance_a.jsonl"), "").expect("nested file");
        fs::write(directory.path().join("nested/other.jsonl"), "").expect("ignored file");

        let files = matching_files(directory.path(), "performance_");
        assert_eq!(
            files,
            vec![
                directory.path().join("nested/performance_a.jsonl"),
                directory.path().join("performance_z.jsonl"),
            ]
        );
    }

    #[test]
    fn jsonl_reader_skips_malformed_and_non_object_records() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("performance_bad.jsonl");
        fs::write(
            &path,
            "{\"timestamp\":\"2026-09-25T12:00:00+00:00\",\"value\":1}\nnot-json\n[]\n{\"timestamp\":\"bad\",\"value\":2}\n",
        )
        .expect("write jsonl");

        let records = read_jsonl_records(&[path], 10, None);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["value"], json!(1));
        assert_eq!(records[1]["value"], json!(2));
    }

    #[test]
    fn jsonl_reader_applies_utc_window_and_returns_sorted_latest_limit() {
        let directory = tempfile::tempdir().expect("temp dir");
        let old_path = directory.path().join("performance_old.jsonl");
        let recent_path = directory.path().join("performance_recent.jsonl");
        let now = Utc::now();
        let since = now - chrono::Duration::minutes(30);
        let old = (since - chrono::Duration::seconds(5)).to_rfc3339();
        let older_recent = (now - chrono::Duration::seconds(10)).to_rfc3339();
        let latest_offset = (now - chrono::Duration::seconds(3))
            .with_timezone(&chrono::FixedOffset::east_opt(2 * 60 * 60).expect("offset"))
            .to_rfc3339();
        fs::write(
            &old_path,
            format!(
                "{{\"timestamp\":\"{old}\",\"value\":\"old\"}}\n{{\"timestamp\":\"{older_recent}\",\"value\":\"older\"}}\n"
            ),
        )
        .expect("write older records");
        fs::write(
            &recent_path,
            format!("{{\"timestamp\":\"{latest_offset}\",\"value\":\"latest\"}}\n"),
        )
        .expect("write latest record");

        let records = read_jsonl_records(&[old_path, recent_path], 2, Some(&since));
        assert_eq!(
            records
                .iter()
                .map(|record| record["value"].as_str().expect("value"))
                .collect::<Vec<_>>(),
            vec!["older", "latest"]
        );
        let latest_time =
            DateTime::parse_from_rfc3339(records[1]["timestamp"].as_str().expect("timestamp"))
                .expect("latest timestamp");
        assert!(latest_time.with_timezone(&Utc) >= since);
    }
}
