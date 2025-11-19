"""Async task scheduler for periodic RSS refresh."""

import asyncio
from datetime import datetime, timezone

from app.core.logging import get_logger

logger = get_logger("scheduler")


async def periodic_rss_refresh(interval_seconds: int = 600) -> None:
    """
    Periodic task that refreshes RSS cache every N seconds.

    This runs as a background asyncio.Task in the main event loop.
    """
    from app.services.rss_ingestion import refresh_news_cache_async

    logger.info("Starting periodic RSS refresh (interval: %ds)", interval_seconds)

    while True:
        try:
            await asyncio.sleep(interval_seconds)
            logger.info("🔄 Starting scheduled RSS refresh at %s", datetime.now(timezone.utc))
            await refresh_news_cache_async()
        except asyncio.CancelledError:
            logger.info("Periodic refresh cancelled")
            break
        except Exception as e:
            logger.error("Scheduled refresh failed: %s", e, exc_info=True)
