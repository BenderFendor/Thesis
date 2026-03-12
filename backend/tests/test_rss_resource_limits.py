from __future__ import annotations

import pytest


def test_exception_mentions_too_many_open_files_detects_nested_causes() -> None:
    from app.core.process_limits import exception_mentions_too_many_open_files

    inner = OSError(24, "Too many open files")
    outer = RuntimeError("wrapper")
    outer.__cause__ = inner

    assert exception_mentions_too_many_open_files(outer) is True
    assert (
        exception_mentions_too_many_open_files(RuntimeError("different error")) is False
    )


@pytest.mark.asyncio
async def test_refresh_news_cache_async_skips_python_fallback_on_emfile(
    monkeypatch,
) -> None:
    from app.services import rss_ingestion

    monkeypatch.setattr(
        rss_ingestion,
        "get_rss_sources",
        lambda: {"Example": {"url": "https://example.com/feed.xml"}},
    )
    monkeypatch.setattr(rss_ingestion, "RUST_RSS_AVAILABLE", True)

    async def _raise_emfile(*args, **kwargs) -> None:
        raise RuntimeError("Failed to start Tokio runtime: Too many open files")

    python_called = False

    async def _python_fallback(*args, **kwargs) -> None:
        nonlocal python_called
        python_called = True

    monkeypatch.setattr(rss_ingestion, "_refresh_news_cache_with_rust", _raise_emfile)
    monkeypatch.setattr(
        rss_ingestion,
        "_refresh_news_cache_with_python",
        _python_fallback,
    )

    rss_ingestion.news_cache.update_in_progress = False

    with pytest.raises(RuntimeError, match="Too many open files"):
        await rss_ingestion.refresh_news_cache_async()

    assert python_called is False
    assert rss_ingestion.news_cache.update_in_progress is False
