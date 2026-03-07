from __future__ import annotations

import argparse
import json
import ssl
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
RSS_SOURCES_PATH = ROOT / "backend" / "app" / "data" / "rss_sources.json"

_SSL_CONTEXT = ssl._create_unverified_context()
HEADERS = {"User-Agent": "NewsAggregator/1.0"}


def iter_urls(url_field: Any) -> list[str]:
    if isinstance(url_field, str) and url_field.strip():
        return [url_field.strip()]
    if isinstance(url_field, list):
        return [
            item.strip() for item in url_field if isinstance(item, str) and item.strip()
        ]
    return []


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
