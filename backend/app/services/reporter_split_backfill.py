"""Backfill: split existing composite multi-author `Reporter` rows (audit rec 2b).

`reporter_indexer._handle_composite_byline` (audit rec 2a) stops new
composite bylines from minting junk rows going forward, but 1,343 rows
already exist from before that fix. This stage retroactively splits them:

- Locates every active (`retirement_reason IS NULL`, not agency-flagged)
  `Reporter` row whose name is a composite byline
  (`reporter_name_splitter.split_byline`).
- Creates/locates one child `Reporter` row per individual author (matched
  by `normalized_name`, same as the upstream path).
- Re-points every `ArticleAuthor` row from the composite row onto *each*
  child -- `article_authors` is an `(article_id, reporter_id)` pair table,
  so a byline crediting two people becomes two pairs for the same article,
  not one row moved to an arbitrary "primary" author.
- Retires the composite row with `retirement_reason='split'` and
  `split_into=[child ids]` -- distinct from Fix 3's `merged_into` marker
  because a split is 1 -> N, not N -> 1. The row is never deleted.

Idempotent: the candidate query excludes already-retired rows, so a
composite row split on one run is not reprocessed on the next; re-running
against an unchanged DB is a no-op.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import ArticleAuthor, Reporter
from app.services.reporter_name_splitter import split_byline

logger = get_logger("reporter_split_backfill")


def _normalize(name: str) -> str:
    return " ".join(name.lower().strip().split())


@dataclass
class SplitBackfillReport:
    """Summary counters for one backfill pass."""

    reporters_split: int = 0
    children_created: int = 0
    children_reused: int = 0
    article_links_created: int = 0


async def _get_or_create_child(
    db: AsyncSession, individual_name: str, report: SplitBackfillReport
) -> Reporter:
    normalized = _normalize(individual_name)
    # `.limit(1)` deliberately, not `scalar_one_or_none()`: the corpus can
    # already contain duplicate-name rows for this individual (that's
    # exactly Fix 3's problem) -- prefer the one with the most articles so
    # this child lands on the row `reporter_merge` would pick as the winner
    # anyway, rather than erroring out on ambiguity.
    existing = (
        await db.execute(
            select(Reporter)
            .where(Reporter.normalized_name == normalized, Reporter.retirement_reason.is_(None))
            .order_by(Reporter.article_count.desc().nullslast(), Reporter.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        report.children_reused += 1
        return existing
    child = Reporter(name=individual_name.strip(), normalized_name=normalized)
    db.add(child)
    await db.flush()
    report.children_created += 1
    return child


async def split_composite_reporters(db: AsyncSession) -> SplitBackfillReport:
    """Split every active composite-byline reporter row; idempotent, no network."""
    report = SplitBackfillReport()

    candidates = list(
        (
            await db.execute(
                select(Reporter).where(
                    Reporter.article_count > 0,
                    Reporter.retirement_reason.is_(None),
                    Reporter.is_collective.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )

    for composite in candidates:
        split_result = split_byline(str(composite.name or ""))
        if not split_result.was_split:
            continue

        composite_links = list(
            (
                await db.execute(
                    select(ArticleAuthor).where(ArticleAuthor.reporter_id == composite.id)
                )
            )
            .scalars()
            .all()
        )
        article_ids = [row.article_id for row in composite_links]

        child_ids: list[int] = []
        for individual_name in split_result.authors:
            child = await _get_or_create_child(db, individual_name, report)
            child_ids.append(cast(int, child.id))

            existing_child_article_ids = set(
                (
                    await db.execute(
                        select(ArticleAuthor.article_id).where(
                            ArticleAuthor.reporter_id == child.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            for article_id in article_ids:
                if article_id in existing_child_article_ids:
                    continue
                db.add(
                    ArticleAuthor(
                        article_id=article_id,
                        reporter_id=child.id,
                        author_role="author",
                        observation_source="reporter_split_backfill",
                    )
                )
                existing_child_article_ids.add(article_id)
                report.article_links_created += 1

            child_count = (
                await db.execute(
                    select(func.count(ArticleAuthor.id)).where(
                        ArticleAuthor.reporter_id == child.id
                    )
                )
            ).scalar_one()
            child.article_count = int(child_count)

        composite.retirement_reason = "split"
        composite.split_into = child_ids
        report.reporters_split += 1

    if report.reporters_split:
        logger.info(
            "reporter_split_backfill: split=%d children_created=%d children_reused=%d "
            "article_links_created=%d",
            report.reporters_split,
            report.children_created,
            report.children_reused,
            report.article_links_created,
        )
    return report
