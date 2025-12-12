import os
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv
from google import genai
from openai import OpenAI

load_dotenv()


def _env_enabled(name: str, default: str = "1") -> bool:
    raw = os.getenv(name, default)
    return raw not in {"0", "false", "False", ""}


@dataclass(frozen=True)
class Settings:
    app_title: str = "Global News Aggregation API"
    app_version: str = "1.0.0"
    gemini_api_key: Optional[str] = os.getenv("GEMINI_API_KEY")
    open_router_api_key: Optional[str] = os.getenv("OPEN_ROUTER_API_KEY")
    open_router_model: str = os.getenv("OPEN_ROUTER_MODEL", "google/gemini-2.0-flash-exp:free")
    frontend_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://localhost:3001",
    )
    enable_vector_store: bool = _env_enabled("ENABLE_VECTOR_STORE")
    enable_database: bool = _env_enabled("ENABLE_DATABASE")


settings = Settings()


def create_gemini_client(logger) -> Optional[genai.Client]:
    """Initialise and return the Gemini client if an API key is configured."""
    if not settings.gemini_api_key:
        logger.warning("⚠️ GEMINI_API_KEY not found in environment variables")
        return None

    try:
        # Attempt to create client with default settings
        client = genai.Client(api_key=settings.gemini_api_key)
        logger.info("✅ Gemini API configured successfully")
        return client
    except Exception as e:
        logger.error(f"❌ Failed to initialize Gemini client: {e}")
        # Fallback or return None to prevent crash
        return None


def create_openai_client(logger) -> Optional[OpenAI]:
    """Initialise and return the OpenAI client for OpenRouter if an API key is configured."""
    if not settings.open_router_api_key:
        logger.warning("⚠️ OPEN_ROUTER_API_KEY not found in environment variables")
        return None

    try:
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.open_router_api_key,
        )
        logger.info("✅ OpenRouter API configured successfully")
        return client
    except Exception as e:
        logger.error(f"❌ Failed to initialize OpenRouter client: {e}")
        return None


def get_openai_client() -> Optional[OpenAI]:
    """Helper to get OpenAI client with a default logger."""
    import logging
    logger = logging.getLogger("app.core.config")
    return create_openai_client(logger)
