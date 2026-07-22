"""Phase 3 regression tests: organization/person detail-page data.

Covers the Atlas rebuild plan's Phase 3 acceptance criteria for
`GET /api/wiki/atlas/entities/{id}` (`atlas_entity.get_atlas_entity`):
ordered `ownership_chain` (with percentages/evidence/claim ids), the
downward `controls` rollup, `siblings_via_owner` for outlets, corrected
`profile_path` values for organization/person nodes, and cycle safety when
the ownership graph itself is cyclic.
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
from app.services.atlas_entity import get_atlas_entity
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


async def _seed_document_chain(db: AsyncSession, *, key: str, sha256: str) -> EvidenceObservation:
    document = EvidenceDocument(
        id=f"doc_{key}",
        source_url=f"https://registry.example.test/{key}",
        document_type="beneficial_ownership_filing",
        source_class="registry_filing",
    )
    snapshot = DocumentSnapshot(
        id=f"snap_{key}",
        document_id=document.id,
        sha256_raw=sha256,
        storage_path=f"/var/scoop/snapshots/{key}.warc",
        retrieved_at=NOW,
        retriever="test-retriever",
        retriever_version="1.0",
    )
    observation = EvidenceObservation(
        id=f"obs_{key}",
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
    return observation


async def _accepted_claim(
    db: AsyncSession,
    *,
    claim_id: str,
    subject_id: str,
    object_id: str,
    predicate: str,
    pct: float | None,
    doc_key: str,
    sha256: str,
) -> None:
    observation = await _seed_document_chain(db, key=doc_key, sha256=sha256)
    qualifiers: dict[str, Any] = {"direct": True}
    if pct is not None:
        qualifiers["pct"] = pct
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
    await materialize_claim(db, claim_id, reviewer="reviewer@test")
    await db.flush()


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


async def _seed_spine(db: AsyncSession) -> None:
    """outlet Beacon --100%--> OrgA --60%--> OrgB (root); Ledger --80%--> OrgA too;
    person Jane Owner --controls--> OrgB (no equity pct)."""
    beacon = await _seed_publication(db, entity_id="ent_beacon", name="Daily Beacon")
    ledger = await _seed_publication(db, entity_id="ent_ledger", name="Nightly Ledger")
    org_a = EvidenceEntity(
        id="ent_org_a", record_kind="legal_entity", canonical_name="Org A", status="accepted"
    )
    org_b = EvidenceEntity(
        id="ent_org_b", record_kind="legal_entity", canonical_name="Org B", status="accepted"
    )
    person = EvidenceEntity(
        id="ent_person", record_kind="person", canonical_name="Jane Owner", status="accepted"
    )
    db.add_all([org_a, org_b, person])
    await db.flush()

    await _accepted_claim(
        db,
        claim_id="claim_beacon_owned",
        subject_id=beacon.id,
        object_id=org_a.id,
        predicate="directly_owns",
        pct=100.0,
        doc_key="beacon",
        sha256="a" * 64,
    )
    await _accepted_claim(
        db,
        claim_id="claim_ledger_owned",
        subject_id=ledger.id,
        object_id=org_a.id,
        predicate="directly_owns",
        pct=80.0,
        doc_key="ledger",
        sha256="b" * 64,
    )
    await _accepted_claim(
        db,
        claim_id="claim_org_a_owned",
        subject_id=org_a.id,
        object_id=org_b.id,
        predicate="owns_equity_in",
        pct=60.0,
        doc_key="org_a",
        sha256="c" * 64,
    )
    await _accepted_claim(
        db,
        claim_id="claim_org_b_controlled",
        subject_id=org_b.id,
        object_id=person.id,
        predicate="controls",
        pct=None,
        doc_key="org_b",
        sha256="d" * 64,
    )
    await db.commit()


@pytest.mark.asyncio
async def test_outlet_ownership_chain_orders_hops_with_percentage_and_evidence(
    db: AsyncSession,
) -> None:
    await _seed_spine(db)
    record = await get_atlas_entity(db, stable_source_id("Daily Beacon"))
    assert record is not None
    chain = record.details["ownership_chain"]
    assert [hop["label"] for hop in chain] == ["Daily Beacon", "Org A", "Org B"]
    assert chain[0]["percentage"] is None  # self hop carries no percentage
    assert chain[1]["percentage"] == pytest.approx(100.0)
    assert chain[1]["evidence_count"] > 0
    assert chain[1]["claim_ids"] == ["claim_beacon_owned"]
    assert chain[2]["percentage"] == pytest.approx(60.0)
    assert chain[2]["claim_ids"] == ["claim_org_a_owned"]
    assert chain[1]["entity_type"] == "organization"
    assert chain[1]["profile_path"] == "/wiki/organization/ent_org_a"


@pytest.mark.asyncio
async def test_organization_controls_rollup_reaches_multiple_hops_down(db: AsyncSession) -> None:
    await _seed_spine(db)
    record = await get_atlas_entity(db, "organization:ent_org_b")
    assert record is not None
    controlled_labels = {entry["label"] for entry in record.details["controls"]}
    assert controlled_labels == {"Org A", "Daily Beacon", "Nightly Ledger"}
    org_a_entry = next(e for e in record.details["controls"] if e["label"] == "Org A")
    assert org_a_entry["percentage"] == pytest.approx(60.0)
    assert org_a_entry["relation_type"] == "owns_equity_in"


@pytest.mark.asyncio
async def test_person_controls_rollup_reaches_through_owned_org_chain(db: AsyncSession) -> None:
    await _seed_spine(db)
    record = await get_atlas_entity(db, "person:ent_person")
    assert record is not None
    controlled_labels = {entry["label"] for entry in record.details["controls"]}
    assert controlled_labels == {"Org B", "Org A", "Daily Beacon", "Nightly Ledger"}


@pytest.mark.asyncio
async def test_outlet_siblings_via_owner_share_ultimate_root(db: AsyncSession) -> None:
    await _seed_spine(db)
    record = await get_atlas_entity(db, stable_source_id("Daily Beacon"))
    assert record is not None
    siblings = record.details["siblings_via_owner"]
    assert [s["label"] for s in siblings] == ["Nightly Ledger"]
    assert siblings[0]["claim_ids"]


@pytest.mark.asyncio
async def test_organization_and_person_profile_paths_point_to_new_routes(db: AsyncSession) -> None:
    await _seed_spine(db)
    org_record = await get_atlas_entity(db, "organization:ent_org_a")
    assert org_record is not None
    assert org_record.profile_path == "/wiki/organization/ent_org_a"

    person_record = await get_atlas_entity(db, "person:ent_person")
    assert person_record is not None
    assert person_record.profile_path == "/wiki/person/ent_person"


@pytest.mark.asyncio
async def test_cyclic_ownership_data_does_not_hang_the_chain_walk(db: AsyncSession) -> None:
    org_x = EvidenceEntity(
        id="ent_org_x", record_kind="legal_entity", canonical_name="Org X", status="accepted"
    )
    org_y = EvidenceEntity(
        id="ent_org_y", record_kind="legal_entity", canonical_name="Org Y", status="accepted"
    )
    db.add_all([org_x, org_y])
    await db.flush()
    await _accepted_claim(
        db,
        claim_id="claim_x_owns_y",
        subject_id=org_y.id,
        object_id=org_x.id,
        predicate="owns_equity_in",
        pct=50.0,
        doc_key="x_owns_y",
        sha256="e" * 64,
    )
    await _accepted_claim(
        db,
        claim_id="claim_y_owns_x",
        subject_id=org_x.id,
        object_id=org_y.id,
        predicate="owns_equity_in",
        pct=50.0,
        doc_key="y_owns_x",
        sha256="f" * 64,
    )
    await db.commit()

    record = await get_atlas_entity(db, "organization:ent_org_x")
    assert record is not None
    chain = record.details["ownership_chain"]
    # Cycle-guarded: the walk terminates instead of looping forever, and
    # never revisits a node once it has appeared in the chain.
    seen_ids = [hop["entity_id"] for hop in chain]
    assert len(seen_ids) == len(set(seen_ids))
    assert len(chain) <= 3
