"""Research."""

from typing import Any

from pydantic import Field

from app.models.base import StrictBaseModel


class NewsResearchRequest(StrictBaseModel):
    """News Research Request."""

    query: str
    include_thinking: bool = True
    model: str | None = None


class ResearchModelOption(StrictBaseModel):
    """A configured model available to the research agent."""

    id: str
    label: str
    model: str
    provider: str


class ResearchModelCatalog(StrictBaseModel):
    """Models configured for the research agent runtime."""

    default: str | None = None
    models: list[ResearchModelOption] = Field(default_factory=list)
    provider: str


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
