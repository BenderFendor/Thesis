"""Focused regression tests for entity research routes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_reporter_profile_cache_uses_resolver_key_only(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import entity_research

    called: dict[str, bool] = {"value": False}

    async def _fake_build_reporter_dossier(
        name: str,
        organization: str | None = None,
        article_context: str | None = None,
    ) -> dict[str, object]:
        called["value"] = True
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

    monkeypatch.setattr(
        entity_research,
        "build_reporter_dossier",
        _fake_build_reporter_dossier,
    )

    response = await client.post(
        "/research/entity/reporter/profile",
        json={"name": "Jane Doe", "organization": "Other Outlet"},
    )

    assert response.status_code == 200
    data = response.json()
    assert called["value"] is True
    assert data["canonical_name"] == "Jane Doe at Other Outlet"
    assert data["cached"] is False


@pytest.mark.asyncio
async def test_reporter_refresh_clears_stale_legacy_leaning_fields(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import entity_research

    async def _fake_build_reporter_dossier(
        name: str,
        organization: str | None = None,
        article_context: str | None = None,
    ) -> dict[str, object]:
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

    monkeypatch.setattr(
        entity_research,
        "build_reporter_dossier",
        _fake_build_reporter_dossier,
    )

    response = await client.post(
        "/research/entity/reporter/profile?force_refresh=true",
        json={"name": "Jane Doe", "organization": "Test News"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["political_leaning"] is None
    assert data["leaning_confidence"] is None
