"""
Shared fixtures for wiki API tests.

Provides an in-memory SQLite database with test data,
a FastAPI TestClient wired to that database, and mock
RSS source data so tests run without external dependencies.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator, Dict, Any
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
)

from app.database import (
    Base,
    Article,
    ArticleAuthor,
    Organization,
    PropagandaFilterScore,
    Reporter,
    SourceMetadata,
    WikiIndexStatus,
    get_db,
)

# ---------------------------------------------------------------------------
# Test RSS sources (mocked, no filesystem dependency)
# ---------------------------------------------------------------------------

MOCK_RSS_SOURCES: Dict[str, Dict[str, Any]] = {
    "Test News": {
        "url": "https://testnews.example.com/rss",
        "category": "general",
        "country": "US",
        "funding_type": "commercial",
        "bias_rating": "center",
    },
    "State Gazette": {
        "url": "https://stategazette.example.com/rss",
        "category": "politics",
        "country": "GB",
        "funding_type": "state",
        "bias_rating": "left",
    },
    "Independent Wire": {
        "url": "https://indwire.example.com/rss",
        "category": "world",
        "country": "DE",
        "funding_type": "nonprofit",
        "bias_rating": "center",
    },
    "Right Report - 1": {
        "url": "https://rightreport.example.com/rss/1",
        "category": "opinion",
        "country": "US",
        "funding_type": "commercial",
        "bias_rating": "right",
    },
    "Right Report - 2": {
        "url": "https://rightreport.example.com/rss/2",
        "category": "opinion",
        "country": "US",
        "funding_type": "commercial",
        "bias_rating": "right",
    },
}


def _mock_get_rss_sources() -> Dict[str, Dict[str, Any]]:
    return MOCK_RSS_SOURCES


# ---------------------------------------------------------------------------
# In-memory async SQLite engine
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session


# ---------------------------------------------------------------------------
# Seed test data
# ---------------------------------------------------------------------------


def _utc(days_ago: int = 0) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days_ago)


@pytest_asyncio.fixture
async def seeded_db(db_session: AsyncSession) -> AsyncSession:
    """Populate the test database with representative data."""

    # -- Articles ---------------------------------------------------------
    articles = [
        Article(
            id=1,
            title="Article A",
            source="Test News",
            url="https://testnews.example.com/a",
            published_at=_utc(1),
            category="politics",
        ),
        Article(
            id=2,
            title="Article B",
            source="Test News",
            url="https://testnews.example.com/b",
            published_at=_utc(2),
            category="world",
        ),
        Article(
            id=3,
            title="Article C",
            source="State Gazette",
            url="https://stategazette.example.com/c",
            published_at=_utc(0),
            category="politics",
        ),
    ]
    db_session.add_all(articles)

    # -- Reporters --------------------------------------------------------
    reporters = [
        Reporter(
            id=1,
            name="Jane Doe",
            normalized_name="jane doe",
            bio="Veteran journalist covering politics.",
            topics=["politics", "economy"],
            political_leaning="center-left",
            leaning_confidence="high",
            article_count=42,
            wikipedia_url="https://en.wikipedia.org/wiki/Jane_Doe",
            research_confidence="high",
            career_history=[{"organization": "Test News", "role": "senior reporter"}],
            education=[{"institution": "Columbia", "degree": "MS Journalism"}],
        ),
        Reporter(
            id=2,
            name="John Smith",
            normalized_name="john smith",
            bio="Foreign correspondent.",
            topics=["world", "conflict"],
            political_leaning="center",
            leaning_confidence="medium",
            article_count=15,
            research_confidence="medium",
        ),
    ]
    db_session.add_all(reporters)

    # -- ArticleAuthor junctions -----------------------------------------
    junctions = [
        ArticleAuthor(article_id=1, reporter_id=1),
        ArticleAuthor(article_id=2, reporter_id=1),
        ArticleAuthor(article_id=3, reporter_id=2),
    ]
    db_session.add_all(junctions)

    # -- Organizations ---------------------------------------------------
    orgs = [
        Organization(
            id=1,
            name="Test News Corp",
            normalized_name="test news corp",
            org_type="publisher",
            funding_type="commercial",
            media_bias_rating="center",
            factual_reporting="high",
            wikipedia_url="https://en.wikipedia.org/wiki/Test_News_Corp",
            research_confidence="high",
        ),
        Organization(
            id=2,
            name="Parent Media Group",
            normalized_name="parent media group",
            org_type="parent_company",
            funding_type="commercial",
            media_bias_rating="center",
            factual_reporting="high",
            research_confidence="medium",
        ),
        Organization(
            id=3,
            name="State Gazette Holdings",
            normalized_name="state gazette holdings",
            org_type="publisher",
            funding_type="state",
            parent_org_id=2,
            ownership_percentage="100",
            research_confidence="high",
        ),
    ]
    db_session.add_all(orgs)

    # -- SourceMetadata --------------------------------------------------
    metas = [
        SourceMetadata(
            id=1,
            source_name="Test News",
            normalized_name="test news",
            parent_company="Test News Corp",
            credibility_score=0.85,
            source_type="newspaper",
            is_state_media=False,
            geographic_focus=["US", "World"],
            topic_focus=["politics", "economy"],
        ),
    ]
    db_session.add_all(metas)

    # -- PropagandaFilterScores ------------------------------------------
    filter_axes = [
        "ownership",
        "advertising",
        "sourcing",
        "flak",
        "ideology",
        "class_interest",
    ]
    scores = []
    for i, axis in enumerate(filter_axes):
        scores.append(
            PropagandaFilterScore(
                source_name="Test News",
                filter_name=axis,
                score=i
                + 1,  # 1,2,3,4,5,6 -> clamped to 1-5 conceptually, but OK for test
                confidence="high",
                prose_explanation=f"Test explanation for {axis}.",
                empirical_basis=f"Based on test data for {axis}.",
                scored_by="test",
                last_scored_at=_utc(0),
            )
        )
    db_session.add_all(scores)

    # -- WikiIndexStatus -------------------------------------------------
    statuses = [
        WikiIndexStatus(
            entity_type="source",
            entity_name="Test News",
            status="complete",
            last_indexed_at=_utc(1),
            next_index_at=_utc(-6),  # 6 days in future
        ),
        WikiIndexStatus(
            entity_type="source",
            entity_name="State Gazette",
            status="pending",
        ),
    ]
    db_session.add_all(statuses)

    await db_session.commit()
    return db_session


# ---------------------------------------------------------------------------
# FastAPI test client wired to the test DB
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def client(db_engine, seeded_db) -> AsyncGenerator[AsyncClient, None]:
    """
    AsyncClient hitting the real FastAPI app but with:
    - get_db overridden to use the in-memory SQLite session
    - get_rss_sources mocked to return MOCK_RSS_SOURCES
    """
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def _override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    with patch("app.api.routes.wiki.get_rss_sources", _mock_get_rss_sources):
        from app.main import app

        app.dependency_overrides[get_db] = _override_get_db

        # Disable startup/shutdown events so tests don't try to connect
        # to real databases or start background tasks
        saved_startup = app.router.on_startup[:]
        saved_shutdown = app.router.on_shutdown[:]
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()

        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                yield ac
        finally:
            app.router.on_startup = saved_startup
            app.router.on_shutdown = saved_shutdown
            app.dependency_overrides.clear()
