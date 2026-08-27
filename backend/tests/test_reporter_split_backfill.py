"""Backfill: split existing composite reporter rows (audit rec 2b)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import Article, ArticleAuthor, Reporter
from app.services.reporter_split_backfill import split_composite_reporters

NOW = datetime(2026, 7, 22, tzinfo=UTC).replace(tzinfo=None)


async def _make_article(db, url: str) -> Article:
    article = Article(title="A story", source="AP Wire", url=url, published_at=NOW, content="x")
    db.add(article)
    await db.flush()
    return article


@pytest.mark.asyncio
async def test_split_backfill_creates_children_and_retires_composite(db_session) -> None:
    composite = Reporter(
        name="ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press",
        normalized_name="alanna durkin richer and gene johnson, associated press",
        article_count=2,
    )
    db_session.add(composite)
    await db_session.flush()

    articles = [await _make_article(db_session, f"https://example.com/{i}") for i in range(2)]
    await db_session.flush()
    db_session.add_all(
        [
            ArticleAuthor(article_id=articles[0].id, reporter_id=composite.id),
            ArticleAuthor(article_id=articles[1].id, reporter_id=composite.id),
        ]
    )
    await db_session.commit()

    report = await split_composite_reporters(db_session)
    await db_session.commit()

    assert report.reporters_split == 1
    assert report.children_created == 2
    assert report.article_links_created == 4  # 2 articles x 2 children

    await db_session.refresh(composite)
    assert composite.retirement_reason == "split"
    assert composite.split_into is not None and len(composite.split_into) == 2

    children = list(
        (await db_session.execute(select(Reporter).where(Reporter.id.in_(composite.split_into))))
        .scalars()
        .all()
    )
    names = sorted(c.name for c in children)
    assert names == ["ALANNA DURKIN RICHER", "GENE JOHNSON"]
    for child in children:
        assert child.article_count == 2
        links = (
            (
                await db_session.execute(
                    select(ArticleAuthor).where(ArticleAuthor.reporter_id == child.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(links) == 2

    # Original composite links are left in place (not deleted) -- the
    # composite row is retired, not erased.
    original_links = (
        (
            await db_session.execute(
                select(ArticleAuthor).where(ArticleAuthor.reporter_id == composite.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(original_links) == 2


@pytest.mark.asyncio
async def test_split_backfill_is_idempotent(db_session) -> None:
    composite = Reporter(name="A and B", normalized_name="a and b", article_count=1)
    db_session.add(composite)
    await db_session.flush()
    article = await _make_article(db_session, "https://example.com/x")
    db_session.add(ArticleAuthor(article_id=article.id, reporter_id=composite.id))
    await db_session.commit()

    first = await split_composite_reporters(db_session)
    await db_session.commit()
    assert first.reporters_split == 1

    second = await split_composite_reporters(db_session)
    await db_session.commit()
    assert second.reporters_split == 0
    assert second.children_created == 0
    assert second.article_links_created == 0


@pytest.mark.asyncio
async def test_split_backfill_reuses_existing_child_reporter(db_session) -> None:
    existing_child = Reporter(name="B", normalized_name="b", article_count=5)
    composite = Reporter(name="A and B", normalized_name="a and b", article_count=1)
    db_session.add_all([existing_child, composite])
    await db_session.flush()
    article = await _make_article(db_session, "https://example.com/y")
    db_session.add(ArticleAuthor(article_id=article.id, reporter_id=composite.id))
    await db_session.commit()

    report = await split_composite_reporters(db_session)
    await db_session.commit()

    assert report.children_created == 1  # only "A" is new
    assert report.children_reused == 1  # "B" reused

    await db_session.refresh(composite)
    assert existing_child.id in composite.split_into
