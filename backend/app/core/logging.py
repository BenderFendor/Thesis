import logging
from typing import Optional

_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s"


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    """Configure root logging with project defaults and return the app logger."""
    logging.basicConfig(level=level, format=_LOG_FORMAT)
    return logging.getLogger("app")


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """Get a named logger, ensuring logging is configured."""
    if not logging.getLogger().handlers:
        configure_logging()
    return logging.getLogger(name if name else "app")
