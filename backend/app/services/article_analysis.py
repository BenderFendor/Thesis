from __future__ import annotations

import json
from typing import Any, Dict, Optional

from google.genai import types  # type: ignore[import-unresolved]
from newspaper import Article  # type: ignore[import-unresolved]

from app.core.config import create_gemini_client
from app.core.logging import get_logger

logger = get_logger("article_analysis")

gemini_client = create_gemini_client(logger)


async def extract_article_content(url: str) -> Dict[str, Any]:
    try:
        article = Article(url)
        article.download()
        article.parse()

        return {
            "success": True,
            "title": article.title,
            "authors": article.authors,
            "publish_date": str(article.publish_date) if article.publish_date else None,
            "text": article.text,
            "top_image": article.top_image,
            "images": list(article.images),
            "keywords": getattr(article, "keywords", []),
            "meta_description": getattr(article, "meta_description", None),
        }
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error extracting article from %s: %s", url, exc)
        return {"success": False, "error": str(exc)}


async def analyze_with_gemini(
    article_data: Dict[str, Any], source_name: Optional[str] = None
) -> Dict[str, Any]:
    if not gemini_client:
        return {"error": "Gemini API key not configured"}

    try:
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        config = types.GenerateContentConfig(
            tools=[grounding_tool], response_modalities=["TEXT"]
        )

        prompt = _build_analysis_prompt(article_data, source_name)

        response = gemini_client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=prompt,
            config=config,
        )

        grounding_metadata = _extract_grounding_metadata(response)

        try:
            response_text = response.text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]

            analysis = json.loads(response_text)
            if grounding_metadata:
                analysis["grounding_metadata"] = grounding_metadata
            return analysis
        except json.JSONDecodeError:
            return {
                "raw_response": response.text,
                "grounding_metadata": grounding_metadata,
                "error": "Failed to parse AI response as JSON",
            }
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error analyzing with Gemini: %s", exc)
        return {"error": str(exc)}


def _build_analysis_prompt(
    article_data: Dict[str, Any], source_name: Optional[str]
) -> str:
    title = article_data.get("title", "Unknown")
    authors = (
        ", ".join(article_data.get("authors", []))
        if article_data.get("authors")
        else "Unknown"
    )
    publish_date = article_data.get("publish_date", "Unknown")
    text = (article_data.get("text") or "")[:4000]

    return f"""
You are an expert media analyst and fact-checker. Analyze the following news article comprehensively and use Google Search to verify ALL factual claims, numbers, quotes, and statements:

**Article Title:** {title}
**Source:** {source_name or "Unknown"}
**Authors:** {authors}
**Published:** {publish_date}

**Article Text:**
{text}  

IMPORTANT: Use Google Search to verify EVERY factual claim in the article. For each claim, search for corroborating or contradicting sources.

Please provide a detailed analysis in the following JSON format:

{{
  "summary": "A concise 2-3 sentence summary of the article",
  "source_analysis": {{
    "credibility_assessment": "Assessment of source credibility (high/medium/low)",
    "ownership": "Information about who owns this publication",
    "funding_model": "How is this source funded",
    "political_leaning": "Political bias assessment (left/center/right)",
    "reputation": "General reputation and track record"
  }},
  "reporter_analysis": {{
    "background": "Background information on the reporter(s) if available",
    "expertise": "Reporter's area of expertise",
    "known_biases": "Any known biases or perspectives",
    "track_record": "Notable past work or controversies"
  }},
  "bias_analysis": {{
    "tone_bias": "Analysis of emotional tone and word choice",
    "framing_bias": "How the story is framed or presented",
    "selection_bias": "What information is included or excluded",
    "source_diversity": "Diversity of sources quoted in the article",
    "overall_bias_score": "Overall bias rating (1-10, where 5 is neutral)"
  }},
  "fact_check_suggestions": [
    "Key claim 1 that should be fact-checked",
    "Key claim 2 that should be fact-checked",
    "Key claim 3 that should be fact-checked"
  ],
  "fact_check_results": [
    {{
      "claim": "Specific claim from the article (quote it exactly)",
      "verification_status": "verified/partially-verified/unverified/false",
      "evidence": "What evidence was found via Google Search",
      "sources": ["URL 1", "URL 2"],
      "confidence": "high/medium/low",
      "notes": "Additional context or caveats"
    }}
  ],
  "context": "Important background context for understanding this story",
  "missing_perspectives": "What perspectives or information might be missing"
}}

CRITICAL: For fact_check_results, verify ALL specific details including:
- Names of people, companies, organizations
- Numbers, statistics, financial figures
- Dates and timelines
- Quotes and statements
- Events and their descriptions
- Any claims that can be objectively verified

Provide only the JSON response, no additional text.
"""


def _extract_grounding_metadata(response: Any) -> Dict[str, Any]:
    grounding_metadata: Dict[str, Any] = {
        "grounding_chunks": [],
        "grounding_supports": [],
        "web_search_queries": [],
    }

    if not getattr(response, "candidates", None):
        return grounding_metadata

    candidate = response.candidates[0]
    metadata = getattr(candidate, "grounding_metadata", None)
    if not metadata:
        return grounding_metadata

    if getattr(metadata, "grounding_chunks", None):
        for chunk in metadata.grounding_chunks:
            if getattr(chunk, "web", None):
                grounding_metadata["grounding_chunks"].append(
                    {
                        "uri": getattr(chunk.web, "uri", None),
                        "title": getattr(chunk.web, "title", None),
                    }
                )

    if getattr(metadata, "web_search_queries", None):
        grounding_metadata["web_search_queries"] = list(metadata.web_search_queries)

    return grounding_metadata
