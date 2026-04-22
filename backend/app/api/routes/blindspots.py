"""API endpoints for blind spots analysis."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.blind_spots import (
    get_blind_spots_analyzer,
    analyze_all_sources,
)
from app.services.blindspot_viewer import get_blindspot_viewer_service

router = APIRouter(prefix="/blindspots", tags=["blindspots"])


class SourceBlindSpotsResponse(BaseModel):
    """Response for source blind spots analysis."""

    source: str
    article_count: int
    topics_covered: int
    total_active_topics: int
    coverage_ratio: float
    blind_spots: List[Dict[str, Any]]
    coverage_gaps: List[Dict[str, Any]]


class TopicBlindSpotResponse(BaseModel):
    """Response for topic blind spots."""

    cluster_id: int
    cluster_label: str
    keywords: List[str]
    article_count: int
    covering_sources: List[str]
    covering_count: int
    blind_spot_sources: List[str]
    blind_spot_count: int
    severity: str
    date_identified: str


class CoverageReportResponse(BaseModel):
    """Response for comprehensive coverage report."""

    report_period_days: int
    generated_at: str
    total_sources: int
    average_coverage_ratio: float
    average_articles_per_source: float
    source_rankings: List[Dict[str, Any]]
    systemic_blind_spots: List[Dict[str, Any]]
    underperforming_sources: List[Dict[str, Any]]


class BlindspotLensResponse(BaseModel):
    id: Literal["bias", "credibility", "geography", "institutional_populist"]
    label: str
    description: str
    available: bool
    unavailable_reason: Optional[str] = None


class BlindspotLaneResponse(BaseModel):
    id: Literal["pole_a", "shared", "pole_b"]
    label: str
    description: str
    cluster_count: int


class BlindspotCoverageCountsResponse(BaseModel):
    pole_a: int
    shared: int
    pole_b: int


class BlindspotCoverageSharesResponse(BaseModel):
    pole_a: float
    shared: float
    pole_b: float


class BlindspotGeographySignalResponse(BaseModel):
    id: str
    label: str
    count: int


class BlindspotPreviewArticleResponse(BaseModel):
    id: int
    title: str
    source: str
    source_id: Optional[str] = None
    url: str
    image_url: Optional[str] = None
    published_at: Optional[str] = None
    summary: Optional[str] = None
    similarity: float
    country: Optional[str] = None
    source_country: Optional[str] = None
    category: Optional[str] = None
    bias: Optional[str] = None
    credibility: Optional[str] = None
    author: Optional[str] = None
    authors: List[str] = []


class BlindspotCardResponse(BaseModel):
    cluster_id: int
    cluster_label: str
    keywords: List[str]
    article_count: int
    source_count: int
    lane: Literal["pole_a", "shared", "pole_b"]
    blindspot_score: float
    balance_score: float
    published_at: Optional[str] = None
    explanation: str
    coverage_counts: BlindspotCoverageCountsResponse
    coverage_shares: BlindspotCoverageSharesResponse
    representative_article: Optional[BlindspotPreviewArticleResponse] = None
    articles: List[BlindspotPreviewArticleResponse]
    geography_signals: List[BlindspotGeographySignalResponse] = []


class BlindspotViewerSummaryResponse(BaseModel):
    window: str
    total_clusters: int
    eligible_clusters: int
    generated_at: str
    category: Optional[str] = None
    source_filters: List[str]


class BlindspotViewerResponse(BaseModel):
    available_lenses: List[BlindspotLensResponse]
    selected_lens: BlindspotLensResponse
    summary: BlindspotViewerSummaryResponse
    lanes: List[BlindspotLaneResponse]
    cards: List[BlindspotCardResponse]
    status: str


@router.get("/source/{source_name}", response_model=SourceBlindSpotsResponse)
async def get_source_blind_spots(
    source_name: str,
    days: int = Query(30, ge=1, le=90),
    session: AsyncSession = Depends(get_db),
) -> SourceBlindSpotsResponse:
    """Get blind spots analysis for a specific source.

    Identifies topics that this source is NOT covering while other sources are.

    Args:
        source_name: Name of the news source
        days: Analysis period in days (1-90)

    Returns:
        Blind spots analysis with coverage gaps
    """
    try:
        analyzer = get_blind_spots_analyzer()
        result = await analyzer.analyze_source_coverage(session, source_name, days)
        return SourceBlindSpotsResponse(**result)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to analyze source coverage: {str(e)}"
        )


@router.get("/topics", response_model=List[TopicBlindSpotResponse])
async def get_topic_blind_spots(
    min_sources: int = Query(4, ge=2, le=20),
    session: AsyncSession = Depends(get_db),
) -> List[TopicBlindSpotResponse]:
    """Get topics where major sources have blind spots.

    Identifies stories that many sources are covering, but some major sources
    are not reporting on.

    Args:
        min_sources: Minimum number of sources covering topic to analyze

    Returns:
        List of topics with blind spots and severity ratings
    """
    try:
        analyzer = get_blind_spots_analyzer()
        results = await analyzer.identify_topic_blind_spots(session, min_sources)
        return [TopicBlindSpotResponse(**r) for r in results]
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to identify topic blind spots: {str(e)}"
        )


@router.get("/report", response_model=CoverageReportResponse)
async def get_coverage_report(
    days: int = Query(30, ge=7, le=90),
    session: AsyncSession = Depends(get_db),
) -> CoverageReportResponse:
    """Get comprehensive coverage report for all sources.

    Provides:
    - Source rankings by coverage ratio
    - Systemic blind spots (topics many sources miss)
    - Underperforming sources (coverage ratio < 50%)

    Args:
        days: Analysis period in days (7-90)

    Returns:
        Comprehensive coverage report
    """
    try:
        result = await analyze_all_sources(session, days)
        return CoverageReportResponse(**result)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate coverage report: {str(e)}"
        )


@router.post("/update-stats")
async def update_coverage_stats(
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Trigger update of daily coverage statistics.

    Updates SourceCoverageStats table with today's data.
    Should be called periodically (e.g., daily) by a scheduler.

    Returns:
        Update results with count of sources updated
    """
    try:
        analyzer = get_blind_spots_analyzer()
        updated = await analyzer.update_daily_coverage_stats(session)
        return {
            "success": True,
            "sources_updated": updated,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update coverage stats: {str(e)}"
        )


@router.get("/dashboard")
async def get_blind_spots_dashboard(
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Get dashboard data for blind spots visualization.

    Combines multiple analyses into a single dashboard view.

    Returns:
        Dashboard data with charts and summaries
    """
    try:
        analyzer = get_blind_spots_analyzer()

        # Get quick summary stats
        report = await analyzer.generate_source_coverage_report(session, days=7)
        topic_blind_spots = await analyzer.identify_topic_blind_spots(
            session, min_sources=4
        )

        # Calculate dashboard metrics
        high_severity = [b for b in topic_blind_spots if b["severity"] == "high"]
        medium_severity = [b for b in topic_blind_spots if b["severity"] == "medium"]

        # Source coverage distribution
        coverage_ranges = {
            "excellent": len(
                [s for s in report["source_rankings"] if s["coverage_ratio"] >= 0.8]
            ),
            "good": len(
                [
                    s
                    for s in report["source_rankings"]
                    if 0.6 <= s["coverage_ratio"] < 0.8
                ]
            ),
            "fair": len(
                [
                    s
                    for s in report["source_rankings"]
                    if 0.4 <= s["coverage_ratio"] < 0.6
                ]
            ),
            "poor": len(
                [s for s in report["source_rankings"] if s["coverage_ratio"] < 0.4]
            ),
        }

        return {
            "summary": {
                "total_sources": report["total_sources"],
                "average_coverage": round(report["average_coverage_ratio"] * 100, 1),
                "high_severity_blind_spots": len(high_severity),
                "medium_severity_blind_spots": len(medium_severity),
                "underperforming_sources": len(report["underperforming_sources"]),
            },
            "coverage_distribution": coverage_ranges,
            "top_blind_spots": topic_blind_spots[:5],
            "underperforming_sources": report["underperforming_sources"][:5],
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate dashboard: {str(e)}"
        )


@router.get("/viewer", response_model=BlindspotViewerResponse)
async def get_blindspot_viewer(
    lens: Literal["bias", "credibility", "geography", "institutional_populist"] = Query(
        default="bias"
    ),
    window: str = Query(default="1w", pattern="^(1d|1w|1m)$"),
    category: Optional[str] = Query(default=None),
    sources: Optional[str] = Query(default=None),
    per_lane: int = Query(default=10, ge=1, le=20),
    session: AsyncSession = Depends(get_db),
) -> BlindspotViewerResponse:
    """Get a multi-lens blindspot viewer payload."""
    try:
        service = get_blindspot_viewer_service()
        payload = await service.build_viewer(
            session,
            lens=lens,
            window=window,
            category=category,
            sources=sources,
            per_lane=per_lane,
        )
        return BlindspotViewerResponse.model_validate(payload)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to build blindspot viewer: {str(exc)}",
        )
