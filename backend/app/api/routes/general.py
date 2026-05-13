"""General."""

from __future__ import annotations

from datetime import datetime, UTC

from fastapi import APIRouter

from app.data.rss_sources import get_rss_sources

router = APIRouter(tags=["general"])


@router.get("/", response_model=dict[str, str])
async def read_root() -> dict[str, str]:
    """Read Root."""
    return {
        "message": "Global News Aggregation API is running!",
        "version": "1.0.0",
        "docs": "/docs",
    }


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health Check."""
    return {"status": "healthy", "timestamp": datetime.now(UTC).isoformat()}


@router.get("/categories")
async def get_categories() -> dict[str, list[str]]:
    """Return configured source categories.

    The frontend calls this as a top-level endpoint.
    """
    categories = {info.get("category", "general") for info in get_rss_sources().values()}
    return {"categories": sorted(categories)}
