from __future__ import annotations

import gzip
import logging
import sys
from pathlib import Path

from app.core import logging as app_logging
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


def test_rotated_app_logs_are_gzip_and_keep_backup_count(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(app_logging, "LOG_DIR", tmp_path)
    monkeypatch.setattr(app_logging, "MAX_LOG_SIZE", 600)
    monkeypatch.setattr(app_logging, "BACKUP_COUNT", 2)
    monkeypatch.setattr(app_logging, "_session_dir", None)

    root_logger = logging.getLogger()
    original_handlers = root_logger.handlers[:]
    original_level = root_logger.level
    root_logger.handlers.clear()

    try:
        app_logger = app_logging.configure_logging(logging.INFO)
        messages = [f"record {number} " + "x" * 400 for number in range(1, 5)]
        for message in messages:
            app_logger.info(message)
        for handler in root_logger.handlers:
            handler.flush()

        session_dir = app_logging.get_session_dir()
        active_log = session_dir / "app.log"
        assert messages[-1] in active_log.read_text(encoding="utf-8")
        assert not active_log.read_bytes().startswith(b"\x1f\x8b")

        for backup_number, message in ((1, messages[-2]), (2, messages[-3])):
            backup = session_dir / f"app.log.{backup_number}.gz"
            with gzip.open(backup, "rt", encoding="utf-8") as compressed_log:
                assert message in compressed_log.read()

        assert len(list(session_dir.glob("app.log.*.gz"))) == app_logging.BACKUP_COUNT
    finally:
        created_handlers = root_logger.handlers[:]
        for handler in created_handlers:
            root_logger.removeHandler(handler)
            handler.close()
        root_logger.handlers[:] = original_handlers
        root_logger.setLevel(original_level)
