"""Retrieve primary-source corpus bodies and pin their request metadata and hashes."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import httpx

from app.core.config import SCOOP_BROWSER_UA

DEFAULT_CORPUS = Path(__file__).resolve().parents[1] / "tests" / "evidence_corpus"
SEC_USER_AGENT = os.getenv("SCOOP_SEC_USER_AGENT", "").strip()


async def _capture(
    client: httpx.AsyncClient, semaphore: asyncio.Semaphore, case_id: str, index: int, url: str
) -> tuple[str, int, str, bytes, str, str]:
    async with semaphore:
        if "sec.gov/" in url and not SEC_USER_AGENT:
            raise RuntimeError(
                "SCOOP_SEC_USER_AGENT is required for SEC captures and must include contact information"
            )
        user_agent = SEC_USER_AGENT if "sec.gov/" in url else SCOOP_BROWSER_UA
        response = await client.get(url, headers={"Accept": "*/*", "User-Agent": user_agent})
        response.raise_for_status()
    return (
        case_id,
        index,
        str(response.url),
        response.content,
        response.headers.get("content-type", "application/octet-stream"),
        user_agent,
    )


async def run(corpus: Path) -> list[str]:
    """Capture every URL in the manifest and update only mechanical metadata."""
    manifest_path = corpus / "manifest.json"
    manifest = cast(dict[str, Any], json.loads(manifest_path.read_text(encoding="utf-8")))
    cases = cast(list[dict[str, Any]], manifest["cases"])
    semaphore = asyncio.Semaphore(4)
    timeout = httpx.Timeout(45.0, connect=15.0)
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, headers={"User-Agent": SCOOP_BROWSER_UA}
    ) as client:
        tasks = [
            _capture(client, semaphore, str(case["case_id"]), index, str(url))
            for case in cases
            for index, url in enumerate(cast(list[str], case.get("source_urls") or []))
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    captures_by_case: dict[str, list[dict[str, Any]]] = {str(case["case_id"]): [] for case in cases}
    failures: list[str] = []
    retrieved_at = datetime.now(UTC).isoformat()
    raw_root = corpus / "raw"
    raw_root.mkdir(parents=True, exist_ok=True)
    for result in results:
        if isinstance(result, BaseException):
            failures.append(f"{type(result).__name__}: {result}")
            continue
        case_id, index, final_url, body, content_type, user_agent = result
        relative = Path("raw") / f"{case_id}-{index + 1}.capture"
        path = corpus / relative
        path.write_bytes(body)
        captures_by_case[case_id].append(
            {
                "path": relative.as_posix(),
                "sha256": hashlib.sha256(body).hexdigest(),
                "source_url": final_url,
                "retrieved_at": retrieved_at,
                "http_status": 200,
                "content_type": content_type,
                "request": {"method": "GET", "user_agent": user_agent},
            }
        )
    for case in cases:
        case["captures"] = captures_by_case[str(case["case_id"])]
        if not case["captures"]:
            failures.append(f"{case['case_id']}: no capture completed")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return failures


def main() -> int:
    """Run corpus retrieval and fail when any required source was unavailable."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    args = parser.parse_args()
    failures = asyncio.run(run(args.corpus))
    if failures:
        for failure in failures:
            print(failure)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
