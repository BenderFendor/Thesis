import os
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv
from google import genai

load_dotenv()


@dataclass(frozen=True)
class Settings:
    app_title: str = "Global News Aggregation API"
    app_version: str = "1.0.0"
    gemini_api_key: Optional[str] = os.getenv("GEMINI_API_KEY")
    frontend_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://localhost:3001",
    )
    enable_live_ingestion: bool = os.getenv("ENABLE_LIVE_INGESTION", "false").lower() == "true"


settings = Settings()


def create_gemini_client(logger) -> Optional[genai.Client]:
    """Initialise and return the Gemini client if an API key is configured."""
    if not settings.gemini_api_key:
        logger.warning("⚠️ GEMINI_API_KEY not found in environment variables")
        return None

    client = genai.Client(api_key=settings.gemini_api_key)
    logger.info("✅ Gemini API configured successfully")
    return client
