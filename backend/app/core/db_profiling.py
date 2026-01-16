"""
Database Query Profiling Utilities

Tools for profiling SQLAlchemy queries:
- Query timing collection
- N+1 detection
- Slow query logging
- Connection pool monitoring
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.pool import AsyncAdaptedQueuePool

from app.core.logging import get_logger

logger = get_logger("db_profiling")


@dataclass
class QueryInfo:
    statement: str
    parameters: Tuple[Any, ...]
    start_time: float
    duration_ms: float
    cursor_description: Optional[Tuple[Any, ...]] = None
    row_count: Optional[int] = None
    error: Optional[str] = None


@dataclass
class SlowQueryThreshold:
    warning_ms: float = 100.0
    critical_ms: float = 1000.0
    log_all: bool = False


class QueryProfiler:
    """Profiler for database query performance."""

    def __init__(self, threshold: Optional[SlowQueryThreshold] = None) -> None:
        self.threshold = threshold or SlowQueryThreshold()
        self._queries: List[QueryInfo] = []
        self._lock = asyncio.Lock()
        self._query_count = 0
        self._total_time_ms = 0.0
        self._slow_queries: List[QueryInfo] = []
        self._enabled = True

    @property
    def avg_query_time_ms(self) -> float:
        return self._total_time_ms / self._query_count if self._query_count > 0 else 0.0

    async def record_query(self, query: QueryInfo) -> None:
        """Record a query execution."""
        if not self._enabled:
            return

        async with self._lock:
            self._queries.append(query)
            self._query_count += 1
            self._total_time_ms += query.duration_ms

            if query.duration_ms >= self.threshold.warning_ms:
                self._slow_queries.append(query)

                if query.duration_ms >= self.threshold.critical_ms:
                    logger.warning(
                        "CRITICAL SLOW QUERY (%.2fms): %s",
                        query.duration_ms,
                        query.statement[:200],
                    )
                elif self.threshold.log_all:
                    logger.debug(
                        "Slow query (%.2fms): %s",
                        query.duration_ms,
                        query.statement[:200],
                    )

    def get_stats(self) -> Dict[str, Any]:
        """Get profiling statistics."""
        return {
            "total_queries": self._query_count,
            "total_time_ms": round(self._total_time_ms, 2),
            "avg_time_ms": round(self.avg_query_time_ms, 2),
            "slow_query_count": len(self._slow_queries),
            "slow_queries": [
                {
                    "duration_ms": q.duration_ms,
                    "statement": q.statement[:200],
                    "timestamp": datetime.fromtimestamp(
                        q.start_time, tz=timezone.utc
                    ).isoformat(),
                }
                for q in sorted(
                    self._slow_queries, key=lambda q: q.duration_ms, reverse=True
                )[:20]
            ],
        }

    def reset(self) -> None:
        """Reset profiling data."""
        self._queries.clear()
        self._slow_queries.clear()
        self._query_count = 0
        self._total_time_ms = 0.0

    def enable(self) -> None:
        self._enabled = True

    def disable(self) -> None:
        self._enabled = False


class N1QueryDetector:
    """Detector for N+1 query patterns."""

    def __init__(self) -> None:
        self._parent_queries: Dict[str, List[QueryInfo]] = {}
        self._child_queries: Dict[str, List[QueryInfo]] = {}
        self._lock = asyncio.Lock()

    async def detect_patterns(self) -> List[Dict[str, Any]]:
        """Detect N+1 patterns in recorded queries."""
        patterns = []

        async with self._lock:
            for parent_stmt, parent_queries in self._parent_queries.items():
                for child_stmt, child_queries in self._child_queries.items():
                    if self._is_related(parent_stmt, child_stmt):
                        if len(parent_queries) > 1 and len(child_queries) > len(
                            parent_queries
                        ):
                            patterns.append(
                                {
                                    "parent": parent_stmt[:100],
                                    "child": child_stmt[:100],
                                    "parent_calls": len(parent_queries),
                                    "child_calls": len(child_queries),
                                    "ratio": round(
                                        len(child_queries) / len(parent_queries), 2
                                    ),
                                    "severity": "high"
                                    if len(child_queries) / len(parent_queries) > 10
                                    else "medium",
                                }
                            )

        return patterns

    def _is_related(self, parent: str, child: str) -> bool:
        """Check if child query is related to parent (basic heuristic)."""
        parent_tables = set(self._extract_tables(parent))
        child_tables = set(self._extract_tables(child))
        return bool(parent_tables & child_tables)

    def _extract_tables(self, statement: str) -> set:
        """Extract table names from SQL statement."""
        import re

        tables = set()
        patterns = [
            r'FROM\s+"?([a-zA-Z_][a-zA-Z0-9_"]*)',
            r'JOIN\s+"?([a-zA-Z_][a-zA-Z0-9_"]*)',
        ]
        for pattern in patterns:
            matches = re.findall(pattern, statement, re.IGNORECASE)
            tables.update(matches)
        return tables


class ConnectionPoolMonitor:
    """Monitor for database connection pool statistics."""

    def __init__(self, pool: AsyncAdaptedQueuePool) -> None:
        self._pool = pool

    def get_stats(self) -> Dict[str, Any]:
        """Get connection pool statistics."""
        return {
            "pool_size": self._pool.size(),
            "pool_checkedout": self._pool.checkedout(),
            "pool_overflow": self._pool.overflow(),
            "pool_checkedin": self._pool.checkedin(),
            "status": self._get_pool_status(),
        }

    def _get_pool_status(self) -> str:
        """Get human-readable pool status."""
        size = self._pool.size()
        checkedout = self._pool.checkedout()
        overflow = self._pool.overflow()

        if checkedout == 0:
            return "idle"
        elif checkedout < size:
            return "healthy"
        elif checkedout == size:
            return "near_capacity"
        else:
            return "saturated"

    def is_saturated(self, threshold: float = 0.9) -> bool:
        """Check if pool is saturated."""
        size = self._pool.size()
        checkedout = self._pool.checkedout()
        return checkedout / size >= threshold if size > 0 else False


_global_query_profiler: Optional[QueryProfiler] = None


def get_query_profiler() -> QueryProfiler:
    """Get or create global query profiler."""
    global _global_query_profiler
    if _global_query_profiler is None:
        _global_query_profiler = QueryProfiler()
    return _global_query_profiler


def instrument_engine(engine) -> None:
    """Instrument SQLAlchemy engine with query profiling."""
    profiler = get_query_profiler()

    @event.listens_for(engine.sync_engine, "before_cursor_execute", retval=True)
    def before_cursor_execute(
        conn, cursor, statement, parameters, context, executemany
    ):
        conn.info["query_start_time"] = time.perf_counter()
        return statement, parameters

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        duration_ms = (time.perf_counter() - conn.info["query_start_time"]) * 1000

        query = QueryInfo(
            statement=statement,
            parameters=parameters,
            start_time=time.time(),
            duration_ms=duration_ms,
        )

        if asyncio.iscoroutinefunction(conn.execute):
            asyncio.create_task(profiler.record_query(query))
        else:
            profiler.record_query(query)


class ProfileQueryContext:
    """Async context manager for profiling a single query."""

    def __init__(self, statement: str, params: Tuple[Any, ...] = ()) -> None:
        self.statement = statement
        self.params = params
        self.profiler = get_query_profiler()
        self.start_time: float = 0.0
        self.duration_ms: float = 0.0
        self.error: Optional[str] = None

    async def __aenter__(self) -> "ProfileQueryContext":
        self.start_time = time.perf_counter()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self.duration_ms = (time.perf_counter() - self.start_time) * 1000
        if exc_type:
            self.error = str(exc_val)
        query = QueryInfo(
            statement=self.statement,
            parameters=self.params,
            start_time=time.time(),
            duration_ms=self.duration_ms,
            error=self.error,
        )
        await self.profiler.record_query(query)


def profile_query(statement: str, params: Tuple[Any, ...] = ()) -> ProfileQueryContext:
    """Context manager to profile a single query."""
    return ProfileQueryContext(statement, params)
