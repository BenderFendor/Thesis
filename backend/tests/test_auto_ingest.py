"""Tests for the Atlas auto-ingest startup orchestrator.

Verifies: stages run in the registered order, a failing stage doesn't abort
later stages, the interval guard skips network-bound stages when a recent
success is on record, and SCOOP_AUTO_INGEST=0 disables the whole run. No
stage under test performs real network I/O -- the pipeline entry points
(`run_backfill`, `ingest_wikidata_ownership_claims`, etc.) are never called
directly; instead `app.services.auto_ingest.STAGES` is swapped for stub
stages, so this file never imports evidence_ingest's network paths.
"""

from __future__ import annotations

import dataclasses
from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings as real_settings
from app.database import WikiIndexStatus, get_utc_now
from app.services import auto_ingest
from app.services.auto_ingest import Stage, run_auto_ingest


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


def _enabled_settings(**overrides):
    base = dataclasses.replace(
        real_settings,
        auto_ingest_enabled=True,
        enable_database=True,
        auto_ingest_interval_hours=24,
    )
    return dataclasses.replace(base, **overrides) if overrides else base


async def test_stages_run_in_registered_order(monkeypatch, session_factory):
    calls: list[str] = []

    async def stage_a(db: AsyncSession) -> None:
        calls.append("a")

    async def stage_b(db: AsyncSession) -> None:
        calls.append("b")

    async def stage_c(db: AsyncSession) -> None:
        calls.append("c")

    monkeypatch.setattr(auto_ingest, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auto_ingest, "settings", _enabled_settings())
    monkeypatch.setattr(
        auto_ingest,
        "STAGES",
        [
            Stage("a", stage_a, network_bound=False),
            Stage("b", stage_b, network_bound=False),
            Stage("c", stage_c, network_bound=False),
        ],
    )

    await run_auto_ingest()

    assert calls == ["a", "b", "c"]


async def test_failing_stage_does_not_abort_later_stages(monkeypatch, session_factory):
    calls: list[str] = []

    async def stage_ok(db: AsyncSession) -> None:
        calls.append("ok")

    async def stage_fails(db: AsyncSession) -> None:
        calls.append("fails")
        raise ConnectionError("simulated offline network")

    async def stage_after(db: AsyncSession) -> None:
        calls.append("after")

    monkeypatch.setattr(auto_ingest, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auto_ingest, "settings", _enabled_settings())
    monkeypatch.setattr(
        auto_ingest,
        "STAGES",
        [
            Stage("ok", stage_ok, network_bound=False),
            Stage("fails", stage_fails, network_bound=False),
            Stage("after", stage_after, network_bound=False),
        ],
    )

    # Must not raise -- a failing stage is logged and swallowed.
    await run_auto_ingest()

    assert calls == ["ok", "fails", "after"]


async def test_interval_guard_skips_network_bound_stage_with_recent_success(
    monkeypatch, session_factory
):
    calls: list[str] = []

    async def local_stage(db: AsyncSession) -> None:
        calls.append("local")

    async def network_stage(db: AsyncSession) -> None:
        calls.append("network")

    # Seed a marker row recording a successful run 1 hour ago (well inside
    # the default 24h guard).
    async with session_factory() as db:
        db.add(
            WikiIndexStatus(
                entity_type="auto_ingest",
                entity_name="atlas_pipeline",
                status="complete",
                last_indexed_at=get_utc_now() - timedelta(hours=1),
            )
        )
        await db.commit()

    monkeypatch.setattr(auto_ingest, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auto_ingest, "settings", _enabled_settings())
    monkeypatch.setattr(
        auto_ingest,
        "STAGES",
        [
            Stage("local", local_stage, network_bound=False),
            Stage("network", network_stage, network_bound=True),
        ],
    )

    await run_auto_ingest()

    assert calls == ["local"]


async def test_interval_guard_runs_network_bound_stage_when_stale(monkeypatch, session_factory):
    calls: list[str] = []

    async def network_stage(db: AsyncSession) -> None:
        calls.append("network")

    # Marker row is 48 hours old -- older than the 24h guard.
    async with session_factory() as db:
        db.add(
            WikiIndexStatus(
                entity_type="auto_ingest",
                entity_name="atlas_pipeline",
                status="complete",
                last_indexed_at=get_utc_now() - timedelta(hours=48),
            )
        )
        await db.commit()

    monkeypatch.setattr(auto_ingest, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auto_ingest, "settings", _enabled_settings())
    monkeypatch.setattr(
        auto_ingest,
        "STAGES",
        [Stage("network", network_stage, network_bound=True)],
    )

    await run_auto_ingest()

    assert calls == ["network"]


async def test_scoop_auto_ingest_disabled_skips_all_stages(monkeypatch, session_factory):
    calls: list[str] = []

    async def stage_a(db: AsyncSession) -> None:
        calls.append("a")

    monkeypatch.setattr(auto_ingest, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auto_ingest, "settings", _enabled_settings(auto_ingest_enabled=False))
    monkeypatch.setattr(auto_ingest, "STAGES", [Stage("a", stage_a, network_bound=False)])

    await run_auto_ingest()

    assert calls == []


async def test_disabled_database_skips_all_stages(monkeypatch, session_factory):
    calls: list[str] = []

    async def stage_a(db: AsyncSession) -> None:
        calls.append("a")

    monkeypatch.setattr(auto_ingest, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(auto_ingest, "settings", _enabled_settings(enable_database=False))
    monkeypatch.setattr(auto_ingest, "STAGES", [Stage("a", stage_a, network_bound=False)])

    await run_auto_ingest()

    assert calls == []


def test_default_stage_registry_covers_the_three_atlas_pipelines():
    names = [stage.name for stage in auto_ingest.STAGES]
    assert names == ["entity_backfill", "evidence_ingestion", "funding_bias_analysis"]
    assert [stage.network_bound for stage in auto_ingest.STAGES] == [False, True, False]


@pytest.mark.parametrize("raw_value", ["0", "false", "False", ""])
def test_scoop_auto_ingest_env_var_disables(monkeypatch, raw_value):
    monkeypatch.setenv("SCOOP_AUTO_INGEST", raw_value)
    from app.core.config import _env_enabled

    assert _env_enabled("SCOOP_AUTO_INGEST") is False


@pytest.mark.parametrize("raw_value", ["1", "true", None])
def test_scoop_auto_ingest_env_var_enabled_by_default(monkeypatch, raw_value):
    if raw_value is None:
        monkeypatch.delenv("SCOOP_AUTO_INGEST", raising=False)
    else:
        monkeypatch.setenv("SCOOP_AUTO_INGEST", raw_value)
    from app.core.config import _env_enabled

    assert _env_enabled("SCOOP_AUTO_INGEST") is True
