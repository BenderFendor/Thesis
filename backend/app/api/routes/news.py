from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.rss_sources import get_rss_sources
from app.database import (
    Article,
    SourceMetadata,
    article_record_to_dict,
    build_article_keyword_search,
    count_articles_by_keyword,
    get_total_article_count,
    get_session_dialect_name,
    get_db,
    search_article_records_by_keyword,
)
from app.models.news import NewsArticle, NewsResponse, SourceInfo
from app.services.country_mentions import country_name
from app.services.cache import news_cache

router = APIRouter(prefix="/news", tags=["news"])


def _source_slug(name: str) -> str:
    return "-".join(name.lower().split())


def _selected_sources(
    source: Optional[str],
    sources: Optional[str],
) -> Optional[List[str]]:
    rss_sources = get_rss_sources()
    exact_name_lookup = {name.lower(): name for name in rss_sources.keys()}
    slug_lookup = {_source_slug(name): name for name in rss_sources.keys()}

    def resolve_source_name(candidate: str) -> str:
        stripped = candidate.strip()
        if not stripped:
            return ""

        if stripped in rss_sources:
            return stripped

        lowered = stripped.lower()
        if lowered in exact_name_lookup:
            return exact_name_lookup[lowered]

        return slug_lookup.get(lowered, stripped)

    if sources:
        parsed_sources = [candidate.strip() for candidate in sources.split(",")]
        selected = [
            resolved
            for candidate in parsed_sources
            if (resolved := resolve_source_name(candidate))
        ]
        if selected:
            return list(dict.fromkeys(selected))

    if source:
        resolved = resolve_source_name(source)
        if resolved:
            return [resolved]

    return None


# --- Pagination Models ---


class CursorData(BaseModel):
    """Encoded cursor containing sort value and ID for keyset pagination."""

    published_at: str
    id: int
    search_rank: Optional[float] = None


class PaginatedResponse(BaseModel):
    """Response model for paginated article lists."""

    articles: List[Dict[str, Any]]
    total: int
    limit: int
    next_cursor: Optional[str] = None
    prev_cursor: Optional[str] = None
    has_more: bool = False


class RecentPageResponse(BaseModel):
    """Lightweight response for recent articles without total counts."""

    articles: List[Dict[str, Any]]
    limit: int
    next_cursor: Optional[str] = None
    has_more: bool = False


class BrowseIndexResponse(BaseModel):
    """Lightweight full-corpus response for browse views."""

    articles: List[Dict[str, Any]]
    total: int


def _compact_summary(summary: Optional[str], limit: int = 280) -> Optional[str]:
    if summary is None:
        return None

    normalized = " ".join(summary.split())
    if len(normalized) <= limit:
        return normalized

    truncated = normalized[:limit].rsplit(" ", 1)[0].strip()
    if not truncated:
        truncated = normalized[:limit].strip()
    return f"{truncated}..."


def _browse_article_to_dict(row: Mapping[str, Any]) -> Dict[str, Any]:
    published_at = row.get("published_at")
    published = published_at.isoformat() if published_at is not None else None
    summary = _compact_summary(cast(Optional[str], row.get("summary")))

    return {
        "id": row.get("id"),
        "title": row.get("title") or "Untitled article",
        "source": row.get("source") or "Unknown",
        "source_id": row.get("source_id"),
        "country": row.get("country"),
        "credibility": row.get("credibility"),
        "bias": row.get("bias"),
        "summary": summary,
        "description": summary,
        "image": row.get("image_url"),
        "image_url": row.get("image_url"),
        "published": published,
        "published_at": published,
        "category": row.get("category") or "general",
        "url": row.get("url"),
        "link": row.get("url"),
        "author": row.get("author"),
        "authors": row.get("authors") or [],
    }


def _browse_search_country_codes(search: Optional[str]) -> List[str]:
    normalized = " ".join((search or "").split()).strip().lower()
    if not normalized or " " in normalized:
        return []

    supported_codes = [
        "US",
        "CN",
        "GB",
        "DE",
        "FR",
        "RU",
        "UA",
        "IL",
        "PS",
        "IR",
        "TW",
        "JP",
        "KR",
        "KP",
    ]
    return [
        code
        for code in supported_codes
        if code.lower() == normalized or country_name(code).lower() == normalized
    ]


def _browse_text_match(row: Mapping[str, Any], term: str) -> bool:
    normalized = term.strip().lower()
    if not normalized:
        return False

    fields = [
        row.get("title"),
        row.get("summary"),
        row.get("source"),
        row.get("category"),
    ]
    return any(
        isinstance(value, str) and normalized in value.lower() for value in fields
    )


def _browse_sort_timestamp(row: Mapping[str, Any]) -> float:
    published_at = row.get("published_at")
    if isinstance(published_at, datetime):
        return published_at.timestamp()
    return 0.0


def _browse_sort_day(row: Mapping[str, Any]) -> int:
    published_at = row.get("published_at")
    if isinstance(published_at, datetime):
        return published_at.date().toordinal()
    return 0


def _browse_country_match(row: Mapping[str, Any], search: str) -> bool:
    country_codes = set(_browse_search_country_codes(search))
    mentioned = row.get("mentioned_countries")
    if not country_codes or not isinstance(mentioned, list):
        return False
    return any(isinstance(code, str) and code in country_codes for code in mentioned)


def _browse_match_bucket(row: Mapping[str, Any], search: str) -> int:
    if _browse_text_match(row, search):
        return 0
    if _browse_country_match(row, search):
        return 1
    return 2


_BROWSE_SELECT_COLUMNS = (
    Article.id.label("id"),
    Article.title.label("title"),
    Article.source.label("source"),
    Article.source_id.label("source_id"),
    Article.country.label("country"),
    Article.credibility.label("credibility"),
    Article.bias.label("bias"),
    Article.summary.label("summary"),
    Article.image_url.label("image_url"),
    Article.published_at.label("published_at"),
    Article.category.label("category"),
    Article.url.label("url"),
    Article.author.label("author"),
    Article.authors.label("authors"),
    Article.mentioned_countries.label("mentioned_countries"),
)


def encode_cursor(
    published_at: datetime,
    article_id: int,
    search_rank: Optional[float] = None,
) -> str:
    """Encode pagination cursor as base64 string."""
    data = {
        "published_at": published_at.isoformat(),
        "id": article_id,
        "search_rank": search_rank,
    }
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> CursorData:
    """Decode pagination cursor from base64 string."""
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return CursorData(
            published_at=data["published_at"],
            id=data["id"],
            search_rank=data.get("search_rank"),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid cursor: {e}")


@router.get("/page", response_model=PaginatedResponse)
async def get_news_paginated(
    response: Response,
    limit: int = Query(default=50, ge=1, le=500),
    cursor: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    sources: Optional[str] = Query(
        default=None, description="Comma-separated source names for multi-select"
    ),
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
    cursor_data: Optional[CursorData] = None
    cursor_dt: Optional[datetime] = None
    search_dialect_name = get_session_dialect_name(db) if search else ""

    if category:
        filters.append(Article.category == category)

    selected_sources = _selected_sources(source=source, sources=sources)
    if selected_sources:
        filters.append(Article.source.in_(selected_sources))

    # Apply cursor for keyset pagination
    if cursor and search_dialect_name != "postgresql":
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

    if search:
        normalized_search = " ".join(search.split())
        match_filter, rank, order_by = build_article_keyword_search(
            normalized_search,
            search_dialect_name,
        )
        search_filters = [*filters, match_filter]

        if rank is not None:
            if cursor:
                cursor_data = decode_cursor(cursor)
                cursor_dt = datetime.fromisoformat(cursor_data.published_at)
            if (
                cursor_data is not None
                and cursor_dt is not None
                and cursor_data.search_rank is not None
            ):
                search_filters.append(
                    or_(
                        rank < cursor_data.search_rank,
                        and_(
                            rank == cursor_data.search_rank,
                            Article.published_at < cursor_dt,
                        ),
                        and_(
                            rank == cursor_data.search_rank,
                            Article.published_at == cursor_dt,
                            Article.id < cursor_data.id,
                        ),
                    )
                )
            stmt = (
                select(Article, rank)
                .where(*search_filters)
                .order_by(*order_by)
                .limit(limit + 1)
            )
            result = await db.execute(stmt)
            ranked_rows = result.all()
            rows = [row[0] for row in ranked_rows]
            row_ranks = [float(row[1]) for row in ranked_rows]
        else:
            rows = await search_article_records_by_keyword(
                db,
                query=normalized_search,
                limit=limit + 1,
                filters=filters,
            )
            row_ranks = []
    else:
        # Execute query with limit + 1 to check if more pages exist
        if sort_order == "desc":
            if filters:
                stmt = (
                    select(Article)
                    .where(*filters)
                    .order_by(desc(Article.published_at), desc(Article.id))
                    .limit(limit + 1)
                )
            else:
                stmt = (
                    select(Article)
                    .order_by(desc(Article.published_at), desc(Article.id))
                    .limit(limit + 1)
                )
        else:
            if filters:
                stmt = (
                    select(Article)
                    .where(*filters)
                    .order_by(asc(Article.published_at), asc(Article.id))
                    .limit(limit + 1)
                )
            else:
                stmt = (
                    select(Article)
                    .order_by(asc(Article.published_at), asc(Article.id))
                    .limit(limit + 1)
                )

        result = await db.execute(stmt)
        rows = list(result.scalars().all())
        row_ranks = []

    # Check if there are more results
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]
        row_ranks = row_ranks[:limit]

    # Get total count (cached for performance)
    if search:
        total = await count_articles_by_keyword(db, query=search, filters=filters)
    else:
        if filters:
            count_stmt = select(func.count()).select_from(Article).where(*filters)
            total = int((await db.execute(count_stmt)).scalar_one())
        else:
            total = await get_total_article_count(db)

    # Build response
    articles = [article_record_to_dict(row) for row in rows]

    # Generate next cursor from last item
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        last_published_at = cast(Optional[datetime], last.published_at)
        last_id = cast(Optional[int], last.id)
        if last_published_at is not None and last_id is not None:
            last_rank = row_ranks[-1] if row_ranks else None
            next_cursor = encode_cursor(last_published_at, last_id, last_rank)

    return PaginatedResponse(
        articles=articles,
        total=total,
        limit=limit,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/page/cached", response_model=PaginatedResponse)
async def get_cached_news_paginated(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    sources: Optional[str] = Query(
        default=None, description="Comma-separated source names for multi-select"
    ),
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

    selected_sources = _selected_sources(source=source, sources=sources)
    if selected_sources:
        selected_source_names = set(selected_sources)
        filtered = [a for a in filtered if a.source in selected_source_names]

    if search:
        search_lower = search.lower()
        filtered = [
            a
            for a in filtered
            if search_lower in (a.title or "").lower()
            or search_lower in (a.description or "").lower()
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
            "source_id": _source_slug(a.source),
            "country": a.country,
            "credibility": "UNKNOWN",
            "bias": "UNKNOWN",
            "summary": a.description,
            "content": None,
            "image": a.image,
            "image_url": a.image,
            "published_at": a.published,
            "category": a.category,
            "url": a.link,
            "author": a.author,
            "authors": a.authors,
            "tags": None,
            "mentioned_countries": a.mentioned_countries,
            "original_language": None,
            "translated": False,
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


@router.get("/index", response_model=BrowseIndexResponse)
async def get_browse_index(
    response: Response,
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    sources: Optional[str] = Query(
        default=None, description="Comma-separated source names for multi-select"
    ),
    search: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> BrowseIndexResponse:
    """Return lightweight article cards for the full browse corpus."""
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    response.headers["Vary"] = "Accept-Encoding"

    filters = []
    search_dialect_name = get_session_dialect_name(db) if search else ""

    if category:
        filters.append(Article.category == category)

    selected_sources = _selected_sources(source=source, sources=sources)
    if selected_sources:
        filters.append(Article.source.in_(selected_sources))

    if search:
        normalized_search = " ".join(search.split())
        match_filter, rank, order_by = build_article_keyword_search(
            normalized_search,
            search_dialect_name,
        )
        country_codes = _browse_search_country_codes(normalized_search)
        if country_codes:
            clauses = [
                *filters,
                or_(
                    match_filter,
                    *[
                        Article.mentioned_countries.contains([code])
                        for code in country_codes
                    ],
                ),
            ]
        else:
            clauses = [*filters, match_filter]

        if rank is not None:
            stmt = (
                select(*_BROWSE_SELECT_COLUMNS, rank)
                .where(*clauses)
                .order_by(*order_by)
            )
            result = await db.execute(stmt)
            rows = result.mappings().all()
        else:
            stmt = (
                select(*_BROWSE_SELECT_COLUMNS)
                .where(*clauses)
                .order_by(desc(Article.published_at), desc(Article.id))
            )
            result = await db.execute(stmt)
            rows = result.mappings().all()
    else:
        stmt = select(*_BROWSE_SELECT_COLUMNS)
        if filters:
            stmt = stmt.where(*filters)
        stmt = stmt.order_by(desc(Article.published_at), desc(Article.id))
        result = await db.execute(stmt)
        rows = result.mappings().all()

    row_mappings = [cast(Mapping[str, Any], row) for row in rows]
    if search and _browse_search_country_codes(search):
        normalized_search = " ".join(search.split())
        row_mappings.sort(
            key=lambda row: (
                -_browse_sort_day(row),
                _browse_match_bucket(row, normalized_search),
                -_browse_sort_timestamp(row),
                -int(row.get("id") or 0),
            )
        )

    articles = [_browse_article_to_dict(row) for row in row_mappings]

    return BrowseIndexResponse(
        articles=articles,
        total=len(articles),
    )


@router.get("/recent", response_model=RecentPageResponse)
async def get_recent_news(
    limit: int = Query(default=50, ge=1, le=500),
    cursor: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> RecentPageResponse:
    """
    Lightweight recent articles endpoint for historical paging.

    Uses keyset pagination and avoids total counts for faster queries.
    """
    filters = []

    if category:
        filters.append(Article.category == category)

    if source:
        filters.append(Article.source == source)

    if cursor:
        cursor_data = decode_cursor(cursor)
        cursor_dt = datetime.fromisoformat(cursor_data.published_at)
        filters.append(
            or_(
                Article.published_at < cursor_dt,
                and_(Article.published_at == cursor_dt, Article.id < cursor_data.id),
            )
        )

    stmt = (
        (select(Article).where(*filters) if filters else select(Article))
        .order_by(desc(Article.published_at), desc(Article.id))
        .limit(limit + 1)
    )

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    articles = [article_record_to_dict(row) for row in rows]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        last_published_at = last.published_at
        last_id = last.id
        if last_published_at is not None and last_id is not None:
            next_cursor = encode_cursor(last_published_at, last_id)

    return RecentPageResponse(
        articles=articles,
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
async def get_sources(db: AsyncSession = Depends(get_db)) -> List[SourceInfo]:
    metadata_by_name: Dict[str, SourceMetadata] = {}
    try:
        meta_result = await db.execute(select(SourceMetadata))
        for metadata_entry in meta_result.scalars().all():
            source_name = cast(
                Optional[str], getattr(metadata_entry, "source_name", None)
            )
            if not isinstance(source_name, str) or source_name == "":
                continue
            metadata_by_name[source_name] = metadata_entry
    except Exception:
        metadata_by_name = {}

    sources: List[SourceInfo] = []
    for name, info in get_rss_sources().items():
        url_field = info.get("url")
        url = ""
        if isinstance(url_field, list):
            first_url = url_field[0] if url_field else None
            if isinstance(first_url, str):
                url = first_url
        elif isinstance(url_field, str):
            url = url_field

        category = info.get("category")
        country = info.get("country")
        funding_type = info.get("funding_type")
        bias_rating = info.get("bias_rating")
        ownership_label = info.get("ownership_label")
        meta: Optional[SourceMetadata] = metadata_by_name.get(name)
        factual_rating = (
            cast(Optional[str], getattr(meta, "factual_rating", None)) if meta else None
        )
        credibility_score = (
            float(cast(float, meta.credibility_score))
            if meta and meta.credibility_score is not None
            else None
        )
        sources.append(
            SourceInfo(
                id=_source_slug(name),
                slug=_source_slug(name),
                name=name,
                url=url,
                category=category if isinstance(category, str) else "general",
                country=country if isinstance(country, str) else "US",
                funding_type=funding_type if isinstance(funding_type, str) else None,
                bias_rating=bias_rating if isinstance(bias_rating, str) else None,
                ownership_label=(
                    ownership_label if isinstance(ownership_label, str) else None
                ),
                factual_rating=factual_rating,
                credibility_score=credibility_score,
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
    stats_map: Dict[str, Dict[str, object]] = {}
    for stat in source_stats:
        stat_name = stat.get("name")
        if isinstance(stat_name, str):
            stats_map[stat_name] = stat

    # Ensure all configured sources are in the response
    all_stats: List[Dict[str, object]] = []
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
                    "ownership_label": source_info.get("ownership_label"),
                    "article_count": 0,
                    "status": "pending",
                    "error_message": None,
                    "last_checked": None,
                }
            )

    return {"sources": all_stats, "total_sources": len(all_stats)}
