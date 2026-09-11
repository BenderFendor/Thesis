from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
REPO_BACKEND = ROOT / "backend"
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.services.source_url_guard import (  # noqa: E402
    AGGREGATOR_HOSTS,
    extract_domain,
    extract_host,
    hosts_match,
    iter_urls,
    normalize_site_url,
)

RSS_SOURCES_PATH = ROOT / "backend" / "app" / "data" / "rss_sources.json"
_SSL_CONTEXT = ssl._create_unverified_context()
HEADERS = {"User-Agent": "NewsAggregator/1.0"}
_ATOM_NS = "http://www.w3.org/2005/Atom"


@dataclass(slots=True)
class _UrlValidation:
    ok: bool
    detail: str
    status: int | None


@dataclass(slots=True)
class _GuardContext:
    feed_host: str
    configured_host: str
    site_host: str
    inferred_site_host: str
    article_domain: str | None


def _trim_to_feed_document(body: bytes) -> bytes:
    """Keep the first complete RSS/Atom document when a feed appends junk."""
    lowered = body.lower()
    endings = [
        end + len(tag) for tag in (b"</rss>", b"</feed>") if (end := lowered.rfind(tag)) != -1
    ]
    return body[: max(endings)] if endings else body


def _strip_invalid_xml_bytes(body: bytes) -> bytes:
    return bytes(
        byte for byte in body if byte in (0x09, 0x0A, 0x0D) or 0x20 <= byte <= 0x7E or byte >= 0x80
    )


def _strip_invalid_xml_chars(body: bytes) -> str:
    text = body.decode("utf-8", errors="ignore")
    return "".join(
        char
        for char in text
        if char in ("\t", "\n", "\r")
        or "\u0020" <= char <= "\ud7ff"
        or "\ue000" <= char <= "\ufffd"
    )


def _parse_invalid_token_feed(body: bytes) -> ET.Element:
    trimmed = _trim_to_feed_document(body)
    try:
        return ET.fromstring(_strip_invalid_xml_bytes(trimmed))
    except ET.ParseError:
        return ET.fromstring(_strip_invalid_xml_chars(trimmed))


def _parse_feed_xml(body: bytes) -> ET.Element:
    try:
        return ET.fromstring(body)
    except ET.ParseError as exc:
        message = str(exc)
        if "junk after document element" in message:
            return ET.fromstring(_trim_to_feed_document(body))
        if "invalid token" in message:
            return _parse_invalid_token_feed(body)
        raise


def count_items(root: ET.Element) -> int:
    tag = root.tag.lower()
    if "rss" in tag:
        return len(root.findall("./channel/item"))
    if "feed" not in tag and "atom" not in tag:
        return 0
    entries = root.findall(f"./{{{_ATOM_NS}}}entry")
    return len(entries) if entries else len(root.findall("./entry"))


def _element_url_host(element: ET.Element | None, *, attribute: str | None = None) -> str | None:
    if element is None:
        return None
    raw = element.get(attribute) if attribute else element.text
    value = str(raw or "").strip()
    return extract_host(value) if value else None


def _rss_candidate_hosts(root: ET.Element) -> list[str | None]:
    return [
        _element_url_host(root.find("./channel/item/source"), attribute="url"),
        _element_url_host(root.find("./channel/item/link")),
        _element_url_host(root.find("./channel/link")),
    ]


def _atom_candidate_hosts(root: ET.Element) -> list[str | None]:
    return [
        _element_url_host(root.find(f"./{{{_ATOM_NS}}}entry/{{{_ATOM_NS}}}link"), attribute="href"),
        _element_url_host(root.find("./entry/link"), attribute="href"),
    ]


def _first_article_domain(url: str) -> str | None:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30, context=_SSL_CONTEXT) as response:
        root = _parse_feed_xml(response.read())
    return next(
        (host for host in _rss_candidate_hosts(root) + _atom_candidate_hosts(root) if host),
        None,
    )


def validate_url(url: str) -> tuple[bool, str, int | None]:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30, context=_SSL_CONTEXT) as response:
        status = getattr(response, "status", None)
        content_type = response.headers.get("Content-Type", "")
        body = response.read()

    root = _parse_feed_xml(body)
    items = count_items(root)
    if items <= 0:
        return False, f"parsed XML but found {items} items", status
    root_tag = root.tag.lower()
    is_feed_root = any(marker in root_tag for marker in ("rss", "feed", "atom"))
    if "html" in content_type.lower() and not is_feed_root:
        return False, f"returned HTML content-type {content_type}", status
    return True, f"status={status} items={items} root={root.tag}", status


def _validate_url_safely(url: str) -> _UrlValidation:
    try:
        ok, detail, status = validate_url(url)
        return _UrlValidation(ok, detail, status)
    except urllib.error.HTTPError as exc:
        return _UrlValidation(False, f"HTTPError status={exc.code}", exc.code)
    except Exception as exc:
        return _UrlValidation(False, f"{type(exc).__name__}: {exc}", None)


def _print_url_validation(source_name: str, url: str, validation: _UrlValidation) -> None:
    label = "OK" if validation.ok else "FAIL"
    print(f"{label}\t{source_name}\t{url}\t{validation.detail}")


def _guard_context(source_info: dict[str, Any], urls: list[str]) -> _GuardContext:
    first_url = urls[0]
    feed_host = extract_host(first_url) or ""
    configured_host = extract_domain(first_url) or ""
    site_host = extract_domain(source_info.get("site_url")) or ""
    inferred_site = normalize_site_url(first_url)
    inferred_site_host = extract_domain(inferred_site) or ""
    try:
        article_domain = _first_article_domain(first_url)
    except Exception:
        article_domain = None
    return _GuardContext(
        feed_host=feed_host,
        configured_host=configured_host,
        site_host=site_host,
        inferred_site_host=inferred_site_host,
        article_domain=article_domain,
    )


def _aggregator_guard(context: _GuardContext) -> tuple[str, str]:
    configured_matches = bool(
        context.configured_host
        and (
            context.site_host
            and hosts_match(context.configured_host, context.site_host)
            or context.article_domain
            and hosts_match(context.configured_host, context.article_domain)
        )
    )
    if configured_matches:
        return "ok", "site_scoped_aggregator_matches_target"
    return "mismatch", "aggregator_feed"


def _non_aggregator_guard(context: _GuardContext) -> tuple[str, str | None]:
    comparisons = (
        (context.site_host, "site_url_mismatch"),
        (context.inferred_site_host, "inferred_site_mismatch"),
        (context.article_domain or "", "first_article_domain_mismatch"),
    )
    for candidate_host, reason in comparisons:
        if (
            candidate_host
            and context.configured_host
            and not hosts_match(context.configured_host, candidate_host)
        ):
            return "mismatch", reason
    return "ok", None


def _guard_decision(context: _GuardContext) -> tuple[str, str | None]:
    if context.feed_host in AGGREGATOR_HOSTS:
        return _aggregator_guard(context)
    return _non_aggregator_guard(context)


def _guard_fields(context: _GuardContext) -> str:
    return (
        f"configured={context.configured_host or context.feed_host or '-'}"
        f"\tfeed_host={context.feed_host or '-'}"
        f"\tsite_url={context.site_host or '-'}"
        f"\tinferred_site={context.inferred_site_host or '-'}"
        f"\tarticle_domain={context.article_domain or '-'}"
    )


def _print_guard(source_name: str, source_info: dict[str, Any], urls: list[str]) -> None:
    context = _guard_context(source_info, urls)
    status, reason = _guard_decision(context)
    reason_field = f"\treason={reason}" if reason else ""
    print(f"GUARD\t{source_name}\tstatus={status}{reason_field}\t{_guard_fields(context)}")


def _selected_source_entries(
    data: dict[str, Any], only_names: set[str] | None
) -> list[tuple[str, Any]]:
    return [(name, info) for name, info in data.items() if only_names is None or name in only_names]


def _source_urls(source_name: str, source_info: Any) -> tuple[list[str], int]:
    if not isinstance(source_info, dict):
        print(f"FAIL\t{source_name}\tinvalid entry type")
        return [], 1
    urls = iter_urls(source_info.get("url"))
    if not urls:
        print(f"FAIL\t{source_name}\tmissing url")
        return [], 1
    return urls, 0


def _validate_source_urls(
    source_name: str,
    urls: list[str],
    status_counts: Counter[str],
) -> int:
    failures = 0
    for url in urls:
        validation = _validate_url_safely(url)
        status_counts[str(validation.status) if validation.status is not None else "error"] += 1
        _print_url_validation(source_name, url, validation)
        failures += int(not validation.ok)
    return failures


def _validate_source(
    source_name: str,
    source_info: Any,
    status_counts: Counter[str],
) -> int:
    urls, failures = _source_urls(source_name, source_info)
    if not urls:
        return failures
    failures += _validate_source_urls(source_name, urls, status_counts)
    assert isinstance(source_info, dict)
    _print_guard(source_name, source_info, urls)
    return failures


def _print_summary(status_counts: Counter[str], failures: int) -> None:
    print("SUMMARY")
    for key, count in sorted(status_counts.items()):
        print(f"{key}\t{count}")
    print(f"FAILURES\t{failures}")


def validate_sources(data: dict[str, Any], *, only_names: set[str] | None = None) -> int:
    """Validate every selected source feed and its URL-domain quality guard."""
    status_counts: Counter[str] = Counter()
    failures = sum(
        _validate_source(source_name, source_info, status_counts)
        for source_name, source_info in _selected_source_entries(data, only_names)
    )
    _print_summary(status_counts, failures)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate RSS sources in backend/app/data/rss_sources.json"
    )
    parser.add_argument(
        "--json-path",
        type=Path,
        default=RSS_SOURCES_PATH,
        help="Path to rss_sources.json",
    )
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help="Optional list of source names to validate",
    )
    args = parser.parse_args()
    data = json.loads(args.json_path.read_text(encoding="utf-8"))
    failures = validate_sources(data, only_names=set(args.only) if args.only else None)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
