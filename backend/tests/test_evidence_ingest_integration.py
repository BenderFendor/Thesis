"""Integration test: seed a small fixture ownership DAG through the real
Wikidata ingestor and assert the full pipeline -- AcceptedRelationship
chains plus a persisted CalculationTrace with a computed interest range.

CNN -> Warner Bros. Discovery (single hop, 100%)
Fox News -> Fox Corporation -> Murdoch Family Trust (two hops, 100% * 40%)

All data here is deliberately labeled as fixture/test data (see the
docstring on `ingest_evidence.py`'s smoke check and the Phase 1 final report
for why live EDGAR/Wikidata data does not reliably carry ownership
percentages): this test exercises the acceptance -> materialization ->
ownership_math wiring end-to-end without claiming these are verified live
percentages.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import AcceptedRelationship, CalculationTrace
from app.services.entity_resolver import resolve_or_create
from app.services.evidence_ingest import ingest_wikidata_ownership_claims

NOW = datetime(2026, 7, 20, tzinfo=UTC).replace(tzinfo=None)

QID_CNN = "Q459251"
QID_WBD = "Q94629774"
QID_FOX_NEWS = "Q789375"
QID_FOX_CORP = "Q22065285"
QID_MURDOCH_TRUST = "Q108705947"


def _statement(statement_id: str, item_qid: str, proportion: float) -> dict[str, Any]:
    return {
        "id": statement_id,
        "mainsnak": {"datavalue": {"value": {"id": item_qid}}},
        "references": [{"snaks": {"P248": [{}]}}],
        "qualifiers": {"P1107": [{"datavalue": {"value": {"amount": f"+{proportion / 100.0}"}}}]},
    }


RESULTS_BY_QID: dict[str, dict[str, Any]] = {
    QID_CNN: {
        "qid": QID_CNN,
        "wikidata_url": f"https://www.wikidata.org/wiki/{QID_CNN}",
        "labels": {QID_WBD: "Warner Bros. Discovery"},
        "raw_claims": {
            "P127": [_statement("cnn-owned", QID_WBD, 100.0)],
            "P749": [],
            "P112": [],
            "P169": [],
        },
        "raw_response_text": "{}",
    },
    QID_WBD: {
        "qid": QID_WBD,
        "wikidata_url": f"https://www.wikidata.org/wiki/{QID_WBD}",
        "labels": {},
        "raw_claims": {"P127": [], "P749": [], "P112": [], "P169": []},
        "raw_response_text": "{}",
    },
    QID_FOX_NEWS: {
        "qid": QID_FOX_NEWS,
        "wikidata_url": f"https://www.wikidata.org/wiki/{QID_FOX_NEWS}",
        "labels": {QID_FOX_CORP: "Fox Corporation"},
        "raw_claims": {
            "P127": [_statement("foxnews-owned", QID_FOX_CORP, 100.0)],
            "P749": [],
            "P112": [],
            "P169": [],
        },
        "raw_response_text": "{}",
    },
    QID_FOX_CORP: {
        "qid": QID_FOX_CORP,
        "wikidata_url": f"https://www.wikidata.org/wiki/{QID_FOX_CORP}",
        "labels": {QID_MURDOCH_TRUST: "Murdoch Family Trust"},
        "raw_claims": {
            "P127": [_statement("foxcorp-owned", QID_MURDOCH_TRUST, 40.0)],
            "P749": [],
            "P112": [],
            "P169": [],
        },
        "raw_response_text": "{}",
    },
    QID_MURDOCH_TRUST: {
        "qid": QID_MURDOCH_TRUST,
        "wikidata_url": f"https://www.wikidata.org/wiki/{QID_MURDOCH_TRUST}",
        "labels": {},
        "raw_claims": {"P127": [], "P749": [], "P112": [], "P169": []},
        "raw_response_text": "{}",
    },
}


class FakeResearcher:
    async def _fetch_wikidata_by_qid(self, qid: str) -> dict[str, Any]:
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


@pytest.mark.asyncio
async def test_cnn_to_wbd_and_fox_news_to_murdoch_trust_chains(db: AsyncSession) -> None:
    cnn = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"wikidata_qid": QID_CNN},
        candidate_name="CNN",
    )
    fox_news = await resolve_or_create(
        db,
        record_kind="publication",
        external_ids={"wikidata_qid": QID_FOX_NEWS},
        candidate_name="Fox News",
    )
    await db.commit()

    await ingest_wikidata_ownership_claims(
        db, seed_entity_ids=[cnn.id, fox_news.id], researcher=FakeResearcher(), max_depth=3
    )
    await db.commit()

    relationships = list(
        (
            await db.execute(
                select(AcceptedRelationship).where(
                    AcceptedRelationship.predicate == "directly_owns"
                )
            )
        )
        .scalars()
        .all()
    )
    # CNN->WBD, Fox News->Fox Corp, Fox Corp->Murdoch Family Trust.
    assert len(relationships) == 3

    from app.models.evidence import EntityExternalId, EvidenceEntity

    async def _entity_id_for_qid(qid: str) -> str:
        row = (
            await db.execute(
                select(EntityExternalId).where(
                    EntityExternalId.scheme == "wikidata_qid", EntityExternalId.value == qid
                )
            )
        ).scalar_one()
        return str(row.entity_id)

    wbd_id = await _entity_id_for_qid(QID_WBD)
    murdoch_trust_id = await _entity_id_for_qid(QID_MURDOCH_TRUST)

    from app.services.evidence_spine import compute_ownership_interest

    cnn_trace = await compute_ownership_interest(db, owner_id=wbd_id, target_id=cnn.id)
    assert cnn_trace["aggregate"] == {"lower": 100.0, "upper": 100.0}

    fox_trace = await compute_ownership_interest(
        db, owner_id=murdoch_trust_id, target_id=fox_news.id
    )
    assert fox_trace["aggregate"] == {"lower": 40.0, "upper": 40.0}
    assert len(fox_trace["paths"]) == 1
    path = fox_trace["paths"][0]
    assert path["entity_ids"][0] == murdoch_trust_id
    assert path["entity_ids"][-1] == fox_news.id

    # `_record_interest_trace` persists a CalculationTrace as a side effect
    # of materializing each interest-bearing claim during ingestion.
    traces = list((await db.execute(select(CalculationTrace))).scalars().all())
    assert len(traces) >= 3
    assert all(trace.measurement_name == "ownership_interest" for trace in traces)

    (await db.get(EvidenceEntity, wbd_id))  # sanity: entity resolves
