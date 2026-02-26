from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Sequence

from app.core.config import settings
from app.core.llm_client import get_llm_client
from app.core.logging import get_logger
from app.services.source_profile_extractor import FIELD_KEYS, SourceDocument

logger = get_logger("source_profile_synthesizer")

SYSTEM_PROMPT = (
    "You are a media research analyst. Use only the provided source documents. "
    "Do not guess, do not invent numbers, and do not rely on outside knowledge. "
    "If a detail is missing, leave that field empty. "
    "Provide critical analysis in notes using evidence from the documents. "
    "Return strict JSON that matches the schema."
)


async def synthesize_source_fields(
    source_name: str,
    documents: Sequence[SourceDocument],
    existing_fields: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, List[Dict[str, Any]]]:
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
        "documents": [
            {"url": doc.url, "title": doc.title, "text": doc.text} for doc in documents
        ],
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
            model=settings.open_router_model,
            max_tokens=900,
            temperature=0.2,
        )
    except Exception as exc:
        logger.warning("Source synthesis failed for %s: %s", source_name, exc)
        return {}

    content = response.choices[0].message.content if response.choices else ""
    parsed = _parse_json_payload(content)
    if not parsed:
        logger.warning("Source synthesis returned invalid JSON for %s", source_name)
        return {}

    fields_payload = parsed.get("fields") if isinstance(parsed, dict) else None
    if not isinstance(fields_payload, dict):
        return {}

    return _normalize_fields(fields_payload)


def _parse_json_payload(text: str) -> Dict[str, Any]:
    if not text:
        return {}
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}


def _normalize_fields(
    fields_payload: Dict[str, Any],
) -> Dict[str, List[Dict[str, Any]]]:
    normalized: Dict[str, List[Dict[str, Any]]] = {}
    for key in FIELD_KEYS:
        entries = fields_payload.get(key, [])
        if not isinstance(entries, list):
            continue
        cleaned_entries: List[Dict[str, Any]] = []
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


def _normalize_sources(raw_sources: Any) -> List[str]:
    if not raw_sources:
        return []
    if isinstance(raw_sources, str):
        sources = [raw_sources]
    elif isinstance(raw_sources, list):
        sources = raw_sources
    else:
        sources = [raw_sources]
    return [str(source).strip() for source in sources if str(source).strip()]
