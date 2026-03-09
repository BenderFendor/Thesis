from typing import Any, Dict, List, Optional

from app.models.base import StrictBaseModel


class NewsArticle(StrictBaseModel):
    id: Optional[int] = None
    title: str
    link: str
    description: str
    published: str
    source: str
    author: Optional[str] = None
    category: str = "general"
    country: Optional[str] = None
    image: Optional[str] = None


class BookmarkCreateRequest(StrictBaseModel):
    article_id: int


class NewsResponse(StrictBaseModel):
    articles: List[NewsArticle]
    total: int
    sources: List[str]


class SourceInfo(StrictBaseModel):
    id: Optional[str] = None
    slug: Optional[str] = None
    name: str
    url: str
    category: str
    country: str = "US"
    funding_type: Optional[str] = None
    bias_rating: Optional[str] = None
    ownership_label: Optional[str] = None
    extra: Dict[str, Any] | None = None
