"""
HDBSCAN Clustering Module

Density-based clustering with automatic outlier detection.
Pure algorithm - no model weights, optimized C++ backend.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class HDBSCANClusterer:
    """
    HDBSCAN clustering for news article topic grouping.

    Advantages over centroid-based clustering:
    - Automatic outlier detection (noise points)
    - No need to specify number of clusters
    - Handles varying density clusters
    - More robust to initialization

    Args:
        min_cluster_size: Minimum points to form a cluster (default 5)
        min_samples: Density threshold (default 3)
        cluster_selection_epsilon: Merge clusters below this distance
    """

    def __init__(
        self,
        min_cluster_size: int = 5,
        min_samples: int = 3,
        cluster_selection_epsilon: float = 0.0,
        metric: str = "euclidean",
        cluster_selection_method: str = "eom",
    ):
        """
        Initialize HDBSCAN clusterer.
        """
        self.min_cluster_size = min_cluster_size
        self.min_samples = min_samples
        self.cluster_selection_epsilon = cluster_selection_epsilon
        self.metric = metric
        self.cluster_selection_method = cluster_selection_method

        self.cluster_labels: Optional[np.ndarray] = None
        self.cluster_probabilities: Optional[np.ndarray] = None
        self.outlier_scores: Optional[np.ndarray] = None
        self.n_clusters: int = 0
        self.n_noise: int = 0

    def fit_predict(self, embeddings: List[List[float]]) -> np.ndarray:
        """
        Fit HDBSCAN and return cluster labels.

        Args:
            embeddings: List of article embedding vectors

        Returns:
            NumPy array of cluster labels (-1 for noise)
        """
        try:
            import hdbscan

            embeddings_array = np.array(embeddings, dtype=np.float32)

            if embeddings_array.shape[0] < self.min_cluster_size:
                logger.warning(
                    f"Too few samples ({embeddings_array.shape[0]}) "
                    f"for min_cluster_size ({self.min_cluster_size})"
                )
                self.cluster_labels = np.zeros(
                    embeddings_array.shape[0], dtype=np.int32
                )
                return self.cluster_labels

            clusterer = hdbscan.HDBSCAN(
                min_cluster_size=self.min_cluster_size,
                min_samples=self.min_samples,
                cluster_selection_epsilon=self.cluster_selection_epsilon,
                metric=self.metric,
                cluster_selection_method=self.cluster_selection_method,
                gen_min_span_tree=True,
            )

            self.cluster_labels = clusterer.fit_predict(embeddings_array)
            self.cluster_probabilities = clusterer.probabilities_
            self.outlier_scores = clusterer.outlier_scores_

            self.n_clusters = len(set(self.cluster_labels)) - (
                1 if -1 in self.cluster_labels else 0
            )
            self.n_noise = np.sum(self.cluster_labels == -1)

            logger.info(
                f"HDBSCAN found {self.n_clusters} clusters, "
                f"{self.n_noise} noise points out of {len(embeddings)} samples"
            )

            return self.cluster_labels

        except ImportError:
            logger.warning(
                "HDBSCAN not installed, falling back to numpy-based implementation"
            )
            return self._fallback_cluster(embeddings)

    def _fallback_cluster(self, embeddings: List[List[float]]) -> np.ndarray:
        """
        Simple fallback clustering when HDBSCAN not available.
        Uses sklearn's DBSCAN instead.
        """
        try:
            from sklearn.cluster import DBSCAN

            embeddings_array = np.array(embeddings, dtype=np.float32)

            # eps tuned for normalized embeddings (cosine ~ euclidean on sphere)
            eps = 1.0 - 0.75  # Equivalent to 0.75 cosine threshold

            clusterer = DBSCAN(eps=eps, min_samples=self.min_samples)
            labels = clusterer.fit_predict(embeddings_array)

            self.n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
            self.n_noise = np.sum(labels == -1)

            logger.info(
                f"DBSCAN fallback found {self.n_clusters} clusters, "
                f"{self.n_noise} noise points"
            )

            return labels

        except ImportError:
            logger.error("Neither HDBSCAN nor DBSCAN available")
            return np.zeros(len(embeddings), dtype=np.int32)

    def get_cluster_info(
        self,
        embeddings: List[List[float]],
        article_ids: List[str],
    ) -> List[Dict[str, Any]]:
        """
        Get detailed cluster information.

        Args:
            embeddings: Article embeddings
            article_ids: Chroma IDs for articles

        Returns:
            List of cluster info dicts
        """
        if self.cluster_labels is None:
            raise ValueError("Must call fit_predict first")

        if len(embeddings) != len(article_ids):
            raise ValueError("Embeddings and article_ids must have same length")

        embeddings_array = np.array(embeddings, dtype=np.float32)
        cluster_info: Dict[int, Dict[str, Any]] = {}

        for idx, (label, embedding) in enumerate(
            zip(self.cluster_labels, embeddings_array)
        ):
            if label == -1:
                continue  # Skip noise

            if label not in cluster_info:
                cluster_info[label] = {
                    "cluster_id": int(label),
                    "article_ids": [],
                    "centroid": None,
                    "member_embeddings": [],
                    "size": 0,
                    "outlier_score_sum": 0.0,
                }

            cluster_info[label]["article_ids"].append(article_ids[idx])
            cluster_info[label]["member_embeddings"].append(embedding)
            cluster_info[label]["size"] += 1

            if self.outlier_scores is not None:
                cluster_info[label]["outlier_score_sum"] += self.outlier_scores[idx]

        # Calculate centroids
        for label, info in cluster_info.items():
            if info["member_embeddings"]:
                info["centroid"] = np.mean(info["member_embeddings"], axis=0).tolist()
            del info["member_embeddings"]  # Don't return embeddings

        # Calculate cluster quality score
        for info in cluster_info.values():
            if info["size"] > 0:
                avg_outlier = info["outlier_score_sum"] / info["size"]
                info["coherence_score"] = 1.0 - min(avg_outlier, 1.0)
            else:
                info["coherence_score"] = 0.0

        return list(cluster_info.values())

    def get_noise_articles(
        self,
        article_ids: List[str],
        threshold: float = 0.7,
    ) -> List[Dict[str, Any]]:
        """
        Get articles flagged as noise/outliers.

        Args:
            article_ids: Chroma IDs for articles
            threshold: Minimum outlier score to include

        Returns:
            List of noise article info dicts
        """
        if self.cluster_labels is None or self.outlier_scores is None:
            return []

        noise_articles = []

        for idx, (label, outlier_score) in enumerate(
            zip(self.cluster_labels, self.outlier_scores)
        ):
            if label == -1 or outlier_score >= threshold:
                noise_articles.append(
                    {
                        "chroma_id": article_ids[idx],
                        "outlier_score": float(outlier_score),
                        "is_noise": label == -1,
                    }
                )

        return noise_articles

    def get_stats(self) -> Dict:
        """Get clustering statistics."""
        return {
            "n_clusters": self.n_clusters,
            "n_noise": self.n_noise,
            "noise_ratio": self.n_noise / max(len(self.cluster_labels), 1)
            if self.cluster_labels is not None
            else 0,
            "min_cluster_size": self.min_cluster_size,
            "min_samples": self.min_samples,
        }


def cluster_articles_hdbscan(
    embeddings: List[List[float]],
    article_ids: List[str],
    min_cluster_size: int = 5,
    min_samples: int = 3,
) -> Tuple[List[int], List[Dict[str, Any]]]:
    """
    Convenience function to cluster articles.

    Args:
        embeddings: Article embedding vectors
        article_ids: Chroma IDs
        min_cluster_size: Minimum cluster size
        min_samples: Density parameter

    Returns:
        Tuple of (labels, cluster_info)
    """
    clusterer = HDBSCANClusterer(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
    )

    labels = clusterer.fit_predict(embeddings)
    cluster_info = clusterer.get_cluster_info(embeddings, article_ids)

    return labels, cluster_info
