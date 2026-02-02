"""Re-cluster articles from the last week using improved clustering logic.

This script:
1. Deletes existing cluster assignments from articles in the last 7 days
2. Re-runs fast batch clustering on those articles
3. Uses the new similarity threshold (0.82) and proper cosine similarity
"""

import asyncio
import sys

sys.path.insert(0, "/home/bender/classwork/Thesis/backend")

from datetime import datetime, timedelta
from sqlalchemy import select, delete, update, func
from app.database import (
    AsyncSessionLocal,
    Article,
    ArticleTopic,
    TopicCluster,
    get_utc_now,
)
from app.core.logging import get_logger
from app.services.fast_clustering import FastClusteringService

logger = get_logger("recluster_last_week")


async def recluster_last_week():
    """Re-cluster articles from the last 7 days."""
    async with AsyncSessionLocal() as session:
        # Calculate date 7 days ago
        week_ago = get_utc_now() - timedelta(days=7)

        logger.info(f"Starting re-clustering for articles since {week_ago}")

        # Find articles from last week that have cluster assignments
        result = await session.execute(
            select(Article.id)
            .join(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(Article.published_at >= week_ago)
            .distinct()
        )
        article_ids = [row[0] for row in result.all()]

        if not article_ids:
            logger.info("No articles found with cluster assignments in the last week")
            return

        logger.info(
            f"Found {len(article_ids)} articles with existing cluster assignments"
        )

        # Get affected cluster IDs before deleting
        result = await session.execute(
            select(ArticleTopic.cluster_id)
            .where(ArticleTopic.article_id.in_(article_ids))
            .distinct()
        )
        affected_cluster_ids = [row[0] for row in result.all()]
        logger.info(f"Affected clusters: {len(affected_cluster_ids)}")

        # Delete existing ArticleTopic assignments for these articles
        await session.execute(
            delete(ArticleTopic).where(ArticleTopic.article_id.in_(article_ids))
        )
        logger.info(
            f"Deleted existing cluster assignments for {len(article_ids)} articles"
        )

        # Update cluster counts and deactivate clusters that will have <2 articles
        if affected_cluster_ids:
            remaining_counts = await session.execute(
                select(ArticleTopic.cluster_id, func.count(ArticleTopic.id))
                .where(ArticleTopic.cluster_id.in_(affected_cluster_ids))
                .group_by(ArticleTopic.cluster_id)
            )
            remaining_map = {row[0]: row[1] for row in remaining_counts.all()}

            for cluster_id in affected_cluster_ids:
                remaining = remaining_map.get(cluster_id, 0)

                if remaining < 2:
                    # Deactivate cluster if it has less than 2 articles
                    await session.execute(
                        update(TopicCluster)
                        .where(TopicCluster.id == cluster_id)
                        .values(is_active=False, article_count=remaining)
                    )
                    logger.info(
                        f"Deactivated cluster {cluster_id} (only {remaining} articles remaining)"
                    )
                else:
                    # Update article count
                    await session.execute(
                        update(TopicCluster)
                        .where(TopicCluster.id == cluster_id)
                        .values(article_count=remaining)
                    )

        await session.commit()
        logger.info("Cleanup complete, starting re-clustering...")

        # Now re-cluster the articles
        service = FastClusteringService()
        total_assigned = 0
        batch_size = 500

        # Process in batches
        for i in range(0, len(article_ids), batch_size):
            batch_ids = article_ids[i : i + batch_size]
            logger.info(
                f"Processing batch {i // batch_size + 1} ({len(batch_ids)} articles)"
            )

            # Get articles in this batch
            result = await session.execute(
                select(Article).where(Article.id.in_(batch_ids))
            )
            batch_articles = result.scalars().all()

            # Reset their cluster assignments flag
            for article in batch_articles:
                # Mark as unassigned by removing any ArticleTopic entries
                # (already done above, but ensure clean state)
                pass

            await session.commit()

            # Run clustering on this batch
            assigned = await service.process_unassigned_batch(
                session, limit=len(batch_ids)
            )
            total_assigned += assigned
            await session.commit()

            logger.info(f"Batch complete: {assigned} articles assigned to clusters")

        logger.info(
            f"Re-clustering complete! Total articles assigned: {total_assigned}"
        )
        print(
            f"\n✓ Successfully re-clustered {total_assigned} articles from the last week"
        )
        print(f"  - Old threshold: 0.75 → New threshold: 0.82")
        print(f"  - Fixed cosine similarity calculation")
        print(f"  - Eliminated chain grouping issues")
        print(f"  - Stored actual similarity values (not hardcoded)")


if __name__ == "__main__":
    asyncio.run(recluster_last_week())
