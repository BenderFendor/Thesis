"""Reporter/person Atlas node unification.

Ontology: "all reporters are people; not all people are reporters" (see
`docs/agents/traces/reporter-person-unification.md`). A `person`
`EvidenceEntity` carrying a `scoop_reporter_id` external id is the same
human as the `reporter:<id>` node `atlas_graph_projection.py` builds from
the legacy `Reporter` table -- it must not get its own duplicate Atlas
node, and its evidence edges must land on the reporter node instead. A
`person` entity without that external id is unaffected and keeps
projecting as a normal `person:<id>` node.

Covers:
1. Node dedup: a reporter-mapped person entity produces no `person:<id>`
   node.
2. Edge remap: a non-byline ownership-flavored claim on that entity
   resolves its endpoint to `reporter:<id>`, not `person:<id>`.
3. No double counting: an `authored_by` claim from a reporter-mapped
   person is not also re-emitted as a general ownership edge (it is
   already covered by `atlas_graph_projection.py`'s dedicated reporter
   byline edge builder) -- coverage on the reporter node comes from
   exactly one evidence-backed edge, not two.
4. A `person` entity with no `scoop_reporter_id` still projects normally.
5. `entity_resolver.resolve_or_create` attaches `scoop_reporter_id` when a
   person's name unambiguously matches one `Reporter` row, and does *not*
   when the name is ambiguous (two reporters share the name) or when no
   `Reporter` row matches at all.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import Reporter
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.atlas_evidence_projection import load_evidence_atlas_projection
from app.services.atlas_graph import build_atlas_graph, build_atlas_stats
from app.services.entity_resolver import resolve_or_create
from app.models.atlas import AtlasGraphFilters

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 7, 22, tzinfo=UTC).replace(tzinfo=None)


async def _seed_reporter(db, *, name: str, article_count: int = 1) -> Reporter:
    reporter = Reporter(name=name, normalized_name=name.lower(), article_count=article_count)
    db.add(reporter)
    await db.flush()
    return reporter


async def _seed_person(
    db, *, entity_id: str, name: str, scoop_reporter_id: str | None
) -> EvidenceEntity:
    entity = EvidenceEntity(
        id=entity_id,
        record_kind="person",
        entity_kind="person",
        canonical_name=name,
        status="accepted",
    )
    db.add(entity)
    await db.flush()
    if scoop_reporter_id is not None:
        db.add(
            EntityExternalId(
                entity_id=entity_id, scheme="scoop_reporter_id", value=scoop_reporter_id
            )
        )
        await db.flush()
    return entity


async def _seed_org(db, *, entity_id: str, name: str) -> EvidenceEntity:
    entity = EvidenceEntity(
        id=entity_id,
        record_kind="legal_entity",
        entity_kind="legal_entity",
        canonical_name=name,
        status="accepted",
    )
    db.add(entity)
    await db.flush()
    return entity


def _claim(*, claim_id: str, subject: str, predicate: str, obj: str) -> EvidenceClaim:
    return EvidenceClaim(
        id=claim_id,
        subject_entity_id=subject,
        predicate=predicate,
        object_entity_id=obj,
        qualifiers={},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="test_class",
        status="candidate",
        method_version="test/1.0",
        claim_hash=f"hash_{claim_id}",
    )


async def test_reporter_mapped_person_has_no_duplicate_node(db_session) -> None:
    reporter = await _seed_reporter(db_session, name="Jane Reporter")
    await _seed_person(
        db_session, entity_id="ent_jane", name="Jane Reporter", scoop_reporter_id=str(reporter.id)
    )
    await db_session.commit()

    nodes, _edges = await load_evidence_atlas_projection(
        db_session, AtlasGraphFilters(as_of=NOW, known_at=NOW)
    )
    assert "person:ent_jane" not in {node.id for node in nodes}
    assert not any(node.entity_type == "person" and node.label == "Jane Reporter" for node in nodes)


async def test_reporter_mapped_person_edge_lands_on_reporter_node(db_session) -> None:
    """A non-byline predicate (founded_by) on a reporter-mapped person entity
    must resolve its endpoint to the reporter node, proving evidence for
    *any* future person-typed fact -- not just bylines -- unifies correctly."""
    reporter = await _seed_reporter(db_session, name="Jane Reporter")
    await _seed_org(db_session, entity_id="ent_org", name="Beacon Media")
    await _seed_person(
        db_session, entity_id="ent_jane", name="Jane Reporter", scoop_reporter_id=str(reporter.id)
    )
    db_session.add(_claim(claim_id="c1", subject="ent_org", predicate="founded_by", obj="ent_jane"))
    await db_session.commit()

    _nodes, edges = await load_evidence_atlas_projection(
        db_session, AtlasGraphFilters(as_of=NOW, known_at=NOW)
    )
    matching = [edge for edge in edges if edge.predicate == "founded_by"]
    assert len(matching) == 1
    [edge] = matching
    # The ownership-edge builder maps object_entity_id -> source_id (see
    # _accepted_ownership_edges); the claim's object is the person, so the
    # unified endpoint is the edge's source, not target.
    assert edge.source_id == f"reporter:{reporter.id}"
    assert "ent_jane" not in edge.source_id
    assert "ent_jane" not in edge.target_id


async def test_reporter_byline_claim_not_double_counted(db_session) -> None:
    """An evidence-backed authored_by claim for a reporter-mapped person must
    not be emitted both by the dedicated reporter byline builder *and* the
    general ownership-edge builder -- exactly one evidence-backed edge (and
    exactly one unit of research coverage) for the reporter node, not two."""
    reporter = await _seed_reporter(db_session, name="Jane Reporter")
    await _seed_org(db_session, entity_id="ent_pub", name="Daily Beacon")
    await _seed_person(
        db_session, entity_id="ent_jane", name="Jane Reporter", scoop_reporter_id=str(reporter.id)
    )
    document = EvidenceDocument(
        id="doc_byline",
        source_url="https://beacon.example/story",
        document_type="reporter_byline",
        source_class="article_byline",
    )
    snapshot = DocumentSnapshot(
        id="snap_byline",
        document_id=document.id,
        sha256_raw="a" * 64,
        storage_path="ingest://doc_byline/a",
        retrieved_at=NOW,
        retriever="test",
        retriever_version="1.0",
    )
    observation = EvidenceObservation(
        id="obs_byline",
        snapshot_id=snapshot.id,
        locator={"record_index": 0},
        quoted_text="byline text",
        extractor="test",
        extractor_version="1.0",
    )
    db_session.add_all([document, snapshot, observation])
    await db_session.flush()
    db_session.add(
        _claim(claim_id="c2", subject="ent_jane", predicate="authored_by", obj="ent_pub")
    )
    await db_session.flush()
    db_session.add(ClaimEvidence(claim_id="c2", observation_id="obs_byline"))
    await db_session.commit()

    graph = await build_atlas_graph(
        db_session,
        AtlasGraphFilters(
            entity_types=["outlet", "organization", "person", "reporter"],
            limit_nodes=None,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )
    node_id = f"reporter:{reporter.id}"
    touching = [edge for edge in graph.edges if node_id in (edge.source_id, edge.target_id)]
    authored_edges = [edge for edge in touching if edge.predicate == "authored_by"]
    assert len(authored_edges) == 1
    assert authored_edges[0].evidence_count == 1
    # No duplicate person node either, and the reporter's research coverage
    # counts this claim exactly once.
    assert not any(node.id == "person:ent_jane" for node in graph.nodes)
    reporter_node = next(node for node in graph.nodes if node.id == node_id)
    assert reporter_node.evidence_coverage == "1 cited observations"

    stats = await build_atlas_stats(db_session)
    assert stats.research_coverage_by_entity_type["reporter"].numerator == 1
    assert stats.by_entity_type["person"] == 0


async def test_person_without_scoop_reporter_id_projects_normally(db_session) -> None:
    await _seed_org(db_session, entity_id="ent_org2", name="Acme Media")
    await _seed_person(db_session, entity_id="ent_owner", name="Real Owner", scoop_reporter_id=None)
    db_session.add(
        _claim(claim_id="c3", subject="ent_org2", predicate="founded_by", obj="ent_owner")
    )
    await db_session.commit()

    nodes, edges = await load_evidence_atlas_projection(
        db_session, AtlasGraphFilters(as_of=NOW, known_at=NOW)
    )
    assert "person:ent_owner" in {node.id for node in nodes}
    matching = [edge for edge in edges if edge.predicate == "founded_by"]
    assert len(matching) == 1
    assert matching[0].source_id == "person:ent_owner"


async def test_resolve_or_create_links_unambiguous_reporter_name(db_session) -> None:
    reporter = await _seed_reporter(db_session, name="Solo Byline")
    await db_session.commit()

    entity = await resolve_or_create(
        db_session,
        record_kind="person",
        external_ids={"author_profile": "https://example.com/solo-byline"},
        candidate_name="Solo Byline",
        entity_kind="person",
    )
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(EntityExternalId.value).where(
                    EntityExternalId.entity_id == entity.id,
                    EntityExternalId.scheme == "scoop_reporter_id",
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == [str(reporter.id)]


async def test_resolve_or_create_skips_ambiguous_reporter_name(db_session) -> None:
    await _seed_reporter(db_session, name="Duplicate Name")
    await _seed_reporter(db_session, name="Duplicate Name")
    await db_session.commit()

    entity = await resolve_or_create(
        db_session,
        record_kind="person",
        external_ids={"author_profile": "https://example.com/dup"},
        candidate_name="Duplicate Name",
        entity_kind="person",
    )
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(EntityExternalId.value).where(
                    EntityExternalId.entity_id == entity.id,
                    EntityExternalId.scheme == "scoop_reporter_id",
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


async def test_resolve_or_create_no_match_leaves_person_unlinked(db_session) -> None:
    entity = await resolve_or_create(
        db_session,
        record_kind="person",
        external_ids={"author_profile": "https://example.com/nobody"},
        candidate_name="Nobody Reporter-Like",
        entity_kind="person",
    )
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(EntityExternalId.value).where(
                    EntityExternalId.entity_id == entity.id,
                    EntityExternalId.scheme == "scoop_reporter_id",
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


async def test_resolve_or_create_does_not_query_reporters_when_id_already_given(db_session) -> None:
    """The bulk byline ingestor already supplies `scoop_reporter_id`
    directly -- the name-match fallback must not overwrite or duplicate it,
    and must not require a matching `Reporter` row to exist."""
    entity = await resolve_or_create(
        db_session,
        record_kind="person",
        external_ids={"scoop_reporter_id": "999999"},
        candidate_name="Someone",
        entity_kind="person",
    )
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(EntityExternalId.value).where(
                    EntityExternalId.entity_id == entity.id,
                    EntityExternalId.scheme == "scoop_reporter_id",
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == ["999999"]
