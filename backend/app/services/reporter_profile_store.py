"""Persistence helpers for reporter wiki profiles."""

from __future__ import annotations

from typing import Any, cast
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Reporter, get_utc_now

# Politcal leaning mapping helpers
_PARTY_LEFT = {"democratic", "labour", "socialist", "social democr", "green", "left", "progressive"}
_PARTY_RIGHT = {
    "republican",
    "conservative",
    "christian democr",
    "right",
    "libertarian",
    "national",
}
_IDEO_LEFT = {
    "socialism",
    "social democr",
    "communism",
    "marxism",
    "progressivism",
    "left",
    "liberalism",
}
_IDEO_RIGHT = {"conservatism", "libertarianism", "nationalism", "populism", "right", "reactionary"}


def _derive_political_leaning_from_profile(
    profile: dict[str, Any],
) -> tuple[str | None, str | None, list[str]]:
    party = profile.get("political_party") or []
    ideology = profile.get("political_ideology") or []
    sources: list[str] = []

    party_lower = {p.lower() for p in party if p}
    has_left = any(any(kw in p for kw in _PARTY_LEFT) for p in party_lower)
    has_right = any(any(kw in p for kw in _PARTY_RIGHT) for p in party_lower)
    if has_left and has_right:
        sources.append("wikidata_party")
        return "center", "medium", sources
    if has_left:
        sources.append("wikidata_party")
        return "left", "medium", sources
    if has_right:
        sources.append("wikidata_party")
        return "right", "medium", sources

    ideology_lower = {i.lower() for i in ideology if i}
    has_left = any(any(kw in i for kw in _IDEO_LEFT) for i in ideology_lower)
    has_right = any(any(kw in i for kw in _IDEO_RIGHT) for i in ideology_lower)
    if has_left and has_right:
        sources.append("wikidata_ideology")
        return "center", "low", sources
    if has_left:
        sources.append("wikidata_ideology")
        return "left", "low", sources
    if has_right:
        sources.append("wikidata_ideology")
        return "right", "low", sources

    return None, None, []


REPORTER_PROFILE_FIELDS = (
    "name",
    "normalized_name",
    "bio",
    "career_history",
    "education",
    "political_leaning",
    "leaning_confidence",
    "leaning_sources",
    "twitter_handle",
    "linkedin_url",
    "wikipedia_url",
    "wikidata_qid",
    "wikidata_url",
    "canonical_name",
    "resolver_key",
    "match_status",
    "overview",
    "dossier_sections",
    "citations",
    "search_links",
    "match_explanation",
    "research_sources",
    "research_confidence",
    "littlesis_url",
    "article_count",
    "last_article_at",
    "canonical_author_url",
    "author_page_url",
    "confidence_tier",
    "confidence_score",
    "claims_count",
)


def _unique_strings(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            unique.append(cleaned)
    return unique


def _profile_strings(profile: dict[str, Any], key: str) -> list[str]:
    raw = profile.get(key)
    if isinstance(raw, list):
        return _unique_strings(raw)
    if isinstance(raw, str):
        return _unique_strings([raw])
    return []


async def upsert_reporter_profile(
    session: AsyncSession,
    profile: dict[str, Any],
) -> Reporter:
    """Create or update a reporter from a resolved deterministic profile."""
    resolver_key = cast(str | None, profile.get("resolver_key"))
    stmt = select(Reporter)
    if resolver_key:
        stmt = stmt.where(Reporter.resolver_key == resolver_key)
    else:
        stmt = stmt.where(Reporter.normalized_name == profile.get("normalized_name"))

    reporter = (await session.execute(stmt)).scalar_one_or_none() or Reporter()

    for field in REPORTER_PROFILE_FIELDS:
        setattr(reporter, field, profile.get(field))

    topics = _unique_strings(
        [
            *_profile_strings(profile, "topics"),
            *_profile_strings(profile, "field_of_work"),
        ]
    )
    reporter.topics = topics

    existing_institutional = profile.get("institutional_affiliations")
    if (
        existing_institutional
        and isinstance(existing_institutional, list)
        and existing_institutional
    ):
        reporter.institutional_affiliations = existing_institutional
    else:
        affiliations = _profile_strings(profile, "affiliations")
        if affiliations:
            reporter.institutional_affiliations = [
                {"organization": value, "source": "wikidata"} for value in affiliations
            ]

    leaning, confidence, sources = _derive_political_leaning_from_profile(profile)
    if leaning and not reporter.political_leaning:
        reporter.political_leaning = leaning
        reporter.leaning_confidence = confidence
        if sources:
            existing_sources = reporter.leaning_sources or []
            if isinstance(existing_sources, list):
                for s in sources:
                    if s not in existing_sources:
                        existing_sources.append(s)
                reporter.leaning_sources = existing_sources

    reporter.last_researched_at = get_utc_now()
    session.add(reporter)
    await session.commit()
    return reporter
