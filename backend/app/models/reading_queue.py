"""Reading Queue."""

from typing import Any
from datetime import datetime
from app.models.base import StrictBaseModel


class ReadingQueueItem(StrictBaseModel):
    """Reading Queue Item."""

    id: int | None = None
    user_id: int | None = None
    article_id: int
    article_title: str
    article_url: str
    article_source: str
    article_image: str | None = None
    queue_type: str = "daily"  # 'daily' or 'permanent'
    position: int = 0
    read_status: str = "unread"  # 'unread', 'reading', 'completed'
    added_at: datetime
    archived_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    word_count: int | None = None
    estimated_read_time_minutes: int | None = None
    full_text: str | None = None

    class Config:
        """Config."""

        from_attributes = True

    @classmethod
    def from_attributes(cls, obj: Any) -> "ReadingQueueItem":
        """Helper retained for compatibility with code expecting Pydantic v1."""
        return cls.model_validate(obj, from_attributes=True)


class AddToQueueRequest(StrictBaseModel):
    """Add To Queue Request."""

    article_id: int
    article_title: str
    article_url: str
    article_source: str
    article_image: str | None = None
    queue_type: str = "daily"


class UpdateQueueItemRequest(StrictBaseModel):
    """Update Queue Item Request."""

    read_status: str | None = None
    queue_type: str | None = None
    position: int | None = None
    archived_at: datetime | None = None


class QueueResponse(StrictBaseModel):
    """Queue Response."""

    items: list[ReadingQueueItem]
    daily_count: int
    permanent_count: int
    total_count: int


class QueueOverviewResponse(StrictBaseModel):
    """Queue Overview Response."""

    total_items: int
    daily_items: int
    permanent_items: int
    unread_count: int
    reading_count: int
    completed_count: int
    estimated_total_read_time_minutes: int


class Highlight(StrictBaseModel):
    """Highlight."""

    id: int | None = None
    user_id: int | None = None
    article_url: str
    highlighted_text: str
    color: str = "yellow"  # 'yellow', 'blue', 'red'
    note: str | None = None
    character_start: int
    character_end: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        """Config."""

        from_attributes = True

    @classmethod
    def from_attributes(cls, obj: Any) -> "Highlight":
        """From Attributes."""
        return cls.model_validate(obj, from_attributes=True)


class CreateHighlightRequest(StrictBaseModel):
    """Create Highlight Request."""

    article_url: str
    highlighted_text: str
    color: str = "yellow"
    note: str | None = None
    character_start: int
    character_end: int


class UpdateHighlightRequest(StrictBaseModel):
    """Update Highlight Request."""

    color: str | None = None
    note: str | None = None
