"""Small, local-first observability endpoints for agentic debugging."""

from __future__ import annotations

import asyncio
import contextlib
import os
import platform
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from app.core.logging import get_runtime_data_dir, get_runtime_log_dir
from app.services.resource_monitor import read_jsonl_records, resource_monitor

router = APIRouter(
    prefix="/debug/observability",
    tags=["debug", "observability"],
    include_in_schema=False,
)
_event_loop_task: asyncio.Task[None] | None = None


async def _sample_event_loop_lag() -> None:
    interval = 1.0
    loop = asyncio.get_running_loop()
    expected = loop.time() + interval
    while True:
        await asyncio.sleep(interval)
        now = loop.time()
        resource_monitor.set_event_loop_lag((now - expected) * 1000)
        expected = now + interval


@router.on_event("startup")
async def start_observability() -> None:
    """Start low-overhead resource and event-loop sampling."""
    global _event_loop_task
    resource_monitor.start()
    if _event_loop_task is None or _event_loop_task.done():
        _event_loop_task = asyncio.create_task(
            _sample_event_loop_lag(),
            name="observability_event_loop_lag",
        )


@router.on_event("shutdown")
async def stop_observability() -> None:
    """Stop observability tasks without delaying application shutdown."""
    global _event_loop_task
    if _event_loop_task is not None:
        _event_loop_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _event_loop_task
        _event_loop_task = None
    resource_monitor.stop()


@router.get("/resources")
async def get_resource_snapshot() -> dict[str, Any]:
    """Return a current CPU, memory, disk, network, process, and GPU snapshot."""
    return resource_monitor.collect_snapshot()


@router.get("/performance")
async def get_recent_performance_samples(
    limit: int = Query(200, ge=1, le=5000),
    since_minutes: int = Query(30, ge=1, le=24 * 60),
) -> dict[str, Any]:
    """Return recent persisted performance samples across local services."""
    log_dir = get_runtime_log_dir()
    paths = sorted(log_dir.rglob("performance_*.jsonl"))
    since = datetime.now(UTC) - timedelta(minutes=since_minutes)
    records = read_jsonl_records(paths, limit=limit, since=since)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "since_minutes": since_minutes,
        "returned": len(records),
        "files": [str(path) for path in paths],
        "samples": records,
    }


@router.get("/runtime")
async def get_runtime_context() -> dict[str, Any]:
    """Return code-adjacent runtime facts useful in a debug bundle."""
    runtime_dir = get_runtime_data_dir()
    log_dir = get_runtime_log_dir()
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "service": resource_monitor.service_name,
        "pid": os.getpid(),
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "runtime_data_dir": str(runtime_dir),
        "runtime_log_dir": str(log_dir),
        "resource_monitor": {
            "enabled": os.getenv("THESIS_OBSERVABILITY_ENABLED", "1")
            not in {"0", "false", "False", ""},
            "running": resource_monitor.running,
            "interval_seconds": resource_monitor.interval_seconds,
            "log_path": str(resource_monitor.log_path),
        },
        "log_files": [
            {
                "path": str(path),
                "size_bytes": path.stat().st_size,
                "modified_at": datetime.fromtimestamp(
                    path.stat().st_mtime, tz=UTC
                ).isoformat(),
            }
            for path in sorted(log_dir.rglob("*.jsonl"))
            if path.is_file()
        ],
    }


@router.get("/health")
async def get_observability_health() -> dict[str, Any]:
    """Report whether the lightweight evidence pipeline is running."""
    log_path: Path = resource_monitor.log_path
    return {
        "status": "healthy" if resource_monitor.running else "degraded",
        "monitor_running": resource_monitor.running,
        "performance_log_exists": log_path.exists(),
        "performance_log_path": str(log_path),
        "latest_sample": resource_monitor.latest_snapshot(),
    }
