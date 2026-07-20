"""OpenTelemetry span exporter that writes compact JSON Lines locally."""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExportResult, SpanExporter
from opentelemetry.trace import format_span_id, format_trace_id

from app.core.logging import get_runtime_log_dir


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return str(value)


def _iso_from_ns(value: int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value / 1_000_000_000, tz=UTC).isoformat()


class JsonlSpanExporter(SpanExporter):
    """Persist completed spans in a format both humans and agents can inspect."""

    def __init__(self, *, service_name: str, log_dir: Path | None = None) -> None:
        safe_service = "".join(
            character if character.isalnum() or character in {"-", "_"} else "_"
            for character in service_name
        )
        self._path = (log_dir or get_runtime_log_dir()) / (
            f"traces_{safe_service}_{os.getpid()}.jsonl"
        )
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self._path

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self._lock, self._path.open("a", encoding="utf-8") as handle:
                for span in spans:
                    context = span.context
                    parent = span.parent
                    start_ns = span.start_time
                    end_ns = span.end_time
                    duration_ms = (
                        (end_ns - start_ns) / 1_000_000
                        if start_ns is not None and end_ns is not None
                        else None
                    )
                    payload = {
                        "timestamp": _iso_from_ns(end_ns)
                        or datetime.now(UTC).isoformat(),
                        "kind": "trace_span",
                        "service": span.resource.attributes.get("service.name"),
                        "trace_id": format_trace_id(context.trace_id),
                        "span_id": format_span_id(context.span_id),
                        "parent_span_id": format_span_id(parent.span_id)
                        if parent
                        else None,
                        "operation": span.name,
                        "span_kind": span.kind.name,
                        "status": span.status.status_code.name,
                        "status_description": span.status.description,
                        "start_time": _iso_from_ns(start_ns),
                        "end_time": _iso_from_ns(end_ns),
                        "duration_ms": round(duration_ms, 3)
                        if duration_ms is not None
                        else None,
                        "attributes": _json_safe(dict(span.attributes or {})),
                        "events": [
                            {
                                "name": event.name,
                                "timestamp": _iso_from_ns(event.timestamp),
                                "attributes": _json_safe(dict(event.attributes or {})),
                            }
                            for event in span.events
                        ],
                    }
                    handle.write(
                        json.dumps(payload, separators=(",", ":"), default=str) + "\n"
                    )
        except OSError:
            return SpanExportResult.FAILURE
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return True
