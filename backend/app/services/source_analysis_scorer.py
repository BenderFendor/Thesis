"""Five-axis source-analysis scorer for the Media Accountability Wiki."""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable
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
        """Initialize one scored source-analysis axis."""
        self.axis_name = axis_name
        self.score = max(1, min(5, score))
        self.confidence = confidence
        self.prose = prose
        self.citations = citations
        self.empirical_basis = empirical_basis
        self.scored_by = scored_by

    def to_dict(self) -> dict[str, Any]:
        """Serialize the axis score for API responses and persistence."""
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
        """Initialize a complete source-analysis result."""
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
    return _ownership_structure_risks(parents, owners), parents, owners


def _ownership_structure_risks(parents: list[Any], owners: list[Any]) -> list[str]:
    return _owner_count_risks((len(parents), len(owners))) + _vertical_integration_risks(
        parents, owners
    )


def _owner_count_risks(owner_counts: tuple[int, int]) -> list[str]:
    if 1 in owner_counts:
        return ["single concentrated owner"]
    if any(count >= 3 for count in owner_counts):
        return ["complex multi-owner structure"]
    return []


def _vertical_integration_risks(parents: list[Any], owners: list[Any]) -> list[str]:
    if parents and owners:
        return ["vertical integration detected"]
    return []


def _disclosure_adjustment(
    values: Any,
    disclosed: tuple[int, list[str]],
    undisclosed: tuple[int, list[str]],
) -> tuple[int, list[str]]:
    return disclosed if values else undisclosed


def _state_funding_adjustment(_org: dict[str, Any]) -> tuple[int, list[str]]:
    return 4, ["state-linked funding with uncertain transparency"]


def _public_funding_adjustment(_org: dict[str, Any]) -> tuple[int, list[str]]:
    return 3, ["public funding model"]


def _commercial_funding_adjustment(org: dict[str, Any]) -> tuple[int, list[str]]:
    return _disclosure_adjustment(
        org.get("major_advertisers") or [],
        (3, ["commercial with disclosed advertisers"]),
        (4, ["commercial but undisclosed advertisers"]),
    )


def _nonprofit_funding_adjustment(org: dict[str, Any]) -> tuple[int, list[str]]:
    return _disclosure_adjustment(
        org.get("top_donors") or [],
        (2, ["nonprofit with disclosed donors"]),
        (3, ["nonprofit with undisclosed donors"]),
    )


def _default_funding_adjustment(_org: dict[str, Any]) -> tuple[int, list[str]]:
    return 3, []


_FUNDING_MODEL_ADJUSTMENTS: dict[str, Callable[[dict[str, Any]], tuple[int, list[str]]]] = {
    "state-funded": _state_funding_adjustment,
    "state": _state_funding_adjustment,
    "public": _public_funding_adjustment,
    "public broadcaster": _public_funding_adjustment,
    "commercial": _commercial_funding_adjustment,
    "corporate": _commercial_funding_adjustment,
    "non-profit": _nonprofit_funding_adjustment,
    "nonprofit": _nonprofit_funding_adjustment,
    "independent": _nonprofit_funding_adjustment,
}


def _funding_model_adjustment(funding_type: str, org: dict[str, Any]) -> tuple[int, list[str]]:
    adjustment = _FUNDING_MODEL_ADJUSTMENTS.get(funding_type, _default_funding_adjustment)
    return adjustment(org)


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


def _normalise_context_value(primary: Any, fallback: Any = "") -> str:
    return str(primary or fallback or "").lower()


def _labelled_context_parts(
    context: dict[str, Any], fields: tuple[tuple[str, str], ...]
) -> list[str]:
    return [f"{label}: {context[key]}" for key, label in fields if context.get(key)]


def _list_context_part(label: str, values: Any) -> list[str]:
    return [f"{label}: {', '.join(map(str, values[:5]))}"] if values else []


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
- Funding type: {org.get("funding_type", "Unknown")}
- Parent organization: {org.get("parent_org", "Unknown")}
- Media bias rating: {org.get("media_bias_rating", "Unknown")}
- Factual reporting: {org.get("factual_reporting", "Unknown")}
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


def _parsed_axis_scores(payload: dict[str, Any]) -> dict[str, AnalysisAxisScore]:
    return {
        axis: parsed for axis in _LLM_AXES if (parsed := _axis_from_llm(axis, payload)) is not None
    }


def _parsed_org_updates(
    payload: dict[str, Any], include_org_metadata: bool
) -> dict[str, Any] | None:
    organization = payload.get("organization")
    if include_org_metadata and isinstance(organization, dict):
        return organization
    return None


def _funding_score_details(
    score: int,
    parents: list[Any],
    owners: list[Any],
    risks: list[str],
    advertisers: Any,
) -> tuple[int, str, int]:
    if parents and owners:
        score = max(score, 4)
    summary = "; ".join(risks) if risks else "minimal funding data available"
    advertiser_count = len(advertisers) if isinstance(advertisers, list) else 0
    return score, summary, advertiser_count


class SourceAnalysisScorer:
    """Score sources on funding, network, bias, credibility, and framing risk."""

    def __init__(self) -> None:
        """Initialize the scorer with the configured OpenAI client."""
        self.client: OpenAI | None = get_openai_client()

    async def score_source(
        self,
        source_name: str,
        org_data: dict[str, Any] | None = None,
        source_metadata: dict[str, Any] | None = None,
        article_corpus_stats: dict[str, Any] | None = None,
    ) -> SourceAnalysisResult:
        """Score a source from organization, source, and corpus context."""
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
        funding_type = _normalise_context_value(
            org.get("funding_type"), metadata.get("funding_type")
        )
        transparency = _normalise_context_value(org.get("funding_transparency"))
        ownership_risks, parents, owners = _ownership_risks(org)
        score, transparency_risks = _transparency_adjustment(transparency, funding_type, org)
        risks = ownership_risks + transparency_risks + _advertiser_risks(org)
        score, summary, advertiser_count = _funding_score_details(
            score,
            parents,
            owners,
            risks,
            org.get("major_advertisers"),
        )
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
                f"{advertiser_count}."
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
        scores = _parsed_axis_scores(payload)
        output: dict[str, Any] = {"scores": scores}
        org_updates = _parsed_org_updates(payload, include_org_metadata)
        if org_updates is not None:
            output["org_updates"] = org_updates
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
        org_metadata, org_schema = _org_prompt_sections(source_name, context, include_org_metadata)
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
        return (
            _labelled_context_parts(org, scalar_fields)
            + _list_context_part("Major advertisers", org.get("major_advertisers"))
            + _list_context_part("Funding sources", org.get("funding_sources"))
        )

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
