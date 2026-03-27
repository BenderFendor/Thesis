"""Focused route-unit regressions for the review fixes."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Iterable

import pytest


class _ScalarResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Any:
        return self._value

    def scalar_one(self) -> Any:
        return self._value


class _ScalarsWrapper:
    def __init__(self, values: Iterable[Any]) -> None:
        self._values = list(values)

    def all(self) -> list[Any]:
        return list(self._values)


class _ListResult:
    def __init__(self, values: Iterable[Any]) -> None:
        self._values = list(values)

    def scalars(self) -> _ScalarsWrapper:
        return _ScalarsWrapper(self._values)

    def all(self) -> list[Any]:
        return list(self._values)


class _FakeAsyncSession:
    def __init__(self, execute_results: list[Any]) -> None:
        self._execute_results = list(execute_results)
        self.added: list[Any] = []
        self.committed = False

    async def execute(self, _stmt: Any) -> Any:
        if not self._execute_results:
            raise AssertionError("Unexpected execute() call")
        return self._execute_results.pop(0)

    def add(self, value: Any) -> None:
        self.added.append(value)

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, _value: Any) -> None:
        return None


@dataclass
class _ReporterRow:
    id: int | None = None
    name: str | None = None
    normalized_name: str | None = None
    bio: str | None = None
    career_history: list[dict[str, Any]] | None = None
    topics: list[str] | None = None
    education: list[dict[str, Any]] | None = None
    political_leaning: str | None = None
    leaning_confidence: str | None = None
    leaning_sources: list[str] | None = None
    twitter_handle: str | None = None
    linkedin_url: str | None = None
    wikipedia_url: str | None = None
    wikidata_qid: str | None = None
    wikidata_url: str | None = None
    canonical_name: str | None = None
    resolver_key: str | None = None
    match_status: str | None = None
    overview: str | None = None
    dossier_sections: list[dict[str, Any]] | None = None
    citations: list[dict[str, str]] | None = None
    search_links: dict[str, str] | None = None
    match_explanation: str | None = None
    research_sources: list[str] | None = None
    research_confidence: str | None = None


@pytest.mark.asyncio
async def test_profile_reporter_does_not_fallback_to_wrong_normalized_name_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import entity_research

    async def _fake_build_reporter_dossier(
        name: str,
        organization: str | None = None,
        article_context: str | None = None,
    ) -> dict[str, Any]:
        return {
            "name": name,
            "normalized_name": name.lower(),
            "canonical_name": "Jane Doe at Other Outlet",
            "match_status": "matched",
            "bio": "Freshly resolved profile.",
            "career_history": [],
            "topics": ["politics"],
            "education": [],
            "political_leaning": None,
            "leaning_confidence": None,
            "leaning_sources": None,
            "twitter_handle": None,
            "linkedin_url": None,
            "wikipedia_url": "https://en.wikipedia.org/wiki/Jane_Doe",
            "wikidata_qid": "Q200",
            "wikidata_url": "https://www.wikidata.org/wiki/Q200",
            "overview": "Freshly resolved profile.",
            "dossier_sections": [],
            "citations": [],
            "search_links": {},
            "match_explanation": "Matched for a different outlet.",
            "research_sources": ["wikidata"],
            "research_confidence": "high",
        }

    async def _identity_wikipedia_url(url: str | None) -> str | None:
        return url

    monkeypatch.setattr(
        entity_research,
        "build_reporter_dossier",
        _fake_build_reporter_dossier,
    )
    monkeypatch.setattr(
        entity_research,
        "_ensure_english_wikipedia_url",
        _identity_wikipedia_url,
    )

    session = _FakeAsyncSession(
        [
            _ScalarResult(None),  # cache miss by resolver_key
            _ScalarResult(None),  # no existing row for upsert
        ]
    )

    response = await entity_research.profile_reporter(
        request=entity_research.ReporterProfileRequest(
            name="Jane Doe",
            organization="Other Outlet",
        ),
        db=session,
        force_refresh=False,
    )

    assert response.canonical_name == "Jane Doe at Other Outlet"
    assert response.cached is False
    assert len(session.added) == 1


@pytest.mark.asyncio
async def test_profile_reporter_refresh_clears_stale_legacy_leaning_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import entity_research

    async def _fake_build_reporter_dossier(
        name: str,
        organization: str | None = None,
        article_context: str | None = None,
    ) -> dict[str, Any]:
        return {
            "name": name,
            "normalized_name": name.lower(),
            "canonical_name": "Jane Doe",
            "match_status": "matched",
            "bio": "Freshly resolved profile.",
            "career_history": [],
            "topics": ["politics"],
            "education": [],
            "political_leaning": None,
            "leaning_confidence": None,
            "leaning_sources": None,
            "twitter_handle": None,
            "linkedin_url": None,
            "wikipedia_url": "https://en.wikipedia.org/wiki/Jane_Doe",
            "wikidata_qid": "Q100",
            "wikidata_url": "https://www.wikidata.org/wiki/Q100",
            "overview": "Freshly resolved profile.",
            "dossier_sections": [],
            "citations": [],
            "search_links": {},
            "match_explanation": "Matched without leaning data.",
            "research_sources": ["wikidata"],
            "research_confidence": "high",
        }

    async def _identity_wikipedia_url(url: str | None) -> str | None:
        return url

    monkeypatch.setattr(
        entity_research,
        "build_reporter_dossier",
        _fake_build_reporter_dossier,
    )
    monkeypatch.setattr(
        entity_research,
        "_ensure_english_wikipedia_url",
        _identity_wikipedia_url,
    )

    existing = _ReporterRow(
        id=1,
        name="Jane Doe",
        normalized_name="jane doe",
        political_leaning="center-left",
        leaning_confidence="high",
        leaning_sources=["legacy"],
        resolver_key="jane doe::test news",
        match_status="matched",
    )
    session = _FakeAsyncSession([_ScalarResult(existing)])

    response = await entity_research.profile_reporter(
        request=entity_research.ReporterProfileRequest(
            name="Jane Doe",
            organization="Test News",
        ),
        db=session,
        force_refresh=True,
    )

    assert response.political_leaning is None
    assert response.leaning_confidence is None
    assert existing.leaning_sources is None


@pytest.mark.asyncio
async def test_get_source_wiki_aggregates_deduplicated_source_variants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import wiki

    rss_sources = {
        "Right Report - 1": {
            "url": "https://rightreport.example.com/rss/1",
            "category": "opinion",
            "country": "US",
            "funding_type": "commercial",
            "bias_rating": "right",
        },
        "Right Report - 2": {
            "url": "https://rightreport.example.com/rss/2",
            "category": "opinion",
            "country": "US",
            "funding_type": "commercial",
            "bias_rating": "right",
        },
    }

    async def _fake_get_source_profile(
        source_name: str,
        website: str | None = None,
        force_refresh: bool = False,
        cache_only: bool = False,
    ) -> dict[str, Any] | None:
        if source_name == "Right Report - 1":
            return {
                "overview": "Variant profile",
                "match_status": "matched",
                "wikipedia_url": None,
                "wikidata_qid": None,
                "wikidata_url": None,
                "dossier_sections": [],
                "citations": [],
                "search_links": {},
                "match_explanation": "Loaded from variant cache.",
            }
        return None

    monkeypatch.setattr(wiki, "get_rss_sources", lambda: rss_sources)
    monkeypatch.setattr(wiki, "get_source_profile", _fake_get_source_profile)

    score_entry = SimpleNamespace(
        source_name="Right Report - 1",
        axis_name="funding",
        score=4,
        confidence="medium",
        prose_explanation="Variant funding score.",
        citations=[],
        empirical_basis="Test basis.",
        scored_by="test",
        last_scored_at=None,
    )
    metadata_entry = SimpleNamespace(
        source_name="Right Report - 1",
        parent_company="Right Report Media",
        credibility_score=0.42,
        is_state_media=False,
        source_type="digital",
        geographic_focus=["US"],
        topic_focus=["opinion"],
    )
    reporter_row = SimpleNamespace(
        id=7,
        name="Casey Smith",
        topics=["politics"],
        political_leaning="right",
        article_count=3,
    )
    status_entry = SimpleNamespace(
        entity_name="Right Report - 1",
        status="complete",
        last_indexed_at=None,
    )

    session = _FakeAsyncSession(
        [
            _ListResult([score_entry]),
            _ListResult([metadata_entry]),
            _ScalarResult(1),
            _ListResult([reporter_row]),
            _ScalarResult(None),
            _ListResult([status_entry]),
        ]
    )

    response = await wiki.get_source_wiki(source_name="Right Report", db=session)

    assert response.name == "Right Report"
    assert response.article_count == 1
    assert response.parent_company == "Right Report Media"
    assert response.index_status == "complete"
    assert any(axis.axis_name == "funding" for axis in response.analysis_axes)
