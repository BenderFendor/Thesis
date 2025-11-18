from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.database import (
    AsyncSessionLocal,
    fetch_articles_by_ids,
    fetch_recent_articles,
    search_articles_by_keyword,
)
from app.vector_store import get_vector_store

logger = get_logger("news_research")


async def load_articles_for_research(
    query: str,
    semantic_limit: int = 20,
    keyword_limit: int = 50,
    recent_limit: int = 40,
    max_total: int = 150,
) -> Dict[str, Any]:
    db_enabled = settings.enable_database and AsyncSessionLocal is not None

    vector_store = get_vector_store()
    semantic_results: List[Dict[str, Any]] = []
    if vector_store and query:
        try:
            semantic_results = vector_store.search_similar(query, limit=semantic_limit)
        except Exception as semantic_error:  # pragma: no cover - defensive logging
            logger.error("Semantic vector search failed: %s", semantic_error)
            semantic_results = []

    keyword_articles_raw: List[Dict[str, Any]] = []
    recent_articles_raw: List[Dict[str, Any]] = []
    fetched_lookup: Dict[int, Dict[str, Any]] = {}

    if db_enabled:
        async with AsyncSessionLocal() as session:
            if query:
                keyword_articles_raw = await search_articles_by_keyword(
                    session, query=query, limit=keyword_limit
                )

            article_ids = [
                result.get("article_id")
                for result in semantic_results
                if isinstance(result.get("article_id"), int)
            ]
            if article_ids:
                fetched_articles = await fetch_articles_by_ids(session, article_ids)
                fetched_lookup = {article["id"]: article for article in fetched_articles}

            need_recent = len(keyword_articles_raw) < max(10, keyword_limit // 2)
            if need_recent:
                recent_articles_raw = await fetch_recent_articles(
                    session, limit=recent_limit
                )
    else:
        logger.info("Skipping database-backed search; ENABLE_DATABASE=0")

    keyword_articles = [
        {**article, "retrieval_method": "keyword_postgres"}
        for article in keyword_articles_raw
    ]

    semantic_articles: List[Dict[str, Any]] = []
    if semantic_results:
        for result in semantic_results:
            article_id = result.get("article_id")
            if isinstance(article_id, int) and article_id in fetched_lookup:
                article_data = {**fetched_lookup[article_id]}
            else:
                metadata = result.get("metadata", {})
                article_data = {
                    "id": article_id,
                    "title": metadata.get("title")
                    or metadata.get("url")
                    or "Semantic match",
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
                    "chroma_id": result.get("chroma_id"),
                }
            article_data["retrieval_method"] = "semantic_vector_store"
            article_data["semantic_score"] = result.get("similarity_score")
            article_data["semantic_distance"] = result.get("distance")
            article_data["chroma_id"] = result.get("chroma_id") or article_data.get(
                "chroma_id"
            )
            article_data["preview"] = result.get("preview")
            semantic_articles.append(article_data)

    semantic_count = len(semantic_articles)

    need_recent = len(keyword_articles) < max(10, keyword_limit // 2)
    recent_articles = [
        {**article, "retrieval_method": "recent_postgres"}
        for article in recent_articles_raw
    ] if need_recent and recent_articles_raw else []

    combined: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()

    def _normalize_url(url: Optional[str]) -> Optional[str]:
        if not url or not isinstance(url, str):
            return None
        return url.rstrip("/")

    def _add_articles(bucket: List[Dict[str, Any]]) -> None:
        for article in bucket:
            if not article:
                continue
            payload = {**article}
            payload.setdefault("title", "Untitled article")
            payload.setdefault("description", payload.get("summary"))
            payload.setdefault("category", "general")

            article_id = payload.get("id") or payload.get("article_id")
            url_key = _normalize_url(payload.get("url") or payload.get("link"))

            id_key = str(article_id) if article_id is not None else None
            if id_key and id_key in seen_ids:
                continue
            if url_key and url_key in seen_urls:
                continue

            combined.append(payload)

            if id_key:
                seen_ids.add(id_key)
            if url_key:
                seen_urls.add(url_key)

            if len(combined) >= max_total:
                return

    _add_articles(semantic_articles)
    if len(combined) < max_total:
        _add_articles(keyword_articles)
    if len(combined) < max_total:
        _add_articles(recent_articles)

    summary = {
        "keyword_count": len(keyword_articles),
        "semantic_count": semantic_count,
        "recent_count": len(recent_articles),
        "total": len(combined),
        "vector_enabled": bool(vector_store),
    }

    return {"articles": combined, "summary": summary}


def run_research_agent(
    query: str,
    articles: List[Dict[str, Any]],
    verbose: bool = True,
    chat_history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    from news_research_agent import research_news  # type: ignore[import-not-found]

    return research_news(
        query=query, articles=articles, verbose=verbose, chat_history=chat_history
    )
