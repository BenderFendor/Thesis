"""Tests for reporter source enrichment planning."""

from __future__ import annotations

from scripts.plan_reporter_source_enrichment import (
    ReporterSourceFact,
    build_enrichment_command,
    dedupe_reporter_facts_by_identity,
    summarize_reporter_backlog,
    summarize_source_backlog,
)


def test_sources_rank_by_likely_then_unverified_backlog() -> None:
    rows = summarize_source_backlog(
        [
            ReporterSourceFact("Source A", 1, "verified"),
            ReporterSourceFact("Source A", 2, "likely"),
            ReporterSourceFact("Source A", 3, "likely"),
            ReporterSourceFact("Source B", 4, "strong"),
            ReporterSourceFact("Source B", 5, "strong"),
            ReporterSourceFact("Source B", 6, "likely"),
            ReporterSourceFact("Source C", 7, "likely"),
            ReporterSourceFact("Source C", 8, "unmatched"),
            ReporterSourceFact("Source C", 8, "unmatched", article_count=3),
            ReporterSourceFact("Source C", 9, None),
        ]
    )

    assert [row.source for row in rows] == ["Source C", "Source A", "Source B"]
    assert rows[0].eligible_reporters == 3
    assert rows[0].likely_backlog == 3
    assert rows[1].likely_backlog == 2
    assert rows[2].unverified_reporters == 3


def test_target_math_uses_70_percent_verified_shortfall() -> None:
    rows = summarize_source_backlog(
        [
            ReporterSourceFact("Example News", 1, "verified"),
            ReporterSourceFact("Example News", 2, "verified"),
            ReporterSourceFact("Example News", 3, "likely"),
            ReporterSourceFact("Example News", 4, "likely"),
            ReporterSourceFact("Example News", 5, "strong"),
            ReporterSourceFact("Example News", 6, "unmatched"),
            ReporterSourceFact("Example News", 7, None),
            ReporterSourceFact("Example News", 8, "likely"),
            ReporterSourceFact("Example News", 9, "strong"),
            ReporterSourceFact("Example News", 10, "likely"),
        ]
    )

    row = rows[0]

    assert row.eligible_reporters == 10
    assert row.verified_reporters == 2
    assert row.verified_target_70pct == 7
    assert row.verified_shortfall == 5
    assert row.unverified_reporters == 8
    assert row.likely_backlog == 6


def test_strategy_command_generation_for_official_and_guessed_workflows() -> None:
    official_command = build_enrichment_command(
        "The New York Times",
        strategy_id="official_author_page_extraction",
        target_promotions=12,
    )
    guessed_command = build_enrichment_command(
        "The Guardian",
        strategy_id="guessed_author_page_profiles",
        target_promotions=4,
    )

    assert official_command == (
        "uv run python backend/scripts/enrich_local_reporter_author_pages.py"
        " --source 'The New York Times'"
        " --target-promotions 12"
        " --max-articles-per-reporter 3"
    )
    assert "--include-guessed-author-pages" in guessed_command
    assert "--max-guessed-author-pages 10" in guessed_command


def test_blocked_sources_get_manual_access_barrier_strategy() -> None:
    rows = summarize_source_backlog(
        [
            ReporterSourceFact("Bloomberg", 1, "likely"),
            ReporterSourceFact("Bloomberg", 2, "likely"),
        ],
        source_configs={"Bloomberg": {"url": "https://www.bloomberg.com/feed/podcast"}},
    )

    row = rows[0]

    assert row.strategy_id == "blocked_cloudflare_manual"
    assert "--limit-reporters 10" in row.command_template
    assert "access_barriers" in row.command_template


def test_known_source_overrides_use_stable_profile_guess_workflows() -> None:
    rows = summarize_source_backlog(
        [
            ReporterSourceFact("The Diplomat", 1, "likely"),
            ReporterSourceFact("The Guardian - UK", 2, "likely"),
        ]
    )

    strategies = {row.source: row.strategy_id for row in rows}

    assert strategies["The Diplomat"] == "guessed_author_page_profiles"
    assert strategies["The Guardian - UK"] == "guessed_author_page_profiles"


def test_reporter_backlog_rows_include_unverified_reporters_with_source_workflow() -> None:
    rows = summarize_reporter_backlog(
        [
            ReporterSourceFact(
                "ABC News Australia",
                1,
                "verified",
                reporter_name="Verified Person",
                article_count=3,
            ),
            ReporterSourceFact(
                "ABC News Australia",
                2,
                "likely",
                reporter_name="Likely Person",
                article_count=7,
            ),
            ReporterSourceFact(
                "ABC News Australia",
                3,
                "strong",
                reporter_name="Strong Person",
                article_count=2,
            ),
        ]
    )

    assert [(row.reporter_id, row.confidence_tier) for row in rows] == [
        (2, "likely"),
        (3, "strong"),
    ]
    assert rows[0].strategy_id == "official_author_page_extraction"
    assert rows[0].command_template.startswith(
        "uv run python backend/scripts/enrich_local_reporter_author_pages.py"
    )


def test_identity_dedupe_collapses_author_page_aliases_for_planning() -> None:
    facts = [
        ReporterSourceFact(
            "The Guardian",
            1,
            "verified",
            author_page_url="https://www.theguardian.com/profile/ali-martin/",
            reporter_name="Ali Martin at Lord's",
            canonical_name="Ali Martin",
            article_count=1,
        ),
        ReporterSourceFact(
            "The Guardian",
            2,
            "verified",
            author_page_url="https://theguardian.com/profile/ali-martin",
            reporter_name="Ali Martin at Edgbaston",
            canonical_name="Ali Martin",
            article_count=4,
        ),
        ReporterSourceFact(
            "The Guardian",
            3,
            "likely",
            reporter_name="Different Person",
            canonical_name="Different Person",
            article_count=2,
        ),
    ]

    deduped = dedupe_reporter_facts_by_identity(facts)

    assert len(deduped) == 2
    assert {fact.reporter_name for fact in deduped} == {
        "Ali Martin at Edgbaston",
        "Different Person",
    }


def test_disallowed_catalog_sources_are_excluded_from_broad_eligible_cohort() -> None:
    rows = summarize_source_backlog(
        [
            ReporterSourceFact("ArXiv CS (AI)", 1, "likely"),
            ReporterSourceFact("Example News", 2, "likely"),
        ],
        source_configs={
            "ArXiv CS (AI)": {"ownership_label": "academic preprint repository"},
            "Example News": {"ownership_label": "independent newspaper"},
        },
    )

    assert [row.source for row in rows] == ["Example News"]
