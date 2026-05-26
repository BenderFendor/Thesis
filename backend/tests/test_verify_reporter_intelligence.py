"""Regression tests for reporter intelligence verification."""

from __future__ import annotations

from typing import Any

import pytest

from app.database import Reporter
from scripts import verify_reporter_intelligence as verifier


class FakeSession:
    async def execute(self, _stmt: Any) -> Any:
        raise AssertionError("unexpected database call")


async def fake_compute_confidence_tier(
    _session: Any,
    reporter: Reporter,
) -> tuple[str, float, dict[str, Any]]:
    return str(reporter.confidence_tier or "unmatched"), float(reporter.confidence_score or 0.0), {}


def test_source_names_from_career_history_dedupes_organizations() -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        career_history=[
            {"organization": "BBC"},
            {"organization": " BBC "},
            {"organization": "CNN"},
            {"source": "wikidata"},
            "invalid",
        ],
    )

    assert verifier._source_names_from_career_history(reporter) == ["BBC", "CNN"]


def test_reporter_attribution_totals_count_unique_reporter_paths() -> None:
    reporters = [
        Reporter(id=1, name="Article Reporter", career_history=[{"organization": "BBC"}]),
        Reporter(id=2, name="Career Reporter", career_history=[{"organization": "CNN"}]),
        Reporter(id=3, name="Unknown Reporter"),
    ]

    assert verifier._reporter_attribution_totals(reporters, {1: ["Article Source"]}) == {
        "article": 1,
        "career": 1,
        "unknown": 1,
    }


def test_quality_audit_flags_verified_rows_without_person_evidence() -> None:
    reporters = [
        Reporter(
            id=1,
            name="Jane Doe",
            confidence_tier="verified",
            author_page_url="https://example.org/author/jane",
            citations=[{"label": "Official author page", "url": "https://example.org/author/jane"}],
        ),
        Reporter(
            id=2,
            name="Guest Contributor",
            confidence_tier="verified",
            author_page_url="https://example.org/author/guest",
            citations=[
                {"label": "Official author page", "url": "https://example.org/author/guest"}
            ],
        ),
        Reporter(
            id=3,
            name="John Public",
            confidence_tier="verified",
            author_page_url="https://test.local/author/john",
            citations=[{"label": "Official author page", "url": "https://test.local/author/john"}],
        ),
        Reporter(
            id=4,
            name="Jane Missing",
            confidence_tier="verified",
            author_page_url="https://example.org/author/missing",
            citations=[],
        ),
    ]

    audit = verifier._audit_reporter_quality(reporters)

    assert audit["verified_reporters"] == 4
    assert audit["verified_person_names"] == 3
    assert audit["verified_public_author_pages"] == 3
    assert audit["verified_author_page_citations"] == 3
    assert audit["quality_failures"] == 3
    assert audit["sample_verified_non_person_names"] == ["2:Guest Contributor"]
    assert audit["sample_verified_non_public_author_pages"] == [
        "3:John Public:https://test.local/author/john"
    ]
    assert audit["sample_verified_missing_author_page_citations"] == [
        "4:Jane Missing:https://example.org/author/missing"
    ]


def test_profile_audit_flags_bad_strong_and_stale_local_profiles() -> None:
    reporters = [
        Reporter(
            id=1,
            name="Jane Doe",
            canonical_name="Jane Doe",
            confidence_tier="strong",
            wikidata_qid="Q1",
            dossier_sections=[
                {
                    "items": [
                        {"label": "Occupation", "value": "journalist"},
                    ]
                }
            ],
        ),
        Reporter(
            id=2,
            name="q12181423",
            canonical_name="q12181423",
            confidence_tier="strong",
            wikidata_qid="Q12181423",
            overview="journalist",
        ),
        Reporter(
            id=3,
            name="Old Combined and Name",
            canonical_name="Old Combined and Name",
            confidence_tier="likely",
            match_status="local_byline",
        ),
        Reporter(
            id=4,
            name="Linked Person",
            canonical_name="Linked Person",
            confidence_tier="likely",
            match_status="local_byline",
        ),
        Reporter(
            id=5,
            name="Example News",
            canonical_name="Example News",
            confidence_tier="likely",
            match_status="local_byline",
            career_history=[{"organization": "Example News"}],
        ),
    ]

    audit = verifier._profile_issue_samples(reporters, {4: ["Example News"], 5: ["Example News"]})

    assert audit["quality_failures"] == 5
    assert audit["issue_counts"] == {
        "strong_missing_person_like_name": 1,
        "strong_qid_label_name": 1,
        "likely_local_byline_without_article_links": 1,
        "likely_combined_local_byline_name": 1,
        "likely_source_label_local_byline_name": 1,
    }


def test_profile_audit_accepts_strong_profile_with_journalism_dossier_evidence() -> None:
    reporters = [
        Reporter(
            id=1,
            name="Yann Levy",
            canonical_name="Yann Levy",
            confidence_tier="strong",
            wikidata_qid="Q16683631",
            overview="French photographer",
            dossier_sections=[
                {
                    "items": [
                        {"label": "Occupation", "value": "photographer"},
                        {"label": "Occupation", "value": "journalist"},
                    ]
                }
            ],
        )
    ]

    audit = verifier._profile_issue_samples(reporters, {})

    assert audit["quality_failures"] == 0
    assert audit["issue_counts"] == {}


def test_profile_audit_accepts_verified_official_author_page_without_role_terms() -> None:
    reporters = [
        Reporter(
            id=1,
            name="Jane Doe",
            canonical_name="Jane Doe",
            confidence_tier="verified",
            match_status="local_byline",
            author_page_url="https://example.org/author/jane",
            citations=[
                {
                    "label": "Official author page",
                    "url": "https://example.org/author/jane",
                    "source_type": "official_author_page",
                }
            ],
        )
    ]

    audit = verifier._profile_issue_samples(reporters, {1: ["Example News"]})

    assert audit["quality_failures"] == 0
    assert audit["issue_counts"] == {}


def test_identity_alias_audit_reports_duplicate_author_pages_and_raw_residue() -> None:
    reporters = [
        Reporter(
            id=1,
            name="Ali Martin at Lord's",
            canonical_name="Ali Martin",
            confidence_tier="verified",
            author_page_url="https://www.theguardian.com/profile/ali-martin",
        ),
        Reporter(
            id=2,
            name="Ali Martin at Edgbaston",
            canonical_name="Ali Martin",
            confidence_tier="verified",
            author_page_url="https://theguardian.com/profile/ali-martin/",
        ),
        Reporter(
            id=3,
            name="Jane Reporter",
            canonical_name="Jane Reporter",
            confidence_tier="strong",
            author_page_url="https://example.org/author/jane",
        ),
    ]

    audit = verifier._identity_alias_audit(reporters)

    assert audit["tiered_reporters"] == 3
    assert audit["tiered_author_page_identities"] == 2
    assert audit["duplicate_author_page_groups"] == 1
    assert audit["duplicate_author_page_rows"] == 1
    assert audit["raw_byline_residue"] == 2
    assert audit["quality_failures"] == 1
    assert audit["sample_duplicate_author_pages"][0]["author_url"] == (
        "https://theguardian.com/profile/ali-martin"
    )


def _reporter(
    reporter_id: int,
    name: str,
    tier: str,
) -> Reporter:
    return Reporter(
        id=reporter_id,
        name=name,
        canonical_name=name,
        confidence_tier=tier,
    )


def test_eligible_cohort_audit_reports_70_percent_target_and_leakage() -> None:
    reporters = [
        _reporter(1, "Verified One", "verified"),
        _reporter(2, "Verified Two", "verified"),
        _reporter(3, "Strong Person", "strong"),
        _reporter(4, "Likely Person", "likely"),
        _reporter(5, "Tiny Sample", "verified"),
        _reporter(6, "Example News", "verified"),
        _reporter(7, "Combined Person and Second Person", "verified"),
    ]

    audit = verifier._eligible_cohort_audit(
        reporters,
        {
            1: ["Example News"],
            2: ["Example News"],
            3: ["Example News"],
            4: ["Example News"],
            5: ["Example News"],
            6: ["Example News"],
            7: ["Example News"],
        },
        {1: 5, 2: 6, 3: 9, 4: 10, 5: 2, 6: 12, 7: 12},
        min_article_links=5,
        target_verified_percent=70.0,
        top_sources_limit=3,
    )

    assert audit["eligible_reporters"] == 4
    assert audit["all_reporters"] == 7
    assert audit["all_verified_reporters"] == 5
    assert audit["all_verified_percent"] == 71.43
    assert audit["all_target_verified_reporters"] == 5
    assert audit["all_verified_shortfall"] == 0
    assert audit["verified_reporters"] == 2
    assert audit["strong_reporters"] == 1
    assert audit["likely_reporters"] == 1
    assert audit["verified_percent"] == 50.0
    assert audit["target_verified_reporters"] == 3
    assert audit["verified_shortfall"] == 1
    assert audit["non_strong_leakage"] == 1
    assert audit["quality_failures"] == 2
    assert audit["top_sources"] == [
        {
            "source": "Example News",
            "eligible": 4,
            "verified": 2,
            "strong": 1,
            "likely": 1,
            "unmatched": 0,
            "unverified": 2,
            "non_strong_leakage": 1,
            "article_links": 30,
        }
    ]


def test_eligible_cohort_audit_passes_when_remaining_profiles_are_strong() -> None:
    reporters = [
        *[_reporter(i, f"Verified Person {i}", "verified") for i in range(1, 8)],
        *[_reporter(i, f"Strong Person {i}", "strong") for i in range(8, 11)],
    ]
    reporter_sources = {int(reporter.id): ["Example News"] for reporter in reporters}
    article_counts = {int(reporter.id): 5 for reporter in reporters}

    audit = verifier._eligible_cohort_audit(
        reporters,
        reporter_sources,
        article_counts,
        min_article_links=5,
        target_verified_percent=70.0,
        top_sources_limit=1,
    )

    assert audit["eligible_reporters"] == 10
    assert audit["verified_reporters"] == 7
    assert audit["strong_reporters"] == 3
    assert audit["verified_shortfall"] == 0
    assert audit["non_strong_leakage"] == 0
    assert audit["quality_failures"] == 0


@pytest.mark.asyncio
async def test_source_metrics_fall_back_to_career_history(monkeypatch) -> None:
    monkeypatch.setattr(verifier, "compute_confidence_tier", fake_compute_confidence_tier)
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        career_history=[{"organization": "BBC", "source": "wikidata"}],
        confidence_tier="strong",
        confidence_score=0.85,
        claims_count=2,
        author_page_url="https://example.org/author/jane",
    )

    sources = await verifier._compute_source_metrics([reporter], {}, FakeSession())

    assert set(sources) == {"BBC"}
    assert sources["BBC"]["total_reporters"] == 1
    assert sources["BBC"]["article_source_reporters"] == 0
    assert sources["BBC"]["career_source_reporters"] == 1
    assert sources["BBC"]["unknown_source_reporters"] == 0
    assert sources["BBC"]["with_public_author_page_url"] == 1
    assert sources["BBC"]["with_claims"] == 1


@pytest.mark.asyncio
async def test_source_metrics_count_verified_author_page_citations(monkeypatch) -> None:
    monkeypatch.setattr(verifier, "compute_confidence_tier", fake_compute_confidence_tier)
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        confidence_tier="verified",
        confidence_score=1.0,
        author_page_url="https://example.org/author/jane",
        citations=[
            {
                "label": "Official author page",
                "url": "https://example.org/author/jane",
            }
        ],
    )

    sources = await verifier._compute_source_metrics(
        [reporter],
        {1: ["Example News"]},
        FakeSession(),
    )

    assert sources["Example News"]["with_author_page_url"] == 1
    assert sources["Example News"]["with_public_author_page_url"] == 1
    assert sources["Example News"]["verified_author_page_citations"] == 1


@pytest.mark.asyncio
async def test_article_source_mapping_takes_precedence_over_career_history(monkeypatch) -> None:
    monkeypatch.setattr(verifier, "compute_confidence_tier", fake_compute_confidence_tier)
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        career_history=[{"organization": "BBC", "source": "wikidata"}],
        confidence_tier="likely",
        confidence_score=0.6,
    )

    sources = await verifier._compute_source_metrics(
        [reporter],
        {1: ["Article Source"]},
        FakeSession(),
    )

    assert set(sources) == {"Article Source"}
    assert sources["Article Source"]["article_source_reporters"] == 1
    assert sources["Article Source"]["career_source_reporters"] == 0
    assert sources["Article Source"]["unknown_source_reporters"] == 0
