"""Reporter Wikipedia."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import SCOOP_WIKIMEDIA_UA
from app.core.logging import get_logger

logger = get_logger("reporter_wikipedia")

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
JOURNALISM_CATEGORIES = [
    "American_journalists",
    "American_reporters_and_correspondents",
    "American_television_journalists",
    "British_journalists",
    "Canadian_journalists",
    "Australian_journalists",
]


async def fetch_journalist_bio(
    name: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Fetch Journalist Bio."""
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=10.0)
    try:
        r = await client.get(
            WIKIPEDIA_API,
            params={
                "action": "query",
                "list": "search",
                "srsearch": f'"{name}" journalist',
                "srlimit": 3,
                "format": "json",
            },
            headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
        )
        if r.status_code != 200:
            return {"found": False, "pages": []}

        pages = (r.json().get("query") or {}).get("search") or []
        if not pages:
            r2 = await client.get(
                WIKIPEDIA_API,
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": f'"{name}" reporter',
                    "srlimit": 3,
                    "format": "json",
                },
                headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
            )
            if r2.status_code == 200:
                pages = (r2.json().get("query") or {}).get("search") or []

        if not pages:
            return {"found": False, "pages": []}

        best_title = pages[0].get("title", "")
        if not best_title:
            return {"found": False, "pages": []}

        r3 = await client.get(
            WIKIPEDIA_API,
            params={
                "action": "query",
                "prop": "extracts|pageimages|info",
                "titles": best_title,
                "exintro": True,
                "explaintext": True,
                "inprop": "url",
                "pithumbsize": 200,
                "format": "json",
            },
            headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
        )
        if r3.status_code != 200:
            return {"found": True, "pages": pages, "extract": None}

        extract_data = r3.json().get("query", {}).get("pages", {})
        for pid, info in extract_data.items():
            if pid == "-1":
                continue
            return {
                "found": True,
                "pages": pages,
                "title": info.get("title"),
                "extract": info.get("extract", "")[:800],
                "url": info.get("fullurl"),
                "thumbnail": (info.get("thumbnail") or {}).get("source"),
            }
        return {"found": False, "pages": []}
    except Exception as exc:
        logger.debug("Wikipedia bio fetch failed for %s: %s", name, exc)
        return {"found": False, "pages": []}
    finally:
        if owned_client:
            await client.aclose()


async def fetch_category_journalists(
    category: str,
    limit: int = 100,
    http_client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    """Fetch Category Journalists."""
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=10.0)
    results: list[dict[str, Any]] = []
    params: dict[str, Any] = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": f"Category:{category}",
        "cmlimit": min(limit, 500),
        "cmtype": "page",
        "format": "json",
    }
    try:
        while True:
            r = await client.get(
                WIKIPEDIA_API, params=params, headers={"User-Agent": SCOOP_WIKIMEDIA_UA}
            )
            if r.status_code != 200:
                break
            data = r.json()
            members = (data.get("query") or {}).get("categorymembers") or []
            for m in members:
                results.append({"title": m.get("title", ""), "pageid": m.get("pageid")})
            if "continue" in data:
                params["cmcontinue"] = data["continue"]["cmcontinue"]
                if limit and len(results) >= limit:
                    break
            else:
                break
        return results
    except Exception as exc:
        logger.debug("Category fetch failed for %s: %s", category, exc)
        return results
    finally:
        if owned_client:
            await client.aclose()
