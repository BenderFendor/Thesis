"""Blind spots analysis service for identifying gaps in source coverage.

Analyzes which news sources are covering which topics and identifies
"blind spots" where major stories are not being reported by certain sources.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import (
    Article,
    TopicCluster,
    ArticleTopic,
    SourceMetadata,
    SourceCoverageStats,
    TopicBlindSpot,
    get_utc_now,
)
from app.core.config import settings

logger = logging.getLogger(__name__)


class BlindSpotsAnalyzer:
    """Analyzes source coverage and identifies blind spots."""

    def __init__(self):
        self.min_articles_for_blind_spot = 5  # Minimum articles in topic to consider
        self.coverage_threshold = (
            0.3  # Source must cover < 30% of days to be blind spot
        )
        self.severity_thresholds = {
            "high": {
                "min_sources": 8,
                "max_blind_sources": 0.5,
            },  # >8 sources, >50% blind
            "medium": {
                "min_sources": 4,
                "max_blind_sources": 0.7,
            },  # >4 sources, >30% blind
            "low": {"min_sources": 2, "max_blind_sources": 1.0},  # >2 sources
        }

    async def analyze_source_coverage(
        self, session: AsyncSession, source_name: str, days: int = 30
    ) -> Dict[str, Any]:
        """Analyze coverage for a specific source.

        Args:
            session: Database session
            source_name: Name of the source to analyze
            days: Number of days to analyze

        Returns:
            Coverage analysis with blind spots
        """
        since = get_utc_now() - timedelta(days=days)

        # Get all articles from this source in timeframe
        articles_result = await session.execute(
            select(Article)
            .where(and_(Article.source == source_name, Article.published_at >= since))
            .order_by(desc(Article.published_at))
        )
        articles = articles_result.scalars().all()

        if not articles:
            return {
                "source": source_name,
                "article_count": 0,
                "topics_covered": 0,
                "blind_spots": [],
                "coverage_gaps": [],
            }

        # Get cluster assignments for these articles
        article_ids = [a.id for a in articles]
        topics_result = await session.execute(
            select(ArticleTopic.cluster_id, func.count(ArticleTopic.id).label("count"))
            .where(ArticleTopic.article_id.in_(article_ids))
            .group_by(ArticleTopic.cluster_id)
        )
        topic_counts = {row[0]: row[1] for row in topics_result.all()}

        # Get all active clusters in timeframe
        all_clusters_result = await session.execute(
            select(TopicCluster).where(
                and_(TopicCluster.is_active == True, TopicCluster.last_seen >= since)
            )
        )
        all_clusters = all_clusters_result.scalars().all()

        # Identify blind spots (clusters this source is NOT covering)
        covered_clusters = set(topic_counts.keys())
        blind_spots = []

        for cluster in all_clusters:
            if cluster.id not in covered_clusters:
                # Check if this cluster has enough coverage to matter
                total_articles = await self._get_cluster_article_count(
                    session, cluster.id, since
                )
                if total_articles >= self.min_articles_for_blind_spot:
                    blind_spots.append(
                        {
                            "cluster_id": cluster.id,
                            "cluster_label": cluster.label
                            or ", ".join(cluster.keywords[:3]),
                            "topic_keywords": cluster.keywords,
                            "total_articles": total_articles,
                            "severity": self._calculate_blind_spot_severity(
                                total_articles
                            ),
                        }
                    )

        # Sort blind spots by severity
        blind_spots.sort(key=lambda x: x["severity"], reverse=True)

        return {
            "source": source_name,
            "article_count": len(articles),
            "topics_covered": len(covered_clusters),
            "total_active_topics": len(all_clusters),
            "coverage_ratio": len(covered_clusters) / max(len(all_clusters), 1),
            "blind_spots": blind_spots[:20],  # Top 20 blind spots
            "coverage_gaps": self._identify_coverage_gaps(articles),
        }

    async def identify_topic_blind_spots(
        self, session: AsyncSession, min_sources: int = 4
    ) -> List[Dict[str, Any]]:
        """Identify topics where major sources are not reporting.

        Args:
            session: Database session
            min_sources: Minimum number of sources covering topic to analyze

        Returns:
            List of topics with blind spots
        """
        since = get_utc_now() - timedelta(days=7)  # Last week

        # Get all active clusters with sufficient coverage
        clusters_result = await session.execute(
            select(TopicCluster).where(
                and_(
                    TopicCluster.is_active == True,
                    TopicCluster.last_seen >= since,
                    TopicCluster.article_count >= self.min_articles_for_blind_spot,
                )
            )
        )
        clusters = clusters_result.scalars().all()

        # Get all active sources
        sources_result = await session.execute(
            select(SourceMetadata.source_name).where(
                SourceMetadata.last_analyzed_at.isnot(None)
            )
        )
        all_sources = {row[0] for row in sources_result.all()}

        if not all_sources:
            # Fallback: get sources from articles
            sources_result = await session.execute(
                select(func.distinct(Article.source)).where(
                    Article.published_at >= since
                )
            )
            all_sources = {row[0] for row in sources_result.all() if row[0]}

        blind_spots = []

        for cluster in clusters:
            # Get sources covering this cluster
            covering_result = await session.execute(
                select(func.distinct(Article.source))
                .join(ArticleTopic, ArticleTopic.article_id == Article.id)
                .where(
                    and_(
                        ArticleTopic.cluster_id == cluster.id,
                        Article.published_at >= since,
                    )
                )
            )
            covering_sources = {row[0] for row in covering_result.all() if row[0]}

            if len(covering_sources) >= min_sources:
                # Find sources NOT covering (blind spots)
                blind_sources = all_sources - covering_sources

                if blind_sources:
                    severity = self._calculate_topic_blind_spot_severity(
                        len(covering_sources), len(blind_sources), cluster.article_count
                    )

                    blind_spots.append(
                        {
                            "cluster_id": cluster.id,
                            "cluster_label": cluster.label
                            or ", ".join(cluster.keywords[:3]),
                            "keywords": cluster.keywords,
                            "article_count": cluster.article_count,
                            "covering_sources": list(covering_sources),
                            "covering_count": len(covering_sources),
                            "blind_spot_sources": list(blind_sources),
                            "blind_spot_count": len(blind_sources),
                            "severity": severity,
                            "date_identified": get_utc_now().isoformat(),
                        }
                    )

        # Sort by severity
        severity_order = {"high": 0, "medium": 1, "low": 2}
        blind_spots.sort(key=lambda x: severity_order.get(x["severity"], 3))

        return blind_spots

    async def generate_source_coverage_report(
        self, session: AsyncSession, days: int = 30
    ) -> Dict[str, Any]:
        """Generate comprehensive coverage report for all sources.

        Args:
            session: Database session
            days: Number of days to analyze

        Returns:
            Coverage report with rankings and blind spots
        """
        since = get_utc_now() - timedelta(days=days)

        # Get all sources
        sources_result = await session.execute(
            select(func.distinct(Article.source)).where(Article.published_at >= since)
        )
        sources = [row[0] for row in sources_result.all() if row[0]]

        # Analyze each source
        source_analyses = []
        for source in sources:
            analysis = await self.analyze_source_coverage(session, source, days)
            source_analyses.append(analysis)

        # Calculate statistics
        if source_analyses:
            avg_coverage = sum(a["coverage_ratio"] for a in source_analyses) / len(
                source_analyses
            )
            avg_articles = sum(a["article_count"] for a in source_analyses) / len(
                source_analyses
            )
        else:
            avg_coverage = 0
            avg_articles = 0

        # Rank sources by coverage
        source_analyses.sort(key=lambda x: x["coverage_ratio"], reverse=True)

        # Identify systemic blind spots (across multiple sources)
        topic_blind_spots = await self.identify_topic_blind_spots(session)

        return {
            "report_period_days": days,
            "generated_at": get_utc_now().isoformat(),
            "total_sources": len(sources),
            "average_coverage_ratio": round(avg_coverage, 2),
            "average_articles_per_source": round(avg_articles, 1),
            "source_rankings": [
                {
                    "source": a["source"],
                    "coverage_ratio": a["coverage_ratio"],
                    "topics_covered": a["topics_covered"],
                    "article_count": a["article_count"],
                    "blind_spot_count": len(a["blind_spots"]),
                }
                for a in source_analyses
            ],
            "systemic_blind_spots": topic_blind_spots[:10],
            "underperforming_sources": [
                {
                    "source": a["source"],
                    "coverage_ratio": a["coverage_ratio"],
                    "blind_spots": a["blind_spots"][:5],
                }
                for a in source_analyses
                if a["coverage_ratio"] < 0.5
            ],
        }

    async def update_daily_coverage_stats(self, session: AsyncSession) -> int:
        """Update SourceCoverageStats for today.

        Args:
            session: Database session

        Returns:
            Number of sources updated
        """
        today = get_utc_now().replace(hour=0, minute=0, second=0, microsecond=0)

        # Get all articles from today
        today_result = await session.execute(
            select(Article).where(
                and_(
                    Article.published_at >= today,
                    Article.published_at < today + timedelta(days=1),
                )
            )
        )
        articles = today_result.scalars().all()

        # Group by source
        source_articles = defaultdict(list)
        for article in articles:
            source_articles[article.source].append(article)

        updated_count = 0

        for source_name, source_arts in source_articles.items():
            # Get cluster coverage for this source today
            article_ids = [a.id for a in source_arts]

            cluster_result = await session.execute(
                select(func.distinct(ArticleTopic.cluster_id)).where(
                    ArticleTopic.article_id.in_(article_ids)
                )
            )
            cluster_ids = [row[0] for row in cluster_result.all() if row[0]]

            # Count by category
            category_counts = defaultdict(int)
            for article in source_arts:
                category_counts[article.category or "general"] += 1

            # Check for existing stats
            existing = await session.execute(
                select(SourceCoverageStats).where(
                    and_(
                        SourceCoverageStats.source_name == source_name,
                        SourceCoverageStats.date == today,
                    )
                )
            )
            stats = existing.scalar_one_or_none()

            if stats:
                stats.article_count = len(source_arts)
                stats.article_count_by_category = dict(category_counts)
                stats.topics_covered = len(cluster_ids)
                stats.cluster_ids = cluster_ids
            else:
                stats = SourceCoverageStats(
                    source_name=source_name,
                    date=today,
                    article_count=len(source_arts),
                    article_count_by_category=dict(category_counts),
                    topics_covered=len(cluster_ids),
                    cluster_ids=cluster_ids,
                )
                session.add(stats)

            updated_count += 1

        await session.commit()
        return updated_count

    def _identify_coverage_gaps(self, articles: List[Article]) -> List[Dict[str, Any]]:
        """Identify temporal or category gaps in coverage."""
        if not articles:
            return []

        # Sort by date
        sorted_articles = sorted(
            articles, key=lambda a: a.published_at or get_utc_now()
        )

        gaps = []
        for i in range(1, len(sorted_articles)):
            prev_date = sorted_articles[i - 1].published_at
            curr_date = sorted_articles[i].published_at

            if prev_date and curr_date:
                gap_hours = (curr_date - prev_date).total_seconds() / 3600
                if gap_hours > 24:  # Gap larger than 24 hours
                    gaps.append(
                        {
                            "start": prev_date.isoformat(),
                            "end": curr_date.isoformat(),
                            "duration_hours": round(gap_hours, 1),
                        }
                    )

        return gaps[:5]  # Top 5 gaps

    async def _get_cluster_article_count(
        self, session: AsyncSession, cluster_id: int, since: datetime
    ) -> int:
        """Get total article count for a cluster since a date."""
        result = await session.execute(
            select(func.count(ArticleTopic.id))
            .join(Article, Article.id == ArticleTopic.article_id)
            .where(
                and_(
                    ArticleTopic.cluster_id == cluster_id, Article.published_at >= since
                )
            )
        )
        return result.scalar_one() or 0

    def _calculate_blind_spot_severity(self, total_articles: int) -> str:
        """Calculate severity of a blind spot based on coverage."""
        if total_articles >= 20:
            return "high"
        elif total_articles >= 10:
            return "medium"
        return "low"

    def _calculate_topic_blind_spot_severity(
        self, covering_count: int, blind_count: int, total_articles: int
    ) -> str:
        """Calculate severity for topic-level blind spots."""
        total_sources = covering_count + blind_count
        blind_ratio = blind_count / total_sources if total_sources > 0 else 0

        # High severity: major topic, many sources blind
        if total_articles >= 15 and covering_count >= 6 and blind_ratio >= 0.4:
            return "high"
        # Medium: moderate topic, some sources blind
        elif total_articles >= 8 and covering_count >= 3 and blind_ratio >= 0.25:
            return "medium"
        return "low"


# Global instance
_blind_spots_analyzer: Optional[BlindSpotsAnalyzer] = None


def get_blind_spots_analyzer() -> BlindSpotsAnalyzer:
    """Get or create blind spots analyzer instance."""
    global _blind_spots_analyzer
    if _blind_spots_analyzer is None:
        _blind_spots_analyzer = BlindSpotsAnalyzer()
    return _blind_spots_analyzer


async def analyze_all_sources(session: AsyncSession, days: int = 30) -> Dict[str, Any]:
    """Convenience function to analyze all sources."""
    analyzer = get_blind_spots_analyzer()
    return await analyzer.generate_source_coverage_report(session, days)
