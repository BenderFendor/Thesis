"""Funding Researcher Agent for Phase 5B.

This agent researches news organizations to understand:
- Ownership structure (parent companies, subsidiaries)
- Funding sources (commercial, public, non-profit, state-funded)
- Major donors and advertisers
- 990 filings for non-profits
- SEC filings for public companies

Uses a layered source strategy:
1. Wikipedia (organization info)
2. Media Bias/Fact Check (bias ratings, ownership)
3. LittleSis (power relationships, donors)
4. OpenSecrets (political connections)
5. ProPublica Nonprofit Explorer (990 data)
"""

import asyncio
import inspect
import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, cast
from urllib.parse import quote

import httpx
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.core.config import (
    get_llamacpp_model,
    get_openai_client,
    resolve_opencode_model,
    settings,
)
from app.core.logging import get_logger
from app.services.async_utils import gather_limited

logger = get_logger("funding_researcher")

# EDGAR User-Agent header — required by SEC; accepts email-only identity
_EDGAR_HEADERS: dict[str, str] = {
    "User-Agent": "Scoop Research (contact@example.com)",
    "Accept-Encoding": "gzip, deflate",
}

_external_semaphore = asyncio.Semaphore(5)

KNOWN_ORGS: dict[str, dict[str, Any]] = {
    "bbc": {
        "name": "BBC",
        "org_type": "public broadcaster",
        "funding_type": "public",
        "parent": None,
        "funding_sources": ["license fee", "government grant"],
        "description": "British Broadcasting Corporation, UK public broadcaster",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "cnn": {
        "name": "CNN",
        "org_type": "cable news channel",
        "funding_type": "commercial",
        "parent": "Warner Bros. Discovery",
        "description": "Cable News Network, American news channel",
        "media_bias_rating": "center-left",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "fox news": {
        "name": "Fox News",
        "funding_type": "commercial",
        "parent": "Fox Corporation",
        "description": "American conservative news channel",
        "media_bias_rating": "right",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "new york times": {
        "name": "The New York Times",
        "org_type": "publisher",
        "funding_type": "commercial",
        "parent": "The New York Times Company",
        "cik": "0000071691",
        "description": "American newspaper of record",
        "media_bias_rating": "center-left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "washington post": {
        "name": "The Washington Post",
        "funding_type": "commercial",
        "parent": "Nash Holdings (Jeff Bezos)",
        "description": "American newspaper based in Washington D.C.",
        "media_bias_rating": "center-left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "npr": {
        "name": "NPR",
        "org_type": "nonprofit",
        "funding_type": "non-profit",
        "parent": None,
        "funding_sources": ["corporate sponsorships", "member station dues", "grants"],
        "description": "National Public Radio, American non-profit media organization",
        "media_bias_rating": "center-left",
        "factual_reporting": "very-high",
        "confidence": "high",
    },
    "reuters": {
        "name": "Reuters",
        "funding_type": "commercial",
        "parent": "Thomson Reuters",
        "description": "International news organization",
        "media_bias_rating": "center",
        "factual_reporting": "very-high",
        "confidence": "high",
    },
    "associated press": {
        "name": "Associated Press",
        "funding_type": "non-profit",
        "parent": None,
        "description": "American non-profit news agency",
        "media_bias_rating": "center",
        "factual_reporting": "very-high",
        "confidence": "high",
    },
    "al jazeera": {
        "name": "Al Jazeera",
        "funding_type": "state-funded",
        "parent": "Al Jazeera Media Network (Qatar)",
        "description": "Qatari state-funded news network",
        "media_bias_rating": "center-left",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "rt": {
        "name": "RT (Russia Today)",
        "funding_type": "state-funded",
        "parent": "Russian Government",
        "description": "Russian state-controlled international news network",
        "media_bias_rating": "right",
        "factual_reporting": "very-low",
        "confidence": "high",
    },
    "abc news": {
        "name": "ABC News",
        "funding_type": "commercial",
        "parent": "The Walt Disney Company",
        "description": "American broadcast news division of ABC",
        "media_bias_rating": "center-left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "american spectator": {
        "name": "American Spectator",
        "funding_type": "non-profit",
        "parent": "American Spectator Foundation",
        "description": "Conservative American magazine (501(c)(3))",
        "media_bias_rating": "right",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "axios": {
        "name": "Axios",
        "funding_type": "commercial",
        "parent": "Cox Enterprises",
        "description": "American news website focused on business, politics, tech",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "big think": {
        "name": "Big Think",
        "funding_type": "commercial",
        "parent": "Freethink Media",
        "description": "Knowledge platform covering science, philosophy, innovation",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "bloomberg": {
        "name": "Bloomberg",
        "funding_type": "commercial",
        "parent": "Bloomberg L.P.",
        "description": "American financial, software, and media company",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "cbc": {
        "name": "CBC",
        "funding_type": "public",
        "parent": "Canadian Broadcasting Corporation",
        "description": "Canadian public broadcaster",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "hacker news": {
        "name": "Hacker News",
        "funding_type": "commercial",
        "parent": "Y Combinator",
        "description": "Social news site focused on computer science and entrepreneurship",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "ign": {
        "name": "IGN",
        "funding_type": "commercial",
        "parent": "Ziff Davis",
        "description": "American video game and entertainment media company",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "le monde": {
        "name": "Le Monde",
        "funding_type": "commercial",
        "parent": "Groupe Le Monde",
        "description": "French daily newspaper of record",
        "media_bias_rating": "center-left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "mother jones": {
        "name": "Mother Jones",
        "funding_type": "non-profit",
        "parent": "Foundation for National Progress",
        "description": "American non-profit investigative journalism magazine",
        "media_bias_rating": "left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "national geographic": {
        "name": "National Geographic",
        "org_type": "media brand",
        "funding_type": "commercial",
        "parent": "National Geographic Partners (Disney 73%)",
        "ownership_percentage": "73%",
        "description": "American magazine and media brand",
        "media_bias_rating": "center",
        "factual_reporting": "very-high",
        "confidence": "high",
    },
    "national post": {
        "name": "National Post",
        "funding_type": "commercial",
        "parent": "Postmedia Network",
        "description": "Canadian English-language newspaper",
        "media_bias_rating": "center-right",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "national review": {
        "name": "National Review",
        "funding_type": "non-profit",
        "parent": "National Review Institute",
        "description": "American conservative magazine (501(c)(3) since 2015)",
        "media_bias_rating": "right",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "realclearpolitics": {
        "name": "RealClearPolitics",
        "funding_type": "commercial",
        "parent": "Real Clear Holdings LLC",
        "description": "American political news aggregator",
        "media_bias_rating": "center-right",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "reason": {
        "name": "Reason",
        "funding_type": "non-profit",
        "parent": "Reason Foundation",
        "description": "American libertarian magazine (501(c)(3))",
        "media_bias_rating": "libertarian",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "the atlantic": {
        "name": "The Atlantic",
        "funding_type": "commercial",
        "parent": "Emerson Collective",
        "description": "American magazine covering politics, culture, international affairs",
        "media_bias_rating": "center-left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "the dispatch": {
        "name": "The Dispatch",
        "funding_type": "commercial",
        "parent": "Dispatch Media Inc.",
        "description": "American center-right digital media company",
        "media_bias_rating": "center-right",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "the economist": {
        "name": "The Economist",
        "funding_type": "commercial",
        "parent": "The Economist Group",
        "description": "British weekly international affairs newspaper",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "the guardian": {
        "name": "The Guardian",
        "funding_type": "trust-owned",
        "parent": "Scott Trust Limited",
        "description": "British daily newspaper owned by the Scott Trust",
        "media_bias_rating": "left",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "the nation": {
        "name": "The Nation",
        "funding_type": "commercial",
        "parent": "The Nation Company, L.P.",
        "description": "American progressive weekly magazine",
        "media_bias_rating": "left",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "variety": {
        "name": "Variety",
        "funding_type": "commercial",
        "parent": "Penske Media Corporation",
        "description": "American entertainment trade magazine",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "washington times": {
        "name": "Washington Times",
        "funding_type": "commercial",
        "parent": "Operations Holdings (Unification Church)",
        "description": "American daily newspaper",
        "media_bias_rating": "right",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "democracy now!": {
        "name": "Democracy Now!",
        "funding_type": "non-profit",
        "parent": "Democracy Now! Productions",
        "description": "American non-profit daily news program",
        "media_bias_rating": "left",
        "factual_reporting": "mixed",
        "confidence": "high",
    },
    "warner bros. discovery": {
        "name": "Warner Bros. Discovery",
        "org_type": "public company",
        "funding_type": "commercial",
        "description": "American multinational media conglomerate",
        "media_bias_rating": None,
        "confidence": "high",
    },
}


def normalize_organization_name(name: str) -> str:
    """Normalize an organization name for matching across public registries."""
    name = re.sub(
        r"\b(Inc|LLC|Corp|Corporation|Company|Co|Ltd|Limited)\b\.?",
        "",
        name,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", re.sub(r"[,.;:]+", " ", name.casefold())).strip()


class FundingResearcher:
    """Agent that researches news organization funding and ownership."""

    def __init__(self) -> None:
        """Initialize."""
        self.client: OpenAI | None = get_openai_client()
        self.http_client = httpx.AsyncClient(
            timeout=30.0,
            headers={
                "User-Agent": "ScoopNewsApp/1.0 (https://github.com/scoopnews; academic research project)",
            },
        )

        # ProPublica Nonprofit Explorer API (free, no key needed)
        self.propublica_base = "https://projects.propublica.org/nonprofits/api/v2"

    async def research_organization(
        self, name: str, website: str | None = None, use_ai: bool = False
    ) -> dict[str, Any]:
        """Research an organization's funding and ownership.

        Args:
            name: Organization name
            website: Optional website URL
            use_ai: Opt in to non-authoritative narrative enrichment

        Returns:
            Organization data dict with ownership, funding, etc.
        """
        logger.info(f"Researching organization: {name}")

        normalized_name = self._normalize_name(name)

        domain = self._extract_domain_from_url(website) if website else None

        # Gather data from multiple sources in parallel
        results = await gather_limited(
            [
                self._search_wikipedia(name),
                self._search_propublica_nonprofit(name),
                self._get_known_org_data(name),
                self._search_sec_edgar(name),
                self._resolve_org_wikidata_sparql(name, domain),
            ],
            limit=3,
            return_exceptions=True,
        )

        wikipedia_data: dict[str, Any] = (
            results[0] if not isinstance(results[0], BaseException) else {}
        )
        nonprofit_data: dict[str, Any] = (
            results[1] if not isinstance(results[1], BaseException) else {}
        )
        known_data: dict[str, Any] = results[2] if not isinstance(results[2], BaseException) else {}
        sec_data: dict[str, Any] = results[3] if not isinstance(results[3], BaseException) else {}
        wikidata_sparql: dict[str, Any] = (
            results[4] if not isinstance(results[4], BaseException) else {}
        )

        if inspect.isawaitable(wikipedia_data):
            wikipedia_data = await wikipedia_data
        if inspect.isawaitable(nonprofit_data):
            nonprofit_data = await nonprofit_data
        if inspect.isawaitable(known_data):
            known_data = await known_data
        if inspect.isawaitable(sec_data):
            sec_data = await sec_data
        if inspect.isawaitable(wikidata_sparql):
            wikidata_sparql = await wikidata_sparql

        wikidata_data = await self._fetch_wikidata(wikipedia_data.get("page_title") or name)

        # Merge with priority
        org_data = self._merge_org_data(
            name=name,
            normalized_name=normalized_name,
            website=website,
            wikipedia=wikipedia_data,
            wikidata=wikidata_data,
            nonprofit=nonprofit_data,
            known=known_data,
            sec=sec_data,
            wikidata_sparql=wikidata_sparql,
        )

        # Use AI to synthesize
        if self.client and use_ai:
            org_data = await self._ai_enhance_org_data(org_data)

        org_data["last_researched_at"] = datetime.now(UTC).isoformat()

        return org_data

    def _normalize_name(self, name: str) -> str:
        """Retain the existing instance-level normalization interface."""
        return normalize_organization_name(name)

    @staticmethod
    def _name_overlap(a: str, b: str) -> float:
        """Word-level Jaccard similarity between two names."""
        words_a = set(a.split())
        words_b = set(b.split())
        if not words_a or not words_b:
            return 0.0
        overlap = len(words_a & words_b)
        union_size = len(words_a) + len(words_b) - overlap
        if union_size <= 0:
            return 0.0
        return overlap / union_size

    def _propublica_name_matches(self, query: str, candidate: str) -> bool:
        """Return true when a ProPublica result is a credible org-name match."""
        normalized_query = self._normalize_name(query)
        normalized_candidate = self._normalize_name(candidate)
        if not normalized_query or not normalized_candidate:
            return False

        if normalized_query == normalized_candidate:
            return True

        query_tokens = normalized_query.split()
        candidate_tokens = normalized_candidate.split()
        if len(query_tokens) == 1:
            raw_query = re.sub(r"[^A-Za-z]", "", query)
            is_acronym = raw_query.isupper() and 2 <= len(raw_query) <= 4
            return is_acronym and bool(candidate_tokens) and candidate_tokens[0] == query_tokens[0]

        return (
            normalized_query in normalized_candidate
            or normalized_candidate in normalized_query
            or self._name_overlap(normalized_query, normalized_candidate) >= 0.5
        )

    async def _search_wikipedia(self, name: str) -> dict[str, Any]:
        """Search Wikipedia for organization information."""
        try:
            search_query = f"{name} news organization"
            url = "https://en.wikipedia.org/w/api.php"
            params = httpx.QueryParams(
                {
                    "action": "query",
                    "list": "search",
                    "srsearch": search_query,
                    "format": "json",
                    "srlimit": 3,
                }
            )

            async with _external_semaphore:
                response = await self.http_client.get(url, params=params)
            if response.status_code != 200:
                return {}

            data = response.json()
            search_results = data.get("query", {}).get("search", [])

            if not search_results:
                return {}

            normalized_name = self._normalize_name(name)
            page_title = next(
                (
                    result["title"]
                    for result in search_results
                    if self._normalize_name(result.get("title", "")) == normalized_name
                ),
                search_results[0]["title"],
            )
            extract_params = httpx.QueryParams(
                {
                    "action": "query",
                    "titles": page_title,
                    "prop": "extracts|info",
                    "exintro": True,
                    "explaintext": True,
                    "format": "json",
                    "inprop": "url",
                }
            )

            async with _external_semaphore:
                extract_response = await self.http_client.get(url, params=extract_params)
            if extract_response.status_code != 200:
                return {}

            extract_data = extract_response.json()
            pages = extract_data.get("query", {}).get("pages", {})

            for page_id, page_info in pages.items():
                if page_id == "-1":
                    continue

                extract = page_info.get("extract", "")

                # Try to extract ownership info from text
                ownership_info = self._extract_ownership_from_text(extract)

                return {
                    "source": "wikipedia",
                    "title": page_info.get("title"),
                    "description": extract[:500],
                    "recent_ownership_changes": self._extract_ownership_changes(extract),
                    "url": page_info.get("fullurl"),
                    "ownership": ownership_info,
                    "page_title": page_info.get("title"),
                    "confidence": "high",
                }

            return {}

        except Exception as e:
            logger.error(f"Wikipedia search failed for {name}: {e}")
            return {}

    def _extract_ownership_from_text(self, text: str) -> dict[str, Any] | None:
        """Extract ownership information from Wikipedia text."""
        ownership = {}
        lower_text = text.lower()

        # Common patterns for ownership
        patterns = [
            r"owned by ([A-Z][A-Za-z\s&]+)",
            r"subsidiary of ([A-Z][A-Za-z\s&]+)",
            r"parent company (?:is )?([A-Z][A-Za-z\s&]+)",
            r"acquired by ([A-Z][A-Za-z\s&]+)",
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                ownership["parent"] = match.group(1).strip()
                break

        # Look for funding type indicators
        if "non-profit" in lower_text or "nonprofit" in lower_text:
            ownership["funding_type"] = "non-profit"
        elif "public broadcasting" in lower_text:
            ownership["funding_type"] = "public"
        elif "state-owned" in lower_text or "government-funded" in lower_text:
            ownership["funding_type"] = "state-funded"

        return ownership if ownership else None

    @staticmethod
    def _extract_ownership_changes(text: str) -> str | None:
        """Extract source-grounded merger and acquisition sentences."""
        keywords = (
            "acquired",
            "acquisition",
            "agreed to be sold",
            "merged",
            "merger",
            "spin-off",
            "spun off",
        )
        sentences = re.split(r"(?<=[.!?])\s+", text)
        matches = [
            sentence.strip()
            for sentence in sentences
            if any(keyword in sentence.casefold() for keyword in keywords)
        ]
        return " ".join(matches[:3]) or None

    async def _search_propublica_nonprofit(self, name: str) -> dict[str, Any]:
        """Search ProPublica Nonprofit Explorer for 990 data."""
        try:
            search_url = f"{self.propublica_base}/search.json"
            params = httpx.QueryParams({"q": name})

            async with _external_semaphore:
                response = await self.http_client.get(search_url, params=params)
            if response.status_code != 200:
                return {}

            data = response.json()
            organizations = data.get("organizations", [])

            if not organizations:
                return {}

            # Find the best match by name similarity
            org = None
            for candidate in organizations:
                candidate_name = candidate.get("name") or ""
                if self._propublica_name_matches(name, candidate_name):
                    org = candidate
                    break

            if not org:
                logger.debug(
                    "ProPublica: no name match for '%s' in results: %s",
                    name,
                    [c.get("name") for c in organizations[:3]],
                )
                return {}

            ein = org.get("ein")
            if ein is not None:
                ein = str(ein)

            if not ein:
                return {}

            # Get detailed org data including 990 filings
            org_url = f"{self.propublica_base}/organizations/{ein}.json"
            async with _external_semaphore:
                org_response = await self.http_client.get(org_url)

            if org_response.status_code != 200:
                return {
                    "source": "propublica",
                    "ein": ein,
                    "name": org.get("name"),
                    "confidence": "medium",
                }

            org_data = org_response.json()
            org_info = org_data.get("organization", {})
            filings = org_data.get("filings_with_data", [])

            latest_filing = filings[0] if filings else {}

            return {
                "source": "propublica",
                "ein": ein,
                "name": org_info.get("name"),
                "funding_type": "non-profit",
                "annual_revenue": str(latest_filing.get("totrevenue", "")),
                "total_assets": str(latest_filing.get("totassetsend", "")),
                "tax_period": latest_filing.get("tax_prd_yr"),
                "subsection": org_info.get("subsection_code"),  # 501c type
                "confidence": "high",
            }

        except Exception as e:
            logger.error(f"ProPublica search failed for {name}: {e}")
            return {}

    async def _fetch_wikidata(self, page_title: str) -> dict[str, Any]:
        """Fetch structured ownership and metadata from Wikidata."""
        try:
            params = httpx.QueryParams(
                {
                    "action": "wbgetentities",
                    "sites": "enwiki",
                    "titles": page_title,
                    "props": "claims|labels|descriptions|sitelinks",
                    "format": "json",
                    "formatversion": 2,
                    "languages": "en",
                }
            )
            async with _external_semaphore:
                response = await self.http_client.get(
                    "https://www.wikidata.org/w/api.php", params=params
                )
            if response.status_code != 200:
                return {}
            data = response.json()
            entities = data.get("entities")
            if not entities:
                return {}
            # Wikidata returns entities as a dict keyed by QID
            if isinstance(entities, dict):
                entity = next(iter(entities.values()), None)
            else:
                entity = entities[0] if entities else None
            if not entity or not isinstance(entity, dict):
                return {}
            claims = entity.get("claims") or {}
            relations = _collect_wikidata_relations(claims)
            labels = await self._resolve_wikidata_labels(
                relations["ownership_ids"]
                + relations["parent_ids"]
                + relations["part_of_ids"]
                + relations["headquarters_ids"]
                + relations["subsidiary_ids"]
                + relations["org_type_ids"]
            )
            return _build_wikidata_payload(entity.get("id"), labels, claims, relations)
        except Exception as exc:
            logger.warning("Wikidata fetch failed for %s: %s", page_title, exc)
            return {}

    async def _resolve_wikidata_labels(self, item_ids: list[str]) -> dict[str, str]:
        if not item_ids:
            return {}
        unique_ids = sorted({item_id for item_id in item_ids if item_id})
        if not unique_ids:
            return {}
        params = httpx.QueryParams(
            {
                "action": "wbgetentities",
                "ids": "|".join(unique_ids),
                "props": "labels",
                "format": "json",
                "languages": "en",
                "formatversion": 2,
            }
        )
        async with _external_semaphore:
            response = await self.http_client.get(
                "https://www.wikidata.org/w/api.php", params=params
            )
        if response.status_code != 200:
            return {}
        data = response.json()
        labels: dict[str, str] = {}
        entities = data.get("entities")
        if not entities:
            return labels
        # Wikidata returns entities as a dict keyed by QID
        entity_values = entities.values() if isinstance(entities, dict) else entities
        for entity in entity_values:
            if not isinstance(entity, dict):
                continue
            entity_id = entity.get("id")
            label = (entity.get("labels") or {}).get("en", {}).get("value")
            if entity_id and label:
                labels[entity_id] = label
        return labels

    async def _get_known_org_data(self, name: str) -> dict[str, Any]:
        """Return known data for major news organizations."""
        normalized = self._normalize_name(name)

        for key, data in KNOWN_ORGS.items():
            if self._normalize_name(key) == normalized:
                return {"source": "known_data", **data}

        return {}

    def _merge_org_data(
        self,
        name: str,
        normalized_name: str,
        website: str | None,
        wikipedia: dict[str, Any],
        wikidata: dict[str, Any],
        nonprofit: dict[str, Any],
        known: dict[str, Any],
        sec: dict[str, Any] | None = None,
        wikidata_sparql: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Merge data from multiple sources."""
        org: dict[str, Any] = {
            "name": name,
            "normalized_name": normalized_name,
            "description": None,
            "org_type": None,
            "parent_org": None,
            "ownership_percentage": None,
            "recent_ownership_changes": None,
            "funding_type": None,
            "funding_sources": [],
            "major_advertisers": [],
            "ein": None,
            "annual_revenue": None,
            "top_donors": [],
            "media_bias_rating": None,
            "factual_reporting": None,
            "website": website,
            "wikidata_url": None,
            "wikidata_qid": None,
            "owned_by": [],
            "parent_orgs": [],
            "part_of": [],
            "headquarters": [],
            "inception": None,
            "official_website": None,
            "subsidiaries": [],
            "wikipedia_url": None,
            "littlesis_url": None,
            "opensecrets_url": None,
            "cik": None,
            "opensecrets_data": {},
            "conflict_flags": [],
            "research_sources": [],
            "research_confidence": "low",
        }

        _merge_known_data(org, known)
        _merge_wikipedia_data(org, wikipedia)
        _merge_wikidata_data(org, wikidata)
        _merge_wikidata_sparql_data(org, wikidata_sparql)
        _merge_nonprofit_data(org, nonprofit)
        _merge_sec_data(org, sec)

        return org

    @staticmethod
    def _extract_domain_from_url(url: str) -> str | None:
        """Extract domain name from a URL."""
        match = re.search(r"https?://([^/:]+)", url)
        if match:
            return match.group(1).lower()
        return None

    async def _resolve_cik(self, name: str) -> str | None:
        """Resolve a company name to an SEC Central Index Key (CIK).

        Uses the SEC EDGAR company mapping file.
        """
        try:
            url = "https://www.sec.gov/files/company_tickers.json"
            async with _external_semaphore:
                response = await self.http_client.get(url, headers=_EDGAR_HEADERS)
            if response.status_code != 200:
                logger.warning("SEC company_tickers returned %d", response.status_code)
                return None

            data = response.json()
            normalized_name = self._normalize_name(name)

            # Exact match first
            for _key, entry in data.items():
                entry_name = (entry.get("title") or "").lower().strip()
                if normalized_name == self._normalize_name(entry_name):
                    cik_str = str(entry.get("cik_str", ""))
                    return cik_str.zfill(10)

            # Fuzzy name-overlap match
            best_score = 0.0
            best_cik: str | None = None
            for _key, entry in data.items():
                entry_name = (entry.get("title") or "").lower().strip()
                norm_entry = self._normalize_name(entry_name)
                score = self._name_overlap(normalized_name, norm_entry)
                if score > 0.7 and score > best_score:
                    best_score = score
                    cik_str = str(entry.get("cik_str", ""))
                    best_cik = cik_str.zfill(10)

            return best_cik

        except Exception as e:
            logger.warning("CIK resolution failed for %s: %s", name, e)
            return None

    async def _search_sec_edgar(self, name: str) -> dict[str, Any]:
        """Search SEC EDGAR for company financial data.

        Uses the EDGAR full-text search and falls back to Company Facts API.
        """
        try:
            cik = await self._resolve_cik(name)
            if not cik:
                return {}

            sec_data: dict[str, Any] = {
                "source": "sec_edgar",
                "cik": cik,
                "confidence": "medium",
            }

            submissions_url = f"https://data.sec.gov/submissions/CIK{cik}.json"
            async with _external_semaphore:
                submissions_response = await self.http_client.get(
                    submissions_url, headers=_EDGAR_HEADERS
                )
            if submissions_response.status_code == 200:
                submissions = submissions_response.json()
                sec_data["ein"] = submissions.get("ein")
                sec_data["sic_description"] = submissions.get("sicDescription")
                sec_data["tickers"] = submissions.get("tickers") or []
                sec_data["exchanges"] = submissions.get("exchanges") or []
                sec_data["confidence"] = "high"

            facts_url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
            async with _external_semaphore:
                facts_response = await self.http_client.get(facts_url, headers=_EDGAR_HEADERS)
            if facts_response.status_code == 200:
                facts = facts_response.json()
                facts_data = facts.get("facts", {})
                us_gaap = facts_data.get("us-gaap", {})

                def _latest_fact_value(tag: str) -> str | None:
                    """Return the latest annual (10-K) fact value for a GAAP tag.

                    Selects the latest reporting period, then the latest filed
                    revision for that period. A single 10-K repeats prior-year
                    comparatives with the current fiscal-year label.
                    """
                    tag_data = us_gaap.get(tag, {})
                    units = tag_data.get("units", {})
                    usd_entries = units.get("USD", [])
                    if not usd_entries:
                        return None
                    # Filter to 10-K filings only (annual)
                    annual = [e for e in usd_entries if e.get("form") == "10-K"]
                    if not annual:
                        annual = usd_entries
                    entries_with_period = [entry for entry in annual if entry.get("end")]
                    candidates = entries_with_period or annual
                    latest = max(
                        candidates,
                        key=lambda entry: (
                            str(entry.get("end") or ""),
                            str(entry.get("filed") or ""),
                        ),
                    )
                    value = latest.get("val")
                    return str(value) if value is not None else None

                # Probe revenue tags in priority order (ASC 606 first)
                revenue = (
                    _latest_fact_value("RevenueFromContractWithCustomerExcludingAssessedTax")
                    or _latest_fact_value("Revenues")
                    or _latest_fact_value("SalesRevenueNet")
                )
                sec_data["revenue"] = revenue
                sec_data["total_assets"] = _latest_fact_value("Assets")
                sec_data["confidence"] = "high"

            if len(sec_data) > 3:
                return sec_data

            query = quote(name)
            search_url = (
                f"https://efts.sec.gov/LATEST/search-index?q={query}&categories=form-type=10-K"
            )
            async with _external_semaphore:
                search_response = await self.http_client.get(search_url, headers=_EDGAR_HEADERS)
            if search_response.status_code == 200:
                search_data = search_response.json()
                if search_data.get("hits", {}).get("hits", []):
                    return sec_data

            return {}

        except Exception as e:
            logger.warning("SEC EDGAR search failed for %s: %s", name, e)
            return {}

    async def _resolve_org_wikidata_sparql(
        self, name: str, domain: str | None = None
    ) -> dict[str, Any]:
        """Resolve an organization via Wikidata using wbsearchentities and SPARQL.

        Searches for entities with instance types: newspaper (Q11032),
        magazine (Q192283), TV station (Q5296), website (Q35127), etc.
        """
        try:
            # Step 1: wbsearchentities
            search_url = "https://www.wikidata.org/w/api.php"
            search_params = httpx.QueryParams(
                {
                    "action": "wbsearchentities",
                    "search": name,
                    "language": "en",
                    "format": "json",
                    "limit": 3,
                    "type": "item",
                }
            )
            async with _external_semaphore:
                search_response = await self.http_client.get(search_url, params=search_params)
            if search_response.status_code == 200:
                search_data = search_response.json()
                hits = search_data.get("search", [])
                for hit in hits:
                    hit_label = (hit.get("label") or "").lower()
                    if (
                        self._name_overlap(
                            self._normalize_name(name), self._normalize_name(hit_label)
                        )
                        >= 0.5
                    ):
                        qid = hit.get("id")
                        if qid:
                            return await self._fetch_wikidata_by_qid(qid)

            # Step 2: SPARQL query by name with org instance types
            org_types = [
                "wd:Q11032",  # newspaper
                "wd:Q192283",  # magazine
                "wd:Q5296",  # TV station
                "wd:Q35127",  # website
                "wd:Q5633421",  # publisher
                "wd:Q16735862",  # media company
                "wd:Q43229",  # organization
            ]
            types_clause = " ".join(org_types)
            sparql_query = f"""
            SELECT ?item ?itemLabel WHERE {{
              SERVICE wikibase:mwapi {{
                bd:serviceParam wikibase:api "EntitySearch".
                bd:serviceParam wikibase:endpoint "www.wikidata.org".
                bd:serviceParam mwapi:search "{name}".
                bd:serviceParam mwapi:language "en".
                ?item wikibase:apiOutputItem mwapi:item.
              }}
              ?item wdt:P31 ?org_type.
              VALUES ?org_type {{ {types_clause} }}
              SERVICE wikibase:label {{
                bd:serviceParam wikibase:language "en".
              }}
            }}
            LIMIT 5
            """
            sparql_params = httpx.QueryParams({"format": "json", "query": sparql_query})
            async with _external_semaphore:
                sparql_response = await self.http_client.get(
                    "https://query.wikidata.org/sparql", params=sparql_params
                )
            if sparql_response.status_code == 200:
                sparql_data = sparql_response.json()
                bindings = sparql_data.get("results", {}).get("bindings", [])
                for binding in bindings:
                    item_url = binding.get("item", {}).get("value", "")
                    qid = item_url.split("/")[-1] if item_url else None
                    if qid:
                        return await self._fetch_wikidata_by_qid(qid)

        except Exception as e:
            logger.warning("Wikidata SPARQL org resolution failed: %s", e)

        return {}

    async def _fetch_wikidata_by_qid(self, qid: str) -> dict[str, Any]:
        """Fetch Wikidata claims and labels for a known QID."""
        try:
            params = httpx.QueryParams(
                {
                    "action": "wbgetentities",
                    "ids": qid,
                    "props": "claims|labels|descriptions|sitelinks",
                    "format": "json",
                    "formatversion": 2,
                    "languages": "en",
                }
            )
            async with _external_semaphore:
                response = await self.http_client.get(
                    "https://www.wikidata.org/w/api.php", params=params
                )
            if response.status_code != 200:
                return {}
            raw_response_text = response.text
            data = response.json()
            entities = data.get("entities", {})
            entity = entities.get(qid) if isinstance(entities, dict) else None
            if not entity or not isinstance(entity, dict):
                return {}
            claims = entity.get("claims") or {}
            relations = _collect_wikidata_relations(claims, include_people=True)
            labels = await self._resolve_wikidata_labels(
                relations["ownership_ids"]
                + relations["parent_ids"]
                + relations["part_of_ids"]
                + relations["headquarters_ids"]
                + relations["founder_ids"]
                + relations["ceo_ids"]
                + relations["subsidiary_ids"]
                + relations["owned_proportion_ids"]
                + relations["parent_proportion_ids"]
                + relations["org_type_ids"]
            )
            payload = _build_wikidata_payload(qid, labels, claims, relations, include_details=True)
            payload["raw_response_text"] = raw_response_text
            return payload
        except Exception as exc:
            logger.warning("Wikidata fetch by QID %s failed: %s", qid, exc)
            return {}

    async def detect_conflicts(
        self,
        source_name: str,
        parent_org: str | None,
        coverage_topics: list[str],
    ) -> list[dict[str, Any]]:
        """Detect conflicts of interest between ownership and coverage.

        Cross-references parent company business interests (from SEC EDGAR
        segments + Wikidata industry codes) with the source's top coverage
        topics to flag potential conflicts.

        Returns a list of conflict flags with severity.
        """
        conflicts: list[dict[str, Any]] = []
        if not parent_org or not coverage_topics:
            return conflicts

        # Get parent company business interests
        parent_data = await self.research_organization(parent_org, use_ai=False)
        owned_by = parent_data.get("owned_by", []) or []
        parent_orgs = parent_data.get("parent_orgs", []) or []
        business_interests: set[str] = set()

        # Gather all ownership labels as potential business interest strings
        for item in owned_by + parent_orgs + [parent_org]:
            if isinstance(item, str):
                business_interests.add(item.lower())

        # Known conflict keywords mapping
        conflict_keywords: dict[str, str] = {
            "oil": "energy",
            "gas": "energy",
            "petroleum": "energy",
            "defense": "defense",
            "military": "defense",
            "pharma": "pharmaceuticals",
            "pharmaceutical": "pharmaceuticals",
            "bank": "finance",
            "finance": "finance",
            "telecom": "telecommunications",
            "media": "media",
            "insurance": "insurance",
            "healthcare": "healthcare",
            "tech": "technology",
            "technology": "technology",
            "real estate": "real estate",
            "retail": "retail",
        }

        for topic in coverage_topics:
            topic_lower = topic.lower()
            for interest in business_interests:
                for kw, _sector in conflict_keywords.items():
                    if kw in interest and kw in topic_lower:
                        conflicts.append(
                            {
                                "topic": topic,
                                "business_interest": interest,
                                "severity": "high",
                                "evidence": (
                                    f"Source covers '{topic}' and parent "
                                    f"'{interest}' operates in the same sector."
                                ),
                            }
                        )
                        break

        return conflicts

    async def _ai_enhance_org_data(self, org: dict[str, Any]) -> dict[str, Any]:
        """Use AI to fill gaps in organization data with expanded research.

        Cross-checks KNOWN_ORGS data for staleness and requesting richer
        funding transparency fields.
        """
        if not self.client:
            return org

        org_name = org["name"]
        known_key = self._normalize_name(org_name)

        # Staleness check: cross-reference KNOWN_ORGS against LLM knowledge
        staleness_flags = _collect_staleness_flags(self.client, org_name, known_key)

        try:
            missing_fields = [
                field
                for field in (
                    "org_type",
                    "parent_org",
                    "ownership_percentage",
                    "funding_type",
                    "annual_revenue",
                    "media_bias_rating",
                    "factual_reporting",
                )
                if not org.get(field)
            ]
            if not missing_fields and not staleness_flags:
                return org

            missing_desc = ", ".join(missing_fields) if missing_fields else "staleness validation"
            staleness_note = " ".join(staleness_flags) if staleness_flags else ""

            prompt = f"""You are a media research assistant analyzing a news organization.

Organization: {org_name}
Known Data:
- Funding Type: {org.get("funding_type", "Unknown")}
- Parent Organization: {org.get("parent_org", "Unknown")}
- Bias Rating: {org.get("media_bias_rating", "Unknown")}
- Factual Reporting: {org.get("factual_reporting", "Unknown")}
- Annual Revenue: {org.get("annual_revenue", "Unknown")}
- Current Source Description: {org.get("description", "Unknown")}

{staleness_note}

Based on your knowledge, fill these missing or uncertain fields: {missing_desc}.
Use only relationships completed as of today for parent_org and
ownership_percentage. Put pending or proposed transactions only in
recent_ownership_changes. Return null or an empty list when a value is not
publicly supported. Do not guess advertiser names, donors, or ownership stakes.

Provide:
1. Organization type (publisher, media conglomerate, parent company, nonprofit, public broadcaster, or state media)
2. Funding type (commercial, public, non-profit, state-funded, independent, trust-owned)
3. Current parent or controlling owner and ownership percentage
4. Material funding sources or revenue streams
5. General media bias and factual-reporting rating
6. Estimated annual revenue range and source hint
7. Publicly documented major donors or grant funders
8. Publicly documented major advertisers
9. Recent ownership changes in the last five years
10. Funding transparency and paywall status

Respond in JSON:
{{
  "org_type": "media conglomerate",
  "funding_type": "commercial",
  "funding_sources": ["advertising", "subscriptions"],
  "parent_org": "Current Parent Company" or null,
  "ownership_percentage": "100%" or null,
  "media_bias_rating": "center",
  "factual_reporting": "high",
  "estimated_revenue": "e.g. $50M-$100M",
  "revenue_citation": "e.g. 2025 annual report",
  "major_donors": [],
  "major_advertisers": [],
  "recent_ownership_changes": "Description or null",
  "funding_transparency": "transparent",
  "has_paywall": false,
  "notes": "Brief explanation"
}}"""

            response = self.client.chat.completions.create(
                model=(
                    get_llamacpp_model()
                    if settings.llm_backend == "llamacpp"
                    else resolve_opencode_model(settings.open_router_model)
                ),
                messages=cast(
                    Iterable[ChatCompletionMessageParam],
                    [{"role": "user", "content": prompt}],
                ),
                max_tokens=1200,
                temperature=0.1,
                response_format={"type": "json_object"},
            )

            content = response.choices[0].message.content
            if not content:
                logger.warning(f"AI returned empty content for org {org_name}")
                return org
            json_match = re.search(r"\{[\s\S]*?\}", content, re.DOTALL)

            if json_match:
                ai_data = json.loads(json_match.group())
                _apply_ai_enhancements(org, ai_data)
            else:
                logger.warning("AI returned no JSON object for org %s", org_name)

        except json.JSONDecodeError as e:
            logger.error("Failed to parse AI enhancement JSON for %s: %s", org_name, e)
        except Exception as e:
            logger.error("AI enhancement failed for org %s: %s", org_name, e)

        return org

    async def get_ownership_chain(self, org_name: str, max_depth: int = 5) -> list[dict[str, Any]]:
        """Build an ownership chain for an organization.

        Returns a list of organizations from child to ultimate parent.
        """
        chain = []
        current_name = org_name
        visited = set()

        for _ in range(max_depth):
            if current_name.lower() in visited:
                break
            visited.add(current_name.lower())

            org_data = await self.research_organization(current_name)
            chain.append(org_data)

            parent = org_data.get("parent_org")
            if not parent:
                break

            current_name = parent

        return chain

    async def close(self) -> None:
        """Close HTTP client."""
        await self.http_client.aclose()


# Singleton instance
_researcher: FundingResearcher | None = None


def get_funding_researcher() -> FundingResearcher:
    """Get or create the FundingResearcher singleton."""
    global _researcher
    if _researcher is None:
        _researcher = FundingResearcher()
    return _researcher


def _extract_wikidata_item_ids(claims: dict[str, Any], prop: str) -> list[str]:
    items: list[str] = []
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value") or {}
        if isinstance(value, dict):
            item_id = value.get("id")
            if item_id:
                items.append(item_id)
    return items


def _extract_wikidata_time(claims: dict[str, Any], prop: str) -> str | None:
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value") or {}
        if isinstance(value, dict):
            time_value = value.get("time")
            if isinstance(time_value, str):
                return time_value
    return None


def _extract_wikidata_url(claims: dict[str, Any], prop: str) -> str | None:
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value")
        if isinstance(value, str):
            return value
    return None


def _select_organization_type(org_types: list[str]) -> str | None:
    """Select the most specific deterministic organization classification."""
    priorities = (
        "public company",
        "private company",
        "nonprofit organization",
        "non-profit organization",
        "state-owned enterprise",
        "public broadcaster",
        "media conglomerate",
        "media company",
        "publisher",
        "organization",
        "business",
        "enterprise",
    )
    by_casefold = {value.casefold(): value for value in org_types}
    for priority in priorities:
        if priority in by_casefold:
            return by_casefold[priority]
    return org_types[0] if org_types else None


def _format_wikidata_proportion(amount: object) -> str | None:
    """Convert Wikidata's decimal P1107 quantity into a display percentage."""
    try:
        proportion = Decimal(str(amount))
    except (InvalidOperation, ValueError):
        return None
    if not proportion.is_finite():
        return None
    percentage = proportion * 100 if proportion <= 1 else proportion
    if percentage < 0 or percentage > 100:
        return None
    formatted = format(percentage.normalize(), "f")
    return f"{formatted}%"


def _extract_wikidata_items_with_proportion(
    claims: dict[str, Any], prop: str
) -> list[tuple[str, str | None]]:
    """Extract (item_id, proportion) pairs from a Wikidata claim property.

    Reads the proportion qualifier (P1107) on each statement to determine
    ownership or voting percentage. Returns None for proportion when no
    qualifier is present or the qualifier value is not numeric.
    """
    results: list[tuple[str, str | None]] = []
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value") or {}
        if not isinstance(value, dict):
            continue
        item_id = value.get("id")
        if not item_id:
            continue

        # Check qualifiers for proportion (P1107)
        proportion: str | None = None
        qualifiers = claim.get("qualifiers") or {}
        for qual_claim in qualifiers.get("P1107", []):
            qual_snak = qual_claim.get("datavalue") or {}
            qual_value = qual_snak.get("value")
            if isinstance(qual_value, dict):
                proportion = _format_wikidata_proportion(qual_value.get("amount"))
            elif isinstance(qual_value, (int, float, str)):
                proportion = _format_wikidata_proportion(qual_value)
        results.append((item_id, proportion))
    return results


def _collect_wikidata_relations(
    claims: dict[str, Any], *, include_people: bool = False
) -> dict[str, Any]:
    """Collect item ids and proportion pairs for the Wikidata relation properties."""
    ownership_ids = _extract_wikidata_item_ids(claims, "P127")
    parent_ids = _extract_wikidata_item_ids(claims, "P749")
    part_of_ids = _extract_wikidata_item_ids(claims, "P361")
    headquarters_ids = _extract_wikidata_item_ids(claims, "P159")
    subsidiary_ids = _extract_wikidata_item_ids(claims, "P355")
    org_type_ids = _extract_wikidata_item_ids(claims, "P1454")
    org_type_ids += _extract_wikidata_item_ids(claims, "P31")
    owned_with_proportion = _extract_wikidata_items_with_proportion(claims, "P127")
    parent_with_proportion = _extract_wikidata_items_with_proportion(claims, "P749")
    return {
        "ownership_ids": ownership_ids,
        "parent_ids": parent_ids,
        "part_of_ids": part_of_ids,
        "headquarters_ids": headquarters_ids,
        "subsidiary_ids": subsidiary_ids,
        "org_type_ids": org_type_ids,
        "owned_with_proportion": owned_with_proportion,
        "parent_with_proportion": parent_with_proportion,
        "owned_proportion_ids": [iid for iid, _pct in owned_with_proportion],
        "parent_proportion_ids": [iid for iid, _pct in parent_with_proportion],
        "founder_ids": (_extract_wikidata_item_ids(claims, "P112") if include_people else []),
        "ceo_ids": _extract_wikidata_item_ids(claims, "P169") if include_people else [],
    }


def _labels_for_ids(labels: dict[str, str], item_ids: list[str]) -> list[str]:
    """Resolve item ids to labels, preserving order and dropping unknown ids."""
    return [label for item_id in item_ids if (label := labels.get(item_id))]


def _label_proportion_pairs(
    labels: dict[str, str], pairs: list[tuple[str, str | None]]
) -> list[tuple[str, str | None]]:
    """Resolve proportion pairs to (label, proportion), dropping unknown ids."""
    return [(label, pct) for item_id, pct in pairs if (label := labels.get(item_id))]


def _build_wikidata_payload(
    qid: str | None,
    labels: dict[str, str],
    claims: dict[str, Any],
    relations: dict[str, Any],
    *,
    include_details: bool = False,
) -> dict[str, Any]:
    """Build a Wikidata result payload from collected relation ids and labels."""
    payload: dict[str, Any] = {
        "source": "wikidata",
        "qid": qid,
        "wikidata_url": f"https://www.wikidata.org/wiki/{qid}" if qid else None,
        "owned_by": _labels_for_ids(labels, relations["ownership_ids"]),
        "parent_orgs": _labels_for_ids(labels, relations["parent_ids"]),
        "part_of": _labels_for_ids(labels, relations["part_of_ids"]),
        "headquarters": _labels_for_ids(labels, relations["headquarters_ids"]),
        "subsidiaries": _labels_for_ids(labels, relations["subsidiary_ids"]),
        "org_types": _labels_for_ids(labels, relations["org_type_ids"]),
        "inception": _extract_wikidata_time(claims, "P571"),
        "official_website": _extract_wikidata_url(claims, "P856"),
        "confidence": "medium",
        "owned_with_proportion": _label_proportion_pairs(
            labels, relations["owned_with_proportion"]
        ),
        "parent_with_proportion": _label_proportion_pairs(
            labels, relations["parent_with_proportion"]
        ),
    }
    if include_details:
        payload.update(
            {
                "founders": _labels_for_ids(labels, relations["founder_ids"]),
                "ceos": _labels_for_ids(labels, relations["ceo_ids"]),
                "raw_claims": claims,
                "labels": labels,
            }
        )
    return payload


def _merge_known_data(org: dict[str, Any], known: dict[str, Any]) -> None:
    """Merge KNOWN_ORGS data (highest priority for major outlets)."""
    if not known:
        return
    org["funding_type"] = known.get("funding_type") or org["funding_type"]
    org["parent_org"] = known.get("parent") or org["parent_org"]
    org["description"] = known.get("description") or org["description"]
    org["org_type"] = known.get("org_type") or org["org_type"]
    org["cik"] = known.get("cik") or org["cik"]
    if not org["ein"] and known.get("ein"):
        org["ein"] = str(known["ein"])
    if not org["annual_revenue"] and known.get("annual_revenue"):
        org["annual_revenue"] = known["annual_revenue"]
    if not org["ownership_percentage"] and known.get("ownership_percentage"):
        org["ownership_percentage"] = known["ownership_percentage"]
    if not org["funding_sources"] and known.get("funding_sources"):
        org["funding_sources"] = known["funding_sources"]
    org["media_bias_rating"] = known.get("media_bias_rating")
    org["factual_reporting"] = known.get("factual_reporting")
    org["research_sources"].append("known_data")
    org["research_confidence"] = "high"


def _merge_wikipedia_data(org: dict[str, Any], wikipedia: dict[str, Any]) -> None:
    """Merge Wikipedia organization data."""
    if not wikipedia:
        return
    wiki_ownership = wikipedia.get("ownership") or {}
    if not org["parent_org"] and wiki_ownership.get("parent"):
        org["parent_org"] = wiki_ownership["parent"]
    if not org["funding_type"] and wiki_ownership.get("funding_type"):
        org["funding_type"] = wiki_ownership["funding_type"]
    if not org["description"]:
        org["description"] = wikipedia.get("description")
    org["recent_ownership_changes"] = wikipedia.get("recent_ownership_changes")
    org["wikipedia_url"] = wikipedia.get("url")
    org["research_sources"].append("wikipedia")
    if org["research_confidence"] == "low":
        org["research_confidence"] = "medium"


def _merge_wikidata_data(org: dict[str, Any], wikidata: dict[str, Any]) -> None:
    """Merge Wikidata data from English Wikipedia title lookup."""
    if not wikidata:
        return
    org["wikidata_url"] = wikidata.get("wikidata_url")
    org["wikidata_qid"] = wikidata.get("qid")
    org["owned_by"] = wikidata.get("owned_by") or []
    org["parent_orgs"] = wikidata.get("parent_orgs") or []
    org["part_of"] = wikidata.get("part_of") or []
    org["headquarters"] = wikidata.get("headquarters") or []
    org["subsidiaries"] = wikidata.get("subsidiaries") or []
    if not org["org_type"]:
        org["org_type"] = _select_organization_type(
            cast(list[str], wikidata.get("org_types") or [])
        )
    org["inception"] = wikidata.get("inception")
    org["official_website"] = wikidata.get("official_website")
    if not org["parent_org"] and org["parent_orgs"]:
        org["parent_org"] = org["parent_orgs"][0]
    if not org["website"] and org["official_website"]:
        org["website"] = org["official_website"]

    # Extract ownership_percentage from Wikidata proportion qualifiers (P1107)
    if not org.get("ownership_percentage"):
        wiki_owned_proportion = wikidata.get("owned_with_proportion") or []
        wiki_parent_proportion = wikidata.get("parent_with_proportion") or []
        for _name, pct in wiki_owned_proportion + wiki_parent_proportion:
            if pct is not None:
                org["ownership_percentage"] = pct
                break

    org["research_sources"].append("wikidata")
    if org["research_confidence"] == "low":
        org["research_confidence"] = "medium"


def _merge_wikidata_sparql_data(
    org: dict[str, Any], wikidata_sparql: dict[str, Any] | None
) -> None:
    """Merge the Wikidata SPARQL fallback (orgs without English Wikipedia)."""
    if not wikidata_sparql:
        return
    if not org["wikidata_qid"]:
        org["wikidata_qid"] = wikidata_sparql.get("qid")
    if not org["wikidata_url"]:
        org["wikidata_url"] = wikidata_sparql.get("wikidata_url")
    for field in ("owned_by", "part_of", "headquarters", "subsidiaries"):
        if wikidata_sparql.get(field):
            org[field] = wikidata_sparql[field]
    if wikidata_sparql.get("parent_orgs"):
        org["parent_orgs"] = wikidata_sparql["parent_orgs"]
        if not org["parent_org"]:
            org["parent_org"] = org["parent_orgs"][0]
    if not org["org_type"]:
        org["org_type"] = _select_organization_type(
            cast(list[str], wikidata_sparql.get("org_types") or [])
        )
    if not org["ownership_percentage"]:
        proportions = (wikidata_sparql.get("owned_with_proportion") or []) + (
            wikidata_sparql.get("parent_with_proportion") or []
        )
        org["ownership_percentage"] = next(
            (percentage for _owner, percentage in proportions if percentage is not None),
            None,
        )
    if wikidata_sparql.get("inception"):
        org["inception"] = wikidata_sparql["inception"]
    if wikidata_sparql.get("official_website"):
        org["official_website"] = wikidata_sparql["official_website"]
    if "wikidata_sparql" not in org["research_sources"]:
        org["research_sources"].append("wikidata_sparql")
    if org["research_confidence"] == "low":
        org["research_confidence"] = "medium"


def _merge_nonprofit_data(org: dict[str, Any], nonprofit: dict[str, Any]) -> None:
    """Merge ProPublica nonprofit data.

    Skipped when higher-priority sources identify the outlet as commercial
    or as a person.
    """
    known_commercial = str(org.get("funding_type") or "").lower() == "commercial"
    is_person = str(org.get("org_type") or "").casefold() in {"human", "person"}
    if nonprofit and not known_commercial and not is_person:
        nonprofit_ein = nonprofit.get("ein")
        org["ein"] = str(nonprofit_ein) if nonprofit_ein is not None else None
        org["annual_revenue"] = nonprofit.get("annual_revenue")
        if not org.get("funding_type"):
            org["funding_type"] = nonprofit.get("funding_type")
        org["research_sources"].append("propublica")
        if org["research_confidence"] == "low":
            org["research_confidence"] = "high"


def _merge_sec_data(org: dict[str, Any], sec: dict[str, Any] | None) -> None:
    """Merge SEC EDGAR data."""
    if not sec:
        return
    org["cik"] = sec.get("cik")
    if sec.get("ein"):
        org["ein"] = org["ein"] or str(sec["ein"])
    if sec.get("tickers") and not org.get("funding_type"):
        org["funding_type"] = "commercial"
    if sec.get("tickers") and not org.get("org_type"):
        org["org_type"] = "public company"
    if sec.get("revenue"):
        org["annual_revenue"] = org["annual_revenue"] or sec["revenue"]
    if sec.get("total_assets"):
        org["annual_revenue"] = org["annual_revenue"] or sec["total_assets"]
    if "sec_edgar" not in org["research_sources"]:
        org["research_sources"].append("sec_edgar")
    if org["research_confidence"] == "low":
        org["research_confidence"] = "medium"


def _collect_staleness_flags(client: OpenAI, org_name: str, known_key: str) -> list[str]:
    """Flag a KNOWN_ORGS entry as stale when the LLM says it is outdated."""
    if known_key not in KNOWN_ORGS:
        return []
    known_entry = KNOWN_ORGS[known_key]
    try:
        verify_prompt = (
            f"You are a media ownership fact-checker. "
            f"The KNOWN_ORGS database has this entry for '{org_name}': "
            f"{json.dumps(known_entry)}. "
            f"Is any of this information materially outdated as of 2025? "
            f"Answer only YES or NO."
        )
        verify_response = client.chat.completions.create(
            model=(
                get_llamacpp_model()
                if settings.llm_backend == "llamacpp"
                else resolve_opencode_model(settings.open_router_model)
            ),
            messages=cast(
                Iterable[ChatCompletionMessageParam],
                [{"role": "user", "content": verify_prompt}],
            ),
            max_tokens=10,
            temperature=0.0,
        )
        verify_content = verify_response.choices[0].message.content or ""
        if "YES" in verify_content.upper() and "NO" not in verify_content.upper():
            logger.info("KNOWN_ORGS entry for %s flagged stale by LLM", org_name)
            return ["KNOWN_ORGS entry flagged as stale by LLM"]
    except Exception as e:
        logger.warning("KNOWN_ORGS staleness check failed: %s", e)
    return []


def _apply_ai_enhancements(org: dict[str, Any], ai_data: dict[str, Any]) -> None:
    """Apply AI-provided ratings and transparency flags to the org dict."""
    outlet_types = {
        "news organization",
        "nonprofit",
        "public broadcaster",
        "publisher",
        "state media",
    }
    if str(org.get("org_type") or "").casefold() in outlet_types:
        if not org.get("media_bias_rating"):
            org["media_bias_rating"] = ai_data.get("media_bias_rating")
        if not org.get("factual_reporting"):
            org["factual_reporting"] = ai_data.get("factual_reporting")

    if ai_data.get("funding_transparency"):
        org["funding_transparency"] = ai_data["funding_transparency"]
    if (
        str(org.get("org_type") or "").casefold() == "publisher"
        and ai_data.get("has_paywall") is not None
    ):
        org["has_paywall"] = bool(ai_data["has_paywall"])

    if "ai_inference" not in org.get("research_sources", []):
        org["research_sources"].append("ai_inference")
