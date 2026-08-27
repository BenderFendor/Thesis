"""Regression tests: contradiction outcomes must not fail the ingestion stage.

`materialize_claim` raises `ContradictionError` (a subclass of
`EvidenceSpineError`) when a claim contradicts an already-accepted
relationship -- opening (or reusing) a durable `AdjudicationItem` is the
designed success path, not an acceptance failure. Before this fix,
`_auto_accept_relationship_claim` funneled that outcome into
`report.acceptance_failures`, which flipped `auto_ingest._run_evidence_ingestion`
into "partial" and raised `PartialIngestError` on every restart for the same
already-known contradictions.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import (
    AdjudicationItem,
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.evidence_ingest import IngestReport, _auto_accept_relationship_claim

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


async def _seed_reviewed_claim(
    db: AsyncSession,
    *,
    claim_id: str,
    subject_id: str,
    object_id: str,
    doc_id: str,
    sha256: str,
) -> EvidenceClaim:
    snapshot = await _seed_registry_document(db, doc_id=doc_id, sha256=sha256)
    observation = EvidenceObservation(
        id=f"{claim_id}_obs",
        snapshot_id=snapshot.id,
        locator={"page": 1, "field": "beneficial_owner"},
        quoted_text="ownership statement",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment="reviewed_yes",
        reviewed_by="reviewer@test",
    )
    db.add(observation)
    await db.flush()
    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=subject_id,
        predicate="directly_owns",
        object_entity_id=object_id,
        qualifiers={"pct": 100, "direct": True},
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


async def _seed_entities(db: AsyncSession) -> tuple[EvidenceEntity, EvidenceEntity, EvidenceEntity]:
    publication = EvidenceEntity(
        id="ent_pub", record_kind="publication", canonical_name="Example Daily", status="candidate"
    )
    owner_a = EvidenceEntity(
        id="ent_owner_a", record_kind="legal_entity", canonical_name="Holdco A", status="candidate"
    )
    owner_b = EvidenceEntity(
        id="ent_owner_b", record_kind="legal_entity", canonical_name="Holdco B", status="candidate"
    )
    db.add_all([publication, owner_a, owner_b])
    await db.flush()
    return publication, owner_a, owner_b


@pytest.mark.asyncio
async def test_contradiction_opens_adjudication_and_does_not_fail_stage(
    db: AsyncSession,
) -> None:
    publication, owner_a, owner_b = await _seed_entities(db)

    accepted_claim = await _seed_reviewed_claim(
        db,
        claim_id="claim_accepted",
        subject_id=publication.id,
        object_id=owner_a.id,
        doc_id="doc_a",
        sha256="a" * 64,
    )
    report = IngestReport(source="test")
    accepted = await _auto_accept_relationship_claim(
        db, accepted_claim, reviewer="reviewer@test", report=report
    )
    assert accepted is not None
    assert report.acceptance_failures == []
    assert report.adjudications_opened == []

    conflicting_claim = await _seed_reviewed_claim(
        db,
        claim_id="claim_conflicting",
        subject_id=publication.id,
        object_id=owner_b.id,
        doc_id="doc_b",
        sha256="b" * 64,
    )
    result = await _auto_accept_relationship_claim(
        db, conflicting_claim, reviewer="reviewer@test", report=report
    )

    # A contradiction is not an acceptance failure -- it must not appear in
    # `acceptance_failures` (that field flips auto_ingest's run to "partial"
    # and raises PartialIngestError, which is what caused the stage to fail
    # on every restart for the same known contradiction).
    assert result is None
    assert report.acceptance_failures == []
    assert len(report.adjudications_opened) == 1
    assert report.candidates == 1

    items = list((await db.execute(select(AdjudicationItem))).scalars().all())
    assert len(items) == 1
    assert items[0].item_type == "claim_contradiction"


@pytest.mark.asyncio
async def test_genuine_acceptance_failure_still_fails(db: AsyncSession) -> None:
    publication, owner_a, _owner_b = await _seed_entities(db)
    # No supporting observation at all -> evaluate_claim_by_id rejects for
    # real (not a contradiction), which must still count as a failure.
    claim = EvidenceClaim(
        id="claim_unsupported",
        subject_entity_id=publication.id,
        predicate="directly_owns",
        object_entity_id=owner_a.id,
        qualifiers={"pct": 100, "direct": True},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="catalog_metadata",
        status="candidate",
        method_version="test/1.0",
        claim_hash="hash_claim_unsupported",
    )
    db.add(claim)
    await db.flush()

    report = IngestReport(source="test")
    result = await _auto_accept_relationship_claim(
        db, claim, reviewer="reviewer@test", report=report
    )

    assert result is None
    assert len(report.acceptance_failures) == 1
    assert report.adjudications_opened == []


@pytest.mark.asyncio
async def test_repeated_runs_do_not_multiply_adjudication_items(db: AsyncSession) -> None:
    publication, owner_a, owner_b = await _seed_entities(db)

    accepted_claim = await _seed_reviewed_claim(
        db,
        claim_id="claim_accepted",
        subject_id=publication.id,
        object_id=owner_a.id,
        doc_id="doc_a",
        sha256="a" * 64,
    )
    report = IngestReport(source="test")
    await _auto_accept_relationship_claim(
        db, accepted_claim, reviewer="reviewer@test", report=report
    )

    conflicting_claim = await _seed_reviewed_claim(
        db,
        claim_id="claim_conflicting",
        subject_id=publication.id,
        object_id=owner_b.id,
        doc_id="doc_b",
        sha256="b" * 64,
    )

    # Simulate the claim contradicting the accepted relationship across two
    # separate restarts of the ingestion stage (same claim, re-evaluated).
    for _ in range(3):
        run_report = IngestReport(source="test")
        await _auto_accept_relationship_claim(
            db, conflicting_claim, reviewer="reviewer@test", report=run_report
        )
        assert len(run_report.adjudications_opened) == 1

    count = (await db.execute(select(func.count()).select_from(AdjudicationItem))).scalar_one()
    assert count == 1
