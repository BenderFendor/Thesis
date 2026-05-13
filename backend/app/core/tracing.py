"""Tracing."""

from __future__ import annotations

import logging
from typing import Any, cast

from fastapi import FastAPI

from app.core.config import settings

TRACER_NAME = "scoop-backend"

_logger = logging.getLogger("app.tracing")


def _tracer_provider_configured() -> bool:
    try:
        from opentelemetry.sdk.trace import TracerProvider

        return isinstance(
            cast(Any, __import__("opentelemetry.trace").trace).get_tracer_provider(),
            TracerProvider,
        )
    except Exception:
        return False


def setup_tracing(app: FastAPI) -> None:
    """Setup Tracing."""
    if not settings.otel_enabled:
        _logger.info("OpenTelemetry tracing is disabled (OTEL_ENABLED=0)")
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
    except ImportError as exc:
        _logger.warning("OpenTelemetry dependencies not installed: %s; tracing disabled", exc)
        return

    sample_rate = max(0.0, min(1.0, settings.otel_sample_rate))

    resource = Resource.create({"service.name": TRACER_NAME})

    provider = TracerProvider(
        resource=resource,
        sampler=TraceIdRatioBased(sample_rate),
    )

    console_exporter = ConsoleSpanExporter()
    processor = BatchSpanProcessor(console_exporter)
    provider.add_span_processor(processor)

    if settings.otel_exporter_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )

            otlp_exporter = OTLPSpanExporter(
                endpoint=settings.otel_exporter_endpoint,
            )
            otlp_processor = BatchSpanProcessor(otlp_exporter)
            provider.add_span_processor(otlp_processor)
            _logger.info("OTLP exporter configured at %s", settings.otel_exporter_endpoint)
        except ImportError:
            _logger.warning("OTLP exporter not installed; only console export active")
        except Exception as exc:
            _logger.warning("Failed to configure OTLP exporter: %s", exc)

    trace.set_tracer_provider(provider)

    _instrument_fastapi(app)
    _instrument_httpx()
    _instrument_sqlalchemy()

    _logger.info(
        "OpenTelemetry tracing enabled (service=%s sample_rate=%.2f)",
        TRACER_NAME,
        sample_rate,
    )


def get_tracer(name: str = TRACER_NAME) -> Any:
    """Get Tracer."""
    if not settings.otel_enabled:
        return _NoOpTracer()

    try:
        from opentelemetry.trace import get_tracer as _otel_get_tracer

        return _otel_get_tracer(name)
    except ImportError:
        return _NoOpTracer()


class _NoOpTracer:
    def start_as_current_span(self, name: str, *args: Any, **kwargs: Any) -> Any:
        """Start As Current Span."""
        return _NoOpSpan()

    def start_span(self, name: str, *args: Any, **kwargs: Any) -> Any:
        """Start Span."""
        return _NoOpSpan()


class _NoOpSpan:
    def __enter__(self) -> _NoOpSpan:
        """Context manager enter."""
        return self

    def __exit__(self, *args: Any) -> None:
        """Context manager exit."""
        pass

    def set_attribute(self, key: str, value: Any) -> None:
        """Set Attribute."""
        pass

    def set_status(self, status: Any, description: str | None = None) -> None:
        """Set Status."""
        pass

    def record_exception(self, exception: Exception) -> None:
        """Record Exception."""
        pass

    def add_event(self, name: str, attributes: Any = None) -> None:
        """Add Event."""
        pass

    def get_span_context(self) -> Any:
        """Get Span Context."""
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
            excluded_urls="/health,/favicon.ico,/static/*",
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
        from opentelemetry.instrumentation.sqlalchemy import (
            SQLAlchemyInstrumentor,
        )

        SQLAlchemyInstrumentor().instrument(
            enable_commenter=True,
            commenter_options={},
        )
        _logger.info("SQLAlchemy instrumentation applied")
    except Exception as exc:
        _logger.warning("SQLAlchemy instrumentation failed: %s", exc)
