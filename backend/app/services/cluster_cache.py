"""Read/write pre-computed topic cluster snapshots from Postgres.

The API layer reads exclusively from these snapshots.  ChromaDB is never
queried at request time — only the background computation worker touches it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import TopicClusterSnapshot, get_utc_now

logger = get_logger("cluster_cache")

# Keep this many snapshots per window; older ones are pruned on each write.
SNAPSHOT_KEEP_COUNT = 5

VALID_WINDOWS = ("1d", "1w", "1m")


async def get_latest_snapshot(
    session: AsyncSession, window: str
) -> Optional[TopicClusterSnapshot]:
    """Return the most recently computed snapshot for the given window, or None."""
    result = await session.execute(
        select(TopicClusterSnapshot)
        .where(TopicClusterSnapshot.window == window)
        .order_by(TopicClusterSnapshot.computed_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def save_snapshot(
    session: AsyncSession,
    window: str,
    clusters: List[Dict[str, Any]],
) -> TopicClusterSnapshot:
    """Persist a new cluster snapshot and prune old ones for this window.

    Writes atomically: insert new row, then delete any rows beyond
    SNAPSHOT_KEEP_COUNT for the same window.
    """
    snapshot = TopicClusterSnapshot(
        window=window,
        clusters_json=clusters,
        cluster_count=len(clusters),
        computed_at=get_utc_now(),
    )
    session.add(snapshot)
    await session.flush()  # Get the new row's id before pruning

    # Find the ids to keep (the N most recent including the one just inserted)
    keep_result = await session.execute(
        select(TopicClusterSnapshot.id)
        .where(TopicClusterSnapshot.window == window)
        .order_by(TopicClusterSnapshot.computed_at.desc())
        .limit(SNAPSHOT_KEEP_COUNT)
    )
    keep_ids = [row[0] for row in keep_result.all()]

    if keep_ids:
        await session.execute(
            delete(TopicClusterSnapshot).where(
                TopicClusterSnapshot.window == window,
                TopicClusterSnapshot.id.notin_(keep_ids),
            )
        )

    await session.commit()
    logger.info("Saved cluster snapshot: window=%s clusters=%d", window, len(clusters))
    return snapshot
