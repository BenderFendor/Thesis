"""Deterministic contradiction-first summaries for topic clusters."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

NEGATION_TERMS = {"no", "not", "never", "none", "without", "denied", "deny", "false"}
STOP_WORDS = {
    "about",
    "after",
    "again",
    "against",
    "also",
    "amid",
    "among",
    "and",
    "are",
    "article",
    "because",
    "been",
    "before",
    "being",
    "between",
    "but",
    "could",
    "from",
    "has",
    "have",
    "into",
    "more",
    "news",
    "over",
    "said",
    "says",
    "that",
    "the",
    "their",
    "this",
    "through",
    "under",
    "will",
    "with",
    "would",
}


def _sentence_candidates(article: dict[str, Any]) -> list[str]:
    text = " ".join(
        str(article.get(key) or "")
        for key in ("title", "summary")
        if isinstance(article.get(key), str)
    )
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    return sentences[:5]


def _tokens(text: str) -> list[str]:
    return [
        token.lower()
        for token in re.findall(r"\b[a-zA-Z][a-zA-Z'-]{2,}\b", text)
        if token.lower() not in STOP_WORDS
    ]


def _has_negation(text: str) -> bool:
    words = set(_tokens(text))
    return bool(words & NEGATION_TERMS)


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\b\d+(?:[,.]\d+)*(?:\.\d+)?%?\b", text))


def _article_source(article: dict[str, Any]) -> str:
    source = article.get("source")
    return str(source) if isinstance(source, str) and source else "Unknown source"


def build_contradiction_panel(cluster: dict[str, Any]) -> dict[str, Any]:
    """Build a compact contradiction-first panel from cluster articles.

    This is intentionally conservative. It only marks a group as disputed when
    article snippets around the same keyword have conflicting numbers or
    negation patterns. Everything else is presented as agreement or gaps.
    """
    articles = [a for a in cluster.get("articles") or [] if isinstance(a, dict)]
    source_names = {_article_source(article) for article in articles}
    if len(source_names) < 3 or len(articles) < 3:
        return {
            "status": "insufficient_source_diversity",
            "reason": "Contradiction-first analysis needs at least three source-diverse articles.",
            "claims": [],
            "agreed_facts": [],
            "unconfirmed_gaps": [],
            "source_count": len(source_names),
            "article_count": len(articles),
        }

    snippets_by_keyword: dict[str, list[dict[str, str]]] = defaultdict(list)
    token_counts: Counter[str] = Counter()
    for article in articles:
        candidates = _sentence_candidates(article)
        for sentence in candidates:
            token_counts.update(_tokens(sentence))
        for sentence in candidates:
            sentence_tokens = set(_tokens(sentence))
            for keyword, _count in token_counts.most_common(12):
                if keyword in sentence_tokens:
                    snippets_by_keyword[keyword].append(
                        {
                            "source": _article_source(article),
                            "article_url": str(article.get("url") or ""),
                            "stance": "mentions",
                            "snippet": sentence[:320],
                        }
                    )

    claims: list[dict[str, Any]] = []
    agreed_facts: list[dict[str, Any]] = []
    unconfirmed_gaps: list[str] = []

    for keyword, snippets in snippets_by_keyword.items():
        unique_sources = {snippet["source"] for snippet in snippets}
        if len(unique_sources) < 2:
            continue

        number_sets = [_numbers(snippet["snippet"]) for snippet in snippets]
        non_empty_numbers = [nums for nums in number_sets if nums]
        number_conflict = len({tuple(sorted(nums)) for nums in non_empty_numbers}) > 1
        negation_values = {_has_negation(snippet["snippet"]) for snippet in snippets}
        negation_conflict = len(negation_values) > 1

        if number_conflict or negation_conflict:
            claims.append(
                {
                    "claim": f"Sources diverge on details involving {keyword}.",
                    "status": "disputed",
                    "evidence": snippets[:6],
                }
            )
        elif len(unique_sources) >= 3 and len(agreed_facts) < 3:
            agreed_facts.append(
                {
                    "claim": f"Multiple sources mention {keyword}.",
                    "evidence": snippets[:4],
                }
            )
        elif len(unconfirmed_gaps) < 3:
            unconfirmed_gaps.append(
                f"Only {len(unique_sources)} sources mention {keyword}; check primary evidence before treating it as settled."
            )

        if len(claims) >= 5:
            break

    return {
        "status": "ok",
        "reason": None,
        "claims": claims[:5],
        "agreed_facts": agreed_facts[:3],
        "unconfirmed_gaps": unconfirmed_gaps[:3],
        "source_count": len(source_names),
        "article_count": len(articles),
    }
