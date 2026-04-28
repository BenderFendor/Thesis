from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.saved_article_helpers import (
    build_saved_article_detail_stmt,
    build_saved_article_list_stmt,
    get_article_or_404,
    get_saved_article_item,
    get_saved_article_item_or_404,
    serialize_saved_article_create,
    serialize_saved_article_detail,
    serialize_saved_article_row,
)
from app.database import (
    LikedArticle as LikedArticleRecord,
    get_db,
)
from app.models.news import BookmarkCreateRequest

router = APIRouter(prefix="/api/liked", tags=["liked"])


@router.get("")
async def list_liked_articles(db: AsyncSession = Depends(get_db)) -> Dict[str, object]:
    liked_stmt = build_saved_article_list_stmt(LikedArticleRecord, "liked_id")

    result = await db.execute(liked_stmt)
    rows = result.all()

    liked_articles = [
        serialize_saved_article_row(row, id_field="liked_id") for row in rows
    ]

    return {"liked": liked_articles, "total": len(liked_articles)}


@router.get("/{article_id}")
async def get_liked_article(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    liked_stmt = build_saved_article_detail_stmt(LikedArticleRecord, article_id)

    result = await db.execute(liked_stmt)
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Liked article not found")

    liked, article = row
    return serialize_saved_article_detail(
        id_field="liked_id",
        item=liked,
        article=article,
    )


@router.post("", status_code=201)
async def create_liked_article(
    payload: BookmarkCreateRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    article = await get_article_or_404(db, payload.article_id)
    existing = await get_saved_article_item(db, LikedArticleRecord, payload.article_id)

    if existing:
        return serialize_saved_article_create(
            id_field="liked_id",
            item=existing,
            created=False,
        )

    liked = LikedArticleRecord(article_id=article.id)
    db.add(liked)
    await db.flush()
    await db.refresh(liked)

    return serialize_saved_article_create(
        id_field="liked_id",
        item=liked,
        created=True,
    )


@router.delete("/{article_id}")
async def delete_liked_article(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    liked = await get_saved_article_item_or_404(
        db,
        LikedArticleRecord,
        article_id,
        not_found_detail="Liked article not found",
    )

    await db.delete(liked)
    await db.flush()

    return {"deleted": True, "article_id": article_id}
