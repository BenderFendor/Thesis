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
            logger.info(
                "Starting scheduled RSS refresh at %s", datetime.now(timezone.utc)
            )
            await refresh_news_cache_async()
        except asyncio.CancelledError:
            logger.info("Periodic refresh cancelled")
            break
        except Exception as e:
            logger.error("Scheduled refresh failed: %s", e, exc_info=True)


async def periodic_blind_spots_update(interval_seconds: int = 86400) -> None:
    """
    Periodic task that updates source coverage stats for blind spots analysis.

    Runs every 24 hours by default to:
    1. Update daily coverage statistics per source
    2. Identify new blind spots (topics sources are missing)
    """
    from app.database import AsyncSessionLocal
    from app.services.blind_spots import get_blind_spots_analyzer
    from app.core.config import settings

    logger.info(
        "Starting periodic blind spots update (interval: %ds)", interval_seconds
    )

    await asyncio.sleep(300)  # Start after 5 minutes

    while True:
        try:
            await asyncio.sleep(interval_seconds)

            if not settings.enable_database or AsyncSessionLocal is None:
                continue

            logger.info(
                "Starting blind spots analysis at %s", datetime.now(timezone.utc)
            )

            async with AsyncSessionLocal() as session:  # type: ignore[misc]
                analyzer = get_blind_spots_analyzer()

                # Update daily coverage stats
                updated = await analyzer.update_daily_coverage_stats(session)

                # Generate report for logging
                report = await analyzer.generate_source_coverage_report(session, days=7)

                logger.info(
                    "Blind spots analysis complete: sources_updated=%d, "
                    "total_sources=%d, systemic_blind_spots=%d",
                    updated,
                    report.get("total_sources", 0),
                    len(report.get("systemic_blind_spots", [])),
                )

        except asyncio.CancelledError:
            logger.info("Periodic blind spots update cancelled")
            break
        except Exception as e:
            logger.error("Blind spots update failed: %s", e, exc_info=True)
