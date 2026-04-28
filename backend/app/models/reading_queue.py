from typing import Any, Optional
from datetime import datetime
from app.models.base import StrictBaseModel


class ReadingQueueItem(StrictBaseModel):
    id: Optional[int] = None
    user_id: Optional[int] = None
    article_id: int
    article_title: str
    article_url: str
    article_source: str
    article_image: Optional[str] = None
    queue_type: str = "daily"  # 'daily' or 'permanent'
    position: int = 0
    read_status: str = "unread"  # 'unread', 'reading', 'completed'
    added_at: datetime
    archived_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    word_count: Optional[int] = None
    estimated_read_time_minutes: Optional[int] = None
    full_text: Optional[str] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_attributes(cls, obj: Any) -> "ReadingQueueItem":
        """Helper retained for compatibility with code expecting Pydantic v1."""
        return cls.model_validate(obj, from_attributes=True)


class AddToQueueRequest(StrictBaseModel):
    article_id: int
    article_title: str
    article_url: str
    article_source: str
    article_image: Optional[str] = None
    queue_type: str = "daily"


class UpdateQueueItemRequest(StrictBaseModel):
    read_status: Optional[str] = None
    queue_type: Optional[str] = None
    position: Optional[int] = None
    archived_at: Optional[datetime] = None


class QueueResponse(StrictBaseModel):
    items: list[ReadingQueueItem]
    daily_count: int
    permanent_count: int
    total_count: int


class QueueOverviewResponse(StrictBaseModel):
    total_items: int
    daily_items: int
    permanent_items: int
    unread_count: int
    reading_count: int
    completed_count: int
    estimated_total_read_time_minutes: int


class Highlight(StrictBaseModel):
    id: Optional[int] = None
    user_id: Optional[int] = None
    article_url: str
    highlighted_text: str
    color: str = "yellow"  # 'yellow', 'blue', 'red'
    note: Optional[str] = None
    character_start: int
    character_end: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_attributes(cls, obj: Any) -> "Highlight":
        return cls.model_validate(obj, from_attributes=True)


class CreateHighlightRequest(StrictBaseModel):
    article_url: str
    highlighted_text: str
    color: str = "yellow"
    note: Optional[str] = None
    character_start: int
    character_end: int


class UpdateHighlightRequest(StrictBaseModel):
    color: Optional[str] = None
    note: Optional[str] = None
