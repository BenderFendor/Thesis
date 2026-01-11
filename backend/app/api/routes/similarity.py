"""API routes for ChromaDB similarity features."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article as ArticleRecord, TopicCluster, get_db
from app.vector_store import get_vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/similarity", tags=["similarity"])


@router.get("/related/{article_id}")
async def get_related_articles(
    article_id: int,
    limit: int = Query(5, le=20),
    exclude_same_source: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    """Find articles similar to a given article ID."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store not available")

    article_stmt = select(ArticleRecord).where(ArticleRecord.id == article_id)
    result = await db.execute(article_stmt)
    article = result.scalar_one_or_none()

    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    source_id = article.source_id if exclude_same_source else None
    similar = vector_store.find_similar_by_id(
        article_id=article_id,
        limit=limit,
        exclude_same_source=exclude_same_source,
        source_id=source_id,
    )

    if not similar:
        return {"article_id": article_id, "related": [], "total": 0}

    related_ids = [s["article_id"] for s in similar]
    articles_stmt = select(ArticleRecord).where(ArticleRecord.id.in_(related_ids))
    articles_result = await db.execute(articles_stmt)
    articles = articles_result.scalars().all()
    article_map = {a.id: a for a in articles}

    related = []
    for sim in similar:
        art = article_map.get(sim["article_id"])
        if not art:
            continue
        related.append(
            {
                "id": art.id,
                "title": art.title,
                "source": art.source,
                "sourceId": art.source_id,
                "summary": art.summary,
                "image": art.image_url,
                "publishedAt": art.published_at.isoformat()
                if art.published_at
                else None,
                "category": art.category,
                "url": art.url,
                "similarity_score": sim["similarity_score"],
            }
        )

    return {"article_id": article_id, "related": related, "total": len(related)}


@router.get("/search-suggestions")
async def get_search_suggestions(
    query: str = Query(..., min_length=2),
    limit: int = Query(5, le=10),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    """Get search suggestions based on cluster labels nearest to the query."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store not available")

    clusters_stmt = (
        select(TopicCluster).where(TopicCluster.article_count > 0).limit(100)
    )
    result = await db.execute(clusters_stmt)
    clusters = result.scalars().all()

    if not clusters:
        return {"query": query, "suggestions": []}

    cluster_data = []
    for c in clusters:
        if c.centroid_embedding:
            cluster_data.append(
                {
                    "id": c.id,
                    "label": c.label or f"Topic {c.id}",
                    "centroid": c.centroid_embedding,
                }
            )

    if not cluster_data:
        return {"query": query, "suggestions": []}

    nearest = vector_store.find_nearest_cluster_labels(query, cluster_data, limit=limit)
    suggestions = [
        {
            "cluster_id": n["cluster_id"],
            "label": n["label"],
            "relevance": round(n["similarity"], 3),
        }
        for n in nearest
        if n["similarity"] > 0.3
    ]

    return {"query": query, "suggestions": suggestions}


@router.get("/source-coverage")
async def get_source_coverage(
    source_ids: str = Query(..., description="Comma-separated source IDs"),
    sample_size: int = Query(100, le=500),
) -> Dict[str, object]:
    """Compare embedding space coverage between sources."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store not available")

    ids = [s.strip() for s in source_ids.split(",") if s.strip()]
    if len(ids) < 2:
        raise HTTPException(
            status_code=400, detail="Provide at least 2 source IDs to compare"
        )

    coverage = vector_store.compute_source_coverage(ids, sample_size=sample_size)
    return coverage


@router.post("/novelty-score")
async def compute_novelty_score(
    article_id: int,
    reading_history: List[int],
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    """Compute how novel an article is compared to reading history."""
    vector_store = get_vector_store()
    if vector_store is None:
        raise HTTPException(status_code=503, detail="Vector store not available")

    if not reading_history:
        return {
            "article_id": article_id,
            "novelty_score": 1.0,
            "reason": "empty_history",
        }

    article_chroma_id = f"article_{article_id}"
    article_result = vector_store.collection.get(
        ids=[article_chroma_id],
        include=["embeddings"],
    )

    if not article_result["ids"] or not article_result["embeddings"]:
        raise HTTPException(status_code=404, detail="Article not in vector store")

    article_embedding = article_result["embeddings"][0]

    history_ids = [f"article_{aid}" for aid in reading_history[:50]]
    history_result = vector_store.collection.get(
        ids=history_ids,
        include=["embeddings"],
    )

    if not history_result["embeddings"]:
        return {
            "article_id": article_id,
            "novelty_score": 1.0,
            "reason": "no_history_embeddings",
        }

    import numpy as np

    article_vec = np.array(article_embedding)
    history_vecs = np.array(history_result["embeddings"])

    similarities = np.dot(history_vecs, article_vec) / (
        np.linalg.norm(history_vecs, axis=1) * np.linalg.norm(article_vec)
    )

    max_similarity = float(np.max(similarities))
    avg_similarity = float(np.mean(similarities))
    novelty_score = 1.0 - max_similarity

    return {
        "article_id": article_id,
        "novelty_score": round(novelty_score, 3),
        "max_similarity_to_history": round(max_similarity, 3),
        "avg_similarity_to_history": round(avg_similarity, 3),
        "history_size": len(history_result["embeddings"]),
    }


@router.get("/article-topics/{article_id}")
async def get_article_topics(
    article_id: int,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    """Get topic cluster assignments for an article."""
    from app.database import ArticleTopic

    stmt = (
        select(ArticleTopic, TopicCluster)
        .join(TopicCluster, ArticleTopic.cluster_id == TopicCluster.id)
        .where(ArticleTopic.article_id == article_id)
        .order_by(ArticleTopic.similarity.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return {"article_id": article_id, "topics": []}

    topics = []
    for article_topic, cluster in rows:
        topics.append(
            {
                "cluster_id": cluster.id,
                "label": cluster.label or f"Topic {cluster.id}",
                "similarity": round(article_topic.similarity, 3)
                if article_topic.similarity
                else None,
                "keywords": cluster.keywords or [],
            }
        )

    return {"article_id": article_id, "topics": topics}


@router.post("/bulk-article-topics")
async def get_bulk_article_topics(
    article_ids: List[int],
    db: AsyncSession = Depends(get_db),
) -> Dict[str, object]:
    """Get topic cluster assignments for multiple articles."""
    from app.database import ArticleTopic

    if not article_ids:
        return {"articles": {}}

    stmt = (
        select(ArticleTopic, TopicCluster)
        .join(TopicCluster, ArticleTopic.cluster_id == TopicCluster.id)
        .where(ArticleTopic.article_id.in_(article_ids))
        .order_by(ArticleTopic.article_id, ArticleTopic.similarity.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    articles_map: Dict[int, List[Dict]] = {aid: [] for aid in article_ids}

    for article_topic, cluster in rows:
        aid = article_topic.article_id
        if aid in articles_map:
            articles_map[aid].append(
                {
                    "cluster_id": cluster.id,
                    "label": cluster.label or f"Topic {cluster.id}",
                    "similarity": round(article_topic.similarity, 3)
                    if article_topic.similarity
                    else None,
                }
            )

    return {"articles": articles_map}
