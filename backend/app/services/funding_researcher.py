"""
Funding Researcher Agent for Phase 5B.

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
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import get_openai_client
from app.core.logging import get_logger

logger = get_logger("funding_researcher")

KNOWN_ORGS: Dict[str, Dict[str, Any]] = {
    "bbc": {
        "name": "BBC",
        "funding_type": "public",
        "parent": None,
        "description": "British Broadcasting Corporation, UK public broadcaster",
        "media_bias_rating": "center",
        "factual_reporting": "high",
        "confidence": "high",
    },
    "cnn": {
        "name": "CNN",
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
        "funding_type": "commercial",
        "parent": "The New York Times Company",
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
        "funding_type": "non-profit",
        "parent": None,
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
}


class FundingResearcher:
    """Agent that researches news organization funding and ownership."""

    def __init__(self):
        self.client = get_openai_client()
        self.http_client = httpx.AsyncClient(timeout=30.0)
        
        # ProPublica Nonprofit Explorer API (free, no key needed)
        self.propublica_base = "https://projects.propublica.org/nonprofits/api/v2"
        
    async def research_organization(
        self, 
        name: str,
        website: Optional[str] = None,
        use_ai: bool = True
    ) -> Dict[str, Any]:
        """
        Research an organization's funding and ownership.
        
        Args:
            name: Organization name
            website: Optional website URL
            
        Returns:
            Organization data dict with ownership, funding, etc.
        """
        logger.info(f"Researching organization: {name}")
        
        normalized_name = self._normalize_name(name)
        
        # Gather data from multiple sources in parallel
        results = await asyncio.gather(
            self._search_wikipedia(name),
            self._search_propublica_nonprofit(name),
            self._get_known_org_data(name),
            return_exceptions=True
        )
        
        wikipedia_data = results[0] if not isinstance(results[0], Exception) else {}
        nonprofit_data = results[1] if not isinstance(results[1], Exception) else {}
        known_data = results[2] if not isinstance(results[2], Exception) else {}
        wikidata_data = await self._fetch_wikidata(wikipedia_data.get("page_title") or name)
        
        # Merge with priority
        org_data = self._merge_org_data(
            name=name,
            normalized_name=normalized_name,
            website=website,
            wikipedia=wikipedia_data,
            wikidata=wikidata_data,
            nonprofit=nonprofit_data,
            known=known_data
        )
        
        # Use AI to synthesize
        if self.client and use_ai:
            org_data = await self._ai_enhance_org_data(org_data)
        
        org_data["last_researched_at"] = datetime.now(timezone.utc).isoformat()
        
        return org_data
    
    def _normalize_name(self, name: str) -> str:
        """Normalize organization name for matching."""
        # Remove common suffixes
        name = re.sub(r'\b(Inc|LLC|Corp|Corporation|Co|Ltd|Limited)\b\.?', '', name, flags=re.IGNORECASE)
        return name.lower().strip()
    
    async def _search_wikipedia(self, name: str) -> Dict[str, Any]:
        """Search Wikipedia for organization information."""
        try:
            search_query = f"{name} news organization"
            url = "https://en.wikipedia.org/w/api.php"
            params = {
                "action": "query",
                "list": "search",
                "srsearch": search_query,
                "format": "json",
                "srlimit": 3
            }
            
            response = await self.http_client.get(url, params=params)
            if response.status_code != 200:
                return {}
                
            data = response.json()
            search_results = data.get("query", {}).get("search", [])
            
            if not search_results:
                return {}
            
            page_title = search_results[0]["title"]
            extract_params = {
                "action": "query",
                "titles": page_title,
                "prop": "extracts|info",
                "exintro": True,
                "explaintext": True,
                "format": "json",
                "inprop": "url"
            }
            
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
                    "url": page_info.get("fullurl"),
                    "ownership": ownership_info,
                    "page_title": page_info.get("title"),
                    "confidence": "high"
                }
                
            return {}
            
        except Exception as e:
            logger.error(f"Wikipedia search failed for {name}: {e}")
            return {}
    
    def _extract_ownership_from_text(self, text: str) -> Optional[Dict[str, Any]]:
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
    
    async def _search_propublica_nonprofit(self, name: str) -> Dict[str, Any]:
        """Search ProPublica Nonprofit Explorer for 990 data."""
        try:
            # Search for organization
            search_url = f"{self.propublica_base}/search.json"
            params = {"q": name}
            
            response = await self.http_client.get(search_url, params=params)
            if response.status_code != 200:
                return {}
                
            data = response.json()
            organizations = data.get("organizations", [])
            
            if not organizations:
                return {}
            
            # Get the first matching organization
            org = organizations[0]
            ein = org.get("ein")
            if ein is not None:
                ein = str(ein)
            
            if not ein:
                return {}
            
            # Get detailed org data including 990 filings
            org_url = f"{self.propublica_base}/organizations/{ein}.json"
            org_response = await self.http_client.get(org_url)
            
            if org_response.status_code != 200:
                return {
                    "source": "propublica",
                    "ein": ein,
                    "name": org.get("name"),
                    "confidence": "medium"
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
                "confidence": "high"
            }
            
        except Exception as e:
            logger.error(f"ProPublica search failed for {name}: {e}")
            return {}

    async def _fetch_wikidata(self, page_title: str) -> Dict[str, Any]:
        """Fetch structured ownership and metadata from Wikidata."""
        try:
            params = {
                "action": "wbgetentities",
                "sites": "enwiki",
                "titles": page_title,
                "props": "claims|labels|descriptions|sitelinks",
                "format": "json",
                "formatversion": 2,
                "languages": "en",
            }
            response = await self.http_client.get(
                "https://www.wikidata.org/w/api.php", params=params
            )
            if response.status_code != 200:
                return {}
            data = response.json()
            entities = data.get("entities") or []
            if not entities:
                return {}
            entity = entities[0]
            qid = entity.get("id")
            claims = entity.get("claims") or {}

            item_ids: List[str] = []
            ownership_ids = _extract_wikidata_item_ids(claims, "P127")
            parent_ids = _extract_wikidata_item_ids(claims, "P749")
            part_of_ids = _extract_wikidata_item_ids(claims, "P361")
            headquarters_ids = _extract_wikidata_item_ids(claims, "P159")
            item_ids.extend(ownership_ids + parent_ids + part_of_ids + headquarters_ids)

            labels = await self._resolve_wikidata_labels(item_ids)

            return {
                "source": "wikidata",
                "qid": qid,
                "wikidata_url": f"https://www.wikidata.org/wiki/{qid}" if qid else None,
                "owned_by": [labels.get(item_id) for item_id in ownership_ids if labels.get(item_id)],
                "parent_orgs": [labels.get(item_id) for item_id in parent_ids if labels.get(item_id)],
                "part_of": [labels.get(item_id) for item_id in part_of_ids if labels.get(item_id)],
                "headquarters": [labels.get(item_id) for item_id in headquarters_ids if labels.get(item_id)],
                "inception": _extract_wikidata_time(claims, "P571"),
                "official_website": _extract_wikidata_url(claims, "P856"),
                "confidence": "medium",
            }
        except Exception as exc:
            logger.warning("Wikidata fetch failed for %s: %s", name, exc)
            return {}

    async def _resolve_wikidata_labels(self, item_ids: List[str]) -> Dict[str, str]:
        if not item_ids:
            return {}
        unique_ids = sorted({item_id for item_id in item_ids if item_id})
        if not unique_ids:
            return {}
        params = {
            "action": "wbgetentities",
            "ids": "|".join(unique_ids),
            "props": "labels",
            "format": "json",
            "languages": "en",
            "formatversion": 2,
        }
        response = await self.http_client.get(
            "https://www.wikidata.org/w/api.php", params=params
        )
        if response.status_code != 200:
            return {}
        data = response.json()
        labels: Dict[str, str] = {}
        for entity in data.get("entities") or []:
            entity_id = entity.get("id")
            label = (entity.get("labels") or {}).get("en", {}).get("value")
            if entity_id and label:
                labels[entity_id] = label
        return labels
    
    async def _get_known_org_data(self, name: str) -> Dict[str, Any]:
        """Return known data for major news organizations."""
        normalized = self._normalize_name(name)
        
        # Check for exact or partial matches
        for key, data in KNOWN_ORGS.items():
            if key in normalized or normalized in key:
                return {"source": "known_data", **data}
                
        return {}
    
    def _merge_org_data(
        self,
        name: str,
        normalized_name: str,
        website: Optional[str],
        wikipedia: Dict[str, Any],
        wikidata: Dict[str, Any],
        nonprofit: Dict[str, Any],
        known: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Merge data from multiple sources."""
        org = {
            "name": name,
            "normalized_name": normalized_name,
            "org_type": "publisher",
            "parent_org": None,
            "ownership_percentage": None,
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
            "wikipedia_url": None,
            "littlesis_url": None,
            "opensecrets_url": None,
            "research_sources": [],
            "research_confidence": "low"
        }
        
        # Merge known data (highest priority for major outlets)
        if known:
            org["funding_type"] = known.get("funding_type") or org["funding_type"]
            org["parent_org"] = known.get("parent") or org["parent_org"]
            org["media_bias_rating"] = known.get("media_bias_rating")
            org["factual_reporting"] = known.get("factual_reporting")
            org["research_sources"].append("known_data")
            org["research_confidence"] = "high"
        
        # Merge Wikipedia data
        if wikipedia:
            if not org["parent_org"] and wikipedia.get("ownership", {}).get("parent"):
                org["parent_org"] = wikipedia["ownership"]["parent"]
            if not org["funding_type"] and wikipedia.get("ownership", {}).get("funding_type"):
                org["funding_type"] = wikipedia["ownership"]["funding_type"]
            org["wikipedia_url"] = wikipedia.get("url")
            org["research_sources"].append("wikipedia")
            if org["research_confidence"] == "low":
                org["research_confidence"] = "medium"

        if wikidata:
            org["wikidata_url"] = wikidata.get("wikidata_url")
            org["wikidata_qid"] = wikidata.get("qid")
            org["owned_by"] = wikidata.get("owned_by") or []
            org["parent_orgs"] = wikidata.get("parent_orgs") or []
            org["part_of"] = wikidata.get("part_of") or []
            org["headquarters"] = wikidata.get("headquarters") or []
            org["inception"] = wikidata.get("inception")
            org["official_website"] = wikidata.get("official_website")
            if not org["parent_org"] and org["parent_orgs"]:
                org["parent_org"] = org["parent_orgs"][0]
            if not org["website"] and org["official_website"]:
                org["website"] = org["official_website"]
            org["research_sources"].append("wikidata")
            if org["research_confidence"] == "low":
                org["research_confidence"] = "medium"

        # Merge ProPublica nonprofit data
        if nonprofit:
            nonprofit_ein = nonprofit.get("ein")
            org["ein"] = str(nonprofit_ein) if nonprofit_ein is not None else None
            org["annual_revenue"] = nonprofit.get("annual_revenue")
            org["funding_type"] = nonprofit.get("funding_type") or org["funding_type"]
            org["research_sources"].append("propublica")
            org["research_confidence"] = "high"
        
        return org
    
    async def _ai_enhance_org_data(self, org: Dict[str, Any]) -> Dict[str, Any]:
        """Use AI to fill gaps in organization data."""
        if not self.client:
            return org
            
        # Only enhance if we have minimal data
        if org.get("research_confidence") == "high":
            return org
            
        try:
            prompt = f"""You are a media research assistant analyzing a news organization.

Organization: {org['name']}
Known Data:
- Funding Type: {org.get('funding_type', 'Unknown')}
- Parent Organization: {org.get('parent_org', 'Unknown')}
- Bias Rating: {org.get('media_bias_rating', 'Unknown')}

Based on your knowledge, provide information about this organization:
1. What type of funding does this organization have? (commercial, public, non-profit, state-funded, independent)
2. Who owns or controls this organization?
3. What is their general media bias? (left, center-left, center, center-right, right)
4. How factual is their reporting? (very-high, high, mixed, low, very-low)

Respond in JSON:
{{
  "funding_type": "commercial",
  "parent_org": "Parent Company Name" or null,
  "media_bias_rating": "center",
  "factual_reporting": "high",
  "notes": "Brief explanation"
}}"""

            response = self.client.chat.completions.create(
                model="google/gemini-3-flash-preview",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            
            if json_match:
                ai_data = json.loads(json_match.group())
                
                if not org.get("funding_type"):
                    org["funding_type"] = ai_data.get("funding_type")
                if not org.get("parent_org"):
                    org["parent_org"] = ai_data.get("parent_org")
                if not org.get("media_bias_rating"):
                    org["media_bias_rating"] = ai_data.get("media_bias_rating")
                if not org.get("factual_reporting"):
                    org["factual_reporting"] = ai_data.get("factual_reporting")
                    
                org["research_sources"].append("ai_inference")
                
        except Exception as e:
            logger.error(f"AI enhancement failed for org {org['name']}: {e}")
            
        return org
    
    async def get_ownership_chain(self, org_name: str, max_depth: int = 5) -> List[Dict[str, Any]]:
        """
        Build an ownership chain for an organization.
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
    
    async def close(self):
        """Close HTTP client."""
        await self.http_client.aclose()


# Singleton instance
_researcher: Optional[FundingResearcher] = None


def get_funding_researcher() -> FundingResearcher:
    """Get or create the FundingResearcher singleton."""
    global _researcher
    if _researcher is None:
        _researcher = FundingResearcher()
    return _researcher


def _extract_wikidata_item_ids(claims: Dict[str, Any], prop: str) -> List[str]:
    items: List[str] = []
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value") or {}
        if isinstance(value, dict):
            item_id = value.get("id")
            if item_id:
                items.append(item_id)
    return items


def _extract_wikidata_time(claims: Dict[str, Any], prop: str) -> Optional[str]:
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value") or {}
        if isinstance(value, dict):
            time_value = value.get("time")
            if time_value:
                return time_value
    return None


def _extract_wikidata_url(claims: Dict[str, Any], prop: str) -> Optional[str]:
    for claim in claims.get(prop, []):
        mainsnak = claim.get("mainsnak") or {}
        datavalue = mainsnak.get("datavalue") or {}
        value = datavalue.get("value")
        if isinstance(value, str):
            return value
    return None
