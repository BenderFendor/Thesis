from __future__ import annotations

import asyncio
import json
import re
from collections import Counter, OrderedDict
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin, urlparse

import httpx

from app.core.logging import get_logger

logger = get_logger("reporter_public_records")

_JSON_LD_PATTERN = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
_META_AUTHOR_PATTERN = re.compile(
    r"<meta[^>]+name=[\"']author[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>",
    re.IGNORECASE,
)
_ANCHOR_PATTERN = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.IGNORECASE | re.DOTALL)
_TAG_ATTR_PATTERN = re.compile(r"([a-zA-Z_:.-]+)\s*=\s*[\"']([^\"']*)[\"']")
_AUTHOR_PATH_PATTERN = re.compile(
    r"/(author|authors|profile|profiles|staff|team|bio|bios)/",
    re.IGNORECASE,
)


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _name_matches(candidate: Optional[str], reporter_name: str) -> bool:
    if not candidate:
        return False
    normalized_candidate = _normalize_name(candidate)
    normalized_reporter = _normalize_name(reporter_name)
    if normalized_candidate == normalized_reporter:
        return True
    candidate_tokens = set(re.findall(r"[a-z0-9]+", normalized_candidate))
    reporter_tokens = set(re.findall(r"[a-z0-9]+", normalized_reporter))
    if not candidate_tokens or not reporter_tokens:
        return False
    return reporter_tokens.issubset(candidate_tokens) or candidate_tokens.issubset(
        reporter_tokens
    )


def _ordered_unique(values: Iterable[Optional[str]]) -> List[str]:
    unique: "OrderedDict[str, None]" = OrderedDict()
    for value in values:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in unique:
            unique[cleaned] = None
    return list(unique.keys())


def _domain(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url)
    return parsed.netloc.lower().replace("www.", "") or None


def _is_fetchable_article_url(url: str) -> bool:
    host = _domain(url)
    if not host:
        return False
    return not host.endswith(".example.com") and host != "example.com"


def _parse_tag_attrs(raw_attrs: str) -> Dict[str, str]:
    return {
        match.group(1).lower(): match.group(2)
        for match in _TAG_ATTR_PATTERN.finditer(raw_attrs)
    }


def _strip_html(value: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", value)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _collect_author_objects(payload: Any) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    if isinstance(payload, dict):
        author = payload.get("author")
        if isinstance(author, list):
            for item in author:
                if isinstance(item, dict):
                    results.append(item)
                elif isinstance(item, str):
                    results.append({"name": item})
        elif isinstance(author, dict):
            results.append(author)
        elif isinstance(author, str):
            results.append({"name": author})

        graph = payload.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                results.extend(_collect_author_objects(item))
    elif isinstance(payload, list):
        for item in payload:
            results.extend(_collect_author_objects(item))
    return results


def _parse_json_ld_author_data(
    html: str, reporter_name: str, page_url: str
) -> Dict[str, List[str]]:
    author_pages: List[str] = []
    social_links: List[str] = []

    for raw_json in _JSON_LD_PATTERN.findall(html):
        try:
            payload = json.loads(raw_json.strip())
        except json.JSONDecodeError:
            continue

        for author in _collect_author_objects(payload):
            name = author.get("name")
            if not _name_matches(
                name if isinstance(name, str) else None, reporter_name
            ):
                continue
            if isinstance(author.get("url"), str):
                author_pages.append(urljoin(page_url, author["url"]))
            same_as = author.get("sameAs")
            if isinstance(same_as, list):
                social_links.extend(
                    urljoin(page_url, value)
                    for value in same_as
                    if isinstance(value, str)
                )
            elif isinstance(same_as, str):
                social_links.append(urljoin(page_url, same_as))

    return {
        "author_pages": _ordered_unique(author_pages),
        "social_links": _ordered_unique(social_links),
    }


def _parse_anchor_author_links(
    html: str, reporter_name: str, page_url: str
) -> List[str]:
    links: List[str] = []
    for raw_attrs, raw_text in _ANCHOR_PATTERN.findall(html):
        attrs = _parse_tag_attrs(raw_attrs)
        href = attrs.get("href")
        if not href:
            continue
        rel = attrs.get("rel", "")
        text = _strip_html(raw_text)
        absolute = urljoin(page_url, href)
        if "author" in rel.lower() or _AUTHOR_PATH_PATTERN.search(
            urlparse(absolute).path
        ):
            if text and not _name_matches(text, reporter_name):
                continue
            links.append(absolute)
    return _ordered_unique(links)


def _author_name_from_meta(html: str) -> Optional[str]:
    match = _META_AUTHOR_PATTERN.search(html)
    if not match:
        return None
    return match.group(1).strip() or None


async def _fetch_article_author_signals(
    client: httpx.AsyncClient,
    reporter_name: str,
    article_url: str,
) -> Dict[str, Any]:
    try:
        response = await client.get(article_url, follow_redirects=True)
    except Exception as exc:
        logger.debug("Reporter article fetch failed for %s: %s", article_url, exc)
        return {}

    if response.status_code != 200:
        return {}
    if "text/html" not in response.headers.get("content-type", ""):
        return {}

    html = response.text
    json_ld = _parse_json_ld_author_data(html, reporter_name, str(response.url))
    anchor_links = _parse_anchor_author_links(html, reporter_name, str(response.url))
    meta_author = _author_name_from_meta(html)

    return {
        "article_url": str(response.url),
        "author_pages": _ordered_unique(json_ld["author_pages"] + anchor_links),
        "social_links": json_ld["social_links"],
        "meta_author": meta_author,
    }


async def build_reporter_activity_summary(
    reporter_name: str,
    recent_articles: List[Dict[str, Any]],
) -> Dict[str, Any]:
    source_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    domain_counts: Counter[str] = Counter()
    article_dates: List[str] = []
    article_urls = [
        str(article["url"])
        for article in recent_articles
        if isinstance(article.get("url"), str)
        and article.get("url")
        and _is_fetchable_article_url(str(article["url"]))
    ][:6]

    for article in recent_articles:
        source = article.get("source")
        category = article.get("category")
        published_at = article.get("published_at")
        url = article.get("url")
        if isinstance(source, str) and source:
            source_counts[source] += 1
        if isinstance(category, str) and category:
            category_counts[category] += 1
        if isinstance(url, str) and url:
            host = _domain(url)
            if host:
                domain_counts[host] += 1
        if isinstance(published_at, str) and published_at:
            article_dates.append(published_at)

    author_pages: List[str] = []
    social_links: List[str] = []
    matched_meta_articles = 0
    if article_urls:
        async with httpx.AsyncClient(timeout=15.0) as client:
            results = await asyncio.gather(
                *[
                    _fetch_article_author_signals(client, reporter_name, article_url)
                    for article_url in article_urls
                ],
                return_exceptions=True,
            )

        for result in results:
            if isinstance(result, BaseException):
                continue
            author_pages.extend(
                value
                for value in result.get("author_pages", [])
                if isinstance(value, str)
            )
            social_links.extend(
                value
                for value in result.get("social_links", [])
                if isinstance(value, str)
            )
            meta_author = result.get("meta_author")
            if _name_matches(
                meta_author if isinstance(meta_author, str) else None, reporter_name
            ):
                matched_meta_articles += 1

    return {
        "article_count": len(recent_articles),
        "source_count": len(source_counts),
        "active_since": min(article_dates) if article_dates else None,
        "latest_article_at": max(article_dates) if article_dates else None,
        "outlets": [
            {"name": name, "article_count": count}
            for name, count in source_counts.most_common(6)
        ],
        "categories": [
            {"name": name, "article_count": count}
            for name, count in category_counts.most_common(8)
        ],
        "domains": [
            {"domain": name, "article_count": count}
            for name, count in domain_counts.most_common(6)
        ],
        "author_pages": [
            {"url": url, "domain": _domain(url), "source": "article-page"}
            for url in _ordered_unique(author_pages)[:8]
        ],
        "external_profiles": [
            {"url": url, "domain": _domain(url), "source": "structured-data"}
            for url in _ordered_unique(social_links)[:8]
        ],
        "meta_author_matches": matched_meta_articles,
    }
