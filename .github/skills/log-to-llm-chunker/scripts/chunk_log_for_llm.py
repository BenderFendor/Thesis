#!/usr/bin/env python3

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path


DEFAULT_TARGET_TOKENS = 500_000
DEFAULT_CHARS_PER_TOKEN = 4
DEFAULT_ENCODING = "utf-8"


@dataclass(frozen=True)
class ChunkResult:
    source: str
    output_dir: str
    target_tokens: int
    chars_per_token: int
    num_parts: int
    total_chars_written: int
    parts: list[str]


def safe_mkdir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def iter_text_lines(path: Path, encoding: str):
    with path.open("r", encoding=encoding, errors="replace") as file:
        for line in file:
            yield line


def split_overlong_line(line: str, max_chars: int) -> list[str]:
    if max_chars <= 0:
        raise ValueError("max_chars must be > 0")

    if len(line) <= max_chars:
        return [line]

    parts: list[str] = []
    start = 0
    while start < len(line):
        end = min(start + max_chars, len(line))
        parts.append(line[start:end])
        start = end

    return parts


def chunk_log(
    *,
    input_path: Path,
    output_dir: Path,
    target_tokens: int,
    chars_per_token: int,
    encoding: str,
    prefix: str,
    write_manifest: bool,
) -> ChunkResult:
    if target_tokens <= 0:
        raise ValueError("target_tokens must be > 0")
    if chars_per_token <= 0:
        raise ValueError("chars_per_token must be > 0")

    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")
    if not input_path.is_file():
        raise ValueError(f"Input must be a file: {input_path}")

    safe_mkdir(output_dir)

    max_chars = target_tokens * chars_per_token

    parts: list[str] = []
    part_index = 1
    buffer_lines: list[str] = []
    buffer_chars = 0
    total_chars_written = 0

    def flush() -> None:
        nonlocal part_index, buffer_lines, buffer_chars, total_chars_written
        if not buffer_lines:
            return

        part_name = f"{prefix}-part-{part_index:04d}.txt"
        part_path = output_dir / part_name
        text = "".join(buffer_lines)
        part_path.write_text(text, encoding=DEFAULT_ENCODING, errors="replace")

        parts.append(str(part_path))
        part_index += 1
        total_chars_written += len(text)
        buffer_lines = []
        buffer_chars = 0

    for line in iter_text_lines(input_path, encoding=encoding):
        for piece in split_overlong_line(line, max_chars=max_chars):
            if buffer_chars + len(piece) > max_chars and buffer_lines:
                flush()
            buffer_lines.append(piece)
            buffer_chars += len(piece)

    flush()

    result = ChunkResult(
        source=str(input_path),
        output_dir=str(output_dir),
        target_tokens=target_tokens,
        chars_per_token=chars_per_token,
        num_parts=len(parts),
        total_chars_written=total_chars_written,
        parts=parts,
    )

    if write_manifest:
        manifest_path = output_dir / f"{prefix}-manifest.json"
        manifest_path.write_text(
            json.dumps(asdict(result), indent=2), encoding=DEFAULT_ENCODING
        )

    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Split a large log (text) file into multiple plain-text parts sized for LLM review. "
            "Token sizing is approximated by chars-per-token."
        )
    )
    parser.add_argument("--input", required=True, help="Path to input .log/.txt file")
    parser.add_argument(
        "--output", required=True, help="Output directory for chunk files"
    )
    parser.add_argument(
        "--target-tokens",
        type=int,
        default=DEFAULT_TARGET_TOKENS,
        help=f"Approx tokens per chunk (default: {DEFAULT_TARGET_TOKENS})",
    )
    parser.add_argument(
        "--chars-per-token",
        type=int,
        default=DEFAULT_CHARS_PER_TOKEN,
        help=(
            f"Token approximation ratio (default: {DEFAULT_CHARS_PER_TOKEN}). "
            "Common rough values: 3-5."
        ),
    )
    parser.add_argument(
        "--encoding",
        default=DEFAULT_ENCODING,
        help=f"Input encoding (default: {DEFAULT_ENCODING})",
    )
    parser.add_argument(
        "--prefix",
        default=None,
        help="Output filename prefix (default: input filename stem)",
    )
    parser.add_argument(
        "--no-manifest",
        action="store_true",
        help="Do not write a manifest JSON",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()
    prefix = args.prefix or input_path.stem

    result = chunk_log(
        input_path=input_path,
        output_dir=output_dir,
        target_tokens=args.target_tokens,
        chars_per_token=args.chars_per_token,
        encoding=args.encoding,
        prefix=prefix,
        write_manifest=not args.no_manifest,
    )

    print(
        json.dumps(
            {
                "source": result.source,
                "output_dir": result.output_dir,
                "target_tokens": result.target_tokens,
                "chars_per_token": result.chars_per_token,
                "num_parts": result.num_parts,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
