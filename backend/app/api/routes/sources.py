from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources, _DATA_PATH, reload_rss_sources
from app.database import get_db
from app.services.rss_parser_rust_bindings import parse_feeds_parallel
from app.services.source_credibility import get_signal_store

logger = get_logger(__name__)


class AddRssRequest(BaseModel):
    url: str


def _source_slug(name: str) -> str:
    return "-".join(name.lower().split())


def _derive_source_name(url: str) -> str:
    host = urlparse(url).hostname or url
    host = host.removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 2 and parts[-2] in ("co", "com", "org", "net", "gov"):
        return parts[-3].replace("-", " ").title() if len(parts) >= 3 else host
    return parts[0].replace("-", " ").title()


router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("")
async def get_sources() -> list[dict[str, Any]]:
    """Get all available RSS sources."""
    rss_sources = get_rss_sources()

    # Convert to list of sources with proper structure
    return [
        {
            "id": _source_slug(name),
            "slug": _source_slug(name),
            "name": name,
            "url": source_data.get("url"),
            "rssUrl": source_data.get("url"),  # Same as url for RSS feeds
            "category": source_data.get("category", "general"),
            "country": source_data.get("country", ""),
            "funding_type": source_data.get("funding_type", ""),
            "bias_rating": source_data.get("bias_rating", ""),
            "ownership_label": source_data.get("ownership_label", ""),
        }
        for name, source_data in rss_sources.items()
    ]


@router.post("/add-rss")
async def add_rss_source(request: AddRssRequest) -> dict[str, Any]:
    url = request.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    source_name = _derive_source_name(url)

    try:
        result = parse_feeds_parallel([(source_name, [url])], 6)
    except Exception as exc:
        logger.warning("RSS validation failed for %s: %s", url, exc)
        raise HTTPException(status_code=422, detail=f"Failed to parse RSS feed: {exc}")

    articles_payload = result.get("articles", [])
    stats_payload = result.get("source_stats", {})
    stat = stats_payload.get(source_name, {})
    status = stat.get("status", "error")
    error_message = stat.get("error_message")
    article_count = stat.get("article_count", len(articles_payload))

    if status == "error" and article_count == 0:
        detail = error_message or "Could not parse any articles from this feed"
        raise HTTPException(status_code=422, detail=detail)

    # Derive feed title from the first article's source or the stat
    feed_title = source_name
    for article in articles_payload:
        if isinstance(article, dict) and article.get("source"):
            feed_title = str(article["source"])
            break

    existing_sources = get_rss_sources()
    if feed_title in existing_sources:
        raise HTTPException(status_code=409, detail=f"Source '{feed_title}' already exists")

    # Read raw JSON for appending
    raw_sources = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    raw_sources[feed_title] = {
        "url": url,
        "category": "general",
        "country": "",
        "funding_type": "",
        "bias_rating": "",
        "ownership_label": "",
        "factual_reporting": "unknown",
    }

    _DATA_PATH.write_text(json.dumps(raw_sources, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
    reload_rss_sources()
    logger.info("Added new RSS source: %s (%s)", feed_title, url)

    return {
        "success": True,
        "name": feed_title,
        "url": url,
        "article_count": article_count,
        "status": status,
    }


_credibility_cache: dict[str, tuple[dict[str, Any], float]] = {}
_CREDIBILITY_CACHE_TTL = 86400


@router.get("/{domain}/credibility")
async def get_source_credibility(
    domain: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the 6-dimension credibility profile for a source domain.

    Endpoint: GET /api/source/{domain}/credibility
    Cache: 24 hours in-memory
    """
    now = datetime.now(timezone.utc).timestamp()
    cached = _credibility_cache.get(domain)
    if cached:
        cached_data, cached_at = cached
        if now - cached_at < _CREDIBILITY_CACHE_TTL:
            return cached_data

    store = get_signal_store()
    profile = await store.compute_single_source(db, domain)

    _credibility_cache[domain] = (profile, now)

    keys_to_drop = sorted(
        [k for k in _credibility_cache if now - _credibility_cache[k][1] >= _CREDIBILITY_CACHE_TTL],
        key=lambda k: _credibility_cache[k][1],
    )
    for key in keys_to_drop[-100:]:
        del _credibility_cache[key]

    return profile
