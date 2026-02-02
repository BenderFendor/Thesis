"""Fix stale last_seen timestamps on existing TopicCluster records."""

import asyncio
import sys

sys.path.insert(0, "/home/bender/classwork/Thesis/backend")

from sqlalchemy import select, update
from app.database import AsyncSessionLocal, TopicCluster, get_utc_now
from app.core.logging import get_logger

logger = get_logger("fix_cluster_timestamps")


async def fix_cluster_timestamps():
    """Update all active clusters to have current last_seen timestamp."""
    async with AsyncSessionLocal() as session:
        # Count clusters that need updating
        result = await session.execute(
            select(TopicCluster).where(TopicCluster.is_active == True)
        )
        clusters = result.scalars().all()

        logger.info(f"Found {len(clusters)} active clusters to update")

        if not clusters:
            logger.info("No active clusters found")
            return

        # Update all clusters to have current timestamp
        now = get_utc_now()
        await session.execute(
            update(TopicCluster)
            .where(TopicCluster.is_active == True)
            .values(last_seen=now)
        )
        await session.commit()

        logger.info(f"Updated {len(clusters)} clusters with last_seen={now}")
        print(f"✓ Successfully updated {len(clusters)} cluster timestamps")


if __name__ == "__main__":
    asyncio.run(fix_cluster_timestamps())
