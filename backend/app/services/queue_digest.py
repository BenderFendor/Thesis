"""Queue digest generation service for synthesizing articles into a reading digest."""

from __future__ import annotations

import json
from typing import Any

from app.core.config import create_openai_client, settings
from app.core.logging import get_logger

logger = get_logger("queue_digest")

openai_client = create_openai_client(logger)


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
    if not openai_client:
        logger.error("OpenRouter API client not configured")
        raise RuntimeError("OpenRouter API key not configured")

    try:
        response = openai_client.chat.completions.create(
            model=settings.open_router_model,
            messages=[
                {"role": "system", "content": "You are a helpful news assistant."},
                {"role": "user", "content": _build_digest_prompt(articles, grouped)}
            ]
        )

        if not response or not response.choices:
            logger.error("Invalid response from OpenRouter API")
            raise RuntimeError("Failed to generate digest: invalid API response")

        digest = response.choices[0].message.content.strip()

        # Append a structured JSON block the frontend can parse/embed. This
        # follows the same "```json:articles\n<JSON>\n```" fenced format used
        # elsewhere in the repo for embedding article payloads.
        try:
            structured_block = _build_structured_articles_block(articles)
        except Exception:  # pragma: no cover - defensive
            logger.exception('Failed to build structured articles block')
            structured_block = ''

        return f"{digest}\n\n{structured_block}" if structured_block else digest

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
                (
                    f"Title: {a.get('title', 'Untitled')}\n"
                    f"Source: {a.get('source', 'Unknown')}\n"
                    f"URL: {a.get('url') or a.get('link') or 'N/A'}\n"
                    f"Summary: {a.get('summary') or a.get('description') or ''}"
                )
                for a in cat_articles
            ]
        )

        category_sections.append(
            f"""## {category} ({len(cat_articles)} articles)

Articles:
{articles_text}"""
        )

    articles_by_category = "\n\n".join(category_sections)

    # Build a deduplicated reference list of article title -> url for explicit linking
    seen = set()
    reference_lines = []
    for a in articles:
        title = a.get('title') or 'Untitled'
        url = a.get('url') or a.get('link')
        if not url:
            continue
        key = (title, url)
        if key in seen:
            continue
        seen.add(key)
        reference_lines.append(f"- [{title}]({url})")

    reference_links = "\n".join(reference_lines)

    return f"""You are a personal research assistant creating a daily briefing for a busy professional.

Synthesize the following {len(articles)} articles across {len(grouped)} topics into a well-organized, 
skimmable "Daily Reading Digest" that identifies key themes and provides actionable insights.

ARTICLES BY CATEGORY:
{articles_by_category}

When you mention or summarize articles in the executive summary or in the category overviews,
include a Markdown link using the article title that points to the article URL (for example:
[Article Title](https://...)). If an article does not have a URL, include its source name in
parentheses after the title.

Create a professional digest that:
1. Starts with an executive summary (2-3 sentences highlighting the day's key themes)
2. Organizes insights by category/theme with clear subheadings
3. Uses bullet points for easy scanning
4. Highlights 3-5 key takeaways and implications
5. Includes recommended next actions or areas for deeper research
6. Notes any significant disagreements or diverging perspectives across sources

Format using clean Markdown for maximum readability. Focus on synthesizing connections
between articles rather than summarizing each individually.

REFERENCE LINKS:
{reference_links}
"""


def _build_structured_articles_block(
    articles: list[dict[str, Any]] | None
) -> str:
    """Build a fenced JSON block with normalized articles for frontend embedding.

    The frontend looks for a code fence that starts with "json:articles" and
    parses the JSON payload inside. Provide a minimal, stable schema so the
    reader UI can create inline cards.
    """

    normalized: list[dict[str, Any]] = []

    for a in articles or []:
        # Normalize common fields the frontend expects
        title = a.get('title') or a.get('headline') or 'Untitled'
        summary = a.get('summary') or a.get('description') or ''
        url = a.get('url') or a.get('link') or ''
        image = a.get('image') or a.get('image_url') or '/placeholder.svg'
        source = a.get('source') or a.get('publisher') or 'Unknown'
        published = a.get('published') or a.get('published_at')
        category = a.get('category') or 'general'
        author = a.get('author')

        meta = {
            'retrieval_method': a.get('retrieval_method'),
            'chroma_id': a.get('chroma_id'),
            'semantic_score': a.get('semantic_score'),
        }

        normalized.append(
            {
                'title': title,
                'summary': summary,
                'url': url,
                'image': image,
                'source': source,
                'published': published,
                'category': category,
                'author': author,
                'meta': meta,
            }
        )

    payload = {'articles': normalized, 'total': len(normalized), 'clusters': []}

    # Wrap in the exact fence the frontend regex expects
    try:
        json_text = json.dumps(payload, ensure_ascii=False, indent=2)
    except Exception:  # pragma: no cover - defensive
        logger.exception('Error serializing structured articles payload')
        json_text = '{}'

    return f"```json:articles\n{json_text}\n```"
