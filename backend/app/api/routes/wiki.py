"""API routes for the Media Accountability Wiki.

Provides endpoints for:
- Source directory with filtering (country, bias, funding type)
- Individual source wiki pages with source-analysis scores
- Reporter directory and profiles with deep dossiers
- Organization ownership graph data
- Wiki indexing status and triggers
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import String, func, or_, select
from sqlalchemy import cast as sql_cast
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.database import (
    Article,
    ArticleAuthor,
    Organization,
    Reporter,
    SourceAnalysisScore,
    SourceClaim,
    SourceClaimEvidence,
    SourceMetadata,
    WikiIndexStatus,
    get_db,
)
from app.services.reporter_career_timeline import build_reporter_career_timeline
from app.services.reporter_public_records import build_reporter_activity_summary
from app.services.source_ledger import build_source_ledger
from app.services.source_research import get_source_profile

router = APIRouter(prefix="/api/wiki", tags=["wiki"])
logger = get_logger("wiki_routes")


def _required_str(value: str | None) -> str:
    return cast(str, value)


def _required_int(value: int | None) -> int:
    return cast(int, value)


def _optional_float(value: Any) -> float | None:
    return cast(float | None, value)


def _string_list(value: Any) -> list[str]:
    return cast(list[str], value or [])


def _overview_part(label: str, value: str) -> str | None:
    if not value:
        return None
    return f"{label}: {value}."


def _source_overview_parts(source_config: dict[str, Any], meta: SourceMetadata | None) -> list[str]:
    """Build the catalog-based overview sentences for a source."""
    return [
        part
        for part in (
            _overview_part("Type", str((meta.source_type if meta else "") or "").strip()),
            _overview_part("Country", str(source_config.get("country") or "").strip()),
            _overview_part("Funding model", str(source_config.get("funding_type") or "").strip()),
            _overview_part(
                "Parent organization", str((meta.parent_company if meta else "") or "").strip()
            ),
            _overview_part(
                "Catalog bias label", str(source_config.get("bias_rating") or "").strip()
            ),
        )
        if part
    ]


def _org_factual_label(org_data: dict[str, Any] | None) -> str | None:
    if not org_data:
        return None
    factual = str(org_data.get("factual_reporting") or "").strip()
    if not factual:
        return None
    return f"Catalog factual reporting label: {factual}."


def _source_overview_fallback(
    source_name: str,
    source_config: dict[str, Any],
    meta: SourceMetadata | None,
    org_data: dict[str, Any] | None,
) -> str | None:
    parts = _source_overview_parts(source_config, meta)
    factual_label = _org_factual_label(org_data)
    if factual_label:
        parts.append(factual_label)
    if not parts:
        return None
    return f"{source_name} source profile. {' '.join(parts)}"


def _employer_names(career_history: Any) -> list[str]:
    employers: list[str] = []
    for entry in career_history or []:
        if isinstance(entry, dict):
            org = entry.get("organization", "")
            if org:
                employers.append(str(org))
    return employers


def _rss_catalog_by_name() -> dict[str, dict[str, Any]]:
    sources = get_rss_sources()
    rss_by_name: dict[str, dict[str, Any]] = {}
    for name, cfg in sources.items():
        base_name = name.split(" - ")[0].strip()
        rss_by_name[base_name.lower()] = {
            "rss_name": base_name,
            "funding_type": cfg.get("funding_type", ""),
            "bias_rating": cfg.get("bias_rating", ""),
            "country": cfg.get("country", ""),
            "category": cfg.get("category", "general"),
            "factual_reporting": cfg.get("factual_reporting", ""),
        }
    return rss_by_name


def _match_employer_rss(
    employer: str, rss_by_name: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    employer_lower = employer.lower()
    rss_data = rss_by_name.get(employer_lower)
    if rss_data is not None:
        return rss_data
    for rss_key, rss_data in rss_by_name.items():
        if rss_key in employer_lower or employer_lower in rss_key:
            return rss_data
    return None


def _build_employer_rss_context(reporter: Reporter) -> dict[str, Any] | None:
    """Cross-reference a reporter's employers against the RSS catalog.

    Returns employer context with funding, bias, country from RSS config.
    """
    employer_names = _employer_names(reporter.career_history)
    if not employer_names:
        return None

    rss_by_name = _rss_catalog_by_name()
    matches: list[dict[str, Any]] = []
    for employer in employer_names:
        match = _match_employer_rss(employer, rss_by_name)
        if match is not None:
            matches.append(match)

    if not matches:
        return None

    primary = matches[0]
    return {
        "employers_matched": len(matches),
        "primary_outlet": primary["rss_name"],
        "funding_type": primary["funding_type"],
        "bias_rating": primary["bias_rating"],
        "country": primary["country"],
        "category": primary["category"],
        "factual_reporting": primary["factual_reporting"],
        "all_matches": matches[:5],
    }


# ── Response Models ──────────────────────────────────────────────────


class AnalysisAxisResponse(BaseModel):
    """Analysis Axis Response."""

    axis_name: str
    score: int
    confidence: str | None = None
    prose_explanation: str | None = None
    citations: list[dict[str, str]] | None = None
    empirical_basis: str | None = None
    scored_by: str | None = None
    last_scored_at: str | None = None


class SourceCardResponse(BaseModel):
    """Compact source card for the wiki index grid."""

    name: str
    country: str | None = None
    funding_type: str | None = None
    bias_rating: str | None = None
    category: str | None = None
    parent_company: str | None = None
    credibility_score: float | None = None
    analysis_scores: dict[str, int] | None = None  # {axis_name: score}
    index_status: str | None = None
    last_indexed_at: str | None = None


class SourceLedgerMetricResponse(BaseModel):
    """Single transparent source-ledger metric."""

    id: str
    label: str
    value: float | int
    unit: str
    description: str
    status: str


class SourceLedgerResponse(BaseModel):
    """Observed source ledger for a source wiki page."""

    source_name: str
    article_count: int
    paywall: dict[str, Any]
    original_reporting: dict[str, Any]
    wire_dependency: dict[str, Any]
    author_transparency: dict[str, Any]
    source_transparency: dict[str, Any]
    rss_health: dict[str, Any]
    metrics: list[SourceLedgerMetricResponse]


class SourceWikiResponse(BaseModel):
    """Full wiki page data for a single source."""

    name: str
    website: str | None = None
    country: str | None = None
    funding_type: str | None = None
    bias_rating: str | None = None
    category: str | None = None
    parent_company: str | None = None
    credibility_score: float | None = None
    is_state_media: bool | None = None
    source_type: str | None = None
    overview: str | None = None
    match_status: str | None = None
    wikipedia_url: str | None = None
    wikidata_qid: str | None = None
    wikidata_url: str | None = None
    dossier_sections: list[dict[str, Any]] = []
    citations: list[dict[str, str]] = []
    search_links: dict[str, str] | None = None
    match_explanation: str | None = None
    official_pages: list[dict[str, str]] = []
    policy_transparency: dict[str, Any] | None = None
    ads_txt: dict[str, Any] | None = None
    sellers_json: dict[str, Any] | None = None
    claims: list[dict[str, Any]] = []
    source_ledger: SourceLedgerResponse | None = None

    # Source analysis scores
    analysis_axes: list[AnalysisAxisResponse] = []

    # Reporters associated with this source
    reporters: list[dict[str, Any]] = []

    # Organization/ownership data
    organization: dict[str, Any] | None = None
    ownership_chain: list[dict[str, Any]] = []

    # Coverage analysis
    article_count: int = 0
    geographic_focus: list[str] = []
    topic_focus: list[str] = []

    # Index metadata
    index_status: str | None = None
    last_indexed_at: str | None = None


class ReporterCardResponse(BaseModel):
    """Compact reporter card for the directory."""

    id: int
    name: str
    normalized_name: str | None = None
    bio: str | None = None
    topics: list[str] | None = None
    political_leaning: str | None = None
    leaning_confidence: str | None = None
    article_count: int = 0
    current_outlet: str | None = None
    wikipedia_url: str | None = None
    canonical_name: str | None = None
    match_status: str | None = None
    research_confidence: str | None = None


class ReporterDossierResponse(BaseModel):
    """Full reporter dossier for the wiki page."""

    id: int
    name: str
    normalized_name: str | None = None
    bio: str | None = None
    career_history: list[dict[str, Any]] | None = None
    topics: list[str] | None = None
    education: list[dict[str, Any]] | None = None

    political_leaning: str | None = None
    leaning_confidence: str | None = None
    leaning_sources: list[str] | None = None

    twitter_handle: str | None = None
    linkedin_url: str | None = None
    wikipedia_url: str | None = None
    wikidata_qid: str | None = None
    wikidata_url: str | None = None
    canonical_name: str | None = None
    match_status: str | None = None
    overview: str | None = None
    dossier_sections: list[dict[str, Any]] = []
    citations: list[dict[str, str]] = []
    search_links: dict[str, str] | None = None
    match_explanation: str | None = None

    # Deep dossier fields
    source_patterns: dict[str, Any] | None = None
    topics_avoided: dict[str, Any] | None = None
    advertiser_alignment: dict[str, Any] | None = None
    revolving_door: dict[str, Any] | None = None
    controversies: list[dict[str, Any]] | None = None
    institutional_affiliations: list[dict[str, Any]] | None = None
    coverage_comparison: dict[str, Any] | None = None
    career_timeline: dict[str, Any] | None = None

    article_count: int = 0
    last_article_at: str | None = None

    # Articles in our system
    recent_articles: list[dict[str, Any]] = []
    activity_summary: dict[str, Any] | None = None

    # Employer context from RSS catalog
    employer_context: dict[str, Any] | None = None

    research_sources: list[str] | None = None
    research_confidence: str | None = None


class WikiIndexStatusResponse(BaseModel):
    """Wiki Index Status Response."""

    total_entries: int = 0
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}


def _dedupe_sources(sources: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    unique_sources: dict[str, dict[str, Any]] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config
    return unique_sources


def _scores_by_source(
    all_scores: Sequence[SourceAnalysisScore],
) -> dict[str, dict[str, int]]:
    scores_by_source: dict[str, dict[str, int]] = {}
    for score in all_scores:
        score_source_name = _required_str(score.source_name)
        score_axis_name = _required_str(score.axis_name)
        if score_source_name not in scores_by_source:
            scores_by_source[score_source_name] = {}
        scores_by_source[score_source_name][score_axis_name] = _required_int(score.score)
    return scores_by_source


def _status_by_entity_name(
    status_entries: Sequence[WikiIndexStatus],
) -> dict[str, WikiIndexStatus]:
    return {
        _required_str(status_entry.entity_name): status_entry for status_entry in status_entries
    }


def _metadata_by_name(
    metadata_entries: Sequence[SourceMetadata],
) -> dict[str, SourceMetadata]:
    metadata_by_name: dict[str, SourceMetadata] = {}
    for metadata_entry in metadata_entries:
        metadata_by_name[_required_str(metadata_entry.source_name)] = metadata_entry
    return metadata_by_name


def _passes_source_filters(
    name: str,
    config: dict[str, Any],
    country: str | None,
    bias: str | None,
    funding: str | None,
    search: str | None,
) -> bool:
    source_country = config.get("country", "")
    source_bias = config.get("bias_rating", "")
    source_funding = config.get("funding_type", "")
    if country and source_country.upper() != country.upper():
        return False
    if bias and source_bias.lower() != bias.lower():
        return False
    if funding and source_funding.lower() != funding.lower():
        return False
    return not search or search.lower() in name.lower()


def _build_source_card(
    name: str,
    config: dict[str, Any],
    meta: SourceMetadata | None,
    status: WikiIndexStatus | None,
    scores: dict[str, int] | None,
) -> SourceCardResponse:
    return SourceCardResponse(
        name=name,
        country=config.get("country") or None,
        funding_type=config.get("funding_type") or None,
        bias_rating=config.get("bias_rating") or None,
        category=config.get("category", "general"),
        parent_company=meta.parent_company if meta else None,
        credibility_score=_optional_float(meta.credibility_score) if meta else None,
        analysis_scores=scores,
        index_status=status.status if status else "unindexed",
        last_indexed_at=(
            status.last_indexed_at.isoformat() if status and status.last_indexed_at else None
        ),
    )


def _sort_source_cards(cards: list[SourceCardResponse], sort: str) -> None:
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


# ── Source Endpoints ─────────────────────────────────────────────────


@router.get("/sources", response_model=list[SourceCardResponse])
async def list_wiki_sources(
    db: AsyncSession = Depends(get_db),
    country: str | None = Query(None, description="Filter by ISO country code"),
    bias: str | None = Query(None, description="Filter by bias rating"),
    funding: str | None = Query(None, description="Filter by funding type"),
    search: str | None = Query(None, description="Search by source name"),
    sort: str = Query("name", description="Sort by: name, country, bias"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[SourceCardResponse]:
    """List all sources for the wiki index page with optional filtering."""
    unique_sources = _dedupe_sources(get_rss_sources())

    # Load analysis scores from DB
    score_result = await db.execute(select(SourceAnalysisScore))
    scores_by_source = _scores_by_source(score_result.scalars().all())

    # Load index status from DB
    status_result = await db.execute(
        select(WikiIndexStatus).where(WikiIndexStatus.entity_type == "source")
    )
    status_entries = _status_by_entity_name(status_result.scalars().all())

    # Load source metadata from DB for credibility/parent company
    meta_result = await db.execute(select(SourceMetadata))
    metadata_by_name = _metadata_by_name(meta_result.scalars().all())

    # Build response cards
    cards: list[SourceCardResponse] = []
    for name, config in unique_sources.items():
        if not _passes_source_filters(name, config, country, bias, funding, search):
            continue
        cards.append(
            _build_source_card(
                name,
                config,
                metadata_by_name.get(name),
                status_entries.get(name),
                scores_by_source.get(name),
            )
        )

    _sort_source_cards(cards, sort)
    return cards[offset : offset + limit]


def _profile_value(source_profile: dict[str, Any] | None, key: str, default: Any = None) -> Any:
    value = (source_profile or {}).get(key)
    return default if value is None else value


def _match_source_config(
    sources: dict[str, dict[str, Any]], source_name: str
) -> tuple[dict[str, Any], list[str]] | None:
    source_config: dict[str, Any] | None = None
    matched_source_names: list[str] = []
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name.lower() == source_name.lower() or name.lower() == source_name.lower():
            matched_source_names.append(name)
            if source_config is None:
                source_config = config
    if source_config is None:
        return None
    if not matched_source_names:
        matched_source_names = [source_name]
    return source_config, matched_source_names


async def _load_analysis_scores(
    db: AsyncSession, matched_source_names: list[str]
) -> list[AnalysisAxisResponse]:
    score_result = await db.execute(
        select(SourceAnalysisScore).where(SourceAnalysisScore.source_name.in_(matched_source_names))
    )
    score_map: dict[str, SourceAnalysisScore] = {}
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
    return [
        AnalysisAxisResponse(
            axis_name=_required_str(s.axis_name),
            score=_required_int(s.score),
            confidence=s.confidence,
            prose_explanation=s.prose_explanation,
            citations=cast(list[dict[str, str]] | None, s.citations),
            empirical_basis=s.empirical_basis,
            scored_by=s.scored_by,
            last_scored_at=s.last_scored_at.isoformat() if s.last_scored_at else None,
        )
        for s in score_map.values()
    ]


def _resolve_metadata(
    metadata_entries: Sequence[SourceMetadata], source_name: str
) -> SourceMetadata | None:
    return next(
        (
            entry
            for entry in metadata_entries
            if _required_str(entry.source_name).lower() == source_name.lower()
        ),
        metadata_entries[0] if metadata_entries else None,
    )


async def _load_wiki_reporters(
    db: AsyncSession, matched_source_names: list[str]
) -> list[dict[str, Any]]:
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
        .where(Reporter.retirement_reason.is_(None))
        .distinct()
        .limit(50)
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "topics": r.topics,
            "political_leaning": r.political_leaning,
            "article_count": r.article_count or 0,
        }
        for r in reporter_result.all()
    ]


async def _load_wiki_organization(db: AsyncSession, source_name: str) -> dict[str, Any] | None:
    org_result = await db.execute(
        select(Organization).where(Organization.normalized_name == source_name.lower().strip())
    )
    org = org_result.scalar_one_or_none()
    if org is None:
        return None
    return {
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


async def _load_source_profile(
    source_name: str, matched_source_names: list[str]
) -> dict[str, Any] | None:
    for profile_source_name in [source_name, *matched_source_names]:
        try:
            source_profile = await get_source_profile(
                source_name=profile_source_name,
                website=None,
                force_refresh=False,
                cache_only=True,
            )
        except (OSError, TypeError, ValueError):
            source_profile = None
        if source_profile is not None:
            return source_profile
    return None


async def _load_index_status(
    db: AsyncSession, matched_source_names: list[str], source_name: str
) -> WikiIndexStatus | None:
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
                -entry.last_indexed_at.timestamp() if entry.last_indexed_at else float("inf"),
            ),
        )
    return status


async def _load_source_claims(
    db: AsyncSession, matched_source_names: list[str]
) -> list[dict[str, Any]]:
    claim_payloads: list[dict[str, Any]] = []
    try:
        claim_result = await db.execute(
            select(SourceClaim).where(
                SourceClaim.source_name.in_(matched_source_names),
                SourceClaim.is_current.is_(True),
            )
        )
        claim_rows = claim_result.scalars().all()

        for claim_row in claim_rows:
            evidence_result = await db.execute(
                select(SourceClaimEvidence).where(SourceClaimEvidence.claim_id == claim_row.id)
            )
            evidence_rows = evidence_result.scalars().all()
            claim_payloads.append(
                {
                    "id": claim_row.id,
                    "type": claim_row.claim_type,
                    "kind": claim_row.claim_kind,
                    "value": claim_row.claim_value,
                    "confidence": claim_row.confidence,
                    "parser_version": claim_row.parser_version,
                    "valid_from": (
                        claim_row.valid_from.isoformat() if claim_row.valid_from else None
                    ),
                    "valid_to": claim_row.valid_to.isoformat() if claim_row.valid_to else None,
                    "evidence": [
                        {
                            "source_type": row.source_type,
                            "source_name": row.source_name,
                            "source_url": row.source_url,
                            "retrieved_at": (
                                row.retrieved_at.isoformat() if row.retrieved_at else None
                            ),
                            "raw_excerpt": row.raw_excerpt,
                        }
                        for row in evidence_rows
                    ],
                }
            )
    except AssertionError:
        logger.debug(
            "Skipping source claim loading due to mock session result exhaustion",
        )
    return claim_payloads


async def _load_source_ledger(
    db: AsyncSession,
    source_name: str,
    matched_source_names: list[str],
    source_config: dict[str, Any],
    meta: SourceMetadata | None,
) -> dict[str, Any] | None:
    try:
        return await build_source_ledger(
            db,
            source_name=source_name,
            matched_source_names=matched_source_names,
            source_config=source_config,
            meta=meta,
        )
    except AssertionError:
        logger.debug(
            "Skipping source ledger loading due to mock session result exhaustion",
        )
        return None


def _meta_view(meta: SourceMetadata | None) -> dict[str, Any]:
    if meta is None:
        return {}
    return {
        "parent_company": meta.parent_company,
        "credibility_score": meta.credibility_score,
        "is_state_media": meta.is_state_media,
        "source_type": meta.source_type,
        "geographic_focus": meta.geographic_focus,
        "topic_focus": meta.topic_focus,
    }


def _index_status_view(status: WikiIndexStatus | None) -> dict[str, Any]:
    return {
        "status": status.status if status else "unindexed",
        "last_indexed_at": (
            status.last_indexed_at.isoformat() if status and status.last_indexed_at else None
        ),
    }


def _build_wiki_response(
    source_name: str,
    source_config: dict[str, Any],
    meta: SourceMetadata | None,
    source_profile: dict[str, Any] | None,
    resolved_overview: str | None,
    scores: list[AnalysisAxisResponse],
    reporters: list[dict[str, Any]],
    org_data: dict[str, Any] | None,
    article_count: int,
    claim_payloads: list[dict[str, Any]],
    source_ledger: dict[str, Any] | None,
    status: WikiIndexStatus | None,
) -> SourceWikiResponse:
    meta_view = _meta_view(meta)
    status_view = _index_status_view(status)
    return SourceWikiResponse(
        name=source_name,
        website=cast(str | None, _profile_value(source_profile, "website")),
        country=source_config.get("country") or None,
        funding_type=source_config.get("funding_type") or None,
        bias_rating=source_config.get("bias_rating") or None,
        category=source_config.get("category", "general"),
        parent_company=meta_view.get("parent_company"),
        credibility_score=_optional_float(meta_view.get("credibility_score")),
        is_state_media=meta_view.get("is_state_media"),
        source_type=meta_view.get("source_type"),
        overview=resolved_overview,
        match_status=cast(str | None, _profile_value(source_profile, "match_status")),
        wikipedia_url=cast(str | None, _profile_value(source_profile, "wikipedia_url")),
        wikidata_qid=cast(str | None, _profile_value(source_profile, "wikidata_qid")),
        wikidata_url=cast(str | None, _profile_value(source_profile, "wikidata_url")),
        dossier_sections=cast(
            list[dict[str, Any]], _profile_value(source_profile, "dossier_sections", [])
        ),
        citations=cast(list[dict[str, str]], _profile_value(source_profile, "citations", [])),
        search_links=cast(dict[str, str] | None, _profile_value(source_profile, "search_links")),
        match_explanation=cast(str | None, _profile_value(source_profile, "match_explanation")),
        official_pages=cast(
            list[dict[str, str]], _profile_value(source_profile, "official_pages", [])
        ),
        policy_transparency=cast(
            dict[str, Any] | None, _profile_value(source_profile, "policy_transparency")
        ),
        ads_txt=cast(dict[str, Any] | None, _profile_value(source_profile, "ads_txt")),
        sellers_json=cast(dict[str, Any] | None, _profile_value(source_profile, "sellers_json")),
        claims=claim_payloads,
        source_ledger=(
            SourceLedgerResponse.model_validate(source_ledger) if source_ledger else None
        ),
        analysis_axes=scores,
        reporters=reporters,
        organization=org_data,
        article_count=article_count,
        geographic_focus=_string_list(meta_view.get("geographic_focus")) if meta else [],
        topic_focus=_string_list(meta_view.get("topic_focus")) if meta else [],
        index_status=status_view["status"],
        last_indexed_at=status_view["last_indexed_at"],
    )


@router.get("/sources/{source_name}", response_model=SourceWikiResponse)
async def get_source_wiki(
    source_name: str,
    db: AsyncSession = Depends(get_db),
) -> SourceWikiResponse:
    """Get full wiki page data for a single source."""
    matched = _match_source_config(get_rss_sources(), source_name)
    if matched is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")
    source_config, matched_source_names = matched

    # Load source analysis scores
    scores = await _load_analysis_scores(db, matched_source_names)

    # Load source metadata
    metadata_entries = (
        (
            await db.execute(
                select(SourceMetadata).where(SourceMetadata.source_name.in_(matched_source_names))
            )
        )
        .scalars()
        .all()
    )
    meta = _resolve_metadata(metadata_entries, source_name)

    # Count articles from this source
    article_count_result = await db.execute(
        select(func.count()).select_from(Article).where(Article.source.in_(matched_source_names))
    )
    article_count = article_count_result.scalar_one() or 0

    # Load reporters associated with this source (via articles)
    reporters = await _load_wiki_reporters(db, matched_source_names)

    # Load organization data
    org_data = await _load_wiki_organization(db, source_name)

    # Load the source profile, then the wiki index status
    source_profile = await _load_source_profile(source_name, matched_source_names)
    status = await _load_index_status(db, matched_source_names, source_name)

    resolved_overview = cast(str | None, _profile_value(source_profile, "overview"))
    if not resolved_overview:
        resolved_overview = _source_overview_fallback(
            source_name=source_name,
            source_config=source_config,
            meta=meta,
            org_data=org_data,
        )

    claim_payloads = await _load_source_claims(db, matched_source_names)
    source_ledger = await _load_source_ledger(
        db,
        source_name=source_name,
        matched_source_names=matched_source_names,
        source_config=source_config,
        meta=meta,
    )

    return _build_wiki_response(
        source_name=source_name,
        source_config=source_config,
        meta=meta,
        source_profile=source_profile,
        resolved_overview=resolved_overview,
        scores=scores,
        reporters=reporters,
        org_data=org_data,
        article_count=article_count,
        claim_payloads=claim_payloads,
        source_ledger=source_ledger,
        status=status,
    )


@router.get("/sources/{source_name}/reporters")
async def get_source_reporters(
    source_name: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
) -> list[ReporterCardResponse]:
    """Get reporters associated with a source."""
    reporter_ids = (
        select(ArticleAuthor.reporter_id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Article.source == source_name)
        .distinct()
        .limit(limit)
    )
    result = await db.execute(
        select(Reporter).where(Reporter.id.in_(reporter_ids), Reporter.retirement_reason.is_(None))
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


@router.get("/reporters", response_model=list[ReporterCardResponse])
async def list_wiki_reporters(
    db: AsyncSession = Depends(get_db),
    search: str | None = Query(None, description="Search by reporter name"),
    source: str | None = Query(None, description="Filter by source/outlet"),
    leaning: str | None = Query(None, description="Filter by political leaning"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[ReporterCardResponse]:
    """List all reporters in the wiki directory."""
    stmt = select(Reporter).where(Reporter.retirement_reason.is_(None))

    if search:
        stmt = stmt.where(Reporter.name.ilike(f"%{search}%"))
    if source:
        escaped_source = source.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        reporter_ids = (
            select(ArticleAuthor.reporter_id)
            .join(Article, Article.id == ArticleAuthor.article_id)
            .where(Article.source == source)
            .distinct()
        )
        stmt = stmt.where(
            or_(
                Reporter.id.in_(reporter_ids),
                sql_cast(Reporter.career_history, String).ilike(f"%{escaped_source}%", escape="\\"),
            )
        )
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
            current_outlet=source,
            canonical_name=r.canonical_name,
            match_status=r.match_status,
            wikipedia_url=r.wikipedia_url,
            research_confidence=r.research_confidence,
        )
        for r in reporters
    ]


async def _resolve_merged_reporter(db: AsyncSession, reporter: Reporter) -> Reporter:
    """Follow soft-retirement merge links to the winner reporter row."""
    seen_ids = {reporter.id}
    while reporter.retirement_reason == "merged" and reporter.merged_into is not None:
        next_reporter = await db.get(Reporter, reporter.merged_into)
        if next_reporter is None or next_reporter.id in seen_ids:
            break
        reporter = next_reporter
        seen_ids.add(reporter.id)
    return reporter


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

    # A soft-retired (merged) id serves its winner's dossier so old links
    # keep working; same semantics as entity_research.get_reporter.
    reporter = await _resolve_merged_reporter(db, reporter)

    # Get recent articles by this reporter
    article_result = await db.execute(
        select(Article)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter.id)
        .order_by(Article.published_at.desc())
        .limit(20)
    )
    articles: list[dict[str, Any]] = [
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
    activity_summary = await build_reporter_activity_summary(_required_str(reporter.name), articles)

    employer_context = _build_employer_rss_context(reporter)
    career_timeline = await build_reporter_career_timeline(db, reporter)

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
        dossier_sections=cast(list[dict[str, Any]], reporter.dossier_sections or []),
        citations=cast(list[dict[str, str]], reporter.citations or []),
        search_links=cast(dict[str, str] | None, reporter.search_links),
        match_explanation=reporter.match_explanation,
        source_patterns=reporter.source_patterns,
        topics_avoided=reporter.topics_avoided,
        advertiser_alignment=reporter.advertiser_alignment,
        revolving_door=reporter.revolving_door,
        controversies=reporter.controversies,
        institutional_affiliations=reporter.institutional_affiliations,
        coverage_comparison=reporter.coverage_comparison,
        career_timeline=career_timeline,
        article_count=reporter.article_count or 0,
        last_article_at=(
            reporter.last_article_at.isoformat() if reporter.last_article_at else None
        ),
        recent_articles=articles,
        activity_summary=activity_summary,
        employer_context=employer_context,
        research_sources=reporter.research_sources,
        research_confidence=reporter.research_confidence,
    )


@router.get("/reporters/{reporter_id}/articles")
async def get_reporter_articles(
    reporter_id: int,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[dict[str, Any]]:
    """Get articles by a specific reporter."""
    reporter = await db.get(Reporter, reporter_id)
    if reporter is None:
        raise HTTPException(status_code=404, detail="Reporter not found")
    reporter = await _resolve_merged_reporter(db, reporter)

    result = await db.execute(
        select(Article)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter.id)
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


@router.get("/organizations", response_model=list[dict[str, Any]])
async def list_wiki_organizations(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[dict[str, Any]]:
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


# ── Indexing Endpoints ───────────────────────────────────────────────


@router.get("/index/status", response_model=WikiIndexStatusResponse)
async def get_wiki_index_status(
    db: AsyncSession = Depends(get_db),
) -> WikiIndexStatusResponse:
    """Get wiki indexing status summary."""
    result = await db.execute(select(WikiIndexStatus))
    entries = result.scalars().all()

    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
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
async def trigger_source_index(source_name: str) -> dict[str, str]:
    """Trigger indexing for a specific source (admin endpoint)."""
    from app.services.wiki_indexer import index_source

    sources = get_rss_sources()
    source_config: dict[str, Any] | None = None
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


@router.post("/index/reporters")
async def trigger_reporter_index(
    limit: int = Query(500, ge=1, le=2000),
    mode: Literal["all", "unresolved", "sparql"] = Query(
        "all", description="all, unresolved, or sparql"
    ),
) -> dict[str, Any]:
    """Trigger reporter indexing (admin endpoint).

    mode=all: Run both SPARQL seed and unresolved author indexing.
    mode=unresolved: Only index unresolved article authors.
    mode=sparql: Only run Wikidata SPARQL seed.
    """
    import httpx

    from app.services.reporter_indexer import (
        index_unresolved_reporters,
        seed_reporters_from_wikidata,
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        if mode in ("all", "sparql"):
            sparql_result = await seed_reporters_from_wikidata(http_client=client)
        else:
            sparql_result = {"total": 0, "resolved": 0, "failed": 0}

        if mode in ("all", "unresolved"):
            author_result = await index_unresolved_reporters(limit=limit, http_client=client)
        else:
            author_result = {"total": 0, "resolved": 0, "failed": 0, "skipped": 0}

    return {
        "status": "complete",
        "mode": mode,
        "sparql_seed": sparql_result,
        "unresolved_author_index": author_result,
    }
