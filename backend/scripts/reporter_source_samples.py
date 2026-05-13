from __future__ import annotations

import hashlib
from typing import Any

from app.data.rss_sources import get_rss_sources


def normalize_lookup_name(value: str) -> str:
    normalized = value.strip().lower()
    return normalized[4:] if normalized.startswith("the ") else normalized


def select_sources(source_names: list[str]) -> dict[str, dict[str, Any]]:
    all_sources = get_rss_sources()
    selected: dict[str, dict[str, Any]] = {}
    for source_name in source_names:
        config = all_sources.get(source_name)
        if config is None:
            base_matches = [
                (name, value)
                for name, value in all_sources.items()
                if normalize_lookup_name(name.split(" - ", 1)[0])
                == normalize_lookup_name(source_name)
            ]
            if base_matches:
                _, config = base_matches[0]
        if config is not None:
            selected[source_name] = config
        else:
            selected[source_name] = {"url": ""}
    return selected


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
        (
            "us",
            [
                name
                for name, cfg in all_sources.items()
                if str(cfg.get("country") or "").upper() == "US"
            ],
        ),
        (
            "non_us",
            [
                name
                for name, cfg in all_sources.items()
                if str(cfg.get("country") or "").upper()
                and str(cfg.get("country") or "").upper() != "US"
            ],
        ),
        (
            "niche",
            [
                name
                for name, cfg in all_sources.items()
                if str(cfg.get("category") or "").lower() not in {"general", "news", "world", ""}
            ],
        ),
        (
            "ownership_variety",
            [
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
            ],
        ),
    ]

    selected: list[str] = []
    seen: set[str] = set()
    while len(selected) < limit:
        progressed = False
        for _, bucket_names in buckets:
            remaining = [name for name in bucket_names if name not in seen]
            if not remaining:
                continue
            pick = sorted(
                remaining,
                key=lambda name: hashlib.sha256(name.encode("utf-8")).hexdigest(),
            )[0]
            selected.append(pick)
            seen.add(pick)
            progressed = True
            if len(selected) >= limit:
                break
        if not progressed:
            for name in sorted(all_sources):
                if name not in seen:
                    selected.append(name)
                    seen.add(name)
                    break
            else:
                break
    return selected[:limit]
