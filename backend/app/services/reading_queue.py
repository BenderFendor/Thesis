from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from sqlalchemy import select, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import ReadingQueueItem
from app.models.reading_queue import ReadingQueueItem as ReadingQueueItemSchema
from app.models.reading_queue import AddToQueueRequest, UpdateQueueItemRequest
from app.core.logging import get_logger

logger = get_logger("reading_queue_service")

# Default TTL for daily queue items (7 days)
DAILY_QUEUE_TTL_DAYS = 7

# Average adult reading speed (words per minute)
AVERAGE_READING_SPEED = 230


def calculate_read_time(text: Optional[str]) -> Optional[int]:
    """
    Calculate estimated read time in minutes based on word count.
    Formula: minutes = ceil(word_count / 230)
    """
    if not text:
        return None
    word_count = len(text.split())
    if word_count == 0:
        return None
    import math
    return math.ceil(word_count / AVERAGE_READING_SPEED)


def get_word_count(text: Optional[str]) -> Optional[int]:
    """Calculate word count from text."""
    if not text:
        return None
    return len(text.split())


async def add_to_queue(
    session: AsyncSession, request: AddToQueueRequest, user_id: int = 1
) -> ReadingQueueItemSchema:
    """Add an article to the reading queue."""
    # Check if article already exists in queue
    existing = await session.execute(
        select(ReadingQueueItem).where(
            ReadingQueueItem.article_url == request.article_url
        )
    )
    existing_item = existing.scalar_one_or_none()

    if existing_item:
        logger.info(
            "Article %s already in queue, skipping duplicate", request.article_url
        )
        return ReadingQueueItemSchema.from_attributes(existing_item)

    # Get max position for new items (add to top)
    max_pos = await session.execute(
        select(ReadingQueueItem).order_by(desc(ReadingQueueItem.position)).limit(1)
    )
    max_position_item = max_pos.scalar_one_or_none()
    new_position = (max_position_item.position + 1) if max_position_item else 0

    queue_item = ReadingQueueItem(
        user_id=user_id,
        article_id=request.article_id,
        article_title=request.article_title,
        article_url=request.article_url,
        article_source=request.article_source,
        article_image=request.article_image,
        queue_type=request.queue_type or "daily",
        position=new_position,
        read_status="unread",
        added_at=datetime.utcnow(),
    )

    session.add(queue_item)
    await session.commit()
    await session.refresh(queue_item)

    logger.info("Added article to queue: %s", request.article_title)
    return ReadingQueueItemSchema.from_attributes(queue_item)


async def remove_from_queue(
    session: AsyncSession, queue_id: int, user_id: int = 1
) -> bool:
    """Remove an item from the reading queue."""
    result = await session.execute(
        select(ReadingQueueItem).where(
            and_(
                ReadingQueueItem.id == queue_id,
                ReadingQueueItem.user_id == user_id,
            )
        )
    )
    queue_item = result.scalar_one_or_none()

    if not queue_item:
        logger.warning("Queue item not found: %d", queue_id)
        return False

    await session.delete(queue_item)
    await session.commit()

    logger.info("Removed item from queue: %d", queue_id)
    return True


async def get_queue(
    session: AsyncSession, user_id: int = 1
) -> Tuple[List[ReadingQueueItemSchema], int, int]:
    """Get all items in the reading queue for a user."""
    result = await session.execute(
        select(ReadingQueueItem)
        .where(ReadingQueueItem.user_id == user_id)
        .order_by(ReadingQueueItem.queue_type.desc(), ReadingQueueItem.position.desc())
    )
    items = result.scalars().all()

    # Convert to schema
    queue_items = [ReadingQueueItemSchema.from_attributes(item) for item in items]

    # Count by type
    daily_count = sum(1 for item in queue_items if item.queue_type == "daily")
    permanent_count = sum(1 for item in queue_items if item.queue_type == "permanent")

    return queue_items, daily_count, permanent_count


async def update_queue_item(
    session: AsyncSession,
    queue_id: int,
    request: UpdateQueueItemRequest,
    user_id: int = 1,
) -> Optional[ReadingQueueItemSchema]:
    """Update a queue item's status or move between queues."""
    result = await session.execute(
        select(ReadingQueueItem).where(
            and_(
                ReadingQueueItem.id == queue_id,
                ReadingQueueItem.user_id == user_id,
            )
        )
    )
    queue_item = result.scalar_one_or_none()

    if not queue_item:
        logger.warning("Queue item not found: %d", queue_id)
        return None

    if request.read_status:
        queue_item.read_status = request.read_status
    if request.queue_type:
        queue_item.queue_type = request.queue_type
    if request.position is not None:
        queue_item.position = request.position
    if request.archived_at:
        queue_item.archived_at = request.archived_at

    queue_item.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(queue_item)

    logger.info("Updated queue item: %d", queue_id)
    return ReadingQueueItemSchema.from_attributes(queue_item)


async def move_expired_to_permanent(session: AsyncSession, user_id: int = 1) -> int:
    """Move daily queue items older than TTL to permanent queue."""
    cutoff_date = datetime.utcnow() - timedelta(days=DAILY_QUEUE_TTL_DAYS)

    result = await session.execute(
        select(ReadingQueueItem).where(
            and_(
                ReadingQueueItem.user_id == user_id,
                ReadingQueueItem.queue_type == "daily",
                ReadingQueueItem.added_at < cutoff_date,
            )
        )
    )
    expired_items = result.scalars().all()

    for item in expired_items:
        item.queue_type = "permanent"
        item.updated_at = datetime.utcnow()

    await session.commit()

    logger.info(
        "Moved %d items from daily to permanent queue", len(expired_items)
    )
    return len(expired_items)


async def archive_completed_items(session: AsyncSession, user_id: int = 1) -> int:
    """Archive completed items that are older than 30 days."""
    cutoff_date = datetime.utcnow() - timedelta(days=30)

    result = await session.execute(
        select(ReadingQueueItem).where(
            and_(
                ReadingQueueItem.user_id == user_id,
                ReadingQueueItem.read_status == "completed",
                ReadingQueueItem.updated_at < cutoff_date,
                ReadingQueueItem.archived_at.is_(None),
            )
        )
    )
    archived_items = result.scalars().all()

    for item in archived_items:
        item.archived_at = datetime.utcnow()

    await session.commit()

    logger.info("Archived %d completed items", len(archived_items))
    return len(archived_items)


async def remove_by_url(session: AsyncSession, article_url: str) -> bool:
    """Remove an item from queue by article URL."""
    result = await session.execute(
        select(ReadingQueueItem).where(
            ReadingQueueItem.article_url == article_url
        )
    )
    queue_item = result.scalar_one_or_none()

    if not queue_item:
        return False

    await session.delete(queue_item)
    await session.commit()

    logger.info("Removed item from queue by URL: %s", article_url)
    return True


async def get_queue_overview(
    session: AsyncSession, user_id: int = 1
) -> dict:
    """Get queue statistics and overview."""
    from app.api.routes.reading_queue import QueueOverviewResponse

    result = await session.execute(
        select(ReadingQueueItem).where(ReadingQueueItem.user_id == user_id)
    )
    items = result.scalars().all()

    total_items = len(items)
    daily_items = sum(1 for item in items if item.queue_type == "daily")
    permanent_items = sum(1 for item in items if item.queue_type == "permanent")
    unread_count = sum(1 for item in items if item.read_status == "unread")
    reading_count = sum(1 for item in items if item.read_status == "reading")
    completed_count = sum(1 for item in items if item.read_status == "completed")

    # Calculate total estimated read time from items that have it
    total_read_time = sum(
        (item.estimated_read_time_minutes or 0)
        for item in items
        if item.read_status == "unread"
    )

    return QueueOverviewResponse(
        total_items=total_items,
        daily_items=daily_items,
        permanent_items=permanent_items,
        unread_count=unread_count,
        reading_count=reading_count,
        completed_count=completed_count,
        estimated_total_read_time_minutes=total_read_time,
    )
