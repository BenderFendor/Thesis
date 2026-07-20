"""Project logging and runtime-data paths."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s"

REPO_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_DATA_DIR = Path(os.environ.get("THESIS_RUNTIME_DIR", REPO_ROOT / "runtime-data"))
RUNTIME_LOG_DIR = RUNTIME_DATA_DIR / "logs"

# Keep the existing structured debug logger, but point it at durable project data
# unless a deployment explicitly chooses another directory.
os.environ.setdefault("DEBUG_LOG_DIR", str(RUNTIME_LOG_DIR))

LOG_DIR = Path(os.environ.get("LOG_DIR", RUNTIME_LOG_DIR / "sessions"))
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


def get_runtime_data_dir() -> Path:
    """Return the configured runtime-data directory, creating it when needed."""
    RUNTIME_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return RUNTIME_DATA_DIR


def get_runtime_log_dir() -> Path:
    """Return the configured structured-log directory."""
    RUNTIME_LOG_DIR.mkdir(parents=True, exist_ok=True)
    return RUNTIME_LOG_DIR


def get_session_dir() -> Path:
    """Return the current plain-text application-log session directory."""
    global _session_dir
    if _session_dir is None:
        session_name = f"{datetime.now():%Y-%m-%d_%H-%M-%S}_{os.getpid()}"
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
    except (OSError, PermissionError) as exc:
        root_logger.warning("Could not create log file: %s", exc)

    return logging.getLogger("app")


def get_logger(name: str | None = None) -> logging.Logger:
    """Get a named logger, ensuring logging is configured."""
    if not logging.getLogger().handlers:
        configure_logging()
    return logging.getLogger(name if name else "app")


def log_progress(logger: logging.Logger, message: str, *args: object) -> None:
    """Emit one operational INFO line to both the console and detailed log."""
    logger.info(message, *args, extra={"console_summary": True})
