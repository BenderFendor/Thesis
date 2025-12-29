from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Dict, List, Any

import feedparser  # type: ignore[import-unresolved]
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import func, select  # type: ignore[import-unresolved]

from app.core.config import settings
from app.data.rss_sources import get_rss_sources
from app.database import (
    Article,
    AsyncSessionLocal,
    fetch_article_chroma_mappings,
    fetch_articles_page,
)
from app.services.cache import news_cache
from app.services.persistence import get_embedding_queue_depth
from app.services.metrics import get_metrics
from app.services.startup_metrics import startup_metrics
from app.services.stream_manager import stream_manager
from app.services.debug_logger import debug_logger, DEBUG_LOG_DIR
from app.vector_store import get_vector_store

router = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/source/{source_name}")
async def get_source_debug_data(source_name: str) -> Dict[str, object]:
    rss_sources = get_rss_sources()
    if source_name not in rss_sources:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")

    source_info = rss_sources[source_name]
    rss_url = (
        source_info["url"][0]
        if isinstance(source_info["url"], list)
        else source_info["url"]
    )

    feed = feedparser.parse(rss_url, agent="NewsAggregator/1.0")

    cached_articles = [
        article.dict()
        for article in news_cache.get_articles()
        if article.source == source_name
    ]
    source_stat = next(
        (
            stats
            for stats in news_cache.get_source_stats()
            if stats["name"] == source_name
        ),
        None,
    )

    debug_data = {
        "source_name": source_name,
        "source_config": source_info,
        "rss_url": rss_url,
        "all_urls": source_info["url"]
        if isinstance(source_info["url"], list)
        else [source_info["url"]],
        "feed_metadata": {
            "title": getattr(feed.feed, "title", "N/A"),
            "description": getattr(feed.feed, "description", "N/A"),
            "link": getattr(feed.feed, "link", "N/A"),
            "language": getattr(feed.feed, "language", "N/A"),
            "updated": getattr(feed.feed, "updated", "N/A"),
            "generator": getattr(feed.feed, "generator", "N/A"),
        },
        "feed_status": {
            "http_status": getattr(feed, "status", "N/A"),
            "bozo": getattr(feed, "bozo", False),
            "bozo_exception": str(getattr(feed, "bozo_exception", "None")),
            "entries_count": len(feed.entries) if hasattr(feed, "entries") else 0,
        },
        "parsed_entries": [],
        "cached_articles": cached_articles,
        "source_statistics": source_stat,
        "debug_timestamp": datetime.now(timezone.utc).isoformat(),
        "image_analysis": {
            "total_entries": len(feed.entries) if hasattr(feed, "entries") else 0,
            "entries_with_images": 0,
            "image_sources": [],
        },
    }

    if hasattr(feed, "entries"):
        for i, entry in enumerate(feed.entries[:10]):
            image_sources = []

            if getattr(entry, "media_thumbnail", None):
                image_sources.append(
                    {"type": "media_thumbnail", "url": entry.media_thumbnail}
                )
            if getattr(entry, "media_content", None):
                image_sources.append(
                    {"type": "media_content", "data": entry.media_content}
                )
            if getattr(entry, "enclosures", None):
                image_sources.append({"type": "enclosures", "data": entry.enclosures})

            content_images = []
            if getattr(entry, "content", None):
                content_text = (
                    entry.content[0].value
                    if isinstance(entry.content, list)
                    else str(entry.content)
                )
                content_images = re.findall(r"<img[^>]+src=\"([^\"]+)\"", content_text)

            desc_images = []
            if entry.get("description"):
                desc_images = re.findall(
                    r"<img[^>]+src=\"([^\"]+)\"", entry.description
                )

            has_images = bool(image_sources or content_images or desc_images)
            if has_images:
                debug_data["image_analysis"]["entries_with_images"] += 1

            parsed_entry = {
                "index": i,
                "title": entry.get("title", "No title"),
                "link": entry.get("link", ""),
                "description": (entry.get("description", "")[:200] + "...")
                if entry.get("description") and len(entry.get("description", "")) > 200
                else entry.get("description", "No description"),
                "published": entry.get("published", "No date"),
                "author": entry.get("author", "No author"),
                "tags": entry.get("tags", []),
                "has_images": has_images,
                "image_sources": image_sources,
                "content_images": content_images,
                "description_images": desc_images,
                "raw_entry_keys": list(entry.keys()) if hasattr(entry, "keys") else [],
            }

            debug_data["parsed_entries"].append(parsed_entry)
            debug_data["image_analysis"]["image_sources"].extend(
                [
                    {"entry_index": i, "source": "content", "urls": content_images},
                    {"entry_index": i, "source": "description", "urls": desc_images},
                    {"entry_index": i, "source": "metadata", "data": image_sources},
                ]
            )

    return debug_data


@router.get("/streams")
async def get_stream_status() -> Dict[str, object]:
    with stream_manager.lock:
        return {
            "active_streams": len(stream_manager.active_streams),
            "total_streams_created": stream_manager.stream_counter,
            "streams": {
                stream_id: {
                    "status": info["status"],
                    "sources_completed": info["sources_completed"],
                    "total_sources": info["total_sources"],
                    "duration_seconds": (
                        datetime.now(timezone.utc) - info["start_time"]
                    ).total_seconds(),
                    "client_connected": info["client_connected"],
                }
                for stream_id, info in stream_manager.active_streams.items()
            },
            "source_throttling": dict(stream_manager.source_last_accessed),
        }


@router.get("/metrics/pipeline")
async def get_pipeline_metrics() -> Dict[str, object]:
    """Get current RSS pipeline metrics."""
    metrics = get_metrics()
    return {
        "success": True,
        "metrics": metrics.to_dict(),
    }


@router.get("/startup")
async def get_startup_metrics() -> Dict[str, object]:
    """Expose recorded startup timings and notes."""
    return startup_metrics.to_dict()


@router.get("/chromadb/articles")
async def list_chromadb_articles(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Dict[str, object]:
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store unavailable")

    payload = await run_in_threadpool(vector_store.list_articles, limit, offset)

    ids = payload.get("ids") or []
    metadatas = payload.get("metadatas") or []
    documents = payload.get("documents") or []

    articles: List[Dict[str, object]] = []
    for idx, chroma_id in enumerate(ids):
        metadata = metadatas[idx] if idx < len(metadatas) else {}
        document = documents[idx] if idx < len(documents) else ""
        articles.append(
            {
                "id": chroma_id,
                "metadata": metadata,
                "preview": document[:200],
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
) -> Dict[str, object]:
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
) -> Dict[str, object]:
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


@router.get("/cache/delta")
async def get_cache_db_delta(
    sample_limit: int = Query(200, ge=10, le=1000),
    sample_offset: int = Query(0, ge=0),
    source: str | None = Query(default=None, description="Filter by RSS source key"),
    sample_preview_limit: int = Query(50, ge=0, le=200),
) -> Dict[str, object]:
    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    cached = news_cache.get_articles()
    if source:
        cached = [article for article in cached if article.source == source]

    cache_total = len(cached)
    sample_slice = cached[sample_offset : sample_offset + sample_limit]
    cache_urls = [article.link for article in sample_slice if article.link]

    if not cache_urls:
        return {
            "cache_total": cache_total,
            "cache_sampled": 0,
            "db_total": 0,
            "missing_in_db_count": 0,
            "missing_in_db_sample": [],
            "source": source,
        }

    async with AsyncSessionLocal() as session:
        db_total_stmt = select(func.count(Article.id))
        if source:
            db_total_stmt = db_total_stmt.where(Article.source == source)
        db_total = (await session.execute(db_total_stmt)).scalar_one()

        matched_stmt = select(Article.url).where(Article.url.in_(cache_urls))
        matched_urls = {row[0] for row in (await session.execute(matched_stmt)).all()}

    missing_in_db = [url for url in cache_urls if url not in matched_urls]

    return {
        "cache_total": cache_total,
        "cache_sampled": len(cache_urls),
        "db_total": db_total,
        "missing_in_db_count": len(missing_in_db),
        "missing_in_db_sample": missing_in_db[:sample_preview_limit],
        "source": source,
        "sample_offset": sample_offset,
        "sample_limit": sample_limit,
    }


@router.get("/storage/drift")
async def get_storage_drift(
    sample_limit: int = Query(50, ge=5, le=500),
) -> Dict[str, object]:
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store unavailable")

    if not settings.enable_database or AsyncSessionLocal is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    async with AsyncSessionLocal() as session:
        mappings = await fetch_article_chroma_mappings(session)

    db_total = len(mappings)
    db_chroma_ids = {m["chroma_id"] for m in mappings if m["chroma_id"]}
    db_missing_chroma = [m for m in mappings if not m["chroma_id"]]

    chroma_ids = set(await run_in_threadpool(vector_store.list_all_ids))

    missing_in_chroma = [
        m
        for m in mappings
        if m["chroma_id"] and m["chroma_id"] not in chroma_ids
    ]
    dangling_in_chroma = list(chroma_ids - db_chroma_ids)

    drift_report = {
        "database_total_articles": db_total,
        "database_with_embeddings": len(db_chroma_ids),
        "database_missing_embeddings": len(db_missing_chroma),
        "vector_total_documents": len(chroma_ids),
        "missing_in_chroma": missing_in_chroma[:sample_limit],
        "dangling_in_chroma": dangling_in_chroma[:sample_limit],
        "missing_in_chroma_count": len(missing_in_chroma),
        "dangling_in_chroma_count": len(dangling_in_chroma),
    }

    return drift_report


# --- Phase 3: Debug Page Consolidation - New Endpoints ---


@router.get("/system/status")
async def get_system_status() -> Dict[str, object]:
    """
    Comprehensive system status for debug page.
    
    Returns startup metrics, component health, and runtime info.
    """
    import os
    import sys
    import platform
    
    startup_data = startup_metrics.to_dict()
    cache_stats = news_cache.get_source_stats()
    cache_last_updated = news_cache.last_updated
    cache_age_seconds = None
    if cache_last_updated:
        cache_age_seconds = (
            datetime.now(timezone.utc) - cache_last_updated
        ).total_seconds()
    
    # Component health checks
    components = {
        "cache": {
            "healthy": True,
            "article_count": len(news_cache.get_articles()),
            "source_count": len(cache_stats),
            "last_updated": cache_last_updated.isoformat()
            if cache_last_updated
            else None,
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
            "working_dir": os.getcwd(),
        },
        "config": {
            "debug_mode": settings.debug if hasattr(settings, "debug") else False,
            "enable_database": settings.enable_database,
            "chroma_host": getattr(settings, "chroma_host", None),
            "chroma_port": getattr(settings, "chroma_port", None),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Runtime log level state
_current_log_level: str = "INFO"


@router.get("/loglevel")
async def get_log_level() -> Dict[str, str]:
    """Get current runtime log level."""
    return {"level": _current_log_level}


@router.post("/loglevel")
async def set_log_level(level: str = Query(..., description="Log level: DEBUG, INFO, WARNING, ERROR")) -> Dict[str, str]:
    """
    Set runtime log level for all loggers.
    
    Valid levels: DEBUG, INFO, WARNING, ERROR, CRITICAL
    """
    import logging
    global _current_log_level
    
    level_upper = level.upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    
    if level_upper not in valid_levels:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid log level. Must be one of: {', '.join(valid_levels)}"
        )
    
    # Set level on root logger
    logging.getLogger().setLevel(getattr(logging, level_upper))
    
    # Set level on our app loggers
    for logger_name in ["rss_ingestion", "news_stream", "image_proxy", "jobs", "updates", "cache"]:
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
) -> Dict[str, object]:
    """
    Test RSS parser on an arbitrary URL.
    
    Returns parsed feed metadata and sample entries for debugging.
    """
    import time
    
    start_time = time.time()
    
    try:
        feed = feedparser.parse(url, agent="NewsAggregator/1.0 (Debug Parser Test)")
        parse_time = time.time() - start_time
        
        result = {
            "url": url,
            "parse_time_seconds": round(parse_time, 3),
            "success": not getattr(feed, "bozo", False),
            "feed_info": {
                "title": getattr(feed.feed, "title", ""),
                "description": getattr(feed.feed, "description", ""),
                "link": getattr(feed.feed, "link", ""),
                "language": getattr(feed.feed, "language", ""),
            },
            "status": {
                "http_status": getattr(feed, "status", "N/A"),
                "bozo": getattr(feed, "bozo", False),
                "bozo_exception": str(getattr(feed, "bozo_exception", "")),
                "entries_count": len(feed.entries) if hasattr(feed, "entries") else 0,
            },
            "sample_entries": [],
        }
        
        for i, entry in enumerate(feed.entries[:max_entries]):
            # Extract image using new extraction service
            from app.services.image_extraction import extract_image_from_entry
            image_result = extract_image_from_entry(entry, base_url=url)
            
            result["sample_entries"].append({
                "index": i,
                "title": entry.get("title", ""),
                "link": entry.get("link", ""),
                "published": entry.get("published", ""),
                "image_extraction": image_result.to_dict(),
            })
        
        return result
        
    except Exception as e:
        return {
            "url": url,
            "success": False,
            "error": str(e),
            "parse_time_seconds": time.time() - start_time,
        }


@router.post("/parser/test/article")
async def test_article_parser(
    url: str = Query(..., description="Article page URL to test og:image extraction"),
) -> Dict[str, object]:
    """
    Test article page parser for og:image extraction.
    
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
async def list_active_jobs() -> Dict[str, object]:
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
async def get_updates_subscribers() -> Dict[str, object]:
    """Get updates stream subscriber info."""
    from app.api.routes.updates import _update_subscribers, _event_counter
    
    return {
        "subscriber_count": len(_update_subscribers),
        "total_events_sent": _event_counter,
    }


# --- Debug Logger Endpoints ---


class FrontendDebugReport(BaseModel):
    session_id: str = Field(..., description="Frontend performance session ID")
    summary: Dict[str, Any]
    recent_events: List[Dict[str, Any]] = []
    slow_operations: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    dom_stats: Dict[str, Any] | None = None
    location: str | None = None
    user_agent: str | None = None
    generated_at: str | None = None


@router.post("/logs/frontend")
async def ingest_frontend_debug_report(report: FrontendDebugReport) -> Dict[str, object]:
    """
    Store a frontend debug payload for agentic debugging.
    """
    debug_logger.log_frontend_report(report.model_dump())
    return {"status": "ok"}


@router.get("/logs/frontend")
async def get_frontend_debug_reports() -> Dict[str, object]:
    """
    Return recent frontend debug payloads.
    """
    reports = debug_logger.get_frontend_reports()
    return {"count": len(reports), "reports": reports}


@router.get("/logs/report")
async def get_debug_report() -> Dict[str, object]:
    """
    Get comprehensive debug report for agentic debugging tools.
    
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
) -> Dict[str, object]:
    """
    Get recent debug events.
    
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
                detail=f"Invalid event_type. Must be one of: {', '.join(valid_types)}"
            )
    
    events = debug_logger.get_recent_events(limit=limit, event_type=filter_type)
    return {
        "count": len(events),
        "limit": limit,
        "filter": event_type,
        "events": events,
    }


@router.get("/logs/streams")
async def get_active_debug_streams() -> Dict[str, object]:
    """
    Get detailed info about active streams being traced.
    
    Includes timing, event gaps, potential hang detection.
    """
    return {
        "active_streams": debug_logger.get_active_streams(),
        "stream_manager_streams": {
            stream_id: {
                "status": info["status"],
                "sources_completed": info["sources_completed"],
                "total_sources": info["total_sources"],
                "duration_seconds": (
                    datetime.now(timezone.utc) - info["start_time"]
                ).total_seconds(),
                "client_connected": info["client_connected"],
            }
            for stream_id, info in stream_manager.active_streams.items()
        },
    }


@router.get("/logs/slow")
async def get_slow_operations() -> Dict[str, object]:
    """
    Get list of slow operations detected.
    
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
async def get_performance_summary() -> Dict[str, object]:
    """
    Get performance summary with timing statistics by component.
    """
    return debug_logger.get_performance_summary()


@router.get("/logs/files")
async def list_debug_log_files() -> Dict[str, object]:
    """
    List available debug log files.
    
    Debug logs are stored as JSON Lines (.jsonl) files.
    """
    log_files = []
    if DEBUG_LOG_DIR.exists():
        for log_file in sorted(DEBUG_LOG_DIR.glob("debug_*.jsonl"), reverse=True):
            stat = log_file.stat()
            log_files.append({
                "filename": log_file.name,
                "size_bytes": stat.st_size,
                "size_kb": round(stat.st_size / 1024, 2),
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "created": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
            })
    
    return {
        "log_directory": str(DEBUG_LOG_DIR),
        "file_count": len(log_files),
        "files": log_files[:20],  # Limit to 20 most recent
    }


@router.get("/logs/file/{filename}")
async def read_debug_log_file(
    filename: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    event_type: str | None = Query(default=None),
) -> Dict[str, object]:
    """
    Read events from a specific debug log file.
    
    Supports pagination and filtering by event type.
    """
    import json
    
    log_file = DEBUG_LOG_DIR / filename
    if not log_file.exists():
        raise HTTPException(status_code=404, detail=f"Log file not found: {filename}")
    
    if not log_file.name.startswith("debug_") or not log_file.suffix == ".jsonl":
        raise HTTPException(status_code=400, detail="Invalid log file name")
    
    events = []
    total_lines = 0
    
    try:
        with open(log_file, "r") as f:
            for i, line in enumerate(f):
                if not line.strip():
                    continue
                total_lines += 1
                
                if i < offset:
                    continue
                if len(events) >= limit:
                    continue
                
                try:
                    event = json.loads(line)
                    if event_type and event.get("event_type") != event_type:
                        continue
                    events.append(event)
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log file: {e}")
    
    return {
        "filename": filename,
        "total_lines": total_lines,
        "offset": offset,
        "limit": limit,
        "returned": len(events),
        "filter": event_type,
        "events": events,
    }


@router.delete("/logs/files")
async def clear_old_log_files(
    keep_recent: int = Query(5, ge=1, le=20, description="Number of recent files to keep"),
) -> Dict[str, object]:
    """
    Delete old debug log files, keeping the most recent ones.
    """
    if not DEBUG_LOG_DIR.exists():
        return {"message": "No log directory exists", "deleted": 0}
    
    log_files = sorted(DEBUG_LOG_DIR.glob("debug_*.jsonl"), reverse=True)
    files_to_delete = log_files[keep_recent:]
    
    deleted = []
    for log_file in files_to_delete:
        try:
            size = log_file.stat().st_size
            log_file.unlink()
            deleted.append({"filename": log_file.name, "size_bytes": size})
        except Exception as e:
            deleted.append({"filename": log_file.name, "error": str(e)})
    
    return {
        "message": f"Deleted {len(deleted)} old log files",
        "kept": keep_recent,
        "deleted": deleted,
    }
