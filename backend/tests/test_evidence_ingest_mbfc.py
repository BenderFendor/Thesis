"""Tests for the MBFC ownership + bias/factuality ingestor.

Writes small local CSV fixtures matching `mbfc_integration.py`'s expected
columns so `build_mbfc_lookup` reads them directly -- no live HuggingFace
network call.
"""

from __future__ import annotations

import csv
from datetime import UTC, datetime
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import AcceptedRelationship, EvidenceClaim
from app.services.evidence_ingest import ingest_mbfc_ownership

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
def mbfc_files(tmp_path: Path) -> tuple[str, str, str]:
    factuality_path = tmp_path / "factuality.csv"
    bias_path = tmp_path / "bias.csv"
    ownership_path = tmp_path / "ownership.csv"

    with factuality_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "factuality"])
        writer.writeheader()
        writer.writerow({"name": "Test Outlet", "factuality": "high"})

    with bias_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "bias"])
        writer.writeheader()
        writer.writerow({"name": "Test Outlet", "bias": "left-center"})

    with ownership_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "ownership", "country"])
        writer.writeheader()
        writer.writerow(
            {"name": "Test Outlet", "ownership": "Owned by Big Media Corp", "country": "US"}
        )

    return str(factuality_path), str(bias_path), str(ownership_path)


@pytest.mark.asyncio
async def test_bias_and_factuality_auto_accept_as_attributed_assessment(
    db: AsyncSession, mbfc_files: tuple[str, str, str]
) -> None:
    factuality_file, bias_file, ownership_file = mbfc_files
    report = await ingest_mbfc_ownership(
        db, factuality_file=factuality_file, bias_file=bias_file, ownership_file=ownership_file
    )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    bias_claims = [c for c in claims if c.predicate == "bias_rating"]
    factual_claims = [c for c in claims if c.predicate == "factual_reporting"]
    assert len(bias_claims) == 1
    assert len(factual_claims) == 1
    assert bias_claims[0].status == "accepted"
    assert factual_claims[0].status == "accepted"
    assert bias_claims[0].object_value == {"rating": "left-center", "source": "mbfc"}
    assert bias_claims[0].object_entity_id is None
    assert bias_claims[0].asserted_by == "mbfc"

    # Attribute claims never materialize an AcceptedRelationship (no object entity).
    relationships = list((await db.execute(select(AcceptedRelationship))).scalars().all())
    assert relationships == []
    assert report.accepted == 2


@pytest.mark.asyncio
async def test_ownership_claim_stays_tier_review(
    db: AsyncSession, mbfc_files: tuple[str, str, str]
) -> None:
    factuality_file, bias_file, ownership_file = mbfc_files
    await ingest_mbfc_ownership(
        db, factuality_file=factuality_file, bias_file=bias_file, ownership_file=ownership_file
    )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    ownership_claims = [c for c in claims if c.predicate == "directly_owns"]
    assert len(ownership_claims) == 1
    assert ownership_claims[0].status == "candidate"


@pytest.mark.asyncio
async def test_ownership_prefix_stripped_from_owner_name(
    db: AsyncSession, mbfc_files: tuple[str, str, str]
) -> None:
    factuality_file, bias_file, ownership_file = mbfc_files
    await ingest_mbfc_ownership(
        db, factuality_file=factuality_file, bias_file=bias_file, ownership_file=ownership_file
    )
    await db.commit()

    from app.models.evidence import EvidenceEntity

    owner = (
        await db.execute(
            select(EvidenceEntity).where(EvidenceEntity.canonical_name == "Big Media Corp")
        )
    ).scalar_one_or_none()
    assert owner is not None


@pytest.mark.asyncio
async def test_rerun_dedupes_all_claim_kinds(
    db: AsyncSession, mbfc_files: tuple[str, str, str]
) -> None:
    factuality_file, bias_file, ownership_file = mbfc_files
    await ingest_mbfc_ownership(
        db, factuality_file=factuality_file, bias_file=bias_file, ownership_file=ownership_file
    )
    await db.commit()
    first_count = len((await db.execute(select(EvidenceClaim))).scalars().all())

    second_report = await ingest_mbfc_ownership(
        db, factuality_file=factuality_file, bias_file=bias_file, ownership_file=ownership_file
    )
    await db.commit()
    second_count = len((await db.execute(select(EvidenceClaim))).scalars().all())

    assert first_count == second_count == 3  # bias + factuality + ownership
    assert second_report.claims_created == 0
    assert second_report.claims_deduped == 3
