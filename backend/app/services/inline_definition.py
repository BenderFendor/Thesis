from __future__ import annotations

from typing import Any, Dict, Optional

from google.genai import types  # type: ignore[import-unresolved]

from app.core.config import create_gemini_client
from app.core.logging import get_logger

logger = get_logger("inline_definition")

gemini_client = create_gemini_client(logger)

GEMINI_MODEL_NAME = "gemini-2.0-flash"


async def define_term_with_gemini(term: str, context: Optional[str] = None) -> Dict[str, Any]:
    """Return a short, one-paragraph definition/explanation for a highlighted term.

    Uses the configured Gemini client. If Gemini is not configured, returns an
    explanatory error message.
    """
    if not gemini_client:
        return {"error": "Gemini API key not configured"}

    try:
        # Build a concise prompt asking for a one-paragraph definition in the given context
        ctx = context or "general"
        prompt = (
            f"The user is reading an article about {ctx}. "
            f"They highlighted the term: '{term}'.\n\n"
            "Please provide a short, one-paragraph definition or explanation for this term in context."
        )

        config = types.GenerateContentConfig(response_modalities=["TEXT"], max_output_tokens=200)

        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
            config=config,
        )

        text = getattr(response, "text", "").strip()
        return {"definition": text}
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Error generating inline definition: %s", exc, exc_info=True)
        return {"error": str(exc)}
