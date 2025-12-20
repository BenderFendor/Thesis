"""
Debug Logger Service for Agentic Debugging

This module provides comprehensive structured logging optimized for debugging by
AI coding tools and humans alike. It captures:

- Request/response cycles with timing
- SSE stream lifecycle events
- Database query performance
- Cache operations
- RSS ingestion timing
- Error traces with context
- Performance bottleneck detection

Log Format: JSON Lines (one JSON object per line) for easy parsing.
"""

from __future__ import annotations

import json
import os
import threading
import time
import traceback
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Deque

from app.core.logging import get_logger

logger = get_logger("debug_logger")

# Directory for debug logs
DEBUG_LOG_DIR = Path(os.environ.get("DEBUG_LOG_DIR", "/tmp/scoop_debug_logs"))
DEBUG_LOG_DIR.mkdir(parents=True, exist_ok=True)

# Maximum in-memory events to keep for quick access
MAX_IN_MEMORY_EVENTS = 1000

# Performance thresholds for automatic flagging (in seconds)
THRESHOLDS = {
    "request_slow": 5.0,
    "db_query_slow": 1.0,
    "rss_fetch_slow": 10.0,
    "stream_event_gap": 5.0,
    "cache_miss_threshold": 0.5,
}


class EventType(str, Enum):
    """Types of debug events."""
    REQUEST_START = "request_start"
    REQUEST_END = "request_end"
    REQUEST_ERROR = "request_error"
    STREAM_START = "stream_start"
    STREAM_EVENT = "stream_event"
    STREAM_END = "stream_end"
    STREAM_ERROR = "stream_error"
    STREAM_CLIENT_DISCONNECT = "stream_client_disconnect"
    DB_QUERY_START = "db_query_start"
    DB_QUERY_END = "db_query_end"
    DB_QUERY_ERROR = "db_query_error"
    CACHE_HIT = "cache_hit"
    CACHE_MISS = "cache_miss"
    CACHE_UPDATE = "cache_update"
    RSS_FETCH_START = "rss_fetch_start"
    RSS_FETCH_END = "rss_fetch_end"
    RSS_FETCH_ERROR = "rss_fetch_error"
    RSS_PARSE_ERROR = "rss_parse_error"
    EXECUTOR_SUBMIT = "executor_submit"
    EXECUTOR_COMPLETE = "executor_complete"
    EXECUTOR_TIMEOUT = "executor_timeout"
    PERFORMANCE_WARNING = "performance_warning"
    BOTTLENECK_DETECTED = "bottleneck_detected"
    HANG_SUSPECTED = "hang_suspected"
    CUSTOM = "custom"


@dataclass
class DebugEvent:
    """A single debug event with all context needed for debugging."""
    
    event_id: str
    event_type: EventType
    timestamp: str
    component: str  # e.g., "stream", "cache", "database", "rss"
    operation: str  # e.g., "fetch_news", "query_articles"
    
    # Timing
    duration_ms: Optional[float] = None
    start_time: Optional[float] = None
    
    # Context
    request_id: Optional[str] = None
    stream_id: Optional[str] = None
    source_name: Optional[str] = None
    category: Optional[str] = None
    
    # Data
    message: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, float] = field(default_factory=dict)
    
    # Error info
    error: Optional[str] = None
    error_type: Optional[str] = None
    stack_trace: Optional[str] = None
    
    # Performance flags
    is_slow: bool = False
    is_bottleneck: bool = False
    threshold_exceeded: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result = asdict(self)
        result["event_type"] = self.event_type.value
        return result
    
    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), default=str)


@dataclass
class RequestTrace:
    """Traces a single request through the system."""
    
    request_id: str
    path: str
    method: str
    start_time: float
    events: List[DebugEvent] = field(default_factory=list)
    stream_id: Optional[str] = None
    is_complete: bool = False
    end_time: Optional[float] = None
    total_duration_ms: Optional[float] = None
    
    def add_event(self, event: DebugEvent) -> None:
        """Add an event to this trace."""
        event.request_id = self.request_id
        self.events.append(event)
    
    def complete(self) -> None:
        """Mark the request as complete."""
        self.is_complete = True
        self.end_time = time.time()
        self.total_duration_ms = (self.end_time - self.start_time) * 1000


@dataclass
class StreamTrace:
    """Traces a single SSE stream lifecycle."""
    
    stream_id: str
    request_id: Optional[str]
    start_time: float
    events: List[DebugEvent] = field(default_factory=list)
    source_timings: Dict[str, float] = field(default_factory=dict)
    articles_emitted: int = 0
    sources_completed: int = 0
    sources_failed: int = 0
    last_event_time: float = 0
    is_complete: bool = False
    end_time: Optional[float] = None
    disconnect_reason: Optional[str] = None
    
    def add_event(self, event: DebugEvent) -> None:
        """Add an event and update timing."""
        event.stream_id = self.stream_id
        self.events.append(event)
        self.last_event_time = time.time()
    
    def get_event_gap(self) -> float:
        """Get time since last event in seconds."""
        if self.last_event_time == 0:
            return 0.0
        return time.time() - self.last_event_time


class DebugLoggerService:
    """
    Central debug logging service that captures, stores, and analyzes debug events.
    
    Features:
    - Thread-safe event logging
    - Request and stream tracing
    - Performance bottleneck detection
    - File-based log storage (JSON Lines)
    - In-memory recent event buffer
    - Hang detection
    """
    
    def __init__(self):
        self._lock = threading.Lock()
        self._events: Deque[DebugEvent] = deque(maxlen=MAX_IN_MEMORY_EVENTS)
        self._active_requests: Dict[str, RequestTrace] = {}
        self._active_streams: Dict[str, StreamTrace] = {}
        self._log_file: Optional[Path] = None
        self._session_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        self._event_counter = 0
        
        # Performance tracking
        self._bottleneck_counts: Dict[str, int] = {}
        self._slow_operations: Deque[Dict[str, Any]] = deque(maxlen=100)
        
        # Initialize log file
        self._init_log_file()
        
        logger.info(
            "DebugLoggerService initialized, session=%s, log_dir=%s",
            self._session_id,
            DEBUG_LOG_DIR
        )
    
    def _init_log_file(self) -> None:
        """Initialize the debug log file for this session."""
        self._log_file = DEBUG_LOG_DIR / f"debug_{self._session_id}.jsonl"
        # Write session header
        header = {
            "type": "session_start",
            "session_id": self._session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "thresholds": THRESHOLDS,
        }
        with open(self._log_file, "w") as f:
            f.write(json.dumps(header) + "\n")
    
    def _generate_event_id(self) -> str:
        """Generate a unique event ID."""
        with self._lock:
            self._event_counter += 1
            return f"evt_{self._session_id}_{self._event_counter:06d}"
    
    def _write_to_file(self, event: DebugEvent) -> None:
        """Write event to log file."""
        if self._log_file:
            try:
                with open(self._log_file, "a") as f:
                    f.write(event.to_json() + "\n")
            except Exception as e:
                logger.error("Failed to write debug event to file: %s", e)
    
    def _check_performance(self, event: DebugEvent) -> None:
        """Check if event indicates performance issues."""
        if event.duration_ms is None:
            return
        
        duration_s = event.duration_ms / 1000
        
        # Check thresholds based on component
        threshold_key = None
        if event.component == "request" and duration_s > THRESHOLDS["request_slow"]:
            threshold_key = "request_slow"
        elif event.component == "database" and duration_s > THRESHOLDS["db_query_slow"]:
            threshold_key = "db_query_slow"
        elif event.component == "rss" and duration_s > THRESHOLDS["rss_fetch_slow"]:
            threshold_key = "rss_fetch_slow"
        
        if threshold_key:
            event.is_slow = True
            event.threshold_exceeded = threshold_key
            self._slow_operations.append({
                "event_id": event.event_id,
                "component": event.component,
                "operation": event.operation,
                "duration_ms": event.duration_ms,
                "threshold": threshold_key,
                "timestamp": event.timestamp,
            })
    
    def log_event(
        self,
        event_type: EventType,
        component: str,
        operation: str,
        message: str = "",
        request_id: Optional[str] = None,
        stream_id: Optional[str] = None,
        source_name: Optional[str] = None,
        category: Optional[str] = None,
        duration_ms: Optional[float] = None,
        details: Optional[Dict[str, Any]] = None,
        metrics: Optional[Dict[str, float]] = None,
        error: Optional[Exception] = None,
    ) -> DebugEvent:
        """Log a debug event."""
        event = DebugEvent(
            event_id=self._generate_event_id(),
            event_type=event_type,
            timestamp=datetime.now(timezone.utc).isoformat(),
            component=component,
            operation=operation,
            message=message,
            request_id=request_id,
            stream_id=stream_id,
            source_name=source_name,
            category=category,
            duration_ms=duration_ms,
            details=details or {},
            metrics=metrics or {},
        )
        
        if error:
            event.error = str(error)
            event.error_type = type(error).__name__
            event.stack_trace = traceback.format_exc()
        
        self._check_performance(event)
        
        with self._lock:
            self._events.append(event)
            
            # Update active traces
            if request_id and request_id in self._active_requests:
                self._active_requests[request_id].add_event(event)
            if stream_id and stream_id in self._active_streams:
                self._active_streams[stream_id].add_event(event)
        
        self._write_to_file(event)
        return event
    
    # --- Request Tracing ---
    
    def start_request(self, request_id: str, path: str, method: str) -> RequestTrace:
        """Start tracing a request."""
        trace = RequestTrace(
            request_id=request_id,
            path=path,
            method=method,
            start_time=time.time(),
        )
        with self._lock:
            self._active_requests[request_id] = trace
        
        self.log_event(
            EventType.REQUEST_START,
            component="request",
            operation="start",
            message=f"{method} {path}",
            request_id=request_id,
            details={"path": path, "method": method},
        )
        return trace
    
    def end_request(
        self, request_id: str, status_code: int, error: Optional[Exception] = None
    ) -> Optional[RequestTrace]:
        """End tracing a request."""
        with self._lock:
            trace = self._active_requests.pop(request_id, None)
        
        if trace:
            trace.complete()
            self.log_event(
                EventType.REQUEST_ERROR if error else EventType.REQUEST_END,
                component="request",
                operation="end",
                message=f"Status {status_code}",
                request_id=request_id,
                duration_ms=trace.total_duration_ms,
                details={
                    "status_code": status_code,
                    "event_count": len(trace.events),
                },
                error=error,
            )
        return trace
    
    # --- Stream Tracing ---
    
    def start_stream(self, stream_id: str, request_id: Optional[str] = None) -> StreamTrace:
        """Start tracing a stream."""
        trace = StreamTrace(
            stream_id=stream_id,
            request_id=request_id,
            start_time=time.time(),
            last_event_time=time.time(),
        )
        with self._lock:
            self._active_streams[stream_id] = trace
        
        self.log_event(
            EventType.STREAM_START,
            component="stream",
            operation="start",
            message=f"Stream {stream_id} started",
            request_id=request_id,
            stream_id=stream_id,
        )
        return trace
    
    def log_stream_event(
        self,
        stream_id: str,
        event_name: str,
        source_name: Optional[str] = None,
        article_count: int = 0,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log a stream event (source complete, cache data, etc.)."""
        with self._lock:
            trace = self._active_streams.get(stream_id)
        
        if trace:
            # Check for event gap (potential hang)
            gap = trace.get_event_gap()
            is_slow_gap = gap > THRESHOLDS["stream_event_gap"]
            
            if source_name:
                trace.source_timings[source_name] = time.time() - trace.start_time
                trace.articles_emitted += article_count
            
            self.log_event(
                EventType.STREAM_EVENT,
                component="stream",
                operation=event_name,
                message=f"Stream event: {event_name}",
                stream_id=stream_id,
                source_name=source_name,
                details={
                    **(details or {}),
                    "article_count": article_count,
                    "event_gap_seconds": round(gap, 2),
                    "is_slow_gap": is_slow_gap,
                },
                metrics={
                    "articles_emitted": trace.articles_emitted,
                    "event_gap_s": gap,
                },
            )
            
            if is_slow_gap:
                self.log_event(
                    EventType.HANG_SUSPECTED,
                    component="stream",
                    operation="hang_check",
                    message=f"Large gap between events: {gap:.1f}s",
                    stream_id=stream_id,
                    details={"gap_seconds": gap, "threshold": THRESHOLDS["stream_event_gap"]},
                )
    
    def end_stream(
        self,
        stream_id: str,
        reason: str = "complete",
        error: Optional[Exception] = None,
    ) -> Optional[StreamTrace]:
        """End tracing a stream."""
        with self._lock:
            trace = self._active_streams.pop(stream_id, None)
        
        if trace:
            trace.is_complete = True
            trace.end_time = time.time()
            trace.disconnect_reason = reason
            duration_ms = (trace.end_time - trace.start_time) * 1000
            
            event_type = EventType.STREAM_ERROR if error else EventType.STREAM_END
            if reason == "client_disconnect":
                event_type = EventType.STREAM_CLIENT_DISCONNECT
            
            self.log_event(
                event_type,
                component="stream",
                operation="end",
                message=f"Stream ended: {reason}",
                stream_id=stream_id,
                duration_ms=duration_ms,
                details={
                    "reason": reason,
                    "articles_emitted": trace.articles_emitted,
                    "sources_completed": trace.sources_completed,
                    "source_timings": trace.source_timings,
                },
                error=error,
            )
        return trace
    
    # --- Cache Tracing ---
    
    def log_cache_operation(
        self,
        operation: str,
        hit: bool,
        article_count: int = 0,
        cache_age_seconds: Optional[float] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log a cache operation."""
        event_type = EventType.CACHE_HIT if hit else EventType.CACHE_MISS
        if operation == "update":
            event_type = EventType.CACHE_UPDATE
        
        self.log_event(
            event_type,
            component="cache",
            operation=operation,
            message=f"Cache {operation}: {'hit' if hit else 'miss'}",
            details={
                **(details or {}),
                "article_count": article_count,
                "cache_age_seconds": cache_age_seconds,
            },
            metrics={
                "articles": article_count,
                "age_s": cache_age_seconds or 0,
            },
        )
    
    # --- Database Tracing ---
    
    @contextmanager
    def trace_db_query(self, query_name: str, details: Optional[Dict[str, Any]] = None):
        """Context manager to trace database queries."""
        start = time.time()
        
        self.log_event(
            EventType.DB_QUERY_START,
            component="database",
            operation=query_name,
            message=f"DB query started: {query_name}",
            details=details or {},
        )
        
        try:
            yield
            duration_ms = (time.time() - start) * 1000
            self.log_event(
                EventType.DB_QUERY_END,
                component="database",
                operation=query_name,
                message=f"DB query complete: {query_name}",
                duration_ms=duration_ms,
                details=details or {},
            )
        except Exception as e:
            duration_ms = (time.time() - start) * 1000
            self.log_event(
                EventType.DB_QUERY_ERROR,
                component="database",
                operation=query_name,
                message=f"DB query failed: {query_name}",
                duration_ms=duration_ms,
                details=details or {},
                error=e,
            )
            raise
    
    # --- RSS Tracing ---
    
    def log_rss_operation(
        self,
        operation: str,
        source_name: str,
        success: bool,
        duration_ms: Optional[float] = None,
        article_count: int = 0,
        error: Optional[Exception] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log an RSS fetch/parse operation."""
        if operation == "fetch":
            event_type = EventType.RSS_FETCH_END if success else EventType.RSS_FETCH_ERROR
        else:
            event_type = EventType.RSS_PARSE_ERROR if not success else EventType.CUSTOM
        
        self.log_event(
            event_type,
            component="rss",
            operation=operation,
            message=f"RSS {operation} for {source_name}: {'success' if success else 'failed'}",
            source_name=source_name,
            duration_ms=duration_ms,
            details={
                **(details or {}),
                "article_count": article_count,
                "success": success,
            },
            error=error,
        )
    
    # --- Analysis Methods ---
    
    def get_recent_events(
        self, limit: int = 100, event_type: Optional[EventType] = None
    ) -> List[Dict[str, Any]]:
        """Get recent events, optionally filtered by type."""
        with self._lock:
            events = list(self._events)
        
        if event_type:
            events = [e for e in events if e.event_type == event_type]
        
        return [e.to_dict() for e in events[-limit:]]
    
    def get_active_streams(self) -> Dict[str, Dict[str, Any]]:
        """Get info about active streams."""
        with self._lock:
            return {
                stream_id: {
                    "stream_id": trace.stream_id,
                    "start_time": trace.start_time,
                    "duration_s": time.time() - trace.start_time,
                    "articles_emitted": trace.articles_emitted,
                    "sources_completed": trace.sources_completed,
                    "event_gap_s": trace.get_event_gap(),
                    "event_count": len(trace.events),
                    "is_potentially_hung": trace.get_event_gap() > THRESHOLDS["stream_event_gap"],
                }
                for stream_id, trace in self._active_streams.items()
            }
    
    def get_slow_operations(self) -> List[Dict[str, Any]]:
        """Get list of slow operations detected."""
        with self._lock:
            return list(self._slow_operations)
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get a summary of performance metrics."""
        with self._lock:
            events = list(self._events)
        
        # Calculate averages by component
        component_timings: Dict[str, List[float]] = {}
        for event in events:
            if event.duration_ms is not None:
                if event.component not in component_timings:
                    component_timings[event.component] = []
                component_timings[event.component].append(event.duration_ms)
        
        component_stats = {}
        for component, timings in component_timings.items():
            if timings:
                component_stats[component] = {
                    "count": len(timings),
                    "avg_ms": sum(timings) / len(timings),
                    "max_ms": max(timings),
                    "min_ms": min(timings),
                }
        
        return {
            "session_id": self._session_id,
            "total_events": len(events),
            "active_streams": len(self._active_streams),
            "active_requests": len(self._active_requests),
            "slow_operations_count": len(self._slow_operations),
            "component_stats": component_stats,
            "thresholds": THRESHOLDS,
            "log_file": str(self._log_file),
        }
    
    def get_debug_report(self) -> Dict[str, Any]:
        """
        Generate a comprehensive debug report for agentic tools.
        
        This includes everything needed to diagnose issues:
        - Recent events
        - Active streams and their state
        - Performance summary
        - Slow operations
        - Potential issues detected
        """
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": self._session_id,
            "performance_summary": self.get_performance_summary(),
            "active_streams": self.get_active_streams(),
            "slow_operations": self.get_slow_operations(),
            "recent_events": self.get_recent_events(limit=50),
            "recent_errors": [
                e.to_dict() for e in self._events
                if e.error is not None
            ][-20:],
            "hang_suspects": [
                stream_info
                for stream_info in self.get_active_streams().values()
                if stream_info.get("is_potentially_hung")
            ],
            "recommendations": self._generate_recommendations(),
        }
    
    def _generate_recommendations(self) -> List[str]:
        """Generate debugging recommendations based on current state."""
        recommendations = []
        
        # Check for active streams with gaps
        for stream_id, info in self.get_active_streams().items():
            if info.get("is_potentially_hung"):
                recommendations.append(
                    f"Stream {stream_id} may be hung - gap of {info['event_gap_s']:.1f}s since last event. "
                    "Check ThreadPoolExecutor shutdown and RSS fetch timeouts."
                )
        
        # Check for slow operations
        slow_ops = self.get_slow_operations()
        if len(slow_ops) > 5:
            by_component = {}
            for op in slow_ops:
                comp = op.get("component", "unknown")
                by_component[comp] = by_component.get(comp, 0) + 1
            
            for comp, count in by_component.items():
                recommendations.append(
                    f"Multiple slow {comp} operations detected ({count}). "
                    f"Consider optimizing {comp} layer."
                )
        
        # Check for errors
        recent_errors = [e for e in self._events if e.error is not None][-10:]
        if recent_errors:
            error_types = set(e.error_type for e in recent_errors if e.error_type)
            recommendations.append(
                f"Recent errors detected: {', '.join(error_types)}. "
                "Check stack traces in debug log."
            )
        
        if not recommendations:
            recommendations.append("No critical issues detected. System appears healthy.")
        
        return recommendations


# Global singleton instance
debug_logger = DebugLoggerService()


# Convenience functions for common operations
def log_event(
    event_type: EventType,
    component: str,
    operation: str,
    **kwargs,
) -> DebugEvent:
    """Log a debug event."""
    return debug_logger.log_event(event_type, component, operation, **kwargs)


def start_request(request_id: str, path: str, method: str) -> RequestTrace:
    """Start tracing a request."""
    return debug_logger.start_request(request_id, path, method)


def end_request(request_id: str, status_code: int, error: Optional[Exception] = None):
    """End tracing a request."""
    return debug_logger.end_request(request_id, status_code, error)


def start_stream(stream_id: str, request_id: Optional[str] = None) -> StreamTrace:
    """Start tracing a stream."""
    return debug_logger.start_stream(stream_id, request_id)


def log_stream_event(stream_id: str, event_name: str, **kwargs) -> None:
    """Log a stream event."""
    debug_logger.log_stream_event(stream_id, event_name, **kwargs)


def end_stream(stream_id: str, reason: str = "complete", error: Optional[Exception] = None):
    """End tracing a stream."""
    return debug_logger.end_stream(stream_id, reason, error)


def trace_db_query(query_name: str, details: Optional[Dict[str, Any]] = None):
    """Context manager to trace database queries."""
    return debug_logger.trace_db_query(query_name, details)


def get_debug_report() -> Dict[str, Any]:
    """Get comprehensive debug report."""
    return debug_logger.get_debug_report()
