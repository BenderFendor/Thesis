"""Regression tests for official reporter author-page enrichment."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, Reporter
from scripts.enrich_local_reporter_author_pages import (
    _candidate_author_pages,
    _guessed_author_pages,
    _profile_name_matches_reporter,
    _set_author_page_citation,
    repair_verified_author_page_citations,
)


def test_set_author_page_citation_assigns_new_json_list() -> None:
    reporter = Reporter(
        id=1,
        name="Jane Doe",
        author_page_url="https://example.org/author/jane",
        citations=[{"label": "Local article evidence", "url": "https://example.org/story"}],
    )

    changed = _set_author_page_citation(reporter, "https://example.org/author/jane")

    assert changed is True
    assert reporter.citations == [
        {"label": "Local article evidence", "url": "https://example.org/story"},
        {
            "label": "Official author page",
            "url": "https://example.org/author/jane",
            "source_type": "official_author_page",
        },
    ]
    assert _set_author_page_citation(reporter, "https://example.org/author/jane") is False


def test_profile_name_match_requires_person_like_names() -> None:
    assert _profile_name_matches_reporter("Jane Doe", "BY JANE DOE") is True
    assert _profile_name_matches_reporter("Guest Contributor", "Guest Contributor") is False
    assert _profile_name_matches_reporter("Agencia EFE", "Agencia EFE") is False
    assert _profile_name_matches_reporter("MND Plus", "MND Plus") is False
    assert _profile_name_matches_reporter("El Jalapeno", "El Jalapeno") is False
    assert _profile_name_matches_reporter("Contributing Writer", "Contributing Writer") is False
    assert _profile_name_matches_reporter("L'Equipe TV", "L'Equipe TV") is False
    assert (
        _profile_name_matches_reporter(
            "The FRANCE 24 Observers",
            "The FRANCE 24 Observers",
        )
        is False
    )


def test_guessed_author_pages_builds_bounded_same_host_candidates() -> None:
    candidates = _guessed_author_pages(
        "https://www.theguardian.com/us-news/2026/apr/01/story",
        "Amelia Gentleman",
        max_candidates=5,
    )

    assert candidates[:2] == [
        "https://www.theguardian.com/profile/ameliagentleman",
        "https://www.theguardian.com/profile/amelia-gentleman",
    ]
    assert "https://www.theguardian.com/by/amelia-gentleman" in candidates
    assert len(candidates) == 5
    assert all(candidate.startswith("https://www.theguardian.com/") for candidate in candidates)


def test_guessed_author_pages_include_host_specific_short_slug_patterns() -> None:
    assert _guessed_author_pages(
        "https://www.axios.com/2026/04/01/story",
        "Hans Nichols",
        max_candidates=3,
    ) == [
        "https://www.axios.com/authors/hnichols",
        "https://www.axios.com/authors/hans-nichols",
        "https://www.axios.com/authors/hansnichols",
    ]
    assert _guessed_author_pages(
        "https://indianexpress.com/article/india/story/",
        "Anurag Bhaskar",
        max_candidates=2,
    ) == [
        "https://indianexpress.com/profile/author/anurag-bhaskar/",
        "https://indianexpress.com/profile/guest-writer/anurag-bhaskar/",
    ]
    assert _guessed_author_pages(
        "https://www.nationalreview.com/2026/05/story/",
        "Noah Rothman",
        max_candidates=2,
    ) == [
        "https://www.nationalreview.com/author/noah-rothman/",
        "https://www.nationalreview.com/by/noah-rothman",
    ]
    assert _guessed_author_pages(
        "https://www.phillyvoice.com/story/",
        "Adam Aaronson",
        max_candidates=2,
    ) == [
        "https://www.phillyvoice.com/staff-contributors/adam-aaronson/",
        "https://www.phillyvoice.com/by/adam-aaronson",
    ]
    assert _guessed_author_pages(
        "https://thediplomat.com/2026/04/story/",
        "Shannon Tiezzi",
        max_candidates=2,
    ) == [
        "https://thediplomat.com/authors/shannon-tiezzi/",
        "https://thediplomat.com/by/shannon-tiezzi",
    ]
    assert _guessed_author_pages(
        "https://warontherocks.com/story/",
        "Michael Kofman",
        max_candidates=2,
    ) == [
        "https://warontherocks.com/author/michael-kofman/",
        "https://warontherocks.com/by/michael-kofman",
    ]
    assert _guessed_author_pages(
        "https://www.washingtontimes.com/news/2026/apr/1/story/",
        "Ramsey Touchberry",
        max_candidates=2,
    ) == [
        "https://www.washingtontimes.com/staff/ramsey-touchberry/",
        "https://www.washingtontimes.com/by/ramsey-touchberry",
    ]


def test_guessed_author_pages_rejects_generic_reporter_name() -> None:
    assert (
        _guessed_author_pages(
            "https://example.org/news/story",
            "Press Release",
            max_candidates=5,
        )
        == []
    )


def test_candidate_author_pages_prefers_article_signals_over_guesses() -> None:
    candidates = _candidate_author_pages(
        {"author_pages": ["https://www.nytimes.com/by/carlos-lozada"]},
        "https://www.nytimes.com/2026/04/01/opinion/story.html",
        "Carlos Lozada",
        include_guessed=True,
        max_guessed_pages=3,
    )

    assert candidates == [("https://www.nytimes.com/by/carlos-lozada", "profile_name_match")]


def test_candidate_author_pages_adds_guesses_when_only_cross_host_signals_exist() -> None:
    candidates = _candidate_author_pages(
        {"author_pages": ["https://bsky.app/profile/phillyvoice.com"]},
        "https://www.phillyvoice.com/sixers-news-analysis/",
        "Adam Aaronson",
        include_guessed=True,
        max_guessed_pages=1,
    )

    assert candidates == [
        ("https://bsky.app/profile/phillyvoice.com", "profile_name_match"),
        (
            "https://www.phillyvoice.com/staff-contributors/adam-aaronson/",
            "guessed_profile_name_match",
        ),
    ]


def test_candidate_author_pages_adds_guesses_when_signals_absent() -> None:
    candidates = _candidate_author_pages(
        {"author_pages": []},
        "https://www.nytimes.com/2026/04/01/opinion/story.html",
        "Carlos Lozada",
        include_guessed=True,
        max_guessed_pages=3,
    )

    assert candidates == [
        ("https://www.nytimes.com/by/carlos-lozada", "guessed_profile_name_match"),
        ("https://www.nytimes.com/by/carloslozada", "guessed_profile_name_match"),
        ("https://www.nytimes.com/by/clozada", "guessed_profile_name_match"),
    ]


@pytest.mark.asyncio
async def test_repair_verified_author_page_citations_writes_missing_citation() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as session:
        session.add(
            Reporter(
                id=1,
                name="Jane Doe",
                confidence_tier="verified",
                author_page_url="https://example.org/author/jane",
                canonical_author_url="https://example.org/author/jane",
                citations=[{"label": "Local article evidence", "url": "https://example.org/story"}],
            )
        )
        await session.commit()

        metrics = await repair_verified_author_page_citations(session, apply=True)
        reporter = (await session.execute(select(Reporter).where(Reporter.id == 1))).scalar_one()

    assert metrics.reporters_scanned == 1
    assert metrics.public_author_pages == 1
    assert metrics.citations_missing == 1
    assert metrics.citations_repaired == 1
    assert {
        "label": "Official author page",
        "url": "https://example.org/author/jane",
        "source_type": "official_author_page",
    } in reporter.citations

    await engine.dispose()
