from __future__ import annotations

import logging
import sys

from app.core.logging import ConsoleSummaryFilter, ConsoleSummaryFormatter


def _record(level: int, message: str, *, console_summary: bool = False) -> logging.LogRecord:
    record = logging.LogRecord("test", level, __file__, 1, message, (), None)
    record.console_summary = console_summary
    return record


def test_console_filter_hides_routine_detail_but_keeps_progress_and_warnings() -> None:
    console_filter = ConsoleSummaryFilter()

    assert console_filter.filter(_record(logging.INFO, "raw service response")) is False
    assert (
        console_filter.filter(
            _record(logging.INFO, "RSS ready: 8000 articles", console_summary=True)
        )
        is True
    )
    assert console_filter.filter(_record(logging.WARNING, "source failed")) is True


def test_console_formatter_omits_stack_trace() -> None:
    try:
        raise RuntimeError("failure")
    except RuntimeError:
        record = logging.LogRecord(
            "test",
            logging.ERROR,
            __file__,
            1,
            "refresh failed",
            (),
            sys.exc_info(),
        )

    rendered = ConsoleSummaryFormatter("%(levelname)s %(message)s").format(record)

    assert rendered == "ERROR refresh failed"
    assert record.exc_info is not None
