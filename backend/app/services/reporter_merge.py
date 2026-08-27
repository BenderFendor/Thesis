"""Merge duplicate-name reporter rows (audit rec 3).

375 duplicate-name groups / 399 excess rows exist because `article_authors`
is scoped per RSS feed entry: the same human gets a separate `Reporter` row
per feed variant (The Guardian vs. The Guardian - UK) or wire-syndication
appearance (an AP staffer credited at several client outlets). The audit's
definition of a duplicate is deliberately narrow -- exact
`normalized_name` equality among *covered* (article_count > 0) reporters --
so this stage matches that exactly rather than fuzzy-matching names.

Reversible: a losing row is never deleted. It gets `retirement_reason=
'merged'` and `merged_into=<winner id>`; every FK that pointed at it
(`article_authors.reporter_id`, `reporter_claims.reporter_id`,
`identity_edges.reporter_id`) is re-pointed at the winner. `article_authors`
has a `(article_id, reporter_id)` uniqueness constraint, so a move that
would collide with a row the winner already owns for that article drops the
now-fully-redundant loser row instead of violating it (that's not evidence
loss -- it's the same article credited to the same now-unified person
twice).

Winner selection: most articles (`article_count`, our best signal of "which
row accumulated the real evidence"), tie-broken by earliest `created_at`
(the longest-standing identity), tie-broken by lowest id (determinism).

Idempotent: the candidate query only considers active rows
(`retirement_reason IS NULL`), so a merged loser never reappears as a
duplicate on a later run -- a second run with no new duplicates is a no-op.
Deliberately excludes `is_collective` rows (audit rec 4's flagged wire/
agency names): those are hidden from the Atlas regardless of duplication,
and merging "Reuters" x3 into one node would misrepresent them as a single
staff writer.

Run *after* `reporter_name_cleanup` (Fix 5): cleaning a dirty name can
create a fresh exact-normalized-name match with an existing clean row.
"""

from __future__ import annotations

from dataclasses import dataclass
from collections import defaultdict
from typing import cast

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import ArticleAuthor, IdentityEdge, Reporter, ReporterClaim

logger = get_logger("reporter_merge")


@dataclass
class MergeReport:
    """Summary counters for one merge pass."""

    groups_merged: int = 0
    reporters_retired: int = 0
    article_links_moved: int = 0
    article_links_deduped: int = 0


def _pick_winner(group: list[Reporter]) -> Reporter:
    def sort_key(reporter: Reporter) -> tuple[int, float, int]:
        # created_at is nullable (pre-default rows); a datetime/str mixed key
        # would raise TypeError on comparison, so sort on a numeric timestamp.
        created_at = reporter.created_at
        return (
            -(reporter.article_count or 0),
            created_at.timestamp() if created_at is not None else float("inf"),
            cast(int, reporter.id),
        )

    return sorted(group, key=sort_key)[0]


async def _repoint_article_authors(
    db: AsyncSession, *, loser_id: int, winner_id: int
) -> tuple[int, int]:
    """Move `article_authors` rows from loser to winner; dedupe on collision.

    Returns (moved, deduped).
    """
    loser_rows = list(
        (await db.execute(select(ArticleAuthor).where(ArticleAuthor.reporter_id == loser_id)))
        .scalars()
        .all()
    )
    if not loser_rows:
        return 0, 0

    winner_article_ids = set(
        (
            await db.execute(
                select(ArticleAuthor.article_id).where(ArticleAuthor.reporter_id == winner_id)
            )
        )
        .scalars()
        .all()
    )

    moved = 0
    deduped = 0
    for row in loser_rows:
        if row.article_id in winner_article_ids:
            await db.execute(delete(ArticleAuthor).where(ArticleAuthor.id == row.id))
            deduped += 1
        else:
            row.reporter_id = winner_id
            winner_article_ids.add(row.article_id)
            moved += 1
    return moved, deduped


async def merge_duplicate_reporters(db: AsyncSession) -> MergeReport:
    """Merge exact-normalized-name duplicate reporters; idempotent, no network."""
    report = MergeReport()

    candidates = list(
        (
            await db.execute(
                select(Reporter).where(
                    Reporter.article_count > 0,
                    Reporter.retirement_reason.is_(None),
                    Reporter.is_collective.is_(False),
                    Reporter.normalized_name.isnot(None),
                    Reporter.normalized_name != "",
                )
            )
        )
        .scalars()
        .all()
    )

    groups: dict[str, list[Reporter]] = defaultdict(list)
    for reporter in candidates:
        groups[str(reporter.normalized_name)].append(reporter)

    for group in groups.values():
        if len(group) < 2:
            continue
        winner = _pick_winner(group)
        losers = [reporter for reporter in group if reporter.id != winner.id]

        for loser in losers:
            moved, deduped = await _repoint_article_authors(
                db, loser_id=cast(int, loser.id), winner_id=cast(int, winner.id)
            )
            report.article_links_moved += moved
            report.article_links_deduped += deduped

            await db.execute(
                update(ReporterClaim)
                .where(ReporterClaim.reporter_id == loser.id)
                .values(reporter_id=winner.id)
            )
            await db.execute(
                update(IdentityEdge)
                .where(IdentityEdge.reporter_id == loser.id)
                .values(reporter_id=winner.id)
            )

            loser.retirement_reason = "merged"
            loser.merged_into = winner.id
            report.reporters_retired += 1

        winner_article_count = (
            await db.execute(
                select(func.count(ArticleAuthor.id)).where(ArticleAuthor.reporter_id == winner.id)
            )
        ).scalar_one()
        winner.article_count = int(winner_article_count)
        report.groups_merged += 1

    if report.groups_merged:
        logger.info(
            "reporter_merge: groups=%d retired=%d links_moved=%d links_deduped=%d",
            report.groups_merged,
            report.reporters_retired,
            report.article_links_moved,
            report.article_links_deduped,
        )
    return report
