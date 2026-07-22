"""Tests for the SEC EDGAR Exhibit-21 subsidiary ingestor.

Uses `httpx.MockTransport` (the pattern already established in
tests/test_cloudflare_fetcher.py) to stand in for the three live EDGAR
endpoints this ingestor calls -- submissions JSON, filing index HTML, and
the Exhibit 21 document itself -- so no live network is used in the test.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import AcceptedRelationship, EvidenceClaim, EvidenceDocument
from app.services.evidence_ingest import ingest_edgar_subsidiaries

NOW = datetime(2026, 7, 20, tzinfo=UTC).replace(tzinfo=None)

CIK = "1437107"
CIK_PADDED = CIK.zfill(10)
ACCESSION = "0001437107-25-000031"
ACCESSION_NODASH = ACCESSION.replace("-", "")
PRIMARY_DOC = "wbd-20241231.htm"

SUBMISSIONS_JSON = {
    "cik": CIK_PADDED,
    "name": "Warner Bros. Discovery, Inc.",
    "filings": {
        "recent": {
            "form": ["10-K", "8-K"],
            "accessionNumber": [ACCESSION, "0001437107-25-000005"],
            "primaryDocument": [PRIMARY_DOC, "form8k.htm"],
            "filingDate": ["2025-02-27", "2025-01-05"],
        }
    },
}

INDEX_HTML = f'<html><body><a href="/Archives/edgar/data/{CIK}/{ACCESSION_NODASH}/a-ex21listofsubsid.htm">EX-21</a></body></html>'

EX21_HTML = (
    "<html><body><table>"
    "<tr><td>Entity Name</td><td>Country</td></tr>"
    "<tr><td>CNN America, Inc.</td><td>United States</td></tr>"
    "<tr><td>CNN Productions, Inc.</td><td>United States</td></tr>"
    "</table></body></html>"
)


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


def _handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if "submissions/CIK" in url:
        return httpx.Response(200, json=SUBMISSIONS_JSON, request=request)
    if url.endswith(f"/{ACCESSION_NODASH}/"):
        return httpx.Response(200, text=INDEX_HTML, request=request)
    if "ex21" in url.lower():
        return httpx.Response(200, text=EX21_HTML, request=request)
    return httpx.Response(404, request=request)


@pytest.fixture
def mock_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(_handler))


@pytest.mark.asyncio
async def test_subsidiaries_parsed_and_auto_accepted(
    db: AsyncSession, mock_client: httpx.AsyncClient
) -> None:
    async with mock_client as client:
        report = await ingest_edgar_subsidiaries(
            db, ciks={CIK: "Warner Bros. Discovery, Inc."}, client=client
        )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    ownership_claims = [c for c in claims if c.predicate == "directly_owns"]
    assert len(ownership_claims) == 2
    assert all(c.status == "accepted" for c in ownership_claims)
    assert report.accepted == 2

    documents = list((await db.execute(select(EvidenceDocument))).scalars().all())
    assert len(documents) == 1
    assert documents[0].source_class == "registry_filing"

    relationships = list((await db.execute(select(AcceptedRelationship))).scalars().all())
    assert len(relationships) == 2
    assert {r.materialized_by for r in relationships} == {"auto-ingest:edgar:evidence_ingest/1.0"}


@pytest.mark.asyncio
async def test_subsidiary_claims_have_no_percentage_qualifier(
    db: AsyncSession, mock_client: httpx.AsyncClient
) -> None:
    """Exhibit 21 doesn't disclose ownership percentages -- these claims
    must not assert a `pct`/`pct_band` this ingestor cannot cite."""
    async with mock_client as client:
        await ingest_edgar_subsidiaries(
            db, ciks={CIK: "Warner Bros. Discovery, Inc."}, client=client
        )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    for claim in claims:
        assert "pct" not in claim.qualifiers
        assert "pct_band" not in claim.qualifiers


@pytest.mark.asyncio
async def test_rerun_is_idempotent(db: AsyncSession, mock_client: httpx.AsyncClient) -> None:
    async with mock_client as client:
        await ingest_edgar_subsidiaries(
            db, ciks={CIK: "Warner Bros. Discovery, Inc."}, client=client
        )
    await db.commit()
    first_count = len((await db.execute(select(EvidenceClaim))).scalars().all())

    second_client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    async with second_client as client:
        second_report = await ingest_edgar_subsidiaries(
            db, ciks={CIK: "Warner Bros. Discovery, Inc."}, client=client
        )
    await db.commit()
    second_count = len((await db.execute(select(EvidenceClaim))).scalars().all())

    assert first_count == second_count == 2
    assert second_report.claims_created == 0
    assert second_report.claims_deduped == 2
