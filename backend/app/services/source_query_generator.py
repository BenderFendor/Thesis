from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Dict, List, Optional

from app.core.config import get_openai_client, settings
from app.core.logging import get_logger

logger = get_logger("source_query_generator")

SYSTEM_PROMPT = """You are a media research specialist. Your task is to generate optimal search queries to research a news source.

Generate queries that will help find information about:
- Ownership and parent companies
- Funding sources and revenue
- Political bias and editorial stance
- Factual reporting history
- Corrections policies
- Reach and audience size
- Affiliations and memberships
- Founding date and history
- Headquarters location

Return ONLY a JSON array of 6-8 search queries. Each query should be specific and targeted."""


QUERY_SYSTEM_PROMPT = """You are a media research specialist. Generate search queries to research a news source.

Return ONLY valid JSON in this exact format:
{"queries": ["query 1", "query 2", ...]}

Generate 6-8 queries covering: ownership, funding, bias, factual reporting, editorial stance, reach, affiliations, history."""


async def generate_search_queries(
    source_name: str,
    website: Optional[str] = None,
) -> List[str]:
    """Generate optimal search queries for a source."""
    client = get_openai_client()
    if not client:
        logger.info("OpenRouter client unavailable, using fallback queries")
        return _fallback_queries(source_name, website)

    context = f"Source: {source_name}"
    if website:
        context += f"\nWebsite: {website}"

    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.source_research_model,
            messages=[
                {"role": "system", "content": QUERY_SYSTEM_PROMPT},
                {"role": "user", "content": context},
            ],
            max_tokens=400,
            temperature=0.3,
        )

        content = response.choices[0].message.content if response.choices else ""
        queries = _parse_queries(content)

        if queries:
            logger.info(f"Generated {len(queries)} queries for {source_name}")
            return queries
        else:
            logger.warning(f"Failed to parse queries for {source_name}, using fallback")
            return _fallback_queries(source_name, website)

    except Exception as exc:
        logger.warning(f"Query generation failed for {source_name}: {exc}")
        return _fallback_queries(source_name, website)


def _parse_queries(content: str) -> List[str]:
    """Parse queries from LLM response."""
    if not content:
        return []

    try:
        data = json.loads(content)
        if isinstance(data, dict) and "queries" in data:
            return [q.strip() for q in data["queries"] if q.strip()]
        if isinstance(data, list):
            return [q.strip() for q in data if isinstance(q, str) and q.strip()]
    except json.JSONDecodeError:
        pass

    match = re.search(r"\[[\s\S]*\]", content)
    if match:
        try:
            queries = json.loads(match.group(0))
            return [q.strip() for q in queries if isinstance(q, str) and q.strip()]
        except json.JSONDecodeError:
            pass

    return []


def _fallback_queries(source_name: str, website: Optional[str]) -> List[str]:
    """Generate fallback queries without LLM."""
    site_filter = ""
    if website:
        domain = website.replace("https://", "").replace("http://", "").split("/")[0]
        site_filter = f" site:{domain}"

    queries = [
        f"{source_name} about{site_filter}",
        f"{source_name} ownership parent company",
        f"{source_name} funding donors",
        f"{source_name} media bias rating",
        f"{source_name} editorial policy{site_filter}",
        f"{source_name} corrections policy{site_filter}",
    ]

    if "founded" not in source_name.lower():
        queries.append(f"{source_name} founded year")

    if "headquarters" not in source_name.lower():
        queries.append(f"{source_name} headquarters location")

    return queries[:8]
