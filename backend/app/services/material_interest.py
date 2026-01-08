"""
Material Interest Agent for Phase 5C.

This agent analyzes material interests that may influence news coverage:
- Trade relationships between countries (OEC data)
- Corporate interests and advertisers
- Political donations and lobbying
- Geographic economic ties

Helps identify potential conflicts of interest in news coverage.
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import get_openai_client
from app.core.logging import get_logger

logger = get_logger("material_interest")


class MaterialInterestAgent:
    """Agent that analyzes material interests affecting news coverage."""

    def __init__(self):
        self.client = get_openai_client()
        self.http_client = httpx.AsyncClient(timeout=30.0)
        
        # OEC (Observatory of Economic Complexity) API
        self.oec_base = "https://oec.world/olap-proxy/data"
        
    async def analyze_material_context(
        self,
        article_source: str,
        source_country: str,
        mentioned_countries: List[str],
        topics: Optional[List[str]] = None,
        article_text: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyze material interests that may affect coverage.
        
        Args:
            article_source: Name of the news source
            source_country: Country code of the source
            mentioned_countries: Countries mentioned in the article
            topics: Topics covered (e.g., trade, energy, defense)
            article_text: Optional article text for deeper analysis
            
        Returns:
            Material context analysis
        """
        logger.info(f"Analyzing material context for {article_source} ({source_country})")
        
        # Gather trade data for country relationships
        trade_analyses = []
        for country in mentioned_countries[:5]:  # Limit to 5 countries
            if country != source_country:
                trade_data = await self._get_trade_relationship(source_country, country)
                if trade_data:
                    trade_analyses.append({
                        "country_pair": f"{source_country}-{country}",
                        **trade_data
                    })
        
        # Get known interests for major sources
        source_interests = self._get_known_source_interests(article_source)
        
        # Use AI to synthesize analysis
        analysis = {
            "source": article_source,
            "source_country": source_country,
            "mentioned_countries": mentioned_countries,
            "trade_relationships": trade_analyses,
            "known_interests": source_interests,
            "potential_conflicts": [],
            "analysis_summary": None,
            "analyzed_at": datetime.now(timezone.utc).isoformat()
        }
        
        if self.client and (trade_analyses or source_interests):
            analysis = await self._ai_analyze_interests(analysis, topics, article_text)
        
        return analysis
    
    async def _get_trade_relationship(
        self, 
        country1: str, 
        country2: str
    ) -> Optional[Dict[str, Any]]:
        """Get trade relationship data between two countries."""
        try:
            # OEC API for trade data
            # Note: OEC requires specific formatting, this is a simplified example
            # In production, you'd use their actual API params
            
            # For now, return cached/known major relationships
            known_relationships = self._get_known_trade_relationships()
            key = f"{country1}-{country2}"
            reverse_key = f"{country2}-{country1}"
            
            if key in known_relationships:
                return known_relationships[key]
            elif reverse_key in known_relationships:
                data = known_relationships[reverse_key].copy()
                data["direction"] = "reversed"
                return data
                
            return None
            
        except Exception as e:
            logger.error(f"Failed to get trade data for {country1}-{country2}: {e}")
            return None
    
    def _get_known_trade_relationships(self) -> Dict[str, Dict[str, Any]]:
        """Return known major trade relationships."""
        return {
            "US-CN": {
                "relationship": "major_trading_partner",
                "exports_rank": 1,
                "imports_rank": 1,
                "key_sectors": ["electronics", "machinery", "agriculture"],
                "tension_areas": ["tariffs", "technology", "IP"],
                "trade_volume": "650B USD"
            },
            "US-MX": {
                "relationship": "major_trading_partner",
                "exports_rank": 2,
                "imports_rank": 2,
                "key_sectors": ["automotive", "agriculture", "manufacturing"],
                "tension_areas": ["immigration", "USMCA"],
                "trade_volume": "600B USD"
            },
            "US-CA": {
                "relationship": "major_trading_partner",
                "exports_rank": 1,
                "imports_rank": 3,
                "key_sectors": ["energy", "automotive", "agriculture"],
                "tension_areas": ["lumber", "dairy"],
                "trade_volume": "700B USD"
            },
            "US-RU": {
                "relationship": "adversarial",
                "key_sectors": ["energy", "defense"],
                "tension_areas": ["sanctions", "Ukraine", "election interference"],
                "trade_volume": "35B USD"
            },
            "GB-EU": {
                "relationship": "post-brexit",
                "key_sectors": ["financial services", "manufacturing"],
                "tension_areas": ["Brexit", "Northern Ireland", "fishing"],
                "trade_volume": "400B GBP"
            },
            "CN-TW": {
                "relationship": "contested",
                "key_sectors": ["semiconductors", "electronics"],
                "tension_areas": ["sovereignty", "One China Policy"],
                "trade_volume": "200B USD"
            },
            "IL-PS": {
                "relationship": "conflict",
                "key_sectors": [],
                "tension_areas": ["occupation", "settlements", "security"],
                "trade_volume": "minimal"
            },
            "SA-IR": {
                "relationship": "adversarial",
                "key_sectors": ["energy"],
                "tension_areas": ["Yemen", "regional influence", "nuclear"],
                "trade_volume": "minimal"
            }
        }
    
    def _get_known_source_interests(self, source_name: str) -> Dict[str, Any]:
        """Return known material interests for major news sources."""
        normalized = source_name.lower()
        
        known_sources = {
            "cnn": {
                "parent_company": "Warner Bros. Discovery",
                "major_advertisers": ["AT&T", "pharmaceuticals", "financial services"],
                "owner_interests": ["entertainment media", "streaming"],
                "political_donations": "Democratic-leaning",
                "notes": "Formerly owned by AT&T until 2022 spin-off"
            },
            "fox news": {
                "parent_company": "Fox Corporation",
                "owner": "Murdoch family",
                "major_advertisers": ["MyPillow", "reverse mortgages", "pharmaceuticals"],
                "owner_interests": ["media", "entertainment", "real estate (Australia)"],
                "political_donations": "Republican-leaning",
                "notes": "Murdoch family owns News Corp and Fox Corporation"
            },
            "washington post": {
                "parent_company": "Nash Holdings",
                "owner": "Jeff Bezos",
                "owner_interests": ["Amazon", "e-commerce", "AWS", "space (Blue Origin)"],
                "potential_conflicts": ["Amazon labor coverage", "AWS government contracts"],
                "notes": "Purchased by Bezos in 2013 for $250M"
            },
            "new york times": {
                "parent_company": "The New York Times Company",
                "owner": "Sulzberger family (public company)",
                "major_advertisers": ["luxury brands", "real estate", "financial services"],
                "owner_interests": ["media", "podcasting", "games"],
                "notes": "Publicly traded but family-controlled"
            },
            "al jazeera": {
                "parent_company": "Al Jazeera Media Network",
                "owner": "State of Qatar",
                "owner_interests": ["natural gas", "World Cup hosting", "regional influence"],
                "potential_conflicts": ["Qatar coverage", "Gulf politics", "World Cup labor"],
                "notes": "Funded by Qatari government"
            },
            "rt": {
                "parent_company": "TV-Novosti",
                "owner": "Russian government",
                "owner_interests": ["Russian state interests", "energy exports", "geopolitics"],
                "potential_conflicts": ["All Russia coverage", "Ukraine", "NATO"],
                "notes": "Registered as foreign agent in US"
            },
            "bbc": {
                "parent_company": "BBC (public corporation)",
                "owner": "UK Government (via license fee)",
                "owner_interests": ["British soft power", "public education"],
                "potential_conflicts": ["UK government policy", "monarchy coverage"],
                "notes": "Funded by TV license fee, editorially independent"
            }
        }
        
        for key, data in known_sources.items():
            if key in normalized:
                return data
                
        return {}
    
    async def _ai_analyze_interests(
        self,
        analysis: Dict[str, Any],
        topics: Optional[List[str]],
        article_text: Optional[str]
    ) -> Dict[str, Any]:
        """Use AI to synthesize material interest analysis."""
        if not self.client:
            return analysis
            
        try:
            context = f"""Analyze potential material interests affecting news coverage.

Source: {analysis['source']} (from {analysis['source_country']})
Countries Mentioned: {', '.join(analysis['mentioned_countries'])}
Topics: {', '.join(topics or ['general'])}

Trade Relationships:
{json.dumps(analysis['trade_relationships'], indent=2)}

Known Source Interests:
{json.dumps(analysis['known_interests'], indent=2)}

Based on this information:
1. Are there potential conflicts of interest in covering this story?
2. What material interests might influence the coverage?
3. Should readers be aware of any biases or blind spots?

Respond in JSON:
{{
  "potential_conflicts": ["list of potential conflicts"],
  "analysis_summary": "Brief summary of material context",
  "reader_warnings": ["things readers should know"],
  "confidence": "high/medium/low"
}}"""

            response = self.client.chat.completions.create(
                model="google/gemini-3-flash-preview",
                messages=[{"role": "user", "content": context}],
                max_tokens=600,
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            
            if json_match:
                ai_data = json.loads(json_match.group())
                analysis["potential_conflicts"] = ai_data.get("potential_conflicts", [])
                analysis["analysis_summary"] = ai_data.get("analysis_summary")
                analysis["reader_warnings"] = ai_data.get("reader_warnings", [])
                analysis["confidence"] = ai_data.get("confidence", "low")
                
        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            
        return analysis
    
    async def get_country_economic_profile(self, country_code: str) -> Dict[str, Any]:
        """Get economic profile for a country."""
        # Simplified - in production would call OEC API
        profiles = {
            "US": {
                "gdp": "25.5T USD",
                "gdp_rank": 1,
                "top_exports": ["refined petroleum", "aircraft", "cars", "medical equipment"],
                "top_imports": ["cars", "computers", "broadcasting equipment", "packaged medicines"],
                "major_partners": ["China", "Canada", "Mexico", "Japan", "Germany"]
            },
            "CN": {
                "gdp": "18.3T USD",
                "gdp_rank": 2,
                "top_exports": ["computers", "broadcasting equipment", "telephones", "integrated circuits"],
                "top_imports": ["crude petroleum", "integrated circuits", "iron ore", "gold"],
                "major_partners": ["United States", "Japan", "South Korea", "Germany", "Australia"]
            },
            "GB": {
                "gdp": "3.1T USD",
                "gdp_rank": 6,
                "top_exports": ["gold", "cars", "gas turbines", "packaged medicines"],
                "top_imports": ["gold", "cars", "crude petroleum", "packaged medicines"],
                "major_partners": ["United States", "Germany", "Netherlands", "France", "China"]
            }
        }
        
        return profiles.get(country_code, {"note": "Economic data not available"})
    
    async def close(self):
        """Close HTTP client."""
        await self.http_client.aclose()


# Singleton instance
_agent: Optional[MaterialInterestAgent] = None


def get_material_interest_agent() -> MaterialInterestAgent:
    """Get or create the MaterialInterestAgent singleton."""
    global _agent
    if _agent is None:
        _agent = MaterialInterestAgent()
    return _agent
