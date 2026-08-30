"""Synchronize PostgreSQL articles into ChromaDB.

Normal mode: the backfill loop picks up articles with embedding_generated=False
and embeds them in batches.

Drift recovery mode: triggered when Chroma has fewer than FULL_SYNC_THRESHOLD
documents on startup (e.g. after a /tmp wipe). Instead of resetting 80k DB
flags (which requires heavy UPDATE queries on a busy DB), the worker iterates
through ALL articles by published_at DESC using an offset cursor, checking
each batch against Chroma's existing IDs before embedding. This avoids any
mass UPDATE and works safely alongside continuous RSS ingestion.

In both modes, sync_caught_up is set as soon as any articles are in Chroma so
the cluster computation worker can start promptly.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import select, update

from app.core.config import settings
from app.core.logging import get_logger
from app.database import AsyncSessionLocal, Article
from app.vector_store import (
    BatchArticlePayload,
    VectorStore,
    get_vector_store,
    is_chroma_reachable,
)

logger = get_logger("chroma_sync")

# Set once the initial backfill pass finishes (or Chroma was already in sync).
# The cluster computation worker awaits this before its first run.
sync_caught_up: asyncio.Event = asyncio.Event()

# Below this Chroma doc count we assume a /tmp wipe and enter drift recovery.
_FULL_SYNC_THRESHOLD = 10_000

# Set True when drift is detected; cleared when recovery scan completes.
_drift_recovery: bool = False


@dataclass(slots=True)
class _RecoveryState:
    offset: int = 0
    total_embedded: int = 0
    consecutive_errors: int = 0
    batches_scanned: int = 0


def _get_session_factory() -> Any:
    return cast(Any, AsyncSessionLocal)


def _build_batch_payload(article: Article) -> BatchArticlePayload:
    return {
        "chroma_id": f"article_{article.id}",
        "title": article.title or "",
        "summary": article.summary or "",
        "content": article.content or "",
        "metadata": {"source_id": article.source_id or "unknown"},
    }


async def _detect_and_fix_chroma_drift(vs: VectorStore) -> bool:
    """Return True if drift was detected and recovery mode was activated.

    Uses only the Chroma document count (fast, no DB query) to decide.
    Signals sync_caught_up immediately so the cluster worker can proceed with
    whatever Chroma already holds while the recovery scan runs.
    """
    global _drift_recovery

    try:
        chroma_count: int = await asyncio.to_thread(vs.collection.count)
    except Exception as exc:
        logger.warning("Could not count Chroma documents: %s", exc)
        return False

    logger.info("Chroma document count at startup: %d", chroma_count)

    if chroma_count >= _FULL_SYNC_THRESHOLD:
        logger.info(
            "Chroma has %d docs (>= threshold %d); no drift recovery needed.",
            chroma_count,
            _FULL_SYNC_THRESHOLD,
        )
        if not sync_caught_up.is_set():
            sync_caught_up.set()
            logger.info(
                "Chroma already populated (%d docs); cluster worker unblocked.",
                chroma_count,
            )
        return False

    logger.warning(
        "Chroma has only %d docs (threshold %d). Entering drift recovery mode "
        "(full re-scan without DB flag reset).",
        chroma_count,
        _FULL_SYNC_THRESHOLD,
    )
    _drift_recovery = True

    if not sync_caught_up.is_set():
        sync_caught_up.set()
        logger.info("Chroma has %d documents; cluster worker unblocked.", chroma_count)

    return True


async def chroma_sync_worker(
    batch_size: int = 200,
    interval_seconds: int = 10,
    startup_delay_seconds: int = 15,
) -> None:
    """Periodically backfill articles into ChromaDB."""
    global _drift_recovery

    logger.info("Chroma sync worker starting (delay=%ds)", startup_delay_seconds)
    await asyncio.sleep(startup_delay_seconds)
    drift_checked = False

    while True:
        try:
            if not (settings.enable_database and AsyncSessionLocal is not None):
                await asyncio.sleep(interval_seconds)
                continue

            if not is_chroma_reachable():
                await asyncio.sleep(interval_seconds)
                continue

            vs = get_vector_store()
            if vs is None:
                await asyncio.sleep(interval_seconds)
                continue

            if not drift_checked:
                drift_checked = True
                await _detect_and_fix_chroma_drift(vs)

            if _drift_recovery:
                await _run_recovery_scan(vs, batch_size, interval_seconds)
                _drift_recovery = False
                logger.info("Drift recovery scan complete; switching to normal mode.")
                continue

            async with _get_session_factory()() as session:
                result = await session.execute(
                    select(Article)
                    .where(
                        Article.embedding_generated.is_(False)
                        | Article.embedding_generated.is_(None)
                    )
                    .where(Article.content.isnot(None))
                    .order_by(Article.published_at.desc())
                    .limit(batch_size)
                )
                articles = result.scalars().all()

            if not articles:
                if not sync_caught_up.is_set():
                    logger.info("Chroma sync caught up; signalling cluster computation worker.")
                    sync_caught_up.set()
                await asyncio.sleep(interval_seconds * 6)
                continue

            await _embed_and_mark(vs, articles, interval_seconds)

        except Exception as exc:
            logger.error("Chroma sync worker error: %s", exc)
            await asyncio.sleep(interval_seconds)


def _recovery_cutoff() -> datetime:
    return (datetime.now(UTC) - timedelta(days=7)).replace(tzinfo=None)


async def _fetch_recovery_batch(
    offset: int,
    batch_size: int,
    cutoff: datetime,
) -> list[Article] | None:
    try:
        async with _get_session_factory()() as session:
            result = await session.execute(
                select(Article)
                .where(Article.content.isnot(None))
                .where(Article.published_at >= cutoff)
                .order_by(Article.published_at.desc())
                .offset(offset)
                .limit(batch_size)
            )
            return list(result.scalars().all())
    except Exception as exc:
        logger.warning("Recovery scan: DB fetch failed (%s); retrying.", exc)
        return None


async def _existing_recovery_ids(
    vs: VectorStore,
    articles: list[Article],
) -> set[str] | None:
    chroma_ids = [f"article_{article.id}" for article in articles]
    try:
        existing = await asyncio.to_thread(vs.collection.get, chroma_ids, include=[])
    except Exception as exc:
        logger.warning("Recovery scan: Chroma get failed (%s); skipping batch.", exc)
        return None
    return set(existing["ids"])


def _missing_recovery_articles(
    articles: list[Article],
    existing_ids: set[str],
) -> list[Article]:
    return [article for article in articles if f"article_{article.id}" not in existing_ids]


async def _mark_recovery_articles(article_ids: list[int]) -> None:
    try:
        async with _get_session_factory()() as session:
            await session.execute(
                update(Article).where(Article.id.in_(article_ids)).values(embedding_generated=True)
            )
            await session.commit()
    except Exception as exc:
        logger.warning(
            "Recovery scan: could not mark %d articles as embedded: %s",
            len(article_ids),
            exc,
        )


async def _embed_recovery_articles(
    vs: VectorStore,
    missing: list[Article],
    offset: int,
) -> int:
    if not missing:
        return 0

    payloads = [_build_batch_payload(article) for article in missing]
    try:
        added = await asyncio.to_thread(vs.batch_add_articles, payloads)
    except Exception as exc:
        logger.warning("Recovery scan: Chroma batch add failed (%s); skipping batch.", exc)
        return 0

    if added <= 0:
        return 0

    logger.info(
        "Recovery scan: embedded %d articles (offset=%d)",
        added,
        offset,
    )
    if not sync_caught_up.is_set():
        sync_caught_up.set()
        logger.info("First recovery batch done; cluster worker unblocked.")
    await _mark_recovery_articles([article.id for article in missing])
    return added


def _log_recovery_progress(state: _RecoveryState, batch_size: int, missing_count: int) -> None:
    if state.batches_scanned % 20 != 0:
        return
    logger.info(
        "Recovery scan progress: offset=%d scanned=%d missing_this_run=%d",
        state.offset,
        state.batches_scanned * batch_size,
        missing_count,
    )


async def _run_recovery_scan(
    vs: VectorStore,
    batch_size: int,
    interval_seconds: int,
) -> None:
    """Re-embed recent articles (past 7 days) not already in Chroma."""
    cutoff = _recovery_cutoff()
    logger.info(
        "Drift recovery scan starting: re-embedding articles since %s.",
        cutoff.strftime("%Y-%m-%d"),
    )
    state = _RecoveryState()

    while True:
        articles = await _fetch_recovery_batch(state.offset, batch_size, cutoff)
        if articles is None:
            state.consecutive_errors += 1
            if state.consecutive_errors >= 10:
                logger.error("Recovery scan: too many DB errors; aborting.")
                return
            await asyncio.sleep(interval_seconds)
            continue

        if not articles:
            logger.info(
                "Recovery scan complete: %d articles embedded into Chroma (7-day window).",
                state.total_embedded,
            )
            return

        state.consecutive_errors = 0
        existing_ids = await _existing_recovery_ids(vs, articles)
        if existing_ids is None:
            state.offset += batch_size
            await asyncio.sleep(interval_seconds)
            continue

        missing = _missing_recovery_articles(articles, existing_ids)
        state.batches_scanned += 1
        _log_recovery_progress(state, batch_size, len(missing))
        state.total_embedded += await _embed_recovery_articles(vs, missing, state.offset)
        state.offset += batch_size
        await asyncio.sleep(0.5)


async def _embed_and_mark(
    vs: VectorStore,
    articles: list[Article],
    interval_seconds: int,
) -> None:
    """Embed a batch of articles and mark them as embedded in Postgres."""
    payloads = [_build_batch_payload(article) for article in articles]
    added = await asyncio.to_thread(vs.batch_add_articles, payloads)

    if added > 0:
        article_ids = [article.id for article in articles]
        async with _get_session_factory()() as session:
            await session.execute(
                update(Article).where(Article.id.in_(article_ids)).values(embedding_generated=True)
            )
            await session.commit()
        logger.info("Synced %d articles into Chroma vector store.", added)
        if not sync_caught_up.is_set():
            logger.info("First Chroma batch complete; signalling cluster computation worker.")
            sync_caught_up.set()
        await asyncio.sleep(1)
    else:
        await asyncio.sleep(interval_seconds)
