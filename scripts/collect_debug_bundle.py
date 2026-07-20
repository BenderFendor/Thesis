#!/usr/bin/env python3
"""Collect a compact, agent-readable Thesis debug bundle."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SENSITIVE_KEY = re.compile(
    r"(?:^|[_-])(?:api[_-]?key|key|token|secret|password|cookie|authorization)"
    r"(?:$|[_-])",
    re.IGNORECASE,
)
SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password|cookie|authorization)\b"
    r"(\s*[:=]\s*)([^\s,;]+)"
)
URL_QUERY_VALUE = re.compile(r"([?&][^=\s&#]+)=([^&#\s]*)")
URL_PASSWORD = re.compile(r"(\b[a-z][a-z0-9+.-]*://[^:/\s@]+):([^@\s/]+)@", re.I)
CONFIG_ENV_NAMES = (
    "ENVIRONMENT",
    "DEBUG",
    "ENABLE_DATABASE",
    "ENABLE_VECTOR_STORE",
    "DATABASE_URL",
    "CHROMA_HOST",
    "CHROMA_PORT",
    "EMBEDDING_SERVICE_URL",
    "EMBEDDING_MODEL_NAME",
    "EMBEDDING_BATCH_SIZE",
    "EMBEDDING_QUEUE_SIZE",
    "THESIS_OBSERVABILITY_ENABLED",
    "THESIS_PERFORMANCE_SAMPLE_SECONDS",
    "THESIS_RUNTIME_DIR",
    "THESIS_SERVICE_NAME",
    "THESIS_LOG_MAX_BYTES",
    "THESIS_LOG_BACKUP_COUNT",
    "OTEL_ENABLED",
    "OTEL_SAMPLE_RATE",
    "OTEL_EXPORTER_ENDPOINT",
)
API_ENDPOINTS = {
    "runtime": "/debug/observability/runtime",
    "resources": "/debug/observability/resources",
    "performance": "/debug/observability/performance?limit=1000&since_minutes={minutes}",
    "debug_report": "/debug/logs/report",
    "profiling": "/profiling/summary",
    "queries": "/profiling/queries",
    "pipeline": "/debug/metrics/pipeline",
    "storage_drift": "/debug/storage/drift",
    "startup": "/debug/startup",
}


def utc_now() -> datetime:
    return datetime.now(UTC)


def parse_duration(value: str) -> timedelta:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([smhd])\s*", value.lower())
    if not match:
        raise argparse.ArgumentTypeError("duration must look like 30m, 2h, 1d, or 90s")
    amount = float(match.group(1))
    unit = match.group(2)
    seconds = amount * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
    return timedelta(seconds=seconds)


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def sanitize_text(value: str) -> str:
    """Redact common secret forms and URL values embedded in free-form text."""
    value = URL_PASSWORD.sub(r"\1:<redacted>@", value)
    value = URL_QUERY_VALUE.sub(r"\1=<redacted>", value)
    return SENSITIVE_ASSIGNMENT.sub(r"\1\2<redacted>", value)


def sanitize_value(key: str, value: object) -> object:
    if key.upper() == "DATABASE_URL" and isinstance(value, str):
        return URL_PASSWORD.sub(r"\1:<redacted>@", value)
    if SENSITIVE_KEY.search(key):
        return "<redacted>"
    return sanitize_record(value)


def sanitize_record(value: object) -> object:
    """Recursively redact sensitive fields before evidence leaves runtime data."""
    if isinstance(value, dict):
        return {str(key): sanitize_value(str(key), item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_record(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_record(item) for item in value]
    if isinstance(value, str):
        return sanitize_text(value)
    return value


def run_command(
    command: list[str], cwd: Path, timeout: float = 10.0
) -> dict[str, object]:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"available": False, "error": str(exc), "command": command}
    return {
        "available": True,
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout[-100_000:],
        "stderr": result.stderr[-50_000:],
    }


def fetch_json(base_url: str, path: str, timeout: float = 5.0) -> dict[str, object]:
    url = f"{base_url.rstrip('/')}{path}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return {
            "available": True,
            "url": sanitize_text(url),
            "payload": sanitize_record(payload),
        }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        return {"available": False, "url": url, "error": str(exc)}


def filter_jsonl(source: Path, destination: Path, since: datetime) -> dict[str, object]:
    total = 0
    kept = 0
    malformed = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        source_handle = source.open(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"source": str(source), "available": False, "error": str(exc)}

    with source_handle, destination.open("w", encoding="utf-8") as output:
        for line in source_handle:
            if not line.strip():
                continue
            total += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                malformed += 1
                continue
            if not isinstance(record, dict):
                malformed += 1
                continue
            timestamp = parse_timestamp(record.get("timestamp"))
            if timestamp is not None and timestamp < since:
                continue
            output.write(
                json.dumps(sanitize_record(record), default=str, separators=(",", ":"))
                + "\n"
            )
            kept += 1

    if kept == 0:
        destination.unlink(missing_ok=True)
    return {
        "source": str(source),
        "destination": str(destination),
        "available": True,
        "total_records": total,
        "kept_records": kept,
        "malformed_records": malformed,
    }


def collect_logs(
    root: Path, runtime_dir: Path, bundle_dir: Path, since: datetime
) -> list[dict[str, object]]:
    candidates: set[Path] = set()
    if runtime_dir.exists():
        candidates.update(
            path for path in runtime_dir.rglob("*.jsonl") if path.is_file()
        )
    legacy_dir = Path(os.environ.get("DEBUG_LOG_DIR", "/tmp/scoop_debug_logs"))
    if legacy_dir.exists() and legacy_dir.resolve() != runtime_dir.resolve():
        candidates.update(
            path for path in legacy_dir.rglob("*.jsonl") if path.is_file()
        )

    results: list[dict[str, object]] = []
    for source in sorted(candidates):
        try:
            relative = source.relative_to(runtime_dir)
        except ValueError:
            relative = Path("legacy") / source.name
        destination = bundle_dir / "logs" / relative
        results.append(filter_jsonl(source, destination, since))
    return results


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(sanitize_record(value), indent=2, default=str) + "\n",
        encoding="utf-8",
    )


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.exists():
        return records
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    records.append(value)
    except OSError:
        return []
    return records


def summarize(bundle_dir: Path, manifest: dict[str, Any]) -> str:
    records: list[dict[str, Any]] = []
    for path in (
        (bundle_dir / "logs").rglob("*.jsonl") if (bundle_dir / "logs").exists() else []
    ):
        records.extend(read_jsonl(path))

    errors = [
        record
        for record in records
        if record.get("error")
        or str(record.get("event_type", "")).endswith("_error")
        or record.get("result") == "error"
        or str(record.get("level", "")).lower() in {"error", "critical"}
    ]
    slow = [
        record
        for record in records
        if record.get("is_slow")
        or record.get("kind") == "operation"
        and (record.get("duration_ms") or 0) >= 1000
    ]
    samples = [record for record in records if record.get("kind") == "resource_sample"]

    max_process_cpu = max(
        (
            float(record.get("process", {}).get("cpu_percent") or 0)
            for record in samples
        ),
        default=0.0,
    )
    max_memory_percent = max(
        (
            float(record.get("system", {}).get("memory_used_percent") or 0)
            for record in samples
        ),
        default=0.0,
    )
    max_disk_percent = max(
        (float(record.get("disk", {}).get("used_percent") or 0) for record in samples),
        default=0.0,
    )
    max_event_loop_lag = max(
        (
            float(record.get("process", {}).get("event_loop_lag_ms") or 0)
            for record in samples
        ),
        default=0.0,
    )

    evidence: list[str] = []
    if errors:
        evidence.append(f"- {len(errors)} error-bearing event(s) were captured.")
    if slow:
        evidence.append(
            f"- {len(slow)} operation(s) exceeded 1 second or were explicitly flagged slow."
        )
    if samples:
        evidence.extend(
            [
                f"- Peak sampled process CPU: {max_process_cpu:.1f}%.",
                f"- Peak sampled system memory use: {max_memory_percent:.1f}%.",
                f"- Peak sampled disk use: {max_disk_percent:.1f}%.",
                f"- Peak sampled event-loop lag: {max_event_loop_lag:.1f} ms.",
            ]
        )
    if not evidence:
        evidence.append(
            "- No structured events were available in the selected time window."
        )

    revision = manifest.get("git", {}).get("revision", {})
    commit = "unknown"
    if isinstance(revision, dict):
        commit = str(revision.get("stdout", "")).strip() or "unknown"

    return "\n".join(
        [
            "# Thesis Debug Bundle",
            "",
            f"Generated: {manifest['generated_at']}",
            f"Window start: {manifest['since']}",
            f"Git revision: `{commit}`",
            "",
            "## Evidence summary",
            "",
            *evidence,
            "",
            "## How to use this bundle",
            "",
            "Start with `manifest.json`, then correlate `request_id`, `trace_id`, `service`, "
            "`operation`, and timestamps across `logs/` and `api/`. Conclusions should cite "
            "the underlying records rather than this generated summary alone.",
            "",
        ]
    )


def build_bundle(args: argparse.Namespace) -> tuple[Path, Path]:
    root = Path(args.root).resolve()
    runtime_dir = Path(
        os.environ.get("THESIS_RUNTIME_DIR", root / "runtime-data")
    ).resolve()
    generated_at = utc_now()
    since = generated_at - args.since
    stamp = generated_at.strftime("%Y-%m-%dT%H-%M-%SZ")
    output_root = Path(args.output or root / "debug-bundles").resolve()
    bundle_dir = output_root / stamp
    bundle_dir.mkdir(parents=True, exist_ok=False)

    log_results = collect_logs(root, runtime_dir, bundle_dir, since)
    minutes = max(1, int(args.since.total_seconds() / 60))

    api_results: dict[str, dict[str, object]] = {}
    for name, path_template in API_ENDPOINTS.items():
        path = path_template.format(minutes=minutes)
        result = fetch_json(args.api_url, path, timeout=args.timeout)
        api_results[name] = result
        write_json(bundle_dir / "api" / f"{name}.json", result)

    git_results = {
        "revision": run_command(["git", "rev-parse", "HEAD"], root),
        "branch": run_command(["git", "branch", "--show-current"], root),
        "status": run_command(["git", "status", "--short"], root),
        "recent_commits": run_command(
            ["git", "log", "-10", "--pretty=format:%H%x09%cI%x09%s"], root
        ),
    }
    write_json(bundle_dir / "git" / "state.json", git_results)

    configuration = {
        name: sanitize_value(name, os.environ[name])
        for name in CONFIG_ENV_NAMES
        if name in os.environ
    }
    runtime = {
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "node": run_command(["node", "--version"], root),
        "docker_compose": run_command(
            ["docker", "compose", "ps", "--format", "json"], root, timeout=15
        ),
        "configuration": configuration,
        "disk_usage": {
            "root": str(root),
            "total_bytes": shutil.disk_usage(root).total,
            "used_bytes": shutil.disk_usage(root).used,
            "free_bytes": shutil.disk_usage(root).free,
        },
    }
    write_json(bundle_dir / "runtime" / "context.json", runtime)

    manifest: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": generated_at.isoformat(),
        "since": since.isoformat(),
        "window_seconds": args.since.total_seconds(),
        "root": str(root),
        "runtime_dir": str(runtime_dir),
        "api_url": args.api_url,
        "logs": log_results,
        "api": api_results,
        "git": git_results,
    }
    write_json(bundle_dir / "manifest.json", manifest)
    (bundle_dir / "summary.md").write_text(
        summarize(bundle_dir, manifest), encoding="utf-8"
    )

    archive_path = output_root / f"{stamp}.zip"
    with zipfile.ZipFile(
        archive_path, "w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        for path in sorted(bundle_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(bundle_dir.parent))
    return bundle_dir, archive_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=parse_duration, default=parse_duration("30m"))
    parser.add_argument("--api-url", default="http://localhost:8000")
    parser.add_argument("--root", default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output")
    parser.add_argument("--timeout", type=float, default=5.0)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        bundle_dir, archive_path = build_bundle(args)
    except FileExistsError as exc:
        print(f"Bundle already exists: {exc}", file=sys.stderr)
        return 2
    print(bundle_dir)
    print(archive_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
