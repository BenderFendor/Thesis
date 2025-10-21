from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.models.reading_queue import (
    ReadingQueueItem,
    AddToQueueRequest,
    UpdateQueueItemRequest,
    QueueResponse,
    Highlight,
    CreateHighlightRequest,
    UpdateHighlightRequest,
)
from app.services import reading_queue as queue_service
from app.services import highlights as highlights_service
from app.services.queue_digest import generate_queue_digest
from app.core.logging import get_logger

logger = get_logger("reading_queue_routes")

router = APIRouter(prefix="/api/queue", tags=["reading_queue"])


class QueueOverviewResponse(BaseModel):
    """Queue overview statistics."""

    total_items: int
    daily_items: int
    permanent_items: int
    unread_count: int
    reading_count: int
    completed_count: int
    estimated_total_read_time_minutes: int


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


@router.get("/overview", response_model=QueueOverviewResponse)
async def get_queue_overview(session: AsyncSession = Depends(get_db)):
    """Get queue statistics and overview."""
    try:
        overview = await queue_service.get_queue_overview(session)
        return overview
    except Exception as e:
        logger.error("Error fetching queue overview: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch queue overview")


# Highlights endpoints
@router.post("/highlights", response_model=Highlight)
async def create_highlight(
    request: CreateHighlightRequest, session: AsyncSession = Depends(get_db)
):
    """Create a new highlight."""
    try:
        highlight = await highlights_service.create_highlight(session, request)
        return highlight
    except Exception as e:
        logger.error("Error creating highlight: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create highlight")


@router.get("/highlights/article/{article_url}", response_model=list[Highlight])
async def get_article_highlights(
    article_url: str, session: AsyncSession = Depends(get_db)
):
    """Get all highlights for a specific article."""
    try:
        highlights = await highlights_service.get_highlights_for_article(
            session, article_url
        )
        return highlights
    except Exception as e:
        logger.error("Error fetching highlights: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch highlights")


@router.get("/highlights", response_model=list[Highlight])
async def get_all_highlights(session: AsyncSession = Depends(get_db)):
    """Get all highlights for the user."""
    try:
        highlights = await highlights_service.get_all_highlights(session)
        return highlights
    except Exception as e:
        logger.error("Error fetching all highlights: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch highlights")


@router.patch("/highlights/{highlight_id}", response_model=Highlight)
async def update_highlight(
    highlight_id: int,
    request: UpdateHighlightRequest,
    session: AsyncSession = Depends(get_db),
):
    """Update a highlight."""
    try:
        highlight = await highlights_service.update_highlight(
            session, highlight_id, request
        )
        if not highlight:
            raise HTTPException(status_code=404, detail="Highlight not found")
        return highlight
    except Exception as e:
        logger.error("Error updating highlight: %s", e)
        raise HTTPException(status_code=500, detail="Failed to update highlight")


@router.delete("/highlights/{highlight_id}", status_code=204)
async def delete_highlight(highlight_id: int, session: AsyncSession = Depends(get_db)):
    """Delete a highlight."""
    try:
        success = await highlights_service.delete_highlight(session, highlight_id)
        if not success:
            raise HTTPException(status_code=404, detail="Highlight not found")
    except Exception as e:
        logger.error("Error deleting highlight: %s", e)
        raise HTTPException(status_code=500, detail="Failed to delete highlight")


@router.post("/maintenance/archive", status_code=200)
async def archive_completed_items(session: AsyncSession = Depends(get_db)):
    """Archive completed items older than 30 days."""
    try:
        count = await queue_service.archive_completed_items(session)
        return {"message": f"Archived {count} completed items"}
    except Exception as e:
        logger.error("Error archiving items: %s", e)
        raise HTTPException(status_code=500, detail="Failed to archive items")


@router.get("/{queue_id}/content", response_model=dict)
async def get_queue_item_content(
    queue_id: int, session: AsyncSession = Depends(get_db)
):
    """Get full article content for a queue item."""
    try:
        item = await queue_service.get_queue_item_by_id(session, queue_id)
        if not item:
            raise HTTPException(status_code=404, detail="Queue item not found")

        # Return the full_text if available
        return {
            "id": item.id,
            "article_url": item.article_url,
            "article_title": item.article_title,
            "article_source": item.article_source,
            "full_text": item.full_text or "",
            "word_count": item.word_count,
            "estimated_read_time_minutes": item.estimated_read_time_minutes,
            "read_status": item.read_status,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error fetching queue item content: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch content")


@router.get("/digest/daily", response_model=dict)
async def get_daily_digest(session: AsyncSession = Depends(get_db)):
    """Get a daily digest of top queue items."""
    try:
        digest = await queue_service.generate_daily_digest(session)
        return digest
    except Exception as e:
        logger.error("Error generating daily digest: %s", e)
        raise HTTPException(status_code=500, detail="Failed to generate digest")


class QueueDigestRequest(BaseModel):
    """Request for generating AI digest."""

    articles: list[dict]
    grouped: dict[str, list[dict]]


class QueueDigestResponse(BaseModel):
    """Response containing generated digest."""

    digest: str


@router.post("/digest", response_model=QueueDigestResponse)
async def generate_ai_digest(request: QueueDigestRequest):
    """Generate an AI-powered reading digest from queued articles."""
    try:
        digest = await generate_queue_digest(request.articles, request.grouped)
        return {"digest": digest}
    except Exception as e:
        logger.error("Error generating AI digest: %s", e)
        raise HTTPException(
            status_code=500, detail="Failed to generate digest"
        )
