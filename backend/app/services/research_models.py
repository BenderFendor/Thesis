"""Model selection and provider construction for the news research agent."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ResearchModelProfile:
    """A model profile that can be selected for one research request."""

    id: str
    label: str
    model: str
    provider: str


def _model_profile(provider: str, model: str, label: str) -> ResearchModelProfile:
    return ResearchModelProfile(
        id=f"{provider}:{model}",
        label=label,
        model=model,
        provider=provider,
    )


def get_research_model_options(config: Any) -> tuple[ResearchModelProfile, ...]:
    """Return models for the active backend, not stale credentials from others."""
    provider = getattr(config, "llm_backend", "openrouter")
    if provider == "opencode":
        if not getattr(config, "opencode_api_key", None):
            return ()
        default_model = getattr(config, "opencode_model", "mimo-v2.5-free")
        models = (default_model, *getattr(config, "opencode_research_models", ()))
        return tuple(
            _model_profile("opencode", model, "OpenCode Zen")
            for model in dict.fromkeys(models)
            if model
        )
    if provider == "openrouter":
        if not getattr(config, "open_router_api_key", None):
            return ()
        return (_model_profile("openrouter", getattr(config, "open_router_model", ""), "OpenRouter"),)
    if provider == "gemini":
        if not getattr(config, "gemini_api_key", None):
            return ()
        return (_model_profile("gemini", getattr(config, "gemini_model", ""), "Google Gemini"),)
    if provider == "llamacpp":
        return (_model_profile("llamacpp", getattr(config, "llamacpp_model", "local"), "Local llama.cpp"),)
    return ()


def _default_research_model(
    config: Any,
    options: tuple[ResearchModelProfile, ...],
) -> ResearchModelProfile:
    preferred_provider = getattr(config, "llm_backend", "openrouter")
    return next(
        (option for option in options if option.provider == preferred_provider),
        options[0],
    )


def resolve_research_model(config: Any, model_id: str | None = None) -> ResearchModelProfile:
    """Resolve a requested model or the configured default."""
    options = get_research_model_options(config)
    if not options:
        raise RuntimeError("No research model is configured on the backend.")
    if model_id is None:
        return _default_research_model(config, options)
    selected = next((option for option in options if option.id == model_id), None)
    if selected is None:
        raise ValueError("That research model is not configured on the backend.")
    return selected


def get_research_model_catalog(config: Any) -> dict[str, object]:
    """Return the public model catalog for the selector endpoint."""
    options = get_research_model_options(config)
    default = _default_research_model(config, options) if options else None
    return {
        "default": default.id if default is not None else None,
        "models": [asdict(option) for option in options],
        "provider": getattr(config, "llm_backend", "unknown"),
    }


def build_research_llm(
    profile: ResearchModelProfile,
    config: Any,
    session_id: str | None,
    *,
    chat_openai: Callable[..., Any],
    chat_gemini: Callable[..., Any],
    secret_str: Callable[[str], Any],
    opencode_headers: Callable[[str | None], dict[str, str]],
    llamacpp_model: Callable[[], str],
) -> Any:
    """Build a provider client while keeping provider-specific wiring local."""
    if profile.provider == "opencode":
        api_key = getattr(config, "opencode_api_key", None)
        if not api_key:
            raise RuntimeError("OpenCode Zen is not configured on the backend.")
        return chat_openai(
            model=profile.model,
            temperature=0.2,
            api_key=secret_str(api_key),
            base_url=getattr(config, "opencode_base_url", "https://opencode.ai/zen/v1"),
            default_headers=opencode_headers(session_id),
            max_retries=2,
            timeout=30.0,
        )
    if profile.provider == "openrouter":
        api_key = getattr(config, "open_router_api_key", None)
        if not api_key:
            raise RuntimeError("OpenRouter is not configured on the backend.")
        return chat_openai(
            model=profile.model,
            temperature=0.2,
            api_key=secret_str(api_key),
            base_url="https://openrouter.ai/api/v1",
        )
    if profile.provider == "llamacpp":
        return chat_openai(
            model=profile.model or llamacpp_model(),
            temperature=0.2,
            api_key=secret_str(getattr(config, "llamacpp_api_key", "no-key")),
            base_url=getattr(config, "llamacpp_base_url", "http://localhost:8080/v1"),
        )
    return chat_gemini(
        model=profile.model, google_api_key=config.gemini_api_key,
        temperature=0.2, max_retries=2,
    )


def bind_research_tools(
    llm: Any,
    profile: ResearchModelProfile,
    tools: Sequence[Any],
    *,
    tool_choice: str | None = None,
    warn: Callable[[str], None],
) -> Any:
    """Bind research tools, retrying without llama.cpp-only options when needed."""
    kwargs: dict[str, Any] = {}
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice
    if profile.provider == "llamacpp":
        kwargs["parallel_tool_calls"] = False
    try:
        return llm.bind_tools(tools, **kwargs)
    except TypeError:
        if profile.provider != "llamacpp":
            raise
        warn("parallel_tool_calls is unsupported by this backend; using default tool binding")
        return llm.bind_tools(tools, **({"tool_choice": tool_choice} if tool_choice else {}))


def get_cached_research_tools(
    cache: dict[str, Any],
    profile: ResearchModelProfile,
    tools: Sequence[Any],
    get_llm: Callable[[], Any],
    warn: Callable[[str], None],
    tool_choice: str | None = None,
) -> Any:
    """Return one cached tool-bound client for a model profile."""
    # Zen headers belong to a run/request, never to the process-wide model cache.
    cached = cache.get(profile.id) if profile.provider != "opencode" else None
    if cached is not None:
        return cached
    bound = bind_research_tools(get_llm(), profile, tools, tool_choice=tool_choice, warn=warn)
    if profile.provider != "opencode":
        cache[profile.id] = bound
    return bound


def is_recoverable_llamacpp_error(provider: str, message: str) -> bool:
    """Return whether a provider error can be retried after message sanitization."""
    if provider != "llamacpp":
        return False
    lowered = message.lower()
    recoverable_terms = (
        "cannot have 2 or more assistant messages at the end of the list",
        "jinja",
        "chat template",
        "template error",
        "system message must be",
        "conversation roles must alternate",
    )
    return any(term in lowered for term in recoverable_terms) or (
        "invalid_request_error" in lowered and "model" in lowered and "not found" in lowered
    )
