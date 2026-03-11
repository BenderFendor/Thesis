from __future__ import annotations

from hypothesis import given, strategies as st

from app.services.country_mentions import extract_article_mentioned_countries


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
    assert mentions == ["CN", "US"]
