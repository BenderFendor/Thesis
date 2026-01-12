"""
MinHash Deduplication Module

Fast near-duplicate detection using MinHash locality-sensitive hashing.
Pure algorithm - no neural network, runs on CPU.
"""

from __future__ import annotations

import logging
import hashlib
from typing import Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


NUM_HASH_FUNCTIONS = 128
MINHASH_LENGTH = 256
CHAR_NGRAM = 5
SIMILARITY_THRESHOLD = 0.85


def shingle_text(text: str, n: int = CHAR_NGRAM) -> Set[str]:
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
) -> List[int]:
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
        min_val = 2**64 - 1
        for shingle in shingles:
            # Compute hash for each shingle
            combined = f"{shingle}:{a}:{b}".encode()
            h = int(hashlib.md5(combined).hexdigest(), 16)
            if h < min_val:
                min_val = h
        minhash.append(min_val)

    return minhash


def estimate_jaccard_similarity(
    sig1: List[int],
    sig2: List[int],
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
    signatures: Dict[str, List[int]],
    threshold: float = SIMILARITY_THRESHOLD,
) -> Dict[Tuple[str, str], float]:
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
        bands: Optional[int] = None,
    ):
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
        self.signatures: Dict[str, List[int]] = {}
        self.documents: Dict[str, str] = {}

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
        documents: Dict[str, str],
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
        doc_ids: Optional[List[str]] = None,
        threshold: Optional[float] = None,
    ) -> List[Tuple[str, str, float]]:
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
        doc_ids: Optional[List[str]] = None,
    ) -> List[Tuple[str, str, float]]:
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
        buckets: Dict[Tuple[int, int], List[str]] = {}
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
        candidate_pairs: Set[Tuple[str, str]] = set()
        for bucket_docs in buckets.values():
            if len(bucket_docs) > 1:
                for i, d1 in enumerate(bucket_docs):
                    for d2 in bucket_docs[i + 1 :]:
                        pair = tuple(sorted((d1, d2)))
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

    def get_signature(self, doc_id: str) -> Optional[List[int]]:
        """Get MinHash signature for a document."""
        return self.signatures.get(doc_id)

    def get_stats(self) -> Dict:
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
    articles: List[Dict],
    text_field: str = "text",
    id_field: str = "chroma_id",
    threshold: float = SIMILARITY_THRESHOLD,
) -> Dict[str, Set[str]]:
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
    text_to_ids: Dict[str, List[str]] = {}
    for article in articles:
        text = article.get(text_field, "") or ""
        doc_id = article.get(id_field, "")
        if doc_id and text:
            text_hash = hashlib.md5(text.encode()).hexdigest()
            if text_hash not in text_to_ids:
                text_to_ids[text_hash] = []
            text_to_ids[text_hash].append(doc_id)

    # Add one representative per exact duplicate
    dedup_result: Dict[str, Set[str]] = {}
    for text_hash, ids in text_to_ids.items():
        representative = ids[0]
        dedup_result[representative] = set(ids)
        deduplicator.add_document(
            representative,
            list(text_to_ids.keys())[list(text_to_ids.keys()).index(text_hash)],
        )

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
