"""API endpoints for multi-source story comparison."""

from __future__ import annotations

from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.article_comparison import compare_articles

router = APIRouter(prefix="/compare", tags=["comparison"])


class ComparisonRequest(BaseModel):
    """Request to compare two articles."""

    content_1: str
    content_2: str
    title_1: str = ""
    title_2: str = ""


class ComparisonResponse(BaseModel):
    """Response with comparison analysis."""

    similarity: Dict[str, Any]
    entities: Dict[str, Any]
    keywords: Dict[str, Any]
    diff: Dict[str, Any]
    summary: Dict[str, Any]


@router.post("/articles", response_model=ComparisonResponse)
async def compare_two_articles(request: ComparisonRequest) -> ComparisonResponse:
    """Compare two articles and return detailed analysis.

    Performs:
    - Entity extraction and comparison
    - Keyword frequency analysis
    - Text similarity calculation
    - Visual diff generation

    Args:
        request: ComparisonRequest with content and titles of both articles

    Returns:
        ComparisonResponse with comprehensive analysis
    """
    try:
        result = compare_articles(
            content1=request.content_1,
            content2=request.content_2,
            title1=request.title_1,
            title2=request.title_2,
        )
        return ComparisonResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")
