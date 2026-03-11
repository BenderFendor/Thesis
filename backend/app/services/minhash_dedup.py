"""
MinHash Deduplication Module

Fast near-duplicate detection using MinHash locality-sensitive hashing.
Pure algorithm - no neural network, runs on CPU.
"""

from __future__ import annotations

import hashlib
import importlib
import logging
from collections.abc import Mapping

rss_parser_rust = None

try:  # Optional Rust acceleration
    _rss_parser_rust = importlib.import_module("rss_parser_rust")
    _required_attrs = {"minhash_duplicate_pairs"}
    if _required_attrs.issubset(set(dir(_rss_parser_rust))):
        rss_parser_rust = _rss_parser_rust
        RUST_MINHASH_AVAILABLE = True
    else:  # pragma: no cover - import path can resolve to source dir namespace package
        RUST_MINHASH_AVAILABLE = False
except ImportError:  # pragma: no cover - optional dependency
    RUST_MINHASH_AVAILABLE = False

logger = logging.getLogger(__name__)


NUM_HASH_FUNCTIONS = 128
MINHASH_LENGTH = 256
CHAR_NGRAM = 5
SIMILARITY_THRESHOLD = 0.85
MAX_MD5_INT = 2**128 - 1


def _rust_duplicate_pairs(
    documents: list[tuple[str, str]],
    threshold: float,
    num_hashes: int,
) -> list[tuple[str, str, float]] | None:
    if not RUST_MINHASH_AVAILABLE or rss_parser_rust is None:
        return None
    try:
        minhash_duplicate_pairs = getattr(rss_parser_rust, "minhash_duplicate_pairs")
        payload = minhash_duplicate_pairs(
            documents,
            threshold,
            num_hashes,
        )
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.debug("Rust MinHash duplicate detection failed: %s", exc)
        return None

    result: list[tuple[str, str, float]] = []
    for item in payload:
        doc_id_1 = item.get("doc_id_1")
        doc_id_2 = item.get("doc_id_2")
        similarity = item.get("similarity")
        if (
            isinstance(doc_id_1, str)
            and isinstance(doc_id_2, str)
            and isinstance(similarity, (int, float))
        ):
            result.append((doc_id_1, doc_id_2, float(similarity)))
    return result


def shingle_text(text: str, n: int = CHAR_NGRAM) -> set[str]:
    """
    Create character n-grams (shingles) from text.

    Args:
        text: Input text
        n: N-gram size (default 5 for near-duplicate detection)

    Returns:
        Set of n-gram strings
    """
    text = text.lower().strip()
    if len(text) < n:
        return {text} if text else set()

    shingles = set()
    for i in range(len(text) - n + 1):
        shingle = text[i : i + n]
        shingles.add(shingle)

    return shingles


def compute_minhash(
    text: str,
    num_hashes: int = NUM_HASH_FUNCTIONS,
    seed: int = 42,
) -> list[int]:
    """
    Compute MinHash signature for a document.

    Uses multiple hash functions to create a compact signature
    that approximates Jaccard similarity between documents.

    Args:
        text: Input text
        num_hashes: Number of hash functions (128 recommended)
        seed: Random seed for hash function generation

    Returns:
        List of minhash values
    """
    shingles = shingle_text(text)

    if not shingles:
        return [2**64 - 1] * num_hashes

    # Generate hash function parameters using seeded approach
    hash_params = []
    for i in range(num_hashes):
        hash_seed = seed + i
        a = ((hash_seed * 6364136223846793005) + 1442695040888963407) % (2**64)
        b = ((hash_seed * 3410719502) + 3141592653) % (2**64)
        hash_params.append((a, b))

    minhash = []
    for a, b in hash_params:
        min_val = MAX_MD5_INT
        for shingle in shingles:
            # Compute hash for each shingle
            combined = f"{shingle}:{a}:{b}".encode()
            h = int(hashlib.md5(combined).hexdigest(), 16)
            if h < min_val:
                min_val = h
        minhash.append(min_val)

    return minhash


def estimate_jaccard_similarity(
    sig1: list[int],
    sig2: list[int],
) -> float:
    """
    Estimate Jaccard similarity from MinHash signatures.

    The probability that minhash values agree equals Jaccard similarity.

    Args:
        sig1: First MinHash signature
        sig2: Second MinHash signature

    Returns:
        Estimated Jaccard similarity (0.0 to 1.0)
    """
    if len(sig1) != len(sig2):
        return 0.0

    if not sig1 or not sig2:
        return 0.0

    matches = sum(1 for a, b in zip(sig1, sig2) if a == b)
    return matches / len(sig1)


def compute_similarity_matrix(
    signatures: dict[str, list[int]],
    threshold: float = SIMILARITY_THRESHOLD,
) -> dict[tuple[str, str], float]:
    """
    Compute pairwise similarity for all documents.

    Args:
        signatures: Dict mapping doc_id -> MinHash signature
        threshold: Similarity threshold for output

    Returns:
        Dict of (id1, id2) -> similarity score (only above threshold)
    """
    ids = list(signatures.keys())
    n = len(ids)
    similarities = {}

    for i in range(n):
        for j in range(i + 1, n):
            sim = estimate_jaccard_similarity(signatures[ids[i]], signatures[ids[j]])
            if sim >= threshold:
                similarities[(ids[i], ids[j])] = sim

    return similarities


class MinHashDeduplicator:
    """
    Near-duplicate detection using MinHash LSH.

    Usage:
        dedup = MinHashDeduplicator()
        dedup.add_document("doc1", "article text...")
        dedup.add_document("doc2", "similar article...")
        duplicates = dedup.find_duplicates(threshold=0.85)
    """

    def __init__(
        self,
        num_hashes: int = NUM_HASH_FUNCTIONS,
        threshold: float = SIMILARITY_THRESHOLD,
        bands: int | None = None,
    ) -> None:
        """
        Initialize deduplicator.

        Args:
            num_hashes: Number of hash functions in signature
            threshold: Similarity threshold for duplicate detection
            bands: Number of LSH bands (auto-calculated if None)
        """
        self.num_hashes = num_hashes
        self.threshold = threshold
        self.bands = bands if bands is not None else 8
        self.signatures: dict[str, list[int]] = {}
        self.documents: dict[str, str] = {}

    def add_document(self, doc_id: str, text: str) -> None:
        """
        Add a document to the index.

        Args:
            doc_id: Unique document identifier
            text: Document text content
        """
        signature = compute_minhash(text, num_hashes=self.num_hashes)
        self.signatures[doc_id] = signature
        self.documents[doc_id] = text
        logger.debug(f"Added document {doc_id} with MinHash signature")

    def add_documents_batch(
        self,
        documents: dict[str, str],
        batch_size: int = 100,
    ) -> int:
        """
        Add multiple documents efficiently.

        Args:
            documents: Dict of doc_id -> text
            batch_size: Processing batch size

        Returns:
            Number of documents added
        """
        count = 0
        for doc_id, text in documents.items():
            self.add_document(doc_id, text)
            count += 1
            if count % batch_size == 0:
                logger.debug(f"Processed {count}/{len(documents)} documents")

        logger.info(f"Added {count} documents to MinHash index")
        return count

    def find_duplicates(
        self,
        doc_ids: list[str] | None = None,
        threshold: float | None = None,
    ) -> list[tuple[str, str, float]]:
        """
        Find near-duplicate document pairs.

        Args:
            doc_ids: Optional list of specific documents to check
            threshold: Override similarity threshold

        Returns:
            List of (doc_id1, doc_id2, similarity) tuples
        """
        threshold = threshold or self.threshold

        if doc_ids is None:
            doc_ids = list(self.signatures.keys())

        rust_documents = [
            (doc_id, self.documents[doc_id])
            for doc_id in doc_ids
            if doc_id in self.documents and self.documents[doc_id]
        ]
        rust_duplicates = _rust_duplicate_pairs(
            rust_documents,
            threshold,
            self.num_hashes,
        )
        if rust_duplicates is not None:
            logger.info(
                "Found %s duplicate pairs above threshold %s via Rust",
                len(rust_duplicates),
                threshold,
            )
            return rust_duplicates

        duplicates = []

        for i, id1 in enumerate(doc_ids):
            for id2 in doc_ids[i + 1 :]:
                if id1 in self.signatures and id2 in self.signatures:
                    sim = estimate_jaccard_similarity(
                        self.signatures[id1],
                        self.signatures[id2],
                    )
                    if sim >= threshold:
                        duplicates.append((id1, id2, sim))

        # Sort by similarity descending
        duplicates.sort(key=lambda x: x[2], reverse=True)

        logger.info(
            f"Found {len(duplicates)} duplicate pairs above threshold {threshold}"
        )
        return duplicates

    def find_duplicates_lsh(
        self,
        doc_ids: list[str] | None = None,
    ) -> list[tuple[str, str, float]]:
        """
        Find duplicates using Locality-Sensitive Hashing for efficiency.

        LSH buckets similar signatures together, avoiding O(n²) comparison.

        Args:
            doc_ids: Optional list of specific documents to check

        Returns:
            List of (doc_id1, doc_id2, similarity) tuples
        """
        threshold = self.threshold

        if doc_ids is None:
            doc_ids = list(self.signatures.keys())

        # Build LSH buckets
        buckets: dict[tuple[int, tuple[int, ...]], list[str]] = {}
        rows_per_band = self.num_hashes // self.bands

        for doc_id in doc_ids:
            sig = self.signatures[doc_id]
            for band in range(self.bands):
                start = band * rows_per_band
                end = start + rows_per_band
                band_hash = tuple(sig[start:end])
                bucket_key = (band, band_hash)
                if bucket_key not in buckets:
                    buckets[bucket_key] = []
                buckets[bucket_key].append(doc_id)

        # Find candidate pairs from buckets
        candidate_pairs: set[tuple[str, str]] = set()
        for bucket_docs in buckets.values():
            if len(bucket_docs) > 1:
                for i, d1 in enumerate(bucket_docs):
                    for d2 in bucket_docs[i + 1 :]:
                        pair: tuple[str, str] = (d1, d2) if d1 <= d2 else (d2, d1)
                        candidate_pairs.add(pair)

        # Verify candidates with full similarity
        duplicates = []
        for id1, id2 in candidate_pairs:
            sim = estimate_jaccard_similarity(
                self.signatures[id1],
                self.signatures[id2],
            )
            if sim >= threshold:
                duplicates.append((id1, id2, sim))

        duplicates.sort(key=lambda x: x[2], reverse=True)

        logger.info(f"LSH found {len(duplicates)} duplicate pairs")
        return duplicates

    def get_signature(self, doc_id: str) -> list[int] | None:
        """Get MinHash signature for a document."""
        return self.signatures.get(doc_id)

    def get_stats(self) -> dict[str, int | float]:
        """Get deduplicator statistics."""
        return {
            "document_count": len(self.signatures),
            "num_hashes": self.num_hashes,
            "threshold": self.threshold,
            "bands": self.bands,
        }

    def clear(self) -> None:
        """Clear all documents from the index."""
        self.signatures.clear()
        self.documents.clear()


def deduplicate_articles(
    articles: list[Mapping[str, object]],
    text_field: str = "text",
    id_field: str = "chroma_id",
    threshold: float = SIMILARITY_THRESHOLD,
) -> dict[str, set[str]]:
    """
    Find duplicate groups in a list of articles.

    Args:
        articles: List of article dicts
        text_field: Field containing article text
        id_field: Field containing article ID
        threshold: Similarity threshold

    Returns:
        Dict mapping representative_id -> set of duplicate IDs
    """
    deduplicator = MinHashDeduplicator(threshold=threshold)

    # Build mapping from text to IDs (handle exact duplicates)
    text_to_ids: dict[str, list[str]] = {}
    text_by_hash: dict[str, str] = {}
    for article in articles:
        text_value = article.get(text_field, "") or ""
        doc_id_value = article.get(id_field, "")
        text = (
            text_value
            if isinstance(text_value, str)
            else str(text_value)
            if text_value
            else ""
        )
        doc_id = (
            doc_id_value
            if isinstance(doc_id_value, str)
            else str(doc_id_value)
            if doc_id_value
            else ""
        )
        if doc_id and text:
            text_hash = hashlib.md5(text.encode()).hexdigest()
            if text_hash not in text_to_ids:
                text_to_ids[text_hash] = []
                text_by_hash[text_hash] = text
            text_to_ids[text_hash].append(doc_id)

    # Add one representative per exact duplicate
    dedup_result: dict[str, set[str]] = {}
    for text_hash, ids in text_to_ids.items():
        representative = ids[0]
        dedup_result[representative] = set(ids)
        deduplicator.add_document(representative, text_by_hash[text_hash])

    # Find near-duplicates
    duplicates = deduplicator.find_duplicates()

    for id1, id2, sim in duplicates:
        # Merge into existing group or create new one
        found = False
        for rep, group in dedup_result.items():
            if id1 in group:
                group.add(id2)
                found = True
                break
        if not found:
            dedup_result[id1] = {id1, id2}

    return dedup_result
