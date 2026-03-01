from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Sequence

from app.core.config import get_openai_client, settings
from app.core.logging import get_logger
from app.services.source_profile_extractor import FIELD_KEYS, SourceDocument

logger = get_logger("source_field_extractor")

MAX_CHARS_PER_DOC = 3000

EXTRACTION_PROMPT = """You are a media research analyst. Extract structured information about a news source from the provided documents.

For each piece of information you find, extract:
- field: the category (funding, ownership, political_bias, factual_reporting, editorial_stance, corrections_history, major_controversies, reach_traffic, affiliations, founded, headquarters, official_website, nonprofit_filings)
- value: the actual information found
- source: the URL where you found this
- evidence: a brief quote or summary from the source

Return ONLY valid JSON array. Each entry should have: field, value, source, evidence
If no useful information is found for a field, skip it.
Do not invent information - only extract what is actually in the documents."""


async def extract_fields_from_documents(
    source_name: str,
    documents: Sequence[SourceDocument],
) -> List[Dict[str, Any]]:
    """Extract structured fields from documents using LLM."""
    client = get_openai_client()
    if not client:
        logger.info("OpenRouter unavailable, using regex fallback")
        return []

    if not documents:
        return []

    truncated_docs = _truncate_documents(documents)

    docs_context = _build_docs_context(truncated_docs)

    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.source_research_model,
            messages=[
                {"role": "system", "content": EXTRACTION_PROMPT},
                {
                    "role": "user",
                    "content": f"Source: {source_name}\n\nDocuments:\n{docs_context}",
                },
            ],
            max_tokens=4000,
            temperature=0.2,
        )

        content = response.choices[0].message.content if response.choices else ""
        extracted = _parse_extracted_fields(content)

        if extracted:
            logger.info(
                f"Extracted {len(extracted)} field entries from {len(documents)} docs"
            )
            return extracted
        else:
            logger.warning(f"Failed to parse extracted fields for {source_name}")
            return []

    except Exception as exc:
        logger.warning(f"Field extraction failed for {source_name}: {exc}")
        return []


def _truncate_documents(documents: Sequence[SourceDocument]) -> List[Dict[str, str]]:
    """Truncate documents to stay within token budget."""
    truncated = []
    for doc in documents:
        text = doc.text
        if len(text) > MAX_CHARS_PER_DOC:
            text = _smart_truncate(text, MAX_CHARS_PER_DOC)

        truncated.append(
            {
                "url": doc.url,
                "title": doc.title,
                "text": text,
            }
        )

    return truncated


def _smart_truncate(text: str, max_chars: int) -> str:
    """Smart truncate that preserves important content."""
    if len(text) <= max_chars:
        return text

    lines = text.split("\n")
    if len(lines) > 1:
        important = []
        for line in lines[:10]:
            line = line.strip()
            if line and len(line) > 20:
                important.append(line)

        if important:
            result = "\n".join(important)
            if len(result) > max_chars // 2:
                return result[:max_chars] + "..."

    return text[:max_chars] + "..."


def _build_docs_context(documents: List[Dict[str, str]]) -> str:
    """Build context string from documents."""
    parts = []
    for i, doc in enumerate(documents):
        parts.append(f"[Document {i + 1}]")
        parts.append(f"URL: {doc['url']}")
        parts.append(f"Title: {doc['title']}")
        parts.append(f"Content: {doc['text']}")
        parts.append("")

    return "\n".join(parts)


def _parse_extracted_fields(content: str) -> List[Dict[str, Any]]:
    """Parse extracted fields from LLM response."""
    if not content:
        return []

    try:
        data = json.loads(content)
        if isinstance(data, list):
            return _normalize_extracted_entries(data)
        if isinstance(data, dict) and "fields" in data:
            fields = data["fields"]
            if isinstance(fields, list):
                return _normalize_extracted_entries(fields)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\[[\s\S]*\]", content)
    if match:
        try:
            data = json.loads(match.group(0))
            return _normalize_extracted_entries(data)
        except json.JSONDecodeError:
            pass

    return []


def _normalize_extracted_entries(entries: List[Any]) -> List[Dict[str, Any]]:
    """Normalize extracted entries."""
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        field = entry.get("field") or entry.get("field_name")
        value = entry.get("value") or entry.get("info")
        source = entry.get("source") or entry.get("url")
        evidence = entry.get("evidence") or entry.get("notes") or entry.get("quote")

        if not field or not value:
            continue

        field = str(field).strip().lower()
        if field not in FIELD_KEYS:
            continue

        normalized.append(
            {
                "field": field,
                "value": str(value).strip(),
                "sources": [str(source).strip()] if source else [],
                "notes": str(evidence).strip() if evidence else None,
            }
        )

    return normalized
