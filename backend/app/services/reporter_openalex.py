"""OpenAlex author lookup for reporter enrichment."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger("reporter_openalex")

OPENALEX_BASE = "https://api.openalex.org"
DEFAULT_TIMEOUT = 15.0


async def search_openalex_author(
    http_client: httpx.AsyncClient,
    name: str,
    institution: str | None = None,
) -> list[dict[str, Any]]:
    """Search OpenAlex for an author by name.

    Uses GET {base}/authors?search={name}
    If institution provided, filter by last_known_institutions.

    Returns list of author dicts with keys:
    - id: OpenAlex author ID (full URL)
    - display_name: author name
    - works_count: total publications
    - cited_by_count: total citations
    - last_known_institution: name if available
    - topics: list of topic names
    - counts_by_year: list of {year, works_count, cited_by_count}
    """
    params: dict[str, Any] = {
        "search": name,
        "per_page": 5,
    }
    response = await http_client.get(
        f"{OPENALEX_BASE}/authors",
        params=params,
        timeout=DEFAULT_TIMEOUT,
    )
    if response.status_code != 200:
        logger.debug("OpenAlex search failed for %s: HTTP %d", name, response.status_code)
        return []

    data = response.json()
    results = data.get("results") or []
    authors = []
    for author in results:
        entry = {
            "id": author.get("id"),
            "display_name": author.get("display_name"),
            "works_count": author.get("works_count"),
            "cited_by_count": author.get("cited_by_count"),
            "last_known_institution": _extract_institution_name(author),
            "topics": _extract_topic_names(author),
            "counts_by_year": (author.get("counts_by_year") or [])[:5],
        }
        authors.append(entry)
    return authors


def _extract_institution_name(author: dict[str, Any]) -> str | None:
    """Extract institution name from OpenAlex author record."""
    institutions = author.get("last_known_institutions") or []
    for inst in institutions:
        if isinstance(inst, dict):
            name_val = inst.get("display_name")
            if isinstance(name_val, str):
                return name_val
    return None


def _extract_topic_names(author: dict[str, Any]) -> list[str]:
    """Extract topic/field names from OpenAlex author record."""
    topics = author.get("topics") or []
    names = []
    for topic in topics:
        if isinstance(topic, dict) and isinstance(topic.get("display_name"), str):
            names.append(topic["display_name"])
    return names


def openalex_claims_from_author(
    author_data: dict[str, Any],
    reporter_name: str,
) -> list[dict[str, Any]]:
    """Convert OpenAlex author data into reporter_claim-compatible dicts.

    Returns list of dicts with keys: claim_type, claim_value, source_type, source_url, confidence.
    Possible claim types: affiliation, topic, work_count.
    """
    claims = []

    institution = author_data.get("last_known_institution")
    if institution:
        claims.append(
            {
                "claim_type": "affiliation",
                "claim_value": institution,
                "source_type": "openalex",
                "source_url": author_data.get("id"),
                "confidence": 0.7,
            }
        )

    for topic in author_data.get("topics") or []:
        claims.append(
            {
                "claim_type": "topic",
                "claim_value": topic,
                "source_type": "openalex",
                "source_url": author_data.get("id"),
                "confidence": 0.6,
            }
        )

    works_count = author_data.get("works_count")
    if isinstance(works_count, int):
        claims.append(
            {
                "claim_type": "work_count",
                "claim_value": str(works_count),
                "source_type": "openalex",
                "source_url": author_data.get("id"),
                "confidence": 0.8,
            }
        )

    cited_by_count = author_data.get("cited_by_count")
    if isinstance(cited_by_count, int):
        claims.append(
            {
                "claim_type": "citation_count",
                "claim_value": str(cited_by_count),
                "source_type": "openalex",
                "source_url": author_data.get("id"),
                "confidence": 0.8,
            }
        )

    return claims
