from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from rich.text import Text
from rich.console import RenderableType
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.reactive import reactive
from textual.widgets import Footer, Header, Input, ListItem, ListView, Static

BASE_DIR = Path(__file__).resolve().parents[1]
SESSION_FILE = BASE_DIR / "research_sessions.json"
DEFAULT_API_BASE = "http://localhost:8000"
MAX_TOOL_LOG_LINES = 200


@dataclass
class SessionStats:
    total_requests: int = 0
    last_duration_seconds: float = 0.0
    avg_duration_seconds: float = 0.0
    time_to_first_event: float = 0.0
    tool_calls: int = 0


@dataclass
class ResearchSession:
    session_id: str
    title: str
    created_at: str
    updated_at: str
    messages: List[Dict[str, Any]]
    stats: SessionStats

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "messages": self.messages,
            "stats": {
                "total_requests": self.stats.total_requests,
                "last_duration_seconds": self.stats.last_duration_seconds,
                "avg_duration_seconds": self.stats.avg_duration_seconds,
                "time_to_first_event": self.stats.time_to_first_event,
                "tool_calls": self.stats.tool_calls,
            },
        }

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "ResearchSession":
        stats_payload = payload.get("stats", {})
        return cls(
            session_id=payload.get("session_id", str(uuid.uuid4())),
            title=payload.get("title", "Untitled Session"),
            created_at=payload.get("created_at") or _utc_now(),
            updated_at=payload.get("updated_at") or _utc_now(),
            messages=payload.get("messages", []),
            stats=SessionStats(
                total_requests=int(stats_payload.get("total_requests", 0)),
                last_duration_seconds=float(
                    stats_payload.get("last_duration_seconds", 0.0)
                ),
                avg_duration_seconds=float(
                    stats_payload.get("avg_duration_seconds", 0.0)
                ),
                time_to_first_event=float(
                    stats_payload.get("time_to_first_event", 0.0)
                ),
                tool_calls=int(stats_payload.get("tool_calls", 0)),
            ),
        )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_sessions() -> List[ResearchSession]:
    if not SESSION_FILE.exists():
        return []
    try:
        data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        return [ResearchSession.from_dict(item) for item in data.get("sessions", [])]
    except Exception:
        return []


def _save_sessions(sessions: List[ResearchSession]) -> None:
    payload = {"sessions": [session.to_dict() for session in sessions]}
    SESSION_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _build_history_payload(messages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    payload: List[Dict[str, str]] = []
    for message in messages:
        message_type = message.get("type")
        if message_type in {"user", "assistant"} and not message.get("tool_type"):
            content = message.get("content", "")
            if content and isinstance(content, str):
                payload.append({"type": str(message_type), "content": content})
    return payload


class SessionManager:
    def __init__(self) -> None:
        self.sessions = _load_sessions()
        if not self.sessions:
            self.sessions.append(self._new_session("Untitled Session"))
        self.active_session_id = self.sessions[0].session_id

    def _new_session(self, title: str) -> ResearchSession:
        now = _utc_now()
        return ResearchSession(
            session_id=str(uuid.uuid4()),
            title=title,
            created_at=now,
            updated_at=now,
            messages=[],
            stats=SessionStats(),
        )

    def active_session(self) -> ResearchSession:
        for session in self.sessions:
            if session.session_id == self.active_session_id:
                return session
        session = self._new_session("Untitled Session")
        self.sessions.append(session)
        self.active_session_id = session.session_id
        return session

    def set_active(self, session_id: str) -> None:
        self.active_session_id = session_id

    def create_session(self, title: str) -> ResearchSession:
        session = self._new_session(title)
        self.sessions.insert(0, session)
        self.active_session_id = session.session_id
        return session

    def update_session(self, session: ResearchSession) -> None:
        for idx, existing in enumerate(self.sessions):
            if existing.session_id == session.session_id:
                self.sessions[idx] = session
                break
        _save_sessions(self.sessions)


class SessionListItem(ListItem):
    def __init__(
        self,
        session_data: ResearchSession,
        *children: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(*children, **kwargs)
        self.session = session_data


class ResearchTUI(App):
    CSS = """
    Screen {
        layout: vertical;
    }

    Horizontal {
        height: 1fr;
    }

    #sessions-pane {
        width: 20%;
        min-width: 24;
        border: tall $background 40%;
        padding: 1 1;
    }

    #main-pane {
        width: 55%;
        border: tall $background 40%;
        padding: 1 2;
    }

    #sidebar-pane {
        width: 25%;
        border: tall $background 40%;
        padding: 1 1;
    }

    .pane-title {
        content-align: left middle;
        text-style: bold;
        color: $text-muted;
    }

    #status-text {
        height: auto;
        margin-bottom: 1;
    }

    #answer-text {
        height: 1fr;
        border: tall $background 20%;
        padding: 1 1;
    }

    #tool-log {
        height: 1fr;
        border: tall $background 20%;
        padding: 1 1;
    }

    #sources-list {
        height: 1fr;
        border: tall $background 20%;
        padding: 1 1;
    }

    Input {
        border: tall $background 50%;
        margin: 1 1 1 1;
    }

    ListView {
        height: 1fr;
    }

    Static {
        margin: 1 0;
    }
    """

    BINDINGS = [
        ("ctrl+c", "quit", "Quit"),
        ("ctrl+n", "new_session", "New Session"),
        ("ctrl+l", "clear_view", "Clear View"),
    ]

    status_text = reactive("Ready")
    latency_text = reactive("Latency: --")

    def __init__(self) -> None:
        super().__init__()
        self.session_manager = SessionManager()
        self.tool_log_lines: List[str] = []
        self.research_buffer = ""
        self.referenced_articles: List[Dict[str, Any]] = []
        self.api_base = os.getenv("NEWS_RESEARCH_API_BASE", DEFAULT_API_BASE)
        self.current_tool_calls = 0
        self.draft_answer: Optional[str] = None

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal():
            with Container(id="sessions-pane"):
                yield Static("Sessions", classes="pane-title")
                self.session_list = ListView(id="session-list")
                yield self.session_list
            with Container(id="main-pane"):
                with Vertical():
                    self.status_widget = Static(self.status_text, id="status-text")
                    self.answer_widget = Static(self._render_answer(), id="answer-text")
                    yield self.status_widget
                    yield self.answer_widget
            with Container(id="sidebar-pane"):
                yield Static("Tool Log", classes="pane-title")
                self.tool_log_widget = Static(self._render_tool_log(), id="tool-log")
                yield self.tool_log_widget
                yield Static("Sources", classes="pane-title")
                self.sources_widget = Static(self._render_sources(), id="sources-list")
                yield self.sources_widget
        self.input_widget = Input(
            placeholder="Ask a research question...",
            id="research-input",
        )
        yield self.input_widget
        yield Footer()

    def on_mount(self) -> None:
        self.refresh_session_list()
        self.load_active_session()
        self.input_widget.focus()

    def refresh_session_list(self) -> None:
        self.session_list.clear()
        for session_item in self.session_manager.sessions:
            item = SessionListItem(session_item, Static(session_item.title))
            self.session_list.append(item)
            if session_item.session_id == self.session_manager.active_session_id:
                self.session_list.index = len(self.session_list) - 1

    def load_active_session(self) -> None:
        session = self.session_manager.active_session()
        self.research_buffer = self._render_session_messages(session)
        self.referenced_articles = (
            session.messages[-1].get("referenced_articles", [])
            if session.messages
            else []
        )
        self.tool_log_lines = (
            session.messages[-1].get("tool_log", []) if session.messages else []
        )
        self.draft_answer = None
        self.update_status("Loaded session")
        if session.stats.total_requests > 0:
            self.update_latency(
                f"Last: {session.stats.last_duration_seconds:.2f}s | Tools: {session.stats.tool_calls}"
            )
        else:
            self.update_latency("Latency: --")
        self.refresh_panels()

    def _render_session_messages(self, session: ResearchSession) -> str:
        output = []
        for message in session.messages:
            role = message.get("type", "assistant")
            prefix = "User" if role == "user" else "Assistant"
            content = message.get("content", "")
            if content:
                output.append(f"{prefix}: {content}")
        return "\n\n".join(output)

    def _render_answer(self) -> RenderableType:
        if self.draft_answer:
            return Text(self.draft_answer)
        if not self.research_buffer:
            return Text("No output yet.")
        return Text(self.research_buffer)

    def _render_tool_log(self) -> RenderableType:
        if not self.tool_log_lines:
            return Text("No tool activity yet.")
        trimmed = self.tool_log_lines[-MAX_TOOL_LOG_LINES:]
        return Text("\n".join(trimmed))

    def _render_sources(self) -> RenderableType:
        if not self.referenced_articles:
            return Text("No sources yet.")
        lines = []
        for article in self.referenced_articles[:15]:
            title = article.get("title") or "Untitled"
            source = article.get("source") or "Unknown"
            lines.append(f"- {source}: {title}")
        return Text("\n".join(lines))

    def refresh_panels(self) -> None:
        self.status_widget.update(f"{self.status_text} | {self.latency_text}")
        self.answer_widget.update(self._render_answer())
        self.tool_log_widget.update(self._render_tool_log())
        self.sources_widget.update(self._render_sources())

    def update_status(self, status: str) -> None:
        self.status_text = status
        self.refresh_panels()

    def update_latency(self, text: str) -> None:
        self.latency_text = text
        self.refresh_panels()

    async def on_list_view_selected(self, event: ListView.Selected) -> None:
        item = event.item
        if isinstance(item, SessionListItem):
            self.session_manager.set_active(item.session.session_id)
            self.load_active_session()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        query = event.value.strip()
        if not query:
            return
        await self.start_research(query)
        self.input_widget.value = ""

    async def start_research(self, query: str) -> None:
        session = self.session_manager.active_session()
        user_message = {
            "id": str(uuid.uuid4()),
            "type": "user",
            "content": query,
            "timestamp": _utc_now(),
        }
        session.messages.append(user_message)
        session.updated_at = _utc_now()
        self.session_manager.update_session(session)

        self.research_buffer = self._render_session_messages(session)
        self.draft_answer = None
        self.tool_log_lines = []
        self.referenced_articles = []
        self.refresh_panels()

        await self._stream_research(query, session)

    async def _stream_research(self, query: str, session: ResearchSession) -> None:
        start_time = time.time()
        first_event_time: Optional[float] = None
        tool_calls = 0
        assistant_message = {
            "id": str(uuid.uuid4()),
            "type": "assistant",
            "content": "",
            "timestamp": _utc_now(),
            "thinking_steps": [],
            "tool_log": [],
            "referenced_articles": [],
        }

        self.current_tool_calls = 0
        self.update_latency("TTF: --")
        self.update_status("Connecting to research stream...")

        history_payload = _build_history_payload(session.messages)
        params = {
            "query": query,
            "include_thinking": "true",
        }
        if history_payload:
            params["history"] = json.dumps(history_payload)

        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream(
                    "GET",
                    f"{self.api_base}/api/news/research/stream",
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
                        if first_event_time is None:
                            first_event_time = time.time()
                            self.update_latency(
                                f"TTF: {first_event_time - start_time:.2f}s"
                            )
                        try:
                            event = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        await self._handle_event(event, assistant_message)
                        elapsed = time.time() - start_time
                        if first_event_time is not None:
                            self.update_latency(
                                f"TTF: {first_event_time - start_time:.2f}s | Elapsed: {elapsed:.1f}s | Tools: {self.current_tool_calls}"
                            )
                        if event.get("type") in {"complete", "error"}:
                            break
            except httpx.HTTPStatusError as exc:
                self.update_status(
                    f"HTTP {exc.response.status_code} for {exc.request.url}"
                )
            except httpx.HTTPError as exc:
                self.update_status(f"Stream error: {exc}")

        duration = time.time() - start_time
        session.stats.total_requests += 1
        session.stats.last_duration_seconds = duration
        total = session.stats.total_requests
        session.stats.avg_duration_seconds = (
            ((session.stats.avg_duration_seconds * (total - 1)) + duration) / total
            if total > 0
            else duration
        )
        session.stats.time_to_first_event = (
            (first_event_time - start_time) if first_event_time else 0.0
        )
        session.stats.tool_calls = self.current_tool_calls
        session.updated_at = _utc_now()
        self.update_latency(f"Last: {duration:.2f}s | Tools: {self.current_tool_calls}")

        if assistant_message["content"]:
            session.messages.append(assistant_message)
        self.session_manager.update_session(session)
        self.research_buffer = self._render_session_messages(session)
        self.update_status("Complete")
        self.refresh_panels()

    async def _handle_event(
        self, event: Dict[str, Any], assistant_message: Dict[str, Any]
    ) -> None:
        event_type = event.get("type")
        if event_type == "status":
            self.update_status(event.get("message", "Working..."))
            return
        if event_type == "thinking":
            content = event.get("content", "")
            if content:
                assistant_message["content"] = content
                self.draft_answer = content
                self.answer_widget.update(self._render_answer())
                self.update_status("Streaming answer...")
            return
        if event_type == "thinking_step":
            step = event.get("step", {})
            assistant_message["thinking_steps"].append(step)
            if step.get("content"):
                snippet = str(step.get("content"))[:160].replace("\n", " ")
                self.tool_log_lines.append(f"~ {snippet}")
                assistant_message["tool_log"].append(self.tool_log_lines[-1])
                self.refresh_panels()
            return
        if event_type == "tool_start":
            tool_name = event.get("tool", "unknown")
            args = event.get("args", {})
            self.current_tool_calls += 1
            self.tool_log_lines.append(f"> {tool_name} {json.dumps(args)}")
            assistant_message["tool_log"].append(self.tool_log_lines[-1])
            self.update_latency(f"Tools: {self.current_tool_calls}")
            self.refresh_panels()
            return
        if event_type == "tool_result":
            content = event.get("content", "")
            snippet = content[:400].replace("\n", " ")
            self.tool_log_lines.append(f"< {snippet}")
            assistant_message["tool_log"].append(self.tool_log_lines[-1])
            self.refresh_panels()
            return
        if event_type == "articles_json":
            self.tool_log_lines.append("< articles_json received")
            assistant_message["tool_log"].append(self.tool_log_lines[-1])
            self.refresh_panels()
            return
        if event_type == "referenced_articles":
            self.referenced_articles = event.get("articles", []) or []
            assistant_message["referenced_articles"] = self.referenced_articles
            self.refresh_panels()
            return
        if event_type == "complete":
            result = event.get("result", {})
            assistant_message["content"] = result.get("answer", "")
            self.draft_answer = None
            self.research_buffer = self._render_session_messages(
                self.session_manager.active_session()
            )
            self.answer_widget.update(self._render_answer())
            self.update_status("Complete")
            return
        if event_type == "error":
            assistant_message["content"] = event.get("message", "Error")
            self.draft_answer = None
            self.research_buffer = self._render_session_messages(
                self.session_manager.active_session()
            )
            self.answer_widget.update(self._render_answer())
            self.update_status("Error")
            return

    def action_new_session(self) -> None:
        session = self.session_manager.create_session("New Research")
        self.refresh_session_list()
        self.load_active_session()
        self.input_widget.focus()
        self.update_status(f"Created session {session.title}")

    def action_clear_view(self) -> None:
        self.tool_log_lines = []
        self.referenced_articles = []
        self.research_buffer = ""
        self.refresh_panels()
        self.update_status("Cleared")


async def run_cli_query(
    query: str,
    api_base: str,
    output_format: str,
    save_session: bool,
) -> int:
    params = {
        "query": query,
        "include_thinking": "true",
    }
    start_time = time.time()
    first_event_time: Optional[float] = None
    tool_calls = 0
    tool_log: List[str] = []
    referenced_articles: List[Dict[str, Any]] = []
    assistant_content = ""

    async with httpx.AsyncClient(timeout=None) as client:
        try:
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
                        tool = event.get("tool", "unknown")
                        args = event.get("args", {})
                        tool_log.append(f"> {tool} {json.dumps(args)}")
                    if event_type == "tool_result":
                        content = event.get("content", "")
                        snippet = str(content)[:400].replace("\n", " ")
                        tool_log.append(f"< {snippet}")
                    if event_type == "referenced_articles":
                        referenced_articles = event.get("articles", []) or []
                    if event_type == "thinking":
                        assistant_content = event.get("content", "")
                    if event_type == "complete":
                        result = event.get("result", {})
                        assistant_content = result.get("answer", assistant_content)
                    if output_format == "json":
                        if event_type in {
                            "status",
                            "thinking",
                            "tool_start",
                            "tool_result",
                            "complete",
                            "error",
                        }:
                            print(json.dumps(event))
                    else:
                        if event_type == "status":
                            print(f"[status] {event.get('message', '')}")
                        elif event_type == "tool_start":
                            print(tool_log[-1])
                        elif event_type == "tool_result":
                            print(tool_log[-1])
                        elif event_type == "complete":
                            print("\n" + (assistant_content or ""))
                        elif event_type == "error":
                            print(f"[error] {event.get('message', '')}")
                    if event_type in {"complete", "error"}:
                        break
        except httpx.HTTPStatusError as exc:
            message = f"HTTP error {exc.response.status_code} for {exc.request.url}"
            if output_format == "json":
                print(json.dumps({"type": "error", "message": message}))
            else:
                print(f"[error] {message}")
            return 1
        except httpx.HTTPError as exc:
            if output_format == "json":
                print(json.dumps({"type": "error", "message": str(exc)}))
            else:
                print(f"[error] {exc}")
            return 1

    elapsed = time.time() - start_time
    ttf = (first_event_time - start_time) if first_event_time else 0.0
    summary_payload = {
        "type": "summary",
        "elapsed_seconds": round(elapsed, 2),
        "time_to_first_event": round(ttf, 2),
        "tool_calls": tool_calls,
    }
    if output_format == "json":
        print(json.dumps(summary_payload))
    else:
        print(
            f"[summary] elapsed={summary_payload['elapsed_seconds']}s ttf={summary_payload['time_to_first_event']}s tools={summary_payload['tool_calls']}"
        )

    if save_session:
        sessions = _load_sessions()
        now = _utc_now()
        session = ResearchSession(
            session_id=str(uuid.uuid4()),
            title=query[:60] or "CLI Research",
            created_at=now,
            updated_at=now,
            messages=[
                {
                    "id": str(uuid.uuid4()),
                    "type": "user",
                    "content": query,
                    "timestamp": now,
                },
                {
                    "id": str(uuid.uuid4()),
                    "type": "assistant",
                    "content": assistant_content,
                    "timestamp": now,
                    "tool_log": tool_log,
                    "referenced_articles": referenced_articles,
                },
            ],
            stats=SessionStats(
                total_requests=1,
                last_duration_seconds=elapsed,
                avg_duration_seconds=elapsed,
                time_to_first_event=ttf,
                tool_calls=tool_calls,
            ),
        )
        sessions.insert(0, session)
        _save_sessions(sessions)

    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run research TUI or one-off CLI query."
    )
    parser.add_argument(
        "query",
        nargs="?",
        help="Optional query to run in CLI mode instead of the TUI",
    )
    parser.add_argument(
        "--api-base",
        default=os.getenv("NEWS_RESEARCH_API_BASE", DEFAULT_API_BASE),
        help="Override API base URL",
    )
    parser.add_argument(
        "--format",
        choices=["json", "text"],
        default="json",
        help="Output format for CLI mode",
    )
    parser.add_argument(
        "--save-session",
        action="store_true",
        help="Persist CLI run to backend/research_sessions.json",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    if args.query:
        asyncio.run(
            run_cli_query(
                args.query,
                args.api_base,
                args.format,
                args.save_session,
            )
        )
        return
    app = ResearchTUI()
    app.run()


if __name__ == "__main__":
    main()
