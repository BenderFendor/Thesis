"""Logging."""

import logging
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s"

LOG_DIR = Path(os.environ.get("LOG_DIR", Path(__file__).parent.parent.parent / "logs"))
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10 MB
BACKUP_COUNT = 3

_session_dir: Path | None = None


class ConsoleSummaryFilter(logging.Filter):
    """Keep routine detail in files while preserving concise console status."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Return whether a record belongs in the operational console."""
        return record.levelno >= logging.WARNING or bool(getattr(record, "console_summary", False))


class ConsoleSummaryFormatter(logging.Formatter):
    """Format console errors without printing stack traces or chained exceptions."""

    def format(self, record: logging.LogRecord) -> str:
        """Render a record as one line while leaving it intact for file handlers."""
        exc_info = record.exc_info
        exc_text = record.exc_text
        stack_info = record.stack_info
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        try:
            return super().format(record)
        finally:
            record.exc_info = exc_info
            record.exc_text = exc_text
            record.stack_info = stack_info


def get_session_dir() -> Path:
    """Get Session Dir."""
    global _session_dir
    if _session_dir is None:
        session_name = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        _session_dir = LOG_DIR / session_name
        _session_dir.mkdir(parents=True, exist_ok=True)
    return _session_dir


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure root logging with project defaults and return the app logger."""
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    if root_logger.handlers:
        return logging.getLogger("app")

    formatter = logging.Formatter(_LOG_FORMAT)

    console_handler = logging.StreamHandler()
    console_handler.addFilter(ConsoleSummaryFilter())
    console_handler.setFormatter(ConsoleSummaryFormatter(_LOG_FORMAT))
    root_logger.addHandler(console_handler)

    session_dir = get_session_dir()
    app_log_file = session_dir / "app.log"

    try:
        session_dir.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            app_log_file,
            maxBytes=MAX_LOG_SIZE,
            backupCount=BACKUP_COUNT,
        )
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    except (OSError, PermissionError) as e:
        root_logger.warning("Could not create log file: %s", e)

    return logging.getLogger("app")


def get_logger(name: str | None = None) -> logging.Logger:
    """Get a named logger, ensuring logging is configured."""
    if not logging.getLogger().handlers:
        configure_logging()
    return logging.getLogger(name if name else "app")


def log_progress(logger: logging.Logger, message: str, *args: object) -> None:
    """Emit one operational INFO line to both the console and detailed log."""
    logger.info(message, *args, extra={"console_summary": True})
