"""Phase 4 regression tests: reporter career timeline + shared-owner findings.

Covers `reporter_career_timeline.build_reporter_career_timeline`: merging
byline history (from `ArticleAuthor`/`Article`) with
`Reporter.institutional_affiliations` into one chronological timeline, and
grouping the reporter's byline outlets by ultimate accepted owner using the
Phase 2/3 ownership-chain helpers.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Article, ArticleAuthor, Base, Reporter
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.atlas_graph_helpers import stable_source_id
from app.services.evidence_spine import materialize_claim
from app.services.reporter_career_timeline import build_reporter_career_timeline

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


@pytest.mark.asyncio
async def test_timeline_merges_and_orders_byline_and_affiliation_entries(db: AsyncSession) -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        normalized_name="jane doe",
        institutional_affiliations=[
            {
                "org": "Press Freedom Institute",
                "role": "board member",
                "start_date": "2015-01-01",
                "end_date": "2018-01-01",
                "url": "https://littlesis.org/entities/999",
            }
        ],
    )
    articles = [
        Article(
            id=1,
            title="Early Beat",
            source="Daily Beacon",
            url="https://beacon.example.com/1",
            published_at=datetime(2020, 1, 1),
            category="politics",
        ),
        Article(
            id=2,
            title="Later Beat",
            source="Daily Beacon",
            url="https://beacon.example.com/2",
            published_at=datetime(2020, 6, 1),
            category="politics",
        ),
        Article(
            id=3,
            title="New Job",
            source="Nightly Ledger",
            url="https://ledger.example.com/1",
            published_at=datetime(2021, 3, 1),
            category="politics",
        ),
    ]
    db.add(reporter)
    db.add_all(articles)
    db.add_all(
        [
            ArticleAuthor(article_id=1, reporter_id=1),
            ArticleAuthor(article_id=2, reporter_id=1),
            ArticleAuthor(article_id=3, reporter_id=1),
        ]
    )
    await db.commit()

    result = await build_reporter_career_timeline(db, reporter)
    timeline = result["timeline"]

    # Chronological: affiliation (2015) < Beacon byline (2020-01) < Ledger byline (2021-03).
    assert [entry["outlet"] for entry in timeline] == [
        "Press Freedom Institute",
        "Daily Beacon",
        "Nightly Ledger",
    ]
    assert [entry["source"] for entry in timeline] == ["affiliation", "byline", "byline"]

    beacon_entry = timeline[1]
    assert beacon_entry["article_count"] == 2
    assert beacon_entry["start_date"] == "2020-01-01T00:00:00"
    assert beacon_entry["end_date"] == "2020-06-01T00:00:00"

    affiliation_entry = timeline[0]
    assert affiliation_entry["evidence_url"] == "https://littlesis.org/entities/999"
    assert affiliation_entry["role"] == "board member"
    assert affiliation_entry["article_count"] is None

    # No ownership data seeded -> no shared-owner findings.
    assert result["shared_owner_findings"] == []


@pytest.mark.asyncio
async def test_shared_owner_finding_emitted_when_two_byline_outlets_share_root(
    db: AsyncSession,
) -> None:
    reporter = Reporter(id=1, name="Jane Doe", normalized_name="jane doe")
    articles = [
        Article(
            id=1,
            title="Beacon Story",
            source="Daily Beacon",
            url="https://beacon.example.com/1",
            published_at=datetime(2020, 1, 1),
            category="politics",
        ),
        Article(
            id=2,
            title="Ledger Story",
            source="Nightly Ledger",
            url="https://ledger.example.com/1",
            published_at=datetime(2021, 1, 1),
            category="politics",
        ),
    ]
    db.add(reporter)
    db.add_all(articles)
    db.add_all(
        [
            ArticleAuthor(article_id=1, reporter_id=1),
            ArticleAuthor(article_id=2, reporter_id=1),
        ]
    )

    beacon = await _seed_publication(db, entity_id="ent_beacon", name="Daily Beacon")
    ledger = await _seed_publication(db, entity_id="ent_ledger", name="Nightly Ledger")
    org = EvidenceEntity(
        id="ent_org", record_kind="legal_entity", canonical_name="Mega Corp", status="accepted"
    )
    db.add(org)
    await db.flush()

    await _accepted_claim(
        db,
        claim_id="claim_beacon_owned",
        subject_id=beacon.id,
        object_id=org.id,
        predicate="directly_owns",
        pct=100.0,
        doc_key="beacon",
        sha256="a" * 64,
    )
    await _accepted_claim(
        db,
        claim_id="claim_ledger_owned",
        subject_id=ledger.id,
        object_id=org.id,
        predicate="directly_owns",
        pct=75.0,
        doc_key="ledger",
        sha256="b" * 64,
    )
    await db.commit()

    result = await build_reporter_career_timeline(db, reporter)
    findings = result["shared_owner_findings"]

    assert len(findings) == 1
    finding = findings[0]
    assert finding["owner"]["label"] == "Mega Corp"
    assert finding["owner"]["entity_id"] == "organization:ent_org"
    outlet_labels = {outlet["label"] for outlet in finding["outlets"]}
    assert outlet_labels == {"Daily Beacon", "Nightly Ledger"}
    assert finding["evidence_count"] > 0
    assert set(finding["claim_ids"]) == {"claim_beacon_owned", "claim_ledger_owned"}


@pytest.mark.asyncio
async def test_no_shared_owner_finding_when_outlets_have_different_owners(
    db: AsyncSession,
) -> None:
    reporter = Reporter(id=1, name="Jane Doe", normalized_name="jane doe")
    articles = [
        Article(
            id=1,
            title="Beacon Story",
            source="Daily Beacon",
            url="https://beacon.example.com/1",
            published_at=datetime(2020, 1, 1),
            category="politics",
        ),
        Article(
            id=2,
            title="Ledger Story",
            source="Nightly Ledger",
            url="https://ledger.example.com/1",
            published_at=datetime(2021, 1, 1),
            category="politics",
        ),
    ]
    db.add(reporter)
    db.add_all(articles)
    db.add_all(
        [
            ArticleAuthor(article_id=1, reporter_id=1),
            ArticleAuthor(article_id=2, reporter_id=1),
        ]
    )

    beacon = await _seed_publication(db, entity_id="ent_beacon", name="Daily Beacon")
    ledger = await _seed_publication(db, entity_id="ent_ledger", name="Nightly Ledger")
    org_a = EvidenceEntity(
        id="ent_org_a", record_kind="legal_entity", canonical_name="Org A", status="accepted"
    )
    org_b = EvidenceEntity(
        id="ent_org_b", record_kind="legal_entity", canonical_name="Org B", status="accepted"
    )
    db.add_all([org_a, org_b])
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
        object_id=org_b.id,
        predicate="directly_owns",
        pct=100.0,
        doc_key="ledger",
        sha256="b" * 64,
    )
    await db.commit()

    result = await build_reporter_career_timeline(db, reporter)
    assert result["shared_owner_findings"] == []


@pytest.mark.asyncio
async def test_single_outlet_reporter_has_no_shared_owner_findings(db: AsyncSession) -> None:
    reporter = Reporter(id=1, name="Jane Doe", normalized_name="jane doe")
    article = Article(
        id=1,
        title="Only Story",
        source="Daily Beacon",
        url="https://beacon.example.com/1",
        published_at=datetime(2020, 1, 1),
        category="politics",
    )
    db.add(reporter)
    db.add(article)
    db.add(ArticleAuthor(article_id=1, reporter_id=1))
    await db.commit()

    result = await build_reporter_career_timeline(db, reporter)
    assert result["shared_owner_findings"] == []
    assert len(result["timeline"]) == 1
