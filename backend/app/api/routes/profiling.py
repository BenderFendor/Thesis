"""
Profiling Routes for exposing metrics.

Endpoints:
- GET /metrics - Prometheus-compatible metrics
- GET /profiling/summary - JSON profiling summary
- GET /profiling/bottlenecks - Bottleneck analysis
- GET /profiling/queries - Database query stats
"""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from app.core.profiling import (
    get_profiling_session,
    get_top_slow_endpoints,
    get_bottleneck_summary,
)
from app.core.db_profiling import get_query_profiler
from app.services.startup_metrics import startup_metrics

router = APIRouter(prefix="/profiling", tags=["profiling"])


@router.get("/metrics")
async def metrics() -> Response:
    """Prometheus-compatible metrics endpoint."""
    session = get_profiling_session()
    stats = session.get_summary()

    lines = [
        "# HELP http_requests_total Total HTTP requests",
        "# TYPE http_requests_total counter",
    ]

    for endpoint in stats.get("endpoints", []):
        endpoint_name = endpoint["endpoint"].replace("/", "_").replace(":", "_")
        lines.append(
            f'http_requests_total{{endpoint="{endpoint_name}"}} {endpoint["call_count"]}'
        )

        lines.append(
            f'http_request_duration_seconds{{endpoint="{endpoint_name}",quantile="0.50"}} {endpoint["p50_ms"] / 1000}'
        )
        lines.append(
            f'http_request_duration_seconds{{endpoint="{endpoint_name}",quantile="0.95"}} {endpoint["p95_ms"] / 1000}'
        )
        lines.append(
            f'http_request_duration_seconds{{endpoint="{endpoint_name}",quantile="0.99"}} {endpoint["p99_ms"] / 1000}'
        )

    if stats.get("memory"):
        lines.append(
            f'process_resident_memory_bytes{{metric="rss"}} {int(stats["memory"]["rss_max_mb"] * 1024 * 1024)}'
        )

    content = "\n".join(lines)
    return Response(content=content, media_type="text/plain")


@router.get("/summary")
async def profiling_summary() -> Dict[str, Any]:
    """Get full profiling summary."""
    session = get_profiling_session()
    return session.get_summary()


@router.get("/bottlenecks")
async def bottlenecks() -> Dict[str, Any]:
    """Get bottleneck analysis."""
    return get_bottleneck_summary()


@router.get("/queries")
async def query_stats() -> Dict[str, Any]:
    """Get database query statistics."""
    profiler = get_query_profiler()
    return profiler.get_stats()


@router.get("/startup")
async def startup_stats() -> Dict[str, Any]:
    """Get startup metrics."""
    return startup_metrics.to_dict()


@router.get("/slow-endpoints")
async def slow_endpoints(limit: int = 5) -> Dict[str, Any]:
    """Get slowest endpoints."""
    endpoints = get_top_slow_endpoints(limit)
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "endpoints": endpoints,
    }


@router.post("/reset")
async def reset_profiling() -> Dict[str, str]:
    """Reset all profiling data."""
    session = get_profiling_session()
    session.stop()
    session.start()
    profiler = get_query_profiler()
    profiler.reset()
    return {"status": "reset"}


@router.get("/health")
async def profiling_health() -> Dict[str, Any]:
    """Get profiling system health status."""
    session = get_profiling_session()
    stats = session.get_summary()

    return {
        "status": "healthy" if stats["total_errors"] == 0 else "degraded",
        "total_requests": stats["total_requests"],
        "total_errors": stats["total_errors"],
        "error_rate_percent": round(
            stats["total_errors"] / stats["total_requests"] * 100, 2
        )
        if stats["total_requests"] > 0
        else 0,
        "avg_latency_ms": round(
            statistics.mean([e["avg_time_ms"] for e in stats["endpoints"] or []])
            if stats["endpoints"]
            else 0,
            2,
        ),
        "p95_latency_ms": round(
            statistics.mean([e["p95_ms"] for e in stats["endpoints"] or []])
            if stats["endpoints"]
            else 0,
            2,
        ),
    }
