"""
Topic clustering and trending/breaking detection service.

Uses existing Chroma embeddings to cluster articles into topics,
then tracks velocity to detect trending and breaking stories.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy import select, func, and_, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import (
    Article,
    TopicCluster,
    ArticleTopic,
    ClusterStatsDaily,
    ClusterStatsHourly,
    get_utc_now,
)
from app.vector_store import get_vector_store

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 0.75
MIN_CLUSTER_SIZE = 2
BASELINE_DAYS = 7
BREAKING_WINDOW_HOURS = 3
SPIKE_THRESHOLD = 2.0


class ClusteringService:
    def __init__(self):
        self.vector_store = get_vector_store()
        if self.vector_store:
            self.embedding_model = self.vector_store.embedding_model
        else:
            self.embedding_model = None

    async def assign_article_to_cluster(
        self, session: AsyncSession, article: Article
    ) -> Optional[int]:
        """Assign an article to an existing cluster or create a new one."""
        if not self.vector_store or not article.chroma_id:
            return None

        try:
            existing = await session.execute(
                select(ArticleTopic).where(ArticleTopic.article_id == article.id)
            )
            if existing.scalar_one_or_none():
                return None

            results = self.vector_store.collection.get(
                ids=[article.chroma_id],
                include=["embeddings"],
            )

            embeddings = results.get("embeddings")
            if embeddings is None or len(embeddings) == 0:
                logger.debug(
                    "No embeddings found for article %d (chroma_id=%s)",
                    article.id,
                    article.chroma_id,
                )
                return None
            first_embedding = embeddings[0]
            if first_embedding is None or (
                hasattr(first_embedding, "__len__") and len(first_embedding) == 0
            ):
                logger.debug(
                    "Empty embedding for article %d (chroma_id=%s)",
                    article.id,
                    article.chroma_id,
                )
                return None

            article_embedding = np.array(first_embedding)

            active_clusters = await session.execute(
                select(TopicCluster).where(TopicCluster.is_active == True)
            )
            clusters = active_clusters.scalars().all()

            best_cluster_id = None
            best_similarity = 0.0

            for cluster in clusters:
                if not cluster.centroid_article_id:
                    continue

                centroid_article = await session.execute(
                    select(Article).where(Article.id == cluster.centroid_article_id)
                )
                centroid_article = centroid_article.scalar_one_or_none()
                if not centroid_article or not centroid_article.chroma_id:
                    continue

                centroid_results = self.vector_store.collection.get(
                    ids=[centroid_article.chroma_id],
                    include=["embeddings"],
                )

                centroid_embeddings = centroid_results.get("embeddings")
                if centroid_embeddings is None or len(centroid_embeddings) == 0:
                    continue
                centroid_first = centroid_embeddings[0]
                if centroid_first is None or (
                    hasattr(centroid_first, "__len__") and len(centroid_first) == 0
                ):
                    continue

                centroid_embedding = np.array(centroid_first)
                similarity = float(np.dot(article_embedding, centroid_embedding))

                if similarity > best_similarity:
                    best_similarity = similarity
                    best_cluster_id = cluster.id

            if best_cluster_id and best_similarity >= SIMILARITY_THRESHOLD:
                article_topic = ArticleTopic(
                    article_id=article.id,
                    cluster_id=best_cluster_id,
                    similarity=best_similarity,
                )
                session.add(article_topic)

                await session.execute(
                    update(TopicCluster)
                    .where(TopicCluster.id == best_cluster_id)
                    .values(
                        article_count=TopicCluster.article_count + 1,
                        last_seen=get_utc_now(),
                    )
                )
                logger.debug(
                    "Assigned article %d to cluster %d (similarity=%.3f)",
                    article.id,
                    best_cluster_id,
                    best_similarity,
                )
                return best_cluster_id

            new_cluster = TopicCluster(
                centroid_article_id=article.id,
                article_count=1,
                first_seen=article.published_at or get_utc_now(),
                last_seen=article.published_at or get_utc_now(),
            )
            session.add(new_cluster)
            await session.flush()

            article_topic = ArticleTopic(
                article_id=article.id,
                cluster_id=new_cluster.id,
                similarity=1.0,
            )
            session.add(article_topic)

            logger.debug(
                "Created new cluster %d for article %d", new_cluster.id, article.id
            )
            return new_cluster.id

        except Exception as e:
            logger.error("Failed to assign article to cluster: %s", e, exc_info=True)
            return None

    async def update_cluster_stats(self, session: AsyncSession) -> Dict[str, int]:
        """Update daily and hourly stats for all active clusters."""
        now = get_utc_now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        current_hour = now.replace(minute=0, second=0, microsecond=0)

        stats = {"daily_updated": 0, "hourly_updated": 0}

        active_clusters = await session.execute(
            select(TopicCluster.id).where(TopicCluster.is_active == True)
        )
        cluster_ids = [row[0] for row in active_clusters.all()]

        for cluster_id in cluster_ids:
            daily_count = await session.execute(
                select(func.count(ArticleTopic.id))
                .select_from(ArticleTopic)
                .join(Article, Article.id == ArticleTopic.article_id)
                .where(
                    and_(
                        ArticleTopic.cluster_id == cluster_id,
                        Article.published_at >= today,
                    )
                )
            )
            daily_article_count = daily_count.scalar() or 0

            daily_sources = await session.execute(
                select(func.count(func.distinct(Article.source)))
                .select_from(ArticleTopic)
                .join(Article, Article.id == ArticleTopic.article_id)
                .where(
                    and_(
                        ArticleTopic.cluster_id == cluster_id,
                        Article.published_at >= today,
                    )
                )
            )
            daily_source_count = daily_sources.scalar() or 0

            existing_daily = await session.execute(
                select(ClusterStatsDaily).where(
                    and_(
                        ClusterStatsDaily.cluster_id == cluster_id,
                        ClusterStatsDaily.date == today,
                    )
                )
            )
            daily_stat = existing_daily.scalar_one_or_none()

            if daily_stat:
                daily_stat.article_count = daily_article_count
                daily_stat.source_count = daily_source_count
            else:
                daily_stat = ClusterStatsDaily(
                    cluster_id=cluster_id,
                    date=today,
                    article_count=daily_article_count,
                    source_count=daily_source_count,
                )
                session.add(daily_stat)
            stats["daily_updated"] += 1

            hour_start = current_hour - timedelta(hours=BREAKING_WINDOW_HOURS)
            hourly_count = await session.execute(
                select(func.count(ArticleTopic.id))
                .select_from(ArticleTopic)
                .join(Article, Article.id == ArticleTopic.article_id)
                .where(
                    and_(
                        ArticleTopic.cluster_id == cluster_id,
                        Article.published_at >= hour_start,
                    )
                )
            )
            hourly_article_count = hourly_count.scalar() or 0

            hourly_sources = await session.execute(
                select(func.count(func.distinct(Article.source)))
                .select_from(ArticleTopic)
                .join(Article, Article.id == ArticleTopic.article_id)
                .where(
                    and_(
                        ArticleTopic.cluster_id == cluster_id,
                        Article.published_at >= hour_start,
                    )
                )
            )
            hourly_source_count = hourly_sources.scalar() or 0

            baseline = await self._get_hourly_baseline(session, cluster_id)
            is_spike = False
            spike_magnitude = 0.0

            if baseline > 0 and hourly_article_count > baseline * SPIKE_THRESHOLD:
                is_spike = True
                spike_magnitude = hourly_article_count / baseline

            existing_hourly = await session.execute(
                select(ClusterStatsHourly).where(
                    and_(
                        ClusterStatsHourly.cluster_id == cluster_id,
                        ClusterStatsHourly.hour == current_hour,
                    )
                )
            )
            hourly_stat = existing_hourly.scalar_one_or_none()

            if hourly_stat:
                hourly_stat.article_count = hourly_article_count
                hourly_stat.source_count = hourly_source_count
                hourly_stat.is_spike = is_spike
                hourly_stat.spike_magnitude = spike_magnitude
            else:
                hourly_stat = ClusterStatsHourly(
                    cluster_id=cluster_id,
                    hour=current_hour,
                    article_count=hourly_article_count,
                    source_count=hourly_source_count,
                    is_spike=is_spike,
                    spike_magnitude=spike_magnitude,
                )
                session.add(hourly_stat)
            stats["hourly_updated"] += 1

        return stats

    async def _get_hourly_baseline(
        self, session: AsyncSession, cluster_id: int
    ) -> float:
        """Get average hourly article count over the baseline period."""
        now = get_utc_now()
        baseline_start = now - timedelta(days=BASELINE_DAYS)

        result = await session.execute(
            select(func.avg(ClusterStatsHourly.article_count)).where(
                and_(
                    ClusterStatsHourly.cluster_id == cluster_id,
                    ClusterStatsHourly.hour >= baseline_start,
                    ClusterStatsHourly.hour
                    < now - timedelta(hours=BREAKING_WINDOW_HOURS),
                )
            )
        )
        return result.scalar() or 0.0

    async def _get_daily_baseline(
        self, session: AsyncSession, cluster_id: int
    ) -> float:
        """Get average daily article count over the baseline period."""
        now = get_utc_now()
        baseline_start = now - timedelta(days=BASELINE_DAYS)

        result = await session.execute(
            select(func.avg(ClusterStatsDaily.article_count)).where(
                and_(
                    ClusterStatsDaily.cluster_id == cluster_id,
                    ClusterStatsDaily.date >= baseline_start,
                    ClusterStatsDaily.date
                    < now.replace(hour=0, minute=0, second=0, microsecond=0),
                )
            )
        )
        return result.scalar() or 0.0

    async def get_trending_clusters(
        self,
        session: AsyncSession,
        window: str = "1d",
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Get top trending clusters based on velocity and diversity."""
        now = get_utc_now()

        if window == "1d":
            window_start = now - timedelta(days=1)
        elif window == "1w":
            window_start = now - timedelta(weeks=1)
        elif window == "1m":
            window_start = now - timedelta(days=30)
        else:
            window_start = now - timedelta(days=1)

        cluster_scores = await session.execute(
            select(
                TopicCluster.id,
                TopicCluster.label,
                TopicCluster.keywords,
                TopicCluster.centroid_article_id,
                TopicCluster.first_seen,
                TopicCluster.article_count,
                func.count(ArticleTopic.id).label("window_count"),
                func.count(func.distinct(Article.source)).label("source_diversity"),
            )
            .select_from(TopicCluster)
            .join(ArticleTopic, ArticleTopic.cluster_id == TopicCluster.id)
            .join(Article, Article.id == ArticleTopic.article_id)
            .where(
                and_(
                    TopicCluster.is_active == True,
                    Article.published_at >= window_start,
                )
            )
            .group_by(TopicCluster.id)
            .having(func.count(ArticleTopic.id) >= MIN_CLUSTER_SIZE)
            .order_by(func.count(ArticleTopic.id).desc())
            .limit(limit * 2)
        )

        results = []
        for row in cluster_scores.all():
            cluster_id = row[0]
            baseline = await self._get_daily_baseline(session, cluster_id)
            window_count = row[6]
            source_diversity = row[7]

            if baseline > 0:
                velocity = float(window_count / baseline)
            else:
                velocity = float(window_count * 2.0)

            recency_bonus = 1.0
            first_seen = row[4]
            if first_seen:
                age_hours = (now - first_seen).total_seconds() / 3600
                if age_hours < 24:
                    recency_bonus = 1.5
                elif age_hours < 72:
                    recency_bonus = 1.2

            trending_score = velocity * (1 + source_diversity * 0.1) * recency_bonus

            representative = await self._get_representative_article(
                session, cluster_id, window_start
            )

            results.append(
                {
                    "cluster_id": cluster_id,
                    "label": row[1],
                    "keywords": row[2] or [],
                    "article_count": row[5],
                    "window_count": window_count,
                    "source_diversity": source_diversity,
                    "trending_score": round(trending_score, 2),
                    "velocity": round(velocity, 2),
                    "representative_article": representative,
                }
            )

        results.sort(key=lambda x: x["trending_score"], reverse=True)
        return results[:limit]

    async def get_breaking_clusters(
        self,
        session: AsyncSession,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Get clusters showing breaking news patterns (3h spikes)."""
        now = get_utc_now()
        current_hour = now.replace(minute=0, second=0, microsecond=0)
        window_start = current_hour - timedelta(hours=BREAKING_WINDOW_HOURS)

        spike_clusters = await session.execute(
            select(
                ClusterStatsHourly.cluster_id,
                ClusterStatsHourly.article_count,
                ClusterStatsHourly.source_count,
                ClusterStatsHourly.spike_magnitude,
                TopicCluster.label,
                TopicCluster.keywords,
                TopicCluster.first_seen,
            )
            .join(TopicCluster, TopicCluster.id == ClusterStatsHourly.cluster_id)
            .where(
                and_(
                    ClusterStatsHourly.is_spike == True,
                    ClusterStatsHourly.hour >= window_start,
                    TopicCluster.is_active == True,
                )
            )
            .order_by(ClusterStatsHourly.spike_magnitude.desc())
            .limit(limit)
        )

        results = []
        for row in spike_clusters.all():
            cluster_id = row[0]
            representative = await self._get_representative_article(
                session, cluster_id, window_start
            )

            is_new_story = False
            first_seen = row[6]
            if first_seen:
                age_hours = (now - first_seen).total_seconds() / 3600
                is_new_story = age_hours < 6

            results.append(
                {
                    "cluster_id": cluster_id,
                    "label": row[4],
                    "keywords": row[5] or [],
                    "article_count_3h": row[1],
                    "source_count_3h": row[2],
                    "spike_magnitude": round(row[3], 2),
                    "is_new_story": is_new_story,
                    "representative_article": representative,
                }
            )

        return results

    async def get_all_clusters(
        self,
        session: AsyncSession,
        window: str = "1d",
        min_articles: int = 2,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Get all active clusters within a time window for topic-based view."""
        now = get_utc_now()

        if window == "1d":
            window_start = now - timedelta(days=1)
        elif window == "1w":
            window_start = now - timedelta(weeks=1)
        elif window == "1m":
            window_start = now - timedelta(days=30)
        else:
            window_start = now - timedelta(days=1)

        clusters_query = await session.execute(
            select(
                TopicCluster.id,
                TopicCluster.label,
                TopicCluster.keywords,
                TopicCluster.centroid_article_id,
                TopicCluster.first_seen,
                TopicCluster.article_count,
                func.count(ArticleTopic.id).label("window_count"),
                func.count(func.distinct(Article.source)).label("source_diversity"),
            )
            .select_from(TopicCluster)
            .join(ArticleTopic, ArticleTopic.cluster_id == TopicCluster.id)
            .join(Article, Article.id == ArticleTopic.article_id)
            .where(
                and_(
                    TopicCluster.is_active == True,
                    Article.published_at >= window_start,
                )
            )
            .group_by(TopicCluster.id)
            .having(func.count(ArticleTopic.id) >= min_articles)
            .order_by(TopicCluster.last_seen.desc())
            .limit(limit)
        )

        results = []
        for row in clusters_query.all():
            cluster_id = row[0]
            representative = await self._get_representative_article(
                session, cluster_id, window_start
            )

            results.append(
                {
                    "cluster_id": cluster_id,
                    "label": row[1],
                    "keywords": row[2] or [],
                    "article_count": row[5],
                    "window_count": row[6],
                    "source_diversity": row[7],
                    "last_seen": row[4].isoformat() if row[4] else None,
                    "representative_article": representative,
                }
            )

        return results

    async def _get_representative_article(
        self,
        session: AsyncSession,
        cluster_id: int,
        since: Optional[datetime] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get the best representative article for a cluster, with best available image."""
        query = (
            select(Article)
            .join(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(ArticleTopic.cluster_id == cluster_id)
            .order_by(ArticleTopic.similarity.desc(), Article.published_at.desc())
        )

        if since:
            query = query.where(Article.published_at >= since)

        result = await session.execute(query.limit(1))
        article = result.scalar_one_or_none()

        if not article:
            return None

        best_image = await self._get_best_cluster_image(session, cluster_id, since)

        return {
            "id": article.id,
            "title": article.title,
            "source": article.source,
            "url": article.url,
            "image_url": best_image or article.image_url,
            "published_at": article.published_at.isoformat()
            if article.published_at
            else None,
            "summary": article.summary[:200] if article.summary else None,
        }

    async def _get_best_cluster_image(
        self,
        session: AsyncSession,
        cluster_id: int,
        since: Optional[datetime] = None,
    ) -> Optional[str]:
        """Find the best image from any article in the cluster."""
        query = (
            select(Article.image_url)
            .join(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(
                and_(
                    ArticleTopic.cluster_id == cluster_id,
                    Article.image_url != None,
                    Article.image_url != "",
                    Article.image_url != "none",
                    ~Article.image_url.ilike("%placeholder%"),
                    ~Article.image_url.ilike("%.svg"),
                )
            )
            .order_by(Article.published_at.desc())
        )

        if since:
            query = query.where(Article.published_at >= since)

        result = await session.execute(query.limit(10))
        images = [row[0] for row in result.all() if row[0]]

        for img in images:
            if img and len(img) > 10:
                return img

        return None

    async def get_cluster_detail(
        self,
        session: AsyncSession,
        cluster_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Get detailed info about a specific cluster."""
        cluster = await session.execute(
            select(TopicCluster).where(TopicCluster.id == cluster_id)
        )
        cluster = cluster.scalar_one_or_none()
        if not cluster:
            return None

        articles = await session.execute(
            select(Article, ArticleTopic.similarity)
            .join(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(ArticleTopic.cluster_id == cluster_id)
            .order_by(Article.published_at.desc())
            .limit(50)
        )

        article_list = []
        for article, similarity in articles.all():
            article_list.append(
                {
                    "id": article.id,
                    "title": article.title,
                    "source": article.source,
                    "url": article.url,
                    "image_url": article.image_url,
                    "published_at": article.published_at.isoformat()
                    if article.published_at
                    else None,
                    "similarity": round(similarity, 3),
                }
            )

        return {
            "id": cluster.id,
            "label": cluster.label,
            "keywords": cluster.keywords or [],
            "article_count": cluster.article_count,
            "first_seen": cluster.first_seen.isoformat()
            if cluster.first_seen
            else None,
            "last_seen": cluster.last_seen.isoformat() if cluster.last_seen else None,
            "is_active": cluster.is_active,
            "articles": article_list,
        }

    async def generate_cluster_label(
        self, session: AsyncSession, cluster_id: int
    ) -> Optional[str]:
        """Generate a label for a cluster based on its articles' titles."""
        articles = await session.execute(
            select(Article.title)
            .join(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(ArticleTopic.cluster_id == cluster_id)
            .order_by(ArticleTopic.similarity.desc())
            .limit(5)
        )

        titles = [row[0] for row in articles.all() if row[0]]
        if not titles:
            return None

        from collections import Counter

        words = []
        stop_words = {
            "the",
            "a",
            "an",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "and",
            "or",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "must",
            "shall",
            "can",
            "this",
            "that",
            "these",
            "those",
            "it",
            "its",
            "with",
            "as",
            "by",
            "from",
            "about",
            "into",
            "through",
            "during",
            "before",
            "after",
            "above",
            "below",
            "up",
            "down",
            "out",
            "off",
            "over",
            "under",
            "again",
            "further",
            "then",
            "once",
            "here",
            "there",
            "when",
            "where",
            "why",
            "how",
            "all",
            "each",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "nor",
            "not",
            "only",
            "own",
            "same",
            "so",
            "than",
            "too",
            "very",
            "just",
            "but",
            "if",
            "while",
            "says",
            "said",
            "new",
            "news",
        }

        for title in titles:
            for word in title.split():
                word = word.strip(".,!?:;\"'()-").lower()
                if len(word) > 2 and word not in stop_words and word.isalpha():
                    words.append(word)

        common = Counter(words).most_common(3)
        if common:
            label = " ".join(word.title() for word, _ in common)
            await session.execute(
                update(TopicCluster)
                .where(TopicCluster.id == cluster_id)
                .values(label=label, keywords=[w for w, _ in common])
            )
            return label

        return None


async def process_unassigned_articles(session: AsyncSession) -> int:
    """Assign all articles without cluster assignment."""
    service = ClusteringService()
    if not service.vector_store:
        logger.warning("Vector store unavailable; skipping clustering")
        return 0

    unassigned = await session.execute(
        select(Article)
        .outerjoin(ArticleTopic, ArticleTopic.article_id == Article.id)
        .where(
            and_(
                ArticleTopic.id == None,
                Article.embedding_generated == True,
            )
        )
        .order_by(Article.published_at.desc())
        .limit(500)
    )

    articles = unassigned.scalars().all()
    logger.info("Found %d unassigned articles with embeddings", len(articles))
    assigned = 0

    chroma_error_logged = False

    for idx, article in enumerate(articles):
        if idx > 0 and idx % 50 == 0:
            logger.info(
                "Clustering progress: %d/%d articles processed, %d assigned",
                idx,
                len(articles),
                assigned,
            )
        try:
            cluster_id = await service.assign_article_to_cluster(session, article)
        except Exception as e:
            if not chroma_error_logged:
                logger.error(
                    "Aborting clustering run due to Chroma error: %s",
                    e,
                    exc_info=True,
                )
                chroma_error_logged = True
            break

        if cluster_id:
            assigned += 1

    if assigned > 0:
        await session.execute(select(TopicCluster.id).where(TopicCluster.label == None))
        unlabeled = await session.execute(
            select(TopicCluster.id).where(
                and_(
                    TopicCluster.is_active == True,
                    TopicCluster.label == None,
                    TopicCluster.article_count >= MIN_CLUSTER_SIZE,
                )
            )
        )
        for row in unlabeled.all():
            await service.generate_cluster_label(session, row[0])

    logger.info("Assigned %d articles to clusters", assigned)
    return assigned


async def merge_similar_clusters(
    session: AsyncSession, similarity_threshold: float = 0.80
) -> int:
    """
    Merge clusters that are semantically similar.

    This addresses the issue where the same story creates multiple clusters
    when articles are written from slightly different angles.

    Algorithm:
    1. Get all active clusters with their centroids
    2. Compare each pair using embedding similarity
    3. Merge clusters above threshold, keeping the larger one
    4. Reassign articles from merged cluster to target cluster
    """
    service = ClusteringService()
    if not service.vector_store:
        logger.warning("Vector store unavailable, cannot merge clusters")
        return 0

    active_clusters = await session.execute(
        select(TopicCluster)
        .where(TopicCluster.is_active == True)
        .order_by(TopicCluster.article_count.desc())
    )
    clusters = active_clusters.scalars().all()

    if len(clusters) < 2:
        return 0

    cluster_embeddings: Dict[int, np.ndarray] = {}

    for cluster in clusters:
        if not cluster.centroid_article_id:
            continue

        centroid_article = await session.execute(
            select(Article).where(Article.id == cluster.centroid_article_id)
        )
        centroid_article = centroid_article.scalar_one_or_none()
        if not centroid_article or not centroid_article.chroma_id:
            continue

        try:
            results = service.vector_store.collection.get(
                ids=[centroid_article.chroma_id],
                include=["embeddings"],
            )
            emb_result = results.get("embeddings")
            if emb_result is not None and len(emb_result) > 0:
                emb = emb_result[0]
                if isinstance(emb, np.ndarray):
                    if emb.size > 0:
                        cluster_embeddings[cluster.id] = emb
                elif isinstance(emb, list) and len(emb) > 0:
                    cluster_embeddings[cluster.id] = np.array(emb)
        except Exception as e:
            logger.debug("Failed to get embedding for cluster %d: %s", cluster.id, e)
            continue

    merged_count = 0
    merged_into: Dict[int, int] = {}

    cluster_ids = list(cluster_embeddings.keys())
    for i, cluster_id_a in enumerate(cluster_ids):
        if cluster_id_a in merged_into:
            continue

        for cluster_id_b in cluster_ids[i + 1 :]:
            if cluster_id_b in merged_into:
                continue

            emb_a = cluster_embeddings[cluster_id_a]
            emb_b = cluster_embeddings[cluster_id_b]
            similarity = float(np.dot(emb_a, emb_b))

            if similarity >= similarity_threshold:
                cluster_a = next((c for c in clusters if c.id == cluster_id_a), None)
                cluster_b = next((c for c in clusters if c.id == cluster_id_b), None)

                if not cluster_a or not cluster_b:
                    continue

                if cluster_a.article_count >= cluster_b.article_count:
                    target_id, source_id = cluster_id_a, cluster_id_b
                else:
                    target_id, source_id = cluster_id_b, cluster_id_a

                await _merge_cluster_into(session, source_id, target_id)
                merged_into[source_id] = target_id
                merged_count += 1

                logger.info(
                    "Merged cluster %d into %d (similarity=%.3f)",
                    source_id,
                    target_id,
                    similarity,
                )

    if merged_count > 0:
        await session.commit()

    logger.info("Merged %d similar clusters", merged_count)
    return merged_count


async def _merge_cluster_into(
    session: AsyncSession, source_id: int, target_id: int
) -> None:
    """Merge source cluster into target cluster."""
    existing_in_target = await session.execute(
        select(ArticleTopic.article_id).where(ArticleTopic.cluster_id == target_id)
    )
    existing_article_ids = {row[0] for row in existing_in_target.all()}

    if existing_article_ids:
        await session.execute(
            delete(ArticleTopic).where(
                and_(
                    ArticleTopic.cluster_id == source_id,
                    ArticleTopic.article_id.in_(existing_article_ids),
                )
            )
        )

    await session.execute(
        update(ArticleTopic)
        .where(ArticleTopic.cluster_id == source_id)
        .values(cluster_id=target_id)
    )

    new_count_result = await session.execute(
        select(func.count(ArticleTopic.id)).where(ArticleTopic.cluster_id == target_id)
    )
    new_count = new_count_result.scalar() or 0

    await session.execute(
        update(TopicCluster)
        .where(TopicCluster.id == target_id)
        .values(
            article_count=new_count,
            last_seen=get_utc_now(),
        )
    )

    await session.execute(
        update(TopicCluster).where(TopicCluster.id == source_id).values(is_active=False)
    )

    await session.execute(
        delete(ClusterStatsDaily).where(ClusterStatsDaily.cluster_id == source_id)
    )
    await session.execute(
        delete(ClusterStatsHourly).where(ClusterStatsHourly.cluster_id == source_id)
    )


async def find_duplicate_articles(
    session: AsyncSession,
    articles: List[Article],
    similarity_threshold: float = 0.85,
) -> Dict[int, Set[int]]:
    """
    Find near-duplicate articles using MinHash before clustering.

    This reduces cluster noise from slightly different versions
    of the same story (wire services, re-writes, etc.).

    Args:
        session: Database session
        articles: List of articles to check
        similarity_threshold: Jaccard similarity threshold (0.85 = 85%)

    Returns:
        Dict mapping representative article ID to set of duplicate IDs
    """
    try:
        from app.services.minhash_dedup import MinHashDeduplicator

        if len(articles) < 2:
            return {}

        deduplicator = MinHashDeduplicator(threshold=similarity_threshold)

        for article in articles:
            text = article.title or ""
            if article.summary:
                text += f" {article.summary}"
            deduplicator.add_document(str(article.id), text)

        duplicates = deduplicator.find_duplicates()

        duplicate_groups: Dict[int, Set[int]] = {}

        for id1, id2, sim in duplicates:
            id1_int = int(id1)
            id2_int = int(id2)

            found = False
            for rep, group in duplicate_groups.items():
                if id1_int in group:
                    group.add(id2_int)
                    found = True
                    break
                if id2_int in group:
                    group.add(id1_int)
                    found = True
                    break

            if not found:
                duplicate_groups[id1_int] = {id1_int, id2_int}

        if duplicate_groups:
            total_dupes = sum(len(v) - 1 for v in duplicate_groups.values())
            logger.info(
                f"Found {total_dupes} duplicate articles in {len(duplicate_groups)} groups"
            )

        return duplicate_groups

    except ImportError:
        logger.warning("MinHash deduplication not available")
        return {}
    except Exception as e:
        logger.error(f"Duplicate detection failed: {e}")
        return {}


async def cluster_batch_hdbscan(
    session: AsyncSession,
    articles: List[Article],
    min_cluster_size: int = 5,
) -> Dict[int, int]:
    """
    Cluster a batch of articles using HDBSCAN algorithm.

    Alternative to centroid-based clustering that automatically
    handles outliers and doesn't require threshold tuning.

    Args:
        session: Database session
        articles: Articles to cluster
        min_cluster_size: Minimum cluster size

    Returns:
        Dict mapping article_id to cluster_id
    """
    from app.services.hdbscan_clustering import cluster_articles_hdbscan

    if not articles:
        return {}

    vector_store = get_vector_store()
    if not vector_store:
        logger.warning("Vector store unavailable for HDBSCAN clustering")
        return {}

    embeddings = []
    chroma_ids = []

    for article in articles:
        if not article.chroma_id:
            continue
        try:
            result = vector_store.collection.get(
                ids=[article.chroma_id],
                include=["embeddings"],
            )
            if result["embeddings"]:
                embeddings.append(result["embeddings"][0])
                chroma_ids.append(article.chroma_id)
        except Exception as e:
            logger.debug(f"Failed to get embedding for article {article.id}: {e}")

    if not embeddings:
        logger.warning("No embeddings found for HDBSCAN clustering")
        return {}

    labels, cluster_info = cluster_articles_hdbscan(
        embeddings=embeddings,
        article_ids=chroma_ids,
        min_cluster_size=min_cluster_size,
    )

    assignment: Dict[int, int] = {}
    chroma_to_article = {a.chroma_id: a.id for a in articles if a.chroma_id}

    for idx, (chroma_id, label) in enumerate(zip(chroma_ids, labels)):
        if label == -1:
            continue  # Skip noise
        article_id = chroma_to_article.get(chroma_id)
        if article_id:
            assignment[article_id] = int(label)

    logger.info(
        f"HDBSCAN clustered {len(assignment)} articles into "
        f"{len(cluster_info)} clusters ({sum(1 for l in labels if l == -1)} noise)"
    )

    return assignment
