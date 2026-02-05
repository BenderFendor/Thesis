from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select  # type: ignore[import-unresolved]
from sqlalchemy.ext.asyncio import AsyncSession  # type: ignore[import-unresolved]

from app.database import (
    Article as ArticleRecord,
    LikedArticle as LikedArticleRecord,
    get_db,
)
from app.models.news import BookmarkCreateRequest

router = APIRouter(prefix="/api/liked", tags=["liked"])


@router.get("")
async def list_liked_articles(db: AsyncSession = Depends(get_db)) -> Dict[str, object]:
    liked_stmt = (
        select(
            LikedArticleRecord.id.label("liked_id"),
            LikedArticleRecord.article_id,
            LikedArticleRecord.created_at,
            ArticleRecord.title,
            ArticleRecord.source,
            ArticleRecord.summary,
            ArticleRecord.image_url,
            ArticleRecord.published_at,
            ArticleRecord.category,
            ArticleRecord.url,
        )
        .join(ArticleRecord, ArticleRecord.id == LikedArticleRecord.article_id)
        .order_by(LikedArticleRecord.created_at.desc())
    )

    result = await db.execute(liked_stmt)
    rows = result.all()

    liked_articles = []
    for row in rows:
        created_at = row.created_at
        created_at_value = created_at.isoformat() if created_at is not None else None
        liked_articles.append(
            {
                "liked_id": row.liked_id,
                "article_id": row.article_id,
                "title": row.title,
                "source": row.source,
                "summary": row.summary,
                "image": row.image_url,
                "published": row.published_at.isoformat() if row.published_at else None,
                "category": row.category,
                "url": row.url,
                "created_at": created_at_value,
            }
        )

    return {"liked": liked_articles, "total": len(liked_articles)}


@router.get("/{article_id}")
async def get_liked_article(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    liked_stmt = (
        select(LikedArticleRecord, ArticleRecord)
        .join(ArticleRecord, ArticleRecord.id == LikedArticleRecord.article_id)
        .where(LikedArticleRecord.article_id == article_id)
    )

    result = await db.execute(liked_stmt)
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Liked article not found")

    liked, article = row
    created_at = liked.created_at
    return {
        "liked_id": liked.id,
        "article_id": article.id,
        "title": article.title,
        "source": article.source,
        "summary": article.summary,
        "image": article.image_url,
        "published": article.published_at.isoformat() if article.published_at else None,
        "category": article.category,
        "url": article.url,
        "created_at": created_at.isoformat() if created_at is not None else None,
    }


@router.post("", status_code=201)
async def create_liked_article(
    payload: BookmarkCreateRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    article_stmt = select(ArticleRecord).where(ArticleRecord.id == payload.article_id)
    article_result = await db.execute(article_stmt)
    article = article_result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    existing_stmt = select(LikedArticleRecord).where(
        LikedArticleRecord.article_id == payload.article_id
    )
    existing_result = await db.execute(existing_stmt)
    existing = existing_result.scalar_one_or_none()

    if existing:
        created_at = existing.created_at
        return {
            "created": False,
            "liked_id": existing.id,
            "article_id": existing.article_id,
            "created_at": created_at.isoformat() if created_at is not None else None,
        }

    liked = LikedArticleRecord(article_id=article.id)
    db.add(liked)
    await db.flush()
    await db.refresh(liked)

    created_at = liked.created_at
    return {
        "created": True,
        "liked_id": liked.id,
        "article_id": liked.article_id,
        "created_at": created_at.isoformat() if created_at is not None else None,
    }


@router.delete("/{article_id}")
async def delete_liked_article(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    liked_stmt = select(LikedArticleRecord).where(
        LikedArticleRecord.article_id == article_id
    )
    result = await db.execute(liked_stmt)
    liked = result.scalar_one_or_none()
    if not liked:
        raise HTTPException(status_code=404, detail="Liked article not found")

    await db.delete(liked)
    await db.flush()

    return {"deleted": True, "article_id": article_id}
