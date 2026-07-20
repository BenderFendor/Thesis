#!/usr/bin/env python3
"""Fail when parser code contains outlet-specific answer-key facts."""

from __future__ import annotations
import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

BENCHMARK_NAMES = (
    "Washington Post", "New York Times", "Wall Street Journal", "Reuters", "Fox News",
    "Financial Times", "The Guardian", "BBC", "Associated Press", "NPR", "POLITICO",
    "The Economist", "Philadelphia Inquirer", "Tampa Bay Times", "USA TODAY", "NBC News",
    "MSNBC", "ABC News", "CNN", "Sinclair", "Bezos", "Murdoch", "Nash Holdings",
    "Woodbridge", "Versant",
)
PIPELINE_DIR_MARKERS = ("adapter", "parser", "resolver", "extractor", "materialize")
EXCLUDED_PARTS = {"proof_suite", "tests", "fixtures", "docs", "alembic", ".git", "node_modules"}

@dataclass(frozen=True, slots=True)
class Violation:
    path: Path
    line_number: int
    line: str
    reason: str


def _looks_like_pipeline(path: Path) -> bool:
    normalized = "/".join(part.casefold() for part in path.parts)
    return any(marker in normalized for marker in PIPELINE_DIR_MARKERS)


def scan_file(path: Path) -> list[Violation]:
    if any(part in EXCLUDED_PARTS for part in path.parts) or path.suffix not in {".py", ".ts", ".tsx", ".js", ".mjs"} or not _looks_like_pipeline(path):
        return []
    pattern = re.compile("|".join(re.escape(name) for name in BENCHMARK_NAMES), re.IGNORECASE)
    violations = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return []
    for line_number, line in enumerate(lines, start=1):
        if not pattern.search(line):
            continue
        lower = line.strip().casefold()
        reason = None
        if re.search(r"\b(if|elif|case|match)\b", lower):
            reason = "outlet-specific conditional"
        elif re.search(r"\b(owner|owned_by|parent|expected_path|hardcoded)\b\s*[:=]", lower):
            reason = "outlet-specific fact table"
        elif "candidate_same_entity" in lower or "same_legal_record" in lower:
            reason = "test-specific identity decision"
        if reason:
            violations.append(Violation(path, line_number, line.strip(), reason))
    return violations


def scan_paths(paths: Iterable[Path]) -> list[Violation]:
    violations = []
    for root in paths:
        if root.is_file():
            violations.extend(scan_file(root))
        else:
            for path in root.rglob("*"):
                if path.is_file():
                    violations.extend(scan_file(path))
    return sorted(violations, key=lambda item: (str(item.path), item.line_number))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", type=Path, default=[Path("backend/app")])
    violations = scan_paths(parser.parse_args().paths)
    for item in violations:
        print(f"{item.path}:{item.line_number}: {item.reason}: {item.line}")
    return 1 if violations else 0

if __name__ == "__main__":
    raise SystemExit(main())
