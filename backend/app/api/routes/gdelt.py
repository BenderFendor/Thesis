"""GDELT integration API endpoints.

Provides endpoints for syncing GDELT events and retrieving GDELT-related data.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.database import get_db, GDELTEvent, TopicCluster
from app.services.gdelt_integration import sync_gdelt_to_clusters, get_gdelt_integration

router = APIRouter(prefix="/gdelt", tags=["gdelt"])


@router.post("/sync")
async def trigger_gdelt_sync(
    minutes: int = Query(15, description="Minutes back to fetch", ge=1, le=60),
    limit: int = Query(250, description="Maximum events to process", ge=1, le=1000),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Trigger a manual sync of GDELT events to clusters.

    Args:
        minutes: How far back to fetch events
        limit: Maximum number of events to process

    Returns:
        Sync results with matched/total counts
    """
    try:
        matched, total = await sync_gdelt_to_clusters(
            session, minutes=minutes, limit=limit
        )

        return {
            "success": True,
            "matched": matched,
            "total": total,
            "window_minutes": minutes,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GDELT sync failed: {str(e)}")


@router.get("/cluster/{cluster_id}")
async def get_cluster_gdelt_events(
    cluster_id: int,
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Get GDELT events matched to a specific cluster.

    Args:
        cluster_id: Cluster ID to query
        limit: Maximum events to return

    Returns:
        Cluster info with matched GDELT events
    """
    # Get cluster info
    cluster_result = await session.execute(
        select(TopicCluster).where(TopicCluster.id == cluster_id)
    )
    cluster = cluster_result.scalar_one_or_none()

    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # Get GDELT events for this cluster
    events_result = await session.execute(
        select(GDELTEvent)
        .where(GDELTEvent.cluster_id == cluster_id)
        .order_by(GDELTEvent.published_at.desc())
        .limit(limit)
    )
    events = events_result.scalars().all()

    # Count total
    count_result = await session.execute(
        select(func.count(GDELTEvent.id)).where(GDELTEvent.cluster_id == cluster_id)
    )
    total_count = count_result.scalar_one()

    return {
        "cluster_id": cluster_id,
        "cluster_label": cluster.label,
        "total_external_events": total_count,
        "events": [
            {
                "id": e.id,
                "gdelt_id": e.gdelt_id,
                "url": e.url,
                "title": e.title,
                "source": e.source,
                "published_at": e.published_at.isoformat() if e.published_at else None,
                "event_code": e.event_code,
                "event_root_code": e.event_root_code,
                "actor1_name": e.actor1_name,
                "actor2_name": e.actor2_name,
                "tone": e.tone,
                "goldstein_scale": e.goldstein_scale,
                "match_method": e.match_method,
                "similarity_score": e.similarity_score,
                "matched_at": e.matched_at.isoformat() if e.matched_at else None,
            }
            for e in events
        ],
    }


@router.get("/stats")
async def get_gdelt_stats(
    hours: int = Query(24, ge=1, le=168),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Get GDELT coverage statistics.

    Args:
        hours: Time window in hours

    Returns:
        Statistics about GDELT coverage
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Total events in window
    total_result = await session.execute(
        select(func.count(GDELTEvent.id)).where(GDELTEvent.created_at >= since)
    )
    total_events = total_result.scalar_one()

    # Matched events
    matched_result = await session.execute(
        select(func.count(GDELTEvent.id)).where(
            GDELTEvent.created_at >= since, GDELTEvent.cluster_id.isnot(None)
        )
    )
    matched_events = matched_result.scalar_one()

    # Match method breakdown
    url_matched_result = await session.execute(
        select(func.count(GDELTEvent.id)).where(
            GDELTEvent.created_at >= since, GDELTEvent.match_method == "url"
        )
    )
    url_matched = url_matched_result.scalar_one()

    embedding_matched_result = await session.execute(
        select(func.count(GDELTEvent.id)).where(
            GDELTEvent.created_at >= since, GDELTEvent.match_method == "embedding"
        )
    )
    embedding_matched = embedding_matched_result.scalar_one()

    # Top clusters by GDELT coverage
    top_clusters_result = await session.execute(
        select(
            TopicCluster.id,
            TopicCluster.label,
            func.count(GDELTEvent.id).label("event_count"),
        )
        .join(GDELTEvent, GDELTEvent.cluster_id == TopicCluster.id)
        .where(GDELTEvent.created_at >= since)
        .group_by(TopicCluster.id)
        .order_by(func.count(GDELTEvent.id).desc())
        .limit(10)
    )
    top_clusters = [
        {"cluster_id": row[0], "cluster_label": row[1], "gdelt_event_count": row[2]}
        for row in top_clusters_result.all()
    ]

    return {
        "window_hours": hours,
        "total_events": total_events,
        "matched_events": matched_events,
        "match_rate": round(matched_events / total_events * 100, 2)
        if total_events > 0
        else 0,
        "match_breakdown": {
            "url_match": url_matched,
            "embedding_match": embedding_matched,
        },
        "top_clusters_by_coverage": top_clusters,
    }


@router.get("/recent")
async def get_recent_gdelt_events(
    limit: int = Query(50, ge=1, le=200),
    include_unmatched: bool = Query(
        False, description="Include events not matched to clusters"
    ),
    session: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Get recently fetched GDELT events.

    Args:
        limit: Maximum events to return
        include_unmatched: Whether to include events without cluster matches

    Returns:
        List of GDELT events
    """
    query = select(GDELTEvent).order_by(GDELTEvent.created_at.desc())

    if not include_unmatched:
        query = query.where(GDELTEvent.cluster_id.isnot(None))

    result = await session.execute(query.limit(limit))
    events = result.scalars().all()

    return [
        {
            "id": e.id,
            "gdelt_id": e.gdelt_id,
            "url": e.url,
            "title": e.title,
            "source": e.source,
            "published_at": e.published_at.isoformat() if e.published_at else None,
            "event_code": e.event_code,
            "tone": e.tone,
            "cluster_id": e.cluster_id,
            "match_method": e.match_method,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]
