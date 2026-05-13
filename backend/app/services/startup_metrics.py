"""Startup Metrics."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, UTC
from threading import Lock
from typing import Any


def _ts(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=UTC).isoformat()


@dataclass
class StartupEvent:
    """Startup Event."""

    name: str
    started_at: float
    completed_at: float
    duration_seconds: float
    detail: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """To Dict."""
        payload = asdict(self)
        payload["started_at"] = _ts(self.started_at)
        payload["completed_at"] = _ts(self.completed_at)
        return payload


class StartupMetrics:
    """Startup Metrics."""

    def __init__(self) -> None:
        """Initialize."""
        self._lock = Lock()
        self._started_at: float | None = None
        self._completed_at: float | None = None
        self._events: list[StartupEvent] = []
        self._notes: dict[str, Any] = {}

    def mark_app_started(self) -> None:
        """Mark App Started."""
        with self._lock:
            self._started_at = time.time()
            self._completed_at = None
            self._events = []
            self._notes = {}

    def mark_app_completed(self) -> None:
        """Mark App Completed."""
        with self._lock:
            self._completed_at = time.time()

    def record_event(
        self,
        name: str,
        started_at: float,
        *,
        detail: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> StartupEvent:
        """Record Event."""
        completed_at = time.time()
        event = StartupEvent(
            name=name,
            started_at=started_at,
            completed_at=completed_at,
            duration_seconds=completed_at - started_at,
            detail=detail,
            metadata=metadata or {},
        )
        with self._lock:
            self._events.append(event)
        return event

    def add_note(self, key: str, value: Any) -> None:
        """Add Note."""
        with self._lock:
            self._notes[key] = value

    def to_dict(self) -> dict[str, Any]:
        """To Dict."""
        with self._lock:
            return {
                "started_at": _ts(self._started_at),
                "completed_at": _ts(self._completed_at),
                "duration_seconds": (
                    (self._completed_at - self._started_at)
                    if self._started_at and self._completed_at
                    else None
                ),
                "events": [event.to_dict() for event in self._events],
                "notes": dict(self._notes),
            }


startup_metrics = StartupMetrics()
