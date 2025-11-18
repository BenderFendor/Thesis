import os
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv
from google import genai

load_dotenv()


def _env_enabled(name: str, default: str = "1") -> bool:
    raw = os.getenv(name, default)
    return raw not in {"0", "false", "False", ""}


@dataclass(frozen=True)
class Settings:
    app_title: str = "Global News Aggregation API"
    app_version: str = "1.0.0"
    gemini_api_key: Optional[str] = os.getenv("GEMINI_API_KEY")
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

    client = genai.Client(api_key=settings.gemini_api_key)
    logger.info("✅ Gemini API configured successfully")
    return client
