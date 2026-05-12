from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from app.core.config import SCOOP_USER_AGENT
from app.core.logging import get_logger

logger = get_logger("reporter_social_search")

MASTODON_INSTANCES = [
    "https://journa.host",
    "https://newsie.social",
    "https://mastodon.social",
    "https://mastodon.online",
]
BLUESKY_API = "https://public.api.bsky.app"


async def find_social_profiles(
    name: str,
    outlet: Optional[str] = None,
    http_client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=15.0)
    try:
        mastodon, bluesky = await _search_all(client, name, outlet)
        return {
            "name": name,
            "outlet": outlet,
            "mastodon": mastodon,
            "bluesky": bluesky,
            "found": bool(mastodon or bluesky),
        }
    finally:
        if owned_client:
            await client.aclose()


async def _search_all(
    client: httpx.AsyncClient, name: str, outlet: Optional[str] = None
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    import asyncio

    results = await asyncio.gather(
        _search_mastodon(client, name, outlet),
        _search_bluesky(client, name, outlet),
        return_exceptions=True,
    )
    mastodon = results[0] if isinstance(results[0], dict) else {}
    bluesky = results[1] if isinstance(results[1], dict) else {}
    return mastodon, bluesky


async def _search_mastodon(
    client: httpx.AsyncClient, name: str, outlet: Optional[str] = None
) -> Dict[str, Any]:
    query = f"{name} {outlet or ''}".strip()
    for instance in MASTODON_INSTANCES:
        try:
            r = await client.get(
                f"{instance}/api/v2/search",
                params={"q": query, "type": "accounts", "limit": 5},
                headers={"User-Agent": SCOOP_USER_AGENT},
                timeout=8.0,
            )
            if r.status_code != 200:
                continue
            data = r.json()
            accounts = data.get("accounts") or []
            if accounts:
                results = []
                for acct in accounts[:3]:
                    results.append(
                        {
                            "username": acct.get("acct", ""),
                            "display_name": acct.get("display_name", ""),
                            "bio": acct.get("note", "")[:200],
                            "url": acct.get("url", ""),
                            "followers": acct.get("followers_count", 0),
                            "instance": instance,
                        }
                    )
                return {"found": True, "accounts": results, "instance": instance}
        except Exception as exc:
            logger.debug("Mastodon search failed on %s: %s", instance, exc)
            continue
    return {"found": False, "accounts": []}


async def _search_bluesky(
    client: httpx.AsyncClient, name: str, outlet: Optional[str] = None
) -> Dict[str, Any]:
    query = f"{name} {outlet or ''}".strip()
    try:
        r = await client.get(
            f"{BLUESKY_API}/xrpc/app.bsky.actor.searchActors",
            params={"q": query, "limit": 5},
            headers={"User-Agent": SCOOP_USER_AGENT},
            timeout=8.0,
        )
        if r.status_code != 200:
            return {"found": False, "accounts": []}
        data = r.json()
        actors = data.get("actors") or []
        if actors:
            results = []
            for actor in actors[:3]:
                results.append(
                    {
                        "handle": actor.get("handle", ""),
                        "display_name": actor.get("displayName", ""),
                        "description": (actor.get("description") or "")[:200],
                        "did": actor.get("did", ""),
                        "followers": actor.get("followersCount", 0),
                    }
                )
            return {"found": True, "accounts": results}
    except Exception as exc:
        logger.debug("Bluesky search failed: %s", exc)
    return {"found": False, "accounts": []}
