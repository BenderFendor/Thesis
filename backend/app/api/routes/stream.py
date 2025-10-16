from __future__ import annotations

import asyncio
import concurrent.futures
import json
import random
import time
from datetime import datetime
from typing import Dict, List, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.rss_ingestion import _process_source_with_debug  # noqa: PLC2701
from app.services.stream_manager import stream_manager

router = APIRouter(prefix="/news", tags=["news-stream"])
stream_logger = get_logger("news_stream")


@router.get("/stream")
async def stream_news(
    request: Request,
    use_cache: bool = True,
    category: str | None = None,
):
    stream_id = f"stream_{int(time.time())}_{random.randint(1000, 9999)}"
    stream_logger.info("🎯 NEWS REQUEST: %s, use_cache=%s", stream_id, use_cache)

    active_count = stream_manager.get_active_stream_count()
    if active_count >= 5:
        stream_logger.warning(
            "🚫 Stream %s rejected: too many active streams (%s)",
            stream_id,
            active_count,
        )

        async def error_stream():
            yield f"data: {json.dumps({'status': 'error', 'message': f'Too many active streams ({active_count}). Please try again later.'})}\n\n"

        return StreamingResponse(error_stream(), media_type="text/event-stream")

    stream_manager.register_stream(stream_id)
    stream_logger.info("🚀 %s using streaming mode", stream_id)
    stream_manager.update_stream(stream_id, status="starting")

    async def event_generator():
        try:
            stream_logger.info("🚀 Stream %s starting event generation", stream_id)
            initial_status = {
                "status": "starting",
                "stream_id": stream_id,
                "message": f"Initializing news stream (use_cache={use_cache})...",
                "timestamp": datetime.now().isoformat(),
                "active_streams": stream_manager.get_active_stream_count(),
            }
            yield f"data: {json.dumps(initial_status)}\n\n"

            cached_articles: List[NewsArticle] = []
            cached_stats: List[Dict[str, object]] = []
            cache_age = None
            if use_cache:
                stream_logger.info("💾 Stream %s using cache-first approach", stream_id)
                cached_articles = news_cache.get_articles()
                cached_stats = news_cache.get_source_stats()
                cache_age = (datetime.now() - news_cache.last_updated).total_seconds()
                stream_logger.info(
                    "📋 Stream %s found %s cached articles (age: %.1fs)",
                    stream_id,
                    len(cached_articles),
                    cache_age,
                )

                if category:
                    cached_articles = [
                        article
                        for article in cached_articles
                        if article.category == category
                    ]

                if cached_articles:
                    cache_data = {
                        "status": "cache_data",
                        "stream_id": stream_id,
                        "articles": [article.dict() for article in cached_articles],
                        "source_stats": cached_stats,
                        "cache_age_seconds": cache_age,
                        "message": f"Loaded {len(cached_articles)} cached articles",
                        "timestamp": datetime.now().isoformat(),
                    }
                    yield f"data: {json.dumps(cache_data)}\n\n"

                if cache_age is not None and cache_age < 120 and cached_articles:
                    stream_logger.info(
                        "✅ Stream %s cache is fresh enough (%.1fs), ending stream",
                        stream_id,
                        cache_age,
                    )
                    final_data = {
                        "status": "complete",
                        "stream_id": stream_id,
                        "message": "Used fresh cached data",
                        "cache_age_seconds": cache_age,
                        "timestamp": datetime.now().isoformat(),
                    }
                    yield f"data: {json.dumps(final_data)}\n\n"
                    return
                else:
                    stream_logger.info(
                        "⏰ Stream %s cache is stale, fetching fresh data", stream_id
                    )

            stream_logger.info("🔄 Stream %s starting fresh data fetch", stream_id)
            stream_manager.update_stream(stream_id, status="fetching_fresh")
            loop = asyncio.get_event_loop()
            rss_sources = get_rss_sources()

            sources_to_process: List[Tuple[str, Dict[str, object]]] = list(
                rss_sources.items()
            )
            if category:
                sources_to_process = [
                    (name, info)
                    for name, info in sources_to_process
                    if info.get("category") == category
                ]
                stream_logger.info(
                    "Applied category filter '%s', processing %s sources.",
                    category,
                    len(sources_to_process),
                )

            stream_manager.update_stream(
                stream_id, total_sources=len(sources_to_process)
            )
            stream_logger.info(
                "📊 Stream %s will process %s sources",
                stream_id,
                len(sources_to_process),
            )

            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                future_to_source = {}
                for name, info in sources_to_process:
                    should_throttle, wait_time = stream_manager.should_throttle_source(
                        name
                    )

                    if should_throttle:
                        stream_logger.info(
                            "⏳ Stream %s throttling source %s for %.1fs",
                            stream_id,
                            name,
                            wait_time,
                        )

                        async def delayed_process(
                            source_name: str,
                            source_info: Dict[str, object],
                            delay: float,
                        ):
                            await asyncio.sleep(delay)
                            return await loop.run_in_executor(
                                executor,
                                _process_source_with_debug,
                                source_name,
                                source_info,
                                stream_id,
                            )

                        future = asyncio.create_task(
                            delayed_process(name, info, wait_time)
                        )
                    else:
                        future = loop.run_in_executor(
                            executor, _process_source_with_debug, name, info, stream_id
                        )

                    future_to_source[future] = name

                completed_sources = 0
                total_sources = len(sources_to_process)
                all_articles: List[NewsArticle] = []
                all_source_stats: List[Dict[str, object]] = []

                stream_logger.info(
                    "⚡ Stream %s processing %s sources with %s futures",
                    stream_id,
                    total_sources,
                    len(future_to_source),
                )

                for future in asyncio.as_completed(list(future_to_source.keys())):
                    if await request.is_disconnected():
                        stream_logger.warning(
                            "🔌 Stream %s client disconnected", stream_id
                        )
                        stream_manager.update_stream(stream_id, client_connected=False)
                        break

                    try:
                        articles, source_stat = await future
                        source_name = (
                            source_stat.get("name", "unknown")
                            if isinstance(source_stat, dict)
                            else "unknown"
                        )
                        completed_sources += 1

                        all_articles.extend(articles)
                        all_source_stats.append(source_stat)

                        stream_manager.update_stream(
                            stream_id,
                            sources_completed=completed_sources,
                            status="processing",
                        )

                        stream_logger.info(
                            "✅ Stream %s completed source %s: %s articles",
                            stream_id,
                            source_name,
                            len(articles),
                        )

                        progress_data = {
                            "status": "source_complete",
                            "stream_id": stream_id,
                            "source": source_name,
                            "articles": [a.dict() for a in articles]
                            if len(articles) <= 20
                            else [a.dict() for a in articles[:20]],
                            "source_stat": source_stat,
                            "progress": {
                                "completed": completed_sources,
                                "total": total_sources,
                                "percentage": round(
                                    (completed_sources / total_sources) * 100, 1
                                )
                                if total_sources
                                else 100,
                            },
                            "timestamp": datetime.now().isoformat(),
                        }
                        yield f"data: {json.dumps(progress_data)}\n\n"
                    except Exception as exc:  # pragma: no cover - defensive logging
                        completed_sources += 1
                        source_name = future_to_source.get(future, "unknown")
                        stream_logger.error(
                            "❌ Stream %s error for %s: %s", stream_id, source_name, exc
                        )

                        error_data = {
                            "status": "source_error",
                            "stream_id": stream_id,
                            "source": source_name,
                            "error": str(exc),
                            "progress": {
                                "completed": completed_sources,
                                "total": total_sources,
                                "percentage": round(
                                    (completed_sources / total_sources) * 100, 1
                                )
                                if total_sources
                                else 100,
                            },
                            "timestamp": datetime.now().isoformat(),
                        }
                        yield f"data: {json.dumps(error_data)}\n\n"

                stream_logger.info(
                    "🏁 Stream %s completed: %s total articles from %s sources",
                    stream_id,
                    len(all_articles),
                    len(all_source_stats),
                )

                try:
                    all_articles.sort(
                        key=lambda article: article.published, reverse=True
                    )
                except Exception as exc:  # pragma: no cover - defensive logging
                    stream_logger.warning(
                        "⚠️ Stream %s couldn't sort articles: %s", stream_id, exc
                    )

                final_data = {
                    "status": "complete",
                    "stream_id": stream_id,
                    "message": f"Successfully loaded {len(all_articles)} articles from {len(all_source_stats)} sources",
                    "total_articles": len(all_articles),
                    "successful_sources": len(
                        [s for s in all_source_stats if s.get("status") == "success"]
                    ),
                    "failed_sources": len(
                        [s for s in all_source_stats if s.get("status") == "error"]
                    ),
                    "progress": {
                        "completed": total_sources,
                        "total": total_sources,
                        "percentage": 100,
                    },
                    "timestamp": datetime.now().isoformat(),
                }
                yield f"data: {json.dumps(final_data)}\n\n"
        except asyncio.CancelledError:  # pragma: no cover - cooperative cancellation
            stream_logger.warning("🚫 Stream %s was cancelled", stream_id)
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            stream_logger.error("💥 Stream %s unexpected error: %s", stream_id, exc)
            error_response = {
                "status": "error",
                "stream_id": stream_id,
                "error": str(exc),
                "timestamp": datetime.now().isoformat(),
            }
            yield f"data: {json.dumps(error_response)}\n\n"
        finally:
            stream_manager.unregister_stream(stream_id)
            stream_logger.info("🧹 Stream %s cleanup completed", stream_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Stream-ID": stream_id,
        },
    )
