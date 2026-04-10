from __future__ import annotations

import re
from collections import OrderedDict
from difflib import SequenceMatcher
from html import unescape
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, cast
from urllib.parse import quote, urlparse

import httpx
import numpy as np

from app.core.logging import get_logger
from app.services.funding_researcher import (
    _extract_wikidata_item_ids,
    _extract_wikidata_url,
    get_funding_researcher,
)
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
    "author",
    "columnist",
    "writer",
    "news",
)
OFFICIAL_PAGE_CANDIDATES: Sequence[Tuple[str, Sequence[str]]] = (
    ("about", ("/about", "/about-us", "/about/", "/about-us/")),
    ("masthead", ("/masthead", "/staff", "/team", "/authors")),
    (
        "editorial",
        (
            "/editorial",
            "/editorial-policy",
            "/standards",
            "/ethics",
            "/corrections",
        ),
    ),
    ("ownership", ("/ownership", "/company", "/about/ownership")),
)


def _normalize_name(value: str) -> str:
    cleaned = re.sub(r"^\s*by\s+", "", value.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def build_resolver_key(name: str, context: Optional[str] = None) -> str:
    normalized = _normalize_name(name).lower()
    suffix = (context or "").strip().lower()
    return f"{normalized}::{suffix}" if suffix else normalized


def _tokenize(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return re.findall(r"[a-z0-9]+", value.lower())


def _text_similarity(a: Optional[str], b: Optional[str]) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _token_overlap(a: Optional[str], b: Optional[str]) -> float:
    tokens_a = set(_tokenize(a))
    tokens_b = set(_tokenize(b))
    if not tokens_a or not tokens_b:
        return 0.0
    overlap = len(tokens_a & tokens_b)
    union = len(tokens_a | tokens_b)
    return overlap / union if union else 0.0


def _extract_entity_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.rsplit("/", 1)[-1]


def _unique_strings(values: Iterable[Optional[str]]) -> List[str]:
    unique: "OrderedDict[str, None]" = OrderedDict()
    for value in values:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in unique:
            unique[cleaned] = None
    return list(unique.keys())


def _strip_html(value: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", value)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_domain(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc.lower().replace("www.", "")
    return host or None


def _is_us_broadcast_source(
    name: str, website: Optional[str], country: Optional[str]
) -> bool:
    if (country or "").upper() != "US":
        return False
    tokens = " ".join([name.lower(), (website or "").lower()])
    return any(
        keyword in tokens for keyword in ("tv", "radio", "fm", "am", "broadcast")
    )


def _citation(
    url: Optional[str], label: str, note: Optional[str] = None
) -> Dict[str, str]:
    citation = {"label": label}
    if url:
        citation["url"] = url
    if note:
        citation["note"] = note
    return citation


async def _resolve_labels(
    http_client: httpx.AsyncClient, item_ids: Sequence[str]
) -> Dict[str, str]:
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
    )
    if response.status_code != 200:
        return {}
    entities = response.json().get("entities") or {}
    results: Dict[str, str] = {}
    values = entities.values() if isinstance(entities, dict) else entities
    for entity in values:
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get("id")
        label = (entity.get("labels") or {}).get("en", {}).get("value")
        if entity_id and label:
            results[str(entity_id)] = str(label)
    return results


async def _fetch_entities(
    http_client: httpx.AsyncClient, ids: Sequence[str]
) -> List[Dict[str, Any]]:
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
    )
    if response.status_code != 200:
        return []
    entities = response.json().get("entities") or {}
    values = entities.values() if isinstance(entities, dict) else entities
    return [
        cast(Dict[str, Any], entity) for entity in values if isinstance(entity, dict)
    ]


async def _search_wikidata(
    http_client: httpx.AsyncClient, name: str
) -> List[Dict[str, Any]]:
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
    )
    if response.status_code != 200:
        return []
    return cast(List[Dict[str, Any]], response.json().get("search") or [])


async def _fetch_wikipedia_summary(
    http_client: httpx.AsyncClient, title: Optional[str]
) -> Dict[str, Any]:
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


async def _try_fetch_site_pages(
    http_client: httpx.AsyncClient, website: Optional[str]
) -> List[Dict[str, str]]:
    if not website:
        return []
    base = website if "://" in website else f"https://{website}"
    pages: List[Dict[str, str]] = []
    seen_urls: set[str] = set()
    for label, paths in OFFICIAL_PAGE_CANDIDATES:
        for path in paths:
            candidate = f"{base.rstrip('/')}{path}"
            try:
                response = await http_client.get(candidate, follow_redirects=True)
            except Exception:
                continue
            if response.status_code != 200:
                continue
            if "text/html" not in response.headers.get("content-type", ""):
                continue
            text = _strip_html(response.text)
            final_url = str(response.url)
            if len(text) < 80 or final_url in seen_urls:
                continue
            seen_urls.add(final_url)
            pages.append({"label": label, "url": final_url, "summary": text[:420]})
            break
    return pages


def _context_similarity(
    name: str, description: str, article_context: Optional[str]
) -> float:
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
                    np.dot(context_vector, description_vector)
                    / (context_norm * description_norm)
                )
                return max(0.0, min(1.0, (raw_score + 1.0) / 2.0))
        except Exception as exc:
            logger.debug(
                "Reporter context embedding match failed for %s: %s", name, exc
            )
    return _token_overlap(context, description)


def _build_reporter_sections(
    canonical_name: str,
    match_explanation: str,
    summary: Dict[str, Any],
    occupations: Sequence[str],
    employers: Sequence[str],
    education: Sequence[str],
    citizenships: Sequence[str],
    official_website: Optional[str],
    wikipedia_url: Optional[str],
    wikidata_url: Optional[str],
) -> List[Dict[str, Any]]:
    citation_urls = _unique_strings([wikipedia_url, wikidata_url, official_website])
    identity_items = [
        {"label": "Name", "value": canonical_name, "sources": citation_urls}
    ]
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

    sections: List[Dict[str, Any]] = [
        {
            "id": "identity",
            "title": "Identity",
            "status": "available",
            "items": identity_items,
        },
        {
            "id": "occupations",
            "title": "Public Record",
            "status": "available"
            if occupations or employers or citizenships
            else "missing",
            "items": [
                {
                    "label": "Occupation",
                    "value": value,
                    "sources": _unique_strings([wikidata_url]),
                }
                for value in occupations
            ]
            + [
                {
                    "label": "Employer",
                    "value": value,
                    "sources": _unique_strings([wikidata_url]),
                }
                for value in employers
            ]
            + [
                {
                    "label": "Citizenship",
                    "value": value,
                    "sources": _unique_strings([wikidata_url]),
                }
                for value in citizenships
            ],
        },
        {
            "id": "education",
            "title": "Education",
            "status": "available" if education else "missing",
            "items": [
                {
                    "label": "Educated at",
                    "value": value,
                    "sources": _unique_strings([wikidata_url]),
                }
                for value in education
            ],
        },
        {
            "id": "links",
            "title": "Links",
            "status": "available"
            if wikipedia_url or wikidata_url or official_website
            else "missing",
            "items": [
                {
                    "label": "Wikipedia",
                    "value": wikipedia_url,
                    "sources": [wikipedia_url],
                }
                for wikipedia_url in ([wikipedia_url] if wikipedia_url else [])
            ]
            + [
                {"label": "Wikidata", "value": wikidata_url, "sources": [wikidata_url]}
                for wikidata_url in ([wikidata_url] if wikidata_url else [])
            ]
            + [
                {
                    "label": "Official website",
                    "value": official_website,
                    "sources": [official_website],
                }
                for official_website in ([official_website] if official_website else [])
            ],
        },
    ]
    return sections


async def build_reporter_dossier(
    name: str,
    organization: Optional[str] = None,
    article_context: Optional[str] = None,
    http_client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    normalized_name = _normalize_name(name)
    resolver_key = build_resolver_key(name, organization)
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=20.0)
    try:
        candidates = await _search_wikidata(client, normalized_name)
        if not candidates:
            search_links = {
                "wikipedia": f"https://en.wikipedia.org/w/index.php?search={quote(normalized_name)}",
                "wikidata": f"https://www.wikidata.org/w/index.php?search={quote(normalized_name)}",
            }
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
                "search_links": search_links,
                "match_explanation": "No public Wikimedia record cleared the search step.",
                "research_sources": ["wikidata_search"],
                "research_confidence": "low",
            }

        candidate_ids = [
            str(candidate_id)
            for candidate in candidates
            for candidate_id in [
                (_extract_entity_id(candidate.get("concepturi")) or candidate.get("id"))
            ]
            if candidate_id
        ]
        entity_candidates = await _fetch_entities(client, candidate_ids)
        label_map = await _resolve_labels(
            client,
            [
                item_id
                for entity in entity_candidates
                for prop in ("P31", "P106", "P108", "P69", "P27")
                for item_id in _extract_wikidata_item_ids(
                    entity.get("claims") or {}, prop
                )
            ],
        )

        scored: List[Tuple[float, Dict[str, Any], Dict[str, Any]]] = []
        for entity in entity_candidates:
            claims = entity.get("claims") or {}
            label = (entity.get("labels") or {}).get("en", {}).get(
                "value"
            ) or normalized_name
            description = (entity.get("descriptions") or {}).get("en", {}).get(
                "value"
            ) or ""
            instance_ids = _extract_wikidata_item_ids(claims, "P31")
            occupation_labels = [
                label_map[item_id]
                for item_id in _extract_wikidata_item_ids(claims, "P106")
                if item_id in label_map
            ]
            employer_labels = [
                label_map[item_id]
                for item_id in _extract_wikidata_item_ids(claims, "P108")
                if item_id in label_map
            ]
            wiki_title = ((entity.get("sitelinks") or {}).get("enwiki") or {}).get(
                "title"
            )
            name_score = _text_similarity(normalized_name, label)
            organization_score = max(
                _token_overlap(organization, " ".join(employer_labels)),
                _token_overlap(organization, description),
            )
            occupation_score = (
                1.0
                if any(
                    keyword in " ".join(occupation_labels).lower()
                    for keyword in JOURNALISM_KEYWORDS
                )
                else 0.0
            )
            human_score = 1.0 if INSTANCE_HUMAN in instance_ids else 0.0
            context_score = _context_similarity(
                normalized_name, description, article_context
            )
            total_score = (
                name_score * 0.34
                + human_score * 0.22
                + occupation_score * 0.18
                + organization_score * 0.14
                + context_score * 0.12
            )
            metadata = {
                "qid": entity.get("id"),
                "label": label,
                "description": description,
                "occupations": occupation_labels,
                "employers": employer_labels,
                "education": [
                    label_map[item_id]
                    for item_id in _extract_wikidata_item_ids(claims, "P69")
                    if item_id in label_map
                ],
                "citizenships": [
                    label_map[item_id]
                    for item_id in _extract_wikidata_item_ids(claims, "P27")
                    if item_id in label_map
                ],
                "official_website": _extract_wikidata_url(claims, "P856"),
                "wiki_title": wiki_title,
                "scores": {
                    "name": round(name_score, 3),
                    "human": round(human_score, 3),
                    "occupation": round(occupation_score, 3),
                    "organization": round(organization_score, 3),
                    "context": round(context_score, 3),
                    "total": round(total_score, 3),
                },
            }
            scored.append((total_score, entity, metadata))

        if not scored:
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
                "search_links": {},
                "match_explanation": "Candidates were returned, but none exposed usable public facts.",
                "research_sources": ["wikidata_search", "wikidata_entities"],
                "research_confidence": "low",
            }

        scored.sort(key=lambda item: item[0], reverse=True)
        best_score, _, best_meta = scored[0]
        second_score = scored[1][0] if len(scored) > 1 else 0.0
        match_status = (
            "matched"
            if best_score >= 0.55 and (best_score - second_score) >= 0.08
            else "ambiguous"
        )
        summary = await _fetch_wikipedia_summary(client, best_meta.get("wiki_title"))
        wikipedia_url = cast(Optional[str], summary.get("url"))
        wikidata_url = (
            f"https://www.wikidata.org/wiki/{best_meta['qid']}"
            if best_meta.get("qid")
            else None
        )
        canonical_name = cast(
            str, summary.get("title") or best_meta.get("label") or normalized_name
        )
        overview = cast(
            Optional[str], summary.get("extract") or best_meta.get("description")
        )
        citation_urls = _unique_strings(
            [wikipedia_url, wikidata_url, best_meta.get("official_website")]
        )
        citations = [
            _citation(wikipedia_url, "Wikipedia lead")
            for wikipedia_url in ([wikipedia_url] if wikipedia_url else [])
        ] + [
            _citation(wikidata_url, "Wikidata item")
            for wikidata_url in ([wikidata_url] if wikidata_url else [])
        ]
        sections = _build_reporter_sections(
            canonical_name=canonical_name,
            match_explanation=(
                "Resolved via name, occupation, outlet overlap, and article context."
                if match_status == "matched"
                else "Multiple public candidates remained plausible after deterministic matching."
            ),
            summary=summary,
            occupations=best_meta["occupations"],
            employers=best_meta["employers"],
            education=best_meta["education"],
            citizenships=best_meta["citizenships"],
            official_website=cast(Optional[str], best_meta.get("official_website")),
            wikipedia_url=wikipedia_url,
            wikidata_url=wikidata_url,
        )
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
            "topics": best_meta["occupations"],
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
            "twitter_handle": None,
            "linkedin_url": None,
            "citizenships": best_meta["citizenships"],
            "official_website": best_meta.get("official_website"),
            "raw_match_scores": best_meta["scores"],
            "citation_urls": citation_urls,
        }
    finally:
        if owned_client:
            await client.aclose()


def build_source_sections(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    fields = cast(Dict[str, List[Dict[str, Any]]], profile.get("fields") or {})
    sections: List[Dict[str, Any]] = []
    section_map = [
        ("overview", "Overview", ("overview", "about", "official_website")),
        ("ownership", "Ownership", ("ownership", "affiliations")),
        ("funding", "Funding", ("funding", "nonprofit_filings")),
        (
            "public_records",
            "Public Records",
            ("founded", "headquarters", "public_records"),
        ),
    ]
    for section_id, title, keys in section_map:
        items = [
            entry for key in keys for entry in fields.get(key, []) if entry.get("value")
        ]
        sections.append(
            {
                "id": section_id,
                "title": title,
                "status": "available" if items else "missing",
                "items": items,
            }
        )
    return sections


async def build_source_profile(
    name: str, website: Optional[str] = None
) -> Dict[str, Any]:
    researcher = get_funding_researcher()
    org_data = await researcher.research_organization(name, website, use_ai=False)
    wikipedia_description = cast(
        Optional[str], (org_data.get("description") or "").strip() or None
    )
    official_website = cast(
        Optional[str],
        org_data.get("website") or org_data.get("official_website") or website,
    )
    official_pages: List[Dict[str, str]] = []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        if official_website:
            official_pages = await _try_fetch_site_pages(client, official_website)

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
    fields: Dict[str, List[Dict[str, Any]]] = {
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
    }

    if wikipedia_description:
        fields["overview"].append(
            {
                "label": "Wikipedia",
                "value": wikipedia_description,
                "sources": _unique_strings(
                    [cast(Optional[str], org_data.get("wikipedia_url"))]
                ),
            }
        )
    if about_page.get("summary"):
        fields["about"].append(
            {
                "label": "About page",
                "value": about_page["summary"],
                "sources": _unique_strings([about_page.get("url")]),
            }
        )
    for official_page in official_pages:
        label = official_page.get("label") or "page"
        summary = official_page.get("summary")
        url = official_page.get("url")
        if not summary or not url or label == "about":
            continue
        target_field = "public_records"
        if label == "ownership":
            target_field = "ownership"
        elif label == "editorial":
            target_field = "about"
        fields[target_field].append(
            {
                "label": label.replace("_", " ").title(),
                "value": summary,
                "sources": [url],
            }
        )
    if official_website:
        fields["official_website"].append(
            {
                "label": "Official website",
                "value": official_website,
                "sources": [official_website],
            }
        )
    if org_data.get("funding_type"):
        fields["funding"].append(
            {
                "label": "Funding type",
                "value": org_data["funding_type"],
                "sources": _unique_strings(
                    cast(List[Optional[str]], citation_candidates)
                ),
            }
        )
    for value in _unique_strings(
        [cast(Optional[str], org_data.get("parent_org"))]
        + cast(List[Optional[str]], org_data.get("owned_by") or [])
        + cast(List[Optional[str]], org_data.get("parent_orgs") or [])
    ):
        fields["ownership"].append(
            {
                "label": "Owner",
                "value": value,
                "sources": _unique_strings(
                    [
                        cast(Optional[str], org_data.get("wikidata_url")),
                        cast(Optional[str], org_data.get("wikipedia_url")),
                    ]
                ),
            }
        )
    for value in cast(List[str], org_data.get("part_of") or []):
        fields["affiliations"].append(
            {
                "label": "Affiliation",
                "value": value,
                "sources": _unique_strings(
                    [cast(Optional[str], org_data.get("wikidata_url"))]
                ),
            }
        )
    if org_data.get("inception"):
        fields["founded"].append(
            {
                "label": "Founded",
                "value": org_data["inception"],
                "sources": _unique_strings(
                    [cast(Optional[str], org_data.get("wikidata_url"))]
                ),
            }
        )
    for value in cast(List[str], org_data.get("headquarters") or []):
        fields["headquarters"].append(
            {
                "label": "Headquarters",
                "value": value,
                "sources": _unique_strings(
                    [cast(Optional[str], org_data.get("wikidata_url"))]
                ),
            }
        )
    if org_data.get("ein"):
        fields["nonprofit_filings"].append(
            {
                "label": "EIN",
                "value": str(org_data["ein"]),
                "sources": _unique_strings(
                    [
                        f"https://projects.propublica.org/nonprofits/organizations/{org_data['ein']}"
                    ]
                ),
            }
        )
    if org_data.get("annual_revenue"):
        fields["nonprofit_filings"].append(
            {
                "label": "Revenue",
                "value": str(org_data["annual_revenue"]),
                "sources": _unique_strings(
                    [
                        f"https://projects.propublica.org/nonprofits/organizations/{org_data['ein']}"
                    ]
                    if org_data.get("ein")
                    else []
                ),
            }
        )
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

    citations = [
        _citation(url, "Public source")
        for url in _unique_strings(cast(List[Optional[str]], citation_candidates))
    ]
    if org_data.get("ein"):
        citations.append(
            _citation(
                f"https://projects.propublica.org/nonprofits/organizations/{org_data['ein']}",
                "ProPublica Nonprofit Explorer",
            )
        )
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
        "overview": wikipedia_description or about_page.get("summary"),
        "wikipedia_url": org_data.get("wikipedia_url"),
        "wikidata_url": org_data.get("wikidata_url"),
        "wikidata_qid": org_data.get("wikidata_qid"),
        "citations": citations,
        "official_pages": official_pages,
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
            cast(List[Optional[str]], org_data.get("research_sources") or [])
        ),
        "key_reporters": [],
    }
    profile["dossier_sections"] = build_source_sections(profile)
    return profile
