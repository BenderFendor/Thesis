"""Country Mentions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article
from app.services.rss_parser_rust_bindings import (
    extract_article_mentioned_countries_rust,
    extract_mentioned_countries_rust,
)

logger = get_logger(__name__)

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_COUNTRIES_PATH = _DATA_DIR / "countries.json"

try:
    with _COUNTRIES_PATH.open("r", encoding="utf-8") as file_obj:
        _COUNTRIES_DATA = cast(dict[str, dict[str, object]], json.load(file_obj))
except Exception as exc:
    logger.warning("Failed to load countries.json: %s", exc)
    _COUNTRIES_DATA = {}


def get_country_geo_data() -> dict[str, dict[str, object]]:
    """Get Country Geo Data."""
    return _COUNTRIES_DATA


def country_name(code: str) -> str:
    """Country Name."""
    country = _COUNTRIES_DATA.get(code.upper())
    if isinstance(country, dict):
        name = country.get("name")
        if isinstance(name, str) and name.strip():
            return name
    return code.upper()


def extract_mentioned_countries(text: str) -> list[str]:
    """Extract Mentioned Countries."""
    return extract_mentioned_countries_rust(text)


def extract_article_mentioned_countries(
    title: str | None,
    summary: str | None,
    content: str | None,
) -> list[str]:
    """Extract Article Mentioned Countries."""
    return extract_article_mentioned_countries_rust(title, summary, content)


async def backfill_article_mentioned_countries(
    session: AsyncSession,
    *,
    batch_size: int = 500,
    max_batches: int | None = None,
) -> dict[str, int]:
    """Backfill Article Mentioned Countries."""
    processed = 0
    updated = 0
    batches = 0

    while max_batches is None or batches < max_batches:
        stmt = (
            select(Article)
            .where(
                or_(
                    Article.mentioned_countries.is_(None),
                    Article.mentioned_countries == [],
                )
            )
            .order_by(Article.id.asc())
            .limit(batch_size)
        )
        records = list((await session.execute(stmt)).scalars().all())
        if not records:
            break

        for record in records:
            record.mentioned_countries = extract_article_mentioned_countries(
                record.title,
                record.summary,
                record.content,
            )
            updated += 1

        await session.commit()
        processed += len(records)
        batches += 1

    remaining_stmt = select(Article.id).where(
        or_(Article.mentioned_countries.is_(None), Article.mentioned_countries == [])
    )
    remaining = len((await session.execute(remaining_stmt)).all())

    return {
        "processed": processed,
        "updated": updated,
        "batches": batches,
        "remaining": remaining,
    }
