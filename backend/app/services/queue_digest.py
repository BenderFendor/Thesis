"""Queue digest generation service for synthesizing articles into a reading digest."""

from __future__ import annotations

import json
from typing import Any

from app.core.config import resolve_opencode_model, settings
from app.core.llm_client import get_llm_client
from app.core.logging import get_logger
from app.services.prompting import (
    build_text_system_prompt,
    compose_prompt_blocks,
)

logger = get_logger("queue_digest")

DIGEST_SYSTEM_PROMPT = build_text_system_prompt(
    role="news digest writer",
    task="Write a clean reading digest from the supplied article set.",
    output_rules=compose_prompt_blocks(
        "Write in markdown.",
        "Keep the digest skimmable without listicle filler.",
    ),
)


async def generate_queue_digest(
    articles: list[dict[str, Any]], grouped: dict[str, list[dict[str, Any]]]
) -> str:
    """Generate an AI-powered reading digest from queued articles.

    Args:
        articles: List of article summaries with metadata
        grouped: Articles grouped by category

    Returns:
        Formatted digest as markdown string
    """
    llm_client = get_llm_client()
    if not llm_client:
        logger.error("OpenRouter API client not configured")
        raise RuntimeError("OpenRouter API key not configured")

    try:
        response = llm_client.chat_completions_create(
            service_name="queue_digest",
            messages=[
                {"role": "system", "content": DIGEST_SYSTEM_PROMPT},
                {"role": "user", "content": _build_digest_prompt(articles, grouped)},
            ],
            model=resolve_opencode_model(settings.open_router_model),
        )

        if not response or not response.choices:
            logger.error("Invalid response from OpenRouter API")
            raise RuntimeError("Failed to generate digest: invalid API response")

        digest = (response.choices[0].message.content or "").strip()

        # Append a structured JSON block the frontend can parse/embed. This
        # follows the same "```json:articles\n<JSON>\n```" fenced format used
        # elsewhere in the repo for embedding article payloads.
        try:
            structured_block = _build_structured_articles_block(articles)
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to build structured articles block")
            structured_block = ""

        return f"{digest}\n\n{structured_block}" if structured_block else digest

    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error generating digest: %s", exc)
        raise


def _build_digest_prompt(
    articles: list[dict[str, Any]], grouped: dict[str, list[dict[str, Any]]]
) -> str:
    """Build the prompt for digest generation."""
    articles_by_category = _category_sections(grouped)
    reference_links = _reference_links(articles)

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
1. Starts with an executive summary (2-3 sentences noting the day's key themes)
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


def _category_sections(grouped: dict[str, list[dict[str, Any]]]) -> str:
    sections = []
    for category, category_articles in grouped.items():
        if not category_articles:
            continue
        articles_text = "\n\n".join(
            f"Title: {article.get('title', 'Untitled')}\n"
            f"Source: {article.get('source', 'Unknown')}\n"
            f"URL: {article.get('url') or article.get('link') or 'N/A'}\n"
            f"Summary: {article.get('summary') or article.get('description') or ''}"
            for article in category_articles
        )
        sections.append(
            f"## {category} ({len(category_articles)} articles)\n\nArticles:\n{articles_text}"
        )
    return "\n\n".join(sections)


def _reference_links(articles: list[dict[str, Any]]) -> str:
    seen: set[tuple[Any, Any]] = set()
    reference_lines = []
    for article in articles:
        title = article.get("title") or "Untitled"
        url = article.get("url") or article.get("link")
        if not url or (title, url) in seen:
            continue
        seen.add((title, url))
        reference_lines.append(f"- [{title}]({url})")
    return "\n".join(reference_lines)


def _build_structured_articles_block(articles: list[dict[str, Any]] | None) -> str:
    """Build a fenced JSON block with normalized articles for frontend embedding.

    The frontend looks for a code fence that starts with "json:articles" and
    parses the JSON payload inside. Provide a minimal, stable schema so the
    reader UI can create inline cards.
    """
    normalized = [_normalize_digest_article(article) for article in articles or []]

    payload = {"articles": normalized, "total": len(normalized), "clusters": []}

    # Wrap in the exact fence the frontend regex expects
    try:
        json_text = json.dumps(payload, ensure_ascii=False, indent=2)
    except Exception:  # pragma: no cover - defensive
        logger.exception("Error serializing structured articles payload")
        json_text = "{}"

    return f"```json:articles\n{json_text}\n```"


def _normalize_digest_article(article: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": _first_value(article, ("title", "headline"), "Untitled"),
        "summary": _first_value(article, ("summary", "description"), ""),
        "url": _first_value(article, ("url", "link"), ""),
        "image": _first_value(article, ("image", "image_url"), "/placeholder.svg"),
        "source": _first_value(article, ("source", "publisher"), "Unknown"),
        "published": _first_value(article, ("published", "published_at")),
        "category": _first_value(article, ("category",), "general"),
        "author": article.get("author"),
        "meta": {
            "retrieval_method": article.get("retrieval_method"),
            "chroma_id": article.get("chroma_id"),
            "semantic_score": article.get("semantic_score"),
        },
    }


def _first_value(article: dict[str, Any], keys: tuple[str, ...], default: Any = None) -> Any:
    for key in keys:
        value = article.get(key)
        if value:
            return value
    return default
