"""API routes for trending and breaking news detection."""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import get_db
from app.services.chroma_topics import ChromaTopicService
from app.services.cluster_cache import get_latest_snapshot
from app.vector_store import is_chroma_reachable

logger = get_logger("trending_routes")
router = APIRouter(prefix="/trending", tags=["trending"])


class GDELTTopCameo(BaseModel):
    """GDELT Top Cameo."""

    code: str | None = None
    label: str | None = None
    count: int


class GDELTContext(BaseModel):
    """GDELT Context."""

    total_events: int
    top_cameo: list[GDELTTopCameo] = Field(default_factory=list)
    goldstein_avg: float | None = None
    goldstein_min: float | None = None
    goldstein_max: float | None = None
    goldstein_bucket: str | None = None
    tone_avg: float | None = None
    tone_baseline_avg: float | None = None
    tone_delta_vs_cluster: float | None = None


class ClusterArticle(BaseModel):
    """Cluster Article."""

    id: int
    title: str
    source: str
    source_id: str | None = None
    url: str
    image_url: str | None = None
    published_at: str | None = None
    summary: str | None = None
    similarity: float | None = None
    author: str | None = None
    authors: list[str] = Field(default_factory=list)
    gdelt_context: GDELTContext | None = None


class TrendingCluster(BaseModel):
    """Trending Cluster."""

    cluster_id: int
    label: str | None
    keywords: list[str]
    article_count: int
    window_count: int
    source_diversity: int
    trending_score: float
    velocity: float
    representative_article: ClusterArticle | None = None
    articles: list[ClusterArticle] = Field(default_factory=list)
    gdelt_context: GDELTContext | None = None


class BreakingCluster(BaseModel):
    """Breaking Cluster."""

    cluster_id: int
    label: str | None
    keywords: list[str]
    article_count_3h: int
    source_count_3h: int
    spike_magnitude: float
    is_new_story: bool
    representative_article: ClusterArticle | None = None
    articles: list[ClusterArticle] = Field(default_factory=list)
    gdelt_context: GDELTContext | None = None


class TrendingResponse(BaseModel):
    """Trending Response."""

    window: str
    clusters: list[TrendingCluster]
    total: int


class BreakingResponse(BaseModel):
    """Breaking Response."""

    window_hours: int
    clusters: list[BreakingCluster]
    total: int


class ClusterDetailResponse(BaseModel):
    """Cluster Detail Response."""

    id: int
    label: str | None
    keywords: list[str]
    article_count: int
    first_seen: str | None
    last_seen: str | None
    is_active: bool
    articles: list[ClusterArticle] = Field(default_factory=list)
    gdelt_context: GDELTContext | None = None


class AllCluster(BaseModel):
    """Cluster for topic-based view (without trending metrics)."""

    cluster_id: int
    label: str | None
    keywords: list[str]
    article_count: int
    window_count: int
    source_diversity: int
    representative_article: ClusterArticle | None = None
    articles: list[ClusterArticle] = Field(default_factory=list)
    gdelt_context: GDELTContext | None = None


class AllClustersResponse(BaseModel):
    """All Clusters Response."""

    window: str
    clusters: list[AllCluster]
    total: int
    computed_at: str | None = None
    status: str | None = None


@router.get("", response_model=TrendingResponse)
async def get_trending(
    response: Response,
    window: str = Query(default="1d", pattern="^(1d|1w|1m)$"),
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> TrendingResponse:
    """Get trending topic clusters based on velocity and diversity."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=120"

    if not is_chroma_reachable():
        return TrendingResponse(window=window, clusters=[], total=0)

    service = ChromaTopicService()
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
    """Get breaking news clusters showing unusual activity spikes."""
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"

    if not is_chroma_reachable():
        return BreakingResponse(window_hours=3, clusters=[], total=0)

    service = ChromaTopicService()
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
    db: AsyncSession = Depends(get_db),
) -> AllClustersResponse:
    """Get all active topic clusters from the latest pre-computed snapshot.

    Served exclusively from the Postgres snapshot written by the background
    cluster computation worker — no ChromaDB call at request time.

    Returns status="initializing" with an empty cluster list when no snapshot
    exists yet (e.g. shortly after first startup).
    """
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=120"

    snapshot = await get_latest_snapshot(db, window)

    if snapshot is None:
        logger.info("No cluster snapshot found for window=%s; returning initializing", window)
        return AllClustersResponse(
            window=window,
            clusters=[],
            total=0,
            computed_at=None,
            status="initializing",
        )

    clusters_data = cast(list[dict[str, Any]], snapshot.clusters_json or [])
    clusters = [AllCluster(**c) for c in clusters_data]

    return AllClustersResponse(
        window=window,
        clusters=clusters,
        total=len(clusters),
        computed_at=snapshot.computed_at.isoformat() if snapshot.computed_at else None,
        status="ok",
    )


@router.get("/clusters/{cluster_id}", response_model=ClusterDetailResponse)
async def get_cluster_detail(
    cluster_id: int,
    db: AsyncSession = Depends(get_db),
) -> ClusterDetailResponse:
    """Get detailed information about a specific topic cluster."""
    service = ChromaTopicService()
    detail = await service.get_cluster_detail(db, cluster_id)

    if not detail:
        raise HTTPException(status_code=404, detail="Cluster not found")

    return ClusterDetailResponse(**detail)


@router.get("/stats")
async def get_trending_stats(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get overall trending system statistics for debugging and monitoring."""
    if not is_chroma_reachable():
        return {
            "active_clusters": 0,
            "total_article_assignments": 0,
            "recent_spikes": 0,
            "similarity_threshold": 0.0,
            "baseline_days": 0,
            "breaking_window_hours": 3,
        }

    service = ChromaTopicService()
    return await service.get_trending_stats(db)
