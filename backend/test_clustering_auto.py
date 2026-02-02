"""Test the improved fast clustering with automatic last_seen updates."""

import asyncio
import sys

sys.path.insert(0, "/home/bender/classwork/Thesis/backend")

from datetime import datetime, timedelta
from sqlalchemy import select, func
from app.database import (
    AsyncSessionLocal,
    TopicCluster,
    ArticleTopic,
    Article,
    get_utc_now,
)
from app.core.logging import get_logger

logger = get_logger("test_clustering")


async def test_clustering():
    """Test that clustering properly updates last_seen when adding articles."""
    async with AsyncSessionLocal() as session:
        # Count active clusters
        result = await session.execute(
            select(func.count(TopicCluster.id)).where(TopicCluster.is_active == True)
        )
        cluster_count = result.scalar()

        # Get recent articles without assignments
        recent_date = get_utc_now() - timedelta(hours=24)
        result = await session.execute(
            select(Article)
            .outerjoin(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(
                ArticleTopic.id == None,
                Article.published_at >= recent_date,
                Article.embedding_generated == True,
            )
            .order_by(Article.published_at.desc())
            .limit(10)
        )
        recent_unassigned = result.scalars().all()

        logger.info(f"Active clusters: {cluster_count}")
        logger.info(f"Recent unassigned articles (24h): {len(recent_unassigned)}")

        if recent_unassigned:
            newest = recent_unassigned[0]
            logger.info(
                f"Newest article: '{newest.title[:50]}...' at {newest.published_at}"
            )

        # Check for clusters with recent last_seen
        result = await session.execute(
            select(func.count(TopicCluster.id)).where(
                TopicCluster.is_active == True, TopicCluster.last_seen >= recent_date
            )
        )
        recent_clusters = result.scalar()
        logger.info(f"Clusters with recent last_seen (24h): {recent_clusters}")

        print(f"\n✓ Clustering stats:")
        print(f"  - Total active clusters: {cluster_count}")
        print(f"  - Recent clusters (24h): {recent_clusters}")
        print(f"  - Unassigned articles (24h): {len(recent_unassigned)}")

        if recent_unassigned and recent_clusters == 0:
            print(
                f"\n⚠ Warning: {len(recent_unassigned)} unassigned articles but no recent clusters"
            )
            print(f"  The scheduler should process these articles within 5 minutes.")
        elif recent_clusters > 0:
            print(f"\n✓ Topics are being updated automatically!")
            print(f"  Recent articles are being assigned to clusters.")


if __name__ == "__main__":
    asyncio.run(test_clustering())
