from __future__ import annotations

import asyncio
import json
import re
from typing import List, Optional

from app.core.config import get_openai_client, settings
from app.core.logging import get_logger

logger = get_logger("source_search_planner")

SYSTEM_PROMPT = (
    "You are a research assistant planning web searches for a news organization. "
    "Generate concise search queries that will find authoritative sources for "
    "funding, ownership, corrections policy, editorial standards, and bias ratings. "
    "Do not invent facts. Output only JSON."
)


class SourceSearchPlanner:
    async def plan_queries(
        self,
        source_name: str,
        website: Optional[str],
        max_queries: int = 6,
    ) -> List[str]:
        client = get_openai_client()
        if not client:
            return []

        payload = {
            "source_name": source_name,
            "website": website,
            "max_queries": max_queries,
            "required_topics": [
                "funding",
                "ownership",
                "mission/about",
                "corrections policy",
                "editorial standards",
                "bias ratings",
                "nonprofit filings (990)",
            ],
            "preferred_domains": [
                "en.wikipedia.org",
                "wikidata.org",
                "projects.propublica.org/nonprofits",
                "mediabiasfactcheck.com",
                "allsides.com",
                "adfontesmedia.com",
            ],
        }

        prompt = (
            "Return a JSON list of search queries. Keep each query under 10 words when possible. "
            "Include official site queries if a website is provided.\n\n"
            f"{json.dumps(payload, ensure_ascii=True)}"
        )

        try:
            response = await asyncio.to_thread(
                client.chat.completions.create,
                model=settings.open_router_model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=350,
                temperature=0.2,
            )
        except Exception as exc:
            logger.warning("Search planner failed for %s: %s", source_name, exc)
            return []

        content = response.choices[0].message.content if response.choices else ""
        queries = _parse_query_list(content)
        if len(queries) > max_queries:
            return queries[:max_queries]
        return queries


def _parse_query_list(text: str) -> List[str]:
    if not text:
        return []
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    cleaned: List[str] = []
    for item in payload:
        if not isinstance(item, str):
            continue
        query = " ".join(item.split())
        if query:
            cleaned.append(query)
    return cleaned
