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
    "what is going on with trump and iran right now",
    "latest updates on ukraine war negotiations",
    "state of us inflation and jobs this week",
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _has_sections(answer_text: str) -> bool:
    lower = answer_text.lower()
    return "answer" in lower


def _step_status_label(step_type: str) -> str:
    if step_type == "thought":
        return "Working through the question."
    if step_type in {"tool_start", "action"}:
        return "Checking more sources."
    if step_type == "observation":
        return "Reviewing results."
    return "Working."


def _is_status_message(message_type: str) -> bool:
    return message_type == "status"


def _is_thinking_step_message(message_type: str) -> bool:
    return message_type == "thinking_step"


def _is_articles_json_message(message_type: str) -> bool:
    return message_type == "articles_json"


def _is_referenced_articles_message(message_type: str) -> bool:
    return message_type == "referenced_articles"


def _is_complete_message(message_type: str) -> bool:
    return message_type == "complete"


def _is_error_message(message_type: str) -> bool:
    return message_type == "error"


def _new_state(query: str) -> Dict[str, Any]:
    return {
        "query": query,
        "streaming_status": "Starting research...",
        "thinking_steps": [],
        "structured_articles": None,
        "referenced_articles": [],
        "final_result": None,
        "error": None,
        "event_counts": {},
        "status_history": [],
        "tool_calls": [],
        "raw_events": [],
    }


def _record_event(state: Dict[str, Any], event: Dict[str, Any]) -> None:
    event_type = str(event.get("type", "unknown"))
    counts = state["event_counts"]
    counts[event_type] = int(counts.get(event_type, 0)) + 1
    state["raw_events"].append(event)


def _process_event_like_frontend(state: Dict[str, Any], event: Dict[str, Any]) -> None:
    _record_event(state, event)
    message_type = str(event.get("type", "unknown"))

    if _is_status_message(message_type):
        status_message = str(event.get("message", ""))
        state["streaming_status"] = status_message
        state["status_history"].append(status_message)
        return

    if _is_thinking_step_message(message_type):
        step = event.get("step") or {}
        if isinstance(step, dict):
            state["thinking_steps"].append(step)
            step_type = str(step.get("type", ""))
            state["streaming_status"] = _step_status_label(step_type)
            if step_type == "tool_start":
                state["tool_calls"].append(step)
        return

    if _is_articles_json_message(message_type):
        payload = event.get("data")
        if isinstance(payload, str) and payload.strip():
            try:
                state["structured_articles"] = json.loads(payload)
                state["streaming_status"] = "Article data ready."
            except json.JSONDecodeError:
                state["structured_articles"] = payload
        return

    if _is_referenced_articles_message(message_type):
        articles = event.get("articles")
        state["referenced_articles"] = articles if isinstance(articles, list) else []
        state["streaming_status"] = "Reviewing articles."
        return

    if _is_complete_message(message_type):
        result = event.get("result")
        state["final_result"] = result if isinstance(result, dict) else None
        state["streaming_status"] = None
        return

    if _is_error_message(message_type):
        error_message = str(event.get("message", "Research hit an error."))
        state["error"] = error_message
        state["streaming_status"] = None


async def run_once(query: str, api_base: str, max_seconds: float) -> Dict[str, Any]:
    params = {
        "query": query,
        "include_thinking": "true",
    }
    start_time = time.time()
    first_event_time: Optional[float] = None
    state = _new_state(query)
    stopped_early = False

    try:
        async with asyncio.timeout(max_seconds):
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

                        _process_event_like_frontend(state, event)

                        if _is_complete_message(str(event.get("type", ""))):
                            break

                        if _is_error_message(str(event.get("type", ""))):
                            break
    except TimeoutError:
        stopped_early = True

    elapsed = time.time() - start_time
    ttf = (first_event_time - start_time) if first_event_time else 0.0
    final_result = (
        state["final_result"] if isinstance(state["final_result"], dict) else {}
    )
    final_answer = str(final_result.get("answer") or "")
    if not final_answer and state["thinking_steps"]:
        last_step = state["thinking_steps"][-1]
        if isinstance(last_step, dict):
            final_answer = str(last_step.get("content", ""))

    repeated_checking = sum(
        1 for status in state["status_history"] if status == "Checking more sources."
    )

    return {
        "query": query,
        "elapsed_seconds": round(elapsed, 2),
        "time_to_first_event": round(ttf, 2),
        "stopped_early": stopped_early,
        "tool_calls": len(state["tool_calls"]),
        "event_counts": state["event_counts"],
        "status_history": state["status_history"],
        "final_streaming_status": state["streaming_status"],
        "thinking_steps": state["thinking_steps"],
        "referenced_articles_count": len(state["referenced_articles"]),
        "answer_length": len(final_answer.strip()),
        "has_sections": _has_sections(final_answer),
        "completed": state["final_result"] is not None,
        "error": state["error"],
        "repeated_checking_statuses": repeated_checking,
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
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=45.0,
        help="Stop a run after this many seconds to capture loops safely",
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
            result = asyncio.run(run_once(query, args.api_base, args.max_seconds))
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
