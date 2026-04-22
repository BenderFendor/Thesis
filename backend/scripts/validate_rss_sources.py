from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
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


def count_items(root: ET.Element) -> int:
    tag = root.tag.lower()
    if "rss" in tag:
        return len(root.findall("./channel/item"))
    if "feed" in tag or "atom" in tag:
        atom_ns = {"atom": "http://www.w3.org/2005/Atom"}
        entries = root.findall("./atom:entry", atom_ns)
        if entries:
            return len(entries)
        return len(root.findall("./entry"))
    return 0


def _first_article_domain(url: str) -> str | None:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CONTEXT) as response:
        body = response.read()

    root = ET.fromstring(body)
    source_url = root.find("./channel/item/source")
    if source_url is not None:
        source_attr = source_url.get("url")
        if isinstance(source_attr, str) and source_attr.strip():
            host = extract_host(source_attr.strip())
            if host:
                return host
    # RSS
    item_link = root.findtext("./channel/item/link")
    if isinstance(item_link, str) and item_link.strip():
        host = extract_host(item_link.strip())
        if host:
            return host
    channel_link = root.findtext("./channel/link")
    if isinstance(channel_link, str) and channel_link.strip():
        host = extract_host(channel_link.strip())
        if host:
            return host
    # Atom
    atom_ns = {"atom": "http://www.w3.org/2005/Atom"}
    entry_link = root.find("./atom:entry/atom:link", atom_ns)
    if entry_link is not None:
        href = entry_link.get("href")
        if isinstance(href, str) and href.strip():
            host = extract_host(href.strip())
            if host:
                return host
    entry_link_plain = root.find("./entry/link")
    if entry_link_plain is not None:
        href = entry_link_plain.get("href")
        if isinstance(href, str) and href.strip():
            host = extract_host(href.strip())
            if host:
                return host
    return None


def validate_url(url: str) -> tuple[bool, str, int | None]:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CONTEXT) as response:
        status = getattr(response, "status", None)
        content_type = response.headers.get("Content-Type", "")
        body = response.read()

    root = ET.fromstring(body)
    items = count_items(root)
    if items <= 0:
        return False, f"parsed XML but found {items} items", status

    if "html" in content_type.lower():
        return False, f"returned HTML content-type {content_type}", status

    return True, f"status={status} items={items} root={root.tag}", status


def validate_sources(
    data: dict[str, Any], *, only_names: set[str] | None = None
) -> int:
    failures = 0
    status_counts: Counter[str] = Counter()

    for source_name, source_info in data.items():
        if only_names is not None and source_name not in only_names:
            continue
        if not isinstance(source_info, dict):
            print(f"FAIL\t{source_name}\tinvalid entry type")
            failures += 1
            continue

        urls = iter_urls(source_info.get("url"))
        if not urls:
            print(f"FAIL\t{source_name}\tmissing url")
            failures += 1
            continue

        for url in urls:
            try:
                ok, detail, status = validate_url(url)
            except urllib.error.HTTPError as exc:
                ok = False
                detail = f"HTTPError status={exc.code}"
                status = exc.code
            except Exception as exc:
                ok = False
                detail = f"{type(exc).__name__}: {exc}"
                status = None

            status_key = str(status) if status is not None else "error"
            status_counts[status_key] += 1

            if ok:
                print(f"OK\t{source_name}\t{url}\t{detail}")
            else:
                print(f"FAIL\t{source_name}\t{url}\t{detail}")
                failures += 1

        # Lightweight URL quality guard
        feed_host = extract_host(urls[0]) if urls else ""
        configured_host = extract_domain(urls[0]) or ""
        site_url = source_info.get("site_url")
        site_host = extract_domain(site_url) or ""

        inferred_site = normalize_site_url(urls[0]) if urls else None
        inferred_site_host = extract_domain(inferred_site) or ""

        article_domain = None
        try:
            article_domain = _first_article_domain(urls[0]) if urls else None
        except Exception:
            article_domain = None

        if feed_host in AGGREGATOR_HOSTS:
            if configured_host and (
                (site_host and hosts_match(configured_host, site_host))
                or (article_domain and hosts_match(configured_host, article_domain))
            ):
                print(
                    f"GUARD\t{source_name}\tstatus=ok\treason=site_scoped_aggregator_matches_target\tconfigured={configured_host}\tfeed_host={feed_host}\tsite_url={site_host or '-'}\tarticle_domain={article_domain or '-'}"
                )
            else:
                print(
                    f"GUARD\t{source_name}\tstatus=mismatch\treason=aggregator_feed\tconfigured={configured_host or feed_host}\tfeed_host={feed_host}\tinferred_site={inferred_site_host or '-'}\tarticle_domain={article_domain or '-'}"
                )
        elif (
            site_host
            and configured_host
            and not hosts_match(configured_host, site_host)
        ):
            print(
                f"GUARD\t{source_name}\tstatus=mismatch\treason=site_url_mismatch\tconfigured={configured_host}\tsite_url={site_host}\tarticle_domain={article_domain or '-'}"
            )
        elif (
            inferred_site_host
            and configured_host
            and not hosts_match(configured_host, inferred_site_host)
        ):
            print(
                f"GUARD\t{source_name}\tstatus=mismatch\treason=inferred_site_mismatch\tconfigured={configured_host}\tinferred_site={inferred_site_host}\tarticle_domain={article_domain or '-'}"
            )
        elif (
            article_domain
            and configured_host
            and not hosts_match(configured_host, article_domain)
        ):
            print(
                f"GUARD\t{source_name}\tstatus=mismatch\treason=first_article_domain_mismatch\tconfigured={configured_host}\tarticle_domain={article_domain}"
            )
        else:
            print(
                f"GUARD\t{source_name}\tstatus=ok\tconfigured={configured_host or '-'}\tsite_url={site_host or inferred_site_host or '-'}\tarticle_domain={article_domain or '-'}"
            )

    print("SUMMARY")
    for key, count in sorted(status_counts.items()):
        print(f"{key}\t{count}")
    print(f"FAILURES\t{failures}")
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
    only_names = set(args.only) if args.only else None
    failures = validate_sources(data, only_names=only_names)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
