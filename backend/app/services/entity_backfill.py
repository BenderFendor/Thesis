"""One-time (idempotent) backfill of the evidence-spine entity store.

Populates `EvidenceEntity`/`EntityExternalId` from the two legacy stores so
`entity_resolver.resolve_or_create` has something to resolve against before
any Phase 1 writer runs:

- Every `rss_sources.py` catalog entry becomes a `publication` entity keyed
  by `rss_catalog_key` (== the current atlas `stable_source_id`, so atlas
  node ids don't change) plus a `domain` external id when one is derivable.
- `Organization(org_type='publisher')` rows auto-merge into the matching
  publication entity on exact domain match; ambiguous ones raise an
  `AdjudicationItem` for human review instead of guessing.
- Other `Organization` rows become `legal_entity` entities.

Safe to re-run: every write is keyed off a stable external id or a
deterministic primary key, so a second pass finds what the first pass made
and skips it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.database import Organization
from app.models.evidence import AdjudicationItem, EntityExternalId, EntityResolution, EvidenceEntity
from app.services.atlas_graph_helpers import normalize_entity_label, stable_source_id
from app.services.entity_resolver import resolve_or_create
from app.services.evidence_spine import stable_hash
from app.services.source_url_guard import extract_domain

logger = get_logger(__name__)


@dataclass
class BackfillReport:
    """Summary counters for one backfill run."""

    catalog_entities_created: int = 0
    catalog_entities_matched: int = 0
    publisher_merged: int = 0
    publisher_adjudicated: int = 0
    publisher_skipped_already_processed: int = 0
    legal_entities_created: int = 0
    legal_entities_matched: int = 0


def _catalog_sources() -> dict[str, dict[str, Any]]:
    """Deduplicate flattened multi-URL catalog keys down to one entry per base name.

    Mirrors `atlas_graph_helpers._catalog_sources` / `atlas_entity._catalog_sources`
    -- the same dedup this codebase already uses to decide what counts as one
    atlas "source" node, so this backfill produces exactly one entity per
    atlas source node.
    """
    unique: dict[str, dict[str, Any]] = {}
    for raw_name, raw_config in get_rss_sources().items():
        unique.setdefault(raw_name.split(" - ")[0].strip(), raw_config)
    return unique


def _catalog_domain(config: dict[str, Any]) -> str | None:
    return extract_domain(config.get("site_url")) or extract_domain(config.get("url"))


async def backfill_catalog_entities(db: AsyncSession, report: BackfillReport) -> None:
    """Resolve every RSS catalog entry to a `publication` EvidenceEntity."""
    for source_name, config in _catalog_sources().items():
        catalog_key = stable_source_id(source_name)
        external_ids = {"rss_catalog_key": catalog_key}
        domain = _catalog_domain(config)
        if domain:
            external_ids["domain"] = domain
        qid = config.get("wikidata_qid")
        if qid:
            external_ids["wikidata_qid"] = str(qid)

        before = await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "rss_catalog_key",
                EntityExternalId.value == catalog_key,
            )
        )
        already_existed = before.scalar_one_or_none() is not None

        await resolve_or_create(
            db,
            record_kind="publication",
            external_ids=external_ids,
            candidate_name=source_name,
        )
        if already_existed:
            report.catalog_entities_matched += 1
        else:
            report.catalog_entities_created += 1


def _littlesis_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    return tail or None


async def _publication_entity_by_domain(db: AsyncSession, domain: str) -> EvidenceEntity | None:
    row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "domain", EntityExternalId.value == domain
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    entity = await db.get(EvidenceEntity, row.entity_id)
    if entity is not None and entity.record_kind == "publication":
        return entity
    return None


async def _publication_candidates_by_name(db: AsyncSession, name: str) -> list[str]:
    normalized = normalize_entity_label(name)
    if not normalized:
        return []
    rows = (
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.record_kind == "publication")
            )
        )
        .scalars()
        .all()
    )
    return [
        cast(str, row.id)
        for row in rows
        if normalize_entity_label(cast(str, row.canonical_name)) == normalized
    ]


async def _process_publisher_org(
    db: AsyncSession, org: Organization, report: BackfillReport
) -> None:
    """Auto-merge a publisher Organization into its publication entity.

    Merges only on exact domain match; otherwise raises an adjudication
    item. Never guesses on name alone.
    """
    org_name = cast(str, org.name)
    shadow_key = str(org.id)
    already_shadow = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "legacy_organization_id",
                EntityExternalId.value == shadow_key,
            )
        )
    ).scalar_one_or_none()
    adjudication_id = f"adj_{stable_hash('entity_merge_candidate', 'organization', org.id)[:32]}"
    already_adjudicated = await db.get(AdjudicationItem, adjudication_id)
    if already_shadow is not None or already_adjudicated is not None:
        report.publisher_skipped_already_processed += 1
        return

    domain = extract_domain(org.website) or extract_domain(org.official_website)
    if not domain:
        db.add(
            AdjudicationItem(
                id=adjudication_id,
                item_type="entity_merge_candidate",
                claim_ids=[],
                entity_ids=[],
                normalized_dimensions={
                    "organization_id": org.id,
                    "organization_name": org_name,
                    "reason_code": "no_website",
                    "candidate_publication_entity_ids": await _publication_candidates_by_name(
                        db, org_name
                    ),
                },
                reason=(
                    f"Organization {org.id} ({org_name!r}) has org_type='publisher' but no "
                    "website/official_website to derive a domain from; cannot auto-merge."
                ),
                status="open",
            )
        )
        await db.flush()
        report.publisher_adjudicated += 1
        return

    survivor = await _publication_entity_by_domain(db, domain)
    if survivor is None:
        db.add(
            AdjudicationItem(
                id=adjudication_id,
                item_type="entity_merge_candidate",
                claim_ids=[],
                entity_ids=[],
                normalized_dimensions={
                    "organization_id": org.id,
                    "organization_name": org_name,
                    "reason_code": "no_domain_match",
                    "domain": domain,
                    "candidate_publication_entity_ids": await _publication_candidates_by_name(
                        db, org_name
                    ),
                },
                reason=(
                    f"Organization {org.id} ({org_name!r}) has domain {domain!r} but no "
                    "catalog publication entity shares that domain; needs human review."
                ),
                status="open",
            )
        )
        await db.flush()
        report.publisher_adjudicated += 1
        return

    shadow_external_ids = {"legacy_organization_id": shadow_key}
    if org.cik:
        shadow_external_ids["cik"] = str(org.cik)
    littlesis_id = _littlesis_id_from_url(org.littlesis_url)
    if littlesis_id:
        shadow_external_ids["littlesis_id"] = littlesis_id

    shadow = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids=shadow_external_ids,
        candidate_name=org_name,
    )
    shadow.status = "merged"

    if shadow.id != survivor.id:
        resolution_id = f"res_{stable_hash('publisher_domain_merge', shadow.id, survivor.id)[:32]}"
        existing_resolution = await db.get(EntityResolution, resolution_id)
        if existing_resolution is None:
            db.add(
                EntityResolution(
                    id=resolution_id,
                    left_entity_id=shadow.id,
                    right_entity_id=survivor.id,
                    decision="same_as",
                    status="accepted",
                    decided_by="entity_backfill:publisher_domain_merge",
                )
            )
    await db.flush()
    report.publisher_merged += 1


async def _process_legal_entity_org(
    db: AsyncSession, org: Organization, report: BackfillReport
) -> None:
    external_ids = {"legacy_organization_id": str(org.id)}
    if org.cik:
        external_ids["cik"] = str(org.cik)
    littlesis_id = _littlesis_id_from_url(org.littlesis_url)
    if littlesis_id:
        external_ids["littlesis_id"] = littlesis_id

    before = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "legacy_organization_id",
                EntityExternalId.value == str(org.id),
            )
        )
    ).scalar_one_or_none()

    await resolve_or_create(
        db,
        record_kind="legal_entity",
        external_ids=external_ids,
        candidate_name=cast(str, org.name),
    )
    if before is not None:
        report.legal_entities_matched += 1
    else:
        report.legal_entities_created += 1


async def backfill_organizations(db: AsyncSession, report: BackfillReport) -> None:
    """Resolve every Organization row per its org_type."""
    orgs = (await db.execute(select(Organization))).scalars().all()
    for org in orgs:
        if org.org_type == "publisher":
            await _process_publisher_org(db, org, report)
        else:
            await _process_legal_entity_org(db, org, report)


async def run_backfill(db: AsyncSession) -> BackfillReport:
    """Run the full Phase 0 backfill: catalog entities, then organizations.

    Organizations must run after the catalog pass so publisher domain
    matches have something to resolve against.
    """
    report = BackfillReport()
    await backfill_catalog_entities(db, report)
    await backfill_organizations(db, report)
    return report
