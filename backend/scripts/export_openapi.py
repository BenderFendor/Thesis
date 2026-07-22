#!/usr/bin/env python3
"""Export or verify the canonical OpenAPI contract without starting the server."""

from __future__ import annotations

import argparse
import difflib
import json
from pathlib import Path

from app.main import app


DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"


def rendered_schema() -> str:
    """Return the running application's canonical formatted schema."""
    return json.dumps(app.openapi(), indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the output file differs from the application schema.",
    )
    args = parser.parse_args()

    generated = rendered_schema()
    if not args.check:
        args.output.write_text(generated, encoding="utf-8")
        print(f"Wrote {args.output}")
        return 0

    current = args.output.read_text(encoding="utf-8") if args.output.exists() else ""
    if current == generated:
        print(f"OpenAPI contract is current: {args.output}")
        return 0

    diff = difflib.unified_diff(
        current.splitlines(),
        generated.splitlines(),
        fromfile=str(args.output),
        tofile="app.openapi()",
        n=2,
    )
    print("OpenAPI contract drift detected")
    for line in list(diff)[:80]:
        print(line)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
