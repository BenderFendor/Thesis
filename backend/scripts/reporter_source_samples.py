from __future__ import annotations

import hashlib
from typing import Any

from app.data.rss_sources import get_rss_sources


def normalize_lookup_name(value: str) -> str:
    normalized = value.strip().lower()
    return normalized[4:] if normalized.startswith("the ") else normalized


def _resolve_source_config(
    source_name: str,
    all_sources: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    config = all_sources.get(source_name)
    if config is not None:
        return config
    base_matches = [
        (name, value)
        for name, value in all_sources.items()
        if normalize_lookup_name(name.split(" - ", 1)[0])
        == normalize_lookup_name(source_name)
    ]
    if base_matches:
        _, config = base_matches[0]
        return config
    return None


def select_sources(source_names: list[str]) -> dict[str, dict[str, Any]]:
    all_sources = get_rss_sources()
    selected: dict[str, dict[str, Any]] = {}
    for source_name in source_names:
        config = _resolve_source_config(source_name, all_sources)
        selected[source_name] = config if config is not None else {"url": ""}
    return selected


def _bucket_us(all_sources: dict[str, dict[str, Any]]) -> list[str]:
    return [
        name
        for name, cfg in all_sources.items()
        if str(cfg.get("country") or "").upper() == "US"
    ]


def _bucket_non_us(all_sources: dict[str, dict[str, Any]]) -> list[str]:
    return [
        name
        for name, cfg in all_sources.items()
        if str(cfg.get("country") or "").upper()
        and str(cfg.get("country") or "").upper() != "US"
    ]


def _bucket_niche(all_sources: dict[str, dict[str, Any]]) -> list[str]:
    return [
        name
        for name, cfg in all_sources.items()
        if str(cfg.get("category") or "").lower() not in {"general", "news", "world", ""}
    ]


def _bucket_ownership_variety(all_sources: dict[str, dict[str, Any]]) -> list[str]:
    return [
        name
        for name, cfg in all_sources.items()
        if any(
            token in str(cfg.get("ownership_label") or "").lower()
            for token in (
                "state",
                "public",
                "nonprofit",
                "independent",
                "private",
                "trust",
            )
        )
    ]


def _bucket_pick(bucket_names: list[str], seen: set[str]) -> str | None:
    remaining = [name for name in bucket_names if name not in seen]
    if not remaining:
        return None
    return sorted(
        remaining,
        key=lambda name: hashlib.sha256(name.encode("utf-8")).hexdigest(),
    )[0]


def _pick_next_unseen(
    all_sources: dict[str, dict[str, Any]],
    seen: set[str],
) -> str | None:
    for name in sorted(all_sources):
        if name not in seen:
            return name
    return None


def broad_source_sample(limit: int) -> list[str]:
    all_sources = get_rss_sources()
    buckets: list[tuple[str, list[str]]] = [
        (
            "popular",
            [
                "BBC",
                "CNN",
                "Reuters",
                "NPR",
                "Fox News",
                "The Guardian",
                "The New York Times",
                "Al Jazeera",
            ],
        ),
        ("us", _bucket_us(all_sources)),
        ("non_us", _bucket_non_us(all_sources)),
        ("niche", _bucket_niche(all_sources)),
        ("ownership_variety", _bucket_ownership_variety(all_sources)),
    ]

    selected: list[str] = []
    seen: set[str] = set()
    while len(selected) < limit:
        progressed = False
        for _, bucket_names in buckets:
            pick = _bucket_pick(bucket_names, seen)
            if pick is None:
                continue
            selected.append(pick)
            seen.add(pick)
            progressed = True
            if len(selected) >= limit:
                break
        if not progressed:
            fallback_pick = _pick_next_unseen(all_sources, seen)
            if fallback_pick is None:
                break
            selected.append(fallback_pick)
            seen.add(fallback_pick)
    return selected[:limit]
