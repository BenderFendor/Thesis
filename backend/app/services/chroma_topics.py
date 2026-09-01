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
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article, GDELTEvent, get_utc_now
from app.services.gdelt_aggregates import build_article_gdelt_context
from app.services.rss_parser_rust_bindings import (
    extract_keywords_from_titles_rust,
    extract_keywords_rust,
    generate_cluster_label_rust,
    lexical_cluster,
)
from app.vector_store import (
    VectorStore,
    _get_chroma_include,
    _get_embedding_rows,
    get_vector_store,
    is_chroma_reachable,
)

logger = get_logger("chroma_topics")

_RECOVERABLE_TOPIC_ERRORS = (
    AttributeError,
    ImportError,
    LookupError,
    OSError,
    RuntimeError,
    SQLAlchemyError,
    TypeError,
    ValueError,
)

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
    """Cluster Candidate."""

    anchor_id: int
    member_ids: list[int]
    similarities: dict[int, float]


class _ArticleUnionFind:
    def __init__(self, article_ids: Iterable[int]) -> None:
        self.parent = {article_id: article_id for article_id in article_ids}

    def find(self, article_id: int) -> int:
        root = article_id
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[article_id] != article_id:
            next_id = self.parent[article_id]
            self.parent[article_id] = root
            article_id = next_id
        return root

    def union(self, first: int, second: int) -> None:
        root_first = self.find(first)
        root_second = self.find(second)
        if root_first != root_second:
            self.parent[root_second] = root_first


def _window_start(window: str) -> datetime:
    now = get_utc_now()
    if window == "1w":
        return now - timedelta(weeks=1)
    if window == "1m":
        return now - timedelta(days=30)
    return now - timedelta(days=1)


def _resolve_query_embeddings(
    embedded_ids: list[str],
    embedding_rows: list[Any],
) -> tuple[list[int], list[list[float]]]:
    resolved_article_ids: list[int] = []
    query_embeddings: list[list[float]] = []
    for chroma_id, raw_embedding in zip(embedded_ids, embedding_rows, strict=False):
        if not chroma_id.startswith("article_"):
            continue
        try:
            article_id = int(chroma_id.replace("article_", ""))
        except ValueError:
            continue

        if hasattr(raw_embedding, "tolist"):
            query_embedding = cast(list[float], cast(Any, raw_embedding).tolist())
        else:
            query_embedding = list(cast(Sequence[float], raw_embedding))
        if not query_embedding:
            continue
        resolved_article_ids.append(article_id)
        query_embeddings.append(query_embedding)
    return resolved_article_ids, query_embeddings


def _clusters_from_ids_batches(
    resolved_article_ids: list[int],
    ids_batches: list[list[str]],
    distance_batches: list[list[float | None]],
) -> dict[int, ClusterCandidate]:
    clusters: dict[int, ClusterCandidate] = {}
    for article_id, ids_batch, distances_batch in zip(
        resolved_article_ids,
        ids_batches,
        distance_batches,
        strict=False,
    ):
        member_ids, similarities = _cluster_members(ids_batch, distances_batch)

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


def _cluster_members(
    ids_batch: Sequence[str],
    distances_batch: Sequence[float | None],
) -> tuple[list[int], dict[int, float]]:
    member_ids: list[int] = []
    similarities: dict[int, float] = {}
    for member_chroma_id, distance in zip(ids_batch, distances_batch, strict=False):
        if not member_chroma_id.startswith("article_"):
            continue
        try:
            member_id = int(member_chroma_id.removeprefix("article_"))
        except ValueError:
            continue
        similarity = 1 - distance if distance is not None else 0.0
        if similarity < SIMILARITY_THRESHOLD:
            continue
        member_ids.append(member_id)
        similarities[member_id] = similarity
    return member_ids, similarities


def _embedding_for_article(embedded: Any) -> list[float] | None:
    embeddings = embedded.get("embeddings") if embedded else None
    if embeddings is None or len(embeddings) == 0:
        return None
    query_embedding_raw = embeddings[0]
    if len(query_embedding_raw) == 0:
        return None
    if isinstance(query_embedding_raw, list):
        return query_embedding_raw
    if hasattr(query_embedding_raw, "tolist"):
        return cast(list[float], cast(Any, query_embedding_raw).tolist())
    return list(query_embedding_raw)


def _select_cluster_anchor(
    members: set[int],
    candidate_by_anchor: dict[int, ClusterCandidate],
) -> tuple[int, dict[int, float]]:
    anchors = [anchor_id for anchor_id in members if anchor_id in candidate_by_anchor]
    if not anchors:
        return min(members), {}

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
    return best_anchor, candidate_by_anchor[best_anchor].similarities


def _merge_candidate_clusters(
    candidates: Sequence[ClusterCandidate],
    candidate_by_anchor: dict[int, ClusterCandidate],
) -> list[ClusterCandidate]:
    all_ids = {article_id for cluster in candidates for article_id in cluster.member_ids}
    union_find = _ArticleUnionFind(all_ids)
    for cluster in candidates:
        for member_id in cluster.member_ids:
            union_find.union(cluster.anchor_id, member_id)

    components: dict[int, set[int]] = {}
    for article_id in union_find.parent:
        root = union_find.find(article_id)
        components.setdefault(root, set()).add(article_id)

    clusters = []
    for members in components.values():
        if len(members) < MIN_CLUSTER_SIZE:
            continue
        anchor_id, similarities = _select_cluster_anchor(members, candidate_by_anchor)
        clusters.append(
            ClusterCandidate(
                anchor_id=anchor_id,
                member_ids=list(members),
                similarities=similarities,
            )
        )
    return clusters


def _normalize_snapshot_articles(raw_articles: list[Any]) -> list[dict[str, Any]]:
    articles: list[dict[str, Any]] = []
    for article in raw_articles:
        if not isinstance(article, dict):
            continue
        normalized_article = {**article}
        normalized_article.setdefault("similarity", 1.0)
        normalized_article.setdefault("gdelt_context", None)
        articles.append(normalized_article)
    return articles


def _attach_article_gdelt_context(
    article: dict[str, Any],
    events_by_article: dict[int, list[dict[str, Any]]],
    tone_baseline_avg: float | None,
) -> dict[str, Any]:
    article_id = article.get("id")
    if article_id is None:
        article.setdefault("gdelt_context", None)
        return article
    context = build_article_gdelt_context(
        events_by_article.get(int(article_id), []),
        tone_baseline_avg=tone_baseline_avg,
    )
    article["gdelt_context"] = context
    return article


def _set_cluster_gdelt_context(
    payload: dict[str, Any], cluster_context: dict[str, Any] | None
) -> None:
    if cluster_context is not None:
        payload["gdelt_context"] = cluster_context
    else:
        payload.setdefault("gdelt_context", None)


def _attach_payload_article_context(
    payload: dict[str, Any],
    events_by_article: dict[int, list[dict[str, Any]]],
    tone_baseline_avg: float | None,
) -> None:
    representative = payload.get("representative_article")
    if isinstance(representative, dict):
        payload["representative_article"] = _attach_article_gdelt_context(
            representative, events_by_article, tone_baseline_avg
        )

    payload["articles"] = [
        _attach_article_gdelt_context(article, events_by_article, tone_baseline_avg)
        for article in cast(list[dict[str, Any]], payload.get("articles") or [])
        if isinstance(article, dict)
    ]


def _cluster_gdelt_events(
    article_ids: Sequence[int], events_by_article: dict[int, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    return [event for article_id in article_ids for event in events_by_article.get(article_id, [])]


def _cluster_tone_baseline(cluster_context: dict[str, Any] | None) -> float | None:
    return cluster_context.get("tone_avg") if cluster_context is not None else None


def _should_fallback_after_chroma_probe(
    index: int, candidates: Sequence[ClusterCandidate], article_count: int
) -> bool:
    return index + 1 >= CHROMA_PROBE_LIMIT and not candidates and article_count > CHROMA_PROBE_LIMIT


def _payload_articles(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [
        payload.get("representative_article"),
        *cast(list[dict[str, Any]], payload.get("articles") or []),
    ]
    return [
        article
        for article in candidates
        if isinstance(article, dict) and article.get("id") is not None
    ]


def _payload_article_ids(articles: Sequence[dict[str, Any]]) -> list[int]:
    return list(dict.fromkeys(int(article["id"]) for article in articles))


def _title_length_score(length: int) -> float:
    if 40 <= length <= 100:
        return 10.0
    if 30 <= length < 40:
        return 7.0
    if 100 < length <= 140:
        return 6.0
    if length < 30:
        return 3.0
    return 1.0


def _title_credibility_score(credibility: str | None) -> float:
    return {"high": 5.0, "medium": 2.0}.get(credibility, 0.0)


def _title_recency_score(published_at: datetime | None) -> float:
    if not published_at:
        return 0.0
    age_hours = (get_utc_now() - published_at).total_seconds() / 3600
    if age_hours < 6:
        return 3.0
    if age_hours < 24:
        return 2.0
    if age_hours < 72:
        return 1.0
    return 0.0


def _title_generic_term_penalty(title: str) -> float:
    generic_terms = ("breaking", "update", "news alert", "developing")
    return -5.0 * sum(term in title.lower() for term in generic_terms)


def _title_capitalization_score(title: str) -> float:
    capitalized = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b", title)
    return min(len(capitalized) * 1.5, 8.0)


def _limit_cluster_articles(articles: Sequence[Article]) -> list[Article]:
    article_window = list(articles[:LEXICAL_MAX_ARTICLES])
    if len(article_window) < len(articles):
        logger.info(
            "Clustering capped to %d newest articles (from %d)",
            len(article_window),
            len(articles),
        )
    return article_window


def _query_anchor_embeddings(
    vector_store: Any,
    article_ids: Sequence[int],
) -> tuple[list[int], dict[str, Any]] | None:
    chroma_ids = [f"article_{article_id}" for article_id in article_ids]
    try:
        embedded = vector_store.collection.get(
            ids=chroma_ids,
            include=_get_chroma_include("embeddings"),
        )
        embedded_ids = cast(list[str], embedded.get("ids") or [])
        embedding_rows = _get_embedding_rows(embedded)
        if not embedded_ids or not embedding_rows:
            return None

        resolved_article_ids, query_embeddings = _resolve_query_embeddings(
            embedded_ids, embedding_rows
        )
        if not resolved_article_ids:
            return None
        result = vector_store.collection.query(
            query_embeddings=cast(
                "list[Sequence[float] | Sequence[int]]",
                query_embeddings,
            ),
            n_results=TRENDING_EXPANSION,
            include=_get_chroma_include("distances", "metadatas"),
        )
    except _RECOVERABLE_TOPIC_ERRORS as exc:
        logger.warning(
            "Failed to batch query article topics for %d anchors: %s",
            len(article_ids),
            exc,
        )
        return None
    return resolved_article_ids, result


class ChromaTopicService:
    """Chroma Topic Service."""

    def __init__(self) -> None:
        """Initialize."""

    @property
    def vector_store(self) -> VectorStore | None:
        """Vector Store."""
        return self._get_vector_store()

    def _get_vector_store(self) -> VectorStore | None:
        """Return the current vector store, refreshing from the module-level singleton."""
        return get_vector_store()

    def _article_id(self, article: Article) -> int:
        return cast(int, article.id)

    @staticmethod
    def _event_context_rows(events: Sequence[GDELTEvent]) -> list[dict[str, Any]]:
        return [
            {
                "event_root_code": event.event_root_code,
                "tone": event.tone,
                "goldstein_scale": event.goldstein_scale,
            }
            for event in events
        ]

    async def _fetch_article_gdelt_events(
        self, session: AsyncSession, article_ids: Sequence[int]
    ) -> dict[int, list[dict[str, Any]]]:
        if not article_ids:
            return {}

        result = await session.execute(
            select(GDELTEvent)
            .where(GDELTEvent.article_id.in_(list(article_ids)))
            .order_by(GDELTEvent.published_at.desc())
        )
        events_by_article: dict[int, list[dict[str, Any]]] = {}
        for event in result.scalars().all():
            if event.article_id is None:
                continue
            events_by_article.setdefault(event.article_id, []).append(
                {
                    "event_root_code": event.event_root_code,
                    "tone": event.tone,
                    "goldstein_scale": event.goldstein_scale,
                }
            )
        return events_by_article

    async def _attach_gdelt_context(
        self,
        session: AsyncSession,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        articles = _payload_articles(payload)
        if not articles:
            payload.setdefault("gdelt_context", None)
            return payload

        return await self._attach_gdelt_context_to_articles(session, payload, articles)

    async def _attach_gdelt_context_to_articles(
        self,
        session: AsyncSession,
        payload: dict[str, Any],
        articles: Sequence[dict[str, Any]],
    ) -> dict[str, Any]:
        article_ids = _payload_article_ids(articles)
        events_by_article = await self._fetch_article_gdelt_events(session, article_ids)
        cluster_events = _cluster_gdelt_events(article_ids, events_by_article)
        cluster_context = build_article_gdelt_context(cluster_events)
        tone_baseline_avg = _cluster_tone_baseline(cluster_context)
        _set_cluster_gdelt_context(payload, cluster_context)
        _attach_payload_article_context(payload, events_by_article, tone_baseline_avg)
        return payload

    @staticmethod
    def _get_session_factory() -> Any:
        from app.database import AsyncSessionLocal

        return cast(Any, AsyncSessionLocal)

    async def get_trending_clusters(
        self, session: AsyncSession, window: str = "1d", limit: int = 10
    ) -> list[dict[str, Any]]:
        """Get Trending Clusters."""
        window_start = _window_start(window)
        max_articles = 200
        fetch_limit = min(limit * TRENDING_EXPANSION, max_articles)
        article_rows = await self._fetch_recent_articles(session, window_start, fetch_limit)
        clusters = await self._cluster_articles(article_rows)
        return await self._build_trending_clusters(session, clusters, window_start, limit)

    async def get_breaking_clusters(
        self, session: AsyncSession, limit: int = 5
    ) -> list[dict[str, Any]]:
        """Get Breaking Clusters."""
        window_start = get_utc_now() - timedelta(hours=BREAKING_WINDOW_HOURS)
        max_articles = 100
        fetch_limit = min(limit * TRENDING_EXPANSION, max_articles)
        article_rows = await self._fetch_recent_articles(session, window_start, fetch_limit)
        clusters = await self._cluster_articles(article_rows)
        return await self._build_breaking_clusters(session, clusters, limit)

    async def get_all_clusters(
        self,
        session: AsyncSession,
        window: str = "1d",
        min_articles: int = MIN_CLUSTER_SIZE,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Get All Clusters."""
        window_start = _window_start(window)
        max_articles = 50000
        fetch_limit = min(limit * TRENDING_EXPANSION, max_articles)
        article_rows = await self._fetch_recent_articles(session, window_start, fetch_limit)
        clusters = await self._cluster_articles(article_rows)
        results = []
        for cluster in clusters:
            if len(cluster.member_ids) < min_articles:
                continue
            cluster_articles = await self._fetch_articles(session, cluster.member_ids)
            if not cluster_articles:
                continue
            representative = cluster_articles[cluster.anchor_id]
            payload = {
                "cluster_id": cluster.anchor_id,
                "label": self._generate_cluster_label(cluster_articles),
                "keywords": self._extract_keywords_from_articles(list(cluster_articles.values())),
                "article_count": len(cluster.member_ids),
                "window_count": len(cluster.member_ids),
                "source_diversity": len({a.source for a in cluster_articles.values() if a.source}),
                "representative_article": self._serialize_article(representative),
                "articles": self._serialize_recent_articles(cluster_articles),
            }
            results.append(await self._attach_gdelt_context(session, payload))
            if len(results) >= limit:
                break
        return results

    async def get_cluster_detail(
        self, session: AsyncSession, cluster_id: int
    ) -> dict[str, Any] | None:
        """Get Cluster Detail."""
        snapshot_detail = await self._get_cluster_detail_from_snapshot(session, cluster_id)
        if snapshot_detail:
            return snapshot_detail
        recent_detail = await self._get_cluster_detail_from_recent_windows(session, cluster_id)
        if recent_detail:
            return recent_detail
        return None

    async def get_article_topics(
        self, session: AsyncSession, article_id: int, limit: int = 5
    ) -> list[dict[str, Any]]:
        """Get Article Topics."""
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
    ) -> dict[int, list[dict[str, Any]]]:
        """Get Bulk Article Topics."""
        ordered_article_ids = list(dict.fromkeys(article_ids))
        if not ordered_article_ids:
            return {}
        if not self._get_vector_store():
            return {article_id: [] for article_id in ordered_article_ids}

        clusters = await self._build_clusters_from_anchors(ordered_article_ids)
        if not clusters:
            return {article_id: [] for article_id in ordered_article_ids}

        all_member_ids: set[int] = set()
        for cluster in clusters.values():
            all_member_ids.update(cluster.member_ids)

        articles_by_id = await self._fetch_articles(session, list(all_member_ids))
        cluster_payload_cache: dict[tuple[int, ...], tuple[str, list[str]]] = {}
        return {
            article_id: self._bulk_topic_entry(
                article_id,
                clusters,
                articles_by_id,
                cluster_payload_cache,
            )
            for article_id in ordered_article_ids
        }

    def _cluster_topic_payload(
        self,
        cluster: ClusterCandidate,
        articles_by_id: dict[int, Article],
        cache: dict[tuple[int, ...], tuple[str, list[str]]],
    ) -> tuple[str, list[str]] | None:
        cluster_key = tuple(sorted(cluster.member_ids))
        cached = cache.get(cluster_key)
        if cached is not None:
            return cached
        cluster_articles = {
            member_id: article
            for member_id, article in articles_by_id.items()
            if member_id in cluster.member_ids
        }
        if not cluster_articles:
            return None
        payload = (
            self._generate_cluster_label(cluster_articles),
            self._extract_keywords_from_articles(list(cluster_articles.values())),
        )
        cache[cluster_key] = payload
        return payload

    def _bulk_topic_entry(
        self,
        article_id: int,
        clusters: dict[int, ClusterCandidate],
        articles_by_id: dict[int, Article],
        cache: dict[tuple[int, ...], tuple[str, list[str]]],
    ) -> list[dict[str, Any]]:
        article_cluster = clusters.get(article_id)
        if article_cluster is None:
            return []
        payload = self._cluster_topic_payload(article_cluster, articles_by_id, cache)
        if payload is None:
            return []
        label, keywords = payload
        similarity = article_cluster.similarities.get(article_id, 1.0)
        return [
            {
                "cluster_id": article_cluster.anchor_id,
                "label": label,
                "similarity": round(similarity, 3),
                "keywords": keywords,
            }
        ]

    async def _build_clusters_from_anchors(
        self, article_ids: Sequence[int]
    ) -> dict[int, ClusterCandidate]:
        vector_store = self._get_vector_store()
        if not vector_store or not article_ids:
            return {}
        query_result = _query_anchor_embeddings(vector_store, article_ids)
        if query_result is None:
            return {}
        resolved_article_ids, result = query_result
        ids_batches = cast(list[list[str]], result.get("ids") or [])
        distance_batches = cast(list[list[float | None]], result.get("distances") or [])
        return _clusters_from_ids_batches(resolved_article_ids, ids_batches, distance_batches)

    async def get_search_suggestions(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Get Search Suggestions."""
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

    async def get_trending_stats(self, session: AsyncSession) -> dict[str, Any]:
        """Get Trending Stats."""
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
        """Get Cluster External Count."""
        if not article_ids:
            return 0
        result = await session.execute(
            select(func.count(GDELTEvent.id)).where(GDELTEvent.article_id.in_(list(article_ids)))
        )
        return result.scalar() or 0

    async def _find_best_snapshot_cluster(
        self, session: AsyncSession, cluster_id: int
    ) -> dict[str, Any] | None:
        from app.services.cluster_cache import get_latest_snapshot

        best_match: dict[str, Any] | None = None
        for window in ("1w", "1d", "1m"):
            snapshot = await get_latest_snapshot(session, window)
            if snapshot is None:
                continue
            clusters_data = cast(list[dict[str, Any]], snapshot.clusters_json or [])
            for cluster in clusters_data:
                if cluster.get("cluster_id") != cluster_id:
                    continue
                if best_match is None or cluster.get("article_count", 0) > best_match.get(
                    "article_count", 0
                ):
                    best_match = cluster
        return best_match

    def _snapshot_cluster_payload(self, cluster_id: int, cluster: dict[str, Any]) -> dict[str, Any]:
        articles = _normalize_snapshot_articles(cluster.get("articles") or [])
        published_dates = sorted(
            article["published_at"] for article in articles if article.get("published_at")
        )
        return {
            "id": cluster_id,
            "label": cluster.get("label") or "Topic",
            "keywords": cluster.get("keywords") or [],
            "article_count": cluster.get("article_count", len(articles)),
            "first_seen": published_dates[0] if published_dates else None,
            "last_seen": published_dates[-1] if published_dates else None,
            "is_active": True,
            "gdelt_context": cluster.get("gdelt_context"),
            "articles": articles,
        }

    async def _get_cluster_detail_from_snapshot(
        self, session: AsyncSession, cluster_id: int
    ) -> dict[str, Any] | None:
        best_match = await self._find_best_snapshot_cluster(session, cluster_id)
        return (
            None if best_match is None else self._snapshot_cluster_payload(cluster_id, best_match)
        )

    async def _get_cluster_detail_from_recent_windows(
        self, session: AsyncSession, cluster_id: int
    ) -> dict[str, Any] | None:
        for window, limit in (("1d", 500), ("1w", 1500), ("1m", LEXICAL_MAX_ARTICLES)):
            article_rows = await self._fetch_recent_articles(session, _window_start(window), limit)
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
    ) -> ClusterCandidate | None:
        for cluster in clusters:
            if cluster.anchor_id == cluster_id:
                return cluster
        return None

    async def _build_cluster_detail_payload(
        self,
        session: AsyncSession,
        cluster: ClusterCandidate,
        cluster_id: int | None = None,
    ) -> dict[str, Any] | None:
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
                    "similarity": round(similarity, 3) if similarity is not None else 0.0,
                }
            )
        payload = {
            "id": cluster_id if cluster_id is not None else cluster.anchor_id,
            "label": label,
            "keywords": keywords,
            "article_count": len(cluster.member_ids),
            "first_seen": self._oldest_article_date(cluster_articles),
            "last_seen": self._latest_article_date(cluster_articles),
            "is_active": True,
            "articles": articles_payload,
        }
        return await self._attach_gdelt_context(session, payload)

    async def compute_and_save_clusters(
        self,
        session: AsyncSession,
        windows: Sequence[str] = ("1d", "1w", "1m"),
        limit: int = 1000,
        min_articles: int = MIN_CLUSTER_SIZE,
    ) -> dict[str, int]:
        """Compute clusters for each window and persist to Postgres.

        Called exclusively by the background computation worker — never by an
        API route.  Returns a dict mapping window → cluster count saved.

        When ChromaDB is unreachable or unstable, the service falls back to a
        lexical clustering strategy so snapshot updates continue.
        """
        from app.services.cluster_cache import save_snapshot

        if not is_chroma_reachable():
            logger.warning("ChromaDB unreachable; using lexical fallback cluster computation")

        counts: dict[str, int] = {}
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
            except _RECOVERABLE_TOPIC_ERRORS as exc:
                logger.error("Cluster computation failed for window=%s: %s", window, exc)
        return counts

    async def _fetch_recent_articles(
        self, session: AsyncSession, since: datetime, limit: int
    ) -> list[Article]:
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

    async def _cluster_articles(self, articles: Sequence[Article]) -> list[ClusterCandidate]:
        if not articles:
            return []
        article_window = _limit_cluster_articles(articles)

        if not USE_CHROMA_CLUSTER_QUERY:
            return self._cluster_articles_lexical(article_window)

        return await self._cluster_articles_chroma(article_window)

    async def _cluster_articles_chroma(
        self, article_window: Sequence[Article]
    ) -> list[ClusterCandidate]:
        if not is_chroma_reachable():
            logger.warning(
                "ChromaDB not reachable; using lexical clustering fallback for %d articles",
                len(article_window),
            )
            return self._cluster_articles_lexical(article_window)

        collected = await self._collect_chroma_candidates(article_window)
        if collected is None:
            logger.warning("Chroma clustering probe produced no candidates; using lexical fallback")
            return self._cluster_articles_lexical(article_window)

        candidates, candidate_by_anchor = collected
        if not candidates:
            logger.warning("No Chroma cluster candidates found; using lexical fallback")
            return self._cluster_articles_lexical(article_window)

        return _merge_candidate_clusters(candidates, candidate_by_anchor)

    async def _collect_chroma_candidates(
        self, article_window: Sequence[Article]
    ) -> tuple[list[ClusterCandidate], dict[int, ClusterCandidate]] | None:
        candidates: list[ClusterCandidate] = []
        candidate_by_anchor: dict[int, ClusterCandidate] = {}
        for index, article in enumerate(article_window):
            cluster = await self._build_cluster_from_anchor(article_id=self._article_id(article))
            if not cluster or len(cluster.member_ids) < MIN_CLUSTER_SIZE:
                if _should_fallback_after_chroma_probe(index, candidates, len(article_window)):
                    return None
                continue
            candidates.append(cluster)
            candidate_by_anchor[cluster.anchor_id] = cluster
        return candidates, candidate_by_anchor

    def _article_keyword_set(self, article: Article) -> set[str]:
        return {keyword.lower() for keyword in self._extract_keywords(article)}

    def _passes_lexical_match(self, base_tokens: set[str], candidate_tokens: set[str]) -> bool:
        if not base_tokens or not candidate_tokens:
            return False

        overlap = len(base_tokens & candidate_tokens)
        if overlap < LEXICAL_MIN_TOKEN_OVERLAP:
            return False

        union_size = (len(base_tokens) + len(candidate_tokens) - overlap) or 1
        jaccard = overlap / union_size
        return jaccard >= LEXICAL_MIN_JACCARD or overlap >= (LEXICAL_MIN_TOKEN_OVERLAP + 1)

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

    def _cluster_articles_lexical(self, articles: Sequence[Article]) -> list[ClusterCandidate]:
        if not articles:
            return []

        article_list = list(articles)
        rust_input: list[tuple[int, str, int]] = [
            (
                self._article_id(article),
                article.title or "",
                idx,
            )
            for idx, article in enumerate(article_list)
        ]
        rust_result = lexical_cluster(rust_input)

        clusters: list[ClusterCandidate] = []
        for entry in rust_result:
            member_ids = [int(m) for m in cast(list[int], entry.get("member_ids", []))]
            similarities = {
                int(k): float(v)
                for k, v in cast(dict[int, float], entry.get("similarities", {})).items()
            }
            clusters.append(
                ClusterCandidate(
                    anchor_id=int(entry["anchor_id"]),
                    member_ids=member_ids,
                    similarities=similarities,
                )
            )
        logger.info(
            "Rust lexical clustering produced %d clusters from %d articles",
            len(clusters),
            len(article_list),
        )
        return clusters

    async def _build_cluster_from_anchor(self, article_id: int = 0) -> ClusterCandidate | None:
        vector_store = self._get_vector_store()
        if not vector_store:
            return None
        chroma_id = f"article_{article_id}"
        try:
            embedded = vector_store.collection.get(
                ids=[chroma_id],
                include=_get_chroma_include("embeddings"),
            )
            query_embedding = _embedding_for_article(embedded)
            if query_embedding is None:
                return None

            result = vector_store.collection.query(
                query_embeddings=cast(
                    "list[Sequence[float] | Sequence[int]]",
                    [query_embedding],
                ),
                n_results=TRENDING_EXPANSION,
                include=_get_chroma_include("distances", "metadatas"),
            )
        except _RECOVERABLE_TOPIC_ERRORS as exc:
            logger.warning("Failed to query cluster for %s: %s", article_id, exc)
            return None

        ids_batches = result.get("ids") if result else None
        distance_batches = result.get("distances") if result else None
        ids = ids_batches[0] if ids_batches else []
        distances = distance_batches[0] if distance_batches else []
        return _clusters_from_ids_batches([article_id], [ids], [distances]).get(article_id)

    async def _fetch_articles(
        self, session: AsyncSession, article_ids: Sequence[int]
    ) -> dict[int, Article]:
        if not article_ids:
            return {}
        result = await session.execute(select(Article).where(Article.id.in_(list(article_ids))))
        articles = result.scalars().all()
        return {self._article_id(article): article for article in articles}

    async def _build_trending_clusters(
        self,
        session: AsyncSession,
        clusters: Sequence[ClusterCandidate],
        window_start: datetime,
        limit: int,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for cluster in clusters:
            result = await self._build_trending_cluster(session, cluster, window_start)
            if result is None:
                continue
            results.append(result)
            if len(results) >= limit:
                break
        results.sort(key=lambda x: x["trending_score"], reverse=True)
        return results[:limit]

    async def _build_trending_cluster(
        self,
        session: AsyncSession,
        cluster: ClusterCandidate,
        window_start: datetime,
    ) -> dict[str, Any] | None:
        cluster_articles = await self._fetch_articles(session, cluster.member_ids)
        if not cluster_articles:
            return None
        representative = cluster_articles.get(cluster.anchor_id)
        if not representative:
            return None
        window_count = sum(
            1
            for article in cluster_articles.values()
            if article.published_at and article.published_at >= window_start
        )
        source_diversity = len(
            {article.source for article in cluster_articles.values() if article.source}
        )
        external_count = await self.get_cluster_external_count(session, cluster.member_ids)
        velocity = float(window_count)
        recency_bonus = self._recency_bonus(representative.published_at)
        external_bonus = 1 + (external_count * 0.05)
        trending_score = velocity * (1 + source_diversity * 0.1) * recency_bonus * external_bonus
        result = {
            "cluster_id": cluster.anchor_id,
            "label": self._generate_cluster_label(cluster_articles),
            "keywords": self._extract_keywords_from_articles(list(cluster_articles.values())),
            "article_count": len(cluster.member_ids),
            "window_count": window_count,
            "source_diversity": source_diversity,
            "trending_score": round(trending_score, 2),
            "velocity": round(velocity, 2),
            "representative_article": self._serialize_article(representative),
            "articles": self._serialize_recent_articles(cluster_articles),
        }
        return await self._attach_gdelt_context(session, result)

    def _breaking_cluster_stats(
        self,
        cluster: ClusterCandidate,
        cluster_articles: dict[int, Article],
        now: datetime,
        window_start: datetime,
    ) -> tuple[Article, int, float, bool] | None:
        representative = cluster_articles.get(cluster.anchor_id)
        if not representative:
            return None
        window_count = sum(
            1
            for article in cluster_articles.values()
            if article.published_at and article.published_at >= window_start
        )
        if window_count == 0:
            return None
        baseline = max(len(cluster.member_ids) / 7.0, 1.0)
        spike_magnitude = window_count / baseline
        if spike_magnitude < BREAKING_SPIKE_THRESHOLD:
            return None
        age_hours = (
            (now - representative.published_at).total_seconds() / 3600
            if representative.published_at
            else None
        )
        return (
            representative,
            window_count,
            spike_magnitude,
            bool(age_hours is not None and age_hours < 6),
        )

    def _serialize_breaking_cluster(
        self,
        cluster: ClusterCandidate,
        cluster_articles: dict[int, Article],
        stats: tuple[Article, int, float, bool],
    ) -> dict[str, Any]:
        representative, window_count, spike_magnitude, is_new_story = stats
        return {
            "cluster_id": cluster.anchor_id,
            "label": self._generate_cluster_label(cluster_articles),
            "keywords": self._extract_keywords_from_articles(list(cluster_articles.values())),
            "article_count_3h": window_count,
            "source_count_3h": len({a.source for a in cluster_articles.values() if a.source}),
            "spike_magnitude": round(spike_magnitude, 2),
            "is_new_story": is_new_story,
            "representative_article": self._serialize_article(representative),
            "articles": self._serialize_recent_articles(cluster_articles),
        }

    async def _build_breaking_clusters(
        self,
        session: AsyncSession,
        clusters: Sequence[ClusterCandidate],
        limit: int,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        now = get_utc_now()
        window_start = now - timedelta(hours=BREAKING_WINDOW_HOURS)
        for cluster in clusters:
            cluster_articles = await self._fetch_articles(session, cluster.member_ids)
            if not cluster_articles:
                continue
            stats = self._breaking_cluster_stats(cluster, cluster_articles, now, window_start)
            if stats is None:
                continue
            result = self._serialize_breaking_cluster(cluster, cluster_articles, stats)
            results.append(await self._attach_gdelt_context(session, result))
        results.sort(key=lambda x: x["spike_magnitude"], reverse=True)
        return results[:limit]

    def _serialize_article(self, article: Article) -> dict[str, Any]:
        return {
            "id": article.id,
            "title": article.title,
            "source": article.source,
            "source_id": "-".join(article.source.lower().split()) if article.source else None,
            "url": article.url,
            "image_url": article.image_url,
            "published_at": article.published_at.isoformat() if article.published_at else None,
            "summary": article.summary[:200] if article.summary else None,
            "author": article.author,
            "authors": article.authors if article.authors is not None else [],
        }

    def _serialize_recent_articles(
        self, articles: dict[int, Article], limit: int = 12
    ) -> list[dict[str, Any]]:
        ordered = sorted(
            articles.values(),
            key=lambda a: a.published_at or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )
        return [self._serialize_article(article) for article in ordered[:limit]]

    def _generate_cluster_label(self, articles: dict[int, Article]) -> str:
        if not articles:
            return "Topic"

        scored: list[tuple[str, float]] = [
            (
                article.title or "",
                self._score_title_rust(article),
            )
            for article in articles.values()
            if article.title
        ]
        return str(generate_cluster_label_rust(scored))

    @staticmethod
    def _score_title_rust(article: Article) -> float:
        if not article.title:
            return 0.0

        title = article.title.strip()
        return (
            _title_length_score(len(title))
            + _title_credibility_score(article.credibility)
            + _title_recency_score(article.published_at)
            + _title_generic_term_penalty(title)
            + _title_capitalization_score(title)
        )

    def _extract_keywords(self, article: Article) -> list[str]:
        return extract_keywords_rust(article.title or "")

    def _extract_keywords_from_articles(self, articles: list[Article]) -> list[str]:
        titles = [article.title or "" for article in articles]
        return extract_keywords_from_titles_rust(titles)

    def _recency_bonus(self, published_at: datetime | None) -> float:
        if not published_at:
            return 1.0
        now = get_utc_now()
        age_hours = (now - published_at).total_seconds() / 3600
        if age_hours < 24:
            return 1.5
        if age_hours < 72:
            return 1.2
        return 1.0

    def _latest_article_date(self, articles: dict[int, Article]) -> str | None:
        dates = [a.published_at for a in articles.values() if a.published_at]
        if not dates:
            return None
        return max(dates).isoformat()

    def _oldest_article_date(self, articles: dict[int, Article]) -> str | None:
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
    except TimeoutError:
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
        except _RECOVERABLE_TOPIC_ERRORS as exc:
            logger.error("Cluster computation worker error: %s", exc)

        await asyncio.sleep(interval_seconds)
