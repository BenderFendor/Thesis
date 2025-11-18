from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional


def _ts(timestamp: float | None) -> Optional[str]:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


@dataclass
class StartupEvent:
    name: str
    started_at: float
    completed_at: float
    duration_seconds: float
    detail: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["started_at"] = _ts(self.started_at)
        payload["completed_at"] = _ts(self.completed_at)
        return payload


class StartupMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._started_at: float | None = None
        self._completed_at: float | None = None
        self._events: List[StartupEvent] = []
        self._notes: Dict[str, Any] = {}

    def mark_app_started(self) -> None:
        with self._lock:
            self._started_at = time.time()
            self._completed_at = None
            self._events = []
            self._notes = {}

    def mark_app_completed(self) -> None:
        with self._lock:
            self._completed_at = time.time()

    def record_event(
        self,
        name: str,
        started_at: float,
        *,
        detail: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> StartupEvent:
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
        with self._lock:
            self._notes[key] = value

    def to_dict(self) -> Dict[str, Any]:
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
