"""Process Limits."""

from __future__ import annotations

import errno
import logging
import os
import resource
from collections.abc import Iterable
from pathlib import Path

DEFAULT_SOFT_NOFILE_TARGET = int(os.getenv("TARGET_NOFILE_SOFT_LIMIT", "65535"))


def get_nofile_limits() -> tuple[int | None, int | None]:
    """Get Nofile Limits."""
    try:
        soft_limit, hard_limit = resource.getrlimit(resource.RLIMIT_NOFILE)
    except (AttributeError, OSError, ValueError):
        return None, None
    return int(soft_limit), int(hard_limit)


def get_open_file_descriptor_count() -> int | None:
    """Get Open File Descriptor Count."""
    for fd_path in ("/proc/self/fd", "/dev/fd"):
        try:
            return len(list(Path(fd_path).iterdir()))
        except OSError:
            continue
    return None


def raise_nofile_soft_limit(
    logger: logging.Logger,
    target_soft_limit: int = DEFAULT_SOFT_NOFILE_TARGET,
) -> tuple[int | None, int | None]:
    """Raise Nofile Soft Limit."""
    soft_limit, hard_limit = get_nofile_limits()
    if soft_limit is None or hard_limit is None:
        logger.info("Open-file limits unavailable on this platform")
        return soft_limit, hard_limit

    desired_soft_limit = min(max(soft_limit, target_soft_limit), hard_limit)
    if desired_soft_limit <= soft_limit:
        logger.info(
            "Open-file limit already sufficient: soft=%s hard=%s",
            soft_limit,
            hard_limit,
        )
        return soft_limit, hard_limit

    try:
        resource.setrlimit(resource.RLIMIT_NOFILE, (desired_soft_limit, hard_limit))
    except (OSError, ValueError) as exc:
        logger.warning(
            "Could not raise open-file soft limit from %s to %s: %s",
            soft_limit,
            desired_soft_limit,
            exc,
        )
        return soft_limit, hard_limit

    logger.info(
        "Raised open-file soft limit from %s to %s (hard=%s)",
        soft_limit,
        desired_soft_limit,
        hard_limit,
    )
    return desired_soft_limit, hard_limit


def _is_open_file_exception(exc: BaseException) -> bool:
    if getattr(exc, "errno", None) == errno.EMFILE:
        return True
    message_parts: Iterable[object] = getattr(exc, "args", ()) or (exc,)
    message = " ".join(str(part) for part in message_parts if part is not None)
    return "too many open files" in message.lower()


def _related_exceptions(exc: BaseException) -> tuple[BaseException, ...]:
    return tuple(related for related in (exc.__cause__, exc.__context__) if related is not None)


def exception_mentions_too_many_open_files(exc: BaseException | None) -> bool:
    """Exception Mentions Too Many Open Files."""
    if exc is None:
        return False

    pending: list[BaseException] = [exc]
    seen: set[int] = set()

    while pending:
        current = pending.pop()
        marker = id(current)
        if marker in seen:
            continue
        seen.add(marker)

        if _is_open_file_exception(current):
            return True
        pending.extend(_related_exceptions(current))

    return False
