"""
MBFC Integration - Media Bias/Fact Check outlet-level bias and factuality data.

Uses the free HuggingFace dataset `zainmujahid/mbfc-media-outlets` (CC BY 4.0):
- 4,192 outlets with factuality labels (low, mixed, high)
- 3,649 outlets with bias labels (left, left-center, center, center-right, right)

Cross-references reporters by their employer outlet to attach outlet-level
bias and factuality metadata to reporter profiles.

Data source: https://huggingface.co/datasets/zainmujahid/mbfc-media-outlets
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

import httpx

from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources

logger = get_logger("mbfc")

MBFC_DATASET_URL = (
    "https://huggingface.co/datasets/zainmujahid/mbfc-media-outlets/resolve/main"
)
MBFC_FACTUALITY_FILE = "factuality.csv"
MBFC_BIAS_FILE = "bias.csv"
MBFC_OWNERSHIP_FILE = "ownership.csv"

MBFC_DATA_DIR = os.environ.get(
    "MBFC_DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "mbfc"),
)

BIAS_TO_STANDARD: Dict[str, str] = {
    "left": "left",
    "leftcenter": "left-center",
    "left-center": "left-center",
    "center": "center",
    "rightcenter": "center-right",
    "right-center": "center-right",
    "right": "right",
    "least biased": "center",
    "satire": "satire",
    "pro-science": "center",
    "conspiracy": "conspiracy-pseudoscience",
    "questionable sources": "conspiracy-pseudoscience",
}

FACTUALITY_TO_STANDARD: Dict[str, str] = {
    "very low": "very-low",
    "low": "low",
    "mixed": "mixed",
    "mostly factual": "mixed",
    "high": "high",
    "very high": "very-high",
}


def _ensure_data_dir() -> str:
    os.makedirs(MBFC_DATA_DIR, exist_ok=True)
    return MBFC_DATA_DIR


def _normalize_name(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9 ]", "", name.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _load_local_csv(filename: str) -> List[Dict[str, str]]:
    filepath = os.path.join(_ensure_data_dir(), filename)
    if not os.path.exists(filepath):
        return []
    import csv

    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


async def download_mbfc_dataset(
    client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, str]:
    """Download MBFC dataset from HuggingFace.

    Returns dict of filename -> local filepath.
    """
    data_dir = _ensure_data_dir()
    owned_client = client is None
    http_client = client or httpx.AsyncClient(timeout=60.0, follow_redirects=True)

    try:
        results: Dict[str, str] = {}
        for filename in [MBFC_FACTUALITY_FILE, MBFC_BIAS_FILE, MBFC_OWNERSHIP_FILE]:
            local_path = os.path.join(data_dir, filename)
            url = f"{MBFC_DATASET_URL}/{filename}"

            if os.path.exists(local_path):
                logger.info("MBFC file already cached: %s", local_path)
                results[filename] = local_path
                continue

            logger.info("Downloading %s ...", url)
            response = await http_client.get(url)
            if response.status_code != 200:
                logger.warning(
                    "Failed to download %s: HTTP %d", url, response.status_code
                )
                continue

            with open(local_path, "wb") as f:
                f.write(response.content)
            logger.info("Downloaded %s -> %s", filename, local_path)
            results[filename] = local_path

        return results
    finally:
        if owned_client:
            await http_client.aclose()


def build_mbfc_lookup(
    factuality_file: Optional[str] = None,
    bias_file: Optional[str] = None,
    ownership_file: Optional[str] = None,
) -> Dict[str, Dict[str, str]]:
    """Build a lookup map from normalized outlet name to MBFC data.

    Returns: {normalized_outlet_name: {bias, factuality, ownership, credibility}}
    """
    factuality_rows = _load_local_csv(
        factuality_file or os.path.join(_ensure_data_dir(), MBFC_FACTUALITY_FILE)
    )
    bias_rows = _load_local_csv(
        bias_file or os.path.join(_ensure_data_dir(), MBFC_BIAS_FILE)
    )
    ownership_rows = _load_local_csv(
        ownership_file or os.path.join(_ensure_data_dir(), MBFC_OWNERSHIP_FILE)
    )

    lookup: Dict[str, Dict[str, str]] = {}

    for row in factuality_rows:
        name = _normalize_name(
            row.get("name", row.get("outlet", row.get("source", "")))
        )
        factuality = (
            row.get("factuality", row.get("factual_reporting", "")).strip().lower()
        )
        if name and factuality:
            standard_fact = FACTUALITY_TO_STANDARD.get(factuality, factuality)
            lookup.setdefault(name, {})["factuality"] = standard_fact
            lookup[name]["mbfc_name"] = row.get("name", name)

    for row in bias_rows:
        name = _normalize_name(
            row.get("name", row.get("outlet", row.get("source", "")))
        )
        bias = row.get("bias", row.get("bias_rating", "")).strip().lower()
        if name and bias:
            standard_bias = BIAS_TO_STANDARD.get(bias, bias)
            lookup.setdefault(name, {})["bias"] = standard_bias
            lookup[name]["mbfc_name"] = row.get("name", name)

    for row in ownership_rows:
        name = _normalize_name(
            row.get("name", row.get("outlet", row.get("source", "")))
        )
        ownership = row.get("ownership", "").strip()
        country = row.get("country", "").strip()
        if name and (ownership or country):
            entry = lookup.setdefault(name, {})
            if ownership:
                entry["ownership"] = ownership
            if country:
                entry["country"] = country

    logger.info(
        "Built MBFC lookup: %d outlets (factuality: %d, bias: %d, ownership: %d)",
        len(lookup),
        len(factuality_rows),
        len(bias_rows),
        len(ownership_rows),
    )
    return lookup


def attach_mbfc_to_reporters(
    reporters: List[Dict[str, Any]],
    employer_map: Dict[int, List[str]],
) -> List[Dict[str, Any]]:
    """Attach MBFC outlet-level data to reporter records by employer.

    Args:
        reporters: Reporter records with at least {id, name}
        employer_map: {reporter_id: [employer_name, ...]}

    Returns enriched reporter dicts with mbfc_data field.
    """
    mbfc_lookup = build_mbfc_lookup()

    enriched: List[Dict[str, Any]] = []
    for reporter in reporters:
        reporter_id = reporter.get("id")
        enrichment: Dict[str, Any] = {}

        raw_id = reporter_id
        employers: list[str] = (
            employer_map.get(int(raw_id), []) if isinstance(raw_id, (int, str)) else []
        )
        for employer in employers:
            normalized_employer = _normalize_name(employer)
            mbfc_entry = mbfc_lookup.get(normalized_employer)
            if mbfc_entry:
                if not enrichment:
                    enrichment = dict(mbfc_entry)
                break

        if not enrichment:
            enriched.append(reporter)
            continue

        enriched_reporter = dict(reporter)
        enriched_reporter["mbfc_data"] = enrichment

        if enrichment.get("bias") and not reporter.get("political_leaning"):
            bias_label = enrichment["bias"]
            if bias_label not in ("satire", "conspiracy-pseudoscience"):
                enriched_reporter["political_leaning"] = bias_label
                enriched_reporter.setdefault("leaning_sources", [])
                if isinstance(enriched_reporter["leaning_sources"], list):
                    enriched_reporter["leaning_sources"].append("mbfc")
                enriched_reporter["leaning_confidence"] = "medium"

        enriched.append(enriched_reporter)

    logger.info("Enriched %d reporters with MBFC data", len(enriched))
    return enriched


def get_rss_mbfc_crosswalk() -> List[Dict[str, Any]]:
    """Cross-reference RSS catalog sources against MBFC labels.

    Returns list of {source_name, rss_bias, rss_funding, mbfc_bias, mbfc_factuality}
    """
    mbfc_lookup = build_mbfc_lookup()
    sources = get_rss_sources()

    unique_sources: Dict[str, Dict[str, Any]] = {}
    for name, config in sources.items():
        base_name = name.split(" - ")[0].strip()
        if base_name not in unique_sources:
            unique_sources[base_name] = config

    crosswalk: List[Dict[str, Any]] = []
    for source_name, config in unique_sources.items():
        normalized = _normalize_name(source_name)
        mbfc_entry = mbfc_lookup.get(normalized)

        crosswalk.append(
            {
                "source_name": source_name,
                "rss_bias": config.get("bias_rating", ""),
                "rss_funding": config.get("funding_type", ""),
                "rss_factuality": config.get("factual_reporting", ""),
                "mbfc_bias": mbfc_entry.get("bias", "") if mbfc_entry else "",
                "mbfc_factuality": mbfc_entry.get("factuality", "")
                if mbfc_entry
                else "",
                "mbfc_ownership": mbfc_entry.get("ownership", "") if mbfc_entry else "",
                "matched": bool(mbfc_entry),
            }
        )

    matched = sum(1 for c in crosswalk if c["matched"])
    logger.info("MBFC crosswalk: %d/%d sources matched", matched, len(crosswalk))
    return crosswalk
