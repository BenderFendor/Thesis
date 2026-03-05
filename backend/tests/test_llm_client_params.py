from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core import llm_client as llm_client_module


def test_llamacpp_extra_body_contains_nonstandard_sampling_params(monkeypatch) -> None:
    mock_create = MagicMock(
        return_value=SimpleNamespace(
            choices=[SimpleNamespace(finish_reason="stop")],
        )
    )
    mock_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=mock_create),
        )
    )

    class DummyCallLogger:
        def log_call(self, **_kwargs) -> None:
            return None

    monkeypatch.setattr(llm_client_module, "LLMCallLogger", DummyCallLogger)
    monkeypatch.setattr(llm_client_module, "get_openai_client", lambda: mock_client)
    monkeypatch.setattr(
        llm_client_module,
        "settings",
        SimpleNamespace(llm_backend="llamacpp", open_router_model="unused-model"),
    )
    monkeypatch.setattr(llm_client_module, "get_llamacpp_model", lambda: "local")
    monkeypatch.setattr(
        llm_client_module,
        "get_llamacpp_instruct_params",
        lambda: {
            "temperature": 1.0,
            "top_p": 0.95,
            "top_k": 20,
            "min_p": 0.0,
            "presence_penalty": 1.5,
            "repetition_penalty": 1.0,
        },
    )

    client = llm_client_module.LLMClient()
    client.chat_completions_create(
        service_name="test",
        messages=[{"role": "user", "content": "hello"}],
    )

    kwargs = mock_create.call_args.kwargs
    assert kwargs["temperature"] == 1.0
    assert kwargs["top_p"] == 0.95
    assert kwargs["presence_penalty"] == 1.5
    assert "top_k" not in kwargs
    assert "min_p" not in kwargs
    assert "repetition_penalty" not in kwargs
    assert kwargs["extra_body"]["top_k"] == 20
    assert kwargs["extra_body"]["min_p"] == 0.0
    assert kwargs["extra_body"]["repetition_penalty"] == 1.0
