"""Server-sent news stream endpoint."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import random
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.debug_logger import (
    EventType,
    debug_logger,
    end_stream,
    log_stream_event,
    start_stream,
)
from app.services.rss_ingestion import _process_source_with_debug  # noqa: PLC2701
from app.services.stream_manager import stream_manager

router = APIRouter(prefix="/news", tags=["news-stream"])
stream_logger = get_logger("news_stream")


@dataclass(slots=True)
class _CacheSnapshot:
    articles: list[NewsArticle] = field(default_factory=list)
    source_stats: list[dict[str, object]] = field(default_factory=list)
    age_seconds: float | None = None


@dataclass(slots=True)
class _FreshAggregate:
    articles: list[NewsArticle] = field(default_factory=list)
    source_stats: list[dict[str, object]] = field(default_factory=list)
    completed: int = 0


@dataclass(slots=True)
class _StreamContext:
    stream_id: str
    request: Request
    category: str | None
    use_cache: bool
    started_at: float = field(default_factory=time.time)

    def event(self, event_name: str, payload: Mapping[str, object]) -> str:
        encode_start = time.perf_counter()
        encoded = f"data: {json.dumps(payload)}\n\n"
        log_stream_event(
            self.stream_id,
            "sse_emit",
            details={
                "event_name": event_name,
                "encode_ms": round((time.perf_counter() - encode_start) * 1000, 3),
                "payload_bytes": len(encoded),
            },
        )
        return encoded


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _progress(completed: int, total: int) -> dict[str, int | float]:
    percentage = round((completed / total) * 100, 1) if total else 100
    return {"completed": completed, "total": total, "percentage": percentage}


def _stream_id() -> str:
    return f"stream_{int(time.time())}_{random.randint(1000, 9999)}"


def _start_trace(context: _StreamContext) -> None:
    request_id = getattr(context.request.state, "request_id", None)
    start_stream(context.stream_id, request_id)
    debug_logger.log_event(
        EventType.STREAM_START,
        component="stream",
        operation="initialize",
        message=f"Stream {context.stream_id} initialization",
        stream_id=context.stream_id,
        request_id=request_id,
        category=context.category,
        details={
            "use_cache": context.use_cache,
            "category": context.category,
            "user_agent": context.request.headers.get("User-Agent", "unknown")[:100],
        },
    )


def _error_response(message: str) -> StreamingResponse:
    async def emit() -> AsyncIterator[str]:
        yield f"data: {json.dumps({'status': 'error', 'message': message})}\n\n"

    return StreamingResponse(emit(), media_type="text/event-stream")


def _filtered_articles(
    articles: list[NewsArticle], category: str | None
) -> list[NewsArticle]:
    if not category:
        return articles
    return [article for article in articles if article.category == category]


def _load_cache(context: _StreamContext) -> _CacheSnapshot:
    started = time.time()
    articles = news_cache.get_articles()
    stats = news_cache.get_source_stats()
    age = (datetime.now(UTC) - news_cache.last_updated).total_seconds()
    articles = _filtered_articles(articles, context.category)
    debug_logger.log_cache_operation(
        operation="read",
        hit=bool(articles),
        article_count=len(articles),
        cache_age_seconds=age,
        details={
            "load_duration_ms": (time.time() - started) * 1000,
            "source_stats_count": len(stats),
        },
    )
    return _CacheSnapshot(articles=articles, source_stats=stats, age_seconds=age)


def _cache_snapshot(context: _StreamContext) -> _CacheSnapshot:
    try:
        snapshot = _load_cache(context)
        stream_logger.info(
            "Stream %s found %s cached articles (age: %.1fs)",
            context.stream_id,
            len(snapshot.articles),
            snapshot.age_seconds or 0,
        )
        return snapshot
    except Exception as exc:
        stream_logger.warning("Stream %s couldn't load cache: %s", context.stream_id, exc)
        debug_logger.log_event(
            EventType.CACHE_MISS,
            component="cache",
            operation="read_error",
            message=f"Cache read failed: {exc}",
            stream_id=context.stream_id,
            error=exc,
        )
        return _CacheSnapshot()


def _initial_cache_payload(
    context: _StreamContext, snapshot: _CacheSnapshot
) -> dict[str, object]:
    return {
        "status": "initial",
        "stream_id": context.stream_id,
        "articles": [article.dict() for article in snapshot.articles],
        "source_stats": snapshot.source_stats,
        "cache_age_seconds": snapshot.age_seconds,
        "message": f"Loaded {len(snapshot.articles)} cached articles instantly",
        "timestamp": _timestamp(),
    }


def _starting_payload(context: _StreamContext) -> dict[str, object]:
    return {
        "status": "starting",
        "stream_id": context.stream_id,
        "message": f"Initializing news stream (use_cache={context.use_cache})...",
        "timestamp": _timestamp(),
        "active_streams": stream_manager.get_active_stream_count(),
    }


def _cache_is_fresh(context: _StreamContext, snapshot: _CacheSnapshot) -> bool:
    return bool(
        context.use_cache
        and snapshot.age_seconds is not None
        and snapshot.age_seconds < 120
        and snapshot.articles
    )


def _cache_complete_payload(
    context: _StreamContext, snapshot: _CacheSnapshot
) -> dict[str, object]:
    return {
        "status": "complete",
        "stream_id": context.stream_id,
        "message": "Used fresh cached data",
        "cache_age_seconds": snapshot.age_seconds,
        "timestamp": _timestamp(),
    }


def _sources_to_process(category: str | None) -> list[tuple[str, dict[str, object]]]:
    sources = list(get_rss_sources().items())
    if not category:
        return sources
    return [(name, info) for name, info in sources if info.get("category") == category]


async def _process_source(
    context: _StreamContext,
    loop: asyncio.AbstractEventLoop,
    executor: concurrent.futures.ThreadPoolExecutor,
    name: str,
    info: dict[str, object],
) -> tuple[str, list[NewsArticle], dict[str, Any], float]:
    should_throttle, wait_time = stream_manager.should_throttle_source(name)
    if should_throttle:
        stream_logger.info(
            "Stream %s throttling source %s for %.1fs",
            context.stream_id,
            name,
            wait_time,
        )
        await asyncio.sleep(wait_time)
    started = time.time()
    articles, source_stat = await loop.run_in_executor(
        executor,
        _process_source_with_debug,
        name,
        info,
        context.stream_id,
    )
    return name, articles, source_stat, (time.time() - started) * 1000


def _source_complete_payload(
    context: _StreamContext,
    source_name: str,
    articles: list[NewsArticle],
    source_stat: dict[str, Any],
    completed: int,
    total: int,
) -> dict[str, object]:
    return {
        "status": "source_complete",
        "stream_id": context.stream_id,
        "source": source_name,
        "articles": [article.dict() for article in articles[:20]],
        "source_stat": source_stat,
        "progress": _progress(completed, total),
        "timestamp": _timestamp(),
    }


def _source_error_payload(
    context: _StreamContext,
    source_name: str,
    error: Exception,
    completed: int,
    total: int,
) -> dict[str, object]:
    return {
        "status": "source_error",
        "stream_id": context.stream_id,
        "source": source_name,
        "error": str(error),
        "progress": _progress(completed, total),
        "timestamp": _timestamp(),
    }


def _record_source_success(
    context: _StreamContext,
    aggregate: _FreshAggregate,
    source_name: str,
    articles: list[NewsArticle],
    source_stat: dict[str, Any],
    duration_ms: float,
    total: int,
) -> None:
    aggregate.completed += 1
    aggregate.articles.extend(articles)
    aggregate.source_stats.append(source_stat)
    stream_manager.update_stream(
        context.stream_id,
        sources_completed=aggregate.completed,
        status="processing",
    )
    log_stream_event(
        context.stream_id,
        "source_complete",
        source_name=source_name,
        article_count=len(articles),
        details={
            "duration_ms": duration_ms,
            "source_status": source_stat.get("status"),
            "progress": f"{aggregate.completed}/{total}",
        },
    )


def _record_source_error(
    context: _StreamContext,
    aggregate: _FreshAggregate,
    source_name: str,
    error: Exception,
) -> None:
    aggregate.completed += 1
    stream_logger.error("Stream %s error for %s: %s", context.stream_id, source_name, error)
    debug_logger.log_rss_operation(
        operation="fetch",
        source_name=source_name,
        success=False,
        error=error,
        details={"stream_id": context.stream_id},
    )


def _cancel_pending(tasks: list[asyncio.Task[Any]]) -> None:
    for task in tasks:
        if not task.done():
            task.cancel()


async def _fresh_events(
    context: _StreamContext,
    sources: list[tuple[str, dict[str, object]]],
) -> AsyncIterator[str]:
    total = len(sources)
    aggregate = _FreshAggregate()
    loop = asyncio.get_running_loop()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=5)
    tasks = [
        asyncio.create_task(_process_source(context, loop, executor, name, info), name=name)
        for name, info in sources
    ]
    try:
        for task in asyncio.as_completed(tasks):
            if await context.request.is_disconnected():
                stream_manager.update_stream(context.stream_id, client_connected=False)
                end_stream(context.stream_id, reason="client_disconnect")
                _cancel_pending(tasks)
                break
            try:
                source_name, articles, source_stat, duration_ms = await task
                _record_source_success(
                    context,
                    aggregate,
                    source_name,
                    articles,
                    source_stat,
                    duration_ms,
                    total,
                )
                yield context.event(
                    "source_complete",
                    _source_complete_payload(
                        context,
                        source_name,
                        articles,
                        source_stat,
                        aggregate.completed,
                        total,
                    ),
                )
            except Exception as exc:  # pragma: no cover - defensive stream boundary
                source_name = task.get_name() if isinstance(task, asyncio.Task) else "unknown"
                _record_source_error(context, aggregate, source_name, exc)
                yield context.event(
                    "source_error",
                    _source_error_payload(
                        context, source_name, exc, aggregate.completed, total
                    ),
                )
        yield context.event("complete", _fresh_complete_payload(context, aggregate, total))
        end_stream(context.stream_id, reason="complete")
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _safe_sort_articles(articles: list[NewsArticle], stream_id: str) -> None:
    try:
        articles.sort(key=lambda article: article.published, reverse=True)
    except Exception as exc:  # pragma: no cover - defensive logging
        stream_logger.warning("Stream %s couldn't sort articles: %s", stream_id, exc)


def _fresh_complete_payload(
    context: _StreamContext, aggregate: _FreshAggregate, total_sources: int
) -> dict[str, object]:
    _safe_sort_articles(aggregate.articles, context.stream_id)
    duration_ms = (time.time() - context.started_at) * 1000
    successful = sum(stat.get("status") == "success" for stat in aggregate.source_stats)
    failed = sum(stat.get("status") == "error" for stat in aggregate.source_stats)
    return {
        "status": "complete",
        "stream_id": context.stream_id,
        "message": (
            f"Successfully loaded {len(aggregate.articles)} articles "
            f"from {len(aggregate.source_stats)} sources"
        ),
        "total_articles": len(aggregate.articles),
        "successful_sources": successful,
        "failed_sources": failed,
        "progress": _progress(total_sources, total_sources),
        "duration_ms": duration_ms,
        "timestamp": _timestamp(),
    }


async def _event_generator(context: _StreamContext) -> AsyncIterator[str]:
    try:
        snapshot = _cache_snapshot(context)
        if snapshot.articles:
            yield context.event("initial", _initial_cache_payload(context, snapshot))
            log_stream_event(
                context.stream_id,
                "initial_cache_emit",
                article_count=len(snapshot.articles),
                details={
                    "cache_age_seconds": snapshot.age_seconds,
                    "category_filter": context.category,
                },
            )
        yield context.event("starting", _starting_payload(context))
        if _cache_is_fresh(context, snapshot):
            yield context.event("complete", _cache_complete_payload(context, snapshot))
            end_stream(context.stream_id, reason="complete_cached")
            return

        stream_manager.update_stream(context.stream_id, status="fetching_fresh")
        sources = _sources_to_process(context.category)
        stream_manager.update_stream(context.stream_id, total_sources=len(sources))
        async for event in _fresh_events(context, sources):
            yield event
    except asyncio.CancelledError:  # pragma: no cover - cooperative cancellation
        end_stream(context.stream_id, reason="cancelled")
        raise
    except Exception as exc:  # pragma: no cover - defensive stream boundary
        stream_logger.error("Stream %s unexpected error: %s", context.stream_id, exc)
        end_stream(context.stream_id, reason="error", error=exc)
        yield context.event(
            "error",
            {
                "status": "error",
                "stream_id": context.stream_id,
                "error": str(exc),
                "timestamp": _timestamp(),
            },
        )
    finally:
        stream_manager.unregister_stream(context.stream_id)


@router.get("/stream")
async def stream_news(
    request: Request,
    use_cache: bool = True,
    category: str | None = None,
) -> StreamingResponse:
    """Stream cached news immediately, then source-by-source fresh updates."""
    context = _StreamContext(_stream_id(), request, category, use_cache)
    stream_logger.info("NEWS REQUEST: %s, use_cache=%s", context.stream_id, use_cache)
    _start_trace(context)

    active_count = stream_manager.get_active_stream_count()
    if active_count >= 5:
        end_stream(context.stream_id, reason="rejected_too_many_streams")
        return _error_response(
            f"Too many active streams ({active_count}). Please try again later."
        )

    stream_manager.register_stream(context.stream_id)
    stream_manager.update_stream(context.stream_id, status="starting")
    return StreamingResponse(
        _event_generator(context),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Stream-ID": context.stream_id,
        },
    )
