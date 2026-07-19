"""Article Analysis."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.article_analysis import (
    ArticleAnalysisRequest,
    ArticleAnalysisResponse,
    LanguageDiagnosticsRequest,
    LanguageDiagnosticsResponse,
)
from app.services.article_analysis import analyze_with_gemini, extract_article_content
from app.services.language_diagnostics import analyze_language_diagnostics

router = APIRouter(tags=["article-analysis"])


@router.get("/article/extract")
async def extract_article_text(url: str) -> dict[str, object]:
    """Extract Article Text."""
    data = await extract_article_content(url)
    if not data.get("success"):
        return {
            "success": False,
            "url": url,
            "error": data.get("error", "Failed to extract article"),
        }

    return {
        "success": True,
        "url": url,
        "text": data.get("text"),
        "title": data.get("title"),
        "authors": data.get("authors"),
        "publish_date": data.get("publish_date"),
    }


@router.post("/api/article/analyze", response_model=ArticleAnalysisResponse)
async def analyze_article(request: ArticleAnalysisRequest) -> ArticleAnalysisResponse:
    """Analyze Article."""
    article_data = await extract_article_content(request.url)
    if not article_data.get("success"):
        return ArticleAnalysisResponse(
            success=False,
            article_url=request.url,
            error=article_data.get("error", "Failed to extract article content"),
        )

    language_diagnostics = _build_language_diagnostics_response(
        article_url=request.url,
        title=_as_optional_str(article_data.get("title")),
        text=_as_optional_str(article_data.get("text")) or "",
    )

    ai_analysis = await analyze_with_gemini(article_data, request.source_name)
    if "error" in ai_analysis and "raw_response" not in ai_analysis:
        return ArticleAnalysisResponse(
            success=False,
            article_url=request.url,
            full_text=article_data.get("text"),
            title=article_data.get("title"),
            authors=article_data.get("authors"),
            publish_date=article_data.get("publish_date"),
            error=ai_analysis.get("error"),
            language_diagnostics=language_diagnostics,
        )

    return ArticleAnalysisResponse(
        success=True,
        article_url=request.url,
        full_text=article_data.get("text"),
        title=article_data.get("title"),
        authors=article_data.get("authors"),
        publish_date=article_data.get("publish_date"),
        source_analysis=ai_analysis.get("source_analysis"),
        reporter_analysis=ai_analysis.get("reporter_analysis"),
        bias_analysis=ai_analysis.get("bias_analysis"),
        fact_check_suggestions=ai_analysis.get("fact_check_suggestions"),
        fact_check_results=ai_analysis.get("fact_check_results"),
        grounding_metadata=ai_analysis.get("grounding_metadata"),
        language_diagnostics=language_diagnostics,
        summary=ai_analysis.get("summary"),
    )


@router.post("/api/article/language-diagnostics", response_model=LanguageDiagnosticsResponse)
async def analyze_article_language(
    request: LanguageDiagnosticsRequest,
) -> LanguageDiagnosticsResponse:
    """Analyze article language without requiring LLM services."""
    text = request.text
    title = request.title

    if not text:
        article_data = await extract_article_content(request.url)
        if not article_data.get("success"):
            return LanguageDiagnosticsResponse(
                success=False,
                article_url=request.url,
                title=title,
                error=article_data.get("error", "Failed to extract article content"),
            )
        text = _as_optional_str(article_data.get("text")) or ""
        title = title or _as_optional_str(article_data.get("title"))

    return _build_language_diagnostics_response(
        article_url=request.url,
        title=title,
        text=text,
    )


def _build_language_diagnostics_response(
    *,
    article_url: str,
    title: str | None,
    text: str,
) -> LanguageDiagnosticsResponse:
    payload = analyze_language_diagnostics(text, title=title)
    return LanguageDiagnosticsResponse.model_validate(
        {
            "success": True,
            "article_url": article_url,
            "title": title,
            **payload,
        }
    )


def _as_optional_str(value: object) -> str | None:
    if isinstance(value, str):
        return value
    return None
