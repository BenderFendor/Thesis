from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from app.services.article_comparison import (
    calculate_text_similarity,
    generate_diff_highlights,
)
from app.services.rss_parser_rust_bindings import RUST, deduplicate_article_groups


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
    assert any(item["source_1_text"] == "Alpha wins the vote." for item in diff["similar"])
    assert any(item["type"] == "unique_to_source_1" for item in diff["removed"])
    assert any(item["type"] == "unique_to_source_2" for item in diff["added"])


def test_rust_minhash_core_reports_near_duplicate_similarity() -> None:
    duplicates = RUST.minhash_duplicate_pairs(
        [
            (
                "doc-1",
                "Climate talks focus on emissions targets and regional energy costs.",
            ),
            (
                "doc-2",
                "Climate talks focus on emissions targets and regional energy costs with new concessions.",
            ),
            (
                "doc-3",
                "Local sports coverage highlights a derby win downtown.",
            ),
        ],
        threshold=0.5,
    )
    assert duplicates
    assert duplicates[0]["doc_id_1"] == "doc-1"
    assert duplicates[0]["doc_id_2"] == "doc-2"
    similarity = duplicates[0]["similarity"]
    assert isinstance(similarity, float)
    assert 0.5 <= similarity <= 1.0


def test_rust_deduplication_groups_exact_duplicates() -> None:
    articles = [
        ("a1", "Shared article body."),
        ("a2", "Shared article body."),
        ("a3", "Completely different writeup."),
    ]

    grouped = deduplicate_article_groups(articles, threshold=0.9)
    assert any(group == {"a1", "a2"} for group in grouped.values())


def test_rust_deduplication_merges_connected_duplicate_groups() -> None:
    articles = [
        ("first", "Alpha article text"),
        ("second", "Alpha article text with one added clause"),
        (
            "third",
            "Alpha article text with one added clause and another",
        ),
    ]

    grouped = deduplicate_article_groups(articles, threshold=0.0)
    assert len(grouped) == 1
    assert next(iter(grouped.values())) == {"first", "second", "third"}
