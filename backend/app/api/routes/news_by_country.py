"""
News by country endpoints for globe visualization and Local Lens feature.
"""

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, Query, Depends
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, Article, article_record_to_dict
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/news", tags=["news-by-country"])

_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_COUNTRIES_PATH = _DATA_DIR / "countries.json"
_COUNTRY_ALIASES_PATH = _DATA_DIR / "country_aliases.json"
try:
    with _COUNTRIES_PATH.open("r", encoding="utf-8") as f:
        _COUNTRIES_DATA = cast(dict[str, dict[str, object]], json.load(f))
except Exception as e:
    logger.warning("Failed to load countries.json: %s", e)
    _COUNTRIES_DATA = {}

try:
    with _COUNTRY_ALIASES_PATH.open("r", encoding="utf-8") as f:
        raw_aliases = cast(dict[str, list[str]], json.load(f))
except Exception as e:
    logger.warning("Failed to load country_aliases.json: %s", e)
    raw_aliases = {}

_COUNTRY_ALIAS_MAP = {
    code: tuple(
        sorted(
            {
                alias.strip()
                for alias in aliases
                if isinstance(alias, str) and alias.strip()
            },
            key=len,
            reverse=True,
        )
    )
    for code, aliases in raw_aliases.items()
}


def _is_textual_alias(alias: str) -> bool:
    stripped = alias.strip()
    if len(stripped) < 4:
        return stripped in {"U.K.", "UK", "USA", "UAE", "PRC", "DPRK"}
    if any(char in stripped for char in {",", "/"}):
        return False
    if stripped.isupper() and len(stripped) <= 3:
        return False
    return any(char.isalpha() for char in stripped)


_TEXTUAL_ALIAS_MAP = {
    code: tuple(alias for alias in aliases if _is_textual_alias(alias))
    for code, aliases in _COUNTRY_ALIAS_MAP.items()
}
_TOKEN_RE = re.compile(r"[\w']+", re.UNICODE)


def _alias_tokens(value: str) -> tuple[str, ...]:
    return tuple(token.casefold() for token in _TOKEN_RE.findall(value))


_ALIAS_TO_CODES: dict[tuple[str, ...], set[str]] = {}
for code, aliases in _TEXTUAL_ALIAS_MAP.items():
    for alias in aliases:
        normalized = _alias_tokens(alias)
        if not normalized:
            continue
        _ALIAS_TO_CODES.setdefault(normalized, set()).add(code)

_UNIQUE_ALIAS_TO_CODE = {
    alias_tokens: next(iter(codes))
    for alias_tokens, codes in _ALIAS_TO_CODES.items()
    if len(codes) == 1
}
_MAX_ALIAS_TOKENS = max((len(tokens) for tokens in _UNIQUE_ALIAS_TO_CODE), default=1)
_COUNTRY_PATTERNS = {
    code: re.compile(
        r"(?<!\\w)(?:" + "|".join(re.escape(alias) for alias in aliases) + r")(?!\\w)",
        re.IGNORECASE,
    )
    for code, aliases in _TEXTUAL_ALIAS_MAP.items()
    if aliases
}


def _country_name(code: str) -> str:
    country = _COUNTRIES_DATA.get(code)
    if isinstance(country, dict):
        name = country.get("name")
        if isinstance(name, str) and name.strip():
            return name
    return code


def _article_text(record: Article) -> str:
    return " ".join(
        part.strip()
        for part in (record.title, record.summary, record.content)
        if isinstance(part, str) and part.strip()
    )


def _extract_mentioned_countries(text: str) -> list[str]:
    if not text.strip():
        return []
    tokens = [token.casefold() for token in _TOKEN_RE.findall(text)]
    mentions: set[str] = set()
    for index in range(len(tokens)):
        max_width = min(_MAX_ALIAS_TOKENS, len(tokens) - index)
        for width in range(max_width, 0, -1):
            code = _UNIQUE_ALIAS_TO_CODE.get(tuple(tokens[index : index + width]))
            if code is not None:
                mentions.add(code)
                break
    return sorted(mentions)


def _country_mention_filter(code: str) -> Any | None:
    aliases = _TEXTUAL_ALIAS_MAP.get(code, ())
    if not aliases:
        return None

    clauses = []
    for alias in aliases:
        pattern = f"%{alias}%"
        clauses.extend(
            [
                Article.title.ilike(pattern),
                Article.summary.ilike(pattern),
                Article.content.ilike(pattern),
            ]
        )

    return or_(*clauses) if clauses else None


def _serialize_articles(records: list[Article]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for record in records:
        payload = article_record_to_dict(record)
        payload["source_country"] = record.country
        payload["mentioned_countries"] = _extract_mentioned_countries(
            _article_text(record)
        )
        serialized.append(payload)
    return serialized


@router.get("/countries/geo")
async def get_countries_geo_data() -> dict[str, object]:
    """
    Get static country geographic data for globe markers.

    Returns country codes with names and lat/lng coordinates.
    """
    return {
        "countries": _COUNTRIES_DATA,
        "total": len(_COUNTRIES_DATA),
    }


@router.get("/by-country")
async def get_article_counts_by_country(
    hours: int = Query(24, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """
    Get recent article counts grouped by covered country for globe heatmap.

    Heatmap counts are based on which countries are mentioned in recent article
    text, while source_counts keeps source-origin volume for comparison.
    """
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)

    source_stmt = (
        select(Article.country, func.count(Article.id).label("count"))
        .where(Article.published_at >= since)
        .where(Article.country.isnot(None))
        .where(Article.country != "")
        .group_by(Article.country)
        .order_by(func.count(Article.id).desc())
    )

    result = await db.execute(source_stmt)
    rows = result.all()

    source_counts: dict[str, int] = {}
    for row in rows:
        country = row._mapping["country"]
        count = row._mapping["count"]
        if isinstance(country, str) and isinstance(count, int):
            source_counts[country] = count

    article_stmt = select(Article.title, Article.summary, Article.content).where(
        Article.published_at >= since
    )
    article_rows = (await db.execute(article_stmt)).all()

    counts: dict[str, int] = {}
    covered_article_count = 0
    for title, summary, content in article_rows:
        text = " ".join(
            part.strip()
            for part in (title, summary, content)
            if isinstance(part, str) and part.strip()
        )
        mentions = _extract_mentioned_countries(text)
        if not mentions:
            continue
        covered_article_count += 1
        for mention in mentions:
            counts[mention] = counts.get(mention, 0) + 1

    total_stmt = select(func.count(Article.id)).where(Article.published_at >= since)
    total = (await db.execute(total_stmt)).scalar_one()

    return {
        "counts": counts,
        "source_counts": source_counts,
        "total_articles": total,
        "articles_with_country": covered_article_count,
        "articles_without_country": total - covered_article_count,
        "country_count": len(counts),
        "window_hours": hours,
    }


@router.get("/country/{code}")
async def get_news_for_country(
    code: str,
    view: str = Query("internal", pattern="^(internal|external)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    hours: int | None = Query(None, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """
    Local Lens feature: Get news for a specific country.

    Args:
        code: ISO 3166-1 alpha-2 country code (e.g., "US", "GB", "CN")
        view:
            - "internal": Articles FROM this country (source_country = code)
            - "external": Articles ABOUT this country (country mentioned in content)
                          Currently uses source country != code as approximation
        limit: Maximum number of articles to return
        offset: Pagination offset

    Returns:
        Paginated list of articles matching the criteria
    """
    code_upper = code.upper()
    country_name = _country_name(code_upper)
    mention_filter = _country_mention_filter(code_upper)

    base_filters = []
    if hours is not None:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
        base_filters.append(Article.published_at >= since)

    if view == "internal":
        filters = [*base_filters, Article.country == code_upper]
        matching_strategy = "country_mentions"
        if mention_filter is not None:
            filters.append(mention_filter)
        view_description = f"How sources in {country_name} cover {country_name}"
    else:
        filters = [
            *base_filters,
            Article.country.isnot(None),
            Article.country != "",
            Article.country != code_upper,
        ]
        matching_strategy = "country_mentions"
        if mention_filter is not None:
            filters.append(mention_filter)
        view_description = f"How outside sources cover {country_name}"

    # Get total count
    count_stmt = select(func.count(Article.id)).where(*filters)
    total = (await db.execute(count_stmt)).scalar_one()

    if view == "internal" and total == 0:
        filters = [*base_filters, Article.country == code_upper]
        count_stmt = select(func.count(Article.id)).where(*filters)
        total = (await db.execute(count_stmt)).scalar_one()
        matching_strategy = "source_origin_fallback"
        view_description = f"Recent reporting from sources based in {country_name}"

    # Get articles
    stmt = (
        select(Article)
        .where(*filters)
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
        .offset(offset)
    )

    result = await db.execute(stmt)
    records = result.scalars().all()
    articles = _serialize_articles(list(records))

    source_count_stmt = select(func.count(func.distinct(Article.source))).where(
        *filters
    )
    source_count = (await db.execute(source_count_stmt)).scalar_one()

    return {
        "country_code": code_upper,
        "country_name": country_name,
        "view": view,
        "view_description": view_description,
        "matching_strategy": matching_strategy,
        "total": total,
        "limit": limit,
        "offset": offset,
        "returned": len(articles),
        "has_more": offset + len(articles) < total,
        "source_count": source_count,
        "window_hours": hours,
        "articles": articles,
    }


@router.get("/countries/list")
async def list_available_countries(
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """
    List all countries with at least one article, sorted by article count.

    Useful for populating globe markers or country selector.
    """
    stmt = (
        select(
            Article.country,
            func.count(Article.id).label("article_count"),
            func.max(Article.published_at).label("latest_article"),
        )
        .where(Article.country.isnot(None))
        .where(Article.country != "")
        .group_by(Article.country)
        .order_by(func.count(Article.id).desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    countries = [
        {
            "code": row.country,
            "article_count": row.article_count,
            "latest_article": row.latest_article.isoformat()
            if row.latest_article
            else None,
        }
        for row in rows
        if row.country
    ]

    return {
        "countries": countries,
        "total_countries": len(countries),
    }
