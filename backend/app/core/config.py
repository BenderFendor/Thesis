import os
from dataclasses import dataclass
import logging
from typing import Optional, Tuple

from dotenv import load_dotenv
from google import genai
from openai import OpenAI

load_dotenv()


def _env_enabled(name: str, default: str = "1") -> bool:
    raw = os.getenv(name, default)
    return raw not in {"0", "false", "False", ""}


def _parse_domain_list(env_var: str, default: str = "") -> Tuple[str, ...]:
    raw = os.getenv(env_var, default)
    if not raw:
        return ()
    return tuple(d.strip() for d in raw.split(",") if d.strip())


def _parse_optional_str(env_var: str) -> Optional[str]:
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
    app_title: str = "Global News Aggregation API"
    app_version: str = "1.0.0"
    gemini_api_key: Optional[str] = os.getenv("GEMINI_API_KEY")
    open_router_api_key: Optional[str] = os.getenv("OPEN_ROUTER_API_KEY")
    open_router_model: str = os.getenv("OPEN_ROUTER_MODEL", "z-ai/glm-4.5-air:free")
    source_research_model: str = os.getenv(
        "SOURCE_RESEARCH_MODEL", "z-ai/glm-4.5-air:free"
    )
    # LLM backend selection: "openrouter" (default) or "llamacpp"
    llm_backend: str = os.getenv("LLM_BACKEND", "openrouter")
    llamacpp_base_url: str = os.getenv("LLAMACPP_BASE_URL", "http://localhost:8080/v1")
    llamacpp_model: str = os.getenv("LLAMACPP_MODEL", "local")
    llamacpp_api_key: str = os.getenv("LLAMACPP_API_KEY", "no-key")

    # llama.cpp Instruct mode settings for reasoning tasks
    llamacpp_temperature: float = 1.0
    llamacpp_top_p: float = 0.95
    llamacpp_top_k: int = 20
    llamacpp_min_p: float = 0.0
    llamacpp_presence_penalty: float = 1.5
    llamacpp_repetition_penalty: float = 1.0

    source_research_cache_ttl_hours: int = int(
        os.getenv("SOURCE_RESEARCH_CACHE_TTL_HOURS", "168")
    )
    frontend_origins: tuple[str, ...] = _parse_domain_list(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"
    )
    frontend_origin_regex: Optional[str] = _parse_optional_str("CORS_ORIGIN_REGEX")
    enable_vector_store: bool = _env_enabled("ENABLE_VECTOR_STORE")
    enable_database: bool = _env_enabled("ENABLE_DATABASE")
    enable_incremental_cache: bool = _env_enabled("ENABLE_INCREMENTAL_CACHE", "1")
    news_cache_max_articles: int = int(os.getenv("NEWS_CACHE_MAX_ARTICLES", "3000"))
    news_cache_max_per_source: int = int(os.getenv("NEWS_CACHE_MAX_PER_SOURCE", "20"))
    embedding_model_name: str = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
    embedding_service_url: str = os.getenv(
        "EMBEDDING_SERVICE_URL", "http://127.0.0.1:8002"
    )
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
    verification_cache_ttl_hours: int = int(
        os.getenv("VERIFICATION_CACHE_TTL_HOURS", "24")
    )
    verification_workspace_dir: str = os.getenv(
        "VERIFICATION_WORKSPACE_DIR", "/tmp/thesis_verification"
    )
    verification_recheck_threshold: float = float(
        os.getenv("VERIFICATION_RECHECK_THRESHOLD", "0.4")
    )
    verification_allowed_domains: Tuple[str, ...] = _parse_domain_list(
        "VERIFICATION_ALLOWED_DOMAINS", _DEFAULT_VERIFICATION_DOMAINS
    )


settings = Settings()


def create_gemini_client(logger: logging.Logger) -> Optional[genai.Client]:
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


def create_openai_client(logger: logging.Logger) -> Optional[OpenAI]:
    """Initialise and return an OpenAI-compatible client for the configured LLM backend.

    Supports two backends selected by LLM_BACKEND:
      "openrouter" (default) — routes to OpenRouter using OPEN_ROUTER_API_KEY.
      "llamacpp"             — routes to a local llama.cpp server (no auth required).
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

    # Default: OpenRouter
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
_llamacpp_resolved_model: Optional[str] = None


def get_llamacpp_model() -> str:
    """Return the model id to use for llama.cpp requests.

    Returns the name auto-discovered from /v1/models at startup when
    LLAMACPP_MODEL is left at its default value of "local".  Falls back to
    settings.llamacpp_model if discovery has not run yet (e.g. in tests).
    """
    if _llamacpp_resolved_model is not None:
        return _llamacpp_resolved_model
    return settings.llamacpp_model


def check_llamacpp_server(logger: logging.Logger) -> None:
    """Probe the llama.cpp /health endpoint and raise RuntimeError if unreachable.

    Also auto-discovers the model name to use in API requests and stores it in
    _llamacpp_resolved_model so every subsequent call uses the correct name.
    Discovery order: /props model_alias → /v1/models → process cmdline.

    Called at app startup when LLM_BACKEND=llamacpp so failures surface immediately
    rather than on the first LLM request.
    """
    global _llamacpp_resolved_model

    import json
    import urllib.error
    import urllib.request

    # Strip /v1 suffix to get the server root, then append /health
    base = settings.llamacpp_base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    health_url = base + "/health"
    models_url = base + "/v1/models"

    try:
        with urllib.request.urlopen(health_url, timeout=5) as resp:
            if resp.status != 200:
                raise RuntimeError(
                    f"llama.cpp health check returned unexpected status {resp.status}"
                )
            logger.info("llama.cpp server reachable at %s", health_url)
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"LLM_BACKEND=llamacpp but server returned HTTP {e.code} at {health_url}. "
            "Ensure the server has finished loading the model."
        ) from e
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(
            f"LLM_BACKEND=llamacpp but server not reachable at {health_url}: {e}. "
            "Start llama-server first: llama-server -m model.gguf --port 8080"
        ) from e

    # If the user set an explicit model name, trust it and skip discovery.
    if settings.llamacpp_model != "local":
        _llamacpp_resolved_model = settings.llamacpp_model
        logger.info("llama.cpp model (explicit): %s", _llamacpp_resolved_model)
        return

    # Auto-discover the model name to use in API requests.
    #
    # Strategy 1: /v1/models data — populated after the router handles its first
    #   request; on cold start this array is empty, so fall through.
    # Strategy 2: Sentinel completion with model="" — the router accepts an empty
    #   model string and routes to whichever worker is ready, returning the actual
    #   model id in the response.  Warm-up cost: 1 token.
    # Strategy 3: Process cmdline (-m flag) — zero-cost fallback for standalone
    #   (non-router) llama-server instances.
    try:
        with urllib.request.urlopen(models_url, timeout=5) as resp:
            payload = json.loads(resp.read().decode())
        data = payload.get("data") or []
        if data:
            _llamacpp_resolved_model = data[0]["id"]
            logger.info(
                "llama.cpp model (from /v1/models): %s", _llamacpp_resolved_model
            )
            return
        models = payload.get("models") or []
        if models:
            _llamacpp_resolved_model = models[0].get("model") or models[0].get("name")
            logger.info(
                "llama.cpp model (from /v1/models legacy): %s", _llamacpp_resolved_model
            )
            return
    except Exception as e:
        logger.debug("Models endpoint discovery failed (%s)", e)

    # Strategy 2: sentinel — model="" is accepted by the router on both warm and
    # cold starts; the response body contains the actual model id.
    completions_url = base + "/v1/chat/completions"
    sentinel_body = json.dumps(
        {
            "model": "",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
        }
    ).encode()
    try:
        req = urllib.request.Request(
            completions_url,
            data=sentinel_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            completion = json.loads(resp.read().decode())
        discovered = completion.get("model")
        if discovered:
            _llamacpp_resolved_model = discovered
            logger.info(
                "llama.cpp model (from sentinel completion): %s",
                _llamacpp_resolved_model,
            )
            return
    except Exception as e:
        logger.debug("Sentinel completion discovery failed (%s)", e)

    try:
        import glob as _glob
        import os as _os

        for cmdline_path in _glob.glob("/proc/*/cmdline"):
            try:
                with open(cmdline_path, "rb") as f:
                    parts = f.read().split(b"\x00")
                parts_str = [p.decode(errors="replace") for p in parts]
                if not any("llama" in p for p in parts_str):
                    continue
                for i, part in enumerate(parts_str):
                    if part in ("-m", "--model") and i + 1 < len(parts_str):
                        model_name = _os.path.basename(parts_str[i + 1])
                        if model_name:
                            _llamacpp_resolved_model = model_name
                            logger.info(
                                "llama.cpp model (from process args): %s",
                                _llamacpp_resolved_model,
                            )
                            return
            except (PermissionError, FileNotFoundError, ProcessLookupError):
                continue
    except Exception as e:
        logger.debug("Process-arg discovery failed (%s)", e)

    logger.warning(
        "Could not discover llama.cpp model id; using '%s'. "
        "Set LLAMACPP_MODEL explicitly to avoid this.",
        settings.llamacpp_model,
    )


_openai_client_instance: Optional[OpenAI] = None


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


def get_openai_client() -> Optional[OpenAI]:
    """Get singleton OpenAI-compatible client instance, created lazily on first use."""
    global _openai_client_instance
    if _openai_client_instance is None:
        import logging

        logger = logging.getLogger("app.core.config")
        _openai_client_instance = create_openai_client(logger)
    return _openai_client_instance
