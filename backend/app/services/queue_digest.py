"""Queue digest generation service for synthesizing articles into a reading digest."""

from __future__ import annotations

from typing import Any

from app.core.config import create_gemini_client
from app.core.logging import get_logger

logger = get_logger("queue_digest")

gemini_client = create_gemini_client(logger)


async def generate_queue_digest(
    articles: list[dict[str, Any]], grouped: dict[str, list[dict[str, Any]]]
) -> str:
    """
    Generate an AI-powered reading digest from queued articles.

    Args:
        articles: List of article summaries with metadata
        grouped: Articles grouped by category

    Returns:
        Formatted digest as markdown string
    """
    if not gemini_client:
        logger.error("Gemini API client not configured")
        raise RuntimeError("Gemini API key not configured")

    try:
        model = gemini_client.models.generate_content(
            model="gemini-2.0-flash",
            contents=_build_digest_prompt(articles, grouped),
        )

        if not model or not hasattr(model, "text"):
            logger.error("Invalid response from Gemini API")
            raise RuntimeError("Failed to generate digest: invalid API response")

        digest = model.text.strip()
        return digest

    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error generating digest: %s", exc)
        raise


def _build_digest_prompt(
    articles: list[dict[str, Any]], grouped: dict[str, list[dict[str, Any]]]
) -> str:
    """Build the prompt for digest generation."""
    # Generate category-specific summaries
    category_sections = []
    for category, cat_articles in grouped.items():
        if not cat_articles:
            continue

        articles_text = "\n\n".join(
            [
                f"Title: {a['title']}\nSource: {a['source']}\nSummary: {a['summary']}"
                for a in cat_articles
            ]
        )

        category_sections.append(
            f"""## {category} ({len(cat_articles)} articles)

Articles:
{articles_text}"""
        )

    articles_by_category = "\n\n".join(category_sections)

    return f"""You are a personal research assistant creating a daily briefing for a busy professional.

Synthesize the following {len(articles)} articles across {len(grouped)} topics into a well-organized, 
skimmable "Daily Reading Digest" that identifies key themes and provides actionable insights.

ARTICLES BY CATEGORY:
{articles_by_category}

Create a professional digest that:
1. Starts with an executive summary (2-3 sentences highlighting the day's key themes)
2. Organizes insights by category/theme with clear subheadings
3. Uses bullet points for easy scanning
4. Highlights 3-5 key takeaways and implications
5. Includes recommended next actions or areas for deeper research
6. Notes any significant disagreements or diverging perspectives across sources

Format using clean Markdown for maximum readability. Focus on synthesizing connections 
between articles rather than summarizing each individually."""
