"""
News by country endpoints for globe visualization and Local Lens feature.
"""
import json
from pathlib import Path
from typing import Dict, Optional
from fastapi import APIRouter, Query, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, Article, article_record_to_dict
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/news", tags=["news-by-country"])

# Load static country data
_COUNTRIES_PATH = Path(__file__).parent.parent.parent / "data" / "countries.json"
try:
    with _COUNTRIES_PATH.open("r", encoding="utf-8") as f:
        _COUNTRIES_DATA: Dict[str, Dict] = json.load(f)
except Exception as e:
    logger.warning(f"Failed to load countries.json: {e}")
    _COUNTRIES_DATA = {}


@router.get("/countries/geo")
async def get_countries_geo_data() -> Dict[str, object]:
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
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    """
    Get article counts grouped by source country for globe heatmap.
    
    Returns a dictionary mapping ISO country codes to article counts.
    """
    stmt = (
        select(Article.country, func.count(Article.id).label("count"))
        .where(Article.country.isnot(None))
        .where(Article.country != "")
        .group_by(Article.country)
        .order_by(func.count(Article.id).desc())
    )
    
    result = await db.execute(stmt)
    rows = result.all()
    
    # Build country -> count mapping
    counts = {row.country: row.count for row in rows if row.country}
    
    # Calculate total for non-country articles
    total_stmt = select(func.count(Article.id))
    total = (await db.execute(total_stmt)).scalar_one()
    
    country_total = sum(counts.values())
    
    return {
        "counts": counts,
        "total_articles": total,
        "articles_with_country": country_total,
        "articles_without_country": total - country_total,
        "country_count": len(counts),
    }


@router.get("/country/{code}")
async def get_news_for_country(
    code: str,
    view: str = Query("internal", regex="^(internal|external)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
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
    
    if view == "internal":
        # Articles FROM this country (source is based in this country)
        filters = [Article.country == code_upper]
        view_description = f"News sources based in {code_upper}"
    else:
        # Articles ABOUT this country (from other sources)
        # For now, we use source country != code as approximation
        # TODO: Add mentioned_countries field and use proper content analysis
        filters = [
            Article.country != code_upper,
            Article.country.isnot(None),
            Article.country != "",
        ]
        view_description = f"International coverage of {code_upper}"
    
    # Get total count
    count_stmt = select(func.count(Article.id)).where(*filters)
    total = (await db.execute(count_stmt)).scalar_one()
    
    # Get articles
    stmt = (
        select(Article)
        .where(*filters)
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
        .offset(offset)
    )
    
    result = await db.execute(stmt)
    articles = [article_record_to_dict(row) for row in result.scalars().all()]
    
    return {
        "country_code": code_upper,
        "view": view,
        "view_description": view_description,
        "total": total,
        "limit": limit,
        "offset": offset,
        "returned": len(articles),
        "has_more": offset + len(articles) < total,
        "articles": articles,
    }


@router.get("/countries/list")
async def list_available_countries(
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
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
            "latest_article": row.latest_article.isoformat() if row.latest_article else None,
        }
        for row in rows
        if row.country
    ]
    
    return {
        "countries": countries,
        "total_countries": len(countries),
    }
