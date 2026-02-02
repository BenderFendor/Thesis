"""API routes for trending and breaking news detection."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import get_db, TopicCluster
from app.services.clustering import ClusteringService

logger = get_logger("trending_routes")
router = APIRouter(prefix="/trending", tags=["trending"])


class TrendingCluster(BaseModel):
    cluster_id: int
    label: Optional[str]
    keywords: List[str]
    article_count: int
    window_count: int
    source_diversity: int
    trending_score: float
    velocity: float
    representative_article: Optional[Dict[str, Any]]
    articles: List[Dict[str, Any]] = []  # Latest articles in this cluster


class BreakingCluster(BaseModel):
    cluster_id: int
    label: Optional[str]
    keywords: List[str]
    article_count_3h: int
    source_count_3h: int
    spike_magnitude: float
    is_new_story: bool
    representative_article: Optional[Dict[str, Any]]
    articles: List[Dict[str, Any]] = []  # Latest articles in this cluster


class TrendingResponse(BaseModel):
    window: str
    clusters: List[TrendingCluster]
    total: int


class BreakingResponse(BaseModel):
    window_hours: int
    clusters: List[BreakingCluster]
    total: int


class ClusterDetailResponse(BaseModel):
    id: int
    label: Optional[str]
    keywords: List[str]
    article_count: int
    first_seen: Optional[str]
    last_seen: Optional[str]
    is_active: bool
    articles: List[Dict[str, Any]]


class AllCluster(BaseModel):
    """Cluster for topic-based view (without trending metrics)."""

    cluster_id: int
    label: Optional[str]
    keywords: List[str]
    article_count: int
    window_count: int
    source_diversity: int
    representative_article: Optional[Dict[str, Any]]
    articles: List[Dict[str, Any]] = []  # Latest articles in this cluster


class AllClustersResponse(BaseModel):
    window: str
    clusters: List[AllCluster]
    total: int


@router.get("", response_model=TrendingResponse)
async def get_trending(
    response: Response,
    window: str = Query(default="1d", pattern="^(1d|1w|1m)$"),
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> TrendingResponse:
    """
    Get trending topic clusters based on velocity and diversity.

    Window options:
    - 1d: Last 24 hours
    - 1w: Last 7 days
    - 1m: Last 30 days

    Scoring factors:
    - Velocity: Article count vs trailing baseline
    - Source diversity: Number of distinct sources covering the topic
    - Recency: Bonus for newly emerging stories
    """
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=120"

    service = ClusteringService()
    if not service.vector_store:
        return TrendingResponse(window=window, clusters=[], total=0)

    clusters = await service.get_trending_clusters(db, window=window, limit=limit)

    return TrendingResponse(
        window=window,
        clusters=[TrendingCluster(**c) for c in clusters],
        total=len(clusters),
    )


@router.get("/breaking", response_model=BreakingResponse)
async def get_breaking(
    response: Response,
    limit: int = Query(default=5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> BreakingResponse:
    """
    Get breaking news clusters showing unusual activity spikes.

    Breaking detection:
    - 3-hour window comparison against 7-day hourly baseline
    - Spike threshold: 2x baseline volume
    - Prioritizes new stories (first seen < 6 hours ago)

    Returns clusters ordered by spike magnitude.
    """
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"

    service = ClusteringService()
    if not service.vector_store:
        return BreakingResponse(window_hours=3, clusters=[], total=0)

    clusters = await service.get_breaking_clusters(db, limit=limit)

    return BreakingResponse(
        window_hours=3,
        clusters=[BreakingCluster(**c) for c in clusters],
        total=len(clusters),
    )


@router.get("/clusters", response_model=AllClustersResponse)
async def get_all_clusters(
    response: Response,
    window: str = Query(default="1d", pattern="^(1d|1w|1m)$"),
    min_articles: int = Query(default=2, ge=1, le=10),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> AllClustersResponse:
    """
    Get all active topic clusters within a time window for topic-based view.

    Window options:
    - 1d: Last 24 hours
    - 1w: Last 7 days
    - 1m: Last 30 days

    Parameters:
    - min_articles: Minimum articles per cluster (excludes single-article clusters)
    - limit: Maximum clusters to return (pagination support)

    Returns clusters ordered by recency (most recently seen first).
    """
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=120"

    service = ClusteringService()
    if not service.vector_store:
        return AllClustersResponse(window=window, clusters=[], total=0)

    clusters = await service.get_all_clusters(
        db, window=window, min_articles=min_articles, limit=limit
    )

    return AllClustersResponse(
        window=window,
        clusters=[AllCluster(**c) for c in clusters],
        total=len(clusters),
    )


@router.get("/clusters/{cluster_id}", response_model=ClusterDetailResponse)
async def get_cluster_detail(
    cluster_id: int,
    db: AsyncSession = Depends(get_db),
) -> ClusterDetailResponse:
    """
    Get detailed information about a specific topic cluster.

    Returns:
    - Cluster metadata (label, keywords, timestamps)
    - List of member articles ordered by relevance and recency
    """
    service = ClusteringService()
    detail = await service.get_cluster_detail(db, cluster_id)

    if not detail:
        raise HTTPException(status_code=404, detail="Cluster not found")

    return ClusterDetailResponse(**detail)


@router.get("/stats")
async def get_trending_stats(
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get overall trending system statistics.

    Useful for debugging and monitoring cluster health.
    """
    from sqlalchemy import select, func
    from app.database import TopicCluster, ArticleTopic, ClusterStatsHourly

    active_clusters = await db.execute(
        select(func.count(TopicCluster.id)).where(TopicCluster.is_active == True)
    )
    active_count = active_clusters.scalar() or 0

    total_assignments = await db.execute(select(func.count(ArticleTopic.id)))
    assignment_count = total_assignments.scalar() or 0

    recent_spikes = await db.execute(
        select(func.count(ClusterStatsHourly.id)).where(
            ClusterStatsHourly.is_spike == True
        )
    )
    spike_count = recent_spikes.scalar() or 0

    return {
        "active_clusters": active_count,
        "total_article_assignments": assignment_count,
        "recent_spikes": spike_count,
        "similarity_threshold": 0.75,
        "baseline_days": 7,
        "breaking_window_hours": 3,
    }


@router.post("/backfill")
async def backfill_clusters(
    limit: int = Query(default=500, ge=10, le=2000),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Backfill article clusters and update stats.

    Run this to populate trending/breaking data when:
    - Clusters are empty after initial setup
    - Articles were ingested without clustering enabled
    - Vector store was unavailable during ingestion
    """
    from app.services.clustering import process_unassigned_articles

    service = ClusteringService()
    if not service.vector_store:
        raise HTTPException(
            status_code=503,
            detail="Vector store unavailable. Ensure ChromaDB is running.",
        )

    assigned = await process_unassigned_articles(db)
    await db.commit()

    stats = await service.update_cluster_stats(db)
    await db.commit()

    active_clusters = await db.execute(
        select(func.count(TopicCluster.id)).where(TopicCluster.is_active == True)
    )
    active_count = active_clusters.scalar() or 0

    unlabeled = await db.execute(
        select(TopicCluster.id).where(
            and_(
                TopicCluster.is_active == True,
                TopicCluster.label == None,
                TopicCluster.article_count >= 2,
            )
        )
    )
    for row in unlabeled.all():
        await service.generate_cluster_label(db, row[0])
    await db.commit()

    return {
        "message": "Backfill completed",
        "articles_assigned": assigned,
        "daily_stats_updated": stats.get("daily_updated", 0),
        "hourly_stats_updated": stats.get("hourly_updated", 0),
        "active_clusters": active_count,
    }


@router.post("/merge")
async def merge_clusters(
    threshold: float = Query(default=0.80, ge=0.5, le=0.95),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Merge semantically similar clusters.

    This helps deduplicate clusters that cover the same story but were
    created from articles with slightly different angles.

    The threshold parameter controls how similar clusters must be to merge:
    - 0.80 (default): Conservative, only merges very similar clusters
    - 0.70: More aggressive, may merge related but distinct stories
    - 0.90: Very conservative, only obvious duplicates

    Run this after backfill or periodically to clean up duplicate clusters.
    """
    from app.services.clustering import merge_similar_clusters

    service = ClusteringService()
    if not service.vector_store:
        raise HTTPException(
            status_code=503,
            detail="Vector store unavailable. Ensure ChromaDB is running.",
        )

    merged_count = await merge_similar_clusters(db, similarity_threshold=threshold)

    active_clusters = await db.execute(
        select(func.count(TopicCluster.id)).where(TopicCluster.is_active == True)
    )
    active_count = active_clusters.scalar() or 0

    return {
        "message": "Cluster merge completed",
        "clusters_merged": merged_count,
        "active_clusters": active_count,
        "threshold_used": threshold,
    }


@router.post("/test")
async def test_clustering_endpoint(
    cleanup: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Test clustering by creating test articles and running clustering immediately.

    This endpoint is for development/testing only. It:
    1. Creates 8 test articles with embeddings (3 AI articles, 2 climate, 2 politics, 1 standalone)
    2. Runs fast clustering on them
    3. Returns results and optionally cleans up test data

    Use this to verify clustering works without waiting 30 minutes.
    """
    import sys
    import os

    # Import test functions
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))
    from test_clustering import (
        create_test_articles_with_embeddings,
        test_fast_clustering,
        cleanup_test_articles,
    )

    service = ClusteringService()
    if not service.vector_store:
        raise HTTPException(
            status_code=503,
            detail="Vector store unavailable. Ensure ChromaDB is running.",
        )

    # Run the test
    results = await test_fast_clustering()

    if cleanup and results.get("success"):
        cleaned = await cleanup_test_articles()
        results["test_articles_cleaned"] = cleaned

    return results


@router.get("/diagnostics")
async def get_clustering_diagnostics(
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get detailed diagnostics about clustering system state.

    Returns counts of articles, embeddings, clusters, and identifies
    any issues preventing clustering from working.
    """
    import sys
    import os

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))
    from test_clustering import diagnose_clustering_issues

    diagnostics = await diagnose_clustering_issues()

    # Add current cluster distribution
    try:
        from sqlalchemy import select, func
        from app.database import ArticleTopic, TopicCluster

        # Get cluster sizes
        cluster_sizes = await db.execute(
            select(
                TopicCluster.id,
                TopicCluster.label,
                func.count(ArticleTopic.id).label("article_count"),
            )
            .outerjoin(ArticleTopic, ArticleTopic.cluster_id == TopicCluster.id)
            .where(TopicCluster.is_active == True)
            .group_by(TopicCluster.id)
            .order_by(func.count(ArticleTopic.id).desc())
        )

        diagnostics["cluster_distribution"] = [
            {"id": row[0], "label": row[1], "articles": row[2]}
            for row in cluster_sizes.all()
        ]

    except Exception as e:
        diagnostics["issues"].append(f"Failed to get cluster distribution: {e}")

    return diagnostics
