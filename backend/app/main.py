from __future__ import annotations

import asyncio
import signal
import threading
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.database import init_db, AsyncSessionLocal, fetch_all_articles
from app.middleware.request_tracing import RequestTracingMiddleware
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.persistence import (
    article_persistence_worker,
    embedding_generation_worker,
    migrate_cached_articles_on_startup,
    set_main_event_loop,
)
from app.services.rss_ingestion import (
    refresh_news_cache_async,
    start_cache_refresh_scheduler,
    _shutdown_event,
    _process_pool,
)
from app.services.scheduler import periodic_rss_refresh
from app.services.startup_metrics import startup_metrics
from app.services.websocket_manager import manager

configure_logging()
logger = get_logger("app.main")

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="A comprehensive news aggregation platform providing diverse global perspectives",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add request tracing middleware for debugging
app.add_middleware(RequestTracingMiddleware)

app.include_router(api_router)

_background_tasks: list[asyncio.Task[Any]] = []
_scheduler_lock = threading.Lock()
_schedulers_started = False


def _register_background_task(task: asyncio.Task[Any]) -> None:
    _background_tasks.append(task)

    def _cleanup(future: asyncio.Future[Any]) -> None:
        try:
            _background_tasks.remove(task)
        except ValueError:
            pass

        if future.cancelled():
            return

        exception = future.exception()
        if exception:
            logger.error(
                "Background task %s failed: %s",
                task.get_name(),
                exception,
                exc_info=True,
            )

    task.add_done_callback(_cleanup)


def _handle_shutdown_signal(signum, frame) -> None:
    """Handle SIGTERM/SIGINT for graceful shutdown."""
    logger.info("Received shutdown signal %s", signum)

    if _shutdown_event:
        _shutdown_event.set()

    if _process_pool:
        logger.info("Shutting down process pool...")
        _process_pool.shutdown(wait=True, cancel_futures=True)

    logger.info("Shutdown complete")


def _start_schedulers_once() -> None:
    global _schedulers_started
    with _scheduler_lock:
        if _schedulers_started:
            return
        start_cache_refresh_scheduler()
        _schedulers_started = True
        logger.info("Background schedulers initialised")


async def _load_cache_from_db_fast() -> None:
    """Fast path: Load small batch from DB on startup for instant readiness."""
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Skipping DB cache warmup; ENABLE_DATABASE=0")
        return

    logger.info("Attempting to load articles from database...")
    try:
        async with AsyncSessionLocal() as session:
            # Load small batch (500) for fast perceived startup
            articles_dicts = await fetch_all_articles(session, limit=500)
            if articles_dicts:
                # Convert dictionaries back to NewsArticle Pydantic models
                articles = [
                    NewsArticle(**article_dict) for article_dict in articles_dicts
                ]
                # Create minimal stats - will be updated by background RSS refresh
                stats = {"loaded_from_db": len(articles), "sources": {}}
                news_cache.update_cache(articles, stats)
                logger.info(
                    "Loaded %d articles from database into cache.", len(articles)
                )
                return
            else:
                logger.info("No articles in DB; async refresh will populate cache.")
    except Exception as e:
        logger.error("Failed to load from DB: %s. Async refresh will handle.", e)


async def _initial_cache_load() -> None:
    """Initialize cache on startup using fast DB load path."""
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Initial cache load disabled (database unavailable)")
        return

    load_start = time.time()
    metadata: dict[str, Any] = {}
    detail = "completed"
    try:
        logger.info("Starting initial cache load...")
        await _load_cache_from_db_fast()
        logger.info("Initial cache population complete")
        metadata["result"] = "loaded"
        metadata["cache_size"] = len(news_cache.get_articles())
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Initial cache population failed: %s", exc, exc_info=True)
        metadata["result"] = "error"
        metadata["error"] = str(exc)
        detail = "error"
    finally:
        startup_metrics.record_event(
            "cache_preload_from_db",
            load_start,
            detail=detail,
            metadata=metadata,
        )


def _parse_published_at(article: NewsArticle) -> datetime:
    try:
        published = article.published.replace("Z", "+00:00")
        return datetime.fromisoformat(published)
    except Exception:
        return datetime.now(timezone.utc)


async def _start_initial_rss_refresh() -> None:
    await asyncio.sleep(2)
    refresh_start = time.time()
    logger.info("Starting initial async RSS refresh...")
    try:
        await refresh_news_cache_async()
        duration = time.time() - refresh_start
        logger.info("Initial async RSS refresh complete (%.2fs)", duration)
        startup_metrics.record_event(
            "initial_rss_refresh",
            refresh_start,
            metadata={"cache_size": len(news_cache.get_articles())},
        )
    except Exception as exc:  # pragma: no cover
        logger.error("Background RSS refresh failed: %s", exc, exc_info=True)
        startup_metrics.add_note("initial_rss_refresh_error", str(exc))


async def _maybe_migrate_cached_articles() -> None:
    await asyncio.sleep(3)
    articles = news_cache.get_articles()
    if not articles:
        logger.info("Cache empty, skipping migration")
        startup_metrics.add_note("cache_preload_articles", 0)
        return

    try:
        oldest = min(articles, key=_parse_published_at)
        oldest_dt = _parse_published_at(oldest)
        age_hours = (datetime.now(timezone.utc) - oldest_dt).total_seconds() / 3600
        if age_hours > 6:
            logger.info(
                "Cache has stale articles (%.1fh old), starting migration...",
                age_hours,
            )
            migration_start = time.time()
            await migrate_cached_articles_on_startup()
            startup_metrics.record_event(
                "cached_article_migration",
                migration_start,
                metadata={
                    "article_count": len(articles),
                    "oldest_article_hours": age_hours,
                },
            )
        else:
            logger.info("Cache is fresh (%.1fh old), skipping migration", age_hours)
            startup_metrics.add_note(
                "cache_freshness_hours",
                round(age_hours, 2),
            )
    except Exception as exc:
        logger.warning("Could not determine cache age: %s; skipping migration", exc)
        startup_metrics.add_note("cache_age_error", str(exc))


@app.on_event("startup")
async def on_startup() -> None:

    startup_start = time.time()
    startup_metrics.mark_app_started()
    startup_metrics.add_note(
        "app_version",
        {
            "version": settings.app_version,
            "title": settings.app_title,
        },
    )
    logger.info("Starting Global News Aggregation API...")

    loop = asyncio.get_running_loop()
    set_main_event_loop(loop)

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, _handle_shutdown_signal)
    signal.signal(signal.SIGINT, _handle_shutdown_signal)

    if settings.enable_database:
        db_start = time.time()
        await init_db()
        logger.info(
            "Database initialisation complete (%.2fs)", time.time() - db_start
        )
        startup_metrics.record_event("database_initialised", db_start)
    else:
        logger.info("Database disabled; skipping initialisation and persistence")
        startup_metrics.add_note("database_disabled", True)

    _start_schedulers_once()
    startup_metrics.add_note("schedulers_started_at", time.time())

    if settings.enable_database and AsyncSessionLocal is not None:
        cache_preload_task = asyncio.create_task(
            _initial_cache_load(), name="initial_cache_load"
        )
        _register_background_task(cache_preload_task)
        startup_metrics.add_note("cache_preload_task", cache_preload_task.get_name())

    # Start async RSS refresh scheduler (delayed first run)
    scheduler_task = asyncio.create_task(
        periodic_rss_refresh(interval_seconds=600), name="rss_refresh_scheduler"
    )
    _register_background_task(scheduler_task)
    startup_metrics.add_note("rss_scheduler_task", scheduler_task.get_name())

    refresh_task = asyncio.create_task(_start_initial_rss_refresh(), name="initial_rss_refresh")
    _register_background_task(refresh_task)

    if settings.enable_database:
        persistence_task = asyncio.create_task(
            article_persistence_worker(), name="article_persistence_worker"
        )
        _register_background_task(persistence_task)
        if settings.enable_vector_store:
            embedding_task = asyncio.create_task(
                embedding_generation_worker(), name="embedding_generation_worker"
            )
            _register_background_task(embedding_task)

    # Only migrate if cache has stale articles (> 6 hours old)
    if settings.enable_database:
        migration_task = asyncio.create_task(
            _maybe_migrate_cached_articles(), name="conditional_migration"
        )
        _register_background_task(migration_task)

    logger.info(
        "API startup complete (%.2fs) - cache ready with %d articles",
        time.time() - startup_start,
        len(news_cache.get_articles()),
    )
    startup_metrics.mark_app_completed()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    logger.info("Shutting down Global News Aggregation API...")

    tasks_snapshot = list(_background_tasks)
    for task in tasks_snapshot:
        task.cancel()

    if tasks_snapshot:
        await asyncio.gather(*tasks_snapshot, return_exceptions=True)

    logger.info("Shutdown complete")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("WebSocket connection error: %s", exc, exc_info=True)
        manager.disconnect(websocket)
