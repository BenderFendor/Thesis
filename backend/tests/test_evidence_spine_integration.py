"""End-to-end regression tests for the evidence-spine acceptance pipeline.

Builds a full chain (entities -> document -> snapshot -> observation -> claim
-> ClaimEvidence -> materialize -> Atlas projection -> proof bundle) against
an in-memory SQLite database, the same pattern used by
tests/conftest.py's `db_engine`/`db_session` fixtures.

These tests also pin down two regressions found during PR review:

1. `atlas_evidence_projection.load_evidence_atlas_projection` must report the
   same `evidence_root_count` as `evidence_spine.count_relationship_evidence_roots`
   for the same relationship (they previously used two different definitions
   of "independent root" -- one lineage-resolved, one a raw snapshot-hash
   count that overcounts mirrored/copied filings).
2. A proof bundle must never embed a `DocumentSnapshot.storage_path` (an
   internal server-side location for raw snapshot bytes) anywhere in its
   files -- it previously leaked into `snapshots/index.json`/`proof.json`.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.atlas import AtlasGraphFilters
from app.models.evidence import (
    AcceptedRelationship,
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
    RelationshipClaim,
    SourceLineage,
)
from app.services.atlas_evidence_projection import load_evidence_atlas_projection
from app.services.evidence_export import build_relationship_proof_bundle
from app.services.evidence_spine import (
    EvidenceSpineError,
    count_relationship_evidence_roots,
    evaluate_claim_by_id,
    list_relationships,
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


async def _seed_entities(db: AsyncSession) -> tuple[EvidenceEntity, EvidenceEntity]:
    publication = EvidenceEntity(
        id="ent_pub", record_kind="publication", canonical_name="Example Daily", status="candidate"
    )
    owner = EvidenceEntity(
        id="ent_owner",
        record_kind="legal_entity",
        canonical_name="Example Holdings LLC",
        status="candidate",
    )
    db.add_all([publication, owner])
    await db.flush()
    return publication, owner


async def _seed_registry_document(
    db: AsyncSession, *, doc_id: str = "doc_filing_1", sha256: str = "a" * 64
) -> tuple[EvidenceDocument, DocumentSnapshot]:
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
    return document, snapshot


async def _seed_observation(
    db: AsyncSession, snapshot: DocumentSnapshot, *, obs_id: str, entailment: str
) -> EvidenceObservation:
    observation = EvidenceObservation(
        id=obs_id,
        snapshot_id=snapshot.id,
        locator={"page": 1, "field": "beneficial_owner"},
        quoted_text="Example Holdings LLC holds 100% of Example Daily.",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment=entailment,
        reviewed_by="reviewer@test" if entailment == "reviewed_yes" else None,
    )
    db.add(observation)
    await db.flush()
    return observation


async def _seed_claim(
    db: AsyncSession,
    publication: EvidenceEntity,
    owner: EvidenceEntity,
    *,
    claim_id: str,
    evidence_class: str,
    observation: EvidenceObservation | None,
) -> EvidenceClaim:
    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=publication.id,
        predicate="directly_owns",
        object_entity_id=owner.id,
        qualifiers={"pct": 100, "direct": True},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class=evidence_class,
        status="candidate",
        method_version="test/1.0",
        claim_hash=f"hash_{claim_id}",
    )
    db.add(claim)
    await db.flush()
    if observation is not None:
        db.add(ClaimEvidence(claim_id=claim_id, observation_id=observation.id, role="supporting"))
        await db.flush()
    return claim


@pytest.mark.asyncio
async def test_catalog_metadata_alone_is_rejected(db: AsyncSession) -> None:
    publication, owner = await _seed_entities(db)
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_catalog",
        evidence_class="catalog_metadata",
        observation=None,
    )
    evaluation = await evaluate_claim_by_id(db, claim.id)
    assert evaluation.accepted is False
    with pytest.raises(EvidenceSpineError):
        await materialize_claim(db, claim.id, reviewer="reviewer@test")


@pytest.mark.asyncio
async def test_materialize_requires_non_empty_reviewer(db: AsyncSession) -> None:
    """Regression: `materialize_claim` used to accept no reviewer at all, leaving
    accepted relationships with no record of who accepted them."""
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db)
    observation = await _seed_observation(
        db, snapshot, obs_id="obs_no_reviewer", entailment="reviewed_yes"
    )
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_no_reviewer",
        evidence_class="registry_filing",
        observation=observation,
    )
    with pytest.raises(EvidenceSpineError, match="reviewer"):
        await materialize_claim(db, claim.id, reviewer="")
    with pytest.raises(EvidenceSpineError, match="reviewer"):
        await materialize_claim(db, claim.id, reviewer="   ")


@pytest.mark.asyncio
async def test_materialized_relationship_records_reviewer_identity(db: AsyncSession) -> None:
    """Regression: the accepted relationship must record who materialized it
    (the audit trail this endpoint previously had none of)."""
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db)
    observation = await _seed_observation(
        db, snapshot, obs_id="obs_audit", entailment="reviewed_yes"
    )
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_audit",
        evidence_class="registry_filing",
        observation=observation,
    )
    relationship = await materialize_claim(db, claim.id, reviewer="  alice@newsroom.test  ")
    await db.flush()
    assert relationship.materialized_by == "alice@newsroom.test"

    query = await list_relationships(db, as_of=NOW, known_at=NOW, entity_id=publication.id)
    assert query.relationships[0].materialized_by == "alice@newsroom.test"


@pytest.mark.asyncio
async def test_reviewed_yes_without_recorded_reviewer_is_rejected_at_the_db_layer(
    db: AsyncSession,
) -> None:
    """Regression: an observation could previously carry entailment='reviewed_yes'
    with no `reviewed_by` set, which would let a claim materialize without any
    real review action behind it. The DB now enforces this invariant directly
    (see `ck_evidence_observation_reviewed_yes_has_reviewer`); the equivalent
    application-level guard is covered by
    tests/test_evidence_policy.py::test_reviewed_yes_without_a_recorded_reviewer_does_not_qualify
    for callers that bypass the ORM/DB constraint."""
    from sqlalchemy.exc import IntegrityError

    _, snapshot = await _seed_registry_document(db)
    observation = EvidenceObservation(
        id="obs_unattributed",
        snapshot_id=snapshot.id,
        locator={"page": 1, "field": "beneficial_owner"},
        quoted_text="Example Holdings LLC holds 100% of Example Daily.",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment="reviewed_yes",
        reviewed_by=None,
    )
    db.add(observation)
    with pytest.raises(IntegrityError):
        await db.flush()


@pytest.mark.asyncio
async def test_model_suggested_entailment_is_rejected(db: AsyncSession) -> None:
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db)
    observation = await _seed_observation(
        db, snapshot, obs_id="obs_model", entailment="model_suggested"
    )
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_model",
        evidence_class="registry_filing",
        observation=observation,
    )
    evaluation = await evaluate_claim_by_id(db, claim.id)
    assert evaluation.accepted is False
    assert "no reviewed evidence entails the claim" in "; ".join(evaluation.reasons)


@pytest.mark.asyncio
async def test_reviewed_yes_with_permitted_class_succeeds_and_materializes(
    db: AsyncSession,
) -> None:
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db)
    observation = await _seed_observation(db, snapshot, obs_id="obs_ok", entailment="reviewed_yes")
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_ok",
        evidence_class="registry_filing",
        observation=observation,
    )

    evaluation = await evaluate_claim_by_id(db, claim.id)
    assert evaluation.accepted is True
    assert evaluation.independent_root_count == 1

    relationship = await materialize_claim(db, claim.id, reviewer="reviewer@test")
    await db.flush()
    assert relationship.status == "accepted"
    assert relationship.acceptance_policy_version == evaluation.policy_version

    links = list(
        (
            await db.execute(
                RelationshipClaim.__table__.select().where(
                    RelationshipClaim.relationship_id == relationship.id
                )
            )
        ).fetchall()
    )
    assert len(links) == 1
    assert links[0].claim_id == claim.id


@pytest.mark.asyncio
async def test_relationship_cannot_materialize_before_qualifying_evidence(db: AsyncSession) -> None:
    publication, owner = await _seed_entities(db)
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_none",
        evidence_class="registry_filing",
        observation=None,
    )
    with pytest.raises(EvidenceSpineError):
        await materialize_claim(db, claim.id, reviewer="reviewer@test")
    query = await list_relationships(db, as_of=NOW, known_at=NOW, entity_id=publication.id)
    assert query.relationships == []


@pytest.mark.asyncio
async def test_duplicate_materialization_is_idempotent_and_keeps_supporting_links(
    db: AsyncSession,
) -> None:
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db)
    observation = await _seed_observation(db, snapshot, obs_id="obs_dup", entailment="reviewed_yes")
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_dup",
        evidence_class="registry_filing",
        observation=observation,
    )

    first = await materialize_claim(db, claim.id, reviewer="reviewer@test")
    await db.flush()
    second = await materialize_claim(db, claim.id, reviewer="reviewer@test")
    await db.flush()
    assert first.id == second.id

    rows = list(
        (
            await db.execute(
                AcceptedRelationship.__table__.select().where(
                    AcceptedRelationship.relationship_hash == first.relationship_hash
                )
            )
        ).fetchall()
    )
    assert len(rows) == 1

    query = await list_relationships(db, as_of=NOW, known_at=NOW, entity_id=publication.id)
    assert len(query.relationships) == 1
    assert query.relationships[0].claim_ids == [claim.id]


@pytest.mark.asyncio
async def test_accepted_only_query_returns_the_accepted_edge(db: AsyncSession) -> None:
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db)
    observation = await _seed_observation(db, snapshot, obs_id="obs_q", entailment="reviewed_yes")
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_q",
        evidence_class="registry_filing",
        observation=observation,
    )
    await materialize_claim(db, claim.id, reviewer="reviewer@test")
    await db.flush()

    query = await list_relationships(db, as_of=NOW, known_at=NOW)
    assert any(
        row.subject_entity_id == publication.id and row.predicate == "directly_owns"
        for row in query.relationships
    )


@pytest.mark.asyncio
async def test_atlas_root_count_matches_evidence_api_root_count_for_mirrored_filing(
    db: AsyncSession,
) -> None:
    """Regression test: two DocumentSnapshots that are lineage-linked mirrors
    of the same filing (one `SourceLineage` row) must collapse to ONE
    independent root everywhere -- in the evidence API's
    `count_relationship_evidence_roots` AND in the Atlas projection's
    `evidence_root_count`. Before the fix, Atlas counted raw distinct
    snapshot hashes and would have reported 2 roots here instead of 1.
    """
    publication, owner = await _seed_entities(db)
    parent_doc, parent_snapshot = await _seed_registry_document(
        db, doc_id="doc_parent", sha256="a" * 64
    )
    child_doc, child_snapshot = await _seed_registry_document(
        db, doc_id="doc_child", sha256="b" * 64
    )
    db.add(
        SourceLineage(
            parent_document_id=parent_doc.id, child_document_id=child_doc.id, relation="mirror"
        )
    )
    await db.flush()

    obs_parent = await _seed_observation(
        db, parent_snapshot, obs_id="obs_parent", entailment="reviewed_yes"
    )
    obs_child = await _seed_observation(
        db, child_snapshot, obs_id="obs_child", entailment="reviewed_yes"
    )

    claim = EvidenceClaim(
        id="claim_mirror",
        subject_entity_id=publication.id,
        predicate="directly_owns",
        object_entity_id=owner.id,
        qualifiers={"pct": 100, "direct": True},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="registry_filing",
        status="candidate",
        method_version="test/1.0",
        claim_hash="hash_mirror",
    )
    db.add(claim)
    await db.flush()
    db.add_all(
        [
            ClaimEvidence(claim_id=claim.id, observation_id=obs_parent.id, role="supporting"),
            ClaimEvidence(claim_id=claim.id, observation_id=obs_child.id, role="supporting"),
        ]
    )
    await db.flush()

    relationship = await materialize_claim(db, claim.id, reviewer="reviewer@test")
    await db.flush()

    api_root_count = await count_relationship_evidence_roots(db, [claim.id])
    assert api_root_count == 1, (
        "mirrored filing sharing one lineage root must count as one independent root"
    )

    _, edges = await load_evidence_atlas_projection(db, AtlasGraphFilters(as_of=NOW, known_at=NOW))
    matching = [edge for edge in edges if edge.id == f"evidence-edge:{relationship.id}"]
    assert len(matching) == 1
    assert matching[0].evidence_root_count == api_root_count, (
        "Atlas evidence_root_count must agree with the evidence API's lineage-resolved root count"
    )


@pytest.mark.asyncio
async def test_proof_bundle_never_leaks_local_storage_path(db: AsyncSession) -> None:
    publication, owner = await _seed_entities(db)
    _, snapshot = await _seed_registry_document(db, sha256="c" * 64)
    observation = await _seed_observation(
        db, snapshot, obs_id="obs_proof", entailment="reviewed_yes"
    )
    claim = await _seed_claim(
        db,
        publication,
        owner,
        claim_id="claim_proof",
        evidence_class="registry_filing",
        observation=observation,
    )
    relationship = await materialize_claim(db, claim.id, reviewer="reviewer@test")
    await db.flush()

    bundle_bytes = await build_relationship_proof_bundle(
        db,
        relationship.id,
        as_of=NOW,
        known_at=NOW,
        commit_sha="deadbeef",
        dataset_snapshot="test-dataset",
    )

    import zipfile
    import io

    with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as archive:
        for name in archive.namelist():
            content = archive.read(name).decode("utf-8", errors="ignore")
            assert snapshot.storage_path not in content, (
                f"{name} leaked the local snapshot storage_path"
            )
            assert "/var/scoop/snapshots" not in content, f"{name} leaked a local filesystem path"
