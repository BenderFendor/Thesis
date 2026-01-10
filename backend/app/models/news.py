from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class NewsArticle(BaseModel):
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


class BookmarkCreateRequest(BaseModel):
    article_id: int


class NewsResponse(BaseModel):
    articles: List[NewsArticle]
    total: int
    sources: List[str]


class SourceInfo(BaseModel):
    name: str
    url: str
    category: str
    country: str = "US"
    funding_type: Optional[str] = None
    bias_rating: Optional[str] = None
    extra: Dict[str, Any] | None = None
