"""
Lightweight updates stream for cache invalidation signals.

This SSE endpoint only sends "invalidate" events when new content is available,
rather than streaming all the article data. Clients should use the pagination
API to fetch actual article data.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger

router = APIRouter(prefix="/updates", tags=["updates"])
logger = get_logger("updates")

# Global update queue for broadcasting invalidation events
_update_subscribers: list[asyncio.Queue] = []
_event_counter = 0


def _remove_subscriber(queue: asyncio.Queue) -> None:
    try:
        _update_subscribers.remove(queue)
    except ValueError:
        return


async def broadcast_update(event_type: str, data: Dict[str, Any] | None = None) -> None:
    """
    Broadcast an update event to all connected subscribers.
    
    Call this from ingestion code when new articles are added to the cache/database.
    """
    global _event_counter
    _event_counter += 1
    
    event = {
        "id": _event_counter,
        "type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **(data or {}),
    }
    
    # Send to all subscribers
    dead_queues: list[asyncio.Queue] = []
    for queue in _update_subscribers:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            dead_queues.append(queue)

    # Clean up dead/full queues
    for queue in dead_queues:
        _remove_subscriber(queue)
    
    logger.debug("Broadcast %s event to %d subscribers", event_type, len(_update_subscribers))


@router.get("/stream")
async def updates_stream() -> StreamingResponse:
    """
    SSE stream for lightweight cache invalidation events.
    
    Events:
    - invalidate: New content available, client should refetch
    - refresh_started: A refresh job has started
    - refresh_complete: A refresh job has completed
    
    This does NOT stream article data. Use /api/news/page for actual content.
    """
    subscriber_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _update_subscribers.append(subscriber_queue)
    
    logger.info("New updates subscriber connected (total: %d)", len(_update_subscribers))
    
    async def event_generator():
        try:
            # Send initial connection event
            yield f"id: 0\nretry: 5000\ndata: {json.dumps({'type': 'connected', 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"
            
            while True:
                try:
                    # Wait for events with timeout for keepalive
                    event = await asyncio.wait_for(subscriber_queue.get(), timeout=30.0)
                    
                    yield f"id: {event['id']}\ndata: {json.dumps(event)}\n\n"
                    
                except asyncio.TimeoutError:
                    # Send keepalive comment to maintain connection
                    yield ": keepalive\n\n"
                    
        except asyncio.CancelledError:
            logger.info("Updates subscriber disconnected")
            raise
        finally:
            # Remove from subscribers
            _remove_subscriber(subscriber_queue)
            logger.info("Updates subscriber cleanup (remaining: %d)", len(_update_subscribers))
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@router.get("/status")
async def get_updates_status() -> Dict[str, Any]:
    """Get current updates stream status."""
    return {
        "active_subscribers": len(_update_subscribers),
        "total_events_sent": _event_counter,
    }
