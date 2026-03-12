from __future__ import annotations

import errno
import logging
import os
import resource
from typing import Iterable


DEFAULT_SOFT_NOFILE_TARGET = int(os.getenv("TARGET_NOFILE_SOFT_LIMIT", "65535"))


def get_nofile_limits() -> tuple[int | None, int | None]:
    try:
        soft_limit, hard_limit = resource.getrlimit(resource.RLIMIT_NOFILE)
    except (AttributeError, OSError, ValueError):
        return None, None
    return int(soft_limit), int(hard_limit)


def get_open_file_descriptor_count() -> int | None:
    for fd_path in ("/proc/self/fd", "/dev/fd"):
        try:
            return len(os.listdir(fd_path))
        except OSError:
            continue
    return None


def raise_nofile_soft_limit(
    logger: logging.Logger,
    target_soft_limit: int = DEFAULT_SOFT_NOFILE_TARGET,
) -> tuple[int | None, int | None]:
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


def exception_mentions_too_many_open_files(exc: BaseException | None) -> bool:
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

        if getattr(current, "errno", None) == errno.EMFILE:
            return True

        message_parts: Iterable[object] = getattr(current, "args", ()) or (current,)
        message = " ".join(str(part) for part in message_parts if part is not None)
        if "too many open files" in message.lower():
            return True

        cause = current.__cause__
        context = current.__context__
        if cause is not None:
            pending.append(cause)
        if context is not None:
            pending.append(context)

    return False
