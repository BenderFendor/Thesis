"""
BM25 Keyword Search Component

Lightweight pure algorithm for keyword-based article retrieval.
Uses Okapi BM25 ranking function with configurable parameters.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)


class BM25Search:
    """
    BM25-based keyword search for articles.

    BM25 is a probabilistic relevance ranking function that outperforms
    simple TF-IDF for most use cases. It's pure algorithm - no model weights.
    """

    def __init__(
        self,
        k1: float = 1.6,
        b: float = 0.7,
        epsilon: float = 0.25,
    ):
        """
        Initialize BM25 search engine.

        Args:
            k1: Term frequency saturation parameter (1.2-2.0 typical)
                Higher = less aggressive TF saturation
            b: Length normalization weight (0.0-1.0 typical)
                Higher = more aggressive length normalization
            epsilon: IDF floor value for unknown terms
        """
        self.k1 = k1
        self.b = b
        self.epsilon = epsilon
        self.bm25: Optional[BM25Okapi] = None
        self.corpus_ids: List[str] = []
        self.documents: List[str] = []
        self.tokenized_corpus: List[List[str]] = []
        self.avg_doc_length: float = 0.0
        self.doc_lengths: List[int] = []

    def build_index(
        self,
        documents: List[Dict],
        id_field: str = "chroma_id",
        text_field: str = "text",
    ) -> int:
        """
        Build BM25 index from document collection.

        Args:
            documents: List of dicts with id and text fields
            id_field: Field name for document ID
            text_field: Field name for document text

        Returns:
            Number of documents indexed
        """
        if not documents:
            logger.warning("No documents provided for BM25 indexing")
            return 0

        self.corpus_ids = []
        self.documents = []
        self.tokenized_corpus = []
        self.doc_lengths = []

        for doc in documents:
            doc_id = doc.get(id_field, "")
            text = doc.get(text_field, "") or ""

            if not doc_id:
                continue

            self.corpus_ids.append(doc_id)
            self.documents.append(text)

            # Tokenize - lowercase, split on whitespace
            tokens = text.lower().split()
            self.tokenized_corpus.append(tokens)
            self.doc_lengths.append(len(tokens))

        if not self.tokenized_corpus:
            logger.warning("No valid documents after tokenization")
            return 0

        # Calculate average document length
        self.avg_doc_length = sum(self.doc_lengths) / len(self.doc_lengths)

        # Build BM25 index
        self.bm25 = BM25Okapi(
            self.tokenized_corpus,
            k1=self.k1,
            b=self.b,
            epsilon=self.epsilon,
        )

        logger.info(
            f"BM25 index built with {len(self.corpus_ids)} documents, "
            f"avg length: {self.avg_doc_length:.1f} tokens"
        )
        return len(self.corpus_ids)

    def search(
        self,
        query: str,
        top_k: int = 10,
        score_threshold: float = 0.0,
    ) -> List[Dict]:
        """
        Search index with keyword query.

        Args:
            query: Search query string
            top_k: Maximum number of results
            score_threshold: Minimum score threshold (0.0 = no filter)

        Returns:
            List of result dicts with id, score, and metadata
        """
        if not self.bm25:
            logger.warning("BM25 index not built - call build_index() first")
            return []

        try:
            # Tokenize query
            tokenized_query = query.lower().split()

            if not tokenized_query:
                return []

            # Get BM25 scores
            scores = self.bm25.get_scores(tokenized_query)

            # Build results with ranking
            results = []
            for idx, score in enumerate(scores):
                if score_threshold > 0 and score < score_threshold:
                    continue
                results.append(
                    {
                        "chroma_id": self.corpus_ids[idx],
                        "bm25_score": float(score),
                        "document": self.documents[idx][:200],
                        "doc_length": self.doc_lengths[idx],
                    }
                )

            # Sort by score descending
            results.sort(key=lambda x: x["bm25_score"], reverse=True)

            # Return top k
            return results[:top_k]

        except Exception as e:
            logger.error(f"BM25 search failed: {e}")
            return []

    def get_scores_for_fusion(
        self,
        query: str,
        candidate_ids: List[str],
        top_k: int = 50,
    ) -> Dict[str, float]:
        """
        Get BM25 scores for specific candidate IDs (for hybrid fusion).

        Args:
            query: Search query
            candidate_ids: IDs to score
            top_k: Maximum candidates to return

        Returns:
            Dict mapping chroma_id -> BM25 score
        """
        if not self.bm25:
            return {}

        tokenized_query = query.lower().split()
        if not tokenized_query:
            return {}

        # Get all scores
        all_scores = self.bm25.get_scores(tokenized_query)

        # Build id -> score mapping for candidates
        id_to_score = {}
        for idx, chroma_id in enumerate(self.corpus_ids):
            if chroma_id in candidate_ids:
                id_to_score[chroma_id] = float(all_scores[idx])

        # Sort and return top k
        sorted_scores = sorted(id_to_score.items(), key=lambda x: x[1], reverse=True)[
            :top_k
        ]

        return dict(sorted_scores)

    def get_stats(self) -> Dict:
        """Get index statistics."""
        return {
            "document_count": len(self.corpus_ids),
            "avg_doc_length": self.avg_doc_length,
            "k1": self.k1,
            "b": self.b,
            "built": self.bm25 is not None,
        }


def compute_bm25_score(
    query: str,
    document: str,
    doc_length: int,
    avg_doc_length: float,
    k1: float = 1.6,
    b: float = 0.7,
    idf_cache: Optional[Dict[str, float]] = None,
) -> float:
    """
    Compute BM25 score for a single query-document pair.

    Useful for incremental scoring without building full index.

    Args:
        query: Search query
        document: Document text
        doc_length: Length of document in tokens
        avg_doc_length: Average document length in corpus
        k1: TF saturation parameter
        b: Length normalization parameter
        idf_cache: Optional pre-computed IDF values

    Returns:
        BM25 score
    """
    from collections import Counter

    query_tokens = query.lower().split()
    doc_tokens = document.lower().split()

    if not query_tokens or not doc_tokens:
        return 0.0

    doc_counter = Counter(doc_tokens)
    doc_len = len(doc_tokens)

    # Compute IDF for query terms (simplified)
    total_docs = 1  # Single document mode
    idf_sum = 0.0

    for term in set(query_tokens):
        if idf_cache and term in idf_cache:
            idf = idf_cache[term]
        else:
            # Simplified IDF: log(1 + (N - n + 0.5) / (n + 0.5))
            n = doc_counter.get(term, 0)
            idf = max(0, 0.5 * np.log((total_docs - n + 0.5) / (n + 0.5) + 1))
            if idf_cache is not None:
                idf_cache[term] = idf
        idf_sum += idf

    # Compute TF component for each query term
    tf_sum = 0.0
    for term in query_tokens:
        tf = doc_counter.get(term, 0)
        # BM25 TF formula
        tf_component = (tf * (k1 + 1)) / (
            tf + k1 * (1 - b + b * (doc_len / avg_doc_length))
        )
        tf_sum += tf_component

    # BM25 score
    return idf_sum * tf_sum / len(query_tokens) if query_tokens else 0.0
