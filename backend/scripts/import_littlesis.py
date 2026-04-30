#!/usr/bin/env python3
"""
Import LittleSis bulk data and cross-reference with reporters.

Downloads LittleSis entities and relationships, filters for media-related
entities, matches to Reporter records, and extracts organizational affiliations.

Usage:
    # First, download bulk data (one-time)
    uv run python -m scripts.import_littlesis --download

    # Then cross-reference with reporters
    uv run python -m scripts.import_littlesis

    # Full pipeline
    uv run python -m scripts.import_littlesis --download --cross-ref
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
    parser = argparse.ArgumentParser(
        description="Import and cross-reference LittleSis data"
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Download LittleSis bulk data files",
    )
    parser.add_argument(
        "--cross-ref",
        action="store_true",
        help="Cross-reference reporters against LittleSis entities",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=2000,
        help="Max reporters to match (default: 2000)",
    )
    return parser.parse_args()


async def download() -> int:
    from app.services.littlesis_integration import download_littlesis_bulk

    print("Downloading LittleSis bulk data...")
    result = await download_littlesis_bulk()
    if result:
        for filename, path in result.items():
            print(f"  {filename} -> {path}")
        print("Download complete.")
        return 0
    else:
        print("Download failed - no files retrieved.")
        return 1


async def cross_ref(limit: int) -> int:
    from app.services.littlesis_integration import (
        load_littlesis_entities,
        load_littlesis_relationships,
        cross_reference_entities_with_reporters,
        extract_affiliations_from_relationships,
    )
    from sqlalchemy import select

    from app.database import AsyncSessionLocal, Reporter

    print("Loading LittleSis entities...")
    entities = load_littlesis_entities()
    if not entities:
        print("No entities loaded. Run with --download first.")
        return 1

    print(f"Loaded {len(entities)} media-related entities.")

    entity_map = {e.get("id"): e for e in entities if e.get("id")}
    entity_ids = set(entity_map.keys())

    print("Loading LittleSis relationships...")
    relationships = load_littlesis_relationships(entity_ids=entity_ids)
    print(f"Loaded {len(relationships)} relationships.")

    if AsyncSessionLocal is None:
        print("Database not available.")
        return 1

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Reporter.id, Reporter.name, Reporter.normalized_name).limit(limit)
        )
        reporter_names = [(r[0], r[1], r[2]) for r in result.all()]

    print(
        f"Cross-referencing {len(reporter_names)} reporters against {len(entities)} LS entities..."
    )
    matches = cross_reference_entities_with_reporters(entities, reporter_names)
    print(f"Found {len(matches)} reporter-to-LS-entity matches.")

    if matches:
        entities_by_id = {e.get("id"): e for e in entities if e.get("id")}
        affiliations = extract_affiliations_from_relationships(
            matches, relationships, entities_by_id
        )
        print(f"Extracted {len(affiliations)} affiliations.")

        for aff in affiliations[:20]:
            print(
                f"  Reporter #{aff['reporter_id']} -> {aff['category']} -> "
                f"{aff['organization']} ({aff.get('start_date', '?')} - "
                f"{aff.get('end_date', '?')})"
            )
        if len(affiliations) > 20:
            print(f"  ... and {len(affiliations) - 20} more")

    return 0


async def main_async(args: argparse.Namespace) -> int:
    did_something = False
    if args.download:
        code = await download()
        if code != 0:
            return code
        did_something = True

    if args.cross_ref:
        code = await cross_ref(args.limit)
        if code != 0:
            return code
        did_something = True

    if not did_something:
        print("No action specified. Use --download, --cross-ref, or both.")
        return 1

    return 0


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(asyncio.run(main_async(args)))
