"""Tests for the Phase 5 catalog-wide funding-vs-bias correlation analysis.

Covers `app.services.funding_bias_analysis`: preregistration idempotency,
Cramer's V against a hand-computed fixture, degenerate cases (single
category, empty population), and the API route's empty-state response.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.services.funding_bias_analysis import (
    PREREGISTRATION_ID,
    build_contingency_table,
    cramers_v,
    get_funding_bias_analysis_response,
    preregister_funding_bias_methodology,
    run_funding_bias_analysis,
)

# A 2x2 fixture with a hand-computed expected Cramer's V:
#   state-funded/left = 8, state-funded/right = 2
#   commercial/left   = 2, commercial/right   = 8
#   n = 20, row totals = [10, 10], col totals = [10, 10]
#   expected[i][j] = 10*10/20 = 5 for every cell
#   chi2 = (8-5)^2/5 * 4 = (9/5)*4 = 7.2
#   V = sqrt(chi2 / (n * (min(2,2)-1))) = sqrt(7.2 / 20) = sqrt(0.36) = 0.6
_FIXTURE_CATALOG: dict[str, dict[str, Any]] = {}
for i in range(8):
    _FIXTURE_CATALOG[f"State Left {i}"] = {"funding_type": "state-funded", "bias_rating": "left"}
for i in range(2):
    _FIXTURE_CATALOG[f"State Right {i}"] = {"funding_type": "state-funded", "bias_rating": "right"}
for i in range(2):
    _FIXTURE_CATALOG[f"Commercial Left {i}"] = {"funding_type": "commercial", "bias_rating": "left"}
for i in range(8):
    _FIXTURE_CATALOG[f"Commercial Right {i}"] = {
        "funding_type": "commercial",
        "bias_rating": "right",
    }
assert len(_FIXTURE_CATALOG) == 20


def _mock_rss_sources(catalog: dict[str, dict[str, Any]]) -> Any:
    def _get() -> dict[str, dict[str, Any]]:
        return catalog

    return _get


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


# ---------------------------------------------------------------------------
# Cramer's V math -- pure function, no DB
# ---------------------------------------------------------------------------


def test_cramers_v_matches_hand_computed_value_on_2x2_fixture() -> None:
    pairs = [
        (sample["funding_type"], sample["bias_rating"]) for sample in _FIXTURE_CATALOG.values()
    ]
    rows, cols, table = build_contingency_table(pairs)
    assert rows == ["commercial", "state-funded"]
    assert cols == ["left", "right"]
    assert table == [[2, 8], [8, 2]]

    result = cramers_v(table)
    assert result["n"] == 20
    assert result["chi_square"] == pytest.approx(7.2, abs=1e-9)
    assert result["degrees_of_freedom"] == 1
    assert result["cramers_v"] == pytest.approx(0.6, abs=1e-9)
    assert result["note"] is None


def test_cramers_v_degenerate_single_category_returns_none_not_zero() -> None:
    """A single row (one funding_type) makes min(rows, cols) - 1 == 0 -- undefined, not 0."""
    rows, cols, table = build_contingency_table([("commercial", "left"), ("commercial", "right")])
    result = cramers_v(table)
    assert result["cramers_v"] is None
    assert result["chi_square"] is None
    assert result["note"] is not None


def test_cramers_v_degenerate_empty_population_returns_none() -> None:
    rows, cols, table = build_contingency_table([])
    assert rows == [] and cols == [] and table == []
    result = cramers_v(table)
    assert result["n"] == 0
    assert result["cramers_v"] is None
    assert result["note"] is not None


# ---------------------------------------------------------------------------
# Preregistration idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preregistration_is_idempotent(db: AsyncSession) -> None:
    first = await preregister_funding_bias_methodology(db)
    await db.commit()
    second = await preregister_funding_bias_methodology(db)

    assert first.id == PREREGISTRATION_ID
    assert second.id == first.id
    assert second.canonical_hash == first.canonical_hash
    assert second.locked_at == first.locked_at
    assert second.specification == first.specification
    # limitations must be non-empty and explicit about correlation-not-causation
    limitations = " ".join(second.specification["limitations"])
    assert "not that funding causes" in limitations


# ---------------------------------------------------------------------------
# Full run over a seeded population
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_funding_bias_analysis_over_seeded_fixture(db: AsyncSession) -> None:
    with patch("app.services.atlas_entity.get_rss_sources", _mock_rss_sources(_FIXTURE_CATALOG)):
        run = await run_funding_bias_analysis(db)
        await db.commit()

    assert run.population_size == 20
    assert run.rows == ["commercial", "state-funded"]
    assert run.cols == ["left", "right"]
    assert run.table == [[2, 8], [8, 2]]
    assert run.statistic["cramers_v"] == pytest.approx(0.6, abs=1e-9)
    assert run.statistic["interpretation"] == "strong association"
    assert run.trace.measurement_name == "funding_bias_association"
    assert run.trace.subgraph["preregistration_id"] == run.preregistration.id


@pytest.mark.asyncio
async def test_run_funding_bias_analysis_is_idempotent_for_unchanged_data(db: AsyncSession) -> None:
    with patch("app.services.atlas_entity.get_rss_sources", _mock_rss_sources(_FIXTURE_CATALOG)):
        first = await run_funding_bias_analysis(db)
        await db.commit()
        second = await run_funding_bias_analysis(db)
        await db.commit()

    assert first.trace.id == second.trace.id
    assert first.preregistration.id == second.preregistration.id


@pytest.mark.asyncio
async def test_population_excludes_outlets_missing_either_value(db: AsyncSession) -> None:
    catalog = {
        "Has Both": {"funding_type": "commercial", "bias_rating": "left"},
        "Missing Bias": {"funding_type": "commercial"},
        "Missing Funding": {"bias_rating": "left"},
        "Missing Both": {},
    }
    with patch("app.services.atlas_entity.get_rss_sources", _mock_rss_sources(catalog)):
        run = await run_funding_bias_analysis(db)
        await db.commit()

    assert run.population_size == 1


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_funding_bias_endpoint_is_empty_state_before_any_run(db: AsyncSession) -> None:
    from app.main import app

    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/wiki/atlas/analysis/funding-bias")
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False
        assert data["methodology"] is None
        assert data["statistic"] is None
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_funding_bias_endpoint_returns_results_after_a_run(db: AsyncSession) -> None:
    with patch("app.services.atlas_entity.get_rss_sources", _mock_rss_sources(_FIXTURE_CATALOG)):
        await run_funding_bias_analysis(db)
        await db.commit()

    result = await get_funding_bias_analysis_response(db)
    assert result.available is True
    assert result.methodology is not None
    assert result.statistic is not None
    assert result.statistic.cramers_v == pytest.approx(0.6, abs=1e-9)
    assert result.population_size == 20
    assert result.validation_card_skip_reason is not None
