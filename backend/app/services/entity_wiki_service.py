"""Entity Wiki Service."""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from difflib import SequenceMatcher
from html import unescape
from typing import Any, cast
from collections.abc import Callable, Iterable, Sequence
from urllib.parse import quote, urlparse

import httpx
import numpy as np

from app.core.config import SCOOP_WIKIMEDIA_UA
from app.core.logging import get_logger
from app.services.ad_supply_transparency import (
    build_sellers_json_summary as _build_sellers_json_summary,
    fetch_ads_txt as _fetch_ads_txt,
    public_ads_txt_summary as _public_ads_txt_summary,
)
from app.services.funding_researcher import (
    _extract_wikidata_item_ids,
    _extract_wikidata_url,
    get_funding_researcher,
)
from app.services.source_policy_transparency import build_policy_transparency_summary
from app.vector_store import get_vector_store

logger = get_logger("entity_wiki_service")

WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"
WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"
WIKIDATA_SEARCH_LIMIT = 8
INSTANCE_HUMAN = "Q5"
JOURNALISM_KEYWORDS = (
    "journalist",
    "reporter",
    "correspondent",
    "editor",
    "columnist",
    "writer",
    "news",
    "anchor",
    "commentator",
    "broadcaster",
    "presenter",
)
NON_JOURNALIST_OCCUPATIONS = (
    "researcher",
    "scientist",
    "physician",
    "doctor",
    "engineer",
    "attorney",
    "lawyer",
    "musician",
    "actor",
    "actress",
    "athlete",
    "professor",
    "teacher",
    "artist",
    "politician",
    "nurse",
    "chef",
    "police",
)
NON_JOURNALIST_PENALTY = 0.4
EXPANDED_WIKIDATA_PROPS = {
    "P31": "instance_of",
    "P106": "occupation",
    "P108": "employer",
    "P69": "educated_at",
    "P27": "country_of_citizenship",
    "P856": "official_website",
    "P2002": "twitter",
    "P2003": "instagram",
    "P6634": "linkedin",
    "P101": "field_of_work",
    "P2031": "work_period_start",
    "P2032": "work_period_end",
    "P569": "date_of_birth",
    "P19": "place_of_birth",
    "P21": "sex_or_gender",
    "P1416": "affiliation",
    "P8687": "social_media_followers",
    "P2397": "youtube_channel_id",
    "P4012": "semantic_scholar_author_id",
    "P1960": "google_scholar_author_id",
    "P214": "viaf_id",
    "P244": "library_of_congress_id",
    "P102": "political_party",
    "P1142": "political_ideology",
    "P737": "influenced_by",
    "P463": "member_of",
    "P937": "work_location",
}
OFFICIAL_PAGE_CANDIDATES: Sequence[tuple[str, Sequence[str]]] = (
    ("about", ("/about", "/about-us", "/about/", "/about-us/")),
    ("masthead", ("/masthead", "/staff", "/team", "/authors")),
    (
        "editorial_standards",
        (
            "/editorial",
            "/editorial-policy",
            "/editorial-policies",
            "/editorial-guidelines",
            "/editorial-standards",
            "/standards",
            "/standards-and-practices",
            "/ethics",
            "/principles",
        ),
    ),
    (
        "corrections",
        (
            "/corrections",
            "/corrections-policy",
            "/corrections-and-clarifications",
            "/clarifications",
        ),
    ),
    ("ownership", ("/ownership", "/company", "/about/ownership")),
)
OFFICIAL_PAGE_URL_TERMS: dict[str, Sequence[str]] = {
    "about": ("about", "about-us", "mission"),
    "masthead": ("masthead", "staff", "team", "author", "people"),
    "editorial_standards": (
        "editorial",
        "policy",
        "policies",
        "guidelines",
        "standards",
        "ethics",
        "principles",
    ),
    "corrections": ("correction", "corrections", "clarification", "clarifications"),
    "ownership": ("ownership", "company", "corporate", "who-we-are"),
}


def _normalize_name(value: str) -> str:
    cleaned = re.sub(r"^\s*by\s+", "", value.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def build_resolver_key(name: str, context: str | None = None) -> str:
    """Build Resolver Key."""
    normalized = _normalize_name(name).lower()
    suffix = (context or "").strip().lower()
    return f"{normalized}::{suffix}" if suffix else normalized


def _tokenize(value: str | None) -> list[str]:
    if not value:
        return []
    return re.findall(r"[a-z0-9]+", value.lower())


def _text_similarity(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _token_overlap(a: str | None, b: str | None) -> float:
    tokens_a = set(_tokenize(a))
    tokens_b = set(_tokenize(b))
    if not tokens_a or not tokens_b:
        return 0.0
    overlap = len(tokens_a & tokens_b)
    union = len(tokens_a | tokens_b)
    return overlap / union if union else 0.0


def _extract_entity_id(value: str | None) -> str | None:
    if not value:
        return None
    return value.rsplit("/", 1)[-1]


def _extract_wikidata_string(claims: dict[str, Any], prop: str) -> str | None:
    """Extract a string value from a Wikidata claim property."""
    claim_list = claims.get(prop) or []
    if not claim_list:
        return None
    try:
        return str(claim_list[0].get("mainsnak", {}).get("datavalue", {}).get("value", ""))
    except (TypeError, KeyError, IndexError):
        return None


def _unique_strings(values: Iterable[str | None]) -> list[str]:
    unique: OrderedDict[str, None] = OrderedDict()
    for value in values:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in unique:
            unique[cleaned] = None
    return list(unique.keys())


def _condense_overview_text(value: str, max_chars: int = 900) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    sentence_chunks = re.split(r"(?<=[.!?])\s+", cleaned)
    selected: list[str] = []
    total = 0
    for chunk in sentence_chunks:
        piece = chunk.strip()
        if not piece:
            continue
        if selected and (total + 1 + len(piece)) > max_chars:
            break
        selected.append(piece)
        total += len(piece) + (1 if selected else 0)
    if selected:
        return " ".join(selected).strip()
    return cleaned[:max_chars].rstrip() + "..."


def _build_fallback_overview(name: str, org_data: dict[str, Any]) -> str | None:
    description = str(org_data.get("description") or "").strip()
    if description:
        return _condense_overview_text(description)

    pieces = _fallback_overview_pieces(org_data)
    if not pieces:
        return None
    prefix = f"{name} public profile summary."
    return _condense_overview_text(f"{prefix} {' '.join(pieces)}")


def _fallback_overview_pieces(org_data: dict[str, Any]) -> list[str]:
    pieces: list[str] = []
    funding_type = str(org_data.get("funding_type") or "").strip()
    parent_org = str(org_data.get("parent_org") or "").strip()
    media_bias = str(org_data.get("media_bias_rating") or "").strip()
    factual = str(org_data.get("factual_reporting") or "").strip()

    if funding_type:
        pieces.append(f"Funding model: {funding_type}.")
    if parent_org:
        pieces.append(f"Parent organization: {parent_org}.")
    if media_bias:
        pieces.append(f"Catalog bias label: {media_bias}.")
    if factual:
        pieces.append(f"Catalog factual reporting label: {factual}.")
    return pieces


def _coerce_sources_to_urls(values: Iterable[Any]) -> list[str]:
    urls: list[str] = []
    for value in values:
        if isinstance(value, str) and value.strip():
            urls.append(value.strip())
    return _unique_strings(urls)


def _parent_company_claim(
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    parent = str(claim_value.get("name") or "").strip()
    if not parent:
        return None
    return "ownership", "Parent company", parent


def _legal_entity_claim(
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    legal_name = str(claim_value.get("name") or "").strip()
    if not legal_name:
        return None
    return "public_records", "Legal entity", legal_name


def _article_count_claim(
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    count = claim_value.get("count")
    if isinstance(count, int):
        return "public_records", "Article count (30d)", str(count)
    return None


def _top_topics_claim(
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    topics = claim_value.get("topics")
    if isinstance(topics, list) and topics:
        return (
            "public_records",
            "Top topics (30d)",
            ", ".join(str(topic) for topic in topics if topic),
        )
    return None


def _bias_label_claim(
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    label = str(claim_value.get("label") or "").strip()
    provider = str(claim_value.get("provider") or "catalog").strip()
    if not label:
        return None
    return "public_records", f"Bias label ({provider})", label


def _source_url_guard_claim(
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    status = str(claim_value.get("status") or "unknown").strip()
    configured_host = str(claim_value.get("configured_host") or "").strip()
    website_host = str(claim_value.get("website_host") or "").strip()
    reason = str(claim_value.get("reason") or "").strip()
    details = [f"status={status}"]
    if configured_host:
        details.append(f"configured={configured_host}")
    if website_host:
        details.append(f"inferred={website_host}")
    if reason:
        details.append(f"reason={reason}")
    return "public_records", "Source URL quality", "; ".join(details)


_CLAIM_RECORD_BUILDERS: dict[str, Callable[[dict[str, Any]], tuple[str, str, str] | None]] = {
    "parent_company": _parent_company_claim,
    "legal_entity_name": _legal_entity_claim,
    "article_count_30d": _article_count_claim,
    "top_topics_30d": _top_topics_claim,
    "bias_label_catalog": _bias_label_claim,
    "source_url_guard": _source_url_guard_claim,
}


def _claim_record(
    claim_type: str,
    claim_value: dict[str, Any],
) -> tuple[str, str, str] | None:
    record_builder = _CLAIM_RECORD_BUILDERS.get(claim_type)
    if record_builder is None:
        return None
    return record_builder(claim_value)


def _append_claim_items(
    fields: dict[str, list[dict[str, Any]]],
    claim_type: str,
    claim_value: dict[str, Any],
    evidence_urls: list[str],
) -> None:
    record = _claim_record(claim_type, claim_value)
    if record is None:
        return
    field_key, label, value = record
    fields[field_key].append(
        {
            "label": label,
            "value": value,
            "sources": evidence_urls,
        }
    )


def _strip_html(value: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", value)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_domain(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc.lower().replace("www.", "")
    return host or None


def _is_us_broadcast_source(name: str, website: str | None, country: str | None) -> bool:
    if (country or "").upper() != "US":
        return False
    tokens = " ".join([name.lower(), (website or "").lower()])
    return any(keyword in tokens for keyword in ("tv", "radio", "fm", "am", "broadcast"))


def _citation(url: str | None, label: str, note: str | None = None) -> dict[str, str]:
    citation = {"label": label}
    if url:
        citation["url"] = url
    if note:
        citation["note"] = note
    return citation


def _source_profile_citation(
    url: str | None, official_website: str | None
) -> dict[str, str] | None:
    if not url:
        return None
    normalized_url = url.lower()
    official_host = _extract_domain(official_website)
    url_host = _extract_domain(url)
    if "wikipedia.org/" in normalized_url:
        return _citation(url, "Wikipedia profile")
    if "wikidata.org/" in normalized_url:
        return _citation(url, "Wikidata public record")
    if "projects.propublica.org/nonprofits/" in normalized_url:
        return _citation(url, "ProPublica Nonprofit Explorer")
    if official_host and url_host == official_host:
        if re.search(
            r"/(about|ownership|company|masthead|staff|team|editorial|standards|ethics)",
            urlparse(url).path,
        ):
            return _citation(url, "Official transparency page")
        return _citation(url, "Official website")
    return _citation(url, "Public source")


async def _resolve_labels(
    http_client: httpx.AsyncClient, item_ids: Sequence[str]
) -> dict[str, str]:
    unique_ids = sorted({item_id for item_id in item_ids if item_id})
    if not unique_ids:
        return {}
    response = await http_client.get(
        WIKIDATA_API_URL,
        params={
            "action": "wbgetentities",
            "ids": "|".join(unique_ids),
            "props": "labels",
            "languages": "en",
            "format": "json",
            "formatversion": 2,
        },
        headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
    )
    if response.status_code != 200:
        return {}
    entities = response.json().get("entities") or {}
    results: dict[str, str] = {}
    values = entities.values() if isinstance(entities, dict) else entities
    for entity in values:
        parsed = _wikidata_label(entity)
        if parsed is not None:
            entity_id, label = parsed
            results[entity_id] = label
    return results


def _wikidata_label(entity: Any) -> tuple[str, str] | None:
    if not isinstance(entity, dict):
        return None
    entity_id = entity.get("id")
    label = (entity.get("labels") or {}).get("en", {}).get("value")
    if not entity_id or not label:
        return None
    return str(entity_id), str(label)


async def _fetch_entities(
    http_client: httpx.AsyncClient, ids: Sequence[str]
) -> list[dict[str, Any]]:
    unique_ids = sorted({item_id for item_id in ids if item_id})
    if not unique_ids:
        return []
    response = await http_client.get(
        WIKIDATA_API_URL,
        params={
            "action": "wbgetentities",
            "ids": "|".join(unique_ids),
            "props": "claims|labels|descriptions|sitelinks",
            "languages": "en",
            "format": "json",
            "formatversion": 2,
        },
        headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
    )
    if response.status_code != 200:
        return []
    entities = response.json().get("entities") or {}
    values = entities.values() if isinstance(entities, dict) else entities
    return [cast(dict[str, Any], entity) for entity in values if isinstance(entity, dict)]


async def _search_wikidata(http_client: httpx.AsyncClient, name: str) -> list[dict[str, Any]]:
    response = await http_client.get(
        WIKIDATA_API_URL,
        params={
            "action": "wbsearchentities",
            "search": name,
            "language": "en",
            "limit": WIKIDATA_SEARCH_LIMIT,
            "type": "item",
            "format": "json",
        },
        headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
    )
    if response.status_code != 200:
        return []
    return cast(list[dict[str, Any]], response.json().get("search") or [])


async def _fetch_wikipedia_summary(
    http_client: httpx.AsyncClient, title: str | None
) -> dict[str, Any]:
    if not title:
        return {}
    response = await http_client.get(
        WIKIPEDIA_API_URL,
        params={
            "action": "query",
            "titles": title,
            "prop": "extracts|info",
            "exintro": True,
            "explaintext": True,
            "inprop": "url",
            "format": "json",
        },
        headers={"User-Agent": SCOOP_WIKIMEDIA_UA},
    )
    if response.status_code != 200:
        return {}
    pages = (response.json().get("query") or {}).get("pages") or {}
    for page_id, page_info in pages.items():
        if page_id == "-1":
            continue
        return {
            "title": page_info.get("title"),
            "extract": page_info.get("extract"),
            "url": page_info.get("fullurl"),
        }
    return {}


async def _fetch_official_page(
    http_client: httpx.AsyncClient,
    base_url: str,
    label: str,
    path: str,
    seen_urls: set[str],
) -> dict[str, str] | None:
    candidate = f"{base_url.rstrip('/')}{path}"
    try:
        response = await http_client.get(candidate, follow_redirects=True)
    except Exception:
        return None
    if response.status_code != 200:
        return None
    if "text/html" not in response.headers.get("content-type", ""):
        return None
    text = _strip_html(response.text)
    final_url = str(response.url)
    if len(text) < 80 or final_url in seen_urls:
        return None
    if not _official_page_url_matches_label(label, final_url):
        return None
    return {"label": label, "url": final_url, "summary": text[:420]}


async def _try_fetch_site_pages(
    http_client: httpx.AsyncClient, website: str | None
) -> list[dict[str, str]]:
    if not website:
        return []
    base = website if "://" in website else f"https://{website}"
    pages: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for label, paths in OFFICIAL_PAGE_CANDIDATES:
        for path in paths:
            page = await _fetch_official_page(http_client, base, label, path, seen_urls)
            if page is None:
                continue
            seen_urls.add(page["url"])
            pages.append(page)
            break
    return pages


def _official_page_url_matches_label(label: str, url: str) -> bool:
    terms = OFFICIAL_PAGE_URL_TERMS.get(label)
    if not terms:
        return True
    parsed = urlparse(url)
    path = parsed.path.lower().strip("/")
    if not path:
        return False
    normalized_path = re.sub(r"[^a-z0-9]+", "-", path).strip("-")
    return any(term in normalized_path for term in terms)


def _context_similarity(name: str, description: str, article_context: str | None) -> float:
    context = (article_context or "").strip()
    if not context or not description:
        return 0.0
    vector_store = get_vector_store()
    if vector_store is not None:
        try:
            embeddings = vector_store.embedding_model.encode([context, description])
            context_vector = np.array(embeddings[0])
            description_vector = np.array(embeddings[1])
            context_norm = np.linalg.norm(context_vector)
            description_norm = np.linalg.norm(description_vector)
            if context_norm > 0 and description_norm > 0:
                raw_score = float(
                    np.dot(context_vector, description_vector) / (context_norm * description_norm)
                )
                return max(0.0, min(1.0, (raw_score + 1.0) / 2.0))
        except Exception as exc:
            logger.debug("Reporter context embedding match failed for %s: %s", name, exc)
    return _token_overlap(context, description)


def _empty_reporter_dossier(
    normalized_name: str,
    resolver_key: str,
    match_explanation: str,
    research_sources: list[str],
) -> dict[str, Any]:
    return {
        "name": normalized_name,
        "normalized_name": normalized_name.lower(),
        "canonical_name": normalized_name,
        "resolver_key": resolver_key,
        "match_status": "none",
        "overview": None,
        "bio": None,
        "career_history": [],
        "topics": [],
        "education": [],
        "wikipedia_url": None,
        "wikidata_qid": None,
        "wikidata_url": None,
        "dossier_sections": [],
        "citations": [],
        "search_links": {
            "wikipedia": f"https://en.wikipedia.org/w/index.php?search={quote(normalized_name)}",
            "wikidata": f"https://www.wikidata.org/w/index.php?search={quote(normalized_name)}",
        },
        "match_explanation": match_explanation,
        "research_sources": research_sources,
        "research_confidence": "low",
    }


def _claim_labels(
    label_map: dict[str, str],
    claims: dict[str, Any],
    prop: str,
) -> list[str]:
    return [
        label_map[item_id]
        for item_id in _extract_wikidata_item_ids(claims, prop)
        if item_id in label_map
    ]


def _collect_label_ids(entity_candidates: Sequence[dict[str, Any]]) -> list[str]:
    return [
        item_id
        for entity in entity_candidates
        for prop in (
            "P31",
            "P106",
            "P108",
            "P69",
            "P27",
            "P101",
            "P1416",
            "P102",
            "P1142",
            "P463",
            "P166",
            "P800",
            "P512",
            "P1412",
            "P19",
            "P937",
        )
        for item_id in _extract_wikidata_item_ids(entity.get("claims") or {}, prop)
    ]


def _reporter_candidate_signals(
    normalized_name: str,
    entity: dict[str, Any],
    label_map: dict[str, str],
) -> dict[str, Any]:
    claims = entity.get("claims") or {}
    label = (entity.get("labels") or {}).get("en", {}).get("value") or normalized_name
    description = (entity.get("descriptions") or {}).get("en", {}).get("value") or ""
    return {
        "claims": claims,
        "label": label,
        "description": description,
        "instance_ids": _extract_wikidata_item_ids(claims, "P31"),
        "occupation_labels": _claim_labels(label_map, claims, "P106"),
        "employer_labels": _claim_labels(label_map, claims, "P108"),
        "wiki_title": ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title"),
        "twitter_handle": _extract_wikidata_string(claims, "P2002"),
        "linkedin_url": _extract_wikidata_url(claims, "P6634"),
        "instagram_handle": _extract_wikidata_string(claims, "P2003"),
        "field_of_work": _claim_labels(label_map, claims, "P101"),
        "affiliations": _claim_labels(label_map, claims, "P1416"),
        "political_party": _claim_labels(label_map, claims, "P102"),
        "political_ideology": _claim_labels(label_map, claims, "P1142"),
        "member_of": _claim_labels(label_map, claims, "P463"),
        "work_location": _claim_labels(label_map, claims, "P937"),
        "award_labels": _claim_labels(label_map, claims, "P166"),
        "notable_works": _claim_labels(label_map, claims, "P800"),
        "degrees": _claim_labels(label_map, claims, "P512"),
        "languages": _claim_labels(label_map, claims, "P1412"),
        "date_of_birth": _extract_wikidata_string(claims, "P569"),
        "place_of_birth_labels": _claim_labels(label_map, claims, "P19"),
        "work_period_start": _extract_wikidata_string(claims, "P2031"),
        "work_period_end": _extract_wikidata_string(claims, "P2032"),
        "official_website": _extract_wikidata_url(claims, "P856"),
        "qid": entity.get("id"),
    }


def _reporter_candidate_scores(
    normalized_name: str,
    organization: str | None,
    article_context: str | None,
    signals: dict[str, Any],
) -> dict[str, float]:
    occupation_labels = signals["occupation_labels"]
    employer_labels = signals["employer_labels"]
    instance_ids = signals["instance_ids"]
    name_score = _text_similarity(normalized_name, signals["label"])
    organization_score = max(
        max(_token_overlap(organization, emp_label) for emp_label in employer_labels)
        if employer_labels
        else 0.0,
        0.0,
    )
    occupation_text = " ".join(occupation_labels).lower()
    occupation_is_journalism = any(keyword in occupation_text for keyword in JOURNALISM_KEYWORDS)
    occupation_is_non_journalist = any(
        keyword in occupation_text for keyword in NON_JOURNALIST_OCCUPATIONS
    )
    occupation_score = 1.0 if occupation_is_journalism else 0.0
    human_score = 1.0 if INSTANCE_HUMAN in instance_ids else 0.0
    context_score = _context_similarity(normalized_name, signals["description"], article_context)
    total_score = (
        name_score * 0.30
        + human_score * 0.18
        + occupation_score * 0.26
        + organization_score * 0.14
        + context_score * 0.12
    )
    if occupation_is_non_journalist and not occupation_is_journalism:
        total_score -= NON_JOURNALIST_PENALTY
    return {
        "name": name_score,
        "human": human_score,
        "occupation": occupation_score,
        "organization": organization_score,
        "context": context_score,
        "total": total_score,
    }


def _score_reporter_candidate(
    normalized_name: str,
    organization: str | None,
    article_context: str | None,
    entity: dict[str, Any],
    label_map: dict[str, str],
) -> tuple[float, dict[str, Any]]:
    signals = _reporter_candidate_signals(normalized_name, entity, label_map)
    scores = _reporter_candidate_scores(normalized_name, organization, article_context, signals)
    metadata = {
        "qid": signals["qid"],
        "label": signals["label"],
        "description": signals["description"],
        "occupations": signals["occupation_labels"],
        "employers": signals["employer_labels"],
        "education": _claim_labels(label_map, signals["claims"], "P69"),
        "citizenships": _claim_labels(label_map, signals["claims"], "P27"),
        "official_website": signals["official_website"],
        "twitter_handle": signals["twitter_handle"],
        "linkedin_url": signals["linkedin_url"],
        "instagram_handle": signals["instagram_handle"],
        "field_of_work": signals["field_of_work"],
        "affiliations": signals["affiliations"],
        "political_party": signals["political_party"],
        "political_ideology": signals["political_ideology"],
        "member_of": signals["member_of"],
        "work_location": signals["work_location"],
        "awards": signals["award_labels"],
        "notable_works": signals["notable_works"],
        "degrees": signals["degrees"],
        "languages": signals["languages"],
        "date_of_birth": signals["date_of_birth"],
        "place_of_birth": signals["place_of_birth_labels"],
        "work_period_start": signals["work_period_start"],
        "work_period_end": signals["work_period_end"],
        "wiki_title": signals["wiki_title"],
        "scores": {key: round(value, 3) for key, value in scores.items()},
    }
    return scores["total"], metadata


def _select_reporter_match(
    scored: Sequence[tuple[float, dict[str, Any], dict[str, Any]]],
) -> tuple[float, float, dict[str, Any]] | None:
    journalist_scored = [s for s in scored if s[2]["scores"]["occupation"] > 0]
    if not journalist_scored:
        return None
    best_score, _, best_meta = journalist_scored[0]
    second_score = (
        journalist_scored[1][0]
        if len(journalist_scored) > 1
        else (scored[0][0] if scored[0][2].get("qid") != best_meta.get("qid") else 0.0)
    )
    return best_score, second_score, best_meta


def _optional_citation(url: str | None, label: str) -> list[dict[str, str]]:
    return [_citation(url, label)] if url else []


def _reporter_labeled_items(
    label: str,
    values: Sequence[str],
    source_url: str | None,
) -> list[dict[str, Any]]:
    return [
        {
            "label": label,
            "value": value,
            "sources": _unique_strings([source_url]),
        }
        for value in values
    ]


def _reporter_public_record_items(
    occupations: Sequence[str],
    field_of_work: Sequence[str],
    employers: Sequence[str],
    affiliations: Sequence[str],
    citizenships: Sequence[str],
    wikidata_url: str | None,
) -> list[dict[str, Any]]:
    return (
        _reporter_labeled_items("Occupation", occupations, wikidata_url)
        + _reporter_labeled_items("Field of work", field_of_work, wikidata_url)
        + _reporter_labeled_items("Employer", employers, wikidata_url)
        + _reporter_labeled_items("Affiliation", affiliations, wikidata_url)
        + _reporter_labeled_items("Citizenship", citizenships, wikidata_url)
    )


def _reporter_alignment_items(
    political_party: Sequence[str],
    political_ideology: Sequence[str],
    member_of: Sequence[str],
    wikidata_url: str | None,
) -> list[dict[str, Any]]:
    return (
        _reporter_labeled_items("Political party", political_party, wikidata_url)
        + _reporter_labeled_items("Political ideology", political_ideology, wikidata_url)
        + _reporter_labeled_items("Member of", member_of, wikidata_url)
    )


def _reporter_link_items(label: str, url: str | None) -> list[dict[str, Any]]:
    return [{"label": label, "value": url, "sources": [url]}] if url else []


def _reporter_links_items(
    wikipedia_url: str | None,
    wikidata_url: str | None,
    official_website: str | None,
) -> list[dict[str, Any]]:
    return (
        _reporter_link_items("Wikipedia", wikipedia_url)
        + _reporter_link_items("Wikidata", wikidata_url)
        + _reporter_link_items("Official website", official_website)
    )


def _reporter_section(
    section_id: str,
    title: str,
    items: list[dict[str, Any]],
    status: str | None = None,
) -> dict[str, Any]:
    return {
        "id": section_id,
        "title": title,
        "status": status or ("available" if items else "missing"),
        "items": items,
    }


def _build_reporter_sections(
    canonical_name: str,
    match_explanation: str,
    summary: dict[str, Any],
    occupations: Sequence[str],
    field_of_work: Sequence[str],
    employers: Sequence[str],
    affiliations: Sequence[str],
    education: Sequence[str],
    citizenships: Sequence[str],
    political_party: Sequence[str],
    political_ideology: Sequence[str],
    member_of: Sequence[str],
    official_website: str | None,
    wikipedia_url: str | None,
    wikidata_url: str | None,
) -> list[dict[str, Any]]:
    citation_urls = _unique_strings([wikipedia_url, wikidata_url, official_website])
    identity_items = [{"label": "Name", "value": canonical_name, "sources": citation_urls}]
    if summary.get("extract"):
        identity_items.append(
            {
                "label": "Overview",
                "value": summary["extract"],
                "sources": _unique_strings([wikipedia_url, wikidata_url]),
            }
        )
    identity_items.append(
        {
            "label": "Match",
            "value": match_explanation,
            "sources": _unique_strings([wikidata_url]),
        }
    )
    public_record_items = _reporter_public_record_items(
        occupations,
        field_of_work,
        employers,
        affiliations,
        citizenships,
        wikidata_url,
    )
    education_items = _reporter_labeled_items("Educated at", education, wikidata_url)
    alignment_items = _reporter_alignment_items(
        political_party,
        political_ideology,
        member_of,
        wikidata_url,
    )
    links_items = _reporter_links_items(wikipedia_url, wikidata_url, official_website)
    return [
        _reporter_section("identity", "Identity", identity_items, "available"),
        _reporter_section("occupations", "Public Record", public_record_items),
        _reporter_section("education", "Education", education_items),
        _reporter_section("alignment", "Alignment", alignment_items),
        _reporter_section("links", "Links", links_items),
    ]


def _build_reporter_payload(
    normalized_name: str,
    resolver_key: str,
    match_status: str,
    canonical_name: str,
    overview: str | None,
    best_meta: dict[str, Any],
    wikipedia_url: str | None,
    wikidata_url: str | None,
    sections: list[dict[str, Any]],
    citations: list[dict[str, str]],
    citation_urls: list[str],
) -> dict[str, Any]:
    return {
        "name": normalized_name,
        "normalized_name": normalized_name.lower(),
        "canonical_name": canonical_name,
        "resolver_key": resolver_key,
        "match_status": match_status,
        "overview": overview,
        "bio": overview,
        "career_history": [
            {"organization": employer, "role": "employer", "source": "wikidata"}
            for employer in best_meta["employers"]
        ],
        "topics": _unique_strings([*best_meta["occupations"], *best_meta["field_of_work"]]),
        "education": [
            {"institution": institution, "source": "wikidata"}
            for institution in best_meta["education"]
        ],
        "wikipedia_url": wikipedia_url,
        "wikidata_qid": best_meta.get("qid"),
        "wikidata_url": wikidata_url,
        "dossier_sections": sections,
        "citations": citations,
        "search_links": {
            "wikipedia": wikipedia_url
            or f"https://en.wikipedia.org/w/index.php?search={quote(normalized_name)}",
            "wikidata": wikidata_url
            or f"https://www.wikidata.org/w/index.php?search={quote(normalized_name)}",
        },
        "match_explanation": (
            f"Matched {canonical_name} with score {best_meta['scores']['total']}."
            if match_status == "matched"
            else f"Best candidate was {canonical_name}, but the margin over the next candidate was too small."
        ),
        "research_sources": ["wikidata_search", "wikidata_entities", "wikipedia"],
        "research_confidence": "high" if match_status == "matched" else "medium",
        "twitter_handle": best_meta.get("twitter_handle"),
        "linkedin_url": best_meta.get("linkedin_url"),
        "instagram_handle": best_meta.get("instagram_handle"),
        "field_of_work": best_meta.get("field_of_work"),
        "affiliations": best_meta.get("affiliations"),
        "citizenships": best_meta["citizenships"],
        "political_party": best_meta.get("political_party"),
        "political_ideology": best_meta.get("political_ideology"),
        "member_of": best_meta.get("member_of"),
        "work_location": best_meta.get("work_location"),
        "awards": best_meta.get("awards"),
        "notable_works": best_meta.get("notable_works"),
        "degrees": best_meta.get("degrees"),
        "languages": best_meta.get("languages"),
        "date_of_birth": best_meta.get("date_of_birth"),
        "place_of_birth": best_meta.get("place_of_birth"),
        "work_period_start": best_meta.get("work_period_start"),
        "work_period_end": best_meta.get("work_period_end"),
        "official_website": best_meta.get("official_website"),
        "raw_match_scores": best_meta["scores"],
        "citation_urls": citation_urls,
    }


async def _finalize_reporter_dossier(
    client: httpx.AsyncClient,
    normalized_name: str,
    resolver_key: str,
    scored: Sequence[tuple[float, dict[str, Any], dict[str, Any]]],
    best_score: float,
    second_score: float,
    best_meta: dict[str, Any],
) -> dict[str, Any]:
    context = await _reporter_dossier_context(
        client,
        normalized_name,
        scored,
        best_score,
        second_score,
        best_meta,
    )
    match_status = context["match_status"]
    summary: dict[str, Any] = {}
    wikipedia_url = context["wikipedia_url"]
    wikidata_url = context["wikidata_url"]
    canonical_name = context["canonical_name"]
    overview = context["overview"]
    citation_urls = context["citation_urls"]
    citations = context["citations"]
    sections = _build_reporter_sections(
        canonical_name=canonical_name,
        match_explanation=(
            "Resolved via name, occupation, outlet overlap, and article context."
            if match_status == "matched"
            else "Multiple public candidates remained plausible after deterministic matching."
        ),
        summary=summary,
        occupations=best_meta["occupations"],
        field_of_work=best_meta["field_of_work"],
        employers=best_meta["employers"],
        affiliations=best_meta["affiliations"],
        education=best_meta["education"],
        citizenships=best_meta["citizenships"],
        political_party=best_meta.get("political_party") or [],
        political_ideology=best_meta.get("political_ideology") or [],
        member_of=best_meta.get("member_of") or [],
        official_website=cast(str | None, best_meta.get("official_website")),
        wikipedia_url=wikipedia_url,
        wikidata_url=wikidata_url,
    )
    return _build_reporter_payload(
        normalized_name=normalized_name,
        resolver_key=resolver_key,
        match_status=match_status,
        canonical_name=canonical_name,
        overview=overview,
        best_meta=best_meta,
        wikipedia_url=wikipedia_url,
        wikidata_url=wikidata_url,
        sections=sections,
        citations=citations,
        citation_urls=citation_urls,
    )


async def _reporter_dossier_context(
    client: httpx.AsyncClient,
    normalized_name: str,
    scored: Sequence[tuple[float, dict[str, Any], dict[str, Any]]],
    best_score: float,
    second_score: float,
    best_meta: dict[str, Any],
) -> dict[str, Any]:
    matched_threshold = 0.65 if len(scored) == 1 else 0.55
    match_status = (
        "matched"
        if best_score >= matched_threshold and (best_score - second_score) >= 0.08
        else "ambiguous"
    )
    summary: dict[str, Any] = {}
    try:
        summary = await _fetch_wikipedia_summary(client, best_meta.get("wiki_title"))
    except Exception:
        logger.debug("Wikipedia summary fetch failed for %s", normalized_name)
    wikipedia_url = cast(str | None, summary.get("url"))
    wikidata_url = (
        f"https://www.wikidata.org/wiki/{best_meta['qid']}" if best_meta.get("qid") else None
    )
    canonical_name = cast(str, summary.get("title") or best_meta.get("label") or normalized_name)
    overview = cast(str | None, summary.get("extract") or best_meta.get("description"))
    citation_urls = _unique_strings(
        [wikipedia_url, wikidata_url, best_meta.get("official_website")]
    )
    citations = _optional_citation(wikipedia_url, "Wikipedia lead") + _optional_citation(
        wikidata_url, "Wikidata item"
    )
    return {
        "match_status": match_status,
        "wikipedia_url": wikipedia_url,
        "wikidata_url": wikidata_url,
        "canonical_name": canonical_name,
        "overview": overview,
        "citation_urls": citation_urls,
        "citations": citations,
    }


async def _score_reporter_entities(
    client: httpx.AsyncClient,
    normalized_name: str,
    organization: str | None,
    article_context: str | None,
    candidates: list[dict[str, Any]],
) -> list[tuple[float, dict[str, Any], dict[str, Any]]]:
    candidate_ids = [
        str(candidate_id)
        for candidate in candidates
        for candidate_id in [
            (_extract_entity_id(candidate.get("concepturi")) or candidate.get("id"))
        ]
        if candidate_id
    ]
    entity_candidates = await _fetch_entities(client, candidate_ids)
    label_map = await _resolve_labels(client, _collect_label_ids(entity_candidates))
    scored: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
    for entity in entity_candidates:
        total_score, metadata = _score_reporter_candidate(
            normalized_name,
            organization,
            article_context,
            entity,
            label_map,
        )
        scored.append((total_score, entity, metadata))
    return scored


async def build_reporter_dossier(
    name: str,
    organization: str | None = None,
    article_context: str | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Build Reporter Dossier."""
    normalized_name = _normalize_name(name)
    resolver_key = build_resolver_key(name, organization)
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=20.0)
    try:
        candidates = await _search_wikidata(client, normalized_name)
        if not candidates:
            return _empty_reporter_dossier(
                normalized_name,
                resolver_key,
                "No public Wikimedia record cleared the search step.",
                ["wikidata_search"],
            )
        scored = await _score_reporter_entities(
            client,
            normalized_name,
            organization,
            article_context,
            candidates,
        )
        if not scored:
            return _empty_reporter_dossier(
                normalized_name,
                resolver_key,
                "Candidates were returned, but none exposed usable public facts.",
                ["wikidata_search", "wikidata_entities"],
            )
        scored.sort(key=lambda item: item[0], reverse=True)
        selected = _select_reporter_match(scored)
        if selected is None:
            return _empty_reporter_dossier(
                normalized_name,
                resolver_key,
                "No journalist Wikidata candidates found for this name -- bylines are from a news outlet, not a known public entity.",
                ["wikidata_search"],
            )
        best_score, second_score, best_meta = selected
        return await _finalize_reporter_dossier(
            client,
            normalized_name,
            resolver_key,
            scored,
            best_score,
            second_score,
            best_meta,
        )

    finally:
        if owned_client:
            await client.aclose()


def build_source_sections(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Build Source Sections."""
    fields = cast(dict[str, list[dict[str, Any]]], profile.get("fields") or {})
    sections: list[dict[str, Any]] = []
    section_map = [
        ("overview", "Overview", ("overview", "about", "official_website")),
        ("ownership", "Ownership", ("ownership", "affiliations")),
        ("funding", "Funding", ("funding", "nonprofit_filings")),
        ("transparency", "Transparency", ("transparency",)),
        (
            "public_records",
            "Public Records",
            ("founded", "headquarters", "public_records"),
        ),
    ]
    for section_id, title, keys in section_map:
        items = [entry for key in keys for entry in fields.get(key, []) if entry.get("value")]
        sections.append(
            {
                "id": section_id,
                "title": title,
                "status": "available" if items else "missing",
                "items": items,
            }
        )
    return sections


def _transparency_item(
    label: str,
    value: str,
    sources: list[str],
    notes: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "label": label,
        "value": value,
        "sources": _unique_strings(sources),
    }
    if notes:
        item["notes"] = notes
    return item


def _transparency_page_items(
    pages_by_label: dict[str | None, dict[str, str]],
) -> list[dict[str, Any]]:
    checks = [
        (
            "About page",
            "about",
            "Trust/JTI-style identity signal: source publishes an about or mission page.",
        ),
        (
            "Masthead or author directory",
            "masthead",
            "Trust/JTI-style people signal: source exposes staff, team, or author information.",
        ),
        (
            "Editorial standards",
            "editorial_standards",
            "Trust/JTI-style policy signal: source exposes editorial standards, ethics, or policy information.",
        ),
        (
            "Corrections policy",
            "corrections",
            "Trust/JTI-style accountability signal: source exposes a corrections page or policy.",
        ),
        (
            "Ownership page",
            "ownership",
            "Trust/JTI-style governance signal: source exposes ownership or company information.",
        ),
    ]
    items: list[dict[str, Any]] = []
    for label, page_label, notes in checks:
        page = pages_by_label.get(page_label)
        if page:
            items.append(_transparency_item(label, "available", [page["url"]], notes))
    return items


def _structured_record_transparency_items(
    fields: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    ownership_sources = [
        source
        for item in [*fields.get("ownership", []), *fields.get("affiliations", [])]
        for source in cast(list[str], item.get("sources") or [])
    ]
    if ownership_sources:
        items.append(
            _transparency_item(
                "Structured ownership record",
                "available",
                ownership_sources,
                "Ownership or affiliation was resolved from public structured records.",
            )
        )
    funding_sources = [
        source
        for item in [*fields.get("funding", []), *fields.get("nonprofit_filings", [])]
        for source in cast(list[str], item.get("sources") or [])
    ]
    if funding_sources:
        items.append(
            _transparency_item(
                "Funding record",
                "available",
                funding_sources,
                "Funding type or nonprofit filing evidence is present.",
            )
        )
    return items


def _ads_txt_transparency_items(
    ads_txt: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not ads_txt:
        return items
    ads_txt_sources = _ads_txt_sources(ads_txt)
    authorized_sellers = int(ads_txt.get("authorized_sellers") or 0)
    direct_sellers = int(ads_txt.get("direct_sellers") or 0)
    resellers = int(ads_txt.get("resellers") or 0)
    items.append(
        _transparency_item(
            "ads.txt authorized sellers",
            f"{authorized_sellers} authorized sellers ({direct_sellers} DIRECT, {resellers} RESELLER)",
            ads_txt_sources,
            "IAB ads.txt signal: publisher declares authorized digital advertising sellers.",
        )
    )
    _append_ads_txt_domain_item(
        items,
        "ads.txt owner domain",
        cast(list[str], ads_txt.get("owner_domains") or []),
        ads_txt_sources,
        "IAB ads.txt OWNERDOMAIN signal links publisher inventory to declared ownership domain.",
    )
    _append_ads_txt_domain_item(
        items,
        "ads.txt manager domain",
        cast(list[str], ads_txt.get("manager_domains") or []),
        ads_txt_sources,
        "IAB ads.txt MANAGERDOMAIN signal names the declared monetization manager.",
    )
    duplicate_records = int(ads_txt.get("duplicate_records") or 0)
    invalid_lines = int(ads_txt.get("invalid_lines") or 0)
    _append_ads_txt_diagnostics(
        items,
        duplicate_records,
        invalid_lines,
        ads_txt_sources,
    )
    return items


def _ads_txt_sources(ads_txt: dict[str, Any]) -> list[str]:
    return _unique_strings([cast(str | None, ads_txt.get("url"))])


def _append_ads_txt_domain_item(
    items: list[dict[str, Any]],
    label: str,
    domains: list[str],
    sources: list[str],
    note: str,
) -> None:
    if domains:
        items.append(_transparency_item(label, ", ".join(domains), sources, note))


def _append_ads_txt_diagnostics(
    items: list[dict[str, Any]],
    duplicate_records: int,
    invalid_lines: int,
    sources: list[str],
) -> None:
    if duplicate_records or invalid_lines:
        items.append(
            _transparency_item(
                "ads.txt diagnostics",
                f"{duplicate_records} duplicate records; {invalid_lines} invalid lines",
                sources,
                "Local parser diagnostics for malformed or repeated ads.txt seller declarations.",
            )
        )


def _sellers_json_transparency_items(
    sellers_json: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not sellers_json:
        return items
    systems = cast(list[dict[str, Any]], sellers_json.get("systems") or [])
    sellers_json_urls = _available_sellers_json_urls(systems)
    checked_records = int(sellers_json.get("checked_records") or 0)
    matched_records = int(sellers_json.get("matched_records") or 0)
    available_sellers_json = int(sellers_json.get("available_sellers_json") or 0)
    checked_ad_systems = int(sellers_json.get("checked_ad_systems") or 0)
    items.append(
        _transparency_item(
            "sellers.json cross-check",
            (
                f"{matched_records}/{checked_records} checked ads.txt rows matched "
                f"across {available_sellers_json}/{checked_ad_systems} ad systems"
            ),
            sellers_json_urls,
            "IAB sellers.json signal: ad-system seller IDs were checked against published seller identity files.",
        )
    )
    _append_sellers_json_alignment(items, sellers_json, sellers_json_urls)
    return items


def _available_sellers_json_urls(systems: list[dict[str, Any]]) -> list[str]:
    return _unique_strings(
        cast(str | None, system.get("sellers_json_url"))
        for system in systems
        if system.get("status") == "available"
    )


def _append_sellers_json_alignment(
    items: list[dict[str, Any]],
    sellers_json: dict[str, Any],
    urls: list[str],
) -> None:
    owner_domain_matches = int(sellers_json.get("owner_domain_matches") or 0)
    manager_domain_matches = int(sellers_json.get("manager_domain_matches") or 0)
    if not owner_domain_matches and not manager_domain_matches:
        return
    items.append(
        _transparency_item(
            "sellers.json domain alignment",
            (
                f"{owner_domain_matches} OWNERDOMAIN matches; "
                f"{manager_domain_matches} MANAGERDOMAIN matches"
            ),
            urls,
            "Matched sellers.json domains are compared with ads.txt OWNERDOMAIN and MANAGERDOMAIN declarations.",
        )
    )


def _policy_transparency_items(
    policy_transparency: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if not policy_transparency:
        return items
    for signal in cast(list[dict[str, Any]], policy_transparency.get("signals") or []):
        sources = cast(list[str], signal.get("sources") or [])
        if not sources:
            continue
        matched_terms = cast(list[str], signal.get("matched_terms") or [])
        notes = "Official-page policy text matched deterministic transparency terms."
        if matched_terms:
            notes = f"{notes} Terms: {', '.join(matched_terms[:6])}."
        items.append(
            _transparency_item(
                f"Policy signal: {signal.get('label') or signal.get('id')}",
                "available",
                sources,
                notes,
            )
        )
    return items


def _build_transparency_items(
    official_pages: list[dict[str, str]],
    fields: dict[str, list[dict[str, Any]]],
    ads_txt: dict[str, Any] | None = None,
    sellers_json: dict[str, Any] | None = None,
    policy_transparency: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    pages_by_label = {
        page.get("label"): page for page in official_pages if page.get("label") and page.get("url")
    }
    return (
        _transparency_page_items(pages_by_label)
        + _structured_record_transparency_items(fields)
        + _ads_txt_transparency_items(ads_txt)
        + _sellers_json_transparency_items(sellers_json)
        + _policy_transparency_items(policy_transparency)
    )


async def _fetch_organization_evidence(
    official_website: str | None,
) -> tuple[
    list[dict[str, str]],
    dict[str, Any] | None,
    dict[str, Any] | None,
    dict[str, Any] | None,
]:
    if not official_website:
        return [], None, None, None
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        official_pages = await _try_fetch_site_pages(client, official_website)
        ads_txt = await _fetch_ads_txt(client, official_website)
        sellers_json = await _build_sellers_json_summary(client, ads_txt)
        policy_transparency = build_policy_transparency_summary(official_pages)
    return official_pages, ads_txt, sellers_json, policy_transparency


def _add_profile_field(
    fields: dict[str, list[dict[str, Any]]],
    group: str,
    label: str,
    value: Any,
    sources: Iterable[str | None],
) -> None:
    fields[group].append(
        {
            "label": label,
            "value": value,
            "sources": _unique_strings(sources),
        }
    )


def _add_about_page_field(
    fields: dict[str, list[dict[str, Any]]],
    about_page: dict[str, Any],
) -> None:
    if about_page.get("summary"):
        _add_profile_field(
            fields,
            "about",
            "About page",
            about_page["summary"],
            [about_page.get("url")],
        )


def _add_official_page_fields(
    fields: dict[str, list[dict[str, Any]]],
    official_pages: list[dict[str, str]],
) -> None:
    for official_page in official_pages:
        label = official_page.get("label") or "page"
        summary = official_page.get("summary")
        url = official_page.get("url")
        if not summary or not url or label == "about":
            continue
        target_field = "public_records"
        if label == "ownership":
            target_field = "ownership"
        elif label in {"editorial_standards", "corrections", "masthead"}:
            target_field = "transparency"
        fields[target_field].append(
            {
                "label": label.replace("_", " ").title(),
                "value": summary,
                "sources": [url],
            }
        )


def _add_funding_fields(
    fields: dict[str, list[dict[str, Any]]],
    org_data: dict[str, Any],
    citation_candidates: Sequence[Any],
    ads_txt: dict[str, Any] | None,
) -> None:
    if org_data.get("funding_type"):
        _add_profile_field(
            fields,
            "funding",
            "Funding type",
            org_data["funding_type"],
            citation_candidates,
        )
    funding_sources = cast(list[str], org_data.get("funding_sources") or [])
    if funding_sources:
        _add_profile_field(
            fields,
            "funding",
            "Funding sources",
            ", ".join(funding_sources),
            citation_candidates,
        )
    if ads_txt:
        authorized_sellers = int(ads_txt.get("authorized_sellers") or 0)
        if authorized_sellers:
            _add_profile_field(
                fields,
                "funding",
                "Ad supply evidence",
                f"{authorized_sellers} authorized ad sellers",
                [cast(str | None, ads_txt.get("url"))],
            )


def _add_catalog_record_fields(
    fields: dict[str, list[dict[str, Any]]],
    org_data: dict[str, Any],
    citation_candidates: Sequence[Any],
) -> None:
    if org_data.get("media_bias_rating"):
        _add_profile_field(
            fields,
            "public_records",
            "Catalog bias rating",
            str(org_data["media_bias_rating"]),
            citation_candidates,
        )
    if org_data.get("factual_reporting"):
        _add_profile_field(
            fields,
            "public_records",
            "Catalog factual reporting",
            str(org_data["factual_reporting"]),
            citation_candidates,
        )
    if org_data.get("org_type"):
        _add_profile_field(
            fields,
            "public_records",
            "Organization type",
            org_data["org_type"],
            citation_candidates,
        )


def _add_ownership_fields(
    fields: dict[str, list[dict[str, Any]]],
    org_data: dict[str, Any],
) -> None:
    current_parent = cast(str | None, org_data.get("parent_org"))
    ownership_values = (
        [current_parent]
        if current_parent
        else cast(list[str | None], org_data.get("owned_by") or [])
        + cast(list[str | None], org_data.get("parent_orgs") or [])
    )
    label = "Current parent" if current_parent else "Owner"
    sources = _unique_strings(
        [
            cast(str | None, org_data.get("wikidata_url")),
            cast(str | None, org_data.get("wikipedia_url")),
        ]
    )
    for value in _unique_strings(ownership_values):
        _add_profile_field(fields, "ownership", label, value, sources)


def _add_affiliation_fields(
    fields: dict[str, list[dict[str, Any]]],
    org_data: dict[str, Any],
) -> None:
    for value in cast(list[str], org_data.get("part_of") or []):
        _add_profile_field(
            fields,
            "affiliations",
            "Affiliation",
            value,
            [cast(str | None, org_data.get("wikidata_url"))],
        )


def _add_founded_headquarters_fields(
    fields: dict[str, list[dict[str, Any]]],
    org_data: dict[str, Any],
) -> None:
    if org_data.get("inception"):
        _add_profile_field(
            fields,
            "founded",
            "Founded",
            org_data["inception"],
            [cast(str | None, org_data.get("wikidata_url"))],
        )
    for value in cast(list[str], org_data.get("headquarters") or []):
        _add_profile_field(
            fields,
            "headquarters",
            "Headquarters",
            value,
            [cast(str | None, org_data.get("wikidata_url"))],
        )


def _add_nonprofit_fields(
    fields: dict[str, list[dict[str, Any]]],
    org_data: dict[str, Any],
) -> None:
    ein = org_data.get("ein")
    if ein:
        _add_profile_field(
            fields,
            "nonprofit_filings",
            "EIN",
            str(ein),
            [f"https://projects.propublica.org/nonprofits/organizations/{ein}"],
        )
    if org_data.get("annual_revenue"):
        revenue_sources = (
            [f"https://projects.propublica.org/nonprofits/organizations/{org_data['ein']}"]
            if org_data.get("ein")
            else []
        )
        _add_profile_field(
            fields,
            "nonprofit_filings",
            "Revenue",
            str(org_data["annual_revenue"]),
            revenue_sources,
        )


def _add_broadcast_source_field(
    fields: dict[str, list[dict[str, Any]]],
    name: str,
    official_website: str | None,
) -> None:
    if _is_us_broadcast_source(name, official_website, None):
        fields["public_records"].append(
            {
                "label": "FCC ownership search",
                "value": "Open FCC ownership search",
                "sources": [
                    "https://enterpriseefiling.fcc.gov/dataentry/public/tv/publicForm323Search.html"
                ],
            }
        )


def _parse_claim_value(claim_value_raw: Any) -> dict[str, Any]:
    if isinstance(claim_value_raw, dict):
        return cast(dict[str, Any], claim_value_raw)
    if isinstance(claim_value_raw, str):
        try:
            loaded = json.loads(claim_value_raw)
            if isinstance(loaded, dict):
                return cast(dict[str, Any], loaded)
        except Exception:
            pass
    return {}


def _apply_source_claims(
    fields: dict[str, list[dict[str, Any]]],
    claim_rows: Sequence[dict[str, Any]],
) -> None:
    for claim in claim_rows:
        claim_type = str(claim.get("type") or "").strip()
        claim_value = _parse_claim_value(claim.get("value"))
        evidence = cast(list[dict[str, Any]], claim.get("evidence") or [])
        evidence_urls = _coerce_sources_to_urls(
            evidence_row.get("source_url") for evidence_row in evidence
        )
        _append_claim_items(fields, claim_type, claim_value, evidence_urls)


def _build_source_profile_fields(
    name: str,
    org_data: dict[str, Any],
    official_website: str | None,
    official_pages: list[dict[str, str]],
    about_page: dict[str, Any],
    citation_candidates: Sequence[Any],
    ads_txt: dict[str, Any] | None,
    sellers_json: dict[str, Any] | None,
    policy_transparency: dict[str, Any] | None,
    wikipedia_description: str | None,
) -> dict[str, list[dict[str, Any]]]:
    fields: dict[str, list[dict[str, Any]]] = {
        "overview": [],
        "about": [],
        "funding": [],
        "ownership": [],
        "affiliations": [],
        "founded": [],
        "headquarters": [],
        "official_website": [],
        "nonprofit_filings": [],
        "public_records": [],
        "transparency": [],
    }
    if wikipedia_description:
        _add_profile_field(
            fields,
            "overview",
            "Wikipedia",
            wikipedia_description,
            [cast(str | None, org_data.get("wikipedia_url"))],
        )
    _add_about_page_field(fields, about_page)
    _add_official_page_fields(fields, official_pages)
    if official_website:
        fields["official_website"].append(
            {
                "label": "Official website",
                "value": official_website,
                "sources": [official_website],
            }
        )
    _add_funding_fields(fields, org_data, citation_candidates, ads_txt)
    _add_catalog_record_fields(fields, org_data, citation_candidates)
    _add_ownership_fields(fields, org_data)
    _add_affiliation_fields(fields, org_data)
    _add_founded_headquarters_fields(fields, org_data)
    _add_nonprofit_fields(fields, org_data)
    _add_broadcast_source_field(fields, name, official_website)
    fields["transparency"].extend(
        _build_transparency_items(
            official_pages,
            fields,
            ads_txt,
            sellers_json,
            policy_transparency,
        )
    )
    _apply_source_claims(
        fields,
        cast(list[dict[str, Any]], org_data.get("source_claims") or []),
    )
    return fields


def _build_profile_citations(
    citation_candidates: Sequence[Any],
    official_website: str | None,
    org_data: dict[str, Any],
) -> list[dict[str, str]]:
    citations = [
        citation
        for citation in (
            _source_profile_citation(url, official_website)
            for url in _unique_strings(cast(list[str | None], citation_candidates))
        )
        if citation
    ]
    ein = org_data.get("ein")
    if ein:
        citations.append(
            _citation(
                f"https://projects.propublica.org/nonprofits/organizations/{ein}",
                "ProPublica Nonprofit Explorer",
            )
        )
    return citations


def _build_source_profile_payload(
    name: str,
    org_data: dict[str, Any],
    official_website: str | None,
    wikipedia_description: str | None,
    about_page: dict[str, Any],
    fallback_overview: str | None,
    fields: dict[str, list[dict[str, Any]]],
    citations: list[dict[str, str]],
    official_pages: list[dict[str, str]],
    policy_transparency: dict[str, Any] | None,
    ads_txt: dict[str, Any] | None,
    sellers_json: dict[str, Any] | None,
) -> dict[str, Any]:
    profile = {
        "name": name,
        "canonical_name": name,
        "website": official_website,
        "fetched_at": org_data.get("last_researched_at"),
        "cached": False,
        "fields": fields,
        "match_status": "matched"
        if any(
            value
            for value in (
                wikipedia_description,
                org_data.get("wikidata_url"),
                official_website,
            )
        )
        else "none",
        "overview": (wikipedia_description or about_page.get("summary") or fallback_overview),
        "wikipedia_url": org_data.get("wikipedia_url"),
        "wikidata_url": org_data.get("wikidata_url"),
        "wikidata_qid": org_data.get("wikidata_qid"),
        "citations": citations,
        "official_pages": official_pages,
        "policy_transparency": policy_transparency,
        "ads_txt": _public_ads_txt_summary(ads_txt),
        "sellers_json": sellers_json,
        "search_links": {
            "wikipedia": org_data.get("wikipedia_url")
            or f"https://en.wikipedia.org/w/index.php?search={quote(name)}",
            "wikidata": org_data.get("wikidata_url")
            or f"https://www.wikidata.org/w/index.php?search={quote(name)}",
            "source_search": f"https://duckduckgo.com/?q={quote(name + ' media outlet')}",
        },
        "match_explanation": "Built from Wikipedia, Wikidata, official site metadata, and public-record links.",
        "research_confidence": org_data.get("research_confidence", "low"),
        "research_sources": _unique_strings(
            cast(list[str | None], org_data.get("research_sources") or [])
        ),
        "key_reporters": [],
    }
    profile["dossier_sections"] = build_source_sections(profile)
    return profile


async def build_source_profile(name: str, website: str | None = None) -> dict[str, Any]:
    """Build Source Profile."""
    researcher = get_funding_researcher()
    org_data = await researcher.research_organization(name, website, use_ai=False)
    wikipedia_description = cast(str | None, (org_data.get("description") or "").strip() or None)
    official_website = cast(
        str | None,
        org_data.get("website") or org_data.get("official_website") or website,
    )
    (
        official_pages,
        ads_txt,
        sellers_json,
        policy_transparency,
    ) = await _fetch_organization_evidence(official_website)
    about_page = next(
        (page for page in official_pages if page.get("label") == "about"),
        {},
    )
    citation_candidates = [
        org_data.get("wikipedia_url"),
        org_data.get("wikidata_url"),
        official_website,
        about_page.get("url"),
    ]
    fields = _build_source_profile_fields(
        name,
        org_data,
        official_website,
        official_pages,
        about_page,
        citation_candidates,
        ads_txt,
        sellers_json,
        policy_transparency,
        wikipedia_description,
    )
    fallback_overview = _build_fallback_overview(name, org_data)
    if fallback_overview and not any(item.get("value") for item in fields["overview"]):
        _add_profile_field(
            fields,
            "overview",
            "Profile summary",
            fallback_overview,
            citation_candidates,
        )
    citations = _build_profile_citations(citation_candidates, official_website, org_data)
    return _build_source_profile_payload(
        name,
        org_data,
        official_website,
        wikipedia_description,
        about_page,
        fallback_overview,
        fields,
        citations,
        official_pages,
        policy_transparency,
        ads_txt,
        sellers_json,
    )
