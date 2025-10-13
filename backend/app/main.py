from __future__ import annotations

import asyncio
import threading
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.database import init_db
from app.services.image_scraper import start_image_scraping_scheduler
from app.services.persistence import (
    article_persistence_worker,
    migrate_cached_articles_on_startup,
    set_main_event_loop,
)
from app.services.rss_ingestion import refresh_news_cache, start_cache_refresh_scheduler
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
            logger.error("Background task %s failed: %s", task.get_name(), exception, exc_info=True)

    task.add_done_callback(_cleanup)


def _start_schedulers_once() -> None:
    global _schedulers_started
    with _scheduler_lock:
        if _schedulers_started:
            return
        start_cache_refresh_scheduler()
        start_image_scraping_scheduler()
        _schedulers_started = True
        logger.info("Background schedulers initialised")


def _initial_cache_load() -> None:
    try:
        refresh_news_cache()
        logger.info("Initial cache population complete")
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Initial cache population failed: %s", exc, exc_info=True)


@app.on_event("startup")
async def on_startup() -> None:
    logger.info("Starting Global News Aggregation API...")

    loop = asyncio.get_running_loop()
    set_main_event_loop(loop)

    await init_db()
    logger.info("Database initialisation complete")

    _start_schedulers_once()

    threading.Thread(target=_initial_cache_load, name="initial-cache-load", daemon=True).start()

    persistence_task = asyncio.create_task(article_persistence_worker(), name="article_persistence_worker")
    _register_background_task(persistence_task)

    migration_task = asyncio.create_task(migrate_cached_articles_on_startup(), name="migrate_cached_articles")
    _register_background_task(migration_task)

    logger.info("API startup complete")


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
