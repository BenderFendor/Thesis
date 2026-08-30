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


def _keyword_hits(records: set[str], keywords: set[str]) -> tuple[bool, bool]:
    """Return (has_left, has_right) keyword hits across one record set."""
    has_left = any(any(kw in record for kw in keywords) for record in records)
    return has_left, False


def _derive_political_leaning_from_profile(
    profile: dict[str, Any],
) -> tuple[str | None, str | None, list[str]]:
    party = profile.get("political_party") or []
    ideology = profile.get("political_ideology") or []
    sources: list[str] = []

    party_lower = {p.lower() for p in party if p}
    party_leaning = _leaning_from_keywords(party_lower, _PARTY_LEFT, _PARTY_RIGHT)
    if party_leaning is not None:
        sources.append("wikidata_party")
        leaning, confidence = party_leaning
        return leaning, confidence, sources

    ideology_lower = {i.lower() for i in ideology if i}
    ideology_leaning = _leaning_from_keywords(ideology_lower, _IDEO_LEFT, _IDEO_RIGHT)
    if ideology_leaning is not None:
        sources.append("wikidata_ideology")
        leaning, confidence = ideology_leaning
        return leaning, confidence, sources

    return None, None, []


def _leaning_from_keywords(
    records: set[str],
    left_keywords: set[str],
    right_keywords: set[str],
) -> tuple[str, str] | None:
    """Resolve a leaning/confidence pair from keyword hits on one record set."""
    has_left = any(any(kw in record for kw in left_keywords) for record in records)
    has_right = any(any(kw in record for kw in right_keywords) for record in records)
    if has_left and has_right:
        return "center", "medium"
    if has_left:
        return "left", "medium"
    if has_right:
        return "right", "medium"
    return None


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



def _apply_institutional_affiliations(reporter: Reporter, profile: dict[str, Any]) -> None:
    """Set institutional affiliations from explicit or wikidata-derived values."""
    existing_institutional = profile.get("institutional_affiliations")
    if (
        existing_institutional
        and isinstance(existing_institutional, list)
        and existing_institutional
    ):
        reporter.institutional_affiliations = existing_institutional
        return
    affiliations = _profile_strings(profile, "affiliations")
    if affiliations:
        reporter.institutional_affiliations = [
            {"organization": value, "source": "wikidata"} for value in affiliations
        ]


def _apply_political_leaning(
    reporter: Reporter,
    leaning: str | None,
    confidence: str | None,
    sources: list[str],
) -> None:
    """Fill in a derived political leaning when the reporter has none yet."""
    if not leaning:
        return
    if reporter.political_leaning:
        return
    reporter.political_leaning = leaning
    reporter.leaning_confidence = confidence
    if sources:
        existing_sources = reporter.leaning_sources or []
        if isinstance(existing_sources, list):
            for source in sources:
                if source not in existing_sources:
                    existing_sources.append(source)
            reporter.leaning_sources = existing_sources

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

    _apply_institutional_affiliations(reporter, profile)

    leaning, confidence, sources = _derive_political_leaning_from_profile(profile)
    _apply_political_leaning(reporter, leaning, confidence, sources)

    reporter.last_researched_at = get_utc_now()
    session.add(reporter)
    await session.commit()
    return reporter
