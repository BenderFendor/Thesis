"""Regression test for `build_atlas_stats`' research-coverage metric.

Pins the exact rule: an entity counts as "researched" when at least one
evidence-backed edge (`evidence_count > 0`) touches it -- the same
condition `_rank_nodes` uses to set `AtlasNode.evidence_coverage` to
something other than "not researched". This also exercises the
`limit_nodes=None` change (stats must cover the full corpus, not a
600-node-capped slice).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.atlas_graph import build_atlas_stats
from app.services.atlas_graph_helpers import stable_source_id
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


async def _accepted_ownership_claim(
    db: AsyncSession, *, claim_id: str, subject_id: str, object_id: str, doc_key: str
) -> None:
    document = EvidenceDocument(
        id=f"doc_{doc_key}",
        source_url=f"https://registry.example.test/{doc_key}",
        document_type="beneficial_ownership_filing",
        source_class="registry_filing",
    )
    snapshot = DocumentSnapshot(
        id=f"snap_{doc_key}",
        document_id=document.id,
        sha256_raw=doc_key.ljust(64, "0"),
        storage_path=f"/var/scoop/snapshots/{doc_key}.warc",
        retrieved_at=NOW,
        retriever="test-retriever",
        retriever_version="1.0",
    )
    observation = EvidenceObservation(
        id=f"obs_{doc_key}",
        snapshot_id=snapshot.id,
        locator={"page": 1},
        quoted_text="Filed ownership record.",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment="reviewed_yes",
        reviewed_by="reviewer@test",
    )
    db.add_all([document, snapshot, observation])
    await db.flush()

    qualifiers: dict[str, Any] = {"direct": True, "pct": 100.0}
    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=subject_id,
        predicate="directly_owns",
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
    await materialize_claim(db, claim_id, reviewer="reviewer@test")
    await db.flush()


@pytest.mark.asyncio
async def test_research_coverage_counts_only_evidence_backed_entities(db: AsyncSession) -> None:
    """Beacon->OrgA is evidence-backed (2 researched entities); Ledger and
    Jane Owner have no edges at all, so they stay "not researched"."""
    beacon = await _seed_publication(db, entity_id="ent_beacon", name="Daily Beacon")
    await _seed_publication(db, entity_id="ent_ledger", name="Nightly Ledger")
    org_a = EvidenceEntity(
        id="ent_org_a", record_kind="legal_entity", canonical_name="Org A", status="accepted"
    )
    person = EvidenceEntity(
        id="ent_person", record_kind="person", canonical_name="Jane Owner", status="accepted"
    )
    db.add_all([org_a, person])
    await db.flush()

    await _accepted_ownership_claim(
        db,
        claim_id="claim_beacon_owned",
        subject_id=beacon.id,
        object_id=org_a.id,
        doc_key="beacon",
    )
    await db.commit()

    stats = await build_atlas_stats(db)

    # Corpus: Beacon (outlet), Ledger (outlet), Org A (organization), Jane
    # Owner (person) = 4 entities total. Only Beacon and Org A are touched
    # by an evidence-backed edge.
    assert stats.research_coverage.numerator == 2
    assert stats.research_coverage.denominator == 4

    by_type = stats.research_coverage_by_entity_type
    assert by_type["outlet"].numerator == 1
    assert by_type["outlet"].denominator == 2
    assert by_type["organization"].numerator == 1
    assert by_type["organization"].denominator == 1
    assert by_type["person"].numerator == 0
    assert by_type["person"].denominator == 1
