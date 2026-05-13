"""Wiki Indexer - Background indexing service for the Media Accountability Wiki.

Handles:
- Seeding wiki data for all sources from rss_sources.json
- Scoring source-analysis axes for each source
- Re-indexing stale entries (older than 7 days)
- Tracking index status in wiki_index_status table

Can be used as:
- CLI: python -m app.services.wiki_indexer --all
- Background task: launched from main.py on server startup
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from datetime import datetime, timedelta, UTC
from importlib import import_module
from typing import Any, Protocol, TypedDict, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.database import (
    AsyncSessionLocal,
    Organization,
    SourceClaim,
    SourceClaimEvidence,
    SourceAnalysisScore,
    WikiIndexStatus,
    get_utc_now,
)
from app.data.rss_sources import get_rss_sources
from app.services.funding_researcher import get_funding_researcher
from app.services.reporter_indexer import index_stale_reporters
from app.services.source_claims import (
    build_source_claim_inputs,
    collect_article_behavior_stats,
    sync_source_claims,
)

logger = get_logger("wiki_indexer")

# How old an entry can be before it's considered stale
STALE_THRESHOLD_DAYS = 7

# Delay between indexing individual sources to avoid rate limits
INDEX_DELAY_SECONDS = 2.0


class _AnalysisScorePayload(TypedDict):
    axis_name: str
    score: int
    confidence: str
    prose_explanation: str
    citations: list[dict[str, str]]
    empirical_basis: str
    scored_by: str


class _AnalysisScoreLike(Protocol):
    axis_name: str
    score: int

    def to_dict(self) -> _AnalysisScorePayload: ...


class _ScoringResultLike(Protocol):
    scores: list[_AnalysisScoreLike]
    org_updates: dict[str, Any] | None


class _DisabledScoringResult:
    scores: list[_AnalysisScoreLike]
    org_updates: dict[str, Any] | None

    def __init__(self) -> None:
        """Initialize."""
        self.scores = []
        self.org_updates = {}


class _SourceAnalysisScorerLike(Protocol):
    async def score_source(
        self,
        source_name: str,
        org_data: dict[str, Any] | None = None,
        source_metadata: dict[str, Any] | None = None,
        article_corpus_stats: dict[str, Any] | None = None,
    ) -> _ScoringResultLike: ...


def get_source_analysis_scorer() -> _SourceAnalysisScorerLike:
    """Get Source Analysis Scorer."""
    scorer_module = import_module("app.services.source_analysis_scorer")
    get_scorer = cast(
        Callable[[], _SourceAnalysisScorerLike],
        scorer_module.get_source_analysis_scorer,
    )
    return get_scorer()


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for wiki indexing")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    return factory()


async def _upsert_index_status(
    session: AsyncSession,
    entity_type: str,
    entity_name: str,
    status: str,
    error_message: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """Create or update the wiki_index_status row for an entity."""
    result = await session.execute(
        select(WikiIndexStatus).where(
            WikiIndexStatus.entity_type == entity_type,
            WikiIndexStatus.entity_name == entity_name,
        )
    )
    existing = result.scalar_one_or_none()

    now = get_utc_now()

    if existing:
        existing.status = status
        existing.error_message = error_message
        existing.updated_at = now
        if status == "complete":
            existing.last_indexed_at = now
            existing.next_index_at = now + timedelta(days=STALE_THRESHOLD_DAYS)
            existing.index_duration_ms = duration_ms
        elif status == "failed":
            existing.error_message = error_message
            # Retry sooner on failure
            existing.next_index_at = now + timedelta(hours=6)
    else:
        entry = WikiIndexStatus(
            entity_type=entity_type,
            entity_name=entity_name,
            status=status,
            error_message=error_message,
            index_duration_ms=duration_ms,
            last_indexed_at=now if status == "complete" else None,
            next_index_at=(
                now + timedelta(days=STALE_THRESHOLD_DAYS)
                if status == "complete"
                else now + timedelta(hours=6)
            ),
        )
        session.add(entry)

    await session.commit()


async def _save_analysis_scores(
    session: AsyncSession,
    source_name: str,
    scores: list[_AnalysisScoreLike],
) -> None:
    """Persist source-analysis scores to the database."""
    for score in scores:
        score_dict = score.to_dict()
        result = await session.execute(
            select(SourceAnalysisScore).where(
                SourceAnalysisScore.source_name == source_name,
                SourceAnalysisScore.axis_name == score_dict["axis_name"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.score = score_dict["score"]
            existing.confidence = score_dict["confidence"]
            existing.prose_explanation = score_dict["prose_explanation"]
            existing.citations = score_dict["citations"]
            existing.empirical_basis = score_dict["empirical_basis"]
            existing.scored_by = score_dict.get("scored_by", "llm")
            existing.last_scored_at = get_utc_now()
            existing.updated_at = get_utc_now()
        else:
            entry = SourceAnalysisScore(
                source_name=source_name,
                axis_name=score_dict["axis_name"],
                score=score_dict["score"],
                confidence=score_dict["confidence"],
                prose_explanation=score_dict["prose_explanation"],
                citations=score_dict["citations"],
                empirical_basis=score_dict["empirical_basis"],
                scored_by=score_dict.get("scored_by", "llm"),
            )
            session.add(entry)

    await session.commit()


async def _upsert_organization(
    session: AsyncSession,
    org_data: dict[str, Any],
) -> int | None:
    """Create or update an Organization row from research data.

    Returns the organization's id.  Also resolves the parent_org string to
    ``parent_org_id`` so the ownership graph has real edges.
    """
    normalized = org_data.get("normalized_name", "")
    if not normalized:
        return None

    result = await session.execute(
        select(Organization).where(Organization.normalized_name == normalized)
    )
    existing = result.scalar_one_or_none()

    _updateable_attrs = (
        "funding_type",
        "funding_sources",
        "ein",
        "annual_revenue",
        "media_bias_rating",
        "factual_reporting",
        "wikipedia_url",
        "research_sources",
        "research_confidence",
        "owned_by",
        "parent_orgs",
        "part_of",
        "headquarters",
        "inception",
        "official_website",
        "cik",
        "opensecrets_data",
        "conflict_flags",
    )

    if existing:
        for attr in _updateable_attrs:
            value = org_data.get(attr)
            if value is not None:
                setattr(existing, attr, value)
        existing.updated_at = get_utc_now()
        org = existing
    else:
        org = Organization(
            name=org_data.get("name"),
            normalized_name=normalized,
            org_type=org_data.get("org_type"),
            funding_type=org_data.get("funding_type"),
            funding_sources=org_data.get("funding_sources"),
            ein=org_data.get("ein"),
            annual_revenue=org_data.get("annual_revenue"),
            media_bias_rating=org_data.get("media_bias_rating"),
            factual_reporting=org_data.get("factual_reporting"),
            website=org_data.get("website"),
            wikipedia_url=org_data.get("wikipedia_url"),
            research_sources=org_data.get("research_sources"),
            research_confidence=org_data.get("research_confidence"),
            owned_by=org_data.get("owned_by", []),
            parent_orgs=org_data.get("parent_orgs", []),
            part_of=org_data.get("part_of", []),
            headquarters=org_data.get("headquarters", []),
            inception=org_data.get("inception"),
            official_website=org_data.get("official_website"),
            cik=org_data.get("cik"),
            opensecrets_data=org_data.get("opensecrets_data", {}),
            conflict_flags=org_data.get("conflict_flags", []),
        )
        session.add(org)

    await session.flush()

    # Resolve parent_org string to parent_org_id
    parent_org_name = org_data.get("parent_org")
    if parent_org_name and isinstance(parent_org_name, str):
        parent_normalized = parent_org_name.lower().strip()
        if parent_normalized and parent_normalized != normalized:
            parent_result = await session.execute(
                select(Organization).where(Organization.normalized_name == parent_normalized)
            )
            parent_row = parent_result.scalar_one_or_none()
            if parent_row is not None:
                org.parent_org_id = parent_row.id
                org.updated_at = get_utc_now()

    await session.commit()
    return cast(int, org.id)


async def _hydrate_org_claims(
    session: AsyncSession,
    org_data: dict[str, Any],
    source_name: str,
) -> dict[str, Any]:
    claim_result = await session.execute(
        select(SourceClaim).where(
            SourceClaim.source_name == source_name,
            SourceClaim.is_current.is_(True),
        )
    )
    claim_rows = claim_result.scalars().all()

    hydrated_claims: list[dict[str, Any]] = []
    for claim_row in claim_rows:
        evidence_result = await session.execute(
            select(SourceClaimEvidence).where(SourceClaimEvidence.claim_id == claim_row.id)
        )
        evidence_rows = evidence_result.scalars().all()
        hydrated_claims.append(
            {
                "id": claim_row.id,
                "type": claim_row.claim_type,
                "kind": claim_row.claim_kind,
                "value": claim_row.claim_value,
                "confidence": claim_row.confidence,
                "evidence": [
                    {
                        "source_type": evidence_row.source_type,
                        "source_name": evidence_row.source_name,
                        "source_url": evidence_row.source_url,
                        "raw_excerpt": evidence_row.raw_excerpt,
                    }
                    for evidence_row in evidence_rows
                ],
            }
        )

    hydrated = dict(org_data)
    hydrated["source_claims"] = hydrated_claims
    return hydrated


async def index_source(
    source_name: str,
    source_config: dict[str, Any],
    enable_llm_scoring: bool = True,
) -> bool:
    """Index a single source: research org data and score source-analysis axes.

    Uses a single LLM call to both score source-analysis axes and fill org
    metadata gaps (when research_confidence is not "high").

    Args:
        source_name: Name of the source to index
        source_config: Configuration dict for the source
        enable_llm_scoring: If False, skip LLM-based source analysis (for background tasks)

    Returns True on success, False on failure.
    """
    start = time.monotonic()
    logger.info("Indexing source: %s", source_name)

    session = await _get_session()
    try:
        await _upsert_index_status(session, "source", source_name, "indexing")

        # Research organization data WITHOUT AI enhancement
        # The scorer's LLM call handles org metadata when needed
        researcher = get_funding_researcher()
        org_data = await researcher.research_organization(source_name, use_ai=False)

        # Prefer existing known-org data, then RSS config, then external research.
        rss_funding = source_config.get("funding_type", "").strip()
        if rss_funding and "known_data" not in org_data.get("research_sources", []):
            org_data["funding_type"] = rss_funding.lower()
            if "rss_config" not in org_data.get("research_sources", []):
                org_data.setdefault("research_sources", []).append("rss_config")

        source_metadata = {
            "country": source_config.get("country", ""),
            "funding_type": source_config.get("funding_type", ""),
            "political_bias": source_config.get("bias_rating", ""),
            "source_type": source_config.get("category", "general"),
            "site_url": source_config.get("site_url", ""),
        }

        configured_site = source_config.get("site_url")
        if isinstance(configured_site, str) and configured_site.strip():
            org_data.setdefault("website", configured_site.strip())

        # Score source-analysis axes (LLM call) - only when explicitly enabled
        result: _ScoringResultLike
        if enable_llm_scoring:
            scorer = get_source_analysis_scorer()
            result = await scorer.score_source(
                source_name=source_name,
                org_data=org_data,
                source_metadata=source_metadata,
            )
        else:
            result = _DisabledScoringResult()

        # Apply org metadata updates from the consolidated LLM call
        if result.org_updates:
            for field in (
                "funding_type",
                "parent_org",
                "media_bias_rating",
                "factual_reporting",
            ):
                value = result.org_updates.get(field)
                if value and not org_data.get(field):
                    org_data[field] = value
            if "ai_inference" not in org_data.get("research_sources", []):
                org_data.setdefault("research_sources", []).append("ai_inference")

        # Persist organization data
        await _upsert_organization(session, org_data)

        # Persist analysis scores (empty when LLM disabled)
        await _save_analysis_scores(session, source_name, result.scores)

        # Persist claim-level dossier fields with provenance and versioning
        article_count_30d, top_topics_30d = await collect_article_behavior_stats(
            session,
            source_name,
            days=30,
        )
        claim_inputs = build_source_claim_inputs(
            source_name=source_name,
            source_config=source_config,
            org_data=org_data,
            article_count_30d=article_count_30d,
            top_topics_30d=top_topics_30d,
        )
        await sync_source_claims(session, source_name, claim_inputs)

        # Keep organization profile in sync with freshly persisted claim provenance.
        hydrated_org_data = await _hydrate_org_claims(session, org_data, source_name)
        await _upsert_organization(session, hydrated_org_data)

        duration_ms = int((time.monotonic() - start) * 1000)
        await _upsert_index_status(
            session, "source", source_name, "complete", duration_ms=duration_ms
        )

        scores_str = (
            ", ".join(f"{s.axis_name}={s.score}" for s in result.scores)
            if result.scores
            else "disabled"
        )
        logger.info(
            "Indexed source %s in %dms (scores: %s)",
            source_name,
            duration_ms,
            scores_str,
        )
        return True

    except Exception as exc:
        logger.error("Failed to index source %s: %s", source_name, exc)
        await _upsert_index_status(session, "source", source_name, "failed", error_message=str(exc))
        return False
    finally:
        await session.close()


async def index_all_sources(
    delay_seconds: float = INDEX_DELAY_SECONDS,
    enable_llm_scoring: bool = True,
) -> dict[str, Any]:
    """Index all sources from rss_sources.json.

    Args:
        delay_seconds: Delay between indexing each source
        enable_llm_scoring: If True, run LLM-based source analysis (default for CLI)

    Returns summary stats.
    """
    sources = get_rss_sources()

    # Deduplicate sources by base name (e.g., "BBC" covers "BBC News - Home", etc.)
    unique_sources: dict[str, dict[str, Any]] = {}
    for name, config in sources.items():
        # Use the base name (before " - ") for dedup
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config

    total = len(unique_sources)
    success = 0
    failed = 0

    logger.info("Starting wiki indexing for %d unique sources", total)

    for i, (name, config) in enumerate(unique_sources.items(), 1):
        logger.info("[%d/%d] Indexing: %s", i, total, name)
        result = await index_source(name, config, enable_llm_scoring=enable_llm_scoring)
        if result:
            success += 1
        else:
            failed += 1

        # Rate limit
        if i < total:
            await asyncio.sleep(delay_seconds)

    summary = {
        "total": total,
        "success": success,
        "failed": failed,
        "completed_at": datetime.now(UTC).isoformat(),
    }
    logger.info("Wiki indexing complete: %s", summary)
    return summary


async def index_stale_sources(
    stale_days: int = STALE_THRESHOLD_DAYS,
    delay_seconds: float = INDEX_DELAY_SECONDS,
    enable_llm_scoring: bool = False,
) -> dict[str, Any]:
    """Re-index sources whose wiki data is older than stale_days."""
    session = await _get_session()
    try:
        cutoff = get_utc_now() - timedelta(days=stale_days)

        # Find stale entries
        result = await session.execute(
            select(WikiIndexStatus).where(
                WikiIndexStatus.entity_type == "source",
                WikiIndexStatus.status.in_(["complete", "stale", "failed"]),
                WikiIndexStatus.last_indexed_at < cutoff,
            )
        )
        stale_entries = result.scalars().all()

        # Find sources that have never been indexed
        all_sources = get_rss_sources()
        result2 = await session.execute(
            select(WikiIndexStatus.entity_name).where(WikiIndexStatus.entity_type == "source")
        )
        indexed_names = {row[0] for row in result2.all()}

        # Get unique source base names
        unique_sources: dict[str, dict[str, Any]] = {}
        for name, config in all_sources.items():
            base_name = name.split(" - ")[0].strip()
            if base_name not in unique_sources:
                unique_sources[base_name] = config

        unindexed = {
            name: config for name, config in unique_sources.items() if name not in indexed_names
        }

        stale_names = {entry.entity_name for entry in stale_entries}
        to_reindex = {
            name: unique_sources.get(name, {}) for name in stale_names if name in unique_sources
        }

        all_to_index = {**to_reindex, **unindexed}
        total = len(all_to_index)

        if total == 0:
            logger.info("No stale or unindexed wiki entries found")
            return {"total": 0, "success": 0, "failed": 0}

        success = 0
        failed = 0

        logger.info(
            "Found %d stale + %d unindexed = %d sources to index",
            len(to_reindex),
            len(unindexed),
            total,
        )

        for i, (name, config) in enumerate(all_to_index.items(), 1):
            logger.info("[%d/%d] Re-indexing: %s", i, total, name)
            result_ok = await index_source(name, config, enable_llm_scoring=enable_llm_scoring)
            if result_ok:
                success += 1
            else:
                failed += 1

            if i < total:
                await asyncio.sleep(delay_seconds)

        return {"total": total, "success": success, "failed": failed}

    finally:
        await session.close()


async def get_index_status_summary() -> dict[str, Any]:
    """Get a summary of wiki indexing status."""
    session = await _get_session()
    try:
        result = await session.execute(select(WikiIndexStatus))
        entries = result.scalars().all()

        by_status: dict[str, int] = {}
        by_type: dict[str, int] = {}
        for entry in entries:
            status_key = cast(str, entry.status)
            entity_type_key = cast(str, entry.entity_type)
            by_status[status_key] = by_status.get(status_key, 0) + 1
            by_type[entity_type_key] = by_type.get(entity_type_key, 0) + 1

        return {
            "total_entries": len(entries),
            "by_status": by_status,
            "by_type": by_type,
        }
    finally:
        await session.close()


async def periodic_wiki_refresh(
    interval_seconds: int = 86400,
    stale_days: int = STALE_THRESHOLD_DAYS,
) -> None:
    """Background task that periodically re-indexes stale wiki entries.

    Designed to be launched as an asyncio task from main.py.
    LLM-based scoring is controlled by BACKGROUND_LLM_SCORING_ENABLED env var.
    """
    from app.core.config import settings

    # Initial delay to let the server finish startup
    await asyncio.sleep(300)

    while True:
        try:
            logger.info("Running periodic wiki refresh...")
            source_summary = await index_stale_sources(
                stale_days=stale_days,
                enable_llm_scoring=settings.background_llm_scoring_enabled,
            )
            logger.info("Periodic wiki refresh complete (sources): %s", source_summary)
            reporter_summary = await index_stale_reporters(stale_days=stale_days)
            logger.info("Periodic wiki refresh complete (reporters): %s", reporter_summary)
        except asyncio.CancelledError:
            logger.info("Wiki refresh task cancelled")
            return
        except Exception as exc:
            logger.error("Wiki refresh failed: %s", exc, exc_info=True)

        await asyncio.sleep(interval_seconds)
