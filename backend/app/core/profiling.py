"""
Performance Profiling Middleware and Utilities

Comprehensive instrumentation for measuring FastAPI backend performance:
- Per-endpoint latency tracking (min, max, avg, p50, p95, p99)
- Database query timing
- External API call timing (Rust parser, embedding service)
- Memory usage snapshots
- Start-up timing capture
- Metrics endpoint for exposing all captured data
"""

from __future__ import annotations

import asyncio
import gc
import inspect
import os
import psutil
import time
import threading
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
import statistics

from app.core.logging import get_logger

logger = get_logger("profiling")


@dataclass
class EndpointMetrics:
    name: str
    method: str
    path: str
    call_count: int = 0
    total_time_ms: float = 0.0
    min_time_ms: float = float("inf")
    max_time_ms: float = 0.0
    times_ms: Deque[float] = field(default_factory=lambda: deque(maxlen=10000))
    errors: int = 0
    last_called: Optional[float] = None

    def record(self, duration_ms: float, success: bool = True) -> None:
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
        return self.total_time_ms / self.call_count if self.call_count > 0 else 0.0

    def percentile(self, p: float) -> float:
        if not self.times_ms:
            return 0.0
        sorted_times = sorted(self.times_ms)
        idx = int(len(sorted_times) * p / 100)
        return sorted_times[min(idx, len(sorted_times) - 1)]


@dataclass
class QueryMetrics:
    query_type: str
    statement: str
    call_count: int = 0
    total_time_ms: float = 0.0
    min_time_ms: float = float("inf")
    max_time_ms: float = 0.0
    errors: int = 0

    def record(self, duration_ms: float, success: bool = True) -> None:
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
        return self.total_time_ms / self.call_count if self.call_count > 0 else 0.0


@dataclass
class ExternalCallMetrics:
    service: str
    operation: str
    call_count: int = 0
    total_time_ms: float = 0.0
    min_time_ms: float = float("inf")
    max_time_ms: float = 0.0
    timeouts: int = 0
    errors: int = 0

    def record(
        self, duration_ms: float, success: bool = True, timeout: bool = False
    ) -> None:
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
        return self.total_time_ms / self.call_count if self.call_count > 0 else 0.0


class ProfilingSession:
    """Central profiling session managing all metrics collection."""

    def __init__(self, name: str = "default") -> None:
        self.name = name
        self._start_time: Optional[float] = None
        self._end_time: Optional[float] = None
        self._lock = threading.Lock()

        self.endpoints: Dict[str, EndpointMetrics] = {}
        self.queries: Dict[str, QueryMetrics] = {}
        self.external_calls: Dict[Tuple[str, str], ExternalCallMetrics] = {}

        self.memory_samples: List[Dict[str, Any]] = []
        self.cpu_samples: List[Dict[str, Any]] = []

        self._memory_monitor_running = False
        self._memory_monitor_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._start_time = time.time()
        gc.collect()

    def stop(self) -> None:
        self._end_time = time.time()
        self._stop_memory_monitor()

    @property
    def duration_seconds(self) -> float:
        if self._start_time and self._end_time:
            return self._end_time - self._start_time
        return 0.0

    def _get_endpoint_key(self, method: str, path: str) -> str:
        return f"{method}:{path}"

    def record_endpoint(
        self, method: str, path: str, duration_ms: float, success: bool = True
    ) -> None:
        key = self._get_endpoint_key(method, path)
        with self._lock:
            if key not in self.endpoints:
                self.endpoints[key] = EndpointMetrics(
                    name=path, method=method, path=path
                )
            self.endpoints[key].record(duration_ms, success)

    def record_query(
        self,
        query_type: str,
        statement: str,
        duration_ms: float,
        success: bool = True,
    ) -> None:
        key = f"{query_type}:{statement[:100]}"
        with self._lock:
            if key not in self.queries:
                self.queries[key] = QueryMetrics(
                    query_type=query_type, statement=statement[:100]
                )
            self.queries[key].record(duration_ms, success)

    def record_external_call(
        self,
        service: str,
        operation: str,
        duration_ms: float,
        success: bool = True,
        timeout: bool = False,
    ) -> None:
        key = (service, operation)
        with self._lock:
            if key not in self.external_calls:
                self.external_calls[key] = ExternalCallMetrics(
                    service=service, operation=operation
                )
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
        self._start_memory_monitor(interval)

    def snapshot_memory(self) -> Dict[str, Any]:
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

    def get_summary(self) -> Dict[str, Any]:
        endpoint_stats = []
        for key, metrics in self.endpoints.items():
            times = list(metrics.times_ms)
            endpoint_stats.append(
                {
                    "endpoint": key,
                    "call_count": metrics.call_count,
                    "total_time_ms": round(metrics.total_time_ms, 2),
                    "avg_time_ms": round(metrics.avg_time_ms, 2),
                    "min_time_ms": round(metrics.min_time_ms, 2)
                    if metrics.min_time_ms != float("inf")
                    else 0,
                    "max_time_ms": round(metrics.max_time_ms, 2),
                    "p50_ms": round(metrics.percentile(50), 2),
                    "p95_ms": round(metrics.percentile(95), 2),
                    "p99_ms": round(metrics.percentile(99), 2),
                    "errors": metrics.errors,
                    "errors_percent": round(
                        metrics.errors / metrics.call_count * 100, 2
                    )
                    if metrics.call_count > 0
                    else 0,
                }
            )

        query_stats = []
        for key, metrics in self.queries.items():
            query_stats.append(
                {
                    "query": key,
                    "call_count": metrics.call_count,
                    "total_time_ms": round(metrics.total_time_ms, 2),
                    "avg_time_ms": round(metrics.avg_time_ms, 2),
                    "min_time_ms": round(metrics.min_time_ms, 2)
                    if metrics.min_time_ms != float("inf")
                    else 0,
                    "max_time_ms": round(metrics.max_time_ms, 2),
                    "errors": metrics.errors,
                }
            )

        external_stats = []
        for (service, operation), metrics in self.external_calls.items():
            external_stats.append(
                {
                    "service": service,
                    "operation": operation,
                    "call_count": metrics.call_count,
                    "total_time_ms": round(metrics.total_time_ms, 2),
                    "avg_time_ms": round(metrics.avg_time_ms, 2),
                    "min_time_ms": round(metrics.min_time_ms, 2)
                    if metrics.min_time_ms != float("inf")
                    else 0,
                    "max_time_ms": round(metrics.max_time_ms, 2),
                    "timeouts": metrics.timeouts,
                    "errors": metrics.errors,
                }
            )

        memory_stats = None
        if self.memory_samples:
            rss_values = [s["rss_mb"] for s in self.memory_samples]
            memory_stats = {
                "samples": len(self.memory_samples),
                "rss_avg_mb": round(statistics.mean(rss_values), 2),
                "rss_max_mb": round(max(rss_values), 2),
                "rss_min_mb": round(min(rss_values), 2),
            }

        return {
            "session_name": self.name,
            "duration_seconds": round(self.duration_seconds, 2),
            "endpoints": sorted(
                endpoint_stats, key=lambda x: x["avg_time_ms"], reverse=True
            ),
            "queries": sorted(
                query_stats, key=lambda x: x["avg_time_ms"], reverse=True
            ),
            "external_calls": sorted(
                external_stats, key=lambda x: x["avg_time_ms"], reverse=True
            ),
            "memory": memory_stats,
            "total_requests": sum(e["call_count"] for e in endpoint_stats),
            "total_errors": sum(e["errors"] for e in endpoint_stats),
        }


_profiling_session: Optional[ProfilingSession] = None


def get_profiling_session() -> ProfilingSession:
    """Get or create the global profiling session."""
    global _profiling_session
    if _profiling_session is None:
        _profiling_session = ProfilingSession()
    return _profiling_session


def set_profiling_session(session: ProfilingSession) -> None:
    global _profiling_session
    _profiling_session = session


class ProfilingMiddleware(BaseHTTPMiddleware):
    """Middleware that tracks per-request timing and metrics."""

    SKIP_PATHS = {"/health", "/favicon.ico", "/metrics", "/static/"}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        method = request.method

        if path in self.SKIP_PATHS:
            return await call_next(request)

        start_time = time.perf_counter()
        session = get_profiling_session()

        try:
            response = await call_next(request)
            success = response.status_code < 500
        except Exception as exc:
            success = False
            raise
        finally:
            duration_ms = (time.perf_counter() - start_time) * 1000
            session.record_endpoint(method, path, duration_ms, success)

        return response


def profile_function(name: Optional[str] = None, record_args: bool = False):
    """Decorator to profile a function's execution time."""

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            session = get_profiling_session()
            start = time.perf_counter()
            try:
                result = await func(*args, **kwargs)
                return result
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                func_name = name or f"{func.__module__}.{func.__name__}"
                session.record_external_call(
                    "function", func_name, duration_ms, success=True
                )

        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            session = get_profiling_session()
            start = time.perf_counter()
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                duration_ms = (time.perf_counter() - start) * 1000
                func_name = name or f"{func.__module__}.{func.__name__}"
                session.record_external_call(
                    "function", func_name, duration_ms, success=True
                )

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


class ProfileSection:
    """Async context manager for profiling a section of code."""

    def __init__(self, service: str, operation: str) -> None:
        self.service = service
        self.operation = operation
        self.session = get_profiling_session()
        self.start_time: float = 0.0
        self.duration_ms: float = 0.0

    async def __aenter__(self) -> "ProfileSection":
        self.start_time = time.perf_counter()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
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
        self._original_execute: Optional[Callable] = None
        self._patched = False

    def patch_sessionmaker(self, sessionmaker) -> None:
        """Patch async_sessionmaker to profile execute calls."""
        if self._patched:
            return

        original_execute = getattr(sessionmaker, "execute", None)
        if original_execute:
            session = get_profiling_session()

            @wraps(original_execute)
            async def patched_execute(self, *args, **kwargs):
                start = time.perf_counter()
                try:
                    result = await original_execute(self, *args, **kwargs)
                    return result
                finally:
                    duration_ms = (time.perf_counter() - start) * 1000
                    statement = (
                        str(args[0]) if args else kwargs.get("statement", "unknown")
                    )
                    session.record_query("execute", statement, duration_ms)

            sessionmaker.execute = patched_execute
            self._patched = True


def get_top_slow_endpoints(limit: int = 5) -> List[Dict[str, Any]]:
    """Get the slowest endpoints by average response time."""
    session = get_profiling_session()
    stats = session.get_summary()
    return stats["endpoints"][:limit]


def get_bottleneck_summary() -> Dict[str, Any]:
    """Generate a summary of performance bottlenecks."""
    session = get_profiling_session()
    stats = session.get_summary()

    bottlenecks = []

    for endpoint in stats.get("endpoints", []):
        if endpoint["p95_ms"] > 1000:
            bottlenecks.append(
                {
                    "type": "high_latency_endpoint",
                    "target": endpoint["endpoint"],
                    "p95_ms": endpoint["p95_ms"],
                    "call_count": endpoint["call_count"],
                    "severity": "critical" if endpoint["p95_ms"] > 5000 else "warning",
                }
            )

    for query in stats.get("queries", []):
        if query["avg_time_ms"] > 100:
            bottlenecks.append(
                {
                    "type": "slow_query",
                    "target": query["query"][:100],
                    "avg_ms": query["avg_ms"],
                    "call_count": query["call_count"],
                    "severity": "critical" if query["avg_ms"] > 500 else "warning",
                }
            )

    for ext in stats.get("external_calls", []):
        if ext["avg_time_ms"] > 1000 or ext["timeouts"] > 0:
            bottlenecks.append(
                {
                    "type": "slow_external_call",
                    "target": f"{ext['service']}:{ext['operation']}",
                    "avg_ms": ext["avg_ms"],
                    "timeouts": ext["timeouts"],
                    "severity": "critical" if ext["timeouts"] > 0 else "warning",
                }
            )

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "bottleneck_count": len(bottlenecks),
        "bottlenecks": sorted(
            bottlenecks,
            key=lambda x: x["p95_ms"] if "p95_ms" in x else x["avg_ms"],
            reverse=True,
        ),
    }
