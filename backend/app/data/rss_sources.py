import json
from pathlib import Path
from typing import Dict, Any
from app.core.logging import get_logger

logger = get_logger(__name__)

_DATA_PATH = Path(__file__).with_name("rss_sources.json")

with _DATA_PATH.open("r", encoding="utf-8") as _source_file:
    _RAW_SOURCES: Dict[str, Any] = json.load(_source_file)


def get_rss_sources() -> Dict[str, Dict[str, Any]]:
    """Load RSS sources from JSON, flattening nested URL arrays into separate sources."""
    flattened = {}

    for key, value in _RAW_SOURCES.items():
        if not isinstance(value, dict):
            logger.warning(f"Skipping invalid source {key}: not a dict")
            continue

        # Check if 'url' is a list (multiple feeds) or string (single feed)
        urls = value.get("url")

        if isinstance(urls, list) and urls:
            # Flatten array of URLs into separate sources
            for idx, url in enumerate(urls, 1):
                if isinstance(url, str) and url.strip():
                    composite_key = f"{key} - {idx}"
                    flattened[composite_key] = {
                        "url": url.strip(),
                        "category": value.get("category", "general"),
                        "country": value.get("country", ""),
                        "funding_type": value.get("funding_type", ""),
                        "bias_rating": value.get("bias_rating", ""),
                    }
        elif isinstance(urls, str) and urls.strip():
            # Single URL source
            flattened[key] = {
                "url": urls.strip(),
                "category": value.get("category", "general"),
                "country": value.get("country", ""),
                "funding_type": value.get("funding_type", ""),
                "bias_rating": value.get("bias_rating", ""),
            }
        else:
            logger.debug(
                f"Skipping {key}: url field is neither string nor list or is empty"
            )

    logger.info(f"✅ Loaded {len(flattened)} RSS sources")
    return flattened
