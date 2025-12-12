from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import and_, desc, asc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.rss_sources import get_rss_sources
from app.database import Article, article_record_to_dict, get_db
from app.models.news import NewsArticle, NewsResponse, SourceInfo
from app.services.cache import news_cache

router = APIRouter(prefix="/news", tags=["news"])


# --- Pagination Models ---


class CursorData(BaseModel):
    """Encoded cursor containing sort value and ID for keyset pagination."""

    published_at: str
    id: int


class PaginatedResponse(BaseModel):
    """Response model for paginated article lists."""

    articles: List[Dict[str, Any]]
    total: int
    limit: int
    next_cursor: Optional[str] = None
    prev_cursor: Optional[str] = None
    has_more: bool = False


def encode_cursor(published_at: datetime, article_id: int) -> str:
    """Encode pagination cursor as base64 string."""
    data = {"published_at": published_at.isoformat(), "id": article_id}
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> CursorData:
    """Decode pagination cursor from base64 string."""
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return CursorData(published_at=data["published_at"], id=data["id"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid cursor: {e}")


@router.get("/page", response_model=PaginatedResponse)
async def get_news_paginated(
    response: Response,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    sources: Optional[str] = Query(default=None, description="Comma-separated source names for multi-select"),
    search: Optional[str] = Query(default=None),
    sort_order: str = Query(default="desc"),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse:
    """
    Paginated article endpoint with cursor-based navigation.

    Cursor pagination is more efficient than offset for large datasets:
    - Consistent performance regardless of page number
    - No "skipping" issues when new data is inserted
    - Better index utilization

    Supports filtering by:
    - category: Single category filter
    - source: Single source filter (legacy)
    - sources: Comma-separated list for multi-source filtering
    - search: Text search in title and summary

    Returns:
        PaginatedResponse with articles, cursors, and metadata
    """
    # Add cache headers for CDN/browser caching
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    response.headers["Vary"] = "Accept-Encoding"

    # Build base query filters
    filters = []

    if category:
        filters.append(Article.category == category)

    # Multi-source filter (comma-separated)
    if sources:
        source_list = [s.strip() for s in sources.split(",") if s.strip()]
        if source_list:
            filters.append(Article.source.in_(source_list))
    elif source:
        # Legacy single source filter
        filters.append(Article.source == source)

    if search:
        pattern = f"%{search}%"
        filters.append(
            or_(
                Article.title.ilike(pattern),
                Article.summary.ilike(pattern),
            )
        )

    # Apply cursor for keyset pagination
    if cursor:
        cursor_data = decode_cursor(cursor)
        cursor_dt = datetime.fromisoformat(cursor_data.published_at)

        if sort_order == "desc":
            # For descending: get items BEFORE the cursor
            filters.append(
                or_(
                    Article.published_at < cursor_dt,
                    and_(
                        Article.published_at == cursor_dt, Article.id < cursor_data.id
                    ),
                )
            )
        else:
            # For ascending: get items AFTER the cursor
            filters.append(
                or_(
                    Article.published_at > cursor_dt,
                    and_(
                        Article.published_at == cursor_dt, Article.id > cursor_data.id
                    ),
                )
            )

    # Build order clause
    if sort_order == "desc":
        order_clause = [desc(Article.published_at), desc(Article.id)]
    else:
        order_clause = [asc(Article.published_at), asc(Article.id)]

    # Execute query with limit + 1 to check if more pages exist
    if filters:
        stmt = select(Article).where(*filters).order_by(*order_clause).limit(limit + 1)
    else:
        stmt = select(Article).order_by(*order_clause).limit(limit + 1)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    # Check if there are more results
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    # Get total count (cached for performance)
    count_stmt = select(func.count()).select_from(Article)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await db.execute(count_stmt)).scalar_one()

    # Build response
    articles = [article_record_to_dict(row) for row in rows]

    # Generate next cursor from last item
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(last.published_at, last.id)

    return PaginatedResponse(
        articles=articles,
        total=total,
        limit=limit,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/page/cached", response_model=PaginatedResponse)
async def get_cached_news_paginated(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
) -> PaginatedResponse:
    """
    Paginated endpoint using in-memory cache (faster for frequently accessed data).
    Uses offset pagination since cache is in-memory array.

    Best for:
    - Initial page loads
    - Common category filters
    - Real-time updates
    """
    all_articles = news_cache.get_articles()

    # Apply filters
    filtered = all_articles

    if category:
        filtered = [a for a in filtered if a.category == category]

    if source:
        filtered = [a for a in filtered if a.source == source]

    if search:
        search_lower = search.lower()
        filtered = [
            a
            for a in filtered
            if search_lower in (a.title or "").lower()
            or search_lower in (a.summary or "").lower()
        ]

    total = len(filtered)

    # Apply pagination
    paginated = filtered[offset : offset + limit]

    # Convert to dict format
    articles = [
        {
            "id": a.id,
            "title": a.title,
            "source": a.source,
            "source_id": a.source_id,
            "country": a.country,
            "credibility": a.credibility,
            "bias": a.bias,
            "summary": a.summary,
            "content": a.content,
            "image": a.image,
            "image_url": a.image,
            "published_at": a.published,
            "category": a.category,
            "url": a.url,
            "tags": a.tags,
            "original_language": a.original_language,
            "translated": a.translated,
        }
        for a in paginated
    ]

    has_more = offset + limit < total
    next_cursor = str(offset + limit) if has_more else None

    return PaginatedResponse(
        articles=articles,
        total=total,
        limit=limit,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/source/{source_name}", response_model=List[NewsArticle])
async def get_news_by_source(source_name: str) -> List[NewsArticle]:
    rss_sources = get_rss_sources()
    if source_name not in rss_sources:
        raise HTTPException(status_code=404, detail="Source not found")

    all_articles = news_cache.get_articles()
    return [article for article in all_articles if article.source == source_name]


@router.get("/category/{category_name}", response_model=NewsResponse)
async def get_news_by_category(category_name: str) -> NewsResponse:
    all_articles = news_cache.get_articles()
    category_articles = [
        article for article in all_articles if article.category == category_name
    ]
    sources_included = list({article.source for article in category_articles})

    return NewsResponse(
        articles=category_articles,
        total=len(category_articles),
        sources=sources_included,
    )


@router.get("/sources", response_model=List[SourceInfo])
async def get_sources() -> List[SourceInfo]:
    sources: List[SourceInfo] = []
    for name, info in get_rss_sources().items():
        url_field = info.get("url")
        url = url_field[0] if isinstance(url_field, list) and url_field else url_field
        sources.append(
            SourceInfo(
                name=name,
                url=url,
                category=info.get("category", "general"),
                country=info.get("country", "US"),
                funding_type=info.get("funding_type"),
                bias_rating=info.get("bias_rating"),
            )
        )
    return sources


@router.get("/categories")
async def get_categories() -> Dict[str, List[str]]:
    categories = {
        info.get("category", "general") for info in get_rss_sources().values()
    }
    return {"categories": list(categories)}


@router.get("/sources/stats")
async def get_source_stats() -> Dict[str, object]:
    """Return stats for all configured sources."""
    configured_sources = get_rss_sources()
    source_stats = news_cache.get_source_stats()

    # Create a map of existing stats by name
    stats_map = {stat["name"]: stat for stat in source_stats}

    # Ensure all configured sources are in the response
    all_stats = []
    for source_name, source_info in configured_sources.items():
        if source_name in stats_map:
            all_stats.append(stats_map[source_name])
        else:
            all_stats.append(
                {
                    "name": source_name,
                    "url": source_info.get("url", ""),
                    "category": source_info.get("category", "general"),
                    "country": source_info.get("country", ""),
                    "funding_type": source_info.get("funding_type"),
                    "bias_rating": source_info.get("bias_rating"),
                    "article_count": 0,
                    "status": "pending",
                    "error_message": None,
                    "last_checked": None,
                }
            )

    return {"sources": all_stats, "total_sources": len(all_stats)}
