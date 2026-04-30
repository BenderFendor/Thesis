"""
Reporter Indexer - Background indexing service for the reporter wiki.

Handles:
- Proactively resolving reporter profiles from unresolved article authors
- Bulk seeding reporters via Wikidata SPARQL queries
- Tracking reporter index status in wiki_index_status table
- Re-indexing stale reporter entries (older than 7 days)

Can be used as:
- CLI: python -m app.services.reporter_indexer --all
- Background task: launched from wiki_indexer periodic refresh
"""

from __future__ import annotations

import asyncio
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, cast

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.database import (
    Article,
    AsyncSessionLocal,
    Reporter,
    WikiIndexStatus,
    get_utc_now,
)
from app.data.rss_sources import get_rss_sources
from app.services.entity_wiki_service import build_reporter_dossier, build_resolver_key
from app.services.reporter_profile_store import upsert_reporter_profile

logger = get_logger("reporter_indexer")

STALE_THRESHOLD_DAYS = 7
INDEX_DELAY_SECONDS = float(0.3)
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
SPARQL_BATCH_SIZE = 20
SPARQL_USER_AGENT = "ScoopNewsReporterIndexer/1.0 (https://github.com/anomalyco/Thesis)"

WIKIDATA_JOURNALIST_SPARQL = """
SELECT DISTINCT ?journalist ?journalistLabel ?employerLabel ?twitter ?beatLabel WHERE {
  VALUES ?employerLabel { %s }
  ?journalist wdt:P106 wd:Q1930187 .
  ?journalist wdt:P108 ?employer .
  ?employer rdfs:label ?employerLabel .
  FILTER(LANG(?employerLabel) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  OPTIONAL { ?journalist wdt:P2002 ?twitter . }
  OPTIONAL { ?journalist wdt:P101 ?beat .  ?beat rdfs:label ?beatLabel . FILTER(LANG(?beatLabel) = "en") }
}
"""


def _normalize_for_resolver(name: str) -> str:
    return " ".join(name.lower().strip().split())


def _is_fetchable_article_url(url: str) -> bool:
    from urllib.parse import urlparse

    host = urlparse(url).netloc.lower().replace("www.", "")
    return bool(host) and not host.endswith(".example.com") and host != "example.com"


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for reporter indexing")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    return factory()


async def _upsert_index_status(
    session: AsyncSession,
    entity_type: str,
    entity_name: str,
    status: str,
    error_message: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
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


async def _get_unresolved_author_names(
    session: AsyncSession, limit: int = 500
) -> List[Tuple[str, Optional[str]]]:
    """Find authors in articles that do not yet have a resolved Reporter record."""
    result = await session.execute(
        select(Article.author, Article.source)
        .where(Article.author.isnot(None))
        .where(Article.author != "")
        .distinct()
        .limit(limit * 3)
    )
    all_authors: List[Tuple[str, Optional[str]]] = []
    seen = set()
    for row in result.all():
        author_name = cast(str, row[0]).strip()
        source_name = cast(Optional[str], row[1])
        normalized = _normalize_for_resolver(author_name)
        if normalized and normalized not in seen:
            seen.add(normalized)
            all_authors.append((author_name, source_name))
            if len(all_authors) >= limit:
                break

    reporter_result = await session.execute(select(Reporter.normalized_name))
    existing_names = {cast(str, r[0]) for r in reporter_result.all()}

    unresolved = [
        (name, source)
        for name, source in all_authors
        if _normalize_for_resolver(name) not in existing_names
    ]
    return unresolved


async def index_unresolved_reporters(
    limit: int = 500,
    delay_seconds: float = INDEX_DELAY_SECONDS,
    http_client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    """Index reporters for all unresolved article authors."""
    session = await _get_session()
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=20.0)
    try:
        unresolved = await _get_unresolved_author_names(session, limit)
        if not unresolved:
            logger.info("No unresolved reporter names found")
            return {"total": 0, "resolved": 0, "failed": 0, "skipped": 0}

        resolved = 0
        failed = 0
        skipped = 0
        total = len(unresolved)

        logger.info("Indexing %d unresolved reporters", total)

        for i, (author_name, source_name) in enumerate(unresolved, 1):
            resolver_key = build_resolver_key(author_name, source_name)
            entity_name = resolver_key or _normalize_for_resolver(author_name)

            try:
                await _upsert_index_status(session, "reporter", entity_name, "indexing")

                profile = await build_reporter_dossier(
                    name=author_name,
                    organization=source_name,
                    http_client=client,
                )

                if profile.get("match_status") == "matched":
                    await upsert_reporter_profile(session, profile)
                    await _upsert_index_status(
                        session, "reporter", entity_name, "complete"
                    )
                    resolved += 1
                    logger.debug(
                        "[%d/%d] Resolved: %s -> %s",
                        i,
                        total,
                        author_name,
                        profile.get("canonical_name"),
                    )
                else:
                    await _upsert_index_status(
                        session, "reporter", entity_name, "complete"
                    )
                    skipped += 1
                    logger.debug(
                        "[%d/%d] Unresolvable: %s (status=%s)",
                        i,
                        total,
                        author_name,
                        profile.get("match_status"),
                    )

            except Exception as exc:
                await session.rollback()
                logger.error("Failed to index reporter %s: %s", author_name, exc)
                await _upsert_index_status(
                    session,
                    "reporter",
                    entity_name,
                    "failed",
                    error_message=str(exc),
                )
                failed += 1

            if i < total:
                await asyncio.sleep(delay_seconds)

        return {
            "total": total,
            "resolved": resolved,
            "failed": failed,
            "skipped": skipped,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        await session.close()
        if owned_client:
            await client.aclose()


async def seed_reporters_from_wikidata(
    http_client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    """Bulk-seed reporters from Wikidata using SPARQL.

    Queries Wikidata for journalists whose employer labels match outlets
    in the RSS catalog, then resolves full dossiers for each.
    """
    sources = get_rss_sources()
    unique_sources: Dict[str, Any] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config

    employer_names = sorted({name for name in unique_sources.keys() if len(name) > 2})

    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=30.0)
    try:
        all_journalist_names: List[Tuple[str, str]] = []

        for batch_start in range(0, len(employer_names), SPARQL_BATCH_SIZE):
            batch = employer_names[batch_start : batch_start + SPARQL_BATCH_SIZE]
            quoted = " ".join(f'"{employer}"@en' for employer in batch)
            query = WIKIDATA_JOURNALIST_SPARQL % quoted

            logger.info(
                "Querying Wikidata SPARQL batch %d-%d/%d ...",
                batch_start + 1,
                min(batch_start + SPARQL_BATCH_SIZE, len(employer_names)),
                len(employer_names),
            )

            sparql_url = (
                f"{WIKIDATA_SPARQL_URL}?"
                f"{urllib.parse.urlencode({'format': 'json', 'query': query})}"
            )
            response = await client.get(
                sparql_url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": SPARQL_USER_AGENT,
                },
            )

            if response.status_code != 200:
                logger.warning(
                    "Wikidata SPARQL batch failed: HTTP %d at batch %d-%d",
                    response.status_code,
                    batch_start + 1,
                    min(batch_start + SPARQL_BATCH_SIZE, len(employer_names)),
                )
                continue

            data = response.json()
            batch_bindings: Any = (data.get("results") or {}).get("bindings") or []

            for binding in batch_bindings:
                name = str(binding.get("journalistLabel", {}).get("value", "")).strip()
                employer = str(
                    binding.get("employerLabel", {}).get("value", "")
                ).strip()
                if name and employer:
                    all_journalist_names.append((name, employer))

            logger.debug("Batch returned %d results", len(batch_bindings))

        all_journalist_names = list(dict.fromkeys(all_journalist_names))

        logger.info(
            "Wikidata SPARQL returned %d unique journalist-employer pairs",
            len(all_journalist_names),
        )

        resolved = 0
        failed = 0
        total = len(all_journalist_names)

        session = await _get_session()
        try:
            for i, (name, employer) in enumerate(all_journalist_names, 1):
                resolver_key = build_resolver_key(name, employer)
                entity_name = resolver_key or _normalize_for_resolver(name)

                stmt = select(Reporter).where(Reporter.resolver_key == resolver_key)
                existing = (await session.execute(stmt)).scalar_one_or_none()
                if existing and existing.match_status == "matched":
                    resolved += 1
                    continue

                try:
                    profile = await build_reporter_dossier(
                        name=name,
                        organization=employer,
                        http_client=client,
                    )

                    if profile.get("match_status") == "matched":
                        await upsert_reporter_profile(session, profile)
                        await _upsert_index_status(
                            session, "reporter", entity_name, "complete"
                        )
                        resolved += 1

                        if resolved % 20 == 0:
                            logger.info(
                                "[%d/%d] SPARQL seeded: %d resolved",
                                i,
                                total,
                                resolved,
                            )

                    else:
                        failed += 1

                except Exception as exc:
                    await session.rollback()
                    logger.error("SPARQL seed failed for %s: %s", name, exc)
                    failed += 1

                if i < total:
                    await asyncio.sleep(INDEX_DELAY_SECONDS)

        finally:
            await session.close()

        return {
            "total": total,
            "resolved": resolved,
            "failed": failed,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

    finally:
        if owned_client:
            await client.aclose()


async def index_stale_reporters(
    stale_days: int = STALE_THRESHOLD_DAYS,
    delay_seconds: float = INDEX_DELAY_SECONDS,
) -> Dict[str, Any]:
    """Re-index reporters whose wiki data is older than stale_days."""
    session = await _get_session()
    try:
        cutoff = get_utc_now() - timedelta(days=stale_days)

        result = await session.execute(
            select(WikiIndexStatus).where(
                WikiIndexStatus.entity_type == "reporter",
                WikiIndexStatus.status.in_(["complete", "stale", "failed"]),
                or_(
                    WikiIndexStatus.last_indexed_at.is_(None),
                    WikiIndexStatus.last_indexed_at < cutoff,
                ),
            )
        )
        stale_entries = result.scalars().all()

        if not stale_entries:
            logger.info("No stale reporter entries found")
            return {"total": 0, "resolved": 0, "failed": 0}

        total = len(stale_entries)
        resolved = 0
        failed = 0

        logger.info("Re-indexing %d stale reporters", total)

        async with httpx.AsyncClient(timeout=20.0) as client:
            for i, entry in enumerate(stale_entries, 1):
                entity_name = cast(str, entry.entity_name)
                parts = entity_name.rsplit("::", 1)
                reporter_name = parts[0] if parts else entity_name
                org_name = parts[1] if len(parts) > 1 else None

                try:
                    profile = await build_reporter_dossier(
                        name=reporter_name,
                        organization=org_name,
                        http_client=client,
                    )

                    if profile.get("match_status") == "matched":
                        await upsert_reporter_profile(session, profile)

                    await _upsert_index_status(
                        session, "reporter", entity_name, "complete"
                    )
                    resolved += 1

                except Exception as exc:
                    await session.rollback()
                    logger.error(
                        "Stale reporter re-index failed for %s: %s",
                        entity_name,
                        exc,
                    )
                    await _upsert_index_status(
                        session,
                        "reporter",
                        entity_name,
                        "failed",
                        error_message=str(exc),
                    )
                    failed += 1

                if i < total:
                    await asyncio.sleep(delay_seconds)

        return {"total": total, "resolved": resolved, "failed": failed}

    finally:
        await session.close()


async def index_all_reporters(
    delay_seconds: float = INDEX_DELAY_SECONDS,
) -> Dict[str, Any]:
    """Full reporter indexing pipeline: SPARQL seed + unresolved author indexing."""
    logger.info("Starting full reporter indexing pipeline")

    sparql_result = await seed_reporters_from_wikidata()
    logger.info("SPARQL seeding result: %s", sparql_result)

    author_result = await index_unresolved_reporters(delay_seconds=delay_seconds)
    logger.info("Unresolved author indexing result: %s", author_result)

    return {
        "sparql_seed": sparql_result,
        "author_index": author_result,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
