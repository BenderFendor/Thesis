from __future__ import annotations

from typing import Any, Dict, Optional

from app.core.config import create_openai_client, settings
from app.core.logging import get_logger

logger = get_logger("inline_definition")

openai_client = create_openai_client(logger)


async def define_term_with_gemini(term: str, context: Optional[str] = None) -> Dict[str, Any]:
    """Return a short, one-paragraph definition/explanation for a highlighted term.

    Uses the configured OpenRouter client. If OpenRouter is not configured, returns an
    explanatory error message.
    """
    if not openai_client:
        return {"error": "OpenRouter API key not configured"}

    try:
        # Build a concise prompt asking for a one-paragraph definition in the given context
        ctx = context or "general"
        prompt = (
            f"The user is reading an article about {ctx}. "
            f"They highlighted the term: '{term}'.\n\n"
            "Please provide a short, one-paragraph definition or explanation for this term in context."
        )

        response = openai_client.chat.completions.create(
            model=settings.open_router_model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant providing definitions."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=200
        )

        text = response.choices[0].message.content.strip()
        return {"definition": text}
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error generating inline definition: %s", exc, exc_info=True)
        return {"error": str(exc)}
