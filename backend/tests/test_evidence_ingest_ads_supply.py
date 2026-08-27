"""Frozen ads.txt adapter tests against the real evidence-spine writer."""

from __future__ import annotations

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.evidence import EvidenceClaim, EvidenceEntity, EvidenceObservation
from app.services.evidence_ingest import EvidenceSpineError, ingest_ads_supply


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def frozen_ads_client() -> httpx.AsyncClient:
    """Return an async client backed by one immutable ads.txt body."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            request=request,
            headers={"content-type": "text/plain"},
            text="google.com, pub-123, DIRECT, f08c47fec0942fa0\nexample.net, 456, RESELLER\n",
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_ads_supply_keeps_exact_account_relationship_and_capture(db: AsyncSession) -> None:
    publisher = EvidenceEntity(
        id="ent_publication",
        record_kind="publication",
        entity_kind="publication_brand",
        canonical_name="Test News",
        status="accepted",
    )
    db.add(publisher)
    await db.flush()

    async with frozen_ads_client() as client:
        report = await ingest_ads_supply(
            db,
            publishers={"ent_publication": "https://news.example"},
            client=client,
        )
    await db.commit()

    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    observations = list((await db.execute(select(EvidenceObservation))).scalars().all())
    sellers = list(
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.entity_kind == "seller_account")
            )
        )
        .scalars()
        .all()
    )
    assert report.candidates == 2
    assert len(claims) == len(observations) == len(sellers) == 2
    assert all(claim.status == "candidate" for claim in claims)
    assert claims[0].predicate == "authorizes_inventory_seller"
    assert claims[0].qualifiers["publisher_domain"] == "news.example"
    assert {claim.qualifiers["relationship_type"] for claim in claims} == {"DIRECT", "RESELLER"}
    assert all(claim.qualifiers["captured_at"] for claim in claims)


async def test_ads_supply_replay_is_idempotent(db: AsyncSession) -> None:
    db.add(
        EvidenceEntity(
            id="ent_publication",
            record_kind="publication",
            entity_kind="publication_brand",
            canonical_name="Test News",
            status="accepted",
        )
    )
    await db.flush()
    async with frozen_ads_client() as client:
        await ingest_ads_supply(
            db, publishers={"ent_publication": "https://news.example"}, client=client
        )
        second = await ingest_ads_supply(
            db, publishers={"ent_publication": "https://news.example"}, client=client
        )

    assert second.claims_created == 0
    assert second.claims_deduped == 2


def mixed_reachability_client() -> httpx.AsyncClient:
    """One publisher connect-errors, the other serves a normal ads.txt body."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "dead.example" in str(request.url):
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(
            200,
            request=request,
            headers={"content-type": "text/plain"},
            text="google.com, pub-123, DIRECT, f08c47fec0942fa0\n",
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_ads_supply_skips_unreachable_publisher_and_processes_the_rest(
    db: AsyncSession,
) -> None:
    db.add_all(
        [
            EvidenceEntity(
                id="ent_dead",
                record_kind="publication",
                entity_kind="publication_brand",
                canonical_name="Dead News",
                status="accepted",
            ),
            EvidenceEntity(
                id="ent_live",
                record_kind="publication",
                entity_kind="publication_brand",
                canonical_name="Live News",
                status="accepted",
            ),
        ]
    )
    await db.flush()

    async with mixed_reachability_client() as client:
        report = await ingest_ads_supply(
            db,
            publishers={
                "ent_dead": "https://dead.example",
                "ent_live": "https://live.example",
            },
            client=client,
        )
    await db.commit()

    # The adapter must complete despite one publisher being unreachable, and
    # must still process the reachable one.
    claims = list((await db.execute(select(EvidenceClaim))).scalars().all())
    assert len(claims) == 1
    assert claims[0].qualifiers["publisher_domain"] == "live.example"
    assert report.candidates == 1


def all_unreachable_client() -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_ads_supply_raises_only_when_every_publisher_is_unreachable(
    db: AsyncSession,
) -> None:
    db.add(
        EvidenceEntity(
            id="ent_dead",
            record_kind="publication",
            entity_kind="publication_brand",
            canonical_name="Dead News",
            status="accepted",
        )
    )
    await db.flush()

    async with all_unreachable_client() as client:
        with pytest.raises(EvidenceSpineError):
            await ingest_ads_supply(
                db, publishers={"ent_dead": "https://dead.example"}, client=client
            )
