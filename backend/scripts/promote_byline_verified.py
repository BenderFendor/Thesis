"""Record consistent byline evidence for likely reporters.

For reporters with repeated article observations from the same source, records
source-level byline evidence without treating the source homepage as a person
author page. This can raise confidence to strong, but verified remains reserved
for confirmed author/profile pages.

Usage:
    python scripts/promote_byline_verified.py
    python scripts/promote_byline_verified.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from copy import deepcopy
from pathlib import Path

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from sqlalchemy import func, select  # noqa: E402

from app.core.logging import get_logger  # noqa: E402
from app.data.rss_sources import get_rss_sources  # noqa: E402
from app.database import (  # noqa: E402
    Article,
    ArticleAuthor,
    AsyncSessionLocal,
    Reporter,
    get_utc_now,
)
from app.services.reporter_confidence_scorer import (  # noqa: E402
    update_reporter_confidence,
)

logger = get_logger("byline_verify")

DEFAULT_MIN_ARTICLES = 5


async def _get_session():
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        min_articles = max(1, int(args.min_articles))
        result = await session.execute(
            select(Reporter, func.count(ArticleAuthor.id).label("obs_count"), Article.source)
            .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
            .join(Article, Article.id == ArticleAuthor.article_id)
            .where(Reporter.confidence_tier == "likely")
            .group_by(Reporter.id, Article.source)
            .having(func.count(ArticleAuthor.id) >= min_articles)
            .order_by(func.count(ArticleAuthor.id).desc())
        )

        reporter_obs: dict[int, tuple[Reporter, int, str]] = {}
        for row in result.all():
            reporter, obs, source = row
            rid = int(reporter.id or 0)
            if rid not in reporter_obs or reporter_obs[rid][1] < obs:
                reporter_obs[rid] = (reporter, obs, str(source))

        if not reporter_obs:
            logger.info("No likely reporters with %d+ observations", min_articles)
            return 0

        logger.info(
            "Found %d likely reporters with %d+ observations",
            len(reporter_obs),
            min_articles,
        )

        # Build source URL lookup from RSS catalog
        catalog = get_rss_sources()
        source_urls: dict[str, str] = {}
        for name, cfg in catalog.items():
            base = name.split(" - ")[0].strip().lower()
            site = cfg.get("site_url") or cfg.get("url")
            if site and base not in source_urls:
                if isinstance(site, list):
                    source_urls[base] = str(site[0])
                else:
                    source_urls[base] = str(site)

        updated = 0
        upgraded_to_strong = 0
        skipped_no_source_url = 0

        for rid, (reporter, obs_count, source_name) in reporter_obs.items():
            source_lower = source_name.lower()
            source_key = source_name.split(" - ")[0].strip().lower()
            evidence_url = (
                source_urls.get(source_key)
                or source_urls.get(source_lower)
                or f"https://{source_name.lower().replace(' ', '')}"
            )

            if not evidence_url.startswith("http"):
                skipped_no_source_url += 1
                continue

            citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
            citation = {
                "label": "Consistent byline attribution",
                "url": evidence_url,
                "source_type": "byline_frequency",
                "note": (f"Name appears as article author {obs_count} times for {source_name}."),
            }
            if not any(
                isinstance(c, dict)
                and c.get("label") == citation["label"]
                and c.get("url") == citation["url"]
                for c in citations
            ):
                citations.append(citation)
            reporter.citations = citations
            reporter.research_sources = sorted(
                set((reporter.research_sources or []) + ["byline_frequency"])
            )
            reporter.updated_at = get_utc_now()

            if not args.dry_run:
                await session.commit()
                await update_reporter_confidence(session, rid)
                await session.refresh(reporter)
                updated += 1
                new_tier = reporter.confidence_tier or "unmatched"
                if new_tier == "strong":
                    upgraded_to_strong += 1
                    logger.debug(
                        "Recorded strong byline evidence: %s (%d obs, %s)",
                        reporter.name,
                        obs_count,
                        source_name,
                    )

        print()
        print("=" * 72)
        print(f"BYLINE VERIFY  (dry_run={args.dry_run})")
        print("=" * 72)
        print(f"Reporters with {min_articles}+ obs: {len(reporter_obs)}")
        print(f"Evidence rows updated:         {updated}")
        print(f"Upgraded to strong:            {upgraded_to_strong}")
        print(f"Skipped (no source URL):        {skipped_no_source_url}")
        print("=" * 72)

    finally:
        await session.close()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record repeated byline evidence without marking it as verified."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--min-articles", type=int, default=DEFAULT_MIN_ARTICLES)
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
