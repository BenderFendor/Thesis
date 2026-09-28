from __future__ import annotations

import re
import unicodedata
from collections import Counter

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.api.routes.comparison import ComparisonRequest, compare_two_articles
from app.services.article_comparison import extract_keywords

_NON_STOPWORDS = ("zebra", "yak", "election", "policy", "reform", "climate")


def _python_keyword_reference(text: str, top_n: int) -> list[tuple[str, int]]:
    words = re.findall(r"\b[a-z]{3,}\b", text.lower())
    return Counter(words).most_common(top_n)


def test_comparison_keywords_preserve_frequency_ties_stop_words_and_limits() -> None:
    assert extract_keywords("zebra yak zebra yak") == [("zebra", 2), ("yak", 2)]
    assert extract_keywords("The election was about policy and reform.") == [
        ("election", 1),
        ("policy", 1),
        ("reform", 1),
    ]
    assert extract_keywords("election policy reform", 2) == [
        ("election", 1),
        ("policy", 1),
    ]
    assert extract_keywords("election policy", 0) == []
    assert extract_keywords("election policy", -1) == []
    assert extract_keywords("election policy", 10**100) == [
        ("election", 1),
        ("policy", 1),
    ]


def test_comparison_keyword_boundaries_match_python_alphanumeric_rules() -> None:
    assert extract_keywords("\u0345abc \u2160def \u2460ghi \u0663jkl") == [("abc", 1)]
    extension_i = "\U0002ebf0abc"
    unicode_version = tuple(map(int, unicodedata.unidata_version.split(".")))
    if unicode_version >= (15, 1, 0):
        assert extract_keywords(extension_i) == []
    else:
        assert extract_keywords(extension_i) == [("abc", 1)]


@given(
    words=st.lists(st.sampled_from(_NON_STOPWORDS), max_size=80),
    separator=st.sampled_from((" ", " / ", "İ", "\u0345", "\u2160", "é")),
    top_n=st.integers(min_value=0, max_value=24),
)
def test_rust_keywords_match_python_reference_for_non_stopword_tokens(
    words: list[str], separator: str, top_n: int
) -> None:
    text = separator.join(words)
    assert extract_keywords(text, top_n) == _python_keyword_reference(text, top_n)


@pytest.mark.asyncio
async def test_comparison_route_keeps_response_shape_and_rust_keyword_results() -> None:
    result = await compare_two_articles(
        ComparisonRequest(
            content_1="zebra yak zebra yak",
            content_2="policy reform policy",
        )
    )

    payload = result.model_dump()
    assert set(payload) == {"similarity", "entities", "keywords", "diff", "summary"}
    assert payload["keywords"]["source_1_top"] == [
        {"word": "zebra", "count": 2},
        {"word": "yak", "count": 2},
    ]
    assert payload["keywords"]["source_2_top"] == [
        {"word": "policy", "count": 2},
        {"word": "reform", "count": 1},
    ]
