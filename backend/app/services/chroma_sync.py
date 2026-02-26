"""Synchronize PostgreSQL articles into ChromaDB.

Normal mode: the backfill loop picks up articles with embedding_generated=False
and embeds them in batches.

Drift recovery mode: triggered when Chroma has fewer than FULL_SYNC_THRESHOLD
documents on startup (e.g. after a /tmp wipe).  Instead of resetting 80k DB
flags (which requires heavy UPDATE queries on a busy DB), the worker iterates
through ALL articles by published_at DESC using an offset cursor, checking
each batch against Chroma's existing IDs before embedding.  This avoids any
mass UPDATE and works safely alongside continuous RSS ingestion.

In both modes, sync_caught_up is set as soon as any articles are in Chroma so
the cluster computation worker can start promptly.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select, update

from app.core.config import settings
from app.core.logging import get_logger
from app.database import AsyncSessionLocal, Article
from app.vector_store import get_vector_store, is_chroma_reachable

logger = get_logger("chroma_sync")

# Set once the initial backfill pass finishes (or Chroma was already in sync).
# The cluster computation worker awaits this before its first run.
sync_caught_up: asyncio.Event = asyncio.Event()

# Below this Chroma doc count we assume a /tmp wipe and enter drift recovery.
_FULL_SYNC_THRESHOLD = 10_000

# Set True when drift is detected; cleared when recovery scan completes.
_drift_recovery: bool = False


async def _detect_and_fix_chroma_drift(vs) -> bool:
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
        return False

    logger.warning(
        "Chroma has only %d docs (threshold %d). Entering drift recovery mode "
        "(full re-scan without DB flag reset).",
        chroma_count,
        _FULL_SYNC_THRESHOLD,
    )
    _drift_recovery = True

    # Unblock the cluster worker immediately so it can compute from what Chroma
    # already holds while the recovery scan runs in the background.
    if not sync_caught_up.is_set():
        sync_caught_up.set()
        logger.info("Chroma has %d documents; cluster worker unblocked.", chroma_count)

    return True


async def chroma_sync_worker(
    batch_size: int = 200,
    interval_seconds: int = 10,
    startup_delay_seconds: int = 15,
) -> None:
    """Periodically backfill articles into ChromaDB.

    On first run: detects Chroma/DB drift and activates recovery mode if needed.

    Normal loop: picks up articles with embedding_generated=False and embeds
    them.  Signals sync_caught_up after the first successful batch.

    Recovery loop: iterates all articles by published_at DESC using an offset
    cursor, checks each batch against Chroma's existing IDs, and embeds only
    the missing ones.  No mass DB UPDATE required.
    """
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

            # One-time drift detection on first successful Chroma connection.
            if not drift_checked:
                drift_checked = True
                await _detect_and_fix_chroma_drift(vs)

            if _drift_recovery:
                await _run_recovery_scan(vs, batch_size, interval_seconds)
                # Recovery scan finished (or permanently failed); fall back to
                # normal mode which will pick up any remaining unembedded rows.
                _drift_recovery = False
                logger.info("Drift recovery scan complete; switching to normal mode.")
                continue

            # --- Normal mode: embed articles flagged embedding_generated=False ---
            async with AsyncSessionLocal() as session:
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
                    logger.info(
                        "Chroma sync caught up; signalling cluster computation worker."
                    )
                    sync_caught_up.set()
                await asyncio.sleep(interval_seconds * 6)
                continue

            await _embed_and_mark(vs, articles, interval_seconds)

        except Exception as exc:
            logger.error("Chroma sync worker error: %s", exc)
            await asyncio.sleep(interval_seconds)


async def _run_recovery_scan(vs, batch_size: int, interval_seconds: int) -> None:
    """Re-embed recent articles (past 7 days) not already in Chroma.

    Scopes the scan to the past 7 days so it covers all cluster windows (1d, 3d, 7d)
    without iterating 80k rows in a memory-constrained gunicorn worker.  Older articles
    are left to the normal sync worker, which backtracks naturally over time.

    Checks Chroma membership directly — no mass DB flag reset required.
    """
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    # Strip timezone for naive DB column comparison.
    cutoff_naive = cutoff.replace(tzinfo=None)
    logger.info(
        "Drift recovery scan starting: re-embedding articles since %s.",
        cutoff.strftime("%Y-%m-%d"),
    )
    offset = 0
    total_embedded = 0
    consecutive_errors = 0
    batches_scanned = 0

    while True:
        # Fetch a batch of recent articles (within 7-day recovery window).
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Article)
                    .where(Article.content.isnot(None))
                    .where(Article.published_at >= cutoff_naive)
                    .order_by(Article.published_at.desc())
                    .offset(offset)
                    .limit(batch_size)
                )
                articles = result.scalars().all()
        except Exception as exc:
            logger.warning("Recovery scan: DB fetch failed (%s); retrying.", exc)
            consecutive_errors += 1
            if consecutive_errors >= 10:
                logger.error("Recovery scan: too many DB errors; aborting.")
                return
            await asyncio.sleep(interval_seconds)
            continue

        if not articles:
            logger.info(
                "Recovery scan complete: %d articles embedded into Chroma (7-day window).",
                total_embedded,
            )
            return

        consecutive_errors = 0

        # Check which IDs are already in Chroma.
        chroma_ids = [f"article_{a.id}" for a in articles]
        try:
            existing = await asyncio.to_thread(
                vs.collection.get, chroma_ids, include=[]
            )
            existing_set = set(existing["ids"])
        except Exception as exc:
            logger.warning(
                "Recovery scan: Chroma get failed (%s); skipping batch.", exc
            )
            offset += batch_size
            await asyncio.sleep(interval_seconds)
            continue

        missing = [a for a in articles if f"article_{a.id}" not in existing_set]

        batches_scanned += 1
        # Log progress every 20 batches (~4,000 articles) so the scan stays visible in logs.
        if batches_scanned % 20 == 0:
            logger.info(
                "Recovery scan progress: offset=%d scanned=%d missing_this_run=%d",
                offset,
                batches_scanned * batch_size,
                len(missing),
            )

        if missing:
            payloads = [
                {
                    "chroma_id": f"article_{a.id}",
                    "article_id": a.id,
                    "title": a.title or "",
                    "summary": a.summary or "",
                    "content": a.content or "",
                    "source": a.source or "unknown",
                    "url": a.url or "",
                    "published_at": a.published_at.isoformat()
                    if a.published_at
                    else "",
                    "metadata": {"source_id": a.source_id or "unknown"},
                }
                for a in missing
            ]
            try:
                added = await asyncio.to_thread(vs.batch_add_articles, payloads)
                if added > 0:
                    total_embedded += added
                    logger.info(
                        "Recovery scan: embedded %d articles (offset=%d, total=%d)",
                        added,
                        offset,
                        total_embedded,
                    )
                    if not sync_caught_up.is_set():
                        sync_caught_up.set()
                        logger.info(
                            "First recovery batch done; cluster worker unblocked."
                        )
                    # Mark embedded articles so normal mode doesn't re-process them.
                    article_ids = [a.id for a in missing]
                    try:
                        async with AsyncSessionLocal() as session:
                            await session.execute(
                                update(Article)
                                .where(Article.id.in_(article_ids))
                                .values(embedding_generated=True)
                            )
                            await session.commit()
                    except Exception as mark_exc:
                        # Non-fatal: worst case normal mode re-tries these.
                        logger.warning(
                            "Recovery scan: could not mark %d articles as embedded: %s",
                            len(article_ids),
                            mark_exc,
                        )
            except Exception as exc:
                logger.warning(
                    "Recovery scan: Chroma batch add failed (%s); skipping batch.", exc
                )

        offset += batch_size
        # Brief pause between batches to avoid overwhelming DB or Chroma.
        await asyncio.sleep(0.5)


async def _embed_and_mark(vs, articles, interval_seconds: int) -> None:
    """Embed a batch of articles and mark them as embedded in Postgres."""
    payloads = [
        {
            "chroma_id": f"article_{a.id}",
            "article_id": a.id,
            "title": a.title or "",
            "summary": a.summary or "",
            "content": a.content or "",
            "source": a.source or "unknown",
            "url": a.url or "",
            "published_at": a.published_at.isoformat() if a.published_at else "",
            "metadata": {"source_id": a.source_id or "unknown"},
        }
        for a in articles
    ]

    added = await asyncio.to_thread(vs.batch_add_articles, payloads)

    if added > 0:
        article_ids = [a.id for a in articles]
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Article)
                .where(Article.id.in_(article_ids))
                .values(embedding_generated=True)
            )
            await session.commit()
        logger.info("Synced %d articles into Chroma vector store.", added)
        if not sync_caught_up.is_set():
            logger.info(
                "First Chroma batch complete; signalling cluster computation worker."
            )
            sync_caught_up.set()
        # Loop quickly while catching up.
        await asyncio.sleep(1)
    else:
        await asyncio.sleep(interval_seconds)
