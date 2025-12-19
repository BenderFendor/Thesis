"""Metrics collection for RSS ingestion pipeline."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict


@dataclass
class PipelineMetrics:
    """Metrics for RSS ingestion pipeline."""

    fetch_count: int = 0
    fetch_errors: int = 0
    fetch_not_modified: int = 0
    parse_count: int = 0
    parse_errors: int = 0
    persist_count: int = 0
    persist_errors: int = 0

    start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    end_time: datetime | None = None

    queue_sizes: Dict[str, int] = field(default_factory=dict)

    def duration_seconds(self) -> float:
        """Calculate total pipeline duration."""
        if self.end_time is None:
            return (datetime.now(timezone.utc) - self.start_time).total_seconds()
        return (self.end_time - self.start_time).total_seconds()

    def to_dict(self) -> Dict:
        """Convert to dictionary for logging/API."""
        return {
            "fetch": {
                "count": self.fetch_count,
                "errors": self.fetch_errors,
                "not_modified": self.fetch_not_modified,
            },
            "parse": {"count": self.parse_count, "errors": self.parse_errors},
            "persist": {"count": self.persist_count, "errors": self.persist_errors},
            "duration_seconds": self.duration_seconds(),
            "queue_sizes": self.queue_sizes,
        }


# Global metrics instance
_metrics = PipelineMetrics()


def get_metrics() -> PipelineMetrics:
    """Get current pipeline metrics."""
    return _metrics


def reset_metrics() -> None:
    """Reset metrics for new run."""
    global _metrics
    _metrics = PipelineMetrics()
