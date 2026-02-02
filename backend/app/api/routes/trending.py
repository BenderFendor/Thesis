"""API routes for trending and breaking news detection."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import get_db
from app.services.chroma_topics import ChromaTopicService

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

    service = ChromaTopicService()
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

    service = ChromaTopicService()
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

    service = ChromaTopicService()
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
    service = ChromaTopicService()
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
    service = ChromaTopicService()
    if not service.vector_store:
        return {
            "active_clusters": 0,
            "total_article_assignments": 0,
            "recent_spikes": 0,
            "similarity_threshold": 0.0,
            "baseline_days": 0,
            "breaking_window_hours": 3,
        }
    return await service.get_trending_stats(db)
