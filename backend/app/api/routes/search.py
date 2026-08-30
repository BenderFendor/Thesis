"""Search."""

from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article as ArticleRecord, SearchHistory, get_db
from app.vector_store import SimilarArticleResult, get_vector_store

router = APIRouter(prefix="/api/search", tags=["search"])


def _semantic_filter_metadata(category: str | None) -> dict[str, str] | None:
    """Normalize a category filter for chroma metadata matching."""
    normalized = category.lower() if category else None
    if not normalized or normalized == "all":
        return None
    return {"category": normalized}


def _semantic_result_payloads(
    chroma_results: Sequence[SimilarArticleResult],
    article_map: dict[Any, ArticleRecord],
) -> list[dict[str, object]]:
    """Build search result payloads for chroma rows with a matching article."""
    payloads: list[dict[str, object]] = []
    for chroma_result in chroma_results:
        article = article_map.get(chroma_result["article_id"])
        if not article:
            continue
        payloads.append(
            {
                "id": article.id,
                "title": article.title,
                "source": article.source,
                "summary": article.summary,
                "image": article.image_url,
                "published": article.published_at.isoformat() if article.published_at else None,
                "category": article.category,
                "url": article.url,
                "similarity_score": chroma_result["similarity_score"],
                "distance": chroma_result["distance"],
            }
        )
    return payloads


@router.get("/semantic")
async def semantic_search(
    query: str = Query(..., min_length=3),
    limit: int = Query(10, le=50),
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Semantic Search."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store is not available")

    chroma_results = vector_store.search_similar(
        query=query,
        limit=limit,
        filter_metadata=_semantic_filter_metadata(category),
    )
    article_ids = [result["article_id"] for result in chroma_results if result["article_id"]]
    if not chroma_results or not article_ids:
        return {"query": query, "results": [], "total": 0}

    articles_result = await db.execute(
        select(ArticleRecord).where(ArticleRecord.id.in_(article_ids))
    )
    article_map = {article.id: article for article in articles_result.scalars().all()}
    results = _semantic_result_payloads(chroma_results, article_map)

    db.add(SearchHistory(query=query, search_type="semantic", results_count=len(results)))
    return {"query": query, "results": results, "total": len(results)}
