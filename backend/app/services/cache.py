from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Dict, List

from app.core.logging import get_logger
from app.models.news import NewsArticle

logger = get_logger("news_cache")


class NewsCache:
    def __init__(self) -> None:
        self.articles: List[NewsArticle] = []
        self.source_stats: List[Dict[str, object]] = []
        self.last_updated: datetime = datetime.now(timezone.utc)
        self.lock = threading.Lock()
        self.update_in_progress: bool = False
        self.update_count: int = 0

    def get_articles(self) -> List[NewsArticle]:
        with self.lock:
            logger.debug("📋 Cache accessed: %s articles available", len(self.articles))
            return self.articles.copy()

    def get_source_stats(self) -> List[Dict[str, object]]:
        with self.lock:
            logger.debug("📊 Source stats accessed: %s sources", len(self.source_stats))
            return self.source_stats.copy()

    def update_cache(
        self, articles: List[NewsArticle], source_stats: List[Dict[str, object]]
    ) -> None:
        with self.lock:
            old_count = len(self.articles)
            self.articles = articles
            self.source_stats = source_stats
            self.last_updated = datetime.now(timezone.utc)
            self.update_in_progress = False
            self.update_count += 1

            logger.info(
                "🔄 Cache updated #%s: %s -> %s articles from %s sources",
                self.update_count,
                old_count,
                len(articles),
                len(source_stats),
            )

            working_sources = [s for s in source_stats if s.get("status") == "success"]
            error_sources = [s for s in source_stats if s.get("status") == "error"]
            logger.info(
                "📊 Cache health: %s working, %s error sources",
                len(working_sources),
                len(error_sources),
            )


news_cache = NewsCache()
