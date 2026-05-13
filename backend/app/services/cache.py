"""Cache."""

from __future__ import annotations

import threading
from collections import defaultdict
from datetime import datetime, UTC

from app.core.config import settings
from app.core.logging import get_logger
from app.models.news import NewsArticle

logger = get_logger("news_cache")


class NewsCache:
    """News Cache."""

    def __init__(self) -> None:
        """Initialize."""
        self.articles: list[NewsArticle] = []
        self.articles_by_source: dict[str, list[NewsArticle]] = {}
        self.source_stats: list[dict[str, object]] = []
        self.source_stats_by_name: dict[str, dict[str, object]] = {}
        self.last_updated: datetime = datetime.now(UTC)
        self.lock = threading.Lock()
        self.update_in_progress: bool = False
        self.update_count: int = 0

    def _assert_invariants(self) -> None:
        assert self.update_count >= 0, "update_count must be non-negative"
        assert isinstance(self.articles, list), "articles must remain a list"
        assert isinstance(self.source_stats, list), "source_stats must remain a list"
        assert isinstance(self.articles_by_source, dict), "articles_by_source must remain a dict"

    def _published_key(self, article: NewsArticle) -> str:
        return article.published or ""

    def _shape_articles(self, articles: list[NewsArticle]) -> list[NewsArticle]:
        max_articles = settings.news_cache_max_articles
        max_per_source = settings.news_cache_max_per_source

        if not articles:
            return []

        grouped: dict[str, list[NewsArticle]] = defaultdict(list)
        for article in sorted(articles, key=self._published_key, reverse=True):
            grouped[article.source].append(article)

        trimmed_groups = {
            source: (source_articles[:max_per_source] if max_per_source > 0 else source_articles)
            for source, source_articles in grouped.items()
            if source_articles
        }

        source_order = sorted(
            trimmed_groups.keys(),
            key=lambda source: self._published_key(trimmed_groups[source][0]),
            reverse=True,
        )

        shaped: list[NewsArticle] = []
        round_index = 0
        while max_articles <= 0 or len(shaped) < max_articles:
            appended = False
            for source in source_order:
                source_articles = trimmed_groups[source]
                if round_index >= len(source_articles):
                    continue
                shaped.append(source_articles[round_index])
                appended = True
                if max_articles > 0 and len(shaped) >= max_articles:
                    break
            if not appended:
                break
            round_index += 1

        return shaped

    def _rebuild_source_index(self) -> None:
        self.articles_by_source = {}
        for article in self.articles:
            self.articles_by_source.setdefault(article.source, []).append(article)

    def get_articles(self) -> list[NewsArticle]:
        """Get Articles."""
        with self.lock:
            self._assert_invariants()
            logger.debug("Cache accessed: %s articles available", len(self.articles))
            snapshot = self.articles.copy()
            assert snapshot is not self.articles, "get_articles must return a copy"
            return snapshot

    def get_source_stats(self) -> list[dict[str, object]]:
        """Get Source Stats."""
        with self.lock:
            self._assert_invariants()
            logger.debug("Source stats accessed: %s sources", len(self.source_stats))
            snapshot = self.source_stats.copy()
            assert snapshot is not self.source_stats, "get_source_stats must return a copy"
            return snapshot

    def get_source_stat(self, source_name: str) -> dict[str, object] | None:
        """Get Source Stat."""
        with self.lock:
            stat = self.source_stats_by_name.get(source_name)
            if stat is None:
                return None
            return dict(stat)

    def get_articles_for_source(self, source_name: str) -> list[NewsArticle]:
        """Get Articles For Source."""
        with self.lock:
            return list(self.articles_by_source.get(source_name, []))

    def update_cache(
        self, articles: list[NewsArticle], source_stats: list[dict[str, object]]
    ) -> None:
        """Update Cache."""
        assert isinstance(articles, list), "update_cache requires list articles"
        assert isinstance(source_stats, list), "update_cache requires list source_stats"
        with self.lock:
            old_count = len(self.articles)
            self.articles = self._shape_articles(articles)
            self.source_stats = source_stats
            self._rebuild_source_index()
            self.source_stats_by_name = {}
            for stat in source_stats:
                stat_name = stat.get("name")
                if isinstance(stat_name, str) and stat_name:
                    self.source_stats_by_name[stat_name] = stat
            self.last_updated = datetime.now(UTC)
            self.update_in_progress = False
            self.update_count += 1

            logger.info(
                "Cache updated #%s: %s -> %s cached articles (%s raw) from %s sources",
                self.update_count,
                old_count,
                len(self.articles),
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
            self._assert_invariants()
            assert len(self.articles) <= len(articles), (
                "update_cache must not exceed raw article count"
            )

    def update_source_cache(
        self,
        articles: list[NewsArticle],
        source_stat: dict[str, object],
        replace_articles: bool = True,
    ) -> None:
        """Update Source Cache."""
        source_name = source_stat.get("name") or (articles[0].source if articles else None)
        if not source_name:
            return

        assert isinstance(source_name, str), "source_name must be a string"
        with self.lock:
            existing_articles = self.articles
            if replace_articles:
                retained = [a for a in existing_articles if a.source != source_name]
                new_articles = sorted(
                    articles,
                    key=self._published_key,
                    reverse=True,
                )
                merged: list[NewsArticle] = []
                i = 0
                j = 0
                while i < len(retained) and j < len(new_articles):
                    if self._published_key(retained[i]) >= self._published_key(new_articles[j]):
                        merged.append(retained[i])
                        i += 1
                    else:
                        merged.append(new_articles[j])
                        j += 1
                if i < len(retained):
                    merged.extend(retained[i:])
                if j < len(new_articles):
                    merged.extend(new_articles[j:])

                self.articles = self._shape_articles(merged)
                self._rebuild_source_index()

            if source_name:
                self.source_stats_by_name[source_name] = source_stat
                self.source_stats = list(self.source_stats_by_name.values())

            self.last_updated = datetime.now(UTC)
            self.update_count += 1
            self._assert_invariants()


news_cache = NewsCache()
