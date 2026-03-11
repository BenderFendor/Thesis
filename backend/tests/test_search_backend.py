from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import news_research_agent as agent
from app.database import search_articles_by_keyword


def _invoke_search_internal_news(query: str, top_k: int) -> str:
    return str(agent.search_internal_news.invoke({"query": query, "top_k": top_k}))


@pytest.mark.asyncio
async def test_search_articles_by_keyword_matches_all_terms_in_sqlite_fallback(
    seeded_db: AsyncSession,
) -> None:
    results = await search_articles_by_keyword(
        seeded_db,
        query="China supply chains",
        limit=10,
    )

    assert [article["id"] for article in results] == []


@pytest.mark.asyncio
async def test_news_page_search_uses_backend_search(client: AsyncClient) -> None:
    resp = await client.get("/news/page?search=China supply chains&limit=10")
    assert resp.status_code == 200

    data = resp.json()
    assert data["total"] == 0
    assert [article["id"] for article in data["articles"]] == []


def test_search_internal_news_prefers_db_results(monkeypatch) -> None:
    article = {
        "id": 77,
        "title": "Database match",
        "source": "Test News",
        "url": "https://testnews.example.com/db-match",
        "published": "2026-03-10T00:00:00",
        "summary": "Database-backed result",
        "retrieval_method": "keyword_postgres",
    }

    async def fake_search_internal_news_from_db(query: str, top_k: int):
        assert query == "db query"
        assert top_k == 3
        return [article]

    monkeypatch.setattr(
        agent,
        "_search_internal_news_from_db",
        fake_search_internal_news_from_db,
    )
    agent.set_news_articles([])

    result = _invoke_search_internal_news("db query", 3)
    payload = json.loads(result)

    assert payload[0]["url"] == article["url"]
    assert agent._articles_by_id[str(article["id"])] == article


def test_search_internal_news_falls_back_to_cached_articles(monkeypatch) -> None:
    async def fake_search_internal_news_from_db(_query: str, _top_k: int):
        return []

    monkeypatch.setattr(
        agent,
        "_search_internal_news_from_db",
        fake_search_internal_news_from_db,
    )
    agent.set_news_articles(
        [
            {
                "id": 1,
                "title": "Cached China update",
                "source": "Cache Source",
                "url": "https://cache.example.com/china-update",
                "summary": "China policy and supply chains update",
            }
        ]
    )

    result = _invoke_search_internal_news("China supply", 5)
    payload = json.loads(result)

    assert payload[0]["title"] == "Cached China update"


def test_search_internal_news_returns_empty_message_when_archive_has_no_match(
    monkeypatch,
) -> None:
    async def fake_search_internal_news_from_db(_query: str, _top_k: int):
        return []

    monkeypatch.setattr(
        agent,
        "_search_internal_news_from_db",
        fake_search_internal_news_from_db,
    )
    agent.set_news_articles([])

    result = _invoke_search_internal_news("China supply", 5)

    assert result == "No relevant articles found in internal archive."
