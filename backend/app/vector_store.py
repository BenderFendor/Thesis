from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Mapping, Sequence
from importlib import import_module
from typing import TYPE_CHECKING, Any, Protocol, TypedDict, cast

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from chromadb.api.models.Collection import Collection
    from chromadb.api.types import (
        Embedding,
        GetResult,
        IncludeEnum,
        Metadata,
        QueryResult,
    )
    from chromadb.api.types import Where
    from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))

_vector_store: VectorStore | None = None
_vector_store_lock = threading.Lock()

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

# Connection state tracking to prevent log flooding
_last_connection_attempt: float = 0.0
_failed_attempts: int = 0
_connection_backoff_until: float = 0.0
_MAX_BACKOFF_SECONDS: float = 300.0  # Max 5 minutes between retries
_BACKOFF_MULTIPLIER: float = 2.0
_INITIAL_BACKOFF: float = 5.0  # Start with 5 second backoff


MetadataScalar = str | int | float | bool


class AppSettingsProtocol(Protocol):
    enable_vector_store: bool


class StartupMetricsProtocol(Protocol):
    def record_event(
        self,
        name: str,
        started_at: float,
        *,
        detail: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> object: ...

    def add_note(self, key: str, value: Any) -> None: ...


class ChromaClientProtocol(Protocol):
    def heartbeat(self) -> int: ...

    def get_collection(self, *, name: str) -> "Collection": ...

    def get_or_create_collection(
        self,
        *,
        name: str,
        metadata: Mapping[str, MetadataScalar],
    ) -> "Collection": ...


class EmbeddingModelProtocol(Protocol):
    def encode(
        self,
        sentences: str | list[str],
        *,
        batch_size: int = ...,
        show_progress_bar: bool | None = ...,
        convert_to_numpy: bool = ...,
        **kwargs: object,
    ) -> "NDArray[Any]": ...


class ReciprocalRankFusionProtocol(Protocol):
    def __call__(
        self,
        rankings: list[list[tuple[str, float]]],
        k: int = ...,
    ) -> list[tuple[str, float]]: ...


class CombineScoresProtocol(Protocol):
    def __call__(
        self,
        bm25_scores: dict[str, float],
        vector_scores: dict[str, float],
        bm25_weight: float = ...,
        normalize: bool = ...,
    ) -> dict[str, float]: ...


class BM25SearchProtocol(Protocol):
    def build_index(
        self,
        documents: Sequence[Mapping[str, object]],
        id_field: str = ...,
        text_field: str = ...,
    ) -> int: ...

    def get_scores_for_fusion(
        self,
        query: str,
        candidate_ids: Sequence[str],
        top_k: int = ...,
    ) -> dict[str, float]: ...


class SimilarArticleResult(TypedDict):
    chroma_id: str
    article_id: int
    distance: float
    similarity_score: float
    metadata: Mapping[str, MetadataScalar]
    preview: str


class HybridSearchResult(TypedDict):
    chroma_id: str
    article_id: int
    fused_score: float
    bm25_score: float
    vector_score: float
    distance: float | None
    metadata: Mapping[str, MetadataScalar]
    preview: str


class BatchArticlePayload(TypedDict):
    chroma_id: str
    title: str
    summary: str
    content: str
    metadata: Mapping[str, object]


class ClusterCentroid(TypedDict):
    id: str | int
    label: str
    centroid: Sequence[float]


class ClusterSimilarityResult(TypedDict):
    cluster_id: str | int
    label: str
    similarity: float


def _get_settings() -> AppSettingsProtocol:
    config_module = import_module("app.core.config")
    return cast(AppSettingsProtocol, getattr(config_module, "settings"))


def _get_startup_metrics() -> StartupMetricsProtocol:
    metrics_module = import_module("app.services.startup_metrics")
    return cast(StartupMetricsProtocol, getattr(metrics_module, "startup_metrics"))


def _create_chroma_client() -> ChromaClientProtocol:
    try:
        chroma_module = cast(Any, import_module("chromadb"))
        chroma_settings_cls = cast(
            Any, getattr(import_module("chromadb.config"), "Settings")
        )
    except ImportError as exc:  # pragma: no cover - optional at import time
        raise RuntimeError(
            "Chroma dependencies are not installed; install chromadb to enable vector store."
        ) from exc

    return cast(
        ChromaClientProtocol,
        chroma_module.HttpClient(
            host=CHROMA_HOST,
            port=CHROMA_PORT,
            settings=chroma_settings_cls(
                anonymized_telemetry=False,
                allow_reset=True,
                chroma_server_ssl_verify=False,
            ),
        ),
    )


def _get_sentence_transformer_class() -> type["SentenceTransformer"]:
    try:
        transformer_module = import_module("sentence_transformers")
    except ImportError as exc:  # pragma: no cover - optional at import time
        raise RuntimeError(
            "sentence-transformers is not installed; cannot generate embeddings."
        ) from exc
    return cast(
        type["SentenceTransformer"], getattr(transformer_module, "SentenceTransformer")
    )


def _get_chroma_include(*values: str) -> list["IncludeEnum"]:
    include_enum = cast(
        Any, getattr(import_module("chromadb.api.types"), "IncludeEnum")
    )
    return [cast("IncludeEnum", include_enum(value)) for value in values]


def _coerce_metadata(metadata: Mapping[str, object]) -> "Metadata":
    return cast("Metadata", metadata)


def _coerce_where(where: Mapping[str, object] | None) -> "Where | None":
    if where is None:
        return None
    return cast("Where", dict(where))


def _get_query_batches(
    results: "QueryResult",
) -> tuple[list[str], list[float], list["Metadata"], list[str]]:
    ids = results["ids"] or []
    distances = results["distances"] or []
    metadatas = results["metadatas"] or []
    documents = results["documents"] or []
    if not ids or not distances or not metadatas or not documents:
        return [], [], [], []
    return ids[0], distances[0], metadatas[0], documents[0]


def _get_embedding_rows(
    payload: "GetResult",
) -> list["Embedding | Sequence[float] | Sequence[int]"]:
    raw_embeddings = payload["embeddings"]
    if raw_embeddings is None:
        return []

    rows = list(cast(Sequence[object], raw_embeddings))
    if rows and isinstance(rows[0], (float, int)):
        return [
            cast(
                "Embedding | Sequence[float] | Sequence[int]",
                cast(Sequence[float] | Sequence[int], rows),
            )
        ]
    return [cast("Embedding | Sequence[float] | Sequence[int]", row) for row in rows]


def _embedding_to_list(embedding: "NDArray[Any]") -> list[float]:
    return cast(list[float], embedding.tolist())


def _embeddings_to_lists(embeddings: "NDArray[Any]") -> list[list[float]]:
    return [cast(list[float], row.tolist()) for row in embeddings]


def _get_hybrid_search_helpers() -> tuple[
    ReciprocalRankFusionProtocol,
    CombineScoresProtocol,
]:
    hybrid_module = import_module("app.services.hybrid_search")
    return (
        cast(
            ReciprocalRankFusionProtocol,
            getattr(hybrid_module, "reciprocal_rank_fusion"),
        ),
        cast(CombineScoresProtocol, getattr(hybrid_module, "combine_scores")),
    )


def _new_bm25_search() -> BM25SearchProtocol:
    bm25_module = import_module("app.services.bm25_search")
    bm25_search_class = cast(Any, getattr(bm25_module, "BM25Search"))
    return cast(BM25SearchProtocol, bm25_search_class())


def _get_backoff_duration() -> float:
    """Calculate current backoff duration based on failed attempts."""
    global _failed_attempts
    duration = _INITIAL_BACKOFF * (_BACKOFF_MULTIPLIER**_failed_attempts)
    return min(duration, _MAX_BACKOFF_SECONDS)


def _record_connection_failure() -> None:
    """Record a failed connection attempt and update backoff."""
    global _failed_attempts, _connection_backoff_until, _last_connection_attempt
    _failed_attempts += 1
    _last_connection_attempt = time.time()
    _connection_backoff_until = _last_connection_attempt + _get_backoff_duration()


def _record_connection_success() -> None:
    """Reset failure tracking on successful connection."""
    global _failed_attempts, _connection_backoff_until
    _failed_attempts = 0
    _connection_backoff_until = 0.0


def is_chroma_reachable(timeout: float = 3.0) -> bool:
    """
    Lightweight preflight check to see if ChromaDB is reachable.
    Uses a simple socket connection check - much faster than full client init.

    Args:
        timeout: Connection timeout in seconds

    Returns:
        True if ChromaDB appears reachable, False otherwise
    """
    try:
        import socket

        sock = socket.create_connection((CHROMA_HOST, CHROMA_PORT), timeout=timeout)
        sock.close()
        return True
    except Exception:
        return False


def check_chroma_health() -> dict[str, object]:
    """
    Check ChromaDB health without initializing full VectorStore.
    Returns detailed status information for monitoring/debugging.

    Returns:
        Dict with 'reachable', 'healthy', 'backoff_active', and 'last_attempt' keys
    """
    global _last_connection_attempt, _connection_backoff_until, _failed_attempts

    now = time.time()
    reachable = is_chroma_reachable()
    backoff_active = now < _connection_backoff_until
    time_until_retry = max(0, _connection_backoff_until - now)

    return {
        "reachable": reachable,
        "healthy": reachable and not backoff_active,
        "backoff_active": backoff_active,
        "backoff_seconds_remaining": int(time_until_retry),
        "failed_attempts": _failed_attempts,
        "last_attempt": _last_connection_attempt,
        "host": CHROMA_HOST,
        "port": CHROMA_PORT,
    }


class VectorStore:
    def __init__(self) -> None:
        init_start = time.time()
        startup_metrics = _get_startup_metrics()
        self._embedding_model: EmbeddingModelProtocol | None = None
        self._embedding_cache_dir: str | None = None
        try:
            self.client: ChromaClientProtocol = _create_chroma_client()

            # Fail fast if the Chroma server isn't reachable.
            self.client.heartbeat()

            # Create or get collection - workaround for 0.5.23 get_or_create_collection bug
            try:
                self.collection: Collection = self.client.get_collection(
                    name="news_articles"
                )
            except Exception:
                self.collection = self.client.get_or_create_collection(
                    name="news_articles",
                    metadata={"hnsw:space": "cosine"},  # Cosine similarity for text
                )

            # Configure local cache for HuggingFace model
            self._embedding_cache_dir = os.path.expanduser(
                "~/.cache/sentence_transformers"
            )
            os.makedirs(self._embedding_cache_dir, exist_ok=True)

            # Lazy load embedding model on first use (avoids startup blocking)
            # Model will be loaded when first embedding request is made

            logger.info(f"Connected to ChromaDB at {CHROMA_HOST}:{CHROMA_PORT}")
            collection_count = self.collection.count()
            logger.info(
                f"Collection '{self.collection.name}' has {collection_count} documents"
            )
            startup_metrics.record_event(
                "vector_store_init",
                init_start,
                metadata={
                    "host": CHROMA_HOST,
                    "port": CHROMA_PORT,
                    "collection": self.collection.name,
                    "documents": collection_count,
                },
            )
            startup_metrics.add_note(
                "vector_store_status",
                {
                    "connected": True,
                    "collection": self.collection.name,
                },
            )
        except Exception as e:
            logger.error("Failed to connect to ChromaDB: %s", e)
            startup_metrics.add_note("vector_store_error", str(e))
            raise

    @property
    def embedding_model(self) -> EmbeddingModelProtocol:
        """Lazy load embedding model on first access."""
        if self._embedding_model is None:
            sentence_transformer = _get_sentence_transformer_class()
            logger.info(
                f"Loading embedding model ({EMBEDDING_MODEL_NAME}) on first use..."
            )
            self._embedding_model = cast(
                EmbeddingModelProtocol,
                sentence_transformer(
                    EMBEDDING_MODEL_NAME,
                    cache_folder=self._embedding_cache_dir,
                ),
            )
        assert self._embedding_model is not None
        return self._embedding_model

    def add_article(
        self,
        article_id: str,
        title: str,
        summary: str,
        content: str,
        metadata: Mapping[str, object],
    ) -> bool:
        """Add article embedding to ChromaDB"""
        try:
            # Combine title, summary, and content for richer embeddings
            text = f"{title}\n\n{summary}"
            if content and content != summary:
                text += f"\n\n{content[:500]}"  # Limit content length

            # Generate embedding
            embedding = _embedding_to_list(
                self.embedding_model.encode(
                    text,
                    show_progress_bar=False,
                )
            )

            # Store in ChromaDB with metadata
            self.collection.upsert(
                ids=[article_id],
                embeddings=cast(
                    "list[Sequence[float] | Sequence[int]]",
                    [embedding],
                ),
                documents=[text],
                metadatas=[
                    _coerce_metadata(
                        {
                            **metadata,
                            "title": title,
                            "summary": summary[:200],  # Truncate for metadata
                        }
                    )
                ],
            )

            logger.debug(f"Added article {article_id} to vector store")
            return True

        except Exception as e:
            logger.error("Failed to add article to vector store: %s", e)
            return False

    def search_similar(
        self,
        query: str,
        limit: int = 10,
        filter_metadata: Mapping[str, object] | None = None,
    ) -> list[SimilarArticleResult]:
        """Semantic search for similar articles"""
        try:
            # Generate query embedding
            query_embedding = _embedding_to_list(self.embedding_model.encode(query))

            # Search ChromaDB
            results = self.collection.query(
                query_embeddings=cast(
                    "list[Sequence[float] | Sequence[int]]",
                    [query_embedding],
                ),
                n_results=limit,
                where=_coerce_where(filter_metadata),
                include=_get_chroma_include("metadatas", "documents", "distances"),
            )

            # Format results
            articles: list[SimilarArticleResult] = []
            result_ids, distances, metadatas, documents = _get_query_batches(results)
            for chroma_id, distance, result_metadata, document in zip(
                result_ids,
                distances,
                metadatas,
                documents,
            ):
                articles.append(
                    {
                        "chroma_id": chroma_id,
                        "article_id": int(chroma_id.replace("article_", "")),
                        "distance": distance,
                        "similarity_score": 1 - distance,  # Convert to similarity
                        "metadata": result_metadata,
                        "preview": document[:200],
                    }
                )

            logger.info(
                f"Found {len(articles)} similar articles for query: '{query[:50]}...'"
            )
            return articles

        except Exception as e:
            logger.error("Vector search failed: %s", e)
            return []

    def batch_add_articles(self, articles: list[BatchArticlePayload]) -> int:
        """Batch insert articles for better performance"""
        global _vector_store
        try:
            ids: list[str] = []
            documents: list[str] = []
            metadatas: list[Metadata] = []

            for article in articles:
                title = article["title"] or ""
                summary = article["summary"] or ""
                content = article["content"]
                text_parts = [
                    title,
                    "\n\n",
                    summary,
                ]
                if content and content.strip() and content.strip() != summary.strip():
                    text_parts.extend(["\n\n", content[:500]])
                text = "".join(text_parts)

                ids.append(article["chroma_id"])
                documents.append(text)
                metadatas.append(
                    _coerce_metadata(
                        {
                            **article["metadata"],
                            "title": title,
                            "summary": summary[:200],
                        }
                    )
                )

            embeddings_array = self.embedding_model.encode(
                documents,
                batch_size=min(32, max(1, len(documents))),
                convert_to_numpy=True,
                show_progress_bar=False,
            )

            embeddings = _embeddings_to_lists(embeddings_array)

            self.collection.upsert(
                ids=ids,
                embeddings=cast(
                    "list[Sequence[float] | Sequence[int]]",
                    embeddings,
                ),
                documents=documents,
                metadatas=metadatas,
            )

            logger.info(f"Batch added {len(articles)} articles to vector store")
            return len(articles)

        except Exception as e:
            logger.error("Batch add failed: %s", e)
            if "Connection refused" in str(e) or "connect" in str(e).lower():
                _vector_store = None
                logger.warning(
                    "Cleared stale vector store after connection error in batch_add_articles"
                )
            return 0

    def list_articles(self, limit: int = 50, offset: int = 0) -> dict[str, object]:
        """Return a window of Chroma documents for debugging purposes."""
        try:
            payload = self.collection.get(
                limit=limit,
                offset=offset,
                include=_get_chroma_include("metadatas", "documents"),
            )

            ids = payload["ids"] or []
            metadatas = payload["metadatas"] or []
            documents = payload["documents"] or []

            return {
                "ids": ids,
                "metadatas": metadatas,
                "documents": documents,
                "count": len(ids),
                "total": self.collection.count(),
            }
        except Exception as exc:
            logger.error("Failed to fetch Chroma documents: %s", exc)
            raise

    def list_all_ids(self) -> list[str]:
        """Return every stored Chroma ID (used for drift detection)."""
        try:
            payload = self.collection.get(include=cast("list[IncludeEnum]", []))
            ids = payload["ids"] or []
            return list(ids)
        except Exception as exc:
            logger.error("Failed to enumerate Chroma IDs: %s", exc)
            raise

    def delete_article(self, article_id: str) -> bool:
        """Remove article from vector store"""
        try:
            self.collection.delete(ids=[article_id])
            logger.debug(f"Deleted article {article_id} from vector store")
            return True
        except Exception as e:
            logger.error("Failed to delete article: %s", e)
            return False

    def get_collection_stats(self) -> dict[str, object]:
        """Get vector store statistics"""
        try:
            count = self.collection.count()
            return {
                "total_articles": count,
                "collection_name": self.collection.name,
                "embedding_dimension": 384,  # For all-MiniLM-L6-v2
                "similarity_metric": "cosine",
            }
        except Exception as e:
            logger.error("Failed to get stats: %s", e)
            return {"total_articles": 0, "error": str(e)}

    def find_similar_by_id(
        self,
        article_id: int,
        limit: int = 5,
        exclude_same_source: bool = True,
        source_id: str | None = None,
    ) -> list[SimilarArticleResult]:
        """Find similar articles given an article ID (uses stored embedding)."""
        try:
            chroma_id = f"article_{article_id}"
            result = self.collection.get(
                ids=[chroma_id],
                include=_get_chroma_include("embeddings", "metadatas"),
            )

            stored_ids = result["ids"] or []
            embeddings = _get_embedding_rows(result)
            if not stored_ids or not embeddings:
                logger.warning(f"Article {article_id} not found in vector store")
                return []

            embedding = embeddings[0]
            where_clause: Where | None = None
            if exclude_same_source and source_id:
                where_clause = _coerce_where({"source_id": {"$ne": source_id}})

            results = self.collection.query(
                query_embeddings=cast(
                    "list[Embedding] | list[Sequence[float] | Sequence[int]]",
                    [embedding],
                ),
                n_results=limit + 1,
                where=where_clause,
                include=_get_chroma_include("metadatas", "documents", "distances"),
            )

            articles: list[SimilarArticleResult] = []
            result_ids, distances, metadatas, documents = _get_query_batches(results)
            for result_id, distance, result_metadata, document in zip(
                result_ids,
                distances,
                metadatas,
                documents,
            ):
                if result_id == chroma_id:
                    continue
                articles.append(
                    {
                        "chroma_id": result_id,
                        "article_id": int(result_id.replace("article_", "")),
                        "distance": distance,
                        "similarity_score": 1 - distance,
                        "metadata": result_metadata,
                        "preview": document[:200],
                    }
                )
                if len(articles) >= limit:
                    break

            logger.debug(
                f"Found {len(articles)} similar articles for article {article_id}"
            )
            return articles

        except Exception as e:
            logger.error("Find similar by ID failed: %s", e)
            return []

    def get_embedding_for_query(self, query: str) -> list[float]:
        """Generate embedding for a text query (for search suggestions)."""
        return _embedding_to_list(self.embedding_model.encode(query))

    def search_hybrid(
        self,
        query: str,
        limit: int = 10,
        bm25_weight: float = 0.5,
        fusion_method: str = "rrf",
        filter_metadata: Mapping[str, object] | None = None,
    ) -> Sequence[HybridSearchResult | SimilarArticleResult]:
        """
        Hybrid search combining BM25 (keyword) + Vector (semantic) with RRF fusion.

        Benefits:
        - BM25 handles exact keyword matches
        - Vector handles synonyms and semantic similarity
        - RRF fusion provides robust combination

        Args:
            query: Search query string
            limit: Maximum results to return
            bm25_weight: Weight for BM25 (0.5 = equal, 0.3 = more semantic)
            fusion_method: 'rrf' (recommended) or 'weighted'
            filter_metadata: Optional ChromaDB where clause filter

        Returns:
            List of result dicts with fused scores
        """
        try:
            reciprocal_rank_fusion, combine_scores = _get_hybrid_search_helpers()

            if filter_metadata:
                vector_results = self.search_similar(
                    query, limit=limit * 2, filter_metadata=filter_metadata
                )
            else:
                vector_results = self.search_similar(query, limit=limit * 2)

            if not vector_results:
                logger.info("No vector search results for hybrid search")
                return []

            vector_scores = {
                r["chroma_id"]: r["similarity_score"] for r in vector_results
            }
            vector_ranking = sorted(
                vector_scores.items(), key=lambda x: x[1], reverse=True
            )

            bm25_scores: dict[str, float] = {}
            try:
                bm25_search = _new_bm25_search()
                bm25_docs = [
                    {"chroma_id": r["chroma_id"], "text": r["preview"]}
                    for r in vector_results
                ]
                bm25_search.build_index(bm25_docs)
                bm25_scores = bm25_search.get_scores_for_fusion(
                    query, list(vector_scores.keys())
                )
            except Exception as e:
                logger.debug(f"BM25 scoring failed, using vector-only: {e}")
                bm25_scores = {}

            bm25_ranking = sorted(bm25_scores.items(), key=lambda x: x[1], reverse=True)

            if fusion_method == "rrf":
                fused = reciprocal_rank_fusion([bm25_ranking, vector_ranking])
            else:
                combined = combine_scores(
                    bm25_scores, vector_scores, bm25_weight=bm25_weight
                )
                fused = sorted(combined.items(), key=lambda x: x[1], reverse=True)

            chroma_id_to_vector = {r["chroma_id"]: r for r in vector_results}

            results: list[HybridSearchResult] = []
            for chroma_id, fused_score in fused[:limit]:
                if chroma_id not in chroma_id_to_vector:
                    continue
                vector_result = chroma_id_to_vector[chroma_id]
                results.append(
                    {
                        "chroma_id": chroma_id,
                        "article_id": int(chroma_id.replace("article_", "")),
                        "fused_score": round(fused_score, 4),
                        "bm25_score": round(bm25_scores.get(chroma_id, 0.0), 2),
                        "vector_score": round(vector_result["similarity_score"], 4),
                        "distance": vector_result["distance"],
                        "metadata": vector_result["metadata"],
                        "preview": vector_result["preview"][:200],
                    }
                )

            logger.info(
                f"Hybrid search returned {len(results)} results for query: '{query[:50]}...'"
            )
            return results

        except ImportError as e:
            logger.warning(f"Hybrid search dependencies not available: {e}")
            return self.search_similar(
                query, limit=limit, filter_metadata=filter_metadata
            )
        except Exception as e:
            logger.error(f"Hybrid search failed: {e}")
            return self.search_similar(
                query, limit=limit, filter_metadata=filter_metadata
            )

    def find_nearest_cluster_labels(
        self,
        query: str,
        cluster_centroids: list[ClusterCentroid],
        limit: int = 5,
    ) -> list[ClusterSimilarityResult]:
        """Find cluster labels nearest to a query embedding."""
        try:
            query_embedding = self.embedding_model.encode(query)
            import numpy as np

            results: list[ClusterSimilarityResult] = []
            for cluster in cluster_centroids:
                centroid = np.array(cluster["centroid"])
                similarity = float(
                    np.dot(query_embedding, centroid)
                    / (np.linalg.norm(query_embedding) * np.linalg.norm(centroid))
                )
                results.append(
                    {
                        "cluster_id": cluster["id"],
                        "label": cluster["label"],
                        "similarity": similarity,
                    }
                )

            results.sort(key=lambda x: x["similarity"], reverse=True)
            return results[:limit]

        except Exception as e:
            logger.error("Find nearest cluster labels failed: %s", e)
            return []

    def compute_source_coverage(
        self, source_ids: list[str], sample_size: int = 100
    ) -> dict[str, object]:
        """Compute embedding space coverage statistics per source."""
        try:
            import numpy as np

            coverage_stats: dict[str, dict[str, int | float]] = {}
            all_embeddings: list[Embedding | Sequence[float] | Sequence[int]] = []
            source_embeddings: dict[
                str,
                list[Embedding | Sequence[float] | Sequence[int]],
            ] = {sid: [] for sid in source_ids}

            for source_id in source_ids:
                results = self.collection.get(
                    where=_coerce_where({"source_id": source_id}),
                    limit=sample_size,
                    include=_get_chroma_include("embeddings"),
                )
                embeddings = _get_embedding_rows(results)
                if embeddings:
                    source_embeddings[source_id] = embeddings
                    all_embeddings.extend(embeddings)

            if not all_embeddings:
                return {"error": "No embeddings found for sources"}

            all_embeddings_arr = np.array(all_embeddings)
            global_centroid = np.mean(all_embeddings_arr, axis=0)
            global_std = np.std(all_embeddings_arr, axis=0)

            for source_id, embeddings in source_embeddings.items():
                if not embeddings:
                    coverage_stats[source_id] = {"article_count": 0}
                    continue

                emb_arr = np.array(embeddings)
                source_centroid = np.mean(emb_arr, axis=0)
                source_std = np.std(emb_arr, axis=0)
                centroid_distance = float(
                    np.linalg.norm(source_centroid - global_centroid)
                )
                spread = float(np.mean(source_std))
                diversity_score = spread / (np.mean(global_std) + 1e-8)

                coverage_stats[source_id] = {
                    "article_count": len(embeddings),
                    "centroid_distance": centroid_distance,
                    "spread": spread,
                    "diversity_score": float(diversity_score),
                }

            return {
                "sources": coverage_stats,
                "global_article_count": len(all_embeddings),
            }

        except Exception as e:
            logger.error("Compute source coverage failed: %s", e)
            return {"error": str(e)}


def get_vector_store() -> VectorStore | None:
    """
    Return a lazily initialised vector store (or None if disabled/unavailable).

    Implements connection backoff to prevent log flooding when ChromaDB is down.
    Uses preflight health check before attempting expensive initialization.
    """
    global _vector_store, _connection_backoff_until
    settings = _get_settings()
    startup_metrics = _get_startup_metrics()

    if not settings.enable_vector_store:
        logger.info("Vector store disabled via ENABLE_VECTOR_STORE=0")
        startup_metrics.add_note(
            "vector_store_status",
            {"connected": False, "disabled": True},
        )
        return None

    # Fast path: already initialized
    if _vector_store is not None:
        return _vector_store

    # Check if we're in backoff period (prevents log flooding)
    now = time.time()
    if now < _connection_backoff_until:
        # Silently return None during backoff - callers should handle this gracefully
        return None

    # Preflight check: is Chroma even reachable? (lightweight, no heavy init)
    if not is_chroma_reachable(timeout=2.0):
        _record_connection_failure()
        # Only log on first failure or every 5 minutes to reduce noise
        if _failed_attempts == 1 or (_failed_attempts % 10 == 0):
            logger.warning(
                "ChromaDB not reachable at %s:%d (attempt #%d, backoff %ds)",
                CHROMA_HOST,
                CHROMA_PORT,
                _failed_attempts,
                int(_get_backoff_duration()),
            )
        startup_metrics.add_note(
            "vector_store_status",
            {
                "connected": False,
                "error": "not_reachable",
                "failed_attempts": _failed_attempts,
            },
        )
        return None

    with _vector_store_lock:
        if _vector_store is not None:
            return _vector_store
        try:
            _vector_store = VectorStore()
            _record_connection_success()
        except Exception as exc:
            _record_connection_failure()
            # Only log every Nth failure to prevent log flooding
            if _failed_attempts == 1 or (_failed_attempts % 5 == 0):
                logger.warning(
                    "ChromaDB initialization failed (attempt #%d, backoff %ds): %s",
                    _failed_attempts,
                    int(_get_backoff_duration()),
                    exc,
                )
            startup_metrics.add_note(
                "vector_store_status",
                {
                    "connected": False,
                    "error": str(exc),
                    "failed_attempts": _failed_attempts,
                },
            )
            _vector_store = None
        return _vector_store
