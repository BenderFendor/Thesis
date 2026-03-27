"""Shared GDELT aggregation helpers for UI payloads and snapshot metadata."""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable, Mapping, Sequence

from app.services.gdelt_taxonomy import dominant_cameo_roots, goldstein_bucket


def average(values: Iterable[float | None]) -> float | None:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return None
    return round(sum(filtered) / len(filtered), 3)


def bounds(values: Iterable[float | None]) -> tuple[float | None, float | None]:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return (None, None)
    return (min(filtered), max(filtered))


def build_article_gdelt_context(
    events: Sequence[Mapping[str, Any]],
    *,
    tone_baseline_avg: float | None = None,
) -> dict[str, Any] | None:
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
    counts: Counter[str] = Counter()
    for event in events:
        for key in ("actor1_country", "actor2_country"):
            value = str(event.get(key) or "").strip().upper()
            if value:
                counts[value] += 1
    return dict(counts)


def merge_count_maps(*count_maps: Mapping[str, int]) -> dict[str, int]:
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
