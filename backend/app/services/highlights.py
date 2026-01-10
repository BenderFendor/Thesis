from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Highlight
from app.models.reading_queue import Highlight as HighlightSchema
from app.models.reading_queue import CreateHighlightRequest, UpdateHighlightRequest
from app.core.logging import get_logger

logger = get_logger("highlights_service")


async def create_highlight(
    session: AsyncSession, request: CreateHighlightRequest, user_id: int = 1
) -> HighlightSchema:
    """Create a new highlight."""
    highlight = Highlight(
        user_id=user_id,
        article_url=request.article_url,
        highlighted_text=request.highlighted_text,
        color=request.color,
        note=request.note,
        character_start=request.character_start,
        character_end=request.character_end,
    )

    session.add(highlight)
    await session.commit()
    await session.refresh(highlight)

    logger.info(
        "Created highlight for article: %s",
        request.article_url,
    )
    return HighlightSchema.from_attributes(highlight)


async def delete_highlight(
    session: AsyncSession, highlight_id: int, user_id: int = 1
) -> bool:
    """Delete a highlight by ID."""
    result = await session.execute(
        select(Highlight).where(
            Highlight.id == highlight_id,
            Highlight.user_id == user_id,
        )
    )
    highlight = result.scalar_one_or_none()

    if not highlight:
        logger.warning("Highlight not found: %d", highlight_id)
        return False

    await session.delete(highlight)
    await session.commit()

    logger.info("Deleted highlight: %d", highlight_id)
    return True


async def get_highlights_for_article(
    session: AsyncSession, article_url: str, user_id: int = 1
) -> List[HighlightSchema]:
    """Get all highlights for a specific article."""
    result = await session.execute(
        select(Highlight).where(
            Highlight.user_id == user_id,
            Highlight.article_url == article_url,
        )
    )
    highlights = result.scalars().all()
    return [HighlightSchema.from_attributes(h) for h in highlights]


async def get_all_highlights(
    session: AsyncSession, user_id: int = 1
) -> List[HighlightSchema]:
    """Get all highlights for a user."""
    result = await session.execute(
        select(Highlight)
        .where(Highlight.user_id == user_id)
        .order_by(Highlight.created_at.desc())
    )
    highlights = result.scalars().all()
    return [HighlightSchema.from_attributes(h) for h in highlights]


async def update_highlight(
    session: AsyncSession,
    highlight_id: int,
    request: UpdateHighlightRequest,
    user_id: int = 1,
) -> Optional[HighlightSchema]:
    """Update a highlight."""
    result = await session.execute(
        select(Highlight).where(
            Highlight.id == highlight_id,
            Highlight.user_id == user_id,
        )
    )
    highlight = result.scalar_one_or_none()

    if not highlight:
        logger.warning("Highlight not found: %d", highlight_id)
        return None

    if request.color:
        highlight.color = request.color
    if request.note is not None:
        highlight.note = request.note

    highlight.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(highlight)

    logger.info("Updated highlight: %d", highlight_id)
    return HighlightSchema.from_attributes(highlight)
