"""Article Analysis."""

from typing import Literal
from typing import Any

from app.models.base import StrictBaseModel


class ArticleAnalysisRequest(StrictBaseModel):
    """Article Analysis Request."""

    url: str
    source_name: str | None = None


class LanguageDiagnosticsRequest(StrictBaseModel):
    """Language Diagnostics Request."""

    url: str
    text: str | None = None
    title: str | None = None
    source_name: str | None = None


class FactCheckResult(StrictBaseModel):
    """Fact Check Result."""

    claim: str
    verification_status: str
    evidence: str
    sources: list[str]
    confidence: str
    notes: str | None = None


class LanguageDiagnosticExample(StrictBaseModel):
    """Language Diagnostic Example."""

    sentence: str
    term: str | None = None
    pattern: str | None = None
    category: str | None = None


class LanguageDiagnosticMetric(StrictBaseModel):
    """Language Diagnostic Metric."""

    count: int
    rate: float
    status: Literal["low", "medium", "high"]
    examples: list[LanguageDiagnosticExample]


class LanguageDiagnosticOverall(StrictBaseModel):
    """Language Diagnostic Overall."""

    score: float
    status: Literal["low", "medium", "high"]
    summary: str


class LanguageDiagnosticsResponse(StrictBaseModel):
    """Language Diagnostics Response."""

    success: bool
    article_url: str
    title: str | None = None
    sentence_count: int = 0
    word_count: int = 0
    passive_voice: LanguageDiagnosticMetric | None = None
    actor_omission: LanguageDiagnosticMetric | None = None
    euphemisms: LanguageDiagnosticMetric | None = None
    sanitized_language: LanguageDiagnosticMetric | None = None
    overall: LanguageDiagnosticOverall | None = None
    error: str | None = None


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
    language_diagnostics: LanguageDiagnosticsResponse | None = None
    summary: str | None = None
    error: str | None = None
