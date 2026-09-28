from __future__ import annotations

import json

from hypothesis import given
from hypothesis import strategies as st

from app.services.language_diagnostics import (
    analyze_language_diagnostics,
    analyze_language_diagnostics_python,
)
from rss_parser_rust import analyze_language_diagnostics_json

_REVIEWED_TEXTS = (
    "The neighborhood was struck before dawn. Five residents were killed during what officials called a surgical strike. The ministry said collateral damage was regrettable. Witnesses said the army fired from the ridge.",
    "The city council approved the budget after a public vote. The mayor signed the ordinance on Tuesday.",
    "Clashes were reported. Clashes were reported. Mistakes were made, and an officer-involved shooting followed.",
    "A person was injured by the police. The report was reviewed by the city council.",
    "Officials called the event an incident. The incident was not reported by the police.",
    "One. Two. lower case continues.\u001cThree!\n\tFour? 'Five'",
    "İ ı ſ K café cafe\u0301 123 _word word-word word's",
    "was e\u0301 killed.",
    "ıS killed.",
    "İs killed.",
    "waſ killed.",
    "One was injured by the Kelvin police.",
    "a\U0002ebf0' b",
    "\U0002ebf0-b",
    "The subject was killed. " + "Residents met today. " * 31,
)

_LEXICAL_PARTS = (
    "was killed",
    "were attacked by the army",
    "were detained",
    "collateral damage",
    "surgical strike",
    "mistakes were made",
    "clashes",
    "unrest",
    "incident",
    "the council voted",
    "by officials",
    "İ ı ſ K",
    "e\u0301 café",
    "\u001c\u00a0\t",
    '!? "Quoted. Next"',
    "word-word word's",
)


def _rust_result(text: str, title: str | None = None) -> dict[str, object]:
    return json.loads(analyze_language_diagnostics_json(text, title))


def test_rust_diagnostics_match_reviewed_python_cases() -> None:
    for text in _REVIEWED_TEXTS:
        for title in (None, "was killed"):  # title is intentionally ignored by the contract.
            expected = analyze_language_diagnostics_python(text, title)
            assert _rust_result(text, title) == expected
            assert analyze_language_diagnostics(text, title) == expected


@given(text=st.text(max_size=240))
def test_rust_diagnostics_match_python_for_unicode_text(text: str) -> None:
    assert _rust_result(text) == analyze_language_diagnostics_python(text)
    assert analyze_language_diagnostics(text) == analyze_language_diagnostics_python(text)


@given(
    parts=st.lists(st.sampled_from(_LEXICAL_PARTS), max_size=24),
    separator=st.sampled_from((" ", "\n", "\t", "\u001c", "\u00a0", "  ")),
)
def test_rust_diagnostics_match_python_for_generated_language_patterns(
    parts: list[str], separator: str
) -> None:
    text = separator.join(parts)
    expected = analyze_language_diagnostics_python(text)
    assert _rust_result(text) == expected
    assert analyze_language_diagnostics(text) == expected
