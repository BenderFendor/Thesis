"""Source Url Guard."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.services.rss_parser_rust_bindings import RUST

AGGREGATOR_HOSTS = {
    "news.google.com",
    "feedproxy.google.com",
    "feedburner.com",
}

_SITE_QUERY_RE = re.compile(r"site:([a-z0-9.-]+)", re.IGNORECASE)


def normalize_host(host: str) -> str:
    """Normalize Host."""
    return str(RUST.rust_normalize_host(host))


def extract_host(url: str) -> str:
    """Extract Host."""
    return normalize_host(urlparse(url).netloc)


def iter_urls(url_value: Any) -> list[str]:
    """Iter Urls."""
    if isinstance(url_value, str) and url_value.strip():
        return [url_value.strip()]
    if isinstance(url_value, list):
        return [item.strip() for item in url_value if isinstance(item, str) and item.strip()]
    return []


def _site_host_from_google_news(url: str) -> str | None:
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


def _hostname(url_value: str) -> str | None:
    """Normalize a single URL value to a hostname, or None when it has none."""
    raw_value = url_value if "://" in url_value else f"https://{url_value}"
    return normalize_host(urlparse(raw_value).netloc) or None


def _strip_feed_prefix(host: str) -> str | None:
    """Strip a leading feeds./rss. prefix from a host, when present."""
    for prefix in ("feeds.", "rss."):
        if host.startswith(prefix) and "." in host:
            return host.split(".", 1)[1]
    return None


def _final_domain(raw_value: str) -> str | None:
    """Resolve the canonical domain for a raw URL value."""
    host = _hostname(raw_value)
    if not host:
        return None
    site_host = _site_host_from_google_news(raw_value)
    if site_host:
        return site_host
    return _strip_feed_prefix(host) or host


def extract_domain(url_value: Any) -> str | None:
    """Extract Domain."""
    urls = iter_urls(url_value)
    if not urls:
        if isinstance(url_value, str):
            return _final_domain(url_value)
        return None
    return _final_domain(urls[0])


def normalize_site_url(url_value: Any) -> str | None:
    """Normalize Site Url."""
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


def hosts_match(expected: str, actual: str) -> bool:
    """Hosts Match."""
    return bool(RUST.rust_hosts_match(expected, actual))


def build_source_url_guard(
    url_value: Any,
    website_url: str | None,
) -> dict[str, Any]:
    """Build Source Url Guard."""
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
