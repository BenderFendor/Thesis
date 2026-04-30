#!/usr/bin/env python3
"""
Seed reporters database from Wikidata SPARQL.

Queries Wikidata for journalists working at outlets in the RSS catalog,
then resolves their profiles and persists to the reporters table.

Usage:
    uv run python -m scripts.seed_reporters_wikidata
    uv run python -m scripts.seed_reporters_wikidata --timeout 60
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
    parser = argparse.ArgumentParser(description="Seed reporters from Wikidata SPARQL")
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="HTTP request timeout in seconds",
    )
    return parser.parse_args()


async def main_async(timeout: int) -> int:
    from app.services.reporter_indexer import seed_reporters_from_wikidata

    import httpx

    print("Querying Wikidata SPARQL for journalists...")
    async with httpx.AsyncClient(timeout=float(timeout)) as client:
        result = await seed_reporters_from_wikidata(http_client=client)

    if "error" in result:
        print(f"ERROR: {result['error']}")
        return 1

    print(f"Total journalist-employer pairs found: {result.get('total', 0)}")
    print(f"Resolved: {result.get('resolved', 0)}")
    print(f"Failed: {result.get('failed', 0)}")
    print(f"Completed at: {result.get('completed_at', 'unknown')}")
    return 0


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(asyncio.run(main_async(timeout=args.timeout)))
