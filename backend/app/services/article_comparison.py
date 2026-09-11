"""Multi-source story comparison service with entity extraction and diff analysis."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, TypedDict

from app.services.rss_parser_rust_bindings import (
    sentence_diff as rust_sentence_diff,
    text_similarity as rust_text_similarity,
)


class CommonKeywordDiff(TypedDict):
    """Common Keyword Diff."""

    keyword: str
    source_1_freq: int
    source_2_freq: int
    difference: int
    emphasis: str


class UniqueKeywordFrequency(TypedDict):
    """Unique Keyword Frequency."""

    keyword: str
    frequency: int


class KeywordComparisonResult(TypedDict):
    """Keyword Comparison Result."""

    common_keywords: list[CommonKeywordDiff]
    unique_to_source_1: list[UniqueKeywordFrequency]
    unique_to_source_2: list[UniqueKeywordFrequency]


_COMMON_ENTITY_WORDS = frozenset(
    {
        "The",
        "A",
        "An",
        "In",
        "On",
        "At",
        "To",
        "For",
        "Of",
        "And",
        "Or",
        "But",
        "Is",
        "Are",
        "Was",
        "Were",
        "This",
        "That",
        "These",
        "Those",
        "It",
        "He",
        "She",
        "They",
        "We",
        "You",
        "I",
        "Me",
        "My",
        "Your",
        "Their",
        "His",
        "Her",
        "Its",
        "Our",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    }
)

_ORGANIZATION_INDICATORS = (
    "corp",
    "inc",
    "ltd",
    "company",
    "organization",
    "association",
    "university",
    "institute",
    "foundation",
    "agency",
    "department",
    "administration",
)

_LOCATION_INDICATORS = (
    "city",
    "county",
    "state",
    "country",
    "nation",
    "republic",
    "kingdom",
    "province",
    "region",
    "district",
    "avenue",
    "street",
    "boulevard",
)

_PERSON_INDICATORS = (
    "Mr.",
    "Ms.",
    "Mrs.",
    "Dr.",
    "Prof.",
    "President",
    "Senator",
    "Representative",
    "Governor",
    "Mayor",
    "CEO",
    "Director",
    "Minister",
)

_DATE_PATTERNS = (
    r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s+\w+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}?\b",
    r"\b\d{1,2}/\d{1,2}/\d{2,4}\b",
    r"\b\d{4}-\d{2}-\d{2}\b",
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}?\b",
    r"\btoday\b|\byesterday\b|\bthis morning\b|\bthis afternoon\b|\blast night\b",
)


def _has_indicator(text: str, indicators: tuple[str, ...]) -> bool:
    return any(indicator in text for indicator in indicators)


def _entity_group(entity: str, text: str) -> str | None:
    """Classify an entity into persons/organizations/locations/dates (or None)."""
    entity_lower = entity.lower()
    if _has_indicator(entity_lower, _ORGANIZATION_INDICATORS):
        return "organizations"
    if _has_indicator(entity_lower, _LOCATION_INDICATORS):
        return "locations"
    position = text.find(entity)
    if _has_indicator(text[max(0, position - 50) : position], _PERSON_INDICATORS):
        return "persons"
    if " " in entity:
        return "organizations"
    return None


def _extract_date_matches(text: str) -> list[str]:
    matches: list[str] = []
    for pattern in _DATE_PATTERNS:
        matches.extend(re.findall(pattern, text, re.IGNORECASE))
    return matches


def _dedupe_entities(entities: dict[str, list[str]]) -> dict[str, list[str]]:
    for key in entities:
        seen = set()
        unique: list[str] = []
        for item in entities[key]:
            item_lower = item.lower()
            if item_lower not in seen:
                seen.add(item_lower)
                unique.append(item)
        entities[key] = unique[:20]
    return entities


def extract_entities(text: str) -> dict[str, list[str]]:
    """Extract named entities from text using simple heuristics.

    Returns:
        Dict with keys: persons, organizations, locations, dates
    """
    entities: dict[str, list[str]] = {
        "persons": [],
        "organizations": [],
        "locations": [],
        "dates": [],
    }

    words = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b", text)
    potential_entities = [
        word for word in words if word not in _COMMON_ENTITY_WORDS and len(word) > 2
    ]

    for entity in set(potential_entities):
        group = _entity_group(entity, text)
        if group:
            entities[group].append(entity)

    entities["dates"].extend(_extract_date_matches(text))
    return _dedupe_entities(entities)


def extract_keywords(text: str, top_n: int = 20) -> list[tuple[str, int]]:
    """Extract top keywords by frequency, excluding common stop words."""
    stop_words = {
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "must",
        "shall",
        "can",
        "need",
        "this",
        "that",
        "these",
        "those",
        "i",
        "you",
        "he",
        "she",
        "it",
        "we",
        "they",
        "me",
        "him",
        "her",
        "us",
        "them",
        "my",
        "your",
        "his",
        "its",
        "our",
        "their",
        "what",
        "which",
        "who",
        "when",
        "where",
        "why",
        "how",
        "all",
        "any",
        "both",
        "each",
        "few",
        "more",
        "most",
        "other",
        "some",
        "such",
        "no",
        "nor",
        "not",
        "only",
        "own",
        "same",
        "so",
        "than",
        "too",
        "very",
        "just",
        "now",
        "then",
        "here",
        "there",
        "up",
        "down",
        "out",
        "off",
        "over",
        "under",
        "again",
        "further",
        "once",
        "said",
        "says",
        "say",
        "told",
        "tell",
        "tells",
        "according",
        "also",
        "after",
        "before",
        "during",
        "while",
        "about",
        "into",
        "through",
        "above",
        "below",
        "between",
        "among",
        "within",
        "without",
    }

    words = re.findall(r"\b[a-z]{3,}\b", text.lower())
    filtered_words = [word for word in words if word not in stop_words]
    return Counter(filtered_words).most_common(top_n)


def calculate_text_similarity(text1: str, text2: str) -> float:
    """Calculate similarity ratio between two texts."""
    if not text1 or not text2:
        return 0.0
    return rust_text_similarity(text1, text2)


def _categorize_entities(
    entities1: dict[str, list[str]],
    entities2: dict[str, list[str]],
    category: str,
) -> tuple[list[str], list[str], list[str]]:
    """Compute common/unique entity lists for one category."""
    set1 = {entity.lower() for entity in entities1.get(category, [])}
    set2 = {entity.lower() for entity in entities2.get(category, [])}

    common = set1 & set2
    unique1 = set1 - set2
    unique2 = set2 - set1

    return (
        [entity for entity in entities1.get(category, []) if entity.lower() in common],
        [entity for entity in entities1.get(category, []) if entity.lower() in unique1],
        [entity for entity in entities2.get(category, []) if entity.lower() in unique2],
    )


def find_common_and_unique(
    entities1: dict[str, list[str]],
    entities2: dict[str, list[str]],
) -> dict[str, dict[str, list[str]]]:
    """Find common and unique entities between two entity sets."""
    result: dict[str, dict[str, list[str]]] = {
        "common_entities": {},
        "unique_to_source_1": {},
        "unique_to_source_2": {},
    }

    for category in ["persons", "organizations", "locations", "dates"]:
        common_items, unique1_items, unique2_items = _categorize_entities(
            entities1, entities2, category
        )
        result["common_entities"][category] = common_items
        result["unique_to_source_1"][category] = unique1_items
        result["unique_to_source_2"][category] = unique2_items

    return result


def compare_keywords(
    keywords1: list[tuple[str, int]],
    keywords2: list[tuple[str, int]],
) -> KeywordComparisonResult:
    """Compare keyword frequency distributions between two articles."""
    dict1 = dict(keywords1)
    dict2 = dict(keywords2)

    set1 = set(dict1.keys())
    set2 = set(dict2.keys())

    common_keywords: list[CommonKeywordDiff] = []
    for keyword in set1 & set2:
        freq1 = dict1[keyword]
        freq2 = dict2[keyword]
        diff = freq1 - freq2
        common_keywords.append(
            {
                "keyword": keyword,
                "source_1_freq": freq1,
                "source_2_freq": freq2,
                "difference": diff,
                "emphasis": "source_1" if diff > 0 else "source_2" if diff < 0 else "equal",
            }
        )

    common_keywords.sort(key=lambda item: abs(item["difference"]), reverse=True)

    unique_1: list[UniqueKeywordFrequency] = [
        {"keyword": keyword, "frequency": dict1[keyword]} for keyword in (set1 - set2)
    ]
    unique_2: list[UniqueKeywordFrequency] = [
        {"keyword": keyword, "frequency": dict2[keyword]} for keyword in (set2 - set1)
    ]

    unique_1.sort(key=lambda item: item["frequency"], reverse=True)
    unique_2.sort(key=lambda item: item["frequency"], reverse=True)

    return {
        "common_keywords": common_keywords[:15],
        "unique_to_source_1": unique_1[:15],
        "unique_to_source_2": unique_2[:15],
    }


def generate_diff_highlights(
    text1: str,
    text2: str,
) -> dict[str, list[dict[str, Any]]]:
    """Generate visual diff highlights between two texts."""
    payload = rust_sentence_diff(text1, text2)
    return {
        "added": list(payload.get("added", [])),
        "removed": list(payload.get("removed", [])),
        "similar": list(payload.get("similar", [])),
    }


def compare_articles(
    content1: str, content2: str, title1: str = "", title2: str = ""
) -> dict[str, Any]:
    """Perform comprehensive comparison between two articles."""
    entities1 = extract_entities(content1)
    entities2 = extract_entities(content2)

    keywords1 = extract_keywords(content1)
    keywords2 = extract_keywords(content2)

    content_similarity = calculate_text_similarity(content1, content2)
    title_similarity = calculate_text_similarity(title1, title2) if title1 and title2 else 0.0

    entity_comparison = find_common_and_unique(entities1, entities2)
    keyword_comparison = compare_keywords(keywords1, keywords2)
    diff_highlights = generate_diff_highlights(content1, content2)

    return {
        "similarity": {
            "content_similarity": round(content_similarity, 2),
            "title_similarity": round(title_similarity, 2),
            "overall_match_percent": round(content_similarity * 100, 1),
        },
        "entities": {
            "source_1": entities1,
            "source_2": entities2,
            "comparison": entity_comparison,
        },
        "keywords": {
            "source_1_top": [{"word": word, "count": count} for word, count in keywords1[:10]],
            "source_2_top": [{"word": word, "count": count} for word, count in keywords2[:10]],
            "comparison": keyword_comparison,
        },
        "diff": diff_highlights,
        "summary": {
            "common_entities_count": sum(
                len(value) for value in entity_comparison["common_entities"].values()
            ),
            "unique_entities_source_1": sum(
                len(value) for value in entity_comparison["unique_to_source_1"].values()
            ),
            "unique_entities_source_2": sum(
                len(value) for value in entity_comparison["unique_to_source_2"].values()
            ),
            "common_keywords_count": len(keyword_comparison["common_keywords"]),
            "unique_keywords_source_1": len(keyword_comparison["unique_to_source_1"]),
            "unique_keywords_source_2": len(keyword_comparison["unique_to_source_2"]),
        },
    }
