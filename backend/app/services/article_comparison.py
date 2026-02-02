"""Multi-source story comparison service with entity extraction and diff analysis."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List, Set, Tuple
from difflib import SequenceMatcher


def extract_entities(text: str) -> Dict[str, List[str]]:
    """Extract named entities from text using simple heuristics.

    Returns:
        Dict with keys: persons, organizations, locations, dates
    """
    # Simple pattern-based extraction
    # In production, this would use spaCy or a proper NER model

    entities = {"persons": [], "organizations": [], "locations": [], "dates": []}

    # Extract capitalized words (potential proper nouns)
    words = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b", text)

    # Filter out common words and short words
    common_words = {
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

    potential_entities = [w for w in words if w not in common_words and len(w) > 2]

    # Categorize based on context clues
    for entity in set(potential_entities):
        entity_lower = entity.lower()

        # Organization indicators
        if any(
            indicator in entity_lower
            for indicator in [
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
            ]
        ):
            entities["organizations"].append(entity)
        # Location indicators
        elif any(
            indicator in entity_lower
            for indicator in [
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
            ]
        ):
            entities["locations"].append(entity)
        # Person indicators (common titles)
        elif any(
            indicator in text[max(0, text.find(entity) - 50) : text.find(entity)]
            for indicator in [
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
            ]
        ):
            entities["persons"].append(entity)
        else:
            # Default to organizations for multi-word capitalized phrases
            if " " in entity:
                entities["organizations"].append(entity)

    # Extract dates
    date_patterns = [
        r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s+\w+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}?\b",
        r"\b\d{1,2}/\d{1,2}/\d{2,4}\b",
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}?\b",
        r"\btoday\b|\byesterday\b|\bthis morning\b|\bthis afternoon\b|\blast night\b",
    ]

    for pattern in date_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        entities["dates"].extend(matches)

    # Remove duplicates while preserving order
    for key in entities:
        seen = set()
        unique = []
        for item in entities[key]:
            item_lower = item.lower()
            if item_lower not in seen:
                seen.add(item_lower)
                unique.append(item)
        entities[key] = unique[:20]  # Limit to top 20

    return entities


def extract_keywords(text: str, top_n: int = 20) -> List[Tuple[str, int]]:
    """Extract top keywords by frequency, excluding common stop words.

    Args:
        text: Input text
        top_n: Number of top keywords to return

    Returns:
        List of (keyword, frequency) tuples
    """
    # Common stop words
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
        "her",
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

    # Normalize text
    text_lower = text.lower()

    # Extract words (alphanumeric, at least 3 chars)
    words = re.findall(r"\b[a-z]{3,}\b", text_lower)

    # Filter stop words and count
    filtered_words = [w for w in words if w not in stop_words]
    word_counts = Counter(filtered_words)

    # Get top N
    return word_counts.most_common(top_n)


def calculate_text_similarity(text1: str, text2: str) -> float:
    """Calculate similarity ratio between two texts using SequenceMatcher.

    Returns:
        Float between 0.0 and 1.0
    """
    if not text1 or not text2:
        return 0.0

    # Normalize texts
    t1 = " ".join(text1.lower().split())
    t2 = " ".join(text2.lower().split())

    return SequenceMatcher(None, t1, t2).ratio()


def find_common_and_unique(
    entities1: Dict[str, List[str]], entities2: Dict[str, List[str]]
) -> Dict[str, Any]:
    """Find common and unique entities between two entity sets.

    Returns:
        Dict with common_entities, unique_to_1, unique_to_2
    """
    result = {"common_entities": {}, "unique_to_source_1": {}, "unique_to_source_2": {}}

    for category in ["persons", "organizations", "locations", "dates"]:
        set1 = {e.lower() for e in entities1.get(category, [])}
        set2 = {e.lower() for e in entities2.get(category, [])}

        common = set1 & set2
        unique1 = set1 - set2
        unique2 = set2 - set1

        # Map back to original case
        common_original = [
            e for e in entities1.get(category, []) if e.lower() in common
        ]
        unique1_original = [
            e for e in entities1.get(category, []) if e.lower() in unique1
        ]
        unique2_original = [
            e for e in entities2.get(category, []) if e.lower() in unique2
        ]

        result["common_entities"][category] = common_original
        result["unique_to_source_1"][category] = unique1_original
        result["unique_to_source_2"][category] = unique2_original

    return result


def compare_keywords(
    keywords1: List[Tuple[str, int]], keywords2: List[Tuple[str, int]]
) -> Dict[str, Any]:
    """Compare keyword frequency distributions between two articles.

    Returns:
        Dict with common_keywords, unique_keywords_1, unique_keywords_2, emphasis_diff
    """
    dict1 = dict(keywords1)
    dict2 = dict(keywords2)

    set1 = set(dict1.keys())
    set2 = set(dict2.keys())

    # Common keywords with frequency comparison
    common = set1 & set2
    common_keywords = []
    for kw in common:
        freq1 = dict1[kw]
        freq2 = dict2[kw]
        diff = freq1 - freq2
        common_keywords.append(
            {
                "keyword": kw,
                "source_1_freq": freq1,
                "source_2_freq": freq2,
                "difference": diff,
                "emphasis": "source_1"
                if diff > 0
                else "source_2"
                if diff < 0
                else "equal",
            }
        )

    # Sort by absolute difference
    common_keywords.sort(key=lambda x: abs(x["difference"]), reverse=True)

    # Unique keywords
    unique_1 = [{"keyword": kw, "frequency": dict1[kw]} for kw in (set1 - set2)]
    unique_2 = [{"keyword": kw, "frequency": dict2[kw]} for kw in (set2 - set1)]

    unique_1.sort(key=lambda x: x["frequency"], reverse=True)
    unique_2.sort(key=lambda x: x["frequency"], reverse=True)

    return {
        "common_keywords": common_keywords[:15],
        "unique_to_source_1": unique_1[:15],
        "unique_to_source_2": unique_2[:15],
    }


def generate_diff_highlights(text1: str, text2: str) -> Dict[str, List[Dict[str, Any]]]:
    """Generate visual diff highlights between two texts.

    Returns:
        Dict with added, removed, and unchanged sections
    """
    # Split into sentences for comparison
    sentences1 = re.split(r"(?<=[.!?])\s+", text1)
    sentences2 = re.split(r"(?<=[.!?])\s+", text2)

    added = []
    removed = []
    similar = []

    # Find similar sentences
    for i, s1 in enumerate(sentences1):
        best_match = None
        best_ratio = 0.0

        for j, s2 in enumerate(sentences2):
            ratio = SequenceMatcher(None, s1.lower(), s2.lower()).ratio()
            if ratio > best_ratio and ratio > 0.6:  # Threshold for similarity
                best_ratio = ratio
                best_match = (j, s2)

        if best_match:
            similar.append(
                {
                    "source_1_index": i,
                    "source_2_index": best_match[0],
                    "source_1_text": s1,
                    "source_2_text": best_match[1],
                    "similarity": round(best_ratio, 2),
                }
            )
        else:
            removed.append({"index": i, "text": s1, "type": "unique_to_source_1"})

    # Find sentences in source 2 not in source 1
    matched_indices = {s["source_2_index"] for s in similar}
    for j, s2 in enumerate(sentences2):
        if j not in matched_indices:
            added.append({"index": j, "text": s2, "type": "unique_to_source_2"})

    return {
        "added": added,
        "removed": removed,
        "similar": sorted(similar, key=lambda x: x["similarity"], reverse=True)[:10],
    }


def compare_articles(
    content1: str, content2: str, title1: str = "", title2: str = ""
) -> Dict[str, Any]:
    """Perform comprehensive comparison between two articles.

    Returns:
        Complete comparison analysis with entities, keywords, and diff
    """
    # Extract entities
    entities1 = extract_entities(content1)
    entities2 = extract_entities(content2)

    # Extract keywords
    keywords1 = extract_keywords(content1)
    keywords2 = extract_keywords(content2)

    # Calculate similarities
    content_similarity = calculate_text_similarity(content1, content2)
    title_similarity = (
        calculate_text_similarity(title1, title2) if title1 and title2 else 0.0
    )

    # Compare entities
    entity_comparison = find_common_and_unique(entities1, entities2)

    # Compare keywords
    keyword_comparison = compare_keywords(keywords1, keywords2)

    # Generate diff
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
            "source_1_top": [{"word": w, "count": c} for w, c in keywords1[:10]],
            "source_2_top": [{"word": w, "count": c} for w, c in keywords2[:10]],
            "comparison": keyword_comparison,
        },
        "diff": diff_highlights,
        "summary": {
            "common_entities_count": sum(
                len(v) for v in entity_comparison["common_entities"].values()
            ),
            "unique_entities_source_1": sum(
                len(v) for v in entity_comparison["unique_to_source_1"].values()
            ),
            "unique_entities_source_2": sum(
                len(v) for v in entity_comparison["unique_to_source_2"].values()
            ),
            "common_keywords_count": len(keyword_comparison["common_keywords"]),
            "unique_keywords_source_1": len(keyword_comparison["unique_to_source_1"]),
            "unique_keywords_source_2": len(keyword_comparison["unique_to_source_2"]),
        },
    }
