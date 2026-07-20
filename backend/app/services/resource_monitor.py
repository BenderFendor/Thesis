"""Lightweight resource sampling for agent-readable performance evidence."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psutil

from app.core.logging import get_logger, get_runtime_log_dir

logger = get_logger("resource_monitor")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _safe_call(default: Any, callback: Any) -> Any:
    try:
        return callback()
    except (
        AttributeError,
        OSError,
        PermissionError,
        RuntimeError,
        ValueError,
        psutil.Error,
    ):
        return default


def _number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) else None


def _parse_gpu_rows(output: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        fields = [field.strip() for field in line.split(",")]
        if len(fields) != 7:
            continue
        index, name, utilization, memory_used, memory_total, temperature, power = fields

        def as_float(raw: str) -> float | None:
            if raw in {"", "N/A", "[Not Supported]"}:
                return None
            try:
                return float(raw)
            except ValueError:
                return None

        used_mib = as_float(memory_used)
        total_mib = as_float(memory_total)
        rows.append(
            {
                "index": int(index) if index.isdigit() else index,
                "name": name,
                "utilization_percent": as_float(utilization),
                "memory_used_bytes": int(used_mib * 1024 * 1024)
                if used_mib is not None
                else None,
                "memory_total_bytes": int(total_mib * 1024 * 1024)
                if total_mib is not None
                else None,
                "temperature_celsius": as_float(temperature),
                "power_watts": as_float(power),
            }
        )
    return rows


def collect_gpu_snapshot(timeout_seconds: float = 1.5) -> list[dict[str, Any]]:
    """Collect NVIDIA GPU state when nvidia-smi is available."""
    executable = shutil.which("nvidia-smi")
    if executable is None:
        return []

    query = (
        "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw"
    )
    try:
        result = subprocess.run(
            [
                executable,
                f"--query-gpu={query}",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return _parse_gpu_rows(result.stdout)


def read_jsonl_records(
    paths: Iterable[Path],
    *,
    limit: int = 200,
    since: datetime | None = None,
) -> list[dict[str, Any]]:
    """Read and time-sort JSONL records from one or more files."""
    records: list[dict[str, Any]] = []
    for path in paths:
        if not path.exists() or not path.is_file():
            continue
        try:
            with path.open(encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(value, dict):
                        continue
                    timestamp = value.get("timestamp")
                    if since is not None and isinstance(timestamp, str):
                        try:
                            parsed = datetime.fromisoformat(
                                timestamp.replace("Z", "+00:00")
                            )
                        except ValueError:
                            parsed = None
                        if parsed is not None:
                            if parsed.tzinfo is None:
                                parsed = parsed.replace(tzinfo=UTC)
                            if parsed < since:
                                continue
                    records.append(value)
        except OSError:
            continue

    records.sort(key=lambda item: str(item.get("timestamp", "")))
    return records[-limit:]


class ResourceMonitor:
    """Sample host, process, disk, network, and optional GPU state to JSONL."""

    def __init__(
        self,
        *,
        service_name: str | None = None,
        interval_seconds: float | None = None,
        log_dir: Path | None = None,
    ) -> None:
        self.service_name = service_name or os.getenv("THESIS_SERVICE_NAME", "backend")
        raw_interval = interval_seconds or float(
            os.getenv("THESIS_PERFORMANCE_SAMPLE_SECONDS", "5")
        )
        self.interval_seconds = max(1.0, raw_interval)
        self.log_dir = log_dir or get_runtime_log_dir()
        safe_service = "".join(
            character if character.isalnum() or character in {"-", "_"} else "_"
            for character in self.service_name
        )
        self.log_path = self.log_dir / f"performance_{safe_service}_{os.getpid()}.jsonl"
        self._process = psutil.Process(os.getpid())
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._latest: dict[str, Any] | None = None
        self._event_loop_lag_ms: float | None = None
        self._enabled = os.getenv("THESIS_OBSERVABILITY_ENABLED", "1") not in {
            "0",
            "false",
            "False",
            "",
        }
        _safe_call(0.0, lambda: self._process.cpu_percent(interval=None))

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def set_event_loop_lag(self, lag_ms: float) -> None:
        with self._state_lock:
            self._event_loop_lag_ms = max(0.0, lag_ms)

    def collect_snapshot(self) -> dict[str, Any]:
        """Collect one resource snapshot without writing it."""
        memory = _safe_call(None, self._process.memory_info)
        process_io = _safe_call(None, self._process.io_counters)
        virtual_memory = psutil.virtual_memory()
        swap_memory = psutil.swap_memory()
        disk_io = psutil.disk_io_counters()
        network_io = psutil.net_io_counters()
        disk_usage = psutil.disk_usage(str(self.log_dir.anchor or "/"))

        with self._state_lock:
            event_loop_lag_ms = self._event_loop_lag_ms

        snapshot: dict[str, Any] = {
            "timestamp": _utc_now(),
            "kind": "resource_sample",
            "service": self.service_name,
            "pid": os.getpid(),
            "process": {
                "cpu_percent": _number(
                    _safe_call(None, lambda: self._process.cpu_percent(interval=None))
                ),
                "rss_bytes": getattr(memory, "rss", None),
                "vms_bytes": getattr(memory, "vms", None),
                "thread_count": _safe_call(None, self._process.num_threads),
                "open_file_descriptors": _safe_call(None, self._process.num_fds),
                "read_bytes": getattr(process_io, "read_bytes", None),
                "write_bytes": getattr(process_io, "write_bytes", None),
                "event_loop_lag_ms": event_loop_lag_ms,
            },
            "system": {
                "cpu_percent": psutil.cpu_percent(interval=None),
                "cpu_count_logical": psutil.cpu_count(logical=True),
                "cpu_count_physical": psutil.cpu_count(logical=False),
                "load_average": list(os.getloadavg())
                if hasattr(os, "getloadavg")
                else None,
                "memory_total_bytes": virtual_memory.total,
                "memory_available_bytes": virtual_memory.available,
                "memory_used_percent": virtual_memory.percent,
                "swap_used_bytes": swap_memory.used,
                "swap_used_percent": swap_memory.percent,
            },
            "disk": {
                "total_bytes": disk_usage.total,
                "used_bytes": disk_usage.used,
                "free_bytes": disk_usage.free,
                "used_percent": disk_usage.percent,
                "read_bytes": getattr(disk_io, "read_bytes", None),
                "write_bytes": getattr(disk_io, "write_bytes", None),
                "read_count": getattr(disk_io, "read_count", None),
                "write_count": getattr(disk_io, "write_count", None),
            },
            "network": {
                "bytes_sent": getattr(network_io, "bytes_sent", None),
                "bytes_received": getattr(network_io, "bytes_recv", None),
                "packets_sent": getattr(network_io, "packets_sent", None),
                "packets_received": getattr(network_io, "packets_recv", None),
            },
            "gpus": collect_gpu_snapshot(),
        }
        with self._state_lock:
            self._latest = snapshot
        return snapshot

    def latest_snapshot(self) -> dict[str, Any]:
        with self._state_lock:
            latest = self._latest
        return latest or self.collect_snapshot()

    def _append(self, snapshot: dict[str, Any]) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        serialized = json.dumps(snapshot, separators=(",", ":"), default=str)
        try:
            with self._write_lock, self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(serialized + "\n")
        except OSError as exc:
            logger.warning(
                "Could not write performance sample to %s: %s", self.log_path, exc
            )

    def record_operation(
        self,
        operation: str,
        *,
        duration_ms: float | None = None,
        result: str = "success",
        details: dict[str, Any] | None = None,
    ) -> None:
        """Append a sparse operation event beside periodic resource samples."""
        self._append(
            {
                "timestamp": _utc_now(),
                "kind": "operation",
                "service": self.service_name,
                "pid": os.getpid(),
                "operation": operation,
                "duration_ms": duration_ms,
                "result": result,
                "details": details or {},
            }
        )

    def _run(self) -> None:
        while not self._stop_event.is_set():
            started = time.monotonic()
            try:
                self._append(self.collect_snapshot())
            except Exception as exc:  # pragma: no cover - defensive monitor isolation
                logger.warning("Resource sampling failed: %s", exc, exc_info=True)
            remaining = max(0.0, self.interval_seconds - (time.monotonic() - started))
            self._stop_event.wait(remaining)

    def start(self) -> None:
        """Start the daemon sampler when observability is enabled."""
        if not self._enabled or self.running:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name=f"resource-monitor-{self.service_name}",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "Resource monitor started (service=%s interval=%.1fs path=%s)",
            self.service_name,
            self.interval_seconds,
            self.log_path,
        )

    def stop(self) -> None:
        """Stop the sampler and wait briefly for the thread to exit."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=max(2.0, self.interval_seconds + 1.0))
        self._thread = None


resource_monitor = ResourceMonitor()
