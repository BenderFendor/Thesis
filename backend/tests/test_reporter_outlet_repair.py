"""Repair for the feedburner.com site_url collision (audit rec 1)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import Article, ArticleAuthor, Reporter
from app.models.evidence import EntityExternalId, EvidenceClaim, EvidenceEntity
from app.services.atlas_graph_helpers import stable_source_id
from app.services import reporter_outlet_repair as repair_module
from app.services.reporter_outlet_repair import repair_feedburner_collision
from app.scripts.ingest_reporter_bylines import RESEARCH_SOURCE_MARKER

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 7, 22, tzinfo=UTC).replace(tzinfo=None)

_FAKE_CATALOG = {
    "Breitbart": {"site_url": "https://www.breitbart.com"},
    "Ekathimerini": {"site_url": "https://www.ekathimerini.com"},
    "RealClearPolitics": {"site_url": "https://www.realclearpolitics.com"},
}


@pytest.fixture(autouse=True)
def _patch_catalog(monkeypatch):
    monkeypatch.setattr(repair_module, "get_rss_sources", lambda: _FAKE_CATALOG)


async def _seed_wrong_atlantic_entity(db) -> str:
    """Simulate pre-fix state: The Atlantic owns 3 misattributed rss_catalog_key rows."""
    entity = EvidenceEntity(
        id="ent_atlantic",
        record_kind="legal_entity",
        canonical_name="The Atlantic",
        entity_kind="publication_brand",
        status="accepted",
    )
    db.add(entity)
    await db.flush()
    rows = [EntityExternalId(entity_id="ent_atlantic", scheme="domain", value="feedburner.com")]
    for name in _FAKE_CATALOG:
        rows.append(
            EntityExternalId(
                entity_id="ent_atlantic", scheme="rss_catalog_key", value=stable_source_id(name)
            )
        )
    db.add_all(rows)
    await db.flush()
    return entity.id


async def _seed_misattributed_reporter(db, *, name: str, source: str) -> tuple[Reporter, str]:
    """A reporter whose real byline is at `source`, but has a wrong authored_by claim -> Atlantic."""
    reporter = Reporter(
        name=name,
        normalized_name=name.lower(),
        article_count=1,
        research_sources=[RESEARCH_SOURCE_MARKER],
    )
    db.add(reporter)
    await db.flush()

    article = Article(
        title="A story",
        source=source,
        url=f"https://example.com/{name}",
        published_at=NOW,
        content="body",
    )
    db.add(article)
    await db.flush()
    db.add(ArticleAuthor(article_id=article.id, reporter_id=reporter.id))

    person = EvidenceEntity(
        id=f"ent_person_{reporter.id}",
        record_kind="person",
        canonical_name=name,
        entity_kind="person",
        status="accepted",
    )
    db.add(person)
    await db.flush()
    db.add(
        EntityExternalId(entity_id=person.id, scheme="scoop_reporter_id", value=str(reporter.id))
    )
    claim = EvidenceClaim(
        id=f"claim_{reporter.id}",
        subject_entity_id=person.id,
        predicate="authored_by",
        object_entity_id="ent_atlantic",
        qualifiers={},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="article_byline",
        status="candidate",
        method_version="test/1.0",
        claim_hash=f"hash_{reporter.id}",
    )
    db.add(claim)
    await db.flush()
    return reporter, claim.id


async def test_repair_repoints_stale_catalog_keys_and_leaves_atlantic_domain(db_session) -> None:
    await _seed_wrong_atlantic_entity(db_session)
    await db_session.commit()

    report = await repair_feedburner_collision(db_session)
    await db_session.commit()

    assert report.entities_repointed == 3
    assert sorted(report.repointed_names) == ["Breitbart", "Ekathimerini", "RealClearPolitics"]

    for name in _FAKE_CATALOG:
        row = (
            await db_session.execute(
                select(EntityExternalId).where(
                    EntityExternalId.scheme == "rss_catalog_key",
                    EntityExternalId.value == stable_source_id(name),
                )
            )
        ).scalar_one()
        assert row.entity_id != "ent_atlantic"

    # Atlantic keeps owning the shared feedburner.com domain marker itself.
    atlantic_domain = (
        await db_session.execute(
            select(EntityExternalId).where(
                EntityExternalId.entity_id == "ent_atlantic", EntityExternalId.scheme == "domain"
            )
        )
    ).scalar_one_or_none()
    assert atlantic_domain is not None


async def test_repair_retracts_wrong_claim_and_clears_skip_marker(db_session) -> None:
    await _seed_wrong_atlantic_entity(db_session)
    reporter, claim_id = await _seed_misattributed_reporter(
        db_session, name="Jane Breitbart Reporter", source="Breitbart"
    )
    await db_session.commit()

    report = await repair_feedburner_collision(db_session)
    await db_session.commit()

    assert report.claims_retracted == 1
    assert report.reporters_reset == 1

    claim = await db_session.get(EvidenceClaim, claim_id)
    assert claim.retracted_at is not None

    await db_session.refresh(reporter)
    assert RESEARCH_SOURCE_MARKER not in (reporter.research_sources or [])


async def test_repair_leaves_genuine_atlantic_claim_alone(db_session) -> None:
    await _seed_wrong_atlantic_entity(db_session)
    reporter, claim_id = await _seed_misattributed_reporter(
        db_session, name="Real Atlantic Writer", source="The Atlantic - National"
    )
    await db_session.commit()

    report = await repair_feedburner_collision(db_session)
    await db_session.commit()

    assert report.claims_retracted == 0
    claim = await db_session.get(EvidenceClaim, claim_id)
    assert claim.retracted_at is None
    await db_session.refresh(reporter)
    assert RESEARCH_SOURCE_MARKER in (reporter.research_sources or [])


async def test_repair_is_idempotent(db_session) -> None:
    await _seed_wrong_atlantic_entity(db_session)
    reporter, _claim_id = await _seed_misattributed_reporter(
        db_session, name="Jane Breitbart Reporter", source="Breitbart"
    )
    await db_session.commit()

    first = await repair_feedburner_collision(db_session)
    await db_session.commit()
    assert first.entities_repointed == 3
    assert first.claims_retracted == 1

    second = await repair_feedburner_collision(db_session)
    await db_session.commit()
    assert second.entities_repointed == 0
    assert second.claims_retracted == 0
    assert second.reporters_reset == 0
