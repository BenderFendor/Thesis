"""Bounded JSON Lines file writes for local runtime evidence."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

DEFAULT_MAX_BYTES = 25 * 1024 * 1024
DEFAULT_BACKUP_COUNT = 3
SENSITIVE_KEY = re.compile(
    r"(?:^|[_-])(?:api[_-]?key|key|token|secret|password|cookie|authorization)"
    r"(?:$|[_-])",
    re.IGNORECASE,
)
SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password|cookie|authorization)\b"
    r"(\s*[:=]\s*)([^\s,;]+)"
)
URL_QUERY_VALUE = re.compile(r"([?&][^=\s&#]+)=([^&#\s]*)")
URL_PASSWORD = re.compile(r"(\b[a-z][a-z0-9+.-]*://[^:/\s@]+):([^@\s/]+)@", re.I)


def _positive_env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _backup_path(path: Path, index: int) -> Path:
    return path.with_name(f"{path.stem}.{index}{path.suffix}")


def sanitize_runtime_value(value: object, *, key: str = "") -> object:
    """Redact secrets and URL values before writing local runtime evidence."""
    if SENSITIVE_KEY.search(key):
        return "<redacted>"
    if isinstance(value, dict):
        return {
            str(item_key): sanitize_runtime_value(item, key=str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_runtime_value(item) for item in value]
    if isinstance(value, str):
        value = URL_PASSWORD.sub(r"\1:<redacted>@", value)
        value = URL_QUERY_VALUE.sub(r"\1=<redacted>", value)
        return SENSITIVE_ASSIGNMENT.sub(r"\1\2<redacted>", value)
    return value


def append_jsonl(path: Path, value: dict[str, Any]) -> None:
    """Append one record and rotate the file before it exceeds its size cap.

    Callers that can write from more than one thread must hold their own lock.
    """
    line = json.dumps(sanitize_runtime_value(value), separators=(",", ":"), default=str) + "\n"
    encoded_size = len(line.encode("utf-8"))
    max_bytes = _positive_env_int("THESIS_LOG_MAX_BYTES", DEFAULT_MAX_BYTES)
    backup_count = _positive_env_int("THESIS_LOG_BACKUP_COUNT", DEFAULT_BACKUP_COUNT)

    path.parent.mkdir(parents=True, exist_ok=True)
    current_size = path.stat().st_size if path.exists() else 0
    if current_size and current_size + encoded_size > max_bytes:
        oldest = _backup_path(path, backup_count)
        oldest.unlink(missing_ok=True)
        for index in range(backup_count - 1, 0, -1):
            source = _backup_path(path, index)
            if source.exists():
                source.replace(_backup_path(path, index + 1))
        path.replace(_backup_path(path, 1))

    with path.open("a", encoding="utf-8") as handle:
        handle.write(line)
