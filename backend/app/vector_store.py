from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer

from app.core.config import settings
from app.services.startup_metrics import startup_metrics

logger = logging.getLogger(__name__)

CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))

_vector_store: Optional["VectorStore"] = None
_vector_store_lock = threading.Lock()

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"


class VectorStore:
    def __init__(self):
        init_start = time.time()
        self._embedding_model = None
        self._embedding_cache_dir = None
        try:
            # Use HTTP client for Docker setup
            self.client = chromadb.HttpClient(
                host=CHROMA_HOST,
                port=CHROMA_PORT,
                settings=ChromaSettings(
                    anonymized_telemetry=False,
                    allow_reset=True,  # Enable for development
                    chroma_server_ssl_verify=False,
                ),
            )

            # Fail fast if the Chroma server isn't reachable.
            self.client.heartbeat()

            # Create or get collection
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
    def embedding_model(self):
        """Lazy load embedding model on first access."""
        if self._embedding_model is None:
            logger.info(
                f"Loading embedding model ({EMBEDDING_MODEL_NAME}) on first use..."
            )
            self._embedding_model = SentenceTransformer(
                EMBEDDING_MODEL_NAME, cache_folder=self._embedding_cache_dir
            )
        return self._embedding_model

    def add_article(
        self, article_id: str, title: str, summary: str, content: str, metadata: Dict
    ) -> bool:
        """Add article embedding to ChromaDB"""
        try:
            # Combine title, summary, and content for richer embeddings
            text = f"{title}\n\n{summary}"
            if content and content != summary:
                text += f"\n\n{content[:500]}"  # Limit content length

            # Generate embedding
            embedding = self.embedding_model.encode(
                text,
                show_progress_bar=False,
            ).tolist()

            # Store in ChromaDB with metadata
            self.collection.add(
                ids=[article_id],
                embeddings=[embedding],
                documents=[text],
                metadatas=[
                    {
                        **metadata,
                        "title": title,
                        "summary": summary[:200],  # Truncate for metadata
                    }
                ],
            )

            logger.debug(f"Added article {article_id} to vector store")
            return True

        except Exception as e:
            logger.error("Failed to add article to vector store: %s", e)
            return False

    def search_similar(
        self, query: str, limit: int = 10, filter_metadata: Optional[Dict] = None
    ) -> List[Dict]:
        """Semantic search for similar articles"""
        try:
            # Generate query embedding
            query_embedding = self.embedding_model.encode(query).tolist()

            # Build where clause for filtering
            where_clause = filter_metadata if filter_metadata else None

            # Search ChromaDB
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=limit,
                where=where_clause,
                include=["metadatas", "documents", "distances"],
            )

            # Format results
            articles = []
            if results["ids"] and len(results["ids"][0]) > 0:
                for i in range(len(results["ids"][0])):
                    articles.append(
                        {
                            "chroma_id": results["ids"][0][i],
                            "article_id": int(
                                results["ids"][0][i].replace("article_", "")
                            ),
                            "distance": results["distances"][0][i],
                            "similarity_score": 1
                            - results["distances"][0][i],  # Convert to similarity
                            "metadata": results["metadatas"][0][i],
                            "preview": results["documents"][0][i][:200],
                        }
                    )

            logger.info(
                f"Found {len(articles)} similar articles for query: '{query[:50]}...'"
            )
            return articles

        except Exception as e:
            logger.error("Vector search failed: %s", e)
            return []

    def batch_add_articles(self, articles: List[Dict]) -> int:
        """Batch insert articles for better performance"""
        try:
            ids: List[str] = []
            documents: List[str] = []
            metadatas: List[Dict] = []

            for article in articles:
                text_parts = [
                    article.get("title", "") or "",
                    "\n\n",
                    article.get("summary", "") or "",
                ]
                content = article.get("content")
                if (
                    content
                    and content.strip()
                    and content.strip() != (article.get("summary") or "").strip()
                ):
                    text_parts.extend(["\n\n", content[:500]])
                text = "".join(text_parts)

                ids.append(article["chroma_id"])
                documents.append(text)
                metadatas.append(
                    {
                        **article.get("metadata", {}),
                        "title": article.get("title"),
                        "summary": (article.get("summary") or "")[:200],
                    }
                )

            embeddings_array = self.embedding_model.encode(
                documents,
                batch_size=min(32, max(1, len(documents))),
                convert_to_numpy=True,
                show_progress_bar=False,
            )

            embeddings = [embedding.tolist() for embedding in embeddings_array]

            self.collection.add(
                ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas
            )

            logger.info(f"Batch added {len(articles)} articles to vector store")
            return len(articles)

        except Exception as e:
            logger.error("Batch add failed: %s", e)
            return 0

    def list_articles(self, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """Return a window of Chroma documents for debugging purposes."""
        try:
            payload = self.collection.get(
                limit=limit,
                offset=offset,
                include=["metadatas", "documents"],
            )

            ids = payload.get("ids") or []
            metadatas = payload.get("metadatas") or []
            documents = payload.get("documents") or []

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

    def list_all_ids(self) -> List[str]:
        """Return every stored Chroma ID (used for drift detection)."""
        try:
            payload = self.collection.get(include=[])
            ids = payload.get("ids") or []
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

    def get_collection_stats(self) -> Dict:
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
        source_id: Optional[str] = None,
    ) -> List[Dict]:
        """Find similar articles given an article ID (uses stored embedding)."""
        try:
            chroma_id = f"article_{article_id}"
            result = self.collection.get(
                ids=[chroma_id],
                include=["embeddings", "metadatas"],
            )

            if not result["ids"] or not result["embeddings"]:
                logger.warning(f"Article {article_id} not found in vector store")
                return []

            embedding = result["embeddings"][0]
            where_clause = None
            if exclude_same_source and source_id:
                where_clause = {"source_id": {"$ne": source_id}}

            results = self.collection.query(
                query_embeddings=[embedding],
                n_results=limit + 1,
                where=where_clause,
                include=["metadatas", "documents", "distances"],
            )

            articles = []
            if results["ids"] and len(results["ids"][0]) > 0:
                for i in range(len(results["ids"][0])):
                    result_id = results["ids"][0][i]
                    if result_id == chroma_id:
                        continue
                    articles.append(
                        {
                            "chroma_id": result_id,
                            "article_id": int(result_id.replace("article_", "")),
                            "distance": results["distances"][0][i],
                            "similarity_score": 1 - results["distances"][0][i],
                            "metadata": results["metadatas"][0][i],
                            "preview": results["documents"][0][i][:200],
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

    def get_embedding_for_query(self, query: str) -> List[float]:
        """Generate embedding for a text query (for search suggestions)."""
        return self.embedding_model.encode(query).tolist()

    def search_hybrid(
        self,
        query: str,
        limit: int = 10,
        bm25_weight: float = 0.5,
        fusion_method: str = "rrf",
        filter_metadata: Optional[Dict] = None,
    ) -> List[Dict]:
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
            from app.services.hybrid_search import (
                HybridSearch,
                reciprocal_rank_fusion,
                combine_scores,
            )

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

            bm25_scores = {}
            try:
                from app.services.bm25_search import BM25Search

                bm25_search = BM25Search()
                bm25_docs = [
                    {"chroma_id": r["chroma_id"], "text": r.get("preview", "")}
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

            results = []
            for chroma_id, fused_score in fused[:limit]:
                if chroma_id not in chroma_id_to_vector:
                    continue
                vector_result = chroma_id_to_vector[chroma_id]
                results.append(
                    {
                        "chroma_id": chroma_id,
                        "article_id": int(chroma_id.replace("article_", "")),
                        "fused_score": round(fused_score, 4),
                        "bm25_score": round(bm25_scores.get(chroma_id, 0), 2),
                        "vector_score": round(
                            vector_result.get("similarity_score", 0), 4
                        ),
                        "distance": vector_result.get("distance"),
                        "metadata": vector_result.get("metadata", {}),
                        "preview": vector_result.get("preview", "")[:200],
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
        self, query: str, cluster_centroids: List[Dict], limit: int = 5
    ) -> List[Dict]:
        """Find cluster labels nearest to a query embedding."""
        try:
            query_embedding = self.embedding_model.encode(query)
            import numpy as np

            results = []
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
        self, source_ids: List[str], sample_size: int = 100
    ) -> Dict[str, Any]:
        """Compute embedding space coverage statistics per source."""
        try:
            import numpy as np

            coverage_stats = {}
            all_embeddings = []
            source_embeddings: Dict[str, List] = {sid: [] for sid in source_ids}

            for source_id in source_ids:
                results = self.collection.get(
                    where={"source_id": source_id},
                    limit=sample_size,
                    include=["embeddings"],
                )
                if results["embeddings"]:
                    source_embeddings[source_id] = results["embeddings"]
                    all_embeddings.extend(results["embeddings"])

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


def get_vector_store() -> Optional[VectorStore]:
    """Return a lazily initialised vector store (or None if disabled/unavailable)."""
    if not settings.enable_vector_store:
        logger.info("Vector store disabled via ENABLE_VECTOR_STORE=0")
        startup_metrics.add_note(
            "vector_store_status",
            {"connected": False, "disabled": True},
        )
        return None

    global _vector_store
    if _vector_store is not None:
        return _vector_store

    with _vector_store_lock:
        if _vector_store is not None:
            return _vector_store
        try:
            _vector_store = VectorStore()
        except Exception as exc:
            logger.warning("ChromaDB not available: %s", exc)
            startup_metrics.add_note("vector_store_error", str(exc))
            _vector_store = None
        return _vector_store
