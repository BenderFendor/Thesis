"""Tests for cluster_cache.py and the /trending/clusters API route.

Verifies the Postgres-snapshot design: the API never touches ChromaDB;
it reads exclusively from pre-computed rows written by the background worker.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, AsyncGenerator, Dict, List
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.database import Base, TopicClusterSnapshot, get_db
from app.services.cluster_cache import (
    SNAPSHOT_KEEP_COUNT,
    get_latest_snapshot,
    save_snapshot,
)


# ---------------------------------------------------------------------------
# Fixtures
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
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


def _sample_clusters(count: int = 3) -> List[Dict[str, Any]]:
    return [
        {
            "cluster_id": i,
            "label": f"Topic {i}",
            "keywords": ["kw1", "kw2"],
            "article_count": 5,
            "window_count": 3,
            "source_diversity": 2,
            "representative_article": None,
            "articles": [],
        }
        for i in range(count)
    ]


# ---------------------------------------------------------------------------
# cluster_cache unit tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_latest_snapshot_returns_none_when_empty(db_session: AsyncSession):
    """No rows → None, not an error."""
    result = await get_latest_snapshot(db_session, "1d")
    assert result is None


@pytest.mark.asyncio
async def test_save_then_get_latest_snapshot(db_session: AsyncSession):
    """save_snapshot writes a row; get_latest_snapshot returns it."""
    clusters = _sample_clusters(2)
    await save_snapshot(db_session, "1d", clusters)

    snapshot = await get_latest_snapshot(db_session, "1d")
    assert snapshot is not None
    assert snapshot.window == "1d"
    assert snapshot.cluster_count == 2
    assert len(snapshot.clusters_json) == 2  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_get_latest_snapshot_returns_most_recent(db_session: AsyncSession):
    """When multiple snapshots exist, get_latest_snapshot returns the newest."""
    await save_snapshot(db_session, "1w", _sample_clusters(1))
    await save_snapshot(db_session, "1w", _sample_clusters(4))

    snapshot = await get_latest_snapshot(db_session, "1w")
    assert snapshot is not None
    assert snapshot.cluster_count == 4


@pytest.mark.asyncio
async def test_save_snapshot_prunes_old_rows(db_session: AsyncSession):
    """Writing more than SNAPSHOT_KEEP_COUNT rows prunes the oldest ones."""
    for i in range(SNAPSHOT_KEEP_COUNT + 2):
        await save_snapshot(db_session, "1m", _sample_clusters(i + 1))

    from sqlalchemy import func, select

    count_result = await db_session.execute(
        select(func.count(TopicClusterSnapshot.id)).where(
            TopicClusterSnapshot.window == "1m"
        )
    )
    count = count_result.scalar()
    assert count == SNAPSHOT_KEEP_COUNT


@pytest.mark.asyncio
async def test_snapshots_are_window_isolated(db_session: AsyncSession):
    """Snapshots for different windows do not affect each other."""
    await save_snapshot(db_session, "1d", _sample_clusters(2))
    await save_snapshot(db_session, "1w", _sample_clusters(5))

    snap_1d = await get_latest_snapshot(db_session, "1d")
    snap_1w = await get_latest_snapshot(db_session, "1w")
    snap_1m = await get_latest_snapshot(db_session, "1m")

    assert snap_1d is not None and snap_1d.cluster_count == 2
    assert snap_1w is not None and snap_1w.cluster_count == 5
    assert snap_1m is None


# ---------------------------------------------------------------------------
# /trending/clusters API route tests
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def api_client(db_engine) -> AsyncGenerator[AsyncClient, None]:
    """FastAPI test client wired to the in-memory SQLite DB, ChromaDB mocked out."""
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    # Patch is_chroma_reachable so other routes don't attempt real connections.
    with patch("app.api.routes.trending.is_chroma_reachable", return_value=False):
        from app.main import app

        app.dependency_overrides[get_db] = _override_get_db

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
            app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_clusters_route_initializing_when_no_snapshot(api_client: AsyncClient):
    """With no snapshot, the route returns empty clusters and status=initializing."""
    response = await api_client.get("/trending/clusters?window=1d")
    assert response.status_code == 200
    data = response.json()
    assert data["clusters"] == []
    assert data["total"] == 0
    assert data["status"] == "initializing"
    assert data["computed_at"] is None


@pytest.mark.asyncio
async def test_clusters_route_returns_cached_data(
    api_client: AsyncClient, db_engine
) -> None:
    """With a snapshot in Postgres, the route returns it regardless of ChromaDB state."""
    # Write a snapshot directly so the API can serve it
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        await save_snapshot(session, "1d", _sample_clusters(3))

    response = await api_client.get("/trending/clusters?window=1d")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert len(data["clusters"]) == 3
    assert data["status"] == "ok"
    assert data["computed_at"] is not None


@pytest.mark.asyncio
async def test_clusters_route_uses_window_param(
    api_client: AsyncClient, db_engine
) -> None:
    """Different window params return the correct snapshot for that window."""
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        await save_snapshot(session, "1d", _sample_clusters(2))
        await save_snapshot(session, "1w", _sample_clusters(7))

    resp_1d = await api_client.get("/trending/clusters?window=1d")
    resp_1w = await api_client.get("/trending/clusters?window=1w")
    resp_1m = await api_client.get("/trending/clusters?window=1m")

    assert resp_1d.json()["total"] == 2
    assert resp_1w.json()["total"] == 7
    assert resp_1m.json()["status"] == "initializing"
