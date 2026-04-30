#!/usr/bin/env python3
"""
Import MBFC (Media Bias/Fact Check) outlet-level data and cross-reference with sources.

Downloads the free HuggingFace dataset `zainmujahid/mbfc-media-outlets`,
attaches bias/factuality labels to reporters and sources.

Usage:
    # Download MBFC dataset
    uv run python -m scripts.import_mbfc --download

    # Cross-reference RSS sources against MBFC
    uv run python -m scripts.import_mbfc --crosswalk

    # Full pipeline
    uv run python -m scripts.import_mbfc --download --crosswalk
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import and cross-reference MBFC data")
    parser.add_argument(
        "--download",
        action="store_true",
        help="Download MBFC dataset from HuggingFace",
    )
    parser.add_argument(
        "--crosswalk",
        action="store_true",
        help="Cross-reference RSS sources against MBFC labels",
    )
    return parser.parse_args()


async def download() -> int:
    from app.services.mbfc_integration import download_mbfc_dataset

    print("Downloading MBFC dataset from HuggingFace...")
    result = await download_mbfc_dataset()
    if result:
        for filename, path in result.items():
            print(f"  {filename} -> {path}")
        print("Download complete.")
        return 0
    else:
        print("Download failed - no files retrieved.")
        return 1


async def crosswalk() -> int:
    from app.services.mbfc_integration import get_rss_mbfc_crosswalk

    print("Cross-referencing RSS sources against MBFC...")
    results = get_rss_mbfc_crosswalk()

    matched = [r for r in results if r["matched"]]
    unmatched = [r for r in results if not r["matched"]]

    print(f"\n{len(matched)} matched, {len(unmatched)} unmatched\n")

    print(f"{'Source':40s} {'RSS Bias':12s} {'MBFC Bias':12s} {'MBFC Factuality':16s}")
    print("-" * 80)
    for r in sorted(matched, key=lambda x: x["source_name"]):
        print(
            f"{r['source_name']:40s} {r['rss_bias']:12s} "
            f"{r['mbfc_bias']:12s} {r['mbfc_factuality']:16s}"
        )

    if unmatched:
        print(f"\n--- Unmatched ({len(unmatched)}) ---")
        for r in sorted(unmatched, key=lambda x: x["source_name"])[:15]:
            print(f"  {r['source_name']}")
        if len(unmatched) > 15:
            print(f"  ... and {len(unmatched) - 15} more")

    return 0


async def main_async(args: argparse.Namespace) -> int:
    did_something = False
    if args.download:
        code = await download()
        if code != 0:
            return code
        did_something = True

    if args.crosswalk:
        code = await crosswalk()
        if code != 0:
            return code
        did_something = True

    if not did_something:
        print("No action specified. Use --download, --crosswalk, or both.")
        return 1

    return 0


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(asyncio.run(main_async(args)))
