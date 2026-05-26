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

    async def _fake_search_wikidata(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
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
    monkeypatch.setattr(entity_wiki_service, "_fetch_wikipedia_summary", _fake_wikipedia_summary)

    profile = await entity_wiki_service.build_reporter_dossier(
        name="Jane Doe",
        organization="Test News",
    )

    assert profile["wikidata_qid"] == "Q100"
    assert "investigative reporting" in profile["topics"]
    assert "sports" not in profile["topics"]

    public_record = next(
        section for section in profile["dossier_sections"] if section["id"] == "occupations"
    )
    values = {item["value"] for item in public_record["items"]}
    assert "investigative reporting" in values
    assert "Investigative Reporters and Editors" in values
    assert "sports" not in values
    assert "Other Club" not in values


@pytest.mark.asyncio
async def test_source_profile_uses_specific_citation_labels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import entity_wiki_service

    class FakeResearcher:
        async def research_organization(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {
                "description": "Example Source is a news outlet.",
                "website": "https://example.com",
                "wikipedia_url": "https://en.wikipedia.org/wiki/Example_Source",
                "wikidata_url": "https://www.wikidata.org/wiki/Q123",
                "funding_type": "commercial",
                "research_sources": ["wikipedia", "wikidata"],
                "research_confidence": "medium",
            }

    async def _fake_site_pages(*_args: Any, **_kwargs: Any) -> list[dict[str, str]]:
        return [
            {
                "label": "about",
                "url": "https://example.com/about",
                "summary": "Example Source publishes independent journalism and discloses funding.",
            },
            {
                "label": "editorial_standards",
                "url": "https://example.com/standards",
                "summary": "Example Source has written editorial standards for accuracy and fairness.",
            },
            {
                "label": "corrections",
                "url": "https://example.com/corrections",
                "summary": "Example Source publishes corrections and clarifications for errors.",
            },
            {
                "label": "masthead",
                "url": "https://example.com/authors",
                "summary": "Example Source lists its staff, reporters, and authors.",
            },
        ]

    async def _fake_fetch_ads_txt(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {
            "url": "https://example.com/ads.txt",
            "records": [
                {
                    "ad_system_domain": "google.com",
                    "publisher_account_id": "pub-123",
                    "relationship": "DIRECT",
                    "certification_authority_id": "f08c47fec0942fa0",
                }
            ],
            "authorized_sellers": 3,
            "direct_sellers": 2,
            "resellers": 1,
            "duplicate_records": 1,
            "invalid_lines": 2,
            "owner_domains": ["example.com"],
            "manager_domains": ["admanager.example"],
            "contact": [],
        }

    async def _fake_build_sellers_json_summary(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {
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
        }

    monkeypatch.setattr(entity_wiki_service, "get_funding_researcher", lambda: FakeResearcher())
    monkeypatch.setattr(entity_wiki_service, "_try_fetch_site_pages", _fake_site_pages)
    monkeypatch.setattr(entity_wiki_service, "_fetch_ads_txt", _fake_fetch_ads_txt)
    monkeypatch.setattr(
        entity_wiki_service, "_build_sellers_json_summary", _fake_build_sellers_json_summary
    )

    profile = await entity_wiki_service.build_source_profile(
        "Example Source", "https://example.com"
    )

    citation_labels = {citation["label"] for citation in profile["citations"]}
    assert "Wikipedia profile" in citation_labels
    assert "Wikidata public record" in citation_labels
    assert "Official website" in citation_labels
    assert "Official transparency page" in citation_labels
    assert "Public source" not in citation_labels

    transparency = next(
        section for section in profile["dossier_sections"] if section["id"] == "transparency"
    )
    transparency_labels = {item["label"] for item in transparency["items"]}
    assert "About page" in transparency_labels
    assert "Masthead or author directory" in transparency_labels
    assert "Editorial standards" in transparency_labels
    assert "Corrections policy" in transparency_labels
    assert "Funding record" in transparency_labels
    assert "ads.txt authorized sellers" in transparency_labels
    assert "ads.txt owner domain" in transparency_labels
    assert "ads.txt manager domain" in transparency_labels
    assert "ads.txt diagnostics" in transparency_labels
    assert "sellers.json cross-check" in transparency_labels
    assert "sellers.json domain alignment" in transparency_labels
    assert "Policy signal: Editorial independence" in transparency_labels
    assert "Policy signal: Ethics or standards" in transparency_labels
    assert "Policy signal: Corrections process" in transparency_labels
    assert profile["policy_transparency"]["available_signals"] >= 3
    ads_item = next(
        item for item in transparency["items"] if item["label"] == "ads.txt authorized sellers"
    )
    assert ads_item["value"] == "3 authorized sellers (2 DIRECT, 1 RESELLER)"
    assert ads_item["sources"] == ["https://example.com/ads.txt"]
    diagnostics = next(
        item for item in transparency["items"] if item["label"] == "ads.txt diagnostics"
    )
    assert diagnostics["value"] == "1 duplicate records; 2 invalid lines"
    assert "records" not in profile["ads_txt"]
    sellers_item = next(
        item for item in transparency["items"] if item["label"] == "sellers.json cross-check"
    )
    assert sellers_item["value"] == "1/1 checked ads.txt rows matched across 1/1 ad systems"
    assert sellers_item["sources"] == ["https://google.com/sellers.json"]


def test_policy_transparency_summary_extracts_official_page_signals() -> None:
    from app.services.source_policy_transparency import build_policy_transparency_summary

    summary = build_policy_transparency_summary(
        [
            {
                "label": "editorial_standards",
                "url": "https://example.com/standards",
                "summary": (
                    "Our editorial independence policy covers accuracy, corrections, "
                    "and conflicts of interest."
                ),
            },
            {
                "label": "ownership",
                "url": "https://example.com/ownership",
                "summary": "Example Source is owned by Example Media and funded by advertising.",
            },
        ]
    )

    assert summary is not None
    assert summary["checked_pages"] == 2
    signal_ids = {signal["id"] for signal in summary["signals"]}
    assert "editorial_independence" in signal_ids
    assert "corrections_process" in signal_ids
    assert "conflicts_policy" in signal_ids
    assert "ownership_disclosure" in signal_ids
    assert "funding_disclosure" in signal_ids


@pytest.mark.asyncio
async def test_try_fetch_site_pages_rejects_unrelated_redirects() -> None:
    from app.services.entity_wiki_service import _try_fetch_site_pages

    class FakeResponse:
        def __init__(self, status_code: int, url: str, body: str = "") -> None:
            self.status_code = status_code
            self.url = url
            self.text = body
            self.headers = {"content-type": "text/html"}

    class FakeClient:
        async def get(self, url: str, **_kwargs: Any) -> FakeResponse:
            if url == "https://example.com/about":
                return FakeResponse(
                    200,
                    "https://example.com/about",
                    "<main>About Example Source. " + ("Independent journalism. " * 8) + "</main>",
                )
            if url == "https://example.com/ethics":
                return FakeResponse(
                    200,
                    "https://example.com/religion/0/",
                    "<main>Religion and ethics classroom material. "
                    + ("Lesson archive. " * 8)
                    + "</main>",
                )
            return FakeResponse(404, url)

    pages = await _try_fetch_site_pages(FakeClient(), "https://example.com")

    assert pages == [
        {
            "label": "about",
            "url": "https://example.com/about",
            "summary": "About Example Source. " + ("Independent journalism. " * 8).strip(),
        }
    ]


def test_parse_ads_txt_counts_relationships_and_domain_variables() -> None:
    from app.services.ad_supply_transparency import parse_ads_txt

    parsed = parse_ads_txt(
        """
        # comment
        OWNERDOMAIN=example.com
        MANAGERDOMAIN = admanager.example
        CONTACT-EMAIL=adops@example.com
        google.com, pub-123, DIRECT, f08c47fec0942fa0
        openx.com, 456, RESELLER
        openx.com, 456, RESELLER
        broken line
        bad.example, 789, INDIRECT
        """
    )

    assert parsed["authorized_sellers"] == 3
    assert parsed["direct_sellers"] == 1
    assert parsed["resellers"] == 2
    assert parsed["duplicate_records"] == 1
    assert parsed["invalid_lines"] == 2
    assert parsed["owner_domains"] == ["example.com"]
    assert parsed["manager_domains"] == ["admanager.example"]
    assert parsed["contact"] == ["adops@example.com"]


def test_parse_sellers_json_indexes_seller_ids_and_confidential_records() -> None:
    from app.services.ad_supply_transparency import parse_sellers_json

    parsed = parse_sellers_json(
        """
        {
          "sellers": [
            {
              "seller_id": "pub-123",
              "seller_type": "PUBLISHER",
              "name": "Example Source",
              "domain": "example.com"
            },
            {
              "seller_id": "secret-1",
              "seller_type": "INTERMEDIARY",
              "is_confidential": true
            }
          ]
        }
        """
    )

    assert parsed is not None
    assert parsed["seller_count"] == 2
    assert parsed["confidential_sellers"] == 1
    assert parsed["sellers_by_id"]["pub-123"]["domain"] == "example.com"


@pytest.mark.asyncio
async def test_sellers_json_summary_cross_checks_ads_txt_seller_ids() -> None:
    from app.services.ad_supply_transparency import build_sellers_json_summary

    class FakeResponse:
        def __init__(self, url: str, status_code: int, body: str) -> None:
            self.url = url
            self.status_code = status_code
            self.content = body.encode()
            self.encoding = "utf-8"
            self.headers = {"content-type": "application/json"}

    class FakeClient:
        async def get(self, url: str, **_kwargs: Any) -> FakeResponse:
            if url == "https://google.com/sellers.json":
                return FakeResponse(
                    url,
                    200,
                    """
                    {
                      "sellers": [
                        {
                          "seller_id": "pub-123",
                          "seller_type": "PUBLISHER",
                          "name": "Example Source",
                          "domain": "example.com"
                        }
                      ]
                    }
                    """,
                )
            return FakeResponse(url, 404, "{}")

    ads_txt = {
        "records": [
            {
                "ad_system_domain": "google.com",
                "publisher_account_id": "pub-123",
                "relationship": "DIRECT",
                "certification_authority_id": "f08c47fec0942fa0",
            },
            {
                "ad_system_domain": "google.com",
                "publisher_account_id": "missing-456",
                "relationship": "RESELLER",
                "certification_authority_id": "",
            },
            {
                "ad_system_domain": "openx.com",
                "publisher_account_id": "789",
                "relationship": "RESELLER",
                "certification_authority_id": "",
            },
        ],
        "owner_domains": ["example.com"],
        "manager_domains": ["manager.example"],
    }

    summary = await build_sellers_json_summary(FakeClient(), ads_txt)

    assert summary is not None
    assert summary["checked_ad_systems"] == 2
    assert summary["available_sellers_json"] == 1
    assert summary["checked_records"] == 2
    assert summary["matched_records"] == 1
    assert summary["missing_seller_ids"] == 1
    assert summary["owner_domain_matches"] == 1
    assert summary["systems"][0]["ad_system_domain"] == "google.com"
    assert summary["systems"][0]["matched_records"] == 1
    assert summary["systems"][1]["status"] == "missing"
