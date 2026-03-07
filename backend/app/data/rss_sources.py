import json
from pathlib import Path
from typing import Dict, Any
from app.core.logging import get_logger

logger = get_logger(__name__)

_DATA_PATH = Path(__file__).with_name("rss_sources.json")

with _DATA_PATH.open("r", encoding="utf-8") as _source_file:
    _RAW_SOURCES: Dict[str, Any] = json.load(_source_file)


def get_rss_sources() -> Dict[str, Dict[str, Any]]:
    """
    Load RSS sources from JSON.

    If consolidate=true, keeps multi-URL sources as single entries with list of URLs.
    Otherwise, flattens nested URL arrays into separate numbered sources (e.g., "AP - 1", "AP - 2").
    """
    flattened = {}

    def build_source_config(
        url_value: str | list[str], source_value: Dict[str, Any]
    ) -> Dict[str, Any]:
        config = {
            "url": url_value,
            "category": source_value.get("category", "general"),
            "country": source_value.get("country", ""),
            "funding_type": source_value.get("funding_type", ""),
            "bias_rating": source_value.get("bias_rating", ""),
            "ownership_label": source_value.get("ownership_label", ""),
        }
        if source_value.get("consolidate", False):
            config["consolidate"] = True
        return config

    for key, value in _RAW_SOURCES.items():
        if not isinstance(value, dict):
            logger.warning(f"Skipping invalid source {key}: not a dict")
            continue

        # Check if 'url' is a list (multiple feeds) or string (single feed)
        urls = value.get("url")
        consolidate = value.get("consolidate", False)

        if isinstance(urls, list) and urls:
            if consolidate:
                # Keep as single consolidated source with all URLs
                valid_urls = [
                    url.strip() for url in urls if isinstance(url, str) and url.strip()
                ]
                if valid_urls:
                    flattened[key] = build_source_config(valid_urls, value)
            else:
                # Flatten array of URLs into separate sources
                for idx, url in enumerate(urls, 1):
                    if isinstance(url, str) and url.strip():
                        composite_key = f"{key} - {idx}"
                        flattened[composite_key] = build_source_config(
                            url.strip(), value
                        )
        elif isinstance(urls, str) and urls.strip():
            # Single URL source
            flattened[key] = build_source_config(urls.strip(), value)
        else:
            logger.debug(
                f"Skipping {key}: url field is neither string nor list or is empty"
            )

    logger.info(f"Loaded {len(flattened)} RSS sources")
    return flattened
