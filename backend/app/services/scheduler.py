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


async def periodic_cluster_update(interval_seconds: int = 300) -> None:
    """
    Periodic task that updates topic clusters and stats.

    Runs every 5 minutes by default to:
    1. Assign new articles to clusters
    2. Update cluster statistics (daily/hourly)
    """
    from app.database import AsyncSessionLocal
    from app.services.clustering import (
        process_unassigned_articles,
        ClusteringService,
    )
    from app.core.config import settings

    logger.info("Starting periodic cluster update (interval: %ds)", interval_seconds)

    await asyncio.sleep(30)

    while True:
        try:
            await asyncio.sleep(interval_seconds)

            if not settings.enable_database or AsyncSessionLocal is None:
                continue

            if not settings.enable_vector_store:
                continue

            logger.info("Starting cluster update at %s", datetime.now(timezone.utc))

            async with AsyncSessionLocal() as session:
                # Use fast batch clustering instead of slow one-by-one processing
                from app.services.fast_clustering import (
                    fast_process_unassigned_articles,
                )

                assigned = await fast_process_unassigned_articles(session, limit=500)
                await session.commit()

                service = ClusteringService()
                stats = await service.update_cluster_stats(session)
                await session.commit()

                logger.info(
                    "Cluster update complete: assigned=%d, daily_updated=%d, hourly_updated=%d",
                    assigned,
                    stats.get("daily_updated", 0),
                    stats.get("hourly_updated", 0),
                )

        except asyncio.CancelledError:
            logger.info("Periodic cluster update cancelled")
            break
        except Exception as e:
            logger.error("Cluster update failed: %s", e, exc_info=True)


async def periodic_cluster_merge(interval_seconds: int = 1800) -> None:
    """
    Periodic task that merges similar topic clusters.

    Runs every 30 minutes by default to deduplicate clusters
    covering the same story from different angles.
    """
    from app.database import AsyncSessionLocal
    from app.services.clustering import merge_similar_clusters
    from app.core.config import settings

    logger.info("Starting periodic cluster merge (interval: %ds)", interval_seconds)

    await asyncio.sleep(120)

    while True:
        try:
            await asyncio.sleep(interval_seconds)

            if not settings.enable_database or AsyncSessionLocal is None:
                continue

            if not settings.enable_vector_store:
                continue

            logger.info("Starting cluster merge at %s", datetime.now(timezone.utc))

            async with AsyncSessionLocal() as session:
                merged = await merge_similar_clusters(
                    session, similarity_threshold=0.80
                )
                logger.info("Cluster merge complete: merged=%d clusters", merged)

        except asyncio.CancelledError:
            logger.info("Periodic cluster merge cancelled")
            break
        except Exception as e:
            logger.error("Cluster merge failed: %s", e, exc_info=True)


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
