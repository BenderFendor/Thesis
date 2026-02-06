"""
CLI entry point for wiki indexing.

Usage:
    python -m app.scripts.index_wiki --all          # Index all sources
    python -m app.scripts.index_wiki --source "BBC"  # Index a specific source
    python -m app.scripts.index_wiki --stale         # Re-index stale entries
    python -m app.scripts.index_wiki --status        # Show indexing status
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.core.logging import configure_logging
from app.database import init_db
from app.data.rss_sources import get_rss_sources
from app.services.wiki_indexer import (
    get_index_status_summary,
    index_all_sources,
    index_source,
    index_stale_sources,
)


async def main() -> None:
    configure_logging()

    parser = argparse.ArgumentParser(description="Media Accountability Wiki Indexer")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Index all sources")
    group.add_argument("--source", type=str, help="Index a specific source by name")
    group.add_argument(
        "--stale", action="store_true", help="Re-index stale entries (>7 days)"
    )
    group.add_argument(
        "--status", action="store_true", help="Show indexing status summary"
    )

    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Delay in seconds between source indexing (default: 2.0)",
    )

    args = parser.parse_args()

    # Initialize database
    await init_db()

    if args.status:
        summary = await get_index_status_summary()
        print(f"\nWiki Index Status:")
        print(f"  Total entries: {summary['total_entries']}")
        print(f"  By status: {summary['by_status']}")
        print(f"  By type: {summary['by_type']}")
        return

    if args.all:
        print("Indexing all sources...")
        summary = await index_all_sources(delay_seconds=args.delay)
        print(
            f"\nResults: {summary['success']}/{summary['total']} succeeded, {summary['failed']} failed"
        )
        return

    if args.stale:
        print("Re-indexing stale entries...")
        summary = await index_stale_sources(delay_seconds=args.delay)
        print(
            f"\nResults: {summary['success']}/{summary['total']} succeeded, {summary['failed']} failed"
        )
        return

    if args.source:
        sources = get_rss_sources()
        # Find matching source
        source_config = None
        for name, config in sources.items():
            if name.lower() == args.source.lower() or name.lower().startswith(
                args.source.lower()
            ):
                source_config = config
                break

        if source_config is None:
            source_config = {"country": "", "funding_type": "", "bias_rating": ""}

        print(f"Indexing source: {args.source}")
        success = await index_source(args.source, source_config)
        if success:
            print(f"Successfully indexed {args.source}")
        else:
            print(f"Failed to index {args.source}")
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
