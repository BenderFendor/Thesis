"""
Propaganda Filter Scorer for the Media Accountability Wiki.

Scores each news source on six axes derived from Chomsky's Manufacturing
Consent (5 filters) and Parenti's Inventing Reality (class interest).

Each filter is scored 1-5 with prose reasoning, citations, and an explicit
distinction between empirical data and inferred analysis.

Filters:
  1. Ownership     - corporate concentration, conglomerate depth
  2. Advertising   - ad dependency, corporate advertiser influence
  3. Sourcing      - official vs grassroots source reliance
  4. Flak          - vulnerability to organized pressure campaigns
  5. Ideology      - ideological alignment and framing rigidity
  6. Class Interest - coverage of labor, inequality, corporate power (Parenti)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.config import get_openai_client, settings
from app.core.logging import get_logger

logger = get_logger("propaganda_scorer")

FILTER_NAMES = [
    "ownership",
    "advertising",
    "sourcing",
    "flak",
    "ideology",
    "class_interest",
]

# Empirical data we can pull from existing DB/config without LLM
KNOWN_OWNERSHIP_DEPTH: Dict[str, Dict[str, Any]] = {
    "cnn": {
        "parent_chain": ["CNN", "Warner Bros. Discovery"],
        "conglomerate": True,
        "publicly_traded": True,
    },
    "fox news": {
        "parent_chain": ["Fox News", "Fox Corporation", "Murdoch Family Trust"],
        "conglomerate": True,
        "publicly_traded": True,
    },
    "new york times": {
        "parent_chain": ["The New York Times", "The New York Times Company"],
        "conglomerate": False,
        "publicly_traded": True,
        "controlling_family": "Sulzberger",
    },
    "washington post": {
        "parent_chain": ["The Washington Post", "Nash Holdings"],
        "conglomerate": False,
        "publicly_traded": False,
        "controlling_individual": "Jeff Bezos",
    },
    "bbc": {
        "parent_chain": ["BBC"],
        "conglomerate": False,
        "publicly_traded": False,
        "public_broadcaster": True,
    },
    "npr": {
        "parent_chain": ["NPR"],
        "conglomerate": False,
        "publicly_traded": False,
        "nonprofit": True,
    },
    "reuters": {
        "parent_chain": ["Reuters", "Thomson Reuters"],
        "conglomerate": True,
        "publicly_traded": True,
    },
    "associated press": {
        "parent_chain": ["Associated Press"],
        "conglomerate": False,
        "publicly_traded": False,
        "cooperative": True,
    },
    "al jazeera": {
        "parent_chain": [
            "Al Jazeera",
            "Al Jazeera Media Network",
            "Government of Qatar",
        ],
        "conglomerate": False,
        "publicly_traded": False,
        "state_funded": True,
    },
    "rt": {
        "parent_chain": ["RT", "TV-Novosti", "Russian Government"],
        "conglomerate": False,
        "publicly_traded": False,
        "state_funded": True,
        "state_controlled": True,
    },
}

KNOWN_FUNDING_TYPES: Dict[str, str] = {
    "commercial": "advertising",
    "public": "public_funding",
    "non-profit": "donations_grants",
    "state-funded": "government",
    "independent": "mixed",
}


class FilterScore:
    """A single filter's scored result."""

    def __init__(
        self,
        filter_name: str,
        score: int,
        confidence: str,
        prose: str,
        citations: List[Dict[str, str]],
        empirical_basis: str,
    ):
        self.filter_name = filter_name
        self.score = max(1, min(5, score))  # clamp 1-5
        self.confidence = confidence
        self.prose = prose
        self.citations = citations
        self.empirical_basis = empirical_basis

    def to_dict(self) -> Dict[str, Any]:
        return {
            "filter_name": self.filter_name,
            "score": self.score,
            "confidence": self.confidence,
            "prose_explanation": self.prose,
            "citations": self.citations,
            "empirical_basis": self.empirical_basis,
        }


class ScoringResult:
    """Container for filter scores and optional org metadata updates."""

    def __init__(
        self,
        scores: List[FilterScore],
        org_updates: Optional[Dict[str, Any]] = None,
    ):
        self.scores = scores
        self.org_updates = org_updates


class PropagandaFilterScorer:
    """Scores sources on the six propaganda filters."""

    def __init__(self):
        self.client = get_openai_client()

    async def score_source(
        self,
        source_name: str,
        org_data: Optional[Dict[str, Any]] = None,
        source_metadata: Optional[Dict[str, Any]] = None,
        article_corpus_stats: Optional[Dict[str, Any]] = None,
    ) -> "ScoringResult":
        """Score a source on all six filters, optionally enhancing org metadata.

        When org_data has research_confidence != "high", the LLM call also
        returns org metadata fields so we avoid a second API call.

        Args:
            source_name: display name of the source
            org_data: pre-fetched organization/funding data (optional)
            source_metadata: SourceMetadata row as dict (optional)
            article_corpus_stats: stats about articles in our DB (optional)

        Returns:
            ScoringResult with filter scores and optional org metadata updates
        """
        logger.info("Scoring propaganda filters for: %s", source_name)

        context = self._build_context(
            source_name, org_data, source_metadata, article_corpus_stats
        )

        needs_org_enhancement = (
            org_data is not None and org_data.get("research_confidence") != "high"
        )

        # Score empirical filters first (ownership, advertising)
        ownership_score = self._score_ownership(source_name, context)
        advertising_score = self._score_advertising(source_name, context)

        # LLM-scored filters (+ org metadata when needed)
        llm_result = await self._llm_score_filters(
            source_name, context, include_org_metadata=needs_org_enhancement
        )
        llm_scores = llm_result["scores"]
        org_updates = llm_result.get("org_updates")

        scores = [ownership_score, advertising_score]
        for filter_name in ["sourcing", "flak", "ideology", "class_interest"]:
            if filter_name in llm_scores:
                scores.append(llm_scores[filter_name])
            else:
                scores.append(
                    FilterScore(
                        filter_name=filter_name,
                        score=3,
                        confidence="low",
                        prose="Insufficient data to score this filter.",
                        citations=[],
                        empirical_basis="No empirical data available. Score defaulted to 3 (neutral) rather than guessing.",
                    )
                )

        return ScoringResult(scores=scores, org_updates=org_updates)

    def _build_context(
        self,
        source_name: str,
        org_data: Optional[Dict[str, Any]],
        source_metadata: Optional[Dict[str, Any]],
        article_corpus_stats: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Aggregate all available data into a context dict for scoring."""
        ctx: Dict[str, Any] = {"source_name": source_name}

        normalized = source_name.lower().strip()

        # Known ownership data
        for key, data in KNOWN_OWNERSHIP_DEPTH.items():
            if key in normalized or normalized in key:
                ctx["ownership_data"] = data
                break

        if org_data:
            ctx["org_data"] = org_data
        if source_metadata:
            ctx["source_metadata"] = source_metadata
        if article_corpus_stats:
            ctx["corpus_stats"] = article_corpus_stats

        return ctx

    def _score_ownership(
        self, source_name: str, context: Dict[str, Any]
    ) -> FilterScore:
        """Score Filter 1: Ownership concentration.

        Mostly empirical: based on corporate structure depth, conglomerate
        membership, and whether the source is publicly traded.
        """
        ownership = context.get("ownership_data", {})
        org = context.get("org_data", {})
        citations: List[Dict[str, str]] = []

        if not ownership and not org:
            return FilterScore(
                filter_name="ownership",
                score=3,
                confidence="low",
                prose=f"Ownership structure for {source_name} has not been researched yet. Score defaults to 3 (neutral) pending investigation.",
                citations=[],
                empirical_basis="No ownership data available.",
            )

        # Scoring logic
        score = 1  # Start at most independent
        reasoning_parts: List[str] = []
        empirical_parts: List[str] = []

        parent_chain = ownership.get("parent_chain", [])
        chain_depth = len(parent_chain)

        # Corporate depth adds to score
        if chain_depth >= 3:
            score += 2
            reasoning_parts.append(
                f"Ownership chain has {chain_depth} levels ({' -> '.join(parent_chain)}), indicating significant corporate concentration."
            )
            empirical_parts.append(f"Ownership chain depth: {chain_depth} levels.")
        elif chain_depth == 2:
            score += 1
            parent = (
                parent_chain[-1]
                if parent_chain
                else org.get("parent_org", "unknown parent")
            )
            reasoning_parts.append(f"Owned by {parent}. Single-level parent ownership.")
            empirical_parts.append(f"Parent company: {parent}.")

        if ownership.get("conglomerate"):
            score += 1
            reasoning_parts.append(
                "Part of a media conglomerate with diversified holdings."
            )
            empirical_parts.append("Conglomerate membership: yes.")

        if ownership.get("publicly_traded"):
            score += 1
            reasoning_parts.append(
                "Publicly traded, subject to shareholder profit pressures."
            )
            empirical_parts.append("Publicly traded: yes.")

        if ownership.get("state_controlled"):
            score = 5
            reasoning_parts = [
                f"{source_name} is directly controlled by a state government, "
                "representing maximum ownership concentration in a single entity."
            ]
            empirical_parts = ["State-controlled media outlet."]

        if ownership.get("cooperative"):
            score = max(1, score - 2)
            reasoning_parts.append(
                "Organized as a cooperative, distributing ownership across member organizations."
            )
            empirical_parts.append("Cooperative ownership structure.")

        if ownership.get("nonprofit"):
            score = max(1, score - 1)
            reasoning_parts.append(
                "Non-profit structure reduces profit-driven ownership pressures."
            )
            empirical_parts.append("Non-profit status: yes.")

        if ownership.get("public_broadcaster"):
            score = max(1, score - 1)
            reasoning_parts.append(
                "Public broadcaster with charter-based editorial independence mandate."
            )
            empirical_parts.append("Public broadcaster status: yes.")

        # Controlling individual/family adds a point
        controlling = ownership.get("controlling_individual") or ownership.get(
            "controlling_family"
        )
        if controlling:
            score += 1
            reasoning_parts.append(
                f"Controlled by {controlling}, concentrating editorial power in a single entity."
            )
            empirical_parts.append(f"Controlling entity: {controlling}.")

        score = max(1, min(5, score))

        # Build citations from org_data
        if org.get("wikipedia_url"):
            citations.append(
                {"url": org["wikipedia_url"], "title": f"{source_name} - Wikipedia"}
            )
        if org.get("wikidata_url"):
            citations.append(
                {"url": org["wikidata_url"], "title": f"{source_name} - Wikidata"}
            )

        return FilterScore(
            filter_name="ownership",
            score=score,
            confidence="high" if ownership else "medium",
            prose=" ".join(reasoning_parts)
            if reasoning_parts
            else f"Limited ownership data available for {source_name}.",
            citations=citations,
            empirical_basis=" ".join(empirical_parts)
            if empirical_parts
            else "Ownership data derived from known corporate records.",
        )

    def _score_advertising(
        self, source_name: str, context: Dict[str, Any]
    ) -> FilterScore:
        """Score Filter 2: Advertising dependency.

        Semi-empirical: based on funding type and known advertiser data.
        """
        org = context.get("org_data", {})
        metadata = context.get("source_metadata", {})
        citations: List[Dict[str, str]] = []

        funding_type = (
            org.get("funding_type") or metadata.get("funding_type") or ""
        ).lower()

        score = 3  # default neutral
        reasoning_parts: List[str] = []
        empirical_parts: List[str] = []

        if funding_type in ("commercial", ""):
            score = 4
            reasoning_parts.append(
                f"{source_name} operates on a commercial model, "
                "making it dependent on advertising revenue and susceptible "
                "to advertiser pressure on editorial content."
            )
            empirical_parts.append(
                f"Funding type: {funding_type or 'presumed commercial'}."
            )

            # Major advertisers increase score
            advertisers = org.get("major_advertisers") or []
            if advertisers:
                score = 5
                reasoning_parts.append(
                    f"Known major advertisers: {', '.join(advertisers[:5])}. "
                    "Dependence on large corporate advertisers creates structural "
                    "incentives to avoid coverage that threatens ad revenue."
                )
                empirical_parts.append(
                    f"Major advertisers identified: {len(advertisers)}."
                )

        elif funding_type == "public":
            score = 2
            reasoning_parts.append(
                f"{source_name} is publicly funded, significantly reducing "
                "advertising dependency. However, public funding creates its "
                "own dependency on government budget allocation."
            )
            empirical_parts.append("Funding type: public broadcasting.")

        elif funding_type == "non-profit":
            score = 2
            reasoning_parts.append(
                f"{source_name} operates as a non-profit, reducing direct "
                "advertiser influence. Donor dependency may create different "
                "but analogous pressures."
            )
            empirical_parts.append("Funding type: non-profit.")

            # Check for donor data
            donors = org.get("top_donors") or []
            if donors:
                score = 3
                reasoning_parts.append(
                    f"Major donors identified: {len(donors)}. "
                    "Large donor influence functions similarly to advertiser "
                    "pressure in Chomsky's model."
                )

        elif funding_type in ("state-funded", "state-affiliated"):
            score = 2
            reasoning_parts.append(
                f"{source_name} is state-funded, eliminating commercial "
                "advertising dependency. State funding substitutes government "
                "influence for advertiser influence."
            )
            empirical_parts.append("Funding type: state-funded.")

        elif funding_type == "independent":
            score = 2
            reasoning_parts.append(
                f"{source_name} operates independently with diversified "
                "or reader-supported funding."
            )
            empirical_parts.append("Funding type: independent.")

        return FilterScore(
            filter_name="advertising",
            score=max(1, min(5, score)),
            confidence="medium" if funding_type else "low",
            prose=" ".join(reasoning_parts),
            citations=citations,
            empirical_basis=" ".join(empirical_parts)
            if empirical_parts
            else "No detailed advertising/funding data available.",
        )

    async def _llm_score_filters(
        self,
        source_name: str,
        context: Dict[str, Any],
        include_org_metadata: bool = False,
    ) -> Dict[str, Any]:
        """Use LLM to score the harder-to-measure filters: sourcing, flak, ideology, class_interest.

        When include_org_metadata is True, the prompt also asks for org metadata
        (funding_type, parent_org, media_bias_rating, factual_reporting) to avoid
        a separate LLM call for org enhancement.

        Returns dict with "scores" (Dict[str, FilterScore]) and optional "org_updates" (Dict).
        """
        if not self.client:
            logger.warning("No LLM client available; skipping LLM-scored filters")
            return {"scores": {}}

        context_summary = self._format_context_for_llm(source_name, context)

        org_metadata_section = ""
        org_json_section = ""
        if include_org_metadata:
            org_data = context.get("org_data", {})
            org_metadata_section = f"""
ADDITIONAL TASK - ORGANIZATION METADATA:
The following organization fields are incomplete. Based on your knowledge
of {source_name}, provide best-effort values for any missing fields.
Currently known:
- Funding type: {org_data.get("funding_type", "Unknown")}
- Parent organization: {org_data.get("parent_org", "Unknown")}
- Media bias rating: {org_data.get("media_bias_rating", "Unknown")}
- Factual reporting: {org_data.get("factual_reporting", "Unknown")}
"""
            org_json_section = """,
  "organization": {{
    "funding_type": "commercial|public|non-profit|state-funded|independent",
    "parent_org": "Parent Company Name or null",
    "media_bias_rating": "left|center-left|center|center-right|right",
    "factual_reporting": "very-high|high|mixed|low|very-low"
  }}"""

        prompt = f"""You are a media analyst applying Noam Chomsky's propaganda model
(from Manufacturing Consent) and Michael Parenti's class analysis
(from Inventing Reality) to evaluate a news source.

SOURCE: {source_name}

AVAILABLE CONTEXT:
{context_summary}
{org_metadata_section}
Score this source on these four filters. Each score is 1-5 where:
  1 = minimal filter effect (most independent/diverse)
  5 = maximum filter effect (most constrained/aligned)

For each filter, provide:
- score (integer 1-5)
- confidence (high/medium/low)
- prose (2-3 sentences explaining the reasoning)
- citations (list of URLs or references that support the analysis)
- empirical_basis (what is measured vs inferred)

FILTERS TO SCORE:

3. SOURCING (Chomsky Filter 3):
   How much does this source rely on official/government/corporate sources
   vs independent/grassroots/expert sources? Heavy reliance on official
   sources means information is pre-filtered by power structures.

4. FLAK (Chomsky Filter 4):
   How vulnerable is this source to organized pressure campaigns,
   advertiser boycotts, government pressure, or institutional backlash?
   Has it historically capitulated to or resisted flak?

5. IDEOLOGY (Chomsky Filter 5):
   How rigid is the ideological framing? Does the source present a
   consistent ideological lens (market fundamentalism, nationalism, etc.)
   or allow diverse analytical frameworks?

6. CLASS INTEREST (Parenti):
   Does this source cover labor issues, wealth inequality, corporate
   accountability, and class dynamics? Or does it systematically normalize
   existing power structures and avoid class analysis?

Respond ONLY with valid JSON (no markdown):
{{
  "sourcing": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }},
  "flak": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }},
  "ideology": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }},
  "class_interest": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }}{org_json_section}
}}"""

        try:
            response = self.client.chat.completions.create(
                model=settings.open_router_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2500 if include_org_metadata else 2000,
                temperature=0.3,
            )

            content = response.choices[0].message.content or ""
            json_match = re.search(r"\{[\s\S]*\}", content)
            if not json_match:
                logger.error("No JSON found in LLM response for %s", source_name)
                return {"scores": {}}

            data = json.loads(json_match.group())
            results: Dict[str, FilterScore] = {}

            for filter_name in ["sourcing", "flak", "ideology", "class_interest"]:
                filter_data = data.get(filter_name, {})
                if not filter_data:
                    continue

                results[filter_name] = FilterScore(
                    filter_name=filter_name,
                    score=int(filter_data.get("score", 3)),
                    confidence=filter_data.get("confidence", "low"),
                    prose=filter_data.get("prose", ""),
                    citations=filter_data.get("citations", []),
                    empirical_basis=filter_data.get(
                        "empirical_basis",
                        "This score is primarily based on LLM analysis and should be verified with empirical research.",
                    ),
                )

            output: Dict[str, Any] = {"scores": results}

            if include_org_metadata and "organization" in data:
                output["org_updates"] = data["organization"]
                logger.info(
                    "LLM returned org metadata for %s: %s",
                    source_name,
                    list(data["organization"].keys()),
                )

            return output

        except json.JSONDecodeError as exc:
            logger.error("Failed to parse LLM JSON for %s: %s", source_name, exc)
            return {"scores": {}}
        except Exception as exc:
            logger.error("LLM scoring failed for %s: %s", source_name, exc)
            return {"scores": {}}

    def _format_context_for_llm(self, source_name: str, context: Dict[str, Any]) -> str:
        """Format available context into a readable summary for the LLM prompt."""
        parts: List[str] = []

        ownership = context.get("ownership_data", {})
        if ownership:
            chain = ownership.get("parent_chain", [])
            if chain:
                parts.append(f"Ownership chain: {' -> '.join(chain)}")
            if ownership.get("publicly_traded"):
                parts.append("Publicly traded: yes")
            if ownership.get("state_funded"):
                parts.append("State-funded: yes")
            if ownership.get("state_controlled"):
                parts.append("State-controlled: yes")
            if ownership.get("cooperative"):
                parts.append("Cooperative: yes")
            if ownership.get("nonprofit"):
                parts.append("Non-profit: yes")

        org = context.get("org_data", {})
        if org:
            if org.get("funding_type"):
                parts.append(f"Funding type: {org['funding_type']}")
            if org.get("media_bias_rating"):
                parts.append(f"Media bias rating: {org['media_bias_rating']}")
            if org.get("factual_reporting"):
                parts.append(f"Factual reporting: {org['factual_reporting']}")
            if org.get("parent_org"):
                parts.append(f"Parent organization: {org['parent_org']}")
            advertisers = org.get("major_advertisers", [])
            if advertisers:
                parts.append(f"Major advertisers: {', '.join(advertisers[:5])}")

        metadata = context.get("source_metadata", {})
        if metadata:
            if metadata.get("country"):
                parts.append(f"Country: {metadata['country']}")
            if metadata.get("source_type"):
                parts.append(f"Source type: {metadata['source_type']}")
            if metadata.get("is_state_media"):
                parts.append("State media: yes")
            if metadata.get("political_bias"):
                parts.append(f"Political bias: {metadata['political_bias']}")

        corpus = context.get("corpus_stats", {})
        if corpus:
            if corpus.get("article_count"):
                parts.append(f"Articles in our database: {corpus['article_count']}")
            if corpus.get("top_categories"):
                parts.append(
                    f"Top categories: {', '.join(corpus['top_categories'][:5])}"
                )

        if not parts:
            return "No structured data available. Score based on general knowledge of this source."

        return "\n".join(parts)


# Singleton
_scorer: Optional[PropagandaFilterScorer] = None


def get_propaganda_scorer() -> PropagandaFilterScorer:
    global _scorer
    if _scorer is None:
        _scorer = PropagandaFilterScorer()
    return _scorer
