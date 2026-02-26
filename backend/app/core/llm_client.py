import uuid
import time
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.core.config import get_openai_client, settings
from app.core.logging import get_session_dir


class LLMCallLogger:
    _instance: Optional["LLMCallLogger"] = None
    _llm_log_file = None
    _error_log_file = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._setup_session()

    def _setup_session(self):
        if LLMCallLogger._llm_log_file is not None:
            return

        session_dir = get_session_dir()

        llm_log_path = session_dir / "llm_calls.log"
        error_log_path = session_dir / "api_errors.log"

        LLMCallLogger._llm_log_file = open(llm_log_path, "a")
        LLMCallLogger._error_log_file = open(error_log_path, "a")

    def close(self):
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
        messages: List[Dict[str, str]],
        duration_ms: int,
        success: bool,
        error_type: Optional[str] = None,
        error_message: Optional[str] = None,
        finish_reason: Optional[str] = None,
    ):
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
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
        LLMCallLogger._llm_log_file.write(log_line)
        LLMCallLogger._llm_log_file.flush()

        if not success:
            error_entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "request_id": request_id,
                "service": service_name,
                "model": model,
                "error_type": error_type,
                "error_message": error_message,
            }
            error_line = json.dumps(error_entry) + "\n"
            LLMCallLogger._error_log_file.write(error_line)
            LLMCallLogger._error_log_file.flush()


class LLMClient:
    def __init__(self):
        self._client = get_openai_client()
        self._logger = LLMCallLogger()

    def chat_completions_create(
        self,
        service_name: str,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        **kwargs,
    ) -> Any:
        if model is None:
            model = settings.open_router_model

        request_id = str(uuid.uuid4())[:8]
        start_time = time.monotonic()

        try:
            response = self._client.chat.completions.create(
                model=model,
                messages=messages,
                **kwargs,
            )

            duration_ms = int((time.monotonic() - start_time) * 1000)

            finish_reason = (
                response.choices[0].finish_reason if response.choices else "unknown"
            )

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


_llm_client_instance: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    global _llm_client_instance
    if _llm_client_instance is None:
        _llm_client_instance = LLMClient()
    return _llm_client_instance
