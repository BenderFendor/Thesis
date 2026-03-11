from __future__ import annotations

import json
import re
from pathlib import Path
from typing import cast

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article

logger = get_logger(__name__)

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_COUNTRIES_PATH = _DATA_DIR / "countries.json"
_COUNTRY_ALIASES_PATH = _DATA_DIR / "country_aliases.json"

try:
    with _COUNTRIES_PATH.open("r", encoding="utf-8") as file_obj:
        _COUNTRIES_DATA = cast(dict[str, dict[str, object]], json.load(file_obj))
except Exception as exc:
    logger.warning("Failed to load countries.json: %s", exc)
    _COUNTRIES_DATA = {}

try:
    with _COUNTRY_ALIASES_PATH.open("r", encoding="utf-8") as file_obj:
        _RAW_ALIASES = cast(dict[str, list[str]], json.load(file_obj))
except Exception as exc:
    logger.warning("Failed to load country_aliases.json: %s", exc)
    _RAW_ALIASES = {}


def _is_textual_alias(alias: str) -> bool:
    stripped = alias.strip()
    if len(stripped) < 4:
        return stripped in {"U.K.", "UK", "USA", "UAE", "PRC", "DPRK"}
    if any(char in stripped for char in {",", "/"}):
        return False
    if stripped.isupper() and len(stripped) <= 3:
        return False
    return any(char.isalpha() for char in stripped)


_COUNTRY_ALIAS_MAP = {
    code: tuple(
        sorted(
            {
                alias.strip()
                for alias in aliases
                if isinstance(alias, str) and alias.strip()
            },
            key=len,
            reverse=True,
        )
    )
    for code, aliases in _RAW_ALIASES.items()
}
_TEXTUAL_ALIAS_MAP = {
    code: tuple(alias for alias in aliases if _is_textual_alias(alias))
    for code, aliases in _COUNTRY_ALIAS_MAP.items()
}
_TOKEN_RE = re.compile(r"[\w']+", re.UNICODE)


def _alias_tokens(value: str) -> tuple[str, ...]:
    return tuple(token.casefold() for token in _TOKEN_RE.findall(value))


_ALIAS_TO_CODES: dict[tuple[str, ...], set[str]] = {}
for country_code, aliases in _TEXTUAL_ALIAS_MAP.items():
    for alias in aliases:
        normalized = _alias_tokens(alias)
        if normalized:
            _ALIAS_TO_CODES.setdefault(normalized, set()).add(country_code)

_UNIQUE_ALIAS_TO_CODE = {
    alias_tokens: next(iter(country_codes))
    for alias_tokens, country_codes in _ALIAS_TO_CODES.items()
    if len(country_codes) == 1
}
_MAX_ALIAS_TOKENS = max((len(tokens) for tokens in _UNIQUE_ALIAS_TO_CODE), default=1)


def get_country_geo_data() -> dict[str, dict[str, object]]:
    return _COUNTRIES_DATA


def country_name(code: str) -> str:
    country = _COUNTRIES_DATA.get(code.upper())
    if isinstance(country, dict):
        name = country.get("name")
        if isinstance(name, str) and name.strip():
            return name
    return code.upper()


def build_article_text(
    title: str | None,
    summary: str | None,
    content: str | None,
) -> str:
    return " ".join(
        part.strip()
        for part in (title, summary, content)
        if isinstance(part, str) and part.strip()
    )


def extract_mentioned_countries(text: str) -> list[str]:
    if not text.strip():
        return []

    tokens = [token.casefold() for token in _TOKEN_RE.findall(text)]
    mentions: set[str] = set()
    for index in range(len(tokens)):
        max_width = min(_MAX_ALIAS_TOKENS, len(tokens) - index)
        for width in range(max_width, 0, -1):
            country_code = _UNIQUE_ALIAS_TO_CODE.get(
                tuple(tokens[index : index + width])
            )
            if country_code is not None:
                mentions.add(country_code)
                break
    return sorted(mentions)


def extract_article_mentioned_countries(
    title: str | None,
    summary: str | None,
    content: str | None,
) -> list[str]:
    return extract_mentioned_countries(build_article_text(title, summary, content))


async def backfill_article_mentioned_countries(
    session: AsyncSession,
    *,
    batch_size: int = 500,
    max_batches: int | None = None,
) -> dict[str, int]:
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
