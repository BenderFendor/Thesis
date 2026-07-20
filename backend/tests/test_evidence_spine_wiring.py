"""Integration tests for the acceptance-pipeline wiring added for issue #10.

`ownership_math` and `claim_comparison` previously existed only as pure,
unit-tested functions -- nothing in `materialize_claim` called them, so a
claim could materialize an accepted relationship that silently contradicted
an existing one, or that pushed direct ownership of an entity past 100%.
These tests exercise both guards through the real `materialize_claim` path,
not the pure functions in isolation.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import (
    AdjudicationItem,
    CalculationTrace,
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.evidence_spine import (
    EvidenceSpineError,
    compute_ownership_interest,
    materialize_claim,
)

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


async def _seed_registry_document(
    db: AsyncSession, *, doc_id: str, sha256: str
) -> DocumentSnapshot:
    document = EvidenceDocument(
        id=doc_id,
        source_url=f"https://registry.example.test/{doc_id}",
        document_type="beneficial_ownership_filing",
        source_class="registry_filing",
    )
    snapshot = DocumentSnapshot(
        id=f"{doc_id}_snap",
        document_id=doc_id,
        sha256_raw=sha256,
        storage_path=f"/var/scoop/snapshots/{doc_id}.warc",
        retrieved_at=NOW,
        retriever="test-retriever",
        retriever_version="1.0",
    )
    db.add_all([document, snapshot])
    await db.flush()
    return snapshot


async def _seed_qualifying_claim(
    db: AsyncSession,
    *,
    claim_id: str,
    subject_id: str,
    object_id: str,
    qualifiers: dict[str, object],
    predicate: str = "directly_owns",
) -> EvidenceClaim:
    snapshot = await _seed_registry_document(
        db, doc_id=f"doc_{claim_id}", sha256=claim_id.ljust(64, "0")
    )
    observation = EvidenceObservation(
        id=f"obs_{claim_id}",
        snapshot_id=snapshot.id,
        locator={"page": 1, "field": "beneficial_owner"},
        quoted_text="filed beneficial ownership statement",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment="reviewed_yes",
    )
    db.add(observation)
    await db.flush()
    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=subject_id,
        predicate=predicate,
        object_entity_id=object_id,
        qualifiers=qualifiers,
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="registry_filing",
        status="candidate",
        method_version="test/1.0",
        claim_hash=f"hash_{claim_id}",
    )
    db.add(claim)
    await db.flush()
    db.add(ClaimEvidence(claim_id=claim_id, observation_id=observation.id, role="supporting"))
    await db.flush()
    return claim


async def _seed_entities(db: AsyncSession, *ids: str) -> None:
    db.add_all(
        EvidenceEntity(
            id=entity_id, record_kind="legal_entity", canonical_name=entity_id, status="candidate"
        )
        for entity_id in ids
    )
    await db.flush()


@pytest.mark.asyncio
async def test_competing_owner_claim_opens_adjudication_instead_of_materializing(
    db: AsyncSession,
) -> None:
    await _seed_entities(db, "ent_target", "ent_owner_a", "ent_owner_b")
    first = await _seed_qualifying_claim(
        db,
        claim_id="claim_first_owner",
        subject_id="ent_target",
        object_id="ent_owner_a",
        qualifiers={"pct": 100, "direct": True},
    )
    await materialize_claim(db, first.id)
    await db.flush()

    second = await _seed_qualifying_claim(
        db,
        claim_id="claim_second_owner",
        subject_id="ent_target",
        object_id="ent_owner_b",
        qualifiers={"pct": 100, "direct": True},
    )
    with pytest.raises(EvidenceSpineError, match="adjudication item"):
        await materialize_claim(db, second.id)

    items = list((await db.execute(select(AdjudicationItem))).scalars().all())
    assert len(items) == 1
    assert items[0].item_type == "claim_contradiction"
    assert second.id in items[0].claim_ids


@pytest.mark.asyncio
async def test_out_of_domain_interest_qualifiers_are_rejected(db: AsyncSession) -> None:
    """A pct over 100% is invalid ownership_math input and must not crash the pipeline.

    `InterestRange.__post_init__` raises `OwnershipMathError` for this; the
    acceptance path must translate that into a clean `EvidenceSpineError`
    before the relationship is ever created, not fail deep inside trace
    recording after the row has already been flushed.
    """
    await _seed_entities(db, "ent_target2", "ent_owner_c")
    claim = await _seed_qualifying_claim(
        db,
        claim_id="claim_owner_c",
        subject_id="ent_target2",
        object_id="ent_owner_c",
        qualifiers={"pct": 150, "direct": True},
    )
    with pytest.raises(EvidenceSpineError, match="invalid ownership interest"):
        await materialize_claim(db, claim.id)


@pytest.mark.asyncio
async def test_compute_ownership_interest_resolves_a_multi_hop_chain(db: AsyncSession) -> None:
    """ownership_math must be used to *serve* indirect interest, not just in unit tests.

    Holdco owns 50% of Midco, Midco owns 60% of Target -- Holdco's indirect
    interest in Target (30%) can only be derived by walking both accepted
    edges, which is exactly what `compute_indirect_interest` does.
    """
    await _seed_entities(db, "ent_holdco", "ent_midco", "ent_target4")
    first = await _seed_qualifying_claim(
        db,
        claim_id="claim_holdco_midco",
        subject_id="ent_midco",
        object_id="ent_holdco",
        qualifiers={"pct": 50, "direct": True},
    )
    second = await _seed_qualifying_claim(
        db,
        claim_id="claim_midco_target",
        subject_id="ent_target4",
        object_id="ent_midco",
        qualifiers={"pct": 60, "direct": True},
    )
    await materialize_claim(db, first.id)
    await db.flush()
    await materialize_claim(db, second.id)
    await db.flush()

    result = await compute_ownership_interest(
        db, owner_id="ent_holdco", target_id="ent_target4", interest_type="economic"
    )
    assert result["aggregate"] == {"lower": 30.0, "upper": 30.0}


@pytest.mark.asyncio
async def test_materializing_an_interest_claim_records_a_calculation_trace(
    db: AsyncSession,
) -> None:
    await _seed_entities(db, "ent_target3", "ent_owner_e")
    claim = await _seed_qualifying_claim(
        db,
        claim_id="claim_owner_e",
        subject_id="ent_target3",
        object_id="ent_owner_e",
        qualifiers={"pct": 100, "direct": True},
    )
    relationship = await materialize_claim(db, claim.id)
    await db.flush()

    traces = list((await db.execute(select(CalculationTrace))).scalars().all())
    assert len(traces) == 1
    assert traces[0].relationship_id == relationship.id
    assert traces[0].measurement_name == "ownership_interest"
    assert traces[0].result["aggregate"] == {"lower": 100.0, "upper": 100.0}
