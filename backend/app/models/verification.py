"""Pydantic models for verification agent request/response types."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    VERY_LOW = "very_low"


class SourceType(str, Enum):
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


class SourceInfo(BaseModel):
    id: str
    url: str
    title: Optional[str] = None
    domain: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    source_type: SourceType = SourceType.UNKNOWN
    published_at: Optional[str] = None
    supports_claim: bool = True
    excerpt: Optional[str] = None


class VerifiedClaim(BaseModel):
    id: str
    claim_text: str
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_level: ConfidenceLevel
    supporting_sources: List[str] = Field(default_factory=list)
    conflicting_sources: List[str] = Field(default_factory=list)
    footnotes: List[int] = Field(default_factory=list)
    needs_recheck: bool = False
    recheck_reason: Optional[str] = None


class VerificationResult(BaseModel):
    query: str
    overall_confidence: float = Field(ge=0.0, le=1.0)
    overall_confidence_level: ConfidenceLevel
    verified_claims: List[VerifiedClaim] = Field(default_factory=list)
    sources: Dict[str, SourceInfo] = Field(default_factory=dict)
    markdown_report: str = ""
    generated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    duration_ms: int = 0
    error: Optional[str] = None


class VerificationRequest(BaseModel):
    query: str
    main_findings: List[Dict[str, Any]] = Field(default_factory=list)
    main_answer: Optional[str] = None
    previous_claims: List[VerifiedClaim] = Field(default_factory=list)


class VerificationStreamEvent(BaseModel):
    type: str
    content: Optional[str] = None
    claim: Optional[VerifiedClaim] = None
    source: Optional[SourceInfo] = None
    result: Optional[VerificationResult] = None
    progress: Optional[float] = None


class CredibilityConfig(BaseModel):
    domain: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    source_type: SourceType = SourceType.UNKNOWN
    is_active: bool = True
