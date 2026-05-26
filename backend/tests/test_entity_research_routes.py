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


@pytest.mark.asyncio
async def test_source_profile_response_exposes_ad_supply_transparency(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.routes import entity_research

    async def _fake_get_source_profile(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "name": "Example Source",
            "canonical_name": "Example Source",
            "website": "https://example.com",
            "cached": False,
            "fields": {},
            "key_reporters": [],
            "overview": "Example Source profile.",
            "match_status": "matched",
            "dossier_sections": [
                {
                    "id": "transparency",
                    "title": "Transparency",
                    "status": "available",
                    "items": [
                        {
                            "label": "sellers.json cross-check",
                            "value": "1/1 checked ads.txt rows matched across 1/1 ad systems",
                            "sources": ["https://google.com/sellers.json"],
                        }
                    ],
                }
            ],
            "citations": [],
            "search_links": {},
            "match_explanation": "Built from public records.",
            "policy_transparency": {
                "checked_pages": 2,
                "available_signals": 1,
                "signals": [
                    {
                        "id": "corrections_process",
                        "label": "Corrections process",
                        "status": "available",
                        "sources": ["https://example.com/corrections"],
                        "matched_terms": ["corrections"],
                    }
                ],
            },
            "ads_txt": {
                "url": "https://example.com/ads.txt",
                "authorized_sellers": 1,
                "direct_sellers": 1,
                "resellers": 0,
                "duplicate_records": 0,
                "invalid_lines": 0,
                "owner_domains": ["example.com"],
                "manager_domains": [],
                "contact": [],
            },
            "sellers_json": {
                "checked_ad_systems": 1,
                "available_sellers_json": 1,
                "checked_records": 1,
                "matched_records": 1,
                "missing_seller_ids": 0,
                "owner_domain_matches": 1,
                "manager_domain_matches": 0,
                "systems": [
                    {
                        "ad_system_domain": "google.com",
                        "status": "available",
                        "ads_txt_records": 1,
                        "seller_count": 1,
                        "confidential_sellers": 0,
                        "matched_records": 1,
                        "missing_seller_ids": 0,
                        "owner_domain_matches": 1,
                        "manager_domain_matches": 0,
                        "sellers_json_url": "https://google.com/sellers.json",
                    }
                ],
            },
        }

    monkeypatch.setattr(entity_research, "get_source_profile", _fake_get_source_profile)

    response = await client.post(
        "/research/entity/source/profile",
        json={"name": "Example Source", "website": "https://example.com"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["policy_transparency"]["available_signals"] == 1
    assert data["ads_txt"]["url"] == "https://example.com/ads.txt"
    assert "records" not in data["ads_txt"]
    assert data["sellers_json"]["matched_records"] == 1
    assert data["sellers_json"]["systems"][0]["sellers_json_url"] == (
        "https://google.com/sellers.json"
    )
