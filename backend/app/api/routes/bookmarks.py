from __future__ import annotations

from datetime import datetime
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select  # type: ignore[import-unresolved]
from sqlalchemy.ext.asyncio import AsyncSession  # type: ignore[import-unresolved]

from app.database import Article as ArticleRecord, Bookmark as BookmarkRecord, get_db
from app.models.news import BookmarkCreateRequest

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


@router.get("")
async def list_bookmarks(db: AsyncSession = Depends(get_db)) -> Dict[str, object]:
    bookmarks_stmt = (
        select(
            BookmarkRecord.id.label("bookmark_id"),
            BookmarkRecord.article_id,
            BookmarkRecord.created_at,
            ArticleRecord.title,
            ArticleRecord.source,
            ArticleRecord.summary,
            ArticleRecord.image_url,
            ArticleRecord.published_at,
            ArticleRecord.category,
            ArticleRecord.url,
        )
        .join(ArticleRecord, ArticleRecord.id == BookmarkRecord.article_id)
        .order_by(BookmarkRecord.created_at.desc())
    )

    result = await db.execute(bookmarks_stmt)
    rows = result.all()

    bookmarks = [
        {
            "bookmark_id": row.bookmark_id,
            "article_id": row.article_id,
            "title": row.title,
            "source": row.source,
            "summary": row.summary,
            "image": row.image_url,
            "published": row.published_at.isoformat() if row.published_at else None,
            "category": row.category,
            "url": row.url,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]

    return {"bookmarks": bookmarks, "total": len(bookmarks)}


@router.get("/{article_id}")
async def get_bookmark(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    bookmark_stmt = (
        select(BookmarkRecord, ArticleRecord)
        .join(ArticleRecord, ArticleRecord.id == BookmarkRecord.article_id)
        .where(BookmarkRecord.article_id == article_id)
    )

    result = await db.execute(bookmark_stmt)
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    bookmark, article = row
    return {
        "bookmark_id": bookmark.id,
        "article_id": article.id,
        "title": article.title,
        "source": article.source,
        "summary": article.summary,
        "image": article.image_url,
        "published": article.published_at.isoformat() if article.published_at else None,
        "category": article.category,
        "url": article.url,
        "created_at": bookmark.created_at.isoformat() if bookmark.created_at else None,
    }


@router.post("", status_code=201)
async def create_bookmark(
    payload: BookmarkCreateRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    article_stmt = select(ArticleRecord).where(ArticleRecord.id == payload.article_id)
    article_result = await db.execute(article_stmt)
    article = article_result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    existing_stmt = select(BookmarkRecord).where(
        BookmarkRecord.article_id == payload.article_id
    )
    existing_result = await db.execute(existing_stmt)
    existing = existing_result.scalar_one_or_none()

    if existing:
        return {
            "created": False,
            "bookmark_id": existing.id,
            "article_id": existing.article_id,
            "created_at": existing.created_at.isoformat()
            if existing.created_at
            else None,
        }

    bookmark = BookmarkRecord(article_id=article.id)
    db.add(bookmark)
    await db.flush()
    await db.refresh(bookmark)

    return {
        "created": True,
        "bookmark_id": bookmark.id,
        "article_id": bookmark.article_id,
        "created_at": bookmark.created_at.isoformat() if bookmark.created_at else None,
    }


@router.put("/{article_id}")
async def update_bookmark(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    bookmark_stmt = select(BookmarkRecord).where(
        BookmarkRecord.article_id == article_id
    )
    result = await db.execute(bookmark_stmt)
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    bookmark.created_at = datetime.utcnow()
    await db.flush()

    return {
        "bookmark_id": bookmark.id,
        "article_id": bookmark.article_id,
        "created_at": bookmark.created_at.isoformat() if bookmark.created_at else None,
        "updated": True,
    }


@router.delete("/{article_id}")
async def delete_bookmark(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    bookmark_stmt = select(BookmarkRecord).where(
        BookmarkRecord.article_id == article_id
    )
    result = await db.execute(bookmark_stmt)
    bookmark = result.scalar_one_or_none()
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    await db.delete(bookmark)
    await db.flush()

    return {"deleted": True, "article_id": article_id}
