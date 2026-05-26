from __future__ import annotations

import asyncio
import re
import ssl
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from app.services.entity_wiki_service import build_reporter_dossier, build_source_profile
from app.services.reporter_public_records import (
    clean_author_name,
    compute_author_confidence,
    extract_article_author_candidates,
)
from app.services.source_url_guard import (
    build_source_url_guard,
    extract_domain,
    extract_host,
    hosts_match,
    normalize_site_url,
)
from scripts.google_news_decoder import decode_google_news_url
from scripts.validate_rss_sources import count_items, iter_urls, _parse_feed_xml

HEADERS = {"User-Agent": "ScoopNewsReporterSourceVerifier/1.0"}
FETCH_TIMEOUT_SECONDS = 12
SSL_CONTEXT = ssl._create_unverified_context()
DEFAULT_SOURCES = [
    "BBC",
    "CNN",
    "Reuters",
    "Pajhwok Afghan News",
    "The Kathmandu Post",
    "Palestine News Network",
]
DEFAULT_REPORTERS = [
    "Christiane Amanpour::CNN",
    "Lyse Doucet::BBC",
    "Jeremy Bowen::BBC",
]
DEFAULT_BYLINE_SOURCES = ["Pajhwok Afghan News", "The Kathmandu Post"]
AUTHOR_PAGE_PATHS = (
    "/author/{slug}/",
    "/authors/{slug}/",
    "/by/{slug}",
    "/people/{slug}",
    "/contributors/{slug}/",
    "/staff/{slug}/",
    "/profile/{slug}/",
)
QUALITY_ORDER = {"none": 0, "weak": 1, "medium": 2, "strong": 3}


def classify_access_barrier(status: int | None, body: bytes) -> str | None:
    body_preview = body[:20_000].decode("utf-8", errors="ignore").lower()
    if "challenges.cloudflare.com" in body_preview or "cf-mitigated" in body_preview:
        return "cloudflare_challenge"
    if "datadome" in body_preview or "x-datadome" in body_preview:
        return "datadome"
    if status in {401, 403, 429}:
        return f"http_{status}"
    return None


def fetch_feed(url: str) -> tuple[int | None, str, bytes]:
    request = urllib.request.Request(url, headers=HEADERS)
    errors: list[str] = []
    for _attempt in range(2):
        try:
            with urllib.request.urlopen(
                request, timeout=FETCH_TIMEOUT_SECONDS, context=SSL_CONTEXT
            ) as response:
                status = getattr(response, "status", None)
                content_type = response.headers.get("Content-Type", "")
                body = response.read()
            return status, content_type, body
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            ValueError,
        ) as exc:
            errors.append(str(exc))

    try:
        with httpx.Client(
            headers=HEADERS,
            timeout=FETCH_TIMEOUT_SECONDS,
            verify=False,
            follow_redirects=True,
        ) as client:
            response = client.get(url)
        return (
            response.status_code,
            response.headers.get("content-type", ""),
            response.content,
        )
    except httpx.HTTPError as exc:
        errors.append(str(exc))
        raise OSError("; ".join(errors)) from exc


def validate_source(source_name: str, config: dict[str, Any]) -> dict[str, Any]:
    urls = iter_urls(config.get("url"))
    if not urls:
        return {"source": source_name, "ok": False, "error": "missing feed url"}

    try:
        status, content_type, body = fetch_feed(urls[0])
        root = _parse_feed_xml(body)
        item_count = count_items(root)
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
        ET.ParseError,
    ) as exc:
        return {"source": source_name, "ok": False, "error": str(exc)}

    guard = build_source_url_guard(config.get("url"), config.get("site_url"))
    required_fields = [
        "site_url",
        "country",
        "funding_type",
        "ownership_label",
        "factual_reporting",
    ]
    missing_fields = [
        field for field in required_fields if not str(config.get(field) or "").strip()
    ]
    ok = item_count > 0 and guard.get("status") == "ok" and not missing_fields
    return {
        "source": source_name,
        "ok": ok,
        "status": status,
        "content_type": content_type,
        "items": item_count,
        "url_guard": guard.get("status"),
        "missing_fields": missing_fields,
    }


async def validate_source_async(source_name: str, config: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(validate_source, source_name, config)


async def validate_source_profile_async(source_name: str, config: dict[str, Any]) -> dict[str, Any]:
    website = config.get("site_url") if isinstance(config.get("site_url"), str) else None
    if not website:
        website = normalize_site_url(config.get("url"))
    try:
        profile = await build_source_profile(source_name, website)
    except Exception as exc:
        return {"source": source_name, "ok": False, "website": website, "error": str(exc)}

    sections = profile.get("dossier_sections") or []
    transparency = next(
        (section for section in sections if section.get("id") == "transparency"),
        {},
    )
    transparency_items = transparency.get("items") or []
    citations = profile.get("citations") or []
    ads_txt = profile.get("ads_txt") or {}
    sellers_json = profile.get("sellers_json") or {}
    policy_transparency = profile.get("policy_transparency") or {}
    ok = profile.get("match_status") == "matched" and bool(citations) and bool(transparency_items)
    return {
        "source": source_name,
        "ok": ok,
        "website": profile.get("website") or website,
        "match_status": profile.get("match_status"),
        "citations": len(citations) if isinstance(citations, list) else 0,
        "transparency_items": len(transparency_items)
        if isinstance(transparency_items, list)
        else 0,
        "ads_txt": bool(ads_txt),
        "authorized_sellers": int(ads_txt.get("authorized_sellers") or 0)
        if isinstance(ads_txt, dict)
        else 0,
        "sellers_json": bool(sellers_json),
        "policy_signals": int(policy_transparency.get("available_signals") or 0)
        if isinstance(policy_transparency, dict)
        else 0,
        "checked_ad_systems": int(sellers_json.get("checked_ad_systems") or 0)
        if isinstance(sellers_json, dict)
        else 0,
        "matched_seller_rows": int(sellers_json.get("matched_records") or 0)
        if isinstance(sellers_json, dict)
        else 0,
    }


def first_text(item: Any, candidates: list[str]) -> str | None:
    for candidate in candidates:
        value = item.findtext(candidate)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def extract_articles(root: Any, limit: int) -> list[dict[str, str]]:
    namespaces = {"dc": "http://purl.org/dc/elements/1.1/"}
    items = root.findall("./channel/item")
    articles: list[dict[str, str]] = []
    inspection_limit = max(10, limit * 5)
    for item in items[:inspection_limit]:
        author = first_text(item, ["dc:creator", "author"])
        if not author:
            author_node = item.find("dc:creator", namespaces)
            if author_node is not None and author_node.text:
                author = author_node.text.strip()
        link = first_text(item, ["link"])
        title = first_text(item, ["title"])
        if link:
            link = decode_google_news_url(link) or link
            articles.append({"author": author or "", "link": link, "title": title or ""})
            if len(articles) >= limit:
                break

    if len(articles) >= limit:
        return articles

    atom = "{http://www.w3.org/2005/Atom}"
    entries = root.findall(f"{atom}entry")
    for entry in entries[:inspection_limit]:
        author = (entry.findtext(f"{atom}author/{atom}name") or "").strip()
        title = (entry.findtext(f"{atom}title") or "").strip()
        link = ""
        for link_node in entry.findall(f"{atom}link"):
            rel = link_node.attrib.get("rel", "alternate")
            href = link_node.attrib.get("href", "")
            if href and rel in {"alternate", ""}:
                link = decode_google_news_url(href) or href
                break
        if link:
            articles.append({"author": author, "link": link, "title": title})
            if len(articles) >= limit:
                break
    return articles


def extract_reporter_from_article(article: dict[str, str]) -> dict[str, Any]:
    raw_feed_author = article.get("author") or ""
    feed_author = clean_author_name(raw_feed_author)
    try:
        status, _, article_body = fetch_feed(article["link"])
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        if feed_author:
            return {
                "ok": True,
                "author": feed_author,
                "article_url": article["link"],
                "confidence": 0.5,
                "candidate_count": 1,
                "author_pages": 0,
                "official_feed_byline": True,
                "access_barrier": "fetch_error",
                "quality": byline_quality(
                    0.5,
                    1,
                    0,
                    official_feed_byline=True,
                ),
                "error": f"article page fetch failed; fell back to RSS byline: {exc}",
            }
        if raw_feed_author.strip():
            return {
                "ok": False,
                "error": f"generic feed byline filtered: {raw_feed_author.strip()}",
                "article_url": article["link"],
                "quality": "none",
                "generic_byline": True,
            }
        raise
    access_barrier = classify_access_barrier(status, article_body)
    if access_barrier:
        if feed_author:
            return {
                "ok": True,
                "author": feed_author,
                "article_url": article["link"],
                "confidence": 0.5,
                "candidate_count": 1,
                "author_pages": 0,
                "official_feed_byline": True,
                "access_barrier": access_barrier,
                "quality": byline_quality(
                    0.5,
                    1,
                    0,
                    official_feed_byline=True,
                ),
                "error": f"article page blocked ({access_barrier}); fell back to RSS byline",
            }
        return {
            "ok": False,
            "error": f"article page blocked ({access_barrier})",
            "article_url": article["link"],
            "quality": "none",
            "access_barrier": access_barrier,
            "generic_byline": bool(raw_feed_author.strip()),
        }
    article_html = article_body.decode("utf-8", errors="ignore")
    candidates = extract_article_author_candidates(article_html, article["link"])
    candidate_names = [
        name
        for name in [
            *candidates.get("names", []),
            clean_author_name(article.get("author") or ""),
        ]
        if isinstance(name, str) and name.strip()
    ]
    author = candidate_names[0] if candidate_names else ""
    if not author:
        if raw_feed_author.strip():
            return {
                "ok": False,
                "error": f"generic feed byline filtered: {raw_feed_author.strip()}",
                "article_url": article["link"],
                "quality": "none",
                "generic_byline": True,
            }
        return {
            "ok": False,
            "error": "no reporter in feed or article page",
            "article_url": article["link"],
            "quality": "none",
        }
    confidence = compute_author_confidence(
        author,
        article_html,
        article["link"],
        rss_byline=article.get("author") or None,
    )
    candidate_count = len(candidates.get("names", []))
    official_feed_byline = author == clean_author_name(article.get("author") or "")
    evidence_count = candidate_count + (1 if official_feed_byline else 0)
    structured_person_count = len(candidates.get("structured_person_names", []))
    microdata_author_count = len(candidates.get("microdata_author_names", []))
    metadata_author_count = len(candidates.get("metadata_author_names", []))
    author_pages = len(candidates.get("author_pages", []))
    if author_pages == 0 and not official_feed_byline:
        author_pages = len(discover_author_pages(author, article["link"]))
    quality = byline_quality(
        confidence,
        evidence_count,
        author_pages,
        structured_person_count,
        microdata_author_count,
        metadata_author_count,
        official_feed_byline,
    )
    return {
        "ok": confidence >= 0.5 or candidate_count > 0,
        "author": author,
        "article_url": article["link"],
        "confidence": confidence,
        "candidate_count": evidence_count,
        "structured_person_count": structured_person_count,
        "microdata_author_count": microdata_author_count,
        "metadata_author_count": metadata_author_count,
        "author_pages": author_pages,
        "official_feed_byline": official_feed_byline,
        "quality": quality,
    }


def _author_slug(author_name: str) -> str | None:
    author_name = clean_author_name(author_name) or ""
    if re.search(r"\b(and|with)\b|[,;&/@]", author_name, re.IGNORECASE):
        return None
    cleaned = re.sub(r"\([^)]*\)", " ", author_name)
    tokens = re.findall(r"[a-z0-9]+", cleaned.lower())
    if len(tokens) < 2:
        return None
    return "-".join(tokens)


def discover_author_pages(author_name: str, article_url: str) -> list[str]:
    author_name = clean_author_name(author_name) or ""
    slug = _author_slug(author_name)
    parsed = urlparse(article_url)
    if not slug or not parsed.scheme or not parsed.netloc:
        return []

    base_url = f"{parsed.scheme}://{parsed.netloc}"
    expected_tokens = set(re.findall(r"[a-z0-9]+", author_name.lower()))
    discovered: list[str] = []
    for path_template in AUTHOR_PAGE_PATHS:
        candidate_url = urljoin(base_url, path_template.format(slug=slug))
        try:
            status, content_type, body = fetch_feed(candidate_url)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            continue
        if status != 200 or "html" not in content_type.lower():
            continue
        page_text = body[:250_000].decode("utf-8", errors="ignore").lower()
        if expected_tokens and expected_tokens.issubset(set(re.findall(r"[a-z0-9]+", page_text))):
            discovered.append(candidate_url)
            break
    return discovered


def validate_live_byline(
    source_name: str, config: dict[str, Any], reporters_per_source: int
) -> dict[str, Any]:
    urls = iter_urls(config.get("url"))
    if not urls:
        return {"source": source_name, "ok": False, "error": "missing feed url"}
    try:
        _, _, body = fetch_feed(urls[0])
        root = _parse_feed_xml(body)
        articles = extract_articles(root, reporters_per_source * 4)
        if not articles:
            return {"source": source_name, "ok": False, "error": "no article in feed"}
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
        ET.ParseError,
    ) as exc:
        return {"source": source_name, "ok": False, "error": str(exc)}

    reporter_results: list[dict[str, Any]] = []
    errors: list[str] = []
    seen_authors: set[str] = set()
    for article in articles:
        if not article_matches_source_domain(article.get("link") or "", config):
            reporter_results.append(
                {
                    "ok": False,
                    "error": "article host differs from source host",
                    "article_url": article.get("link") or "-",
                    "quality": "none",
                    "source_mismatch": True,
                }
            )
            continue
        feed_author = clean_author_name(article.get("author") or "")
        if feed_author and feed_author.lower() in seen_authors:
            continue
        try:
            reporter_result = extract_reporter_from_article(article)
            reporter_results.append(reporter_result)
            author = str(reporter_result.get("author") or "").strip()
            if reporter_result.get("ok") and author:
                seen_authors.add(author.lower())
            if len(seen_authors) >= reporters_per_source:
                break
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            errors.append(str(exc))

    ok_reporters = [item for item in reporter_results if item.get("ok")]
    quality_counts: dict[str, int] = {"strong": 0, "medium": 0, "weak": 0, "none": 0}
    generic_bylines = 0
    access_barriers = 0
    source_mismatches = 0
    structured_authors = 0
    microdata_authors = 0
    metadata_authors = 0
    for item in reporter_results:
        quality = str(item.get("quality") or "none")
        quality_counts[quality] = quality_counts.get(quality, 0) + 1
        if item.get("generic_byline"):
            generic_bylines += 1
        if item.get("access_barrier"):
            access_barriers += 1
        if item.get("source_mismatch"):
            source_mismatches += 1
        structured_authors += int(item.get("structured_person_count", 0))
        microdata_authors += int(item.get("microdata_author_count", 0))
        metadata_authors += int(item.get("metadata_author_count", 0))
    best = ok_reporters[0] if ok_reporters else (reporter_results[0] if reporter_results else {})
    authors = []
    reported_authors: set[str] = set()
    for item in ok_reporters:
        author = str(item.get("author") or "").strip()
        if author and author.lower() not in reported_authors:
            reported_authors.add(author.lower())
            authors.append(author)
    source_quality = best_quality(quality_counts)

    return {
        "source": source_name,
        "ok": bool(ok_reporters),
        "author": best.get("author", "-"),
        "article_url": best.get("article_url", "-"),
        "confidence": best.get("confidence", 0),
        "candidate_count": best.get("candidate_count", 0),
        "author_pages": best.get("author_pages", 0),
        "quality": source_quality,
        "reporters_found": len(authors),
        "reporters_requested": reporters_per_source,
        "reporter_names": authors[:reporters_per_source],
        "strong": quality_counts.get("strong", 0),
        "medium": quality_counts.get("medium", 0),
        "weak": quality_counts.get("weak", 0),
        "none": quality_counts.get("none", 0),
        "generic": generic_bylines,
        "blocked": access_barriers,
        "source_mismatch": source_mismatches,
        "structured": structured_authors,
        "microdata": microdata_authors,
        "metadata": metadata_authors,
        "errors": errors[:3],
    }


def source_has_good_byline(result: dict[str, Any]) -> bool:
    return int(result.get("strong", 0)) + int(result.get("medium", 0)) > 0


def source_has_full_requested_coverage(result: dict[str, Any]) -> bool:
    return int(result.get("reporters_found", 0)) >= int(result.get("reporters_requested", 0))


def source_meets_min_quality(result: dict[str, Any], minimum: str = "medium") -> bool:
    minimum_rank = QUALITY_ORDER.get(minimum, QUALITY_ORDER["medium"])
    quality = str(result.get("quality") or "none").lower()
    return QUALITY_ORDER.get(quality, QUALITY_ORDER["none"]) >= minimum_rank


def byline_quality(
    confidence: float,
    candidate_count: int,
    author_pages: int,
    structured_person_count: int = 0,
    microdata_author_count: int = 0,
    metadata_author_count: int = 0,
    official_feed_byline: bool = False,
) -> str:
    if confidence >= 0.9 and author_pages > 0:
        return "strong"
    if (
        confidence >= 0.7
        or author_pages > 0
        or structured_person_count > 0
        or microdata_author_count > 0
        or metadata_author_count > 0
        or (official_feed_byline and confidence >= 0.5 and candidate_count > 0)
    ):
        return "medium"
    if confidence >= 0.5 or candidate_count > 0:
        return "weak"
    return "none"


def best_quality(quality_counts: dict[str, int]) -> str:
    for quality in ("strong", "medium", "weak"):
        if quality_counts.get(quality, 0) > 0:
            return quality
    return "none"


def article_matches_source_domain(article_url: str, config: dict[str, Any]) -> bool:
    article_host = extract_host(article_url)
    expected_host = extract_domain(config.get("site_url")) or extract_domain(config.get("url"))
    if not article_host or not expected_host:
        return True
    return hosts_match(expected_host, article_host)


async def validate_live_byline_async(
    source_name: str, config: dict[str, Any], reporters_per_source: int
) -> dict[str, Any]:
    return await asyncio.to_thread(validate_live_byline, source_name, config, reporters_per_source)


async def validate_reporter(
    reporter_spec: str,
    client: httpx.AsyncClient,
) -> dict[str, Any]:
    if "::" in reporter_spec:
        reporter_name, outlet = reporter_spec.split("::", 1)
    else:
        reporter_name, outlet = reporter_spec, None

    profile = await build_reporter_dossier(
        name=reporter_name,
        organization=outlet,
        http_client=client,
    )
    citations = profile.get("citations") or []
    career_history = profile.get("career_history") or []
    public_ids = [
        value for value in (profile.get("wikidata_qid"), profile.get("wikipedia_url")) if value
    ]
    ok = profile.get("match_status") == "matched" and bool(public_ids) and bool(citations)
    return {
        "reporter": reporter_name,
        "outlet": outlet,
        "ok": ok,
        "match_status": profile.get("match_status"),
        "confidence": profile.get("research_confidence"),
        "canonical_name": profile.get("canonical_name"),
        "wikidata_qid": profile.get("wikidata_qid"),
        "citations": len(citations) if isinstance(citations, list) else 0,
        "career_entries": len(career_history) if isinstance(career_history, list) else 0,
        "sources": profile.get("research_sources") or [],
    }
