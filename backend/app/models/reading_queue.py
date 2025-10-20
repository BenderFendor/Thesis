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
