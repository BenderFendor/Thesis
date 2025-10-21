from __future__ import annotations

import asyncio
import json
import queue
import threading
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.rss_ingestion import refresh_news_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.post("/refresh")
async def manual_cache_refresh() -> Dict[str, str]:
    """Start cache refresh and return immediately (non-blocking)."""
    if news_cache.update_in_progress:
        return {"message": "Cache refresh already in progress", "status": "in_progress"}

    def _refresh() -> None:
        refresh_news_cache()

    threading.Thread(target=_refresh, daemon=True).start()
    return {"message": "Cache refresh started", "status": "started"}


@router.post("/refresh/stream")
async def stream_cache_refresh() -> StreamingResponse:
    """Stream cache refresh progress as articles are ingested."""
    if news_cache.update_in_progress:

        async def already_running():
            yield f"data: {json.dumps({'status': 'error', 'message': 'Cache refresh already in progress'})}\n\n"

        return StreamingResponse(already_running(), media_type="text/event-stream")

    # Create a queue for communication between the refresh thread and the stream
    progress_queue: queue.Queue[Dict[str, Any]] = queue.Queue()
    refresh_complete = threading.Event()

    def progress_callback(
        articles: list[NewsArticle], source_stat: Dict[str, Any]
    ) -> None:
        """Callback called for each source processed."""
        progress_queue.put(
            {
                "type": "source_complete",
                "source": source_stat.get("name"),
                "article_count": len(articles),
                "source_stat": source_stat,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def refresh_thread_func() -> None:
        """Run refresh in background thread with progress callback."""
        try:
            refresh_news_cache(source_progress_callback=progress_callback)
        finally:
            progress_queue.put(
                {"type": "complete", "timestamp": datetime.now().isoformat()}
            )
            refresh_complete.set()

    # Start the refresh in a background thread
    refresh_thread = threading.Thread(target=refresh_thread_func, daemon=True)
    refresh_thread.start()

    async def event_generator():
        """Generate SSE events for cache refresh progress."""
        try:
            # Send initial event
            yield f"data: {json.dumps({'status': 'starting', 'message': 'Starting cache refresh...'})}\n\n"

            processed_sources = 0
            failed_sources = 0

            # Stream progress events as they come in
            while not refresh_complete.is_set() or not progress_queue.empty():
                try:
                    event = progress_queue.get(timeout=1)

                    if event["type"] == "source_complete":
                        processed_sources += 1
                        source_stat = event["source_stat"]

                        # Count failures
                        if source_stat.get("status") == "error":
                            failed_sources += 1

                        progress_event = {
                            "status": "source_complete",
                            "source": event["source"],
                            "articles_from_source": event["article_count"],
                            "total_sources_processed": processed_sources,
                            "failed_sources": failed_sources,
                            "source_stat": source_stat,
                            "timestamp": event["timestamp"],
                        }
                        yield f"data: {json.dumps(progress_event)}\n\n"

                    elif event["type"] == "complete":
                        # Send final completion event with summary
                        articles = news_cache.get_articles()
                        source_stats = news_cache.get_source_stats()

                        complete_event = {
                            "status": "complete",
                            "message": f"Cache refresh completed: {len(articles)} total articles",
                            "total_articles": len(articles),
                            "total_sources_processed": len(source_stats),
                            "successful_sources": len(
                                [
                                    s
                                    for s in source_stats
                                    if s.get("status") == "success"
                                ]
                            ),
                            "failed_sources": len(
                                [s for s in source_stats if s.get("status") == "error"]
                            ),
                            "warning_sources": len(
                                [
                                    s
                                    for s in source_stats
                                    if s.get("status") == "warning"
                                ]
                            ),
                            "timestamp": event["timestamp"],
                        }
                        yield f"data: {json.dumps(complete_event)}\n\n"

                except queue.Empty:
                    # Timeout waiting for event - check if complete
                    if refresh_complete.is_set() and progress_queue.empty():
                        break
                    # Otherwise continue waiting
                    await asyncio.sleep(0.1)

        except Exception as e:
            error_event = {
                "status": "error",
                "message": f"Error during cache refresh: {str(e)}",
                "timestamp": datetime.now().isoformat(),
            }
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/status")
async def get_cache_status() -> Dict[str, object]:
    articles = news_cache.get_articles()
    source_stats = news_cache.get_source_stats()

    total_articles = len(articles)
    sources_with_articles = len(
        [s for s in source_stats if s.get("article_count", 0) > 0]
    )
    sources_with_errors = len([s for s in source_stats if s.get("status") == "error"])
    sources_with_warnings = len(
        [s for s in source_stats if s.get("status") == "warning"]
    )

    category_counts = defaultdict(int)
    for article in articles:
        category_counts[article.category] += 1

    cache_age = (datetime.now() - news_cache.last_updated).total_seconds()

    return {
        "last_updated": news_cache.last_updated.isoformat(),
        "update_in_progress": news_cache.update_in_progress,
        "total_articles": total_articles,
        "total_sources": len(source_stats),
        "sources_working": sources_with_articles,
        "sources_with_errors": sources_with_errors,
        "sources_with_warnings": sources_with_warnings,
        "category_breakdown": dict(category_counts),
        "cache_age_seconds": cache_age,
    }
