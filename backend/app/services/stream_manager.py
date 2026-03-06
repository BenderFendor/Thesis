import threading
import time
from datetime import datetime, timezone
from typing import Dict, Tuple

from app.core.logging import get_logger

logger = get_logger("stream_manager")


class StreamManager:
    def __init__(self) -> None:
        self.active_streams: Dict[str, Dict[str, object]] = {}
        self.source_last_accessed: Dict[str, float] = {}
        self.stream_counter = 0
        self.lock = threading.Lock()

    def _assert_invariants(self) -> None:
        assert self.stream_counter >= 0, "stream_counter must be non-negative"
        assert isinstance(self.active_streams, dict), "active_streams must be dict"
        assert isinstance(self.source_last_accessed, dict), (
            "source_last_accessed must be dict"
        )

    def register_stream(self, stream_id: str) -> Dict[str, object]:
        assert stream_id, "stream_id is required"
        with self.lock:
            self._assert_invariants()
            stream_info = {
                "id": stream_id,
                "start_time": datetime.now(timezone.utc),
                "status": "starting",
                "sources_completed": 0,
                "total_sources": 0,
                "client_connected": True,
            }
            self.active_streams[stream_id] = stream_info
            self.stream_counter += 1
            logger.info(
                "Stream %s registered. Active streams: %s",
                stream_id,
                len(self.active_streams),
            )
            self._assert_invariants()
            return stream_info

    def update_stream(self, stream_id: str, **updates) -> None:
        assert stream_id, "stream_id is required"
        with self.lock:
            if stream_id in self.active_streams:
                self.active_streams[stream_id].update(updates)
                logger.debug("Stream %s updated: %s", stream_id, updates)
                self._assert_invariants()

    def unregister_stream(self, stream_id: str) -> None:
        assert stream_id, "stream_id is required"
        with self.lock:
            if stream_id in self.active_streams:
                stream_info = self.active_streams.pop(stream_id)
                duration = (
                    datetime.now(timezone.utc) - stream_info["start_time"]
                ).total_seconds()
                logger.info(
                    "Stream %s completed in %.2fs. Active streams: %s",
                    stream_id,
                    duration,
                    len(self.active_streams),
                )
                self._assert_invariants()

    def get_active_stream_count(self) -> int:
        with self.lock:
            return len(self.active_streams)

    def should_throttle_source(
        self, source_name: str, min_interval: int = 10
    ) -> Tuple[bool, float]:
        assert source_name, "source_name is required"
        assert min_interval > 0, "min_interval must be positive"
        with self.lock:
            self._assert_invariants()
            now = time.time()
            last_access = self.source_last_accessed.get(source_name, 0)
            elapsed = now - last_access
            if elapsed < min_interval:
                return True, min_interval - elapsed
            self.source_last_accessed[source_name] = now
            return False, 0.0


stream_manager = StreamManager()
