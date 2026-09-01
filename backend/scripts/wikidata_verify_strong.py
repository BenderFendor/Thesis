"""Record Wikidata employer evidence for strong-tier reporters."""

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
from app.services.reporter_confidence_scorer import update_reporter_confidence  # noqa: E402

logger = get_logger("wikidata_verify")


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


def _employer_matches_source(employer: str, source: str) -> bool:
    employer_name = employer.strip().lower()
    source_name = source.strip().lower()
    return bool(
        employer_name
        and source_name
        and (
            employer_name == source_name
            or employer_name in source_name
            or source_name in employer_name
        )
    )


async def _strong_wikidata_reporters(session: AsyncSession) -> list[Reporter]:
    result = await session.execute(
        select(Reporter).where(
            Reporter.confidence_tier == "strong",
            Reporter.wikidata_qid.isnot(None),
        )
    )
    return list(result.scalars().all())


async def _reporter_sources(
    session: AsyncSession, reporters: list[Reporter]
) -> dict[int, set[str]]:
    reporter_ids = [int(reporter.id) for reporter in reporters if reporter.id]
    if not reporter_ids:
        return {}
    result = await session.execute(
        select(ArticleAuthor.reporter_id, Article.source)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(ArticleAuthor.reporter_id.in_(reporter_ids))
        .distinct()
    )
    sources: dict[int, set[str]] = {}
    for reporter_id, source in result.all():
        sources.setdefault(int(reporter_id), set()).add(str(source))
    return sources


def _catalog_names() -> dict[str, str]:
    names: dict[str, str] = {}
    for source_name in get_rss_sources():
        base = source_name.split(" - ")[0].strip().lower()
        names.setdefault(base, source_name)
    return names


def _career_entry_employer(entry: object) -> str | None:
    if not isinstance(entry, dict):
        return None
    employer = str(entry.get("organization") or "").strip()
    return employer or None


def _career_entries(reporter: Reporter) -> list[object]:
    return reporter.career_history if isinstance(reporter.career_history, list) else []


def _wikidata_employers(reporter: Reporter) -> list[str]:
    career = _career_entries(reporter)
    employers = [
        employer for entry in career if (employer := _career_entry_employer(entry)) is not None
    ]
    return list(dict.fromkeys(employers))


def _first_employer_source_match(
    employers: list[str], sources: list[tuple[str, str]]
) -> tuple[str, str] | None:
    for employer in employers:
        match = next(
            (
                display_name
                for match_name, display_name in sources
                if _employer_matches_source(employer, match_name)
            ),
            None,
        )
        if match is not None:
            return employer, match
    return None


def _matched_employer_source(
    employers: list[str],
    reporter_sources: set[str],
    catalog_names: dict[str, str],
) -> tuple[str, str] | None:
    attributed = [(source, source) for source in reporter_sources]
    direct = _first_employer_source_match(employers, attributed)
    if direct is not None:
        return direct
    return _first_employer_source_match(employers, list(catalog_names.items()))


def _wikidata_url(reporter: Reporter) -> str:
    return str(reporter.wikidata_url or f"https://www.wikidata.org/wiki/{reporter.wikidata_qid}")


def _citation_matches(citation: object, url: str) -> bool:
    return isinstance(citation, dict) and str(citation.get("url") or "") == url


def _employer_citations(
    reporter: Reporter, employer: str, source: str, url: str
) -> list[dict[str, object]]:
    citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
    if any(_citation_matches(citation, url) for citation in citations):
        return citations
    return [
        *citations,
        {
            "label": "Wikidata employer match",
            "url": url,
            "source_type": "wikidata_employer_match",
            "note": f"Wikidata employer '{employer}' matches source '{source}'.",
        },
    ]


def _append_employer_citation(reporter: Reporter, employer: str, source: str) -> None:
    url = _wikidata_url(reporter)
    reporter.citations = _employer_citations(reporter, employer, source, url)
    reporter.research_sources = sorted(
        set((reporter.research_sources or []) + ["wikidata_employer_match"])
    )
    reporter.updated_at = get_utc_now()


async def _persist_employer_evidence(
    session: AsyncSession,
    reporter: Reporter,
    employer: str,
    source: str,
    *,
    dry_run: bool,
) -> bool:
    _append_employer_citation(reporter, employer, source)
    if dry_run:
        return False
    reporter_id = int(reporter.id or 0)
    await session.commit()
    await update_reporter_confidence(session, reporter_id)
    await session.refresh(reporter)
    logger.info(
        "Recorded Wikidata employer evidence: %s (employer=%s, source=%s, tier=%s)",
        reporter.name,
        employer,
        source,
        reporter.confidence_tier,
    )
    return True


async def _verify_reporter(
    session: AsyncSession,
    reporter: Reporter,
    reporter_sources: dict[int, set[str]],
    catalog_names: dict[str, str],
    *,
    dry_run: bool,
) -> str:
    employers = _wikidata_employers(reporter)
    if not employers:
        return "no_employer"
    match = _matched_employer_source(
        employers,
        reporter_sources.get(int(reporter.id or 0), set()),
        catalog_names,
    )
    if match is None:
        return "no_match"
    employer, source = match
    updated = await _persist_employer_evidence(session, reporter, employer, source, dry_run=dry_run)
    return "updated" if updated else "dry_run_match"


def _summary_counts(statuses: list[str]) -> dict[str, int]:
    return {
        "updated": statuses.count("updated"),
        "no_employer": statuses.count("no_employer"),
        "no_match": statuses.count("no_match"),
    }


def _print_summary(total: int, counts: dict[str, int], dry_run: bool) -> None:
    print()
    print("=" * 72)
    print(f"WIKIDATA EMPLOYER VERIFY  (dry_run={dry_run})")
    print("=" * 72)
    print(f"Strong+Wikidata rptrs: {total}")
    print(f"Evidence rows updated: {counts['updated']}")
    print(f"Skipped: no employer   {counts['no_employer']}")
    print(f"Skipped: no match      {counts['no_match']}")
    print("=" * 72)
    print("=" * 72)


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        reporters = await _strong_wikidata_reporters(session)
        if not reporters:
            logger.info("No strong+wikidata reporters found")
            return 0
        sources = await _reporter_sources(session, reporters)
        catalog = _catalog_names()
        statuses = [
            await _verify_reporter(
                session,
                reporter,
                sources,
                catalog,
                dry_run=args.dry_run,
            )
            for reporter in reporters
        ]
        _print_summary(len(reporters), _summary_counts(statuses), args.dry_run)
        return 0
    finally:
        await session.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record Wikidata employer evidence for strong-tier reporters."
    )
    parser.add_argument("--dry-run", action="store_true")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
