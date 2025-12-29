from __future__ import annotations

from fastapi import APIRouter

from app.models.article_analysis import ArticleAnalysisRequest, ArticleAnalysisResponse
from app.services.article_analysis import analyze_with_gemini, extract_article_content

router = APIRouter(tags=["article-analysis"])


@router.get("/article/extract")
async def extract_article_text(url: str):
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
    article_data = await extract_article_content(request.url)
    if not article_data.get("success"):
        return ArticleAnalysisResponse(
            success=False,
            article_url=request.url,
            error=article_data.get("error", "Failed to extract article content"),
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
        summary=ai_analysis.get("summary"),
    )
