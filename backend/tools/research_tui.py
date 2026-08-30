"""Research Tui."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Callable, cast

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
    """Session Stats."""

    total_requests: int = 0
    last_duration_seconds: float = 0.0
    avg_duration_seconds: float = 0.0
    time_to_first_event: float = 0.0
    tool_calls: int = 0


@dataclass
class ResearchSession:
    """Research Session."""

    session_id: str
    title: str
    created_at: str
    updated_at: str
    messages: list[dict[str, Any]]
    stats: SessionStats

    def to_dict(self) -> dict[str, Any]:
        """To Dict."""
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
    def from_dict(cls, payload: dict[str, Any]) -> ResearchSession:
        """From Dict."""
        stats_payload = payload.get("stats", {})
        return cls(
            session_id=payload.get("session_id", str(uuid.uuid4())),
            title=payload.get("title", "Untitled Session"),
            created_at=payload.get("created_at") or _utc_now(),
            updated_at=payload.get("updated_at") or _utc_now(),
            messages=payload.get("messages", []),
            stats=SessionStats(
                total_requests=int(stats_payload.get("total_requests", 0)),
                last_duration_seconds=float(stats_payload.get("last_duration_seconds", 0.0)),
                avg_duration_seconds=float(stats_payload.get("avg_duration_seconds", 0.0)),
                time_to_first_event=float(stats_payload.get("time_to_first_event", 0.0)),
                tool_calls=int(stats_payload.get("tool_calls", 0)),
            ),
        )

@dataclass
class _StreamState:
    """Mutable state accumulated while streaming research events."""

    first_event_time: float | None = None
    tool_calls: int = 0
    tool_log: list[str] = field(default_factory=list)
    referenced_articles: list[dict[str, Any]] = field(default_factory=list)
    assistant_content: str = ""


def _apply_stream_event(state: _StreamState, event: dict[str, Any]) -> bool:
    """Fold one streamed event into CLI state; True when the stream is done."""
    event_type = event.get("type")
    if event_type == "tool_start":
        state.tool_calls += 1
        tool = event.get("tool", "unknown")
        args = event.get("args", {})
        state.tool_log.append(f"> {tool} {json.dumps(args)}")
    elif event_type == "tool_result":
        content = event.get("content", "")
        snippet = str(content)[:400].replace("\n", " ")
        state.tool_log.append(f"< {snippet}")
    elif event_type == "referenced_articles":
        state.referenced_articles = event.get("articles", []) or []
    elif event_type == "thinking":
        state.assistant_content = event.get("content", "")
    elif event_type == "complete":
        result = event.get("result", {})
        state.assistant_content = result.get("answer", state.assistant_content)
    return event_type in {"complete", "error"}

def _parse_stream_event(line: str) -> dict[str, Any] | None:
    """Parse one SSE data line into an event dict, or None when malformed."""
    if not line or not line.startswith("data:"):
        return None
    payload = line.replace("data:", "", 1).strip()
    if not payload:
        return None
    try:
        return cast(dict[str, Any], json.loads(payload))
    except json.JSONDecodeError:
        return None


def _emit_stream_event(state: _StreamState, event: dict[str, Any], output_format: str) -> None:
    """Print one streamed event in the requested output format."""
    event_type = event.get("type")
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
    elif event_type == "status":
        print(f"[status] {event.get('message', '')}")
    elif event_type in {"tool_start", "tool_result"}:
        print(state.tool_log[-1])
    elif event_type == "complete":
        print("\n" + (state.assistant_content or ""))
    elif event_type == "error":
        print(f"[error] {event.get('message', '')}")


def _print_stream_error(exc: httpx.HTTPError, output_format: str) -> None:
    """Report an HTTP error in the requested output format."""
    if isinstance(exc, httpx.HTTPStatusError):
        message = f"HTTP error {exc.response.status_code} for {exc.request.url}"
    else:
        message = str(exc)
    if output_format == "json":
        print(json.dumps({"type": "error", "message": message}))
    else:
        print(f"[error] {message}")


def _emit_cli_summary(state: _StreamState, start_time: float, output_format: str) -> None:
    """Print the CLI run summary."""
    elapsed = time.time() - start_time
    ttf = (state.first_event_time - start_time) if state.first_event_time else 0.0
    summary_payload = {
        "type": "summary",
        "elapsed_seconds": round(elapsed, 2),
        "time_to_first_event": round(ttf, 2),
        "tool_calls": state.tool_calls,
    }
    if output_format == "json":
        print(json.dumps(summary_payload))
    else:
        print(
            f"[summary] elapsed={summary_payload['elapsed_seconds']}s ttf={summary_payload['time_to_first_event']}s tools={summary_payload['tool_calls']}"
        )


def _save_cli_session(
    query: str,
    state: _StreamState,
    elapsed: float,
    ttf: float,
) -> None:
    """Persist a CLI run as a research session."""
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
                "content": state.assistant_content,
                "timestamp": now,
                "tool_log": state.tool_log,
                "referenced_articles": state.referenced_articles,
            },
        ],
        stats=SessionStats(
            total_requests=1,
            last_duration_seconds=elapsed,
            avg_duration_seconds=elapsed,
            time_to_first_event=ttf,
            tool_calls=state.tool_calls,
        ),
    )
    sessions.insert(0, session)
    _save_sessions(sessions)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _load_sessions() -> list[ResearchSession]:
    if not SESSION_FILE.exists():
        return []
    try:
        data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        return [ResearchSession.from_dict(item) for item in data.get("sessions", [])]
    except Exception:
        return []


def _save_sessions(sessions: list[ResearchSession]) -> None:
    payload = {"sessions": [session.to_dict() for session in sessions]}
    SESSION_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _build_history_payload(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    payload: list[dict[str, str]] = []
    for message in messages:
        message_type = message.get("type")
        if message_type in {"user", "assistant"} and not message.get("tool_type"):
            content = message.get("content", "")
            if content and isinstance(content, str):
                payload.append({"type": str(message_type), "content": content})
    return payload


class SessionManager:
    """Session Manager."""

    def __init__(self) -> None:
        """Initialize."""
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
        """Active Session."""
        for session in self.sessions:
            if session.session_id == self.active_session_id:
                return session
        session = self._new_session("Untitled Session")
        self.sessions.append(session)
        self.active_session_id = session.session_id
        return session

    def set_active(self, session_id: str) -> None:
        """Set Active."""
        self.active_session_id = session_id

    def create_session(self, title: str) -> ResearchSession:
        """Create Session."""
        session = self._new_session(title)
        self.sessions.insert(0, session)
        self.active_session_id = session.session_id
        return session

    def update_session(self, session: ResearchSession) -> None:
        """Update Session."""
        for idx, existing in enumerate(self.sessions):
            if existing.session_id == session.session_id:
                self.sessions[idx] = session
                break
        _save_sessions(self.sessions)


class SessionListItem(ListItem):
    """Session List Item."""

    def __init__(
        self,
        session_data: ResearchSession,
        *children: Any,
        **kwargs: Any,
    ) -> None:
        """Initialize."""
        super().__init__(*children, **kwargs)
        self.session = session_data


class ResearchTUI(App):
    """Research TUI."""

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
        """Initialize."""
        super().__init__()
        self.session_manager = SessionManager()
        self.tool_log_lines: list[str] = []
        self.research_buffer = ""
        self.referenced_articles: list[dict[str, Any]] = []
        self.api_base = os.getenv("NEWS_RESEARCH_API_BASE", DEFAULT_API_BASE)
        self.current_tool_calls = 0
        self.draft_answer: str | None = None

    def compose(self) -> ComposeResult:
        """Compose."""
        yield Header()
        with Horizontal():
            with Container(id="sessions-pane"):
                yield Static("Sessions", classes="pane-title")
                self.session_list = ListView(id="session-list")
                yield self.session_list
            with Container(id="main-pane"), Vertical():
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
        """On Mount."""
        self.refresh_session_list()
        self.load_active_session()
        self.input_widget.focus()

    def refresh_session_list(self) -> None:
        """Refresh Session List."""
        self.session_list.clear()
        for session_item in self.session_manager.sessions:
            item = SessionListItem(session_item, Static(session_item.title))
            self.session_list.append(item)
            if session_item.session_id == self.session_manager.active_session_id:
                self.session_list.index = len(self.session_list) - 1

    def load_active_session(self) -> None:
        """Load Active Session."""
        session = self.session_manager.active_session()
        self.research_buffer = self._render_session_messages(session)
        self.referenced_articles = (
            session.messages[-1].get("referenced_articles", []) if session.messages else []
        )
        self.tool_log_lines = session.messages[-1].get("tool_log", []) if session.messages else []
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
        """Refresh Panels."""
        self.status_widget.update(f"{self.status_text} | {self.latency_text}")
        self.answer_widget.update(self._render_answer())
        self.tool_log_widget.update(self._render_tool_log())
        self.sources_widget.update(self._render_sources())

    def update_status(self, status: str) -> None:
        """Update Status."""
        self.status_text = status
        self.refresh_panels()

    def update_latency(self, text: str) -> None:
        """Update Latency."""
        self.latency_text = text
        self.refresh_panels()

    async def on_list_view_selected(self, event: ListView.Selected) -> None:
        """On List View Selected."""
        item = event.item
        if isinstance(item, SessionListItem):
            self.session_manager.set_active(item.session.session_id)
            self.load_active_session()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        """On Input Submitted."""
        query = event.value.strip()
        if not query:
            return
        await self.start_research(query)
        self.input_widget.value = ""

    async def start_research(self, query: str) -> None:
        """Start Research."""
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
        first_event_time: float | None = None
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
                        event = _parse_stream_event(line)
                        if event is None:
                            continue
                        if first_event_time is None:
                            first_event_time = time.time()
                            self.update_latency(f"TTF: {first_event_time - start_time:.2f}s")
                        await self._handle_event(event, assistant_message)
                        self._update_stream_latency(start_time, first_event_time)
                        if event.get("type") in {"complete", "error"}:
                            break
            except httpx.HTTPStatusError as exc:
                self.update_status(f"HTTP {exc.response.status_code} for {exc.request.url}")
            except httpx.HTTPError as exc:
                self.update_status(f"Stream error: {exc}")

        self._finalize_stream(
            session,
            assistant_message,
            start_time,
            first_event_time,
        )

    def _update_stream_latency(self, start_time: float, first_event_time: float | None) -> None:
        """Refresh the latency footer with the current stream progress."""
        elapsed = time.time() - start_time
        if first_event_time is not None:
            self.update_latency(
                f"TTF: {first_event_time - start_time:.2f}s | Elapsed: {elapsed:.1f}s | Tools: {self.current_tool_calls}"
            )

    def _finalize_stream(
        self,
        session: ResearchSession,
        assistant_message: dict[str, Any],
        start_time: float,
        first_event_time: float | None,
    ) -> None:
        """Record stream stats and persist the final session state."""
        duration = time.time() - start_time
        session.stats.total_requests += 1
        session.stats.last_duration_seconds = duration
        self._update_session_averages(session, duration)
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

    def _update_session_averages(self, session: ResearchSession, duration: float) -> None:
        """Roll the running average duration into the session stats."""
        total = session.stats.total_requests
        session.stats.avg_duration_seconds = (
            ((session.stats.avg_duration_seconds * (total - 1)) + duration) / total
        )

    async def _handle_event(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        handler = self._EVENT_HANDLERS.get(str(event.get("type")))
        if handler is not None:
            handler(event, assistant_message)

    def _record_change(self, assistant_message: dict[str, Any], marker: str) -> None:
        """Append a change marker to the tool log for both the view and session."""
        self.tool_log_lines.append(marker)
        assistant_message["tool_log"].append(self.tool_log_lines[-1])
        self.refresh_panels()

    def _handle_status(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle a status event."""
        self.update_status(event.get("message", "Working..."))

    def _handle_thinking(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle a thinking chunk."""
        content = event.get("content", "")
        if content:
            assistant_message["content"] = content
            self.draft_answer = content
            self.answer_widget.update(self._render_answer())
            self.update_status("Streaming answer...")

    def _handle_thinking_step(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle one thinking step."""
        step = event.get("step", {})
        assistant_message["thinking_steps"].append(step)
        if step.get("content"):
            snippet = str(step.get("content"))[:160].replace("\n", " ")
            self._record_change(assistant_message, f"~ {snippet}")

    def _handle_tool_start(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle a tool start event."""
        tool_name = event.get("tool", "unknown")
        args = event.get("args", {})
        self.current_tool_calls += 1
        self._record_change(assistant_message, f"> {tool_name} {json.dumps(args)}")
        self.update_latency(f"Tools: {self.current_tool_calls}")

    def _handle_tool_result(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle a tool result snippet."""
        content = event.get("content", "")
        snippet = str(content)[:400].replace("\n", " ")
        self._record_change(assistant_message, f"< {snippet}")

    def _handle_articles_json(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle an articles payload marker."""
        self._record_change(assistant_message, "< articles_json received")

    def _handle_referenced_articles(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle a referenced articles payload."""
        self.referenced_articles = event.get("articles", []) or []
        assistant_message["referenced_articles"] = self.referenced_articles
        self.refresh_panels()

    def _finalize_answer(
        self,
        assistant_message: dict[str, Any],
        content: str,
        status: str,
    ) -> None:
        """Finalize the answer UI after a complete or error event."""
        assistant_message["content"] = content
        self.draft_answer = None
        self.research_buffer = self._render_session_messages(
            self.session_manager.active_session()
        )
        self.answer_widget.update(self._render_answer())
        self.update_status(status)

    def _handle_complete(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle a complete event."""
        result = event.get("result", {})
        self._finalize_answer(
            assistant_message,
            result.get("answer", ""),
            "Complete",
        )

    def _handle_error(self, event: dict[str, Any], assistant_message: dict[str, Any]) -> None:
        """Handle an error event."""
        self._finalize_answer(assistant_message, event.get("message", "Error"), "Error")

    _EVENT_HANDLERS: dict[str, Callable[..., None]] = {
        "status": _handle_status,
        "thinking": _handle_thinking,
        "thinking_step": _handle_thinking_step,
        "tool_start": _handle_tool_start,
        "tool_result": _handle_tool_result,
        "articles_json": _handle_articles_json,
        "referenced_articles": _handle_referenced_articles,
        "complete": _handle_complete,
        "error": _handle_error,
    }

    def action_new_session(self) -> None:
        """Action New Session."""
        session = self.session_manager.create_session("New Research")
        self.refresh_session_list()
        self.load_active_session()
        self.input_widget.focus()
        self.update_status(f"Created session {session.title}")

    def action_clear_view(self) -> None:
        """Action Clear View."""
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
    """Run Cli Query."""
    params = {
        "query": query,
        "include_thinking": "true",
    }
    start_time = time.time()
    state = _StreamState()

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
                    event = _parse_stream_event(line)
                    if event is None:
                        continue
                    if state.first_event_time is None:
                        state.first_event_time = time.time()
                    done = _apply_stream_event(state, event)
                    _emit_stream_event(state, event, output_format)
                    if done:
                        break
        except (httpx.HTTPStatusError, httpx.HTTPError) as exc:
            _print_stream_error(exc, output_format)
            return 1

    elapsed = time.time() - start_time
    ttf = (state.first_event_time - start_time) if state.first_event_time else 0.0
    _emit_cli_summary(state, start_time, output_format)

    if save_session:
        _save_cli_session(query, state, elapsed, ttf)

    return 0

def build_arg_parser() -> argparse.ArgumentParser:
    """Build Arg Parser."""
    parser = argparse.ArgumentParser(description="Run research TUI or one-off CLI query.")
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
    """Main."""
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
