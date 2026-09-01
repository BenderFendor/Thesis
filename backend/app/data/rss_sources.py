"""Rss Sources."""

import json
from pathlib import Path
from typing import Any

from app.core.logging import get_logger
from app.services.source_url_guard import normalize_site_url

logger = get_logger(__name__)

_DATA_PATH = Path(__file__).with_name("rss_sources.json")

with _DATA_PATH.open("r", encoding="utf-8") as _source_file:
    _RAW_SOURCES: dict[str, Any] = json.load(_source_file)


def _build_source_config(
    url_value: str | list[str], source_value: dict[str, Any]
) -> dict[str, Any]:
    """Build Source Config."""
    config = {
        "url": url_value,
        "site_url": source_value.get("site_url") or normalize_site_url(url_value) or "",
        "category": source_value.get("category", "general"),
        "country": source_value.get("country", ""),
        "funding_type": source_value.get("funding_type", ""),
        "bias_rating": source_value.get("bias_rating", ""),
        "factual_reporting": source_value.get("factual_reporting", ""),
        "ownership_label": source_value.get("ownership_label", ""),
    }
    if source_value.get("consolidate", False):
        config["consolidate"] = True
    if source_value.get("wikidata_qid"):
        config["wikidata_qid"] = source_value["wikidata_qid"]
    return config


def _clean_source_urls(urls: list[Any]) -> list[str]:
    """Filter and strip entries of a multi-URL source entry."""
    return [url.strip() for url in urls if isinstance(url, str) and url.strip()]


def _flatten_url_sources(
    flattened: dict[str, dict[str, Any]],
    key: str,
    value: dict[str, Any],
    urls: list[Any],
) -> None:
    """Add a multi-URL source to `flattened` as consolidated or separate entries."""
    if value.get("consolidate", False):
        valid_urls = _clean_source_urls(urls)
        if valid_urls:
            flattened[key] = _build_source_config(valid_urls, value)
        return
    for idx, url in enumerate(urls, 1):
        if isinstance(url, str) and url.strip():
            composite_key = f"{key} - {idx}"
            flattened[composite_key] = _build_source_config(url.strip(), value)


def get_rss_sources() -> dict[str, dict[str, Any]]:
    """Load RSS sources from JSON.

    If consolidate=true, keeps multi-URL sources as single entries with list of URLs.
    Otherwise, flattens nested URL arrays into separate numbered sources (e.g., "AP - 1", "AP - 2").
    """
    flattened: dict[str, dict[str, Any]] = {}

    for key, value in _RAW_SOURCES.items():
        if not isinstance(value, dict):
            logger.warning(f"Skipping invalid source {key}: not a dict")
            continue

        # Check if 'url' is a list (multiple feeds) or string (single feed)
        urls = value.get("url")
        if isinstance(urls, list) and urls:
            _flatten_url_sources(flattened, key, value, urls)
        elif isinstance(urls, str) and urls.strip():
            # Single URL source
            flattened[key] = _build_source_config(urls.strip(), value)
        else:
            logger.debug(f"Skipping {key}: url field is neither string nor list or is empty")

    logger.info(f"Loaded {len(flattened)} RSS sources")
    return flattened


def reload_rss_sources() -> None:
    """Reload Rss Sources."""
    global _RAW_SOURCES
    _RAW_SOURCES = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    logger.info("RSS sources reloaded from disk")
