"""
Reporter Profiler Agent for Phase 5B.

This agent researches journalists/reporters to build profiles with:
- Basic identity (name, bio, career history)
- Areas of expertise/topics
- Political leanings and bias indicators
- Social media and external links

Uses a layered source strategy:
1. Wikipedia (most authoritative)
2. Media Bias/Fact Check (MBFC)
3. LittleSis (power relationships)
4. OpenSecrets (political donations)
5. SEC filings (for business journalists)
"""

from typing import Any, Dict, List, Optional

from app.core.logging import get_logger

logger = get_logger("reporter_profiler")


def build_deep_dossier_schema() -> Dict[str, Any]:
    """Return the deep dossier schema structure for a new, empty dossier.

    Dossier sections:
    - source_patterns: empirical sourcing breakdown from article corpus
    - topics_avoided: topics the reporter systematically skips (from corpus analysis)
    - advertiser_alignment: overlap between reporter beat and owner/advertiser interests
    - revolving_door: employment transitions between media, government, corporate
      (sourced from LittleSis and Wikidata employer history)
    - controversies: documented ethical or journalistic controversies
    - institutional_affiliations: think tanks, boards, fellowships
      (sourced from LittleSis relationships)
    - coverage_comparison: how coverage differs across past employers
      (sourced from local corpus analysis across time segments)
    - alignment: political party, ideology, member-of data
    """
    return {
        "source_patterns": {
            "official": 0,
            "grassroots": 0,
            "unknown": 0,
            "analysis": None,
        },
        "topics_avoided": {
            "topics": [],
            "analysis": None,
            "confidence": "low",
        },
        "advertiser_alignment": {
            "alignment_score": "low",
            "analysis": None,
            "examples": [],
            "confidence": "low",
        },
        "revolving_door": {
            "history": [],
            "analysis": None,
            "confidence": "low",
        },
        "controversies": [],
        "institutional_affiliations": [],
        "coverage_comparison": {
            "analysis": None,
            "outlets_compared": [],
            "notable_shifts": [],
            "confidence": "low",
        },
        "alignment": {
            "political_party": [],
            "political_ideology": [],
            "member_of": [],
        },
        "article_count": 0,
        "last_article_at": None,
    }


def build_deep_dossier(
    name: str,
    articles: Optional[List[Dict[str, Any]]] = None,
    wikidata_employers: Optional[List[str]] = None,
    littlesis_affiliations: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build a deep dossier using deterministic sources only (no LLM).

    Sources:
    - Local article corpus analysis for source_patterns, topics_avoided, coverage_comparison
    - LittleSis for revolving_door and institutional_affiliations
    - Wikidata employer history for revolving_door supplemental data

    Args:
        name: Reporter name
        articles: List of article dicts from our DB for this reporter
        wikidata_employers: List of employer names from Wikidata
        littlesis_affiliations: List of affiliation dicts from LittleSis

    Returns:
        Dict with deep dossier fields to merge into the reporter record.
    """
    logger.info("Building deterministic deep dossier for: %s", name)
    articles = articles or []

    schema = build_deep_dossier_schema()
    corpus = _analyze_article_corpus(name, articles)
    schema["source_patterns"] = (
        corpus.get("source_patterns") or schema["source_patterns"]
    )
    schema["last_article_at"] = corpus.get("last_article_at")
    schema["article_count"] = len(articles)

    if wikidata_employers:
        schema["revolving_door"]["history"].extend(
            {
                "role": "employer",
                "organization": employer,
                "org_type": "media",
                "period": None,
                "verified": True,
                "source": "wikidata",
            }
            for employer in wikidata_employers
            if employer
        )
        if wikidata_employers:
            schema["revolving_door"]["confidence"] = "medium"

    if littlesis_affiliations:
        affiliations: List[Dict[str, Any]] = [
            {
                "organization": aff.get("organization", ""),
                "role": aff.get("category", "affiliation"),
                "period": (
                    f"{aff.get('start_date', '')} - {aff.get('end_date', '')}"
                    if aff.get("start_date") or aff.get("end_date")
                    else None
                ),
                "org_type": aff.get("org_type", ""),
                "source": "littlesis",
                "littlesis_url": aff.get("littlesis_url"),
            }
            for aff in littlesis_affiliations
        ]
        schema["institutional_affiliations"] = affiliations
        schema["revolving_door"]["confidence"] = "high"

    return schema


def _analyze_article_corpus(
    name: str, articles: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Analyze the reporter's articles in our DB for empirical patterns."""
    if not articles:
        return {
            "source_patterns": {
                "official": 0,
                "grassroots": 0,
                "unknown": 0,
                "analysis": "No articles in database to analyze.",
            },
            "last_article_at": None,
            "topic_distribution": {},
            "category_counts": {},
        }

    from collections import Counter

    categories: Counter[str] = Counter()
    sources_used: Counter[str] = Counter()
    last_published = None

    for article in articles:
        cat = article.get("category", "general")
        categories[cat] += 1

        source = article.get("source", "")
        if source:
            sources_used[source] += 1

        pub = article.get("published_at") or article.get("published")
        if pub and (last_published is None or pub > last_published):
            last_published = pub

    return {
        "source_patterns": {
            "official": 0,
            "grassroots": 0,
            "unknown": len(articles),
            "analysis": (
                f"Sourcing analysis based on {len(articles)} articles. "
                "Detailed source classification requires content analysis."
            ),
        },
        "last_article_at": last_published,
        "topic_distribution": dict(categories.most_common(10)),
        "category_counts": dict(categories),
        "outlets_published_in": dict(sources_used.most_common(10)),
        "total_articles": len(articles),
    }
