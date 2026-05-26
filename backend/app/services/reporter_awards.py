"""Known journalism awards and fellowship crawler for reporter enrichment."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger("reporter_awards")

AWARD_SOURCES: list[dict[str, Any]] = [
    {
        "name": "pulitzer",
        "label": "Pulitzer Prize",
        "url": "https://www.pulitzer.org/prize-winners",
        "type": "web",
        "confidence": 0.90,
    },
    {
        "name": "ire",
        "label": "IRE Award",
        "url": "https://www.ire.org/awards/",
        "type": "web",
        "confidence": 0.85,
    },
    {
        "name": "peabody",
        "label": "Peabody Award",
        "url": "https://peabodyawards.com/search/",
        "type": "web",
        "confidence": 0.85,
    },
]


async def check_award_for_reporter(
    http_client: httpx.AsyncClient,
    reporter_name: str,
    outlet: str | None = None,
) -> list[dict[str, Any]]:
    """Check known award sources for a reporter.

    For API-based sources: search by name.
    For web-based sources: fetch page and search for name patterns.

    Returns list of dicts with keys: claim_type, claim_value, source_type, source_url, confidence.
    Returns empty list if no awards found or if all sources fail.
    """
    claims = []
    for source in AWARD_SOURCES:
        award_type = source.get("type")
        if award_type == "api":
            result = await _try_api_award_source(http_client, source, reporter_name, outlet)
        elif award_type == "web":
            result = await _try_web_award_source(http_client, source, reporter_name, outlet)
        else:
            continue
        if result:
            claims.append(result)
    return claims


async def _try_api_award_source(
    http_client: httpx.AsyncClient,
    source: dict[str, Any],
    reporter_name: str,
    outlet: str | None,
) -> dict[str, Any] | None:
    """Try an API-based award source.

    Sends GET to the source URL, parses JSON response,
    and recursively searches for the reporter name.
    """
    try:
        response = await http_client.get(source["url"], timeout=15.0)
    except Exception as exc:
        logger.debug("Award source %s failed: %s", source["name"], exc)
        return None

    if response.status_code != 200:
        logger.debug("Award source %s returned HTTP %d", source["name"], response.status_code)
        return None

    try:
        data = response.json()
    except Exception:
        logger.debug("Award source %s returned non-JSON", source["name"])
        return None

    name_lower = reporter_name.lower()
    if _search_award_data(data, name_lower, outlet):
        return {
            "claim_type": "award",
            "claim_value": source["label"],
            "source_type": source["name"],
            "source_url": source["url"],
            "confidence": source["confidence"],
        }
    return None


def _search_award_data(data: Any, name_lower: str, outlet: str | None) -> bool:
    """Recursively search award data for name match."""
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, str) and name_lower in value.lower():
                return True
            if _search_award_data(value, name_lower, outlet):
                return True
    elif isinstance(data, list):
        for item in data:
            if _search_award_data(item, name_lower, outlet):
                return True
    return False


async def _try_web_award_source(
    http_client: httpx.AsyncClient,
    source: dict[str, Any],
    reporter_name: str,
    outlet: str | None,
) -> dict[str, Any] | None:
    """Try a web-based award source.

    Fetches the source page and searches the HTML text
    for the reporter name.
    """
    try:
        response = await http_client.get(source["url"], timeout=15.0, follow_redirects=True)
    except Exception as exc:
        logger.debug("Award source %s failed: %s", source["name"], exc)
        return None

    if response.status_code != 200:
        logger.debug("Award source %s returned HTTP %d", source["name"], response.status_code)
        return None

    text = response.text
    name_lower = reporter_name.lower()

    if name_lower in text.lower():
        return {
            "claim_type": "award",
            "claim_value": source["label"],
            "source_type": source["name"],
            "source_url": str(response.url),
            "confidence": source["confidence"],
        }
    return None
