"""Profile page scraping for reporters/author pages."""

from __future__ import annotations

import json
import re
from html import unescape
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.logging import get_logger
from app.services.cloudflare_fetcher import (
    classify_access_barrier,
    fetch_html_document,
    outcome_to_error,
)

logger = get_logger("reporter_author_page_scraper")

_BIO_SECTION_PATTERNS = [
    re.compile(
        r'<div[^>]*class=["\'](?:author-bio|bio|biography|about-the-author)[^"\']*["\'][^>]*>(.*?)</div>',
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r'<section[^>]*class=["\'](?:author-bio|bio|biography)[^"\']*["\'][^>]*>(.*?)</section>',
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r'<p[^>]*class=["\'](?:bio|description|about)[^"\']*["\'][^>]*>(.*?)</p>',
        re.IGNORECASE | re.DOTALL,
    ),
]
_JSON_LD_PATTERN_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_STRIP_HTML_RE = re.compile(r"(?is)<[^>]+>")
_H1_PATTERN = re.compile(r"<h1\b[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
_TITLE_PATTERN = re.compile(r"<title\b[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_OG_TITLE_PATTERN = re.compile(
    r"<meta\b(?=[^>]*(?:property|name)=['\"]og:title['\"])(?=[^>]*content=['\"]([^'\"]+)['\"])[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_TITLE_NAME_PATTERNS = (
    re.compile(
        r"^(?P<name>.+?),\s*Author at\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^Read All The Stories (?:Written|Published) by (?P<name>.+?)\.?$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?P<name>.+?)\s*:\s*Read All The Stories (?:Written|Published) by\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(?P<name>.+?)\s*:\s*Read Latest News from\b",
        re.IGNORECASE,
    ),
)


def _strip_html(value: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", value)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = _STRIP_HTML_RE.sub(" ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _clean_title_name(value: str) -> str:
    text = _strip_html(value)
    for separator in (" - ", " | ", " — ", " – "):
        if separator in text:
            text = text.split(separator, 1)[0].strip()
    for pattern in _TITLE_NAME_PATTERNS:
        match = pattern.match(text)
        if match:
            text = match.group("name").strip()
            break
    return text


def _looks_like_person_name(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in {"author", "authors", "profile", "profiles", "staff"}:
        return False
    return len(re.findall(r"[^\W\d_]+", value, flags=re.UNICODE)) >= 2


def _title_profile_name(html: str) -> str | None:
    title_match = _TITLE_PATTERN.search(html)
    if title_match:
        title_name = _clean_title_name(title_match.group(1))
        if _looks_like_person_name(title_name):
            return title_name

    og_title_match = _OG_TITLE_PATTERN.search(html)
    if og_title_match:
        og_title_name = _clean_title_name(og_title_match.group(1))
        if _looks_like_person_name(og_title_name):
            return og_title_name
    return None


def _domain(url: str) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    return parsed.netloc.lower().replace("www.", "") or None


def _extract_person_jsonld(payload: Any) -> list[dict[str, Any]]:
    """Recursively extract Person-type objects from JSON-LD."""
    persons: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        types = payload.get("@type")
        type_list = types if isinstance(types, list) else [types] if types else []
        if "Person" in type_list:
            persons.append(payload)
        for _key, value in payload.items():
            persons.extend(_extract_person_jsonld(value))
    elif isinstance(payload, list):
        for item in payload:
            persons.extend(_extract_person_jsonld(item))
    return persons


async def scrape_author_profile(
    http_client: httpx.AsyncClient,
    profile_url: str,
) -> dict[str, Any]:
    """Fetch and parse an author profile page.

    Returns dict with keys:
    - url: final URL after redirects
    - domain: extracted domain
    - full_name: from JSON-LD name or meta
    - bio: extracted bio text
    - job_title: from JSON-LD jobTitle
    - same_as: list of sameAs URLs from JSON-LD
    - social_links: list of social profile URLs found
    - education: extracted education entries
    - email: email if found
    - affiliation: organization/affiliation from JSON-LD
    - error: error message if fetch failed
    """
    outcome = await fetch_html_document(http_client, profile_url, timeout_seconds=15.0)
    fetch_error = outcome_to_error(outcome)
    if fetch_error:
        result: dict[str, Any] = {
            "url": outcome.url,
            "error": fetch_error,
            "access_path": outcome.access_path,
        }
        barrier = classify_access_barrier(outcome)
        if barrier:
            result["access_barrier"] = barrier
        if outcome.fallback_error:
            result["fallback_error"] = outcome.fallback_error
        return result

    final_url = outcome.url
    html = outcome.text
    result = {
        "url": final_url,
        "domain": _domain(final_url),
        "access_path": outcome.access_path,
    }
    title_name = _title_profile_name(html)
    if title_name:
        result["full_name"] = title_name

    for raw_json in _JSON_LD_PATTERN_RE.findall(html):
        try:
            payload = json.loads(raw_json.strip())
        except json.JSONDecodeError:
            continue
        persons = _extract_person_jsonld(payload)
        for person in persons:
            if not result.get("full_name") and isinstance(person.get("name"), str):
                result["full_name"] = person["name"].strip()
            if not result.get("job_title") and isinstance(person.get("jobTitle"), str):
                result["job_title"] = person["jobTitle"].strip()
            if isinstance(person.get("description"), str) and not result.get("bio"):
                result["bio"] = person["description"].strip()
            if isinstance(person.get("affiliation"), dict) and isinstance(
                person["affiliation"].get("name"), str
            ):
                result["affiliation"] = person["affiliation"]["name"]
            same_as = person.get("sameAs")
            if isinstance(same_as, list):
                result.setdefault("same_as", []).extend(
                    url for url in same_as if isinstance(url, str) and url.startswith("http")
                )
            elif isinstance(same_as, str):
                result.setdefault("same_as", []).append(same_as)
            if isinstance(person.get("alumniOf"), dict) and isinstance(
                person["alumniOf"].get("name"), str
            ):
                result.setdefault("education", []).append(person["alumniOf"]["name"])
            elif isinstance(person.get("alumniOf"), list):
                for org in person["alumniOf"]:
                    if isinstance(org, dict) and isinstance(org.get("name"), str):
                        result.setdefault("education", []).append(org["name"])

    if not result.get("full_name"):
        h1_match = _H1_PATTERN.search(html)
        if h1_match:
            h1_name = _clean_title_name(h1_match.group(1))
            if _looks_like_person_name(h1_name):
                result["full_name"] = h1_name

    if not result.get("bio"):
        for pattern in _BIO_SECTION_PATTERNS:
            match = pattern.search(html)
            if match:
                bio_text = _strip_html(match.group(1))
                if bio_text and len(bio_text) > 20:
                    result["bio"] = bio_text
                    break

    email_match = _EMAIL_PATTERN.search(html)
    if email_match:
        result["email"] = email_match.group(0)

    if "same_as" in result:
        seen: set[str] = set()
        unique: list[str] = []
        for url_item in result["same_as"]:
            if url_item not in seen:
                seen.add(url_item)
                unique.append(url_item)
        result["same_as"] = unique

    return result
