from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime
from typing import Dict

from fastapi import APIRouter

from app.services.cache import news_cache
from app.services.rss_ingestion import refresh_news_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.post("/refresh")
async def manual_cache_refresh() -> Dict[str, str]:
    if news_cache.update_in_progress:
        return {"message": "Cache refresh already in progress", "status": "in_progress"}

    def _refresh() -> None:
        refresh_news_cache()

    threading.Thread(target=_refresh, daemon=True).start()
    return {"message": "Cache refresh started", "status": "started"}


@router.get("/status")
async def get_cache_status() -> Dict[str, object]:
    articles = news_cache.get_articles()
    source_stats = news_cache.get_source_stats()

    total_articles = len(articles)
    sources_with_articles = len(
        [s for s in source_stats if s.get("article_count", 0) > 0]
    )
    sources_with_errors = len([s for s in source_stats if s.get("status") == "error"])
    sources_with_warnings = len(
        [s for s in source_stats if s.get("status") == "warning"]
    )

    category_counts = defaultdict(int)
    for article in articles:
        category_counts[article.category] += 1

    cache_age = (datetime.now() - news_cache.last_updated).total_seconds()

    return {
        "last_updated": news_cache.last_updated.isoformat(),
        "update_in_progress": news_cache.update_in_progress,
        "total_articles": total_articles,
        "total_sources": len(source_stats),
        "sources_working": sources_with_articles,
        "sources_with_errors": sources_with_errors,
        "sources_with_warnings": sources_with_warnings,
        "category_breakdown": dict(category_counts),
        "cache_age_seconds": cache_age,
    }
