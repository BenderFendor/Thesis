"""News by country endpoints for globe visualization and Local Lens feature."""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import any_, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import (
    Article,
    article_record_to_dict,
    get_db,
    get_session_dialect_name,
)
from app.services.country_mentions import country_name, get_country_geo_data

logger = get_logger(__name__)

router = APIRouter(prefix="/news", tags=["news-by-country"])


def _serialize_articles(records: list[Article]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for record in records:
        payload = article_record_to_dict(record)
        payload["source_country"] = record.country
        serialized.append(payload)
    return serialized


async def _fetch_country_filtered_articles(
    db: AsyncSession,
    *,
    base_filters: list[Any],
    code_upper: str,
    view: str,
    limit: int,
    offset: int,
) -> tuple[list[Article], int, int]:
    dialect_name = get_session_dialect_name(db)

    if dialect_name == "postgresql":
        filters = [
            *base_filters,
            literal(code_upper) == any_(Article.mentioned_countries),
        ]
        if view == "internal":
            filters.insert(len(base_filters), Article.country == code_upper)
        else:
            filters.extend(
                [
                    Article.country.isnot(None),
                    Article.country != "",
                    Article.country != code_upper,
                ]
            )

        count_stmt = select(func.count(Article.id)).where(*filters)
        total = int((await db.execute(count_stmt)).scalar_one())
        stmt = (
            select(Article)
            .where(*filters)
            .order_by(Article.published_at.desc(), Article.id.desc())
            .limit(limit)
            .offset(offset)
        )
        records = list((await db.execute(stmt)).scalars().all())
        source_count_stmt = select(func.count(func.distinct(Article.source))).where(
            *filters
        )
        source_count = int((await db.execute(source_count_stmt)).scalar_one())
        return records, total, source_count

    stmt = (
        select(Article)
        .where(*base_filters)
        .order_by(Article.published_at.desc(), Article.id.desc())
    )
    candidate_records = list((await db.execute(stmt)).scalars().all())

    if view == "internal":
        filtered = [
            record
            for record in candidate_records
            if record.country == code_upper
            and code_upper in (record.mentioned_countries or [])
        ]
    else:
        filtered = [
            record
            for record in candidate_records
            if record.country not in {None, "", code_upper}
            and code_upper in (record.mentioned_countries or [])
        ]

    paginated = filtered[offset : offset + limit]
    source_count = len({record.source for record in filtered if record.source})
    return paginated, len(filtered), source_count


@router.get("/countries/geo")
async def get_countries_geo_data_route() -> dict[str, object]:
    countries = get_country_geo_data()
    return {
        "countries": countries,
        "total": len(countries),
    }


@router.get("/by-country")
async def get_article_counts_by_country(
    hours: int = Query(24, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)

    source_stmt = (
        select(Article.country, func.count(Article.id).label("count"))
        .where(Article.published_at >= since)
        .where(Article.country.isnot(None))
        .where(Article.country != "")
        .group_by(Article.country)
        .order_by(func.count(Article.id).desc())
    )
    source_rows = (await db.execute(source_stmt)).all()

    source_counts: dict[str, int] = {}
    for row in source_rows:
        country = row._mapping["country"]
        count = row._mapping["count"]
        if isinstance(country, str) and isinstance(count, int):
            source_counts[country] = count

    mention_stmt = select(Article.mentioned_countries).where(
        Article.published_at >= since
    )
    mention_rows = list((await db.execute(mention_stmt)).scalars().all())

    counts: dict[str, int] = {}
    covered_article_count = 0
    for mentions in mention_rows:
        mentions = mentions or []
        if not mentions:
            continue
        covered_article_count += 1
        for mention in mentions:
            counts[mention] = counts.get(mention, 0) + 1

    total_stmt = select(func.count(Article.id)).where(Article.published_at >= since)
    total = int((await db.execute(total_stmt)).scalar_one())

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
    code_upper = code.upper()
    country_label = country_name(code_upper)

    base_filters: list[Any] = []
    if hours is not None:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
        base_filters.append(Article.published_at >= since)

    if view == "internal":
        matching_strategy = "country_mentions"
        view_description = f"How sources in {country_label} cover {country_label}"
    else:
        matching_strategy = "country_mentions"
        view_description = f"How outside sources cover {country_label}"

    records, total, source_count = await _fetch_country_filtered_articles(
        db,
        base_filters=base_filters,
        code_upper=code_upper,
        view=view,
        limit=limit,
        offset=offset,
    )

    if view == "internal" and total == 0:
        filters = [*base_filters, Article.country == code_upper]
        count_stmt = select(func.count(Article.id)).where(*filters)
        total = int((await db.execute(count_stmt)).scalar_one())
        matching_strategy = "source_origin_fallback"
        view_description = f"Recent reporting from sources based in {country_label}"
        stmt = (
            select(Article)
            .where(*filters)
            .order_by(Article.published_at.desc(), Article.id.desc())
            .limit(limit)
            .offset(offset)
        )
        records = list((await db.execute(stmt)).scalars().all())
        source_count_stmt = select(func.count(func.distinct(Article.source))).where(
            *filters
        )
        source_count = int((await db.execute(source_count_stmt)).scalar_one())

    articles = _serialize_articles(records)

    return {
        "country_code": code_upper,
        "country_name": country_label,
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

    rows = (await db.execute(stmt)).all()
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
