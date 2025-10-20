from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.reading_queue import (
    ReadingQueueItem,
    AddToQueueRequest,
    UpdateQueueItemRequest,
    QueueResponse,
)
from app.services import reading_queue as queue_service
from app.core.logging import get_logger

logger = get_logger("reading_queue_routes")

router = APIRouter(prefix="/api/queue", tags=["reading_queue"])


@router.post("/add", response_model=ReadingQueueItem)
async def add_to_queue(
    request: AddToQueueRequest, session: AsyncSession = Depends(get_db)
):
    """Add an article to the reading queue."""
    try:
        item = await queue_service.add_to_queue(session, request)
        return item
    except Exception as e:
        logger.error("Error adding to queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to add article to queue")


@router.delete("/{queue_id}", status_code=204)
async def remove_from_queue(queue_id: int, session: AsyncSession = Depends(get_db)):
    """Remove an item from the reading queue."""
    try:
        success = await queue_service.remove_from_queue(session, queue_id)
        if not success:
            raise HTTPException(status_code=404, detail="Queue item not found")
    except Exception as e:
        logger.error("Error removing from queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to remove from queue")


@router.delete("/url/{article_url}", status_code=204)
async def remove_from_queue_by_url(
    article_url: str, session: AsyncSession = Depends(get_db)
):
    """Remove an item from queue by article URL."""
    try:
        success = await queue_service.remove_by_url(session, article_url)
        if not success:
            raise HTTPException(status_code=404, detail="Article not found in queue")
    except Exception as e:
        logger.error("Error removing from queue by URL: %s", e)
        raise HTTPException(status_code=500, detail="Failed to remove from queue")


@router.get("", response_model=QueueResponse)
async def get_queue(session: AsyncSession = Depends(get_db)):
    """Get all items in the reading queue."""
    try:
        items, daily_count, permanent_count = await queue_service.get_queue(session)
        return QueueResponse(
            items=items,
            daily_count=daily_count,
            permanent_count=permanent_count,
            total_count=len(items),
        )
    except Exception as e:
        logger.error("Error fetching queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch queue")


@router.patch("/{queue_id}", response_model=ReadingQueueItem)
async def update_queue_item(
    queue_id: int,
    request: UpdateQueueItemRequest,
    session: AsyncSession = Depends(get_db),
):
    """Update a queue item (status, type, position)."""
    try:
        item = await queue_service.update_queue_item(session, queue_id, request)
        if not item:
            raise HTTPException(status_code=404, detail="Queue item not found")
        return item
    except Exception as e:
        logger.error("Error updating queue item: %s", e)
        raise HTTPException(status_code=500, detail="Failed to update queue item")


@router.post("/maintenance/move-expired", status_code=200)
async def move_expired_items(session: AsyncSession = Depends(get_db)):
    """Move expired daily items to permanent queue."""
    try:
        count = await queue_service.move_expired_to_permanent(session)
        return {"message": f"Moved {count} items to permanent queue"}
    except Exception as e:
        logger.error("Error moving expired items: %s", e)
        raise HTTPException(status_code=500, detail="Failed to move expired items")


@router.post("/maintenance/archive", status_code=200)
async def archive_completed_items(session: AsyncSession = Depends(get_db)):
    """Archive completed items older than 30 days."""
    try:
        count = await queue_service.archive_completed_items(session)
        return {"message": f"Archived {count} completed items"}
    except Exception as e:
        logger.error("Error archiving items: %s", e)
        raise HTTPException(status_code=500, detail="Failed to archive items")
