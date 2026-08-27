"""Reporter dirty-name cleanup (audit rec 5)."""

from __future__ import annotations

import pytest

from app.database import Reporter
from app.services.reporter_name_cleanup import clean_reporter_name, cleanup_dirty_reporter_names


@pytest.mark.parametrize(
    "raw, expected",
    [
        (
            "BY DASHAN HENDRICKS Business content manager hendricksd@jamaicaobserver.com",
            "DASHAN HENDRICKS",
        ),
        ("(earlier) Lucy Campbell", "Lucy Campbell"),
        ("(later) John Doe", "John Doe"),
        ("Lucy Campbell", "Lucy Campbell"),  # already clean, no-op
        ("Van Der Berg", "Van Der Berg"),  # ordinary mixed-case name untouched
        ("BY JOHN SMITH", "JOHN SMITH"),
        ("MARY JANE SMITH", "MARY JANE SMITH"),  # 3 caps tokens, no trailing junk
        ("JOHN SMITH john.smith@example.com", "JOHN SMITH"),
        (
            "ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press",
            "ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press",  # left for the splitter
        ),
    ],
)
def test_clean_reporter_name_specimens(raw: str, expected: str) -> None:
    assert clean_reporter_name(raw) == expected


@pytest.mark.asyncio
async def test_cleanup_stage_preserves_raw_name_and_is_idempotent(db_session) -> None:
    reporter = Reporter(
        name="(earlier) Lucy Campbell",
        normalized_name="(earlier) lucy campbell",
        article_count=1,
    )
    clean_reporter = Reporter(
        name="Already Clean", normalized_name="already clean", article_count=1
    )
    db_session.add_all([reporter, clean_reporter])
    await db_session.commit()

    first = await cleanup_dirty_reporter_names(db_session)
    await db_session.commit()
    assert first.reporters_cleaned == 1

    await db_session.refresh(reporter)
    assert reporter.name == "Lucy Campbell"
    assert reporter.normalized_name == "lucy campbell"
    assert reporter.raw_name == "(earlier) Lucy Campbell"

    second = await cleanup_dirty_reporter_names(db_session)
    await db_session.commit()
    assert second.reporters_cleaned == 0

    await db_session.refresh(reporter)
    # raw_name is set once and never overwritten by a subsequent no-op pass.
    assert reporter.raw_name == "(earlier) Lucy Campbell"


@pytest.mark.asyncio
async def test_cleanup_skips_retired_reporters(db_session) -> None:
    reporter = Reporter(
        name="(earlier) Retired Name",
        normalized_name="(earlier) retired name",
        article_count=1,
        retirement_reason="merged",
        merged_into=999,
    )
    db_session.add(reporter)
    await db_session.commit()

    report = await cleanup_dirty_reporter_names(db_session)
    await db_session.commit()
    assert report.reporters_cleaned == 0

    await db_session.refresh(reporter)
    assert reporter.name == "(earlier) Retired Name"
