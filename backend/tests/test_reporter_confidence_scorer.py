"""Regression tests for reporter confidence scoring."""

from __future__ import annotations

from typing import Any

import pytest

from app.database import ArticleAuthor, IdentityEdge, Reporter, ReporterClaim
from app.services.reporter_confidence_scorer import (
    compute_confidence_tier,
    has_author_page_citation,
    has_journalism_profile_evidence,
    has_person_like_reporter_name,
    is_public_author_url,
    update_reporter_confidence,
)


class FakeScalars:
    def __init__(self, values: list[Any]) -> None:
        self.values = values

    def all(self) -> list[Any]:
        return self.values


class FakeResult:
    def __init__(
        self,
        values: list[Any] | None = None,
        scalar_value: Any | None = None,
    ) -> None:
        self.values = values or []
        self.scalar_value = scalar_value

    def scalars(self) -> FakeScalars:
        return FakeScalars(self.values)

    def scalar_one_or_none(self) -> Any | None:
        return self.scalar_value


class FakeSession:
    def __init__(self, results: list[FakeResult]) -> None:
        self.results = results
        self.committed = False

    async def execute(self, _stmt: Any) -> FakeResult:
        return self.results.pop(0)

    async def commit(self) -> None:
        self.committed = True


@pytest.mark.asyncio
async def test_sameas_identity_edge_scores_likely_not_unmatched() -> None:
    reporter = Reporter(id=1, name="Jane Doe")
    session = FakeSession(
        [
            FakeResult(
                values=[
                    IdentityEdge(
                        reporter_id=1, target_url="https://example.com/jane", edge_type="sameAs"
                    )
                ]
            ),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "likely"
    assert score == 0.6
    assert evidence["identity_edges"] == ["sameAs"]


@pytest.mark.asyncio
async def test_wikidata_identity_edge_scores_strong() -> None:
    reporter = Reporter(id=1, name="Jane Doe")
    session = FakeSession(
        [
            FakeResult(
                values=[
                    IdentityEdge(
                        reporter_id=1,
                        target_url="https://www.wikidata.org/wiki/Q1",
                        edge_type="wikidata",
                    )
                ]
            ),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "strong"
    assert score == 0.75
    assert evidence["identity_edges"] == ["wikidata"]


@pytest.mark.asyncio
async def test_update_reporter_confidence_persists_tier_and_score() -> None:
    reporter = Reporter(id=1, name="Jane Doe")
    session = FakeSession(
        [
            FakeResult(scalar_value=reporter),
            FakeResult(values=[]),
            FakeResult(
                values=[
                    ReporterClaim(
                        reporter_id=1,
                        claim_type="bio",
                        claim_value="Reporter",
                        source_type="author_page",
                    )
                ]
            ),
            FakeResult(values=[]),
        ]
    )

    tier = await update_reporter_confidence(session, 1)

    assert tier == "likely"
    assert reporter.confidence_tier == "likely"
    assert reporter.confidence_score == 0.5
    assert session.committed is True


@pytest.mark.asyncio
async def test_multiple_article_author_observations_score_likely() -> None:
    reporter = Reporter(id=1, name="Jane Doe")
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(
                values=[
                    ArticleAuthor(article_id=1, reporter_id=1, observation_source="rss_byline"),
                    ArticleAuthor(article_id=2, reporter_id=1, observation_source="rss_byline"),
                ]
            ),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "likely"
    assert score == 0.55
    assert evidence["article_observations"] == 2


@pytest.mark.asyncio
async def test_single_article_author_observation_scores_likely_with_limited_evidence() -> None:
    reporter = Reporter(id=1, name="Jane Doe")
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(
                values=[
                    ArticleAuthor(article_id=1, reporter_id=1, observation_source="rss_byline"),
                ]
            ),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "likely"
    assert score == 0.45
    assert evidence["article_observations"] == 1
    assert evidence["single_article_observation"] is True


@pytest.mark.asyncio
async def test_non_public_author_url_does_not_verify_reporter() -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        canonical_author_url="https://test.local/author/jane-doe",
        author_page_url="https://test.local/author/jane-doe",
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "unmatched"
    assert score == 0.1
    assert evidence["tier"] == "unmatched"


@pytest.mark.asyncio
async def test_public_author_url_with_non_person_name_does_not_verify_reporter() -> None:
    reporter = Reporter(
        id=1,
        name="Guest Contributor",
        canonical_author_url="https://example.org/author/guest-contributor",
        author_page_url="https://example.org/author/guest-contributor",
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "unmatched"
    assert score == 0.1
    assert evidence["person_like_name"] is False


@pytest.mark.asyncio
async def test_public_author_url_requires_citation_to_verify_reporter() -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        canonical_author_url="https://example.org/author/jane-doe",
        author_page_url="https://example.org/author/jane-doe",
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "strong"
    assert score == 0.85
    assert evidence["canonical_url_found"] is True
    assert has_author_page_citation(reporter) is False


@pytest.mark.asyncio
async def test_public_author_url_with_citation_verifies_reporter() -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        canonical_author_url="https://example.org/author/jane-doe",
        author_page_url="https://example.org/author/jane-doe",
        citations=[{"label": "Official author page", "url": "https://example.org/author/jane-doe"}],
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "verified"
    assert score == 1.0
    assert evidence["publisher_confirmed"] is True
    assert has_author_page_citation(reporter) is True


@pytest.mark.asyncio
async def test_article_observations_without_public_author_page_do_not_verify_reporter() -> None:
    reporter = Reporter(id=1, name="Jane Doe")
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(
                values=[
                    ArticleAuthor(article_id=idx, reporter_id=1, observation_source="rss_byline")
                    for idx in range(1, 11)
                ]
            ),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "likely"
    assert score == 0.6
    assert evidence["article_observations"] == 10


@pytest.mark.asyncio
async def test_wikidata_qid_scores_strong_without_author_page() -> None:
    reporter = Reporter(id=1, name="Jane Doe", wikidata_qid="Q123", overview="Journalist")
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "strong"
    assert score == 0.78
    assert evidence["wikidata_matched"] is True
    assert evidence["journalism_profile_evidence"] is True


@pytest.mark.asyncio
async def test_wikidata_qid_with_qid_label_does_not_score_strong() -> None:
    reporter = Reporter(
        id=1, name="q12181423", canonical_name="q12181423", wikidata_qid="Q12181423"
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "unmatched"
    assert score == 0.1
    assert evidence["person_like_name"] is False
    assert has_person_like_reporter_name(reporter) is False


@pytest.mark.asyncio
async def test_wikidata_qid_can_use_canonical_person_name() -> None:
    reporter = Reporter(
        id=1,
        name="q123",
        canonical_name="Jane Doe",
        wikidata_qid="Q123",
        overview="Political reporter",
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "strong"
    assert score == 0.78
    assert evidence["person_like_name"] is True
    assert has_person_like_reporter_name(reporter) is True


@pytest.mark.asyncio
async def test_wikidata_qid_without_journalism_evidence_does_not_score_strong() -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        canonical_name="Jane Doe",
        wikidata_qid="Q123",
        overview="Freestyle skier",
    )
    session = FakeSession(
        [
            FakeResult(values=[]),
            FakeResult(values=[]),
            FakeResult(values=[]),
        ]
    )

    tier, score, evidence = await compute_confidence_tier(session, reporter)

    assert tier == "unmatched"
    assert score == 0.1
    assert evidence["journalism_profile_evidence"] is False
    assert has_journalism_profile_evidence(reporter) is False


def test_is_public_author_url_rejects_test_hosts() -> None:
    assert is_public_author_url("https://example.com/author/jane") is False
    assert is_public_author_url("https://test.local/author/jane") is False
    assert is_public_author_url("https://news.example.test/author/jane") is False
    assert is_public_author_url("https://example.org/author/jane") is True
