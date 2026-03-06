"""
HDBSCAN Clustering Module

Density-based clustering with automatic outlier detection.
Pure algorithm - no model weights, optimized C++ backend.
"""

from __future__ import annotations

import logging
from importlib import import_module
from typing import Any, cast

import numpy as np
import numpy.typing as npt

logger = logging.getLogger(__name__)

FloatArray = npt.NDArray[np.floating[Any]]
LabelArray = npt.NDArray[np.signedinteger[Any]]


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
    ) -> None:
        """
        Initialize HDBSCAN clusterer.
        """
        self.min_cluster_size = min_cluster_size
        self.min_samples = min_samples
        self.cluster_selection_epsilon = cluster_selection_epsilon
        self.metric = metric
        self.cluster_selection_method = cluster_selection_method

        self.cluster_labels: LabelArray | None = None
        self.cluster_probabilities: FloatArray | None = None
        self.outlier_scores: FloatArray | None = None
        self.n_clusters: int = 0
        self.n_noise: int = 0

    def fit_predict(self, embeddings: list[list[float]]) -> LabelArray:
        """
        Fit HDBSCAN and return cluster labels.

        Args:
            embeddings: List of article embedding vectors

        Returns:
            NumPy array of cluster labels (-1 for noise)
        """
        try:
            hdbscan = import_module("hdbscan")
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

            self.cluster_labels = cast(
                LabelArray,
                clusterer.fit_predict(embeddings_array),
            )
            self.cluster_probabilities = cast(FloatArray, clusterer.probabilities_)
            self.outlier_scores = cast(FloatArray, clusterer.outlier_scores_)

            self.n_clusters = len(set(self.cluster_labels)) - (
                1 if -1 in self.cluster_labels else 0
            )
            self.n_noise = int(np.sum(self.cluster_labels == -1))

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

    def _fallback_cluster(self, embeddings: list[list[float]]) -> LabelArray:
        """
        Simple fallback clustering when HDBSCAN not available.
        Uses sklearn's DBSCAN instead.
        """
        try:
            sklearn_cluster = import_module("sklearn.cluster")
            embeddings_array = np.array(embeddings, dtype=np.float32)

            # eps tuned for normalized embeddings (cosine ~ euclidean on sphere)
            eps = 1.0 - 0.75  # Equivalent to 0.75 cosine threshold

            clusterer = sklearn_cluster.DBSCAN(
                eps=eps,
                min_samples=self.min_samples,
            )
            labels = cast(LabelArray, clusterer.fit_predict(embeddings_array))

            self.n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
            self.n_noise = int(np.sum(labels == -1))

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
        embeddings: list[list[float]],
        article_ids: list[str],
    ) -> list[dict[str, Any]]:
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

        cluster_labels = self.cluster_labels
        embeddings_array = np.array(embeddings, dtype=np.float32)
        cluster_info: dict[int, dict[str, Any]] = {}

        for idx, (label, embedding) in enumerate(zip(cluster_labels, embeddings_array)):
            cluster_id = int(label)
            if cluster_id == -1:
                continue  # Skip noise

            if cluster_id not in cluster_info:
                cluster_info[cluster_id] = {
                    "cluster_id": cluster_id,
                    "article_ids": [],
                    "centroid": None,
                    "member_embeddings": [],
                    "size": 0,
                    "outlier_score_sum": 0.0,
                }

            cluster_info[cluster_id]["article_ids"].append(article_ids[idx])
            cluster_info[cluster_id]["member_embeddings"].append(embedding)
            cluster_info[cluster_id]["size"] += 1

            if self.outlier_scores is not None:
                cluster_info[cluster_id]["outlier_score_sum"] += float(
                    self.outlier_scores[idx]
                )

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
        article_ids: list[str],
        threshold: float = 0.7,
    ) -> list[dict[str, Any]]:
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

        cluster_labels = self.cluster_labels
        outlier_scores = self.outlier_scores
        noise_articles: list[dict[str, Any]] = []

        for idx, (label, outlier_score) in enumerate(
            zip(cluster_labels, outlier_scores)
        ):
            label_value = int(label)
            outlier_score_value = float(outlier_score)
            if label_value == -1 or outlier_score_value >= threshold:
                noise_articles.append(
                    {
                        "chroma_id": article_ids[idx],
                        "outlier_score": outlier_score_value,
                        "is_noise": label_value == -1,
                    }
                )

        return noise_articles

    def get_stats(self) -> dict[str, int | float]:
        """Get clustering statistics."""
        return {
            "n_clusters": self.n_clusters,
            "n_noise": self.n_noise,
            "noise_ratio": self.n_noise / max(len(self.cluster_labels), 1)
            if self.cluster_labels is not None
            else 0.0,
            "min_cluster_size": self.min_cluster_size,
            "min_samples": self.min_samples,
        }


def cluster_articles_hdbscan(
    embeddings: list[list[float]],
    article_ids: list[str],
    min_cluster_size: int = 5,
    min_samples: int = 3,
) -> tuple[LabelArray, list[dict[str, Any]]]:
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
