"""Wayback Machine CDX integration for reporter bio snapshots."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger("reporter_wayback")

CDX_API = "https://web.archive.org/cdx/search/cdx"
DEFAULT_TIMEOUT = 15.0


async def fetch_wayback_snapshots(
    http_client: httpx.AsyncClient,
    url: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Fetch CDX records for a given URL from the Wayback Machine.

    Uses: GET {cdx}?url={url}&output=json&limit={limit}&fl=timestamp,original,statuscode,digest

    Returns list of dicts with keys: timestamp, original_url, status_code, digest.
    Filters to only HTTP 200 records via CDX filter parameter.
    """
    params = {
        "url": url,
        "output": "json",
        "limit": str(limit),
        "fl": "timestamp,original,statuscode,digest",
        "filter": "statuscode:200",
    }
    response = await http_client.get(CDX_API, params=params, timeout=DEFAULT_TIMEOUT)
    if response.status_code != 200:
        logger.debug("Wayback CDX failed for %s: HTTP %d", url, response.status_code)
        return []

    try:
        rows = response.json()
    except Exception:
        logger.debug("Wayback CDX non-JSON response for %s", url)
        return []

    if not rows or not isinstance(rows, list) or len(rows) < 2:
        return []

    records = []
    for row in rows[1:]:
        if len(row) >= 4:
            records.append(
                {
                    "timestamp": row[0],
                    "original_url": row[1],
                    "status_code": row[2],
                    "digest": row[3],
                }
            )
    return records


async def fetch_wayback_snapshot_content(
    http_client: httpx.AsyncClient,
    url: str,
    timestamp: str,
) -> str | None:
    """Fetch the actual content of a Wayback snapshot.

    Uses: https://web.archive.org/web/{timestamp}/{url}
    Returns page text or None on failure.
    """
    snapshot_url = f"https://web.archive.org/web/{timestamp}/{url}"
    try:
        response = await http_client.get(snapshot_url, timeout=DEFAULT_TIMEOUT)
    except Exception as exc:
        logger.debug("Wayback snapshot fetch failed for %s: %s", snapshot_url, exc)
        return None

    if response.status_code != 200:
        return None
    return response.text


def wayback_claims_from_snapshots(
    snapshots: list[dict[str, Any]],
    url: str,
) -> list[dict[str, Any]]:
    """Convert Wayback snapshot metadata into reporter_claim-compatible dicts.

    Returns list of dicts with keys: claim_type, claim_value, source_type, source_url, confidence.
    Claim type: wayback_snapshot (evidence that an author page existed at a point in time).
    Deduplicates by timestamp.
    """
    claims = []
    seen_timestamps = set()
    for snapshot in snapshots:
        ts = snapshot.get("timestamp", "")
        if ts in seen_timestamps:
            continue
        seen_timestamps.add(ts)
        year = ts[:4] if len(ts) >= 4 else "unknown"
        claims.append(
            {
                "claim_type": "wayback_snapshot",
                "claim_value": f"Author page archived at {url} ({year})",
                "source_type": "wayback",
                "source_url": f"https://web.archive.org/web/{ts}/{url}",
                "confidence": 0.9,
            }
        )
    return claims
