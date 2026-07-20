"""OpenTelemetry tracing with local JSONL export for debug bundles."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI

from app.core.config import settings

TRACER_NAME = "scoop-backend"
_logger = logging.getLogger("app.tracing")


def _tracer_provider_configured() -> bool:
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider

        return isinstance(trace.get_tracer_provider(), TracerProvider)
    except Exception:
        return False


def setup_tracing(app: FastAPI) -> None:
    """Configure tracing when OTEL_ENABLED is set."""
    if not settings.otel_enabled:
        _logger.info("OpenTelemetry tracing is disabled (OTEL_ENABLED=0)")
        return

    if _tracer_provider_configured():
        _logger.info("OpenTelemetry tracer provider is already configured")
        _instrument_fastapi(app)
        _instrument_httpx()
        _instrument_sqlalchemy()
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
        )
        from opentelemetry.sdk.trace.sampling import TraceIdRatioBased

        from app.core.file_trace_exporter import JsonlSpanExporter
    except ImportError as exc:
        _logger.warning(
            "OpenTelemetry dependencies not installed: %s; tracing disabled", exc
        )
        return

    sample_rate = max(0.0, min(1.0, settings.otel_sample_rate))
    service_name = os.getenv("THESIS_SERVICE_NAME", TRACER_NAME)

    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": settings.app_version,
            "deployment.environment": settings.environment,
        }
    )
    provider = TracerProvider(
        resource=resource,
        sampler=TraceIdRatioBased(sample_rate),
    )

    file_exporter = JsonlSpanExporter(service_name=service_name)
    provider.add_span_processor(BatchSpanProcessor(file_exporter))
    _logger.info("Local trace export configured at %s", file_exporter.path)

    if os.getenv("OTEL_CONSOLE_EXPORT", "0") not in {"0", "false", "False", ""}:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    if settings.otel_exporter_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )

            provider.add_span_processor(
                BatchSpanProcessor(
                    OTLPSpanExporter(endpoint=settings.otel_exporter_endpoint)
                )
            )
            _logger.info(
                "OTLP exporter configured at %s", settings.otel_exporter_endpoint
            )
        except ImportError:
            _logger.warning(
                "OTLP exporter not installed; local file export remains active"
            )
        except Exception as exc:
            _logger.warning("Failed to configure OTLP exporter: %s", exc)

    trace.set_tracer_provider(provider)

    _instrument_fastapi(app)
    _instrument_httpx()
    _instrument_sqlalchemy()

    _logger.info(
        "OpenTelemetry tracing enabled (service=%s sample_rate=%.2f)",
        service_name,
        sample_rate,
    )


def get_tracer(name: str = TRACER_NAME) -> Any:
    """Return an OpenTelemetry tracer or a no-op fallback."""
    if not settings.otel_enabled:
        return _NoOpTracer()

    try:
        from opentelemetry.trace import get_tracer as _otel_get_tracer

        return _otel_get_tracer(name)
    except ImportError:
        return _NoOpTracer()


class _NoOpTracer:
    def start_as_current_span(self, name: str, *args: Any, **kwargs: Any) -> Any:
        """Return a no-op span context manager."""
        return _NoOpSpan()

    def start_span(self, name: str, *args: Any, **kwargs: Any) -> Any:
        """Return a no-op span."""
        return _NoOpSpan()


class _NoOpSpan:
    def __enter__(self) -> _NoOpSpan:
        return self

    def __exit__(self, *args: Any) -> None:
        return None

    def set_attribute(self, key: str, value: Any) -> None:
        return None

    def set_status(self, status: Any, description: str | None = None) -> None:
        return None

    def record_exception(self, exception: Exception) -> None:
        return None

    def add_event(self, name: str, attributes: Any = None) -> None:
        return None

    def get_span_context(self) -> Any:
        return _NoOpSpanContext()


class _NoOpSpanContext:
    trace_id: int = 0
    span_id: int = 0
    trace_flags: int = 0


def _instrument_fastapi(app: FastAPI) -> None:
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls="/health,/favicon.ico,/static/*,/debug/observability/health",
        )
        _logger.info("FastAPI instrumentation applied")
    except Exception as exc:
        _logger.warning("FastAPI instrumentation failed: %s", exc)


def _instrument_httpx() -> None:
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        _logger.info("httpx instrumentation applied")
    except Exception as exc:
        _logger.warning("httpx instrumentation failed: %s", exc)


def _instrument_sqlalchemy() -> None:
    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        SQLAlchemyInstrumentor().instrument(
            enable_commenter=True,
            commenter_options={},
        )
        _logger.info("SQLAlchemy instrumentation applied")
    except Exception as exc:
        _logger.warning("SQLAlchemy instrumentation failed: %s", exc)
