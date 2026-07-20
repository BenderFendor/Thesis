"""Request correlation and structured timing middleware."""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import get_logger
from app.services.debug_logger import EventType, debug_logger

logger = get_logger("request_tracing")
SKIP_TRACE_PREFIXES = (
    "/health",
    "/favicon.ico",
    "/static/",
    "/debug/observability/health",
)


def _current_trace_id(request_id: str) -> str | None:
    """Attach the request ID to the current OTel span and return its trace ID."""
    try:
        from opentelemetry.trace import format_trace_id, get_current_span

        span = get_current_span()
        context = span.get_span_context()
        if not context.trace_id:
            return None
        span.set_attribute("thesis.request_id", request_id)
        return format_trace_id(context.trace_id)
    except Exception:
        return None


class RequestTracingMiddleware(BaseHTTPMiddleware):
    """Correlate requests with structured logs and optional OpenTelemetry spans."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = (
            request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"
        )
        request.state.request_id = request_id

        path = request.url.path
        method = request.method
        should_trace = not path.startswith(SKIP_TRACE_PREFIXES)
        trace_id = _current_trace_id(request_id)
        request.state.trace_id = trace_id

        if should_trace:
            debug_logger.start_request(request_id, path, method)
            debug_logger.log_event(
                EventType.CUSTOM,
                component="request",
                operation="details",
                message="Request details",
                request_id=request_id,
                details={
                    "trace_id": trace_id,
                    # Keep names for reproducibility without persisting query values.
                    "query_param_names": sorted(set(request.query_params.keys())),
                    "user_agent": request.headers.get("User-Agent", "unknown")[:160],
                    "content_type": request.headers.get("Content-Type"),
                    "accept": request.headers.get("Accept"),
                },
            )

        start_time = time.perf_counter()
        error: Exception | None = None
        status_code = 500
        response: Response | None = None

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as exc:
            error = exc
            raise
        finally:
            duration_ms = (time.perf_counter() - start_time) * 1000

            if should_trace:
                debug_logger.end_request(request_id, status_code, error)
                if duration_ms > 5000:
                    logger.warning(
                        "Slow request detected: %s %s took %.1fms request_id=%s trace_id=%s",
                        method,
                        path,
                        duration_ms,
                        request_id,
                        trace_id,
                    )

            if response is not None:
                response.headers["X-Request-ID"] = request_id
                if trace_id:
                    response.headers["X-Trace-ID"] = trace_id
                response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
                response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"


def get_request_id(request: Request) -> str:
    """Get the request ID from request state."""
    return getattr(request.state, "request_id", "unknown")


def get_trace_id(request: Request) -> str | None:
    """Get the current OpenTelemetry trace ID from request state."""
    return getattr(request.state, "trace_id", None)
