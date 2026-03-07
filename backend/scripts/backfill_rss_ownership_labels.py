from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
RSS_SOURCES_PATH = ROOT / "backend" / "app" / "data" / "rss_sources.json"

SPECIFIC_LABELS: dict[str, str] = {
    "ABC News": "private broadcast network",
    "ABC News Australia": "public broadcaster",
    "Al Jazeera": "state-owned media network",
    "Amnesty International": "NGO-owned advocacy organization",
    "ANSA": "news cooperative",
    "Associated Press": "member-owned news cooperative",
    "BBC": "public broadcaster",
    "BBC News - Home": "public broadcaster",
    "BBC News - India": "public broadcaster",
    "BBC News - Science & Environment": "public broadcaster",
    "BBC News - World": "public broadcaster",
    "BBC Sport - Sport": "public broadcaster",
    "Bloomberg": "private financial media company",
    "CBC": "public broadcaster",
    "CBS News": "private broadcast network",
    "Channel NewsAsia": "state-affiliated broadcaster",
    "CNN": "private broadcast network",
    "CounterPunch": "independent magazine",
    "Democracy Now!": "nonprofit broadcaster",
    "Deutsche Welle": "public broadcaster",
    "Doctors Without Borders": "NGO-owned humanitarian organization",
    "Financial Times": "private newspaper group",
    "Focus Taiwan": "state-owned news agency",
    "Fox News": "private broadcast network",
    "France24": "public broadcaster",
    "Global Voices": "nonprofit international media network",
    "Hacker News": "platform-owned link aggregator",
    "Hacker News Frontpage": "platform-owned link aggregator",
    "Human Rights Watch": "NGO-owned advocacy organization",
    "Jamestown Foundation": "nonprofit think tank publication",
    "KCNA Watch": "state media monitoring project",
    "National Geographic": "private media brand",
    "NBC10 Philadelphia": "private broadcast affiliate",
    "NGO Monitor": "nonprofit advocacy organization",
    "NPR": "nonprofit broadcaster",
    "Project Syndicate": "nonprofit commentary network",
    "Prensa Latina": "state-owned news agency",
    "Press TV": "state media network",
    "Radio Farda": "government-funded broadcaster",
    "Radio Okapi": "nonprofit broadcaster",
    "Reuters": "private news and data company",
    "RT": "state media network",
    "Saudi Press Agency": "state-owned news agency",
    "TASS": "state-owned news agency",
    "The Atlantic - National": "private magazine publisher",
    "The Atlantic Wire": "private magazine publisher",
    "The Economist": "private news magazine group",
    "The Economist - Finance": "private news magazine group",
    "The Economist - International": "private news magazine group",
    "The Guardian": "trust-owned newspaper",
    "The Guardian - UK": "trust-owned newspaper",
    "The Wall Street Journal": "private newspaper",
    "The Washington Post": "private owner-controlled newspaper",
    "Truth Out": "nonprofit news organization",
    "War on the Rocks": "nonprofit analysis outlet",
    "Washington Times": "religious movement-owned newspaper",
    "Washington Times - Politics": "religious movement-owned newspaper",
    "WHYY": "public broadcaster",
    "Xinhua News Agency": "state-owned news agency",
    "Xinhua World News": "state-owned news agency",
}

PRIVATE_NEWSPAPER_KEYWORDS = (
    "daily star",
    "times",
    "post",
    "mail",
    "guardian",
    "chronicle",
    "tribune",
    "observer",
    "inquirer",
    "citizen",
    "standard",
    "express",
    "review",
    "herald",
    "gazette",
    "nation",
    "phoenix",
    "star",
)

MAGAZINE_KEYWORDS = ("magazine", "review", "affairs", "economist")


def infer_ownership_label(source_name: str, source_info: dict[str, Any]) -> str:
    specific = SPECIFIC_LABELS.get(source_name)
    if specific:
        return specific

    funding_type = str(source_info.get("funding_type", "")).strip().lower()
    category = str(source_info.get("category", "")).strip().lower()
    normalized_name = source_name.lower()

    if funding_type == "trust-owned":
        return "trust-owned publication"

    if funding_type == "public":
        if "agency" in normalized_name:
            return "public news agency"
        return "public broadcaster"

    if funding_type == "state-funded":
        if "agency" in normalized_name or "press agency" in normalized_name:
            return "state-owned news agency"
        if "radio" in normalized_name or "tv" in normalized_name:
            return "state broadcaster"
        return "state-funded outlet"

    if funding_type == "state-affiliated":
        if "agency" in normalized_name:
            return "state-affiliated news agency"
        if "channel" in normalized_name or "newsasia" in normalized_name:
            return "state-affiliated broadcaster"
        return "state-affiliated outlet"

    if funding_type == "non-profit":
        if any(
            token in normalized_name
            for token in ("rights", "amnesty", "doctors without borders", "monitor")
        ):
            return "NGO-owned nonprofit organization"
        if "syndicate" in normalized_name:
            return "nonprofit commentary network"
        return "nonprofit media organization"

    if funding_type == "independent":
        if any(token in normalized_name for token in MAGAZINE_KEYWORDS):
            return "independent magazine"
        if category in {"politics", "technology", "business"}:
            return "independent digital outlet"
        return "independent outlet"

    if funding_type == "commercial":
        if "agency" in normalized_name:
            return "private news agency"
        if any(token in normalized_name for token in ("radio", "tv", "newsnation")):
            return "private broadcaster"
        if any(token in normalized_name for token in MAGAZINE_KEYWORDS):
            return "private magazine publisher"
        if any(token in normalized_name for token in PRIVATE_NEWSPAPER_KEYWORDS):
            return "private newspaper"
        return "private media company"

    return "media outlet"


def backfill_ownership_labels(path: Path, write: bool) -> tuple[int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    updated = 0
    total = 0

    for source_name, source_info in data.items():
        if not isinstance(source_info, dict):
            continue
        total += 1
        if str(source_info.get("ownership_label", "")).strip():
            continue
        source_info["ownership_label"] = infer_ownership_label(source_name, source_info)
        updated += 1

    if write and updated:
        path.write_text(
            json.dumps(data, indent=4, ensure_ascii=True) + "\n", encoding="utf-8"
        )

    return updated, total


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill missing ownership_label fields in rss_sources.json."
    )
    parser.add_argument(
        "--json-path",
        type=Path,
        default=RSS_SOURCES_PATH,
        help="Path to rss_sources.json",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write the backfilled labels to disk. Without this flag the script is read-only.",
    )
    args = parser.parse_args()

    updated, total = backfill_ownership_labels(args.json_path, args.write)
    mode = "wrote" if args.write else "would write"
    print(f"{mode} {updated} ownership labels across {total} source entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
