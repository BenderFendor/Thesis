"""Tests for the Phase 5 per-entity `funding_and_bias` details block.

Covers `atlas_entity.get_atlas_entity`'s outlet/organization branches:
accepted MBFC-style attribute claims win over legacy SourceMetadata/
Organization values, carry claim_ids/evidence_count/asserted_by, and a
field with neither a claim nor a legacy value renders as
`origin=None`/`value=None` rather than a false "legacy" attribution.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, Organization, SourceMetadata
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.atlas_entity import get_atlas_entity
from app.services.atlas_graph_helpers import stable_source_id

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


async def _seed_publication(db: AsyncSession, *, entity_id: str, name: str) -> EvidenceEntity:
    entity = EvidenceEntity(
        id=entity_id, record_kind="publication", canonical_name=name, status="accepted"
    )
    db.add(entity)
    await db.flush()
    db.add(
        EntityExternalId(
            entity_id=entity_id, scheme="rss_catalog_key", value=stable_source_id(name)
        )
    )
    await db.flush()
    return entity


async def _accepted_attribute_claim(
    db: AsyncSession,
    *,
    claim_id: str,
    subject_id: str,
    predicate: str,
    rating: str,
    asserted_by: str = "mbfc",
    with_evidence: bool = True,
) -> EvidenceClaim:
    """Seed an already-`status="accepted"` object_value claim directly.

    Bypasses `evidence_spine.materialize_claim` (which hard-requires an
    `object_entity_id` and does not apply to attribute claims -- see
    `evidence_ingest._auto_accept_attribute_claim`) since the acceptance
    pipeline itself is already covered by `test_evidence_ingest_mbfc.py`;
    this file only exercises `atlas_entity.py`'s read side.
    """
    if with_evidence:
        document = EvidenceDocument(
            id=f"doc_{claim_id}",
            source_url="https://mediabiasfactcheck.com/example",
            document_type="mbfc_dataset_row",
            source_class="third_party_assessment",
        )
        snapshot = DocumentSnapshot(
            id=f"snap_{claim_id}",
            document_id=document.id,
            sha256_raw=f"sha_{claim_id}".ljust(64, "0"),
            storage_path=f"/var/scoop/snapshots/{claim_id}.json",
            retrieved_at=NOW,
            retriever="test-retriever",
            retriever_version="1.0",
        )
        observation = EvidenceObservation(
            id=f"obs_{claim_id}",
            snapshot_id=snapshot.id,
            locator={"field": predicate},
            structured_value={"rating": rating, "source": "mbfc"},
            extractor="test-extractor",
            extractor_version="1.0",
            entailment="reviewed_yes",
            reviewed_by="reviewer@test",
        )
        db.add_all([document, snapshot, observation])
        await db.flush()

    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=subject_id,
        predicate=predicate,
        object_entity_id=None,
        object_value={"rating": rating, "source": "mbfc"},
        qualifiers={},
        recorded_at=NOW,
        asserted_by=asserted_by,
        evidence_class="third_party_assessment",
        status="accepted",
        method_version="test/1.0",
        claim_hash=f"hash_{claim_id}",
    )
    db.add(claim)
    await db.flush()
    if with_evidence:
        db.add(
            ClaimEvidence(claim_id=claim_id, observation_id=f"obs_{claim_id}", role="supporting")
        )
        await db.flush()
    return claim


@pytest.mark.asyncio
async def test_outlet_funding_and_bias_prefers_accepted_claim_over_legacy(db: AsyncSession) -> None:
    beacon = await _seed_publication(db, entity_id="ent_beacon", name="Daily Beacon")
    db.add(
        SourceMetadata(
            source_name="Daily Beacon",
            political_bias="center",  # should lose to the accepted claim below
            factual_rating="mixed",
            funding_type="commercial",
        )
    )
    await db.flush()
    await _accepted_attribute_claim(
        db,
        claim_id="claim_bias_beacon",
        subject_id=beacon.id,
        predicate="bias_rating",
        rating="Left-Center",
    )
    await db.commit()

    record = await get_atlas_entity(db, stable_source_id("Daily Beacon"))
    assert record is not None
    block = record.details["funding_and_bias"]

    bias = block["bias_rating"]
    assert bias["value"] == "Left-Center"
    assert bias["origin"] == "claim"
    assert bias["asserted_by"] == "mbfc"
    assert bias["claim_ids"] == ["claim_bias_beacon"]
    assert bias["evidence_count"] > 0
    assert bias["evidence"]

    # No accepted funding_type/factual_reporting claim -> legacy fallback.
    funding = block["funding_type"]
    assert funding["value"] == "commercial"
    assert funding["origin"] == "legacy"
    assert funding["claim_ids"] == []
    assert funding["evidence_count"] == 0

    factual = block["factual_reporting"]
    assert factual["value"] == "mixed"
    assert factual["origin"] == "legacy"


@pytest.mark.asyncio
async def test_outlet_funding_and_bias_field_with_no_value_is_origin_none(db: AsyncSession) -> None:
    await _seed_publication(db, entity_id="ent_unrated", name="Unrated Outlet")
    await db.commit()

    record = await get_atlas_entity(db, stable_source_id("Unrated Outlet"))
    assert record is not None
    block = record.details["funding_and_bias"]
    for field in ("funding_type", "bias_rating", "factual_reporting"):
        assert block[field]["value"] is None
        assert block[field]["origin"] is None
        assert block[field]["claim_ids"] == []
        assert block[field]["evidence_count"] == 0


@pytest.mark.asyncio
async def test_organization_funding_and_bias_mixes_claim_and_legacy_origins(
    db: AsyncSession,
) -> None:
    org_entity = EvidenceEntity(
        id="ent_org_funding",
        record_kind="legal_entity",
        canonical_name="Umbrella Media",
        status="accepted",
    )
    db.add(org_entity)
    await db.flush()

    org = Organization(
        id=501,
        name="Umbrella Media",
        normalized_name="umbrella media",
        org_type="parent_company",
        funding_type="non-profit",
        media_bias_rating="center",
        factual_reporting="high",
    )
    db.add(org)
    await db.flush()
    db.add(
        EntityExternalId(
            entity_id="ent_org_funding", scheme="legacy_organization_id", value=str(org.id)
        )
    )
    await db.flush()

    await _accepted_attribute_claim(
        db,
        claim_id="claim_bias_org",
        subject_id="ent_org_funding",
        predicate="bias_rating",
        rating="Right-Center",
    )
    await db.commit()

    record = await get_atlas_entity(db, "organization:ent_org_funding")
    assert record is not None
    block = record.details["funding_and_bias"]

    assert block["bias_rating"]["value"] == "Right-Center"
    assert block["bias_rating"]["origin"] == "claim"
    assert block["bias_rating"]["claim_ids"] == ["claim_bias_org"]

    assert block["funding_type"]["value"] == "non-profit"
    assert block["funding_type"]["origin"] == "legacy"

    assert block["factual_reporting"]["value"] == "high"
    assert block["factual_reporting"]["origin"] == "legacy"


@pytest.mark.asyncio
async def test_retracted_claim_does_not_win_over_legacy(db: AsyncSession) -> None:
    beacon = await _seed_publication(db, entity_id="ent_beacon_retracted", name="Retracted Beacon")
    db.add(SourceMetadata(source_name="Retracted Beacon", political_bias="left"))
    await db.flush()
    claim = await _accepted_attribute_claim(
        db,
        claim_id="claim_bias_retracted",
        subject_id=beacon.id,
        predicate="bias_rating",
        rating="Far-Left",
    )
    claim.retracted_at = NOW
    await db.commit()

    record = await get_atlas_entity(db, stable_source_id("Retracted Beacon"))
    assert record is not None
    bias = record.details["funding_and_bias"]["bias_rating"]
    assert bias["value"] == "left"
    assert bias["origin"] == "legacy"
