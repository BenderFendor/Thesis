"""Tests for the OpenCode Zen LLM backend (LLM_BACKEND=opencode)."""

import logging
from types import SimpleNamespace

from openai import OpenAI

import agentic_search as search
import news_research_agent
from app.core import config as config_module
from app.core.config import create_openai_client, resolve_opencode_model


def _opencode_settings(**overrides):
    values = dict(
        llm_backend="opencode",
        opencode_api_key="zen-key",
        opencode_base_url="https://opencode.ai/zen/v1",
        opencode_model="x-preview-f-free",
        open_router_api_key=None,
        open_router_model="z-ai/glm-4.5-air:free",
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def _llamacpp_settings():
    return SimpleNamespace(
        llm_backend="llamacpp",
        llamacpp_base_url="http://localhost:8080/v1",
        llamacpp_api_key="no-key",
        open_router_api_key=None,
    )


def _openrouter_settings():
    return SimpleNamespace(
        llm_backend="openrouter",
        open_router_api_key="openrouter-key",
        open_router_model="custom/openrouter-model",
        llamacpp_base_url="http://localhost:8080/v1",
        llamacpp_api_key="no-key",
    )


def test_create_openai_client_opencode_uses_zen_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(config_module, "settings", _opencode_settings())

    client = create_openai_client(logging.getLogger("test-opencode"))

    assert isinstance(client, OpenAI)
    assert "opencode.ai/zen/v1" in str(client.base_url)
    assert client.api_key == "zen-key"


def test_create_openai_client_opencode_without_key_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(
        config_module,
        "settings",
        _opencode_settings(opencode_api_key=None),
    )

    client = create_openai_client(logging.getLogger("test-opencode"))

    assert client is None


def test_factory_keeps_existing_backends(monkeypatch) -> None:
    logger = logging.getLogger("test-opencode")

    monkeypatch.setattr(config_module, "settings", _openrouter_settings())
    openrouter_client = create_openai_client(logger)
    assert openrouter_client is not None
    assert str(openrouter_client.base_url).rstrip("/") == "https://openrouter.ai/api/v1"

    monkeypatch.setattr(config_module, "settings", _llamacpp_settings())
    llamacpp_client = create_openai_client(logger)
    assert llamacpp_client is not None
    assert str(llamacpp_client.base_url).rstrip("/") == "http://localhost:8080/v1"


def test_resolve_opencode_model_overrides_only_for_opencode(monkeypatch) -> None:
    default_model = "z-ai/glm-4.5-air:free"

    monkeypatch.setattr(config_module, "settings", _opencode_settings(opencode_model="zen-model"))
    assert resolve_opencode_model(default_model) == "zen-model"

    monkeypatch.setattr(
        config_module,
        "settings",
        _opencode_settings(llm_backend="openrouter", opencode_model="zen-model"),
    )
    assert resolve_opencode_model(default_model) == default_model

    monkeypatch.setattr(
        config_module,
        "settings",
        SimpleNamespace(llm_backend="llamacpp", opencode_model="zen-model"),
    )
    assert resolve_opencode_model("local") == "local"


def test_news_research_agent_binds_opencode_zen(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class DummyChatOpenAI:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(news_research_agent, "ChatOpenAI", DummyChatOpenAI)
    monkeypatch.setattr(
        news_research_agent,
        "settings",
        SimpleNamespace(
            llm_backend="opencode",
            opencode_api_key="zen-key",
            opencode_base_url="https://opencode.ai/zen/v1",
            opencode_model="x-preview-f-free",
            open_router_api_key="unused-openrouter-key",
        ),
    )

    news_research_agent._reset_llm_instances()
    try:
        news_research_agent._get_llm()
    finally:
        news_research_agent._reset_llm_instances()

    assert captured["model"] == "x-preview-f-free"
    assert captured["api_key"].get_secret_value() == "zen-key"
    assert captured["base_url"] == "https://opencode.ai/zen/v1"


def test_agentic_search_chat_llm_uses_opencode(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class DummyChatOpenAI:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(search, "ChatOpenAI", DummyChatOpenAI)
    monkeypatch.setattr(search, "settings", _opencode_settings())
    llm = search._create_chat_llm()

    assert isinstance(llm, DummyChatOpenAI)
    assert captured["model"] == "x-preview-f-free"
    assert captured["api_key"].get_secret_value() == "zen-key"
