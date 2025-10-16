from __future__ import annotations

import re
from datetime import datetime
from typing import Dict

import feedparser  # type: ignore[import-unresolved]
from fastapi import APIRouter, HTTPException

from app.data.rss_sources import get_rss_sources
from app.services.cache import news_cache
from app.services.stream_manager import stream_manager

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
        "debug_timestamp": datetime.now().isoformat(),
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
                        datetime.now() - info["start_time"]
                    ).total_seconds(),
                    "client_connected": info["client_connected"],
                }
                for stream_id, info in stream_manager.active_streams.items()
            },
            "source_throttling": dict(stream_manager.source_last_accessed),
        }
