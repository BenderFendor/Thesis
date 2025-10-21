from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.data.rss_sources import get_rss_sources

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("")
async def get_sources() -> list[dict[str, Any]]:
    """Get all available RSS sources."""
    rss_sources = get_rss_sources()

    # Convert to list of sources with proper structure
    sources = []
    for name, source_data in rss_sources.items():
        sources.append(
            {
                "name": name,
                "url": source_data.get("url"),
                "rssUrl": source_data.get("url"),  # Same as url for RSS feeds
                "category": source_data.get("category", "general"),
                "country": source_data.get("country", ""),
                "funding_type": source_data.get("funding_type", ""),
                "bias_rating": source_data.get("bias_rating", ""),
            }
        )

    return sources
