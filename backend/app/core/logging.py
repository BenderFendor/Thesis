import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

_LOG_FORMAT = (
    "%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s"
)

LOG_DIR = Path(os.environ.get("LOG_DIR", Path(__file__).parent.parent.parent / "logs"))
LOG_FILE = LOG_DIR / "app.log"
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10 MB
BACKUP_COUNT = 3


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure root logging with project defaults and return the app logger."""
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    if root_logger.handlers:
        return logging.getLogger("app")

    formatter = logging.Formatter(_LOG_FORMAT)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=MAX_LOG_SIZE,
            backupCount=BACKUP_COUNT,
        )
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    except (OSError, PermissionError) as e:
        root_logger.warning("Could not create log file: %s", e)

    return logging.getLogger("app")


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """Get a named logger, ensuring logging is configured."""
    if not logging.getLogger().handlers:
        configure_logging()
    return logging.getLogger(name if name else "app")
