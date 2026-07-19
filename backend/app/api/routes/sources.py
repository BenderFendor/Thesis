"""Sources."""

from __future__ import annotations

import json
from datetime import datetime, UTC
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
    """Add Rss Request."""

    url: str


class PromoteRssRequest(BaseModel):
    """Promote Rss Request."""

    url: str
    name: str | None = None
    category: str = "general"
    country: str = ""
    source_type: str | None = None
    funding_type: str = ""
    bias_rating: str = ""
    ownership_label: str = ""
    factual_reporting: str = "unknown"
    is_paywalled: bool = False


def _source_slug(name: str) -> str:
    return "-".join(name.lower().split())


def _derive_source_name(url: str) -> str:
    host = urlparse(url).hostname or url
    host = host.removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 2 and parts[-2] in ("co", "com", "org", "net", "gov"):
        return parts[-3].replace("-", " ").title() if len(parts) >= 3 else host
    return parts[0].replace("-", " ").title()


def _normalize_source_url(url: str) -> str:
    normalized = url.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="URL is required")
    if not normalized.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    return normalized


def _domain_for_url(url: str) -> str:
    return (urlparse(url).hostname or "").removeprefix("www.").lower()


def _validate_rss_feed(url: str) -> dict[str, Any]:
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

    feed_title = source_name
    sample_articles: list[dict[str, str]] = []
    for article in articles_payload[:5]:
        if not isinstance(article, dict):
            continue
        if article.get("source"):
            feed_title = str(article["source"])
        sample_articles.append(
            {
                "title": str(article.get("title") or ""),
                "url": str(article.get("url") or article.get("link") or ""),
                "source": str(article.get("source") or feed_title),
            }
        )

    existing_sources = get_rss_sources()
    feed_domain = _domain_for_url(url)
    duplicate_candidates = []
    for name, source_data in existing_sources.items():
        source_urls = source_data.get("url")
        urls = source_urls if isinstance(source_urls, list) else [source_urls]
        for existing_url in urls:
            if not isinstance(existing_url, str):
                continue
            if existing_url == url or _domain_for_url(existing_url) == feed_domain:
                duplicate_candidates.append({"name": name, "url": existing_url})

    return {
        "success": True,
        "name": feed_title,
        "url": url,
        "article_count": article_count,
        "status": status,
        "sample_articles": sample_articles,
        "duplicate_candidates": duplicate_candidates,
        "inferred": {
            "domain": feed_domain,
            "source_type": None,
            "category": "general",
            "country": "",
            "is_paywalled": False,
        },
    }


def _promote_rss_source(request: PromoteRssRequest) -> dict[str, Any]:
    url = _normalize_source_url(request.url)
    validation = _validate_rss_feed(url)
    feed_title = (request.name or validation["name"]).strip() or validation["name"]

    existing_sources = get_rss_sources()
    if feed_title in existing_sources:
        raise HTTPException(status_code=409, detail=f"Source '{feed_title}' already exists")

    raw_sources = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    raw_sources[feed_title] = {
        "url": url,
        "category": request.category or "general",
        "country": request.country,
        "source_type": request.source_type or "",
        "funding_type": request.funding_type,
        "bias_rating": request.bias_rating,
        "ownership_label": request.ownership_label,
        "factual_reporting": request.factual_reporting,
        "is_paywalled": request.is_paywalled,
    }

    _DATA_PATH.write_text(
        json.dumps(raw_sources, indent=4, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    reload_rss_sources()
    logger.info("Promoted new RSS source: %s (%s)", feed_title, url)

    return {
        **validation,
        "name": feed_title,
        "promoted": True,
    }


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
            "source_type": source_data.get("source_type", ""),
            "is_paywalled": bool(source_data.get("is_paywalled", False)),
            "funding_type": source_data.get("funding_type", ""),
            "bias_rating": source_data.get("bias_rating", ""),
            "ownership_label": source_data.get("ownership_label", ""),
        }
        for name, source_data in rss_sources.items()
    ]


@router.post("/add-rss")
async def add_rss_source(request: AddRssRequest) -> dict[str, Any]:
    """Compatibility endpoint: validate and promote an RSS source."""
    return _promote_rss_source(PromoteRssRequest(url=request.url))


@router.post("/rss/validate")
async def validate_rss_source(request: AddRssRequest) -> dict[str, Any]:
    """Validate an RSS feed without mutating the source catalog."""
    return _validate_rss_feed(_normalize_source_url(request.url))


@router.post("/rss/promote")
async def promote_rss_source(request: PromoteRssRequest) -> dict[str, Any]:
    """Promote a reviewed RSS feed into the source catalog."""
    return _promote_rss_source(request)


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
    now = datetime.now(UTC).timestamp()
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
