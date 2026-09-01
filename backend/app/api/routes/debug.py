"""Debug."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.config import SCOOP_USER_AGENT, settings
from app.core.logging import get_session_dir
from app.data.rss_sources import get_rss_sources
from app.database import (
    Article,
    AsyncSessionLocal,
    fetch_article_chroma_mappings,
    fetch_articles_page,
)
from app.services.cache import news_cache
from app.services.country_mentions import backfill_article_mentioned_countries
from app.services.debug_logger import DEBUG_LOG_DIR, debug_logger
from app.services.image_extraction import ImageErrorType
from app.services.metrics import get_metrics
from app.services.persistence import get_embedding_queue_depth
from app.services.rss_parser_rust_bindings import parse_feeds_parallel
from app.services.startup_metrics import startup_metrics
from app.services.stream_manager import stream_manager
from app.vector_store import get_vector_store

router = APIRouter(prefix="/debug", tags=["debug"])

_ALLOWED_LLM_LOG_FILES = {
    "llm": "llm_calls.log",
    "errors": "api_errors.log",
}


async def _fetch_rss_text(url: str) -> str:
    async with httpx.AsyncClient(
        follow_redirects=True,
        headers={"User-Agent": SCOOP_USER_AGENT},
        timeout=20.0,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


def _extract_image_urls_from_html(html: str) -> list[str]:
    return re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html, re.IGNORECASE)


def _serialize_stream_info(info: dict[str, object]) -> dict[str, object]:
    start_time = info.get("start_time")
    if not isinstance(start_time, datetime):
        start_time = datetime.now(UTC)

    return {
        "status": info.get("status"),
        "sources_completed": info.get("sources_completed"),
        "total_sources": info.get("total_sources"),
        "duration_seconds": (datetime.now(UTC) - start_time).total_seconds(),
        "client_connected": info.get("client_connected"),
    }


def _as_object_list(value: object) -> list[object]:
    return cast(list[object], value) if isinstance(value, list) else []


def _as_str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _read_jsonl_tail(
    path: Path,
    *,
    limit: int,
    offset: int = 0,
    predicate: Any | None = None,
) -> dict[str, object]:
    if not path.exists():
        return {
            "available": False,
            "path": str(path),
            "returned": 0,
            "total": 0,
            "entries": [],
        }

    entries: list[dict[str, object]] = []
    total = 0

    with path.open("r") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if predicate and not predicate(payload):
                continue
            total += 1
            entries.append(payload)

    end = max(total - offset, 0) if offset else total
    if limit >= 0:
        start = max(end - limit, 0)
        entries = entries[start:end]
    else:
        entries = entries[:end]

    return {
        "available": True,
        "path": str(path),
        "returned": len(entries),
        "total": total,
        "entries": entries,
    }


def _source_rss_urls(source_info: dict[str, object]) -> tuple[str, list[str]]:
    configured = source_info["url"]
    urls = cast(list[str], configured) if isinstance(configured, list) else [cast(str, configured)]
    return urls[0], urls


def _description_preview(value: object) -> str:
    if not isinstance(value, str) or not value:
        return "No description"
    return f"{value[:200]}..." if len(value) > 200 else value


def _entry_image_details(entry: dict[str, object]) -> tuple[list[dict[str, str]], list[str]]:
    image_sources: list[dict[str, str]] = []
    image_url = entry.get("image")
    if isinstance(image_url, str) and image_url:
        image_sources.append({"type": "rust_image", "url": image_url})
    description = entry.get("description")
    html_images = (
        _extract_image_urls_from_html(description)
        if isinstance(description, str) and description
        else []
    )
    return image_sources, html_images


def _parsed_debug_entry(
    index: int, entry: dict[str, object]
) -> tuple[dict[str, object], list[dict[str, object]]]:
    image_sources, html_images = _entry_image_details(entry)
    parsed = {
        "index": index,
        "title": entry.get("title", "No title"),
        "link": entry.get("link", ""),
        "description": _description_preview(entry.get("description")),
        "published": entry.get("published", "No date"),
        "author": entry.get("author") or "No author",
        "tags": entry.get("tags") or [],
        "has_images": bool(image_sources or html_images),
        "image_sources": image_sources,
        "content_images": html_images,
        "description_images": list(html_images),
        "raw_entry_keys": list(entry.keys()),
    }
    analysis = [
        {"entry_index": index, "source": "content", "urls": html_images},
        {"entry_index": index, "source": "description", "urls": html_images},
        {"entry_index": index, "source": "metadata", "data": image_sources},
    ]
    return parsed, analysis


def _append_debug_entries(debug_data: dict[str, object], articles: list[dict[str, object]]) -> None:
    parsed_entries = cast(list[dict[str, object]], debug_data["parsed_entries"])
    image_analysis = cast(dict[str, object], debug_data["image_analysis"])
    image_sources = cast(list[dict[str, object]], image_analysis["image_sources"])
    images_count = 0
    for index, entry in enumerate(articles[:10]):
        parsed, analysis = _parsed_debug_entry(index, entry)
        parsed_entries.append(parsed)
        image_sources.extend(analysis)
        images_count += int(bool(parsed["has_images"]))
    image_analysis["entries_with_images"] = images_count


async def _parse_source_feed(
    source_name: str, rss_url: str
) -> tuple[list[dict[str, object]], dict[str, object]]:
    rust_result = await run_in_threadpool(parse_feeds_parallel, [(source_name, [rss_url])], 8)
    articles = [
        article
        for article in cast(list[dict[str, object]], rust_result.get("articles", []))
        if article.get("source") == source_name
    ]
    stats = cast(dict[str, object], rust_result.get("source_stats", {}))
    return articles, cast(dict[str, object], stats.get(source_name, {}))


def _cached_source_data(source_name: str) -> tuple[list[dict[str, object]], object]:
    articles = [
        article.dict() for article in news_cache.get_articles() if article.source == source_name
    ]
    stat = next(
        (item for item in news_cache.get_source_stats() if item["name"] == source_name), None
    )
    return articles, stat


@router.get("/sources/{source_name}")
async def get_source_debug_data(source_name: str) -> dict[str, object]:
    """Get Source Debug Data."""
    rss_sources = get_rss_sources()
    if source_name not in rss_sources:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")

    source_info = cast(dict[str, object], rss_sources[source_name])
    rss_url, all_urls = _source_rss_urls(source_info)
    rss_text = await _fetch_rss_text(rss_url)
    source_articles, source_feed_stat = await _parse_source_feed(source_name, rss_url)
    cached_articles, source_stat = _cached_source_data(source_name)
    debug_data: dict[str, object] = {
        "source_name": source_name,
        "source_config": source_info,
        "rss_url": rss_url,
        "all_urls": all_urls,
        "feed_metadata": {
            "title": source_name,
            "description": "",
            "link": rss_url,
            "language": "N/A",
            "updated": "N/A",
            "generator": "rss_parser_rust",
        },
        "feed_status": {
            "http_status": 200,
            "bozo": source_feed_stat.get("status") == "error",
            "bozo_exception": str(source_feed_stat.get("error_message") or "None"),
            "entries_count": len(source_articles),
        },
        "parsed_entries": [],
        "cached_articles": cached_articles,
        "source_statistics": source_stat,
        "debug_timestamp": datetime.now(UTC).isoformat(),
        "image_analysis": {
            "total_entries": len(source_articles),
            "entries_with_images": 0,
            "image_sources": [],
        },
        "raw_feed_preview": rss_text[:1000],
    }
    _append_debug_entries(debug_data, source_articles)
    return debug_data


@router.get("/streams")
async def get_stream_status() -> dict[str, object]:
    """Get Stream Status."""
    with stream_manager.lock:
        return {
            "active_streams": len(stream_manager.active_streams),
            "total_streams_created": stream_manager.stream_counter,
            "streams": {
                stream_id: _serialize_stream_info(info)
                for stream_id, info in stream_manager.active_streams.items()
            },
            "source_throttling": dict(stream_manager.source_last_accessed),
        }


@router.get("/metrics/pipeline")
async def get_pipeline_metrics() -> dict[str, object]:
    """Get current RSS pipeline metrics."""
    metrics = get_metrics()
    return {
        "success": True,
        "metrics": metrics.to_dict(),
    }


@router.get("/startup")
async def get_startup_metrics() -> dict[str, object]:
    """Expose recorded startup timings and notes."""
    return startup_metrics.to_dict()


@router.get("/chromadb/articles")
async def list_chromadb_articles(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """List Chromadb Articles."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store unavailable")

    payload = await run_in_threadpool(vector_store.list_articles, limit, offset)

    ids = _as_str_list(payload.get("ids"))
    metadatas = _as_object_list(payload.get("metadatas"))
    documents = _as_object_list(payload.get("documents"))

    articles: list[dict[str, object]] = []
    for idx, chroma_id in enumerate(ids):
        metadata = metadatas[idx] if idx < len(metadatas) else {}
        document = documents[idx] if idx < len(documents) else ""
        preview_source = document if isinstance(document, str) else str(document)
        articles.append(
            {
                "id": chroma_id,
                "metadata": metadata,
                "preview": preview_source[:200],
            }
        )

    return {
        "limit": limit,
        "offset": offset,
        "returned": len(articles),
        "total": payload.get("total"),
        "articles": articles,
    }


@router.get("/database/articles")
async def list_database_articles(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    source: str | None = Query(default=None, description="Filter by RSS source key"),
    missing_embeddings_only: bool = Query(
        default=False,
        description="When true, only rows without generated embeddings are returned.",
    ),
    sort_direction: str = Query(
        default="desc",
        description="Sort published_at ascending or descending.",
    ),
    published_before: datetime | None = Query(default=None),
    published_after: datetime | None = Query(default=None),
) -> dict[str, object]:
    """List Database Articles."""
    sort_normalized = sort_direction.lower()
    if sort_normalized not in {"asc", "desc"}:
        raise HTTPException(status_code=422, detail="sort_direction must be 'asc' or 'desc'")

    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with AsyncSessionLocal() as session:
        page = await fetch_articles_page(
            session=session,
            limit=limit,
            offset=offset,
            source=source,
            missing_embeddings_only=missing_embeddings_only,
            sort_direction=sort_normalized,
            published_before=published_before,
            published_after=published_after,
        )

    return {
        "limit": limit,
        "offset": offset,
        "source": source,
        "missing_embeddings_only": missing_embeddings_only,
        "sort_direction": sort_normalized,
        "published_before": published_before.isoformat() if published_before else None,
        "published_after": published_after.isoformat() if published_after else None,
        **page,
    }


@router.get("/cache/articles")
async def list_cached_articles(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    source: str | None = Query(default=None, description="Filter by RSS source key"),
) -> dict[str, object]:
    """List Cached Articles."""
    cached = news_cache.get_articles()
    if source:
        cached = [article for article in cached if article.source == source]

    total = len(cached)
    window = cached[offset : offset + limit]

    return {
        "limit": limit,
        "offset": offset,
        "source": source,
        "total": total,
        "returned": len(window),
        "articles": [article.dict() for article in window],
    }


def _cached_article_sample(source: str | None, offset: int, limit: int) -> tuple[int, list[str]]:
    cached = news_cache.get_articles()
    if source:
        cached = [article for article in cached if article.source == source]
    sample = cached[offset : offset + limit]
    return len(cached), [article.link for article in sample if article.link]


async def _database_url_sample(source: str | None, urls: list[str]) -> tuple[int, set[str]]:
    if AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with AsyncSessionLocal() as session:
        count_stmt = select(func.count(Article.id))
        if source:
            count_stmt = count_stmt.where(Article.source == source)
        db_total = (await session.execute(count_stmt)).scalar_one()
        matched = await session.execute(select(Article.url).where(Article.url.in_(urls)))
    return db_total, {row[0] for row in matched.all()}


def _cache_delta_response(
    cache_total: int,
    urls: list[str],
    db_total: int,
    matched: set[str],
    source: str | None,
    offset: int,
    limit: int,
    preview_limit: int,
) -> dict[str, object]:
    missing = [url for url in urls if url not in matched]
    return {
        "cache_total": cache_total,
        "cache_sampled": len(urls),
        "db_total": db_total,
        "missing_in_db_count": len(missing),
        "missing_in_db_sample": missing[:preview_limit],
        "source": source,
        "sample_offset": offset,
        "sample_limit": limit,
    }


@router.get("/cache/delta")
async def get_cache_db_delta(
    sample_limit: int = Query(200, ge=10, le=1000),
    sample_offset: int = Query(0, ge=0),
    source: str | None = Query(default=None, description="Filter by RSS source key"),
    sample_preview_limit: int = Query(50, ge=0, le=200),
) -> dict[str, object]:
    """Compare a cache sample with persisted article URLs."""
    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    cache_total, cache_urls = _cached_article_sample(source, sample_offset, sample_limit)
    if not cache_urls:
        return {
            "cache_total": cache_total,
            "cache_sampled": 0,
            "db_total": 0,
            "missing_in_db_count": 0,
            "missing_in_db_sample": [],
            "source": source,
        }
    db_total, matched = await _database_url_sample(source, cache_urls)
    return _cache_delta_response(
        cache_total,
        cache_urls,
        db_total,
        matched,
        source,
        sample_offset,
        sample_limit,
        sample_preview_limit,
    )


def _storage_drift_report(
    mappings: list[dict[str, Any]], chroma_ids: set[str], sample_limit: int
) -> dict[str, object]:
    db_chroma_ids = {m["chroma_id"] for m in mappings if m["chroma_id"]}
    missing_embedding = [m for m in mappings if not m["chroma_id"]]
    missing_chroma = [m for m in mappings if m["chroma_id"] and m["chroma_id"] not in chroma_ids]
    dangling = list(chroma_ids - db_chroma_ids)
    return {
        "database_total_articles": len(mappings),
        "database_with_embeddings": len(db_chroma_ids),
        "database_missing_embeddings": len(missing_embedding),
        "vector_total_documents": len(chroma_ids),
        "missing_in_chroma": missing_chroma[:sample_limit],
        "dangling_in_chroma": dangling[:sample_limit],
        "missing_in_chroma_count": len(missing_chroma),
        "dangling_in_chroma_count": len(dangling),
    }


@router.get("/storage/drift")
async def get_storage_drift(sample_limit: int = Query(50, ge=5, le=500)) -> dict[str, object]:
    """Compare database embedding mappings with the vector store."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store unavailable")
    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with AsyncSessionLocal() as session:
        mappings = await fetch_article_chroma_mappings(session)
    chroma_ids = set(await run_in_threadpool(vector_store.list_all_ids))
    return _storage_drift_report(mappings, chroma_ids, sample_limit)


# --- Phase 3: Debug Page Consolidation - New Endpoints ---


@router.get("/system/status")
async def get_system_status() -> dict[str, object]:
    """Comprehensive system status for debug page.

    Returns startup metrics, component health, and runtime info.
    """
    import os
    import platform
    import sys

    startup_data = startup_metrics.to_dict()
    cache_stats = news_cache.get_source_stats()
    cache_last_updated = news_cache.last_updated
    cache_age_seconds = None
    if cache_last_updated:
        cache_age_seconds = (datetime.now(UTC) - cache_last_updated).total_seconds()

    # Component health checks
    components = {
        "cache": {
            "healthy": True,
            "article_count": len(news_cache.get_articles()),
            "source_count": len(cache_stats),
            "last_updated": cache_last_updated.isoformat() if cache_last_updated else None,
            "age_seconds": cache_age_seconds,
            "update_in_progress": news_cache.update_in_progress,
            "update_count": news_cache.update_count,
            "incremental_enabled": settings.enable_incremental_cache,
            "sources_tracked": len(news_cache.articles_by_source),
        },
        "database": {
            "healthy": settings.enable_database and AsyncSessionLocal is not None,
            "enabled": settings.enable_database,
        },
        "vector_store": {
            "healthy": get_vector_store() is not None,
        },
        "embedding_queue": {
            "depth": get_embedding_queue_depth(),
            "batch_size": settings.embedding_batch_size,
            "max_per_minute": settings.embedding_max_per_minute,
        },
    }

    return {
        "startup": startup_data,
        "components": components,
        "pipeline": get_metrics().to_dict(),
        "runtime": {
            "python_version": sys.version,
            "platform": platform.platform(),
            "pid": os.getpid(),
            "working_dir": str(Path.cwd()),
        },
        "config": {
            "debug_mode": settings.debug if hasattr(settings, "debug") else False,
            "enable_database": settings.enable_database,
            "chroma_host": getattr(settings, "chroma_host", None),
            "chroma_port": getattr(settings, "chroma_port", None),
        },
        "timestamp": datetime.now(UTC).isoformat(),
    }


# Runtime log level state
_current_log_level: str = "INFO"


@router.get("/loglevel")
async def get_log_level() -> dict[str, str]:
    """Get current runtime log level."""
    return {"level": _current_log_level}


@router.post("/loglevel")
async def set_log_level(
    level: str = Query(..., description="Log level: DEBUG, INFO, WARNING, ERROR"),
) -> dict[str, str]:
    """Set runtime log level for all loggers.

    Valid levels: DEBUG, INFO, WARNING, ERROR, CRITICAL
    """
    import logging

    global _current_log_level

    level_upper = level.upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}

    if level_upper not in valid_levels:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid log level. Must be one of: {', '.join(valid_levels)}",
        )

    # Set level on root logger
    logging.getLogger().setLevel(getattr(logging, level_upper))

    # Set level on our app loggers
    for logger_name in [
        "rss_ingestion",
        "news_stream",
        "image_proxy",
        "jobs",
        "updates",
        "cache",
    ]:
        logger = logging.getLogger(logger_name)
        logger.setLevel(getattr(logging, level_upper))

    _current_log_level = level_upper

    return {
        "message": f"Log level set to {level_upper}",
        "level": _current_log_level,
    }


@router.post("/parser/test/rss")
async def test_rss_parser(
    url: str = Query(..., description="RSS feed URL to test"),
    max_entries: int = Query(5, ge=1, le=20),
) -> dict[str, object]:
    """Test RSS parser on an arbitrary URL.

    Returns parsed feed metadata and sample entries for debugging.
    """
    import time

    start_time = time.time()

    try:
        rust_result = await run_in_threadpool(
            parse_feeds_parallel,
            [(url, [url])],
            4,
        )
        parse_time = time.time() - start_time
        sample_articles = cast(list[dict[str, object]], rust_result.get("articles", []))
        source_stats = cast(dict[str, dict[str, object]], rust_result.get("source_stats", {}))
        parser_status = source_stats.get(url, {})

        sample_entries: list[dict[str, object]] = []
        result = {
            "url": url,
            "parse_time_seconds": round(parse_time, 3),
            "success": parser_status.get("status") != "error",
            "feed_info": {
                "title": url,
                "description": "",
                "link": url,
                "language": "",
            },
            "status": {
                "http_status": 200,
                "bozo": parser_status.get("status") == "error",
                "bozo_exception": str(parser_status.get("error_message") or ""),
                "entries_count": len(sample_articles),
            },
            "sample_entries": sample_entries,
        }

        for i, entry in enumerate(sample_articles[:max_entries]):
            sample_entries.append(
                {
                    "index": i,
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "published": entry.get("published", ""),
                    "image_extraction": {
                        "image_url": entry.get("image"),
                        "image_candidates": [],
                        "image_error": None,
                        "image_error_details": None,
                        "selected_source": "rust_feed" if entry.get("image") else None,
                    },
                }
            )

        result["image_error_taxonomy"] = [
            {
                "code": error.value,
            }
            for error in ImageErrorType
        ]

        return result

    except (AttributeError, KeyError, OSError, RuntimeError, TypeError, ValueError) as error:
        return {
            "url": url,
            "success": False,
            "error": str(error),
            "parse_time_seconds": time.time() - start_time,
        }


@router.post("/parser/test/article")
async def test_article_parser(
    url: str = Query(..., description="Article page URL to test og:image extraction"),
) -> dict[str, object]:
    """Test article page parser for og:image extraction.

    Fetches the page and attempts to extract og:image, twitter:image, etc.
    """
    from app.services.image_extraction import fetch_og_image

    result = await fetch_og_image(url)

    return {
        "url": url,
        "success": result.image_url is not None,
        "image_url": result.image_url,
        "candidates": [
            {"url": c.url, "source": c.source, "priority": c.priority}
            for c in result.image_candidates
        ],
        "error": result.image_error.value if result.image_error else None,
        "error_details": result.image_error_details,
    }


@router.get("/jobs")
async def list_active_jobs() -> dict[str, object]:
    """List all active ingestion jobs."""
    from app.api.routes.jobs import _active_jobs

    return {
        "active_jobs": len(_active_jobs),
        "jobs": {
            job_id: {
                "status": job.get("status"),
                "started_at": job.get("started_at"),
                "progress": job.get("progress"),
                "error": job.get("error"),
            }
            for job_id, job in _active_jobs.items()
        },
    }


@router.get("/updates/subscribers")
async def get_updates_subscribers() -> dict[str, object]:
    """Get updates stream subscriber info."""
    from app.api.routes.updates import _event_counter, _update_subscribers

    return {
        "subscriber_count": len(_update_subscribers),
        "total_events_sent": _event_counter,
    }


# --- Debug Logger Endpoints ---


class FrontendDebugReport(BaseModel):
    """Frontend Debug Report."""

    session_id: str = Field(..., description="Frontend performance session ID")
    summary: dict[str, Any]
    recent_events: list[dict[str, Any]] = []
    slow_operations: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    dom_stats: dict[str, Any] | None = None
    location: str | None = None
    user_agent: str | None = None
    generated_at: str | None = None


@router.post("/logs/frontend")
async def ingest_frontend_debug_report(
    report: FrontendDebugReport,
) -> dict[str, object]:
    """Store a frontend debug payload for agentic debugging."""
    debug_logger.log_frontend_report(report.model_dump())
    return {"status": "ok"}


@router.get("/logs/frontend")
async def get_frontend_debug_reports() -> dict[str, object]:
    """Return recent frontend debug payloads."""
    reports = debug_logger.get_frontend_reports()
    return {"count": len(reports), "reports": reports}


@router.get("/logs/report")
async def get_debug_report() -> dict[str, object]:
    """Get comprehensive debug report for agentic debugging tools.

    This endpoint returns everything needed to diagnose issues:
    - Performance summary with component stats
    - Active streams and their state
    - Recent events (last 50)
    - Slow operations detected
    - Hang suspects
    - AI-generated recommendations

    Use this as the primary entry point for debugging sessions.
    """
    return debug_logger.get_debug_report()


@router.get("/logs/events")
async def get_debug_events(
    limit: int = Query(100, ge=1, le=1000),
    event_type: str | None = Query(default=None, description="Filter by event type"),
) -> dict[str, object]:
    """Get recent debug events.

    Event types include:
    - request_start, request_end, request_error
    - stream_start, stream_event, stream_end, stream_error
    - db_query_start, db_query_end, db_query_error
    - cache_hit, cache_miss, cache_update
    - rss_fetch_start, rss_fetch_end, rss_fetch_error
    - performance_warning, bottleneck_detected, hang_suspected
    """
    from app.services.debug_logger import EventType

    filter_type = None
    if event_type:
        try:
            filter_type = EventType(event_type)
        except ValueError:
            valid_types = [e.value for e in EventType]
            raise HTTPException(
                status_code=400,
                detail=f"Invalid event_type. Must be one of: {', '.join(valid_types)}",
            )

    events = debug_logger.get_recent_events(limit=limit, event_type=filter_type)
    return {
        "count": len(events),
        "limit": limit,
        "filter": event_type,
        "events": events,
    }


@router.get("/logs/streams")
async def get_active_debug_streams() -> dict[str, object]:
    """Get detailed info about active streams being traced.

    Includes timing, event gaps, potential hang detection.
    """
    return {
        "active_streams": debug_logger.get_active_streams(),
        "stream_manager_streams": {
            stream_id: _serialize_stream_info(info)
            for stream_id, info in stream_manager.active_streams.items()
        },
    }


@router.get("/logs/slow")
async def get_slow_operations() -> dict[str, object]:
    """Get list of slow operations detected.

    These are operations that exceeded their performance thresholds.
    """
    slow_ops = debug_logger.get_slow_operations()
    return {
        "count": len(slow_ops),
        "operations": slow_ops,
        "thresholds": {
            "request_slow": "5.0s",
            "db_query_slow": "1.0s",
            "rss_fetch_slow": "10.0s",
            "stream_event_gap": "5.0s",
        },
    }


@router.get("/logs/performance")
async def get_performance_summary() -> dict[str, object]:
    """Get performance summary with timing statistics by component."""
    return debug_logger.get_performance_summary()


@router.get("/logs/files")
async def list_debug_log_files() -> dict[str, object]:
    """List available debug log files.

    Debug logs are stored as JSON Lines (.jsonl) files.
    """
    log_files: list[dict[str, object]] = []
    if DEBUG_LOG_DIR.exists():
        for log_file in sorted(DEBUG_LOG_DIR.glob("debug_*.jsonl"), reverse=True):
            stat = log_file.stat()
            log_files.append(
                {
                    "filename": log_file.name,
                    "size_bytes": stat.st_size,
                    "size_kb": round(stat.st_size / 1024, 2),
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                    "created": datetime.fromtimestamp(stat.st_ctime, tz=UTC).isoformat(),
                }
            )

    return {
        "log_directory": str(DEBUG_LOG_DIR),
        "file_count": len(log_files),
        "files": log_files[:20],  # Limit to 20 most recent
    }


def _valid_debug_log_path(filename: str) -> Path:
    path = DEBUG_LOG_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Log file not found: {filename}")
    if not path.name.startswith("debug_") or path.suffix != ".jsonl":
        raise HTTPException(status_code=400, detail="Invalid log file name")
    return path


def _decode_log_event(line: str, event_type: str | None) -> dict[str, object] | None:
    if not line.strip():
        return None
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(event, dict) or (event_type and event.get("event_type") != event_type):
        return None
    return cast(dict[str, object], event)


def _read_debug_events(
    path: Path, offset: int, limit: int, event_type: str | None
) -> tuple[int, list[dict[str, object]]]:
    events: list[dict[str, object]] = []
    total_lines = 0
    with path.open() as handle:
        for index, line in enumerate(handle):
            if not line.strip():
                continue
            total_lines += 1
            if index < offset or len(events) >= limit:
                continue
            event = _decode_log_event(line, event_type)
            if event is not None:
                events.append(event)
    return total_lines, events


@router.get("/logs/file/{filename}")
async def read_debug_log_file(
    filename: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    event_type: str | None = Query(default=None),
) -> dict[str, object]:
    """Read paginated events from one debug JSONL file."""
    log_file = _valid_debug_log_path(filename)
    try:
        total_lines, events = _read_debug_events(log_file, offset, limit, event_type)
    except (OSError, UnicodeError, ValueError) as error:
        raise HTTPException(
            status_code=500, detail=f"Failed to read log file: {error!s}"
        ) from error
    return {
        "filename": filename,
        "total_lines": total_lines,
        "offset": offset,
        "limit": limit,
        "returned": len(events),
        "filter": event_type,
        "events": events,
    }


@router.get("/logs/llm")
async def read_llm_calls(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    service: str | None = Query(default=None, description="Filter by service name"),
    success: bool | None = Query(default=None, description="Filter by success status"),
) -> dict[str, object]:
    """Read Llm Calls."""
    session_dir = get_session_dir()
    path = session_dir / _ALLOWED_LLM_LOG_FILES["llm"]

    def _predicate(entry: dict[str, object]) -> bool:
        if service and entry.get("service") != service:
            return False
        return not (success is not None and bool(entry.get("success")) != success)

    payload = _read_jsonl_tail(path, limit=limit, offset=offset, predicate=_predicate)
    payload.update(
        {
            "service": service,
            "success_filter": success,
        }
    )
    return payload


@router.get("/logs/errors")
async def read_error_logs(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_request_stream_events: bool = Query(
        True,
        description="When true, append recent request/stream errors from the in-memory debug logger.",
    ),
) -> dict[str, object]:
    """Read Error Logs."""
    session_dir = get_session_dir()
    path = session_dir / _ALLOWED_LLM_LOG_FILES["errors"]
    file_payload = _read_jsonl_tail(path, limit=limit, offset=offset)

    recent_errors: list[dict[str, object]] = []
    if include_request_stream_events:
        request_stream_errors = [
            event
            for event in debug_logger.get_recent_events(limit=limit * 4)
            if str(event.get("event_type")) in {"request_error", "stream_error"}
        ]
        recent_errors = request_stream_errors[-limit:]

    return {
        "log_file": file_payload,
        "recent_request_stream_errors": recent_errors,
        "returned_recent_errors": len(recent_errors),
        "include_request_stream_events": include_request_stream_events,
    }


@router.delete("/logs/files")
async def clear_old_log_files(
    keep_recent: int = Query(5, ge=1, le=20, description="Number of recent files to keep"),
) -> dict[str, object]:
    """Delete old debug log files, keeping the most recent ones."""
    if not DEBUG_LOG_DIR.exists():
        return {"message": "No log directory exists", "deleted": 0}

    log_files = sorted(DEBUG_LOG_DIR.glob("debug_*.jsonl"), reverse=True)
    files_to_delete = log_files[keep_recent:]

    deleted: list[dict[str, object]] = []
    for log_file in files_to_delete:
        try:
            size = log_file.stat().st_size
            log_file.unlink()
            deleted.append({"filename": log_file.name, "size_bytes": size})
        except OSError as error:
            deleted.append({"filename": log_file.name, "error": str(error)})

    return {
        "message": f"Deleted {len(deleted)} old log files",
        "kept": keep_recent,
        "deleted": deleted,
    }


@router.post("/backfill/images")
async def backfill_article_images(
    batch_size: int = Query(100, ge=10, le=500, description="Articles per batch"),
    max_batches: int | None = Query(None, ge=1, description="Max batches (None = all)"),
) -> dict[str, object]:
    """Backfill OG images for existing articles missing images.

    Fetches og:image from article URLs and updates the database.
    Uses per-domain concurrency limiting to be polite to servers.
    """
    from app.services.og_image import backfill_missing_images

    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with AsyncSessionLocal() as session:
        stats = await backfill_missing_images(
            session=session,
            batch_size=batch_size,
            max_batches=max_batches,
        )

    return {
        "message": "Image backfill completed",
        **stats,
    }


@router.post("/backfill/mentioned-countries")
async def backfill_article_mentions(
    batch_size: int = Query(500, ge=10, le=2000, description="Articles per batch"),
    max_batches: int | None = Query(None, ge=1, description="Max batches (None = all)"),
) -> dict[str, object]:
    """Backfill Article Mentions."""
    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with AsyncSessionLocal() as session:
        stats = await backfill_article_mentioned_countries(
            session=session,
            batch_size=batch_size,
            max_batches=max_batches,
        )

    return {
        "message": "Mentioned-country backfill completed",
        **stats,
    }
