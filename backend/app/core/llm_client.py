"""Llm Client."""

from __future__ import annotations

import uuid
import json
import time
from datetime import datetime, UTC
from typing import Any, TextIO, cast
from collections.abc import Iterable

from openai import OpenAI
from openai.types.chat import ChatCompletion, ChatCompletionMessageParam
from app.core.config import (
    get_llamacpp_instruct_params,
    get_llamacpp_model,
    get_openai_client,
    settings,
)
from app.core.logging import get_session_dir


class LLMCallLogger:
    """LLM Call Logger."""

    _instance: LLMCallLogger | None = None
    _llm_log_file: TextIO | None = None
    _error_log_file: TextIO | None = None
    _initialized: bool = False

    def __new__(cls) -> LLMCallLogger:
        """New."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        """Initialize."""
        if self._initialized:
            return
        self._initialized = True
        self._setup_session()

    def _setup_session(self) -> None:
        if LLMCallLogger._llm_log_file is not None:
            return

        session_dir = get_session_dir()

        llm_log_path = session_dir / "llm_calls.log"
        error_log_path = session_dir / "api_errors.log"

        LLMCallLogger._llm_log_file = llm_log_path.open("a")
        LLMCallLogger._error_log_file = error_log_path.open("a")

    def close(self) -> None:
        """Close."""
        if LLMCallLogger._llm_log_file:
            LLMCallLogger._llm_log_file.close()
            LLMCallLogger._llm_log_file = None
        if LLMCallLogger._error_log_file:
            LLMCallLogger._error_log_file.close()
            LLMCallLogger._error_log_file = None

    def log_call(
        self,
        request_id: str,
        service_name: str,
        model: str,
        messages: list[dict[str, str]],
        duration_ms: int,
        success: bool,
        error_type: str | None = None,
        error_message: str | None = None,
        finish_reason: str | None = None,
    ) -> None:
        """Log Call."""
        log_entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "request_id": request_id,
            "service": service_name,
            "model": model,
            "messages": messages,
            "duration_ms": duration_ms,
            "success": success,
        }

        if success:
            log_entry["finish_reason"] = finish_reason
        else:
            log_entry["error_type"] = error_type
            log_entry["error_message"] = error_message

        log_line = json.dumps(log_entry) + "\n"
        llm_log_file = cast(TextIO, LLMCallLogger._llm_log_file)
        llm_log_file.write(log_line)
        llm_log_file.flush()

        if not success:
            error_entry = {
                "timestamp": datetime.now(UTC).isoformat(),
                "request_id": request_id,
                "service": service_name,
                "model": model,
                "error_type": error_type,
                "error_message": error_message,
            }
            error_line = json.dumps(error_entry) + "\n"
            error_log_file = cast(TextIO, LLMCallLogger._error_log_file)
            error_log_file.write(error_line)
            error_log_file.flush()


class LLMClient:
    """LLM Client."""

    def __init__(self) -> None:
        """Initialize."""
        self._client = get_openai_client()
        self._logger = LLMCallLogger()

    def chat_completions_create(
        self,
        service_name: str,
        messages: list[dict[str, str]],
        model: str | None = None,
        **kwargs: Any,
    ) -> ChatCompletion:
        """Chat Completions Create."""
        if model is None:
            model = (
                get_llamacpp_model()
                if settings.llm_backend == "llamacpp"
                else settings.open_router_model
            )

        from app.core.tracing import get_tracer

        tracer = get_tracer("scoop-backend")
        span_name = f"llm_call_{service_name}"

        with tracer.start_as_current_span(span_name) as span:
            span.set_attribute("service", service_name)
            span.set_attribute("model", model)
            span.set_attribute("message_count", len(messages))

            # Apply llama.cpp Instruct mode params automatically
            if settings.llm_backend == "llamacpp":
                instruct_params = get_llamacpp_instruct_params()
                kwargs.setdefault("temperature", instruct_params["temperature"])
                kwargs.setdefault("top_p", instruct_params["top_p"])
                kwargs.setdefault("presence_penalty", instruct_params["presence_penalty"])

                extra_body = dict(kwargs.pop("extra_body", {}) or {})
                for key in ("top_k", "min_p", "repetition_penalty"):
                    if key in kwargs:
                        extra_body[key] = kwargs.pop(key)
                    else:
                        extra_body.setdefault(key, instruct_params[key])
                if extra_body:
                    kwargs["extra_body"] = extra_body

            request_id = str(uuid.uuid4())[:8]
            start_time = time.monotonic()

            try:
                client = cast(OpenAI, self._client)
                response = cast(
                    ChatCompletion,
                    client.chat.completions.create(
                        model=model,
                        messages=cast(Iterable[ChatCompletionMessageParam], messages),
                        **kwargs,
                    ),
                )

                duration_ms = int((time.monotonic() - start_time) * 1000)

                finish_reason = response.choices[0].finish_reason if response.choices else "unknown"

                span.set_attribute("duration_ms", duration_ms)
                span.set_attribute("finish_reason", finish_reason)

                self._logger.log_call(
                    request_id=request_id,
                    service_name=service_name,
                    model=model,
                    messages=messages,
                    duration_ms=duration_ms,
                    success=True,
                    finish_reason=finish_reason,
                )

                return response

            except Exception as e:
                duration_ms = int((time.monotonic() - start_time) * 1000)
                error_type = type(e).__name__
                error_message = str(e)

                span.set_attribute("duration_ms", duration_ms)
                span.set_attribute("error_type", error_type)
                span.record_exception(e)

                self._logger.log_call(
                    request_id=request_id,
                    service_name=service_name,
                    model=model,
                    messages=messages,
                    duration_ms=duration_ms,
                    success=False,
                    error_type=error_type,
                    error_message=error_message,
                )

                raise


_llm_client_instance: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """Get Llm Client."""
    global _llm_client_instance
    if _llm_client_instance is None:
        _llm_client_instance = LLMClient()
    return _llm_client_instance
