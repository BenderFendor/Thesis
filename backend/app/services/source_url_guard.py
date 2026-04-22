from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

AGGREGATOR_HOSTS = {
    "news.google.com",
    "feedproxy.google.com",
    "feedburner.com",
}

_SITE_QUERY_RE = re.compile(r"site:([a-z0-9.-]+)", re.IGNORECASE)
_HOST_FAMILIES = {
    "bbc": ("bbc.com", "bbc.co.uk", "bbci.co.uk"),
}


def normalize_host(host: str) -> str:
    return host.strip().lower().replace("www.", "")


def extract_host(url: str) -> str:
    return normalize_host(urlparse(url).netloc)


def iter_urls(url_value: Any) -> list[str]:
    if isinstance(url_value, str) and url_value.strip():
        return [url_value.strip()]
    if isinstance(url_value, list):
        return [
            item.strip() for item in url_value if isinstance(item, str) and item.strip()
        ]
    return []


def _site_host_from_google_news(url: str) -> Optional[str]:
    parsed = urlparse(url)
    if normalize_host(parsed.netloc) != "news.google.com":
        return None
    query_value = " ".join(parse_qs(parsed.query).get("q", []))
    if not query_value:
        return None
    site_match = _SITE_QUERY_RE.search(query_value)
    if not site_match:
        return None
    return normalize_host(site_match.group(1))


def extract_domain(url_value: Any) -> Optional[str]:
    urls = iter_urls(url_value)
    if not urls:
        if isinstance(url_value, str):
            host = extract_host(
                url_value if "://" in url_value else f"https://{url_value}"
            )
            return host or None
        return None

    raw_value = urls[0]
    parsed = urlparse(raw_value if "://" in raw_value else f"https://{raw_value}")
    host = normalize_host(parsed.netloc)
    if not host:
        return None

    site_host = _site_host_from_google_news(raw_value)
    if site_host:
        return site_host

    if host.startswith("feeds.") and "." in host:
        return host.split(".", 1)[1]
    if host.startswith("rss.") and "." in host:
        return host.split(".", 1)[1]
    return host


def normalize_site_url(url_value: Any) -> Optional[str]:
    for candidate in iter_urls(url_value):
        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"}:
            continue

        site_host = _site_host_from_google_news(candidate)
        if site_host:
            return f"https://{site_host}"

        host = normalize_host(parsed.netloc)
        if not host:
            continue

        if host.startswith("feeds.") and "." in host:
            return f"https://{host.split('.', 1)[1]}"
        if host.startswith("rss.") and "." in host:
            return f"https://{host.split('.', 1)[1]}"

        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def _host_family(host: str) -> Optional[str]:
    normalized = normalize_host(host)
    for family, members in _HOST_FAMILIES.items():
        if any(
            normalized == member or normalized.endswith(f".{member}")
            for member in members
        ):
            return family
    return None


def hosts_match(expected: str, actual: str) -> bool:
    expected_norm = normalize_host(expected)
    actual_norm = normalize_host(actual)
    if not expected_norm or not actual_norm:
        return False
    if expected_norm == actual_norm:
        return True
    if expected_norm.endswith(f".{actual_norm}") or actual_norm.endswith(
        f".{expected_norm}"
    ):
        return True
    expected_family = _host_family(expected_norm)
    return expected_family is not None and expected_family == _host_family(actual_norm)


def build_source_url_guard(
    url_value: Any,
    website_url: Optional[str],
) -> dict[str, Any]:
    feed_urls = iter_urls(url_value)
    raw_feed_host = extract_host(feed_urls[0]) if feed_urls else None
    configured_host = extract_domain(url_value)
    website_host = extract_domain(website_url) if website_url else None

    status = "unknown"
    reason = None

    if configured_host and website_host:
        if raw_feed_host in AGGREGATOR_HOSTS:
            if hosts_match(configured_host, website_host):
                status = "ok"
                reason = "site_scoped_aggregator_matches_inferred_website"
            else:
                status = "mismatch"
                reason = "configured_feed_is_aggregator"
        elif hosts_match(configured_host, website_host):
            status = "ok"
            reason = "configured_host_matches_inferred_website"
        else:
            status = "mismatch"
            reason = "configured_host_differs_from_inferred_website"

    return {
        "status": status,
        "feed_host": raw_feed_host,
        "configured_host": configured_host,
        "website_host": website_host,
        "reason": reason,
    }
