"""
Reporter Profiler Agent for Phase 5B.

This agent researches journalists/reporters to build profiles with:
- Basic identity (name, bio, career history)
- Areas of expertise/topics
- Political leanings and bias indicators
- Social media and external links

Uses a layered source strategy:
1. Wikipedia (most authoritative)
2. Media Bias/Fact Check (MBFC)
3. LittleSis (power relationships)
4. OpenSecrets (political donations)
5. SEC filings (for business journalists)
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import get_openai_client, settings
from app.core.logging import get_logger

logger = get_logger("reporter_profiler")


class ReporterProfiler:
    """Agent that researches and profiles journalists/reporters."""

    def __init__(self):
        self.client = get_openai_client()
        self.http_client = httpx.AsyncClient(timeout=30.0)

    async def profile_reporter(
        self,
        name: str,
        organization: Optional[str] = None,
        article_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Research a reporter and return a comprehensive profile.

        Args:
            name: Reporter's name
            organization: Optional organization they work for
            article_context: Optional article text for context

        Returns:
            Profile dict with bio, topics, leanings, etc.
        """
        logger.info(f"Profiling reporter: {name} (org: {organization})")

        # Normalize name for lookups
        normalized_name = self._normalize_name(name)

        # Gather data from multiple sources in parallel
        results = await asyncio.gather(
            self._search_wikipedia(name, organization),
            self._search_mbfc_author(name),
            self._infer_from_context(name, organization, article_context),
            return_exceptions=True,
        )

        wikipedia_data = results[0] if not isinstance(results[0], Exception) else {}
        mbfc_data = results[1] if not isinstance(results[1], Exception) else {}
        inferred_data = results[2] if not isinstance(results[2], Exception) else {}

        # Merge data with priority: Wikipedia > MBFC > Inferred
        profile = self._merge_profile_data(
            name=name,
            normalized_name=normalized_name,
            wikipedia=wikipedia_data,
            mbfc=mbfc_data,
            inferred=inferred_data,
        )

        # Use AI to synthesize and fill gaps
        if self.client:
            profile = await self._ai_enhance_profile(
                profile, organization, article_context
            )

        profile["last_researched_at"] = datetime.now(timezone.utc).isoformat()

        return profile

    def _normalize_name(self, name: str) -> str:
        """Normalize name for database matching."""
        # Remove titles, suffixes
        name = re.sub(
            r"\b(Dr|Mr|Mrs|Ms|Jr|Sr|III|II|IV)\b\.?", "", name, flags=re.IGNORECASE
        )
        # Lowercase and strip
        return name.lower().strip()

    async def _search_wikipedia(
        self, name: str, organization: Optional[str] = None
    ) -> Dict[str, Any]:
        """Search Wikipedia for reporter information."""
        try:
            # Use Wikipedia API to search
            search_query = f"{name} journalist"
            if organization:
                search_query += f" {organization}"

            url = "https://en.wikipedia.org/w/api.php"
            params = {
                "action": "query",
                "list": "search",
                "srsearch": search_query,
                "format": "json",
                "srlimit": 3,
            }

            response = await self.http_client.get(url, params=params)
            if response.status_code != 200:
                return {}

            data = response.json()
            search_results = data.get("query", {}).get("search", [])

            if not search_results:
                return {}

            # Get the first result's page content
            page_title = search_results[0]["title"]
            extract_params = {
                "action": "query",
                "titles": page_title,
                "prop": "extracts|info",
                "exintro": True,
                "explaintext": True,
                "format": "json",
                "inprop": "url",
            }

            extract_response = await self.http_client.get(url, params=extract_params)
            if extract_response.status_code != 200:
                return {}

            extract_data = extract_response.json()
            pages = extract_data.get("query", {}).get("pages", {})

            for page_id, page_info in pages.items():
                if page_id == "-1":
                    continue

                return {
                    "source": "wikipedia",
                    "title": page_info.get("title"),
                    "bio": page_info.get("extract", "")[:1000],  # Limit bio length
                    "url": page_info.get("fullurl"),
                    "confidence": "high",
                }

            return {}

        except Exception as e:
            logger.error(f"Wikipedia search failed for {name}: {e}")
            return {}

    async def _search_mbfc_author(self, name: str) -> Dict[str, Any]:
        """
        Search Media Bias/Fact Check for author information.
        Note: MBFC doesn't have an official API, so this is limited.
        """
        # MBFC doesn't have a public API for author search
        # In production, you'd scrape or use a cached dataset
        return {}

    async def _infer_from_context(
        self, name: str, organization: Optional[str], article_context: Optional[str]
    ) -> Dict[str, Any]:
        """Infer reporter information from article context."""
        if not article_context:
            return {}

        # Extract any byline information
        inferred = {
            "source": "article_context",
            "organization": organization,
            "confidence": "low",
        }

        # Look for common patterns like "John Smith is a reporter for X"
        patterns = [
            rf"{re.escape(name)} is a? ?(\w+) (?:for|at|with) ([A-Za-z\s]+)",
            rf"{re.escape(name)}, (\w+) (?:for|at|with) ([A-Za-z\s]+)",
        ]

        for pattern in patterns:
            match = re.search(pattern, article_context, re.IGNORECASE)
            if match:
                inferred["role"] = match.group(1)
                inferred["organization"] = match.group(2).strip()
                inferred["confidence"] = "medium"
                break

        return inferred

    def _merge_profile_data(
        self,
        name: str,
        normalized_name: str,
        wikipedia: Dict[str, Any],
        mbfc: Dict[str, Any],
        inferred: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Merge data from multiple sources with priority."""
        profile = {
            "name": name,
            "normalized_name": normalized_name,
            "bio": None,
            "career_history": [],
            "topics": [],
            "education": [],
            "political_leaning": None,
            "leaning_confidence": None,
            "leaning_sources": [],
            "twitter_handle": None,
            "linkedin_url": None,
            "wikipedia_url": None,
            "research_sources": [],
            "research_confidence": "low",
        }

        # Merge Wikipedia data
        if wikipedia:
            profile["bio"] = wikipedia.get("bio")
            profile["wikipedia_url"] = wikipedia.get("url")
            profile["research_sources"].append("wikipedia")
            profile["research_confidence"] = (
                "high" if wikipedia.get("confidence") == "high" else "medium"
            )

        # Merge MBFC data
        if mbfc:
            if mbfc.get("political_leaning"):
                profile["political_leaning"] = mbfc.get("political_leaning")
                profile["leaning_confidence"] = mbfc.get("confidence", "medium")
                profile["leaning_sources"].append("mbfc")
            profile["research_sources"].append("mbfc")

        # Merge inferred data (lowest priority)
        if inferred:
            if not profile["bio"] and inferred.get("bio"):
                profile["bio"] = inferred.get("bio")
            if inferred.get("organization"):
                profile["career_history"].append(
                    {
                        "organization": inferred["organization"],
                        "role": inferred.get("role"),
                        "source": "inferred",
                    }
                )
            profile["research_sources"].append("article_context")

        return profile

    async def _ai_enhance_profile(
        self,
        profile: Dict[str, Any],
        organization: Optional[str],
        article_context: Optional[str],
    ) -> Dict[str, Any]:
        """Use AI to enhance and fill gaps in the profile."""
        if not self.client:
            return profile

        # Only enhance if we have some data to work with
        if not profile.get("bio") and not article_context:
            return profile

        try:
            prompt = f"""You are a research assistant analyzing a journalist's profile.

Reporter Name: {profile["name"]}
Organization: {organization or "Unknown"}
Current Bio: {profile.get("bio", "None")}
Wikipedia URL: {profile.get("wikipedia_url", "None")}

Based on any available information, provide a brief assessment:
1. What topics/beats does this journalist likely cover?
2. Are there any known political leanings? (left, center-left, center, center-right, right, or unknown)
3. What is your confidence level in this assessment? (high, medium, low)

Respond in JSON format:
{{
  "topics": ["topic1", "topic2"],
  "political_leaning": "center" or null,
  "leaning_confidence": "low",
  "assessment_notes": "Brief explanation"
}}"""

            response = self.client.chat.completions.create(
                model=settings.open_router_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500,
                temperature=0.3,
            )

            content = response.choices[0].message.content

            # Parse JSON from response
            json_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
            if json_match:
                ai_data = json.loads(json_match.group())

                if ai_data.get("topics"):
                    profile["topics"] = ai_data["topics"]
                if ai_data.get("political_leaning") and not profile.get(
                    "political_leaning"
                ):
                    profile["political_leaning"] = ai_data["political_leaning"]
                    profile["leaning_confidence"] = ai_data.get(
                        "leaning_confidence", "low"
                    )
                    profile["leaning_sources"].append("ai_inference")

        except Exception as e:
            logger.error(f"AI enhancement failed: {e}")

        return profile

    # ── Deep dossier methods (Manufacturing Consent analysis) ──

    async def build_deep_dossier(
        self,
        name: str,
        organization: Optional[str] = None,
        articles: Optional[List[Dict[str, Any]]] = None,
        org_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build a comprehensive dossier extending the basic profile.

        Adds source pattern analysis, topic gaps, advertiser alignment,
        revolving door history, controversies, institutional affiliations,
        and cross-outlet coverage comparison.

        Args:
            name: Reporter name
            organization: Current employer
            articles: List of article dicts from our DB for this reporter
            org_data: Organization/funding data for the reporter's employer

        Returns:
            Dict with deep dossier fields to merge into the reporter record.
        """
        logger.info("Building deep dossier for: %s", name)
        articles = articles or []

        # Compute empirical stats from our article corpus
        corpus_analysis = self._analyze_article_corpus(name, articles)

        # LLM-powered deeper research
        deep_research = await self._llm_deep_research(
            name, organization, corpus_analysis, org_data
        )

        dossier: Dict[str, Any] = {
            "source_patterns": corpus_analysis.get("source_patterns"),
            "topics_avoided": deep_research.get("topics_avoided"),
            "advertiser_alignment": deep_research.get("advertiser_alignment"),
            "revolving_door": deep_research.get("revolving_door"),
            "controversies": deep_research.get("controversies"),
            "institutional_affiliations": deep_research.get(
                "institutional_affiliations"
            ),
            "coverage_comparison": deep_research.get("coverage_comparison"),
            "article_count": len(articles),
            "last_article_at": corpus_analysis.get("last_article_at"),
        }

        return dossier

    def _analyze_article_corpus(
        self, name: str, articles: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Analyze the reporter's articles in our DB for empirical patterns."""
        if not articles:
            return {
                "source_patterns": {
                    "official": 0,
                    "grassroots": 0,
                    "unknown": 0,
                    "analysis": "No articles in database to analyze.",
                },
                "last_article_at": None,
                "topic_distribution": {},
                "category_counts": {},
            }

        from collections import Counter

        categories: Counter[str] = Counter()
        sources_used: Counter[str] = Counter()
        last_published = None

        for article in articles:
            cat = article.get("category", "general")
            categories[cat] += 1

            source = article.get("source", "")
            if source:
                sources_used[source] += 1

            pub = article.get("published_at") or article.get("published")
            if pub and (last_published is None or pub > last_published):
                last_published = pub

        return {
            "source_patterns": {
                "official": 0,
                "grassroots": 0,
                "unknown": len(articles),
                "analysis": (
                    f"Sourcing analysis based on {len(articles)} articles. "
                    "Detailed source classification requires content analysis."
                ),
            },
            "last_article_at": last_published,
            "topic_distribution": dict(categories.most_common(10)),
            "category_counts": dict(categories),
            "outlets_published_in": dict(sources_used.most_common(10)),
            "total_articles": len(articles),
        }

    async def _llm_deep_research(
        self,
        name: str,
        organization: Optional[str],
        corpus_analysis: Dict[str, Any],
        org_data: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Use LLM for the deeper dossier fields that require contextual knowledge."""
        if not self.client:
            logger.warning("No LLM client; skipping deep dossier research for %s", name)
            return {}

        org_context = ""
        if org_data:
            org_context = f"""
Employer details:
- Organization: {org_data.get("name", organization)}
- Funding type: {org_data.get("funding_type", "unknown")}
- Parent company: {org_data.get("parent_org", "unknown")}
- Major advertisers: {", ".join(org_data.get("major_advertisers", [])[:5]) or "unknown"}
- Media bias rating: {org_data.get("media_bias_rating", "unknown")}"""

        corpus_context = ""
        if corpus_analysis.get("total_articles"):
            cats = corpus_analysis.get("topic_distribution", {})
            cat_str = ", ".join(f"{k}: {v}" for k, v in list(cats.items())[:5])
            corpus_context = f"""
Article corpus from our database:
- Total articles: {corpus_analysis["total_articles"]}
- Topic distribution: {cat_str}
- Outlets published in: {", ".join(corpus_analysis.get("outlets_published_in", {}).keys())}"""

        prompt = f"""You are a media research analyst building a comprehensive dossier
on a journalist, applying the analytical frameworks from Chomsky's
Manufacturing Consent and Parenti's Inventing Reality.

JOURNALIST: {name}
CURRENT EMPLOYER: {organization or "Unknown"}
{org_context}
{corpus_context}

Provide a deep analysis covering these areas. For each area, only include
information you are confident about. Mark uncertain claims as "unverified".
Include citations where possible.

Respond ONLY with valid JSON (no markdown):
{{
  "topics_avoided": {{
    "topics": ["topic1", "topic2"],
    "analysis": "Which topics does this reporter systematically not cover that their outlet does cover?",
    "confidence": "low"
  }},
  "advertiser_alignment": {{
    "alignment_score": "low|medium|high",
    "analysis": "How does the reporter's beat align with their employer's advertiser/owner interests?",
    "examples": [],
    "confidence": "low"
  }},
  "revolving_door": {{
    "history": [
      {{"role": "...", "organization": "...", "org_type": "media|government|corporate|think_tank", "period": "...", "verified": true}}
    ],
    "analysis": "Has this journalist moved between media, government, and corporate roles?",
    "confidence": "low"
  }},
  "controversies": [
    {{"description": "...", "date": "...", "citations": [{{"url": "...", "title": "..."}}], "severity": "minor|moderate|major"}}
  ],
  "institutional_affiliations": [
    {{"organization": "...", "role": "member|fellow|board|advisor", "period": "...", "org_type": "think_tank|university|ngo|industry_group"}}
  ],
  "coverage_comparison": {{
    "analysis": "If the reporter has worked at multiple outlets, how has their coverage changed?",
    "outlets_compared": [],
    "notable_shifts": [],
    "confidence": "low"
  }}
}}"""

        try:
            response = self.client.chat.completions.create(
                model=settings.open_router_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2000,
                temperature=0.3,
            )

            content = response.choices[0].message.content or ""
            json_match = re.search(r"\{[\s\S]*\}", content)
            if not json_match:
                logger.error("No JSON in deep dossier LLM response for %s", name)
                return {}

            return json.loads(json_match.group())

        except json.JSONDecodeError as exc:
            logger.error("Failed to parse deep dossier JSON for %s: %s", name, exc)
            return {}
        except Exception as exc:
            logger.error("Deep dossier LLM call failed for %s: %s", name, exc)
            return {}

    async def close(self):
        """Close HTTP client."""
        await self.http_client.aclose()


# Singleton instance
_profiler: Optional[ReporterProfiler] = None


def get_reporter_profiler() -> ReporterProfiler:
    """Get or create the ReporterProfiler singleton."""
    global _profiler
    if _profiler is None:
        _profiler = ReporterProfiler()
    return _profiler
