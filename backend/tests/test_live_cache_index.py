from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from hypothesis import given, strategies as st
from httpx import AsyncClient

import app.services.cache as cache_module
from app.models.news import NewsArticle
from app.services.cache import NewsCache, news_cache


def _build_article(
    article_id: int | None, source: str, minutes_ago: int
) -> NewsArticle:
    published = datetime(2026, 4, 9, tzinfo=timezone.utc) - timedelta(
        minutes=minutes_ago
    )
    return NewsArticle(
        id=article_id,
        title=f"{source} story {article_id}",
        link=f"https://example.com/{article_id}",
        description=f"{source} description {article_id}",
        published=published.isoformat(),
        source=source,
        category="general",
        country="US",
    )


@given(
    entries=st.lists(
        st.tuples(
            st.sampled_from(["Source A", "Source B", "Source C", "Source D"]),
            st.integers(min_value=0, max_value=500),
        ),
        min_size=1,
        max_size=60,
    )
)
def test_shape_articles_keeps_all_articles_when_limits_disabled(
    entries: list[tuple[str, int]],
) -> None:
    cache = NewsCache()
    articles = [
        _build_article(index, source, minutes_ago)
        for index, (source, minutes_ago) in enumerate(entries, start=1)
    ]

    original_settings = cache_module.settings
    cache_module.settings = SimpleNamespace(
        news_cache_max_articles=0,
        news_cache_max_per_source=0,
    )
    try:
        shaped = cache._shape_articles(articles)
    finally:
        cache_module.settings = original_settings

    assert len(shaped) == len(articles)
    assert {article.link for article in shaped} == {
        article.link for article in articles
    }


@given(
    entries=st.lists(
        st.tuples(
            st.sampled_from(["Source A", "Source B", "Source C", "Source D"]),
            st.integers(min_value=0, max_value=500),
        ),
        min_size=1,
        max_size=60,
    ),
    max_articles=st.integers(min_value=1, max_value=25),
    max_per_source=st.integers(min_value=1, max_value=5),
)
def test_shape_articles_respects_explicit_caps(
    entries: list[tuple[str, int]],
    max_articles: int,
    max_per_source: int,
) -> None:
    cache = NewsCache()
    articles = [
        _build_article(index, source, minutes_ago)
        for index, (source, minutes_ago) in enumerate(entries, start=1)
    ]

    original_settings = cache_module.settings
    cache_module.settings = SimpleNamespace(
        news_cache_max_articles=max_articles,
        news_cache_max_per_source=max_per_source,
    )
    try:
        shaped = cache._shape_articles(articles)
    finally:
        cache_module.settings = original_settings

    assert len(shaped) <= min(len(articles), max_articles)
    per_source_counts: dict[str, int] = {}
    for article in shaped:
        per_source_counts[article.source] = per_source_counts.get(article.source, 0) + 1
    assert all(count <= max_per_source for count in per_source_counts.values())


@pytest.mark.asyncio
async def test_cached_browse_index_returns_live_cache_articles(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    articles = [
        _build_article(1, "Source A", 1),
        _build_article(2, "Source B", 2),
        _build_article(3, "Source C", 3),
    ]

    monkeypatch.setattr(news_cache, "get_articles", lambda: articles)

    response = await client.get("/news/index/cached")

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert [article["id"] for article in data["articles"]] == [1, 2, 3]
    assert all(article["is_persisted"] is True for article in data["articles"])
    assert all(article.get("content") is None for article in data["articles"])


@pytest.mark.asyncio
async def test_cached_browse_index_marks_unpersisted_live_rows(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    articles = [
        _build_article(None, "Source A", 1),
        _build_article(2, "Source B", 2),
    ]

    monkeypatch.setattr(news_cache, "get_articles", lambda: articles)

    response = await client.get("/news/index/cached")

    assert response.status_code == 200
    data = response.json()
    assert data["articles"][0]["id"] is None
    assert data["articles"][0]["article_id"] is None
    assert data["articles"][0]["is_persisted"] is False
    assert data["articles"][1]["is_persisted"] is True
