"""Source Profile Synthesizer."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any
from collections.abc import Sequence

from app.core.config import settings
from app.core.llm_client import get_llm_client
from app.core.logging import get_logger
from app.services.prompting import (
    JSON_OUTPUT_RULES,
    PROVIDED_CONTEXT_ONLY_RULES,
    build_json_system_prompt,
    compose_prompt_blocks,
)
from app.services.source_profile_extractor import FIELD_KEYS, SourceDocument

logger = get_logger("source_profile_synthesizer")

SYSTEM_PROMPT = build_json_system_prompt(
    role="media research analyst",
    task=(
        "Analyze source documents and produce critical, evidence-based entries for "
        "the listed fields. Only use information from the provided documents. If a "
        "detail is missing, leave that field empty. Provide critical analysis in "
        "notes using evidence from the documents. Return strict JSON that matches "
        "the schema."
    ),
    grounding_rules=compose_prompt_blocks(
        PROVIDED_CONTEXT_ONLY_RULES,
        "Do not guess, do not invent numbers, and do not rely on outside knowledge.",
    ),
    output_rules=compose_prompt_blocks(
        JSON_OUTPUT_RULES,
        "Keep notes grounded in document evidence.",
    ),
)


async def synthesize_source_fields(
    source_name: str,
    documents: Sequence[SourceDocument],
    existing_fields: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """Synthesize Source Fields."""
    llm_client = get_llm_client()
    if not llm_client:
        logger.info(
            "OpenRouter client unavailable, skipping source synthesis for %s",
            source_name,
        )
        return {}

    if not documents:
        return {}

    payload = {
        "source_name": source_name,
        "field_keys": FIELD_KEYS,
        "existing_fields": existing_fields,
        "documents": [{"url": doc.url, "title": doc.title, "text": doc.text} for doc in documents],
    }

    prompt = (
        "Analyze the source documents and produce critical, evidence-based entries "
        "for the listed fields. Use the provided existing_fields as context, but "
        "only keep or add entries that are supported by the documents.\n\n"
        "Schema:\n"
        "{\n"
        '  "fields": {\n'
        '    "funding": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "ownership": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "political_bias": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "factual_reporting": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "editorial_stance": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "corrections_history": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "major_controversies": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "reach_traffic": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "affiliations": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "founded": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "headquarters": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "official_website": [{"value": "...", "sources": ["url"], "notes": "..."}],\n'
        '    "nonprofit_filings": [{"value": "...", "sources": ["url"], "notes": "..."}]\n'
        "  }\n"
        "}\n\n"
        "Documents and existing_fields (JSON):\n"
        f"{json.dumps(payload, ensure_ascii=True)}"
    )

    try:
        response = await asyncio.to_thread(
            llm_client.chat_completions_create,
            service_name="source_profile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            model=settings.source_research_model,
            max_tokens=900,
            temperature=0.2,
        )
    except Exception as exc:
        logger.warning("Source synthesis failed for %s: %s", source_name, exc)
        return {}

    content = response.choices[0].message.content if response.choices else ""
    parsed = _parse_json_payload(content or "")
    if not parsed:
        logger.warning("Source synthesis returned invalid JSON for %s", source_name)
        return {}

    fields_payload = parsed.get("fields") if isinstance(parsed, dict) else None
    if not isinstance(fields_payload, dict):
        return {}

    return _normalize_fields(fields_payload)


def _parse_json_payload(text: str) -> dict[str, Any]:
    if not text:
        return {}
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _normalize_fields(
    fields_payload: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    normalized: dict[str, list[dict[str, Any]]] = {}
    for key in FIELD_KEYS:
        entries = fields_payload.get(key, [])
        if not isinstance(entries, list):
            continue
        cleaned_entries: list[dict[str, Any]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            value = str(entry.get("value", "")).strip()
            if not value:
                continue
            sources_list = _normalize_sources(entry.get("sources"))
            notes = entry.get("notes")
            cleaned_entries.append(
                {
                    "value": value,
                    "sources": sources_list,
                    "notes": str(notes).strip() if notes else None,
                }
            )
        if cleaned_entries:
            normalized[key] = cleaned_entries
    return normalized


def _normalize_sources(raw_sources: Any) -> list[str]:
    if not raw_sources:
        return []
    if isinstance(raw_sources, str):
        sources = [raw_sources]
    elif isinstance(raw_sources, list):
        sources = raw_sources
    else:
        sources = [raw_sources]
    return [str(source).strip() for source in sources if str(source).strip()]
