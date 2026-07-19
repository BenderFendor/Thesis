"""Measure real RSS publication separately from post-publish enrichment."""

from __future__ import annotations

import argparse
import asyncio
import json
from time import perf_counter

from app.data.rss_sources import get_rss_sources
from app.services import rss_ingestion
from app.services.cache import news_cache


async def _measure(*, wait_for_enrichment: bool) -> None:
    started = perf_counter()
    sources = get_rss_sources()
    await rss_ingestion._refresh_news_cache_with_rust(
        sources,
        None,
        is_partial_refresh=False,
    )
    print(
        json.dumps(
            {
                "phase": "published",
                "articles": len(news_cache.get_articles()),
                "sources": len(sources),
                "seconds": round(perf_counter() - started, 3),
            },
            sort_keys=True,
        )
    )

    if wait_for_enrichment and rss_ingestion._post_publish_tasks:
        await asyncio.gather(*list(rss_ingestion._post_publish_tasks))
        print(
            json.dumps(
                {
                    "phase": "enriched_and_queued",
                    "articles": len(news_cache.get_articles()),
                    "sources": len(sources),
                    "seconds": round(perf_counter() - started, 3),
                },
                sort_keys=True,
            )
        )


def main() -> None:
    """Run the real-feed readiness measurement."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--wait-for-enrichment", action="store_true")
    args = parser.parse_args()
    asyncio.run(_measure(wait_for_enrichment=args.wait_for_enrichment))


if __name__ == "__main__":
    main()
