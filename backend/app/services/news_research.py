"""News Research."""

from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.database import (
    AsyncSessionLocal,
    fetch_articles_by_ids,
    fetch_recent_articles,
    search_articles_by_keyword,
)
from app.vector_store import SimilarArticleResult, VectorStore, get_vector_store

logger = get_logger("news_research")


async def load_articles_for_research(
    query: str,
    semantic_limit: int = 20,
    keyword_limit: int = 50,
    recent_limit: int = 40,
    max_total: int = 150,
) -> dict[str, Any]:
    """Load Articles For Research."""
    session_factory = AsyncSessionLocal
    db_enabled = settings.enable_database and session_factory is not None

    vector_store = get_vector_store()
    semantic_results = _search_semantic_hits(vector_store, query, semantic_limit)
    keyword_floor = max(10, keyword_limit // 2)

    keyword_articles_raw: list[dict[str, Any]] = []
    recent_articles_raw: list[dict[str, Any]] = []
    fetched_lookup: dict[int, dict[str, Any]] = {}
    if db_enabled and session_factory is not None:
        (
            keyword_articles_raw,
            recent_articles_raw,
            fetched_lookup,
        ) = await _load_database_articles(
            session_factory,
            query,
            semantic_results,
            keyword_limit,
            keyword_floor,
            recent_limit,
        )
    else:
        logger.info("Skipping database-backed search; ENABLE_DATABASE=0")

    keyword_articles = [
        {**article, "retrieval_method": "keyword_postgres"} for article in keyword_articles_raw
    ]

    semantic_articles = _build_semantic_articles(semantic_results, fetched_lookup)

    need_recent = len(keyword_articles) < keyword_floor
    recent_articles = (
        [{**article, "retrieval_method": "recent_postgres"} for article in recent_articles_raw]
        if need_recent and recent_articles_raw
        else []
    )

    dedup = ArticleDeduper(max_total)
    for bucket in (semantic_articles, keyword_articles, recent_articles):
        if dedup.is_full:
            break
        dedup.add_bucket(bucket)

    summary = {
        "keyword_count": len(keyword_articles),
        "semantic_count": len(semantic_articles),
        "recent_count": len(recent_articles),
        "total": len(dedup.combined),
        "vector_enabled": bool(vector_store),
    }

    return {"articles": dedup.combined, "summary": summary}


def _search_semantic_hits(
    vector_store: VectorStore | None,
    query: str,
    semantic_limit: int,
) -> list[SimilarArticleResult]:
    """Run the semantic vector search, degrading to empty on failure."""
    if not vector_store or not query:
        return []
    try:
        return vector_store.search_similar(query, limit=semantic_limit)
    except Exception as semantic_error:  # pragma: no cover - defensive logging
        logger.error("Semantic vector search failed: %s", semantic_error)
        return []


async def _load_database_articles(
    session_factory: Any,
    query: str,
    semantic_results: list[SimilarArticleResult],
    keyword_limit: int,
    keyword_floor: int,
    recent_limit: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[int, dict[str, Any]]]:
    """Load keyword, recent, and semantic-id lookups from the database."""
    keyword_articles_raw: list[dict[str, Any]] = []
    recent_articles_raw: list[dict[str, Any]] = []
    fetched_lookup: dict[int, dict[str, Any]] = {}
    async with session_factory() as session:
        if query:
            keyword_articles_raw = await search_articles_by_keyword(
                session, query=query, limit=keyword_limit
            )

        article_ids = [result["article_id"] for result in semantic_results]
        if article_ids:
            fetched_articles = await fetch_articles_by_ids(session, article_ids)
            fetched_lookup = {article["id"]: article for article in fetched_articles}

        if len(keyword_articles_raw) < keyword_floor:
            recent_articles_raw = await fetch_recent_articles(session, limit=recent_limit)
    return keyword_articles_raw, recent_articles_raw, fetched_lookup


def _build_semantic_articles(
    semantic_results: list[SimilarArticleResult],
    fetched_lookup: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Project semantic search hits into article payloads."""
    semantic_articles: list[dict[str, Any]] = []
    for result in semantic_results:
        article_id = result["article_id"]
        if isinstance(article_id, int) and article_id in fetched_lookup:
            article_data = {**fetched_lookup[article_id]}
        else:
            metadata = result["metadata"]
            article_data = {
                "id": article_id,
                "title": metadata.get("title") or metadata.get("url") or "Semantic match",
                "source": metadata.get("source", "Unknown"),
                "category": metadata.get("category", "general"),
                "description": metadata.get("summary"),
                "summary": metadata.get("summary"),
                "link": metadata.get("url"),
                "url": metadata.get("url"),
                "published": metadata.get("published"),
                "image": metadata.get("image"),
                "country": metadata.get("country"),
                "bias": metadata.get("bias"),
                "credibility": metadata.get("credibility"),
                "chroma_id": result["chroma_id"],
            }
        article_data["retrieval_method"] = "semantic_vector_store"
        article_data["semantic_score"] = result["similarity_score"]
        article_data["semantic_distance"] = result["distance"]
        article_data["chroma_id"] = result["chroma_id"] or article_data.get("chroma_id")
        article_data["preview"] = result["preview"]
        semantic_articles.append(article_data)
    return semantic_articles


def _normalize_url(url: str | None) -> str | None:
    if not url or not isinstance(url, str):
        return None
    return url.rstrip("/")


class ArticleDeduper:
    """Dedupe and cap research articles by id and normalized url."""

    def __init__(self, max_total: int) -> None:
        """Initialize the deduplicator with the article cap."""
        self.max_total = max_total
        self.combined: list[dict[str, Any]] = []
        self._seen_ids: set[str] = set()
        self._seen_urls: set[str] = set()

    @property
    def is_full(self) -> bool:
        """True once the combined list has reached the cap."""
        return len(self.combined) >= self.max_total

    def add_bucket(self, bucket: list[dict[str, Any]]) -> None:
        """Add every non-duplicate article from one retrieval bucket."""
        for article in bucket:
            if self.is_full:
                return
            self.add_article(article)

    def add_article(self, article: dict[str, Any]) -> None:
        """Append one article unless it duplicates an already-seen id or url."""
        if not article:
            return
        payload = {**article}
        payload = self._add_defaults(article)

        article_id = payload.get("id") or payload.get("article_id")
        url_key = _normalize_url(payload.get("url") or payload.get("link"))

        id_key = str(article_id) if article_id is not None else None
        if id_key and id_key in self._seen_ids:
            return
        if url_key and url_key in self._seen_urls:
            return

        self.combined.append(payload)
        self._mark(id_key, url_key)

    def _add_defaults(self, article: dict[str, Any]) -> dict[str, Any]:
        """Copy an article payload with title/description/category defaults set."""
        payload = {**article}
        payload.setdefault("title", "Untitled article")
        payload.setdefault("description", payload.get("summary"))
        payload.setdefault("category", "general")
        return payload

    def _mark(self, id_key: str | None, url_key: str | None) -> None:
        """Record an appended article's keys as seen."""
        if id_key:
            self._seen_ids.add(id_key)
        if url_key:
            self._seen_urls.add(url_key)


def run_research_agent(
    query: str,
    articles: list[dict[str, Any]],
    verbose: bool = True,
    chat_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run Research Agent."""
    backend_path = str(Path(__file__).resolve().parent.parent)
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    from news_research_agent import research_news

    return research_news(query=query, articles=articles, verbose=verbose, chat_history=chat_history)


def stream_research_agent(
    query: str,
    articles: list[dict[str, Any]],
    chat_history: list[dict[str, Any]] | None = None,
    stop_event: threading.Event | None = None,
) -> Any:
    """Stream Research Agent."""
    backend_path = str(Path(__file__).resolve().parent.parent)
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    from news_research_agent import research_stream

    return research_stream(
        query=query,
        articles=articles,
        chat_history=chat_history,
        stop_event=stop_event,
    )
