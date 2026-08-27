"""News browsing, pagination, ranking, and source metadata routes."""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.data.rss_sources import get_rss_sources
from app.database import (
    Article,
    SourceMetadata,
    article_record_to_dict,
    build_article_keyword_search,
    count_articles_by_keyword,
    get_db,
    get_session_dialect_name,
    get_total_article_count,
    search_article_records_by_keyword,
)
from app.models.news import NewsArticle, NewsResponse, SourceInfo
from app.services.cache import news_cache
from app.services.country_mentions import country_name
from app.services.rss_parser_rust_bindings import rank_articles as rust_rank_articles

router = APIRouter(prefix="/news", tags=["news"])


def _source_slug(name: str) -> str:
    return "-".join(name.lower().split())


def _source_resolver() -> tuple[dict[str, str], dict[str, str]]:
    configured = get_rss_sources()
    return (
        {name.lower(): name for name in configured},
        {_source_slug(name): name for name in configured},
    )


def _resolve_source_name(candidate: str) -> str:
    configured = get_rss_sources()
    exact, slugs = _source_resolver()
    stripped = candidate.strip()
    if not stripped:
        return ""
    if stripped in configured:
        return stripped
    lowered = stripped.lower()
    return exact.get(lowered, slugs.get(lowered, stripped))


def _selected_sources(source: str | None, sources: str | None) -> list[str] | None:
    if sources:
        selected = [
            resolved
            for candidate in sources.split(",")
            if (resolved := _resolve_source_name(candidate))
        ]
        if selected:
            return list(dict.fromkeys(selected))
    if source and (resolved := _resolve_source_name(source)):
        return [resolved]
    return None


class CursorData(BaseModel):
    published_at: str
    id: int
    search_rank: float | None = None


class PaginatedResponse(BaseModel):
    articles: list[dict[str, Any]]
    total: int
    limit: int
    next_cursor: str | None = None
    prev_cursor: str | None = None
    has_more: bool = False


class RecentPageResponse(BaseModel):
    articles: list[dict[str, Any]]
    limit: int
    next_cursor: str | None = None
    has_more: bool = False


class BrowseIndexResponse(BaseModel):
    articles: list[dict[str, Any]]
    total: int


class RankRequest(BaseModel):
    articles: list[dict[str, Any]]
    liked_article_ids: list[int] = Field(default_factory=list)
    bookmarked_article_ids: list[int] = Field(default_factory=list)
    favorite_source_ids: list[str] = Field(default_factory=list)


class RankResponse(BaseModel):
    articles: list[dict[str, Any]]
    total: int


def _compact_summary(summary: str | None, limit: int = 280) -> str | None:
    if summary is None:
        return None
    normalized = " ".join(summary.split())
    if len(normalized) <= limit:
        return normalized
    truncated = normalized[:limit].rsplit(" ", 1)[0].strip() or normalized[:limit].strip()
    return f"{truncated}..."


def _browse_article_to_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    published_at = row.get("published_at")
    published = published_at.isoformat() if isinstance(published_at, datetime) else None
    summary = _compact_summary(cast(str | None, row.get("summary")))
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
        "author_urls": row.get("author_urls") or [],
    }


def _cached_article_to_dict(article: NewsArticle) -> dict[str, Any]:
    return {
        "id": article.id,
        "article_id": article.id,
        "title": article.title,
        "source": article.source,
        "source_id": _source_slug(article.source),
        "country": article.country,
        "credibility": "UNKNOWN",
        "bias": "UNKNOWN",
        "summary": article.description,
        "content": None,
        "image": article.image,
        "image_url": article.image,
        "published_at": article.published,
        "category": article.category,
        "url": article.link,
        "author": article.author,
        "authors": article.authors,
        "author_urls": article.author_urls,
        "tags": None,
        "mentioned_countries": article.mentioned_countries,
        "original_language": None,
        "translated": False,
        "is_persisted": article.id is not None,
    }


def _matches_cache_search(article: NewsArticle, search: str) -> bool:
    normalized = search.lower()
    return normalized in (article.title or "").lower() or normalized in (
        article.description or ""
    ).lower()


def _filter_cached_articles(
    *,
    category: str | None,
    source: str | None,
    sources: str | None,
    search: str | None,
) -> list[NewsArticle]:
    selected = set(_selected_sources(source, sources) or [])
    return [
        article
        for article in news_cache.get_articles()
        if (not category or article.category == category)
        and (not selected or article.source in selected)
        and (not search or _matches_cache_search(article, search))
    ]


def _browse_search_country_codes(search: str | None) -> list[str]:
    normalized = " ".join((search or "").split()).strip().lower()
    if not normalized or " " in normalized:
        return []
    supported = ("US", "CN", "GB", "DE", "FR", "RU", "UA", "IL", "PS", "IR", "TW", "JP", "KR", "KP")
    return [
        code
        for code in supported
        if code.lower() == normalized or country_name(code).lower() == normalized
    ]


def _browse_text_match(row: Mapping[str, Any], term: str) -> bool:
    normalized = term.strip().lower()
    fields = (row.get("title"), row.get("summary"), row.get("source"), row.get("category"))
    return bool(
        normalized
        and any(isinstance(value, str) and normalized in value.lower() for value in fields)
    )


def _browse_country_match(row: Mapping[str, Any], search: str) -> bool:
    countries = set(_browse_search_country_codes(search))
    mentioned = row.get("mentioned_countries")
    return bool(
        countries
        and isinstance(mentioned, list)
        and any(isinstance(code, str) and code in countries for code in mentioned)
    )


def _browse_match_bucket(row: Mapping[str, Any], search: str) -> int:
    if _browse_text_match(row, search):
        return 0
    return 1 if _browse_country_match(row, search) else 2


def _browse_sort_timestamp(row: Mapping[str, Any]) -> float:
    value = row.get("published_at")
    return value.timestamp() if isinstance(value, datetime) else 0.0


def _browse_sort_day(row: Mapping[str, Any]) -> int:
    value = row.get("published_at")
    return value.date().toordinal() if isinstance(value, datetime) else 0


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
    Article.author_urls.label("author_urls"),
    Article.mentioned_countries.label("mentioned_countries"),
)


def encode_cursor(
    published_at: datetime, article_id: int, search_rank: float | None = None
) -> str:
    data = {
        "published_at": published_at.isoformat(),
        "id": article_id,
        "search_rank": search_rank,
    }
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> CursorData:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return CursorData(
            published_at=data["published_at"],
            id=data["id"],
            search_rank=data.get("search_rank"),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid cursor: {exc}") from exc


def _base_filters(
    category: str | None, source: str | None, sources: str | None
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    if category:
        filters.append(Article.category == category)
    selected = _selected_sources(source, sources)
    if selected:
        filters.append(Article.source.in_(selected))
    return filters


def _cursor_filter(cursor_data: CursorData, sort_order: str) -> ColumnElement[bool]:
    cursor_dt = datetime.fromisoformat(cursor_data.published_at)
    comparison = Article.published_at < cursor_dt if sort_order == "desc" else Article.published_at > cursor_dt
    id_comparison = Article.id < cursor_data.id if sort_order == "desc" else Article.id > cursor_data.id
    return or_(comparison, and_(Article.published_at == cursor_dt, id_comparison))


def _rank_cursor_filter(rank: Any, cursor_data: CursorData) -> ColumnElement[bool] | None:
    if cursor_data.search_rank is None:
        return None
    cursor_dt = datetime.fromisoformat(cursor_data.published_at)
    return or_(
        rank < cursor_data.search_rank,
        and_(rank == cursor_data.search_rank, Article.published_at < cursor_dt),
        and_(
            rank == cursor_data.search_rank,
            Article.published_at == cursor_dt,
            Article.id < cursor_data.id,
        ),
    )


async def _search_page_rows(
    db: AsyncSession,
    search: str,
    dialect: str,
    filters: list[ColumnElement[bool]],
    cursor: str | None,
    limit: int,
) -> tuple[list[Article], list[float]]:
    normalized = " ".join(search.split())
    match_filter, rank, order_by = build_article_keyword_search(normalized, dialect)
    search_filters = [*filters, match_filter]
    if rank is None:
        rows = await search_article_records_by_keyword(
            db, query=normalized, limit=limit + 1, filters=filters
        )
        return list(rows), []
    if cursor and (rank_cursor := _rank_cursor_filter(rank, decode_cursor(cursor))) is not None:
        search_filters.append(rank_cursor)
    statement = select(Article, rank).where(*search_filters).order_by(*order_by).limit(limit + 1)
    ranked_rows = (await db.execute(statement)).all()
    return [row[0] for row in ranked_rows], [float(row[1]) for row in ranked_rows]


async def _plain_page_rows(
    db: AsyncSession,
    filters: list[ColumnElement[bool]],
    sort_order: str,
    limit: int,
) -> list[Article]:
    order = (
        (desc(Article.published_at), desc(Article.id))
        if sort_order == "desc"
        else (asc(Article.published_at), asc(Article.id))
    )
    statement = select(Article)
    if filters:
        statement = statement.where(*filters)
    statement = statement.order_by(*order).limit(limit + 1)
    return list((await db.execute(statement)).scalars().all())


async def _page_total(
    db: AsyncSession,
    search: str | None,
    filters: list[ColumnElement[bool]],
) -> int:
    if search:
        return await count_articles_by_keyword(db, query=search, filters=filters)
    if not filters:
        return await get_total_article_count(db)
    statement = select(func.count()).select_from(Article).where(*filters)
    return int((await db.execute(statement)).scalar_one())


def _trim_page(rows: list[Article], ranks: list[float], limit: int) -> tuple[list[Article], list[float], bool]:
    has_more = len(rows) > limit
    return rows[:limit], ranks[:limit], has_more


def _next_page_cursor(rows: list[Article], ranks: list[float], has_more: bool) -> str | None:
    if not has_more or not rows:
        return None
    last = rows[-1]
    if last.published_at is None or last.id is None:
        return None
    return encode_cursor(last.published_at, int(last.id), ranks[-1] if ranks else None)


@router.get("/page", response_model=PaginatedResponse)
async def get_news_paginated(
    response: Response,
    limit: int = Query(default=50, ge=1, le=500),
    cursor: str | None = Query(default=None),
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    sources: str | None = Query(default=None, description="Comma-separated source names for multi-select"),
    search: str | None = Query(default=None),
    sort_order: str = Query(default="desc"),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse:
    """Return a cursor-paginated article page with optional source/search filters."""
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    response.headers["Vary"] = "Accept-Encoding"
    dialect = get_session_dialect_name(db) if search else ""
    filters = _base_filters(category, source, sources)
    if cursor and dialect != "postgresql":
        filters.append(_cursor_filter(decode_cursor(cursor), sort_order))
    if search:
        rows, ranks = await _search_page_rows(db, search, dialect, filters, cursor, limit)
    else:
        rows = await _plain_page_rows(db, filters, sort_order, limit)
        ranks = []
    rows, ranks, has_more = _trim_page(rows, ranks, limit)
    return PaginatedResponse(
        articles=[article_record_to_dict(row) for row in rows],
        total=await _page_total(db, search, filters),
        limit=limit,
        next_cursor=_next_page_cursor(rows, ranks, has_more),
        has_more=has_more,
    )


@router.get("/page/cached", response_model=PaginatedResponse)
async def get_cached_news_paginated(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    sources: str | None = Query(default=None, description="Comma-separated source names for multi-select"),
    search: str | None = Query(default=None),
) -> PaginatedResponse:
    filtered = _filter_cached_articles(category=category, source=source, sources=sources, search=search)
    total = len(filtered)
    paginated = filtered[offset : offset + limit]
    has_more = offset + limit < total
    return PaginatedResponse(
        articles=[_cached_article_to_dict(article) for article in paginated],
        total=total,
        limit=limit,
        next_cursor=str(offset + limit) if has_more else None,
        has_more=has_more,
    )


@router.get("/index/cached", response_model=BrowseIndexResponse)
async def get_cached_browse_index(
    response: Response,
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    sources: str | None = Query(default=None, description="Comma-separated source names for multi-select"),
    search: str | None = Query(default=None),
) -> BrowseIndexResponse:
    response.headers["Cache-Control"] = "public, max-age=5, stale-while-revalidate=15"
    response.headers["Vary"] = "Accept-Encoding"
    articles = _filter_cached_articles(category=category, source=source, sources=sources, search=search)
    return BrowseIndexResponse(
        articles=[_cached_article_to_dict(article) for article in articles],
        total=len(articles),
    )


def _browse_search_clauses(
    filters: list[ColumnElement[bool]], search: str, dialect: str
) -> tuple[list[ColumnElement[bool]], Any, Sequence[Any]]:
    match_filter, rank, order_by = build_article_keyword_search(search, dialect)
    countries = _browse_search_country_codes(search)
    search_filter = (
        or_(match_filter, *(Article.mentioned_countries.contains([code]) for code in countries))
        if countries
        else match_filter
    )
    return [*filters, search_filter], rank, order_by


async def _browse_rows(
    db: AsyncSession,
    filters: list[ColumnElement[bool]],
    search: str | None,
) -> list[Mapping[str, Any]]:
    if not search:
        statement = select(*_BROWSE_SELECT_COLUMNS)
        if filters:
            statement = statement.where(*filters)
        statement = statement.order_by(desc(Article.published_at), desc(Article.id))
        return [cast(Mapping[str, Any], row) for row in (await db.execute(statement)).mappings().all()]

    normalized = " ".join(search.split())
    clauses, rank, order_by = _browse_search_clauses(
        filters, normalized, get_session_dialect_name(db)
    )
    columns = (*_BROWSE_SELECT_COLUMNS, rank) if rank is not None else _BROWSE_SELECT_COLUMNS
    statement = select(*columns).where(*clauses)
    statement = statement.order_by(*order_by) if rank is not None else statement.order_by(
        desc(Article.published_at), desc(Article.id)
    )
    return [cast(Mapping[str, Any], row) for row in (await db.execute(statement)).mappings().all()]


def _sort_country_browse_rows(rows: list[Mapping[str, Any]], search: str | None) -> None:
    if not search or not _browse_search_country_codes(search):
        return
    normalized = " ".join(search.split())
    rows.sort(
        key=lambda row: (
            -_browse_sort_day(row),
            _browse_match_bucket(row, normalized),
            -_browse_sort_timestamp(row),
            -int(row.get("id") or 0),
        )
    )


@router.get("/index", response_model=BrowseIndexResponse)
async def get_browse_index(
    response: Response,
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    sources: str | None = Query(default=None, description="Comma-separated source names for multi-select"),
    search: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> BrowseIndexResponse:
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    response.headers["Vary"] = "Accept-Encoding"
    rows = await _browse_rows(db, _base_filters(category, source, sources), search)
    _sort_country_browse_rows(rows, search)
    articles = [_browse_article_to_dict(row) for row in rows]
    return BrowseIndexResponse(articles=articles, total=len(articles))


def _recent_filters(
    category: str | None, source: str | None, cursor: str | None
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = []
    if category:
        filters.append(Article.category == category)
    if source:
        filters.append(Article.source == source)
    if cursor:
        filters.append(_cursor_filter(decode_cursor(cursor), "desc"))
    return filters


@router.get("/recent", response_model=RecentPageResponse)
async def get_recent_news(
    limit: int = Query(default=50, ge=1, le=500),
    cursor: str | None = Query(default=None),
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> RecentPageResponse:
    filters = _recent_filters(category, source, cursor)
    rows = await _plain_page_rows(db, filters, "desc", limit)
    rows, _, has_more = _trim_page(rows, [], limit)
    return RecentPageResponse(
        articles=[article_record_to_dict(row) for row in rows],
        limit=limit,
        next_cursor=_next_page_cursor(rows, [], has_more),
        has_more=has_more,
    )


def _fallback_ranks(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "article_id": article.get("id", 0),
            "total_score": 0,
            "bucket_rank": 0,
            "bucket_label": "default",
            "keyword_score": 0,
            "category_score": 0,
            "source_score": 0,
            "matched_keywords": [],
            "matched_categories": [],
            "matched_source": None,
        }
        for article in articles
    ]


def _ranked_results(request: RankRequest) -> list[dict[str, Any]]:
    try:
        return rust_rank_articles(
            articles=request.articles,
            liked_article_ids=request.liked_article_ids,
            bookmarked_article_ids=request.bookmarked_article_ids,
            favorite_source_ids=request.favorite_source_ids,
        )
    except Exception:
        return _fallback_ranks(request.articles)


def _rank_sort_key(article: dict[str, Any], rank_map: dict[Any, dict[str, Any]]) -> tuple[float, float]:
    rank = rank_map.get(article.get("id"), {})
    return -float(rank.get("bucket_rank", 0)), -float(rank.get("total_score", 0))


@router.post("/ranked", response_model=RankResponse)
async def post_ranked_articles(request: RankRequest) -> RankResponse:
    ranked = _ranked_results(request)
    rank_map = {rank["article_id"]: rank for rank in ranked}
    sorted_articles = sorted(request.articles, key=lambda article: _rank_sort_key(article, rank_map))
    for article in sorted_articles:
        article_id = article.get("id")
        if article_id in rank_map:
            article["ranking"] = rank_map[article_id]
    return RankResponse(articles=sorted_articles, total=len(sorted_articles))


@router.get("/source/{source_name}", response_model=list[NewsArticle])
async def get_news_by_source(source_name: str) -> list[NewsArticle]:
    if source_name not in get_rss_sources():
        raise HTTPException(status_code=404, detail="Source not found")
    return [article for article in news_cache.get_articles() if article.source == source_name]


@router.get("/category/{category_name}", response_model=NewsResponse)
async def get_news_by_category(category_name: str) -> NewsResponse:
    articles = [
        article for article in news_cache.get_articles() if article.category == category_name
    ]
    return NewsResponse(
        articles=articles,
        total=len(articles),
        sources=list({article.source for article in articles}),
    )


async def _source_metadata_by_name(db: AsyncSession) -> dict[str, SourceMetadata]:
    try:
        entries = (await db.execute(select(SourceMetadata))).scalars().all()
    except Exception:
        return {}
    return {
        source_name: entry
        for entry in entries
        if isinstance((source_name := getattr(entry, "source_name", None)), str) and source_name
    }


def _configured_url(info: dict[str, Any]) -> str:
    value = info.get("site_url") or info.get("url")
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value and isinstance(value[0], str):
        return value[0]
    return ""


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _source_info(name: str, info: dict[str, Any], metadata: SourceMetadata | None) -> SourceInfo:
    credibility = (
        float(cast(float, metadata.credibility_score))
        if metadata is not None and metadata.credibility_score is not None
        else None
    )
    return SourceInfo(
        id=_source_slug(name),
        slug=_source_slug(name),
        name=name,
        url=_configured_url(info),
        category=_optional_str(info.get("category")) or "general",
        country=_optional_str(info.get("country")) or "US",
        funding_type=_optional_str(info.get("funding_type")),
        source_type=_optional_str(info.get("source_type")),
        is_paywalled=bool(info.get("is_paywalled")),
        bias_rating=_optional_str(info.get("bias_rating")),
        ownership_label=_optional_str(info.get("ownership_label")),
        factual_rating=cast(str | None, getattr(metadata, "factual_rating", None)) if metadata else None,
        credibility_score=credibility,
    )


@router.get("/sources", response_model=list[SourceInfo])
async def get_sources(db: AsyncSession = Depends(get_db)) -> list[SourceInfo]:
    metadata = await _source_metadata_by_name(db)
    return [
        _source_info(name, info, metadata.get(name))
        for name, info in get_rss_sources().items()
    ]


@router.get("/categories")
async def get_categories() -> dict[str, list[str]]:
    categories = {str(info.get("category") or "general") for info in get_rss_sources().values()}
    return {"categories": list(categories)}


def _pending_source_stat(source_name: str, source_info: dict[str, Any]) -> dict[str, object]:
    return {
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


@router.get("/sources/stats")
async def get_source_stats() -> dict[str, object]:
    configured = get_rss_sources()
    stats_map = {
        name: stat
        for stat in news_cache.get_source_stats()
        if isinstance((name := stat.get("name")), str)
    }
    all_stats = [
        stats_map.get(name, _pending_source_stat(name, info))
        for name, info in configured.items()
    ]
    return {"sources": all_stats, "total_sources": len(all_stats)}
