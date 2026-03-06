from typing import Any, List, Optional

from pydantic import Field

from app.models.base import StrictBaseModel


class NewsResearchRequest(StrictBaseModel):
    query: str
    include_thinking: bool = True


class ThinkingStep(StrictBaseModel):
    type: str
    content: str
    timestamp: str


class NewsResearchResponse(StrictBaseModel):
    success: bool
    query: str
    answer: str
    thinking_steps: List[ThinkingStep] = Field(default_factory=list)
    articles_searched: int = 0
    referenced_articles: List[dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None
