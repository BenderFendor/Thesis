#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
REPO_BACKEND = ROOT / "backend"
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.services.async_utils import gather_limited  # noqa: E402
from scripts.reporter_source_verifier import (  # noqa: E402
    DEFAULT_BYLINE_SOURCES,
    DEFAULT_REPORTERS,
    DEFAULT_SOURCES,
    QUALITY_ORDER,
    source_has_full_requested_coverage,
    source_has_good_byline,
    source_meets_min_quality,
    validate_live_byline_async,
    validate_reporter,
    validate_source_async,
    validate_source_profile_async,
)
from scripts.reporter_source_samples import broad_source_sample, select_sources  # noqa: E402


def _print_source_results(source_results: list[dict[str, Any]]) -> None:
    print("SOURCE\tOK\tITEMS\tURL_GUARD\tMISSING_FIELDS")
    for result in source_results:
        print(
            f"{result['source']}\t{result['ok']}\t{result.get('items', 0)}\t"
            f"{result.get('url_guard', 'error')}\t{','.join(result.get('missing_fields', []))}"
        )
        if result.get("error"):
            print(f"ERROR\t{result['source']}\t{result['error']}")


def _print_reporter_results(reporter_results: list[dict[str, Any]]) -> None:
    print("REPORTER\tOK\tMATCH\tCONFIDENCE\tQID\tCITATIONS\tSOURCES")
    for result in reporter_results:
        print(
            f"{result['reporter']}\t{result['ok']}\t{result['match_status']}\t"
            f"{result['confidence']}\t{result.get('wikidata_qid') or '-'}\t"
            f"{result['citations']}\t{','.join(result['sources'])}"
        )


def _print_source_profile_results(profile_results: list[dict[str, Any]]) -> None:
    print(
        "SOURCE_PROFILE\tOK\tMATCH\tCITATIONS\tTRANSPARENCY\tADS_TXT\t"
        "AUTHORIZED_SELLERS\tSELLERS_JSON\tPOLICY_SIGNALS\tCHECKED_AD_SYSTEMS\t"
        "MATCHED_SELLER_ROWS\tWEBSITE"
    )
    for result in profile_results:
        print(
            f"{result['source']}\t{result['ok']}\t{result.get('match_status') or '-'}\t"
            f"{result.get('citations', 0)}\t"
            f"{result.get('transparency_items', 0)}\t"
            f"{result.get('ads_txt', False)}\t"
            f"{result.get('authorized_sellers', 0)}\t"
            f"{result.get('sellers_json', False)}\t"
            f"{result.get('policy_signals', 0)}\t"
            f"{result.get('checked_ad_systems', 0)}\t"
            f"{result.get('matched_seller_rows', 0)}\t"
            f"{result.get('website') or '-'}"
        )
        if result.get("error"):
            print(f"ERROR\t{result['source']}\t{result['error']}")


def _print_byline_results(byline_results: list[dict[str, Any]], reporters_per_source: int) -> None:
    print(
        "BYLINE_SOURCE\tOK\tQUALITY\tFOUND\tSTRONG\tMEDIUM\tWEAK\tNONE\tGENERIC\tBLOCKED\tSOURCE_MISMATCH\tSTRUCTURED\tMICRODATA\tMETA\tAUTHORS\tARTICLE_URL"
    )
    for result in byline_results:
        print(
            f"{result['source']}\t{result['ok']}\t{result.get('quality', 'none')}\t"
            f"{result.get('reporters_found', 0)}/{result.get('reporters_requested', reporters_per_source)}\t"
            f"{result.get('strong', 0)}\t{result.get('medium', 0)}\t"
            f"{result.get('weak', 0)}\t{result.get('none', 0)}\t"
            f"{result.get('generic', 0)}\t"
            f"{result.get('blocked', 0)}\t"
            f"{result.get('source_mismatch', 0)}\t"
            f"{result.get('structured', 0)}\t"
            f"{result.get('microdata', 0)}\t"
            f"{result.get('metadata', 0)}\t"
            f"{'; '.join(result.get('reporter_names', []))}\t"
            f"{result.get('article_url', '-')}"
        )
        if result.get("error"):
            print(f"ERROR\t{result['source']}\t{result['error']}")


def _failed_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in results if not item["ok"]]


def _byline_quality_counts(
    byline_results: list[dict[str, Any]],
) -> tuple[dict[str, int], dict[str, int], dict[str, int]]:
    source_counts = {"strong": 0, "medium": 0, "weak": 0, "none": 0}
    article_counts = {"strong": 0, "medium": 0, "weak": 0, "none": 0}
    evidence_counts = {
        "generic": 0,
        "blocked": 0,
        "source_mismatch": 0,
        "structured": 0,
        "microdata": 0,
        "metadata": 0,
    }
    for item in byline_results:
        quality = str(item.get("quality") or "none")
        source_counts[quality] = source_counts.get(quality, 0) + 1
        for tier in article_counts:
            article_counts[tier] += int(item.get(tier, 0))
        for key in evidence_counts:
            evidence_counts[key] += int(item.get(key, 0))
    return source_counts, article_counts, evidence_counts


def _print_quality_summary(
    source_results: list[dict[str, Any]],
    profile_results: list[dict[str, Any]],
    reporter_results: list[dict[str, Any]],
    byline_results: list[dict[str, Any]],
    reporters_per_source: int,
    min_byline_quality: str,
    failed_bylines: list[dict[str, Any]],
) -> None:
    source_counts, article_counts, evidence_counts = _byline_quality_counts(byline_results)
    good_sources = [item for item in byline_results if source_has_good_byline(item)]
    full_sources = [item for item in byline_results if source_has_full_requested_coverage(item)]
    print(
        f"SUMMARY\tsources={len(source_results)}\tsource_profiles={len(profile_results)}\treporters={len(reporter_results)}\tbylines={len(byline_results)}"
    )
    print(
        "BYLINE_SOURCE_QUALITY\t"
        f"strong={source_counts.get('strong', 0)}\t"
        f"medium={source_counts.get('medium', 0)}\t"
        f"weak={source_counts.get('weak', 0)}\t"
        f"none={source_counts.get('none', 0)}"
    )
    print(
        "BYLINE_ARTICLE_QUALITY\t"
        f"strong={article_counts.get('strong', 0)}\t"
        f"medium={article_counts.get('medium', 0)}\t"
        f"weak={article_counts.get('weak', 0)}\t"
        f"none={article_counts.get('none', 0)}\t"
        f"generic={evidence_counts['generic']}\t"
        f"blocked={evidence_counts['blocked']}\t"
        f"source_mismatch={evidence_counts['source_mismatch']}"
    )
    print(
        "BYLINE_EVIDENCE_TYPE\t"
        f"structured={evidence_counts['structured']}\t"
        f"microdata={evidence_counts['microdata']}\t"
        f"metadata={evidence_counts['metadata']}"
    )
    print(
        "BYLINE_COVERAGE\t"
        f"good_sources={len(good_sources)}\t"
        f"full_requested_sources={len(full_sources)}\t"
        f"reporters_requested_per_source={reporters_per_source}"
    )
    print(
        "BYLINE_GATE\t"
        f"min_quality={min_byline_quality}\t"
        f"passed={len(byline_results) - len(failed_bylines)}\t"
        f"failed={len(failed_bylines)}"
    )


def _print_summary(
    source_results: list[dict[str, Any]],
    profile_results: list[dict[str, Any]],
    reporter_results: list[dict[str, Any]],
    byline_results: list[dict[str, Any]],
    reporters_per_source: int,
    min_byline_quality: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    failed_sources = _failed_results(source_results)
    failed_profiles = _failed_results(profile_results)
    failed_reporters = _failed_results(reporter_results)
    failed_bylines = [
        item
        for item in byline_results
        if not item["ok"] or not source_meets_min_quality(item, min_byline_quality)
    ]
    _print_quality_summary(
        source_results,
        profile_results,
        reporter_results,
        byline_results,
        reporters_per_source,
        min_byline_quality,
        failed_bylines,
    )
    print(
        f"FAILURES\tsources={len(failed_sources)}\tsource_profiles={len(failed_profiles)}\treporters={len(failed_reporters)}\tbylines={len(failed_bylines)}"
    )
    return failed_sources, failed_profiles, failed_reporters, failed_bylines


async def _run_source_checks(
    args: argparse.Namespace,
    source_names: list[str],
    byline_sources: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    selected_sources = select_sources(source_names)
    source_results_raw = await gather_limited(
        [validate_source_async(name, config) for name, config in selected_sources.items()],
        limit=args.source_concurrency,
        return_exceptions=True,
    )
    source_results = [
        item if isinstance(item, dict) else {"source": "unknown", "ok": False, "error": str(item)}
        for item in source_results_raw
    ]
    profile_results_raw = await gather_limited(
        [validate_source_profile_async(name, config) for name, config in selected_sources.items()],
        limit=args.profile_concurrency,
        return_exceptions=True,
    )
    profile_results = [
        item if isinstance(item, dict) else {"source": "unknown", "ok": False, "error": str(item)}
        for item in profile_results_raw
    ]
    selected_byline_sources = select_sources(byline_sources)
    byline_results_raw = await gather_limited(
        [
            validate_live_byline_async(name, config, args.reporters_per_source)
            for name, config in selected_byline_sources.items()
        ],
        limit=args.source_concurrency,
        return_exceptions=True,
    )
    byline_results = [
        item if isinstance(item, dict) else {"source": "unknown", "ok": False, "error": str(item)}
        for item in byline_results_raw
    ]
    return source_results, profile_results, byline_results


async def main_async(args: argparse.Namespace) -> int:
    source_names = args.source or (
        broad_source_sample(args.sample_sources) if args.sample_sources else DEFAULT_SOURCES
    )
    reporter_specs = args.reporter or DEFAULT_REPORTERS
    byline_sources = args.byline_source or (
        source_names if args.bylines_from_sources else DEFAULT_BYLINE_SOURCES
    )

    source_results, profile_results, byline_results = await _run_source_checks(
        args,
        source_names,
        byline_sources,
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        reporter_results = [await validate_reporter(spec, client) for spec in reporter_specs]

    _print_source_results(source_results)
    _print_source_profile_results(profile_results)
    _print_reporter_results(reporter_results)
    _print_byline_results(byline_results, args.reporters_per_source)
    failures = _print_summary(
        source_results,
        profile_results,
        reporter_results,
        byline_results,
        args.reporters_per_source,
        args.min_byline_quality,
    )
    return 1 if any(failures) else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Live-verify reporter and source intelligence against real public sources."
    )
    parser.add_argument("--source", action="append", help="Source name to validate.")
    parser.add_argument(
        "--sample-sources",
        type=int,
        default=0,
        help="Broad deterministic sample size from the current RSS catalog.",
    )
    parser.add_argument(
        "--source-concurrency",
        type=int,
        default=10,
        help="Concurrent live source probes.",
    )
    parser.add_argument(
        "--profile-concurrency",
        type=int,
        default=3,
        help="Concurrent live source profile transparency probes.",
    )
    parser.add_argument(
        "--reporters-per-source",
        type=int,
        default=5,
        help="Maximum article/reporter signals to inspect per source.",
    )
    parser.add_argument(
        "--reporter",
        action="append",
        help="Reporter spec as 'Reporter Name::Outlet'.",
    )
    parser.add_argument(
        "--byline-source",
        action="append",
        help="Source name whose live RSS byline should be validated.",
    )
    parser.add_argument(
        "--bylines-from-sources",
        action="store_true",
        help="Run byline/reporter coverage checks over the selected source set.",
    )
    parser.add_argument(
        "--min-byline-quality",
        choices=sorted(QUALITY_ORDER),
        default="medium",
        help="Minimum source-level byline quality required for a passing byline check.",
    )
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
