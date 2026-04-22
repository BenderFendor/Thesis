from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.data.rss_sources import get_rss_sources
from app.services.cache import news_cache
from app.services.source_document_collector import MAX_DOCS, collect_source_documents
from app.services.entity_wiki_service import (
    build_source_profile as build_deterministic_source_profile,
)
from app.services.rss_parser_rust_bindings import parse_feeds_parallel
from app.services.source_field_extractor import extract_fields_from_documents
from app.services.source_profile_extractor import (
    FIELD_KEYS,
    build_fields_from_documents,
)
from app.services.source_profile_synthesizer import synthesize_source_fields
from app.services.source_query_generator import generate_search_queries
from app.services.source_url_guard import (
    AGGREGATOR_HOSTS,
    extract_domain,
    extract_host,
    hosts_match,
    iter_urls,
    normalize_site_url,
)

logger = get_logger("source_research")

CACHE_DIR = Path(
    os.getenv("SOURCE_RESEARCH_CACHE_DIR", "/tmp/thesis_source_research_cache")
)

_CATALOG_WEBSITE_CACHE: Dict[str, Optional[str]] = {}


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    return cleaned.strip("-") or "unknown"


def _cache_path(source_name: str) -> Path:
    return CACHE_DIR / f"{_slugify(source_name)}.json"


def _infer_website_from_feed_articles(
    source_name: str,
    url_value: Any,
) -> Optional[str]:
    feed_urls = iter_urls(url_value)
    if not feed_urls:
        return None

    try:
        payload = parse_feeds_parallel([(source_name, feed_urls)], 6)
    except Exception as exc:
        logger.debug("Feed-domain inference failed for %s: %s", source_name, exc)
        return None

    articles = payload.get("articles") if isinstance(payload, dict) else None
    if not isinstance(articles, list) or not articles:
        return None

    domains: Counter[str] = Counter()
    for item in articles:
        if not isinstance(item, dict):
            continue
        if item.get("source") != source_name:
            continue
        link = item.get("link")
        if not isinstance(link, str) or not link.strip():
            continue
        domain = extract_host(link)
        if not domain or domain in AGGREGATOR_HOSTS:
            continue
        domains[domain] += 1

    if not domains:
        return None

    top_domain, top_count = domains.most_common(1)[0]
    # Lightweight confidence gate to avoid selecting one-off odd links.
    if top_count < 2 and len(domains) > 1:
        return None
    return f"https://{top_domain}"


def _resolve_website_from_catalog(source_name: str) -> Optional[str]:
    normalized_target = source_name.strip().lower()
    if not normalized_target:
        return None

    if normalized_target in _CATALOG_WEBSITE_CACHE:
        return _CATALOG_WEBSITE_CACHE[normalized_target]

    try:
        sources = get_rss_sources()
    except Exception as exc:
        logger.debug("Failed to load RSS catalog for %s: %s", source_name, exc)
        return None

    for configured_name, config in sources.items():
        base_name = configured_name.split(" - ")[0].strip().lower()
        if normalized_target in {configured_name.lower(), base_name}:
            configured_site = config.get("site_url")
            if isinstance(configured_site, str) and configured_site.strip():
                resolved = configured_site.strip()
                _CATALOG_WEBSITE_CACHE[normalized_target] = resolved
                return resolved

            url_value = config.get("url")
            normalized_website = normalize_site_url(url_value)
            inferred_website = _infer_website_from_feed_articles(source_name, url_value)

            if inferred_website:
                inferred_host = extract_domain(inferred_website) or ""
                normalized_host = (
                    extract_domain(normalized_website) if normalized_website else None
                )
                if normalized_host and not hosts_match(normalized_host, inferred_host):
                    logger.info(
                        "Website guard replaced %s catalog host %s with inferred host %s",
                        source_name,
                        normalized_host,
                        inferred_host,
                    )
                _CATALOG_WEBSITE_CACHE[normalized_target] = inferred_website
                return inferred_website

            if normalized_website:
                _CATALOG_WEBSITE_CACHE[normalized_target] = normalized_website
                return normalized_website

    _CATALOG_WEBSITE_CACHE[normalized_target] = None
    return None


def _load_cached_profile(source_name: str) -> Optional[Dict[str, Any]]:
    path = _cache_path(source_name)
    if not path.exists():
        return None

    ttl = timedelta(hours=settings.source_research_cache_ttl_hours)
    cache_age = datetime.now(timezone.utc) - datetime.fromtimestamp(
        path.stat().st_mtime, tz=timezone.utc
    )
    if cache_age > ttl:
        logger.info(
            "Cache expired for %s (age: %s, ttl: %s)", source_name, cache_age, ttl
        )
        return None

    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
            return payload if isinstance(payload, dict) else None
    except Exception as exc:
        logger.warning(
            "Failed to read source research cache for %s: %s", source_name, exc
        )
        return None


def _save_cached_profile(source_name: str, payload: Dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(source_name)
    try:
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=True, indent=2)
    except Exception as exc:
        logger.warning(
            "Failed to write source research cache for %s: %s", source_name, exc
        )


def _append_field(
    fields: Dict[str, List[Dict[str, Any]]],
    key: str,
    value: Optional[str],
    sources: Optional[List[str]] = None,
    notes: Optional[str] = None,
) -> None:
    if value is None:
        return
    cleaned = str(value).strip()
    if not cleaned:
        return
    entries = fields.setdefault(key, [])
    if any(str(entry.get("value", "")).lower() == cleaned.lower() for entry in entries):
        return
    entries.append(
        {
            "value": cleaned,
            "sources": sources or [],
            "notes": notes,
        }
    )


def _collect_key_reporters(source_name: str, limit: int = 6) -> List[Dict[str, Any]]:
    articles = news_cache.articles_by_source.get(source_name) or []
    counts: Counter[str] = Counter()
    for article in articles:
        author = getattr(article, "author", None)
        if not author:
            continue
        cleaned = str(author).strip()
        if cleaned:
            counts[cleaned] += 1
    if not counts:
        return []
    return [
        {"name": name, "article_count": count}
        for name, count in counts.most_common(limit)
    ]


async def _build_source_profile(
    source_name: str,
    website: Optional[str],
) -> Dict[str, Any]:
    profile = await build_deterministic_source_profile(source_name, website)
    profile["fetched_at"] = datetime.now(timezone.utc).isoformat()
    profile["key_reporters"] = _collect_key_reporters(source_name)
    return profile


async def _build_with_llm_extraction(
    source_name: str,
    website: Optional[str],
    fields: Dict[str, List[Dict[str, Any]]],
) -> bool:
    """Two-step LLM pipeline: generate queries, extract fields, synthesize."""
    try:
        queries = await generate_search_queries(source_name, website)
        if not queries:
            logger.warning(f"No queries generated for {source_name}")
            return False

        logger.info(f"Generated {len(queries)} queries for {source_name}")

        documents = await collect_source_documents(
            source_name,
            website,
            use_llm_planner=False,
            extra_queries=queries,
            max_total_docs=MAX_DOCS,
        )

        if not documents:
            logger.warning(f"No documents collected for {source_name}")
            return False

        logger.info(f"Collected {len(documents)} documents for {source_name}")

        extracted_entries = await extract_fields_from_documents(source_name, documents)
        if extracted_entries:
            for entry in extracted_entries:
                field_name = entry.get("field")
                if not field_name:
                    continue
                _append_field(
                    fields,
                    field_name,
                    entry.get("value"),
                    entry.get("sources"),
                    entry.get("notes"),
                )
            logger.info(
                f"LLM extracted {len(extracted_entries)} field entries for {source_name}"
            )
        else:
            _merge_extracted_fields(fields, build_fields_from_documents(documents))

        synthesized_fields = await synthesize_source_fields(
            source_name, documents, fields
        )
        if synthesized_fields:
            _merge_extracted_fields(fields, synthesized_fields)
            logger.info(f"LLM synthesis complete for {source_name}")

        return True

    except Exception as exc:
        logger.warning(f"LLM extraction pipeline failed for {source_name}: {exc}")
        return False


async def _build_with_regex_only(
    source_name: str,
    website: Optional[str],
    fields: Dict[str, List[Dict[str, Any]]],
) -> None:
    """Fallback: use regex extraction only (no LLM)."""
    try:
        queries = [
            f"{source_name} about",
            f"{source_name} editorial policy",
            f"{source_name} media bias",
        ]

        documents = await collect_source_documents(
            source_name,
            website,
            use_llm_planner=False,
            extra_queries=queries,
            max_total_docs=6,
        )

        if documents:
            _merge_extracted_fields(fields, build_fields_from_documents(documents))
            logger.info(f"Regex extraction complete for {source_name}")

    except Exception as exc:
        logger.warning(f"Regex extraction also failed for {source_name}: {exc}")


def _merge_extracted_fields(
    fields: Dict[str, List[Dict[str, Any]]],
    extracted_fields: Dict[str, List[Dict[str, Any]]],
) -> None:
    for field_name, values in extracted_fields.items():
        for entry in values:
            _append_field(
                fields,
                field_name,
                entry.get("value"),
                entry.get("sources"),
                entry.get("notes"),
            )


def _add_wikidata_fields(
    fields: Dict[str, List[Dict[str, Any]]], org_data: Dict[str, Any]
) -> None:
    wikidata_url = org_data.get("wikidata_url")
    wikidata_sources = [wikidata_url] if wikidata_url else ["wikidata"]
    for owner in org_data.get("owned_by") or []:
        _append_field(
            fields, "ownership", owner, wikidata_sources, "Wikidata P127 (owned by)"
        )
    for parent in org_data.get("parent_orgs") or []:
        _append_field(
            fields,
            "ownership",
            parent,
            wikidata_sources,
            "Wikidata P749 (parent organization)",
        )
    for affiliation in org_data.get("part_of") or []:
        _append_field(
            fields,
            "affiliations",
            affiliation,
            wikidata_sources,
            "Wikidata P361 (part of)",
        )
    for hq in org_data.get("headquarters") or []:
        _append_field(
            fields, "headquarters", hq, wikidata_sources, "Wikidata P159 (headquarters)"
        )
    if org_data.get("inception"):
        _append_field(
            fields,
            "founded",
            org_data["inception"],
            wikidata_sources,
            "Wikidata P571 (inception)",
        )
    if org_data.get("official_website"):
        _append_field(
            fields,
            "official_website",
            org_data["official_website"],
            wikidata_sources,
            "Wikidata P856 (official website)",
        )


def _add_propublica_fields(
    fields: Dict[str, List[Dict[str, Any]]], org_data: Dict[str, Any]
) -> None:
    propublica_url = _propublica_org_url(org_data.get("ein"))
    propublica_sources = [propublica_url] if propublica_url else ["propublica"]
    ein = org_data.get("ein")
    if ein:
        _append_field(
            fields,
            "nonprofit_filings",
            f"EIN {ein}",
            propublica_sources,
            "IRS Form 990",
        )
    subsection = org_data.get("subsection")
    if subsection:
        _append_field(
            fields,
            "nonprofit_filings",
            f"IRS subsection {subsection}",
            propublica_sources,
            "IRS Form 990",
        )
    _append_form_990_value(
        fields,
        org_data,
        "annual_revenue",
        "Total revenue",
        propublica_sources,
    )
    _append_form_990_value(
        fields,
        org_data,
        "total_assets",
        "Total assets",
        propublica_sources,
    )


def _append_form_990_value(
    fields: Dict[str, List[Dict[str, Any]]],
    org_data: Dict[str, Any],
    key: str,
    label: str,
    sources: List[str],
) -> None:
    value = org_data.get(key)
    if not value:
        return
    tax_period = org_data.get("tax_period")
    full_label = label
    if tax_period:
        full_label = f"{label} (tax year {tax_period})"
    _append_field(
        fields,
        "nonprofit_filings",
        f"{full_label}: {value}",
        sources,
        "IRS Form 990",
    )


def _missing_fields(fields: Dict[str, List[Dict[str, Any]]]) -> List[str]:
    missing: List[str] = []
    for key in FIELD_KEYS:
        if not fields.get(key):
            missing.append(key)
    return missing


def _build_gap_queries(
    missing_fields: List[str],
    source_name: str,
    website: Optional[str],
) -> List[str]:
    site_filter = ""
    if website:
        site_filter = f" site:{_extract_domain(website)}"

    queries: List[str] = []
    if "funding" in missing_fields or "nonprofit_filings" in missing_fields:
        queries.extend(
            [
                f"{source_name} funding{site_filter}",
                f"{source_name} donors{site_filter}",
                f"{source_name} 990",
                f"{source_name} annual report",
            ]
        )
    if "ownership" in missing_fields:
        queries.extend(
            [
                f"{source_name} ownership",
                f"{source_name} parent company",
                f"{source_name} owned by",
            ]
        )
    if "corrections_history" in missing_fields:
        queries.append(f"{source_name} corrections policy{site_filter}")
    if "editorial_stance" in missing_fields:
        queries.extend(
            [
                f"{source_name} editorial standards{site_filter}",
                f"{source_name} code of ethics{site_filter}",
            ]
        )
    if "political_bias" in missing_fields or "factual_reporting" in missing_fields:
        queries.append(f"{source_name} media bias rating")
    if "reach_traffic" in missing_fields:
        queries.append(f"{source_name} audience size")
    if "affiliations" in missing_fields:
        queries.append(f"{source_name} member of")
    if "founded" in missing_fields:
        queries.append(f"{source_name} founded year")
    if "headquarters" in missing_fields:
        queries.append(f"{source_name} headquarters")

    return _dedupe_queries(queries)


def _extract_domain(website: str) -> str:
    return extract_domain(website) or ""


def _dedupe_queries(queries: List[str]) -> List[str]:
    seen: set[str] = set()
    deduped: List[str] = []
    for query in queries:
        cleaned = " ".join(query.split())
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(cleaned)
    return deduped


def _propublica_org_url(ein: Optional[str]) -> Optional[str]:
    if not ein:
        return None
    cleaned = str(ein).strip()
    if not cleaned:
        return None
    return f"https://projects.propublica.org/nonprofits/organizations/{cleaned}"


def _map_research_sources(org_data: Dict[str, Any]) -> List[str]:
    research_sources = org_data.get("research_sources") or []
    wikipedia_url = org_data.get("wikipedia_url")
    wikidata_url = org_data.get("wikidata_url")
    propublica_url = _propublica_org_url(org_data.get("ein"))

    mapped: List[str] = []
    for source in research_sources:
        if source == "wikipedia" and wikipedia_url:
            mapped.append(wikipedia_url)
            continue
        if source == "wikidata" and wikidata_url:
            mapped.append(wikidata_url)
            continue
        if source == "propublica" and propublica_url:
            mapped.append(propublica_url)
            continue
        mapped.append(source)
    return mapped


async def get_source_profile(
    source_name: str,
    website: Optional[str] = None,
    force_refresh: bool = False,
    cache_only: bool = False,
) -> Optional[Dict[str, Any]]:
    if not force_refresh:
        cached = _load_cached_profile(source_name)
        if cached:
            cached["cached"] = True
            return cached

    if cache_only:
        return None

    resolved_website = website or _resolve_website_from_catalog(source_name)
    profile = await _build_source_profile(source_name, resolved_website)
    _save_cached_profile(source_name, profile)
    return profile
