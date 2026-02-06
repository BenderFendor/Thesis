"""Unit tests for PropagandaFilterScorer.

Tests the consolidated LLM call that scores propaganda filters and
optionally returns organization metadata.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.services.propaganda_scorer import (
    FilterScore,
    PropagandaFilterScorer,
    ScoringResult,
)


def _mock_llm_response(include_org: bool = False) -> str:
    """Build a fake LLM JSON response."""
    data = {
        "sourcing": {
            "score": 3,
            "confidence": "medium",
            "prose": "Moderate reliance on official sources.",
            "citations": [],
            "empirical_basis": "Inferred from article patterns.",
        },
        "flak": {
            "score": 2,
            "confidence": "medium",
            "prose": "Relatively resilient to external pressure.",
            "citations": [],
            "empirical_basis": "Based on known editorial independence.",
        },
        "ideology": {
            "score": 3,
            "confidence": "low",
            "prose": "Center-oriented but with blind spots.",
            "citations": [],
            "empirical_basis": "General knowledge.",
        },
        "class_interest": {
            "score": 4,
            "confidence": "medium",
            "prose": "Limited labor coverage.",
            "citations": [],
            "empirical_basis": "Topic frequency analysis.",
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
class TestPropagandaFilterScorer:
    async def test_score_source_returns_scoring_result(self):
        scorer = PropagandaFilterScorer()
        scorer.client = _make_mock_client(include_org=False)

        result = await scorer.score_source(
            source_name="Test News",
            org_data={"name": "Test", "research_confidence": "high"},
        )

        assert isinstance(result, ScoringResult)
        assert len(result.scores) == 6
        filter_names = {s.filter_name for s in result.scores}
        assert filter_names == {
            "ownership",
            "advertising",
            "sourcing",
            "flak",
            "ideology",
            "class_interest",
        }
        # No org_updates when confidence is high
        assert result.org_updates is None

    async def test_score_source_includes_org_updates_when_low_confidence(self):
        scorer = PropagandaFilterScorer()
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

        assert isinstance(result, ScoringResult)
        assert len(result.scores) == 6
        assert result.org_updates is not None
        assert result.org_updates["funding_type"] == "commercial"
        assert result.org_updates["parent_org"] == "MegaCorp"
        assert result.org_updates["media_bias_rating"] == "center-right"
        assert result.org_updates["factual_reporting"] == "high"

    async def test_prompt_includes_org_metadata_section_when_needed(self):
        scorer = PropagandaFilterScorer()
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
        prompt = call_args.kwargs["messages"][0]["content"]
        assert "ORGANIZATION METADATA" in prompt
        assert "funding_type" in prompt

    async def test_prompt_excludes_org_metadata_when_high_confidence(self):
        scorer = PropagandaFilterScorer()
        scorer.client = _make_mock_client(include_org=False)

        org_data = {
            "name": "BBC",
            "normalized_name": "bbc",
            "research_confidence": "high",
        }
        await scorer.score_source(source_name="BBC", org_data=org_data)

        call_args = scorer.client.chat.completions.create.call_args
        prompt = call_args.kwargs["messages"][0]["content"]
        assert "ORGANIZATION METADATA" not in prompt

    async def test_no_llm_client_returns_defaults(self):
        scorer = PropagandaFilterScorer()
        scorer.client = None

        result = await scorer.score_source(source_name="No Client Source")

        assert isinstance(result, ScoringResult)
        # Still gets ownership + advertising (algorithmic) + 4 defaults
        assert len(result.scores) == 6
        # LLM-scored filters should have default score 3
        llm_names = {"sourcing", "flak", "ideology", "class_interest"}
        for s in result.scores:
            if s.filter_name in llm_names:
                assert s.score == 3
                assert s.confidence == "low"

    async def test_malformed_llm_response_returns_defaults(self):
        scorer = PropagandaFilterScorer()
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

        assert isinstance(result, ScoringResult)
        assert len(result.scores) == 6
        assert result.org_updates is None

    async def test_max_tokens_increases_with_org_metadata(self):
        scorer = PropagandaFilterScorer()
        scorer.client = _make_mock_client(include_org=True)

        org_data = {
            "name": "Low Conf",
            "normalized_name": "low conf",
            "research_confidence": "low",
        }
        await scorer.score_source(source_name="Low Conf", org_data=org_data)

        call_args = scorer.client.chat.completions.create.call_args
        assert call_args.kwargs["max_tokens"] == 2500

    async def test_max_tokens_standard_without_org_metadata(self):
        scorer = PropagandaFilterScorer()
        scorer.client = _make_mock_client(include_org=False)

        org_data = {
            "name": "High Conf",
            "normalized_name": "high conf",
            "research_confidence": "high",
        }
        await scorer.score_source(source_name="High Conf", org_data=org_data)

        call_args = scorer.client.chat.completions.create.call_args
        assert call_args.kwargs["max_tokens"] == 2000
