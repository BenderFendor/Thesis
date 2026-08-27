"""Reporter byline evidence: ingestion, coverage bridge, and DB-backed script.

Covers Workstream 1 of docs/agents/traces/coverage-to-8000-plan.md end to
end: a byline record from the local article corpus becomes an evidence-spine
`authored_by` candidate claim, which the reporter edge-builder in
`atlas_graph_projection.py` turns into a reporter -> outlet/organization
edge with a real `evidence_count`, which `build_atlas_stats` then counts
toward `research_coverage_by_entity_type["reporter"]`. Also pins that an
`authored_by`/`employed_by` claim with no linked observation contributes
nothing -- coverage must not be free.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import Article, ArticleAuthor, Reporter
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.scripts.ingest_reporter_bylines import ingest_reporter_bylines
from app.services.atlas_graph import build_atlas_stats
from app.services.atlas_graph_helpers import stable_source_id
from app.services.primary_source_adapters import CapturedPayload, ingest_article_records

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 7, 22, tzinfo=UTC).replace(tzinfo=None)


async def _seed_publication(db, *, entity_id: str, name: str, domain: str) -> EvidenceEntity:
    entity = EvidenceEntity(
        id=entity_id, record_kind="publication", canonical_name=name, status="accepted"
    )
    db.add(entity)
    await db.flush()
    db.add_all(
        [
            EntityExternalId(
                entity_id=entity_id, scheme="rss_catalog_key", value=stable_source_id(name)
            ),
            EntityExternalId(entity_id=entity_id, scheme="domain", value=domain),
        ]
    )
    await db.flush()
    return entity


async def _seed_reporter(db, *, name: str, article_count: int = 1) -> Reporter:
    reporter = Reporter(name=name, normalized_name=name.lower(), article_count=article_count)
    db.add(reporter)
    await db.flush()
    return reporter


def _byline_record(
    *, reporter_id: int, author_name: str, url: str, outlet: str, domain: str
) -> dict:
    return {
        "record_type": "reporter_byline",
        "reporter_id": str(reporter_id),
        "article_url": url,
        "headline": "A story",
        "outlet_name": outlet,
        "outlet_domain": domain,
        "author_name": author_name,
    }


async def test_reporter_byline_writes_person_authored_by_outlet_not_article_entity(
    db_session,
) -> None:
    """The `reporter_byline` record type must not mint a per-article entity."""
    await _seed_publication(
        db_session, entity_id="ent_pub", name="Daily Beacon", domain="beacon.example"
    )
    record = _byline_record(
        reporter_id=42,
        author_name="Jane Reporter",
        url="https://beacon.example/story-1",
        outlet="Daily Beacon",
        domain="beacon.example",
    )
    payload = CapturedPayload.json(record["article_url"], record, retrieved_at=NOW)
    report = await ingest_article_records(db_session, payload=payload, records=[record])
    await db_session.commit()

    assert report.candidates == 1
    claims = list((await db_session.execute(select(EvidenceClaim))).scalars().all())
    assert len(claims) == 1
    [claim] = claims
    assert claim.predicate == "authored_by"
    assert claim.evidence_class == "article_byline"
    assert claim.status == "candidate"

    subject = await db_session.get(EvidenceEntity, claim.subject_entity_id)
    object_entity = await db_session.get(EvidenceEntity, claim.object_entity_id)
    assert subject is not None and subject.canonical_name == "Jane Reporter"
    assert subject.record_kind == "person"
    # The outlet resolves to the *existing* publication entity (matched by
    # domain external id) -- no new entity is minted for it, and critically
    # no throwaway per-article entity is created either.
    assert object_entity is not None and object_entity.id == "ent_pub"
    entities = list((await db_session.execute(select(EvidenceEntity))).scalars().all())
    assert len(entities) == 2  # publication + author, nothing else


async def test_reporter_byline_edge_moves_reporter_coverage(db_session) -> None:
    """A candidate authored_by claim with a linked observation moves coverage."""
    await _seed_publication(
        db_session, entity_id="ent_pub", name="Daily Beacon", domain="beacon.example"
    )
    reporter = await _seed_reporter(db_session, name="Jane Reporter")
    other_reporter = await _seed_reporter(db_session, name="No Evidence Reporter")

    record = _byline_record(
        reporter_id=reporter.id,
        author_name="Jane Reporter",
        url="https://beacon.example/story-1",
        outlet="Daily Beacon",
        domain="beacon.example",
    )
    payload = CapturedPayload.json(record["article_url"], record, retrieved_at=NOW)
    await ingest_article_records(db_session, payload=payload, records=[record])
    await db_session.commit()

    stats = await build_atlas_stats(db_session)
    by_type = stats.research_coverage_by_entity_type
    assert by_type["reporter"].numerator == 1
    assert by_type["reporter"].denominator == 2
    assert other_reporter.id  # sanity: second reporter exists and stays unresearched


async def test_authored_by_claim_without_linked_observation_grants_no_coverage(db_session) -> None:
    """An `authored_by` claim that never got a supporting observation link
    must not count -- coverage is not free just because a claim row exists."""
    await _seed_publication(
        db_session, entity_id="ent_pub", name="Daily Beacon", domain="beacon.example"
    )
    reporter = await _seed_reporter(db_session, name="Jane Reporter")

    author = EvidenceEntity(
        id="ent_author", record_kind="person", canonical_name="Jane Reporter", status="accepted"
    )
    db_session.add(author)
    await db_session.flush()

    document = EvidenceDocument(
        id="doc_orphan",
        source_url="https://beacon.example/story-2",
        document_type="reporter_byline",
        source_class="article_byline",
    )
    snapshot = DocumentSnapshot(
        id="snap_orphan",
        document_id=document.id,
        sha256_raw="f" * 64,
        storage_path="ingest://doc_orphan/f",
        retrieved_at=NOW,
        retriever="test",
        retriever_version="1.0",
    )
    # An observation exists but is deliberately never linked via
    # ClaimEvidence -- simulates a claim recorded without real support.
    EvidenceObservation(
        id="obs_orphan",
        snapshot_id=snapshot.id,
        locator={"record_index": 0},
        quoted_text="byline text",
        extractor="test",
        extractor_version="1.0",
    )
    db_session.add_all([document, snapshot])
    await db_session.flush()

    claim = EvidenceClaim(
        id="claim_orphan",
        subject_entity_id="ent_author",
        predicate="authored_by",
        object_entity_id="ent_pub",
        qualifiers={},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="article_byline",
        status="candidate",
        method_version="test/1.0",
        claim_hash="hash_orphan",
    )
    db_session.add(claim)
    await db_session.commit()
    # Deliberately no ClaimEvidence row linking claim_orphan to any observation.

    stats = await build_atlas_stats(db_session)
    assert stats.research_coverage_by_entity_type["reporter"].numerator == 0
    assert reporter.id  # sanity: reporter exists in the corpus, just unresearched


async def test_ingest_reporter_bylines_is_idempotent_by_skip(db_session) -> None:
    """The DB-backed script processes each reporter once, citing their most
    recent article, and skips already-researched reporters on rerun."""
    await _seed_publication(
        db_session, entity_id="ent_pub", name="Daily Beacon", domain="beacon.example"
    )
    reporter = await _seed_reporter(db_session, name="Jane Reporter", article_count=2)

    older = Article(
        title="Older story",
        source="Daily Beacon",
        url="https://beacon.example/older",
        published_at=NOW.replace(year=2025),
        content="body",
    )
    newer = Article(
        title="Newer story",
        source="Daily Beacon",
        url="https://beacon.example/newer",
        published_at=NOW,
        content="body",
    )
    db_session.add_all([older, newer])
    await db_session.flush()
    db_session.add_all(
        [
            ArticleAuthor(article_id=older.id, reporter_id=reporter.id),
            ArticleAuthor(article_id=newer.id, reporter_id=reporter.id),
        ]
    )
    await db_session.commit()

    first_report = await ingest_reporter_bylines(db_session)
    assert first_report.candidates == 1
    assert first_report.claims_created == 1

    [claim] = list((await db_session.execute(select(EvidenceClaim))).scalars().all())
    # Cited article must be the *newer* one (most-recent byline wins).
    linked_observation_id = (
        await db_session.execute(
            select(ClaimEvidence.observation_id).where(ClaimEvidence.claim_id == claim.id)
        )
    ).scalar_one()
    observation = await db_session.get(EvidenceObservation, linked_observation_id)
    snapshot = await db_session.get(DocumentSnapshot, observation.snapshot_id)
    cited_document = await db_session.get(EvidenceDocument, snapshot.document_id)
    assert cited_document.source_url == "https://beacon.example/newer"

    await db_session.refresh(reporter)
    assert "article_byline" in (reporter.research_sources or [])

    second_report = await ingest_reporter_bylines(db_session)
    assert second_report.candidates == 0
    assert second_report.claims_created == 0
