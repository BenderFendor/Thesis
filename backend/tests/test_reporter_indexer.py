"""Tests for reporter wiki background indexing."""

from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, Reporter, WikiIndexStatus, get_utc_now


def _matched_profile() -> dict:
    return {
        "name": "Jane Doe",
        "normalized_name": "jane doe",
        "bio": "Updated profile.",
        "career_history": [{"organization": "Test News", "source": "wikidata"}],
        "topics": ["journalist"],
        "field_of_work": ["investigative reporting"],
        "education": [{"institution": "Columbia", "source": "wikidata"}],
        "political_leaning": "center",
        "leaning_confidence": "medium",
        "leaning_sources": ["wikidata"],
        "twitter_handle": "janedoe",
        "linkedin_url": "https://linkedin.com/in/janedoe",
        "wikipedia_url": "https://en.wikipedia.org/wiki/Jane_Doe",
        "wikidata_qid": "Q100",
        "wikidata_url": "https://www.wikidata.org/wiki/Q100",
        "canonical_name": "Jane Doe",
        "resolver_key": "jane doe::test news",
        "match_status": "matched",
        "overview": "Updated profile.",
        "dossier_sections": [],
        "citations": [],
        "search_links": {},
        "match_explanation": "Matched in test.",
        "research_sources": ["wikidata"],
        "research_confidence": "high",
        "affiliations": ["Investigative Reporters and Editors"],
    }


@pytest.fixture
def engine_and_session():
    async def _setup():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        return engine, factory

    return _setup


@pytest.mark.asyncio
async def test_stale_reporter_update_uses_one_session(engine_and_session):
    engine, factory = await engine_and_session()
    stale_at = get_utc_now() - timedelta(days=8)

    async with factory() as session:
        session.add(
            Reporter(
                name="Jane Doe",
                normalized_name="jane doe",
                resolver_key="jane doe::test news",
                match_status="matched",
                bio="Old profile.",
            )
        )
        session.add(
            WikiIndexStatus(
                entity_type="reporter",
                entity_name="jane doe::test news",
                status="complete",
                last_indexed_at=stale_at,
            )
        )
        await session.commit()

    with (
        patch(
            "app.services.reporter_indexer._get_session", side_effect=lambda: factory()
        ),
        patch(
            "app.services.reporter_indexer.build_reporter_dossier",
            new=AsyncMock(return_value=_matched_profile()),
        ),
    ):
        from app.services.reporter_indexer import index_stale_reporters

        result = await index_stale_reporters(stale_days=7, delay_seconds=0)

    assert result == {"total": 1, "resolved": 1, "failed": 0}

    async with factory() as session:
        reporter = (
            await session.execute(
                select(Reporter).where(Reporter.resolver_key == "jane doe::test news")
            )
        ).scalar_one()
        status = (
            await session.execute(
                select(WikiIndexStatus).where(
                    WikiIndexStatus.entity_name == "jane doe::test news"
                )
            )
        ).scalar_one()

    assert reporter.bio == "Updated profile."
    assert reporter.topics == ["journalist", "investigative reporting"]
    assert reporter.institutional_affiliations == [
        {"organization": "Investigative Reporters and Editors", "source": "wikidata"}
    ]
    assert status.status == "complete"
    assert status.last_indexed_at is not None

    await engine.dispose()
