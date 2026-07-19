"""Regression tests for Atlas relationship matching and trust rules."""

from types import SimpleNamespace

from app.services.atlas_graph_helpers import (
    confidence_tier,
    normalize_entity_label,
    reporter_confidence_tier,
    stable_source_id,
)


def test_normalized_matching_is_exact_not_substring() -> None:
    assert normalize_entity_label("RT") == "rt"
    assert normalize_entity_label("Hartford Courant") == "hartford courant"
    assert normalize_entity_label("RT") != normalize_entity_label("Hartford Courant")
    assert normalize_entity_label("Reuters") != normalize_entity_label("Thomson Reuters Foundation")


def test_stable_source_ids_are_deterministic_and_distinct() -> None:
    assert stable_source_id("Reuters") == stable_source_id(" Reuters ")
    assert stable_source_id("RT") != stable_source_id("Hartford Courant")


def test_reporter_verification_requires_person_level_profile() -> None:
    byline_only = SimpleNamespace(
        author_page_url=None,
        canonical_author_url=None,
        match_status="matched",
        research_confidence="high",
    )
    person_profile = SimpleNamespace(
        author_page_url="https://example.com/authors/alex",
        canonical_author_url=None,
        match_status="matched",
        research_confidence="high",
    )
    assert reporter_confidence_tier(byline_only) == "likely"
    assert reporter_confidence_tier(person_profile) == "verified"


def test_confidence_labels_are_explicit() -> None:
    assert confidence_tier(0.95) == "verified"
    assert confidence_tier(0.8) == "strong"
    assert confidence_tier(0.6) == "likely"
    assert confidence_tier(None) == "unresolved"
    assert confidence_tier(0.95, stale=True) == "stale"
