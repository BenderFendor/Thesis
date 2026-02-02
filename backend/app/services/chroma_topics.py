"""Chroma-native topic clustering for trending and similarity views.

Clusters are computed on-demand using Chroma similarity results. We use an
anchor article ID as the cluster identifier so existing clients can keep
stable IDs per response.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article, GDELTEvent, get_utc_now
from app.vector_store import get_vector_store

logger = get_logger("chroma_topics")

SIMILARITY_THRESHOLD = 0.82
MIN_CLUSTER_SIZE = 2
TRENDING_EXPANSION = 50
BREAKING_WINDOW_HOURS = 3
BREAKING_SPIKE_THRESHOLD = 2.0


@dataclass
class ClusterCandidate:
    anchor_id: int
    member_ids: List[int]
    similarities: Dict[int, float]


def _window_start(window: str) -> datetime:
    now = get_utc_now()
    if window == "1w":
        return now - timedelta(weeks=1)
    if window == "1m":
        return now - timedelta(days=30)
    return now - timedelta(days=1)


class ChromaTopicService:
    def __init__(self):
        self.vector_store = get_vector_store()

    async def get_trending_clusters(
        self, session: AsyncSession, window: str = "1d", limit: int = 10
    ) -> List[Dict[str, Any]]:
        if not self.vector_store:
            return []
        window_start = _window_start(window)
        article_rows = await self._fetch_recent_articles(
            session, window_start, limit * TRENDING_EXPANSION
        )
        clusters = await self._cluster_articles(article_rows)
        return await self._build_trending_clusters(
            session, clusters, window_start, limit
        )

    async def get_breaking_clusters(
        self, session: AsyncSession, limit: int = 5
    ) -> List[Dict[str, Any]]:
        if not self.vector_store:
            return []
        window_start = get_utc_now() - timedelta(hours=BREAKING_WINDOW_HOURS)
        article_rows = await self._fetch_recent_articles(
            session, window_start, limit * TRENDING_EXPANSION
        )
        clusters = await self._cluster_articles(article_rows)
        return await self._build_breaking_clusters(session, clusters, limit)

    async def get_all_clusters(
        self,
        session: AsyncSession,
        window: str = "1d",
        min_articles: int = MIN_CLUSTER_SIZE,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        if not self.vector_store:
            return []
        window_start = _window_start(window)
        article_rows = await self._fetch_recent_articles(
            session, window_start, limit * TRENDING_EXPANSION
        )
        clusters = await self._cluster_articles(article_rows)
        results = []
        for cluster in clusters:
            if len(cluster.member_ids) < min_articles:
                continue
            cluster_articles = await self._fetch_articles(session, cluster.member_ids)
            if not cluster_articles:
                continue
            representative = cluster_articles[cluster.anchor_id]
            results.append(
                {
                    "cluster_id": cluster.anchor_id,
                    "label": self._generate_cluster_label(cluster_articles),
                    "keywords": self._extract_keywords_from_articles(
                        list(cluster_articles.values())
                    ),
                    "article_count": len(cluster.member_ids),
                    "window_count": len(cluster.member_ids),
                    "source_diversity": len(
                        {a.source for a in cluster_articles.values() if a.source}
                    ),
                    "representative_article": self._serialize_article(representative),
                    "articles": self._serialize_recent_articles(cluster_articles),
                }
            )
            if len(results) >= limit:
                break
        return results

    async def get_cluster_detail(
        self, session: AsyncSession, cluster_id: int
    ) -> Optional[Dict[str, Any]]:
        if not self.vector_store:
            return None
        cluster = await self._build_cluster_from_anchor(cluster_id)
        if not cluster:
            return None
        cluster_articles = await self._fetch_articles(session, cluster.member_ids)
        if not cluster_articles:
            return None
        representative = cluster_articles.get(cluster.anchor_id)
        keywords = self._extract_keywords_from_articles(list(cluster_articles.values()))
        label = self._generate_cluster_label(cluster_articles)
        articles_payload = []
        for article_id in cluster.member_ids:
            article = cluster_articles.get(article_id)
            if not article:
                continue
            similarity = cluster.similarities.get(article_id)
            articles_payload.append(
                {
                    "id": article.id,
                    "title": article.title,
                    "source": article.source,
                    "url": article.url,
                    "image_url": article.image_url,
                    "published_at": article.published_at.isoformat()
                    if article.published_at
                    else None,
                    "similarity": round(similarity, 3)
                    if similarity is not None
                    else 0.0,
                }
            )
        return {
            "id": cluster.anchor_id,
            "label": label,
            "keywords": keywords,
            "article_count": len(cluster.member_ids),
            "first_seen": self._oldest_article_date(cluster_articles),
            "last_seen": self._latest_article_date(cluster_articles),
            "is_active": True,
            "articles": articles_payload,
        }

    async def get_article_topics(
        self, session: AsyncSession, article_id: int, limit: int = 5
    ) -> List[Dict[str, Any]]:
        if not self.vector_store:
            return []
        cluster = await self._build_cluster_from_anchor(article_id)
        if not cluster:
            return []
        cluster_articles = await self._fetch_articles(session, cluster.member_ids)
        if not cluster_articles:
            return []
        label = self._generate_cluster_label(cluster_articles)
        keywords = self._extract_keywords_from_articles(list(cluster_articles.values()))
        similarity = cluster.similarities.get(article_id, 1.0)
        return [
            {
                "cluster_id": cluster.anchor_id,
                "label": label,
                "similarity": round(similarity, 3),
                "keywords": keywords,
            }
        ][:limit]

    async def get_bulk_article_topics(
        self, session: AsyncSession, article_ids: Sequence[int]
    ) -> Dict[int, List[Dict[str, Any]]]:
        topics: Dict[int, List[Dict[str, Any]]] = {}
        for article_id in article_ids:
            topics[article_id] = await self.get_article_topics(session, article_id)
        return topics

    async def get_search_suggestions(
        self, query: str, limit: int = 5
    ) -> List[Dict[str, Any]]:
        if not self.vector_store:
            return []
        results = self.vector_store.search_similar(query, limit=limit * 2)
        suggestions = []
        for result in results:
            article_id = result.get("article_id")
            if not article_id:
                continue
            suggestions.append(
                {
                    "cluster_id": article_id,
                    "label": result.get("metadata", {}).get("title")
                    or result.get("preview", "")[:60],
                    "relevance": round(result.get("similarity_score", 0.0), 3),
                }
            )
            if len(suggestions) >= limit:
                break
        return suggestions

    async def get_trending_stats(self, session: AsyncSession) -> Dict[str, Any]:
        recent_count = await session.execute(
            select(func.count(Article.id)).where(
                Article.published_at >= get_utc_now() - timedelta(days=1)
            )
        )
        total_recent = recent_count.scalar() or 0
        return {
            "active_clusters": 0,
            "total_article_assignments": total_recent,
            "recent_spikes": 0,
            "similarity_threshold": SIMILARITY_THRESHOLD,
            "baseline_days": 0,
            "breaking_window_hours": BREAKING_WINDOW_HOURS,
        }

    async def get_cluster_external_count(
        self, session: AsyncSession, article_ids: Iterable[int]
    ) -> int:
        if not article_ids:
            return 0
        result = await session.execute(
            select(func.count(GDELTEvent.id)).where(
                GDELTEvent.article_id.in_(list(article_ids))
            )
        )
        return result.scalar() or 0

    async def _fetch_recent_articles(
        self, session: AsyncSession, since: datetime, limit: int
    ) -> List[Article]:
        result = await session.execute(
            select(Article)
            .where(and_(Article.published_at >= since, Article.embedding_generated))
            .order_by(Article.published_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def _cluster_articles(
        self, articles: Sequence[Article]
    ) -> List[ClusterCandidate]:
        if not articles:
            return []
        clusters: List[ClusterCandidate] = []
        seen: Set[int] = set()
        for article in articles:
            if article.id in seen:
                continue
            cluster = await self._build_cluster_from_anchor(article_id=article.id)
            if not cluster or len(cluster.member_ids) < MIN_CLUSTER_SIZE:
                seen.add(article.id)
                continue
            clusters.append(cluster)
            seen.update(cluster.member_ids)
        return clusters

    async def _build_cluster_from_anchor(
        self, article_id: int = 0
    ) -> Optional[ClusterCandidate]:
        if not self.vector_store:
            return None
        chroma_id = f"article_{article_id}"
        try:
            embedded = self.vector_store.collection.get(
                ids=[chroma_id], include=["embeddings"]
            )
            embeddings = embedded.get("embeddings") if embedded else None
            if not embeddings or not embeddings[0]:
                return None
            query_embedding = embeddings[0]
            result = self.vector_store.collection.query(
                query_embeddings=[query_embedding],
                n_results=TRENDING_EXPANSION,
                include=["distances", "metadatas"],
            )
        except Exception as exc:
            logger.warning("Failed to query cluster for %s: %s", article_id, exc)
            return None

        ids = result.get("ids", [[]])[0] if result else []
        distances = result.get("distances", [[]])[0] if result else []
        member_ids: List[int] = []
        similarities: Dict[int, float] = {}
        for chroma_id, distance in zip(ids, distances):
            if not chroma_id or not chroma_id.startswith("article_"):
                continue
            try:
                member_id = int(chroma_id.replace("article_", ""))
            except ValueError:
                continue
            similarity = 1 - distance if distance is not None else 0.0
            if similarity < SIMILARITY_THRESHOLD:
                continue
            member_ids.append(member_id)
            similarities[member_id] = similarity
        if article_id not in member_ids:
            member_ids.insert(0, article_id)
            similarities[article_id] = similarities.get(article_id, 1.0)
        if len(member_ids) < MIN_CLUSTER_SIZE:
            return None
        return ClusterCandidate(
            anchor_id=article_id, member_ids=member_ids, similarities=similarities
        )

    async def _fetch_articles(
        self, session: AsyncSession, article_ids: Sequence[int]
    ) -> Dict[int, Article]:
        if not article_ids:
            return {}
        result = await session.execute(
            select(Article).where(Article.id.in_(list(article_ids)))
        )
        articles = result.scalars().all()
        return {article.id: article for article in articles}

    async def _build_trending_clusters(
        self,
        session: AsyncSession,
        clusters: Sequence[ClusterCandidate],
        window_start: datetime,
        limit: int,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for cluster in clusters:
            cluster_articles = await self._fetch_articles(session, cluster.member_ids)
            if not cluster_articles:
                continue
            representative = cluster_articles.get(cluster.anchor_id)
            if not representative:
                continue
            window_count = len(
                [
                    a
                    for a in cluster_articles.values()
                    if a.published_at and a.published_at >= window_start
                ]
            )
            source_diversity = len(
                {a.source for a in cluster_articles.values() if a.source}
            )
            external_count = await self.get_cluster_external_count(
                session, cluster.member_ids
            )
            velocity = float(window_count)
            recency_bonus = self._recency_bonus(representative.published_at)
            external_bonus = 1 + (external_count * 0.05)
            trending_score = (
                velocity * (1 + source_diversity * 0.1) * recency_bonus * external_bonus
            )
            results.append(
                {
                    "cluster_id": cluster.anchor_id,
                    "label": self._generate_cluster_label(cluster_articles),
                    "keywords": self._extract_keywords_from_articles(
                        list(cluster_articles.values())
                    ),
                    "article_count": len(cluster.member_ids),
                    "window_count": window_count,
                    "source_diversity": source_diversity,
                    "trending_score": round(trending_score, 2),
                    "velocity": round(velocity, 2),
                    "representative_article": self._serialize_article(representative),
                    "articles": self._serialize_recent_articles(cluster_articles),
                }
            )
            if len(results) >= limit:
                break
        results.sort(key=lambda x: x["trending_score"], reverse=True)
        return results[:limit]

    async def _build_breaking_clusters(
        self,
        session: AsyncSession,
        clusters: Sequence[ClusterCandidate],
        limit: int,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        now = get_utc_now()
        window_start = now - timedelta(hours=BREAKING_WINDOW_HOURS)
        for cluster in clusters:
            cluster_articles = await self._fetch_articles(session, cluster.member_ids)
            if not cluster_articles:
                continue
            representative = cluster_articles.get(cluster.anchor_id)
            if not representative:
                continue
            window_count = len(
                [
                    a
                    for a in cluster_articles.values()
                    if a.published_at and a.published_at >= window_start
                ]
            )
            if window_count == 0:
                continue
            baseline = max(len(cluster.member_ids) / 7.0, 1.0)
            spike_magnitude = window_count / baseline
            if spike_magnitude < BREAKING_SPIKE_THRESHOLD:
                continue
            is_new_story = False
            if representative.published_at:
                age_hours = (now - representative.published_at).total_seconds() / 3600
                is_new_story = age_hours < 6
            results.append(
                {
                    "cluster_id": cluster.anchor_id,
                    "label": self._generate_cluster_label(cluster_articles),
                    "keywords": self._extract_keywords_from_articles(
                        list(cluster_articles.values())
                    ),
                    "article_count_3h": window_count,
                    "source_count_3h": len(
                        {a.source for a in cluster_articles.values() if a.source}
                    ),
                    "spike_magnitude": round(spike_magnitude, 2),
                    "is_new_story": is_new_story,
                    "representative_article": self._serialize_article(representative),
                    "articles": self._serialize_recent_articles(cluster_articles),
                }
            )
        results.sort(key=lambda x: x["spike_magnitude"], reverse=True)
        return results[:limit]

    def _serialize_article(self, article: Article) -> Dict[str, Any]:
        return {
            "id": article.id,
            "title": article.title,
            "source": article.source,
            "url": article.url,
            "image_url": article.image_url,
            "published_at": article.published_at.isoformat()
            if article.published_at
            else None,
            "summary": article.summary[:200] if article.summary else None,
        }

    def _serialize_recent_articles(
        self, articles: Dict[int, Article], limit: int = 5
    ) -> List[Dict[str, Any]]:
        ordered = sorted(
            articles.values(),
            key=lambda a: a.published_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        return [self._serialize_article(article) for article in ordered[:limit]]

    def _generate_cluster_label(self, articles: Dict[int, Article]) -> str:
        """Select the best article title to represent the cluster.

        Scores titles based on length, credibility, recency, and content quality.
        Returns the highest-scoring title or falls back to anchor article title.
        """
        if not articles:
            return "Topic"

        def score_title(article: Article) -> float:
            if not article.title:
                return 0.0

            title = article.title.strip()
            score = 0.0

            # Length score: ideal is 40-100 chars
            length = len(title)
            if 40 <= length <= 100:
                score += 10.0
            elif 30 <= length < 40:
                score += 7.0
            elif 100 < length <= 140:
                score += 6.0
            elif length < 30:
                score += 3.0
            else:
                score += 1.0

            # Credibility bonus
            if article.credibility == "high":
                score += 5.0
            elif article.credibility == "medium":
                score += 2.0

            # Recency bonus (prefer articles from last 24h)
            if article.published_at:
                age_hours = (
                    get_utc_now() - article.published_at
                ).total_seconds() / 3600
                if age_hours < 6:
                    score += 3.0
                elif age_hours < 24:
                    score += 2.0
                elif age_hours < 72:
                    score += 1.0

            # Penalize generic/low-value titles
            title_lower = title.lower()
            generic_terms = ["breaking", "update", "news alert", "developing"]
            for term in generic_terms:
                if term in title_lower:
                    score -= 5.0

            # Bonus for named entities (capitalized words suggest proper nouns)
            import re

            capitalized = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b", title)
            score += min(len(capitalized) * 1.5, 8.0)

            return score

        # Score all articles and pick the best
        scored_articles = [
            (article, score_title(article)) for article in articles.values()
        ]
        scored_articles.sort(key=lambda x: x[1], reverse=True)

        # Return best title if we have one with decent score, else fallback
        if scored_articles and scored_articles[0][1] > 5.0:
            return scored_articles[0][0].title

        # Fallback: try to find any valid title
        for article in articles.values():
            if article.title and len(article.title.strip()) > 10:
                return article.title.strip()

        return "Topic"

    def _extract_keywords(self, article: Article) -> List[str]:
        text = f"{article.title or ''} {article.summary or ''}".lower()
        stopwords = {
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
        }
        words = [w.strip(".,!?;:'\"") for w in text.split() if len(w) > 3]
        return list({w for w in words if w not in stopwords})[:10]

    def _extract_keywords_from_articles(self, articles: List[Article]) -> List[str]:
        keywords: List[str] = []
        for article in articles:
            keywords.extend(self._extract_keywords(article))
        return list(dict.fromkeys(keywords))[:10]

    def _recency_bonus(self, published_at: Optional[datetime]) -> float:
        if not published_at:
            return 1.0
        now = get_utc_now()
        age_hours = (now - published_at).total_seconds() / 3600
        if age_hours < 24:
            return 1.5
        if age_hours < 72:
            return 1.2
        return 1.0

    def _latest_article_date(self, articles: Dict[int, Article]) -> Optional[str]:
        dates = [a.published_at for a in articles.values() if a.published_at]
        if not dates:
            return None
        return max(dates).isoformat()

    def _oldest_article_date(self, articles: Dict[int, Article]) -> Optional[str]:
        dates = [a.published_at for a in articles.values() if a.published_at]
        if not dates:
            return None
        return min(dates).isoformat()
