"""Regression tests for the `/api/wiki/atlas/stats` TTL cache.

`build_atlas_stats` walks the full, unbounded Atlas graph projection
(~11.7k entities in production) on every call, which is expensive and gets
hammered by the UI's status-strip polling. `get_atlas_stats_cached` wraps it
with a short TTL cache so repeated polls within the TTL window reuse one
computed response instead of re-running the full scan.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.services.atlas_graph as atlas_graph
from app.database import Base


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture(autouse=True)
def _reset_stats_cache() -> Any:
    """Isolate each test from cache state left by earlier tests/imports."""
    atlas_graph.invalidate_atlas_stats_cache()
    yield
    atlas_graph.invalidate_atlas_stats_cache()


async def test_cached_stats_reuses_result_within_ttl(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0
    real_build_atlas_stats = atlas_graph.build_atlas_stats

    async def _counting_build_atlas_stats(session: AsyncSession) -> Any:
        nonlocal calls
        calls += 1
        return await real_build_atlas_stats(session)

    monkeypatch.setattr(atlas_graph, "build_atlas_stats", _counting_build_atlas_stats)

    first = await atlas_graph.get_atlas_stats_cached(db)
    second = await atlas_graph.get_atlas_stats_cached(db)

    assert calls == 1, "second call within the TTL window must reuse the cached response"
    assert first is second


async def test_invalidate_forces_recompute(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0
    real_build_atlas_stats = atlas_graph.build_atlas_stats

    async def _counting_build_atlas_stats(session: AsyncSession) -> Any:
        nonlocal calls
        calls += 1
        return await real_build_atlas_stats(session)

    monkeypatch.setattr(atlas_graph, "build_atlas_stats", _counting_build_atlas_stats)

    await atlas_graph.get_atlas_stats_cached(db)
    atlas_graph.invalidate_atlas_stats_cache()
    await atlas_graph.get_atlas_stats_cached(db)

    assert calls == 2, "invalidation must force the next call to recompute"


async def test_cache_expires_after_ttl(db: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    real_build_atlas_stats = atlas_graph.build_atlas_stats

    async def _counting_build_atlas_stats(session: AsyncSession) -> Any:
        nonlocal calls
        calls += 1
        return await real_build_atlas_stats(session)

    monkeypatch.setattr(atlas_graph, "build_atlas_stats", _counting_build_atlas_stats)
    monkeypatch.setattr(atlas_graph, "_STATS_CACHE_TTL_SECONDS", 0.0)

    await atlas_graph.get_atlas_stats_cached(db)
    await atlas_graph.get_atlas_stats_cached(db)

    assert calls == 2, "a zero/expired TTL must force recomputation on the next call"
