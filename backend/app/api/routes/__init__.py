from __future__ import annotations

from importlib import import_module
from typing import Protocol, cast

from fastapi import APIRouter

from . import (
    article_analysis,
    blindspots,
    bookmarks,
    cache,
    comparison,
    debug,
    entity_research,
    general,
    image_proxy,
    inline,
    jobs,
    liked,
    news,
    news_by_country,
    profiling,
    reading_queue,
    research,
    search,
    similarity,
    sources,
    stream,
    trending,
    updates,
    verification,
)


class _RouteModule(Protocol):
    router: APIRouter


def _load_route_module(module_name: str) -> _RouteModule:
    return cast(_RouteModule, import_module(f"{__name__}.{module_name}"))


gdelt = _load_route_module("gdelt")
wiki = _load_route_module("wiki")

router = APIRouter()
router.include_router(general.router)
router.include_router(article_analysis.router)
router.include_router(news.router)
router.include_router(news_by_country.router)
router.include_router(cache.router)
router.include_router(stream.router)
router.include_router(debug.router)
router.include_router(bookmarks.router)
router.include_router(liked.router)
router.include_router(reading_queue.router)
router.include_router(research.router)
router.include_router(entity_research.router)
router.include_router(search.router)
router.include_router(profiling.router)
router.include_router(sources.router)
router.include_router(inline.router)
router.include_router(jobs.router)
router.include_router(updates.router)
router.include_router(image_proxy.router)
router.include_router(trending.router)
router.include_router(similarity.router)
router.include_router(verification.router)
router.include_router(gdelt.router)
router.include_router(comparison.router)
router.include_router(blindspots.router)
router.include_router(wiki.router)
