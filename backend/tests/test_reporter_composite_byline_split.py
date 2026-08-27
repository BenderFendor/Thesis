"""Upstream composite-byline splitting during reporter indexing (audit rec 2a)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import Article, ArticleAuthor, Reporter
from app.services.reporter_indexer import _handle_composite_byline

NOW = datetime(2026, 7, 22, tzinfo=UTC).replace(tzinfo=None)


@pytest.mark.asyncio
async def test_composite_byline_creates_one_reporter_per_author(db_session) -> None:
    composite = "ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press"
    article = Article(
        title="A story",
        source="AP Wire",
        url="https://example.com/story",
        author=composite,
        published_at=NOW,
        content="body",
    )
    db_session.add(article)
    await db_session.commit()

    handled = await _handle_composite_byline(db_session, composite, "AP Wire", "entity-key")
    await db_session.commit()

    assert handled is True
    reporters = list((await db_session.execute(select(Reporter))).scalars().all())
    names = sorted(r.name for r in reporters)
    assert names == ["ALANNA DURKIN RICHER", "GENE JOHNSON"]
    for reporter in reporters:
        assert reporter.article_count == 1
        link = (
            await db_session.execute(
                select(ArticleAuthor).where(
                    ArticleAuthor.reporter_id == reporter.id, ArticleAuthor.article_id == article.id
                )
            )
        ).scalar_one()
        assert link is not None


@pytest.mark.asyncio
async def test_non_composite_byline_is_not_handled(db_session) -> None:
    handled = await _handle_composite_byline(db_session, "Jane Reporter", "AP Wire", "entity-key")
    assert handled is False
    reporters = list((await db_session.execute(select(Reporter))).scalars().all())
    assert reporters == []


@pytest.mark.asyncio
async def test_composite_byline_reuses_existing_reporter_by_normalized_name(db_session) -> None:
    existing = Reporter(name="Gene Johnson", normalized_name="gene johnson", article_count=3)
    db_session.add(existing)
    await db_session.commit()

    composite = "Alanna Durkin Richer and Gene Johnson"
    article = Article(
        title="A story",
        source="AP Wire",
        url="https://example.com/story2",
        author=composite,
        published_at=NOW,
        content="body",
    )
    db_session.add(article)
    await db_session.commit()

    await _handle_composite_byline(db_session, composite, "AP Wire", "entity-key")
    await db_session.commit()

    reporters = list((await db_session.execute(select(Reporter))).scalars().all())
    assert len(reporters) == 2  # existing Gene Johnson reused, not duplicated
    gene = next(r for r in reporters if r.normalized_name == "gene johnson")
    assert gene.id == existing.id
    assert gene.article_count == 1  # recomputed from real ArticleAuthor links
