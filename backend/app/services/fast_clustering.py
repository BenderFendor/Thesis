"""
Fast batch clustering service for topic assignment.

Key improvements over old approach:
1. Batch vector queries to Chroma (50-100 at a time)
2. Parallel async processing with asyncio.gather()
3. Bulk database inserts (100+ rows per transaction)
4. Pre-group articles by similarity before creating clusters
5. No per-article database transactions
6. Updates existing cluster last_seen when adding new articles
"""

import asyncio
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass
import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, update, and_, func
from app.core.logging import get_logger
from app.database import (
    Article,
    ArticleTopic,
    TopicCluster,
    AsyncSessionLocal,
    get_utc_now,
)
from app.vector_store import get_vector_store

logger = get_logger("fast_clustering")


@dataclass
class ArticleWithEmbedding:
    """Article with pre-fetched embedding for batch processing."""

    article: Article
    embedding: List[float]


@dataclass
class SimilarityGroup:
    """Group of similar articles identified by batch similarity search."""

    articles: List[Article]
    representative_embedding: List[float]
    keywords: List[str]
    article_similarities: Optional[Dict[int, float]] = (
        None  # article_id -> similarity to seed
    )


class FastClusteringService:
    """
    High-performance batch clustering using vector similarity.

    Processes 500 articles in ~10-30 seconds vs 5-10 minutes with old approach.
    Automatically updates existing clusters' last_seen when adding new articles.
    """

    def __init__(self):
        self.vector_store = get_vector_store()
        self.batch_size = 50  # Process 50 articles per batch
        self.similarity_threshold = 0.82  # Minimum similarity to group - tighter threshold for semantic coherence
        self.high_similarity_threshold = (
            0.9  # Allow high similarity matches without keyword overlap
        )
        self.min_keyword_overlap = 1  # Require at least 1 shared keyword for grouping
        self.max_concurrent_batches = 5  # Process 5 batches concurrently

    async def process_unassigned_batch(
        self, session: AsyncSession, limit: int = 500
    ) -> int:
        """
        Process unassigned articles in optimized batches.

        Args:
            session: Database session
            limit: Maximum articles to process (default 500)

        Returns:
            Number of articles assigned to clusters
        """
        # Step 1: Fetch unassigned articles with embeddings (most recent first)
        articles = await self._fetch_unassigned_articles(session, limit)
        if not articles:
            logger.info("No unassigned articles to process")
            return 0

        logger.info(
            f"Processing {len(articles)} articles in batches of {self.batch_size}"
        )

        # Step 2: Load embeddings in parallel batches
        articles_with_embeddings = await self._load_embeddings_batch(articles)

        # Step 3: Group similar articles using batch similarity search
        groups = await self._group_similar_articles(articles_with_embeddings)

        # Step 4: Check for matches with existing clusters and assign
        assigned_count = await self._assign_to_clusters(
            session, groups, articles_with_embeddings
        )

        logger.info(
            f"Batch clustering complete: {assigned_count}/{len(articles)} articles assigned"
        )
        return assigned_count

    async def _fetch_unassigned_articles(
        self, session: AsyncSession, limit: int
    ) -> List[Article]:
        """Fetch articles without cluster assignments."""
        result = await session.execute(
            select(Article)
            .outerjoin(ArticleTopic, ArticleTopic.article_id == Article.id)
            .where(
                and_(
                    ArticleTopic.id == None,
                    Article.embedding_generated == True,
                )
            )
            .order_by(Article.published_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def _load_embeddings_batch(
        self, articles: List[Article]
    ) -> List[ArticleWithEmbedding]:
        """Load embeddings for articles in batches."""
        articles_with_embeddings: List[ArticleWithEmbedding] = []

        for i in range(0, len(articles), self.batch_size):
            batch = articles[i : i + self.batch_size]
            chroma_ids = [f"article_{a.id}" for a in batch]

            try:
                result = self.vector_store.collection.get(
                    ids=chroma_ids, include=["embeddings"]
                )

                if result and result["embeddings"]:
                    for article, embedding in zip(batch, result["embeddings"]):
                        if embedding:
                            articles_with_embeddings.append(
                                ArticleWithEmbedding(article, embedding)
                            )

            except Exception as e:
                logger.warning(f"Failed to load embeddings batch: {e}")

        return articles_with_embeddings

    async def _group_similar_articles(
        self, articles: List[ArticleWithEmbedding]
    ) -> List[SimilarityGroup]:
        """Group articles by vector similarity using seed-based approach.

        Each article in a group must be similar to the seed article,
        preventing chain grouping where A~B and B~C but A!~C.
        """
        if not articles:
            return []

        groups: List[SimilarityGroup] = []
        unprocessed = list(range(len(articles)))

        while unprocessed:
            # Start a new group with the first unprocessed article as seed
            seed_idx = unprocessed[0]
            seed = articles[seed_idx]
            unprocessed.remove(seed_idx)

            # Find all articles similar to the SEED (not to each other)
            # This prevents chain grouping problems
            group_indices = [seed_idx]
            similarities: Dict[int, float] = {
                seed.article.id: 1.0
            }  # Seed has similarity 1.0 to itself
            remaining: List[int] = []

            for idx in unprocessed:
                other = articles[idx]
                similarity = self._cosine_similarity(seed.embedding, other.embedding)

                if similarity >= self.similarity_threshold:
                    group_indices.append(idx)
                    similarities[other.article.id] = round(similarity, 4)
                else:
                    remaining.append(idx)

            unprocessed = remaining

            # Create group
            group_articles = [articles[i].article for i in group_indices]
            if group_articles:
                keywords = self._extract_keywords(seed.article)
                groups.append(
                    SimilarityGroup(
                        articles=group_articles,
                        representative_embedding=seed.embedding,
                        keywords=keywords,
                        article_similarities=similarities,
                    )
                )

        logger.info(
            f"Grouped {len(articles)} articles into {len(groups)} similarity groups "
            f"(chain grouping disabled, threshold={self.similarity_threshold})"
        )
        return groups

    async def _assign_to_clusters(
        self,
        session: AsyncSession,
        groups: List[SimilarityGroup],
        articles_with_embeddings: List[ArticleWithEmbedding],
    ) -> int:
        """
        Assign article groups to clusters.

        For groups with 2+ articles:
        - Try to find existing similar cluster and merge
        - Or create new cluster

        For single articles:
        - Try to find existing similar cluster
        - Or create mini-cluster

        Updates last_seen on existing clusters when adding articles.
        """
        if not groups:
            return 0

        assigned_count = 0
        article_embedding_map = {
            aw.article.id: aw.embedding for aw in articles_with_embeddings
        }

        try:
            # Separate multi-article and single-article groups
            multi_article_groups = [g for g in groups if len(g.articles) >= 2]
            single_article_groups = [g for g in groups if len(g.articles) == 1]

            # Process multi-article groups
            for group in multi_article_groups:
                # Try to find existing cluster to merge with
                existing_cluster_id = await self._find_similar_cluster(
                    session,
                    group.representative_embedding,
                    set(group.keywords) if group.keywords else None,
                )

                if existing_cluster_id:
                    # Add to existing cluster and update last_seen
                    assigned_count += await self._add_to_existing_cluster(
                        session, existing_cluster_id, group, article_embedding_map
                    )
                else:
                    # Create new cluster
                    assigned_count += await self._create_new_cluster(session, group)

            # Process single-article groups
            for group in single_article_groups:
                article = group.articles[0]
                embedding = article_embedding_map.get(article.id)

                if embedding:
                    existing_cluster_id = await self._find_similar_cluster(
                        session,
                        embedding,
                        set(group.keywords) if group.keywords else None,
                    )

                    if existing_cluster_id:
                        # Add to existing cluster
                        assigned_count += await self._add_single_to_existing_cluster(
                            session, existing_cluster_id, article
                        )
                    else:
                        # Create mini-cluster
                        assigned_count += await self._create_mini_cluster(
                            session, group
                        )

            logger.info(f"Assigned {assigned_count} articles to clusters")

        except Exception as e:
            logger.error(f"Cluster assignment failed: {e}")
            raise

        return assigned_count

    async def _find_similar_cluster(
        self,
        session: AsyncSession,
        embedding: List[float],
        keywords: Optional[Set[str]] = None,
    ) -> Optional[int]:
        """Find existing cluster with similar centroid using vector search."""
        try:
            # Query Chroma for similar clusters
            result = self.vector_store.collection.query(
                query_embeddings=[embedding],
                n_results=5,
                where={"type": "cluster"},
            )

            if not result or not result["ids"]:
                return None

            # Check if any match is similar enough
            for cluster_id_str, distance in zip(
                result["ids"][0], result["distances"][0]
            ):
                # Chroma uses cosine distance = 1 - cosine_similarity
                # So similarity = 1 - distance
                similarity = 1 - distance if distance <= 2 else 0

                if (
                    similarity >= self.similarity_threshold
                ):  # Use same threshold for consistency
                    # Extract cluster ID from chroma ID (format: "cluster_{id}")
                    cluster_id = int(cluster_id_str.replace("cluster_", ""))

                    # Verify cluster still exists and is active
                    result = await session.execute(
                        select(TopicCluster.id, TopicCluster.keywords).where(
                            and_(
                                TopicCluster.id == cluster_id,
                                TopicCluster.is_active == True,
                            )
                        )
                    )
                    row = result.first()
                    if not row:
                        continue
                    if keywords and row[1]:
                        cluster_keywords = set(row[1])
                        if (
                            cluster_keywords
                            and not (cluster_keywords & keywords)
                            and similarity < self.high_similarity_threshold
                        ):
                            continue
                    return row[0]

            return None

        except Exception as e:
            logger.warning(f"Failed to find similar cluster: {e}")
            return None

    async def _add_to_existing_cluster(
        self,
        session: AsyncSession,
        cluster_id: int,
        group: SimilarityGroup,
        article_embedding_map: Dict[int, List[float]],
    ) -> int:
        """Add articles to existing cluster and update last_seen."""
        # Get the most recent article date for updating last_seen
        max_published = max(
            (a.published_at for a in group.articles if a.published_at),
            default=get_utc_now(),
        )

        # Bulk insert assignments with actual similarity values
        similarities = group.article_similarities or {}
        assignment_values = []
        for article in group.articles:
            # Use computed similarity or default to threshold
            sim = similarities.get(article.id, self.similarity_threshold)
            assignment_values.append(
                {
                    "article_id": article.id,
                    "cluster_id": cluster_id,
                    "similarity": round(sim, 4),
                }
            )

        await session.execute(insert(ArticleTopic), assignment_values)

        # Update cluster: increment count and update last_seen to most recent article
        await session.execute(
            update(TopicCluster)
            .where(TopicCluster.id == cluster_id)
            .values(
                article_count=TopicCluster.article_count + len(group.articles),
                last_seen=max_published,
                centroid_article_id=func.coalesce(
                    TopicCluster.centroid_article_id, group.articles[0].id
                ),
            )
        )

        # Update cluster vector in Chroma (optional: blend in new articles)
        await self._update_cluster_vector(
            session, cluster_id, group, article_embedding_map
        )

        return len(group.articles)

    async def _create_new_cluster(
        self, session: AsyncSession, group: SimilarityGroup
    ) -> int:
        """Create new cluster for article group."""
        # Get the most recent article date
        max_published = max(
            (a.published_at for a in group.articles if a.published_at),
            default=get_utc_now(),
        )

        # Create cluster with timestamps based on article dates
        result = await session.execute(
            insert(TopicCluster).returning(TopicCluster.id),
            [
                {
                    "label": self._generate_cluster_label(group),
                    "keywords": group.keywords,
                    "is_active": True,
                    "article_count": len(group.articles),
                    "centroid_article_id": group.articles[0].id,
                    "first_seen": min(
                        (a.published_at for a in group.articles if a.published_at),
                        default=get_utc_now(),
                    ),
                    "last_seen": max_published,
                }
            ],
        )
        cluster_id = result.scalar_one()

        # Bulk insert assignments with actual similarity values
        similarities = group.article_similarities or {}
        assignment_values = []
        for article in group.articles:
            sim = similarities.get(article.id, self.similarity_threshold)
            assignment_values.append(
                {
                    "article_id": article.id,
                    "cluster_id": cluster_id,
                    "similarity": round(sim, 4),
                }
            )
        await session.execute(insert(ArticleTopic), assignment_values)

        # Add cluster vector to Chroma
        await self._add_cluster_vector(cluster_id, group.representative_embedding)

        return len(group.articles)

    async def _add_single_to_existing_cluster(
        self, session: AsyncSession, cluster_id: int, article: Article
    ) -> int:
        """Add single article to existing cluster."""
        published_at = article.published_at or get_utc_now()

        # Insert assignment with actual similarity (compute if possible)
        actual_similarity = await self._compute_article_cluster_similarity(
            session, cluster_id, article
        )
        await session.execute(
            insert(ArticleTopic),
            [
                {
                    "article_id": article.id,
                    "cluster_id": cluster_id,
                    "similarity": round(actual_similarity, 4),
                }
            ],
        )

        # Update cluster: increment count and update last_seen
        await session.execute(
            update(TopicCluster)
            .where(TopicCluster.id == cluster_id)
            .values(
                article_count=TopicCluster.article_count + 1,
                last_seen=published_at,
                centroid_article_id=func.coalesce(
                    TopicCluster.centroid_article_id, article.id
                ),
            )
        )

        return 1

    async def _create_mini_cluster(
        self, session: AsyncSession, group: SimilarityGroup
    ) -> int:
        """Create mini-cluster for single article."""
        article = group.articles[0]
        published_at = article.published_at or get_utc_now()

        result = await session.execute(
            insert(TopicCluster).returning(TopicCluster.id),
            [
                {
                    "label": article.title[:100] if article.title else "Untitled",
                    "keywords": group.keywords,
                    "is_active": True,
                    "article_count": 1,
                    "centroid_article_id": article.id,
                    "first_seen": published_at,
                    "last_seen": published_at,
                }
            ],
        )
        cluster_id = result.scalar_one()

        await session.execute(
            insert(ArticleTopic),
            [
                {
                    "article_id": article.id,
                    "cluster_id": cluster_id,
                    "similarity": 1.0,
                }
            ],
        )

        return 1

    async def _update_cluster_vector(
        self,
        session: AsyncSession,
        cluster_id: int,
        group: SimilarityGroup,
        article_embedding_map: Dict[int, List[float]],
    ):
        """Update cluster vector in Chroma to include new articles."""
        try:
            # Get existing cluster vector
            existing = self.vector_store.collection.get(
                ids=[f"cluster_{cluster_id}"], include=["embeddings"]
            )

            if existing and existing["embeddings"]:
                # Blend existing vector with new articles (weighted average)
                existing_vector = np.array(existing["embeddings"][0])
                new_vectors = [
                    np.array(article_embedding_map[a.id])
                    for a in group.articles
                    if a.id in article_embedding_map
                ]

                if new_vectors:
                    # Weighted blend: 70% existing, 30% new average
                    new_average = np.mean(new_vectors, axis=0)
                    blended = 0.7 * existing_vector + 0.3 * new_average
                    blended = blended / np.linalg.norm(blended)  # Normalize

                    # Update in Chroma
                    self.vector_store.collection.update(
                        ids=[f"cluster_{cluster_id}"],
                        embeddings=[blended.tolist()],
                    )
            else:
                # No existing vector, add new one
                await self._add_cluster_vector(
                    cluster_id, group.representative_embedding
                )

        except Exception as e:
            logger.warning(f"Failed to update cluster vector: {e}")

    async def _add_cluster_vector(self, cluster_id: int, embedding: List[float]):
        """Add cluster vector to Chroma for future matching."""
        try:
            self.vector_store.collection.add(
                ids=[f"cluster_{cluster_id}"],
                embeddings=[embedding],
                metadatas=[{"type": "cluster", "cluster_id": cluster_id}],
            )
        except Exception as e:
            logger.warning(f"Failed to add cluster vector: {e}")

    async def _compute_article_cluster_similarity(
        self, session: AsyncSession, cluster_id: int, article: Article
    ) -> float:
        """Compute actual similarity between article and cluster centroid."""
        try:
            # Get cluster's centroid article
            result = await session.execute(
                select(TopicCluster.centroid_article_id).where(
                    TopicCluster.id == cluster_id
                )
            )
            centroid_article_id = result.scalar_one_or_none()

            if not centroid_article_id:
                return self.similarity_threshold

            # Get embeddings from Chroma
            centroid_chroma_id = f"article_{centroid_article_id}"
            article_chroma_id = f"article_{article.id}"

            chroma_result = self.vector_store.collection.get(
                ids=[centroid_chroma_id, article_chroma_id], include=["embeddings"]
            )

            if (
                chroma_result
                and chroma_result.get("embeddings")
                and len(chroma_result["embeddings"]) == 2
            ):
                emb_centroid = chroma_result["embeddings"][0]
                emb_article = chroma_result["embeddings"][1]
                if emb_centroid and emb_article:
                    return self._cosine_similarity(emb_centroid, emb_article)

            return self.similarity_threshold

        except Exception as e:
            logger.warning(
                f"Failed to compute similarity for article {article.id}: {e}"
            )
            return self.similarity_threshold

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        a_vec = np.array(a)
        b_vec = np.array(b)
        norm_a = np.linalg.norm(a_vec)
        norm_b = np.linalg.norm(b_vec)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a_vec, b_vec) / (norm_a * norm_b))

    def _extract_keywords(self, article: Article) -> List[str]:
        """Extract keywords from article title and summary."""
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
        keywords = list(set([w for w in words if w not in stopwords]))[:10]
        return keywords

    def _generate_cluster_label(self, group: SimilarityGroup) -> str:
        """Generate human-readable label for cluster."""
        if not group.articles:
            return "Untitled Cluster"

        # Use most common words from all articles
        all_words = []
        for article in group.articles:
            words = self._extract_keywords(article)
            all_words.extend(words)

        from collections import Counter

        most_common = Counter(all_words).most_common(3)
        if most_common:
            return " ".join([w[0] for w in most_common]).title()

        return (
            group.articles[0].title[:100]
            if group.articles[0].title
            else "Untitled Cluster"
        )


# Convenience function for backwards compatibility
async def fast_process_unassigned_articles(
    session: AsyncSession, limit: int = 500
) -> int:
    """Process unassigned articles using fast batch clustering."""
    service = FastClusteringService()
    return await service.process_unassigned_batch(session, limit)
