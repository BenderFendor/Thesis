from typing import Optional
from datetime import datetime
from pydantic import BaseModel


class ReadingQueueItem(BaseModel):
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


class AddToQueueRequest(BaseModel):
    article_id: int
    article_title: str
    article_url: str
    article_source: str
    article_image: Optional[str] = None
    queue_type: str = "daily"


class UpdateQueueItemRequest(BaseModel):
    read_status: Optional[str] = None
    queue_type: Optional[str] = None
    position: Optional[int] = None
    archived_at: Optional[datetime] = None


class QueueResponse(BaseModel):
    items: list[ReadingQueueItem]
    daily_count: int
    permanent_count: int
    total_count: int


class Highlight(BaseModel):
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


class CreateHighlightRequest(BaseModel):
    article_url: str
    highlighted_text: str
    color: str = "yellow"
    note: Optional[str] = None
    character_start: int
    character_end: int


class UpdateHighlightRequest(BaseModel):
    color: Optional[str] = None
    note: Optional[str] = None
