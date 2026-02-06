"""Unit tests for wiki_indexer service functions.

Tests index_source, index_stale_sources, and periodic_wiki_refresh
with mocked LLM/HTTP dependencies (funding_researcher, propaganda_scorer).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import (
    Base,
    Organization,
    PropagandaFilterScore,
    WikiIndexStatus,
    get_utc_now,
)
from app.services.propaganda_scorer import FilterScore, ScoringResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_filter_scores(source_name: str = "Test Source") -> list[FilterScore]:
    """Build a set of mock FilterScore objects for all six axes."""
    axes = [
        "ownership",
        "advertising",
        "sourcing",
        "flak",
        "ideology",
        "class_interest",
    ]
    return [
        FilterScore(
            filter_name=axis,
            score=i + 1,
            confidence="high",
            prose=f"Mock explanation for {axis}.",
            citations=[],
            empirical_basis=f"Mock basis for {axis}.",
        )
        for i, axis in enumerate(axes)
    ]


def _mock_org_data(name: str = "Test Source") -> dict:
    return {
        "name": name,
        "normalized_name": name.lower(),
        "funding_type": "commercial",
        "owner": "Some Corp",
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def engine_and_session():
    """Provide a fresh in-memory SQLite engine + session factory per test."""

    async def _setup():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        return engine, factory

    return _setup


# ---------------------------------------------------------------------------
# index_source
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestIndexSource:
    async def test_creates_index_status_on_success(self, engine_and_session):
        engine, factory = await engine_and_session()

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=_mock_org_data())

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            result = await index_source(
                "Test Source", {"country": "US", "category": "general"}
            )

        assert result is True

        # Verify research_organization called with use_ai=False (consolidated call)
        mock_researcher.research_organization.assert_awaited_once_with(
            "Test Source", use_ai=False
        )

        async with factory() as session:
            row = (
                await session.execute(
                    select(WikiIndexStatus).where(
                        WikiIndexStatus.entity_name == "Test Source"
                    )
                )
            ).scalar_one_or_none()

            assert row is not None
            assert row.status == "complete"
            assert row.index_duration_ms is not None
            assert row.last_indexed_at is not None

        await engine.dispose()

    async def test_persists_six_filter_scores(self, engine_and_session):
        engine, factory = await engine_and_session()

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=_mock_org_data())

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            await index_source("Test Source", {})

        async with factory() as session:
            scores = (
                (
                    await session.execute(
                        select(PropagandaFilterScore).where(
                            PropagandaFilterScore.source_name == "Test Source"
                        )
                    )
                )
                .scalars()
                .all()
            )

            assert len(scores) == 6
            names = {s.filter_name for s in scores}
            assert names == {
                "ownership",
                "advertising",
                "sourcing",
                "flak",
                "ideology",
                "class_interest",
            }

        await engine.dispose()

    async def test_records_failure_on_exception(self, engine_and_session):
        engine, factory = await engine_and_session()

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(
            side_effect=RuntimeError("API down")
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
        ):
            from app.services.wiki_indexer import index_source

            result = await index_source("Broken Source", {})

        assert result is False

        async with factory() as session:
            row = (
                await session.execute(
                    select(WikiIndexStatus).where(
                        WikiIndexStatus.entity_name == "Broken Source"
                    )
                )
            ).scalar_one_or_none()

            assert row is not None
            assert row.status == "failed"
            assert "API down" in (row.error_message or "")

        await engine.dispose()

    async def test_updates_existing_scores_on_reindex(self, engine_and_session):
        """Re-indexing a source should update existing rows, not duplicate."""
        engine, factory = await engine_and_session()

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=_mock_org_data())

        scores_v1 = _make_filter_scores()
        scores_v2 = _make_filter_scores()
        for s in scores_v2:
            s.score = 5

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            side_effect=[
                ScoringResult(scores=scores_v1),
                ScoringResult(scores=scores_v2),
            ]
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            await index_source("Test Source", {})
            await index_source("Test Source", {})

        async with factory() as session:
            scores = (
                (
                    await session.execute(
                        select(PropagandaFilterScore).where(
                            PropagandaFilterScore.source_name == "Test Source"
                        )
                    )
                )
                .scalars()
                .all()
            )

            assert len(scores) == 6
            assert all(s.score == 5 for s in scores)

        await engine.dispose()

    async def test_applies_org_updates_from_scorer(self, engine_and_session):
        """When scorer returns org_updates, those should be merged into org_data
        and persisted as an Organization row."""
        engine, factory = await engine_and_session()

        # org_data without funding_type or media_bias_rating
        incomplete_org = {
            "name": "Indie Wire",
            "normalized_name": "indie wire",
            "research_confidence": "low",
            "research_sources": ["wikipedia"],
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=incomplete_org)

        org_updates = {
            "funding_type": "independent",
            "parent_org": None,
            "media_bias_rating": "center-left",
            "factual_reporting": "high",
        }
        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(
                scores=_make_filter_scores(), org_updates=org_updates
            )
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            result = await index_source("Indie Wire", {})

        assert result is True

        async with factory() as session:
            org = (
                await session.execute(
                    select(Organization).where(
                        Organization.normalized_name == "indie wire"
                    )
                )
            ).scalar_one_or_none()

            assert org is not None
            assert org.funding_type == "independent"
            assert org.media_bias_rating == "center-left"
            assert org.factual_reporting == "high"
            assert "ai_inference" in (org.research_sources or [])

        await engine.dispose()

    async def test_no_org_updates_when_confidence_high(self, engine_and_session):
        """When org_data has research_confidence 'high', scorer should not
        return org_updates (no org enhancement needed)."""
        engine, factory = await engine_and_session()

        high_conf_org = _mock_org_data()
        high_conf_org["research_confidence"] = "high"

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=high_conf_org)

        # ScoringResult without org_updates (confidence was high)
        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores(), org_updates=None)
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            result = await index_source("Test Source", {})

        assert result is True

        # Verify score_source was called (org_updates=None means no extra fields)
        mock_scorer.score_source.assert_awaited_once()

        await engine.dispose()

    async def test_org_updates_do_not_overwrite_existing_values(
        self, engine_and_session
    ):
        """LLM org_updates should only fill gaps, not overwrite existing values."""
        engine, factory = await engine_and_session()

        # org_data already has funding_type set
        org_with_some_data = {
            "name": "Partial Org",
            "normalized_name": "partial org",
            "funding_type": "commercial",
            "research_confidence": "low",
            "research_sources": ["wikipedia"],
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(
            return_value=org_with_some_data
        )

        org_updates = {
            "funding_type": "independent",  # should NOT overwrite "commercial"
            "media_bias_rating": "center",  # should fill gap
        }
        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(
                scores=_make_filter_scores(), org_updates=org_updates
            )
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            await index_source("Partial Org", {})

        async with factory() as session:
            org = (
                await session.execute(
                    select(Organization).where(
                        Organization.normalized_name == "partial org"
                    )
                )
            ).scalar_one_or_none()

            assert org is not None
            assert org.funding_type == "commercial"  # NOT overwritten
            assert org.media_bias_rating == "center"  # filled in

        await engine.dispose()


# ---------------------------------------------------------------------------
# index_stale_sources
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestIndexStaleSources:
    async def test_indexes_unindexed_sources(self, engine_and_session):
        """Sources in rss_sources but not in wiki_index_status should be indexed."""
        engine, factory = await engine_and_session()

        mock_sources = {
            "Fresh News": {"country": "US", "category": "general"},
            "Old Wire": {"country": "GB", "category": "world"},
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=_mock_org_data())
        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_rss_sources", return_value=mock_sources
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_stale_sources

            summary = await index_stale_sources(stale_days=7, delay_seconds=0)

        assert summary["total"] == 2
        assert summary["success"] == 2
        assert summary["failed"] == 0

        await engine.dispose()

    async def test_reindexes_stale_entries(self, engine_and_session):
        """Entries older than stale_days should be re-indexed."""
        engine, factory = await engine_and_session()

        # Seed a stale entry
        async with factory() as session:
            stale_time = get_utc_now() - timedelta(days=10)
            session.add(
                WikiIndexStatus(
                    entity_type="source",
                    entity_name="Stale News",
                    status="complete",
                    last_indexed_at=stale_time,
                    next_index_at=stale_time + timedelta(days=7),
                )
            )
            await session.commit()

        mock_sources = {"Stale News": {"country": "US", "category": "general"}}

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=_mock_org_data())
        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_rss_sources", return_value=mock_sources
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_stale_sources

            summary = await index_stale_sources(stale_days=7, delay_seconds=0)

        assert summary["total"] >= 1
        assert summary["success"] >= 1

        await engine.dispose()

    async def test_skips_fresh_entries(self, engine_and_session):
        """Entries indexed within stale_days should not be re-indexed."""
        engine, factory = await engine_and_session()

        async with factory() as session:
            now = get_utc_now()
            session.add(
                WikiIndexStatus(
                    entity_type="source",
                    entity_name="Fresh News",
                    status="complete",
                    last_indexed_at=now,
                    next_index_at=now + timedelta(days=7),
                )
            )
            await session.commit()

        mock_sources = {"Fresh News": {"country": "US", "category": "general"}}

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_rss_sources", return_value=mock_sources
            ),
        ):
            from app.services.wiki_indexer import index_stale_sources

            summary = await index_stale_sources(stale_days=7, delay_seconds=0)

        assert summary["total"] == 0
        assert summary["success"] == 0

        await engine.dispose()


# ---------------------------------------------------------------------------
# periodic_wiki_refresh
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestPeriodicWikiRefresh:
    async def test_calls_index_stale_sources(self):
        """periodic_wiki_refresh should call index_stale_sources on each iteration."""
        call_count = 0

        async def _mock_index_stale(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count >= 1:
                raise asyncio.CancelledError
            return {"total": 0, "success": 0, "failed": 0}

        with (
            patch(
                "app.services.wiki_indexer.index_stale_sources",
                side_effect=_mock_index_stale,
            ),
            patch("app.services.wiki_indexer.asyncio.sleep", new_callable=AsyncMock),
        ):
            from app.services.wiki_indexer import periodic_wiki_refresh

            await periodic_wiki_refresh(interval_seconds=1, stale_days=7)

        assert call_count >= 1

    async def test_handles_exceptions_gracefully(self):
        """Errors in index_stale_sources should be logged, not crash the loop."""
        call_count = 0

        async def _mock_index_stale(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("Temporary failure")
            raise asyncio.CancelledError

        with (
            patch(
                "app.services.wiki_indexer.index_stale_sources",
                side_effect=_mock_index_stale,
            ),
            patch("app.services.wiki_indexer.asyncio.sleep", new_callable=AsyncMock),
        ):
            from app.services.wiki_indexer import periodic_wiki_refresh

            await periodic_wiki_refresh(interval_seconds=1, stale_days=7)

        assert call_count == 2


# ---------------------------------------------------------------------------
# RSS config funding_type priority
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestRssConfigFundingTypePriority:
    """Verify that index_source applies RSS config funding_type with correct priority:
    KNOWN_ORGS > rss_sources.json > ProPublica/Wikipedia/AI."""

    async def test_rss_config_overrides_propublica(self, engine_and_session):
        """When researcher returns non-profit (from ProPublica) but RSS config
        says Commercial, the DB should store commercial."""
        engine, factory = await engine_and_session()

        org_data = {
            "name": "Bloomberg",
            "normalized_name": "bloomberg",
            "funding_type": "non-profit",  # wrong, from ProPublica
            "research_sources": ["propublica"],
            "research_confidence": "high",
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=org_data)

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            result = await index_source(
                "Bloomberg", {"funding_type": "Commercial", "category": "business"}
            )

        assert result is True

        async with factory() as session:
            org = (
                await session.execute(
                    select(Organization).where(
                        Organization.normalized_name == "bloomberg"
                    )
                )
            ).scalar_one_or_none()

            assert org is not None
            assert org.funding_type == "commercial"

        await engine.dispose()

    async def test_known_data_not_overridden_by_rss_config(self, engine_and_session):
        """When researcher returns data from KNOWN_ORGS, RSS config should NOT
        override funding_type."""
        engine, factory = await engine_and_session()

        org_data = {
            "name": "BBC",
            "normalized_name": "bbc",
            "funding_type": "public",
            "research_sources": ["known_data", "wikipedia"],
            "research_confidence": "high",
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=org_data)

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            # Even if RSS says "State-funded", known_data should win
            result = await index_source(
                "BBC", {"funding_type": "State-funded", "category": "general"}
            )

        assert result is True

        async with factory() as session:
            org = (
                await session.execute(
                    select(Organization).where(Organization.normalized_name == "bbc")
                )
            ).scalar_one_or_none()

            assert org is not None
            assert org.funding_type == "public"

        await engine.dispose()

    async def test_empty_rss_config_does_not_override(self, engine_and_session):
        """When RSS config funding_type is empty, existing org_data should be preserved."""
        engine, factory = await engine_and_session()

        org_data = {
            "name": "SomeSource",
            "normalized_name": "somesource",
            "funding_type": "non-profit",
            "research_sources": ["propublica"],
            "research_confidence": "high",
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=org_data)

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            result = await index_source(
                "SomeSource", {"funding_type": "", "category": "general"}
            )

        assert result is True

        async with factory() as session:
            org = (
                await session.execute(
                    select(Organization).where(
                        Organization.normalized_name == "somesource"
                    )
                )
            ).scalar_one_or_none()

            assert org is not None
            assert org.funding_type == "non-profit"

        await engine.dispose()

    async def test_rss_config_adds_source_tracking(self, engine_and_session):
        """When RSS config is applied, 'rss_config' should appear in research_sources."""
        engine, factory = await engine_and_session()

        org_data = {
            "name": "Axios",
            "normalized_name": "axios",
            "funding_type": "non-profit",  # wrong
            "research_sources": ["propublica"],
            "research_confidence": "medium",
        }

        mock_researcher = MagicMock()
        mock_researcher.research_organization = AsyncMock(return_value=org_data)

        mock_scorer = MagicMock()
        mock_scorer.score_source = AsyncMock(
            return_value=ScoringResult(scores=_make_filter_scores())
        )

        with (
            patch(
                "app.services.wiki_indexer._get_session", side_effect=lambda: factory()
            ),
            patch(
                "app.services.wiki_indexer.get_funding_researcher",
                return_value=mock_researcher,
            ),
            patch(
                "app.services.wiki_indexer.get_propaganda_scorer",
                return_value=mock_scorer,
            ),
        ):
            from app.services.wiki_indexer import index_source

            await index_source(
                "Axios", {"funding_type": "Commercial", "category": "general"}
            )

        async with factory() as session:
            org = (
                await session.execute(
                    select(Organization).where(Organization.normalized_name == "axios")
                )
            ).scalar_one_or_none()

            assert org is not None
            assert "rss_config" in (org.research_sources or [])

        await engine.dispose()
