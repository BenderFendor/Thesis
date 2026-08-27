"""Verify and promote local-byline reporters from publisher identity evidence."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import xml.etree.ElementTree as ET
from copy import deepcopy
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

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
    is_author_profile_url,
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
BLOCKED_SOURCE_HOSTS: set[str] = set()
_ATOM_NS = "http://www.w3.org/2005/Atom"
_DC_NS = "http://purl.org/dc/elements/1.1/"


def _domain_from_url(url: str) -> str:
    return urlparse(url).netloc.lower().replace("www.", "") or ""


def _curl_cffi_module() -> Any | None:
    try:
        import curl_cffi  # type: ignore[import-untyped]
    except ImportError:
        return None
    return curl_cffi


def _curl_get(url: str, *, accept: str = "text/html,application/xhtml+xml,*/*") -> Any | None:
    curl_cffi = _curl_cffi_module()
    if curl_cffi is None:
        return None
    try:
        return curl_cffi.requests.get(
            url,
            impersonate="chrome120",
            timeout=15,
            allow_redirects=True,
            headers={"Accept": accept, "Accept-Language": "en-US,en;q=0.8"},
        )
    except Exception:
        return None


def _jsonld_types(data: dict[str, Any]) -> list[str]:
    raw = data.get("@type") or []
    return [raw] if isinstance(raw, str) else [str(item) for item in raw if isinstance(item, str)]


def _append_author(author: object, names: list[str], urls: list[str]) -> None:
    if not isinstance(author, dict):
        return
    name = author.get("name")
    url = author.get("url")
    if name:
        names.append(str(name))
    if url:
        urls.append(str(url))


def _extract_author_value(author: object, names: list[str], urls: list[str]) -> None:
    authors = author if isinstance(author, list) else [author]
    for item in authors:
        _append_author(item, names, urls)


def _extract_author_from_jsonld(data: Any, names: list[str], urls: list[str]) -> None:
    """Recursively extract author names and URLs from JSON-LD."""
    if isinstance(data, list):
        for item in data:
            _extract_author_from_jsonld(item, names, urls)
        return
    if not isinstance(data, dict):
        return
    if {"Person", "NewsArticle"}.intersection(_jsonld_types(data)):
        _extract_author_value(data.get("author"), names, urls)
    for value in data.values():
        _extract_author_from_jsonld(value, names, urls)


def _jsonld_author_signals(html: str) -> tuple[list[str], list[str]]:
    names: list[str] = []
    urls: list[str] = []
    pattern = r"<script[^>]+type=[\"']application/ld\\+json[\"'][^>]*>(.*?)</script>"
    for raw in re.findall(pattern, html, re.IGNORECASE | re.DOTALL):
        try:
            payload = json.loads(raw.strip())
        except json.JSONDecodeError:
            continue
        _extract_author_from_jsonld(payload, names, urls)
    return names, urls


def _meta_author_name(html: str) -> str | None:
    match = re.search(
        r"<meta[^>]+name=[\"']author[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>",
        html,
        re.IGNORECASE,
    )
    return match.group(1).strip() if match else None


def _try_curl_cffi_article_signals(article_url: str) -> dict[str, Any] | None:
    """Fetch an article with browser TLS impersonation and extract author signals."""
    response = _curl_get(article_url)
    if response is None or response.status_code != 200:
        return None
    html = response.text
    if not html or len(html) < 500:
        return None

    names, urls = _jsonld_author_signals(html)
    meta_author = _meta_author_name(html)
    if meta_author:
        names.append(meta_author)
    if not names and not urls:
        return None
    return {
        "article_url": article_url,
        "author_names": list(dict.fromkeys(names)),
        "author_urls": list(dict.fromkeys(urls)),
        "access_path": "curl_cffi",
    }


def _title_text(html: str) -> str | None:
    match = re.search(r"<title\b[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    raw = re.sub(r"(?is)<[^>]+>", " ", match.group(1))
    raw = re.sub(r"\s+", " ", unescape(raw)).strip()
    for separator in (" - ", " | ", " — ", " – "):
        if separator in raw:
            raw = raw.split(separator, 1)[0].strip()
    return raw


def _person_like_title(html: str) -> str | None:
    title = _title_text(html)
    if not title:
        return None
    return title if len(re.findall(r"[^\W\d_]+", title, flags=re.UNICODE)) >= 2 else None


def _try_curl_cffi_scrape(url: str) -> dict[str, Any] | None:
    """Scrape an author profile page with browser TLS impersonation."""
    response = _curl_get(url)
    if response is None or response.status_code != 200:
        return None
    if not response.text or len(response.text) < 200:
        return None
    return {"url": url, "full_name": _person_like_title(response.text), "access_path": "curl_cffi"}


def _name_overlap(a: str, b: str) -> float:
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


async def _recent_reporter_article_urls(
    session: AsyncSession, reporter_id: int, *, limit: int
) -> list[str]:
    result = await session.execute(
        select(Article.url)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .where(Article.url.isnot(None))
        .where(Article.url != "")
        .order_by(Article.published_at.desc().nullslast())
        .limit(limit)
    )
    return list(dict.fromkeys(str(url) for (url,) in result.all() if url))


async def _fetch_author_pages_one(
    semaphore: asyncio.Semaphore,
    client: httpx.AsyncClient,
    author_name: str,
    url: str,
) -> list[str]:
    async with semaphore:
        try:
            result = await _fetch_article_author_signals(client, author_name, url)
        except Exception:
            return []
    pages = result.get("author_pages", []) if isinstance(result, dict) else []
    return [page for page in pages if isinstance(page, str)]


async def _discover_author_urls_for_reporter(
    session: AsyncSession,
    reporter: Reporter,
    http_client: httpx.AsyncClient,
) -> list[str]:
    """Fetch recent articles and collect publisher author-page URLs."""
    article_urls = await _recent_reporter_article_urls(session, int(reporter.id or 0), limit=10)
    fetchable = [url for url in article_urls if _is_fetchable_article_url(url)][:8]
    semaphore = asyncio.Semaphore(CONCURRENT_ARTICLE_FETCHES)
    pages = await asyncio.gather(
        *(
            _fetch_author_pages_one(semaphore, http_client, str(reporter.name or ""), url)
            for url in fetchable
        ),
        return_exceptions=True,
    )
    flattened = [page for group in pages if isinstance(group, list) for page in group]
    return list(dict.fromkeys(flattened))


def _citation_label(evidence_source: str) -> str:
    labels = {
        "author_page": "Official author page",
        "rss_dc_creator": "RSS dc:creator attribution",
        "wayback_machine": "Wayback Machine archive",
        "wikidata_employer_match": "Wikidata employer match",
        "curl_cffi_jsonld": "Article JSON-LD author",
    }
    return labels.get(evidence_source, "Verified identity source")


def _ensure_profile_citation(
    reporter: Reporter, author_url: str, profile_name: str, evidence_source: str
) -> None:
    citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
    if any(isinstance(item, dict) and str(item.get("url") or "") == author_url for item in citations):
        return
    citations.insert(
        0,
        {
            "label": _citation_label(evidence_source),
            "url": author_url,
            "note": f"Profile name verified as '{profile_name}' via {evidence_source}.",
        },
    )
    reporter.citations = citations


async def _refresh_confidence(session: AsyncSession, reporter: Reporter) -> bool:
    await session.commit()
    await update_reporter_confidence(session, int(reporter.id or 0))
    await session.refresh(reporter)
    return reporter.confidence_tier == "verified"


async def _promote_reporter(
    session: AsyncSession,
    reporter: Reporter,
    author_url: str,
    profile_name: str,
    *,
    evidence_source: str = "author_page",
) -> bool:
    """Persist verified author-page evidence and recompute reporter confidence."""
    if not is_author_profile_url(author_url):
        return await _record_supporting_evidence(
            session,
            reporter,
            author_url,
            evidence_source=evidence_source,
            label="Article JSON-LD author",
            note=f"Article metadata names '{profile_name}' via {evidence_source}.",
        )
    reporter.author_page_url = reporter.author_page_url or author_url
    reporter.canonical_author_url = reporter.canonical_author_url or author_url
    _ensure_profile_citation(reporter, author_url, profile_name, evidence_source)
    reporter.updated_at = get_utc_now()
    promoted = await _refresh_confidence(session, reporter)
    logger.debug(
        "%s %s after author evidence (url=%s, via=%s)",
        "Promoted" if promoted else "Retained tier for",
        reporter.name,
        author_url,
        evidence_source,
    )
    return promoted


async def _record_supporting_evidence(
    session: AsyncSession,
    reporter: Reporter,
    evidence_url: str,
    *,
    evidence_source: str,
    label: str,
    note: str,
) -> bool:
    """Record non-profile identity evidence and recompute confidence."""
    citations = deepcopy(reporter.citations) if isinstance(reporter.citations, list) else []
    duplicate = any(
        isinstance(item, dict)
        and str(item.get("url") or "") == evidence_url
        and str(item.get("source_type") or "") == evidence_source
        for item in citations
    )
    if not duplicate:
        citations.append(
            {"label": label, "url": evidence_url, "source_type": evidence_source, "note": note}
        )
    reporter.citations = citations
    reporter.research_sources = sorted(set((reporter.research_sources or []) + [evidence_source]))
    reporter.updated_at = get_utc_now()
    return await _refresh_confidence(session, reporter)


def _try_bloomberg_api_authors(article_url: str) -> list[str] | None:
    """Hit Bloomberg's unauthenticated article API for author names."""
    curl_cffi = _curl_cffi_module()
    if curl_cffi is None:
        return None
    match = re.match(r"/(?:news/)?(?:articles)/([\w-]+/[\w-]+.*)", urlparse(article_url).path)
    if not match:
        return None
    api_url = f"https://www.bloomberg.com/article/api/story/slug/{match.group(1)}"
    try:
        response = curl_cffi.requests.get(
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
    if response.status_code != 200:
        return None
    with suppress_exception():
        authors = response.json().get("data", {}).get("authors", [])
        return [author["name"] for author in authors if author.get("name")]
    return None


class suppress_exception:
    """Tiny context manager used where third-party response parsing is best-effort."""

    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        return exc_type is not None


def _split_creator(value: str) -> list[str]:
    authors: list[str] = []
    for part in (piece.strip() for piece in value.split(",")):
        if not part:
            continue
        separator = " and " if " and " in part else " & " if " & " in part else None
        authors.extend(piece.strip() for piece in part.split(separator) if piece.strip()) if separator else authors.append(part)
    return authors


def _rss_item_record(item: ET.Element) -> tuple[str, list[str]] | None:
    link_element = item.find("link")
    link = (link_element.text or "").strip() if link_element is not None else ""
    creator = item.find(f"{{{_DC_NS}}}creator")
    author = item.find("author")
    authors = _split_creator(creator.text.strip()) if creator is not None and creator.text else []
    if author is not None and author.text:
        authors.append(author.text.strip())
    return (link, list(dict.fromkeys(authors))) if link and authors else None


def _atom_entry_record(entry: ET.Element) -> tuple[str, list[str]] | None:
    link_element = entry.find(f"{{{_ATOM_NS}}}link")
    link = (link_element.get("href") or "").strip() if link_element is not None else ""
    authors = []
    for author in entry.iter(f"{{{_ATOM_NS}}}author"):
        name = author.find(f"{{{_ATOM_NS}}}name")
        if name is not None and name.text:
            authors.append(name.text.strip())
    return (link, list(dict.fromkeys(authors))) if link and authors else None


def _parse_rss_authors(rss_text: str) -> dict[str, list[str]]:
    """Return article URLs mapped to RSS/Atom author names."""
    try:
        root = ET.fromstring(rss_text)
    except ET.ParseError:
        return {}
    records = [record for item in root.iter("item") if (record := _rss_item_record(item))]
    records.extend(
        record
        for entry in root.iter(f"{{{_ATOM_NS}}}entry")
        if (record := _atom_entry_record(entry))
    )
    return dict(records)


def _source_feed_urls(source_name: str) -> list[str]:
    normalized = source_name.lower()
    for name, config in get_rss_sources().items():
        if normalized != name.split(" - ")[0].strip().lower():
            continue
        raw = config.get("url")
        if isinstance(raw, str):
            return [raw]
        return [str(url) for url in raw or []]
    return []


async def _fetch_feed_text(feed_url: str) -> str | None:
    curl_cffi = _curl_cffi_module()
    try:
        if curl_cffi is not None:
            response = curl_cffi.requests.get(
                feed_url,
                impersonate="chrome120",
                timeout=15,
                headers={"Accept": "application/xml,text/xml,*/*"},
            )
            return response.text
        async with httpx.AsyncClient(timeout=15.0) as client:
            return (await client.get(feed_url)).text
    except Exception:
        return None


def _rss_match_count(reporter_name: str, rss_authors: dict[str, list[str]]) -> int:
    return sum(
        any(_person_name_match(reporter_name, author) for author in authors)
        for authors in rss_authors.values()
    )


async def _try_rss_feed_verification(
    reporter_name: str,
    source_name: str,
    reporter_id: int,
    session: AsyncSession,
) -> dict[str, str] | None:
    """Verify a reporter against dc:creator/Atom author fields in source feeds."""
    del reporter_id, session
    for feed_url in _source_feed_urls(source_name)[:3]:
        rss_text = await _fetch_feed_text(feed_url)
        authors = _parse_rss_authors(rss_text) if rss_text else {}
        matches = _rss_match_count(reporter_name, authors)
        if matches:
            return {
                "url": feed_url,
                "profile_name": reporter_name,
                "source": f"rss_dc_creator:{matches}_matches",
            }
    return None


def _wayback_rows(author_page_url: str) -> list[list[str]]:
    url = (
        "http://web.archive.org/cdx/search/cdx?"
        f"url={author_page_url}&output=json&limit=3&fl=timestamp,original,statuscode"
    )
    response = _curl_get(url)
    if response is None or response.status_code != 200:
        return []
    try:
        payload = json.loads(response.text)
    except Exception:
        return []
    return payload[1:4] if isinstance(payload, list) and len(payload) >= 2 else []


def _wayback_snapshot_name(row: list[str]) -> tuple[str, str, str] | None:
    if len(row) < 3 or row[2] != "200":
        return None
    timestamp, original_url = row[0], row[1]
    snapshot_url = f"http://web.archive.org/web/{timestamp}id_/{original_url}"
    response = _curl_get(snapshot_url)
    if response is None or response.status_code != 200:
        return None
    name = _person_like_title(response.text)
    return (timestamp, original_url, name) if name else None


async def _try_wayback_author_page(
    reporter_name: str, author_page_url: str
) -> dict[str, str] | None:
    """Check archived author pages for a visible matching person name."""
    if not author_page_url or _curl_cffi_module() is None:
        return None
    for row in _wayback_rows(author_page_url):
        snapshot = _wayback_snapshot_name(row)
        if snapshot is None:
            continue
        timestamp, original_url, profile_name = snapshot
        if _person_name_match(reporter_name, profile_name):
            return {
                "url": original_url,
                "profile_name": profile_name,
                "source": f"wayback_machine:{timestamp}",
            }
    return None


def _career_organization_matches(reporter: Reporter, source_name: str) -> bool:
    source = source_name.lower()
    career = reporter.career_history if isinstance(reporter.career_history, list) else []
    organizations = [
        str(entry.get("organization") or "").strip().lower()
        for entry in career
        if isinstance(entry, dict)
    ]
    return any(org and source and (org in source or source in org) for org in organizations)


def _try_wikidata_employer_check(reporter: Reporter, source_name: str) -> dict[str, str] | None:
    """Check whether profile career evidence names the reporter's current source."""
    if not _career_organization_matches(reporter, source_name):
        return None
    wikidata_url = reporter.wikidata_url or ""
    if not wikidata_url and reporter.wikidata_qid:
        wikidata_url = f"https://www.wikidata.org/wiki/{reporter.wikidata_qid}"
    return {
        "url": wikidata_url,
        "profile_name": str(reporter.name or ""),
        "source": "wikidata_employer_match",
    }


def _verification_result(reporter_id: int, name: str) -> dict[str, Any]:
    return {
        "reporter_id": reporter_id,
        "name": name,
        "discovered_urls": 0,
        "scraped": 0,
        "promoted": False,
        "error": None,
    }


async def _load_reporter(session: AsyncSession, reporter_id: int) -> Reporter | None:
    return (
        await session.execute(select(Reporter).where(Reporter.id == reporter_id))
    ).scalar_one_or_none()


async def _curl_article_signal_results(
    session: AsyncSession, reporter: Reporter
) -> tuple[list[str], list[dict[str, Any]]]:
    article_urls = await _recent_reporter_article_urls(session, int(reporter.id or 0), limit=5)
    fetchable = [url for url in article_urls if _is_fetchable_article_url(url)][:5]
    results = await asyncio.gather(
        *(
            asyncio.get_running_loop().run_in_executor(None, _try_curl_cffi_article_signals, url)
            for url in fetchable
        ),
        return_exceptions=True,
    )
    signals = [item for item in results if isinstance(item, dict)]
    return fetchable, signals


async def _apply_direct_cffi_match(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    article_urls: list[str],
    signals: dict[str, Any],
    dry_run: bool,
) -> bool:
    matching_name = next(
        (
            author
            for author in signals.get("author_names", [])
            if _person_name_match(str(reporter.name or ""), str(author))
        ),
        None,
    )
    if matching_name is None:
        return False
    author_urls = [str(url) for url in signals.get("author_urls", []) if url]
    evidence_url = author_urls[0] if author_urls else article_urls[0]
    if dry_run:
        result["promoted"] = bool(author_urls)
        result["evidence_recorded"] = not author_urls
        result["_dry_run_match"] = {
            "url": evidence_url,
            "profile_name": matching_name,
            "source": "curl_cffi_jsonld",
        }
        return True
    if author_urls:
        result["promoted"] = await _promote_reporter(
            session,
            reporter,
            evidence_url,
            str(matching_name),
            evidence_source="curl_cffi_jsonld",
        )
    else:
        result["promoted"] = await _record_supporting_evidence(
            session,
            reporter,
            evidence_url,
            evidence_source="article_jsonld_author",
            label="Article JSON-LD author",
            note=f"Article JSON-LD names '{matching_name}'.",
        )
        result["evidence_recorded"] = True
    return True


async def _augment_author_urls_from_cffi(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    author_urls: list[str],
    dry_run: bool,
) -> bool:
    article_urls, signal_results = await _curl_article_signal_results(session, reporter)
    for signals in signal_results:
        if await _apply_direct_cffi_match(
            session, reporter, result, article_urls, signals, dry_run
        ):
            return True
        author_urls.extend(str(url) for url in signals.get("author_urls", []) if url)
    author_urls[:] = list(dict.fromkeys(author_urls))
    return False


async def _scrape_profile(
    semaphore: asyncio.Semaphore,
    client: httpx.AsyncClient,
    url: str,
) -> tuple[str, dict[str, Any]]:
    async with semaphore:
        try:
            profile = await scrape_author_profile(client, url)
        except Exception as exc:
            profile = {"url": url, "error": str(exc)}
    if not profile.get("error"):
        return url, profile
    fallback = await asyncio.get_running_loop().run_in_executor(None, _try_curl_cffi_scrape, url)
    if fallback and fallback.get("full_name"):
        logger.info("curl_cffi author page fallback succeeded for %s", _domain_from_url(url))
        return url, fallback
    return url, profile


async def _scrape_and_promote(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    client: httpx.AsyncClient,
    author_urls: list[str],
    dry_run: bool,
) -> None:
    semaphore = asyncio.Semaphore(CONCURRENT_PROFILE_SCRAPES)
    scrapes = await asyncio.gather(
        *(_scrape_profile(semaphore, client, url) for url in author_urls[:5]),
        return_exceptions=True,
    )
    valid = [item for item in scrapes if isinstance(item, tuple) and not item[1].get("error")]
    result["scraped"] = len(valid)
    for url, profile in valid:
        profile_name = profile.get("full_name")
        if not _person_name_match(str(reporter.name or ""), profile_name):
            continue
        if dry_run:
            result["promoted"] = True
            result["_dry_run_match"] = {"url": url, "profile_name": profile_name}
            return
        result["promoted"] = await _promote_reporter(
            session,
            reporter,
            url,
            str(profile_name),
            evidence_source="author_page",
        )
        if result["promoted"]:
            return


async def _source_for_reporter(session: AsyncSession, reporter_id: int) -> str:
    result = await session.execute(
        select(Article.source)
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .where(ArticleAuthor.reporter_id == reporter_id)
        .limit(1)
    )
    source = result.scalar_one_or_none()
    return str(source) if source else ""


async def _record_rss_match(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    match: dict[str, str],
    dry_run: bool,
) -> None:
    result["evidence_recorded"] = True
    if dry_run:
        result["_dry_run_match"] = match
        return
    await _record_supporting_evidence(
        session,
        reporter,
        match["url"],
        evidence_source="rss_feed_author",
        label="RSS dc:creator attribution",
        note=f"RSS feed byline matches '{match['profile_name']}'.",
    )


async def _try_wayback_candidates(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    author_urls: list[str],
    dry_run: bool,
) -> bool:
    name = str(reporter.name or "")
    for candidate_url in author_urls[:3]:
        match = await _try_wayback_author_page(name, candidate_url)
        if match is None:
            continue
        if dry_run:
            result["promoted"] = True
            result["_dry_run_match"] = match
            return True
        result["promoted"] = await _promote_reporter(
            session,
            reporter,
            match["url"],
            match["profile_name"],
            evidence_source=match.get("source", "wayback_machine"),
        )
        return bool(result["promoted"])
    return False


async def _try_wikidata_support(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    source_name: str,
    dry_run: bool,
) -> None:
    eligible = reporter.confidence_tier == "strong" or bool(reporter.wikidata_qid)
    match = _try_wikidata_employer_check(reporter, source_name) if eligible else None
    if match is None:
        return
    result["evidence_recorded"] = True
    if dry_run:
        result["_dry_run_match"] = match
        return
    result["promoted"] = await _record_supporting_evidence(
        session,
        reporter,
        match["url"],
        evidence_source="wikidata_employer_match",
        label="Wikidata employer match",
        note=f"Wikidata employer evidence matches source '{source_name}'.",
    )


async def _advanced_verification(
    session: AsyncSession,
    reporter: Reporter,
    result: dict[str, Any],
    author_urls: list[str],
    dry_run: bool,
) -> None:
    source = await _source_for_reporter(session, int(reporter.id or 0))
    rss_match = await _try_rss_feed_verification(
        str(reporter.name or ""), source, int(reporter.id or 0), session
    )
    if rss_match:
        await _record_rss_match(session, reporter, result, rss_match, dry_run)
    if await _try_wayback_candidates(session, reporter, result, author_urls, dry_run):
        return
    await _try_wikidata_support(session, reporter, result, source, dry_run)


async def _process_reporter(
    session: AsyncSession,
    reporter_id: int,
    http_client: httpx.AsyncClient,
    dry_run: bool,
) -> dict[str, Any]:
    """Run the ordered publisher-evidence verification pipeline for one reporter."""
    reporter = await _load_reporter(session, reporter_id)
    if reporter is None:
        return {"reporter_id": reporter_id, "name": "", "error": "not_found"}
    name = str(reporter.name or "")
    result = _verification_result(reporter_id, name)
    if not name.strip():
        result["error"] = "empty_name"
        return result

    author_urls = await _discover_author_urls_for_reporter(session, reporter, http_client)
    result["discovered_urls"] = len(author_urls)
    if not author_urls and await _augment_author_urls_from_cffi(
        session, reporter, result, author_urls, dry_run
    ):
        return result
    if not author_urls:
        logger.debug("No author URLs discovered for %s", name)
        return result

    await _scrape_and_promote(session, reporter, result, http_client, author_urls, dry_run)
    if not result["promoted"]:
        await _advanced_verification(session, reporter, result, author_urls, dry_run)
    return result


async def _get_session() -> AsyncSession:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


def _source_matches_filter(source: str, source_filter: str | None) -> bool:
    if not source_filter:
        return True
    query = source_filter.lower()
    base = source.split(" - ")[0].strip()
    return query in source.lower() or query in base.lower()


async def _get_non_verified_reporter_ids(
    session: AsyncSession,
    source_filter: str | None = None,
    limit: int | None = None,
) -> list[tuple[int, str]]:
    """Get unique reporter/source pairs for non-verified reporters."""
    result = await session.execute(
        select(Reporter.id, Article.source)
        .join(ArticleAuthor, ArticleAuthor.reporter_id == Reporter.id)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(Reporter.confidence_tier != "verified")
        .distinct()
    )
    pairs = [(int(row[0]), str(row[1] or "")) for row in result.all()]
    unique: dict[int, str] = {}
    for reporter_id, source in pairs:
        if reporter_id not in unique and _source_matches_filter(source, source_filter):
            unique[reporter_id] = source
        if limit and len(unique) >= limit:
            break
    return list(unique.items())


async def _process_one_reporter(
    semaphore: asyncio.Semaphore, reporter_id: int, dry_run: bool
) -> dict[str, Any]:
    async with semaphore:
        session = await _get_session()
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                return await _process_reporter(session, reporter_id, client, dry_run)
        finally:
            await session.close()


def _verification_summary(results: list[Any]) -> tuple[int, int, list[str]]:
    promoted = [item for item in results if isinstance(item, dict) and item.get("promoted")]
    errors = sum(
        isinstance(item, BaseException) or (isinstance(item, dict) and bool(item.get("error")))
        for item in results
    )
    names = [str(item.get("name") or "") for item in promoted]
    return len(promoted), errors, names


def _print_summary(total: int, promoted: int, errors: int, names: list[str], dry_run: bool) -> None:
    print()
    print("=" * 72)
    print(f"REPORTER VERIFICATION SUMMARY  (dry_run={dry_run})")
    print("=" * 72)
    print(f"Local-byline rptrs:   {total}")
    print(f"Promoted to verified: {promoted}")
    print(f"Promotion rate:       {round(100 * promoted / max(total, 1), 1)}%")
    print(f"Errors:               {errors}")
    if names:
        suffix = f"\n  ... and {len(names) - 10} more" if len(names) > 10 else ""
        print(f"Promoted names:       {', '.join(names[:10])}{suffix}")
    print("=" * 72)


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        pairs = await _get_non_verified_reporter_ids(session, args.source, args.limit)
    finally:
        await session.close()
    if not pairs:
        logger.info("No local_byline reporters found")
        print("No local_byline reporters found")
        return 0

    semaphore = asyncio.Semaphore(args.concurrency)
    results = await asyncio.gather(
        *(_process_one_reporter(semaphore, reporter_id, args.dry_run) for reporter_id, _ in pairs),
        return_exceptions=True,
    )
    promoted, errors, names = _verification_summary(results)
    _print_summary(len(pairs), promoted, errors, names, args.dry_run)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify local-byline reporters via author-page parsing and promote to verified."
    )
    parser.add_argument("--source", help="Process a single source (substring match)")
    parser.add_argument("--limit", type=int, help="Limit number of sources to process")
    parser.add_argument("--concurrency", type=int, default=6, help="Sources to process in parallel")
    parser.add_argument("--dry-run", action="store_true", help="Discover and scrape without DB writes")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
