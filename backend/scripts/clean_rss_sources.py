#!/usr/bin/env python3
"""Clean and curate backend/app/data/rss_sources.json.

Creates a timestamped backup, removes known low-quality sources (reddit, tabloids,
celebrity gossip, overly-niche sports like cricket-only if desired), and writes
both a cleaned file and a flagged list for manual review.

Run: python3 backend/scripts/clean_rss_sources.py
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parents[1]
RSS_PATH = ROOT / "app" / "data" / "rss_sources.json"


def load_sources(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text())


def save_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def backup(path: Path) -> Path:
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    bak = path.with_suffix(f".json.bak.{ts}")
    shutil.copy2(path, bak)
    return bak


LOW_QUALITY_DOMAINS = (
    "reddit.com",
    "dailymail.co.uk",
    "popsugar.com",
    "tmz.com",
    "eonline.com",
    "celebrity",
    "gossip",
    "cheezburger",
)

TABLOID_KEYWORDS = ("celebr", "gossip", "tabloid", "rumor", "rumour", "perez")


def is_low_quality(key: str, entry: Dict[str, Any]) -> bool:
    url = entry.get("url")
    if isinstance(url, list):
        urls = url
    else:
        urls = [url]

    # domain checks
    for u in urls:
        if not u:
            continue
        low = any(d in u for d in LOW_QUALITY_DOMAINS)
        if low:
            return True

    # key-based heuristics
    k = key.lower()
    if any(tok in k for tok in TABLOID_KEYWORDS):
        return True

    # remove extremely niche single-sport feeds labelled as cricket/tennis etc? keep configurable
    cat = (entry.get("category") or "").lower()
    if "cricket" in cat or "celebrity" in cat:
        return True

    return False


def should_flag(key: str, entry: Dict[str, Any]) -> bool:
    """Return True for borderline sources to review manually."""
    k = key.lower()
    cat = (entry.get("category") or "").lower()
    url = entry.get("url") or ""
    url_text = " ".join(url) if isinstance(url, list) else str(url)

    # flag fashion, beauty, lifestyle, startup/finance blogs that might be ok
    flag_keywords = (
        "fashion",
        "beauty",
        "lifestyle",
        "startup",
        "finance",
        "personal",
        "blog",
        "opinion",
        "entrepreneur",
    )
    if any(tok in k for tok in flag_keywords) or any(
        tok in cat for tok in flag_keywords
    ):
        return True

    # borderline entertainment / tv
    if any(tok in cat for tok in ("tv", "film", "entertainment")) and "ign" not in k:
        return True

    return False


def clean_sources(sources: Dict[str, Any]) -> (Dict[str, Any], Dict[str, Any]):
    cleaned: Dict[str, Any] = {}
    flagged: Dict[str, Any] = {}

    for key, entry in sources.items():
        try:
            if is_low_quality(key, entry):
                # skip low-quality
                continue

            if should_flag(key, entry):
                flagged[key] = entry
                # keep flagged entries in cleaned set for now
                cleaned[key] = entry
            else:
                cleaned[key] = entry
        except Exception:
            # on error preserve the entry and flag it
            flagged[key] = entry
            cleaned[key] = entry

    return cleaned, flagged


def main() -> int:
    if not RSS_PATH.exists():
        print(f"rss sources file not found: {RSS_PATH}")
        return 2

    print("Loading sources...")
    sources = load_sources(RSS_PATH)

    print("Creating backup...")
    bak = backup(RSS_PATH)
    print(f"Backed up to: {bak}")

    print("Cleaning sources...")
    cleaned, flagged = clean_sources(sources)

    cleaned_path = RSS_PATH.with_name("rss_sources.cleaned.json")
    flagged_path = RSS_PATH.with_name("rss_sources.flagged.json")

    print(f"Writing cleaned file: {cleaned_path}")
    save_json(cleaned_path, cleaned)

    print(f"Writing flagged file: {flagged_path}")
    save_json(flagged_path, flagged)

    print("Done. Review the flagged list and replace the original file if satisfied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
