"""Shared GDELT aggregation helpers for UI payloads and snapshot metadata."""

from __future__ import annotations

from collections import Counter
from typing import Any
from collections.abc import Iterable, Mapping, Sequence

from app.services.gdelt_taxonomy import dominant_cameo_roots, goldstein_bucket
from datetime import UTC


def average(values: Iterable[float | None]) -> float | None:
    """Average."""
    filtered = [value for value in values if value is not None]
    if not filtered:
        return None
    return round(sum(filtered) / len(filtered), 3)


def bounds(values: Iterable[float | None]) -> tuple[float | None, float | None]:
    """Bounds."""
    filtered = [value for value in values if value is not None]
    if not filtered:
        return (None, None)
    return (min(filtered), max(filtered))


def build_article_gdelt_context(
    events: Sequence[Mapping[str, Any]],
    *,
    tone_baseline_avg: float | None = None,
) -> dict[str, Any] | None:
    """Build Article Gdelt Context."""
    if not events:
        return None

    tone_avg = average(_as_float(event.get("tone")) for event in events)
    goldstein_avg = average(_as_float(event.get("goldstein_scale")) for event in events)
    goldstein_min, goldstein_max = bounds(
        _as_float(event.get("goldstein_scale")) for event in events
    )

    payload: dict[str, Any] = {
        "total_events": len(events),
        "top_cameo": dominant_cameo_roots(
            str(event.get("event_root_code") or "") for event in events
        ),
        "goldstein_avg": goldstein_avg,
        "goldstein_min": goldstein_min,
        "goldstein_max": goldstein_max,
        "goldstein_bucket": goldstein_bucket(goldstein_avg),
        "tone_avg": tone_avg,
        "tone_baseline_avg": tone_baseline_avg,
    }
    if tone_avg is not None and tone_baseline_avg is not None:
        payload["tone_delta_vs_cluster"] = round(tone_avg - tone_baseline_avg, 3)
    return payload


def actor_country_counts(events: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """Actor Country Counts."""
    counts: Counter[str] = Counter()
    for event in events:
        for key in ("actor1_country", "actor2_country"):
            value = str(event.get(key) or "").strip().upper()
            if value:
                counts[value] += 1
    return dict(counts)


def merge_count_maps(*count_maps: Mapping[str, int]) -> dict[str, int]:
    """Merge Count Maps."""
    merged: Counter[str] = Counter()
    for count_map in count_maps:
        for key, value in count_map.items():
            if key and value > 0:
                merged[key] += value
    return dict(merged)


def compute_cross_border_score(
    source_country_counts: Mapping[str, int],
    actor_country_counts_map: Mapping[str, int],
) -> float:
    """Compute Cross Border Score."""
    if not actor_country_counts_map:
        return 0.0
    actor_total = sum(actor_country_counts_map.values())
    if actor_total <= 0:
        return 0.0
    dominant_source_country = None
    if source_country_counts:
        dominant_source_country = max(
            source_country_counts.items(),
            key=lambda item: item[1],
        )[0]
    off_source_total = 0
    for country, count in actor_country_counts_map.items():
        if dominant_source_country is None or country != dominant_source_country:
            off_source_total += count
    return round(off_source_total / actor_total, 3)


def compute_global_spread_score(country_counts: Mapping[str, int]) -> float:
    """Compute Global Spread Score."""
    if not country_counts:
        return 0.0
    total = sum(country_counts.values())
    if total <= 0:
        return 0.0
    distinct = len(country_counts)
    return round(min(distinct / 10.0, 1.0), 3)


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def compute_source_tone_deviation(
    source_domain: str,
    db_session: Any,
    days: int = 90,
) -> dict[str, Any]:
    """Compute per-source tone deviation vs global and language-matched peers.

    For each GDELT event from source_domain within the last `days`:
      - Compute mean tone per event cluster (articles about same event)
      - Compute global mean tone per cluster
      - Derive per-source deviation: (source_tone - global_tone) / global_stddev
      - Also compute language-matched deviation vs only sources in same language

    Returns dict with global_sigma and language_sigma keys.
    """
    from datetime import datetime, timedelta

    from sqlalchemy import select, func
    from app.database import GDELTEvent, SourceMetadata

    cutoff = datetime.now(UTC) - timedelta(days=days)
    cutoff_naive = cutoff.replace(tzinfo=None)

    language = "en"

    lang_result = await db_session.execute(
        select(SourceMetadata.language).where(SourceMetadata.domain == source_domain)
    )
    lang_row = lang_result.scalars().first()
    lang_row_val = lang_row
    if lang_row_val is not None:
        language = lang_row_val

    tone_result = await db_session.execute(
        select(func.avg(GDELTEvent.tone)).where(
            GDELTEvent.source == source_domain,
            GDELTEvent.published_at >= cutoff_naive,
        )
    )
    source_mean_tone = tone_result.scalar()

    global_tone_result = await db_session.execute(
        select(func.avg(GDELTEvent.tone)).where(
            GDELTEvent.published_at >= cutoff_naive,
        )
    )
    global_mean_tone = global_tone_result.scalar()

    global_stddev_result = await db_session.execute(
        select(func.stddev_pop(GDELTEvent.tone)).where(
            GDELTEvent.published_at >= cutoff_naive,
        )
    )
    global_stddev = global_stddev_result.scalar() or 1.0

    global_sigma = 0.0
    if source_mean_tone is not None and global_mean_tone is not None and global_stddev > 0:
        global_sigma = round((source_mean_tone - global_mean_tone) / global_stddev, 3)

    language_sigma = global_sigma

    lang_domains_result = await db_session.execute(
        select(SourceMetadata.domain).where(SourceMetadata.language == language)
    )
    lang_domains = [row[0] for row in lang_domains_result.all() if row[0]]

    if lang_domains and source_mean_tone is not None:
        lang_tone_result = await db_session.execute(
            select(func.avg(GDELTEvent.tone)).where(
                GDELTEvent.source.in_(lang_domains),
                GDELTEvent.published_at >= cutoff_naive,
            )
        )
        lang_mean_tone = lang_tone_result.scalar()

        lang_stddev_result = await db_session.execute(
            select(func.stddev_pop(GDELTEvent.tone)).where(
                GDELTEvent.source.in_(lang_domains),
                GDELTEvent.published_at >= cutoff_naive,
            )
        )
        lang_stddev = lang_stddev_result.scalar() or 1.0

        if lang_mean_tone is not None and lang_stddev > 0:
            language_sigma = round((source_mean_tone - lang_mean_tone) / lang_stddev, 3)

    return {
        "source_domain": source_domain,
        "days": days,
        "source_mean_tone": round(source_mean_tone, 3) if source_mean_tone else None,
        "global_mean_tone": round(global_mean_tone, 3) if global_mean_tone else None,
        "global_stddev": round(global_stddev, 3),
        "global_sigma": global_sigma,
        "language_sigma": language_sigma,
        "language": language,
    }


async def get_economic_events_between(
    country1: str,
    country2: str,
    days: int = 30,
) -> dict[str, Any]:
    """Get Economic Events Between."""
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from typing import cast

    if AsyncSessionLocal is None:
        return {"total_events": 0, "error": "database disabled"}

    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    cutoff = datetime.now(UTC) - timedelta(days=days)

    async with factory() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    COUNT(*) AS total_events,
                    AVG(tone) AS avg_tone,
                    AVG(goldstein_scale) AS avg_goldstein
                FROM gdelt_events
                WHERE published_at >= :cutoff
                  AND (
                      (actor1_country = :c1 AND actor2_country = :c2)
                      OR (actor1_country = :c2 AND actor2_country = :c1)
                  )
            """
            ),
            {"cutoff": cutoff, "c1": country1.upper(), "c2": country2.upper()},
        )
        row = result.one()
        return {
            "total_events": int(row.total_events or 0),
            "avg_tone": round(row.avg_tone, 3) if row.avg_tone is not None else None,
            "avg_goldstein": round(row.avg_goldstein, 3) if row.avg_goldstein is not None else None,
        }


async def get_country_resource_events(
    country_code: str,
    days: int = 30,
) -> dict[str, Any]:
    """Get Country Resource Events."""
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from typing import cast

    if AsyncSessionLocal is None:
        return {"total_events": 0, "error": "database disabled"}

    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    cutoff = datetime.now(UTC) - timedelta(days=days)

    async with factory() as session:
        result = await session.execute(
            text(
                """
                SELECT COUNT(*) AS total_events
                FROM gdelt_events
                WHERE published_at >= :cutoff
                  AND (
                      actor1_country = :code
                      OR actor2_country = :code
                  )
                  AND CAST(event_root_code AS FLOAT) BETWEEN 14 AND 20
            """
            ),
            {"cutoff": cutoff, "code": country_code.upper()},
        )
        row = result.one()
        return {"total_events": int(row.total_events or 0)}
