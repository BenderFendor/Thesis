from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.services.resource_monitor import (
    ResourceMonitor,
    _parse_gpu_rows,
    read_jsonl_records,
)


def test_parse_gpu_rows_converts_mib_to_bytes() -> None:
    rows = _parse_gpu_rows("0, NVIDIA RTX, 84, 1024, 12288, 71, 120.5\n")

    assert rows == [
        {
            "index": 0,
            "name": "NVIDIA RTX",
            "utilization_percent": 84.0,
            "memory_used_bytes": 1024 * 1024 * 1024,
            "memory_total_bytes": 12288 * 1024 * 1024,
            "temperature_celsius": 71.0,
            "power_watts": 120.5,
        }
    ]


def test_resource_monitor_writes_agent_readable_jsonl(tmp_path: Path) -> None:
    monitor = ResourceMonitor(
        service_name="test-service",
        interval_seconds=1,
        log_dir=tmp_path,
    )

    monitor.start()
    deadline = time.monotonic() + 2
    while not monitor.log_path.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    monitor.stop()

    assert monitor.log_path.exists()
    record = json.loads(monitor.log_path.read_text().splitlines()[0])
    assert record["kind"] == "resource_sample"
    assert record["service"] == "test-service"
    assert record["process"]["rss_bytes"] > 0
    assert record["system"]["memory_total_bytes"] > 0
    assert "used_percent" in record["disk"]
    assert isinstance(record["gpus"], list)


def test_record_operation_is_sparse_and_correlatable(tmp_path: Path) -> None:
    monitor = ResourceMonitor(service_name="embedding-worker", log_dir=tmp_path)
    monitor.record_operation(
        "embedding_batch",
        duration_ms=123.4,
        details={"input_count": 12, "batch_size": 4},
    )

    record = json.loads(monitor.log_path.read_text().strip())
    assert record["kind"] == "operation"
    assert record["operation"] == "embedding_batch"
    assert record["duration_ms"] == 123.4
    assert record["details"]["input_count"] == 12


def test_read_jsonl_records_filters_by_time(tmp_path: Path) -> None:
    path = tmp_path / "performance_test_1.jsonl"
    old = datetime.now(UTC) - timedelta(hours=2)
    recent = datetime.now(UTC)
    path.write_text(
        "\n".join(
            [
                json.dumps({"timestamp": old.isoformat(), "value": "old"}),
                json.dumps({"timestamp": recent.isoformat(), "value": "recent"}),
            ]
        )
        + "\n"
    )

    records = read_jsonl_records(
        [path],
        since=datetime.now(UTC) - timedelta(minutes=30),
    )
    assert [record["value"] for record in records] == ["recent"]
