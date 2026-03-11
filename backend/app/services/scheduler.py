"""Async task scheduler for periodic RSS refresh."""

import asyncio
from datetime import datetime, timezone

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.services.cache import news_cache

logger = get_logger("scheduler")


def _parse_next_check_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _get_due_rss_sources() -> tuple[list[str], float | None]:
    configured_sources = get_rss_sources()
    stats_map = {}
    for stat in news_cache.get_source_stats():
        stat_name = stat.get("name")
        if isinstance(stat_name, str) and stat_name:
            stats_map[stat_name] = stat

    now = datetime.now(timezone.utc)
    due_sources: list[str] = []
    next_wait_seconds: float | None = None

    for source_name in configured_sources:
        stat = stats_map.get(source_name)
        next_check_at = _parse_next_check_at(
            stat.get("next_check_at") if stat else None
        )
        if next_check_at is None:
            due_sources.append(source_name)
            continue

        seconds_until_due = (next_check_at - now).total_seconds()
        if seconds_until_due <= 0:
            due_sources.append(source_name)
            continue

        if next_wait_seconds is None or seconds_until_due < next_wait_seconds:
            next_wait_seconds = seconds_until_due

    return due_sources, next_wait_seconds


async def periodic_rss_refresh(interval_seconds: int = 600) -> None:
    """
    Periodic task that refreshes RSS cache every N seconds.

    This runs as a background asyncio.Task in the main event loop.
    """
    from app.services.rss_ingestion import refresh_news_cache_async

    min_sleep_seconds = 30
    logger.info(
        "Starting periodic RSS refresh scheduler (base interval: %ds)", interval_seconds
    )

    await asyncio.sleep(interval_seconds)

    while True:
        try:
            due_sources, next_wait_seconds = _get_due_rss_sources()
            if not due_sources:
                sleep_seconds = interval_seconds
                if next_wait_seconds is not None:
                    sleep_seconds = max(
                        min_sleep_seconds,
                        min(interval_seconds, int(next_wait_seconds) + 1),
                    )
                await asyncio.sleep(sleep_seconds)
                continue

            logger.info(
                "Starting scheduled RSS refresh for %d sources at %s",
                len(due_sources),
                datetime.now(timezone.utc),
            )
            await refresh_news_cache_async(source_names=due_sources)
        except asyncio.CancelledError:
            logger.info("Periodic refresh cancelled")
            break
        except Exception as e:
            logger.error("Scheduled refresh failed: %s", e, exc_info=True)
            await asyncio.sleep(min_sleep_seconds)


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

            async with AsyncSessionLocal() as session:
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
