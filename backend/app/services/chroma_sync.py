import asyncio
from sqlalchemy import select, or_, update, desc
from app.core.config import settings
from app.core.logging import get_logger
from app.database import AsyncSessionLocal, Article
from app.vector_store import get_vector_store, is_chroma_reachable

logger = get_logger("chroma_sync")

async def chroma_sync_worker(
    batch_size: int = 100,
    interval_seconds: int = 10,
    startup_delay_seconds: int = 15,
) -> None:
    """Periodically scan for Articles missing from Chroma and backfill them.
    
    This ensures that historical articles (and any missed during ingestion)
    are automatically synchronized into the vector database so they can
    be used for clustering and trending without manual scripts.
    """
    logger.info("Chroma backfill worker starting (delay=%ds)", startup_delay_seconds)
    await asyncio.sleep(startup_delay_seconds)

    while True:
        try:
            if settings.enable_database and AsyncSessionLocal is not None:
                if not is_chroma_reachable():
                    await asyncio.sleep(interval_seconds)
                    continue
                    
                vs = get_vector_store()
                if not vs:
                    await asyncio.sleep(interval_seconds)
                    continue

                async with AsyncSessionLocal() as session:
                    # Find articles without embeddings
                    result = await session.execute(
                        select(Article)
                        .where(
                            or_(
                                Article.embedding_generated.is_(False),
                                Article.embedding_generated.is_(None)
                            )
                        )
                        .where(Article.content != None)
                        .order_by(desc(Article.published_at))
                        .limit(batch_size)
                    )
                    articles = result.scalars().all()
                    
                    if articles:
                        payloads = []
                        for a in articles:
                            payloads.append({
                                "chroma_id": f"article_{a.id}",
                                "article_id": a.id,
                                "title": a.title,
                                "summary": a.summary or "",
                                "content": a.content or "",
                                "source": a.source or "unknown",
                                "url": a.url or "",
                                "published_at": a.published_at.isoformat() if a.published_at else "",
                                "metadata": {
                                    "source_id": a.source_id or "unknown",
                                }
                            })
                            
                        # Batch insert
                        added = await asyncio.to_thread(vs.batch_add_articles, payloads)
                        
                        if added > 0:
                            # Update DB
                            article_ids = [a.id for a in articles]
                            await session.execute(
                                update(Article)
                                .where(Article.id.in_(article_ids))
                                .values(embedding_generated=True)
                            )
                            await session.commit()
                            logger.info("Backfilled %d articles into Chroma vector store.", len(article_ids))
                        else:
                            # If batch add failed (e.g. connection error), don't update DB and sleep
                            await asyncio.sleep(interval_seconds)
                        
                        # Loop quickly while catching up
                        await asyncio.sleep(1)
                    else:
                        # Nothing to backfill right now, poll slowly
                        await asyncio.sleep(interval_seconds * 6)
        except Exception as exc:
            logger.error("Chroma sync worker error: %s", exc)
            await asyncio.sleep(interval_seconds)
            
        await asyncio.sleep(interval_seconds)
