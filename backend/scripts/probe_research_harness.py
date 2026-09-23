"""Exercise built-in research questions through the real SSE API."""

import argparse
import json
import time
from urllib.parse import urlencode
from urllib.request import urlopen

QUESTIONS = (
    "What are the different perspectives on climate change?",
    "Compare how different sources cover technology news",
    "Summarize the latest political developments",
)


def probe(base_url: str, model: str, question: str) -> dict:
    params = urlencode({"query": question, "model": model, "include_thinking": "true"})
    started = time.monotonic()
    events = []
    with urlopen(f"{base_url}/api/news/research/stream?{params}", timeout=180) as response:
        for line in response:
            if not line.startswith(b"data: "):
                continue
            event = json.loads(line[6:])
            kind = event.get("type")
            if kind == "complete":
                result = event["result"]
                events.append({"type": kind, "success": result.get("success"), "answer": result.get("answer")})
            elif kind in {"tool_start", "tool_result", "error"}:
                events.append(event)
    return {"question": question, "seconds": round(time.monotonic() - started, 2), "events": events}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--model", default="opencode:ling-3.0-flash-fin-free")
    parser.add_argument("--question", action="append")
    args = parser.parse_args()
    for question in args.question or QUESTIONS:
        print(json.dumps(probe(args.base_url, args.model, question)), flush=True)


if __name__ == "__main__":
    main()
