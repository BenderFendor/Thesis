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
        self.articles_by_source: Dict[str, List[NewsArticle]] = {}
        self.source_stats: List[Dict[str, object]] = []
        self.source_stats_by_name: Dict[str, Dict[str, object]] = {}
        self.last_updated: datetime = datetime.now(timezone.utc)
        self.lock = threading.Lock()
        self.update_in_progress: bool = False
        self.update_count: int = 0

    def _published_key(self, article: NewsArticle) -> str:
        return article.published or ""

    def get_articles(self) -> List[NewsArticle]:
        with self.lock:
            logger.debug("Cache accessed: %s articles available", len(self.articles))
            return self.articles.copy()

    def get_source_stats(self) -> List[Dict[str, object]]:
        with self.lock:
            logger.debug("Source stats accessed: %s sources", len(self.source_stats))
            return self.source_stats.copy()

    def update_cache(
        self, articles: List[NewsArticle], source_stats: List[Dict[str, object]]
    ) -> None:
        with self.lock:
            old_count = len(self.articles)
            self.articles = articles
            self.source_stats = source_stats
            self.articles_by_source = {}
            for article in articles:
                self.articles_by_source.setdefault(article.source, []).append(article)
            self.source_stats_by_name = {
                stat.get("name"): stat for stat in source_stats if stat.get("name")
            }
            self.last_updated = datetime.now(timezone.utc)
            self.update_in_progress = False
            self.update_count += 1

            logger.info(
                "Cache updated #%s: %s -> %s articles from %s sources",
                self.update_count,
                old_count,
                len(articles),
                len(source_stats),
            )

            working_sources = [s for s in source_stats if s.get("status") == "success"]
            error_sources = [s for s in source_stats if s.get("status") == "error"]
            logger.info(
                "Cache health: %s working, %s error sources",
                len(working_sources),
                len(error_sources),
            )

    def update_source_cache(
        self,
        articles: List[NewsArticle],
        source_stat: Dict[str, object],
        replace_articles: bool = True,
    ) -> None:
        source_name = source_stat.get("name") or (
            articles[0].source if articles else None
        )
        if not source_name:
            return

        with self.lock:
            existing_articles = self.articles
            if replace_articles:
                retained = [a for a in existing_articles if a.source != source_name]
                new_articles = sorted(
                    articles,
                    key=self._published_key,
                    reverse=True,
                )
                merged: List[NewsArticle] = []
                i = 0
                j = 0
                while i < len(retained) and j < len(new_articles):
                    if self._published_key(retained[i]) >= self._published_key(
                        new_articles[j]
                    ):
                        merged.append(retained[i])
                        i += 1
                    else:
                        merged.append(new_articles[j])
                        j += 1
                if i < len(retained):
                    merged.extend(retained[i:])
                if j < len(new_articles):
                    merged.extend(new_articles[j:])

                self.articles = merged
                self.articles_by_source[source_name] = new_articles

            if source_name:
                self.source_stats_by_name[source_name] = source_stat
                self.source_stats = list(self.source_stats_by_name.values())

            self.last_updated = datetime.now(timezone.utc)
            self.update_count += 1


news_cache = NewsCache()
