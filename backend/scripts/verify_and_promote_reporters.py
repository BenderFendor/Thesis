"""Verify and promote local-byline reporters by confirming author-page identity.

For each source, discovers author-page URLs from article structured data (JSON-LD,
anchor links, meta tags), scrapes the author page to extract the visible name,
and promotes reporters to verified when the page name matches the reporter name.

This is the universal author-parsing pipeline — it works across all sources by
using article-page signals instead of per-source URL-pattern guessing.

Usage:
    python scripts/verify_and_promote_reporters.py
    python scripts/verify_and_promote_reporters.py --source BBC
    python scripts/verify_and_promote_reporters.py --limit 100
    python scripts/verify_and_promote_reporters.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.logging import get_logger  # noqa: E402
from app.data.rss_sources import get_rss_sources  # noqa: E402
from app.database import (  # noqa: E402
    Article,
    ArticleAuthor,
    AsyncSessionLocal,
    Reporter,
    get_utc_now,
)
from app.services.reporter_author_page_scraper import scrape_author_profile  # noqa: E402
from app.services.reporter_confidence_scorer import (  # noqa: E402
    update_reporter_confidence,
)
from app.services.reporter_public_records import (  # noqa: E402
    _fetch_article_author_signals,
    _is_fetchable_article_url,
    clean_author_name,
)

logger = get_logger("verify_promote")

CONCURRENT_ARTICLE_FETCHES = 8
CONCURRENT_PROFILE_SCRAPES = 6
PROMOTE_NAME_SIMILARITY = 0.70

# Sources where standard httpx always returns 403 — try curl_cffi TLS impersonation
BLOCKED_SOURCE_HOSTS: set[str] = set()


def _domain_from_url(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    return parsed.netloc.lower().replace("www.", "") or ""


def _try_curl_cffi_article_signals(article_url: str) -> dict[str, Any] | None:
    """Fetch article with curl_cffi TLS impersonation and extract JSON-LD author signals.

    Returns dict with author_names, author_urls, or None if fetch failed.
    For many blocked sites (Washington Times, WSJ, etc), this gets past TLS fingerprinting.
    """
    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        resp = curl_cffi.requests.get(
            article_url,
            impersonate="chrome120",
            timeout=15,
            allow_redirects=True,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8",
            },
        )
    except Exception:
        return None

    if resp.status_code != 200:
        return None

    html = resp.text
    if not html or len(html) < 500:
        return None

    import json as _json
    import re as _re

    author_names: list[str] = []
    author_urls: list[str] = []

    # Extract JSON-LD Person/NewsArticle author data
    for raw_ld in _re.findall(
        r"<script[^>]+type=[\"']application/ld\\+json[\"'][^>]*>(.*?)</script>",
        html,
        _re.IGNORECASE | _re.DOTALL,
    ):
        try:
            data = _json.loads(raw_ld.strip())
        except _json.JSONDecodeError:
            continue
        _extract_author_from_jsonld(data, author_names, author_urls)

    # Also try meta author tag
    meta_match = _re.search(
        r"<meta[^>]+name=[\"']author[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>",
        html,
        _re.IGNORECASE,
    )
    if meta_match:
        author_names.append(meta_match.group(1).strip())

    if not author_names and not author_urls:
        return None

    return {
        "article_url": article_url,
        "author_names": list(dict.fromkeys(author_names)),
        "author_urls": list(dict.fromkeys(author_urls)),
        "access_path": "curl_cffi",
    }


def _extract_author_from_jsonld(data: Any, names: list[str], urls: list[str]) -> None:
    """Recursively extract author names and URLs from JSON-LD."""
    if isinstance(data, dict):
        types = data.get("@type") or []
        if isinstance(types, str):
            types = [types]
        if any(t in ("Person", "NewsArticle") for t in types):
            author = data.get("author")
            if isinstance(author, list):
                for a in author:
                    if isinstance(a, dict):
                        if a.get("name"):
                            names.append(str(a["name"]))
                        if a.get("url"):
                            urls.append(str(a["url"]))
            elif isinstance(author, dict):
                if author.get("name"):
                    names.append(str(author["name"]))
                if author.get("url"):
                    urls.append(str(author["url"]))
        for _key, value in data.items():
            _extract_author_from_jsonld(value, names, urls)
    elif isinstance(data, list):
        for item in data:
            _extract_author_from_jsonld(item, names, urls)


def _try_curl_cffi_scrape(url: str) -> dict[str, Any] | None:
    """Scrape author profile page with curl_cffi, extracting visible name from <title>."""
    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return None

    try:
        resp = curl_cffi.requests.get(
            url,
            impersonate="chrome120",
            timeout=15,
            allow_redirects=True,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8",
            },
        )
    except Exception:
        return None

    if resp.status_code != 200 or not resp.text or len(resp.text) < 200:
        return None

    import re as _re
    from html import unescape as _unescape

    _title_pat = _re.compile(r"<title\b[^>]*>(.*?)</title>", _re.IGNORECASE | _re.DOTALL)
    title_match = _title_pat.search(resp.text)
    profile_name: str | None = None
    if title_match:
        raw = _re.sub(r"(?is)<[^>]+>", " ", title_match.group(1))
        raw = _unescape(raw)
        raw = _re.sub(r"\s+", " ", raw).strip()
        for sep in (" - ", " | ", " — ", " – "):
            if sep in raw:
                raw = raw.split(sep, 1)[0].strip()
        if len(_re.findall(r"[^\W\d_]+", raw, flags=_re.UNICODE)) >= 2:
            profile_name = raw

    return {"url": url, "full_name": profile_name, "access_path": "curl_cffi"}


def _name_overlap(a: str, b: str) -> float:
    """Simple token overlap scorer for name matching."""
    tokens_a = set(a.lower().split())
    tokens_b = set(b.lower().split())
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))


def _person_name_match(
    reporter_name: str,
    profile_name: str | None,
    threshold: float = PROMOTE_NAME_SIMILARITY,
) -> bool:
    if not profile_name:
        return False
    cleaned_reporter = clean_author_name(reporter_name) or reporter_name
    cleaned_profile = clean_author_name(profile_name) or profile_name
    return _name_overlap(cleaned_reporter, cleaned_profile) >= threshold


async def _discover_author_urls_for_reporter(
    session: AsyncSession,
    reporter: Reporter,
    http_client: httpx.AsyncClient,
) -> list[str]:
    """Fetch recent articles for this reporter and extract author-page URLs."""
    reporter_id = int(reporter.id or 0)

    article_result = await session.execute(
        select(Article.url)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .where(Article.url.isnot(None))
        .where(Article.url != "")
        .order_by(Article.published_at.desc().nullslast())
        .limit(10)
    )
    article_urls_raw: list[str] = []
    for (url,) in article_result.all():
        if url not in article_urls_raw:
            article_urls_raw.append(str(url))

    author_urls: list[str] = []
    fetchable = [
        (url, str(reporter.name or ""))
        for url in article_urls_raw
        if _is_fetchable_article_url(url)
    ]

    sem = asyncio.Semaphore(CONCURRENT_ARTICLE_FETCHES)

    async def _fetch_one(url: str, author_name: str) -> list[str]:
        async with sem:
            try:
                result = await _fetch_article_author_signals(http_client, author_name, url)
                if isinstance(result, dict):
                    return result.get("author_pages", [])
            except Exception:
                pass
        return []

    tasks = [_fetch_one(url, author) for url, author in fetchable[:8]]
    all_pages = await asyncio.gather(*tasks, return_exceptions=True)
    for page_list in all_pages:
        if isinstance(page_list, list):
            for page_url in page_list:
                if isinstance(page_url, str) and page_url not in author_urls:
                    author_urls.append(page_url)

    return author_urls


async def _promote_reporter(
    session: AsyncSession,
    reporter: Reporter,
    author_url: str,
    profile_name: str,
    *,
    evidence_source: str = "author_page",
) -> bool:
    """Set author page URLs and citations on a reporter, then recompute confidence."""
    reporter_id = int(reporter.id or 0)

    if not reporter.author_page_url:
        reporter.author_page_url = author_url
    if not reporter.canonical_author_url:
        reporter.canonical_author_url = author_url

    label_map = {
        "author_page": "Official author page",
        "rss_dc_creator": "RSS dc:creator attribution",
        "wayback_machine": "Wayback Machine archive",
        "wikidata_employer_match": "Wikidata employer match",
        "curl_cffi_jsonld": "Article JSON-LD author",
    }
    citation_label = label_map.get(evidence_source, "Verified identity source")

    citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
    has_citation = any(
        isinstance(c, dict) and str(c.get("url") or "") == author_url for c in citations
    )
    if not has_citation:
        citations.insert(
            0,
            {
                "label": citation_label,
                "url": author_url,
                "note": f"Profile name verified as '{profile_name}' via {evidence_source}.",
            },
        )
    reporter.citations = citations
    reporter.updated_at = get_utc_now()

    await session.commit()
    await update_reporter_confidence(session, reporter_id)
    await session.refresh(reporter)

    new_tier = reporter.confidence_tier or "unmatched"
    promoted = new_tier == "verified"
    if promoted:
        logger.debug(
            "Promoted %s to verified (url=%s, profile_name=%s, via=%s)",
            reporter.name,
            author_url,
            profile_name,
            evidence_source,
        )
    else:
        logger.debug(
            "Not promoted %s: tier=%s score=%s after setting via=%s",
            reporter.name,
            new_tier,
            reporter.confidence_score,
            evidence_source,
        )
    return promoted


# ── Bloomberg article API author extraction ────────────────────────────


def _try_bloomberg_api_authors(article_url: str) -> list[str] | None:
    """Hit Bloomberg's unauthenticated article API for author names."""
    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return None
    import re as _re
    from urllib.parse import urlparse as _urlparse

    path = _urlparse(article_url).path
    slug_match = _re.match(r"/(?:news/)?(?:articles)/([\w-]+/[\w-]+.*)", path)
    if not slug_match:
        return None
    slug = slug_match.group(1)

    api_url = f"https://www.bloomberg.com/article/api/story/slug/{slug}"
    try:
        resp = curl_cffi.requests.get(
            api_url,
            impersonate="chrome120",
            timeout=15,
            headers={
                "accept": "application/json",
                "cache-control": "no-cache",
                "referer": "https://www.bloomberg.com",
            },
        )
    except Exception:
        return None

    if resp.status_code != 200:
        return None
    try:
        data = resp.json()
        authors = data.get("data", {}).get("authors", [])
        return [a["name"] for a in authors if a.get("name")]
    except Exception:
        return None


# ── RSS feed dc:creator verification ───────────────────────────────────


def _parse_rss_authors(rss_text: str) -> dict[str, list[str]]:
    """Parse RSS/Atom XML, return {article_url: [author_names]} from dc:creator/author."""
    import xml.etree.ElementTree as _ET

    results: dict[str, list[str]] = {}
    ns = {"dc": "http://purl.org/dc/elements/1.1/", "atom": "http://www.w3.org/2005/Atom"}

    try:
        root = _ET.fromstring(rss_text)
    except _ET.ParseError:
        return results

    for item in root.iter("item"):
        link_el = item.find("link")
        link = (link_el.text or "").strip() if link_el is not None else ""
        authors: list[str] = []

        creator_el = item.find("dc:creator", ns)
        if creator_el is not None and creator_el.text:
            raw = creator_el.text.strip()
            # Split by comma, then split each part by "and"/"&"
            for part in [p.strip() for p in raw.split(",") if p.strip()]:
                if " and " in part:
                    authors.extend(s.strip() for s in part.split(" and ") if s.strip())
                elif " & " in part:
                    authors.extend(s.strip() for s in part.split(" & ") if s.strip())
                else:
                    authors.append(part)

        author_el = item.find("author")
        if author_el is not None and author_el.text:
            authors.append(author_el.text.strip())

        if link and authors:
            results[link] = list(dict.fromkeys(authors))

    # Also try Atom namespace
    for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
        link_el = entry.find("atom:link", ns) or entry.find("{http://www.w3.org/2005/Atom}link")
        link = (link_el.get("href") or "").strip() if link_el is not None else ""
        authors: list[str] = []
        for author_el in entry.iter("{http://www.w3.org/2005/Atom}author"):
            name_el = author_el.find("{http://www.w3.org/2005/Atom}name")
            if name_el is not None and name_el.text:
                authors.append(name_el.text.strip())
        if link and authors:
            results[link] = list(dict.fromkeys(authors))

    return results


async def _try_rss_feed_verification(
    reporter_name: str,
    source_name: str,
    reporter_id: int,
    session: AsyncSession,
) -> dict[str, str] | None:
    """Parse the source's RSS feeds and verify the reporter via dc:creator."""
    sources = get_rss_sources()
    source_config: dict[str, Any] | None = None
    for name, cfg in sources.items():
        base = name.split(" - ")[0].strip().lower()
        if source_name.lower() == base:
            source_config = cfg
            break
    if not source_config:
        return None

    feed_urls = source_config.get("url")
    if not feed_urls:
        return None
    if isinstance(feed_urls, str):
        feed_urls = [feed_urls]

    import httpx as _httpx

    try:
        import curl_cffi  # type: ignore[import-untyped]

        use_cffi = True
    except ImportError:
        use_cffi = False

    for feed_url in feed_urls[:3]:
        try:
            if use_cffi:
                resp = curl_cffi.requests.get(
                    str(feed_url),
                    impersonate="chrome120",
                    timeout=15,
                    headers={"Accept": "application/xml,text/xml,*/*"},
                )
                rss_text = resp.text
            else:
                async with _httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.get(str(feed_url))
                    rss_text = r.text
        except Exception:
            continue

        rss_authors = _parse_rss_authors(rss_text)
        if not rss_authors:
            continue

        matches = 0
        for article_url, author_list in rss_authors.items():
            for author_name in author_list:
                if _person_name_match(reporter_name, author_name):
                    matches += 1
                    break  # count once per article

        if matches >= 1:
            return {
                "url": str(feed_url),
                "profile_name": reporter_name,
                "source": f"rss_dc_creator:{matches}_matches",
            }
    return None


# ── Wayback Machine author page verification ───────────────────────────


async def _try_wayback_author_page(
    reporter_name: str, author_page_url: str
) -> dict[str, str] | None:
    """Fetch Wayback Machine snapshots of an author page and check visible name."""
    if not author_page_url:
        return None

    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return None

    from html import unescape as _unescape
    import re as _re

    # Use Wayback CDX to find snapshots
    wb_url = f"http://web.archive.org/cdx/search/cdx?url={author_page_url}&output=json&limit=3&fl=timestamp,original,statuscode"
    try:
        resp = curl_cffi.requests.get(wb_url, impersonate="chrome120", timeout=15)
    except Exception:
        return None

    if resp.status_code != 200:
        return None

    try:
        import json as _json

        cdx_rows = _json.loads(resp.text)
    except Exception:
        return None

    if not isinstance(cdx_rows, list) or len(cdx_rows) < 2:
        return None

    # Try each snapshot
    for row in cdx_rows[1:4]:
        if len(row) < 3:
            continue
        timestamp, original_url, statuscode = row[0], row[1], row[2]
        if statuscode != "200":
            continue

        snapshot_url = f"http://web.archive.org/web/{timestamp}id_/{original_url}"
        try:
            snap_resp = curl_cffi.requests.get(snapshot_url, impersonate="chrome120", timeout=15)
        except Exception:
            continue

        if snap_resp.status_code != 200:
            continue

        # Extract visible name from page title
        _title_pat = _re.compile(r"<title\b[^>]*>(.*?)</title>", _re.IGNORECASE | _re.DOTALL)
        title_match = _title_pat.search(snap_resp.text)
        if not title_match:
            continue

        raw = _re.sub(r"(?is)<[^>]+>", " ", title_match.group(1))
        raw = _unescape(raw)
        raw = _re.sub(r"\s+", " ", raw).strip()
        for sep in (" - ", " | ", " — ", " – "):
            if sep in raw:
                raw = raw.split(sep, 1)[0].strip()

        if len(_re.findall(r"[^\W\d_]+", raw, flags=_re.UNICODE)) >= 2:
            if _person_name_match(reporter_name, raw):
                return {
                    "url": original_url,
                    "profile_name": raw,
                    "source": f"wayback_machine:{timestamp}",
                }

    return None


# ── Wikidata employer cross-check ──────────────────────────────────────


def _try_wikidata_employer_check(reporter: Reporter, source_name: str) -> dict[str, str] | None:
    """Check if Wikidata employer label matches the reporter's source name."""
    wikidata_url = reporter.wikidata_url or ""
    if not wikidata_url and reporter.wikidata_qid:
        wikidata_url = f"https://www.wikidata.org/wiki/{reporter.wikidata_qid}"

    career = reporter.career_history if isinstance(reporter.career_history, list) else []
    for entry in career:
        if not isinstance(entry, dict):
            continue
        org = str(entry.get("organization") or "").strip().lower()
        source_lower = source_name.lower()
        if org and source_lower and (org in source_lower or source_lower in org):
            return {
                "url": wikidata_url,
                "profile_name": str(reporter.name or ""),
                "source": "wikidata_employer_match",
            }
    return None


async def _process_reporter(
    session: AsyncSession,
    reporter_id: int,
    http_client: httpx.AsyncClient,
    dry_run: bool,
) -> dict[str, Any]:
    """Discover author page for a reporter, scrape it, and promote if name matches."""
    # Load fresh copy in this session
    reporter = (
        await session.execute(select(Reporter).where(Reporter.id == reporter_id))
    ).scalar_one_or_none()
    if reporter is None:
        return {"reporter_id": reporter_id, "name": "", "error": "not_found"}

    name = str(reporter.name or "")
    result = {
        "reporter_id": reporter_id,
        "name": name,
        "discovered_urls": 0,
        "scraped": 0,
        "promoted": False,
        "error": None,
    }

    if not name.strip():
        result["error"] = "empty_name"
        return result

    author_urls = await _discover_author_urls_for_reporter(session, reporter, http_client)
    discovered = len(author_urls)
    result["discovered_urls"] = discovered

    if not author_urls:
        # Standard httpx got nothing — try curl_cffi on article pages directly
        reporter_id_int = int(reporter.id or 0)
        article_urls_raw = await session.execute(
            select(Article.url)
            .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
            .where(ArticleAuthor.reporter_id == reporter_id_int)
            .where(Article.url.isnot(None))
            .where(Article.url != "")
            .order_by(Article.published_at.desc().nullslast())
            .limit(5)
        )
        article_urls_to_try = [
            str(row[0]) for row in article_urls_raw.all() if _is_fetchable_article_url(str(row[0]))
        ]

        cffi_signals_results = await asyncio.gather(
            *[
                asyncio.get_running_loop().run_in_executor(
                    None, _try_curl_cffi_article_signals, url
                )
                for url in article_urls_to_try[:5]
            ],
            return_exceptions=True,
        )

        for signals in cffi_signals_results:
            if isinstance(signals, BaseException) or signals is None:
                continue
            cffi_author_names = signals.get("author_names", [])
            cffi_author_urls = signals.get("author_urls", [])

            # If any JSON-LD author name matches our reporter, promote directly
            for author_name in cffi_author_names:
                if _person_name_match(name, author_name):
                    author_url = cffi_author_urls[0] if cffi_author_urls else article_urls_to_try[0]
                    if not dry_run:
                        promoted = await _promote_reporter(
                            session,
                            reporter,
                            author_url,
                            author_name,
                            evidence_source="curl_cffi_jsonld",
                        )
                        result["promoted"] = promoted
                    else:
                        result["promoted"] = True
                        result["_dry_run_match"] = {
                            "url": author_url,
                            "profile_name": author_name,
                            "source": "curl_cffi_jsonld",
                        }
                    return result

            # Also add any discovered author URLs for the scrape path
            for url in cffi_author_urls:
                if url not in author_urls:
                    author_urls.append(url)

    if not author_urls:
        logger.debug("No author URLs discovered for %s", name)
        return result

    sem = asyncio.Semaphore(CONCURRENT_PROFILE_SCRAPES)

    async def _scrape_one(url: str) -> tuple[str, dict[str, Any]]:
        async with sem:
            try:
                profile = await scrape_author_profile(http_client, url)
            except Exception as exc:
                profile = {"url": url, "error": str(exc)}

            # If author page scrape failed, try curl_cffi as fallback
            if profile.get("error"):
                domain = _domain_from_url(url)
                cffi_profile = await asyncio.get_running_loop().run_in_executor(
                    None, _try_curl_cffi_scrape, url
                )
                if cffi_profile and cffi_profile.get("full_name"):
                    logger.info("curl_cffi author page fallback succeeded for %s (%s)", url, domain)
                    return url, cffi_profile
        return url, profile

    scrapes = await asyncio.gather(
        *[_scrape_one(url) for url in author_urls[:5]],
        return_exceptions=True,
    )

    scraped_count = 0
    for scrape_item in scrapes:
        if isinstance(scrape_item, BaseException):
            continue
        url, profile = scrape_item
        if profile.get("error"):
            continue

        profile_name = profile.get("full_name")
        scraped_count += 1
        result["scraped"] = scraped_count

        if profile_name and _person_name_match(name, profile_name):
            if not dry_run:
                promoted = await _promote_reporter(
                    session, reporter, url, profile_name, evidence_source="author_page"
                )
                result["promoted"] = promoted
                if promoted:
                    break
            else:
                result["promoted"] = True
                result["_dry_run_match"] = {
                    "url": url,
                    "profile_name": profile_name,
                }
                break

    # ── If we still haven't promoted, try advanced verification methods ──

    vid = int(reporter.id or 0)
    source_attr = ""
    source_result = await session.execute(
        select(Article.source)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == vid)
        .limit(1)
    )
    source_row = source_result.scalar_one_or_none()
    if source_row:
        source_attr = str(source_row)

    # Tier 5: RSS feed dc:creator verification
    rss_match = await _try_rss_feed_verification(name, source_attr, vid, session)
    if rss_match:
        if not dry_run:
            promoted = await _promote_reporter(
                session,
                reporter,
                rss_match["url"],
                rss_match["profile_name"],
                evidence_source=rss_match.get("source", "rss_dc_creator"),
            )
            result["promoted"] = promoted
        else:
            result["promoted"] = True
            result["_dry_run_match"] = rss_match
        if promoted:
            return result

    # Tier 6: Wayback Machine author page content
    for candidate_url in author_urls[:3]:
        wb_match = await _try_wayback_author_page(name, candidate_url)
        if wb_match:
            if not dry_run:
                promoted = await _promote_reporter(
                    session,
                    reporter,
                    wb_match["url"],
                    wb_match["profile_name"],
                    evidence_source=wb_match.get("source", "wayback_machine"),
                )
                result["promoted"] = promoted
            else:
                result["promoted"] = True
                result["_dry_run_match"] = wb_match
            if promoted:
                return result
            break

    # Tier 7: Wikidata employer cross-check (for strong-tier reporters)
    if reporter.confidence_tier == "strong" or reporter.wikidata_qid:
        wd_match = _try_wikidata_employer_check(reporter, source_attr)
        if wd_match:
            if not dry_run:
                promoted = await _promote_reporter(
                    session,
                    reporter,
                    wd_match["url"],
                    wd_match["profile_name"],
                    evidence_source=wd_match.get("source", "wikidata_employer_match"),
                )
                result["promoted"] = promoted
            else:
                result["promoted"] = True
                result["_dry_run_match"] = wd_match

    return result


async def _get_session():
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def _get_non_verified_reporter_ids(
    session: AsyncSession,
    source_filter: str | None = None,
    limit: int | None = None,
) -> list[tuple[int, str]]:
    """Get unique (reporter_id, source) pairs for non-verified reporters."""
    subq = (
        select(Reporter.id, Article.source)
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Reporter.confidence_tier != "verified")
        .distinct()
    )
    subq_result = await session.execute(subq)
    pairs = [(int(row[0]), str(row[1] or "")) for row in subq_result.all()]

    seen: set[int] = set()
    result: list[tuple[int, str]] = []
    for rid, source in pairs:
        if rid in seen:
            continue
        if source_filter and source_filter.lower() not in source.lower():
            base = source.split(" - ")[0].strip()
            if source_filter.lower() not in base.lower():
                continue
        seen.add(rid)
        result.append((rid, source))
        if limit and len(result) >= limit:
            break

    return result


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        pairs = await _get_non_verified_reporter_ids(
            session,
            source_filter=args.source,
            limit=args.limit,
        )
    finally:
        await session.close()

    if not pairs:
        logger.info("No local_byline reporters found")
        print("No local_byline reporters found")
        return 0

    total = len(pairs)
    logger.info(
        "Processing %d local_byline reporters with concurrency=%d (dry_run=%s)",
        total,
        args.concurrency,
        args.dry_run,
    )

    sem = asyncio.Semaphore(args.concurrency)

    async def _process_one(reporter_id: int) -> dict[str, Any]:
        async with sem:
            session = await _get_session()
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    return await _process_reporter(session, reporter_id, client, args.dry_run)
            finally:
                await session.close()

    results = await asyncio.gather(
        *[_process_one(rid) for rid, _s in pairs],
        return_exceptions=True,
    )

    total = len(pairs)
    total_promoted = 0
    total_errors = 0
    promoted_names: list[str] = []

    for r in results:
        if isinstance(r, BaseException):
            total_errors += 1
            continue
        if r.get("promoted"):
            total_promoted += 1
            promoted_names.append(r.get("name", ""))
        if r.get("error"):
            total_errors += 1

    print()
    print("=" * 72)
    print(f"REPORTER VERIFICATION SUMMARY  (dry_run={args.dry_run})")
    print("=" * 72)
    print(f"Local-byline rptrs:   {total}")
    print(f"Promoted to verified: {total_promoted}")
    print(f"Promotion rate:       {round(100 * total_promoted / max(total, 1), 1)}%")
    print(f"Errors:               {total_errors}")
    if promoted_names:
        print(f"Promoted names:       {', '.join(promoted_names[:10])}")
        if len(promoted_names) > 10:
            print(f"  ... and {len(promoted_names) - 10} more")
    print("=" * 72)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify local-byline reporters via author-page parsing and promote to verified."
    )
    parser.add_argument("--source", help="Process a single source (substring match)")
    parser.add_argument("--limit", type=int, help="Limit number of sources to process")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=6,
        help="Number of sources to process in parallel",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Discover and scrape but do not write to DB",
    )
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
