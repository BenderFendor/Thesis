from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ArticleAnalysisRequest(BaseModel):
    url: str
    source_name: Optional[str] = None


class FactCheckResult(BaseModel):
    claim: str
    verification_status: str
    evidence: str
    sources: List[str]
    confidence: str
    notes: Optional[str] = None


class ArticleAnalysisResponse(BaseModel):
    success: bool
    article_url: str
    full_text: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[List[str]] = None
    publish_date: Optional[str] = None
    source_analysis: Optional[Dict[str, Any]] = None
    reporter_analysis: Optional[Dict[str, Any]] = None
    bias_analysis: Optional[Dict[str, Any]] = None
    fact_check_suggestions: Optional[List[str]] = None
    fact_check_results: Optional[List[Dict[str, Any]]] = None
    grounding_metadata: Optional[Dict[str, Any]] = None
    summary: Optional[str] = None
    error: Optional[str] = None
