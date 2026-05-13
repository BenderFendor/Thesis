"""Article Analysis."""

from typing import Any

from app.models.base import StrictBaseModel


class ArticleAnalysisRequest(StrictBaseModel):
    """Article Analysis Request."""

    url: str
    source_name: str | None = None


class FactCheckResult(StrictBaseModel):
    """Fact Check Result."""

    claim: str
    verification_status: str
    evidence: str
    sources: list[str]
    confidence: str
    notes: str | None = None


class ArticleAnalysisResponse(StrictBaseModel):
    """Article Analysis Response."""

    success: bool
    article_url: str
    full_text: str | None = None
    title: str | None = None
    authors: list[str] | None = None
    publish_date: str | None = None
    source_analysis: dict[str, Any] | None = None
    reporter_analysis: dict[str, Any] | None = None
    bias_analysis: dict[str, Any] | None = None
    fact_check_suggestions: list[str] | None = None
    fact_check_results: list[dict[str, Any]] | None = None
    grounding_metadata: dict[str, Any] | None = None
    summary: str | None = None
    error: str | None = None
