from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select  # type: ignore[import-unresolved]
from sqlalchemy.ext.asyncio import AsyncSession  # type: ignore[import-unresolved]

from app.core.logging import get_logger
from app.database import Article as ArticleRecord, SearchHistory, get_db
from app.vector_store import vector_store

router = APIRouter(prefix="/api/search", tags=["search"])
logger = get_logger("semantic_search")


@router.get("/semantic")
async def semantic_search(
    query: str = Query(..., min_length=3),
    limit: int = Query(10, le=50),
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store is not available")

    filter_metadata = {}
    if category and category.lower() != "all":
        filter_metadata["category"] = category.lower()

    chroma_results = vector_store.search_similar(
        query=query,
        limit=limit,
        filter_metadata=filter_metadata if filter_metadata else None,
    )

    if not chroma_results:
        return {"query": query, "results": [], "total": 0}

    article_ids = [result.get("article_id") for result in chroma_results if result.get("article_id")]
    if not article_ids:
        return {"query": query, "results": [], "total": 0}

    articles_stmt = select(ArticleRecord).where(ArticleRecord.id.in_(article_ids))
    articles_result = await db.execute(articles_stmt)
    articles = articles_result.scalars().all()
    article_map = {article.id: article for article in articles}

    results: List[Dict[str, object]] = []
    for chroma_result in chroma_results:
        article_id = chroma_result.get("article_id")
        article = article_map.get(article_id)
        if not article:
            continue

        results.append(
            {
                "id": article.id,
                "title": article.title,
                "source": article.source,
                "summary": article.summary,
                "image": article.image_url,
                "published": article.published_at.isoformat() if article.published_at else None,
                "category": article.category,
                "url": article.url,
                "similarity_score": chroma_result.get("similarity_score"),
                "distance": chroma_result.get("distance"),
            }
        )

    search_record = SearchHistory(query=query, search_type="semantic", results_count=len(results))
    db.add(search_record)

    return {"query": query, "results": results, "total": len(results)}
