from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_API_BASE = "http://localhost:8000"
DEFAULT_QUERIES = [
    "what is going on with trump and israeli right now",
    "latest updates on ukraine war negotiations",
    "state of us inflation and jobs this week",
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_sections(answer_text: str) -> bool:
    lower = answer_text.lower()
    return "answer" in lower and "follow-up questions" in lower


async def run_once(query: str, api_base: str) -> Dict[str, Any]:
    params = {
        "query": query,
        "include_thinking": "true",
    }
    start_time = time.time()
    first_event_time: Optional[float] = None
    tool_calls = 0
    final_answer = ""

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "GET",
            f"{api_base}/api/news/research/stream",
            params=params,
            headers={"Accept": "text/event-stream"},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line.replace("data:", "", 1).strip()
                if not payload:
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if first_event_time is None:
                    first_event_time = time.time()
                event_type = event.get("type")
                if event_type == "tool_start":
                    tool_calls += 1
                if event_type == "thinking":
                    final_answer = event.get("content", "")
                if event_type == "complete":
                    result = event.get("result", {})
                    final_answer = result.get("answer", "") or final_answer
                    break
                if event_type == "error":
                    final_answer = event.get("message", "")
                    break

    elapsed = time.time() - start_time
    ttf = (first_event_time - start_time) if first_event_time else 0.0

    return {
        "query": query,
        "elapsed_seconds": round(elapsed, 2),
        "time_to_first_event": round(ttf, 2),
        "tool_calls": tool_calls,
        "answer_length": len(final_answer.strip()),
        "has_sections": _has_sections(final_answer),
        "answer": final_answer,
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Research agent lab harness.")
    parser.add_argument(
        "--api-base",
        default=DEFAULT_API_BASE,
        help="Override API base URL",
    )
    parser.add_argument(
        "--query",
        action="append",
        help="Custom query (repeatable).",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=1,
        help="Repeat each query this many times",
    )
    parser.add_argument(
        "--output",
        default=str(BASE_DIR / "lab_runs" / "latest.json"),
        help="Output path for results JSON",
    )
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    queries = args.query or DEFAULT_QUERIES
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    results: List[Dict[str, Any]] = []
    for query in queries:
        for _ in range(args.runs):
            result = asyncio.run(run_once(query, args.api_base))
            results.append(result)

    summary = {
        "timestamp": _utc_now(),
        "api_base": args.api_base,
        "total": len(results),
        "failures": sum(1 for item in results if not item.get("has_sections")),
        "results": results,
    }
    output_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
