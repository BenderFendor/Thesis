"""Repair for the feedburner.com `site_url` collision (audit rec 1).

Before the fix in `app/data/rss_sources.json`, five RSS catalog entries (The
Atlantic - National, The Atlantic Wire, RealClearPolitics, Breitbart,
Ekathimerini) resolved `site_url` from their feed host
(`feeds.feedburner.com`) to the bare aggregator domain `feedburner.com`.
`entity_backfill.backfill_catalog_entities` OR-matches on any external id, so
every one of those five outlets' `rss_catalog_key` external id ended up
glued onto a single `EvidenceEntity` (canonical_name "The Atlantic") via the
shared `domain=feedburner.com` external id. Reporter byline claims minted
against Breitbart/Ekathimerini/RealClearPolitics articles were then written
as `authored_by -> "The Atlantic"`.

Fixing the catalog's `site_url` values (see rss_sources.json) is necessary
but not sufficient: the stale `rss_catalog_key` rows already point at the
wrong entity, and `resolve_or_create` never detaches an external id once
recorded (see `entity_resolver.py`). This module is the mechanism repair:

1. For each misattributed catalog name, resolve (or create) the entity that
   should own it, keyed only by its now-correct `domain` external id --
   independent of the stale `rss_catalog_key` glue.
2. Repoint the stale `rss_catalog_key` row onto that correct entity so
   future `entity_backfill` runs (which OR-match on both `rss_catalog_key`
   and `domain`) stop re-gluing it back onto "The Atlantic".
3. Retract (never delete) the wrong `authored_by` candidate claims: for each
   reporter with a not-yet-retracted `authored_by` claim citing the wrong
   ("The Atlantic") entity, recompute the reporter's actual most-recent
   byline source. If that source is one of the misattributed outlets (not a
   genuine Atlantic byline), retract the claim and clear the reporter's
   `article_byline` research-source marker so `ingest_reporter_bylines`
   re-mints a correct claim against the right outlet entity on its next
   pass (both stages run every auto-ingest cycle; ordering in
   `auto_ingest.STAGES` puts this repair first).

Idempotent: once the `rss_catalog_key` rows are repointed and the wrong
claims retracted, a second run finds nothing left to repoint (entity ids
already match) and no un-retracted wrong claims (all already retracted), so
it is a no-op.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.database import Article, ArticleAuthor, Reporter, get_utc_now
from app.models.evidence import EntityExternalId, EvidenceClaim
from app.services.atlas_graph_helpers import stable_source_id
from app.services.entity_backfill import _catalog_domain
from app.services.entity_resolver import resolve_or_create
from app.scripts.ingest_reporter_bylines import RESEARCH_SOURCE_MARKER

logger = get_logger("reporter_outlet_repair")

# "The Atlantic Wire" is deliberately excluded: it genuinely is the same
# publisher as "The Atlantic - National" and both correctly resolve to
# https://www.theatlantic.com after the site_url fix, so it should keep
# sharing that entity.
_MISATTRIBUTED_CATALOG_NAMES: tuple[str, ...] = (
    "RealClearPolitics",
    "Breitbart",
    "Ekathimerini",
)

_WRONG_DOMAIN = "feedburner.com"


@dataclass
class OutletRepairReport:
    """Summary counters for one repair pass."""

    entities_repointed: int = 0
    claims_retracted: int = 0
    reporters_reset: int = 0
    repointed_names: list[str] = field(default_factory=list)


async def _repoint_misattributed_entities(db: AsyncSession) -> dict[str, str]:
    """Ensure each misattributed catalog name owns a correctly domain-keyed entity.

    Returns {catalog_name: correct_entity_id}.
    """
    sources = get_rss_sources()
    correct_entity_ids: dict[str, str] = {}
    for name in _MISATTRIBUTED_CATALOG_NAMES:
        config = sources.get(name)
        if not config:
            continue
        domain = _catalog_domain(config)
        if not domain or domain == _WRONG_DOMAIN:
            # site_url fix didn't take effect (config error) -- skip rather
            # than repoint onto another wrong domain.
            continue
        entity = await resolve_or_create(
            db,
            record_kind="legal_entity",
            entity_kind="publication_brand",
            external_ids={"domain": domain},
            candidate_name=name,
        )
        correct_entity_ids[name] = cast(str, entity.id)
    return correct_entity_ids


async def _repoint_stale_catalog_keys(
    db: AsyncSession, correct_entity_ids: dict[str, str], report: OutletRepairReport
) -> None:
    for name, entity_id in correct_entity_ids.items():
        catalog_key = stable_source_id(name)
        stale_row = (
            await db.execute(
                select(EntityExternalId).where(
                    EntityExternalId.scheme == "rss_catalog_key",
                    EntityExternalId.value == catalog_key,
                )
            )
        ).scalar_one_or_none()
        if stale_row is not None and stale_row.entity_id != entity_id:
            logger.info(
                "reporter_outlet_repair: repointing %s (%s) from %s to %s",
                name,
                catalog_key,
                stale_row.entity_id,
                entity_id,
            )
            stale_row.entity_id = entity_id
            report.entities_repointed += 1
            report.repointed_names.append(name)
    await db.flush()


async def _reporter_actual_latest_source(db: AsyncSession, reporter_id: int) -> str | None:
    """Recompute a reporter's most-recent byline source, mirroring the ingest ranking."""
    row = (
        await db.execute(
            select(Article.source)
            .select_from(ArticleAuthor)
            .join(Article, Article.id == ArticleAuthor.article_id)
            .where(ArticleAuthor.reporter_id == reporter_id)
            .order_by(Article.published_at.desc(), Article.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return str(row) if row else None


async def _retract_wrong_claims(db: AsyncSession, report: OutletRepairReport) -> None:
    wrong_entity_row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "domain",
                EntityExternalId.value == _WRONG_DOMAIN,
            )
        )
    ).scalar_one_or_none()
    if wrong_entity_row is None:
        return
    wrong_entity_id = wrong_entity_row.entity_id

    candidate_claims = (
        await db.execute(
            select(EvidenceClaim, EntityExternalId.value)
            .join(
                EntityExternalId,
                (EntityExternalId.entity_id == EvidenceClaim.subject_entity_id)
                & (EntityExternalId.scheme == "scoop_reporter_id"),
            )
            .where(
                EvidenceClaim.predicate == "authored_by",
                EvidenceClaim.object_entity_id == wrong_entity_id,
                EvidenceClaim.retracted_at.is_(None),
            )
        )
    ).all()

    now = get_utc_now()
    for claim, reporter_id_str in candidate_claims:
        try:
            reporter_id = int(reporter_id_str)
        except (TypeError, ValueError):
            continue
        actual_source = await _reporter_actual_latest_source(db, reporter_id)
        if actual_source in (None, "The Atlantic", "The Atlantic - National", "The Atlantic Wire"):
            # Either a genuine Atlantic byline or no local corpus evidence to
            # judge by -- leave the claim alone.
            continue
        if actual_source not in _MISATTRIBUTED_CATALOG_NAMES:
            # Some other, unrelated mismatch -- out of scope for this repair.
            continue

        claim.retracted_at = now
        report.claims_retracted += 1

        reporter = await db.get(Reporter, reporter_id)
        if reporter is not None:
            sources = list(reporter.research_sources or [])
            if RESEARCH_SOURCE_MARKER in sources:
                sources.remove(RESEARCH_SOURCE_MARKER)
                reporter.research_sources = sources
                report.reporters_reset += 1
    await db.flush()


async def repair_feedburner_collision(db: AsyncSession) -> OutletRepairReport:
    """Run the full repair: repoint entities, then retract+reset wrong claims.

    Safe to call on every auto-ingest cycle; a fully-repaired database is a
    no-op (see module docstring).
    """
    report = OutletRepairReport()
    correct_entity_ids = await _repoint_misattributed_entities(db)
    if correct_entity_ids:
        await _repoint_stale_catalog_keys(db, correct_entity_ids, report)
    await _retract_wrong_claims(db, report)
    if report.entities_repointed or report.claims_retracted:
        logger.info(
            "reporter_outlet_repair: repointed=%d claims_retracted=%d reporters_reset=%d",
            report.entities_repointed,
            report.claims_retracted,
            report.reporters_reset,
        )
    return report
