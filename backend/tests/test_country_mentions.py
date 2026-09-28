from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.services.country_mentions import extract_article_mentioned_countries
from app.services.rss_parser_rust_bindings import (
    RUST,
    extract_mentioned_countries_rust,
)


@given(
    prefix=st.text(alphabet=st.characters(blacklist_categories=("Cs",)), max_size=30),
    suffix=st.text(alphabet=st.characters(blacklist_categories=("Cs",)), max_size=30),
)
def test_extract_article_mentioned_countries_dedupes_and_sorts_alias_matches(
    prefix: str,
    suffix: str,
) -> None:
    mentions = extract_article_mentioned_countries(
        f"{prefix} United States {suffix}",
        "USA and Beijing appear in the same briefing.",
        "China remains central to the discussion.",
    )

    assert mentions == sorted(mentions)
    assert len(mentions) == len(set(mentions))
    assert {"CN", "US"}.issubset(mentions)


def test_extract_article_mentioned_countries_returns_expected_aliases_without_extra_text() -> None:
    mentions = extract_article_mentioned_countries(
        "United States",
        "USA and Beijing appear in the same briefing.",
        "China remains central to the discussion.",
    )

    assert mentions == ["CN", "US"]


def test_extract_article_mentioned_countries_requires_exact_case_for_short_acronyms() -> None:
    mentions = extract_article_mentioned_countries(
        "United States Uk",
        "Usa is mixed case here on purpose.",
        "China remains central to the discussion.",
    )

    assert mentions == ["CN", "US"]


def test_article_path_matches_direct_text_path_on_reviewed_corpus() -> None:
    title = "United States"
    summary = "USA and Beijing appear in the same briefing."
    content = "China remains central to the discussion."

    article_mentions = extract_article_mentioned_countries(title, summary, content)
    direct_mentions = extract_mentioned_countries_rust(f"{title} {summary} {content}")

    assert article_mentions == direct_mentions == ["CN", "US"]


def test_ambiguous_candidates_and_longest_aliases_use_country_context() -> None:
    assert extract_mentioned_countries_rust("American") == ["MP", "US"]
    assert extract_mentioned_countries_rust("prefixAmericansuffix") == ["MP", "US"]
    assert extract_mentioned_countries_rust("South Sudanese officials") == ["SS"]
    assert extract_mentioned_countries_rust("British Indian Ocean Territory") == ["IO"]
    assert extract_mentioned_countries_rust("American Samoa") == ["AS"]
    assert extract_mentioned_countries_rust("British Virgin Island") == ["VG"]
    assert extract_mentioned_countries_rust("Republic of China") == ["TW"]
    assert extract_mentioned_countries_rust("People's Republic of China") == ["CN"]
    assert extract_mentioned_countries_rust("Channel Island") == ["GG", "JE"]
    assert extract_mentioned_countries_rust("REPÚBLICA DE GUINEA ECUATORIAL") == ["GQ"]


def test_reload_country_aliases_replaces_the_active_alias_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_file = tmp_path / "country_aliases.json"
    data_file.write_text(json.dumps({"ZZ": ["Zedland"]}), encoding="utf-8")
    configured_data_dir = os.environ["RSS_PARSER_DATA_DIR"]

    try:
        monkeypatch.setenv("RSS_PARSER_DATA_DIR", str(tmp_path))
        result = RUST.rust_reload_country_aliases()

        assert result == {"loaded": True, "countries": 1}
        assert extract_mentioned_countries_rust("Zedland") == ["ZZ"]
    finally:
        monkeypatch.setenv("RSS_PARSER_DATA_DIR", configured_data_dir)
        RUST.rust_reload_country_aliases()
