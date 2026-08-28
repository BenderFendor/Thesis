"""FastAPI application entry point.

Orchestrates startup/shutdown lifecycle, including leader election via
file-based lock, cache preloading, background RSS ingestion scheduling,
article persistence workers, vector store sync, and credibility scoring.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import signal
import time
from datetime import datetime, UTC
from pathlib import Path
from types import FrameType
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import router as api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger, log_progress
from app.core.process_limits import (
    get_nofile_limits,
    get_open_file_descriptor_count,
    raise_nofile_soft_limit,
)
from app.core.profiling import ProfilingMiddleware
from app.database import init_db, AsyncSessionLocal, fetch_all_articles
from app.middleware.request_tracing import RequestTracingMiddleware
from app.openapi_contract import add_protocol_extensions
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.chroma_sync import chroma_sync_worker
from app.services.chroma_topics import cluster_computation_worker
from app.services.persistence import (
    article_persistence_worker,
    embedding_generation_worker,
    migrate_cached_articles_on_startup,
    set_main_event_loop,
)
from app.services.rss_ingestion import (
    refresh_news_cache_async,
    _shutdown_event,
    _process_pool,
    apply_saved_polling_state,
)
from app.services.scheduler import (
    periodic_rss_refresh,
    periodic_blind_spots_update,
)
from app.services.wiki_indexer import periodic_wiki_refresh
from app.services.auto_ingest import run_auto_ingest
from app.services.source_credibility import run_credibility_scoring_scheduler
from app.services.gdelt_query import get_gdelt_query_service
from app.services.startup_metrics import startup_metrics
from app.services.websocket_manager import manager
from app.core.tracing import setup_tracing

configure_logging()
logger = get_logger("app.main")

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="A comprehensive news aggregation platform providing diverse global perspectives",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_origin_regex=settings.frontend_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add request tracing middleware for debugging
app.add_middleware(RequestTracingMiddleware)

# Add profiling middleware for performance metrics
app.add_middleware(ProfilingMiddleware)

# Add GZip compression for responses over 1KB
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(api_router)

setup_tracing(app)

if settings.otel_enabled:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request as _StarletteRequest
    from starlette.responses import Response as _StarletteResponse

    class _TraceIdResponseMiddleware(BaseHTTPMiddleware):
        async def dispatch(
            self,
            request: _StarletteRequest,
            call_next: Any,
        ) -> _StarletteResponse:
            """Inject OpenTelemetry trace identifiers into every HTTP response."""
            response = await call_next(request)
            try:
                from opentelemetry.trace import (
                    format_span_id,
                    format_trace_id,
                )
                from opentelemetry.trace import (
                    get_current_span as _otel_get_span,
                )

                span_context = _otel_get_span().get_span_context()
                if span_context.trace_id:
                    response.headers["X-Trace-Id"] = format_trace_id(span_context.trace_id)
                    response.headers["X-Span-Id"] = format_span_id(span_context.span_id)
            except Exception:
                pass
            return cast(Response, response)

    app.add_middleware(_TraceIdResponseMiddleware)
    logger.info("OpenTelemetry trace-id response middleware enabled")

_background_tasks: list[asyncio.Task[Any]] = []
_leader_lock_file: str | None = None  # Set only in the leader worker


def _startup_leader_lock_path() -> Path:
    """Return a lock shared by workers of this server, not unrelated servers."""
    repository = Path(__file__).resolve().parents[2]
    bind = (
        os.getenv("SCOOP_RUNTIME_INSTANCE")
        or os.getenv("GUNICORN_BIND")
        or os.getenv("BACKEND_PORT")
        or os.getenv("PORT")
        or "127.0.0.1:8000"
    )
    identity = hashlib.sha256(f"{repository}\0{bind}".encode()).hexdigest()[:20]
    return Path("/tmp/thesis_startup_lock") / identity / "leader.lock"


def _register_background_task(task: asyncio.Task[Any]) -> None:
    _background_tasks.append(task)

    def _cleanup(future: asyncio.Future[Any]) -> None:
        with contextlib.suppress(ValueError):
            _background_tasks.remove(task)

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


def _handle_shutdown_signal(signum: int, _frame: FrameType | None) -> None:
    """Handle SIGTERM/SIGINT for graceful shutdown."""
    logger.info("Received shutdown signal %s", signum)

    if _shutdown_event:
        _shutdown_event.set()

    if _process_pool:
        logger.info("Shutting down process pool...")
        _process_pool.shutdown(wait=True, cancel_futures=True)

    logger.info("Shutdown complete")


async def _load_cache_from_db_fast() -> None:
    """Load the complete working article set from the DB before network refresh."""
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Skipping DB cache warmup; ENABLE_DATABASE=0")
        return

    assert AsyncSessionLocal is not None
    session_factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)

    logger.info("Attempting to load articles from database...")
    try:
        async with session_factory() as session:
            articles_dicts = await fetch_all_articles(
                session,
                limit=settings.startup_cache_article_limit,
            )
            if articles_dicts:
                normalized_articles = []
                for article_dict in articles_dicts:
                    payload = article_dict
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    if not isinstance(payload, dict):
                        logger.warning(
                            "Skipping cached article with unexpected payload type: %s",
                            type(payload),
                        )
                        continue
                    normalized_articles.append(payload)

                # Convert dictionaries back to NewsArticle Pydantic models
                articles = [NewsArticle(**article_dict) for article_dict in normalized_articles]
                # Create minimal stats - will be updated by background RSS refresh
                stats = [
                    {
                        "name": "database",
                        "status": "success",
                        "article_count": len(articles),
                        "loaded_from_db": True,
                    }
                ]
                news_cache.update_cache(articles, stats)
                log_progress(
                    logger,
                    "Startup cache ready: %d articles loaded from database",
                    len(articles),
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
        parsed = datetime.fromisoformat(published)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed
    except Exception:
        return datetime.now(UTC)


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
        age_hours = (datetime.now(UTC) - oldest_dt).total_seconds() / 3600
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


async def _start_auto_ingest() -> None:
    """Launch the Atlas auto-ingest pipelines shortly after startup (leader only).

    `run_auto_ingest` itself checks SCOOP_AUTO_INGEST and never raises --
    see app.services.auto_ingest for the stage registry and interval guard.
    """
    await asyncio.sleep(10)
    await run_auto_ingest()


async def _initial_reporter_index() -> None:
    """Run initial reporter seeding on startup (non-blocking, best-effort)."""
    import time as time_mod

    from app.core.logging import get_logger

    _logger = get_logger("main")

    await asyncio.sleep(120)
    _logger.info("Initial reporter index starting...")

    start = time_mod.time()
    try:
        from app.services.reporter_indexer import (
            index_unresolved_reporters,
            seed_reporters_from_wikidata,
        )

        _logger.info("Phase 1/2: Wikidata SPARQL reporter seed...")
        sparql_result = await seed_reporters_from_wikidata()
        _logger.info(
            "SPARQL seed: %d total, %d resolved, %d failed",
            sparql_result.get("total", 0),
            sparql_result.get("resolved", 0),
            sparql_result.get("failed", 0),
        )

        _logger.info("Phase 2/2: Unresolved article author indexing...")
        author_result = await index_unresolved_reporters(limit=100)
        _logger.info(
            "Author index: %d total, %d resolved, %d failed",
            author_result.get("total", 0),
            author_result.get("resolved", 0),
            author_result.get("failed", 0),
        )

        elapsed = time_mod.time() - start
        _logger.info("Initial reporter index complete (%.1fs)", elapsed)

    except Exception as exc:
        _logger.error("Initial reporter index failed: %s", exc, exc_info=True)


def _prepare_startup_process() -> None:
    loop = asyncio.get_running_loop()
    set_main_event_loop(loop)
    signal.signal(signal.SIGTERM, _handle_shutdown_signal)
    signal.signal(signal.SIGINT, _handle_shutdown_signal)
    raise_nofile_soft_limit(logger)
    soft_nofile, hard_nofile = get_nofile_limits()
    logger.info(
        "Startup file-descriptor state: open_fds=%s soft_nofile=%s hard_nofile=%s",
        get_open_file_descriptor_count(), soft_nofile, hard_nofile,
    )


def _configure_llm_backend() -> None:
    if settings.llm_backend == "llamacpp":
        from app.core.config import check_llamacpp_server
        check_llamacpp_server(logger)
    startup_metrics.add_note("llm_backend", settings.llm_backend)


async def _initialize_database_for_startup() -> None:
    if not settings.enable_database:
        logger.info("Database disabled; skipping initialisation and persistence")
        startup_metrics.add_note("database_disabled", True)
        return
    db_start = time.time()
    await init_db()
    logger.info("Database initialisation complete (%.2fs)", time.time() - db_start)
    startup_metrics.record_event("database_initialised", db_start)


def _remove_stale_leader_lock(path: Path) -> None:
    if not path.exists():
        return
    old_pid_text = "?"
    try:
        old_pid_text = path.read_text().strip()
        os.kill(int(old_pid_text), 0)
        return
    except (ValueError, ProcessLookupError, PermissionError) as exc:
        logger.warning("Removing stale leader lock (PID %s no longer running): %s", old_pid_text, exc)
    with contextlib.suppress(FileNotFoundError):
        path.unlink()


def _claim_startup_leadership() -> bool:
    global _leader_lock_file
    path = _startup_leader_lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _remove_stale_leader_lock(path)
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        logger.info("Another worker is handling startup tasks, skipping")
        startup_metrics.add_note("startup_role", "follower")
        return False
    try:
        os.write(fd, str(os.getpid()).encode())
    finally:
        os.close(fd)
    _leader_lock_file = str(path)
    logger.info("This worker (PID %d) is the leader for startup tasks", os.getpid())
    return True


def _register_named_task(coro: object, name: str, note: str | None = None) -> asyncio.Task[object]:
    task = asyncio.create_task(coro, name=name)  # type: ignore[arg-type]
    _register_background_task(task)
    if note:
        startup_metrics.add_note(note, task.get_name())
    return task


def _start_rss_background_tasks() -> None:
    apply_saved_polling_state()
    _register_named_task(periodic_rss_refresh(interval_seconds=600), "rss_refresh_scheduler", "rss_scheduler_task")
    _register_named_task(_start_initial_rss_refresh(), "initial_rss_refresh")


def _start_persistence_background_tasks() -> None:
    _register_named_task(article_persistence_worker(), "article_persistence_worker")
    if not settings.enable_vector_store:
        return
    _register_named_task(embedding_generation_worker(), "embedding_generation_worker")
    _register_named_task(cluster_computation_worker(), "cluster_computation_worker")
    _register_named_task(chroma_sync_worker(), "chroma_sync_worker")


def _start_database_schedulers() -> None:
    _register_named_task(_maybe_migrate_cached_articles(), "conditional_migration")
    _register_named_task(periodic_wiki_refresh(interval_seconds=86400), "wiki_refresh_scheduler", "wiki_refresh_task")
    _register_named_task(_initial_reporter_index(), "initial_reporter_index")
    _register_named_task(_start_auto_ingest(), "auto_ingest_pipeline", "auto_ingest_task")
    _register_named_task(run_credibility_scoring_scheduler(interval_seconds=86400), "credibility_scoring_scheduler", "credibility_scoring_task")


def _start_optional_blind_spots_scheduler() -> None:
    if not settings.enable_vector_store:
        return
    _register_named_task(periodic_blind_spots_update(interval_seconds=86400), "blind_spots_scheduler", "blind_spots_task")


def _start_leader_background_tasks() -> None:
    _start_rss_background_tasks()
    if not settings.enable_database:
        return
    _start_persistence_background_tasks()
    _start_database_schedulers()
    _start_optional_blind_spots_scheduler()


@app.on_event("startup")
async def on_startup() -> None:
    """Initialize worker-local state and leader-only background services."""
    startup_start = time.time()
    startup_metrics.mark_app_started()
    startup_metrics.add_note("app_version", {"version": settings.app_version, "title": settings.app_title})
    logger.info("Starting Global News Aggregation API...")

    _prepare_startup_process()
    _configure_llm_backend()
    await _initialize_database_for_startup()
    is_leader = _claim_startup_leadership()

    if settings.enable_database and AsyncSessionLocal is not None:
        await _initial_cache_load()
        startup_metrics.add_note("cache_loaded_by_worker", True)
    if is_leader:
        _start_leader_background_tasks()

    log_progress(
        logger,
        "API startup complete (%.2fs) - cache ready with %d articles",
        time.time() - startup_start,
        len(news_cache.get_articles()),
    )
    startup_metrics.mark_app_completed()



@app.on_event("shutdown")
async def on_shutdown() -> None:
    """Cancel background tasks, release the leader lock, and shut down cleanly.

    Cancels all tracked background tasks with graceful timeout, then
    removes the leader lock file so the next restart can elect a new
    leader without delay.
    """
    logger.info("Shutting down Global News Aggregation API...")

    tasks_snapshot = list(_background_tasks)
    for task in tasks_snapshot:
        task.cancel()

    if tasks_snapshot:
        await asyncio.gather(*tasks_snapshot, return_exceptions=True)

    # Release pooled HTTP clients held by process-lifetime singletons.
    await get_gdelt_query_service().close()

    # Release the leader lock so the next restart can elect a new leader.
    if _leader_lock_file:
        with contextlib.suppress(OSError):
            Path(_leader_lock_file).unlink()

    logger.info("Shutdown complete")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Accept WebSocket connections for real-time news push to the frontend."""
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("WebSocket connection error: %s", exc, exc_info=True)
        manager.disconnect(websocket)


add_protocol_extensions(app)
