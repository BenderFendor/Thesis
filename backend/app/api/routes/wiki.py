"""
API routes for the Media Accountability Wiki.

Provides endpoints for:
- Source directory with filtering (country, bias, funding type)
- Individual source wiki pages with source-analysis scores
- Reporter directory and profiles with deep dossiers
- Organization ownership graph data
- Wiki indexing status and triggers
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.database import (
    Article,
    ArticleAuthor,
    Organization,
    Reporter,
    SourceAnalysisScore,
    SourceMetadata,
    WikiIndexStatus,
    get_db,
)
from app.services.source_research import get_source_profile
from app.services.reporter_public_records import build_reporter_activity_summary

router = APIRouter(prefix="/api/wiki", tags=["wiki"])
logger = get_logger("wiki_routes")


def _required_str(value: Optional[str]) -> str:
    return cast(str, value)


def _required_int(value: Optional[int]) -> int:
    return cast(int, value)


def _optional_float(value: Any) -> Optional[float]:
    return cast(Optional[float], value)


def _string_list(value: Any) -> List[str]:
    return cast(List[str], value or [])


# ── Response Models ──────────────────────────────────────────────────


class AnalysisAxisResponse(BaseModel):
    axis_name: str
    score: int
    confidence: Optional[str] = None
    prose_explanation: Optional[str] = None
    citations: Optional[List[Dict[str, str]]] = None
    empirical_basis: Optional[str] = None
    scored_by: Optional[str] = None
    last_scored_at: Optional[str] = None


class SourceCardResponse(BaseModel):
    """Compact source card for the wiki index grid."""

    name: str
    country: Optional[str] = None
    funding_type: Optional[str] = None
    bias_rating: Optional[str] = None
    category: Optional[str] = None
    parent_company: Optional[str] = None
    credibility_score: Optional[float] = None
    analysis_scores: Optional[Dict[str, int]] = None  # {axis_name: score}
    index_status: Optional[str] = None
    last_indexed_at: Optional[str] = None


class SourceWikiResponse(BaseModel):
    """Full wiki page data for a single source."""

    name: str
    website: Optional[str] = None
    country: Optional[str] = None
    funding_type: Optional[str] = None
    bias_rating: Optional[str] = None
    category: Optional[str] = None
    parent_company: Optional[str] = None
    credibility_score: Optional[float] = None
    is_state_media: Optional[bool] = None
    source_type: Optional[str] = None
    overview: Optional[str] = None
    match_status: Optional[str] = None
    wikipedia_url: Optional[str] = None
    wikidata_qid: Optional[str] = None
    wikidata_url: Optional[str] = None
    dossier_sections: List[Dict[str, Any]] = []
    citations: List[Dict[str, str]] = []
    search_links: Optional[Dict[str, str]] = None
    match_explanation: Optional[str] = None
    official_pages: List[Dict[str, str]] = []

    # Source analysis scores
    analysis_axes: List[AnalysisAxisResponse] = []

    # Reporters associated with this source
    reporters: List[Dict[str, Any]] = []

    # Organization/ownership data
    organization: Optional[Dict[str, Any]] = None
    ownership_chain: List[Dict[str, Any]] = []

    # Coverage analysis
    article_count: int = 0
    geographic_focus: List[str] = []
    topic_focus: List[str] = []

    # Index metadata
    index_status: Optional[str] = None
    last_indexed_at: Optional[str] = None


class ReporterCardResponse(BaseModel):
    """Compact reporter card for the directory."""

    id: int
    name: str
    normalized_name: Optional[str] = None
    bio: Optional[str] = None
    topics: Optional[List[str]] = None
    political_leaning: Optional[str] = None
    leaning_confidence: Optional[str] = None
    article_count: int = 0
    current_outlet: Optional[str] = None
    wikipedia_url: Optional[str] = None
    canonical_name: Optional[str] = None
    match_status: Optional[str] = None
    research_confidence: Optional[str] = None


class ReporterDossierResponse(BaseModel):
    """Full reporter dossier for the wiki page."""

    id: int
    name: str
    normalized_name: Optional[str] = None
    bio: Optional[str] = None
    career_history: Optional[List[Dict[str, Any]]] = None
    topics: Optional[List[str]] = None
    education: Optional[List[Dict[str, Any]]] = None

    political_leaning: Optional[str] = None
    leaning_confidence: Optional[str] = None
    leaning_sources: Optional[List[str]] = None

    twitter_handle: Optional[str] = None
    linkedin_url: Optional[str] = None
    wikipedia_url: Optional[str] = None
    wikidata_qid: Optional[str] = None
    wikidata_url: Optional[str] = None
    canonical_name: Optional[str] = None
    match_status: Optional[str] = None
    overview: Optional[str] = None
    dossier_sections: List[Dict[str, Any]] = []
    citations: List[Dict[str, str]] = []
    search_links: Optional[Dict[str, str]] = None
    match_explanation: Optional[str] = None

    # Deep dossier fields
    source_patterns: Optional[Dict[str, Any]] = None
    topics_avoided: Optional[Dict[str, Any]] = None
    advertiser_alignment: Optional[Dict[str, Any]] = None
    revolving_door: Optional[Dict[str, Any]] = None
    controversies: Optional[List[Dict[str, Any]]] = None
    institutional_affiliations: Optional[List[Dict[str, Any]]] = None
    coverage_comparison: Optional[Dict[str, Any]] = None

    article_count: int = 0
    last_article_at: Optional[str] = None

    # Articles in our system
    recent_articles: List[Dict[str, Any]] = []
    activity_summary: Optional[Dict[str, Any]] = None

    research_sources: Optional[List[str]] = None
    research_confidence: Optional[str] = None


class OwnershipGraphResponse(BaseModel):
    """Graph data for force-directed ownership visualization."""

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []


class WikiIndexStatusResponse(BaseModel):
    total_entries: int = 0
    by_status: Dict[str, int] = {}
    by_type: Dict[str, int] = {}


# ── Source Endpoints ─────────────────────────────────────────────────


@router.get("/sources", response_model=List[SourceCardResponse])
async def list_wiki_sources(
    db: AsyncSession = Depends(get_db),
    country: Optional[str] = Query(None, description="Filter by ISO country code"),
    bias: Optional[str] = Query(None, description="Filter by bias rating"),
    funding: Optional[str] = Query(None, description="Filter by funding type"),
    search: Optional[str] = Query(None, description="Search by source name"),
    sort: str = Query("name", description="Sort by: name, country, bias"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> List[SourceCardResponse]:
    """List all sources for the wiki index page with optional filtering."""
    sources = get_rss_sources()

    # Deduplicate by base name
    unique_sources: Dict[str, Dict[str, Any]] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config

    # Load analysis scores from DB
    score_result = await db.execute(select(SourceAnalysisScore))
    all_scores = score_result.scalars().all()
    scores_by_source: Dict[str, Dict[str, int]] = {}
    for score in all_scores:
        score_source_name = _required_str(score.source_name)
        score_axis_name = _required_str(score.axis_name)
        if score_source_name not in scores_by_source:
            scores_by_source[score_source_name] = {}
        scores_by_source[score_source_name][score_axis_name] = _required_int(
            score.score
        )

    # Load index status from DB
    status_result = await db.execute(
        select(WikiIndexStatus).where(WikiIndexStatus.entity_type == "source")
    )
    status_entries: Dict[str, WikiIndexStatus] = {
        _required_str(status_entry.entity_name): status_entry
        for status_entry in status_result.scalars().all()
    }

    # Load source metadata from DB for credibility/parent company
    meta_result = await db.execute(select(SourceMetadata))
    metadata_by_name: Dict[str, SourceMetadata] = {}
    for metadata_entry in meta_result.scalars().all():
        metadata_by_name[_required_str(metadata_entry.source_name)] = metadata_entry

    # Build response cards
    cards: List[SourceCardResponse] = []
    for name, config in unique_sources.items():
        source_country = config.get("country", "")
        source_bias = config.get("bias_rating", "")
        source_funding = config.get("funding_type", "")

        # Apply filters
        if country and source_country.upper() != country.upper():
            continue
        if bias and source_bias.lower() != bias.lower():
            continue
        if funding and source_funding.lower() != funding.lower():
            continue
        if search and search.lower() not in name.lower():
            continue

        meta: Optional[SourceMetadata] = metadata_by_name.get(name)
        status = status_entries.get(name)

        cards.append(
            SourceCardResponse(
                name=name,
                country=source_country or None,
                funding_type=source_funding or None,
                bias_rating=source_bias or None,
                category=config.get("category", "general"),
                parent_company=meta.parent_company if meta else None,
                credibility_score=_optional_float(meta.credibility_score)
                if meta
                else None,
                analysis_scores=scores_by_source.get(name),
                index_status=status.status if status else "unindexed",
                last_indexed_at=(
                    status.last_indexed_at.isoformat()
                    if status and status.last_indexed_at
                    else None
                ),
            )
        )

    # Sort
    if sort == "country":
        cards.sort(key=lambda c: c.country or "ZZ")
    elif sort == "bias":
        bias_order = {
            "left": 0,
            "left-center": 1,
            "center": 2,
            "center-right": 3,
            "right-center": 3,
            "right": 4,
        }
        cards.sort(key=lambda c: bias_order.get((c.bias_rating or "").lower(), 5))
    else:
        cards.sort(key=lambda c: c.name.lower())

    return cards[offset : offset + limit]


@router.get("/sources/{source_name}", response_model=SourceWikiResponse)
async def get_source_wiki(
    source_name: str,
    db: AsyncSession = Depends(get_db),
) -> SourceWikiResponse:
    """Get full wiki page data for a single source."""
    sources = get_rss_sources()

    # Find the source config
    source_config: Optional[Dict[str, Any]] = None
    matched_source_names: List[str] = []
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if (
            base_name.lower() == source_name.lower()
            or name.lower() == source_name.lower()
        ):
            matched_source_names.append(name)
            if source_config is None:
                source_config = config

    if source_config is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")
    if not matched_source_names:
        matched_source_names = [source_name]

    # Load source analysis scores
    score_result = await db.execute(
        select(SourceAnalysisScore).where(
            SourceAnalysisScore.source_name.in_(matched_source_names)
        )
    )
    score_map: Dict[str, SourceAnalysisScore] = {}
    for score_entry in score_result.scalars().all():
        axis_name = _required_str(score_entry.axis_name)
        existing_score = score_map.get(axis_name)
        if existing_score is None or (
            score_entry.last_scored_at
            and (
                existing_score.last_scored_at is None
                or score_entry.last_scored_at > existing_score.last_scored_at
            )
        ):
            score_map[axis_name] = score_entry
    scores = [
        AnalysisAxisResponse(
            axis_name=_required_str(s.axis_name),
            score=_required_int(s.score),
            confidence=s.confidence,
            prose_explanation=s.prose_explanation,
            citations=cast(Optional[List[Dict[str, str]]], s.citations),
            empirical_basis=s.empirical_basis,
            scored_by=s.scored_by,
            last_scored_at=s.last_scored_at.isoformat() if s.last_scored_at else None,
        )
        for s in score_map.values()
    ]

    # Load source metadata
    meta_result = await db.execute(
        select(SourceMetadata).where(
            SourceMetadata.source_name.in_(matched_source_names)
        )
    )
    metadata_entries = meta_result.scalars().all()
    meta = next(
        (
            entry
            for entry in metadata_entries
            if _required_str(entry.source_name).lower() == source_name.lower()
        ),
        metadata_entries[0] if metadata_entries else None,
    )

    # Count articles from this source
    article_count_result = await db.execute(
        select(func.count())
        .select_from(Article)
        .where(Article.source.in_(matched_source_names))
    )
    article_count = article_count_result.scalar_one() or 0

    # Load reporters associated with this source (via articles)
    reporter_result = await db.execute(
        select(
            Reporter.id,
            Reporter.name,
            Reporter.topics,
            Reporter.political_leaning,
            Reporter.article_count,
        )
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Article.source.in_(matched_source_names))
        .distinct()
        .limit(50)
    )
    reporters: List[Dict[str, Any]] = [
        {
            "id": r.id,
            "name": r.name,
            "topics": r.topics,
            "political_leaning": r.political_leaning,
            "article_count": r.article_count or 0,
        }
        for r in reporter_result.all()
    ]

    # Load organization data
    org_result = await db.execute(
        select(Organization).where(
            Organization.normalized_name == source_name.lower().strip()
        )
    )
    org = org_result.scalar_one_or_none()
    org_data: Optional[Dict[str, Any]] = None
    if org:
        org_data = {
            "id": org.id,
            "name": org.name,
            "org_type": org.org_type,
            "funding_type": org.funding_type,
            "funding_sources": org.funding_sources,
            "major_advertisers": org.major_advertisers,
            "ein": org.ein,
            "annual_revenue": org.annual_revenue,
            "media_bias_rating": org.media_bias_rating,
            "factual_reporting": org.factual_reporting,
            "wikipedia_url": org.wikipedia_url,
            "research_confidence": org.research_confidence,
        }
    source_profile = None
    for profile_source_name in [source_name, *matched_source_names]:
        try:
            source_profile = await get_source_profile(
                source_name=profile_source_name,
                website=None,
                force_refresh=False,
                cache_only=True,
            )
        except Exception:
            source_profile = None
        if source_profile is not None:
            break

    # Load index status
    status_result = await db.execute(
        select(WikiIndexStatus).where(
            WikiIndexStatus.entity_type == "source",
            WikiIndexStatus.entity_name.in_(matched_source_names),
        )
    )
    status_entries = status_result.scalars().all()
    status = next(
        (
            entry
            for entry in status_entries
            if _required_str(entry.entity_name).lower() == source_name.lower()
        ),
        None,
    )
    if status is None and status_entries:
        status_order = {"complete": 0, "pending": 1, "failed": 2, "unindexed": 3}
        status = min(
            status_entries,
            key=lambda entry: (
                status_order.get(_required_str(entry.status), 99),
                -entry.last_indexed_at.timestamp()
                if entry.last_indexed_at
                else float("inf"),
            ),
        )

    return SourceWikiResponse(
        name=source_name,
        website=cast(Optional[str], (source_profile or {}).get("website")),
        country=source_config.get("country") or None,
        funding_type=source_config.get("funding_type") or None,
        bias_rating=source_config.get("bias_rating") or None,
        category=source_config.get("category", "general"),
        parent_company=meta.parent_company if meta else None,
        credibility_score=_optional_float(meta.credibility_score) if meta else None,
        is_state_media=meta.is_state_media if meta else None,
        source_type=meta.source_type if meta else None,
        overview=cast(Optional[str], (source_profile or {}).get("overview")),
        match_status=cast(Optional[str], (source_profile or {}).get("match_status")),
        wikipedia_url=cast(Optional[str], (source_profile or {}).get("wikipedia_url")),
        wikidata_qid=cast(Optional[str], (source_profile or {}).get("wikidata_qid")),
        wikidata_url=cast(Optional[str], (source_profile or {}).get("wikidata_url")),
        dossier_sections=cast(
            List[Dict[str, Any]], (source_profile or {}).get("dossier_sections") or []
        ),
        citations=cast(
            List[Dict[str, str]], (source_profile or {}).get("citations") or []
        ),
        search_links=cast(
            Optional[Dict[str, str]], (source_profile or {}).get("search_links")
        ),
        match_explanation=cast(
            Optional[str], (source_profile or {}).get("match_explanation")
        ),
        official_pages=cast(
            List[Dict[str, str]], (source_profile or {}).get("official_pages") or []
        ),
        analysis_axes=scores,
        reporters=reporters,
        organization=org_data,
        article_count=article_count,
        geographic_focus=_string_list(meta.geographic_focus) if meta else [],
        topic_focus=_string_list(meta.topic_focus) if meta else [],
        index_status=status.status if status else "unindexed",
        last_indexed_at=(
            status.last_indexed_at.isoformat()
            if status and status.last_indexed_at
            else None
        ),
    )


@router.get("/sources/{source_name}/reporters")
async def get_source_reporters(
    source_name: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
) -> List[ReporterCardResponse]:
    """Get reporters associated with a source."""
    result = await db.execute(
        select(Reporter)
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Article.source == source_name)
        .distinct()
        .limit(limit)
    )
    reporters = result.scalars().all()
    return [
        ReporterCardResponse(
            id=_required_int(r.id),
            name=_required_str(r.name),
            normalized_name=r.normalized_name,
            bio=(r.bio[:200] + "..." if r.bio and len(r.bio) > 200 else r.bio),
            topics=r.topics,
            political_leaning=r.political_leaning,
            leaning_confidence=r.leaning_confidence,
            article_count=r.article_count or 0,
            current_outlet=source_name,
            wikipedia_url=r.wikipedia_url,
            canonical_name=r.canonical_name,
            match_status=r.match_status,
            research_confidence=r.research_confidence,
        )
        for r in reporters
    ]


# ── Reporter Endpoints ───────────────────────────────────────────────


@router.get("/reporters", response_model=List[ReporterCardResponse])
async def list_wiki_reporters(
    db: AsyncSession = Depends(get_db),
    search: Optional[str] = Query(None, description="Search by reporter name"),
    source: Optional[str] = Query(None, description="Filter by source/outlet"),
    leaning: Optional[str] = Query(None, description="Filter by political leaning"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> List[ReporterCardResponse]:
    """List all reporters in the wiki directory."""
    stmt = select(Reporter)

    if search:
        stmt = stmt.where(Reporter.name.ilike(f"%{search}%"))
    if leaning:
        stmt = stmt.where(Reporter.political_leaning == leaning)

    stmt = stmt.order_by(Reporter.name).limit(limit).offset(offset)

    result = await db.execute(stmt)
    reporters = result.scalars().all()

    return [
        ReporterCardResponse(
            id=_required_int(r.id),
            name=_required_str(r.name),
            normalized_name=r.normalized_name,
            bio=(r.bio[:200] + "..." if r.bio and len(r.bio) > 200 else r.bio),
            topics=r.topics,
            political_leaning=r.political_leaning,
            leaning_confidence=r.leaning_confidence,
            article_count=r.article_count or 0,
            canonical_name=r.canonical_name,
            match_status=r.match_status,
            wikipedia_url=r.wikipedia_url,
            research_confidence=r.research_confidence,
        )
        for r in reporters
    ]


@router.get("/reporters/{reporter_id}", response_model=ReporterDossierResponse)
async def get_reporter_dossier(
    reporter_id: int,
    db: AsyncSession = Depends(get_db),
) -> ReporterDossierResponse:
    """Get full reporter dossier for the wiki page."""
    result = await db.execute(select(Reporter).where(Reporter.id == reporter_id))
    reporter = result.scalar_one_or_none()

    if not reporter:
        raise HTTPException(status_code=404, detail="Reporter not found")

    # Get recent articles by this reporter
    article_result = await db.execute(
        select(Article)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .order_by(Article.published_at.desc())
        .limit(20)
    )
    articles: List[Dict[str, Any]] = [
        {
            "id": a.id,
            "title": a.title,
            "source": a.source,
            "published_at": a.published_at.isoformat() if a.published_at else None,
            "url": a.url,
            "category": a.category,
        }
        for a in article_result.scalars().all()
    ]
    activity_summary = await build_reporter_activity_summary(
        _required_str(reporter.name), articles
    )

    return ReporterDossierResponse(
        id=_required_int(reporter.id),
        name=_required_str(reporter.name),
        normalized_name=reporter.normalized_name,
        bio=reporter.bio,
        career_history=reporter.career_history,
        topics=reporter.topics,
        education=reporter.education,
        political_leaning=reporter.political_leaning,
        leaning_confidence=reporter.leaning_confidence,
        leaning_sources=reporter.leaning_sources,
        twitter_handle=reporter.twitter_handle,
        linkedin_url=reporter.linkedin_url,
        wikipedia_url=reporter.wikipedia_url,
        wikidata_qid=reporter.wikidata_qid,
        wikidata_url=reporter.wikidata_url,
        canonical_name=reporter.canonical_name,
        match_status=reporter.match_status,
        overview=reporter.overview,
        dossier_sections=cast(List[Dict[str, Any]], reporter.dossier_sections or []),
        citations=cast(List[Dict[str, str]], reporter.citations or []),
        search_links=cast(Optional[Dict[str, str]], reporter.search_links),
        match_explanation=reporter.match_explanation,
        source_patterns=reporter.source_patterns,
        topics_avoided=reporter.topics_avoided,
        advertiser_alignment=reporter.advertiser_alignment,
        revolving_door=reporter.revolving_door,
        controversies=reporter.controversies,
        institutional_affiliations=reporter.institutional_affiliations,
        coverage_comparison=reporter.coverage_comparison,
        article_count=reporter.article_count or 0,
        last_article_at=(
            reporter.last_article_at.isoformat() if reporter.last_article_at else None
        ),
        recent_articles=articles,
        activity_summary=activity_summary,
        research_sources=reporter.research_sources,
        research_confidence=reporter.research_confidence,
    )


@router.get("/reporters/{reporter_id}/articles")
async def get_reporter_articles(
    reporter_id: int,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> List[Dict[str, Any]]:
    """Get articles by a specific reporter."""
    result = await db.execute(
        select(Article)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .order_by(Article.published_at.desc())
        .limit(limit)
        .offset(offset)
    )
    articles = result.scalars().all()
    return [
        {
            "id": a.id,
            "title": a.title,
            "source": a.source,
            "published_at": a.published_at.isoformat() if a.published_at else None,
            "url": a.url,
            "category": a.category,
            "image_url": a.image_url,
        }
        for a in articles
    ]


# ── Organization / Ownership Graph Endpoints ─────────────────────────


@router.get("/organizations", response_model=List[Dict[str, Any]])
async def list_wiki_organizations(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> List[Dict[str, Any]]:
    """List all organizations for the wiki."""
    result = await db.execute(
        select(Organization).order_by(Organization.name).limit(limit).offset(offset)
    )
    orgs = result.scalars().all()
    return [
        {
            "id": o.id,
            "name": o.name,
            "org_type": o.org_type,
            "funding_type": o.funding_type,
            "media_bias_rating": o.media_bias_rating,
            "factual_reporting": o.factual_reporting,
            "parent_org_id": o.parent_org_id,
            "wikipedia_url": o.wikipedia_url,
            "research_confidence": o.research_confidence,
        }
        for o in orgs
    ]


@router.get("/organizations/graph", response_model=OwnershipGraphResponse)
async def get_ownership_graph(
    db: AsyncSession = Depends(get_db),
) -> OwnershipGraphResponse:
    """Get the full ownership graph for force-directed visualization.

    Returns nodes (sources + organizations) and edges (ownership relationships).
    """
    # Load all organizations
    org_result = await db.execute(select(Organization))
    orgs = org_result.scalars().all()

    # Load source configs for additional data
    sources = get_rss_sources()
    unique_sources: Dict[str, Dict[str, Any]] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    seen_nodes: set[str] = set()

    # Add source nodes
    for name, config in unique_sources.items():
        node_id = f"source:{name}"
        if node_id not in seen_nodes:
            seen_nodes.add(node_id)
            nodes.append(
                {
                    "id": node_id,
                    "label": name,
                    "type": "source",
                    "country": config.get("country", ""),
                    "bias": config.get("bias_rating", ""),
                    "funding": config.get("funding_type", ""),
                }
            )

    # Add organization nodes and ownership edges
    for org in orgs:
        node_id = f"org:{org.id}"
        if node_id not in seen_nodes:
            seen_nodes.add(node_id)
            nodes.append(
                {
                    "id": node_id,
                    "label": org.name,
                    "type": org.org_type or "organization",
                    "funding": org.funding_type,
                    "bias": org.media_bias_rating,
                }
            )

        # Create ownership edges
        if org.parent_org_id:
            edges.append(
                {
                    "source": f"org:{org.parent_org_id}",
                    "target": node_id,
                    "type": "ownership",
                    "percentage": org.ownership_percentage,
                }
            )

        # Try to link source nodes to their organization
        org_name_lower = _required_str(org.name).lower()
        for source_name in unique_sources:
            if (
                source_name.lower() in org_name_lower
                or org_name_lower in source_name.lower()
            ):
                source_node_id = f"source:{source_name}"
                if source_node_id in seen_nodes:
                    edges.append(
                        {
                            "source": node_id,
                            "target": source_node_id,
                            "type": "publishes",
                        }
                    )

    return OwnershipGraphResponse(nodes=nodes, edges=edges)


# ── Indexing Endpoints ───────────────────────────────────────────────


@router.get("/index/status", response_model=WikiIndexStatusResponse)
async def get_wiki_index_status(
    db: AsyncSession = Depends(get_db),
) -> WikiIndexStatusResponse:
    """Get wiki indexing status summary."""
    result = await db.execute(select(WikiIndexStatus))
    entries = result.scalars().all()

    by_status: Dict[str, int] = {}
    by_type: Dict[str, int] = {}
    for entry in entries:
        entry_status = _required_str(entry.status)
        entry_type = _required_str(entry.entity_type)
        by_status[entry_status] = by_status.get(entry_status, 0) + 1
        by_type[entry_type] = by_type.get(entry_type, 0) + 1

    return WikiIndexStatusResponse(
        total_entries=len(entries),
        by_status=by_status,
        by_type=by_type,
    )


@router.post("/index/{source_name}")
async def trigger_source_index(source_name: str) -> Dict[str, str]:
    """Trigger indexing for a specific source (admin endpoint)."""
    from app.services.wiki_indexer import index_source

    sources = get_rss_sources()
    source_config: Optional[Dict[str, Any]] = None
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name.lower() == source_name.lower():
            source_config = config
            break

    if source_config is None:
        source_config = {"country": "", "funding_type": "", "bias_rating": ""}

    success = await index_source(source_name, source_config)
    if success:
        return {"status": "complete", "source": source_name}
    raise HTTPException(status_code=500, detail=f"Failed to index {source_name}")
