from typing import List, Optional

from pydantic import BaseModel, Field


class NewsResearchRequest(BaseModel):
    query: str
    include_thinking: bool = True


class ThinkingStep(BaseModel):
    type: str
    content: str
    timestamp: str


class NewsResearchResponse(BaseModel):
    success: bool
    query: str
    answer: str
    thinking_steps: List[ThinkingStep] = Field(default_factory=list)
    articles_searched: int = 0
    referenced_articles: List[dict] = Field(default_factory=list)
    error: Optional[str] = None
