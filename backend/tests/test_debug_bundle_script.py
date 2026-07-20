from __future__ import annotations

import importlib.util
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "collect_debug_bundle.py"
SPEC = importlib.util.spec_from_file_location("collect_debug_bundle", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)


def test_parse_duration() -> None:
    assert bundle.parse_duration("30m") == timedelta(minutes=30)
    assert bundle.parse_duration("2h") == timedelta(hours=2)


def test_sanitize_database_url() -> None:
    value = bundle.sanitize_value(
        "DATABASE_URL",
        "postgresql://newsuser:secret@localhost:5432/newsdb",
    )
    assert value == "postgresql://newsuser:<redacted>@localhost:5432/newsdb"


def test_sanitize_record_redacts_nested_secrets_and_url_values() -> None:
    value = bundle.sanitize_record(
        {
            "authorization": "Bearer secret-value",
            "details": {
                "message": "token=abc123 url=https://example.test/path?q=private",
                "database": "postgresql://user:pass@example.test/db",
            },
        }
    )

    assert value == {
        "authorization": "<redacted>",
        "details": {
            "message": ("token=<redacted> url=https://example.test/path?q=<redacted>"),
            "database": "postgresql://user:<redacted>@example.test/db",
        },
    }


def test_filter_jsonl_keeps_selected_time_window(tmp_path: Path) -> None:
    source = tmp_path / "source.jsonl"
    destination = tmp_path / "bundle" / "source.jsonl"
    now = datetime.now(UTC)
    source.write_text(
        "\n".join(
            [
                json.dumps({"timestamp": (now - timedelta(hours=2)).isoformat(), "id": 1}),
                json.dumps({"timestamp": now.isoformat(), "id": 2}),
                "not-json",
            ]
        )
        + "\n"
    )

    result = bundle.filter_jsonl(
        source,
        destination,
        now - timedelta(minutes=30),
    )

    assert result["kept_records"] == 1
    assert result["malformed_records"] == 1
    assert json.loads(destination.read_text())["id"] == 2
