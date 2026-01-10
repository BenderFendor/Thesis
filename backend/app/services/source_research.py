from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.logging import get_logger
from app.services.cache import news_cache
from app.services.funding_researcher import get_funding_researcher
from app.services.source_document_collector import MAX_DOCS, collect_source_documents
from app.services.source_profile_extractor import FIELD_KEYS, build_fields_from_documents
from app.services.source_profile_synthesizer import synthesize_source_fields

logger = get_logger("source_research")

CACHE_DIR = Path(
    os.getenv("SOURCE_RESEARCH_CACHE_DIR", "/tmp/thesis_source_research_cache")
)


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    return cleaned.strip("-") or "unknown"


def _cache_path(source_name: str) -> Path:
    return CACHE_DIR / f"{_slugify(source_name)}.json"


def _load_cached_profile(source_name: str) -> Optional[Dict[str, Any]]:
    path = _cache_path(source_name)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:
        logger.warning("Failed to read source research cache for %s: %s", source_name, exc)
        return None


def _save_cached_profile(source_name: str, payload: Dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(source_name)
    try:
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=True, indent=2)
    except Exception as exc:
        logger.warning("Failed to write source research cache for %s: %s", source_name, exc)


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
    researcher = get_funding_researcher()
    org_data = await researcher.research_organization(source_name, website, use_ai=False)
    sources = _map_research_sources(org_data)

    fields: Dict[str, List[Dict[str, Any]]] = {}

    _append_field(fields, "funding", org_data.get("funding_type"), sources)
    for funding_source in org_data.get("funding_sources") or []:
        _append_field(fields, "funding", funding_source, sources)

    _append_field(fields, "ownership", org_data.get("parent_org"), sources)
    _append_field(fields, "political_bias", org_data.get("media_bias_rating"), sources)
    _append_field(fields, "factual_reporting", org_data.get("factual_reporting"), sources)

    wikidata_url = org_data.get("wikidata_url")
    wikidata_sources = [wikidata_url] if wikidata_url else ["wikidata"]
    for owner in org_data.get("owned_by") or []:
        _append_field(fields, "ownership", owner, wikidata_sources, "Wikidata P127 (owned by)")
    for parent in org_data.get("parent_orgs") or []:
        _append_field(fields, "ownership", parent, wikidata_sources, "Wikidata P749 (parent organization)")
    for affiliation in org_data.get("part_of") or []:
        _append_field(fields, "affiliations", affiliation, wikidata_sources, "Wikidata P361 (part of)")
    for hq in org_data.get("headquarters") or []:
        _append_field(fields, "headquarters", hq, wikidata_sources, "Wikidata P159 (headquarters)")
    if org_data.get("inception"):
        _append_field(fields, "founded", org_data["inception"], wikidata_sources, "Wikidata P571 (inception)")
    if org_data.get("official_website"):
        _append_field(
            fields,
            "official_website",
            org_data["official_website"],
            wikidata_sources,
            "Wikidata P856 (official website)",
        )

    propublica_url = _propublica_org_url(org_data.get("ein"))
    propublica_sources = [propublica_url] if propublica_url else ["propublica"]
    if org_data.get("ein"):
        _append_field(
            fields,
            "nonprofit_filings",
            f"EIN {org_data['ein']}",
            propublica_sources,
            "IRS Form 990",
        )
    if org_data.get("subsection"):
        _append_field(
            fields,
            "nonprofit_filings",
            f"IRS subsection {org_data['subsection']}",
            propublica_sources,
            "IRS Form 990",
        )
    if org_data.get("annual_revenue"):
        tax_period = org_data.get("tax_period")
        label = "Total revenue"
        if tax_period:
            label = f"Total revenue (tax year {tax_period})"
        _append_field(
            fields,
            "nonprofit_filings",
            f"{label}: {org_data['annual_revenue']}",
            propublica_sources,
            "IRS Form 990",
        )
    if org_data.get("total_assets"):
        tax_period = org_data.get("tax_period")
        label = "Total assets"
        if tax_period:
            label = f"Total assets (tax year {tax_period})"
        _append_field(
            fields,
            "nonprofit_filings",
            f"{label}: {org_data['total_assets']}",
            propublica_sources,
            "IRS Form 990",
        )

    for field_name in [
        "editorial_stance",
        "corrections_history",
        "major_controversies",
        "reach_traffic",
        "affiliations",
        "founded",
        "headquarters",
        "official_website",
        "nonprofit_filings",
    ]:
        if field_name not in fields:
            fields[field_name] = []

    documents = await collect_source_documents(
        source_name,
        website or org_data.get("website"),
        use_llm_planner=False,
    )
    if documents:
        extracted_fields = build_fields_from_documents(documents)
        for field_name, values in extracted_fields.items():
            for entry in values:
                _append_field(
                    fields,
                    field_name,
                    entry.get("value"),
                    entry.get("sources"),
                    entry.get("notes"),
                )
        missing = _missing_fields(fields)
        if missing:
            gap_queries = _build_gap_queries(missing, source_name, website or org_data.get("website"))
            if gap_queries:
                existing_urls = {doc.url for doc in documents}
                documents = await collect_source_documents(
                    source_name,
                    website or org_data.get("website"),
                    max_total_docs=MAX_DOCS,
                    existing_documents=documents,
                    extra_queries=gap_queries,
                    use_llm_planner=False,
                )
                new_docs = [doc for doc in documents if doc.url not in existing_urls]
                if new_docs:
                    extracted_fields = build_fields_from_documents(new_docs)
                    for field_name, values in extracted_fields.items():
                        for entry in values:
                            _append_field(
                                fields,
                                field_name,
                                entry.get("value"),
                                entry.get("sources"),
                                entry.get("notes"),
                            )
        synthesized_fields = await synthesize_source_fields(source_name, documents, fields)
        for field_name, values in synthesized_fields.items():
            for entry in values:
                _append_field(
                    fields,
                    field_name,
                    entry.get("value"),
                    entry.get("sources"),
                    entry.get("notes"),
                )

    profile = {
        "name": source_name,
        "website": website or org_data.get("website"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "fields": fields,
        "key_reporters": _collect_key_reporters(source_name),
    }

    return profile


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
    return website.replace("https://", "").replace("http://", "").split("/")[0].lower()


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
) -> Dict[str, Any]:
    if not force_refresh:
        cached = _load_cached_profile(source_name)
        if cached:
            cached["cached"] = True
            return cached

    profile = await _build_source_profile(source_name, website)
    _save_cached_profile(source_name, profile)
    return profile
