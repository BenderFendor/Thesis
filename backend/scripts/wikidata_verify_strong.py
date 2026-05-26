"""Promote strong-tier reporters by cross-checking Wikidata employer against source.

For every strong-tier reporter with a Wikidata QID, checks if their career_history
entries (from Wikidata P108 employer labels) match any source they've written for.
If there's a match, sets the Wikidata URL as the author_page_url with citation and
recomputes confidence to promote them to verified.

Pure DB operation — no network calls.

Usage:
    python scripts/wikidata_verify_strong.py
    python scripts/wikidata_verify_strong.py --dry-run
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

from sqlalchemy import select  # noqa: E402

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

logger = get_logger("wikidata_verify")


async def _get_session():
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


def _employer_matches_source(employer: str, source: str) -> bool:
    e = employer.strip().lower()
    s = source.strip().lower()
    if not e or not s:
        return False
    return e == s or e in s or s in e


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        # Get all strong reporters with Wikidata QID
        result = await session.execute(
            select(Reporter).where(
                Reporter.confidence_tier == "strong",
                Reporter.wikidata_qid.isnot(None),
            )
        )
        reporters = result.scalars().all()

        if not reporters:
            logger.info("No strong+wikidata reporters found")
            return 0

        # Get source attribution per reporter
        reporter_ids = [int(r.id or 0) for r in reporters if r.id]
        source_result = await session.execute(
            select(ArticleAuthor.reporter_id, Article.source)
            .join(Article, Article.id == ArticleAuthor.article_id)
            .where(ArticleAuthor.reporter_id.in_(reporter_ids))
            .distinct()
        )
        reporter_sources: dict[int, set[str]] = {}
        for rid, src in source_result.all():
            reporter_sources.setdefault(int(rid), set()).add(str(src))

        promoted = 0
        skipped_no_employer = 0
        skipped_no_match = 0
        already_has_author_url = 0

        # Build RSS catalog source name set for employer matching
        catalog_sources = get_rss_sources()
        catalog_names: dict[str, str] = {}
        for name, cfg in catalog_sources.items():
            base = name.split(" - ")[0].strip().lower()
            if base not in catalog_names:
                catalog_names[base] = name

        for reporter in reporters:
            rid = int(reporter.id or 0)

            # Load career history from Wikidata
            career = reporter.career_history if isinstance(reporter.career_history, list) else []
            wd_employers: list[str] = []
            for entry in career:
                if not isinstance(entry, dict):
                    continue
                org = str(entry.get("organization") or "").strip()
                if org and org not in wd_employers:
                    wd_employers.append(org)

            if not wd_employers:
                skipped_no_employer += 1
                continue

            # Check if already has author_page_url
            if reporter.author_page_url:
                already_has_author_url += 1

            # Get source from article attribution, or fall back to RSS catalog
            sources = reporter_sources.get(rid, set())
            matched_source: str | None = None
            matched_employer: str | None = None

            if sources:
                # Match Wikidata employer against article-attributed source
                for employer in wd_employers:
                    for source in sources:
                        if _employer_matches_source(employer, source):
                            matched_source = source
                            matched_employer = employer
                            break
                    if matched_source:
                        break

            if not matched_source:
                # Fall back: match employer against RSS catalog names
                for employer in wd_employers:
                    for cat_name, cat_full in catalog_names.items():
                        if _employer_matches_source(employer, cat_name):
                            matched_source = cat_full
                            matched_employer = employer
                            break
                    if matched_source:
                        break

            if not matched_source:
                skipped_no_match += 1
                continue

            # Promote
            wikidata_url = (
                reporter.wikidata_url or f"https://www.wikidata.org/wiki/{reporter.wikidata_qid}"
            )

            if not reporter.author_page_url:
                reporter.author_page_url = wikidata_url
            if not reporter.canonical_author_url:
                reporter.canonical_author_url = wikidata_url

            citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
            citation = {
                "label": "Wikidata employer match",
                "url": wikidata_url,
                "note": (
                    f"Wikidata employer '{matched_employer}' matches source '{matched_source}'."
                ),
            }
            if not any(
                isinstance(c, dict) and str(c.get("url") or "") == wikidata_url for c in citations
            ):
                citations.append(citation)
            reporter.citations = citations
            reporter.updated_at = get_utc_now()

            if not args.dry_run:
                await session.commit()
                await update_reporter_confidence(session, rid)
                await session.refresh(reporter)
                new_tier = reporter.confidence_tier or "unmatched"
                if new_tier == "verified":
                    promoted += 1
                    logger.info(
                        "Promoted: %s (employer=%s, source=%s)",
                        reporter.name,
                        matched_employer,
                        matched_source,
                    )
                else:
                    logger.debug(
                        "Not promoted: %s tier=%s score=%s",
                        reporter.name,
                        new_tier,
                        reporter.confidence_score,
                    )

        print()
        print("=" * 72)
        print(f"WIKIDATA EMPLOYER VERIFY  (dry_run={args.dry_run})")
        print("=" * 72)
        print(f"Strong+Wikidata rptrs: {len(reporters)}")
        print(f"Promoted to verified:  {promoted}")
        print(f"Skipped: no employer   {skipped_no_employer}")
        print(f"Skipped: no match      {skipped_no_match}")
        print(f"Already has author URL {already_has_author_url}")
        print("=" * 72)
        print("=" * 72)

    finally:
        await session.close()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Promote strong-tier reporters via Wikidata employer cross-check."
    )
    parser.add_argument("--dry-run", action="store_true")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
