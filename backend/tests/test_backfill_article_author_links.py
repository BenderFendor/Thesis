"""Regression tests for deterministic ArticleAuthor backfill."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Article, ArticleAuthor, Base, Reporter, get_utc_now
from scripts.backfill_article_author_links import (
    _clean_author_names,
    _is_combined_byline_name,
    backfill_article_author_links,
    prune_invalid_local_byline_links,
)


@pytest.fixture
def engine_and_session():
    async def _setup():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        return engine, factory

    return _setup


@pytest.mark.asyncio
async def test_backfill_creates_local_reporter_and_article_author_links(engine_and_session) -> None:
    engine, factory = await engine_and_session()
    now = get_utc_now()

    async with factory() as session:
        session.add_all(
            [
                Article(
                    id=1,
                    title="Article A",
                    url="https://example.test/a",
                    source="Example News",
                    author="Jane Doe",
                    authors=["Jane Doe"],
                    author_urls=["https://example.test/author/jane-doe"],
                    published_at=now,
                    category="politics",
                ),
                Article(
                    id=2,
                    title="Article B",
                    url="https://example.test/b",
                    source="Example News",
                    author="Jane Doe",
                    published_at=now,
                    category="world",
                ),
                Article(
                    id=3,
                    title="Generic",
                    url="https://example.test/c",
                    source="Example News",
                    author="author",
                    published_at=now,
                    category="world",
                ),
                Article(
                    id=4,
                    title="Outlet label",
                    url="https://example.test/d",
                    source="Example News",
                    author="Example News",
                    published_at=now,
                    category="world",
                ),
            ]
        )
        await session.commit()

        metrics = await backfill_article_author_links(session, apply=True)

        reporter = (
            await session.execute(
                select(Reporter).where(Reporter.resolver_key == "jane doe::example news")
            )
        ).scalar_one()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.articles_scanned == 4
    assert metrics.skipped_generic_bylines == 2
    assert metrics.candidate_groups == 1
    assert metrics.reporters_created == 1
    assert metrics.links_created == 2
    assert reporter.match_status == "local_byline"
    assert reporter.article_count == 2
    assert reporter.confidence_tier == "likely"
    assert {link.article_id for link in links} == {1, 2}
    assert all(link.observation_source == "rss_byline" for link in links)
    assert [link.author_url_raw for link in sorted(links, key=lambda item: item.article_id)] == [
        "https://example.test/author/jane-doe",
        None,
    ]

    await engine.dispose()


def test_clean_author_names_splits_multi_author_bylines() -> None:
    assert _clean_author_names("Annie Karni and Tamir Kalifa") == [
        "Annie Karni",
        "Tamir Kalifa",
    ]
    assert _clean_author_names("Reid J. Epstein, Lisa Lerer and Shane Goldmacher") == [
        "Reid J. Epstein",
        "Lisa Lerer",
        "Shane Goldmacher",
    ]
    assert _clean_author_names("Aaron Clark, Akriti Sharma") == [
        "Aaron Clark",
        "Akriti Sharma",
    ]
    assert _clean_author_names("AFP and AP") == []
    assert _clean_author_names("Benita Kolovos Victorian state correspondent") == ["Benita Kolovos"]
    assert _clean_author_names("Martha Louis - PC Online Contributor") == ["Martha Louis"]
    assert _clean_author_names("author") == []


def test_is_combined_byline_name_flags_stale_combined_rows() -> None:
    assert _is_combined_byline_name("Jane Doe and John Smith") is True
    assert _is_combined_byline_name("Anna Betts and agencies") is True
    assert _is_combined_byline_name("AFP and AP") is True
    assert _is_combined_byline_name("Jane Doe") is False


@pytest.mark.asyncio
async def test_backfill_links_each_person_in_multi_author_byline(engine_and_session) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Article(
                id=1,
                title="Joint Article",
                url="https://example.test/a",
                source="Example News",
                author="Jane Doe and John Smith",
                published_at=get_utc_now(),
                category="politics",
            )
        )
        await session.commit()

        metrics = await backfill_article_author_links(session, apply=True)
        reporters = (
            (await session.execute(select(Reporter).order_by(Reporter.name))).scalars().all()
        )
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.articles_scanned == 1
    assert metrics.candidate_groups == 2
    assert metrics.reporters_created == 2
    assert metrics.links_created == 2
    assert [reporter.name for reporter in reporters] == ["Jane Doe", "John Smith"]
    assert {link.article_id for link in links} == {1}
    assert len(links) == 2

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_pairs_rust_author_urls_by_author_index(engine_and_session) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Article(
                id=1,
                title="Joint Article",
                url="https://example.test/a",
                source="Example News",
                author="Jane Doe",
                authors=["Jane Doe", "John Smith"],
                author_urls=[
                    "https://example.test/author/jane-doe",
                    "https://example.test/author/john-smith",
                ],
                published_at=get_utc_now(),
                category="politics",
            )
        )
        await session.commit()

        metrics = await backfill_article_author_links(session, apply=True)
        links = (
            (await session.execute(select(ArticleAuthor).order_by(ArticleAuthor.id)))
            .scalars()
            .all()
        )

    assert metrics.candidate_groups == 2
    assert metrics.links_created == 2
    assert [link.author_url_raw for link in links] == [
        "https://example.test/author/jane-doe",
        "https://example.test/author/john-smith",
    ]

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_skips_sources_that_cannot_support_reporter_bylines(
    engine_and_session,
) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Article(
                id=1,
                title="Academic paper",
                url="https://arxiv.org/abs/1",
                source="ArXiv CS (AI)",
                author="Jane Doe",
                published_at=get_utc_now(),
                category="technology",
            )
        )
        await session.commit()

        metrics = await backfill_article_author_links(
            session,
            apply=True,
            source_configs={
                "ArXiv CS (AI)": {
                    "ownership_label": "academic preprint repository",
                    "category": "technology",
                }
            },
        )
        reporters = (await session.execute(select(Reporter))).scalars().all()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.articles_scanned == 1
    assert metrics.skipped_disallowed_sources == 1
    assert metrics.candidate_groups == 0
    assert reporters == []
    assert links == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_dry_run_does_not_write_rows(engine_and_session) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Article(
                id=1,
                title="Article A",
                url="https://example.test/a",
                source="Example News",
                author="Jane Doe",
                published_at=get_utc_now(),
                category="politics",
            )
        )
        await session.commit()

        metrics = await backfill_article_author_links(session, apply=False)

        reporters = (await session.execute(select(Reporter))).scalars().all()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.reporters_created == 1
    assert metrics.links_created == 1
    assert reporters == []
    assert links == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_prune_invalid_local_byline_links_removes_disallowed_source_rows(
    engine_and_session,
) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Reporter(
                id=10,
                name="Jane Doe",
                normalized_name="jane doe",
                resolver_key="jane doe::arxiv cs ai",
                match_status="local_byline",
                career_history=[
                    {
                        "organization": "ArXiv CS (AI)",
                        "role": "byline outlet",
                        "source": "rss_catalog",
                    }
                ],
            )
        )
        session.add(
            Article(
                id=1,
                title="Academic paper",
                url="https://arxiv.org/abs/1",
                source="ArXiv CS (AI)",
                author="Jane Doe",
                published_at=get_utc_now(),
                category="technology",
            )
        )
        session.add(
            ArticleAuthor(
                article_id=1,
                reporter_id=10,
                author_role="author",
                author_confidence=0.55,
                observation_source="rss_byline",
            )
        )
        await session.commit()

        metrics = await prune_invalid_local_byline_links(
            session,
            apply=True,
            source_configs={
                "ArXiv CS (AI)": {
                    "ownership_label": "academic preprint repository",
                    "category": "technology",
                }
            },
        )
        reporters = (await session.execute(select(Reporter))).scalars().all()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.invalid_reporters_pruned == 1
    assert metrics.invalid_links_pruned == 1
    assert reporters == []
    assert links == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_prune_invalid_local_byline_links_removes_stale_combined_bylines(
    engine_and_session,
) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Reporter(
                id=10,
                name="Jane Doe and John Smith",
                normalized_name="jane doe and john smith",
                resolver_key="jane doe and john smith::example news",
                match_status="local_byline",
                career_history=[
                    {
                        "organization": "Example News",
                        "role": "byline outlet",
                        "source": "rss_catalog",
                    }
                ],
            )
        )
        session.add(
            Article(
                id=1,
                title="Joint Article",
                url="https://example.test/a",
                source="Example News",
                author="Jane Doe and John Smith",
                published_at=get_utc_now(),
                category="politics",
            )
        )
        session.add(
            ArticleAuthor(
                article_id=1,
                reporter_id=10,
                author_role="author",
                author_confidence=0.55,
                observation_source="rss_byline",
            )
        )
        await session.commit()

        metrics = await prune_invalid_local_byline_links(
            session,
            apply=True,
            source_configs={"Example News": {"category": "news"}},
        )
        reporters = (await session.execute(select(Reporter))).scalars().all()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.invalid_reporters_pruned == 1
    assert metrics.invalid_links_pruned == 1
    assert reporters == []
    assert links == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_prune_invalid_local_byline_links_removes_source_label_bylines(
    engine_and_session,
) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Reporter(
                id=10,
                name="Example News",
                normalized_name="example news",
                resolver_key="example news::example news",
                match_status="local_byline",
                career_history=[
                    {
                        "organization": "Example News",
                        "role": "byline outlet",
                        "source": "rss_catalog",
                    }
                ],
            )
        )
        session.add(
            Article(
                id=1,
                title="Outlet Article",
                url="https://example.test/a",
                source="Example News",
                author="Example News",
                published_at=get_utc_now(),
                category="politics",
            )
        )
        session.add(
            ArticleAuthor(
                article_id=1,
                reporter_id=10,
                author_role="author",
                author_confidence=0.55,
                observation_source="rss_byline",
            )
        )
        await session.commit()

        metrics = await prune_invalid_local_byline_links(
            session,
            apply=True,
            source_configs={"Example News": {"category": "news"}},
        )
        reporters = (await session.execute(select(Reporter))).scalars().all()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.invalid_reporters_pruned == 1
    assert metrics.invalid_links_pruned == 1
    assert reporters == []
    assert links == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_prune_invalid_local_byline_links_removes_stale_dirty_names(
    engine_and_session,
) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        session.add(
            Reporter(
                id=10,
                name="Martha Louis - PC Online Contributor",
                normalized_name="martha louis pc online contributor",
                resolver_key="martha louis pc online contributor::post courier",
                match_status="local_byline",
                career_history=[
                    {
                        "organization": "Post-Courier",
                        "role": "byline outlet",
                        "source": "rss_catalog",
                    }
                ],
            )
        )
        session.add(
            Article(
                id=1,
                title="Outlet Article",
                url="https://example.test/a",
                source="Post-Courier",
                author="Martha Louis - PC Online Contributor",
                published_at=get_utc_now(),
                category="politics",
            )
        )
        session.add(
            ArticleAuthor(
                article_id=1,
                reporter_id=10,
                author_role="author",
                author_confidence=0.55,
                observation_source="rss_byline",
            )
        )
        await session.commit()

        metrics = await prune_invalid_local_byline_links(
            session,
            apply=True,
            source_configs={"Post-Courier": {"category": "news"}},
        )
        reporters = (await session.execute(select(Reporter))).scalars().all()
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.invalid_reporters_pruned == 1
    assert metrics.invalid_links_pruned == 1
    assert reporters == []
    assert links == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_reuses_existing_reporter_without_duplicate_links(
    engine_and_session,
) -> None:
    engine, factory = await engine_and_session()

    async with factory() as session:
        reporter = Reporter(
            id=10,
            name="Jane Doe",
            normalized_name="jane doe",
            resolver_key="jane doe::example news",
            match_status="local_byline",
        )
        session.add(reporter)
        session.add(
            Article(
                id=1,
                title="Article A",
                url="https://example.test/a",
                source="Example News",
                author="Jane Doe",
                published_at=get_utc_now(),
                category="politics",
            )
        )
        session.add(
            ArticleAuthor(
                article_id=1,
                reporter_id=10,
                author_role="author",
                author_confidence=0.55,
                observation_source="rss_byline",
            )
        )
        await session.commit()

        metrics = await backfill_article_author_links(session, apply=True)
        links = (await session.execute(select(ArticleAuthor))).scalars().all()

    assert metrics.reporters_reused == 1
    assert metrics.reporters_created == 0
    assert metrics.links_created == 0
    assert metrics.existing_links == 1
    assert len(links) == 1

    await engine.dispose()
