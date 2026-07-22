"""Tests for `app.services.entity_resolver.resolve_or_create`.

Covers the Phase 0 entity-resolution contract: match by external id, never
merge on name alone, and attach newly-seen external ids to an already
resolved entity without creating a duplicate.
"""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import EntityExternalId, EvidenceEntity
from app.services.entity_resolver import resolve_or_create


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def test_creates_new_entity_when_no_external_id_matches(db: AsyncSession) -> None:
    entity = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com"},
        candidate_name="Example Daily",
    )
    assert entity.record_kind == "publication"
    assert entity.canonical_name == "Example Daily"

    rows = (
        (await db.execute(select(EntityExternalId).where(EntityExternalId.entity_id == entity.id)))
        .scalars()
        .all()
    )
    assert {(r.scheme, r.value) for r in rows} == {("domain", "example.com")}


async def test_matches_existing_entity_by_external_id(db: AsyncSession) -> None:
    first = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com"},
        candidate_name="Example Daily",
    )
    second = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com"},
        candidate_name="Example Daily (renamed spelling)",
    )
    assert second.id == first.id
    # canonical_name from the first creation is preserved, not overwritten by
    # a later candidate_name -- resolution never rewrites identity off a name.
    assert second.canonical_name == "Example Daily"

    total = (await db.execute(select(EvidenceEntity))).scalars().all()
    assert len(total) == 1


async def test_never_merges_on_name_alone(db: AsyncSession) -> None:
    """Two records with the same candidate_name but disjoint external ids
    must resolve to two distinct entities -- name is never a match key."""
    first = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com"},
        candidate_name="Daily News",
    )
    second = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "dailynews.example.org"},
        candidate_name="Daily News",
    )
    assert first.id != second.id

    total = (await db.execute(select(EvidenceEntity))).scalars().all()
    assert len(total) == 2


async def test_attaches_new_external_id_without_duplicating_entity(db: AsyncSession) -> None:
    first = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com"},
        candidate_name="Example Daily",
    )
    second = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com", "wikidata_qid": "Q12345"},
        candidate_name="Example Daily",
    )
    assert second.id == first.id

    rows = (
        (await db.execute(select(EntityExternalId).where(EntityExternalId.entity_id == first.id)))
        .scalars()
        .all()
    )
    assert {(r.scheme, r.value) for r in rows} == {
        ("domain", "example.com"),
        ("wikidata_qid", "Q12345"),
    }

    total = (await db.execute(select(EvidenceEntity))).scalars().all()
    assert len(total) == 1


async def test_blank_external_id_values_are_ignored(db: AsyncSession) -> None:
    entity = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"domain": "example.com", "wikidata_qid": "   "},
        candidate_name="Example Daily",
    )
    rows = (
        (await db.execute(select(EntityExternalId).where(EntityExternalId.entity_id == entity.id)))
        .scalars()
        .all()
    )
    assert {(r.scheme, r.value) for r in rows} == {("domain", "example.com")}
