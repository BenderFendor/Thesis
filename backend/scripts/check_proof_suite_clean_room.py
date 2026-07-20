#!/usr/bin/env python3
"""Fail when evidence-spine pipeline code contains outlet-specific answer-key facts.

This is a static, best-effort scan, not a proof of a clean pipeline. It
cannot catch every way a benchmark fact could be hardcoded (a hash
comparison, a lookup keyed by an opaque ID, a name assembled at runtime).
The proof suite's real clean-room guarantee comes from pairing this scan
with the mutation tests (see docs/scoop-evidence-spine.md and
tests/test_proof_suite_registry.py), which perturb the *input evidence* and
check that the *output* changes accordingly -- that catches hardcoding this
scanner cannot see, no matter how the forbidden fact is encoded. Treat a
clean run here as "no obvious violation found", not a certificate.

Scope: this only needs to cover the evidence-spine ingestion/acceptance/
materialization/proof-bundle pipeline, not the whole backend -- the rest of
this app is a general news aggregator that legitimately references real
outlet names everywhere (RSS feed configs, credibility datasets, source
profiles), and scanning all of `app/` for those names would drown the
signal in thousands of unrelated hits. A file is in scope if either:

  1. it matches the legacy naming heuristic (a path segment containing
     "adapter", "parser", "resolver", "extractor", or "materialize"), or
  2. its path (relative to the scan root or not) ends with one of the
     `PIPELINE_ALLOWLIST` suffixes below -- the actual evidence-spine
     modules, enumerated explicitly so a new pipeline file with a
     generic-looking name elsewhere in the tree is still covered once it's
     added here, rather than silently evading both directory-name checks.

Adding a new evidence-spine pipeline module? Add its path suffix to
`PIPELINE_ALLOWLIST` (mirror `.github/workflows/evidence-spine.yml`'s path
filters, which track the same surface).
"""

from __future__ import annotations
import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Iterable

# Canonical benchmark entity -> every spelling/alias/abbreviation a parser
# could plausibly hardcode. Matching is done on a normalized (casefolded,
# punctuation-and-whitespace-stripped) form, so "U.S.A. Today", "usa-today",
# and a name split across a line break in a multiline literal are all the
# same forbidden term (see `_normalize`).
BENCHMARK_ALIASES: dict[str, tuple[str, ...]] = {
    "Washington Post": ("Washington Post", "WaPo", "WAPO"),
    "New York Times": ("New York Times", "NYT", "NY Times"),
    "Wall Street Journal": ("Wall Street Journal", "WSJ"),
    "Reuters": ("Reuters",),
    "Fox News": ("Fox News", "FNC"),
    "Financial Times": ("Financial Times", "FT"),
    "The Guardian": ("The Guardian", "Guardian"),
    "BBC": ("BBC", "British Broadcasting Corporation"),
    "Associated Press": ("Associated Press", "AP"),
    "NPR": ("NPR", "National Public Radio"),
    "POLITICO": ("POLITICO", "Politico"),
    "The Economist": ("The Economist", "Economist"),
    "Philadelphia Inquirer": ("Philadelphia Inquirer", "Philly Inquirer"),
    "Tampa Bay Times": ("Tampa Bay Times",),
    "USA TODAY": ("USA TODAY", "USA Today", "USAT"),
    "NBC News": ("NBC News", "NBC"),
    "MSNBC": ("MSNBC",),
    "ABC News": ("ABC News", "ABC News Group"),
    "CNN": ("CNN", "Cable News Network"),
    "Sinclair": ("Sinclair", "Sinclair Broadcast Group", "Sinclair Inc"),
    "Bezos": ("Bezos", "Jeff Bezos"),
    "Murdoch": ("Murdoch", "Rupert Murdoch"),
    "Nash Holdings": ("Nash Holdings",),
    "Woodbridge": ("Woodbridge",),
    "Versant": ("Versant",),
}

PIPELINE_DIR_MARKERS = ("adapter", "parser", "resolver", "extractor", "materialize")

# The real evidence-spine pipeline surface, mirrored from the path filters in
# .github/workflows/evidence-spine.yml. `proof_suite/cases.py` is the public
# benchmark registry itself (the case labels ARE the benchmark, not a
# parser's answer key) and is deliberately excluded via EXCLUDED_PARTS.
PIPELINE_ALLOWLIST = (
    Path("app/models/evidence.py"),
    Path("app/models/evidence_api.py"),
    Path("app/models/atlas.py"),
    Path("app/services/evidence_spine.py"),
    Path("app/services/evidence_policy.py"),
    Path("app/services/evidence_export.py"),
    Path("app/services/ownership_math.py"),
    Path("app/services/claim_comparison.py"),
    Path("app/services/atlas_entity.py"),
    Path("app/services/atlas_evidence_projection.py"),
    Path("app/services/atlas_export.py"),
    Path("app/services/atlas_graph.py"),
    Path("app/services/atlas_graph_helpers.py"),
    Path("app/services/atlas_graph_projection.py"),
    Path("app/proof_suite/runner.py"),
    Path("app/api/routes/wiki_evidence.py"),
    Path("app/api/routes/wiki_atlas.py"),
    Path("scripts/migrate_legacy_ownership_to_evidence.py"),
)

# Suspicious keys/keywords searched for in the raw text around a hit, used
# only to classify *why* a hit is a violation (every classification below is
# itself a violation, "outlet-specific literal" is the catch-all).
_CONDITIONAL_RE = re.compile(r"\b(if|elif|case|match)\b", re.IGNORECASE)
_FACT_TABLE_RE = re.compile(
    r"\b(owner|owned_by|parent|expected_path|hardcoded)\b\s*[:=]", re.IGNORECASE
)
_IDENTITY_DECISION_RE = re.compile(
    r"\bcandidate_same_entity\b|\bsame_legal_record\b", re.IGNORECASE
)

# A line ending in this marker suppresses a hit on that line -- for the rare,
# explicit case where in-scope pipeline code legitimately names a benchmark
# entity (e.g. a comment cross-referencing a case ID). Prefer excluding the
# whole file via EXCLUDED_PARTS/PIPELINE_ALLOWLIST when possible.
SUPPRESSION_MARKER = "clean-room-allow"

EXCLUDED_PARTS = {"proof_suite", "tests", "fixtures", "docs", "alembic", ".git", "node_modules"}
SCANNED_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs"}


@dataclass(frozen=True, slots=True)
class Violation:
    path: Path
    line_number: int
    line: str
    reason: str
    matched_term: str


def _looks_like_pipeline(path: Path) -> bool:
    normalized = "/".join(part.casefold() for part in path.parts)
    if any(marker in normalized for marker in PIPELINE_DIR_MARKERS):
        return True
    return any(str(path).endswith(str(allowed)) for allowed in PIPELINE_ALLOWLIST)


def _normalize(text: str) -> tuple[str, list[int]]:
    """Casefold, collapse whitespace/punctuation runs to single spaces, and
    keep a per-char line-number map.

    Collapsing (not deleting) separators means a name split across a line
    break in a multiline literal -- e.g. a dict spanning several lines with
    `"Washington"` on one line and `"Post"` on the next -- normalizes to the
    same single-space-joined phrase as the one-line form, so it can't evade a
    match by being reformatted across lines. Word boundaries are preserved
    (rather than deleted entirely), so short aliases like "AP" or "FT" can
    still be matched with `\\b` and won't fire inside ordinary words like
    "append" or "draft".
    """
    normalized_chars: list[str] = []
    line_numbers: list[int] = []
    line_number = 1
    pending_space = False
    for char in text:
        if char == "\n":
            line_number += 1
            pending_space = True
            continue
        if char.isalnum():
            if pending_space and normalized_chars:
                normalized_chars.append(" ")
                line_numbers.append(line_number)
            pending_space = False
            normalized_chars.append(char.casefold())
            line_numbers.append(line_number)
        else:
            pending_space = True
    return "".join(normalized_chars), line_numbers


def _normalize_term(term: str) -> str:
    return " ".join("".join(char for char in word if char.isalnum()) for word in term.split())


_TERM_PATTERNS: dict[str, re.Pattern[str]] = {
    alias: re.compile(r"\b" + re.escape(normalized).replace(r"\ ", r"\s+") + r"\b")
    for aliases in BENCHMARK_ALIASES.values()
    for alias in aliases
    for normalized in (_normalize_term(alias).casefold(),)
    if normalized
}


def _classify(window: str) -> str:
    if _CONDITIONAL_RE.search(window):
        return "outlet-specific conditional"
    if _FACT_TABLE_RE.search(window):
        return "outlet-specific fact table"
    if _IDENTITY_DECISION_RE.search(window):
        return "test-specific identity decision"
    return "outlet-specific literal"


def scan_file(path: Path) -> list[Violation]:
    if (
        any(part in EXCLUDED_PARTS for part in path.parts)
        or path.suffix not in SCANNED_SUFFIXES
        or not _looks_like_pipeline(path)
    ):
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    normalized, line_numbers = _normalize(text)
    if not normalized:
        return []
    raw_lines = text.splitlines()

    violations: list[Violation] = []
    seen_spans: set[tuple[int, int]] = set()
    for term, pattern in _TERM_PATTERNS.items():
        for match in pattern.finditer(normalized):
            span_start_line = line_numbers[match.start()]
            span_end_line = line_numbers[min(match.end() - 1, len(line_numbers) - 1)]
            key = (span_start_line, span_end_line)
            if key in seen_spans:
                continue
            raw_line = (
                raw_lines[span_start_line - 1] if span_start_line - 1 < len(raw_lines) else ""
            )
            if SUPPRESSION_MARKER in raw_line:
                continue
            window_text = "\n".join(
                raw_lines[max(0, span_start_line - 3) : min(len(raw_lines), span_end_line + 2)]
            )
            seen_spans.add(key)
            violations.append(
                Violation(
                    path=path,
                    line_number=span_start_line,
                    line=raw_line.strip(),
                    reason=_classify(window_text),
                    matched_term=term,
                )
            )
    return sorted(violations, key=lambda item: item.line_number)


def scan_paths(paths: Iterable[Path]) -> list[Violation]:
    violations = []
    for root in paths:
        if root.is_file():
            violations.extend(scan_file(root))
        else:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    violations.extend(scan_file(path))
    return sorted(violations, key=lambda item: (str(item.path), item.line_number))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", type=Path, default=[Path("backend/app")])
    violations = scan_paths(parser.parse_args().paths)
    for item in violations:
        print(f"{item.path}:{item.line_number}: {item.reason} ({item.matched_term}): {item.line}")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
