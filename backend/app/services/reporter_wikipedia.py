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


async def _search_wikipedia(
    client: httpx.AsyncClient, name: str, keyword: str
) -> list[dict[str, Any]]:
    """Run a title search and return the search result pages (empty on failure)."""
    r = await client.get(
        WIKIPEDIA_API,
        params={
            "action": "query",
            "list": "search",
            "srsearch": f'"{name}" {keyword}',
            "srlimit": 3,
            "format": "json",
        },
        headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
    )
    if r.status_code != 200:
        return []
    return (r.json().get("query") or {}).get("search") or []


async def _fetch_wikipedia_extract(
    client: httpx.AsyncClient, title: str
) -> tuple[bool, dict[str, Any] | None]:
    """Fetch the extracts/info payload for a page.

    Returns (extract_ok, page_info): extract_ok is False when the extract
    request itself failed; page_info is None when no usable page exists.
    """
    r3 = await client.get(
        WIKIPEDIA_API,
        params={
            "action": "query",
            "prop": "extracts|pageimages|info",
            "titles": title,
            "exintro": True,
            "explaintext": True,
            "inprop": "url",
            "pithumbsize": 200,
            "format": "json",
        },
        headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
    )
    if r3.status_code != 200:
        return False, None
    extract_data = r3.json().get("query", {}).get("pages", {})
    for pid, info in extract_data.items():
        if pid == "-1":
            continue
        return True, info
    return True, None


def _journalist_bio_payload(
    pages: list[dict[str, Any]], info: dict[str, Any] | None
) -> dict[str, Any]:
    """Build the bio payload from page search results plus extract info."""
    if info is None:
        return {"found": False, "pages": []}
    return {
        "found": True,
        "pages": pages,
        "title": info.get("title"),
        "extract": info.get("extract", "")[:800],
        "url": info.get("fullurl"),
        "thumbnail": (info.get("thumbnail") or {}).get("source"),
    }


async def fetch_journalist_bio(
    name: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Fetch Journalist Bio."""
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=10.0)
    try:
        pages = await _search_wikipedia(client, name, "journalist")
        if not pages:
            pages = await _search_wikipedia(client, name, "reporter")
        if not pages:
            return {"found": False, "pages": []}

        best_title = pages[0].get("title", "")
        if not best_title:
            return {"found": False, "pages": []}

        extract_ok, info = await _fetch_wikipedia_extract(client, best_title)
        if info is not None:
            return _journalist_bio_payload(pages, info)
        if extract_ok:
            return {"found": False, "pages": []}
        return {"found": True, "pages": pages, "extract": None}
    except Exception as exc:
        logger.debug("Wikipedia bio fetch failed for %s: %s", name, exc)
        return {"found": False, "pages": []}
    finally:
        if owned_client:
            await client.aclose()


def _category_members(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the category members from a categorymembers API payload."""
    return (data.get("query") or {}).get("categorymembers") or []


def _continue_token(data: dict[str, Any]) -> str | None:
    """Return the cmcontinue continuation token, or None when done."""
    if "continue" not in data:
        return None
    return data["continue"]["cmcontinue"]


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
            for member in _category_members(data):
                results.append({"title": member.get("title", ""), "pageid": member.get("pageid")})
            cmcontinue = _continue_token(data)
            if cmcontinue is None:
                break
            params["cmcontinue"] = cmcontinue
            if limit and len(results) >= limit:
                break
        return results
    except Exception as exc:
        logger.debug("Category fetch failed for %s: %s", category, exc)
        return results
    finally:
        if owned_client:
            await client.aclose()
