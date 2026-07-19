from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

import pytest


def _rss_fixture(
    *, article_count: int = 8_000, source_count: int = 261
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    source_names = [f"Source {index:03d}" for index in range(source_count)]
    sources = {
        name: {
            "url": f"https://example.com/{index}/feed.xml",
            "category": "general",
            "country": "US",
        }
        for index, name in enumerate(source_names)
    }
    published = datetime(2026, 7, 19, 12, 0, tzinfo=UTC).isoformat()
    articles = [
        {
            "title": f"Article {index}",
            "link": f"https://example.com/articles/{index}",
            "description": "A short test article.",
            "published": published,
            "source": source_names[index % source_count],
        }
        for index in range(article_count)
    ]
    stats = {
        name: {
            "status": "success",
            "article_count": sum(1 for article in articles if article["source"] == name),
        }
        for name in source_names
    }
    return sources, {
        "articles": articles,
        "source_stats": stats,
        "metrics": {
            "fetch_duration_ms": 0,
            "parse_duration_ms": 0,
            "total_duration_ms": 0,
        },
    }


def test_adaptive_fetch_timeout_uses_slowest_success_plus_one_second() -> None:
    from app.services.rss_ingestion import _adaptive_fetch_timeout_ms

    prior_stats = [
        {
            "name": "Fast and slow",
            "sub_feeds": [
                {"status": "success", "fetch_duration_ms": 820},
                {"status": "success", "fetch_duration_ms": 4_100},
            ],
        },
        {
            "name": "Failed",
            "sub_feeds": [
                {"status": "error", "fetch_duration_ms": 24_900},
            ],
        },
    ]

    assert _adaptive_fetch_timeout_ms(prior_stats) == 5_100


def test_adaptive_fetch_timeout_has_safe_empty_and_upper_bounds() -> None:
    from app.services.rss_ingestion import _adaptive_fetch_timeout_ms

    assert _adaptive_fetch_timeout_ms([]) == 5_000
    assert (
        _adaptive_fetch_timeout_ms(
            [
                {
                    "sub_feeds": [
                        {"status": "success", "fetch_duration_ms": 29_000},
                    ]
                }
            ]
        )
        == 25_000
    )


@pytest.mark.asyncio
async def test_late_retry_uses_full_deadline_without_recursive_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rss_ingestion

    calls: list[dict[str, Any]] = []

    async def _capture_refresh(
        rss_sources: dict[str, dict[str, Any]],
        _callback: object,
        **options: Any,
    ) -> None:
        calls.append({"sources": rss_sources, **options})

    monkeypatch.setattr(rss_ingestion, "_refresh_news_cache_with_rust", _capture_refresh)
    rss_ingestion._schedule_late_source_retry(
        {"Slow Source": {"url": "https://example.com/feed.xml"}},
        None,
    )
    await asyncio.gather(*list(rss_ingestion._post_publish_tasks))

    assert calls == [
        {
            "sources": {"Slow Source": {"url": "https://example.com/feed.xml"}},
            "is_partial_refresh": True,
            "fetch_timeout_ms": 25_000,
            "schedule_timeout_retry": False,
            "refresh_phase": "late_retry",
        }
    ]


@pytest.mark.asyncio
async def test_full_refresh_publishes_8000_articles_before_image_enrichment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rss_ingestion
    from app.services.cache import NewsCache

    sources, parser_result = _rss_fixture()
    isolated_cache = NewsCache()
    requested_concurrency: list[int] = []
    requested_timeouts: list[int] = []
    image_work_started = asyncio.Event()
    allow_image_work_to_finish = asyncio.Event()

    async def _slow_image_enrichment(_articles: list[Any]) -> None:
        image_work_started.set()
        await allow_image_work_to_finish.wait()

    async def _ignore_broadcast(_article_count: int, _source_count: int) -> None:
        return None

    monkeypatch.setattr(rss_ingestion, "news_cache", isolated_cache)

    def _parse_all_feeds(_sources: object, max_concurrent: int, timeout_ms: int) -> dict[str, Any]:
        requested_concurrency.append(max_concurrent)
        requested_timeouts.append(timeout_ms)
        return parser_result

    monkeypatch.setattr(rss_ingestion, "parse_feeds_parallel", _parse_all_feeds)
    monkeypatch.setattr(rss_ingestion, "extract_article_mentioned_countries", lambda *_args: [])
    monkeypatch.setattr(rss_ingestion, "enrich_articles_with_og_images", _slow_image_enrichment)
    monkeypatch.setattr(rss_ingestion, "persist_articles_dual_write", lambda *_args: None)
    monkeypatch.setattr(rss_ingestion, "_broadcast_cache_update", _ignore_broadcast)
    monkeypatch.setattr(rss_ingestion, "save_polling_state", lambda _stats: None)
    monkeypatch.setattr(rss_ingestion, "load_polling_state", lambda: [])

    refresh = asyncio.create_task(
        rss_ingestion._refresh_news_cache_with_rust(
            sources,
            None,
            is_partial_refresh=False,
        )
    )
    try:
        await asyncio.wait_for(image_work_started.wait(), timeout=5)

        assert len(isolated_cache.get_articles()) == 8_000
        assert requested_concurrency == [261]
        assert requested_timeouts == [5_000]
        await asyncio.wait_for(refresh, timeout=5)
    finally:
        allow_image_work_to_finish.set()
        if not refresh.done():
            await asyncio.wait_for(refresh, timeout=10)
        if rss_ingestion._post_publish_tasks:
            await asyncio.gather(*list(rss_ingestion._post_publish_tasks))


@pytest.mark.asyncio
async def test_local_8000_article_publication_path_stays_under_ten_seconds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rss_ingestion
    from app.services.cache import NewsCache

    sources, parser_result = _rss_fixture()
    isolated_cache = NewsCache()

    async def _ignore_images(_articles: list[Any]) -> None:
        return None

    async def _ignore_broadcast(_article_count: int, _source_count: int) -> None:
        return None

    monkeypatch.setattr(rss_ingestion, "news_cache", isolated_cache)
    monkeypatch.setattr(rss_ingestion, "parse_feeds_parallel", lambda *_args: parser_result)
    monkeypatch.setattr(rss_ingestion, "extract_article_mentioned_countries", lambda *_args: [])
    monkeypatch.setattr(rss_ingestion, "enrich_articles_with_og_images", _ignore_images)
    monkeypatch.setattr(rss_ingestion, "persist_articles_dual_write", lambda *_args: None)
    monkeypatch.setattr(rss_ingestion, "_broadcast_cache_update", _ignore_broadcast)
    monkeypatch.setattr(rss_ingestion, "save_polling_state", lambda _stats: None)

    started = perf_counter()
    await rss_ingestion._refresh_news_cache_with_rust(
        sources,
        None,
        is_partial_refresh=False,
    )
    elapsed_seconds = perf_counter() - started

    assert len(isolated_cache.get_articles()) == 8_000
    assert isolated_cache.update_count == 1
    assert elapsed_seconds < 10
    if rss_ingestion._post_publish_tasks:
        await asyncio.gather(*list(rss_ingestion._post_publish_tasks))


@pytest.mark.asyncio
async def test_full_refresh_keeps_cached_articles_for_failed_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rss_ingestion
    from app.services.cache import NewsCache

    sources, parser_result = _rss_fixture(article_count=2, source_count=2)
    parser_result["articles"] = [
        article for article in parser_result["articles"] if article["source"] == "Source 001"
    ]
    parser_result["source_stats"]["Source 000"] = {
        "status": "error",
        "article_count": 0,
        "error_message": "upstream unavailable",
    }
    isolated_cache = NewsCache()
    monkeypatch.setattr(rss_ingestion, "extract_article_mentioned_countries", lambda *_args: [])
    cached_article = rss_ingestion._build_article_from_rust_payload(
        {
            "title": "Previously cached",
            "link": "https://example.com/articles/cached",
            "description": "Still visible during a source outage.",
            "published": datetime(2026, 7, 19, 11, 0, tzinfo=UTC).isoformat(),
        },
        "Source 000",
        sources["Source 000"],
    )
    isolated_cache.update_cache(
        [cached_article],
        [{"name": "Source 000", "status": "success", "article_count": 1}],
    )

    async def _ignore_images(_articles: list[Any]) -> None:
        return None

    async def _ignore_broadcast(_article_count: int, _source_count: int) -> None:
        return None

    monkeypatch.setattr(rss_ingestion, "news_cache", isolated_cache)
    monkeypatch.setattr(rss_ingestion, "parse_feeds_parallel", lambda *_args: parser_result)
    monkeypatch.setattr(rss_ingestion, "enrich_articles_with_og_images", _ignore_images)
    monkeypatch.setattr(rss_ingestion, "persist_articles_dual_write", lambda *_args: None)
    monkeypatch.setattr(rss_ingestion, "_broadcast_cache_update", _ignore_broadcast)
    monkeypatch.setattr(rss_ingestion, "save_polling_state", lambda _stats: None)

    await rss_ingestion._refresh_news_cache_with_rust(
        sources,
        None,
        is_partial_refresh=False,
    )

    links = {article.link for article in isolated_cache.get_articles()}
    assert links == {
        "https://example.com/articles/cached",
        "https://example.com/articles/1",
    }
    assert isolated_cache.update_count == 2
    if rss_ingestion._post_publish_tasks:
        await asyncio.gather(*list(rss_ingestion._post_publish_tasks))


@pytest.mark.asyncio
async def test_full_refresh_keeps_cached_articles_and_retries_timed_out_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rss_ingestion
    from app.services.cache import NewsCache

    sources, parser_result = _rss_fixture(article_count=2, source_count=2)
    parser_result["articles"] = [
        article for article in parser_result["articles"] if article["source"] == "Source 001"
    ]
    parser_result["source_stats"]["Source 000"] = {
        "status": "warning",
        "article_count": 0,
        "sub_feeds": [
            {
                "status": "error",
                "fetch_duration_ms": 5_001,
                "timed_out": True,
            }
        ],
    }
    parser_result["articles"].append(
        {
            "title": "Incomplete source article",
            "link": "https://example.com/articles/incomplete",
            "description": "This must wait for the complete source retry.",
            "published": datetime(2026, 7, 19, 12, 1, tzinfo=UTC).isoformat(),
            "source": "Source 000",
        }
    )
    isolated_cache = NewsCache()
    monkeypatch.setattr(rss_ingestion, "extract_article_mentioned_countries", lambda *_args: [])
    cached_article = rss_ingestion._build_article_from_rust_payload(
        {
            "title": "Previously cached",
            "link": "https://example.com/articles/cached",
            "description": "Still visible while the source retries.",
            "published": datetime(2026, 7, 19, 11, 0, tzinfo=UTC).isoformat(),
        },
        "Source 000",
        sources["Source 000"],
    )
    isolated_cache.update_cache(
        [cached_article],
        [{"name": "Source 000", "status": "success", "article_count": 1}],
    )
    retries: list[dict[str, dict[str, Any]]] = []

    async def _ignore_images(_articles: list[Any]) -> None:
        return None

    async def _ignore_broadcast(_article_count: int, _source_count: int) -> None:
        return None

    monkeypatch.setattr(rss_ingestion, "news_cache", isolated_cache)
    monkeypatch.setattr(rss_ingestion, "parse_feeds_parallel", lambda *_args: parser_result)
    monkeypatch.setattr(rss_ingestion, "enrich_articles_with_og_images", _ignore_images)
    monkeypatch.setattr(rss_ingestion, "persist_articles_dual_write", lambda *_args: None)
    monkeypatch.setattr(rss_ingestion, "_broadcast_cache_update", _ignore_broadcast)
    monkeypatch.setattr(rss_ingestion, "save_polling_state", lambda _stats: None)
    monkeypatch.setattr(
        rss_ingestion,
        "_schedule_late_source_retry",
        lambda retry_sources, _callback: retries.append(retry_sources),
    )

    await rss_ingestion._refresh_news_cache_with_rust(
        sources,
        None,
        is_partial_refresh=False,
    )

    links = {article.link for article in isolated_cache.get_articles()}
    assert links == {
        "https://example.com/articles/cached",
        "https://example.com/articles/1",
    }
    assert list(retries) == [{"Source 000": sources["Source 000"]}]
    if rss_ingestion._post_publish_tasks:
        await asyncio.gather(*list(rss_ingestion._post_publish_tasks))


@pytest.mark.asyncio
async def test_late_retry_merges_new_articles_after_primary_publication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import rss_ingestion
    from app.services.cache import NewsCache

    sources, primary_result = _rss_fixture(article_count=2, source_count=2)
    primary_result["articles"] = [
        article for article in primary_result["articles"] if article["source"] == "Source 001"
    ]
    primary_result["source_stats"]["Source 000"] = {
        "status": "warning",
        "article_count": 0,
        "sub_feeds": [{"status": "error", "timed_out": True}],
    }
    late_article = {
        "title": "Arrived on retry",
        "link": "https://example.com/articles/late",
        "description": "Fetched after the primary publication deadline.",
        "published": datetime(2026, 7, 19, 12, 1, tzinfo=UTC).isoformat(),
        "source": "Source 000",
    }
    retry_result = {
        "articles": [late_article],
        "source_stats": {
            "Source 000": {
                "status": "success",
                "article_count": 1,
                "sub_feeds": [{"status": "success", "timed_out": False}],
            }
        },
        "metrics": {},
    }
    parser_results = iter([primary_result, retry_result])
    isolated_cache = NewsCache()

    async def _ignore_async(*_args: object) -> None:
        return None

    monkeypatch.setattr(rss_ingestion, "news_cache", isolated_cache)
    monkeypatch.setattr(
        rss_ingestion,
        "settings",
        replace(rss_ingestion.settings, enable_incremental_cache=False),
    )
    monkeypatch.setattr(
        rss_ingestion,
        "parse_feeds_parallel",
        lambda *_args: next(parser_results),
    )
    monkeypatch.setattr(rss_ingestion, "extract_article_mentioned_countries", lambda *_args: [])
    monkeypatch.setattr(rss_ingestion, "enrich_articles_with_og_images", _ignore_async)
    monkeypatch.setattr(rss_ingestion, "persist_articles_dual_write", lambda *_args: None)
    monkeypatch.setattr(rss_ingestion, "_broadcast_cache_update", _ignore_async)
    monkeypatch.setattr(rss_ingestion, "save_polling_state", lambda _stats: None)
    monkeypatch.setattr(rss_ingestion, "load_polling_state", lambda: [])

    await rss_ingestion._refresh_news_cache_with_rust(
        sources,
        None,
        is_partial_refresh=False,
    )
    assert "https://example.com/articles/late" not in {
        article.link for article in isolated_cache.get_articles()
    }

    retry_tasks = [
        task
        for task in rss_ingestion._post_publish_tasks
        if task.get_coro().__name__ == "_refresh_news_cache_with_rust"
    ]
    assert len(retry_tasks) == 1
    await asyncio.gather(*retry_tasks)

    assert "https://example.com/articles/late" in {
        article.link for article in isolated_cache.get_articles()
    }
    if rss_ingestion._post_publish_tasks:
        await asyncio.gather(*list(rss_ingestion._post_publish_tasks))
