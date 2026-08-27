"""Tests for reproducible Atlas media measurements."""

from __future__ import annotations

from datetime import datetime

import pytest

from app.database import Article, ArticleAuthor, Reporter
from app.models.evidence import AcceptedRelationship, EvidenceEntity
from app.services.media_measurements import METHOD_VERSION, calculate_media_measurements

pytestmark = pytest.mark.asyncio


async def test_measurements_include_window_denominator_coverage_and_trace(db_session) -> None:
    reporter_a = Reporter(id=10, name="Jane Reporter", normalized_name="jane reporter")
    reporter_b = Reporter(id=11, name="Alex Editor", normalized_name="alex editor")
    articles = [
        Article(
            id=101,
            title="Original report",
            source="Example News",
            url="https://example.test/1",
            published_at=datetime(2026, 7, 1, 12),
            author="Jane Reporter",
            authors=["Jane Reporter", "Alex Editor"],
            content="Original reporting.",
        ),
        Article(
            id=102,
            title="Correction: wire report",
            source="Example News",
            url="https://example.test/2",
            published_at=datetime(2026, 7, 3, 12),
            author="Reuters",
            authors=["Jane Reporter"],
            content="Corrected: This Reuters report was updated.",
        ),
    ]
    db_session.add_all(
        [
            reporter_a,
            reporter_b,
            *articles,
            ArticleAuthor(article_id=101, reporter_id=10, observation_source="jsonld"),
            ArticleAuthor(article_id=101, reporter_id=11, observation_source="byline"),
            ArticleAuthor(article_id=102, reporter_id=10, observation_source="jsonld"),
        ]
    )
    await db_session.flush()

    traces = await calculate_media_measurements(db_session, source_name="Example News")
    assert {trace.measurement_name for trace in traces} == {
        "publication_cadence",
        "corrections_retractions",
        "byline_coauthor_network",
        "original_vs_syndicated",
        "reporter_movement",
        "ownership_concentration",
    }
    for trace in traces:
        assert trace.algorithm_version == METHOD_VERSION
        assert "corpus_window" in trace.result
        assert "denominator" in trace.result
        assert "coverage" in trace.result
        assert trace.result["method_version"] == METHOD_VERSION
    by_name = {trace.measurement_name: trace for trace in traces}
    assert by_name["publication_cadence"].result["article_count"] == 2
    assert by_name["corrections_retractions"].result["correction_count"] == 1
    assert by_name["original_vs_syndicated"].result["syndicated_count"] == 1
    assert by_name["byline_coauthor_network"].result["coauthor_edges"] == [
        {"reporter_a": "Alex Editor", "reporter_b": "Jane Reporter", "article_count": 1}
    ]

    repeated = await calculate_media_measurements(db_session, source_name="Example News")
    assert [trace.id for trace in repeated] == [trace.id for trace in traces]


async def test_ownership_concentration_uses_current_accepted_relationships_only(db_session) -> None:
    owner = EvidenceEntity(
        id="owner", record_kind="legal_entity", entity_kind="public_company", canonical_name="Owner"
    )
    outlet_a = EvidenceEntity(
        id="outlet-a",
        record_kind="legal_entity",
        entity_kind="publication_brand",
        canonical_name="Outlet A",
    )
    outlet_b = EvidenceEntity(
        id="outlet-b",
        record_kind="legal_entity",
        entity_kind="publication_brand",
        canonical_name="Outlet B",
    )
    db_session.add_all([owner, outlet_a, outlet_b])
    db_session.add_all(
        [
            AcceptedRelationship(
                id="rel-current-a",
                subject_entity_id="outlet-a",
                predicate="directly_owns",
                object_entity_id="owner",
                qualifiers={},
                acceptance_policy_version="test",
                status="accepted",
                lifecycle_state="current",
                relationship_hash="hash-a",
            ),
            AcceptedRelationship(
                id="rel-current-b",
                subject_entity_id="outlet-b",
                predicate="directly_owns",
                object_entity_id="owner",
                qualifiers={},
                acceptance_policy_version="test",
                status="accepted",
                lifecycle_state="current",
                relationship_hash="hash-b",
            ),
            AcceptedRelationship(
                id="rel-proposed",
                subject_entity_id="outlet-b",
                predicate="directly_owns",
                object_entity_id="outlet-a",
                qualifiers={},
                acceptance_policy_version="test",
                status="accepted",
                lifecycle_state="proposed",
                relationship_hash="hash-c",
            ),
        ]
    )
    await db_session.flush()

    traces = await calculate_media_measurements(db_session)
    concentration = next(
        trace for trace in traces if trace.measurement_name == "ownership_concentration"
    )
    assert concentration.result["denominator"] == 2
    assert concentration.result["herfindahl_hirschman_index"] == "1.000000"
    assert concentration.result["owners"][0]["name"] == "Owner"
