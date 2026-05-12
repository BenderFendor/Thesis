from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from app.core.config import SCOOP_USER_AGENT
from app.core.logging import get_logger

logger = get_logger("reporter_web_search")


async def search_reporter_web(
    name: str,
    outlet: Optional[str] = None,
    http_client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=15.0)
    try:
        query = f"{name} {outlet or ''} reporter journalist".strip()
        encoded = quote(query)
        url = f"https://lite.duckduckgo.com/lite/?q={encoded}"

        try:
            r = await client.get(
                url,
                headers={"User-Agent": SCOOP_USER_AGENT},
                follow_redirects=True,
            )
        except Exception as exc:
            logger.debug("Web search failed for %s: %s", name, exc)
            return _empty_result(name, "search_failed")

        if r.status_code != 200:
            return _empty_result(name, f"http_{r.status_code}")

        results = _parse_lite_html(r.text, max_results=5)
        if not results:
            logger.info("DDG Lite returned no parseable results for %s (len=%d)", name, len(r.text))
            return _empty_result(name, "no_results", url)

        return {
            "name": name,
            "outlet": outlet,
            "found": True,
            "result_count": len(results),
            "results": results,
            "search_url": url,
            "evidence": [f"Web search found {len(results)} results about {name}"],
        }
    finally:
        if owned_client:
            await client.aclose()


def _parse_lite_html(html: str, max_results: int = 5) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    in_results = False
    current: Dict[str, str] = {}

    for line in html.split("\n"):
        if 'class="result-snippet"' in line or 'class="result__snippet"' in line:
            if current:
                results.append(current)
                current = {}
                if len(results) >= max_results:
                    break
            in_results = True
        if not in_results:
            continue
        if 'class="result__title"' in line or 'class="result-title"' in line:
            m = re.search(r'href="([^"]+)"[^>]*>([^<]+)<', line)
            if m:
                current["url"] = m.group(1)
                current["title"] = _strip_html(m.group(2)).strip()
        if 'class="result__snippet"' in line or 'class="result-snippet"' in line:
            current["snippet"] = _strip_html(line).strip()[:200]

    if current:
        results.append(current)

    return results


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


def _empty_result(name: str, reason: str, search_url: str = "") -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "name": name,
        "found": False,
        "result_count": 0,
        "results": [],
        "evidence": [f"Web search unavailable: {reason}"],
    }
    if search_url:
        result["search_url"] = search_url
    return result
