"""Verify reporters via RSS feed author attribution using the Rust parser.

Downloads RSS feeds for each source in the catalog, parses them with the Rust
RSS parser (which already handles dc:creator, dc:author, RSS author, itunes:author,
media:credit, atom:author, and multi-author name splitting), then promotes
reporters whose names match the RSS feed author set.

Usage:
    python scripts/rss_verify_reporters.py
    python scripts/rss_verify_reporters.py --source "New York Times"
    python scripts/rss_verify_reporters.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

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
from app.services.reporter_public_records import clean_author_name  # noqa: E402
from app.services.rss_parser_rust_bindings import parse_feeds_parallel  # noqa: E402

logger = get_logger("rss_verify")


def _clean_rss_name(name: str) -> str | None:
    cleaned = clean_author_name(name)
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered in {
        "the new york times",
        "staff",
        "editor",
        "news desk",
        "associated press",
        "reuters",
        "afp",
        "the guardian",
        "bbc news",
        "bbc sport",
        "al jazeera",
        "the washington post",
        "bloomberg news",
    }:
        return None
    if len(cleaned) < 2:
        return None
    return cleaned


def _name_subsumes(a: str, b: str) -> bool:
    a_lower = a.lower()
    b_lower = b.lower()
    if a_lower == b_lower:
        return True
    a_tokens = set(a_lower.split())
    b_tokens = set(b_lower.split())
    if not a_tokens or not b_tokens:
        return False
    return bool(a_tokens.issubset(b_tokens) or b_tokens.issubset(a_tokens))


async def _get_session():
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def _promote_via_rss(
    session: AsyncSession,
    reporter: Reporter,
    feed_url: str,
) -> bool:
    rid = int(reporter.id or 0)
    if not reporter.author_page_url:
        reporter.author_page_url = feed_url
    if not reporter.canonical_author_url:
        reporter.canonical_author_url = feed_url

    citations = list(reporter.citations) if isinstance(reporter.citations, list) else []
    citations.append(
        {
            "label": "RSS dc:creator attribution",
            "url": feed_url,
            "note": "Publisher-confirmed byline in RSS feed.",
        }
    )
    reporter.citations = citations
    reporter.updated_at = get_utc_now()

    await session.commit()
    await update_reporter_confidence(session, rid)
    await session.refresh(reporter)
    return reporter.confidence_tier == "verified"


async def verify_source_rss(
    session: AsyncSession,
    source_name: str,
    rss_urls: list[str],
    dry_run: bool,
) -> dict[str, Any]:
    """Parse RSS feeds for a source with Rust parser and promote matching reporters."""
    result = {"source": source_name, "rss_authors": 0, "matched": 0, "promoted": 0}

    if not rss_urls:
        return result

    # Use the Rust parser to fetch and parse all feeds — it handles all
    # author formats (dc:creator, dc:author, RSS author, itunes:author,
    # media:credit, atom:author, multi-author splitting)
    parsed = await asyncio.get_running_loop().run_in_executor(
        None,
        lambda: parse_feeds_parallel([(source_name, rss_urls)], 4),
    )

    articles = parsed.get("articles", [])
    if not articles:
        return result

    # Collect all author names from parsed articles
    all_names: set[str] = set()
    for article in articles:
        for name in article.get("authors", []):
            cleaned = _clean_rss_name(str(name))
            if cleaned:
                all_names.add(cleaned)

    if not all_names:
        return result
    result["rss_authors"] = len(all_names)

    # Find reporters for this source
    source_variants = sorted(
        name
        for name in get_rss_sources()
        if name.split(" - ")[0].strip().lower() == source_name.lower()
    )
    if not source_variants:
        source_variants = [source_name]

    id_result = await session.execute(
        select(Reporter.id)
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Article.source.in_(source_variants))
        .distinct()
    )
    reporter_ids = [int(row[0]) for row in id_result.all()]

    if not reporter_ids:
        return result

    full_result = await session.execute(select(Reporter).where(Reporter.id.in_(reporter_ids)))
    reporters: dict[str, Reporter] = {}
    for r in full_result.scalars().all():
        if r.name and r.confidence_tier != "verified":
            key = _clean_rss_name(str(r.name or ""))
            if key:
                reporters[key] = r

    if not reporters:
        return result

    matched = 0
    promoted = 0
    for rss_name in all_names:
        reporter = reporters.get(rss_name)
        if not reporter:
            for rname, r in reporters.items():
                if _name_subsumes(rss_name, rname):
                    reporter = r
                    break
        if reporter:
            matched += 1
            if not dry_run:
                if await _promote_via_rss(session, reporter, str(rss_urls[0])):
                    promoted += 1

    result["matched"] = matched
    result["promoted"] = promoted
    if matched > 0:
        logger.info(
            "RSS %s: %d authors in feed, %d matched reporters, %d promoted",
            source_name,
            len(all_names),
            matched,
            promoted,
        )
    return result
    result["rss_authors"] = len(all_names)

    # Find reporters for this source
    source_variants = [
        name
        for name in get_rss_sources()
        if name.split(" - ")[0].strip().lower() == source_name.lower()
    ]
    if not source_variants:
        source_variants = [source_name]

    # Avoid DISTINCT on JSON columns — get IDs first, then load reporters
    id_result = await session.execute(
        select(Reporter.id)
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Article.source.in_(source_variants))
        .distinct()
    )
    reporter_ids = [int(row[0]) for row in id_result.all()]

    if not reporter_ids:
        return result

    full_result = await session.execute(select(Reporter).where(Reporter.id.in_(reporter_ids)))
    reporters: dict[str, Reporter] = {}
    for r in full_result.scalars().all():
        if r.name and r.confidence_tier != "verified":
            key = _clean_rss_name(str(r.name or ""))
            if key:
                reporters[key] = r

    if not reporters:
        return result

    matched = 0
    promoted = 0
    for rss_name in all_names:
        reporter = reporters.get(rss_name)
        if not reporter:
            # Try fuzzy match
            for rname, r in reporters.items():
                if _name_subsumes(rss_name, rname):
                    reporter = r
                    break
        if reporter:
            matched += 1
            if not dry_run:
                if await _promote_via_rss(session, reporter, str(rss_urls[0])):
                    promoted += 1

    result["matched"] = matched
    result["promoted"] = promoted
    if matched > 0:
        logger.info(
            "RSS %s: %d authors in feed, %d matched reporters, %d promoted",
            source_name,
            len(all_names),
            matched,
            promoted,
        )
    return result


async def main_async(args: argparse.Namespace) -> int:
    sources = get_rss_sources()
    deduped: dict[str, Any] = {}
    for name, cfg in sources.items():
        base = name.split(" - ")[0].strip()
        if base not in deduped:
            deduped[base] = cfg

    if args.source:
        source_names = [s for s in deduped if args.source.lower() in s.lower()]
    else:
        source_names = sorted(deduped.keys())

    logger.info("Processing %d sources via RSS verification", len(source_names))

    session = await _get_session()
    try:
        total_rss_authors = 0
        total_matched = 0
        total_promoted = 0
        sem = asyncio.Semaphore(args.concurrency)

        async def _process_one(name: str) -> dict[str, Any]:
            async with sem:
                cfg = deduped[name]
                urls = cfg.get("url")
                if isinstance(urls, str):
                    urls = [urls]
                elif not urls:
                    urls = []
                return await verify_source_rss(session, name, list(urls), args.dry_run)

        results = await asyncio.gather(
            *[_process_one(name) for name in source_names],
            return_exceptions=True,
        )

        for r in results:
            if isinstance(r, BaseException):
                continue
            total_rss_authors += r.get("rss_authors", 0)
            total_matched += r.get("matched", 0)
            total_promoted += r.get("promoted", 0)

        print()
        print("=" * 72)
        print(f"RSS VERIFICATION SUMMARY  (dry_run={args.dry_run})")
        print("=" * 72)
        print(f"Sources processed:    {len(source_names)}")
        print(f"RSS author names:     {total_rss_authors}")
        print(f"Matched reporters:    {total_matched}")
        print(f"Promoted to verified: {total_promoted}")
        print("=" * 72)

    finally:
        await session.close()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify reporters via RSS feed dc:creator attribution."
    )
    parser.add_argument("--source", help="Process a single source")
    parser.add_argument("--concurrency", type=int, default=8, help="Concurrent source fetches")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't write to DB")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
