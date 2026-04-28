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
    serialize_saved_article_item,
    serialize_saved_article_row,
)
from app.database import Bookmark as BookmarkRecord, get_db
from app.models.news import BookmarkCreateRequest

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


@router.get("")
async def list_bookmarks(db: AsyncSession = Depends(get_db)) -> Dict[str, object]:
    bookmarks_stmt = build_saved_article_list_stmt(BookmarkRecord, "bookmark_id")
    result = await db.execute(bookmarks_stmt)
    rows = result.all()

    bookmarks = [
        serialize_saved_article_row(row, id_field="bookmark_id") for row in rows
    ]

    return {"bookmarks": bookmarks, "total": len(bookmarks)}


@router.get("/{article_id}")
async def get_bookmark(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    bookmark_stmt = build_saved_article_detail_stmt(BookmarkRecord, article_id)

    result = await db.execute(bookmark_stmt)
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Bookmark not found")

    bookmark, article = row
    return serialize_saved_article_detail(
        id_field="bookmark_id",
        item=bookmark,
        article=article,
    )


@router.post("", status_code=201)
async def create_bookmark(
    payload: BookmarkCreateRequest, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    article = await get_article_or_404(db, payload.article_id)
    existing = await get_saved_article_item(db, BookmarkRecord, payload.article_id)

    if existing:
        return serialize_saved_article_create(
            id_field="bookmark_id",
            item=existing,
            created=False,
        )

    bookmark = BookmarkRecord(article_id=article.id)
    db.add(bookmark)
    await db.flush()
    await db.refresh(bookmark)

    return serialize_saved_article_create(
        id_field="bookmark_id",
        item=bookmark,
        created=True,
    )


@router.put("/{article_id}")
async def update_bookmark(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    bookmark = await get_saved_article_item_or_404(
        db,
        BookmarkRecord,
        article_id,
        not_found_detail="Bookmark not found",
    )
    payload = serialize_saved_article_item(id_field="bookmark_id", item=bookmark)
    payload["updated"] = True
    return payload


@router.delete("/{article_id}")
async def delete_bookmark(
    article_id: int, db: AsyncSession = Depends(get_db)
) -> Dict[str, object]:
    bookmark = await get_saved_article_item_or_404(
        db,
        BookmarkRecord,
        article_id,
        not_found_detail="Bookmark not found",
    )

    await db.delete(bookmark)
    await db.flush()

    return {"deleted": True, "article_id": article_id}
