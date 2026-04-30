"""Persistence helpers for reporter wiki profiles."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Reporter, get_utc_now

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
)


def _unique_strings(values: Iterable[Any]) -> List[str]:
    seen: set[str] = set()
    unique: List[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            unique.append(cleaned)
    return unique


def _profile_strings(profile: Dict[str, Any], key: str) -> List[str]:
    raw = profile.get(key)
    if isinstance(raw, list):
        return _unique_strings(raw)
    if isinstance(raw, str):
        return _unique_strings([raw])
    return []


async def upsert_reporter_profile(
    session: AsyncSession,
    profile: Dict[str, Any],
) -> Reporter:
    """Create or update a reporter from a resolved deterministic profile."""
    resolver_key = cast(Optional[str], profile.get("resolver_key"))
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

    affiliations = _profile_strings(profile, "affiliations")
    if affiliations:
        reporter.institutional_affiliations = [
            {"organization": value, "source": "wikidata"} for value in affiliations
        ]

    reporter.last_researched_at = get_utc_now()
    session.add(reporter)
    await session.commit()
    return reporter
