import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

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
    open_router_model: str = os.getenv("OPEN_ROUTER_MODEL", "openai/gpt-oss-120b:free")
    frontend_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://localhost:3001",
    )
    enable_vector_store: bool = _env_enabled("ENABLE_VECTOR_STORE")
    enable_database: bool = _env_enabled("ENABLE_DATABASE")
    enable_incremental_cache: bool = _env_enabled("ENABLE_INCREMENTAL_CACHE", "1")
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


def create_gemini_client(logger) -> Optional[genai.Client]:
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


def create_openai_client(logger) -> Optional[OpenAI]:
    """Initialise and return the OpenAI client for OpenRouter if an API key is configured."""
    if not settings.open_router_api_key:
        logger.warning("OPEN_ROUTER_API_KEY not found in environment variables")
        return None

    try:
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.open_router_api_key,
        )
        logger.info("OpenRouter API configured successfully")
        return client
    except Exception as e:
        logger.error(f"Failed to initialize OpenRouter client: {e}")
        return None


_openai_client_instance: Optional[OpenAI] = None


def get_openai_client() -> Optional[OpenAI]:
    """Get singleton OpenAI client instance, created lazily on first use."""
    global _openai_client_instance
    if _openai_client_instance is None:
        import logging

        logger = logging.getLogger("app.core.config")
        _openai_client_instance = create_openai_client(logger)
    return _openai_client_instance
