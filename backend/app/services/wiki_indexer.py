"""
Wiki Indexer - Background indexing service for the Media Accountability Wiki.

Handles:
- Seeding wiki data for all sources from rss_sources.json
- Scoring propaganda filters for each source
- Re-indexing stale entries (older than 7 days)
- Tracking index status in wiki_index_status table

Can be used as:
- CLI: python -m app.services.wiki_indexer --all
- Background task: launched from main.py on server startup
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, cast

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.logging import get_logger
from app.database import (
    AsyncSessionLocal,
    Organization,
    PropagandaFilterScore,
    Reporter,
    SourceMetadata,
    WikiIndexStatus,
    get_utc_now,
)
from app.data.rss_sources import get_rss_sources
from app.services.funding_researcher import get_funding_researcher
from app.services.propaganda_scorer import get_propaganda_scorer

logger = get_logger("wiki_indexer")

# How old an entry can be before it's considered stale
STALE_THRESHOLD_DAYS = 7

# Delay between indexing individual sources to avoid rate limits
INDEX_DELAY_SECONDS = float(2.0)


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for wiki indexing")
    factory = cast(async_sessionmaker, AsyncSessionLocal)
    return factory()


async def _upsert_index_status(
    session: AsyncSession,
    entity_type: str,
    entity_name: str,
    status: str,
    error_message: Optional[str] = None,
    duration_ms: Optional[int] = None,
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


async def _save_filter_scores(
    session: AsyncSession,
    source_name: str,
    scores: list,
) -> None:
    """Persist propaganda filter scores to the database."""
    for score in scores:
        score_dict = score.to_dict()
        result = await session.execute(
            select(PropagandaFilterScore).where(
                PropagandaFilterScore.source_name == source_name,
                PropagandaFilterScore.filter_name == score_dict["filter_name"],
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
            entry = PropagandaFilterScore(
                source_name=source_name,
                filter_name=score_dict["filter_name"],
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
    org_data: Dict[str, Any],
) -> None:
    """Create or update an Organization row from research data."""
    normalized = org_data.get("normalized_name", "")
    if not normalized:
        return

    result = await session.execute(
        select(Organization).where(Organization.normalized_name == normalized)
    )
    existing = result.scalar_one_or_none()

    if existing:
        for attr in (
            "funding_type",
            "funding_sources",
            "ein",
            "annual_revenue",
            "media_bias_rating",
            "factual_reporting",
            "wikipedia_url",
            "research_sources",
            "research_confidence",
        ):
            value = org_data.get(attr)
            if value is not None:
                setattr(existing, attr, value)
        existing.updated_at = get_utc_now()
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
        )
        session.add(org)

    await session.commit()


async def index_source(source_name: str, source_config: Dict[str, Any]) -> bool:
    """Index a single source: research org data and score propaganda filters.

    Uses a single LLM call to both score propaganda filters and fill org
    metadata gaps (when research_confidence is not "high").

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

        # Apply RSS config funding_type as authoritative source
        # Priority: KNOWN_ORGS (already in org_data) > rss_sources.json > ProPublica/Wikipedia
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
        }

        # Score propaganda filters (may also return org metadata updates)
        scorer = get_propaganda_scorer()
        result = await scorer.score_source(
            source_name=source_name,
            org_data=org_data,
            source_metadata=source_metadata,
        )

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

        # Persist filter scores
        await _save_filter_scores(session, source_name, result.scores)

        duration_ms = int((time.monotonic() - start) * 1000)
        await _upsert_index_status(
            session, "source", source_name, "complete", duration_ms=duration_ms
        )

        logger.info(
            "Indexed source %s in %dms (scores: %s)",
            source_name,
            duration_ms,
            ", ".join(f"{s.filter_name}={s.score}" for s in result.scores),
        )
        return True

    except Exception as exc:
        logger.error("Failed to index source %s: %s", source_name, exc)
        await _upsert_index_status(
            session, "source", source_name, "failed", error_message=str(exc)
        )
        return False
    finally:
        await session.close()


async def index_all_sources(
    delay_seconds: float = INDEX_DELAY_SECONDS,
) -> Dict[str, Any]:
    """Index all sources from rss_sources.json.

    Returns summary stats.
    """
    sources = get_rss_sources()

    # Deduplicate sources by base name (e.g., "BBC" covers "BBC News - Home", etc.)
    unique_sources: Dict[str, Dict[str, Any]] = {}
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
        result = await index_source(name, config)
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
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("Wiki indexing complete: %s", summary)
    return summary


async def index_stale_sources(
    stale_days: int = STALE_THRESHOLD_DAYS,
    delay_seconds: float = INDEX_DELAY_SECONDS,
) -> Dict[str, Any]:
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
            select(WikiIndexStatus.entity_name).where(
                WikiIndexStatus.entity_type == "source"
            )
        )
        indexed_names = {row[0] for row in result2.all()}

        # Get unique source base names
        unique_sources: Dict[str, Dict[str, Any]] = {}
        for name, config in all_sources.items():
            base_name = name.split(" - ")[0].strip()
            if base_name not in unique_sources:
                unique_sources[base_name] = config

        unindexed = {
            name: config
            for name, config in unique_sources.items()
            if name not in indexed_names
        }

        stale_names = {entry.entity_name for entry in stale_entries}
        to_reindex = {
            name: unique_sources.get(name, {})
            for name in stale_names
            if name in unique_sources
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
            result_ok = await index_source(name, config)
            if result_ok:
                success += 1
            else:
                failed += 1

            if i < total:
                await asyncio.sleep(delay_seconds)

        return {"total": total, "success": success, "failed": failed}

    finally:
        await session.close()


async def get_index_status_summary() -> Dict[str, Any]:
    """Get a summary of wiki indexing status."""
    session = await _get_session()
    try:
        result = await session.execute(select(WikiIndexStatus))
        entries = result.scalars().all()

        by_status: Dict[str, int] = {}
        by_type: Dict[str, int] = {}
        for entry in entries:
            by_status[entry.status] = by_status.get(entry.status, 0) + 1
            by_type[entry.entity_type] = by_type.get(entry.entity_type, 0) + 1

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
    """
    # Initial delay to let the server finish startup
    await asyncio.sleep(300)

    while True:
        try:
            logger.info("Running periodic wiki refresh...")
            summary = await index_stale_sources(stale_days=stale_days)
            logger.info("Periodic wiki refresh complete: %s", summary)
        except asyncio.CancelledError:
            logger.info("Wiki refresh task cancelled")
            return
        except Exception as exc:
            logger.error("Wiki refresh failed: %s", exc, exc_info=True)

        await asyncio.sleep(interval_seconds)
