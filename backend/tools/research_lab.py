from __future__ import annotations

import argparse
import asyncio
import json
import time
from collections import Counter
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
REGISTERED_RESEARCH_TOOLS = (
    "search_internal_news",
    "gdelt_context_search",
    "gdelt_doc_search",
    "web_search",
    "news_search",
    "fetch_article_content",
    "rag_index_documents",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_history_payload(raw_history: Any) -> List[Dict[str, str]]:
    payload: List[Dict[str, str]] = []
    if not isinstance(raw_history, list):
        return payload
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        message_type = str(item.get("type", "")).strip()
        content = str(item.get("content", "")).strip()
        if message_type in {"user", "assistant"} and content:
            payload.append({"type": message_type, "content": content})
    return payload


def _load_history_file(path: str | None) -> List[Dict[str, str]]:
    if not path:
        return []
    history_path = Path(path)
    if not history_path.exists():
        return []
    try:
        raw_history = json.loads(history_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return _normalize_history_payload(raw_history)


def _load_queries_file(path: str | None) -> List[str]:
    if not path:
        return []
    query_path = Path(path)
    if not query_path.exists():
        return []

    raw_text = query_path.read_text(encoding="utf-8").strip()
    if not raw_text:
        return []

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return [line.strip() for line in raw_text.splitlines() if line.strip()]

    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
    if isinstance(parsed, dict):
        raw_queries = parsed.get("queries")
        if isinstance(raw_queries, list):
            return [str(item).strip() for item in raw_queries if str(item).strip()]
    return []


def _append_history_turn(
    history: List[Dict[str, str]],
    query: str,
    answer: str,
) -> List[Dict[str, str]]:
    next_history = list(history)
    user_query = query.strip()
    if user_query:
        next_history.append({"type": "user", "content": user_query})
    assistant_answer = answer.strip()
    if assistant_answer:
        next_history.append({"type": "assistant", "content": assistant_answer})
    return next_history


def _round_average(values: List[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def _history_recall_failed(answer: str) -> bool:
    lower = answer.strip().lower()
    if not lower:
        return False
    phrases = (
        "do not have access to the specific sources",
        "do not retain memory of specific tool outputs",
        "cannot recall the exact urls",
        "cannot recall the specific sources",
        "i do not retain memory",
    )
    return any(phrase in lower for phrase in phrases)


def _resolve_final_answer(
    final_result: Dict[str, Any],
    thinking_steps: List[Dict[str, Any]],
) -> str:
    final_answer = str(final_result.get("answer") or "")
    if final_answer:
        return final_answer

    for step in reversed(thinking_steps):
        if not isinstance(step, dict):
            continue
        if str(step.get("type", "")) != "thought":
            continue
        content = str(step.get("content", ""))
        if content:
            return content
    return ""


def _build_summary(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    requested_tool_counter: Counter[str] = Counter()
    executed_tool_counter: Counter[str] = Counter()
    source_provider_counter: Counter[str] = Counter()
    queries_without_tool_calls: List[str] = []
    history_recall_failures: List[str] = []

    for result in results:
        if int(result.get("tool_calls", 0)) <= 0:
            queries_without_tool_calls.append(str(result.get("query", "")))

        if int(result.get("history_messages_sent", 0)) > 0 and _history_recall_failed(
            str(result.get("answer", ""))
        ):
            history_recall_failures.append(str(result.get("query", "")))

        for tool_result in result.get("tool_sequence", []):
            if not isinstance(tool_result, dict):
                continue
            tool_name = str(tool_result.get("tool", "")).strip()
            if tool_name:
                requested_tool_counter[tool_name] += 1

        for tool_name in result.get("executed_tools", []):
            tool_name_str = str(tool_name).strip()
            if tool_name_str:
                executed_tool_counter[tool_name_str] += 1

        for provider in result.get("source_providers", []):
            provider_name = str(provider).strip()
            if provider_name:
                source_provider_counter[provider_name] += 1

    return {
        "completed": sum(1 for result in results if bool(result.get("completed"))),
        "failures": sum(
            1 for result in results if not bool(result.get("has_sections"))
        ),
        "errors": sum(1 for result in results if bool(result.get("error"))),
        "stopped_early": sum(
            1 for result in results if bool(result.get("stopped_early"))
        ),
        "avg_elapsed_seconds": _round_average(
            [float(result.get("elapsed_seconds", 0.0)) for result in results]
        ),
        "avg_time_to_first_event": _round_average(
            [float(result.get("time_to_first_event", 0.0)) for result in results]
        ),
        "avg_tool_calls": _round_average(
            [float(result.get("tool_calls", 0.0)) for result in results]
        ),
        "avg_executed_tool_calls": _round_average(
            [float(result.get("executed_tool_calls", 0.0)) for result in results]
        ),
        "unique_tools": sorted(executed_tool_counter),
        "tool_usage_counts": dict(sorted(executed_tool_counter.items())),
        "unique_requested_tools": sorted(requested_tool_counter),
        "requested_tool_usage_counts": dict(sorted(requested_tool_counter.items())),
        "missing_registered_tools": [
            tool_name
            for tool_name in REGISTERED_RESEARCH_TOOLS
            if tool_name not in executed_tool_counter
        ],
        "source_provider_counts": dict(sorted(source_provider_counter.items())),
        "queries_without_tool_calls": queries_without_tool_calls,
        "history_recall_failures": history_recall_failures,
    }


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
        "executed_tools": [],
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

    if message_type == "tool_result":
        tool_name = str(event.get("tool", "")).strip()
        if tool_name:
            state["executed_tools"].append(tool_name)
        state["streaming_status"] = "Reviewing results."
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


async def run_once(
    query: str,
    api_base: str,
    max_seconds: float,
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    params = {
        "query": query,
        "include_thinking": "true",
    }
    history_payload = _normalize_history_payload(history or [])
    if history_payload:
        params["history"] = json.dumps(history_payload)
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
    final_answer = _resolve_final_answer(final_result, state["thinking_steps"])

    repeated_checking = sum(
        1 for status in state["status_history"] if status == "Checking more sources."
    )
    tool_events = [
        event
        for event in state["raw_events"]
        if str(event.get("type", "")) == "tool_start"
    ]

    return {
        "query": query,
        "elapsed_seconds": round(elapsed, 2),
        "time_to_first_event": round(ttf, 2),
        "stopped_early": stopped_early,
        "tool_calls": len(tool_events),
        "executed_tool_calls": len(state["executed_tools"]),
        "tool_sequence": [
            {
                "tool": str(event.get("tool", "")),
                "args": event.get("args", {}),
            }
            for event in tool_events
        ],
        "executed_tools": list(state["executed_tools"]),
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
        "history_messages_sent": len(history_payload),
        "source_providers": list(final_result.get("source_providers") or []),
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
        "--query-file",
        help="Optional JSON or newline-delimited file of queries.",
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
    parser.add_argument(
        "--carry-history",
        action="store_true",
        help="Carry user/assistant history across repeated query turns.",
    )
    parser.add_argument(
        "--history-file",
        help="Optional JSON file containing prior user/assistant messages.",
    )
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    file_queries = _load_queries_file(args.query_file)
    queries = args.query or file_queries or DEFAULT_QUERIES
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    seed_history = _load_history_file(args.history_file)

    results: List[Dict[str, Any]] = []
    for run_index in range(args.runs):
        history = list(seed_history)
        for turn_index, query in enumerate(queries, start=1):
            result = asyncio.run(
                run_once(
                    query,
                    args.api_base,
                    args.max_seconds,
                    history if args.carry_history else seed_history,
                )
            )
            result["run_index"] = run_index + 1
            result["turn_index"] = turn_index
            result["history_mode"] = "carry" if args.carry_history else "seed-only"
            results.append(result)
            if args.carry_history:
                history = _append_history_turn(history, query, result.get("answer", ""))

    summary = {
        "timestamp": _utc_now(),
        "api_base": args.api_base,
        "carry_history": args.carry_history,
        "seed_history_messages": len(seed_history),
        "total": len(results),
        "failures": sum(1 for item in results if not item.get("has_sections")),
        "aggregate": _build_summary(results),
        "results": results,
    }
    output_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
