"""News."""

from typing import Any

from pydantic import Field

from app.models.base import StrictBaseModel


class NewsArticle(StrictBaseModel):
    """News Article."""

    id: int | None = None
    title: str
    link: str
    description: str
    published: str
    source: str
    author: str | None = None
    authors: list[str] = Field(default_factory=list)
    category: str = "general"
    country: str | None = None
    image: str | None = None
    mentioned_countries: list[str] = Field(default_factory=list)


class BookmarkCreateRequest(StrictBaseModel):
    """Bookmark Create Request."""

    article_id: int


class NewsResponse(StrictBaseModel):
    """News Response."""

    articles: list[NewsArticle]
    total: int
    sources: list[str]


class SourceInfo(StrictBaseModel):
    """Source Info."""

    id: str | None = None
    slug: str | None = None
    name: str
    url: str
    category: str
    country: str = "US"
    funding_type: str | None = None
    bias_rating: str | None = None
    ownership_label: str | None = None
    factual_rating: str | None = None
    credibility_score: float | None = None
    extra: dict[str, Any] | None = None
