#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))


def _load_dependencies() -> tuple[Any, Any]:
    from app.data.rss_sources import get_rss_sources
    from app.services.source_research import get_source_profile
    from app.services.source_url_guard import build_source_url_guard

    return get_rss_sources, get_source_profile, build_source_url_guard


FIELD_KEYS = [
    "overview",
    "about",
    "funding",
    "ownership",
    "affiliations",
    "founded",
    "headquarters",
    "official_website",
    "nonprofit_filings",
    "public_records",
]

PRIORITY_SOURCES = [
    "Fox News",
    "BBC",
    "Reuters",
    "NPR",
    "Al Jazeera",
    "CNN",
    "The Guardian",
    "The New York Times",
]


def _normalize_source_key(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _base_sources() -> Dict[str, Dict[str, Any]]:
    get_rss_sources, _, _ = _load_dependencies()
    deduped: Dict[str, Dict[str, Any]] = {}
    for name, cfg in get_rss_sources().items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in deduped:
            deduped[base_name] = cfg
    return deduped


def _select_sources(limit: int) -> List[str]:
    all_sources = _base_sources()
    by_key = {_normalize_source_key(name): name for name in all_sources.keys()}
    selected: List[str] = []
    for source_name in PRIORITY_SOURCES:
        exact = all_sources.get(source_name)
        if exact is not None and source_name not in selected:
            selected.append(source_name)
            continue

        normalized_target = _normalize_source_key(source_name)
        if normalized_target.startswith("the"):
            normalized_target = normalized_target[3:]

        match_name = by_key.get(normalized_target)
        if not match_name:
            for candidate_name in all_sources.keys():
                normalized_candidate = _normalize_source_key(candidate_name)
                normalized_candidate_no_the = (
                    normalized_candidate[3:]
                    if normalized_candidate.startswith("the")
                    else normalized_candidate
                )
                if normalized_target in {
                    normalized_candidate,
                    normalized_candidate_no_the,
                }:
                    match_name = candidate_name
                    break

        if match_name and match_name not in selected:
            selected.append(match_name)

    if len(selected) < limit:
        for source_name in sorted(all_sources.keys()):
            if source_name in selected:
                continue
            selected.append(source_name)
            if len(selected) >= limit:
                break
    return selected[:limit]


def _coverage(profile: Dict[str, Any]) -> float:
    fields = profile.get("fields") or {}

    points = 0.0
    possible = 0.0

    for key in FIELD_KEYS:
        possible += 1.0
        if isinstance(fields.get(key), list) and fields.get(key):
            points += 1.0

    possible += 1.0
    if isinstance(profile.get("overview"), str) and profile.get("overview", "").strip():
        points += 1.0

    possible += 1.0
    official_pages = profile.get("official_pages") or []
    if isinstance(official_pages, list) and official_pages:
        points += min(len(official_pages), 4) / 4.0

    possible += 1.0
    citations = profile.get("citations") or []
    if isinstance(citations, list) and citations:
        points += min(len(citations), 5) / 5.0

    possible += 1.0
    match_status = str(profile.get("match_status") or "none").lower()
    if match_status == "matched":
        points += 1.0
    elif match_status == "ambiguous":
        points += 0.5

    if possible == 0:
        return 0.0
    return (points / possible) * 100.0


async def _measure_source(source_name: str, force_refresh: bool) -> Dict[str, Any]:
    _, get_source_profile, build_source_url_guard = _load_dependencies()
    profile = await get_source_profile(
        source_name=source_name,
        website=None,
        force_refresh=force_refresh,
        cache_only=False,
    )
    if not profile:
        return {
            "source": source_name,
            "coverage_percent": 0.0,
            "official_pages": 0,
            "citations": 0,
            "field_hits": 0,
            "match_status": "none",
        }

    fields = profile.get("fields") or {}
    field_hits = sum(
        1
        for key in FIELD_KEYS
        if isinstance(fields.get(key), list) and len(fields.get(key) or []) > 0
    )
    url_guard_status = "unknown"
    for section in profile.get("dossier_sections") or []:
        if not isinstance(section, dict):
            continue
        items = section.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("label") or "") != "Source URL quality":
                continue
            value = str(item.get("value") or "")
            if "status=ok" in value:
                url_guard_status = "ok"
            elif "status=mismatch" in value:
                url_guard_status = "mismatch"
            break

    if url_guard_status == "unknown":
        catalog_sources = _base_sources()
        source_config = catalog_sources.get(source_name)
        guard_value = build_source_url_guard(
            (source_config or {}).get("url"),
            str(profile.get("website") or "") or None,
        )
        status_value = str(guard_value.get("status") or "unknown").lower()
        if status_value in {"ok", "mismatch"}:
            url_guard_status = status_value

    official_pages = profile.get("official_pages") or []
    citations = profile.get("citations") or []
    return {
        "source": source_name,
        "coverage_percent": round(_coverage(profile), 2),
        "official_pages": len(official_pages)
        if isinstance(official_pages, list)
        else 0,
        "citations": len(citations) if isinstance(citations, list) else 0,
        "field_hits": field_hits,
        "match_status": str(profile.get("match_status") or "none"),
        "url_guard": url_guard_status,
    }


async def main_async(limit: int, force_refresh: bool) -> int:
    sources = _select_sources(limit)
    if not sources:
        print("avg_coverage_percent=0.00")
        print("sources_measured=0")
        return 0

    results: List[Dict[str, Any]] = []
    for source_name in sources:
        try:
            result = await _measure_source(source_name, force_refresh)
        except Exception as exc:
            result = {
                "source": source_name,
                "coverage_percent": 0.0,
                "official_pages": 0,
                "citations": 0,
                "field_hits": 0,
                "match_status": "error",
                "error": str(exc),
            }
        results.append(result)

    average = statistics.mean(item["coverage_percent"] for item in results)
    median = statistics.median(item["coverage_percent"] for item in results)

    print(
        "source\tcoverage_percent\tfield_hits\tofficial_pages\tcitations\tmatch_status\turl_guard"
    )
    for row in results:
        print(
            f"{row['source']}\t{row['coverage_percent']:.2f}\t{row['field_hits']}\t{row['official_pages']}\t{row['citations']}\t{row['match_status']}\t{row['url_guard']}"
        )
    url_guard_ok = sum(1 for row in results if row.get("url_guard") == "ok")
    url_guard_mismatch = sum(1 for row in results if row.get("url_guard") == "mismatch")
    print(f"avg_coverage_percent={average:.2f}")
    print(f"median_coverage_percent={median:.2f}")
    print(f"sources_measured={len(results)}")
    print(f"url_guard_ok_count={url_guard_ok}")
    print(f"url_guard_mismatch_count={url_guard_mismatch}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure Source Wiki dossier coverage across multiple outlets."
    )
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Bypass local source profile cache and re-fetch public records.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return asyncio.run(main_async(limit=args.limit, force_refresh=args.force_refresh))


if __name__ == "__main__":
    raise SystemExit(main())
