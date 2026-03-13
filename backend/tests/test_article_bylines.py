from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.database as database
from app.api.routes.news import _browse_article_to_dict
from app.models.news import NewsArticle
from app.services.rss_ingestion import _build_article_from_rust_payload


def test_build_article_from_rust_payload_preserves_authors() -> None:
    article = _build_article_from_rust_payload(
        {
            "title": "Reporter Test",
            "link": "https://example.com/reporter-test",
            "description": "A test article",
            "published": datetime.now(timezone.utc).isoformat(),
            "authors": ["Jane Reporter", "John Editor"],
        },
        "Test Source",
        {"country": "US", "category": "news"},
    )

    assert isinstance(article, NewsArticle)
    assert article.author == "Jane Reporter"
    assert article.authors == ["Jane Reporter", "John Editor"]


def test_browse_article_to_dict_includes_author_fields() -> None:
    payload = _browse_article_to_dict(
        {
            "id": 10,
            "title": "Reporter Test",
            "source": "Test Source",
            "source_id": "test-source",
            "country": "US",
            "credibility": "medium",
            "bias": "left",
            "summary": "A compact summary",
            "image_url": None,
            "published_at": datetime(2026, 3, 13, tzinfo=timezone.utc),
            "category": "news",
            "url": "https://example.com/reporter-test",
            "author": "Jane Reporter",
            "authors": ["Jane Reporter", "John Editor"],
        }
    )

    assert payload["author"] == "Jane Reporter"
    assert payload["authors"] == ["Jane Reporter", "John Editor"]


@pytest.mark.asyncio
async def test_news_index_returns_article_authors(client) -> None:
    response = await client.get("/news/index")
    assert response.status_code == 200
    data = response.json()

    assert all("author" in article for article in data["articles"])
    assert all("authors" in article for article in data["articles"])


@pytest.mark.asyncio
async def test_get_total_article_count_falls_back_when_postgres_estimate_is_negative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = AsyncMock(spec=AsyncSession)
    estimate_result = Mock()
    estimate_result.scalar_one_or_none.return_value = -1
    count_result = Mock()
    count_result.scalar_one.return_value = 42
    session.execute = AsyncMock(side_effect=[estimate_result, count_result])

    monkeypatch.setattr(
        database, "get_session_dialect_name", lambda _session: "postgresql"
    )

    total = await database.get_total_article_count(session)

    assert total == 42
    assert session.execute.await_count == 2
