#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

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
TRANSPARENCY_SIGNAL_TARGET = 4
TRANSPARENCY_ITEM_TARGET = 6

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


def _base_sources() -> dict[str, dict[str, Any]]:
    get_rss_sources, _, _ = _load_dependencies()
    deduped: dict[str, dict[str, Any]] = {}
    for name, cfg in get_rss_sources().items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in deduped:
            deduped[base_name] = cfg
    return deduped


def _strip_leading_the(normalized: str) -> str:
    return normalized.removeprefix("the")


def _match_priority_source(
    source_name: str,
    all_sources: dict[str, dict[str, Any]],
    by_key: dict[str, str],
) -> str | None:
    if all_sources.get(source_name) is not None:
        return source_name

    normalized_target = _strip_leading_the(_normalize_source_key(source_name))
    match_name = by_key.get(normalized_target)
    if match_name:
        return match_name

    for candidate_name in all_sources.keys():
        normalized_candidate = _normalize_source_key(candidate_name)
        if normalized_target in {
            normalized_candidate,
            _strip_leading_the(normalized_candidate),
        }:
            return candidate_name
    return None


def _fill_remaining_sources(
    selected: list[str],
    all_sources: dict[str, dict[str, Any]],
    limit: int,
) -> list[str]:
    for source_name in sorted(all_sources.keys()):
        if source_name in selected:
            continue
        selected.append(source_name)
        if len(selected) >= limit:
            break
    return selected[:limit]


def _select_sources(limit: int) -> list[str]:
    all_sources = _base_sources()
    by_key = {_normalize_source_key(name): name for name in all_sources.keys()}
    selected: list[str] = []
    for source_name in PRIORITY_SOURCES:
        match_name = _match_priority_source(source_name, all_sources, by_key)
        if match_name and match_name not in selected:
            selected.append(match_name)

    if len(selected) < limit:
        selected = _fill_remaining_sources(selected, all_sources, limit)
    return selected[:limit]


def _field_key_score(fields: dict[str, Any]) -> float:
    return float(
        sum(1 for key in FIELD_KEYS if isinstance(fields.get(key), list) and fields.get(key))
    )


def _overview_score(profile: dict[str, Any]) -> float:
    overview = profile.get("overview")
    if isinstance(overview, str) and overview.strip():
        return 1.0
    return 0.0


def _official_pages_score(profile: dict[str, Any]) -> float:
    official_pages = profile.get("official_pages") or []
    if isinstance(official_pages, list) and official_pages:
        return min(len(official_pages), 4) / 4.0
    return 0.0


def _citations_score(profile: dict[str, Any]) -> float:
    citations = profile.get("citations") or []
    if isinstance(citations, list) and citations:
        return min(len(citations), 5) / 5.0
    return 0.0


def _match_status_score(profile: dict[str, Any]) -> float:
    match_status = str(profile.get("match_status") or "none").lower()
    if match_status == "matched":
        return 1.0
    if match_status == "ambiguous":
        return 0.5
    return 0.0


def _transparency_score(profile: dict[str, Any]) -> float:
    transparency_items = _transparency_item_count(profile)
    if transparency_items:
        return min(transparency_items, TRANSPARENCY_ITEM_TARGET) / TRANSPARENCY_ITEM_TARGET
    return 0.0


def _policy_signals_score(profile: dict[str, Any]) -> float:
    policy_signals = _policy_signal_count(profile)
    if policy_signals:
        return min(policy_signals, TRANSPARENCY_SIGNAL_TARGET) / TRANSPARENCY_SIGNAL_TARGET
    return 0.0


def _ads_txt_score(profile: dict[str, Any]) -> float:
    return 1.0 if profile.get("ads_txt") else 0.0


def _sellers_json_score(profile: dict[str, Any]) -> float:
    sellers_json = profile.get("sellers_json")
    if not isinstance(sellers_json, dict):
        return 0.0
    checked_records = int(sellers_json.get("checked_records") or 0)
    matched_records = int(sellers_json.get("matched_records") or 0)
    if checked_records > 0:
        return min(matched_records / checked_records, 1.0)
    if int(sellers_json.get("available_sellers_json") or 0) > 0:
        return 0.5
    return 0.0


def _coverage(profile: dict[str, Any]) -> float:
    fields = profile.get("fields") or {}
    points = (
        _field_key_score(fields)
        + _overview_score(profile)
        + _official_pages_score(profile)
        + _citations_score(profile)
        + _match_status_score(profile)
        + _transparency_score(profile)
        + _policy_signals_score(profile)
        + _ads_txt_score(profile)
        + _sellers_json_score(profile)
    )
    possible = float(len(FIELD_KEYS) + 8)
    if possible == 0:
        return 0.0
    return (points / possible) * 100.0


def _transparency_item_count(profile: dict[str, Any]) -> int:
    for section in profile.get("dossier_sections") or []:
        if not isinstance(section, dict) or section.get("id") != "transparency":
            continue
        items = section.get("items")
        return len(items) if isinstance(items, list) else 0
    return 0


def _policy_signal_count(profile: dict[str, Any]) -> int:
    policy_transparency = profile.get("policy_transparency")
    if isinstance(policy_transparency, dict):
        return int(policy_transparency.get("available_signals") or 0)
    return 0


def _ads_txt_available(profile: dict[str, Any]) -> bool:
    ads_txt = profile.get("ads_txt")
    return isinstance(ads_txt, dict) and bool(ads_txt.get("url"))


def _sellers_json_metrics(profile: dict[str, Any]) -> tuple[int, int, int]:
    sellers_json = profile.get("sellers_json")
    if not isinstance(sellers_json, dict):
        return 0, 0, 0
    return (
        int(sellers_json.get("checked_ad_systems") or 0),
        int(sellers_json.get("checked_records") or 0),
        int(sellers_json.get("matched_records") or 0),
    )


def _empty_source_result(source_name: str) -> dict[str, Any]:
    return {
        "source": source_name,
        "coverage_percent": 0.0,
        "official_pages": 0,
        "citations": 0,
        "field_hits": 0,
        "transparency_items": 0,
        "policy_signals": 0,
        "ads_txt": False,
        "sellers_json_systems": 0,
        "sellers_json_checked": 0,
        "sellers_json_matched": 0,
        "match_status": "none",
    }


def _source_url_quality_item_status(item: object) -> tuple[bool, str]:
    if not isinstance(item, dict):
        return False, "unknown"
    if str(item.get("label") or "") != "Source URL quality":
        return False, "unknown"
    value = str(item.get("value") or "")
    if "status=ok" in value:
        return True, "ok"
    if "status=mismatch" in value:
        return True, "mismatch"
    return True, "unknown"


def _profile_url_guard_status(profile: dict[str, Any]) -> str:
    for section in profile.get("dossier_sections") or []:
        if not isinstance(section, dict):
            continue
        items = section.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            matched, status = _source_url_quality_item_status(item)
            if matched:
                return status
    return "unknown"


def _url_guard_status(
    profile: dict[str, Any],
    source_name: str,
    build_source_url_guard: Any,
) -> str:
    status = _profile_url_guard_status(profile)
    if status != "unknown":
        return status

    catalog_sources = _base_sources()
    source_config = catalog_sources.get(source_name)
    guard_value = build_source_url_guard(
        (source_config or {}).get("url"),
        str(profile.get("website") or "") or None,
    )
    status_value = str(guard_value.get("status") or "unknown").lower()
    if status_value in {"ok", "mismatch"}:
        return status_value
    return "unknown"


async def _measure_source(source_name: str, force_refresh: bool) -> dict[str, Any]:
    _, get_source_profile, build_source_url_guard = _load_dependencies()
    profile = await get_source_profile(
        source_name=source_name,
        website=None,
        force_refresh=force_refresh,
        cache_only=False,
    )
    if not profile:
        return _empty_source_result(source_name)

    fields = profile.get("fields") or {}
    field_hits = int(_field_key_score(fields))
    official_pages = profile.get("official_pages") or []
    citations = profile.get("citations") or []
    sellers_json_systems, sellers_json_checked, sellers_json_matched = _sellers_json_metrics(
        profile
    )
    return {
        "source": source_name,
        "coverage_percent": round(_coverage(profile), 2),
        "official_pages": len(official_pages) if isinstance(official_pages, list) else 0,
        "citations": len(citations) if isinstance(citations, list) else 0,
        "field_hits": field_hits,
        "transparency_items": _transparency_item_count(profile),
        "policy_signals": _policy_signal_count(profile),
        "ads_txt": _ads_txt_available(profile),
        "sellers_json_systems": sellers_json_systems,
        "sellers_json_checked": sellers_json_checked,
        "sellers_json_matched": sellers_json_matched,
        "match_status": str(profile.get("match_status") or "none"),
        "url_guard": _url_guard_status(profile, source_name, build_source_url_guard),
    }


async def _measure_reporter_coverage() -> dict[str, Any]:
    from sqlalchemy import func, select

    from app.database import ArticleAuthor as ArticleAuthorModel
    from app.database import AsyncSessionLocal
    from app.database import Reporter as ReporterModel
    from app.services.reporter_confidence_scorer import (
        has_verified_author_page_citation,
        is_author_profile_url,
    )

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")

    session = AsyncSessionLocal()
    try:
        total_result = await session.execute(select(func.count()).select_from(ReporterModel))
        total_reporters = total_result.scalar_one() or 0

        tier_result = await session.execute(
            select(ReporterModel.confidence_tier, func.count()).group_by(
                ReporterModel.confidence_tier
            )
        )
        tier_counts: dict[str, int] = {}
        for row in tier_result.all():
            tier_counts[str(row[0]) if row[0] else "unmatched"] = int(row[1])

        qid_result = await session.execute(
            select(func.count())
            .select_from(ReporterModel)
            .where(
                ReporterModel.wikidata_qid.isnot(None),
                ReporterModel.wikidata_qid != "",
            )
        )
        with_qid = qid_result.scalar_one() or 0

        author_page_result = await session.execute(
            select(func.count())
            .select_from(ReporterModel)
            .where(
                ReporterModel.author_page_url.isnot(None),
                ReporterModel.author_page_url != "",
            )
        )
        with_author_page = author_page_result.scalar_one() or 0

        claims_result = await session.execute(
            select(func.count())
            .select_from(ReporterModel)
            .where(
                ReporterModel.claims_count > 0,
            )
        )
        with_claims = claims_result.scalar_one() or 0

        article_link_result = await session.execute(
            select(func.count(func.distinct(ArticleAuthorModel.reporter_id))).select_from(
                ArticleAuthorModel
            )
        )
        with_article_links = article_link_result.scalar_one() or 0

        reporter_result = await session.execute(select(ReporterModel))
        reporters = list(reporter_result.scalars().all())
        (
            with_author_profile_page,
            verified_author_profile_page,
            verified_author_page_citations,
            non_profile_author_page,
        ) = _author_page_classification_counts(
            reporters,
            is_author_profile_url,
            has_verified_author_page_citation,
        )

        return {
            "total_reporters": total_reporters,
            "tier_counts": tier_counts,
            "with_wikidata_qid": with_qid,
            "with_author_page_url": with_author_page,
            "with_public_author_page_url": with_author_profile_page,
            "with_author_profile_url": with_author_profile_page,
            "verified_public_author_page_url": verified_author_profile_page,
            "verified_author_profile_url": verified_author_profile_page,
            "verified_author_page_citations": verified_author_page_citations,
            "non_public_author_page_url": non_profile_author_page,
            "non_profile_author_page_url": non_profile_author_page,
            "with_claims": with_claims,
            "with_article_links": with_article_links,
        }
    finally:
        await session.close()


def _author_page_classification_counts(
    reporters: list[Any],
    is_author_profile_url: Any,
    has_verified_author_page_citation: Any,
) -> tuple[int, int, int, int]:
    with_author_profile_page = 0
    verified_author_profile_page = 0
    verified_author_page_citations = 0
    non_profile_author_page = 0
    for reporter_model in reporters:
        author_page_url = str(reporter_model.author_page_url or "")
        if not author_page_url:
            continue
        if not (
            is_author_profile_url(author_page_url)
            or is_author_profile_url(str(reporter_model.canonical_author_url or ""))
        ):
            non_profile_author_page += 1
            continue
        with_author_profile_page += 1
        if reporter_model.confidence_tier == "verified":
            verified_author_profile_page += 1
            if has_verified_author_page_citation(reporter_model):
                verified_author_page_citations += 1
    return (
        with_author_profile_page,
        verified_author_profile_page,
        verified_author_page_citations,
        non_profile_author_page,
    )


def _error_source_result(source_name: str, exc: Exception) -> dict[str, Any]:
    return {
        "source": source_name,
        "coverage_percent": 0.0,
        "official_pages": 0,
        "citations": 0,
        "field_hits": 0,
        "transparency_items": 0,
        "policy_signals": 0,
        "ads_txt": False,
        "sellers_json_systems": 0,
        "sellers_json_checked": 0,
        "sellers_json_matched": 0,
        "match_status": "error",
        "url_guard": "unknown",
        "error": str(exc),
    }


def _print_source_results(results: list[dict[str, Any]]) -> None:
    average = statistics.mean(item["coverage_percent"] for item in results)
    median = statistics.median(item["coverage_percent"] for item in results)

    print(
        "source\tcoverage_percent\tfield_hits\tofficial_pages\tcitations\t"
        "transparency_items\tpolicy_signals\tads_txt\tsellers_json_systems\t"
        "sellers_json_matched\tmatch_status\turl_guard"
    )
    for row in results:
        print(
            f"{row['source']}\t{row['coverage_percent']:.2f}\t{row['field_hits']}\t"
            f"{row['official_pages']}\t{row['citations']}\t"
            f"{row['transparency_items']}\t{row['policy_signals']}\t"
            f"{row['ads_txt']}\t{row['sellers_json_systems']}\t"
            f"{row['sellers_json_matched']}/{row['sellers_json_checked']}\t"
            f"{row['match_status']}\t{row['url_guard']}"
        )
    print(f"avg_coverage_percent={average:.2f}")
    print(f"median_coverage_percent={median:.2f}")
    print(f"sources_measured={len(results)}")


def _count_matching(
    results: list[dict[str, Any]],
    predicate: Callable[[dict[str, Any]], bool],
) -> int:
    return sum(predicate(row) for row in results)


def _aggregate_counts(results: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "ads_txt_count": _count_matching(results, lambda row: bool(row.get("ads_txt"))),
        "policy_signal_source_count": _count_matching(
            results, lambda row: int(row.get("policy_signals") or 0) > 0
        ),
        "sellers_json_count": _count_matching(
            results, lambda row: int(row.get("sellers_json_systems") or 0) > 0
        ),
        "url_guard_mismatch_count": _count_matching(
            results, lambda row: row.get("url_guard") == "mismatch"
        ),
        "url_guard_ok_count": _count_matching(results, lambda row: row.get("url_guard") == "ok"),
    }


def _print_aggregate_counts(results: list[dict[str, Any]]) -> None:
    counts = _aggregate_counts(results)
    for key, value in counts.items():
        print(f"{key}={value}")


def _print_reporter_summary(rc: dict[str, Any]) -> None:
    print()
    print("--- Reporter Coverage ---")
    print(f"total_reporters={rc['total_reporters']}")
    for tier in ("verified", "strong", "likely", "unmatched"):
        count = rc.get("tier_counts", {}).get(tier, 0)
        print(f"confidence_{tier}={count}")
    print(f"with_wikidata_qid={rc['with_wikidata_qid']}")
    print(f"with_author_page_url={rc['with_author_page_url']}")
    print(f"with_public_author_page_url={rc['with_public_author_page_url']}")
    print(f"with_author_profile_url={rc['with_author_profile_url']}")
    print(f"verified_public_author_page_url={rc['verified_public_author_page_url']}")
    print(f"verified_author_profile_url={rc['verified_author_profile_url']}")
    print(f"verified_author_page_citations={rc['verified_author_page_citations']}")
    print(f"non_public_author_page_url={rc['non_public_author_page_url']}")
    print(f"non_profile_author_page_url={rc['non_profile_author_page_url']}")
    print(f"with_claims={rc['with_claims']}")
    print(f"with_article_links={rc['with_article_links']}")


async def main_async(limit: int, force_refresh: bool, reporter: bool = False) -> int:
    sources = _select_sources(limit)
    if not sources:
        print("avg_coverage_percent=0.00")
        print("sources_measured=0")
        return 0

    results: list[dict[str, Any]] = []
    for source_name in sources:
        try:
            result = await _measure_source(source_name, force_refresh)
        except Exception as exc:
            result = _error_source_result(source_name, exc)
        results.append(result)

    _print_source_results(results)
    _print_aggregate_counts(results)

    if reporter:
        try:
            rc = await _measure_reporter_coverage()
            _print_reporter_summary(rc)
        except Exception as exc:
            print(f"reporter_coverage_error={exc}")

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
    parser.add_argument(
        "--reporter",
        action="store_true",
        help="Also measure reporter coverage metrics (confidence tiers, QID, author page, claims).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return asyncio.run(
        main_async(
            limit=args.limit,
            force_refresh=args.force_refresh,
            reporter=args.reporter,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
