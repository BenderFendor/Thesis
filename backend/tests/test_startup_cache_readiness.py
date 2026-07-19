from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest


@pytest.mark.asyncio
async def test_startup_requests_complete_working_article_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main

    requested_limits: list[int] = []

    class _SessionContext:
        async def __aenter__(self) -> object:
            return object()

        async def __aexit__(self, *_args: Any) -> None:
            return None

    async def _fetch(_session: object, *, limit: int) -> list[dict[str, Any]]:
        requested_limits.append(limit)
        return []

    monkeypatch.setattr(
        main,
        "settings",
        replace(
            main.settings,
            enable_database=True,
            startup_cache_article_limit=10_000,
        ),
    )
    monkeypatch.setattr(main, "AsyncSessionLocal", lambda: _SessionContext())
    monkeypatch.setattr(main, "fetch_all_articles", _fetch)

    await main._load_cache_from_db_fast()

    assert requested_limits == [10_000]
