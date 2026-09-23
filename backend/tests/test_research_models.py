"""Tests for request-scoped research model selection and errors."""

from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessageChunk

import news_research_agent
from app.api.routes import research as research_route
from app.services.research_streaming import model_delta_events


def _settings(**overrides):
    values = {
        "llm_backend": "opencode",
        "opencode_api_key": "zen-key",
        "opencode_model": "mimo-v2.5-free",
        "opencode_research_models": (),
        "open_router_api_key": "router-key",
        "open_router_model": "openai/gpt-oss-120b:free",
        "gemini_api_key": None,
        "gemini_model": "gemini-3-flash-preview",
        "llamacpp_model": "local",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_model_catalog_contains_only_configured_providers(monkeypatch) -> None:
    monkeypatch.setattr(news_research_agent, "settings", _settings())

    catalog = news_research_agent.get_research_model_catalog()

    assert catalog["default"] == "opencode:mimo-v2.5-free"
    assert [model["provider"] for model in catalog["models"]] == ["opencode"]


def test_resolve_research_model_rejects_unconfigured_id(monkeypatch) -> None:
    monkeypatch.setattr(news_research_agent, "settings", _settings())

    selected = news_research_agent.resolve_research_model("opencode:mimo-v2.5-free")

    assert selected.provider == "opencode"
    with pytest.raises(ValueError, match="not configured"):
        news_research_agent.resolve_research_model("gemini:missing")


def test_provider_outage_is_retryable_without_raw_exception() -> None:
    payload = research_route._research_error_payload(
        "Error code: 503 - Endpoint is unavailable", "opencode:test-free"
    )
    assert payload["code"] == "provider_unavailable"
    assert payload["retryable"] is True
    assert "503" not in payload["message"]
    assert "choose another model" in payload["message"]


def test_rate_limit_error_payload_is_actionable() -> None:
    payload = research_route._research_error_payload("provider returned HTTP 429", "openrouter:model")

    assert payload["code"] == "rate_limit"
    assert payload["model"] == "openrouter:model"
    assert payload["retryable"] is True
    assert "Choose another model" in payload["message"]


def test_model_delta_events_preserve_provider_reasoning() -> None:
    chunk = AIMessageChunk(
        content="answer",
        additional_kwargs={"reasoning": "plan"},
    )

    assert list(model_delta_events(chunk)) == [
        {
            "type": "model_delta",
            "message_id": "model",
            "content": "answer",
            "reasoning": "plan",
        }
    ]
