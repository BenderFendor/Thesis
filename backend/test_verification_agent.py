"""
Tests for the verification agent.

Tests claim extraction, source searching, credibility scoring,
and the full verification workflow.

Run with: python -m pytest test_verification_agent.py -v
"""

import asyncio
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.verification import (
    ConfidenceLevel,
    SourceInfo,
    SourceType,
    VerificationRequest,
    VerifiedClaim,
)
from app.services.source_credibility import CredibilityScorer, DEFAULT_CREDIBILITY
from app.services.verification_agent import (
    VerificationAgent,
    _confidence_to_level,
    _hash_claim,
    verify_research,
)


class TestConfidenceLevels:
    """Test confidence level conversion."""

    def test_high_confidence(self):
        assert _confidence_to_level(0.95) == ConfidenceLevel.HIGH
        assert _confidence_to_level(0.80) == ConfidenceLevel.HIGH

    def test_medium_confidence(self):
        assert _confidence_to_level(0.79) == ConfidenceLevel.MEDIUM
        assert _confidence_to_level(0.50) == ConfidenceLevel.MEDIUM

    def test_low_confidence(self):
        assert _confidence_to_level(0.49) == ConfidenceLevel.LOW
        assert _confidence_to_level(0.20) == ConfidenceLevel.LOW

    def test_very_low_confidence(self):
        assert _confidence_to_level(0.19) == ConfidenceLevel.VERY_LOW
        assert _confidence_to_level(0.0) == ConfidenceLevel.VERY_LOW


class TestClaimHashing:
    """Test claim hash generation."""

    def test_consistent_hashing(self):
        claim = "The unemployment rate rose to 5.2% in Q3 2024."
        hash1 = _hash_claim(claim)
        hash2 = _hash_claim(claim)
        assert hash1 == hash2

    def test_case_insensitive(self):
        claim1 = "Reuters reported the deal."
        claim2 = "REUTERS REPORTED THE DEAL."
        assert _hash_claim(claim1) == _hash_claim(claim2)

    def test_whitespace_normalized(self):
        claim1 = "The  market  closed  higher."
        claim2 = "The market closed higher."
        assert _hash_claim(claim1) == _hash_claim(claim2)

    def test_different_claims_different_hashes(self):
        claim1 = "GDP grew by 2.1%."
        claim2 = "GDP grew by 3.5%."
        assert _hash_claim(claim1) != _hash_claim(claim2)


class TestCredibilityScorer:
    """Test the credibility scoring engine."""

    def setup_method(self):
        self.scorer = CredibilityScorer()

    def test_known_source_credibility(self):
        score, source_type = self.scorer.get_credibility("reuters.com")
        assert score == 0.95
        assert source_type == SourceType.WIRE

    def test_known_source_with_subdomain(self):
        score, source_type = self.scorer.get_credibility("news.bbc.co.uk")
        assert score == 0.90
        assert source_type == SourceType.BROADCAST

    def test_unknown_source_default(self):
        score, source_type = self.scorer.get_credibility("unknown-blog-xyz.com")
        assert score == 0.3
        assert source_type == SourceType.UNKNOWN

    def test_url_extraction(self):
        score, _ = self.scorer.get_credibility("https://www.reuters.com/article/123")
        assert score == 0.95

    def test_get_source_info(self):
        info = self.scorer.get_source_info(
            url="https://reuters.com/article/test",
            title="Test Article",
            published_at="2024-01-15T10:00:00Z",
            supports_claim=True,
            excerpt="Test excerpt...",
        )
        assert info.domain == "reuters.com"
        assert info.credibility_score == 0.95
        assert info.source_type == SourceType.WIRE
        assert info.supports_claim is True

    def test_calculate_claim_confidence_no_sources(self):
        confidence = self.scorer.calculate_claim_confidence([])
        assert confidence == 0.0

    def test_calculate_claim_confidence_single_high_source(self):
        sources = [
            SourceInfo(
                id="src1",
                url="https://reuters.com/article/1",
                domain="reuters.com",
                credibility_score=0.95,
                source_type=SourceType.WIRE,
                supports_claim=True,
            )
        ]
        confidence = self.scorer.calculate_claim_confidence(sources)
        assert confidence > 0.5

    def test_calculate_claim_confidence_multiple_diverse_sources(self):
        sources = [
            SourceInfo(
                id="src1",
                url="https://reuters.com/a",
                domain="reuters.com",
                credibility_score=0.95,
                source_type=SourceType.WIRE,
                supports_claim=True,
            ),
            SourceInfo(
                id="src2",
                url="https://bbc.com/b",
                domain="bbc.com",
                credibility_score=0.90,
                source_type=SourceType.BROADCAST,
                supports_claim=True,
            ),
            SourceInfo(
                id="src3",
                url="https://nytimes.com/c",
                domain="nytimes.com",
                credibility_score=0.88,
                source_type=SourceType.NEWSPAPER,
                supports_claim=True,
            ),
        ]
        confidence = self.scorer.calculate_claim_confidence(sources)
        assert confidence > 0.7

    def test_conflicting_sources_reduce_confidence(self):
        supporting = [
            SourceInfo(
                id="src1",
                url="https://blog.example.com/a",
                domain="blog.example.com",
                credibility_score=0.4,
                source_type=SourceType.BLOG,
                supports_claim=True,
            )
        ]
        with_conflict = supporting + [
            SourceInfo(
                id="src2",
                url="https://reuters.com/b",
                domain="reuters.com",
                credibility_score=0.95,
                source_type=SourceType.WIRE,
                supports_claim=False,
            )
        ]

        conf_no_conflict = self.scorer.calculate_claim_confidence(supporting)
        conf_with_conflict = self.scorer.calculate_claim_confidence(with_conflict)

        assert conf_with_conflict < conf_no_conflict


class TestClaimExtraction:
    """Test claim extraction from text."""

    def setup_method(self):
        self.agent = VerificationAgent()

    def test_extract_claims_with_numbers(self):
        text = "The unemployment rate rose to 5.2% in Q3 2024. This represents a significant change."
        claims = self.agent._extract_claims(text)
        assert len(claims) >= 1
        assert any("5.2%" in c for c in claims)

    def test_extract_claims_with_attribution(self):
        text = "According to Reuters, the deal is worth $50 billion. The company declined to comment."
        claims = self.agent._extract_claims(text)
        assert len(claims) >= 1
        assert any("Reuters" in c or "$50 billion" in c for c in claims)

    def test_extract_claims_with_dates(self):
        text = "In January 2024, the policy was announced. It takes effect immediately."
        claims = self.agent._extract_claims(text)
        assert len(claims) >= 1
        assert any("January" in c for c in claims)

    def test_extract_claims_with_comparison(self):
        text = "Prices increased by more than 10% this year. Analysts expect continued growth."
        claims = self.agent._extract_claims(text)
        assert len(claims) >= 1

    def test_filter_meta_statements(self):
        text = "Note that this is important. In summary, the market is volatile. The index fell 200 points."
        claims = self.agent._extract_claims(text)
        # Should filter out "Note that" and "In summary" sentences
        for claim in claims:
            assert not claim.lower().startswith("note that")
            assert not claim.lower().startswith("in summary")

    def test_empty_text(self):
        claims = self.agent._extract_claims("")
        assert claims == []

    def test_short_sentences_filtered(self):
        text = "It rose. Yes. The market index rose by 5.2% to close at 45,000 points."
        claims = self.agent._extract_claims(text)
        # Short sentences should be filtered
        for claim in claims:
            assert len(claim) >= 20


class TestVerifiableClaim:
    """Test claim verifiability detection."""

    def setup_method(self):
        self.agent = VerificationAgent()

    def test_claim_with_number(self):
        assert self.agent._is_verifiable_claim("The GDP grew by 2.5% last quarter.")

    def test_claim_with_quote(self):
        assert self.agent._is_verifiable_claim(
            'The CEO said "we are optimistic about growth."'
        )

    def test_claim_with_date(self):
        assert self.agent._is_verifiable_claim("The policy was enacted in March 2024.")

    def test_claim_with_attribution(self):
        assert self.agent._is_verifiable_claim(
            "According to the report, sales increased."
        )

    def test_claim_with_comparison(self):
        assert self.agent._is_verifiable_claim(
            "Exports increased more than imports this year."
        )

    def test_meta_statement_not_verifiable(self):
        assert not self.agent._is_verifiable_claim(
            "Note that this is an important consideration for investors."
        )

    def test_vague_statement_not_verifiable(self):
        assert not self.agent._is_verifiable_claim(
            "The situation is complex and evolving."
        )


class TestVerificationAgentWorkflow:
    """Test the full verification workflow."""

    @pytest.mark.asyncio
    async def test_verify_no_claims(self):
        """Test verification with text containing no verifiable claims."""
        request = VerificationRequest(
            query="test query",
            main_answer="This is a simple statement with no facts.",
        )

        async with VerificationAgent() as agent:
            result = await agent.verify(request)

        assert result.overall_confidence == 0.0
        assert result.overall_confidence_level == ConfidenceLevel.VERY_LOW
        assert len(result.verified_claims) == 0
        assert "No verifiable claims" in result.markdown_report

    @pytest.mark.asyncio
    async def test_verify_with_mocked_search(self):
        """Test verification with mocked external search."""
        request = VerificationRequest(
            query="economic growth",
            main_answer="According to Reuters, GDP grew by 2.5% in Q4 2024.",
        )

        mock_ddg_results = [
            {
                "href": "https://reuters.com/article/gdp-growth",
                "title": "GDP Growth Report Q4 2024",
                "body": "GDP grew by 2.5% in the fourth quarter...",
            },
            {
                "href": "https://bbc.com/news/economy/gdp",
                "title": "Economic Growth Continues",
                "body": "The economy showed strong growth of 2.5%...",
            },
        ]

        with patch.object(
            VerificationAgent, "_ddg_search", return_value=mock_ddg_results
        ):
            with patch.object(
                VerificationAgent,
                "_search_internal_sources",
                new_callable=AsyncMock,
                return_value=[],
            ):
                async with VerificationAgent() as agent:
                    result = await agent.verify(request)

        assert len(result.verified_claims) >= 1
        assert result.overall_confidence > 0

    @pytest.mark.asyncio
    async def test_timeout_handling(self):
        """Test that verification respects timeout."""
        request = VerificationRequest(
            query="test",
            main_answer="In 2024, the market rose 10%. In 2023, it fell 5%. In 2022, it was flat.",
        )

        async with VerificationAgent() as agent:
            agent._start_time = 0  # Force timeout
            result = await agent.verify(request)

        # Should complete without error even if timeout triggered
        assert result is not None
        assert result.error is None or "timeout" not in result.error.lower()


class TestInternalSourceSearch:
    """Test internal source (ChromaDB + PostgreSQL) search."""

    @pytest.mark.asyncio
    async def test_search_internal_sources_no_vector_store(self):
        """Test internal search when vector store is unavailable."""
        with patch("app.vector_store.get_vector_store", return_value=None):
            async with VerificationAgent() as agent:
                sources = await agent._search_internal_sources("test claim")
                assert sources == []

    @pytest.mark.asyncio
    async def test_search_internal_sources_with_results(self):
        """Test internal search with mocked vector store results."""
        mock_vector_store = MagicMock()
        mock_vector_store.search_similar.return_value = [
            {"article_id": 1, "similarity_score": 0.85},
            {"article_id": 2, "similarity_score": 0.75},
        ]

        mock_article_1 = MagicMock()
        mock_article_1.id = 1
        mock_article_1.url = "https://reuters.com/internal/article1"
        mock_article_1.title = "Internal Article 1"
        mock_article_1.summary = "Summary of article 1"
        mock_article_1.published_at = datetime.now(timezone.utc)

        mock_article_2 = MagicMock()
        mock_article_2.id = 2
        mock_article_2.url = "https://bbc.com/internal/article2"
        mock_article_2.title = "Internal Article 2"
        mock_article_2.summary = "Summary of article 2"
        mock_article_2.published_at = datetime.now(timezone.utc)

        with patch(
            "app.vector_store.get_vector_store",
            return_value=mock_vector_store,
        ):
            async with VerificationAgent() as agent:
                # Mock the DB session
                mock_db = AsyncMock()
                mock_result = MagicMock()
                mock_result.scalars.return_value.all.return_value = [
                    mock_article_1,
                    mock_article_2,
                ]
                mock_db.execute = AsyncMock(return_value=mock_result)
                agent.db = mock_db

                sources = await agent._search_internal_sources(
                    "test claim about economics"
                )

        assert len(sources) == 2
        assert sources[0].id.startswith("internal_")
        assert "reuters.com" in sources[0].domain


class TestExternalSourceSearch:
    """Test external source (DuckDuckGo) search."""

    @pytest.mark.asyncio
    async def test_search_external_sources_filters_domains(self):
        """Test that external search filters to allowed domains."""
        mock_ddg_results = [
            {
                "href": "https://reuters.com/allowed",
                "title": "Allowed",
                "body": "Content...",
            },
            {
                "href": "https://random-blog.com/not-allowed",
                "title": "Not Allowed",
                "body": "Content...",
            },
            {
                "href": "https://bbc.com/allowed2",
                "title": "Also Allowed",
                "body": "Content...",
            },
        ]

        with patch.object(
            VerificationAgent, "_ddg_search", return_value=mock_ddg_results
        ):
            async with VerificationAgent() as agent:
                sources = await agent._search_external_sources(
                    "test query", max_results=5
                )

        # Should filter out random-blog.com
        domains = [s.domain for s in sources]
        assert "random-blog.com" not in domains
        assert "reuters.com" in domains or "bbc.com" in domains

    @pytest.mark.asyncio
    async def test_build_search_query_truncation(self):
        """Test that long claims are truncated for search."""
        async with VerificationAgent() as agent:
            long_claim = " ".join(["word"] * 50)
            query = agent._build_search_query(long_claim)
            tokens = query.split()
            assert len(tokens) <= 12


class TestVerifyResearchFunction:
    """Test the convenience verify_research function."""

    @pytest.mark.asyncio
    async def test_verify_research_basic(self):
        """Test basic usage of verify_research function."""
        request = VerificationRequest(
            query="test",
            main_answer="The stock market index rose by 3.5% on Monday.",
        )

        with patch.object(
            VerificationAgent,
            "_search_sources",
            new_callable=AsyncMock,
            return_value=[],
        ):
            result = await verify_research(request)

        assert result is not None
        assert result.query == "test"


class TestArticleToSourceConversion:
    """Test conversion of DB articles to SourceInfo."""

    @pytest.mark.asyncio
    async def test_article_to_source_info(self):
        """Test article to source info conversion."""
        mock_article = MagicMock()
        mock_article.id = 123
        mock_article.url = "https://reuters.com/article/test"
        mock_article.title = "Test Article Title"
        mock_article.summary = "This is a test summary that provides context."
        mock_article.published_at = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)

        async with VerificationAgent() as agent:
            source = agent._article_to_source_info(mock_article, similarity_score=0.8)

        assert source.id == "internal_123"
        assert source.url == "https://reuters.com/article/test"
        assert source.title == "Test Article Title"
        assert source.domain == "reuters.com"
        assert source.credibility_score >= 0.6
        assert source.supports_claim is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
