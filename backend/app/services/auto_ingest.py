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
import os
from uuid import uuid4
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.logging import get_logger
from app.database import AsyncSessionLocal, WikiIndexStatus, get_utc_now
from app.models.evidence import EvidenceIngestRun
from app.models.atlas import AtlasIngestStatusResponse, EvidenceIngestRunRecord
from app.services.entity_backfill import run_backfill
from app.services.evidence_ingest import (
    METHOD_VERSION,
    IngestReport,
    ingest_ads_supply,
    ingest_edgar_subsidiaries,
    ingest_littlesis_ownership,
    ingest_mbfc_ownership,
    ingest_wikidata_ownership_claims,
)
from app.services.funding_bias_analysis import run_funding_bias_analysis
from app.services.primary_source_adapters import ADAPTER_REGISTRY
from app.services.reporter_agency_flag import flag_agency_reporters
from app.services.reporter_merge import merge_duplicate_reporters
from app.services.reporter_name_cleanup import cleanup_dirty_reporter_names
from app.services.reporter_outlet_repair import repair_feedburner_collision
from app.services.reporter_split_backfill import split_composite_reporters
from app.scripts.ingest_reporter_bylines import ingest_reporter_bylines

logger = get_logger("auto_ingest")

# Marker row identity in wiki_index_status; reused rather than adding a new
# table, matching how that table already tracks background-indexing state.
_MARKER_ENTITY_TYPE = "auto_ingest"
_MARKER_ENTITY_NAME = "atlas_pipeline"


class PartialIngestError(RuntimeError):
    """Raised after all required adapters run when any adapter is incomplete."""


@dataclass(frozen=True)
class Stage:
    """One step of the auto-ingest pipeline. See module docstring to extend."""

    name: str
    run: Callable[[AsyncSession], Awaitable[object]]
    # Stages that call external network services are skipped when a recent
    # successful run is on record (the interval guard). Local/cheap stages
    # should leave this False so they run on every start.
    network_bound: bool = False


async def _run_reporter_outlet_repair(db: AsyncSession) -> object:
    """Repair the feedburner.com site_url collision (audit rec 1).

    Must run before `entity_backfill`: repointing the stale
    `rss_catalog_key` glue first prevents `entity_backfill`'s OR-match from
    re-attaching the corrected `domain` external id onto the wrong entity.
    See `app.services.reporter_outlet_repair` for the full mechanism.
    """
    report = await repair_feedburner_collision(db)
    await db.commit()
    return report


async def _run_entity_backfill(db: AsyncSession) -> object:
    report = await run_backfill(db)
    await db.commit()
    return report


async def _run_reporter_name_cleanup(db: AsyncSession) -> object:
    """Clean dirty reporter names (audit rec 5). Must run before merge/split."""
    report = await cleanup_dirty_reporter_names(db)
    await db.commit()
    return report


async def _run_reporter_agency_flag(db: AsyncSession) -> object:
    """Flag pure wire/agency reporter rows (audit rec 4)."""
    report = await flag_agency_reporters(db)
    await db.commit()
    return report


async def _run_reporter_split_backfill(db: AsyncSession) -> object:
    """Split existing composite multi-author reporter rows (audit rec 2b)."""
    report = await split_composite_reporters(db)
    await db.commit()
    return report


async def _run_reporter_merge(db: AsyncSession) -> object:
    """Merge exact-normalized-name duplicate reporters (audit rec 3).

    Runs after name cleanup (a cleaned name can newly match an existing
    row) and after the split backfill (splitting can also create a fresh
    exact-name match against an existing individual reporter).
    """
    report = await merge_duplicate_reporters(db)
    await db.commit()
    return report


async def _block_missing_credential_adapters(db: AsyncSession) -> None:
    """Persist a blocked record for every adapter with missing credentials."""
    for contract in ADAPTER_REGISTRY.values():
        missing = [name for name in contract.required_credentials if not os.getenv(name)]
        if not missing:
            continue
        db.add(
            EvidenceIngestRun(
                id=f"ingest_{uuid4().hex}",
                adapter=contract.name,
                adapter_version=contract.version,
                scope={"mode": "catalog", "configured": False},
                status="blocked",
                network_mode="disabled",
                missing_credentials=missing,
                failure=f"missing required credentials: {', '.join(missing)}",
                retryable=False,
                completed_at=get_utc_now(),
            )
        )
        await db.commit()


async def _evidence_sources(
    db: AsyncSession,
) -> list[tuple[str, Callable[[], Awaitable[IngestReport]]]]:
    """Build the catalog evidence source runners for one pass."""
    from app.scripts.ingest_evidence import (
        EDGAR_PARENT_CIKS,
        _catalog_domain_map,
        _catalog_publishers,
    )

    domain_map = _catalog_domain_map()
    publishers = await _catalog_publishers(db)
    return [
        ("wikidata", lambda: ingest_wikidata_ownership_claims(db)),
        ("littlesis", lambda: ingest_littlesis_ownership(db)),
        ("mbfc", lambda: ingest_mbfc_ownership(db, catalog_domains=domain_map)),
        ("edgar", lambda: ingest_edgar_subsidiaries(db, ciks=dict(EDGAR_PARENT_CIKS))),
        ("ads_txt", lambda: ingest_ads_supply(db, publishers=publishers)),
    ]


async def _record_evidence_source_start(db: AsyncSession, run_id: str, source_name: str) -> None:
    """Create the running marker row for one source."""
    db.add(
        EvidenceIngestRun(
            id=run_id,
            adapter=source_name,
            adapter_version=METHOD_VERSION,
            scope={"mode": "catalog"},
            status="running",
            network_mode="live",
            missing_credentials=[],
        )
    )
    await db.commit()


async def _record_evidence_source_success(
    db: AsyncSession,
    run_id: str,
    report: IngestReport,
    source_name: str,
    failures: dict[str, str],
) -> None:
    """Mark a source run complete and record any acceptance failures."""
    run = await db.get(EvidenceIngestRun, run_id)
    if run is None:
        return
    run.status = "partial" if report.acceptance_failures else "success"
    run.documents_count = report.documents_created
    run.snapshots_count = report.snapshots_created
    run.observations_count = report.observations_created
    run.claims_count = report.claims_created
    run.accepted_count = report.accepted
    run.candidate_count = report.candidates
    run.failure = "; ".join(report.acceptance_failures) or None
    run.retryable = bool(report.acceptance_failures)
    run.completed_at = get_utc_now()
    if report.acceptance_failures:
        failures[source_name] = str(run.failure)
    await db.commit()
    logger.info(
        "auto-ingest: evidence source '%s' complete "
        "(claims created=%d deduped=%d accepted=%d candidates=%d)",
        source_name,
        report.claims_created,
        report.claims_deduped,
        report.accepted,
        report.candidates,
    )
    if report.adjudications_opened:
        logger.info(
            "auto-ingest: evidence source '%s' opened/existing adjudication items: %d",
            source_name,
            len(report.adjudications_opened),
        )


async def _record_evidence_source_failure(
    db: AsyncSession,
    run_id: str,
    source_name: str,
    exc: Exception,
    failures: dict[str, str],
) -> None:
    """Persist a failure marker for one source and record the failure."""
    await db.rollback()
    persisted_run = await db.get(EvidenceIngestRun, run_id)
    if persisted_run is not None:
        persisted_run.status = "failed"
        persisted_run.failure = f"{type(exc).__name__}: {exc}"
        persisted_run.retryable = True
        persisted_run.completed_at = get_utc_now()
        await db.commit()
    failures[source_name] = f"{type(exc).__name__}: {exc}"
    logger.warning(
        "auto-ingest: evidence source '%s' failed (offline or unreachable?): %s",
        source_name,
        exc,
    )


async def _run_evidence_ingestion(db: AsyncSession) -> dict[str, IngestReport]:
    """Run every evidence-ingestion source; one source's failure doesn't skip the rest."""
    await _block_missing_credential_adapters(db)
    results: dict[str, IngestReport] = {}
    failures: dict[str, str] = {}
    for source_name, run_source in await _evidence_sources(db):
        run_id = f"ingest_{uuid4().hex}"
        await _record_evidence_source_start(db, run_id, source_name)
        try:
            report = await run_source()
            results[source_name] = report
            await _record_evidence_source_success(db, run_id, report, source_name, failures)
        except Exception as exc:
            await _record_evidence_source_failure(db, run_id, source_name, exc, failures)
    if failures:
        summary = "; ".join(f"{name}: {failure}" for name, failure in failures.items())
        raise PartialIngestError(f"required evidence adapters were partial: {summary}")
    return results


async def _run_funding_bias_analysis(db: AsyncSession) -> object:
    run = await run_funding_bias_analysis(db)
    await db.commit()
    return run


async def _run_reporter_byline_ingest(db: AsyncSession) -> object:
    """Feed reporter byline evidence from the local article corpus.

    Local/DB-only (no network fetch), so this runs on every restart like
    `entity_backfill` -- but it is not O(corpus) on a steady-state restart:
    `ingest_reporter_bylines` skips any reporter already marked researched,
    so only reporters new since the last run are processed. See
    `app.scripts.ingest_reporter_bylines` for the full design.
    """
    report = await ingest_reporter_bylines(db)
    return report


STAGES: list[Stage] = [
    Stage("reporter_outlet_repair", _run_reporter_outlet_repair, network_bound=False),
    Stage("entity_backfill", _run_entity_backfill, network_bound=False),
    # Reporter data-quality stages (docs/agents/traces/
    # reporter-coverage-quality-audit.md): order matters. Cleanup first (a
    # dirty name must be clean before split/merge compare it); split before
    # merge (splitting can create a fresh exact-name duplicate); agency
    # flag can run anywhere in this group since it only touches exact
    # known-agency names.
    Stage("reporter_name_cleanup", _run_reporter_name_cleanup, network_bound=False),
    Stage("reporter_agency_flag", _run_reporter_agency_flag, network_bound=False),
    Stage("reporter_split_backfill", _run_reporter_split_backfill, network_bound=False),
    Stage("reporter_merge", _run_reporter_merge, network_bound=False),
    Stage("evidence_ingestion", _run_evidence_ingestion, network_bound=True),
    Stage("reporter_byline_ingest", _run_reporter_byline_ingest, network_bound=False),
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


def _freshness_label(
    active: bool,
    incomplete: bool,
    last_success: datetime | None,
    newest_status: str | None,
) -> str:
    """Classify adapter freshness for the Atlas UI."""
    if active:
        return "running"
    if incomplete and (last_success is None or newest_status != "success"):
        return "partial"
    if last_success is None:
        return "never"
    now = get_utc_now()
    compare_now = now if last_success.tzinfo else now.replace(tzinfo=None)
    if compare_now - last_success < timedelta(hours=settings.auto_ingest_interval_hours):
        return "fresh"
    return "stale"


async def get_ingest_status(db: AsyncSession, *, limit: int = 40) -> AtlasIngestStatusResponse:
    """Return persisted adapter freshness and exact failures for the Atlas UI."""
    rows = list(
        (
            await db.execute(
                select(EvidenceIngestRun).order_by(desc(EvidenceIngestRun.started_at)).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    records = [EvidenceIngestRunRecord.model_validate(row, from_attributes=True) for row in rows]
    successes = [row.completed_at for row in rows if row.status == "success" and row.completed_at]
    last_success = max(successes, default=None)
    active = any(row.status == "running" for row in rows)
    incomplete = any(row.status in {"partial", "failed", "blocked"} for row in rows)
    freshness = _freshness_label(active, incomplete, last_success, rows[0].status if rows else None)
    return AtlasIngestStatusResponse(
        freshness=cast(Any, freshness),
        last_success_at=last_success,
        has_retryable_failures=any(row.retryable for row in rows),
        missing_credentials=sorted(
            {credential for row in rows for credential in (row.missing_credentials or [])}
        ),
        runs=records,
    )


def _should_skip_network_bound(last_run_at: datetime | None, interval: timedelta) -> bool:
    """Decide whether the interval guard should skip network-bound stages."""
    if last_run_at is None:
        return False
    now = get_utc_now()
    # last_run_at may be naive (SQLite in tests) or aware (Postgres);
    # normalize before subtracting.
    compare_now = now if last_run_at.tzinfo else now.replace(tzinfo=None)
    age = compare_now - last_run_at
    if age >= interval:
        return False
    logger.info(
        "Auto-ingest: last successful full run was %.1fh ago (< %dh guard); "
        "skipping network-bound stages this start",
        age.total_seconds() / 3600,
        settings.auto_ingest_interval_hours,
    )
    return True


async def _run_stage(stage: Stage, factory: async_sessionmaker[AsyncSession]) -> bool:
    """Run one stage; returns True when a network-bound stage completed."""
    stage_start = time.monotonic()
    logger.info("Auto-ingest: stage '%s' starting", stage.name)
    try:
        async with factory() as db:
            await stage.run(db)
        duration = time.monotonic() - stage_start
        logger.info("Auto-ingest: stage '%s' finished (%.2fs)", stage.name, duration)
        return stage.network_bound
    except Exception as exc:  # pragma: no cover - defensive, logged and continued
        duration = time.monotonic() - stage_start
        logger.warning(
            "Auto-ingest: stage '%s' failed after %.2fs, continuing to next stage: %s",
            stage.name,
            duration,
            exc,
            exc_info=True,
        )
        return False


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
    skip_network_bound = _should_skip_network_bound(last_run_at, interval)

    ran_network_bound = False
    for stage in STAGES:
        if stage.network_bound and skip_network_bound:
            logger.info("Auto-ingest: stage '%s' skipped (interval guard active)", stage.name)
            continue
        if await _run_stage(stage, factory):
            ran_network_bound = True

    if ran_network_bound:
        async with factory() as db:
            await _record_successful_run(db)
        # Ingested data may have changed entity/relationship counts; drop the
        # cached `/api/wiki/atlas/stats` response so the next poll reflects it
        # instead of waiting out the TTL.
        from app.services.atlas_graph import invalidate_atlas_stats_cache

        invalidate_atlas_stats_cache()

    logger.info(
        "Auto-ingest complete (%.2fs total)",
        time.monotonic() - overall_start,
    )
