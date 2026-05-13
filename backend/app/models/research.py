"""Research."""

from typing import Any

from pydantic import Field

from app.models.base import StrictBaseModel


class NewsResearchRequest(StrictBaseModel):
    """News Research Request."""

    query: str
    include_thinking: bool = True


class ThinkingStep(StrictBaseModel):
    """Thinking Step."""

    type: str
    content: str
    timestamp: str


class NewsResearchResponse(StrictBaseModel):
    """News Research Response."""

    success: bool
    query: str
    answer: str
    thinking_steps: list[ThinkingStep] = Field(default_factory=list)
    articles_searched: int = 0
    referenced_articles: list[dict[str, Any]] = Field(default_factory=list)
    source_providers: list[str] = Field(default_factory=list)
    error: str | None = None
