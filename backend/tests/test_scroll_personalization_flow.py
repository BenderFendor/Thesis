from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest
from httpx import AsyncClient

from app.api.routes import similarity as similarity_routes
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.chroma_topics import ChromaTopicService


@dataclass
class _FakeCollection:
    get_calls: int = 0
    query_calls: int = 0

    def get(self, *, ids: list[str], include: list[Any]) -> dict[str, object]:
        self.get_calls += 1
        return {
            "ids": ids,
            "embeddings": [[float(index + 1), 0.0] for index in range(len(ids))],
        }

    def query(
        self,
        *,
        query_embeddings: list[list[float]],
        n_results: int,
        include: list[Any],
    ) -> dict[str, object]:
        self.query_calls += 1
        ids_batches: list[list[str]] = []
        distances_batches: list[list[float]] = []

        for embedding in query_embeddings:
            article_id = int(embedding[0])
            if article_id in {1, 2}:
                peer_id = 2 if article_id == 1 else 1
            elif article_id in {3, 4}:
                peer_id = 4 if article_id == 3 else 3
            else:
                peer_id = article_id
            ids_batches.append([f"article_{article_id}", f"article_{peer_id}"])
            distances_batches.append([0.0, 0.05])

        return {
            "ids": ids_batches,
            "distances": distances_batches,
            "metadatas": [[] for _ in query_embeddings],
        }


@dataclass
class _FakeVectorStore:
    collection: _FakeCollection


def _cache_article(
    article_id: int,
    title: str,
    source: str,
    published: str,
    category: str,
    url: str,
) -> NewsArticle:
    return NewsArticle(
        id=article_id,
        title=title,
        link=url,
        description=title,
        published=published,
        source=source,
        category=category,
        country="US",
        image=None,
        mentioned_countries=[],
    )


@pytest.mark.asyncio
async def test_scroll_personalization_backend_flow_is_batched(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _FakeCollection()
    vector_store = _FakeVectorStore(collection=collection)

    monkeypatch.setattr(similarity_routes, "get_vector_store", lambda: vector_store)
    monkeypatch.setattr(
        ChromaTopicService,
        "_get_vector_store",
        lambda self: vector_store,
    )

    original_articles = news_cache.articles
    original_articles_by_source = news_cache.articles_by_source
    original_source_stats = news_cache.source_stats
    original_source_stats_by_name = news_cache.source_stats_by_name
    original_update_count = news_cache.update_count
    original_last_updated = news_cache.last_updated

    cache_articles = [
        _cache_article(
            1,
            "Article A",
            "Test News",
            "2026-03-11T12:00:00",
            "politics",
            "https://testnews.example.com/a",
        ),
        _cache_article(
            2,
            "Article B",
            "Test News",
            "2026-03-10T12:00:00",
            "world",
            "https://testnews.example.com/b",
        ),
        _cache_article(
            3,
            "Article C",
            "State Gazette",
            "2026-03-12T12:00:00",
            "politics",
            "https://stategazette.example.com/c",
        ),
        _cache_article(
            4,
            "Article D",
            "Independent Wire",
            "2026-03-12T09:00:00",
            "world",
            "https://indwire.example.com/d",
        ),
    ]

    source_stats = [
        {"name": "Test News", "status": "success"},
        {"name": "State Gazette", "status": "success"},
        {"name": "Independent Wire", "status": "success"},
    ]

    try:
        news_cache.update_cache(cache_articles, source_stats)

        bookmark_resp = await client.post("/api/bookmarks", json={"article_id": 1})
        like_resp = await client.post("/api/liked", json={"article_id": 3})
        assert bookmark_resp.status_code == 201
        assert like_resp.status_code == 201

        paginated_resp = await client.get("/news/page/cached?limit=500")
        assert paginated_resp.status_code == 200
        paginated_payload = paginated_resp.json()
        page_article_ids = [article["id"] for article in paginated_payload["articles"]]
        assert page_article_ids == [3, 4, 1, 2]

        bookmarks_resp, liked_resp = await asyncio.gather(
            client.get("/api/bookmarks"),
            client.get("/api/liked"),
        )
        assert bookmarks_resp.status_code == 200
        assert liked_resp.status_code == 200

        bookmark_article_ids = [
            item["article_id"] for item in bookmarks_resp.json()["bookmarks"]
        ]
        liked_article_ids = [item["article_id"] for item in liked_resp.json()["liked"]]
        topic_ids = list(
            dict.fromkeys(page_article_ids + bookmark_article_ids + liked_article_ids)
        )

        topics_resp = await client.post(
            "/api/similarity/bulk-article-topics",
            json=topic_ids,
        )
        assert topics_resp.status_code == 200
        topics_payload = topics_resp.json()["articles"]

        assert set(topics_payload.keys()) == {"1", "2", "3", "4"}
        assert topics_payload["1"][0]["keywords"]
        assert topics_payload["3"][0]["keywords"]
        assert collection.get_calls == 1
        assert collection.query_calls == 1
    finally:
        news_cache.articles = original_articles
        news_cache.articles_by_source = original_articles_by_source
        news_cache.source_stats = original_source_stats
        news_cache.source_stats_by_name = original_source_stats_by_name
        news_cache.update_count = original_update_count
        news_cache.last_updated = original_last_updated
