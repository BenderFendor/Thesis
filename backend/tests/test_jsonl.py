from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.jsonl import append_jsonl, sanitize_runtime_value


def test_sanitize_runtime_value_redacts_nested_secrets() -> None:
    assert sanitize_runtime_value(
        {
            "authorization": "Bearer abc",
            "url": "https://user:pass@example.test/path?q=private",
            "message": "token=abc123",
            "monkey_count": 4,
        }
    ) == {
        "authorization": "<redacted>",
        "url": "https://user:<redacted>@example.test/path?q=<redacted>",
        "message": "token=<redacted>",
        "monkey_count": 4,
    }


def test_append_jsonl_rotates_before_size_cap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("THESIS_LOG_MAX_BYTES", "80")
    monkeypatch.setenv("THESIS_LOG_BACKUP_COUNT", "2")
    path = tmp_path / "events.jsonl"

    for index in range(5):
        append_jsonl(path, {"index": index, "message": "x" * 24})

    rotated = tmp_path / "events.1.jsonl"
    assert path.exists()
    assert rotated.exists()
    records = [json.loads(line) for line in path.read_text().splitlines()]
    assert records[-1]["index"] == 4
    assert not (tmp_path / "events.3.jsonl").exists()
