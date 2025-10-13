from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select  # type: ignore[import-unresolved]
from sqlalchemy.ext.asyncio import AsyncSession  # type: ignore[import-unresolved]

from app.core.logging import get_logger
from app.database import (
    Article as ArticleRecord,
    AsyncSessionLocal,
)
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.vector_store import vector_store

logger = get_logger("persistence")

article_persistence_queue: asyncio.Queue[Tuple[List[NewsArticle], Dict[str, Any]]] = asyncio.Queue()
_main_event_loop: Optional[asyncio.AbstractEventLoop] = None


def set_main_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_event_loop
    _main_event_loop = loop


def get_main_event_loop() -> Optional[asyncio.AbstractEventLoop]:
    return _main_event_loop


def parse_published_datetime(published: Optional[str]) -> datetime:
    from email.utils import parsedate_to_datetime

    if isinstance(published, datetime):
        dt = published
    elif published:
        try:
            dt = parsedate_to_datetime(published)
        except Exception:
            try:
                normalized = published.replace("Z", "+00:00")
                dt = datetime.fromisoformat(normalized)
            except Exception:
                dt = datetime.utcnow().replace(tzinfo=timezone.utc)
    else:
        dt = datetime.utcnow().replace(tzinfo=timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


async def _upsert_article(
    session: AsyncSession,
    article: NewsArticle,
    source_info: Dict[str, Any],
    vector_batch: Optional[List[Dict[str, Any]]] = None,
    vector_deletes: Optional[List[str]] = None,
) -> int:
    published_dt = parse_published_datetime(article.published)
    published_value = published_dt.astimezone(timezone.utc).replace(tzinfo=None)

    tags = []
    if article.category:
        tags.append(article.category)
    if article.source:
        tags.append(article.source)
    tags = list(dict.fromkeys([tag for tag in tags if tag]))

    existing_result = await session.execute(
        select(ArticleRecord).where(ArticleRecord.url == article.link)
    )
    article_record = existing_result.scalar_one_or_none()

    if article_record:
        article_record.title = article.title
        article_record.summary = article.description
        article_record.content = article.description
        article_record.image_url = article.image
        article_record.published_at = published_value
        article_record.category = article.category
        article_record.source = article.source
        if source_info.get("country"):
            article_record.country = source_info.get("country")
        if source_info.get("bias_rating"):
            article_record.bias = source_info.get("bias_rating")
        if source_info.get("credibility"):
            article_record.credibility = source_info.get("credibility")
        if tags:
            article_record.tags = tags
        article_record.updated_at = datetime.utcnow()
    else:
        article_record = ArticleRecord(
            title=article.title,
            source=article.source,
            source_id=source_info.get("source_id"),
            country=source_info.get("country"),
            credibility=source_info.get("credibility"),
            bias=source_info.get("bias_rating"),
            summary=article.description,
            content=article.description,
            image_url=article.image,
            published_at=published_value,
            category=article.category,
            url=article.link,
            tags=tags if tags else None,
        )
        session.add(article_record)
        await session.flush()

    article_id = article_record.id

    if vector_store:
        chroma_id = f"article_{article_id}"
        metadata_payload = {
            "source": article_record.source,
            "category": article_record.category or source_info.get("category", "general"),
            "published": article_record.published_at.isoformat() if article_record.published_at else None,
            "country": article_record.country or source_info.get("country", "Unknown"),
            "url": article_record.url,
        }

        if vector_batch is not None:
            if article_record.chroma_id and article_record.chroma_id != chroma_id and vector_deletes is not None:
                vector_deletes.append(article_record.chroma_id)

            vector_batch.append(
                {
                    "chroma_id": chroma_id,
                    "title": article_record.title,
                    "summary": article_record.summary or "",
                    "content": (article_record.content or article_record.summary or ""),
                    "metadata": metadata_payload,
                    "record": article_record,
                }
            )
            article_record.embedding_generated = False
        else:
            try:
                if article_record.chroma_id and article_record.chroma_id != chroma_id:
                    vector_store.delete_article(article_record.chroma_id)
                success = vector_store.add_article(
                    article_id=chroma_id,
                    title=article_record.title,
                    summary=article_record.summary or "",
                    content=(article_record.content or article_record.summary or ""),
                    metadata=metadata_payload,
                )
                if success:
                    article_record.chroma_id = chroma_id
                    article_record.embedding_generated = True
            except Exception as chroma_error:  # pragma: no cover - best effort logging
                logger.error("Vector store write failed for article %s: %s", article_id, chroma_error)

    article.id = article_id
    return article_id


async def _persist_articles_async(articles: List[NewsArticle], source_info: Dict[str, Any]) -> None:
    if not articles:
        return
    async with AsyncSessionLocal() as session:
        try:
            vector_batch: List[Dict[str, Any]] = []
            vector_deletes: List[str] = []
            for article in articles:
                await _upsert_article(
                    session,
                    article,
                    source_info,
                    vector_batch=vector_batch if vector_store else None,
                    vector_deletes=vector_deletes if vector_store else None,
                )

            if vector_store and vector_batch:
                delete_targets = [chroma_id for chroma_id in vector_deletes if chroma_id]
                for chroma_id in delete_targets:
                    try:
                        vector_store.delete_article(chroma_id)
                    except Exception as chroma_error:
                        logger.error("Vector store delete failed for %s: %s", chroma_id, chroma_error)

                payloads = []
                for item in vector_batch:
                    payloads.append(
                        {
                            "chroma_id": item["chroma_id"],
                            "title": item["title"],
                            "summary": item["summary"],
                            "content": item["content"],
                            "metadata": item["metadata"],
                        }
                    )

                added_count = vector_store.batch_add_articles(payloads)

                if added_count:
                    for item in vector_batch:
                        record = item.get("record")
                        if record:
                            record.chroma_id = item["chroma_id"]
                            record.embedding_generated = True

            await session.commit()
        except Exception as exc:  # pragma: no cover - critical logging
            await session.rollback()
            logger.error(
                "Database persistence failed for source %s: %s",
                source_info.get("name") or source_info.get("source") or "unknown",
                exc,
                exc_info=True,
            )


def persist_articles_dual_write(articles: List[NewsArticle], source_info: Dict[str, Any]) -> None:
    if not articles:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        target_loop = get_main_event_loop()
        if target_loop and target_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                article_persistence_queue.put((articles, source_info)),
                target_loop,
            )

            def _log_future_result(fut: asyncio.Future) -> None:
                try:
                    fut.result()
                except Exception as exc:  # pragma: no cover - best effort logging
                    logger.error("Dual-write enqueue failed: %s", exc, exc_info=True)

            future.add_done_callback(_log_future_result)
        else:
            try:
                asyncio.run(_persist_articles_async(articles, source_info))
            except Exception as exc:  # pragma: no cover - critical logging
                logger.error("Dual-write execution failed: %s", exc, exc_info=True)
    else:
        loop.create_task(article_persistence_queue.put((articles, source_info)))


async def article_persistence_worker() -> None:
    while True:
        articles, source_info = await article_persistence_queue.get()
        try:
            await _persist_articles_async(articles, source_info)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error(
                "Queued database persistence failed for source %s: %s",
                source_info.get("name") or source_info.get("source") or "unknown",
                exc,
                exc_info=True,
            )
        finally:
            article_persistence_queue.task_done()


async def migrate_cached_articles_on_startup(delay_seconds: int = 5) -> None:
    from app.data.rss_sources import get_rss_sources

    await asyncio.sleep(delay_seconds)
    cached_articles = news_cache.get_articles()
    if not cached_articles:
        logger.info("No cached articles to migrate to databases")
        return

    grouped_articles: Dict[str, List[NewsArticle]] = defaultdict(list)
    for cached_article in cached_articles:
        grouped_articles[cached_article.source].append(cached_article)

    rss_sources = get_rss_sources()
    migrated_count = 0
    for source_name, articles in grouped_articles.items():
        source_info = rss_sources.get(source_name, {"category": "general", "country": "US"})
        await _persist_articles_async(articles, source_info)
        migrated_count += len(articles)

    logger.info("🗄️ Migrated %s cached articles to databases on startup", migrated_count)
