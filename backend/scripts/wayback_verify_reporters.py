"""Discover and verify reporter author pages via Wayback Machine cached snapshots.

For reporters whose live author pages return 403/blocked, this script:
1. Queries the DB for likely-tier reporters grouped by source
2. Discovers author page URLs from their recent article pages (JSON-LD, anchors)
3. Tests each author page URL live; if it returns 403, queries the Wayback CDX API
4. Fetches cached snapshots and checks whether the reporter's name appears in
   <title>, <h1>, or meta tags
5. Reports results (with an option to update the DB)

Usage:
    python scripts/wayback_verify_reporters.py
    python scripts/wayback_verify_reporters.py --source BBC
    python scripts/wayback_verify_reporters.py --limit 5
    python scripts/wayback_verify_reporters.py --apply  # actually update DB
"""

from __future__ import annotations  # noqa: E402

import argparse  # noqa: E402
import asyncio  # noqa: E402
import json as _json  # noqa: E402
import re as _re  # noqa: E402
import sys  # noqa: E402
from collections.abc import Sequence  # noqa: E402
from copy import deepcopy  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.logging import get_logger  # noqa: E402
from app.database import (  # noqa: E402
    Article,
    ArticleAuthor,
    AsyncSessionLocal,
    Reporter,
    get_utc_now,
)
from app.services.reporter_confidence_scorer import update_reporter_confidence  # noqa: E402
from app.services.reporter_public_records import (  # noqa: E402
    _fetch_article_author_signals,
    _is_fetchable_article_url,
    clean_author_name,
)

logger = get_logger("wayback_verify")

from urllib.parse import urljoin as _urljoin  # noqa: E402

CDX_API = "http://web.archive.org/cdx/search/cdx"
WAYBACK_BASE = "https://web.archive.org/web"
CONCURRENT_FETCHES = 6
CONCURRENT_WAYBACK = 2
HTTP_TIMEOUT = 15.0
CDX_RATE_LIMIT = 1.5  # seconds between CDX API calls to avoid 429
NAME_OVERLAP_THRESHOLD = 0.70

_cdx_last_call = 0.0
_cdx_lock = asyncio.Lock()


async def _cdx_rate_limiter() -> None:
    """Throttle CDX API calls to avoid 429 rate limiting."""
    global _cdx_last_call
    async with _cdx_lock:
        now = asyncio.get_running_loop().time()
        wait_for = _cdx_last_call + CDX_RATE_LIMIT - now
        if wait_for > 0:
            await asyncio.sleep(wait_for)
        _cdx_last_call = asyncio.get_running_loop().time()


# ── helpers ────────────────────────────────────────────────────────────


def _name_overlap(a: str, b: str) -> float:
    tokens_a = set(a.lower().split())
    tokens_b = set(b.lower().split())
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))


def _person_name_match(reporter_name: str, page_name: str | None) -> bool:
    if not page_name:
        return False
    cleaned_r = clean_author_name(reporter_name) or reporter_name
    cleaned_p = clean_author_name(page_name) or page_name
    return _name_overlap(cleaned_r, cleaned_p) >= NAME_OVERLAP_THRESHOLD


def _url_is_live_blocked(url: str) -> tuple[bool, int | None, str]:
    """Return (is_blocked, status_code, reason).

    Uses curl_cffi when available for TLS-impervious sites; falls back to httpx.
    Synchronous - meant to be called via run_in_executor.
    """
    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return _url_is_live_blocked_sync_httpx(url)

    try:
        resp = curl_cffi.requests.get(
            url,
            impersonate="chrome120",
            timeout=int(HTTP_TIMEOUT),
            allow_redirects=True,
            headers={
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8",
            },
        )
        code = resp.status_code
        is_blocked = code in (401, 403, 429, 451) or code >= 500
        return is_blocked, code, ""
    except Exception as exc:
        return True, None, str(exc)


def _url_is_live_blocked_sync_httpx(url: str) -> tuple[bool, int | None, str]:
    """Fallback sync httpx check for live URL blocking."""
    try:
        resp = httpx.get(url, timeout=HTTP_TIMEOUT, follow_redirects=True)
        code = resp.status_code
        is_blocked = code in (401, 403, 429, 451) or code >= 500
        return is_blocked, code, ""
    except Exception as exc:
        return True, None, str(exc)


def _mock_cdx_snapshots(author_page_url: str, limit: int = 3) -> list[dict[str, str]]:
    """Return simulated CDX snapshots for known author-page URL patterns.

    Used for testing when the CDX API is rate-limited. For washingtontimes.com,
    returns realistic-looking timestamps.
    """
    import hashlib
    import time as _time

    fake_ts_base = int(_time.time())
    digest = hashlib.sha256(author_page_url.encode()).hexdigest()[:32]
    timestamps = [str(fake_ts_base - i * 86400) for i in range(0, limit * 120, 120)][:limit]
    return [
        {
            "timestamp": ts,
            "original_url": author_page_url,
            "status_code": "200",
            "digest": digest,
        }
        for ts in timestamps
    ]


def _cdx_request(cdx_url: str) -> tuple[int, str]:
    import curl_cffi  # type: ignore[import-untyped]

    resp = curl_cffi.requests.get(
        cdx_url,
        impersonate="chrome120",
        timeout=int(HTTP_TIMEOUT),
    )
    return resp.status_code, resp.text


async def _cdx_retry_backoff(attempt: int, max_retries: int) -> None:
    if attempt < max_retries - 1:
        await asyncio.sleep(2.0)


def _parse_cdx_body(body: str, author_page_url: str) -> list[dict[str, str]] | None:
    """Return CDX snapshot records, or None when no usable snapshots exist."""
    try:
        rows = _json.loads(body)
    except Exception as exc:
        logger.info("CDX non-JSON for %s: %s", author_page_url[:60], exc)
        return None

    if not rows or len(rows) < 2:
        logger.info("CDX no snapshots for %s", author_page_url[:60])
        return None

    records: list[dict[str, str]] = []
    for row in rows[1:]:
        if len(row) >= 4:
            records.append(
                {
                    "timestamp": str(row[0]),
                    "original_url": str(row[1]),
                    "status_code": str(row[2]),
                    "digest": str(row[3]),
                }
            )
    logger.info("CDX found %d snapshots for %s", len(records), author_page_url[:60])
    return records


async def _fetch_cdx_snapshots(
    http_client: httpx.AsyncClient,
    author_page_url: str,
    limit: int = 3,
    mock: bool = False,
) -> list[dict[str, str]]:
    """Query the Wayback CDX API for snapshots of a URL.

    Uses curl_cffi for TLS impersonation to avoid 429 rate limits.
    When mock=True, returns simulated snapshots for known domains for testing.
    """
    if mock:
        return _mock_cdx_snapshots(author_page_url, limit)

    import urllib.parse as _urlparse

    params = {
        "url": author_page_url,
        "output": "json",
        "limit": str(limit),
        "fl": "timestamp,original,statuscode,digest",
        "filter": "statuscode:200",
    }
    query_str = _urlparse.urlencode(params)
    cdx_url = f"{CDX_API}?{query_str}"

    max_retries = 3
    loop = asyncio.get_running_loop()
    for attempt in range(max_retries):
        await _cdx_rate_limiter()
        try:
            status, body = await loop.run_in_executor(None, _cdx_request, cdx_url)
        except Exception as exc:
            logger.info("CDX curl_cffi failed for %s: %s", author_page_url[:60], exc)
            await _cdx_retry_backoff(attempt, max_retries)
            continue

        if status == 429:
            delay = (attempt + 1) * 3.0
            logger.info(
                "CDX 429 for %s, retrying in %.1fs (attempt %d/%d)",
                author_page_url[:60],
                delay,
                attempt + 1,
                max_retries,
            )
            await asyncio.sleep(delay)
            continue

        if status != 200:
            logger.info("CDX HTTP %d for %s", status, author_page_url[:60])
            return []

        records = _parse_cdx_body(body, author_page_url)
        if records is not None:
            return records

    logger.info("CDX exhausted retries for %s", author_page_url[:60])
    return []


async def _fetch_snapshot_content(
    http_client: httpx.AsyncClient,
    original_url: str,
    timestamp: str,
) -> str | None:
    """Fetch the HTML of a Wayback snapshot at a given timestamp. Uses curl_cffi."""
    snapshot_url = f"{WAYBACK_BASE}/{timestamp}id_/{original_url}"

    def _do_fetch():
        import curl_cffi  # type: ignore[import-untyped]

        resp = curl_cffi.requests.get(
            snapshot_url,
            impersonate="chrome120",
            timeout=int(HTTP_TIMEOUT),
        )
        if resp.status_code == 200:
            return resp.text
        return None

    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _do_fetch)
    except Exception as exc:
        logger.debug("Snapshot fetch failed %s: %s", snapshot_url[:80], exc)
    return None


def _html_text(markup: str) -> str:
    from html import unescape as _unescape

    raw = _re.sub(r"(?is)<[^>]+>", " ", markup)
    raw = _unescape(raw)
    return _re.sub(r"\s+", " ", raw).strip()


def _looks_like_name(raw: str) -> bool:
    return bool(raw and len(_re.findall(r"[^\W\d_]+", raw, flags=_re.UNICODE)) >= 2)


def _title_name(html: str) -> str | None:
    title_match = _re.search(r"<title\b[^>]*>(.*?)</title>", html, _re.IGNORECASE | _re.DOTALL)
    if not title_match:
        return None
    raw = _html_text(title_match.group(1))
    for sep in (" - ", " | ", " — ", " – "):
        if sep in raw:
            raw = raw.split(sep, 1)[0].strip()
    return raw if _looks_like_name(raw) else None


def _h1_names(html: str) -> list[str]:
    names: list[str] = []
    for match in _re.finditer(r"<h1\b[^>]*>(.*?)</h1>", html, _re.IGNORECASE | _re.DOTALL):
        raw = _html_text(match.group(1))
        if _looks_like_name(raw) and raw not in names:
            names.append(raw)
    return names


def _meta_author_name(html: str) -> str | None:
    from html import unescape as _unescape

    meta_match = _re.search(
        r'<meta\s[^>]*name=["\']author["\'][^>]*content=["\']([^"\']+)["\']',
        html,
        _re.IGNORECASE,
    )
    if not meta_match:
        return None
    raw = _unescape(meta_match.group(1).strip())
    return raw if raw else None


def _extract_visible_names(html: str) -> list[str]:
    """Extract candidate profile names from HTML <title>, <h1>, and meta author."""
    names: list[str] = []
    title = _title_name(html)
    if title:
        names.append(title)
    for raw in _h1_names(html):
        if raw not in names:
            names.append(raw)
    meta_author = _meta_author_name(html)
    if meta_author and meta_author not in names:
        names.append(meta_author)
    return names


def _mock_snapshot_html(reporter_name: str) -> str:
    return (
        f"<html><head><title>{reporter_name} - Author Profile</title>"
        f'<meta name="author" content="{reporter_name}"></head>'
        f"<body><h1>{reporter_name}</h1></body></html>"
    )


def _matched_via(profile_name: str, visible_names: list[str]) -> str:
    if profile_name == visible_names[0]:
        return "title"
    return "h1" if profile_name in visible_names[1:-1] else "meta_author"


async def _snapshot_match(
    http_client: httpx.AsyncClient,
    reporter_name: str,
    snapshot: dict[str, str],
    mock: bool,
) -> dict[str, Any] | None:
    ts = snapshot["timestamp"]
    original_url = snapshot["original_url"]
    digest = snapshot.get("digest", "")
    if mock:
        content = _mock_snapshot_html(reporter_name)
    else:
        content = await _fetch_snapshot_content(http_client, original_url, ts)
        if not content:
            return None

    visible_names = _extract_visible_names(content)
    if not visible_names:
        logger.debug("No visible names in snapshot %s", ts)
        return None

    for profile_name in visible_names:
        if _person_name_match(reporter_name, profile_name):
            return {
                "wayback_url": f"{WAYBACK_BASE}/{ts}/{original_url}",
                "original_url": original_url,
                "profile_name": profile_name,
                "timestamp": ts,
                "digest": digest,
                "matched_via": _matched_via(profile_name, visible_names),
            }
    return None


async def _wayback_verify_author_page(
    http_client: httpx.AsyncClient,
    reporter_name: str,
    author_page_url: str,
    mock: bool = False,
) -> dict[str, Any] | None:
    """Try to verify a reporter via a Wayback-cached author page.

    Returns dict with wayback_url, profile_name, timestamp, or None.
    When mock=True, generates simulated content that matches the reporter name.
    """
    snapshots = await _fetch_cdx_snapshots(http_client, author_page_url, mock=mock)
    if not snapshots:
        logger.debug("No CDX snapshots for %s", author_page_url)
        return None

    for snapshot in snapshots:
        matched = await _snapshot_match(http_client, reporter_name, snapshot, mock)
        if matched is not None:
            return matched
    return None


# ── main pipeline ──────────────────────────────────────────────────────


def _reporter_info_from_row(row: Any, source_filter: str | None) -> dict[str, Any] | None:
    source = str(row.source or "")
    if source_filter and source_filter.lower() not in source.lower():
        return None
    return {
        "id": int(row.id or 0),
        "name": str(row.name or ""),
        "source": source,
        "tier": str(row.confidence_tier or "likely"),
        "author_page_url": row.author_page_url or "",
    }


def _reporter_rows_to_info(
    rows: Sequence[Any],
    source_filter: str | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    reporters_info: list[dict[str, Any]] = []
    for row in rows:
        info = _reporter_info_from_row(row, source_filter)
        if info is None:
            continue
        reporters_info.append(info)
        if limit and len(reporters_info) >= limit:
            break
    return reporters_info


async def _get_likely_reporters(
    session: AsyncSession,
    source_filter: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Return likely-tier reporters grouped by source.

    Uses raw SQL to avoid PostgreSQL JSON DISTINCT errors on the Reporter model.
    """
    from sqlalchemy import text as sa_text

    raw = await session.execute(
        sa_text("""
            SELECT DISTINCT ON (r.id) r.id, r.name, r.confidence_tier,
                   r.author_page_url, a.source
            FROM reporters r
            JOIN article_authors aa ON aa.reporter_id = r.id
            JOIN articles a ON a.id = aa.article_id
            WHERE r.confidence_tier IN ('likely', 'strong')
            ORDER BY r.id
        """)
    )
    rows = raw.all()

    return _reporter_rows_to_info(rows, source_filter, limit)


async def _get_article_urls_for_reporter(
    session: AsyncSession,
    reporter_id: int,
    limit: int = 10,
) -> list[str]:
    """Get recent article URLs for a reporter."""
    result = await session.execute(
        select(Article.url)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .where(Article.url.isnot(None))
        .where(Article.url != "")
        .order_by(Article.published_at.desc().nullslast())
        .limit(limit)
    )
    urls: list[str] = []
    for (url,) in result.all():
        u = str(url)
        if u not in urls and _is_fetchable_article_url(u):
            urls.append(u)
    return urls


def _append_author_signals(author: Any, names: list[str], urls: list[str]) -> None:
    if not isinstance(author, dict):
        return
    if author.get("name"):
        names.append(str(author["name"]))
    if author.get("url"):
        urls.append(str(author["url"]))


def _collect_dict_author_signals(data: dict[str, Any], names: list[str], urls: list[str]) -> None:
    types = data.get("@type") or []
    if isinstance(types, str):
        types = [types]
    if any(t in ("Person", "NewsArticle") for t in types):
        author = data.get("author")
        if isinstance(author, list):
            for item in author:
                _append_author_signals(item, names, urls)
        elif isinstance(author, dict):
            _append_author_signals(author, names, urls)
    for value in data.values():
        _collect_jsonld_author_signals(value, names, urls)


def _collect_jsonld_author_signals(data: Any, names: list[str], urls: list[str]) -> None:
    if isinstance(data, dict):
        _collect_dict_author_signals(data, names, urls)
    elif isinstance(data, list):
        for item in data:
            _collect_jsonld_author_signals(item, names, urls)


def _jsonld_author_signals(html: str) -> tuple[list[str], list[str]]:
    author_names: list[str] = []
    author_urls: list[str] = []
    for raw_ld in _re.findall(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html,
        _re.IGNORECASE | _re.DOTALL,
    ):
        try:
            data = _json.loads(raw_ld.strip())
        except _json.JSONDecodeError:
            continue
        _collect_jsonld_author_signals(data, author_names, author_urls)
    return author_names, author_urls


def _author_anchor_urls(html: str, article_url: str) -> list[str]:
    author_urls: list[str] = []
    for match in _re.finditer(r"<a\b([^>]*)>", html, _re.IGNORECASE):
        attrs_raw = match.group(1)
        href_match = _re.search(r'href=["\']([^"\']+)["\']', attrs_raw, _re.IGNORECASE)
        if not href_match:
            continue
        href = href_match.group(1)
        if _re.search(
            r"/(author|authors|bio|bios|by|byline|columnist|columnists|contributor|"
            r"contributors|people|person|profile|profiles|staff|team)/",
            href,
            _re.IGNORECASE,
        ):
            author_urls.append(_urljoin(article_url, href))
    return author_urls


def _try_curl_cffi_article_signals(article_url: str) -> dict[str, Any] | None:
    """Fetch article with curl_cffi TLS impersonation and extract author URLs.

    Returns dict with author_names, author_urls, or None if fetch failed.
    Fallback when standard httpx gets blocked (403, Cloudflare, etc).
    """
    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        resp = curl_cffi.requests.get(
            article_url,
            impersonate="chrome120",
            timeout=HTTP_TIMEOUT,
            allow_redirects=True,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8",
            },
        )
    except Exception:
        return None

    if resp.status_code != 200 or not resp.text or len(resp.text) < 500:
        return None

    html = resp.text
    author_names, author_urls = _jsonld_author_signals(html)
    author_urls.extend(_author_anchor_urls(html, article_url))

    if not author_names and not author_urls:
        return None

    return {
        "article_url": article_url,
        "author_names": list(dict.fromkeys(author_names)),
        "author_urls": list(dict.fromkeys(author_urls)),
        "access_path": "curl_cffi",
    }


def _dedupe_urls(urls: Any) -> list[str]:
    seen: list[str] = []
    for u in urls:
        if isinstance(u, str) and u not in seen:
            seen.append(u)
    return seen


async def _cffi_author_urls(article_urls: list[str], max_articles: int) -> list[str]:
    loop = asyncio.get_running_loop()
    cffi_results = await asyncio.gather(
        *[
            loop.run_in_executor(None, _try_curl_cffi_article_signals, url)
            for url in article_urls[:max_articles]
        ],
        return_exceptions=True,
    )
    author_urls: list[str] = []
    for signals in cffi_results:
        if isinstance(signals, BaseException) or signals is None:
            continue
        for url in signals.get("author_urls", []):
            if isinstance(url, str) and url not in author_urls:
                author_urls.append(url)
    return author_urls


async def _discover_author_page_urls(
    http_client: httpx.AsyncClient,
    reporter_name: str,
    article_urls: list[str],
    max_articles: int = 5,
) -> list[str]:
    """Fetch article pages and extract author page URLs from JSON-LD / anchors.

    Tries standard httpx first; falls back to curl_cffi for blocked sites.
    """
    sem = asyncio.Semaphore(CONCURRENT_FETCHES)

    async def _fetch_one(url: str) -> list[str]:
        async with sem:
            try:
                result = await _fetch_article_author_signals(http_client, reporter_name, url)
                if isinstance(result, dict):
                    return result.get("author_pages", [])
            except Exception:
                pass
        return []

    tasks = [_fetch_one(url) for url in article_urls[:max_articles]]
    all_pages = await asyncio.gather(*tasks, return_exceptions=True)

    author_urls = _dedupe_urls(
        u for page_list in all_pages if isinstance(page_list, list) for u in page_list
    )

    # Fallback: if no author URLs found, try curl_cffi on article pages directly
    if not author_urls:
        author_urls = await _cffi_author_urls(article_urls, max_articles)

    return author_urls


async def _promote_via_wayback(
    session: AsyncSession,
    reporter: Reporter,
    wayback_result: dict[str, Any],
) -> bool:
    """Set the Wayback URL as the author_page_url and add a citation."""
    author_page_url = wayback_result["wayback_url"]
    original_url = wayback_result["original_url"]
    ts = wayback_result["timestamp"]
    profile_name = wayback_result["profile_name"]

    reporter_id = int(reporter.id or 0)

    if not reporter.author_page_url:
        reporter.author_page_url = author_page_url
    if not reporter.canonical_author_url:
        reporter.canonical_author_url = original_url

    citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
    has_citation = any(
        isinstance(c, dict) and str(c.get("url") or "") == author_page_url for c in citations
    )
    if not has_citation:
        citations.insert(
            0,
            {
                "label": "Wayback Machine archive",
                "url": author_page_url,
                "source_type": "archived_author_page",
                "note": (
                    f"Live page 403/blocked. Cached snapshot {ts}. "
                    f"Profile name verified as '{profile_name}'."
                ),
            },
        )
    reporter.citations = citations
    reporter.updated_at = get_utc_now()

    await session.commit()
    await update_reporter_confidence(session, reporter_id)
    await session.refresh(reporter)

    new_tier = reporter.confidence_tier or "unmatched"
    logger.info(
        "Promoted reporter %s to %s via Wayback (url=%s, ts=%s)",
        reporter.name,
        new_tier,
        original_url,
        ts,
    )
    return new_tier == "verified"


async def _blocked_author_urls(author_page_urls: list[str], reporter_name: str) -> list[str]:
    blocked_urls: list[str] = []
    loop = asyncio.get_running_loop()
    for url in author_page_urls[:5]:
        is_blocked, status_code, _ = await loop.run_in_executor(None, _url_is_live_blocked, url)
        if is_blocked:
            blocked_urls.append(url)
            logger.debug(
                "Blocked author page %s (code=%s) for reporter %s",
                url,
                status_code,
                reporter_name,
            )
        else:
            logger.debug(
                "Author page %s is reachable (code=%s) for reporter %s - skip Wayback",
                url,
                status_code,
                reporter_name,
            )
    return blocked_urls


async def _match_first_wayback(
    http_client: httpx.AsyncClient,
    reporter_name: str,
    blocked_urls: list[str],
    mock: bool,
) -> tuple[dict[str, Any] | None, int]:
    sem = asyncio.Semaphore(CONCURRENT_WAYBACK)

    async def _try_one(url: str) -> dict[str, Any] | None:
        async with sem:
            return await _wayback_verify_author_page(http_client, reporter_name, url, mock=mock)

    wb_tasks = [_try_one(url) for url in blocked_urls[:3]]
    wb_results = await asyncio.gather(*wb_tasks, return_exceptions=True)

    total_snapshots = 0
    for wb_result in wb_results:
        if isinstance(wb_result, BaseException) or wb_result is None:
            continue
        total_snapshots += 1
        return wb_result, total_snapshots
    return None, total_snapshots


async def _apply_wayback_promotion(
    session: AsyncSession, rid: int, wayback_result: dict[str, Any]
) -> bool:
    reporter = (
        await session.execute(select(Reporter).where(Reporter.id == rid))
    ).scalar_one_or_none()
    if reporter is None:
        return False
    return await _promote_via_wayback(session, reporter, wayback_result)


async def _process_reporter(
    session: AsyncSession,
    http_client: httpx.AsyncClient,
    info: dict[str, Any],
    apply_changes: bool,
    mock: bool = False,
) -> dict[str, Any]:
    """Full pipeline for one reporter: discover author URLs, check live, try Wayback."""
    rid = info["id"]
    name = info["name"]
    source = info["source"]
    existing_author_url = info["author_page_url"]

    result = {
        "reporter_id": rid,
        "name": name,
        "source": source,
        "tier": info["tier"],
        "existing_author_page_url": existing_author_url,
        "article_urls_checked": 0,
        "discovered_author_urls": 0,
        "blocked_urls": 0,
        "wayback_snapshots_tried": 0,
        "wayback_matched": False,
        "wayback_url": "",
        "wayback_timestamp": "",
        "matched_name": "",
        "promoted": False,
        "error": None,
    }

    # Step 1: Get recent article URLs
    article_urls = await _get_article_urls_for_reporter(session, rid)
    result["article_urls_checked"] = len(article_urls)
    if not article_urls:
        result["error"] = "no_article_urls"
        return result

    # Step 2: Discover author page URLs from articles
    author_page_urls = await _discover_author_page_urls(http_client, name, article_urls)
    result["discovered_author_urls"] = len(author_page_urls)

    # Also include existing author page URL if set
    if existing_author_url and existing_author_url not in author_page_urls:
        author_page_urls.insert(0, existing_author_url)

    if not author_page_urls:
        result["error"] = "no_author_page_urls_discovered"
        return result

    # Step 3: For each author page URL, test if live is blocked
    blocked_urls = await _blocked_author_urls(author_page_urls, name)
    result["blocked_urls"] = len(blocked_urls)
    if not blocked_urls:
        result["error"] = "no_blocked_author_pages"
        return result

    # Step 4: Try Wayback Machine for each blocked URL
    wayback_result, total_snapshots = await _match_first_wayback(
        http_client, name, blocked_urls, mock
    )
    result["wayback_snapshots_tried"] = total_snapshots
    if wayback_result is None:
        result["error"] = "no_wayback_match"
        return result

    result["wayback_matched"] = True
    result["wayback_url"] = wayback_result["wayback_url"]
    result["wayback_timestamp"] = wayback_result["timestamp"]
    result["matched_name"] = wayback_result["profile_name"]

    if apply_changes:
        result["promoted"] = await _apply_wayback_promotion(session, rid, wayback_result)
    return result


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available (check DATABASE_URL / SSH tunnel)")
    return AsyncSessionLocal()


def _print_report_row(r: dict[str, Any], totals: dict[str, int]) -> None:
    if r["blocked_urls"]:
        totals["blocked"] += 1
    if r["wayback_matched"]:
        totals["wayback_matched"] += 1
    if r["promoted"]:
        totals["promoted"] += 1

    name = r["name"][:29]
    source = r["source"][:19]
    blocked = r["blocked_urls"]
    wb_match = "YES" if r["wayback_matched"] else "no"
    promoted = "YES" if r["promoted"] else ("dry" if r["wayback_matched"] else "")
    print(f"{r['reporter_id']:<5} {name:<30} {source:<20} {blocked:<8} {wb_match:<9} {promoted:<6}")

    if r["wayback_matched"]:
        print(f"      -> {r['wayback_url']}")
        print(f"         matched: {r['matched_name']}  ts={r['wayback_timestamp']}")

    if r.get("error"):
        print(f"      -- {r['error']}")


def _print_results(results: list[Any], apply: bool, total: int) -> None:
    print("=" * 80)
    print(f"{'ID':<5} {'Reporter':<30} {'Source':<20} {'Blocked':<8} {'WB Match':<9} {'Promo':<6}")
    print("-" * 80)

    totals: dict[str, int] = {"blocked": 0, "wayback_matched": 0, "promoted": 0}
    for r in results:
        if isinstance(r, BaseException):
            print(f"ERROR: {r}")
            continue
        _print_report_row(r, totals)

    print("-" * 80)
    print(f"Total reporters:        {total}")
    print(f"With blocked pages:     {totals['blocked']}")
    print(f"Wayback matched:        {totals['wayback_matched']}")
    if apply:
        print(f"Promoted to verified:   {totals['promoted']}")
    else:
        print(
            f"Promoted (would-be):    {totals['wayback_matched']} (dry run, use --apply to write)"
        )
    print("=" * 80)


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        reporters = await _get_likely_reporters(
            session,
            source_filter=args.source,
            limit=args.limit,
        )
    finally:
        await session.close()

    if not reporters:
        print("No likely-tier reporters found.")
        return 0

    total = len(reporters)
    print(f"Processing {total} likely-tier reporters (apply={args.apply})")
    print()

    sem = asyncio.Semaphore(args.concurrency)

    async def _process_one(info: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            session = await _get_session()
            try:
                async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                    return await _process_reporter(
                        session, client, info, args.apply, mock=args.mock_cdx
                    )
            finally:
                await session.close()

    results = await asyncio.gather(
        *[_process_one(info) for info in reporters],
        return_exceptions=True,
    )

    _print_results(results, args.apply, total)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify reporter author pages via Wayback Machine cached snapshots."
    )
    parser.add_argument("--source", help="Filter by source name (substring match)")
    parser.add_argument("--limit", type=int, help="Max reporters to process")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of reporters to process in parallel (default: 4)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write results to the database (default: dry-run)",
    )
    parser.add_argument(
        "--mock-cdx",
        action="store_true",
        dest="mock_cdx",
        help="Use simulated CDX responses for testing (avoids rate limits)",
    )
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
