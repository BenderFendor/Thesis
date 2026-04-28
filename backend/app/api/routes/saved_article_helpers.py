from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article as ArticleRecord
from app.database import Bookmark as BookmarkRecord
from app.database import LikedArticle as LikedArticleRecord

SavedArticleRecord = BookmarkRecord | LikedArticleRecord
SavedArticleRecordModel = type[BookmarkRecord] | type[LikedArticleRecord]


def isoformat_or_none(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def build_saved_article_list_stmt(
    record_model: SavedArticleRecordModel, id_label: str
) -> Any:
    return (
        select(
            record_model.id.label(id_label),
            record_model.article_id,
            record_model.created_at,
            ArticleRecord.title,
            ArticleRecord.source,
            ArticleRecord.summary,
            ArticleRecord.image_url,
            ArticleRecord.published_at,
            ArticleRecord.category,
            ArticleRecord.url,
        )
        .join(ArticleRecord, ArticleRecord.id == record_model.article_id)
        .order_by(record_model.created_at.desc())
    )


def build_saved_article_detail_stmt(
    record_model: SavedArticleRecordModel, article_id: int
) -> Any:
    return (
        select(record_model, ArticleRecord)
        .join(ArticleRecord, ArticleRecord.id == record_model.article_id)
        .where(record_model.article_id == article_id)
    )


def serialize_saved_article_row(row: Any, *, id_field: str) -> dict[str, object]:
    return {
        id_field: getattr(row, id_field),
        "article_id": row.article_id,
        "title": row.title,
        "source": row.source,
        "summary": row.summary,
        "image": row.image_url,
        "published": isoformat_or_none(row.published_at),
        "category": row.category,
        "url": row.url,
        "created_at": isoformat_or_none(row.created_at),
    }


def serialize_saved_article_detail(
    *,
    id_field: str,
    item: SavedArticleRecord,
    article: ArticleRecord,
) -> dict[str, object]:
    return {
        id_field: item.id,
        "article_id": article.id,
        "title": article.title,
        "source": article.source,
        "summary": article.summary,
        "image": article.image_url,
        "published": isoformat_or_none(article.published_at),
        "category": article.category,
        "url": article.url,
        "created_at": isoformat_or_none(item.created_at),
    }


def serialize_saved_article_create(
    *,
    id_field: str,
    item: SavedArticleRecord,
    created: bool,
) -> dict[str, object]:
    payload = serialize_saved_article_item(id_field=id_field, item=item)
    payload["created"] = created
    return payload


def serialize_saved_article_item(
    *, id_field: str, item: SavedArticleRecord
) -> dict[str, object]:
    return {
        id_field: item.id,
        "article_id": item.article_id,
        "created_at": isoformat_or_none(item.created_at),
    }


async def get_article_or_404(db: AsyncSession, article_id: int) -> ArticleRecord:
    article_stmt = select(ArticleRecord).where(ArticleRecord.id == article_id)
    article_result = await db.execute(article_stmt)
    article = article_result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


async def get_saved_article_item(
    db: AsyncSession, record_model: SavedArticleRecordModel, article_id: int
) -> SavedArticleRecord | None:
    item_stmt = select(record_model).where(record_model.article_id == article_id)
    result = await db.execute(item_stmt)
    return cast(SavedArticleRecord | None, result.scalar_one_or_none())


async def get_saved_article_item_or_404(
    db: AsyncSession,
    record_model: SavedArticleRecordModel,
    article_id: int,
    *,
    not_found_detail: str,
) -> SavedArticleRecord:
    item = await get_saved_article_item(db, record_model, article_id)
    if item is None:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return item
