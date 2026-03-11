from __future__ import annotations

from collections.abc import Mapping

from hypothesis import given, strategies as st

from app.services.article_comparison import (
    calculate_text_similarity,
    generate_diff_highlights,
)
from app.services.minhash_dedup import MinHashDeduplicator, deduplicate_articles


@given(st.text(min_size=1, max_size=120))
def test_text_similarity_is_one_for_identical_text(text: str) -> None:
    assert calculate_text_similarity(text, text) == 1.0


@given(st.text(min_size=1, max_size=120), st.text(min_size=1, max_size=120))
def test_text_similarity_stays_in_unit_interval(left: str, right: str) -> None:
    similarity = calculate_text_similarity(left, right)
    assert 0.0 <= similarity <= 1.0


def test_generate_diff_highlights_preserves_unique_sentence_markers() -> None:
    diff = generate_diff_highlights(
        "Alpha wins the vote. Beta calls for a recount.",
        "Alpha wins the vote. Gamma calls for reform.",
    )
    assert any(
        item["source_1_text"] == "Alpha wins the vote." for item in diff["similar"]
    )
    assert any(item["type"] == "unique_to_source_1" for item in diff["removed"])
    assert any(item["type"] == "unique_to_source_2" for item in diff["added"])


def test_minhash_deduplicator_detects_near_duplicates() -> None:
    deduplicator = MinHashDeduplicator(threshold=0.5)
    deduplicator.add_document(
        "doc-1",
        "Climate talks focus on emissions targets and regional energy costs.",
    )
    deduplicator.add_document(
        "doc-2",
        "Climate talks focus on emissions targets and regional energy costs with new concessions.",
    )
    deduplicator.add_document(
        "doc-3",
        "Local sports coverage highlights a derby win downtown.",
    )

    duplicates = deduplicator.find_duplicates()
    assert duplicates
    assert duplicates[0][0:2] == ("doc-1", "doc-2")
    assert duplicates[0][2] >= 0.5


def test_deduplicate_articles_groups_exact_duplicates() -> None:
    articles: list[Mapping[str, object]] = [
        {"chroma_id": "a1", "text": "Shared article body."},
        {"chroma_id": "a2", "text": "Shared article body."},
        {"chroma_id": "a3", "text": "Completely different writeup."},
    ]

    grouped = deduplicate_articles(articles, threshold=0.9)
    assert any(group == {"a1", "a2"} for group in grouped.values())
