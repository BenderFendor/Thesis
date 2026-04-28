from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable, Collection, Iterable
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from urllib.parse import urljoin

from app.core.config import settings
from app.core.logging import get_logger
from app.core.process_limits import (
    exception_mentions_too_many_open_files,
    get_nofile_limits,
    get_open_file_descriptor_count,
)
from app.data.rss_sources import get_rss_sources
from app.models.news import NewsArticle
from app.services.async_utils import gather_limited
from app.services.cache import news_cache
from app.services.country_mentions import extract_article_mentioned_countries
from app.services.image_extraction import is_valid_image_url
from app.services.og_image import enrich_articles_with_og_images
from app.services.persistence import persist_articles_dual_write
from app.services.rss_parser_rust_bindings import parse_feeds_parallel
from app.services.websocket_manager import manager

logger = get_logger("rss_ingestion")

SourceStat = dict[str, Any]
SourceProgressCallback = Callable[[list[NewsArticle], SourceStat], None]

_shutdown_event: asyncio.Event | None = None
_process_pool: Any | None = None

DEFAULT_POLL_INTERVAL_SECONDS = 600
MIN_POLL_INTERVAL_SECONDS = 300
MAX_POLL_INTERVAL_SECONDS = 3600


def _log_fd_diagnostics(message: str, level: int = logging.INFO) -> None:
    soft_limit, hard_limit = get_nofile_limits()
    logger.log(
        level,
        "%s (open_fds=%s soft_nofile=%s hard_nofile=%s)",
        message,
        get_open_file_descriptor_count(),
        soft_limit,
        hard_limit,
    )


def _iter_source_urls(url_field: Any) -> Iterable[str]:
    if isinstance(url_field, str):
        yield url_field
    elif isinstance(url_field, (list, tuple)):
        for url in url_field:
            if isinstance(url, str):
                yield url


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_article_datetime(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    candidate = value.strip().replace("Z", "+00:00")
    if not candidate:
        return None
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _coerce_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _clamp_poll_interval(interval_seconds: int) -> int:
    return max(
        MIN_POLL_INTERVAL_SECONDS,
        min(MAX_POLL_INTERVAL_SECONDS, interval_seconds),
    )


def _get_source_activity_snapshot(
    source_name: str,
    articles: Collection[NewsArticle],
) -> tuple[int, float | None, str | None]:
    relevant_articles = list(articles) or news_cache.get_articles_for_source(
        source_name
    )
    if not relevant_articles:
        return 0, None, None

    now = _utc_now()
    recent_cutoff = now - timedelta(hours=24)
    published_times = [
        published_at
        for published_at in (
            _parse_article_datetime(article.published) for article in relevant_articles
        )
        if published_at is not None
    ]
    if not published_times:
        return 0, None, None

    freshest = max(published_times)
    recent_count = sum(
        1 for published_at in published_times if published_at >= recent_cutoff
    )
    freshest_age_hours = max(0.0, (now - freshest).total_seconds() / 3600)
    return recent_count, freshest_age_hours, freshest.isoformat()


def _next_poll_metadata(
    source_name: str,
    stat: SourceStat,
    articles: Collection[NewsArticle],
    *,
    base_interval_seconds: int = DEFAULT_POLL_INTERVAL_SECONDS,
) -> SourceStat:
    previous_stat = news_cache.get_source_stat(source_name) or {}
    previous_failures = _coerce_int(previous_stat.get("consecutive_failures"))
    previous_idle = _coerce_int(previous_stat.get("consecutive_idle_checks"))
    status = str(stat.get("status") or "pending")
    article_count = _coerce_int(stat.get("article_count"))
    recent_count, freshest_age_hours, freshest_published_at = (
        _get_source_activity_snapshot(
            source_name,
            articles,
        )
    )

    consecutive_failures = 0
    consecutive_idle_checks = 0
    reason = "scheduled_default"
    interval_seconds = _clamp_poll_interval(base_interval_seconds)

    if status == "error":
        consecutive_failures = previous_failures + 1
        interval_seconds = _clamp_poll_interval(
            base_interval_seconds * (2 ** min(consecutive_failures, 2))
        )
        reason = "error_backoff"
    elif status == "not_modified":
        consecutive_idle_checks = previous_idle + 1
        interval_seconds = _clamp_poll_interval(
            base_interval_seconds * min(consecutive_idle_checks + 1, 4)
        )
        reason = "not_modified_backoff"
    elif article_count <= 0:
        consecutive_idle_checks = previous_idle + 1
        interval_seconds = _clamp_poll_interval(
            base_interval_seconds * min(consecutive_idle_checks + 1, 3)
        )
        reason = "empty_feed_backoff"
    else:
        if recent_count >= 8 or (
            freshest_age_hours is not None and freshest_age_hours <= 2
        ):
            interval_seconds = MIN_POLL_INTERVAL_SECONDS
            reason = "high_activity"
        elif recent_count >= 3 or (
            freshest_age_hours is not None and freshest_age_hours <= 6
        ):
            interval_seconds = _clamp_poll_interval(base_interval_seconds)
            reason = "steady_activity"
        else:
            interval_seconds = _clamp_poll_interval(base_interval_seconds * 2)
            reason = "low_activity"

    next_check_at = (_utc_now() + timedelta(seconds=interval_seconds)).isoformat()
    stat["poll_interval_seconds"] = interval_seconds
    stat["next_check_at"] = next_check_at
    stat["adaptive_reason"] = reason
    stat["consecutive_failures"] = consecutive_failures
    stat["consecutive_idle_checks"] = consecutive_idle_checks
    stat["recent_publication_count_24h"] = recent_count
    stat["freshest_article_age_hours"] = freshest_age_hours
    stat["latest_article_published_at"] = freshest_published_at
    return stat


def _merge_partial_cache_update(
    updated_articles: List[NewsArticle],
    updated_source_stats: List[Dict[str, Any]],
) -> None:
    updated_names = {
        str(stat_name)
        for stat_name in (stat.get("name") for stat in updated_source_stats)
        if isinstance(stat_name, str) and stat_name
    }
    existing_articles = [
        article
        for article in news_cache.get_articles()
        if article.source not in updated_names
    ]
    merged_articles = existing_articles + updated_articles
    merged_articles.sort(key=lambda article: article.published, reverse=True)

    stats_by_name: Dict[str, Dict[str, object]] = {}
    for existing_stat in news_cache.get_source_stats():
        existing_name = existing_stat.get("name")
        if isinstance(existing_name, str) and existing_name:
            stats_by_name[existing_name] = existing_stat
    for updated_stat in updated_source_stats:
        updated_name = updated_stat.get("name")
        if isinstance(updated_name, str) and updated_name:
            stats_by_name[updated_name] = updated_stat

    news_cache.update_cache(merged_articles, list(stats_by_name.values()))


def _select_rss_sources(
    rss_sources: Dict[str, Dict[str, Any]],
    source_names: Collection[str] | None,
) -> Dict[str, Dict[str, Any]]:
    if source_names is None:
        return rss_sources
    selected = set(source_names)
    return {
        source_name: source_info
        for source_name, source_info in rss_sources.items()
        if source_name in selected
    }


def _normalize_article_image(image_url: str | None, article_url: str) -> str | None:
    if not image_url:
        return None
    if image_url.startswith("//"):
        image_url = f"https:{image_url}"
    elif not image_url.startswith(("http://", "https://")):
        try:
            image_url = urljoin(article_url, image_url)
        except Exception:
            return None
    return image_url if is_valid_image_url(image_url) else None


def _build_article_from_rust_payload(
    item: Dict[str, Any],
    source_name: str,
    source_info: Dict[str, Any],
) -> NewsArticle:
    link_value = str(item.get("link", ""))
    image_url = _normalize_article_image(item.get("image"), link_value)
    title = item.get("title", "No title")
    description = item.get("description", "No description")
    category = item.get("category") or source_info.get("category", "general")
    payload_authors = item.get("authors")
    authors = (
        [
            str(author).strip()
            for author in payload_authors
            if isinstance(author, str) and str(author).strip()
        ]
        if isinstance(payload_authors, list)
        else []
    )
    primary_author = authors[0] if authors else None
    return NewsArticle(
        title=title,
        link=link_value,
        description=description,
        published=item.get("published", datetime.now(timezone.utc).isoformat()),
        source=source_name,
        author=primary_author,
        authors=authors,
        category=category,
        country=source_info.get("country"),
        image=image_url,
        mentioned_countries=extract_article_mentioned_countries(
            title,
            description,
            description,
        ),
    )


def _process_source_with_debug(
    source_name: str, source_info: Dict[str, Any], stream_id: str
) -> tuple[list[NewsArticle], dict[str, Any]]:
    stream_start = time.time()
    result = parse_feeds_parallel(
        [(source_name, list(_iter_source_urls(source_info.get("url"))))],
        8,
    )
    articles_payload = result.get("articles", [])
    stats_payload = result.get("source_stats", {})
    articles = [
        _build_article_from_rust_payload(item, source_name, source_info)
        for item in articles_payload
        if isinstance(item, dict) and item.get("source") == source_name
    ]
    rust_stat = stats_payload.get(source_name, {})
    stat = {
        "name": source_name,
        "url": source_info.get("url"),
        "category": source_info.get("category", "general"),
        "country": source_info.get("country", "US"),
        "funding_type": source_info.get("funding_type"),
        "bias_rating": source_info.get("bias_rating"),
        "ownership_label": source_info.get("ownership_label"),
        "article_count": rust_stat.get("article_count", len(articles)),
        "status": rust_stat.get("status", "success"),
        "error_message": rust_stat.get("error_message"),
        "last_checked": datetime.now(timezone.utc).isoformat(),
        "is_consolidated": source_info.get("consolidate", False),
        "sub_feeds": rust_stat.get("sub_feeds"),
        "stream_id": stream_id,
        "processing_time_seconds": round(time.time() - stream_start, 2),
    }
    _next_poll_metadata(source_name, stat, articles)
    return articles, stat


async def refresh_news_cache_async(
    source_progress_callback: SourceProgressCallback | None = None,
    source_names: Collection[str] | None = None,
) -> None:
    if news_cache.update_in_progress:
        logger.info("Cache update already in progress, skipping...")
        return

    rss_sources = _select_rss_sources(get_rss_sources(), source_names)
    if source_names is not None and not rss_sources:
        logger.info("No RSS sources selected for refresh; skipping")
        return

    news_cache.update_in_progress = True
    global _shutdown_event
    _shutdown_event = asyncio.Event()
    _log_fd_diagnostics(
        f"Starting RSS refresh for {len(rss_sources)} sources",
        level=logging.INFO,
    )

    try:
        await _refresh_news_cache_with_rust(
            rss_sources,
            source_progress_callback,
            is_partial_refresh=(source_names is not None),
        )
    except Exception as exc:
        logger.error("Rust RSS ingestion failed: %s", exc, exc_info=True)
        if exception_mentions_too_many_open_files(exc):
            _log_fd_diagnostics(
                "Rust RSS ingestion hit open-file exhaustion",
                level=logging.ERROR,
            )
        raise
    finally:
        news_cache.update_in_progress = False


async def _refresh_news_cache_with_rust(
    rss_sources: Dict[str, Dict[str, Any]],
    source_progress_callback: SourceProgressCallback | None,
    *,
    is_partial_refresh: bool,
) -> None:
    logger.info("Using Rust RSS ingestion pipeline")

    sources_payload = [
        (name, list(_iter_source_urls(info.get("url"))))
        for name, info in rss_sources.items()
    ]

    if not sources_payload:
        logger.warning("No RSS sources configured; skipping refresh")
        news_cache.update_cache([], [])
        await _broadcast_cache_update(0, 0)
        return

    result = await asyncio.to_thread(
        parse_feeds_parallel,
        sources_payload,
        min(64, max(8, len(sources_payload) * 2)),
    )

    articles_payload: List[Dict[str, Any]] = result.get("articles", [])
    stats_payload: Dict[str, Dict[str, Any]] = result.get("source_stats", {})
    metrics_payload: Dict[str, Any] = result.get("metrics", {})

    articles_by_source: Dict[str, List[NewsArticle]] = {}
    for item in articles_payload:
        source_name = item.get("source") or "Unknown"
        source_info = rss_sources.get(source_name, {})
        article = _build_article_from_rust_payload(item, source_name, source_info)
        articles_by_source.setdefault(source_name, []).append(article)

    all_articles = [
        article
        for source_articles in articles_by_source.values()
        for article in source_articles
    ]

    if all_articles:
        await enrich_articles_with_og_images(all_articles)
        for name, articles in articles_by_source.items():
            total = len(articles)
            missing = sum(1 for article in articles if not article.image)
            logger.info(
                "Rust ingest image coverage for %s: %d/%d missing",
                name,
                missing,
                total,
            )

    for articles in articles_by_source.values():
        articles.sort(key=lambda article: article.published, reverse=True)

    source_stats: List[Dict[str, Any]] = []
    for name, source_info in rss_sources.items():
        rust_stat = stats_payload.get(name, {})
        stat = {
            "name": name,
            "url": source_info.get("url"),
            "category": source_info.get("category", "general"),
            "country": source_info.get("country", "US"),
            "funding_type": source_info.get("funding_type"),
            "bias_rating": source_info.get("bias_rating"),
            "ownership_label": source_info.get("ownership_label"),
            "article_count": rust_stat.get(
                "article_count", len(articles_by_source.get(name, []))
            ),
            "status": rust_stat.get("status", "success"),
            "error_message": rust_stat.get("error_message"),
            "last_checked": datetime.now(timezone.utc).isoformat(),
            "is_consolidated": source_info.get("consolidate", False),
            "sub_feeds": rust_stat.get("sub_feeds"),
        }
        _next_poll_metadata(name, stat, articles_by_source.get(name, []))
        source_stats.append(stat)
        if settings.enable_incremental_cache:
            replace_articles = stat.get("status") in {"success", "warning"}
            news_cache.update_source_cache(
                articles_by_source.get(name, []),
                stat,
                replace_articles=replace_articles,
            )
        if source_progress_callback is not None:
            try:
                source_progress_callback(articles_by_source.get(name, []), stat)
            except Exception as exc:
                logger.error("Progress callback error: %s", exc)

    loop = asyncio.get_running_loop()
    persist_tasks = []
    for name, articles in articles_by_source.items():
        source_info = rss_sources.get(name, {})
        persist_tasks.append(
            loop.run_in_executor(
                None,
                persist_articles_dual_write,
                articles,
                {**source_info, "name": name, "source": name},
            )
        )

    if persist_tasks:
        await gather_limited(
            persist_tasks,
            limit=max(2, min(8, len(persist_tasks))),
        )

    if settings.enable_incremental_cache:
        total_articles = len(news_cache.get_articles())
        total_sources = len(news_cache.get_source_stats())
        await _broadcast_cache_update(total_articles, total_sources)
    else:
        if is_partial_refresh:
            _merge_partial_cache_update(all_articles, source_stats)
            total_articles = len(news_cache.get_articles())
            total_sources = len(news_cache.get_source_stats())
        else:
            all_articles.sort(key=lambda article: article.published, reverse=True)

            news_cache.update_cache(all_articles, source_stats)
            total_articles = len(all_articles)
            total_sources = len(source_stats)
        await _broadcast_cache_update(total_articles, total_sources)

    logger.info(
        "Rust parser complete: %s articles (fetch=%sms, parse=%sms, total=%sms)",
        len(all_articles),
        metrics_payload.get("fetch_duration_ms", 0),
        metrics_payload.get("parse_duration_ms", 0),
        metrics_payload.get("total_duration_ms", 0),
    )


async def _broadcast_cache_update(total_articles: int, source_count: int) -> None:
    try:
        await manager.broadcast(
            {
                "type": "cache_updated",
                "message": "News cache has been updated",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stats": {
                    "total_articles": total_articles,
                    "sources_processed": source_count,
                },
            }
        )
    except Exception as exc:
        logger.error("Failed to notify clients via WebSocket: %s", exc)

    try:
        from app.api.routes.updates import broadcast_update

        asyncio.create_task(
            broadcast_update(
                "invalidate",
                {
                    "reason": "cache_refresh_complete",
                    "total_articles": total_articles,
                    "sources_processed": source_count,
                },
            )
        )
    except Exception as exc:
        logger.error("Failed to notify updates stream: %s", exc)


def refresh_news_cache(
    source_progress_callback: SourceProgressCallback | None = None,
) -> None:
    asyncio.run(
        refresh_news_cache_async(source_progress_callback=source_progress_callback)
    )


def start_cache_refresh_scheduler(interval_seconds: int = 600) -> None:
    def cache_scheduler() -> None:
        time.sleep(interval_seconds)
        while True:
            try:
                refresh_news_cache()
                time.sleep(interval_seconds)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.error("Error in cache scheduler: %s", exc)
                time.sleep(interval_seconds)

    thread = threading.Thread(target=cache_scheduler, daemon=True)
    thread.start()
    logger.info(
        "Cache refresh scheduler started (every %s s, delayed first run)",
        interval_seconds,
    )
