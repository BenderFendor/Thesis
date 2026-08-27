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
    FetchOutcome,
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
    re.compile(r"^(?P<name>.+?),\s*Author at\b", re.IGNORECASE),
    re.compile(r"^Read All The Stories (?:Written|Published) by (?P<name>.+?)\.?$", re.IGNORECASE),
    re.compile(
        r"^(?P<name>.+?)\s*:\s*Read All The Stories (?:Written|Published) by\b",
        re.IGNORECASE,
    ),
    re.compile(r"^(?P<name>.+?)\s*:\s*Read Latest News from\b", re.IGNORECASE),
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
            return match.group("name").strip()
    return text


def _looks_like_person_name(value: str) -> bool:
    lowered = value.strip().lower()
    blocked = {"author", "authors", "profile", "profiles", "staff"}
    return lowered not in blocked and len(re.findall(r"[^\W\d_]+", value, flags=re.UNICODE)) >= 2


def _title_profile_name(html: str) -> str | None:
    for pattern in (_TITLE_PATTERN, _OG_TITLE_PATTERN):
        match = pattern.search(html)
        if not match:
            continue
        name = _clean_title_name(match.group(1))
        if _looks_like_person_name(name):
            return name
    return None


def _domain(url: str) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    return parsed.netloc.lower().replace("www.", "") or None


def _extract_person_jsonld(payload: Any) -> list[dict[str, Any]]:
    """Recursively extract Person-type objects from JSON-LD."""
    if isinstance(payload, list):
        return [person for item in payload for person in _extract_person_jsonld(item)]
    if not isinstance(payload, dict):
        return []

    types = payload.get("@type")
    type_list = types if isinstance(types, list) else [types] if types else []
    persons = [payload] if "Person" in type_list else []
    for value in payload.values():
        persons.extend(_extract_person_jsonld(value))
    return persons


def _fetch_failure_result(outcome: FetchOutcome, error: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "url": outcome.url,
        "error": error,
        "access_path": outcome.access_path,
    }
    barrier = classify_access_barrier(outcome)
    if barrier:
        result["access_barrier"] = barrier
    if outcome.fallback_error:
        result["fallback_error"] = outcome.fallback_error
    return result


def _jsonld_persons(html: str) -> list[dict[str, Any]]:
    persons: list[dict[str, Any]] = []
    for raw_json in _JSON_LD_PATTERN_RE.findall(html):
        try:
            payload = json.loads(raw_json.strip())
        except json.JSONDecodeError:
            continue
        persons.extend(_extract_person_jsonld(payload))
    return persons


def _set_first_text(result: dict[str, Any], key: str, value: object) -> None:
    if result.get(key) or not isinstance(value, str):
        return
    normalized = value.strip()
    if normalized:
        result[key] = normalized


def _merge_affiliation(result: dict[str, Any], person: dict[str, Any]) -> None:
    affiliation = person.get("affiliation")
    if not isinstance(affiliation, dict):
        return
    name = affiliation.get("name")
    if isinstance(name, str) and name.strip():
        result["affiliation"] = name.strip()


def _same_as_urls(value: object) -> list[str]:
    if isinstance(value, str):
        return [value] if value.startswith("http") else []
    if not isinstance(value, list):
        return []
    return [url for url in value if isinstance(url, str) and url.startswith("http")]


def _education_names(value: object) -> list[str]:
    records = value if isinstance(value, list) else [value]
    return [
        str(record["name"]).strip()
        for record in records
        if isinstance(record, dict)
        and isinstance(record.get("name"), str)
        and str(record["name"]).strip()
    ]


def _merge_person(result: dict[str, Any], person: dict[str, Any]) -> None:
    _set_first_text(result, "full_name", person.get("name"))
    _set_first_text(result, "job_title", person.get("jobTitle"))
    _set_first_text(result, "bio", person.get("description"))
    _merge_affiliation(result, person)

    same_as = _same_as_urls(person.get("sameAs"))
    if same_as:
        result.setdefault("same_as", []).extend(same_as)

    education = _education_names(person.get("alumniOf"))
    if education:
        result.setdefault("education", []).extend(education)


def _fallback_profile_name(html: str) -> str | None:
    match = _H1_PATTERN.search(html)
    if not match:
        return None
    name = _clean_title_name(match.group(1))
    return name if _looks_like_person_name(name) else None


def _fallback_bio(html: str) -> str | None:
    for pattern in _BIO_SECTION_PATTERNS:
        match = pattern.search(html)
        if not match:
            continue
        bio = _strip_html(match.group(1))
        if len(bio) > 20:
            return bio
    return None


def _dedupe_strings(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(value for value in values if isinstance(value, str)))


def _apply_html_fallbacks(result: dict[str, Any], html: str) -> None:
    if not result.get("full_name"):
        fallback_name = _fallback_profile_name(html)
        if fallback_name:
            result["full_name"] = fallback_name
    if not result.get("bio"):
        fallback_bio = _fallback_bio(html)
        if fallback_bio:
            result["bio"] = fallback_bio

    email_match = _EMAIL_PATTERN.search(html)
    if email_match:
        result["email"] = email_match.group(0)


def _normalize_multi_value_fields(result: dict[str, Any]) -> None:
    for key in ("same_as", "education"):
        if key in result:
            result[key] = _dedupe_strings(result[key])


async def scrape_author_profile(
    http_client: httpx.AsyncClient,
    profile_url: str,
) -> dict[str, Any]:
    """Fetch an author profile and combine structured data with HTML fallbacks."""
    outcome = await fetch_html_document(http_client, profile_url, timeout_seconds=15.0)
    fetch_error = outcome_to_error(outcome)
    if fetch_error:
        return _fetch_failure_result(outcome, fetch_error)

    result: dict[str, Any] = {
        "url": outcome.url,
        "domain": _domain(outcome.url),
        "access_path": outcome.access_path,
    }
    title_name = _title_profile_name(outcome.text)
    if title_name:
        result["full_name"] = title_name

    for person in _jsonld_persons(outcome.text):
        _merge_person(result, person)

    _apply_html_fallbacks(result, outcome.text)
    _normalize_multi_value_fields(result)
    return result
