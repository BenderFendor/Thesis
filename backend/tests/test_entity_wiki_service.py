"""Regression tests for deterministic entity wiki profiles."""

from __future__ import annotations

from typing import Any

import pytest


def _item_claim(item_id: str) -> dict[str, Any]:
    return {
        "mainsnak": {
            "datavalue": {
                "value": {
                    "id": item_id,
                }
            }
        }
    }


@pytest.mark.asyncio
async def test_reporter_dossier_uses_best_candidate_public_record_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import entity_wiki_service

    async def _fake_search_wikidata(
        *_args: Any, **_kwargs: Any
    ) -> list[dict[str, Any]]:
        return [
            {"id": "Q100", "concepturi": "https://www.wikidata.org/entity/Q100"},
            {"id": "Q200", "concepturi": "https://www.wikidata.org/entity/Q200"},
        ]

    async def _fake_fetch_entities(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [
            {
                "id": "Q100",
                "labels": {"en": {"value": "Jane Doe"}},
                "descriptions": {"en": {"value": "journalist at Test News"}},
                "sitelinks": {"enwiki": {"title": "Jane Doe"}},
                "claims": {
                    "P31": [_item_claim("Q5")],
                    "P106": [_item_claim("QJOURNALIST")],
                    "P108": [_item_claim("QTESTNEWS")],
                    "P101": [_item_claim("QINVESTIGATIVE")],
                    "P1416": [_item_claim("QIRE")],
                },
            },
            {
                "id": "Q200",
                "labels": {"en": {"value": "Janet Roe"}},
                "descriptions": {"en": {"value": "sports columnist"}},
                "sitelinks": {"enwiki": {"title": "Janet Roe"}},
                "claims": {
                    "P31": [_item_claim("Q5")],
                    "P106": [_item_claim("QJOURNALIST")],
                    "P108": [_item_claim("QOTHERNEWS")],
                    "P101": [_item_claim("QSPORTS")],
                    "P1416": [_item_claim("QOTHERCLUB")],
                },
            },
        ]

    async def _fake_resolve_labels(*_args: Any, **_kwargs: Any) -> dict[str, str]:
        return {
            "QJOURNALIST": "journalist",
            "QTESTNEWS": "Test News",
            "QINVESTIGATIVE": "investigative reporting",
            "QIRE": "Investigative Reporters and Editors",
            "QOTHERNEWS": "Other News",
            "QSPORTS": "sports",
            "QOTHERCLUB": "Other Club",
        }

    async def _fake_wikipedia_summary(*_args: Any, **_kwargs: Any) -> dict[str, str]:
        return {
            "title": "Jane Doe",
            "extract": "Jane Doe is a journalist at Test News.",
            "url": "https://en.wikipedia.org/wiki/Jane_Doe",
        }

    monkeypatch.setattr(entity_wiki_service, "_search_wikidata", _fake_search_wikidata)
    monkeypatch.setattr(entity_wiki_service, "_fetch_entities", _fake_fetch_entities)
    monkeypatch.setattr(entity_wiki_service, "_resolve_labels", _fake_resolve_labels)
    monkeypatch.setattr(
        entity_wiki_service, "_fetch_wikipedia_summary", _fake_wikipedia_summary
    )

    profile = await entity_wiki_service.build_reporter_dossier(
        name="Jane Doe",
        organization="Test News",
    )

    assert profile["wikidata_qid"] == "Q100"
    assert "investigative reporting" in profile["topics"]
    assert "sports" not in profile["topics"]

    public_record = next(
        section
        for section in profile["dossier_sections"]
        if section["id"] == "occupations"
    )
    values = {item["value"] for item in public_record["items"]}
    assert "investigative reporting" in values
    assert "Investigative Reporters and Editors" in values
    assert "sports" not in values
    assert "Other Club" not in values
