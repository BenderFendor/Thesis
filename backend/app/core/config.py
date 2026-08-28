"""Config."""

import os
from dataclasses import dataclass
import logging

from dotenv import load_dotenv
from google import genai
from openai import OpenAI

load_dotenv()

SCOOP_USER_AGENT = "ScoopNewsBot/1.0 (https://github.com/anomalyco/Thesis)"
SCOOP_WIKIMEDIA_UA = (
    "ScoopNewsBot/1.0 (https://github.com/anomalyco/Thesis; wikipedia:en; User:BenderFendor)"
)
SCOOP_BROWSER_UA = (
    "Mozilla/5.0 (compatible; ScoopNewsBot/1.0; +https://github.com/anomalyco/Thesis)"
)


def _env_enabled(name: str, default: str = "1") -> bool:
    raw = os.getenv(name, default)
    return raw not in {"0", "false", "False", ""}


def _parse_domain_list(env_var: str, default: str = "") -> tuple[str, ...]:
    raw = os.getenv(env_var, default)
    if not raw:
        return ()
    return tuple(d.strip() for d in raw.split(",") if d.strip())


def _parse_optional_str(env_var: str) -> str | None:
    raw = os.getenv(env_var)
    if raw is None:
        return None
    value = raw.strip()
    return value or None


# Default high-credibility domains for verification
_DEFAULT_VERIFICATION_DOMAINS = (
    "reuters.com,apnews.com,bbc.com,bbc.co.uk,npr.org,pbs.org,"
    "factcheck.org,snopes.com,politifact.com,mediabiasfactcheck.com,"
    "nytimes.com,washingtonpost.com,theguardian.com,wsj.com,"
    "economist.com,nature.com,science.org,gov.uk,usa.gov,who.int,un.org,"
    "wikipedia.org,en.wikipedia.org"
)


@dataclass(frozen=True)
class Settings:
    """Settings."""

    app_title: str = "Global News Aggregation API"
    app_version: str = "1.0.0"
    # Shared operator secret required to materialize evidence claims into accepted
    # facts or to download proof bundles for privacy-scoped entities. Unset by
    # default so the endpoint fails closed until an operator deliberately enables it.
    scoop_materialize_token: str | None = os.getenv("SCOOP_MATERIALIZE_TOKEN")
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
    open_router_api_key: str | None = os.getenv("OPEN_ROUTER_API_KEY")
    open_router_model: str = os.getenv("OPEN_ROUTER_MODEL", "z-ai/glm-4.5-air:free")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    source_research_model: str = os.getenv("SOURCE_RESEARCH_MODEL", "z-ai/glm-4.5-air:free")
    # LLM backend selection: "openrouter" (default), "llamacpp", or "opencode"
    llm_backend: str = os.getenv("LLM_BACKEND", "openrouter")
    llamacpp_base_url: str = os.getenv("LLAMACPP_BASE_URL", "http://localhost:8080/v1")
    llamacpp_model: str = os.getenv("LLAMACPP_MODEL", "local")
    llamacpp_api_key: str = os.getenv("LLAMACPP_API_KEY", "no-key")

    # OpenCode Zen gateway (https://opencode.ai/docs/zen). Exposes an
    # OpenAI-compatible /chat/completions endpoint that serves the free
    # models used by the Pi/OhMyPi integration (e.g. "x-preview-f-free").
    opencode_api_key: str | None = os.getenv("OPENCODE_API_KEY")
    opencode_base_url: str = os.getenv("OPENCODE_BASE_URL", "https://opencode.ai/zen/v1")
    opencode_model: str = os.getenv("OPENCODE_MODEL", "x-preview-f-free")

    # llama.cpp Instruct mode settings for reasoning tasks
    llamacpp_temperature: float = 1.0
    llamacpp_top_p: float = 0.95
    llamacpp_top_k: int = 20
    llamacpp_min_p: float = 0.0
    llamacpp_presence_penalty: float = 1.5
    llamacpp_repetition_penalty: float = 1.0

    source_research_cache_ttl_hours: int = int(os.getenv("SOURCE_RESEARCH_CACHE_TTL_HOURS", "168"))
    frontend_origins: tuple[str, ...] = _parse_domain_list(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"
    )
    frontend_origin_regex: str | None = _parse_optional_str("CORS_ORIGIN_REGEX")
    enable_vector_store: bool = _env_enabled("ENABLE_VECTOR_STORE")
    enable_database: bool = _env_enabled("ENABLE_DATABASE")
    enable_incremental_cache: bool = _env_enabled("ENABLE_INCREMENTAL_CACHE", "1")
    # Atlas data pipelines (entity backfill, evidence ingestion, funding-bias
    # analysis) run automatically on startup -- see app.services.auto_ingest.
    # Disable for tests/CI with SCOOP_AUTO_INGEST=0.
    auto_ingest_enabled: bool = _env_enabled("SCOOP_AUTO_INGEST")
    auto_ingest_interval_hours: int = int(os.getenv("SCOOP_AUTO_INGEST_INTERVAL_HOURS", "24"))
    news_cache_max_articles: int = int(os.getenv("NEWS_CACHE_MAX_ARTICLES", "0"))
    news_cache_max_per_source: int = int(os.getenv("NEWS_CACHE_MAX_PER_SOURCE", "0"))
    startup_cache_article_limit: int = int(os.getenv("STARTUP_CACHE_ARTICLE_LIMIT", "10000"))
    embedding_model_name: str = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
    embedding_service_url: str = os.getenv("EMBEDDING_SERVICE_URL", "http://127.0.0.1:8002")
    embedding_service_timeout_seconds: float = float(
        os.getenv("EMBEDDING_SERVICE_TIMEOUT_SECONDS", "30")
    )
    embedding_batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "64"))
    embedding_max_per_minute: int = int(os.getenv("EMBEDDING_MAX_PER_MINUTE", "240"))
    embedding_queue_size: int = int(os.getenv("EMBEDDING_QUEUE_SIZE", "2000"))
    debug: bool = _env_enabled("DEBUG", "0")
    environment: str = os.getenv("ENVIRONMENT", "development")

    # Verification Agent Settings
    enable_verification: bool = _env_enabled("ENABLE_VERIFICATION", "1")
    verification_max_duration_seconds: int = int(
        os.getenv("VERIFICATION_MAX_DURATION_SECONDS", "15")
    )
    verification_max_claims: int = int(os.getenv("VERIFICATION_MAX_CLAIMS", "10"))
    verification_max_sources_per_claim: int = int(
        os.getenv("VERIFICATION_MAX_SOURCES_PER_CLAIM", "5")
    )
    verification_cache_ttl_hours: int = int(os.getenv("VERIFICATION_CACHE_TTL_HOURS", "24"))
    verification_workspace_dir: str = os.getenv(
        "VERIFICATION_WORKSPACE_DIR", "/tmp/thesis_verification"
    )
    verification_recheck_threshold: float = float(
        os.getenv("VERIFICATION_RECHECK_THRESHOLD", "0.4")
    )
    verification_allowed_domains: tuple[str, ...] = _parse_domain_list(
        "VERIFICATION_ALLOWED_DOMAINS", _DEFAULT_VERIFICATION_DOMAINS
    )

    # Background LLM scoring (propaganda, verification, source analysis)
    background_llm_scoring_enabled: bool = _env_enabled("BACKGROUND_LLM_SCORING_ENABLED", "0")

    # OpenTelemetry tracing settings
    otel_enabled: bool = _env_enabled("OTEL_ENABLED", "0")
    otel_exporter_endpoint: str | None = _parse_optional_str("OTEL_EXPORTER_ENDPOINT")
    otel_sample_rate: float = float(os.getenv("OTEL_SAMPLE_RATE", "1.0"))


settings = Settings()


def create_gemini_client(logger: logging.Logger) -> genai.Client | None:
    """Initialise and return the Gemini client if an API key is configured."""
    if not settings.gemini_api_key:
        logger.warning("GEMINI_API_KEY not found in environment variables")
        return None

    try:
        # Attempt to create client with default settings
        client = genai.Client(api_key=settings.gemini_api_key)
        logger.info("Gemini API configured successfully")
        return client
    except Exception as e:
        logger.error(f"Failed to initialize Gemini client: {e}")
        # Fallback or return None to prevent crash
        return None


def create_openai_client(logger: logging.Logger) -> OpenAI | None:
    """Initialise and return an OpenAI-compatible client for the configured LLM backend.

    Supports three backends selected by LLM_BACKEND:
      "openrouter" (default) — routes to OpenRouter using OPEN_ROUTER_API_KEY.
      "llamacpp"             — routes to a local llama.cpp server (no auth required).
      "opencode"             — routes to OpenCode Zen using OPENCODE_API_KEY.
    """
    if settings.llm_backend == "llamacpp":
        try:
            client = OpenAI(
                base_url=settings.llamacpp_base_url,
                api_key=settings.llamacpp_api_key,
            )
            logger.info("LLM backend: llama.cpp at %s", settings.llamacpp_base_url)
            return client
        except Exception as e:
            logger.error("Failed to initialize llama.cpp client: %s", e)
            return None

    if settings.llm_backend == "opencode":
        if not settings.opencode_api_key:
            logger.warning("OPENCODE_API_KEY not found in environment variables")
            return None
        try:
            client = OpenAI(
                base_url=settings.opencode_base_url,
                api_key=settings.opencode_api_key,
            )
            logger.info(
                "LLM backend: OpenCode Zen at %s (model %s)",
                settings.opencode_base_url,
                settings.opencode_model,
            )
            return client
        except Exception as e:
            logger.error("Failed to initialize OpenCode client: %s", e)
            return None

    # Fall back to OpenRouter when llama.cpp is not selected.
    if not settings.open_router_api_key:
        logger.warning("OPEN_ROUTER_API_KEY not found in environment variables")
        return None

    try:
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.open_router_api_key,
        )
        logger.info("LLM backend: OpenRouter")
        return client
    except Exception as e:
        logger.error("Failed to initialize OpenRouter client: %s", e)
        return None


# Resolved model id discovered from the llama.cpp server at startup.
# None until check_llamacpp_server() runs; get_llamacpp_model() falls back to
# settings.llamacpp_model if it is never populated.
_llamacpp_resolved_model: str | None = None


def get_llamacpp_model() -> str:
    """Return the model id to use for llama.cpp requests.

    Returns the name auto-discovered from /v1/models at startup when
    LLAMACPP_MODEL is left at its default value of "local".  Falls back to
    settings.llamacpp_model if discovery has not run yet (e.g. in tests).
    """
    if _llamacpp_resolved_model is not None:
        return _llamacpp_resolved_model
    return settings.llamacpp_model


def resolve_opencode_model(default: str) -> str:
    """Return the model id to use with the shared OpenAI-compatible client.

    Only the "opencode" backend remaps the caller-supplied default to the Zen
    gateway model (OPENCODE_MODEL). Other backends return the default unchanged
    so per-service models (OPEN_ROUTER_MODEL, SOURCE_RESEARCH_MODEL) keep
    working exactly as before.
    """
    if settings.llm_backend == "opencode":
        return settings.opencode_model
    return default


def _llamacpp_base_url() -> str:
    base = settings.llamacpp_base_url.rstrip("/")
    return base[:-3] if base.endswith("/v1") else base


def _check_llamacpp_health(base: str, logger: logging.Logger) -> None:
    import urllib.error
    import urllib.request

    health_url = base + "/health"
    try:
        with urllib.request.urlopen(health_url, timeout=5) as response:
            if response.status != 200:
                raise RuntimeError(
                    f"llama.cpp health check returned unexpected status {response.status}"
                )
        logger.info("llama.cpp server reachable at %s", health_url)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"LLM_BACKEND=llamacpp but server returned HTTP {exc.code} at {health_url}. "
            "Ensure the server has finished loading the model."
        ) from exc
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(
            f"LLM_BACKEND=llamacpp but server not reachable at {health_url}: {exc}. "
            "Start llama-server first: llama-server -m model.gguf --port 8080"
        ) from exc


def _discover_llamacpp_from_models(base: str, logger: logging.Logger) -> str | None:
    import json
    import urllib.request

    try:
        with urllib.request.urlopen(base + "/v1/models", timeout=5) as response:
            payload = json.loads(response.read().decode())
    except Exception as exc:
        logger.debug("Models endpoint discovery failed (%s)", exc)
        return None
    data = payload.get("data") or []
    if data:
        return data[0].get("id")
    models = payload.get("models") or []
    if not models:
        return None
    return models[0].get("model") or models[0].get("name")


def _discover_llamacpp_from_sentinel(base: str, logger: logging.Logger) -> str | None:
    import json
    import urllib.request

    body = json.dumps({"model": "", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1}).encode()
    request = urllib.request.Request(
        base + "/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode())
    except Exception as exc:
        logger.debug("Sentinel completion discovery failed (%s)", exc)
        return None
    model = payload.get("model")
    return str(model) if model else None


def _llama_model_from_cmdline(parts: list[str]) -> str | None:
    from pathlib import Path

    if not any("llama" in part for part in parts):
        return None
    for index, part in enumerate(parts[:-1]):
        if part in ("-m", "--model"):
            model_name = Path(parts[index + 1]).name
            if model_name:
                return model_name
    return None


def _discover_llamacpp_from_processes(logger: logging.Logger) -> str | None:
    from pathlib import Path

    try:
        cmdlines = Path("/proc").glob("*/cmdline")
        for path in cmdlines:
            try:
                parts = [part.decode(errors="replace") for part in path.read_bytes().split(b"\x00")]
            except (PermissionError, FileNotFoundError, ProcessLookupError):
                continue
            model = _llama_model_from_cmdline(parts)
            if model:
                return model
    except Exception as exc:
        logger.debug("Process-arg discovery failed (%s)", exc)
    return None

def check_llamacpp_server(logger: logging.Logger) -> None:
    """Validate llama.cpp and resolve the model id used for requests."""
    global _llamacpp_resolved_model

    base = _llamacpp_base_url()
    _check_llamacpp_health(base, logger)
    if settings.llamacpp_model != "local":
        _llamacpp_resolved_model = settings.llamacpp_model
        logger.info("llama.cpp model (explicit): %s", _llamacpp_resolved_model)
        return

    discovery_steps = (
        ("/v1/models", _discover_llamacpp_from_models),
        ("sentinel completion", _discover_llamacpp_from_sentinel),
        ("process args", lambda _base, log: _discover_llamacpp_from_processes(log)),
    )
    for source, discover in discovery_steps:
        model = discover(base, logger)
        if not model:
            continue
        _llamacpp_resolved_model = model
        logger.info("llama.cpp model (from %s): %s", source, model)
        return

    logger.warning(
        "Could not discover llama.cpp model id; using '%s'. Set LLAMACPP_MODEL explicitly to avoid this.",
        settings.llamacpp_model,
    )



_openai_client_instance: OpenAI | None = None


def get_llamacpp_instruct_params() -> dict[str, float | int]:
    """Return llama.cpp inference parameters for Instruct/reasoning mode."""
    return {
        "temperature": settings.llamacpp_temperature,
        "top_p": settings.llamacpp_top_p,
        "top_k": settings.llamacpp_top_k,
        "min_p": settings.llamacpp_min_p,
        "presence_penalty": settings.llamacpp_presence_penalty,
        "repetition_penalty": settings.llamacpp_repetition_penalty,
    }


def get_openai_client() -> OpenAI | None:
    """Get singleton OpenAI-compatible client instance, created lazily on first use."""
    global _openai_client_instance
    if _openai_client_instance is None:
        import logging

        logger = logging.getLogger("app.core.config")
        _openai_client_instance = create_openai_client(logger)
    return _openai_client_instance
