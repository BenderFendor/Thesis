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
    source_stats = news_cache.get_source_stats()
    return {"sources": source_stats, "total_sources": len(source_stats)}
