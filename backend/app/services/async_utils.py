from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Sequence
from typing import TypeVar

T = TypeVar("T")


async def gather_limited(
    awaitables: Sequence[Awaitable[T]],
    *,
    limit: int,
    return_exceptions: bool = False,
) -> list[T | BaseException]:
    capped_limit = max(1, limit)
    semaphore = asyncio.Semaphore(capped_limit)

    async def _run(awaitable: Awaitable[T]) -> T:
        async with semaphore:
            return await awaitable

    tasks = [asyncio.create_task(_run(awaitable)) for awaitable in awaitables]
    if not tasks:
        return []

    if return_exceptions:
        return list(await asyncio.gather(*tasks, return_exceptions=True))

    try:
        return list(await asyncio.gather(*tasks))
    except Exception:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
