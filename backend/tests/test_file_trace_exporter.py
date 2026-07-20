from __future__ import annotations

import json
from pathlib import Path

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

from app.core.file_trace_exporter import JsonlSpanExporter


def test_jsonl_span_exporter_persists_correlation_attributes(tmp_path: Path) -> None:
    provider = TracerProvider(resource=Resource.create({"service.name": "test-service"}))
    exporter = JsonlSpanExporter(service_name="test-service", log_dir=tmp_path)
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test")

    with tracer.start_as_current_span("database.fetch_articles") as span:
        span.set_attribute("thesis.request_id", "req_test")

    provider.shutdown()
    record = json.loads(exporter.path.read_text().strip())
    assert record["kind"] == "trace_span"
    assert record["service"] == "test-service"
    assert record["operation"] == "database.fetch_articles"
    assert record["attributes"]["thesis.request_id"] == "req_test"
    assert len(record["trace_id"]) == 32
    assert len(record["span_id"]) == 16
