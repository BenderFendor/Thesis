from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import bindparam, update  # type: ignore[import-unresolved]
from sqlalchemy.dialects.postgresql import insert  # type: ignore[import-unresolved]
from sqlalchemy.ext.asyncio import AsyncSession  # type: ignore[import-unresolved]

from app.core.config import settings
from app.core.logging import get_logger
from app.database import (
    Article as ArticleRecord,
    AsyncSessionLocal,
)
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.vector_store import VectorStore, get_vector_store

logger = get_logger("persistence")

article_persistence_queue: asyncio.Queue[Tuple[List[NewsArticle], Dict[str, Any]]] = (
    asyncio.Queue()
)
embedding_generation_queue: asyncio.Queue[
    Tuple[List[Dict[str, Any]], List[str]]
] = asyncio.Queue(maxsize=settings.embedding_queue_size)
_main_event_loop: Optional[asyncio.AbstractEventLoop] = None


def set_main_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_event_loop
    _main_event_loop = loop


def get_main_event_loop() -> Optional[asyncio.AbstractEventLoop]:
    return _main_event_loop


def get_embedding_queue_depth() -> int:
    return embedding_generation_queue.qsize()


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
                dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def _build_article_tags(article: NewsArticle) -> List[str]:
    tags: List[str] = []
    if article.category:
        tags.append(article.category)
    if article.source:
        tags.append(article.source)
    return list(dict.fromkeys([tag for tag in tags if tag]))


def _build_article_values(
    article: NewsArticle, source_info: Dict[str, Any]
) -> Dict[str, Any]:
    published_dt = parse_published_datetime(article.published)
    published_value = published_dt.astimezone(timezone.utc).replace(tzinfo=None)
    tags = _build_article_tags(article)
    return {
        "title": article.title,
        "source": article.source,
        "source_id": source_info.get("source_id"),
        "country": source_info.get("country"),
        "credibility": source_info.get("credibility"),
        "bias": source_info.get("bias_rating"),
        "summary": article.description,
        "content": article.description,
        "image_url": article.image,
        "published_at": published_value,
        "category": article.category,
        "url": article.link,
        "tags": tags if tags else None,
        "updated_at": datetime.now(timezone.utc).replace(tzinfo=None),
    }


async def _persist_articles_async(
    articles: List[NewsArticle], source_info: Dict[str, Any]
) -> None:
    if not articles:
        return
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Database disabled; skipping persistence for %s", source_info)
        return
    vector_store = get_vector_store()
    async with AsyncSessionLocal() as session:
        try:
            unique_articles: Dict[str, NewsArticle] = {}
            for article in articles:
                if article.link:
                    unique_articles.setdefault(article.link, article)

            if not unique_articles:
                return

            payloads = [
                _build_article_values(article, source_info)
                for article in unique_articles.values()
            ]

            insert_stmt = insert(ArticleRecord).values(payloads)
            upsert_stmt = insert_stmt.on_conflict_do_update(
                index_elements=[ArticleRecord.url],
                set_={
                    "title": insert_stmt.excluded.title,
                    "summary": insert_stmt.excluded.summary,
                    "content": insert_stmt.excluded.content,
                    "image_url": insert_stmt.excluded.image_url,
                    "published_at": insert_stmt.excluded.published_at,
                    "category": insert_stmt.excluded.category,
                    "source": insert_stmt.excluded.source,
                    "source_id": insert_stmt.excluded.source_id,
                    "country": insert_stmt.excluded.country,
                    "credibility": insert_stmt.excluded.credibility,
                    "bias": insert_stmt.excluded.bias,
                    "tags": insert_stmt.excluded.tags,
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            ).returning(
                ArticleRecord.id,
                ArticleRecord.url,
                ArticleRecord.chroma_id,
                ArticleRecord.embedding_generated,
                ArticleRecord.source,
                ArticleRecord.category,
                ArticleRecord.country,
                ArticleRecord.published_at,
                ArticleRecord.title,
                ArticleRecord.summary,
                ArticleRecord.content,
            )

            result = await session.execute(upsert_stmt)
            rows = result.fetchall()

            url_to_row = {row.url: row for row in rows}
            for url, article in unique_articles.items():
                row = url_to_row.get(url)
                if row:
                    article.id = row.id

            embedding_payloads: List[Dict[str, Any]] = []
            chroma_updates: List[Dict[str, Any]] = []
            vector_deletes: List[str] = []

            if vector_store:
                for row in rows:
                    desired_chroma_id = f"article_{row.id}"
                    chroma_changed = row.chroma_id != desired_chroma_id
                    needs_embedding = not row.embedding_generated or chroma_changed

                    if chroma_changed:
                        if row.chroma_id:
                            vector_deletes.append(row.chroma_id)
                        chroma_updates.append(
                            {"id": row.id, "chroma_id": desired_chroma_id}
                        )

                    if needs_embedding:
                        article = unique_articles.get(row.url)
                        if not article:
                            continue
                        metadata_payload = {
                            "source": row.source,
                            "category": row.category
                            or source_info.get("category", "general"),
                            "published": row.published_at.isoformat()
                            if row.published_at
                            else None,
                            "country": row.country
                            or source_info.get("country", "Unknown"),
                            "url": row.url,
                        }
                        embedding_payloads.append(
                            {
                                "article_id": row.id,
                                "chroma_id": desired_chroma_id,
                                "title": row.title,
                                "summary": row.summary or "",
                                "content": (row.content or row.summary or ""),
                                "metadata": metadata_payload,
                            }
                        )

                if chroma_updates:
                    update_stmt = (
                        update(ArticleRecord)
                        .where(ArticleRecord.id == bindparam("id"))
                        .values(
                            chroma_id=bindparam("chroma_id"),
                            embedding_generated=False,
                        )
                    )
                    await session.execute(update_stmt, chroma_updates)

            await session.commit()

            if vector_store and (embedding_payloads or vector_deletes):
                try:
                    embedding_generation_queue.put_nowait(
                        (embedding_payloads, vector_deletes)
                    )
                except asyncio.QueueFull:
                    logger.warning(
                        "Embedding queue full; dropping %s embeddings",
                        len(embedding_payloads),
                    )
        except Exception as exc:  # pragma: no cover - critical logging
            await session.rollback()
            logger.error(
                "Database persistence failed for source %s: %s",
                source_info.get("name") or source_info.get("source") or "unknown",
                exc,
                exc_info=True,
            )


def persist_articles_dual_write(
    articles: List[NewsArticle], source_info: Dict[str, Any]
) -> None:
    if not articles:
        return
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Database disabled; dropping persistence batch for %s", source_info)
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
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Persistence worker exiting; ENABLE_DATABASE=0")
        return
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


async def embedding_generation_worker() -> None:
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Embedding worker exiting; ENABLE_DATABASE=0")
        return
    while True:
        payloads, delete_ids = await embedding_generation_queue.get()
        drained = 1
        try:
            while (
                len(payloads) < settings.embedding_batch_size
                and not embedding_generation_queue.empty()
            ):
                try:
                    extra_payloads, extra_deletes = embedding_generation_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                payloads.extend(extra_payloads)
                delete_ids.extend(extra_deletes)
                drained += 1

            vector_store = get_vector_store()
            if vector_store is None:
                logger.warning("Vector store unavailable; skipping embedding batch")
                continue

            for chroma_id in delete_ids:
                try:
                    vector_store.delete_article(chroma_id)
                except Exception as chroma_error:
                    logger.error(
                        "Vector store delete failed for %s: %s",
                        chroma_id,
                        chroma_error,
                    )

            if payloads:
                added_count = vector_store.batch_add_articles(payloads)
                if added_count:
                    article_ids = [item["article_id"] for item in payloads]
                    async with AsyncSessionLocal() as session:
                        stmt = (
                            update(ArticleRecord)
                            .where(ArticleRecord.id.in_(article_ids))
                            .values(embedding_generated=True)
                        )
                        await session.execute(stmt)
                        await session.commit()

                if settings.embedding_max_per_minute > 0:
                    delay = (
                        len(payloads)
                        * 60
                        / max(1, settings.embedding_max_per_minute)
                    )
                    if delay > 0:
                        await asyncio.sleep(delay)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Embedding worker failed: %s", exc, exc_info=True)
        finally:
            for _ in range(drained):
                embedding_generation_queue.task_done()


async def migrate_cached_articles_on_startup(delay_seconds: int = 5) -> None:
    if not settings.enable_database or AsyncSessionLocal is None:
        logger.info("Database disabled; skipping cached article migration")
        return
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
        source_info = rss_sources.get(
            source_name, {"category": "general", "country": "US"}
        )
        await _persist_articles_async(articles, source_info)
        migrated_count += len(articles)

    logger.info("Migrated %s cached articles to databases on startup", migrated_count)
