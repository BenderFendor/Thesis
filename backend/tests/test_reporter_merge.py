"""Merge duplicate-name reporters (audit rec 3)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.database import Article, ArticleAuthor, IdentityEdge, Reporter, ReporterClaim
from app.services.reporter_merge import _pick_winner, merge_duplicate_reporters

NOW = datetime(2026, 7, 22, tzinfo=UTC).replace(tzinfo=None)


async def _make_article(db, url: str) -> Article:
    article = Article(title="A story", source="Test Outlet", url=url, published_at=NOW, content="x")
    db.add(article)
    await db.flush()
    return article


@pytest.mark.asyncio
async def test_merge_picks_most_articles_as_winner_and_repoints_links(db_session) -> None:
    winner = Reporter(name="Eric Tucker", normalized_name="eric tucker", article_count=3)
    loser_a = Reporter(name="Eric Tucker", normalized_name="eric tucker", article_count=1)
    loser_b = Reporter(name="Eric Tucker", normalized_name="eric tucker", article_count=1)
    db_session.add_all([winner, loser_a, loser_b])
    await db_session.flush()

    articles = [await _make_article(db_session, f"https://example.com/{i}") for i in range(5)]
    await db_session.flush()
    db_session.add_all(
        [
            ArticleAuthor(article_id=articles[0].id, reporter_id=winner.id),
            ArticleAuthor(article_id=articles[1].id, reporter_id=winner.id),
            ArticleAuthor(article_id=articles[2].id, reporter_id=winner.id),
            ArticleAuthor(article_id=articles[3].id, reporter_id=loser_a.id),
            # Same article as winner already has -- must dedupe, not collide.
            ArticleAuthor(article_id=articles[0].id, reporter_id=loser_b.id),
        ]
    )
    db_session.add(
        ReporterClaim(reporter_id=loser_a.id, claim_type="bio", claim_value="x", source_type="test")
    )
    db_session.add(
        IdentityEdge(reporter_id=loser_a.id, target_url="https://x.example/a", edge_type="sameAs")
    )
    await db_session.commit()

    report = await merge_duplicate_reporters(db_session)
    await db_session.commit()

    assert report.groups_merged == 1
    assert report.reporters_retired == 2
    assert report.article_links_moved == 1
    assert report.article_links_deduped == 1

    await db_session.refresh(loser_a)
    await db_session.refresh(loser_b)
    assert loser_a.retirement_reason == "merged"
    assert loser_a.merged_into == winner.id
    assert loser_b.retirement_reason == "merged"
    assert loser_b.merged_into == winner.id

    await db_session.refresh(winner)
    assert winner.article_count == 4  # 3 original + article[3] moved from loser_a

    claim = (
        await db_session.execute(
            select(ReporterClaim).where(ReporterClaim.reporter_id == winner.id)
        )
    ).scalar_one()
    assert claim is not None
    edge = (
        await db_session.execute(select(IdentityEdge).where(IdentityEdge.reporter_id == winner.id))
    ).scalar_one()
    assert edge is not None

    # loser_b's duplicate ArticleAuthor row for articles[0] was dropped, not
    # left dangling on the retired row.
    remaining = (
        (
            await db_session.execute(
                select(ArticleAuthor).where(ArticleAuthor.reporter_id == loser_b.id)
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []


def test_pick_winner_tolerates_null_created_at() -> None:
    """Rows predating the created_at default must not crash winner selection."""
    dated = Reporter(
        name="Eric Tucker", normalized_name="eric tucker", article_count=2, created_at=NOW
    )
    legacy = Reporter(
        name="Eric Tucker", normalized_name="eric tucker", article_count=2, created_at=None
    )
    # Equal article counts, so the tie-break compares timestamps: the row
    # with a real created_at is the longer-standing identity and wins over
    # the NULL one.
    assert _pick_winner([legacy, dated]) is dated


@pytest.mark.asyncio
async def test_merge_is_idempotent(db_session) -> None:
    winner = Reporter(name="Lisa Mascaro", normalized_name="lisa mascaro", article_count=2)
    loser = Reporter(name="Lisa Mascaro", normalized_name="lisa mascaro", article_count=1)
    db_session.add_all([winner, loser])
    await db_session.commit()

    first = await merge_duplicate_reporters(db_session)
    await db_session.commit()
    assert first.groups_merged == 1
    assert first.reporters_retired == 1

    second = await merge_duplicate_reporters(db_session)
    await db_session.commit()
    assert second.groups_merged == 0
    assert second.reporters_retired == 0


@pytest.mark.asyncio
async def test_merge_excludes_agency_flagged_and_already_retired_rows(db_session) -> None:
    agency_a = Reporter(
        name="Reuters", normalized_name="reuters", article_count=5, is_collective=True
    )
    agency_b = Reporter(
        name="Reuters", normalized_name="reuters", article_count=5, is_collective=True
    )
    retired = Reporter(
        name="Old Name",
        normalized_name="dup name",
        article_count=5,
        retirement_reason="split",
        split_into=[1, 2],
    )
    active = Reporter(name="Dup Name", normalized_name="dup name", article_count=1)
    db_session.add_all([agency_a, agency_b, retired, active])
    await db_session.commit()

    report = await merge_duplicate_reporters(db_session)
    await db_session.commit()

    assert report.groups_merged == 0
    for reporter in (agency_a, agency_b, retired, active):
        await db_session.refresh(reporter)
    assert agency_a.retirement_reason is None
    assert agency_b.retirement_reason is None
    assert active.retirement_reason is None
