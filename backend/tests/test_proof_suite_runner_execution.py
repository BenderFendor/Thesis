"""Regression tests for the proof-suite runner actually executing against real data.

Issue #13 found that the proof suite only produced scaffolding/manifests --
nothing compared a truth bundle against what the evidence-spine pipeline
actually materialized in the database. `evaluate_case_against_database` is
that missing comparison; these tests exercise it end to end, including
proving it can *fail* a wrong truth bundle (not just always report success).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.proof_suite.runner import ASSERTION_NAMES, evaluate_case_against_database
from app.services.evidence_spine import materialize_claim

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


async def _seed_and_materialize(db: AsyncSession) -> tuple[EvidenceEntity, EvidenceEntity, str]:
    publication = EvidenceEntity(
        id="ent_case_pub",
        record_kind="publication",
        canonical_name="Example Daily",
        status="candidate",
    )
    owner = EvidenceEntity(
        id="ent_case_owner",
        record_kind="legal_entity",
        canonical_name="Example Holdings LLC",
        status="candidate",
    )
    db.add_all([publication, owner])
    await db.flush()

    document = EvidenceDocument(
        id="doc_case",
        source_url="https://registry.example.test/doc_case",
        document_type="beneficial_ownership_filing",
        source_class="registry_filing",
    )
    snapshot = DocumentSnapshot(
        id="doc_case_snap",
        document_id="doc_case",
        sha256_raw="c" * 64,
        storage_path="/var/scoop/snapshots/doc_case.warc",
        retrieved_at=NOW,
        retriever="test-retriever",
        retriever_version="1.0",
    )
    db.add_all([document, snapshot])
    await db.flush()

    observation = EvidenceObservation(
        id="obs_case",
        snapshot_id=snapshot.id,
        locator={"page": 1, "field": "beneficial_owner"},
        quoted_text="Example Holdings LLC holds 100% of Example Daily.",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment="reviewed_yes",
    )
    db.add(observation)
    await db.flush()

    claim = EvidenceClaim(
        id="claim_case",
        subject_entity_id=publication.id,
        predicate="directly_owns",
        object_entity_id=owner.id,
        qualifiers={"pct": 100, "direct": True},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="registry_filing",
        status="candidate",
        method_version="test/1.0",
        claim_hash="hash_case",
    )
    db.add(claim)
    await db.flush()
    db.add(ClaimEvidence(claim_id=claim.id, observation_id=observation.id, role="supporting"))
    await db.flush()

    relationship = await materialize_claim(db, claim.id)
    await db.flush()
    return publication, owner, relationship.id


@pytest.mark.asyncio
async def test_matching_truth_bundle_passes_every_assertion(db: AsyncSession) -> None:
    publication, owner, _ = await _seed_and_materialize(db)
    truth = {
        "relationships": [
            {
                "subject_entity_id": publication.id,
                "predicate": "directly_owns",
                "object_entity_id": owner.id,
                "subject_record_kind": "publication",
                "object_record_kind": "legal_entity",
                "qualifiers": {"pct": 100, "direct": True},
                "snapshot_sha256": "c" * 64,
                "claim_ids": ["claim_case"],
            }
        ]
    }
    results = await evaluate_case_against_database(db, truth)
    assert {result.name for result in results} == set(ASSERTION_NAMES)
    failed = [result for result in results if not result.passed]
    assert failed == [], f"expected all assertions to pass, failed: {failed}"


@pytest.mark.asyncio
async def test_wrong_truth_bundle_fails_the_relevant_assertions(db: AsyncSession) -> None:
    """The runner must actually detect a wrong expectation, not rubber-stamp it."""
    publication, owner, _ = await _seed_and_materialize(db)
    truth = {
        "relationships": [
            {
                "subject_entity_id": publication.id,
                "predicate": "directly_owns",
                "object_entity_id": owner.id,
                "qualifiers": {"pct": 40},
                "snapshot_sha256": "f" * 64,
            }
        ]
    }
    results = await evaluate_case_against_database(db, truth)
    by_name = {result.name: result for result in results}
    assert by_name["correct_qualifiers"].passed is False
    assert by_name["exact_snapshot_hashes"].passed is False
    assert by_name["correct_entities"].passed is True


@pytest.mark.asyncio
async def test_nonexistent_relationship_fails_the_whole_case(db: AsyncSession) -> None:
    truth = {
        "relationships": [
            {
                "subject_entity_id": "does-not-exist",
                "predicate": "directly_owns",
                "object_entity_id": "also-missing",
            }
        ]
    }
    results = await evaluate_case_against_database(db, truth)
    assert all(not result.passed for result in results)
