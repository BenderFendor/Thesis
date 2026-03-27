from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import news_research_agent as agent
from app.database import search_articles_by_keyword


def _invoke_search_internal_news(query: str, top_k: int) -> str:
    return str(agent.search_internal_news.invoke({"query": query, "top_k": top_k}))


def _invoke_news_search(keywords: str, max_results: int = 10) -> str:
    return str(
        agent.news_search.invoke(
            {"keywords": keywords, "max_results": max_results, "region": "wt-wt"}
        )
    )


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


@pytest.mark.asyncio
async def test_news_index_returns_lightweight_full_browse_results(
    client: AsyncClient,
) -> None:
    resp = await client.get("/news/index?search=China")
    assert resp.status_code == 200

    data = resp.json()
    assert data["total"] == 3
    assert [article["id"] for article in data["articles"]] == [3, 4, 2]
    assert all(article.get("content") is None for article in data["articles"])
    assert all(len(article.get("summary") or "") <= 283 for article in data["articles"])
    article_c = next(article for article in data["articles"] if article["id"] == 3)
    article_b = next(article for article in data["articles"] if article["id"] == 2)
    assert article_c["author"] == "John Smith"
    assert article_b["authors"] == ["Jane Doe", "Staff Writer"]


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


def test_news_search_prefers_gdelt_context_results(monkeypatch) -> None:
    call_order: list[str] = []

    class FakeGDELTService:
        async def search_context(self, query: str, max_records: int, timespan: str):
            call_order.append("context")
            assert query == "Iran latest"
            assert max_records == 1
            assert timespan
            return [
                {
                    "url": "https://example.com/gdelt-context",
                    "title": "GDELT context update",
                    "source": "GDELT source",
                    "summary": "Snippet from GDELT Context",
                    "published": "2026-03-27T00:00:00Z",
                    "provider": "gdelt",
                    "result_type": "context",
                    "context_snippet": "Snippet from GDELT Context",
                }
            ]

        async def search_doc(self, query: str, max_records: int, timespan: str):
            call_order.append("doc")
            raise AssertionError(
                "DOC search should not run when Context has enough results"
            )

    class FakeDDGS:
        def news(self, *_args, **_kwargs):
            raise AssertionError(
                "DDG fallback should not run when GDELT returns results"
            )

    monkeypatch.setattr(agent, "get_gdelt_query_service", lambda: FakeGDELTService())
    monkeypatch.setattr(agent, "DDGS", lambda: FakeDDGS())

    payload = json.loads(_invoke_news_search("Iran latest", max_results=1))

    assert call_order == ["context"]
    assert payload[0]["provider"] == "gdelt"
    assert payload[0]["context_snippet"] == "Snippet from GDELT Context"


def test_news_search_falls_back_to_ddg_when_gdelt_is_empty(monkeypatch) -> None:
    call_order: list[str] = []

    class FakeGDELTService:
        async def search_context(self, query: str, max_records: int, timespan: str):
            call_order.append("context")
            return []

        async def search_doc(self, query: str, max_records: int, timespan: str):
            call_order.append("doc")
            return []

    class FakeDDGS:
        def news(self, keywords: str, max_results: int, region: str):
            call_order.append("ddg")
            assert keywords == "Iran latest"
            assert max_results == 5
            assert region == "wt-wt"
            return [
                {
                    "url": "https://example.com/ddg-story",
                    "title": "DDG story",
                    "source": "DDG source",
                    "body": "DDG fallback result",
                    "date": "2026-03-27T00:00:00Z",
                }
            ]

    monkeypatch.setattr(agent, "get_gdelt_query_service", lambda: FakeGDELTService())
    monkeypatch.setattr(agent, "DDGS", lambda: FakeDDGS())

    payload = json.loads(_invoke_news_search("Iran latest", max_results=5))

    assert call_order == ["context", "doc", "ddg"]
    assert payload[0]["provider"] == "duckduckgo"
    assert payload[0]["result_type"] == "news"
