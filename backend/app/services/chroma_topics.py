"""Topic clustering via ChromaDB, designed for background-worker use only.

The public API never calls ChromaDB directly.  Instead:
  1. A background worker calls compute_and_save_clusters() on a schedule.
  2. Results are written to the topic_cluster_snapshots Postgres table.
  3. API routes read exclusively from that table via cluster_cache.py.

If ChromaDB is unreachable, the worker skips the run and the API continues
serving the last successful snapshot — it never surfaces a connection error
to the user.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article, GDELTEvent, get_utc_now
from app.vector_store import (
    VectorStore,
    _get_chroma_include,
    _get_embedding_rows,
    get_vector_store,
    is_chroma_reachable,
)

logger = get_logger("chroma_topics")

SIMILARITY_THRESHOLD = 0.82
MIN_CLUSTER_SIZE = 2
TRENDING_EXPANSION = 50
BREAKING_WINDOW_HOURS = 3
BREAKING_SPIKE_THRESHOLD = 2.0
LEXICAL_MIN_TOKEN_OVERLAP = 2
LEXICAL_MIN_JACCARD = 0.18
LEXICAL_MAX_TOKEN_POSTINGS = 250
LEXICAL_MAX_ARTICLES = 3000
CHROMA_PROBE_LIMIT = 20
USE_CHROMA_CLUSTER_QUERY = False
GENERIC_CLUSTER_TOKENS = {
    "about",
    "after",
    "amid",
    "against",
    "along",
    "also",
    "around",
    "been",
    "between",
    "could",
    "despite",
    "direct",
    "during",
    "east",
    "first",
    "follow",
    "following",
    "from",
    "home",
    "including",
    "into",
    "latest",
    "middle",
    "more",
    "most",
    "much",
    "news",
    "over",
    "part",
    "report",
    "reportedly",
    "return",
    "said",
    "since",
    "some",
    "states",
    "than",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "through",
    "today",
    "united",
    "week",
    "weekend",
    "week's",
    "west",
    "what",
    "will",
    "with",
    "would",
}


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
    def __init__(self) -> None:
        pass

    @property
    def vector_store(self) -> VectorStore | None:
        return self._get_vector_store()

    def _get_vector_store(self) -> VectorStore | None:
        """Return the current vector store, refreshing from the module-level singleton."""
        return get_vector_store()

    def _article_id(self, article: Article) -> int:
        return cast(int, article.id)

    @staticmethod
    def _get_session_factory() -> Any:
        from app.database import AsyncSessionLocal

        return cast(Any, AsyncSessionLocal)

    async def get_trending_clusters(
        self, session: AsyncSession, window: str = "1d", limit: int = 10
    ) -> List[Dict[str, Any]]:
        window_start = _window_start(window)
        max_articles = 200
        fetch_limit = min(limit * TRENDING_EXPANSION, max_articles)
        article_rows = await self._fetch_recent_articles(
            session, window_start, fetch_limit
        )
        clusters = await self._cluster_articles(article_rows)
        return await self._build_trending_clusters(
            session, clusters, window_start, limit
        )

    async def get_breaking_clusters(
        self, session: AsyncSession, limit: int = 5
    ) -> List[Dict[str, Any]]:
        window_start = get_utc_now() - timedelta(hours=BREAKING_WINDOW_HOURS)
        max_articles = 100
        fetch_limit = min(limit * TRENDING_EXPANSION, max_articles)
        article_rows = await self._fetch_recent_articles(
            session, window_start, fetch_limit
        )
        clusters = await self._cluster_articles(article_rows)
        return await self._build_breaking_clusters(session, clusters, limit)

    async def get_all_clusters(
        self,
        session: AsyncSession,
        window: str = "1d",
        min_articles: int = MIN_CLUSTER_SIZE,
        limit: int = 1000,
    ) -> List[Dict[str, Any]]:
        window_start = _window_start(window)
        max_articles = 50000
        fetch_limit = min(limit * TRENDING_EXPANSION, max_articles)
        article_rows = await self._fetch_recent_articles(
            session, window_start, fetch_limit
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
        snapshot_detail = await self._get_cluster_detail_from_snapshot(
            session, cluster_id
        )
        if snapshot_detail:
            return snapshot_detail
        recent_detail = await self._get_cluster_detail_from_recent_windows(
            session, cluster_id
        )
        if recent_detail:
            return recent_detail
        return None

    async def get_article_topics(
        self, session: AsyncSession, article_id: int, limit: int = 5
    ) -> List[Dict[str, Any]]:
        if not self._get_vector_store():
            return []
        clusters = await self._build_clusters_from_anchors([article_id])
        cluster = clusters.get(article_id)
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
        ordered_article_ids = list(dict.fromkeys(article_ids))
        if not ordered_article_ids:
            return {}
        if not self._get_vector_store():
            return {article_id: [] for article_id in ordered_article_ids}

        clusters = await self._build_clusters_from_anchors(ordered_article_ids)
        if not clusters:
            return {article_id: [] for article_id in ordered_article_ids}

        all_member_ids: Set[int] = set()
        for cluster in clusters.values():
            all_member_ids.update(cluster.member_ids)

        articles_by_id = await self._fetch_articles(session, list(all_member_ids))
        cluster_payload_cache: Dict[tuple[int, ...], tuple[str, List[str]]] = {}
        topics: Dict[int, List[Dict[str, Any]]] = {}

        for article_id in ordered_article_ids:
            article_cluster: ClusterCandidate | None = clusters.get(article_id)
            if not article_cluster:
                topics[article_id] = []
                continue

            cluster_key = tuple(sorted(article_cluster.member_ids))
            payload = cluster_payload_cache.get(cluster_key)
            if payload is None:
                cluster_articles = {
                    member_id: article
                    for member_id, article in articles_by_id.items()
                    if member_id in article_cluster.member_ids
                }
                if not cluster_articles:
                    topics[article_id] = []
                    continue
                payload = (
                    self._generate_cluster_label(cluster_articles),
                    self._extract_keywords_from_articles(
                        list(cluster_articles.values())
                    ),
                )
                cluster_payload_cache[cluster_key] = payload

            label, keywords = payload
            similarity = article_cluster.similarities.get(article_id, 1.0)
            topics[article_id] = [
                {
                    "cluster_id": article_cluster.anchor_id,
                    "label": label,
                    "similarity": round(similarity, 3),
                    "keywords": keywords,
                }
            ]

        return topics

    async def _build_clusters_from_anchors(
        self, article_ids: Sequence[int]
    ) -> Dict[int, ClusterCandidate]:
        vector_store = self._get_vector_store()
        if not vector_store or not article_ids:
            return {}

        chroma_ids = [f"article_{article_id}" for article_id in article_ids]
        try:
            embedded = vector_store.collection.get(
                ids=chroma_ids,
                include=_get_chroma_include("embeddings"),
            )
            embedded_ids = cast(List[str], embedded.get("ids") or [])
            embedding_rows = _get_embedding_rows(embedded)
            if not embedded_ids or not embedding_rows:
                return {}

            resolved_article_ids: List[int] = []
            query_embeddings: List[List[float]] = []
            for chroma_id, raw_embedding in zip(embedded_ids, embedding_rows):
                if not chroma_id.startswith("article_"):
                    continue
                try:
                    article_id = int(chroma_id.replace("article_", ""))
                except ValueError:
                    continue

                if hasattr(raw_embedding, "tolist"):
                    query_embedding = cast(
                        List[float], cast(Any, raw_embedding).tolist()
                    )
                else:
                    query_embedding = list(cast(Sequence[float], raw_embedding))
                if not query_embedding:
                    continue
                resolved_article_ids.append(article_id)
                query_embeddings.append(query_embedding)

            if not resolved_article_ids:
                return {}

            result = vector_store.collection.query(
                query_embeddings=cast(
                    "list[Sequence[float] | Sequence[int]]",
                    query_embeddings,
                ),
                n_results=TRENDING_EXPANSION,
                include=_get_chroma_include("distances", "metadatas"),
            )
        except Exception as exc:
            logger.warning(
                "Failed to batch query article topics for %d anchors: %s",
                len(article_ids),
                exc,
            )
            return {}

        ids_batches = cast(List[List[str]], result.get("ids") or [])
        distance_batches = cast(
            List[List[Optional[float]]], result.get("distances") or []
        )
        clusters: Dict[int, ClusterCandidate] = {}

        for article_id, ids_batch, distances_batch in zip(
            resolved_article_ids,
            ids_batches,
            distance_batches,
        ):
            member_ids: List[int] = []
            similarities: Dict[int, float] = {}
            for member_chroma_id, distance in zip(ids_batch, distances_batch):
                if not member_chroma_id.startswith("article_"):
                    continue
                try:
                    member_id = int(member_chroma_id.replace("article_", ""))
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
                continue

            clusters[article_id] = ClusterCandidate(
                anchor_id=article_id,
                member_ids=member_ids,
                similarities=similarities,
            )

        return clusters

    async def get_search_suggestions(
        self, query: str, limit: int = 5
    ) -> List[Dict[str, Any]]:
        vector_store = self._get_vector_store()
        if not vector_store:
            return []
        results = vector_store.search_similar(query, limit=limit * 2)
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

    async def _get_cluster_detail_from_snapshot(
        self, session: AsyncSession, cluster_id: int
    ) -> Optional[Dict[str, Any]]:
        from app.services.cluster_cache import get_latest_snapshot

        best_match: Optional[Dict[str, Any]] = None
        for window in ("1w", "1d", "1m"):
            snapshot = await get_latest_snapshot(session, window)
            if snapshot is None:
                continue
            clusters_data = cast(List[Dict[str, Any]], snapshot.clusters_json or [])
            for cluster in clusters_data:
                if cluster.get("cluster_id") != cluster_id:
                    continue
                if best_match is None or cluster.get(
                    "article_count", 0
                ) > best_match.get("article_count", 0):
                    best_match = cluster

        if best_match is None:
            return None

        raw_articles = best_match.get("articles") or []
        articles = []
        for article in raw_articles:
            if not isinstance(article, dict):
                continue
            normalized_article = {**article}
            normalized_article.setdefault("similarity", 1.0)
            articles.append(normalized_article)
        published_dates = sorted(
            article["published_at"]
            for article in articles
            if article.get("published_at")
        )

        return {
            "id": cluster_id,
            "label": best_match.get("label") or "Topic",
            "keywords": best_match.get("keywords") or [],
            "article_count": best_match.get("article_count", len(articles)),
            "first_seen": published_dates[0] if published_dates else None,
            "last_seen": published_dates[-1] if published_dates else None,
            "is_active": True,
            "articles": articles,
        }

    async def _get_cluster_detail_from_recent_windows(
        self, session: AsyncSession, cluster_id: int
    ) -> Optional[Dict[str, Any]]:
        for window, limit in (("1d", 500), ("1w", 1500), ("1m", LEXICAL_MAX_ARTICLES)):
            article_rows = await self._fetch_recent_articles(
                session, _window_start(window), limit
            )
            if not article_rows:
                continue
            clusters = await self._cluster_articles(article_rows)
            candidate = self._find_cluster_candidate(clusters, cluster_id)
            if candidate is None:
                continue
            detail = await self._build_cluster_detail_payload(
                session, candidate, cluster_id=cluster_id
            )
            if detail:
                return detail
        return None

    def _find_cluster_candidate(
        self, clusters: Sequence[ClusterCandidate], cluster_id: int
    ) -> Optional[ClusterCandidate]:
        for cluster in clusters:
            if cluster.anchor_id == cluster_id:
                return cluster
        return None

    async def _build_cluster_detail_payload(
        self,
        session: AsyncSession,
        cluster: ClusterCandidate,
        cluster_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        cluster_articles = await self._fetch_articles(session, cluster.member_ids)
        if not cluster_articles:
            return None
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
            "id": cluster_id if cluster_id is not None else cluster.anchor_id,
            "label": label,
            "keywords": keywords,
            "article_count": len(cluster.member_ids),
            "first_seen": self._oldest_article_date(cluster_articles),
            "last_seen": self._latest_article_date(cluster_articles),
            "is_active": True,
            "articles": articles_payload,
        }

    async def compute_and_save_clusters(
        self,
        session: AsyncSession,
        windows: Sequence[str] = ("1d", "1w", "1m"),
        limit: int = 1000,
        min_articles: int = MIN_CLUSTER_SIZE,
    ) -> Dict[str, int]:
        """Compute clusters for each window and persist to Postgres.

        Called exclusively by the background computation worker — never by an
        API route.  Returns a dict mapping window → cluster count saved.

        When ChromaDB is unreachable or unstable, the service falls back to a
        lexical clustering strategy so snapshot updates continue.
        """
        from app.services.cluster_cache import save_snapshot

        if not is_chroma_reachable():
            logger.warning(
                "ChromaDB unreachable; using lexical fallback cluster computation"
            )

        counts: Dict[str, int] = {}
        for window in windows:
            try:
                clusters = await self.get_all_clusters(
                    session, window=window, min_articles=min_articles, limit=limit
                )
                # Serialize to plain dicts so they are JSON-safe for Postgres
                cluster_dicts = [{k: v for k, v in c.items()} for c in clusters]
                async with self._get_session_factory()() as write_session:
                    await save_snapshot(write_session, window, cluster_dicts)
                counts[window] = len(cluster_dicts)
                logger.info(
                    "Cluster computation done: window=%s count=%d",
                    window,
                    len(cluster_dicts),
                )
            except Exception as exc:
                logger.error(
                    "Cluster computation failed for window=%s: %s", window, exc
                )
        return counts

    async def _fetch_recent_articles(
        self, session: AsyncSession, since: datetime, limit: int
    ) -> List[Article]:
        # Do not filter by embedding_generated: after a Chroma drift reset all
        # flags are False even though Chroma still holds the vectors.  Articles
        # not present in Chroma are silently skipped by _build_cluster_from_anchor.
        result = await session.execute(
            select(Article)
            .where(Article.published_at >= since)
            .where(Article.content.isnot(None))
            .order_by(Article.published_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def _cluster_articles(
        self, articles: Sequence[Article]
    ) -> List[ClusterCandidate]:
        if not articles:
            return []
        article_window = list(articles[:LEXICAL_MAX_ARTICLES])
        if len(article_window) < len(articles):
            logger.info(
                "Clustering capped to %d newest articles (from %d)",
                len(article_window),
                len(articles),
            )

        if not USE_CHROMA_CLUSTER_QUERY:
            return self._cluster_articles_lexical(article_window)

        if not is_chroma_reachable():
            logger.warning(
                "ChromaDB not reachable; using lexical clustering fallback for %d articles",
                len(article_window),
            )
            return self._cluster_articles_lexical(article_window)

        candidates: List[ClusterCandidate] = []
        candidate_by_anchor: Dict[int, ClusterCandidate] = {}
        for index, article in enumerate(article_window):
            cluster = await self._build_cluster_from_anchor(
                article_id=self._article_id(article)
            )
            if not cluster or len(cluster.member_ids) < MIN_CLUSTER_SIZE:
                if (
                    index + 1 >= CHROMA_PROBE_LIMIT
                    and not candidates
                    and len(article_window) > CHROMA_PROBE_LIMIT
                ):
                    logger.warning(
                        "Chroma clustering probe produced no candidates; using lexical fallback"
                    )
                    return self._cluster_articles_lexical(article_window)
                continue
            candidates.append(cluster)
            candidate_by_anchor[cluster.anchor_id] = cluster

        if not candidates:
            logger.warning("No Chroma cluster candidates found; using lexical fallback")
            return self._cluster_articles_lexical(article_window)

        all_ids: Set[int] = set()
        for cluster in candidates:
            all_ids.update(cluster.member_ids)

        parent: Dict[int, int] = {article_id: article_id for article_id in all_ids}

        def find(article_id: int) -> int:
            root = article_id
            while parent[root] != root:
                root = parent[root]
            while parent[article_id] != article_id:
                next_id = parent[article_id]
                parent[article_id] = root
                article_id = next_id
            return root

        def union(a: int, b: int) -> None:
            root_a = find(a)
            root_b = find(b)
            if root_a != root_b:
                parent[root_b] = root_a

        for cluster in candidates:
            anchor_id = cluster.anchor_id
            for member_id in cluster.member_ids:
                union(anchor_id, member_id)

        components: Dict[int, Set[int]] = {}
        for article_id in parent.keys():
            root = find(article_id)
            components.setdefault(root, set()).add(article_id)

        clusters: List[ClusterCandidate] = []
        for members in components.values():
            if len(members) < MIN_CLUSTER_SIZE:
                continue
            anchors = [
                anchor_id for anchor_id in members if anchor_id in candidate_by_anchor
            ]
            if not anchors:
                anchor_id = min(members)
                similarities: Dict[int, float] = {}
            else:
                best_anchor = anchors[0]
                best_score = (-1, -1.0)
                for anchor_id in anchors:
                    candidate = candidate_by_anchor[anchor_id]
                    size_score = len(candidate.member_ids)
                    sim_total = sum(candidate.similarities.values())
                    sim_avg = sim_total / max(len(candidate.similarities), 1)
                    score = (size_score, sim_avg)
                    if score > best_score:
                        best_score = score
                        best_anchor = anchor_id
                anchor_id = best_anchor
                similarities = candidate_by_anchor[anchor_id].similarities

            clusters.append(
                ClusterCandidate(
                    anchor_id=anchor_id,
                    member_ids=list(members),
                    similarities=similarities,
                )
            )

        return clusters

    def _article_keyword_set(self, article: Article) -> Set[str]:
        return {keyword.lower() for keyword in self._extract_keywords(article)}

    def _passes_lexical_match(
        self, base_tokens: Set[str], candidate_tokens: Set[str]
    ) -> bool:
        if not base_tokens or not candidate_tokens:
            return False

        overlap = len(base_tokens & candidate_tokens)
        if overlap < LEXICAL_MIN_TOKEN_OVERLAP:
            return False

        union_size = len(base_tokens | candidate_tokens) or 1
        jaccard = overlap / union_size
        return jaccard >= LEXICAL_MIN_JACCARD or overlap >= (
            LEXICAL_MIN_TOKEN_OVERLAP + 1
        )

    def _normalize_keyword(self, value: str) -> str:
        normalized = value.strip("-/'\"")
        if len(normalized) > 5 and normalized.endswith("ies"):
            return normalized[:-3] + "y"
        if len(normalized) > 5 and normalized.endswith("es"):
            return normalized[:-2]
        if len(normalized) > 4 and normalized.endswith("s"):
            return normalized[:-1]
        if len(normalized) > 5 and normalized.endswith("ian"):
            return normalized[:-3]
        return normalized

    def _cluster_articles_lexical(
        self, articles: Sequence[Article]
    ) -> List[ClusterCandidate]:
        if not articles:
            return []

        article_list = list(articles)
        order_index = {
            self._article_id(article): idx for idx, article in enumerate(article_list)
        }
        keyword_sets: Dict[int, Set[str]] = {
            self._article_id(article): self._article_keyword_set(article)
            for article in article_list
        }

        token_to_article_ids: Dict[str, List[int]] = {}
        for article_id, token_set in keyword_sets.items():
            for token in token_set:
                token_to_article_ids.setdefault(token, []).append(article_id)

        parent: Dict[int, int] = {
            self._article_id(article): self._article_id(article)
            for article in article_list
        }

        def find(article_id: int) -> int:
            root = article_id
            while parent[root] != root:
                root = parent[root]
            while parent[article_id] != article_id:
                next_id = parent[article_id]
                parent[article_id] = root
                article_id = next_id
            return root

        def union(a: int, b: int) -> None:
            root_a = find(a)
            root_b = find(b)
            if root_a != root_b:
                parent[root_b] = root_a

        for article in article_list:
            article_id = self._article_id(article)
            base_tokens = keyword_sets.get(article_id, set())
            if len(base_tokens) < LEXICAL_MIN_TOKEN_OVERLAP:
                continue

            candidate_overlaps: Dict[int, int] = {}
            base_index = order_index[article_id]
            for token in base_tokens:
                neighbors = token_to_article_ids.get(token, [])
                if len(neighbors) > LEXICAL_MAX_TOKEN_POSTINGS:
                    continue
                for neighbor_id in neighbors:
                    if order_index[neighbor_id] <= base_index:
                        continue
                    candidate_overlaps[neighbor_id] = (
                        candidate_overlaps.get(neighbor_id, 0) + 1
                    )

            for neighbor_id, overlap in candidate_overlaps.items():
                if overlap < LEXICAL_MIN_TOKEN_OVERLAP:
                    continue
                neighbor_tokens = keyword_sets.get(neighbor_id, set())
                if self._passes_lexical_match(base_tokens, neighbor_tokens):
                    union(article_id, neighbor_id)

        components: Dict[int, Set[int]] = {}
        for article_id in parent.keys():
            root = find(article_id)
            components.setdefault(root, set()).add(article_id)

        clusters: List[ClusterCandidate] = []
        for members in components.values():
            if len(members) < MIN_CLUSTER_SIZE:
                continue

            ordered_members = sorted(
                members,
                key=lambda member_id: order_index.get(member_id, 0),
            )
            anchor_id = ordered_members[0]
            anchor_tokens = keyword_sets.get(anchor_id, set())
            filtered_members = [anchor_id]

            for member_id in ordered_members[1:]:
                member_tokens = keyword_sets.get(member_id, set())
                if self._passes_lexical_match(anchor_tokens, member_tokens):
                    filtered_members.append(member_id)

            if len(filtered_members) < MIN_CLUSTER_SIZE:
                continue

            similarities: Dict[int, float] = {}
            for member_id in filtered_members:
                if member_id == anchor_id:
                    similarities[member_id] = 1.0
                    continue
                member_tokens = keyword_sets.get(member_id, set())
                if not anchor_tokens or not member_tokens:
                    similarities[member_id] = 0.0
                    continue
                overlap = len(anchor_tokens & member_tokens)
                union_size = len(anchor_tokens | member_tokens) or 1
                similarities[member_id] = round(overlap / union_size, 3)

            clusters.append(
                ClusterCandidate(
                    anchor_id=anchor_id,
                    member_ids=filtered_members,
                    similarities=similarities,
                )
            )

        logger.info(
            "Lexical fallback produced %d clusters from %d articles",
            len(clusters),
            len(article_list),
        )
        return clusters

    async def _build_cluster_from_anchor(
        self, article_id: int = 0
    ) -> Optional[ClusterCandidate]:
        vector_store = self._get_vector_store()
        if not vector_store:
            return None
        chroma_id = f"article_{article_id}"
        try:
            embedded = vector_store.collection.get(
                ids=[chroma_id],
                include=_get_chroma_include("embeddings"),
            )
            embeddings = embedded.get("embeddings") if embedded else None
            if embeddings is None or len(embeddings) == 0:
                return None
            query_embedding_raw = embeddings[0]
            if len(query_embedding_raw) == 0:
                return None
            if isinstance(query_embedding_raw, list):
                query_embedding = query_embedding_raw
            elif hasattr(query_embedding_raw, "tolist"):
                query_embedding = cast(
                    List[float], cast(Any, query_embedding_raw).tolist()
                )
            else:
                query_embedding = list(query_embedding_raw)

            result = vector_store.collection.query(
                query_embeddings=cast(
                    "list[Sequence[float] | Sequence[int]]",
                    [query_embedding],
                ),
                n_results=TRENDING_EXPANSION,
                include=_get_chroma_include("distances", "metadatas"),
            )
        except Exception as exc:
            logger.warning("Failed to query cluster for %s: %s", article_id, exc)
            return None

        ids_batches = result.get("ids") if result else None
        distance_batches = result.get("distances") if result else None
        ids = ids_batches[0] if ids_batches else []
        distances = distance_batches[0] if distance_batches else []
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
        return {self._article_id(article): article for article in articles}

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
            "source_id": "-".join(article.source.lower().split())
            if article.source
            else None,
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
            return cast(str, scored_articles[0][0].title)

        # Fallback: try to find any valid title
        for article in articles.values():
            if article.title and len(article.title.strip()) > 10:
                return article.title.strip()

        return "Topic"

    def _extract_keywords(self, article: Article) -> List[str]:
        text = f"{article.title or ''}".lower()
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
            "and",
            "or",
            "but",
            "not",
            "its",
            "into",
            "their",
            "than",
            "that",
            "have",
            "has",
            "had",
            "from",
        }
        words = re.findall(r"[a-z0-9][a-z0-9'\-/]+", text)
        keywords: List[str] = []
        seen: Set[str] = set()
        for word in words:
            normalized = self._normalize_keyword(word)
            if len(normalized) <= 3:
                continue
            if normalized in stopwords or normalized in GENERIC_CLUSTER_TOKENS:
                continue
            if normalized.isdigit():
                continue
            if normalized not in seen:
                seen.add(normalized)
                keywords.append(normalized)
            if len(keywords) >= 10:
                break
        return keywords

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


async def cluster_computation_worker(
    interval_seconds: int = 300,
    startup_delay_seconds: int = 30,
) -> None:
    """Periodic background task: compute topic clusters and persist to Postgres.

    Waits for the chroma_sync worker to signal that the initial backfill pass
    is complete before running for the first time.  This ensures clusters are
    computed against a fully populated Chroma store.  Subsequent runs happen
    every interval_seconds.

    ChromaDB errors skip the run without crashing; the previous snapshot
    remains available to the API.
    """
    import asyncio
    from app.core.config import settings
    from app.database import AsyncSessionLocal
    from app.services.chroma_sync import sync_caught_up

    logger.info(
        "Cluster computation worker starting (delay=%ds, interval=%ds)",
        startup_delay_seconds,
        interval_seconds,
    )
    await asyncio.sleep(startup_delay_seconds)

    # Wait for the sync worker to confirm Chroma is populated before the first
    # cluster computation.  Cap the wait so we don't block indefinitely if the
    # sync worker is stuck or disabled.
    MAX_SYNC_WAIT_SECONDS = 60
    logger.info("Waiting for Chroma sync to complete before first cluster run...")
    try:
        await asyncio.wait_for(sync_caught_up.wait(), timeout=MAX_SYNC_WAIT_SECONDS)
        logger.info("Chroma sync ready; starting cluster computation.")
    except asyncio.TimeoutError:
        logger.warning(
            "Chroma sync did not complete within %ds; running clusters anyway.",
            MAX_SYNC_WAIT_SECONDS,
        )

    service = ChromaTopicService()

    while True:
        try:
            if settings.enable_database and AsyncSessionLocal is not None:
                async with service._get_session_factory()() as session:
                    counts = await service.compute_and_save_clusters(session)
                    if counts:
                        logger.info("Cluster snapshots saved: %s", counts)
        except Exception as exc:
            logger.error("Cluster computation worker error: %s", exc)

        await asyncio.sleep(interval_seconds)
