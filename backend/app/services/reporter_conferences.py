"""Conference speaker page crawler for reporter enrichment."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger("reporter_conferences")

CONFERENCE_SOURCES: list[dict[str, Any]] = [
    {
        "name": "ona",
        "label": "ONA Conference",
        "url": "https://ona19.journalists.org/speakers/",
        "confidence": 0.80,
    },
    {
        "name": "gijn",
        "label": "GIJN Conference",
        "url": "https://gijn.org/conference/speakers/",
        "confidence": 0.80,
    },
]


async def check_conference_for_reporter(
    http_client: httpx.AsyncClient,
    reporter_name: str,
    outlet: str | None = None,
) -> list[dict[str, Any]]:
    """Check known conference speaker pages for a reporter.

    Fetches each conference speaker page and searches HTML
    for the reporter name. Returns a list of claim dicts.

    Returns list of dicts with keys: claim_type, claim_value, source_type, source_url, confidence.
    Returns empty list if no matches found or if all sources fail.
    """
    claims = []
    for source in CONFERENCE_SOURCES:
        try:
            result = await _check_single_conference(http_client, source, reporter_name, outlet)
        except Exception as exc:
            logger.debug("Conference source %s failed: %s", source["name"], exc)
            continue
        if result:
            claims.append(result)
    return claims


async def _check_single_conference(
    http_client: httpx.AsyncClient,
    source: dict[str, Any],
    reporter_name: str,
    outlet: str | None,
) -> dict[str, Any] | None:
    """Check a single conference speaker page for the reporter."""
    try:
        response = await http_client.get(source["url"], timeout=15.0, follow_redirects=True)
    except Exception:
        return None

    if response.status_code != 200:
        return None

    text = response.text
    name_lower = reporter_name.lower()

    if name_lower in text.lower():
        return {
            "claim_type": "conference_speaker",
            "claim_value": source["label"],
            "source_type": source["name"],
            "source_url": str(response.url),
            "confidence": source["confidence"],
        }

    return None
