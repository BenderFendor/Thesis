"""Automatic startup orchestrator for the Atlas data pipelines.

The Atlas rebuild added three data pipelines that used to require manual CLI
invocation (`python -m app.scripts.backfill_entities`,
`python -m app.scripts.ingest_evidence --source all`,
`python -m app.scripts.run_funding_bias_analysis`). This module runs them
automatically as a background task after the FastAPI server is already
serving requests -- see `run_auto_ingest`, launched from `app.main.on_startup`
the same way `periodic_wiki_refresh` and the reporter indexer are.

Design:
- `STAGES` is an ordered list of `Stage` entries. Each stage's `run` receives
  an `AsyncSession` and returns an arbitrary summary object; raising an
  exception fails only that stage. To add a future pipeline, write an
  `async def _run_my_pipeline(db: AsyncSession) -> object` that awaits the
  pipeline's idempotent entry point and commits, then append
  `Stage("my_pipeline", _run_my_pipeline, network_bound=True/False)` to
  `STAGES`. Nothing else needs to change -- `run_auto_ingest` iterates the
  registry, so runlocal.sh and main.py need no further edits.
- Stages marked `network_bound=True` hit external services (Wikidata,
  LittleSis, MBFC, EDGAR) and are skipped when a recent successful run is
  on record, so a restart loop doesn't hammer those APIs. The guard is a
  single marker row (see `_last_successful_run_at` /
  `_record_successful_run`) reusing the existing `wiki_index_status` table
  with `entity_type="auto_ingest"` -- no new table needed. The interval is
  `SCOOP_AUTO_INGEST_INTERVAL_HOURS` (default 24h). Non-network-bound stages
  (currently just the local, cheap entity backfill) always run.
- `SCOOP_AUTO_INGEST` (default enabled; "0"/"false"/"" disables) is checked
  once at the top of `run_auto_ingest`, so tests and CI can opt out without
  touching call sites. Test fixtures also clear FastAPI's startup handlers
  entirely (see tests/conftest.py), so this never runs during the default
  test suite regardless of the flag.
- Every stage is independently wrapped: a network failure (offline
  Wikidata/EDGAR/LittleSis/MBFC) or any other exception logs a warning and
  the orchestrator moves on to the next stage. Pipeline idempotency
  (dedupe by claim_hash / deterministic ids / locked preregistration) is
  guaranteed by the pipelines themselves -- see `app.services.entity_backfill`,
  `app.services.evidence_ingest`, and `app.services.funding_bias_analysis`.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.logging import get_logger
from app.database import AsyncSessionLocal, WikiIndexStatus, get_utc_now
from app.services.entity_backfill import run_backfill
from app.services.evidence_ingest import (
    IngestReport,
    ingest_edgar_subsidiaries,
    ingest_littlesis_ownership,
    ingest_mbfc_ownership,
    ingest_wikidata_ownership_claims,
)
from app.services.funding_bias_analysis import run_funding_bias_analysis

logger = get_logger("auto_ingest")

# Marker row identity in wiki_index_status; reused rather than adding a new
# table, matching how that table already tracks background-indexing state.
_MARKER_ENTITY_TYPE = "auto_ingest"
_MARKER_ENTITY_NAME = "atlas_pipeline"


@dataclass(frozen=True)
class Stage:
    """One step of the auto-ingest pipeline. See module docstring to extend."""

    name: str
    run: Callable[[AsyncSession], Awaitable[object]]
    # Stages that call external network services are skipped when a recent
    # successful run is on record (the interval guard). Local/cheap stages
    # should leave this False so they run on every start.
    network_bound: bool = False


async def _run_entity_backfill(db: AsyncSession) -> object:
    report = await run_backfill(db)
    await db.commit()
    return report


async def _run_evidence_ingestion(db: AsyncSession) -> dict[str, IngestReport]:
    """Run every evidence-ingestion source; one source's failure doesn't skip the rest."""
    from app.scripts.ingest_evidence import EDGAR_PARENT_CIKS, _catalog_domain_map

    domain_map = _catalog_domain_map()
    sources: list[tuple[str, Callable[[], Awaitable[IngestReport]]]] = [
        ("wikidata", lambda: ingest_wikidata_ownership_claims(db)),
        ("littlesis", lambda: ingest_littlesis_ownership(db)),
        ("mbfc", lambda: ingest_mbfc_ownership(db, catalog_domains=domain_map)),
        ("edgar", lambda: ingest_edgar_subsidiaries(db, ciks=dict(EDGAR_PARENT_CIKS))),
    ]

    results: dict[str, IngestReport] = {}
    for source_name, run_source in sources:
        try:
            report = await run_source()
            await db.commit()
            results[source_name] = report
            logger.info(
                "auto-ingest: evidence source '%s' complete "
                "(claims created=%d deduped=%d accepted=%d candidates=%d)",
                source_name,
                report.claims_created,
                report.claims_deduped,
                report.accepted,
                report.candidates,
            )
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "auto-ingest: evidence source '%s' failed (offline or unreachable?): %s",
                source_name,
                exc,
            )
    return results


async def _run_funding_bias_analysis(db: AsyncSession) -> object:
    run = await run_funding_bias_analysis(db)
    await db.commit()
    return run


STAGES: list[Stage] = [
    Stage("entity_backfill", _run_entity_backfill, network_bound=False),
    Stage("evidence_ingestion", _run_evidence_ingestion, network_bound=True),
    Stage("funding_bias_analysis", _run_funding_bias_analysis, network_bound=False),
]


async def _last_successful_run_at(db: AsyncSession) -> datetime | None:
    """Return the marker's last-success timestamp, or None if never recorded."""
    result = await db.execute(
        select(WikiIndexStatus).where(
            WikiIndexStatus.entity_type == _MARKER_ENTITY_TYPE,
            WikiIndexStatus.entity_name == _MARKER_ENTITY_NAME,
        )
    )
    row = result.scalar_one_or_none()
    if row is None or row.status != "complete" or row.last_indexed_at is None:
        return None
    return row.last_indexed_at


async def _record_successful_run(db: AsyncSession) -> None:
    """Upsert the marker row so the next restart can apply the interval guard."""
    result = await db.execute(
        select(WikiIndexStatus).where(
            WikiIndexStatus.entity_type == _MARKER_ENTITY_TYPE,
            WikiIndexStatus.entity_name == _MARKER_ENTITY_NAME,
        )
    )
    row = result.scalar_one_or_none()
    now = get_utc_now()
    if row is None:
        db.add(
            WikiIndexStatus(
                entity_type=_MARKER_ENTITY_TYPE,
                entity_name=_MARKER_ENTITY_NAME,
                status="complete",
                last_indexed_at=now,
            )
        )
    else:
        row.status = "complete"
        row.last_indexed_at = now
        row.updated_at = now
    await db.commit()


async def run_auto_ingest() -> None:
    """Run every registered stage in order; never raise, never block the caller.

    Intended to be launched with `asyncio.create_task` from the FastAPI
    startup hook (see `app.main.on_startup`). Checks `SCOOP_AUTO_INGEST`
    itself so callers don't need to guard it, and no-ops cleanly if the
    database isn't configured.
    """
    if not settings.auto_ingest_enabled:
        logger.info("Auto-ingest disabled via SCOOP_AUTO_INGEST=0; skipping")
        return

    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Auto-ingest skipped: database unavailable (ENABLE_DATABASE=0)")
        return

    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    interval = timedelta(hours=settings.auto_ingest_interval_hours)

    logger.info(
        "Auto-ingest starting (%d stage(s), interval guard=%dh)",
        len(STAGES),
        settings.auto_ingest_interval_hours,
    )
    overall_start = time.monotonic()

    async with factory() as db:
        last_run_at = await _last_successful_run_at(db)

    skip_network_bound = False
    if last_run_at is not None:
        now = get_utc_now()
        # last_run_at may be naive (SQLite in tests) or aware (Postgres);
        # normalize before subtracting.
        compare_now = now if last_run_at.tzinfo else now.replace(tzinfo=None)
        age = compare_now - last_run_at
        if age < interval:
            skip_network_bound = True
            logger.info(
                "Auto-ingest: last successful full run was %.1fh ago (< %dh guard); "
                "skipping network-bound stages this start",
                age.total_seconds() / 3600,
                settings.auto_ingest_interval_hours,
            )

    ran_network_bound = False
    for stage in STAGES:
        if stage.network_bound and skip_network_bound:
            logger.info("Auto-ingest: stage '%s' skipped (interval guard active)", stage.name)
            continue

        stage_start = time.monotonic()
        logger.info("Auto-ingest: stage '%s' starting", stage.name)
        try:
            async with factory() as db:
                await stage.run(db)
            duration = time.monotonic() - stage_start
            logger.info("Auto-ingest: stage '%s' finished (%.2fs)", stage.name, duration)
            if stage.network_bound:
                ran_network_bound = True
        except Exception as exc:  # pragma: no cover - defensive, logged and continued
            duration = time.monotonic() - stage_start
            logger.warning(
                "Auto-ingest: stage '%s' failed after %.2fs, continuing to next stage: %s",
                stage.name,
                duration,
                exc,
                exc_info=True,
            )

    if ran_network_bound:
        async with factory() as db:
            await _record_successful_run(db)

    logger.info(
        "Auto-ingest complete (%.2fs total)",
        time.monotonic() - overall_start,
    )
