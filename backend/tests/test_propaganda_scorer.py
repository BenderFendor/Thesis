"""Unit tests for SourceAnalysisScorer.

Tests the consolidated LLM call that scores source-analysis axes and
optionally returns organization metadata.
"""

import json
from unittest.mock import MagicMock

import pytest

from app.services.source_analysis_scorer import (
    SourceAnalysisScorer,
    SourceAnalysisResult,
)


def _mock_llm_response(include_org: bool = False) -> str:
    """Build a fake LLM JSON response."""
    data = {
        "source_network": {
            "score": 3,
            "confidence": "medium",
            "prose": "Moderate reliance on official sources.",
            "citations": [],
            "empirical_basis": "Inferred from article patterns.",
        },
        "political_bias": {
            "score": 2,
            "confidence": "medium",
            "prose": "Center-right framing appears in repeated editorial choices.",
            "citations": [],
            "empirical_basis": "Based on repeated ideological cues.",
        },
        "framing_omission": {
            "score": 4,
            "confidence": "low",
            "prose": "Loaded wording and selective omissions appear in coverage.",
            "citations": [],
            "empirical_basis": "General knowledge.",
        },
    }
    if include_org:
        data["organization"] = {
            "funding_type": "commercial",
            "parent_org": "MegaCorp",
            "media_bias_rating": "center-right",
            "factual_reporting": "high",
        }
    return json.dumps(data)


def _make_mock_client(include_org: bool = False):
    """Create a mock OpenAI client that returns a canned completion."""
    client = MagicMock()
    message = MagicMock()
    message.content = _mock_llm_response(include_org)
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    client.chat.completions.create.return_value = response
    return client


@pytest.mark.asyncio
class TestSourceAnalysisScorer:
    async def test_score_source_returns_scoring_result(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=False)

        result = await scorer.score_source(
            source_name="Test News",
            org_data={"name": "Test", "research_confidence": "high"},
        )

        assert isinstance(result, SourceAnalysisResult)
        assert len(result.scores) == 5
        axis_names = {s.axis_name for s in result.scores}
        assert axis_names == {
            "funding",
            "source_network",
            "political_bias",
            "credibility",
            "framing_omission",
        }
        # No org_updates when confidence is high
        assert result.org_updates is None

    async def test_score_source_includes_org_updates_when_low_confidence(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=True)

        org_data = {
            "name": "Unknown News",
            "normalized_name": "unknown news",
            "research_confidence": "low",
        }
        result = await scorer.score_source(
            source_name="Unknown News",
            org_data=org_data,
        )

        assert isinstance(result, SourceAnalysisResult)
        assert len(result.scores) == 5
        assert result.org_updates is not None
        assert result.org_updates["funding_type"] == "commercial"
        assert result.org_updates["parent_org"] == "MegaCorp"
        assert result.org_updates["media_bias_rating"] == "center-right"
        assert result.org_updates["factual_reporting"] == "high"

    async def test_prompt_includes_org_metadata_section_when_needed(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=True)

        org_data = {
            "name": "Indie Press",
            "normalized_name": "indie press",
            "research_confidence": "low",
            "funding_type": None,
        }
        await scorer.score_source(source_name="Indie Press", org_data=org_data)

        # Verify the prompt sent to the LLM contains org metadata section
        call_args = scorer.client.chat.completions.create.call_args
        prompt = call_args.kwargs["messages"][1]["content"]
        assert "ORGANIZATION METADATA" in prompt
        assert "funding_type" in prompt

    async def test_prompt_excludes_org_metadata_when_high_confidence(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=False)

        org_data = {
            "name": "BBC",
            "normalized_name": "bbc",
            "research_confidence": "high",
        }
        await scorer.score_source(source_name="BBC", org_data=org_data)

        call_args = scorer.client.chat.completions.create.call_args
        prompt = call_args.kwargs["messages"][1]["content"]
        assert "ORGANIZATION METADATA" not in prompt

    async def test_no_llm_client_returns_defaults(self):
        scorer = SourceAnalysisScorer()
        scorer.client = None

        result = await scorer.score_source(source_name="No Client Source")

        assert isinstance(result, SourceAnalysisResult)
        assert len(result.scores) == 5
        llm_names = {"source_network", "political_bias", "framing_omission"}
        for s in result.scores:
            if s.axis_name in llm_names:
                assert s.score == 3
                assert s.confidence == "low"

    async def test_malformed_llm_response_returns_defaults(self):
        scorer = SourceAnalysisScorer()
        client = MagicMock()
        message = MagicMock()
        message.content = "This is not JSON at all"
        choice = MagicMock()
        choice.message = message
        response = MagicMock()
        response.choices = [choice]
        client.chat.completions.create.return_value = response
        scorer.client = client

        result = await scorer.score_source(source_name="Bad Response Source")

        assert isinstance(result, SourceAnalysisResult)
        assert len(result.scores) == 5
        assert result.org_updates is None

    async def test_max_tokens_increases_with_org_metadata(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=True)

        org_data = {
            "name": "Low Conf",
            "normalized_name": "low conf",
            "research_confidence": "low",
        }
        await scorer.score_source(source_name="Low Conf", org_data=org_data)

        call_args = scorer.client.chat.completions.create.call_args
        assert call_args.kwargs["max_tokens"] == 2200

    async def test_max_tokens_standard_without_org_metadata(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=False)

        org_data = {
            "name": "High Conf",
            "normalized_name": "high conf",
            "research_confidence": "high",
        }
        await scorer.score_source(source_name="High Conf", org_data=org_data)

        call_args = scorer.client.chat.completions.create.call_args
        assert call_args.kwargs["max_tokens"] == 1800

    async def test_scored_by_reflects_scoring_method(self):
        scorer = SourceAnalysisScorer()
        scorer.client = _make_mock_client(include_org=False)

        result = await scorer.score_source(
            source_name="Test News",
            org_data={"name": "Test", "research_confidence": "high"},
        )

        by_name = {s.axis_name: s for s in result.scores}
        assert by_name["funding"].scored_by == "data"
        assert by_name["credibility"].scored_by == "data"
        assert by_name["source_network"].scored_by == "llm"
        assert by_name["political_bias"].scored_by == "llm"
        assert by_name["framing_omission"].scored_by == "llm"

    async def test_empty_llm_response_returns_defaults(self):
        scorer = SourceAnalysisScorer()
        client = MagicMock()
        message = MagicMock()
        message.content = ""
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "length"
        response = MagicMock()
        response.choices = [choice]
        client.chat.completions.create.return_value = response
        scorer.client = client

        result = await scorer.score_source(source_name="Empty Response Source")

        assert isinstance(result, SourceAnalysisResult)
        assert len(result.scores) == 5
        llm_names = {"source_network", "political_bias", "framing_omission"}
        for s in result.scores:
            if s.axis_name in llm_names:
                assert s.score == 3
                assert s.confidence == "low"
