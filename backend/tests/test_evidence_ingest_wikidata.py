"""Tests for the Wikidata ownership/founder/CEO ingestor in evidence_ingest.py.

Uses a fake `FundingResearcher`-shaped stub (only `_fetch_wikidata_by_qid` is
called) returning canned Wikidata API response shapes -- no live network.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import (
    AcceptedRelationship,
    EntityExternalId,
    EvidenceClaim,
    EvidenceEntity,
)
from app.services.entity_resolver import resolve_or_create
from app.services.evidence_ingest import ingest_wikidata_ownership_claims

NOW = datetime(2026, 7, 20, tzinfo=UTC).replace(tzinfo=None)

QID_CNN = "Q459251"
QID_WBD = "Q94629774"
QID_TURNER = "Q272999"
QID_CEO = "Q7176154"


def _snak(prop: str, item_qid: str) -> dict[str, Any]:
    return {"datavalue": {"value": {"id": item_qid}}}


def _statement(
    statement_id: str,
    prop: str,
    item_qid: str,
    *,
    referenced: bool,
    proportion: float | None = None,
) -> dict[str, Any]:
    statement: dict[str, Any] = {
        "id": statement_id,
        "mainsnak": _snak(prop, item_qid),
        "references": [{"snaks": {"P248": [{}]}}] if referenced else [],
    }
    if proportion is not None:
        statement["qualifiers"] = {
            "P1107": [{"datavalue": {"value": {"amount": f"+{proportion / 100.0}"}}}]
        }
    return statement


CNN_RESULT: dict[str, Any] = {
    "source": "wikidata",
    "qid": QID_CNN,
    "wikidata_url": f"https://www.wikidata.org/wiki/{QID_CNN}",
    "labels": {
        QID_WBD: "Warner Bros. Discovery",
        QID_TURNER: "Ted Turner",
        QID_CEO: "Test CEO",
    },
    "raw_claims": {
        "P127": [
            _statement("stmt-owned-referenced", "P127", QID_WBD, referenced=True, proportion=100.0)
        ],
        "P749": [],
        "P112": [_statement("stmt-founder-referenced", "P112", QID_TURNER, referenced=True)],
        "P169": [_statement("stmt-ceo-unreferenced", "P169", QID_CEO, referenced=False)],
    },
    "raw_response_text": "{}",
}

WBD_RESULT: dict[str, Any] = {
    "source": "wikidata",
    "qid": QID_WBD,
    "wikidata_url": f"https://www.wikidata.org/wiki/{QID_WBD}",
    "labels": {},
    "raw_claims": {"P127": [], "P749": [], "P112": [], "P169": []},
    "raw_response_text": "{}",
}

RESULTS_BY_QID = {QID_CNN: CNN_RESULT, QID_WBD: WBD_RESULT}


class FakeResearcher:
    """Stub with only the method evidence_ingest actually calls."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def _fetch_wikidata_by_qid(self, qid: str) -> dict[str, Any]:
        self.calls.append(qid)
        return RESULTS_BY_QID.get(qid, {})


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed_cnn_entity(db: AsyncSession) -> EvidenceEntity:
    return await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"wikidata_qid": QID_CNN, "rss_catalog_key": "src_cnn"},
        candidate_name="CNN",
    )


@pytest.mark.asyncio
async def test_referenced_ownership_statement_auto_accepts(db: AsyncSession) -> None:
    cnn = await _seed_cnn_entity(db)
    report = await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id], researcher=FakeResearcher()
    )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    ownership_claims = [c for c in claims if c.predicate == "directly_owns"]
    assert len(ownership_claims) == 1
    claim = ownership_claims[0]
    assert claim.status == "accepted"
    assert claim.qualifiers.get("pct") == 100.0

    relationships = list((await db.execute(select(AcceptedRelationship))).scalars().all())
    ownership_relationships = [r for r in relationships if r.predicate == "directly_owns"]
    assert len(ownership_relationships) == 1
    assert ownership_relationships[0].materialized_by == "auto-ingest:wikidata:evidence_ingest/1.0"

    # subject = owned (CNN), object = owner (WBD) -- matches OwnershipEdge direction.
    owner_ext = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "wikidata_qid", EntityExternalId.value == QID_WBD
            )
        )
    ).scalar_one()
    assert ownership_relationships[0].subject_entity_id == cnn.id
    assert ownership_relationships[0].object_entity_id == owner_ext.entity_id
    assert report.accepted == 2  # ownership + founder, both referenced


@pytest.mark.asyncio
async def test_unreferenced_ceo_statement_stays_candidate(db: AsyncSession) -> None:
    cnn = await _seed_cnn_entity(db)
    await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id], researcher=FakeResearcher()
    )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    controls_claims = [c for c in claims if c.predicate == "controls"]
    assert len(controls_claims) == 1
    assert controls_claims[0].status == "candidate"

    relationships = list((await db.execute(select(AcceptedRelationship))).scalars().all())
    assert all(r.predicate != "controls" for r in relationships)


@pytest.mark.asyncio
async def test_referenced_founder_statement_auto_accepts(db: AsyncSession) -> None:
    cnn = await _seed_cnn_entity(db)
    await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id], researcher=FakeResearcher()
    )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    founded_claims = [c for c in claims if c.predicate == "founded_by"]
    assert len(founded_claims) == 1
    assert founded_claims[0].status == "accepted"


@pytest.mark.asyncio
async def test_rerun_is_idempotent(db: AsyncSession) -> None:
    cnn = await _seed_cnn_entity(db)
    await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id], researcher=FakeResearcher()
    )
    await db.commit()
    claims_after_first = list((await db.execute(select(EvidenceClaim))).scalars().all())
    relationships_after_first = list(
        (await db.execute(select(AcceptedRelationship))).scalars().all()
    )

    second_report = await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id], researcher=FakeResearcher()
    )
    await db.commit()
    claims_after_second = list((await db.execute(select(EvidenceClaim))).scalars().all())
    relationships_after_second = list(
        (await db.execute(select(AcceptedRelationship))).scalars().all()
    )

    assert len(claims_after_first) == len(claims_after_second)
    assert len(relationships_after_first) == len(relationships_after_second)
    assert second_report.claims_deduped == len(claims_after_first)
    assert second_report.claims_created == 0


@pytest.mark.asyncio
async def test_bfs_walks_owner_ancestors_one_hop(db: AsyncSession) -> None:
    cnn = await _seed_cnn_entity(db)
    researcher = FakeResearcher()
    await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id], researcher=researcher, max_depth=3
    )
    await db.commit()
    # CNN -> WBD (hop 1) is fetched, and WBD itself is fetched to look for
    # its own owners (hop 2), even though WBD_RESULT has none.
    assert QID_CNN in researcher.calls
    assert QID_WBD in researcher.calls
