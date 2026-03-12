"""
MinHash deduplication backed by the Rust extension.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping

from app.services.rss_parser_rust_bindings import deduplicate_article_groups

logger = logging.getLogger(__name__)

NUM_HASH_FUNCTIONS = 128
SIMILARITY_THRESHOLD = 0.85


class MinHashDeduplicator:
    """Near-duplicate detection using the Rust MinHash implementation."""

    def __init__(
        self,
        num_hashes: int = NUM_HASH_FUNCTIONS,
        threshold: float = SIMILARITY_THRESHOLD,
        bands: int | None = None,
    ) -> None:
        self.num_hashes = num_hashes
        self.threshold = threshold
        self.bands = bands if bands is not None else 8
        self.documents: dict[str, str] = {}

    def add_document(self, doc_id: str, text: str) -> None:
        self.documents[doc_id] = text
        logger.debug("Added document %s to Rust MinHash index", doc_id)

    def add_documents_batch(
        self,
        documents: dict[str, str],
        batch_size: int = 100,
    ) -> int:
        count = 0
        for doc_id, text in documents.items():
            self.add_document(doc_id, text)
            count += 1
            if count % batch_size == 0:
                logger.debug("Processed %s/%s documents", count, len(documents))

        logger.info("Added %s documents to Rust MinHash index", count)
        return count

    def find_duplicates(
        self,
        doc_ids: list[str] | None = None,
        threshold: float | None = None,
    ) -> list[tuple[str, str, float]]:
        active_threshold = threshold or self.threshold
        selected_ids = doc_ids or list(self.documents.keys())
        documents = [
            (doc_id, self.documents[doc_id])
            for doc_id in selected_ids
            if doc_id in self.documents and self.documents[doc_id]
        ]
        groups = deduplicate_article_groups(
            documents,
            threshold=active_threshold,
            num_hashes=self.num_hashes,
        )

        duplicates: list[tuple[str, str, float]] = []
        for representative, members in groups.items():
            for member in sorted(members):
                if member == representative:
                    continue
                left, right = sorted((representative, member))
                duplicates.append((left, right, active_threshold))

        duplicates.sort(key=lambda item: (-item[2], item[0], item[1]))
        logger.info(
            "Found %s duplicate pairs above threshold %s via Rust",
            len(duplicates),
            active_threshold,
        )
        return duplicates

    def find_duplicates_lsh(
        self,
        doc_ids: list[str] | None = None,
    ) -> list[tuple[str, str, float]]:
        return self.find_duplicates(doc_ids=doc_ids, threshold=self.threshold)

    def get_signature(self, doc_id: str) -> list[int] | None:
        logger.debug(
            "Rust-backed deduplicator does not expose signatures for %s", doc_id
        )
        return None

    def get_stats(self) -> dict[str, int | float]:
        return {
            "document_count": len(self.documents),
            "num_hashes": self.num_hashes,
            "threshold": self.threshold,
            "bands": self.bands,
        }

    def clear(self) -> None:
        self.documents.clear()


def deduplicate_articles(
    articles: list[Mapping[str, object]],
    text_field: str = "text",
    id_field: str = "chroma_id",
    threshold: float = SIMILARITY_THRESHOLD,
) -> dict[str, set[str]]:
    rust_documents = []
    for article in articles:
        doc_id_value = article.get(id_field, "")
        text_value = article.get(text_field, "")
        doc_id = (
            doc_id_value if isinstance(doc_id_value, str) else str(doc_id_value or "")
        )
        text = text_value if isinstance(text_value, str) else str(text_value or "")
        if doc_id and text:
            rust_documents.append((doc_id, text))

    return deduplicate_article_groups(
        rust_documents,
        threshold=threshold,
        num_hashes=NUM_HASH_FUNCTIONS,
    )
