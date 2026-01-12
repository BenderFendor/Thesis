#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Tuple

DEFAULT_ENCODING = "utf-8"


ERROR_LINE_RE = re.compile(
    r"(?i)(?:\berror\b|\bexception\b|\btraceback\b|\bpanic\b|\bfatal\b|\bfailed\b|connecterror|connection refused|timed out)"
)

TRACEBACK_START_RE = re.compile(r"^Traceback \(most recent call last\):")


@dataclass(frozen=True)
class FileIndexItem:
    path: str
    size_bytes: int
    mtime_utc: str


@dataclass(frozen=True)
class ErrorGroup:
    signature: str
    count: int
    example: str
    files: List[str]


@dataclass(frozen=True)
class TriageResult:
    input: str
    generated_at_utc: str
    include_glob: str
    files_indexed: int
    total_bytes: int
    groups: List[ErrorGroup]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_mkdir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def iter_files(root: Path, include_glob: str) -> List[Path]:
    # Use Path.rglob for glob-like include.
    # include_glob is applied to the filename only.
    files: List[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if (
            path.name == include_glob
            or path.match(include_glob)
            or path.name.endswith(include_glob.lstrip("*"))
        ):
            files.append(path)
    return sorted(files, key=lambda p: p.stat().st_mtime)


def normalize_signature(line: str) -> str:
    s = line.strip()
    s = re.sub(r"\b0x[0-9a-fA-F]+\b", "0x…", s)
    s = re.sub(r"\b\d+\b", "#", s)
    s = re.sub(r"\s+", " ", s)
    return s[:240]


def take_context(lines: List[str], idx: int, before: int, after: int) -> str:
    start = max(0, idx - before)
    end = min(len(lines), idx + after + 1)
    return "".join(lines[start:end])


def hash_text(text: str) -> str:
    return hashlib.sha1(text.encode(DEFAULT_ENCODING, errors="replace")).hexdigest()[
        :12
    ]


def read_text_lines(path: Path, encoding: str) -> List[str]:
    return path.read_text(encoding=encoding, errors="replace").splitlines(keepends=True)


def extract_error_candidates(lines: List[str]) -> List[int]:
    indices: List[int] = []
    for i, line in enumerate(lines):
        if ERROR_LINE_RE.search(line):
            indices.append(i)
    return indices


def choose_signature(lines: List[str], idx: int) -> str:
    # Prefer a concise error-like line, else fall back to the matching line.
    line = lines[idx].strip()

    if TRACEBACK_START_RE.match(line):
        # Look ahead for the last non-empty line in the traceback block.
        last = line
        for j in range(idx + 1, min(idx + 80, len(lines))):
            if lines[j].strip() == "":
                continue
            last = lines[j].strip()
        return normalize_signature(last)

    return normalize_signature(line)


def write_sample(output_samples: Path, signature: str, sample_text: str) -> str:
    sample_id = hash_text(signature + "\n" + sample_text)
    sample_path = output_samples / f"{sample_id}.txt"
    sample_path.write_text(sample_text, encoding=DEFAULT_ENCODING, errors="replace")
    return str(sample_path)


def triage_logs(
    *,
    input_dir: Path,
    output_dir: Path,
    include_glob: str,
    encoding: str,
    context_before: int,
    context_after: int,
    max_groups: int,
) -> TriageResult:
    safe_mkdir(output_dir)
    samples_dir = output_dir / "samples"
    safe_mkdir(samples_dir)

    files = iter_files(input_dir, include_glob)

    index_items: List[FileIndexItem] = []
    total_bytes = 0

    group_counts: Dict[str, int] = {}
    group_example: Dict[str, str] = {}
    group_files: Dict[str, List[str]] = {}

    for path in files:
        stat = path.stat()
        total_bytes += stat.st_size
        index_items.append(
            FileIndexItem(
                path=str(path),
                size_bytes=stat.st_size,
                mtime_utc=datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat(),
            )
        )

        try:
            lines = read_text_lines(path, encoding)
        except Exception:
            continue

        candidates = extract_error_candidates(lines)
        for idx in candidates:
            sig = choose_signature(lines, idx)
            group_counts[sig] = group_counts.get(sig, 0) + 1
            group_files.setdefault(sig, [])
            if str(path) not in group_files[sig]:
                group_files[sig].append(str(path))
            if sig not in group_example:
                sample = take_context(lines, idx, context_before, context_after)
                sample_path = write_sample(samples_dir, sig, sample)
                group_example[sig] = (
                    f"{path}:{idx + 1}\n(sample: {sample_path})\n{sample}"
                )

    sorted_groups = sorted(group_counts.items(), key=lambda kv: kv[1], reverse=True)
    groups: List[ErrorGroup] = []
    for sig, count in sorted_groups[:max_groups]:
        groups.append(
            ErrorGroup(
                signature=sig,
                count=count,
                example=group_example.get(sig, ""),
                files=group_files.get(sig, []),
            )
        )

    # Write outputs
    (output_dir / "index.json").write_text(
        json.dumps([asdict(item) for item in index_items], indent=2),
        encoding=DEFAULT_ENCODING,
    )

    result = TriageResult(
        input=str(input_dir),
        generated_at_utc=utc_now(),
        include_glob=include_glob,
        files_indexed=len(files),
        total_bytes=total_bytes,
        groups=groups,
    )

    (output_dir / "errors.json").write_text(
        json.dumps(asdict(result), indent=2),
        encoding=DEFAULT_ENCODING,
    )

    text_lines: List[str] = []
    text_lines.append(f"Generated: {result.generated_at_utc}\n")
    text_lines.append(f"Input: {result.input}\n")
    text_lines.append(f"Include: {result.include_glob}\n")
    text_lines.append(f"Files indexed: {result.files_indexed}\n")
    text_lines.append(f"Total bytes: {result.total_bytes}\n\n")

    for g in groups:
        text_lines.append("=" * 80 + "\n")
        text_lines.append(f"count: {g.count}\n")
        text_lines.append(f"signature: {g.signature}\n")
        text_lines.append(f"files: {len(g.files)}\n")
        for f in g.files[:10]:
            text_lines.append(f"  - {f}\n")
        if len(g.files) > 10:
            text_lines.append(f"  ... {len(g.files) - 10} more\n")
        text_lines.append("\n")
        text_lines.append(g.example)
        if not g.example.endswith("\n"):
            text_lines.append("\n")

    (output_dir / "errors.txt").write_text(
        "".join(text_lines), encoding=DEFAULT_ENCODING
    )

    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Triage a log directory by extracting and grouping error lines. "
            "Produces small, grepable artifacts instead of requiring full-log context."
        )
    )
    parser.add_argument("--input", required=True, help="Directory containing logs")
    parser.add_argument(
        "--output", required=True, help="Output directory for triage artifacts"
    )
    parser.add_argument(
        "--include",
        default="*.log*",
        help="Filename glob to include (default: *.log*)",
    )
    parser.add_argument(
        "--encoding",
        default=DEFAULT_ENCODING,
        help=f"Input encoding (default: {DEFAULT_ENCODING})",
    )
    parser.add_argument("--context-before", type=int, default=20)
    parser.add_argument("--context-after", type=int, default=40)
    parser.add_argument("--max-groups", type=int, default=50)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()

    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {input_dir}")

    triage_logs(
        input_dir=input_dir,
        output_dir=output_dir,
        include_glob=args.include,
        encoding=args.encoding,
        context_before=args.context_before,
        context_after=args.context_after,
        max_groups=args.max_groups,
    )


if __name__ == "__main__":
    main()
