from __future__ import annotations

import json
from typing import Any, Dict, Optional

from app.core.config import get_openai_client, settings
from app.core.logging import get_logger
from app.services.article_extraction import extract_article_full_text
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

logger = get_logger("article_analysis")

SYSTEM_MESSAGE = "You are an expert news analyst. Return valid JSON."


def _is_retryable_error(exception):
    msg = str(exception)
    return (
        "429" in msg
        or "rate limit" in msg.lower()
        or "too many requests" in msg.lower()
    )


@retry(
    retry=retry_if_exception(_is_retryable_error),
    wait=wait_exponential(multiplier=2, min=4, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _generate_content_safe(client, model, messages):
    return client.chat.completions.create(
        model=model, messages=messages, response_format={"type": "json_object"}
    )


async def extract_article_content(url: str) -> Dict[str, Any]:
    """Async facade over the shared extraction helper."""
    return await extract_article_full_text(url)


async def analyze_with_gemini(
    article_data: Dict[str, Any], source_name: Optional[str] = None
) -> Dict[str, Any]:
    openai_client = get_openai_client()
    if not openai_client:
        return {"error": "OpenRouter API key not configured"}

    try:
        prompt = _build_analysis_prompt(article_data, source_name)

        response = _generate_content_safe(
            client=openai_client,
            model=settings.open_router_model,
            messages=[
                {"role": "system", "content": SYSTEM_MESSAGE},
                {"role": "user", "content": prompt},
            ],
        )
        response_text = _extract_response_text(response)
        analysis = _parse_response_json(response_text)
        if analysis is None:
            logger.error("Failed to parse AI response as JSON: %s", response_text)
            return {
                "error": "Failed to parse analysis results",
                "raw_response": response_text,
            }
        return analysis

    except Exception as e:
        logger.error("AI analysis failed: %s", e)
        return {"error": str(e)}


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


def _extract_response_text(response: Any) -> str:
    message = response.choices[0].message.content or ""
    return message.strip()


def _parse_response_json(response_text: str) -> Optional[Dict[str, Any]]:
    if not response_text:
        return None
    cleaned = _strip_code_fence(response_text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


def _strip_code_fence(response_text: str) -> str:
    if not response_text.startswith("```"):
        return response_text
    parts = response_text.split("```")
    if len(parts) < 2:
        return response_text
    cleaned = parts[1]
    if cleaned.startswith("json"):
        cleaned = cleaned[4:]
    return cleaned.strip()
