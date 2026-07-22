"""Phase 2 regression tests: Atlas graph projection off the evidence spine.

Covers the Atlas rebuild plan's Phase 2 acceptance criteria: outlet/
organization/person nodes sourced from `EvidenceEntity`, ownership edges
(accepted and candidate) sourced from `AcceptedRelationship`/`EvidenceClaim`,
`sibling_via_owner` rollups, merged-entity collapsing, the removal of the
`exact_canonical_label`/coauthor/shared_outlet machinery, the legacy
"source" entity-type query-param alias, and the fresh-DB catalog fallback.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Article, ArticleAuthor, Base, Reporter
from app.models.atlas import AtlasGraphFilters
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EntityResolution,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.atlas_graph import build_atlas_graph
from app.services.atlas_graph_helpers import stable_source_id
from app.api.routes.wiki_atlas import _validated_entity_types
from app.services.evidence_spine import materialize_claim

NOW = datetime(2026, 7, 20, tzinfo=UTC).replace(tzinfo=None)

CATALOG: dict[str, dict[str, Any]] = {
    "Daily Beacon": {
        "url": "https://daily-beacon.example/rss",
        "site_url": "https://daily-beacon.example",
    },
    "Nightly Ledger": {
        "url": "https://nightly-ledger.example/rss",
        "site_url": "https://nightly-ledger.example",
    },
    "Third Outlet": {
        "url": "https://third-outlet.example/rss",
        "site_url": "https://third-outlet.example",
    },
}


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


def _patched_catalog():
    return patch("app.services.atlas_graph_helpers.get_rss_sources", lambda: CATALOG)


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


async def _accepted_ownership_claim(
    db: AsyncSession,
    *,
    claim_id: str,
    subject_id: str,
    object_id: str,
    predicate: str,
    pct: float | None,
    doc_key: str,
    sha256: str,
) -> str:
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
    relationship = await materialize_claim(db, claim_id, reviewer="reviewer@test")
    await db.flush()
    return str(relationship.id)


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


@pytest.mark.asyncio
async def test_ownership_edges_populate_from_accepted_relationships(db: AsyncSession) -> None:
    beacon = await _seed_publication(db, entity_id="ent_beacon", name="Daily Beacon")
    ledger = await _seed_publication(db, entity_id="ent_ledger", name="Nightly Ledger")
    owner = EvidenceEntity(
        id="ent_owner",
        record_kind="legal_entity",
        canonical_name="Beacon Holdings",
        status="accepted",
    )
    founder = EvidenceEntity(
        id="ent_founder", record_kind="person", canonical_name="Jane Founder", status="accepted"
    )
    db.add_all([owner, founder])
    await db.flush()

    await _accepted_ownership_claim(
        db,
        claim_id="claim_beacon_owned",
        subject_id=beacon.id,
        object_id=owner.id,
        predicate="directly_owns",
        pct=100.0,
        doc_key="beacon",
        sha256="a" * 64,
    )
    await _accepted_ownership_claim(
        db,
        claim_id="claim_ledger_owned",
        subject_id=ledger.id,
        object_id=owner.id,
        predicate="directly_owns",
        pct=80.0,
        doc_key="ledger",
        sha256="b" * 64,
    )
    await _accepted_ownership_claim(
        db,
        claim_id="claim_owner_founded",
        subject_id=owner.id,
        object_id=founder.id,
        predicate="founded_by",
        pct=None,
        doc_key="founder",
        sha256="c" * 64,
    )
    await db.commit()

    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization", "person"],
            limit_nodes=100,
            limit_edges=200,
        ),
    )

    outlet_ids = {node.id for node in graph.nodes if node.entity_type == "outlet"}
    assert stable_source_id("Daily Beacon") in outlet_ids
    assert stable_source_id("Nightly Ledger") in outlet_ids
    org_nodes = [node for node in graph.nodes if node.entity_type == "organization"]
    assert org_nodes and org_nodes[0].id == "organization:ent_owner"
    person_nodes = [node for node in graph.nodes if node.entity_type == "person"]
    assert person_nodes and person_nodes[0].id == "person:ent_founder"

    ownership_edges = [e for e in graph.edges if e.raw_relation_type == "directly_owns"]
    assert len(ownership_edges) == 2
    for edge in ownership_edges:
        assert edge.fact_status == "accepted"
        assert edge.accepted_fact is True
        assert edge.source_id == "organization:ent_owner"
        assert edge.evidence_count > 0
        assert edge.claim_ids
        assert edge.acceptance_policy_version

    beacon_edge = next(
        e for e in ownership_edges if e.target_id == stable_source_id("Daily Beacon")
    )
    assert beacon_edge.ownership_percentage == pytest.approx(100.0)

    founded_edges = [e for e in graph.edges if e.relation_type == "founded_by"]
    assert len(founded_edges) == 1
    assert founded_edges[0].source_id == "person:ent_founder"
    assert founded_edges[0].target_id == "organization:ent_owner"

    # Sibling rollup: both outlets share the same ultimate owner.
    sibling_edges = [e for e in graph.edges if e.relation_type == "sibling_via_owner"]
    assert len(sibling_edges) == 1
    sibling_pair = {sibling_edges[0].source_id, sibling_edges[0].target_id}
    assert sibling_pair == {stable_source_id("Daily Beacon"), stable_source_id("Nightly Ledger")}
    assert sibling_edges[0].direction == "undirected"
    assert sibling_edges[0].is_inferred is True

    # No name-collision hack survives the rewrite.
    assert not any(e.raw_relation_type == "exact_canonical_label" for e in graph.edges)
    assert not any(e.relation_type in {"coauthor", "shared_outlet"} for e in graph.edges)


@pytest.mark.asyncio
async def test_candidate_claim_renders_as_candidate_edge_and_respects_accepted_only(
    db: AsyncSession,
) -> None:
    beacon = await _seed_publication(db, entity_id="ent_beacon2", name="Daily Beacon")
    owner = EvidenceEntity(
        id="ent_owner2",
        record_kind="legal_entity",
        canonical_name="Unverified Holdings",
        status="accepted",
    )
    db.add(owner)
    await db.flush()
    observation = await _seed_document_chain(db, key="candidate", sha256="d" * 64)
    claim = EvidenceClaim(
        id="claim_candidate",
        subject_entity_id=beacon.id,
        predicate="directly_owns",
        object_entity_id=owner.id,
        qualifiers={"pct": 40.0, "direct": True},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="third_party_assessment",
        status="candidate",
        method_version="test/1.0",
        claim_hash="hash_claim_candidate",
    )
    db.add(claim)
    await db.flush()
    db.add(ClaimEvidence(claim_id=claim.id, observation_id=observation.id, role="supporting"))
    await db.commit()

    graph_all = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization"], limit_nodes=100, limit_edges=200
        ),
    )
    candidate_edges = [e for e in graph_all.edges if e.raw_relation_type == "directly_owns"]
    assert len(candidate_edges) == 1
    assert candidate_edges[0].fact_status == "candidate"
    assert candidate_edges[0].accepted_fact is False
    assert candidate_edges[0].is_inferred is True

    graph_accepted_only = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization"],
            limit_nodes=100,
            limit_edges=200,
            accepted_only=True,
        ),
    )
    assert not any(e.raw_relation_type == "directly_owns" for e in graph_accepted_only.edges)


@pytest.mark.asyncio
async def test_merged_entity_collapses_to_survivor(db: AsyncSession) -> None:
    survivor = await _seed_publication(db, entity_id="ent_survivor", name="Daily Beacon")
    shadow = EvidenceEntity(
        id="ent_shadow",
        record_kind="publication",
        canonical_name="Daily Beacon (dup)",
        status="merged",
    )
    db.add(shadow)
    await db.flush()
    db.add(
        EntityResolution(
            id="res_merge_1",
            left_entity_id=shadow.id,
            right_entity_id=survivor.id,
            decision="same_as",
            status="accepted",
            decided_by="test",
        )
    )
    await db.commit()

    graph = await build_atlas_graph(
        db, AtlasGraphFilters(entity_types=["outlet"], limit_nodes=100, limit_edges=200)
    )
    outlet_labels = [node.label for node in graph.nodes if node.entity_type == "outlet"]
    assert outlet_labels.count("Daily Beacon") + outlet_labels.count("Daily Beacon (dup)") == 1
    assert "Daily Beacon (dup)" not in outlet_labels


@pytest.mark.asyncio
async def test_legacy_source_entity_type_param_normalizes_to_outlet() -> None:
    assert _validated_entity_types("source") == ["outlet"]
    assert _validated_entity_types("source,organization") == ["outlet", "organization"]


@pytest.mark.asyncio
async def test_no_synthetic_reporter_edges_from_shared_bylines(db: AsyncSession) -> None:
    reporter_a = Reporter(name="Alex One", canonical_name="Alex One", article_count=2)
    reporter_b = Reporter(name="Alex Two", canonical_name="Alex Two", article_count=2)
    db.add_all([reporter_a, reporter_b])
    await db.flush()

    article = Article(
        title="Shared byline story",
        url="https://daily-beacon.example/a1",
        source="Daily Beacon",
        content="",
        published_at=NOW,
    )
    db.add(article)
    await db.flush()
    db.add_all(
        [
            ArticleAuthor(article_id=article.id, reporter_id=reporter_a.id),
            ArticleAuthor(article_id=article.id, reporter_id=reporter_b.id),
        ]
    )
    await db.commit()

    with _patched_catalog():
        graph = await build_atlas_graph(
            db, AtlasGraphFilters(entity_types=["reporter"], limit_nodes=100, limit_edges=200)
        )
    assert not any(e.relation_type in {"coauthor", "shared_outlet"} for e in graph.edges)


@pytest.mark.asyncio
async def test_fresh_db_falls_back_to_catalog_outlets(db: AsyncSession) -> None:
    """No EvidenceEntity rows exist yet (backfill hasn't run): the Atlas must
    still render outlets, projected straight from the RSS catalog."""
    with _patched_catalog():
        graph = await build_atlas_graph(
            db, AtlasGraphFilters(entity_types=["outlet"], limit_nodes=100, limit_edges=200)
        )
    outlet_ids = {node.id for node in graph.nodes if node.entity_type == "outlet"}
    assert outlet_ids == {stable_source_id(name) for name in CATALOG}
    assert not any(node.entity_type in {"organization", "person"} for node in graph.nodes)
