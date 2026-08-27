"""Five-axis source-analysis scorer for the Media Accountability Wiki."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any, cast

from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.core.config import (
    get_llamacpp_model,
    get_openai_client,
    resolve_opencode_model,
    settings,
)
from app.core.logging import get_logger
from app.services.prompting import COPY_STYLE_GUIDE, build_json_system_prompt, compose_prompt_blocks

logger = get_logger("source_analysis_scorer")

SCORER_SYSTEM_PROMPT = build_json_system_prompt(
    role="media systems analyst",
    task="Score a news source against a five-axis source-analysis rubric using the supplied context.",
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
_LLM_AXES = ("source_network", "political_bias", "framing_omission")


class AnalysisAxisScore:
    """A single source-analysis axis result."""

    def __init__(
        self,
        axis_name: str,
        score: int,
        confidence: str,
        prose: str,
        citations: list[dict[str, str]],
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

    def to_dict(self) -> dict[str, Any]:
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
    """Container for axis scores and optional organization metadata updates."""

    def __init__(
        self,
        scores: list[AnalysisAxisScore],
        org_updates: dict[str, Any] | None = None,
    ):
        self.scores = scores
        self.org_updates = org_updates


def _default_axis(axis_name: str) -> AnalysisAxisScore:
    return AnalysisAxisScore(
        axis_name=axis_name,
        score=3,
        confidence="low",
        prose="Insufficient data to score this axis.",
        citations=[],
        empirical_basis="No empirical data available. Score defaulted to 3 (neutral risk) rather than guessing.",
    )


def _wikipedia_citations(org: dict[str, Any], title: str) -> list[dict[str, str]]:
    url = org.get("wikipedia_url")
    return [{"url": str(url), "title": title}] if url else []


def _ownership_risks(org: dict[str, Any]) -> tuple[list[str], list[Any], list[Any]]:
    parents = org.get("parent_orgs") or []
    owners = org.get("owned_by") or []
    risks: list[str] = []
    if len(parents) == 1 or len(owners) == 1:
        risks.append("single concentrated owner")
    elif len(parents) >= 3 or len(owners) >= 3:
        risks.append("complex multi-owner structure")
    if parents and owners:
        risks.append("vertical integration detected")
    return risks, parents, owners


def _funding_model_adjustment(
    funding_type: str, org: dict[str, Any]
) -> tuple[int, list[str]]:
    if funding_type in {"state-funded", "state"}:
        return 4, ["state-linked funding with uncertain transparency"]
    if funding_type in {"commercial", "corporate"}:
        advertisers = org.get("major_advertisers") or []
        return (
            (3, ["commercial with disclosed advertisers"])
            if advertisers
            else (4, ["commercial but undisclosed advertisers"])
        )
    if funding_type in {"non-profit", "nonprofit", "independent"}:
        donors = org.get("top_donors") or []
        return (
            (2, ["nonprofit with disclosed donors"])
            if donors
            else (3, ["nonprofit with undisclosed donors"])
        )
    if funding_type in {"public", "public broadcaster"}:
        return 3, ["public funding model"]
    return 3, []


def _transparency_adjustment(
    transparency: str, funding_type: str, org: dict[str, Any]
) -> tuple[int, list[str]]:
    decisions = {
        "transparent": (2, ["discloses funding sources publicly"]),
        "partial": (3, ["partial funding disclosure"]),
        "opaque": (4, ["opaque funding structure"]),
        "unknown": (3, ["funding transparency unknown"]),
    }
    return decisions.get(transparency, _funding_model_adjustment(funding_type, org))


def _advertiser_risks(org: dict[str, Any]) -> list[str]:
    advertisers = org.get("major_advertisers") or []
    if not isinstance(advertisers, list):
        return []
    if len(advertisers) >= 5:
        return ["high advertiser diversity"]
    if 1 <= len(advertisers) <= 2:
        return ["heavy reliance on few advertisers"]
    return []


def _funding_confidence(transparency: str, org: dict[str, Any]) -> str:
    if transparency in {"transparent", "partial"}:
        return "high"
    if org.get("funding_type") and not transparency:
        return "medium"
    return "low"


def _credibility_numeric_score(value: float) -> int:
    thresholds = ((0.9, 1), (0.8, 2), (0.65, 3), (0.5, 4))
    return next((score for threshold, score in thresholds if value >= threshold), 5)


def _org_prompt_sections(
    source_name: str, context: dict[str, Any], include: bool
) -> tuple[str, str]:
    if not include:
        return "", ""
    org = context.get("org_data", {})
    metadata = f"""
ADDITIONAL TASK - ORGANIZATION METADATA:
The following organization fields are incomplete. Based on your knowledge
of {source_name}, provide best-effort values for any missing fields.
Currently known:
- Funding type: {org.get('funding_type', 'Unknown')}
- Parent organization: {org.get('parent_org', 'Unknown')}
- Media bias rating: {org.get('media_bias_rating', 'Unknown')}
- Factual reporting: {org.get('factual_reporting', 'Unknown')}
"""
    schema = """,
  "organization": {
    "funding_type": "commercial|public|non-profit|state-funded|independent",
    "parent_org": "Parent Company Name or null",
    "media_bias_rating": "left|center-left|center|center-right|right",
    "factual_reporting": "very-high|high|mixed|low|very-low"
  }"""
    return metadata, schema


def _llm_prompt(
    source_name: str,
    context_summary: str,
    org_metadata_section: str,
    org_json_section: str,
) -> str:
    return f"""SOURCE: {source_name}

AVAILABLE CONTEXT:
{context_summary}
{org_metadata_section}
Score this source on these three axes. Each score is 1-5 where 1 is low structural risk and 5 is high structural risk.
For each axis provide score, confidence, prose, citations, and empirical_basis.

SOURCE_NETWORK: weigh official state/corporate sourcing against local reporting, on-the-ground reporting, diaspora voices, NGOs, scholars, and independent experts.
POLITICAL_BIAS: assess recurring ideological or partisan orientation in framing, sourcing, and editorial stance.
FRAMING_OMISSION: assess omission, loaded wording, euphemism, selective emphasis, and language that nudges readers toward a preferred view.

{COPY_STYLE_GUIDE}

Respond ONLY with valid JSON:
{{
  "source_network": {{"score": 3, "confidence": "medium", "prose": "...", "citations": [], "empirical_basis": "..."}},
  "political_bias": {{"score": 3, "confidence": "medium", "prose": "...", "citations": [], "empirical_basis": "..."}},
  "framing_omission": {{"score": 3, "confidence": "medium", "prose": "...", "citations": [], "empirical_basis": "..."}}{org_json_section}
}}"""


def _extract_json_payload(content: str) -> dict[str, Any] | None:
    match = re.search(r"\{[\s\S]*\}", content)
    if not match:
        return None
    try:
        payload = json.loads(match.group())
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _axis_from_llm(axis_name: str, data: dict[str, Any]) -> AnalysisAxisScore | None:
    axis = data.get(axis_name)
    if not isinstance(axis, dict) or not axis:
        return None
    return AnalysisAxisScore(
        axis_name=axis_name,
        score=int(axis.get("score", 3)),
        confidence=str(axis.get("confidence", "low")),
        prose=str(axis.get("prose", "")),
        citations=axis.get("citations", []) if isinstance(axis.get("citations", []), list) else [],
        empirical_basis=str(
            axis.get(
                "empirical_basis",
                "This score is primarily based on LLM analysis and should be verified with empirical research.",
            )
        ),
    )


class SourceAnalysisScorer:
    """Score sources on funding, network, bias, credibility, and framing risk."""

    def __init__(self) -> None:
        self.client: OpenAI | None = get_openai_client()

    async def score_source(
        self,
        source_name: str,
        org_data: dict[str, Any] | None = None,
        source_metadata: dict[str, Any] | None = None,
        article_corpus_stats: dict[str, Any] | None = None,
    ) -> SourceAnalysisResult:
        context = self._build_context(source_name, org_data, source_metadata, article_corpus_stats)
        needs_org_enhancement = bool(
            org_data is not None and org_data.get("research_confidence") != "high"
        )
        llm_result = await self._llm_score_axes(
            source_name, context, include_org_metadata=needs_org_enhancement
        )
        llm_scores = llm_result["scores"]
        scores = [self._score_funding(source_name, context)]
        scores.extend(llm_scores.get(axis, _default_axis(axis)) for axis in _LLM_AXES)
        scores.append(self._score_credibility(source_name, context))
        return SourceAnalysisResult(scores=scores, org_updates=llm_result.get("org_updates"))

    def _build_context(
        self,
        source_name: str,
        org_data: dict[str, Any] | None,
        source_metadata: dict[str, Any] | None,
        article_corpus_stats: dict[str, Any] | None,
    ) -> dict[str, Any]:
        context: dict[str, Any] = {"source_name": source_name}
        optional = {
            "org_data": org_data,
            "source_metadata": source_metadata,
            "corpus_stats": article_corpus_stats,
        }
        context.update({key: value for key, value in optional.items() if value})
        return context

    def _score_funding(self, source_name: str, context: dict[str, Any]) -> AnalysisAxisScore:
        """Score funding transparency and structural concentration, not funding ideology."""
        org = context.get("org_data", {})
        metadata = context.get("source_metadata", {})
        funding_type = str(org.get("funding_type") or metadata.get("funding_type") or "").lower()
        transparency = str(org.get("funding_transparency") or "").lower()
        ownership_risks, parents, owners = _ownership_risks(org)
        score, transparency_risks = _transparency_adjustment(transparency, funding_type, org)
        risks = ownership_risks + transparency_risks + _advertiser_risks(org)
        if parents and owners:
            score = max(score, 4)
        advertisers = org.get("major_advertisers") or []
        summary = "; ".join(risks) if risks else "minimal funding data available"
        return AnalysisAxisScore(
            axis_name="funding",
            score=score,
            confidence=_funding_confidence(transparency, org),
            prose=(
                f"{source_name} funding risk analysis: {summary}. Score {score}/5 reflects "
                "transparency and concentration of the funding structure, not the funding model itself."
            ),
            citations=_wikipedia_citations(org, f"{source_name} funding context"),
            empirical_basis=(
                f"Funding transparency={transparency or 'missing'}, funding_type={funding_type or 'missing'}, "
                f"observed parent_orgs={len(parents)}, disclosed advertisers="
                f"{len(advertisers) if isinstance(advertisers, list) else 0}."
            ),
            scored_by="data",
        )

    def _score_credibility(self, source_name: str, context: dict[str, Any]) -> AnalysisAxisScore:
        org = context.get("org_data", {})
        metadata = context.get("source_metadata", {})
        credibility = metadata.get("credibility_score")
        citations = _wikipedia_citations(org, f"{source_name} profile")
        if isinstance(credibility, (int, float)):
            value = float(credibility)
            return AnalysisAxisScore(
                "credibility",
                _credibility_numeric_score(value),
                "high",
                f"{source_name} has a recorded credibility score of {value:.2f}.",
                citations,
                f"Credibility risk is derived from stored credibility_score={value:.2f}.",
                "data",
            )
        factual = str(org.get("factual_reporting") or "").lower()
        factual_map = {"very-high": 1, "high": 2, "mixed": 3, "low": 4, "very-low": 5}
        if factual in factual_map:
            return AnalysisAxisScore(
                "credibility",
                factual_map[factual],
                "medium",
                f"{source_name} lacks a stored credibility score, so this axis uses factual-reporting label '{factual}'.",
                citations,
                f"Credibility risk is inferred from factual_reporting={factual}.",
                "data",
            )
        return AnalysisAxisScore(
            "credibility",
            3,
            "low",
            f"Credibility data for {source_name} is incomplete, so this axis defaults to neutral risk.",
            citations,
            "No verified credibility or factual-reporting data was available.",
            "data",
        )

    def _model_name(self) -> str:
        return (
            get_llamacpp_model()
            if settings.llm_backend == "llamacpp"
            else resolve_opencode_model(settings.open_router_model)
        )

    def _invoke_llm(self, prompt: str, include_org_metadata: bool) -> str:
        assert self.client is not None
        response = self.client.chat.completions.create(
            model=self._model_name(),
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
        return response.choices[0].message.content or ""

    def _parsed_llm_output(
        self, source_name: str, content: str, include_org_metadata: bool
    ) -> dict[str, Any]:
        payload = _extract_json_payload(content)
        if payload is None:
            logger.error("No valid JSON found in LLM response for %s", source_name)
            return {"scores": {}}
        scores = {
            axis: parsed
            for axis in _LLM_AXES
            if (parsed := _axis_from_llm(axis, payload)) is not None
        }
        output: dict[str, Any] = {"scores": scores}
        organization = payload.get("organization")
        if include_org_metadata and isinstance(organization, dict):
            output["org_updates"] = organization
        return output

    async def _llm_score_axes(
        self,
        source_name: str,
        context: dict[str, Any],
        include_org_metadata: bool = False,
    ) -> dict[str, Any]:
        if not self.client:
            logger.warning("No LLM client available; skipping LLM-scored axes")
            return {"scores": {}}
        org_metadata, org_schema = _org_prompt_sections(
            source_name, context, include_org_metadata
        )
        prompt = _llm_prompt(
            source_name,
            self._format_context_for_llm(source_name, context),
            org_metadata,
            org_schema,
        )
        try:
            return self._parsed_llm_output(
                source_name,
                self._invoke_llm(prompt, include_org_metadata),
                include_org_metadata,
            )
        except Exception as exc:
            logger.error("LLM scoring failed for %s: %s", source_name, exc)
            return {"scores": {}}

    @staticmethod
    def _org_context_parts(org: dict[str, Any]) -> list[str]:
        scalar_fields = (
            ("funding_type", "Funding type"),
            ("media_bias_rating", "Media bias rating"),
            ("factual_reporting", "Factual reporting"),
            ("parent_org", "Parent organization"),
        )
        parts = [f"{label}: {org[key]}" for key, label in scalar_fields if org.get(key)]
        advertisers = org.get("major_advertisers") or []
        funding_sources = org.get("funding_sources") or []
        if advertisers:
            parts.append(f"Major advertisers: {', '.join(map(str, advertisers[:5]))}")
        if funding_sources:
            parts.append(f"Funding sources: {', '.join(map(str, funding_sources[:5]))}")
        return parts

    @staticmethod
    def _metadata_context_parts(metadata: dict[str, Any]) -> list[str]:
        fields = (
            ("country", "Country"),
            ("source_type", "Source type"),
            ("political_bias", "Catalog political bias"),
        )
        parts = [f"{label}: {metadata[key]}" for key, label in fields if metadata.get(key)]
        if metadata.get("is_state_media"):
            parts.append("State media: yes")
        if metadata.get("credibility_score") is not None:
            parts.append(f"Stored credibility score: {metadata['credibility_score']}")
        return parts

    @staticmethod
    def _corpus_context_parts(corpus: dict[str, Any]) -> list[str]:
        parts: list[str] = []
        if corpus.get("article_count"):
            parts.append(f"Articles in our database: {corpus['article_count']}")
        if corpus.get("top_categories"):
            parts.append(f"Top categories: {', '.join(map(str, corpus['top_categories'][:5]))}")
        return parts

    def _format_context_for_llm(self, source_name: str, context: dict[str, Any]) -> str:
        del source_name
        parts = self._org_context_parts(context.get("org_data", {}))
        parts += self._metadata_context_parts(context.get("source_metadata", {}))
        parts += self._corpus_context_parts(context.get("corpus_stats", {}))
        return (
            "\n".join(parts)
            if parts
            else "No structured data available. Score based on general knowledge of this source."
        )


_scorer: SourceAnalysisScorer | None = None


def get_source_analysis_scorer() -> SourceAnalysisScorer:
    """Return the process-wide source-analysis scorer."""
    global _scorer
    if _scorer is None:
        _scorer = SourceAnalysisScorer()
    return _scorer
