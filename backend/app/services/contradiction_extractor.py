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


def _append_ranked_snippets(
    article: dict[str, Any],
    sentences: list[str],
    keywords: list[str],
    snippets_by_keyword: dict[str, list[dict[str, str]]],
) -> None:
    source = _article_source(article)
    article_url = str(article.get("url") or "")
    for sentence in sentences:
        sentence_tokens = set(_tokens(sentence))
        for keyword in keywords:
            if keyword in sentence_tokens:
                snippets_by_keyword[keyword].append(
                    {
                        "source": source,
                        "article_url": article_url,
                        "stance": "mentions",
                        "snippet": sentence[:320],
                    }
                )


def _collect_keyword_snippets(
    articles: list[dict[str, Any]],
) -> dict[str, list[dict[str, str]]]:
    snippets_by_keyword: dict[str, list[dict[str, str]]] = defaultdict(list)
    token_counts: Counter[str] = Counter()
    for article in articles:
        sentences = _sentence_candidates(article)
        for sentence in sentences:
            token_counts.update(_tokens(sentence))
        keywords = [keyword for keyword, _count in token_counts.most_common(12)]
        _append_ranked_snippets(article, sentences, keywords, snippets_by_keyword)
    return snippets_by_keyword


def _has_numeric_conflict(snippets: list[dict[str, str]]) -> bool:
    number_sets = [_numbers(snippet["snippet"]) for snippet in snippets]
    non_empty_numbers = [numbers for numbers in number_sets if numbers]
    return len({tuple(sorted(numbers)) for numbers in non_empty_numbers}) > 1


def _has_negation_conflict(snippets: list[dict[str, str]]) -> bool:
    return len({_has_negation(snippet["snippet"]) for snippet in snippets}) > 1


def _keyword_summary(
    keyword: str,
    snippets: list[dict[str, str]],
    agreed_count: int,
    gap_count: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    unique_sources = {snippet["source"] for snippet in snippets}
    if len(unique_sources) < 2:
        return None, None, None
    if _has_numeric_conflict(snippets) or _has_negation_conflict(snippets):
        return (
            {
                "claim": f"Sources diverge on details involving {keyword}.",
                "status": "disputed",
                "evidence": snippets[:6],
            },
            None,
            None,
        )
    if len(unique_sources) >= 3 and agreed_count < 3:
        return (
            None,
            {
                "claim": f"Multiple sources mention {keyword}.",
                "evidence": snippets[:4],
            },
            None,
        )
    if gap_count < 3:
        return (
            None,
            None,
            f"Only {len(unique_sources)} sources mention {keyword}; check primary evidence before treating it as settled.",
        )
    return None, None, None


def _summarize_keyword_groups(
    snippets_by_keyword: dict[str, list[dict[str, str]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    claims: list[dict[str, Any]] = []
    agreed_facts: list[dict[str, Any]] = []
    unconfirmed_gaps: list[str] = []
    for keyword, snippets in snippets_by_keyword.items():
        claim, fact, gap = _keyword_summary(
            keyword,
            snippets,
            len(agreed_facts),
            len(unconfirmed_gaps),
        )
        if claim is not None:
            claims.append(claim)
        if fact is not None:
            agreed_facts.append(fact)
        if gap is not None:
            unconfirmed_gaps.append(gap)
        if len(claims) >= 5:
            break
    return claims, agreed_facts, unconfirmed_gaps


def _panel_result(
    articles: list[dict[str, Any]],
    source_names: set[str],
    claims: list[dict[str, Any]],
    agreed_facts: list[dict[str, Any]],
    unconfirmed_gaps: list[str],
) -> dict[str, Any]:
    return {
        "status": "ok",
        "reason": None,
        "claims": claims[:5],
        "agreed_facts": agreed_facts[:3],
        "unconfirmed_gaps": unconfirmed_gaps[:3],
        "source_count": len(source_names),
        "article_count": len(articles),
    }


def build_contradiction_panel(cluster: dict[str, Any]) -> dict[str, Any]:
    """Build a compact contradiction-first panel from cluster articles.

    This is intentionally conservative. It only marks a group as disputed when
    article snippets around the same keyword have conflicting numbers or
    negation patterns. Everything else is presented as agreement or gaps.
    """
    articles = [article for article in cluster.get("articles") or [] if isinstance(article, dict)]
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

    snippets_by_keyword = _collect_keyword_snippets(articles)
    claims, agreed_facts, unconfirmed_gaps = _summarize_keyword_groups(snippets_by_keyword)
    return _panel_result(
        articles,
        source_names,
        claims,
        agreed_facts,
        unconfirmed_gaps,
    )
