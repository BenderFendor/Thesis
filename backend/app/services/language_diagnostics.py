"""Deterministic language diagnostics for article text."""

from __future__ import annotations

import re
from typing import Literal, TypedDict


DiagnosticStatus = Literal["low", "medium", "high"]


class DiagnosticExample(TypedDict):
    """A sentence-level diagnostic example."""

    sentence: str
    term: str | None
    pattern: str | None
    category: str | None


class DiagnosticMetric(TypedDict):
    """A counted diagnostic metric."""

    count: int
    rate: float
    status: DiagnosticStatus
    examples: list[DiagnosticExample]


class DiagnosticOverall(TypedDict):
    """Overall language diagnostic summary."""

    score: float
    status: DiagnosticStatus
    summary: str


class LanguageDiagnosticsPayload(TypedDict):
    """Language diagnostic payload returned by the analyzer."""

    sentence_count: int
    word_count: int
    passive_voice: DiagnosticMetric
    actor_omission: DiagnosticMetric
    euphemisms: DiagnosticMetric
    sanitized_language: DiagnosticMetric
    overall: DiagnosticOverall


SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")
WORD_RE = re.compile(r"\b[\w'-]+\b")
PASSIVE_RE = re.compile(
    r"\b(?:am|are|is|was|were|be|been|being|got|gets|get)\s+"
    r"(?:\w+\s+){0,3}?"
    r"(?:[a-z]+ed|accused|arrested|beaten|born|detained|displaced|driven|"
    r"found|hit|hurt|injured|killed|left|made|reported|seen|shot|struck|told|wounded)\b",
    re.IGNORECASE,
)
BY_ACTOR_RE = re.compile(
    r"\bby\s+(?:the\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,5}\b", re.IGNORECASE
)
HARM_ACTION_RE = re.compile(
    r"\b(?:accused|arrested|attacked|beaten|blamed|charged|detained|displaced|"
    r"fired|hit|injured|killed|removed|shot|struck|targeted|wounded)\b",
    re.IGNORECASE,
)

EUPHEMISM_TERMS: dict[str, str] = {
    "administrative detention": "state power",
    "area denial": "military action",
    "collateral damage": "civilian harm",
    "enhanced interrogation": "state violence",
    "kinetic action": "military action",
    "neutralized": "lethal force",
    "pacification": "state power",
    "regrettable incident": "accountability",
    "security operation": "state power",
    "surgical strike": "military action",
    "targeted killing": "lethal force",
}
SANITIZED_TERMS: dict[str, str] = {
    "clashes": "agent ambiguity",
    "incident": "agent ambiguity",
    "mistakes were made": "accountability",
    "officer-involved shooting": "agent omission",
    "unrest": "agent ambiguity",
}


def analyze_language_diagnostics(text: str, title: str | None = None) -> LanguageDiagnosticsPayload:
    """Analyze article language for passive constructions and sanitized framing."""
    del title

    clean_text = " ".join(text.split())
    sentences = _split_sentences(clean_text)
    sentence_count = len(sentences)
    word_count = len(WORD_RE.findall(clean_text))

    passive_examples = _find_passive_examples(sentences)
    actor_omission_examples = _find_actor_omission_examples(sentences)
    euphemism_examples = _find_term_examples(sentences, EUPHEMISM_TERMS)
    sanitized_examples = _find_term_examples(sentences, SANITIZED_TERMS)

    passive_metric = _build_metric(
        len(passive_examples), sentence_count, passive_examples, (0.08, 0.18)
    )
    actor_omission_metric = _build_metric(
        len(actor_omission_examples),
        sentence_count,
        actor_omission_examples,
        (0.04, 0.1),
    )
    euphemism_metric = _build_metric(
        len(euphemism_examples), sentence_count, euphemism_examples, (0.03, 0.08)
    )
    sanitized_metric = _build_metric(
        len(sanitized_examples), sentence_count, sanitized_examples, (0.03, 0.08)
    )

    score = _overall_score(
        passive_metric, actor_omission_metric, euphemism_metric, sanitized_metric
    )
    overall_status = _status_for_score(score)

    return {
        "sentence_count": sentence_count,
        "word_count": word_count,
        "passive_voice": passive_metric,
        "actor_omission": actor_omission_metric,
        "euphemisms": euphemism_metric,
        "sanitized_language": sanitized_metric,
        "overall": {
            "score": score,
            "status": overall_status,
            "summary": _summary_for_status(
                overall_status, passive_metric, actor_omission_metric, euphemism_metric
            ),
        },
    }


def _split_sentences(text: str) -> list[str]:
    if not text:
        return []

    return [sentence.strip() for sentence in SENTENCE_RE.split(text) if sentence.strip()]


def _find_passive_examples(sentences: list[str]) -> list[DiagnosticExample]:
    examples: list[DiagnosticExample] = []
    for sentence in sentences:
        match = PASSIVE_RE.search(sentence)
        if not match:
            continue
        examples.append(
            {
                "sentence": _truncate_sentence(sentence),
                "term": None,
                "pattern": match.group(0),
                "category": "passive_voice",
            }
        )
    return examples[:5]


def _find_actor_omission_examples(sentences: list[str]) -> list[DiagnosticExample]:
    examples: list[DiagnosticExample] = []
    for sentence in sentences:
        if not PASSIVE_RE.search(sentence):
            continue
        if BY_ACTOR_RE.search(sentence):
            continue
        if not HARM_ACTION_RE.search(sentence):
            continue
        examples.append(
            {
                "sentence": _truncate_sentence(sentence),
                "term": None,
                "pattern": "passive without named actor",
                "category": "actor_omission",
            }
        )
    return examples[:5]


def _find_term_examples(sentences: list[str], terms: dict[str, str]) -> list[DiagnosticExample]:
    examples: list[DiagnosticExample] = []
    seen: set[tuple[str, str]] = set()
    for sentence in sentences:
        sentence_lower = sentence.lower()
        for term, category in terms.items():
            if term not in sentence_lower:
                continue
            key = (term, sentence)
            if key in seen:
                continue
            seen.add(key)
            examples.append(
                {
                    "sentence": _truncate_sentence(sentence),
                    "term": term,
                    "pattern": None,
                    "category": category,
                }
            )
            if len(examples) >= 5:
                return examples
    return examples


def _build_metric(
    count: int,
    sentence_count: int,
    examples: list[DiagnosticExample],
    thresholds: tuple[float, float],
) -> DiagnosticMetric:
    rate = round(count / sentence_count, 3) if sentence_count else 0.0
    return {
        "count": count,
        "rate": rate,
        "status": _status_for_rate(rate, thresholds),
        "examples": examples,
    }


def _status_for_rate(rate: float, thresholds: tuple[float, float]) -> DiagnosticStatus:
    medium_threshold, high_threshold = thresholds
    if rate >= high_threshold:
        return "high"
    if rate >= medium_threshold:
        return "medium"
    return "low"


def _overall_score(*metrics: DiagnosticMetric) -> float:
    weighted = (
        metrics[0]["rate"] * 0.35
        + metrics[1]["rate"] * 0.35
        + metrics[2]["rate"] * 0.2
        + metrics[3]["rate"] * 0.1
    )
    return round(min(1.0, weighted * 5), 3)


def _status_for_score(score: float) -> DiagnosticStatus:
    if score >= 0.45:
        return "high"
    if score >= 0.2:
        return "medium"
    return "low"


def _summary_for_status(
    status: DiagnosticStatus,
    passive_voice: DiagnosticMetric,
    actor_omission: DiagnosticMetric,
    euphemisms: DiagnosticMetric,
) -> str:
    if status == "high":
        return (
            "Language diagnostics found repeated passive framing, actor omission, "
            f"or sanitized terms across {passive_voice['count'] + actor_omission['count'] + euphemisms['count']} passages."
        )
    if status == "medium":
        return "Language diagnostics found some framing patterns worth comparing against other coverage."
    return "Language diagnostics found limited passive or sanitized framing in the available text."


def _truncate_sentence(sentence: str) -> str:
    if len(sentence) <= 280:
        return sentence
    return f"{sentence[:277].rstrip()}..."
