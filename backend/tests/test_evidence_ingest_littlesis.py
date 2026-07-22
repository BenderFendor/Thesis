"""Tests for the LittleSis ownership/hierarchy ingestor.

Writes small gzip fixtures matching the LittleSis bulk-dump schema (one JSON
object per line) so `load_littlesis_entities`/`load_littlesis_relationships`
read local files -- no live network or the real ~2GB bulk dump.
"""

from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import AcceptedRelationship, EvidenceClaim
from app.services.evidence_ingest import ingest_littlesis_ownership

NOW = datetime(2026, 7, 20, tzinfo=UTC).replace(tzinfo=None)


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def littlesis_files(tmp_path: Path) -> tuple[str, str]:
    entities = [
        {
            "id": 1001,
            "name": "Acme Media Holdings",
            "description": "media holding company",
            "primary_ext": "Org",
        },
        {
            "id": 1002,
            "name": "Daily Bugle",
            "description": "media news outlet",
            "primary_ext": "Org",
        },
    ]
    relationships = [
        {
            "id": 5001,
            "category_id": 10,
            "entity1_id": 1001,
            "entity2_id": 1002,
            "description1": "Owns",
            "description2": "Is Owned By",
            "start_date": "2010-01-01",
            "end_date": None,
        }
    ]
    entities_path = tmp_path / "entities.json.gz"
    relationships_path = tmp_path / "relationships.json.gz"
    with gzip.open(entities_path, "wt", encoding="utf-8") as f:
        for entity in entities:
            f.write(json.dumps(entity) + "\n")
    with gzip.open(relationships_path, "wt", encoding="utf-8") as f:
        for rel in relationships:
            f.write(json.dumps(rel) + "\n")
    return str(entities_path), str(relationships_path)


@pytest.mark.asyncio
async def test_ownership_relationship_creates_candidate_claim(
    db: AsyncSession, littlesis_files: tuple[str, str]
) -> None:
    entities_file, relationships_file = littlesis_files
    report = await ingest_littlesis_ownership(
        db, entities_file=entities_file, relationships_file=relationships_file
    )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    assert len(claims) == 1
    claim = claims[0]
    assert claim.predicate == "directly_owns"
    assert claim.status == "candidate"  # tier-review, never auto-accepted
    assert report.claims_created == 1
    assert report.accepted == 0
    assert report.candidates == 1

    relationships = list((await db.execute(select(AcceptedRelationship))).scalars().all())
    assert relationships == []


@pytest.mark.asyncio
async def test_owner_is_entity1_owned_is_entity2(
    db: AsyncSession, littlesis_files: tuple[str, str]
) -> None:
    entities_file, relationships_file = littlesis_files
    await ingest_littlesis_ownership(
        db, entities_file=entities_file, relationships_file=relationships_file
    )
    await db.commit()

    from app.models.evidence import EntityExternalId

    owner_ext = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "littlesis_id", EntityExternalId.value == "1001"
            )
        )
    ).scalar_one()
    owned_ext = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "littlesis_id", EntityExternalId.value == "1002"
            )
        )
    ).scalar_one()

    claim = (await db.execute(select(EvidenceClaim))).scalars().one()
    assert claim.subject_entity_id == owned_ext.entity_id
    assert claim.object_entity_id == owner_ext.entity_id


@pytest.mark.asyncio
async def test_rerun_dedupes_via_claim_hash(
    db: AsyncSession, littlesis_files: tuple[str, str]
) -> None:
    entities_file, relationships_file = littlesis_files
    await ingest_littlesis_ownership(
        db, entities_file=entities_file, relationships_file=relationships_file
    )
    await db.commit()
    first_count = len((await db.execute(select(EvidenceClaim))).scalars().all())

    second_report = await ingest_littlesis_ownership(
        db, entities_file=entities_file, relationships_file=relationships_file
    )
    await db.commit()
    second_count = len((await db.execute(select(EvidenceClaim))).scalars().all())

    assert first_count == second_count == 1
    assert second_report.claims_created == 0
    assert second_report.claims_deduped == 1
