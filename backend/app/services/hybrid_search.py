"""
Hybrid Search Module

Combines BM25 (keyword) + Vector (semantic) search with Reciprocal Rank Fusion.
Lightweight - uses existing all-MiniLM embeddings plus pure BM25 algorithm.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from app.services.bm25_search import BM25Search

logger = logging.getLogger(__name__)


RRF_K = 60  # RRF constant - standard value from research


def reciprocal_rank_fusion(
    rankings: List[List[Tuple[str, float]]],
    k: int = RRF_K,
) -> List[Tuple[str, float]]:
    """
    Combine multiple rankings using Reciprocal Rank Fusion.

    RRF score = Σ(1 / (k + rank))

    Args:
        rankings: List of rankings, each is list of (id, score) tuples
        k: RRF constant (60 is standard)

    Returns:
        Fused ranking as list of (id, fused_score) tuples
    """
    from collections import defaultdict

    if not rankings:
        return []

    fused_scores: Dict[str, float] = defaultdict(float)

    for ranking in rankings:
        for rank, (doc_id, score) in enumerate(ranking, 1):
            # RRF formula
            rrf_score = 1.0 / (k + rank)
            fused_scores[doc_id] += rrf_score

    # Sort by fused score descending
    sorted_results = sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)

    return sorted_results


def combine_scores(
    bm25_scores: Dict[str, float],
    vector_scores: Dict[str, float],
    bm25_weight: float = 0.5,
    normalize: bool = True,
) -> Dict[str, float]:
    """
    Combine BM25 and vector similarity scores.

    Args:
        bm25_scores: Dict of chroma_id -> BM25 score
        vector_scores: Dict of chroma_id -> similarity score
        bm25_weight: Weight for BM25 (1 - weight for vector)
        normalize: Whether to min-max normalize scores

    Returns:
        Dict of chroma_id -> combined score
    """
    combined = {}

    all_ids = set(bm25_scores.keys()) | set(vector_scores.keys())

    # Normalize if requested
    bm25_norm = bm25_scores
    vector_norm = vector_scores

    if normalize and bm25_scores:
        bm25_min = min(bm25_scores.values())
        bm25_max = max(bm25_scores.values())
        bm25_range = bm25_max - bm25_min or 1
        bm25_norm = {k: (v - bm25_min) / bm25_range for k, v in bm25_scores.items()}

    if normalize and vector_scores:
        vector_min = min(vector_scores.values())
        vector_max = max(vector_scores.values())
        vector_range = vector_max - vector_min or 1
        vector_norm = {
            k: (v - vector_min) / vector_range for k, v in vector_scores.items()
        }

    # Combine with weights
    vector_weight = 1.0 - bm25_weight

    for doc_id in all_ids:
        bm25 = bm25_norm.get(doc_id, 0.0)
        vector = vector_norm.get(doc_id, 0.0)
        combined[doc_id] = (bm25_weight * bm25) + (vector_weight * vector)

    return combined


class HybridSearch:
    """
    Hybrid search combining BM25 (keyword) and vector (semantic) retrieval.

    Benefits:
    - BM25 handles exact keyword matches well
    - Vector handles synonyms and semantic similarity
    - RRF fusion provides robust combination
    """

    def __init__(
        self,
        embedding_model=None,
        bm25_k1: float = 1.6,
        bm25_b: float = 0.7,
        bm25_weight: float = 0.5,
    ):
        """
        Initialize hybrid search.

        Args:
            embedding_model: SentenceTransformer model (uses existing if None)
            bm25_k1: BM25 k1 parameter
            bm25_b: BM25 b parameter
            bm25_weight: Weight for BM25 in fusion (0.5 = equal)
        """
        self.embedding_model = embedding_model
        self.bm25_search = BM25Search(k1=bm25_k1, b=bm25_b)
        self.bm25_weight = bm25_weight
        self.vector_weight = 1.0 - bm25_weight
        self.bm25_built = False
        self.corpus_ids: List[str] = []

    def build_index(self, documents: List[Dict]) -> int:
        """
        Build both BM25 and prepare for vector search.

        Args:
            documents: List of dicts with 'chroma_id' and text fields

        Returns:
            Number of documents indexed
        """
        # Build BM25 index
        bm25_docs = [
            {
                "chroma_id": doc.get("chroma_id", ""),
                "text": doc.get("text", "") or doc.get("title", "") or "",
            }
            for doc in documents
        ]

        count = self.bm25_search.build_index(bm25_docs)

        if count > 0:
            self.corpus_ids = self.bm25_search.corpus_ids
            self.bm25_built = True

        return count

    def search(
        self,
        query: str,
        vector_store,
        limit: int = 10,
        vector_limit: int = 50,
        fusion_method: str = "rrf",
    ) -> List[Dict]:
        """
        Execute hybrid search.

        Args:
            query: Search query
            vector_store: VectorStore instance for semantic search
            limit: Maximum results to return
            vector_limit: Candidates to fetch from vector search
            fusion_method: 'rrf' or 'weighted'

        Returns:
            List of result dicts with scores
        """
        if not self.bm25_built:
            logger.warning("BM25 index not built - falling back to vector only")
            return self._vector_only_search(query, vector_store, limit)

        # 1. BM25 search
        bm25_results = self.bm25_search.search(query, top_k=limit)
        bm25_ranking = [(r["chroma_id"], r["bm25_score"]) for r in bm25_results]

        # 2. Vector search
        vector_results = vector_store.search_similar(query, limit=vector_limit)
        vector_scores = {r["chroma_id"]: r["similarity_score"] for r in vector_results}
        vector_ranking = sorted(vector_scores.items(), key=lambda x: x[1], reverse=True)

        # 3. Fuse results
        if fusion_method == "rrf":
            fused = reciprocal_rank_fusion([bm25_ranking, vector_ranking])
        else:
            combined = combine_scores(
                {k: v for k, v in bm25_ranking},
                dict(vector_ranking),
                bm25_weight=self.bm25_weight,
            )
            fused = sorted(combined.items(), key=lambda x: x[1], reverse=True)

        # 4. Build response
        chroma_id_to_vector = {r["chroma_id"]: r for r in vector_results}
        chroma_id_to_bm25 = {r["chroma_id"]: r for r in bm25_results}

        results = []
        for chroma_id, fused_score in fused[:limit]:
            vector_result = chroma_id_to_vector.get(chroma_id, {})
            bm25_result = chroma_id_to_bm25.get(chroma_id, {})

            results.append(
                {
                    "chroma_id": chroma_id,
                    "article_id": int(chroma_id.replace("article_", "")),
                    "fused_score": round(fused_score, 4),
                    "bm25_score": round(bm25_result.get("bm25_score", 0), 2),
                    "vector_score": round(vector_result.get("similarity_score", 0), 4),
                    "preview": vector_result.get("preview")
                    or bm25_result.get("document", "")[:200],
                    "metadata": vector_result.get("metadata") or {},
                }
            )

        logger.info(
            f"Hybrid search returned {len(results)} results for query: '{query[:50]}...'"
        )
        return results

    def _vector_only_search(
        self,
        query: str,
        vector_store,
        limit: int = 10,
    ) -> List[Dict]:
        """Fallback to vector-only search."""
        logger.info("Falling back to vector-only search")
        results = vector_store.search_similar(query, limit=limit)

        for r in results:
            r["fused_score"] = r.get("similarity_score", 0)
            r["bm25_score"] = 0
            r["search_type"] = "vector_only"

        return results

    def search_with_metadata(
        self,
        query: str,
        vector_store,
        metadata_filter: Optional[Dict] = None,
        limit: int = 10,
    ) -> List[Dict]:
        """
        Hybrid search with metadata filtering.

        Args:
            query: Search query
            vector_store: VectorStore instance
            metadata_filter: ChromaDB where clause filter
            limit: Maximum results

        Returns:
            Filtered search results
        """
        # Get vector results with filter
        vector_results = vector_store.search_similar(
            query,
            limit=limit * 2,  # Get more to account for filtering
            filter_metadata=metadata_filter,
        )

        # Get BM25 scores for filtered results
        filtered_ids = {r["chroma_id"] for r in vector_results}
        bm25_scores = self.bm25_search.get_scores_for_fusion(query, list(filtered_ids))

        # Combine
        combined = combine_scores(
            bm25_scores,
            {r["chroma_id"]: r["similarity_score"] for r in vector_results},
            bm25_weight=self.bm25_weight,
        )

        # Sort and limit
        sorted_results = sorted(combined.items(), key=lambda x: x[1], reverse=True)[
            :limit
        ]

        # Build response
        chroma_id_to_vector = {r["chroma_id"]: r for r in vector_results}

        return [
            {
                "chroma_id": chroma_id,
                "article_id": int(chroma_id.replace("article_", "")),
                "fused_score": round(score, 4),
                "vector_score": round(
                    chroma_id_to_vector[chroma_id].get("similarity_score", 0), 4
                ),
                "bm25_score": round(bm25_scores.get(chroma_id, 0), 2),
                "preview": chroma_id_to_vector[chroma_id].get("preview", "")[:200],
                "metadata": chroma_id_to_vector[chroma_id].get("metadata", {}),
            }
            for chroma_id, score in sorted_results
        ]

    def get_stats(self) -> Dict:
        """Get hybrid search statistics."""
        return {
            "bm25_built": self.bm25_built,
            "corpus_size": len(self.corpus_ids),
            "bm25_weight": self.bm25_weight,
            "vector_weight": self.vector_weight,
            "bm25_stats": self.bm25_search.get_stats() if self.bm25_built else None,
        }


def benchmark_hybrid_search(
    query: str,
    vector_store,
    documents: List[Dict],
    limit: int = 10,
) -> Dict[str, Any]:
    """
    Benchmark hybrid vs pure search approaches.

    Useful for tuning weights and evaluating improvement.

    Args:
        query: Test query
        vector_store: VectorStore instance
        documents: Documents to search
        limit: Result limit

    Returns:
        Benchmark results with timing and result counts
    """
    import time

    hybrid = HybridSearch()
    hybrid.build_index(documents)

    # Time vector-only
    start = time.time()
    vector_results = vector_store.search_similar(query, limit=limit)
    vector_time = time.time() - start

    # Time BM25-only
    start = time.time()
    bm25_results = hybrid.bm25_search.search(query, top_k=limit)
    bm25_time = time.time() - start

    # Time hybrid
    start = time.time()
    hybrid_results = hybrid.search(query, vector_store, limit=limit)
    hybrid_time = time.time() - start

    # Calculate overlap
    vector_ids = {r["chroma_id"] for r in vector_results}
    bm25_ids = {r["chroma_id"] for r in bm25_results}
    hybrid_ids = {r["chroma_id"] for r in hybrid_results}

    return {
        "query": query,
        "vector_only": {
            "time_ms": round(vector_time * 1000, 2),
            "results": len(vector_results),
            "ids": list(vector_ids),
        },
        "bm25_only": {
            "time_ms": round(bm25_time * 1000, 2),
            "results": len(bm25_results),
            "ids": list(bm25_ids),
        },
        "hybrid": {
            "time_ms": round(hybrid_time * 1000, 2),
            "results": len(hybrid_results),
            "ids": list(hybrid_ids),
        },
        "overlap": {
            "vector_bm25": len(vector_ids & bm25_ids),
            "vector_hybrid": len(vector_ids & hybrid_ids),
            "bm25_hybrid": len(bm25_ids & hybrid_ids),
        },
    }
