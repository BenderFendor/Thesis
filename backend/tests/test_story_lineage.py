"""Tests for durable story lineage construction."""

from __future__ import annotations

from datetime import datetime, timedelta, UTC
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Article, ArticleEdge, Base, ClaimEdge, ExtractedClaim, StoryCluster
from app.services.story_lineage import build_story_lineage


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


def _published(hours_ago: int) -> datetime:
    return datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=hours_ago)


async def _seed_articles(session: AsyncSession) -> None:
    session.add_all(
        [
            Article(
                id=1,
                title="Reuters says 12 workers were arrested after court ruling",
                source="Reuters",
                url="https://example.com/reuters",
                published_at=_published(5),
                summary="Reuters reported that 12 workers were arrested after the court ruling.",
                content="Reuters reported that 12 workers were arrested after the court ruling.",
            ),
            Article(
                id=2,
                title="Local outlet says 9 workers were arrested after court ruling",
                source="Local Ledger",
                url="https://example.com/local",
                published_at=_published(3),
                summary="Local officials said 9 workers were arrested after the court ruling.",
                content="Local officials said 9 workers were arrested after the court ruling.",
            ),
            Article(
                id=3,
                title="Analysis: court ruling changes enforcement timeline",
                source="Policy Review",
                url="https://example.com/policy",
                published_at=_published(1),
                summary="The court ruling changed the enforcement timeline, analysts said.",
                content="The court ruling changed the enforcement timeline, analysts said.",
            ),
        ]
    )
    await session.commit()


def _cluster_detail() -> dict[str, object]:
    return {
        "id": 44,
        "label": "Court ruling arrests",
        "keywords": ["court", "ruling", "arrests"],
        "first_seen": _published(5).isoformat(),
        "last_seen": _published(1).isoformat(),
        "articles": [
            {
                "id": 1,
                "title": "Reuters says 12 workers were arrested after court ruling",
                "source": "Reuters",
                "url": "https://example.com/reuters",
                "published_at": _published(5).isoformat(),
                "summary": "Reuters reported that 12 workers were arrested after the court ruling.",
            },
            {
                "id": 2,
                "title": "Local outlet says 9 workers were arrested after court ruling",
                "source": "Local Ledger",
                "url": "https://example.com/local",
                "published_at": _published(3).isoformat(),
                "summary": "Local officials said 9 workers were arrested after the court ruling.",
            },
            {
                "id": 3,
                "title": "Analysis: court ruling changes enforcement timeline",
                "source": "Policy Review",
                "url": "https://example.com/policy",
                "published_at": _published(1).isoformat(),
                "summary": "The court ruling changed the enforcement timeline, analysts said.",
            },
        ],
    }


@pytest.mark.asyncio
async def test_build_story_lineage_promotes_cluster_to_durable_graph(
    db_session: AsyncSession,
) -> None:
    await _seed_articles(db_session)

    result = await build_story_lineage(db_session, _cluster_detail())

    assert result["status"] == "ok"
    assert result["story"]["external_cluster_id"] == 44
    assert result["story"]["earliest_article_id"] == 1
    assert len(result["article_edges"]) == 2
    assert {edge["relation"] for edge in result["article_edges"]} == {"same_wire_story"}
    assert len(result["claims"]) >= 2
    assert any(edge["relation"] == "contradicts" for edge in result["claim_edges"])

    story_count = await db_session.scalar(
        select(StoryCluster).where(StoryCluster.external_cluster_id == 44)
    )
    assert story_count is not None
    edge_rows = (await db_session.execute(select(ArticleEdge))).scalars().all()
    claim_rows = (await db_session.execute(select(ExtractedClaim))).scalars().all()
    claim_edge_rows = (await db_session.execute(select(ClaimEdge))).scalars().all()
    assert len(edge_rows) == 2
    assert len(claim_rows) >= 2
    assert claim_edge_rows


@pytest.mark.asyncio
async def test_build_story_lineage_is_idempotent(db_session: AsyncSession) -> None:
    await _seed_articles(db_session)

    first = await build_story_lineage(db_session, _cluster_detail())
    second = await build_story_lineage(db_session, _cluster_detail())

    assert first["status"] == "ok"
    assert second["status"] == "ok"
    article_edges = (await db_session.execute(select(ArticleEdge))).scalars().all()
    stories = (await db_session.execute(select(StoryCluster))).scalars().all()
    assert len(stories) == 1
    assert len(article_edges) == 2
