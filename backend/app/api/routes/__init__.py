from __future__ import annotations

from fastapi import APIRouter

from . import (
    article_analysis,
    bookmarks,
    cache,
    debug,
    general,
    news,
    reading_queue,
    research,
    search,
    stream,
)

router = APIRouter()
router.include_router(general.router)
router.include_router(article_analysis.router)
router.include_router(news.router)
router.include_router(cache.router)
router.include_router(stream.router)
router.include_router(debug.router)
router.include_router(bookmarks.router)
router.include_router(reading_queue.router)
router.include_router(research.router)
router.include_router(search.router)
