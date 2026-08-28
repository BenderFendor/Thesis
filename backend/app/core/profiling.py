"""Performance Profiling Middleware and Utilities.

Comprehensive instrumentation for measuring FastAPI backend performance:
- Per-endpoint latency tracking (min, max, avg, p50, p95, p99)
- Database query timing
- External API call timing (Rust parser, embedding service)
- Memory usage snapshots
- Start-up timing capture
- Metrics endpoint for exposing all captured data
"""

from __future__ import annotations

import gc
import os
import threading
import time
import statistics
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, UTC
from functools import wraps
from types import TracebackType
from typing import Any, cast

import psutil
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger

logger = get_logger("profiling")


@dataclass
class EndpointMetrics:
    """Endpoint Metrics."""

    name: str
    method: str
    path: str
    call_count: int = 0
    total_time_ms: float = 0.0
    min_time_ms: float = float("inf")
    max_time_ms: float = 0.0
    times_ms: deque[float] = field(default_factory=lambda: deque(maxlen=10000))
    errors: int = 0
    last_called: float | None = None

    def record(self, duration_ms: float, success: bool = True) -> None:
        """Record."""
        self.call_count += 1
        self.total_time_ms += duration_ms
        self.times_ms.append(duration_ms)
        if duration_ms < self.min_time_ms:
            self.min_time_ms = duration_ms
        if duration_ms > self.max_time_ms:
            self.max_time_ms = duration_ms
        self.last_called = time.time()
        if not success:
            self.errors += 1

    @property
    def avg_time_ms(self) -> float:
        """Avg Time Ms."""
        return self.total_time_ms / self.call_count if self.call_count > 0 else 0.0

    def percentile(self, p: float) -> float:
        """Percentile."""
        if not self.times_ms:
            return 0.0
        sorted_times = sorted(self.times_ms)
        idx = int(len(sorted_times) * p / 100)
        return sorted_times[min(idx, len(sorted_times) - 1)]


@dataclass
class QueryMetrics:
    """Query Metrics."""

    query_type: str
    statement: str
    call_count: int = 0
    total_time_ms: float = 0.0
    min_time_ms: float = float("inf")
    max_time_ms: float = 0.0
    errors: int = 0

    def record(self, duration_ms: float, success: bool = True) -> None:
        """Record."""
        self.call_count += 1
        self.total_time_ms += duration_ms
        if duration_ms < self.min_time_ms:
            self.min_time_ms = duration_ms
        if duration_ms > self.max_time_ms:
            self.max_time_ms = duration_ms
        if not success:
            self.errors += 1

    @property
    def avg_time_ms(self) -> float:
        """Avg Time Ms."""
        return self.total_time_ms / self.call_count if self.call_count > 0 else 0.0


@dataclass
class ExternalCallMetrics:
    """External Call Metrics."""

    service: str
    operation: str
    call_count: int = 0
    total_time_ms: float = 0.0
    min_time_ms: float = float("inf")
    max_time_ms: float = 0.0
    timeouts: int = 0
    errors: int = 0

    def record(self, duration_ms: float, success: bool = True, timeout: bool = False) -> None:
        """Record."""
        self.call_count += 1
        self.total_time_ms += duration_ms
        if duration_ms < self.min_time_ms:
            self.min_time_ms = duration_ms
        if duration_ms > self.max_time_ms:
            self.max_time_ms = duration_ms
        if timeout:
            self.timeouts += 1
        if not success and not timeout:
            self.errors += 1

    @property
    def avg_time_ms(self) -> float:
        """Avg Time Ms."""
        return self.total_time_ms / self.call_count if self.call_count > 0 else 0.0


class ProfilingSession:
    """Central profiling session managing all metrics collection."""

    def __init__(self, name: str = "default") -> None:
        """Initialize."""
        self.name = name
        self._start_time: float | None = None
        self._end_time: float | None = None
        self._lock = threading.Lock()

        self.endpoints: dict[str, EndpointMetrics] = {}
        self.queries: dict[str, QueryMetrics] = {}
        self.external_calls: dict[tuple[str, str], ExternalCallMetrics] = {}

        self.memory_samples: list[dict[str, Any]] = []
        self.cpu_samples: list[dict[str, Any]] = []

        self._memory_monitor_running = False
        self._memory_monitor_thread: threading.Thread | None = None

    def start(self) -> None:
        """Start."""
        self._start_time = time.time()
        gc.collect()

    def stop(self) -> None:
        """Stop."""
        self._end_time = time.time()
        self._stop_memory_monitor()

    @property
    def duration_seconds(self) -> float:
        """Duration Seconds."""
        if self._start_time and self._end_time:
            return self._end_time - self._start_time
        return 0.0

    def _get_endpoint_key(self, method: str, path: str) -> str:
        return f"{method}:{path}"

    def record_endpoint(
        self, method: str, path: str, duration_ms: float, success: bool = True
    ) -> None:
        """Record Endpoint."""
        key = self._get_endpoint_key(method, path)
        with self._lock:
            if key not in self.endpoints:
                self.endpoints[key] = EndpointMetrics(name=path, method=method, path=path)
            self.endpoints[key].record(duration_ms, success)

    def record_query(
        self,
        query_type: str,
        statement: str,
        duration_ms: float,
        success: bool = True,
    ) -> None:
        """Record Query."""
        key = f"{query_type}:{statement[:100]}"
        with self._lock:
            if key not in self.queries:
                self.queries[key] = QueryMetrics(query_type=query_type, statement=statement[:100])
            self.queries[key].record(duration_ms, success)

    def record_external_call(
        self,
        service: str,
        operation: str,
        duration_ms: float,
        success: bool = True,
        timeout: bool = False,
    ) -> None:
        """Record External Call."""
        key = (service, operation)
        with self._lock:
            if key not in self.external_calls:
                self.external_calls[key] = ExternalCallMetrics(service=service, operation=operation)
            self.external_calls[key].record(duration_ms, success, timeout)

    def _start_memory_monitor(self, interval: float = 0.5) -> None:
        self._memory_monitor_running = True
        self._memory_monitor_thread = threading.Thread(
            target=self._memory_monitor_loop, args=(interval,), daemon=True
        )
        self._memory_monitor_thread.start()

    def _stop_memory_monitor(self) -> None:
        self._memory_monitor_running = False
        if self._memory_monitor_thread and self._memory_monitor_thread.is_alive():
            self._memory_monitor_thread.join(timeout=2.0)

    def _memory_monitor_loop(self, interval: float) -> None:
        process = psutil.Process(os.getpid())
        while self._memory_monitor_running:
            try:
                mem_info = process.memory_info()
                self.memory_samples.append(
                    {
                        "timestamp": time.time(),
                        "rss_mb": mem_info.rss / (1024 * 1024),
                        "vms_mb": mem_info.vms / (1024 * 1024),
                        "cpu_percent": process.cpu_percent(),
                    }
                )
                if len(self.memory_samples) > 10000:
                    self.memory_samples = self.memory_samples[-5000:]
            except Exception:
                pass
            time.sleep(interval)

    def start_memory_monitoring(self, interval: float = 0.5) -> None:
        """Start Memory Monitoring."""
        self._start_memory_monitor(interval)

    def snapshot_memory(self) -> dict[str, Any]:
        """Snapshot Memory."""
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        gc_stats = gc.get_stats()
        return {
            "timestamp": time.time(),
            "rss_mb": mem_info.rss / (1024 * 1024),
            "vms_mb": mem_info.vms / (1024 * 1024),
            "gc_stats": gc_stats,
            "thread_count": threading.active_count(),
        }

    @staticmethod
    def _finite_min(value: float) -> float:
        return round(value, 2) if value != float("inf") else 0

    @classmethod
    def _endpoint_summary(cls, key: str, metrics: EndpointMetrics) -> dict[str, Any]:
        error_percent = metrics.errors / metrics.call_count * 100 if metrics.call_count else 0
        return {
            "endpoint": key,
            "call_count": metrics.call_count,
            "total_time_ms": round(metrics.total_time_ms, 2),
            "avg_time_ms": round(metrics.avg_time_ms, 2),
            "min_time_ms": cls._finite_min(metrics.min_time_ms),
            "max_time_ms": round(metrics.max_time_ms, 2),
            "p50_ms": round(metrics.percentile(50), 2),
            "p95_ms": round(metrics.percentile(95), 2),
            "p99_ms": round(metrics.percentile(99), 2),
            "errors": metrics.errors,
            "errors_percent": round(error_percent, 2),
        }

    @classmethod
    def _query_summary(cls, key: str, metrics: QueryMetrics) -> dict[str, Any]:
        return {
            "query": key,
            "call_count": metrics.call_count,
            "total_time_ms": round(metrics.total_time_ms, 2),
            "avg_time_ms": round(metrics.avg_time_ms, 2),
            "min_time_ms": cls._finite_min(metrics.min_time_ms),
            "max_time_ms": round(metrics.max_time_ms, 2),
            "errors": metrics.errors,
        }

    @classmethod
    def _external_summary(cls, key: tuple[str, str], metrics: ExternalCallMetrics) -> dict[str, Any]:
        service, operation = key
        return {
            "service": service,
            "operation": operation,
            "call_count": metrics.call_count,
            "total_time_ms": round(metrics.total_time_ms, 2),
            "avg_time_ms": round(metrics.avg_time_ms, 2),
            "min_time_ms": cls._finite_min(metrics.min_time_ms),
            "max_time_ms": round(metrics.max_time_ms, 2),
            "timeouts": metrics.timeouts,
            "errors": metrics.errors,
        }

    def _memory_summary(self) -> dict[str, Any] | None:
        if not self.memory_samples:
            return None
        rss_values = [sample["rss_mb"] for sample in self.memory_samples]
        return {
            "samples": len(self.memory_samples),
            "rss_avg_mb": round(statistics.mean(rss_values), 2),
            "rss_max_mb": round(max(rss_values), 2),
            "rss_min_mb": round(min(rss_values), 2),
        }

    def get_summary(self) -> dict[str, Any]:
        """Return normalized endpoint, query, external-call, and memory metrics."""
        endpoint_stats = [self._endpoint_summary(key, metrics) for key, metrics in self.endpoints.items()]
        query_stats = [self._query_summary(key, metrics) for key, metrics in self.queries.items()]
        external_stats = [self._external_summary(key, metrics) for key, metrics in self.external_calls.items()]
        return {
            "session_name": self.name,
            "duration_seconds": round(self.duration_seconds, 2),
            "endpoints": sorted(endpoint_stats, key=lambda item: item["avg_time_ms"], reverse=True),
            "queries": sorted(query_stats, key=lambda item: item["avg_time_ms"], reverse=True),
            "external_calls": sorted(external_stats, key=lambda item: item["avg_time_ms"], reverse=True),
            "memory": self._memory_summary(),
            "total_requests": sum(item["call_count"] for item in endpoint_stats),
            "total_errors": sum(item["errors"] for item in endpoint_stats),
        }



_profiling_session: ProfilingSession | None = None


def get_profiling_session() -> ProfilingSession:
    """Get or create the global profiling session."""
    global _profiling_session
    if _profiling_session is None:
        _profiling_session = ProfilingSession()
    return _profiling_session


def set_profiling_session(session: ProfilingSession) -> None:
    """Set Profiling Session."""
    global _profiling_session
    _profiling_session = session


class ProfilingMiddleware(BaseHTTPMiddleware):
    """Middleware that tracks per-request timing and metrics."""

    SKIP_PATHS = {"/health", "/favicon.ico", "/metrics", "/static/"}

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        """Dispatch."""
        path = request.url.path
        method = request.method

        if path in self.SKIP_PATHS:
            return await call_next(request)

        start_time = time.perf_counter()
        session = get_profiling_session()

        try:
            response = await call_next(request)
            success = response.status_code < 500
        except Exception:
            success = False
            raise
        finally:
            duration_ms = (time.perf_counter() - start_time) * 1000
            session.record_endpoint(method, path, duration_ms, success)

        return response


class ProfileSection:
    """Async context manager for profiling a section of code."""

    def __init__(self, service: str, operation: str) -> None:
        """Initialize."""
        self.service = service
        self.operation = operation
        self.session = get_profiling_session()
        self.start_time: float = 0.0
        self.duration_ms: float = 0.0

    async def __aenter__(self) -> ProfileSection:
        """Context manager enter."""
        self.start_time = time.perf_counter()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        _exc_tb: TracebackType | None,
    ) -> None:
        """Context manager exit."""
        self.duration_ms = (time.perf_counter() - self.start_time) * 1000
        self.session.record_external_call(
            self.service, self.operation, self.duration_ms, success=exc_type is None
        )


def profile_section(service: str, operation: str) -> ProfileSection:
    """Context manager to profile a section of code."""
    return ProfileSection(service, operation)


class QueryProfiler:
    """Profiler for database queries."""

    def __init__(self) -> None:
        """Initialize."""
        self._original_execute: Callable[..., Any] | None = None
        self._patched = False

    def patch_sessionmaker(self, sessionmaker: Any) -> None:
        """Patch async_sessionmaker to profile execute calls."""
        if self._patched:
            return

        original_execute = getattr(sessionmaker, "execute", None)
        if original_execute:
            session = get_profiling_session()
            execute_callable = cast(Callable[..., Awaitable[Any]], original_execute)
            self._original_execute = execute_callable

            @wraps(original_execute)
            async def patched_execute(self: Any, *args: Any, **kwargs: Any) -> Any:
                """Patched Execute."""
                start = time.perf_counter()
                try:
                    result = await execute_callable(self, *args, **kwargs)
                    return result
                finally:
                    duration_ms = (time.perf_counter() - start) * 1000
                    statement = str(args[0]) if args else kwargs.get("statement", "unknown")
                    session.record_query("execute", statement, duration_ms)

            sessionmaker.execute = patched_execute
            self._patched = True


def get_top_slow_endpoints(limit: int = 5) -> list[dict[str, Any]]:
    """Get the slowest endpoints by average response time."""
    session = get_profiling_session()
    stats = session.get_summary()
    endpoints = cast(list[dict[str, Any]], stats["endpoints"])
    return endpoints[:limit]


def _endpoint_bottleneck(endpoint: dict[str, Any]) -> dict[str, Any] | None:
    if endpoint["p95_ms"] <= 1000:
        return None
    return {
        "type": "high_latency_endpoint", "target": endpoint["endpoint"],
        "p95_ms": endpoint["p95_ms"], "call_count": endpoint["call_count"],
        "severity": "critical" if endpoint["p95_ms"] > 5000 else "warning",
    }


def _query_bottleneck(query: dict[str, Any]) -> dict[str, Any] | None:
    avg_ms = query["avg_time_ms"]
    if avg_ms <= 100:
        return None
    return {
        "type": "slow_query", "target": query["query"][:100], "avg_ms": avg_ms,
        "call_count": query["call_count"], "severity": "critical" if avg_ms > 500 else "warning",
    }


def _external_bottleneck(call: dict[str, Any]) -> dict[str, Any] | None:
    avg_ms = call["avg_time_ms"]
    if avg_ms <= 1000 and call["timeouts"] <= 0:
        return None
    return {
        "type": "slow_external_call", "target": f"{call['service']}:{call['operation']}",
        "avg_ms": avg_ms, "timeouts": call["timeouts"],
        "severity": "critical" if call["timeouts"] > 0 else "warning",
    }


def _bottleneck_sort_value(item: dict[str, Any]) -> float:
    return float(item.get("p95_ms", item.get("avg_ms", 0)))

def get_bottleneck_summary() -> dict[str, Any]:
    """Generate a summary of performance bottlenecks."""
    stats = get_profiling_session().get_summary()
    candidates = [
        *(_endpoint_bottleneck(item) for item in stats.get("endpoints", [])),
        *(_query_bottleneck(item) for item in stats.get("queries", [])),
        *(_external_bottleneck(item) for item in stats.get("external_calls", [])),
    ]
    bottlenecks = [item for item in candidates if item is not None]
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "bottleneck_count": len(bottlenecks),
        "bottlenecks": sorted(bottlenecks, key=_bottleneck_sort_value, reverse=True),
    }

