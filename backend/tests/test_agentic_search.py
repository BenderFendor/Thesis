from types import SimpleNamespace

import agentic_search as search


def test_create_chat_llm_uses_settings_openrouter_model(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class DummyChatOpenAI:
        def __init__(self, **kwargs) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(
        search,
        "settings",
        SimpleNamespace(
            llm_backend="openrouter",
            open_router_api_key="openrouter-key",
            open_router_model="custom/openrouter-model",
            gemini_api_key=None,
            llamacpp_api_key="llamacpp-key",
            llamacpp_base_url="http://localhost:8080/v1",
        ),
    )
    monkeypatch.setattr(search, "ChatOpenAI", DummyChatOpenAI)

    llm = search._create_chat_llm()

    assert isinstance(llm, DummyChatOpenAI)
    assert captured["model"] == "custom/openrouter-model"
    assert captured["api_key"] == "openrouter-key"
    assert captured["base_url"] == "https://openrouter.ai/api/v1"


def test_backend_banner_reports_active_openrouter_model(monkeypatch) -> None:
    monkeypatch.setattr(
        search,
        "settings",
        SimpleNamespace(
            llm_backend="openrouter",
            open_router_api_key="openrouter-key",
            open_router_model="custom/openrouter-model",
            gemini_api_key=None,
        ),
    )

    assert search._backend_banner() == "OpenRouter (custom/openrouter-model)"
