"""Pydantic models for verification agent request/response types."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from app.models.base import StrictBaseModel


class ConfidenceLevel(StrEnum):
    """Ordinal confidence tier assigned to a verified claim."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    VERY_LOW = "very_low"


class SourceType(StrEnum):
    """Classification of a source's organizational nature."""

    WIRE = "wire"
    NEWSPAPER = "newspaper"
    MAGAZINE = "magazine"
    BROADCAST = "broadcast"
    NONPROFIT = "nonprofit"
    FACT_CHECKER = "fact_checker"
    GOVERNMENT = "government"
    ACADEMIC = "academic"
    BLOG = "blog"
    SOCIAL = "social"
    UNKNOWN = "unknown"


class SourceInfo(StrictBaseModel):
    """Metadata for a single supporting or conflicting source."""

    id: str
    url: str
    title: str | None = None
    domain: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    source_type: SourceType = SourceType.UNKNOWN
    published_at: str | None = None
    supports_claim: bool = True
    excerpt: str | None = None


class VerifiedClaim(StrictBaseModel):
    """A single claim that has been cross-referenced against sources."""

    id: str
    claim_text: str
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_level: ConfidenceLevel
    supporting_sources: list[str] = Field(default_factory=list)
    conflicting_sources: list[str] = Field(default_factory=list)
    footnotes: list[int] = Field(default_factory=list)
    needs_recheck: bool = False
    recheck_reason: str | None = None


class VerificationResult(StrictBaseModel):
    """Aggregated result containing all verified claims and their sources."""

    query: str
    overall_confidence: float = Field(ge=0.0, le=1.0)
    overall_confidence_level: ConfidenceLevel
    verified_claims: list[VerifiedClaim] = Field(default_factory=list)
    sources: dict[str, SourceInfo] = Field(default_factory=dict)
    markdown_report: str = ""
    generated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    duration_ms: int = 0
    error: str | None = None


class VerificationRequest(StrictBaseModel):
    """Input to the verification agent with the research findings to check."""

    query: str
    main_findings: list[dict[str, Any]] = Field(default_factory=list)
    main_answer: str | None = None
    previous_claims: list[VerifiedClaim] = Field(default_factory=list)


class VerificationStreamEvent(StrictBaseModel):
    """Server-sent event payload emitted during streaming verification."""

    type: str
    content: str | None = None
    claim: VerifiedClaim | None = None
    source: SourceInfo | None = None
    result: VerificationResult | None = None
    progress: float | None = None


class CredibilityConfig(StrictBaseModel):
    """Per-domain credibility configuration for external weighting."""

    domain: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    source_type: SourceType = SourceType.UNKNOWN
    is_active: bool = True
