from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, HTTPException

from app.data.rss_sources import get_rss_sources
from app.models.news import NewsArticle, NewsResponse, SourceInfo
from app.services.cache import news_cache

router = APIRouter(prefix="/news", tags=["news"])


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
    category_articles = [article for article in all_articles if article.category == category_name]
    sources_included = list({article.source for article in category_articles})

    return NewsResponse(articles=category_articles, total=len(category_articles), sources=sources_included)


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
    categories = {info.get("category", "general") for info in get_rss_sources().values()}
    return {"categories": list(categories)}


@router.get("/sources/stats")
async def get_source_stats() -> Dict[str, object]:
    """Return stats for all configured sources."""
    configured_sources = get_rss_sources()
    source_stats = news_cache.get_source_stats()
    
    # Create a map of existing stats by name
    stats_map = {stat['name']: stat for stat in source_stats}
    
    # Ensure all configured sources are in the response
    all_stats = []
    for source_name, source_info in configured_sources.items():
        if source_name in stats_map:
            all_stats.append(stats_map[source_name])
        else:
            all_stats.append({
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
            })
    
    return {"sources": all_stats, "total_sources": len(all_stats)}
