"""Tests for `app.services.entity_backfill`.

Covers the Phase 0 backfill contract: catalog entries become publication
entities, publisher Organizations auto-merge only on exact domain match (or
land in the adjudication queue), other org_types become legal_entity
entities, the whole pass is idempotent, and no two publication entities ever
share a domain external id.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, Organization
from app.models.evidence import AdjudicationItem, EntityExternalId, EntityResolution, EvidenceEntity
from app.services.atlas_graph_helpers import stable_source_id
from app.services.entity_backfill import run_backfill

CATALOG: dict[str, dict[str, Any]] = {
    "Example Daily": {
        "url": "https://example.com/rss",
        "site_url": "https://example.com",
        "category": "general",
        "country": "US",
    },
    "Second Outlet": {
        "url": "https://second-outlet.example.org/feed",
        "site_url": "https://second-outlet.example.org",
        "category": "general",
        "country": "US",
    },
}


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


def _patched_catalog():
    return patch("app.services.entity_backfill.get_rss_sources", lambda: CATALOG)


async def test_catalog_backfill_creates_publication_entities(db: AsyncSession) -> None:
    with _patched_catalog():
        report = await run_backfill(db)
    await db.commit()

    assert report.catalog_entities_created == 2

    pubs = (
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.record_kind == "publication")
            )
        )
        .scalars()
        .all()
    )
    assert len(pubs) == 2

    example_key = stable_source_id("Example Daily")
    row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "rss_catalog_key", EntityExternalId.value == example_key
            )
        )
    ).scalar_one_or_none()
    assert row is not None

    domain_row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.entity_id == row.entity_id, EntityExternalId.scheme == "domain"
            )
        )
    ).scalar_one_or_none()
    assert domain_row is not None
    assert domain_row.value == "example.com"


async def test_backfill_is_idempotent(db: AsyncSession) -> None:
    with _patched_catalog():
        first = await run_backfill(db)
        await db.commit()
        second = await run_backfill(db)
        await db.commit()

    assert first.catalog_entities_created == 2
    assert second.catalog_entities_created == 0
    assert second.catalog_entities_matched == 2

    pubs = (
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.record_kind == "publication")
            )
        )
        .scalars()
        .all()
    )
    assert len(pubs) == 2

    all_external_ids = (await db.execute(select(EntityExternalId))).scalars().all()
    seen = set()
    for row in all_external_ids:
        key = (row.scheme, row.value)
        assert key not in seen, f"duplicate external id row created on rerun: {key}"
        seen.add(key)


async def test_publisher_auto_merges_on_exact_domain_match(db: AsyncSession) -> None:
    org = Organization(
        name="Example Daily Inc",
        normalized_name="example daily inc",
        org_type="publisher",
        website="https://www.example.com",
    )
    db.add(org)
    await db.flush()

    with _patched_catalog():
        report = await run_backfill(db)
    await db.commit()

    assert report.publisher_merged == 1
    assert report.publisher_adjudicated == 0

    # Still exactly two *active* publication survivors -- the org resolves
    # into a shadow entity (status='merged') rather than a duplicate
    # accepted publication, and never gets its own domain external id.
    active_pubs = (
        (
            await db.execute(
                select(EvidenceEntity).where(
                    EvidenceEntity.record_kind == "publication", EvidenceEntity.status == "accepted"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(active_pubs) == 2

    merged_pubs = (
        (
            await db.execute(
                select(EvidenceEntity).where(
                    EvidenceEntity.record_kind == "publication", EvidenceEntity.status == "merged"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(merged_pubs) == 1

    resolutions = (await db.execute(select(EntityResolution))).scalars().all()
    assert len(resolutions) == 1
    assert resolutions[0].decision == "same_as"
    assert resolutions[0].left_entity_id == merged_pubs[0].id

    adjudications = (await db.execute(select(AdjudicationItem))).scalars().all()
    assert adjudications == []


async def test_publisher_ambiguous_case_creates_adjudication_item(db: AsyncSession) -> None:
    org = Organization(
        name="Unlisted Publisher",
        normalized_name="unlisted publisher",
        org_type="publisher",
        website="https://totally-unrelated-domain.example.net",
    )
    db.add(org)
    await db.flush()

    with _patched_catalog():
        report = await run_backfill(db)
    await db.commit()

    assert report.publisher_merged == 0
    assert report.publisher_adjudicated == 1

    items = (await db.execute(select(AdjudicationItem))).scalars().all()
    assert len(items) == 1
    item = items[0]
    assert item.item_type == "entity_merge_candidate"
    assert item.normalized_dimensions["organization_id"] == org.id
    assert item.normalized_dimensions["reason_code"] == "no_domain_match"

    # No duplicate publication entity was created for the ambiguous org.
    pubs = (
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.record_kind == "publication")
            )
        )
        .scalars()
        .all()
    )
    assert len(pubs) == 2


async def test_publisher_with_no_website_creates_adjudication_item(db: AsyncSession) -> None:
    org = Organization(
        name="No Website Publisher", normalized_name="no website publisher", org_type="publisher"
    )
    db.add(org)
    await db.flush()

    with _patched_catalog():
        report = await run_backfill(db)
    await db.commit()

    assert report.publisher_adjudicated == 1
    items = (await db.execute(select(AdjudicationItem))).scalars().all()
    assert items[0].normalized_dimensions["reason_code"] == "no_website"


async def test_adjudication_and_merge_are_idempotent_on_rerun(db: AsyncSession) -> None:
    merged_org = Organization(
        name="Example Daily Inc",
        normalized_name="example daily inc",
        org_type="publisher",
        website="https://www.example.com",
    )
    ambiguous_org = Organization(
        name="Unlisted Publisher",
        normalized_name="unlisted publisher",
        org_type="publisher",
        website="https://totally-unrelated-domain.example.net",
    )
    db.add_all([merged_org, ambiguous_org])
    await db.flush()

    with _patched_catalog():
        await run_backfill(db)
        await db.commit()
        second = await run_backfill(db)
        await db.commit()

    assert second.publisher_merged == 0
    assert second.publisher_adjudicated == 0
    assert second.publisher_skipped_already_processed == 2

    assert len((await db.execute(select(AdjudicationItem))).scalars().all()) == 1
    assert len((await db.execute(select(EntityResolution))).scalars().all()) == 1


async def test_non_publisher_org_becomes_legal_entity(db: AsyncSession) -> None:
    org = Organization(
        name="Global Media Holdings",
        normalized_name="global media holdings",
        org_type="parent_company",
        cik="0001234567",
        littlesis_url="https://littlesis.org/entities/98765",
    )
    db.add(org)
    await db.flush()

    with _patched_catalog():
        report = await run_backfill(db)
    await db.commit()

    assert report.legal_entities_created == 1

    entities = (
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.record_kind == "legal_entity")
            )
        )
        .scalars()
        .all()
    )
    assert len(entities) == 1
    entity = entities[0]
    assert entity.canonical_name == "Global Media Holdings"

    ext_ids = {
        (r.scheme, r.value)
        for r in (
            await db.execute(
                select(EntityExternalId).where(EntityExternalId.entity_id == entity.id)
            )
        )
        .scalars()
        .all()
    }
    assert ("cik", "0001234567") in ext_ids
    assert ("littlesis_id", "98765") in ext_ids
    assert ("legacy_organization_id", str(org.id)) in ext_ids


async def test_no_two_publication_entities_share_a_domain(db: AsyncSession) -> None:
    """Core Phase 0 invariant."""
    merged_org = Organization(
        name="Example Daily Inc",
        normalized_name="example daily inc",
        org_type="publisher",
        website="https://www.example.com",
    )
    db.add(merged_org)
    await db.flush()

    with _patched_catalog():
        await run_backfill(db)
    await db.commit()

    domain_rows = (
        (await db.execute(select(EntityExternalId).where(EntityExternalId.scheme == "domain")))
        .scalars()
        .all()
    )
    entity_ids_by_domain: dict[str, set[str]] = {}
    for row in domain_rows:
        entity_ids_by_domain.setdefault(row.value, set()).add(row.entity_id)

    for domain, entity_ids in entity_ids_by_domain.items():
        publication_entity_ids = {
            eid
            for eid in entity_ids
            if (await db.get(EvidenceEntity, eid)).record_kind == "publication"
        }
        assert len(publication_entity_ids) <= 1, (
            f"domain {domain} shared by {publication_entity_ids}"
        )
