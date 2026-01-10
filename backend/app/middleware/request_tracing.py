"""
Request Tracing Middleware

Automatically traces all requests through the system, capturing timing,
errors, and correlating with stream events.
"""

from __future__ import annotations

import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import get_logger
from app.services.debug_logger import debug_logger, EventType

logger = get_logger("request_tracing")
SKIP_TRACE_PREFIXES = ("/health", "/favicon.ico", "/static/")


class RequestTracingMiddleware(BaseHTTPMiddleware):
    """Middleware that traces all HTTP requests."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate or extract request ID
        request_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"
        
        # Store request ID in state for access by route handlers
        request.state.request_id = request_id
        
        # Start tracing
        path = request.url.path
        method = request.method
        
        # Skip tracing for health checks and static assets
        should_trace = not path.startswith(SKIP_TRACE_PREFIXES)
        
        if should_trace:
            debug_logger.start_request(request_id, path, method)
            
            # Log query params and headers for debugging
            debug_logger.log_event(
                EventType.CUSTOM,
                component="request",
                operation="details",
                message="Request details",
                request_id=request_id,
                details={
                    "query_params": dict(request.query_params),
                    "user_agent": request.headers.get("User-Agent", "unknown")[:100],
                    "content_type": request.headers.get("Content-Type"),
                    "accept": request.headers.get("Accept"),
                },
            )
        
        start_time = time.time()
        error = None
        status_code = 500
        response = None

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as exc:
            error = exc
            raise
        finally:
            duration_ms = (time.time() - start_time) * 1000

            if should_trace:
                debug_logger.end_request(request_id, status_code, error)

                # Log slow requests
                if duration_ms > 5000:  # 5 seconds
                    logger.warning(
                        "Slow request detected: %s %s took %.1fms",
                        method, path, duration_ms
                    )

            # Add headers to response if we have one
            if response is not None:
                response.headers["X-Request-ID"] = request_id
                response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"
                response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"


def get_request_id(request: Request) -> str:
    """Get the request ID from request state."""
    return getattr(request.state, "request_id", "unknown")
