"""
Source analysis scorer for the Media Accountability Wiki.

Scores each news source on five axes:
1. funding
2. source_network
3. political_bias
4. credibility
5. framing_omission
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional, cast

from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.core.config import get_llamacpp_model, get_openai_client, settings
from app.core.logging import get_logger
from app.services.prompting import (
    COPY_STYLE_GUIDE,
    build_json_system_prompt,
    compose_prompt_blocks,
)

logger = get_logger("source_analysis_scorer")

SCORER_SYSTEM_PROMPT = build_json_system_prompt(
    role="media systems analyst",
    task=(
        "Score a news source against a five-axis source-analysis rubric using the "
        "supplied context."
    ),
    output_rules=compose_prompt_blocks(
        "Return valid JSON only. No markdown fences or extra prose.",
        "Keep prose direct, specific, and evidence-based.",
    ),
)

ANALYSIS_AXIS_NAMES = [
    "funding",
    "source_network",
    "political_bias",
    "credibility",
    "framing_omission",
]


class AnalysisAxisScore:
    """A single source-analysis axis result."""

    def __init__(
        self,
        axis_name: str,
        score: int,
        confidence: str,
        prose: str,
        citations: List[Dict[str, str]],
        empirical_basis: str,
        scored_by: str = "llm",
    ):
        self.axis_name = axis_name
        self.score = max(1, min(5, score))
        self.confidence = confidence
        self.prose = prose
        self.citations = citations
        self.empirical_basis = empirical_basis
        self.scored_by = scored_by

    def to_dict(self) -> Dict[str, Any]:
        return {
            "axis_name": self.axis_name,
            "score": self.score,
            "confidence": self.confidence,
            "prose_explanation": self.prose,
            "citations": self.citations,
            "empirical_basis": self.empirical_basis,
            "scored_by": self.scored_by,
        }


class SourceAnalysisResult:
    """Container for axis scores and optional org metadata updates."""

    def __init__(
        self,
        scores: List[AnalysisAxisScore],
        org_updates: Optional[Dict[str, Any]] = None,
    ):
        self.scores = scores
        self.org_updates = org_updates


class SourceAnalysisScorer:
    """Scores sources on the five source-analysis axes."""

    def __init__(self) -> None:
        self.client: OpenAI | None = get_openai_client()

    async def score_source(
        self,
        source_name: str,
        org_data: Optional[Dict[str, Any]] = None,
        source_metadata: Optional[Dict[str, Any]] = None,
        article_corpus_stats: Optional[Dict[str, Any]] = None,
    ) -> SourceAnalysisResult:
        logger.info("Scoring source analysis for: %s", source_name)

        context = self._build_context(
            source_name, org_data, source_metadata, article_corpus_stats
        )

        needs_org_enhancement = (
            org_data is not None and org_data.get("research_confidence") != "high"
        )

        funding_score = self._score_funding(source_name, context)
        credibility_score = self._score_credibility(source_name, context)

        llm_result = await self._llm_score_axes(
            source_name, context, include_org_metadata=needs_org_enhancement
        )
        llm_scores = llm_result["scores"]
        org_updates = llm_result.get("org_updates")

        scores = [funding_score]
        for axis_name in ["source_network", "political_bias", "framing_omission"]:
            if axis_name in llm_scores:
                scores.append(llm_scores[axis_name])
            else:
                scores.append(
                    AnalysisAxisScore(
                        axis_name=axis_name,
                        score=3,
                        confidence="low",
                        prose="Insufficient data to score this axis.",
                        citations=[],
                        empirical_basis=(
                            "No empirical data available. Score defaulted to 3 "
                            "(neutral risk) rather than guessing."
                        ),
                    )
                )
        scores.append(credibility_score)

        return SourceAnalysisResult(scores=scores, org_updates=org_updates)

    def _build_context(
        self,
        source_name: str,
        org_data: Optional[Dict[str, Any]],
        source_metadata: Optional[Dict[str, Any]],
        article_corpus_stats: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        ctx: Dict[str, Any] = {"source_name": source_name}
        if org_data:
            ctx["org_data"] = org_data
        if source_metadata:
            ctx["source_metadata"] = source_metadata
        if article_corpus_stats:
            ctx["corpus_stats"] = article_corpus_stats
        return ctx

    def _score_funding(
        self, source_name: str, context: Dict[str, Any]
    ) -> AnalysisAxisScore:
        org = context.get("org_data", {})
        metadata = context.get("source_metadata", {})

        funding_type = (
            org.get("funding_type") or metadata.get("funding_type") or ""
        ).lower()
        citations: List[Dict[str, str]] = []
        if org.get("wikipedia_url"):
            citations.append(
                {"url": org["wikipedia_url"], "title": f"{source_name} funding context"}
            )

        if funding_type in {"state-funded", "state-affiliated", "state"}:
            return AnalysisAxisScore(
                axis_name="funding",
                score=5,
                confidence="high",
                prose=(
                    f"{source_name} relies on state-linked funding, which creates a high "
                    "risk of structural alignment with government priorities."
                ),
                citations=citations,
                empirical_basis="Funding type is recorded as state-linked.",
                scored_by="data",
            )
        if funding_type in {"commercial", "corporate"}:
            return AnalysisAxisScore(
                axis_name="funding",
                score=4,
                confidence="high",
                prose=(
                    f"{source_name} operates on a commercial funding model, which creates "
                    "pressure from owners, advertisers, and audience retention."
                ),
                citations=citations,
                empirical_basis="Funding type is recorded as commercial.",
                scored_by="data",
            )
        if funding_type in {"public", "public broadcaster"}:
            return AnalysisAxisScore(
                axis_name="funding",
                score=3,
                confidence="medium",
                prose=(
                    f"{source_name} has public funding support. That reduces direct ad "
                    "pressure but still leaves budget and institutional pressures."
                ),
                citations=citations,
                empirical_basis="Funding type is recorded as public.",
                scored_by="data",
            )
        if funding_type in {"non-profit", "nonprofit", "independent"}:
            return AnalysisAxisScore(
                axis_name="funding",
                score=2,
                confidence="medium",
                prose=(
                    f"{source_name} is described as non-profit or independent, which lowers "
                    "some market pressure but can still introduce donor or network dependence."
                ),
                citations=citations,
                empirical_basis=f"Funding type is recorded as {funding_type}.",
                scored_by="data",
            )
        return AnalysisAxisScore(
            axis_name="funding",
            score=3,
            confidence="low",
            prose=(
                f"Funding details for {source_name} are incomplete, so this axis defaults "
                "to a neutral risk score until the funding model is verified."
            ),
            citations=citations,
            empirical_basis="No verified funding type was available.",
            scored_by="data",
        )

    def _score_credibility(
        self, source_name: str, context: Dict[str, Any]
    ) -> AnalysisAxisScore:
        org = context.get("org_data", {})
        metadata = context.get("source_metadata", {})

        credibility_score = metadata.get("credibility_score")
        factual_reporting = (org.get("factual_reporting") or "").lower()
        citations: List[Dict[str, str]] = []
        if org.get("wikipedia_url"):
            citations.append(
                {"url": org["wikipedia_url"], "title": f"{source_name} profile"}
            )

        if isinstance(credibility_score, (int, float)):
            if credibility_score >= 0.9:
                score = 1
            elif credibility_score >= 0.8:
                score = 2
            elif credibility_score >= 0.65:
                score = 3
            elif credibility_score >= 0.5:
                score = 4
            else:
                score = 5
            return AnalysisAxisScore(
                axis_name="credibility",
                score=score,
                confidence="high",
                prose=(
                    f"{source_name} has a recorded credibility score of "
                    f"{float(credibility_score):.2f}. Higher risk here means lower factual "
                    "reliability or weaker correction discipline."
                ),
                citations=citations,
                empirical_basis=(
                    f"Credibility risk is derived from stored credibility_score="
                    f"{float(credibility_score):.2f}."
                ),
                scored_by="data",
            )

        factual_map = {
            "very-high": 1,
            "high": 2,
            "mixed": 3,
            "low": 4,
            "very-low": 5,
        }
        if factual_reporting in factual_map:
            return AnalysisAxisScore(
                axis_name="credibility",
                score=factual_map[factual_reporting],
                confidence="medium",
                prose=(
                    f"{source_name} does not have a stored credibility score, so this axis "
                    f"falls back to the factual-reporting label '{factual_reporting}'."
                ),
                citations=citations,
                empirical_basis=(
                    f"Credibility risk is inferred from factual_reporting={factual_reporting}."
                ),
                scored_by="data",
            )

        return AnalysisAxisScore(
            axis_name="credibility",
            score=3,
            confidence="low",
            prose=(
                f"Credibility data for {source_name} is incomplete, so this axis defaults "
                "to a neutral risk score pending stronger evidence."
            ),
            citations=citations,
            empirical_basis="No verified credibility or factual-reporting data was available.",
            scored_by="data",
        )

    async def _llm_score_axes(
        self,
        source_name: str,
        context: Dict[str, Any],
        include_org_metadata: bool = False,
    ) -> Dict[str, Any]:
        if not self.client:
            logger.warning("No LLM client available; skipping LLM-scored axes")
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

        prompt = f"""SOURCE: {source_name}

AVAILABLE CONTEXT:
{context_summary}
{org_metadata_section}
Score this source on these three axes. Each score is 1-5 where:
  1 = low structural bias/risk
  5 = high structural bias/risk

For each axis, provide:
- score (integer 1-5)
- confidence (high/medium/low)
- prose (2-3 sentences explaining the reasoning)
- citations (list of URLs or references that support the analysis)
- empirical_basis (what is measured vs inferred)

AXES TO SCORE:

1. SOURCE_NETWORK:
   Where does this outlet get information from? Weigh official state and
   corporate sources against local reporting, on-the-ground reporting,
   diaspora voices, NGOs, scholars, and independent experts. If the outlet
   covers a country through diaspora voices more than people inside that
   country, say so directly.

2. POLITICAL_BIAS:
   What recurring ideological or partisan orientation appears in the
   outlet's framing, sourcing choices, and editorial stance?

3. FRAMING_OMISSION:
   Does the outlet lean on omission, loaded wording, euphemism, selective
   emphasis, or odd language that nudges the reader toward a preferred view?

{COPY_STYLE_GUIDE}

Respond ONLY with valid JSON (no markdown):
{{
  "source_network": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }},
  "political_bias": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }},
  "framing_omission": {{
    "score": 3,
    "confidence": "medium",
    "prose": "...",
    "citations": [{{"url": "...", "title": "..."}}],
    "empirical_basis": "..."
  }}{org_json_section}
}}"""

        try:
            response = self.client.chat.completions.create(
                model=(
                    get_llamacpp_model()
                    if settings.llm_backend == "llamacpp"
                    else settings.open_router_model
                ),
                messages=cast(
                    Iterable[ChatCompletionMessageParam],
                    [
                        {"role": "system", "content": SCORER_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                ),
                max_tokens=2200 if include_org_metadata else 1800,
                temperature=0.3,
            )

            content = response.choices[0].message.content or ""
            finish_reason = (
                response.choices[0].finish_reason if response.choices else "unknown"
            )

            if not content:
                logger.error(
                    "Empty LLM response for %s (finish_reason=%s)",
                    source_name,
                    finish_reason,
                )
                return {"scores": {}}

            json_match = re.search(r"\{[\s\S]*\}", content)
            if not json_match:
                logger.error(
                    "No JSON found in LLM response for %s (finish_reason=%s): %.200s",
                    source_name,
                    finish_reason,
                    content,
                )
                return {"scores": {}}

            data = json.loads(json_match.group())
            results: Dict[str, AnalysisAxisScore] = {}

            for axis_name in ["source_network", "political_bias", "framing_omission"]:
                axis_data = data.get(axis_name, {})
                if not axis_data:
                    logger.warning(
                        "LLM response missing axis '%s' for %s",
                        axis_name,
                        source_name,
                    )
                    continue

                results[axis_name] = AnalysisAxisScore(
                    axis_name=axis_name,
                    score=int(axis_data.get("score", 3)),
                    confidence=axis_data.get("confidence", "low"),
                    prose=axis_data.get("prose", ""),
                    citations=axis_data.get("citations", []),
                    empirical_basis=axis_data.get(
                        "empirical_basis",
                        (
                            "This score is primarily based on LLM analysis and should "
                            "be verified with empirical research."
                        ),
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
        parts: List[str] = []

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
            funding_sources = org.get("funding_sources", [])
            if funding_sources:
                parts.append(f"Funding sources: {', '.join(funding_sources[:5])}")

        metadata = context.get("source_metadata", {})
        if metadata:
            if metadata.get("country"):
                parts.append(f"Country: {metadata['country']}")
            if metadata.get("source_type"):
                parts.append(f"Source type: {metadata['source_type']}")
            if metadata.get("is_state_media"):
                parts.append("State media: yes")
            if metadata.get("political_bias"):
                parts.append(f"Catalog political bias: {metadata['political_bias']}")
            if metadata.get("credibility_score") is not None:
                parts.append(
                    f"Stored credibility score: {metadata['credibility_score']}"
                )

        corpus = context.get("corpus_stats", {})
        if corpus:
            if corpus.get("article_count"):
                parts.append(f"Articles in our database: {corpus['article_count']}")
            if corpus.get("top_categories"):
                parts.append(
                    f"Top categories: {', '.join(corpus['top_categories'][:5])}"
                )

        if not parts:
            return (
                "No structured data available. Score based on general knowledge of this "
                "source."
            )

        return "\n".join(parts)


_scorer: Optional[SourceAnalysisScorer] = None


def get_source_analysis_scorer() -> SourceAnalysisScorer:
    global _scorer
    if _scorer is None:
        _scorer = SourceAnalysisScorer()
    return _scorer
