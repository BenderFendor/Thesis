"""Tests for embedding generation logic in persistence.py.

Covers the bug where chroma_id updates incorrectly reset embedding_generated=False,
triggering mass re-embedding of already-embedded articles on every startup.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.database import Base, Article


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _make_article_row(
    *,
    id: int,
    url: str,
    chroma_id: str | None,
    embedding_generated: bool,
    title: str = "Test Title",
    summary: str = "Test summary.",
    source: str = "Test Source",
    category: str = "general",
    country: str = "US",
    published_at: datetime | None = None,
) -> MagicMock:
    """Build a mock DB row as returned by the upsert RETURNING clause."""
    row = MagicMock()
    row.id = id
    row.url = url
    row.chroma_id = chroma_id
    row.embedding_generated = embedding_generated
    row.title = title
    row.summary = summary
    row.source = source
    row.category = category
    row.country = country
    row.published_at = published_at or _utc_now()
    return row


def _make_news_article(url: str, title: str = "Test Title") -> MagicMock:
    from app.models.news import NewsArticle

    article = MagicMock(spec=NewsArticle)
    article.link = url
    article.title = title
    article.description = "Test summary."
    article.image = None
    article.published = None
    article.category = "general"
    article.source = "Test Source"
    article.id = None
    return article


# ---------------------------------------------------------------------------
# Unit tests: _persist_articles_async embedding logic
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_already_embedded_article_does_not_queue_embedding():
    """An article with embedding_generated=True and correct chroma_id must NOT
    be added to the embedding queue."""
    from app.services import persistence

    article_id = 42
    url = "https://example.com/article-42"
    correct_chroma_id = f"article_{article_id}"

    row = _make_article_row(
        id=article_id,
        url=url,
        chroma_id=correct_chroma_id,  # already correct
        embedding_generated=True,  # already embedded
    )

    news_article = _make_news_article(url)
    mock_vector_store = MagicMock()

    # Capture what gets queued
    queued: list = []

    mock_session = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [row]
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.services.persistence.AsyncSessionLocal", mock_session_factory),
        patch(
            "app.services.persistence.get_vector_store", return_value=mock_vector_store
        ),
        patch("app.services.persistence.settings") as mock_settings,
        patch("app.services.persistence.embedding_generation_queue") as mock_queue,
    ):
        mock_settings.enable_database = True
        mock_settings.embedding_queue_size = 100
        mock_queue.put_nowait.side_effect = queued.append

        await persistence._persist_articles_async(
            [news_article],
            {"source_id": "test", "category": "general", "country": "US"},
        )

    assert queued == [], (
        "No embedding should be queued for an already-embedded article with correct chroma_id"
    )

    assert queued == [], (
        "No embedding should be queued for an already-embedded article with correct chroma_id"
    )


@pytest.mark.asyncio
async def test_new_article_without_embedding_queues_embedding():
    """A brand-new article (embedding_generated=False, chroma_id=None) must be
    queued for embedding."""
    from app.services import persistence

    article_id = 99
    url = "https://example.com/article-99"

    row = _make_article_row(
        id=article_id,
        url=url,
        chroma_id=None,  # new article, no chroma_id yet
        embedding_generated=False,
    )

    news_article = _make_news_article(url)
    mock_vector_store = MagicMock()

    queued: list = []

    mock_session = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [row]
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.services.persistence.AsyncSessionLocal", mock_session_factory),
        patch(
            "app.services.persistence.get_vector_store", return_value=mock_vector_store
        ),
        patch("app.services.persistence.settings") as mock_settings,
        patch("app.services.persistence.embedding_generation_queue") as mock_queue,
    ):
        mock_settings.enable_database = True
        mock_settings.embedding_queue_size = 100
        mock_queue.put_nowait.side_effect = queued.append

        await persistence._persist_articles_async(
            [news_article],
            {"source_id": "test", "category": "general", "country": "US"},
        )

    assert len(queued) == 1, "New article should be queued for embedding"
    payloads, deletes = queued[0]
    assert len(payloads) == 1
    assert payloads[0]["article_id"] == article_id
    assert payloads[0]["chroma_id"] == f"article_{article_id}"


@pytest.mark.asyncio
async def test_chroma_id_format_change_queues_embedding_but_does_not_reset_db_flag():
    """When chroma_id changes format (old → article_{id}), the article is queued
    for re-embedding, but the DB update must NOT set embedding_generated=False.

    This is the core regression test for the mass-re-embedding bug.
    """
    from app.services import persistence

    article_id = 7
    url = "https://example.com/article-7"
    old_chroma_id = "some_old_format_7"  # old format that doesn't match article_{id}

    row = _make_article_row(
        id=article_id,
        url=url,
        chroma_id=old_chroma_id,
        embedding_generated=True,  # was previously embedded under old id
    )

    news_article = _make_news_article(url)
    mock_vector_store = MagicMock()

    queued: list = []
    db_update_values: list = []

    mock_session = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [row]

    executed_stmts: list = []

    async def _capture_execute(stmt, *args, **kwargs):
        stmt_str = str(stmt)
        executed_stmts.append((stmt_str, args))
        return mock_result

    mock_session.execute = _capture_execute
    mock_session.commit = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.services.persistence.AsyncSessionLocal", mock_session_factory),
        patch(
            "app.services.persistence.get_vector_store", return_value=mock_vector_store
        ),
        patch("app.services.persistence.settings") as mock_settings,
        patch("app.services.persistence.embedding_generation_queue") as mock_queue,
    ):
        mock_settings.enable_database = True
        mock_settings.embedding_queue_size = 100
        mock_queue.put_nowait.side_effect = queued.append

        await persistence._persist_articles_async(
            [news_article],
            {"source_id": "test", "category": "general", "country": "US"},
        )

    # The article should be queued for re-embedding (chroma_id changed)
    assert len(queued) == 1, (
        "Article with changed chroma_id should be re-queued for embedding"
    )

    # The DB UPDATE for chroma_id must NOT include embedding_generated=False.
    # Filter to UPDATE statements only (not the INSERT upsert, which legitimately
    # contains embedding_generated in its column list).
    update_only_stmts = [
        s for s, _ in executed_stmts if s.strip().upper().startswith("UPDATE")
    ]
    for stmt_str in update_only_stmts:
        assert "embedding_generated" not in stmt_str, (
            "DB UPDATE for chroma_id must not reset embedding_generated=False. "
            "This is the mass-re-embedding bug."
        )


@pytest.mark.asyncio
async def test_no_vector_store_skips_embedding_logic():
    """When vector store is unavailable, no embedding payloads are queued
    and no chroma_id updates are issued."""
    from app.services import persistence

    article_id = 5
    url = "https://example.com/article-5"

    row = _make_article_row(
        id=article_id,
        url=url,
        chroma_id=None,
        embedding_generated=False,
    )

    news_article = _make_news_article(url)

    queued: list = []

    mock_session = AsyncMock(spec=AsyncSession)
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [row]
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.services.persistence.AsyncSessionLocal", mock_session_factory),
        patch("app.services.persistence.get_vector_store", return_value=None),
        patch("app.services.persistence.settings") as mock_settings,
        patch("app.services.persistence.embedding_generation_queue") as mock_queue,
    ):
        mock_settings.enable_database = True
        mock_settings.embedding_queue_size = 100
        mock_queue.put_nowait.side_effect = queued.append

        await persistence._persist_articles_async(
            [news_article],
            {"source_id": "test", "category": "general", "country": "US"},
        )

    assert queued == [], (
        "No embedding should be queued when vector store is unavailable"
    )
