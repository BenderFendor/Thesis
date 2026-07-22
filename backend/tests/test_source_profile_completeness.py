"""Tests for deterministic source-profile completeness gaps.

Verifies that org_type, funding_sources, and ad-supply evidence are
populated from existing research_organization and ads.txt data without
inventing advertiser brands or hardcoding source names.
"""

from __future__ import annotations

from typing import Any

import pytest


@pytest.mark.asyncio
async def test_source_profile_populates_org_type_and_funding_sources_commercial(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A commercial source (analogous to CNN/WBD) surfaces org_type, funding_sources,
    and ad-supply evidence while distinguishing ad-tech infrastructure from advertisers."""
    from app.services import entity_wiki_service

    class FakeResearcher:
        async def research_organization(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {
                "description": "Example News Channel, American news channel",
                "website": "https://example-news.com",
                "wikipedia_url": "https://en.wikipedia.org/wiki/Example_News_Channel",
                "wikidata_url": "https://www.wikidata.org/wiki/Q789",
                "funding_type": "commercial",
                "funding_sources": ["advertising", "subscriptions", "affiliate fees"],
                "parent_org": "Example Media Group",
                "org_type": "public company",
                "owned_by": ["Example Media Group"],
                "parent_orgs": ["Example Media Group"],
                "annual_revenue": "$5B",
                "cik": "0000999999",
                "research_sources": ["known_data", "wikidata", "sec_edgar"],
                "research_confidence": "high",
            }

    async def _fake_site_pages(*_args: Any, **_kwargs: Any) -> list[dict[str, str]]:
        return [
            {
                "label": "about",
                "url": "https://example-news.com/about",
                "summary": "Example News Channel covers world events.",
            },
            {
                "label": "ownership",
                "url": "https://example-news.com/ownership",
                "summary": "Example News Channel is owned by Example Media Group.",
            },
        ]

    async def _fake_fetch_ads_txt(*_args: Any, **_kwargs: Any) -> dict[str, Any] | None:
        return {
            "url": "https://example-news.com/ads.txt",
            "authorized_sellers": 5,
            "direct_sellers": 3,
            "resellers": 2,
            "duplicate_records": 0,
            "invalid_lines": 0,
            "owner_domains": ["example-news.com"],
            "manager_domains": [],
            "contact": [],
        }

    async def _fake_build_sellers_json_summary(
        *_args: Any, **_kwargs: Any
    ) -> dict[str, Any] | None:
        return {
            "checked_ad_systems": 2,
            "available_sellers_json": 1,
            "checked_records": 3,
            "matched_records": 2,
            "missing_seller_ids": 1,
            "owner_domain_matches": 1,
            "manager_domain_matches": 0,
            "systems": [],
        }

    monkeypatch.setattr(entity_wiki_service, "get_funding_researcher", lambda: FakeResearcher())
    monkeypatch.setattr(entity_wiki_service, "_try_fetch_site_pages", _fake_site_pages)
    monkeypatch.setattr(entity_wiki_service, "_fetch_ads_txt", _fake_fetch_ads_txt)
    monkeypatch.setattr(
        entity_wiki_service,
        "_build_sellers_json_summary",
        _fake_build_sellers_json_summary,
    )

    profile = await entity_wiki_service.build_source_profile(
        "Example News Channel", "https://example-news.com"
    )
    fields = profile["fields"]

    # Organization type in public records
    pub_records_values = {item["value"] for item in fields.get("public_records", [])}
    assert "public company" in pub_records_values

    # Funding sources in funding section
    funding_values = {item["value"] for item in fields.get("funding", [])}
    assert "commercial" in funding_values  # funding_type
    assert "advertising, subscriptions, affiliate fees" in funding_values

    # Ad supply evidence (count from ads.txt, not named advertisers)
    assert any(
        item["label"] == "Ad supply evidence"
        and "authorized ad sellers" in item["value"]
        and item["sources"] == ["https://example-news.com/ads.txt"]
        for item in fields.get("funding", [])
    ), "Ad supply evidence with source provenance expected in funding"

    # Parent organization populated
    ownership_items = fields.get("ownership", [])
    current_parent = next(
        item for item in ownership_items if item["value"] == "Example Media Group"
    )
    assert current_parent["label"] == "Current parent"


@pytest.mark.asyncio
async def test_source_profile_funding_completeness_nonprofit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-profit source surfaces org_type and funding_sources but no ad-supply evidence."""
    from app.services import entity_wiki_service

    class FakeResearcherNonprofit:
        async def research_organization(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {
                "description": "Example News Fund is a non-profit investigative newsroom.",
                "website": "https://example-fund.org",
                "wikipedia_url": "https://en.wikipedia.org/wiki/Example_News_Fund",
                "wikidata_url": "https://www.wikidata.org/wiki/Q456",
                "funding_type": "non-profit",
                "funding_sources": [
                    "grants",
                    "donations",
                    "foundation support",
                ],
                "parent_org": None,
                "org_type": "non-profit",
                "owned_by": [],
                "parent_orgs": [],
                "ein": "84-2272800",
                "annual_revenue": "$5M-$10M",
                "research_sources": ["wikipedia", "wikidata", "propublica"],
                "research_confidence": "high",
            }

    async def _fake_site_pages(*_args: Any, **_kwargs: Any) -> list[dict[str, str]]:
        return [
            {
                "label": "about",
                "url": "https://example-fund.org/about",
                "summary": "Example News Fund is a non-profit supported by grants.",
            },
        ]

    async def _fake_fetch_ads_txt_none(*_args: Any, **_kwargs: Any) -> dict[str, Any] | None:
        return None

    async def _fake_build_sellers_json_summary_none(
        *_args: Any, **_kwargs: Any
    ) -> dict[str, Any] | None:
        return None

    monkeypatch.setattr(
        entity_wiki_service,
        "get_funding_researcher",
        lambda: FakeResearcherNonprofit(),
    )
    monkeypatch.setattr(entity_wiki_service, "_try_fetch_site_pages", _fake_site_pages)
    monkeypatch.setattr(entity_wiki_service, "_fetch_ads_txt", _fake_fetch_ads_txt_none)
    monkeypatch.setattr(
        entity_wiki_service,
        "_build_sellers_json_summary",
        _fake_build_sellers_json_summary_none,
    )

    profile = await entity_wiki_service.build_source_profile(
        "Example News Fund", "https://example-fund.org"
    )
    fields = profile["fields"]

    # Organization type in public records
    pub_records_values = {item["value"] for item in fields.get("public_records", [])}
    assert "non-profit" in pub_records_values

    # Funding sources in funding section
    funding_values = {item["value"] for item in fields.get("funding", [])}
    assert "non-profit" in funding_values
    assert "grants, donations, foundation support" in funding_values

    # No ad-supply evidence (no ads.txt for non-profit)
    funding_labels = {item["label"] for item in fields.get("funding", [])}
    assert "Ad supply evidence" not in funding_labels

    # EIN from nonprofit filings
    nonprofit_values = {item["value"] for item in fields.get("nonprofit_filings", [])}
    assert "84-2272800" in nonprofit_values
    assert "$5M-$10M" in nonprofit_values


@pytest.mark.asyncio
async def test_source_profile_completeness_no_source_name_hardcoding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No source-name conditionals drive the completeness fields."""
    from app.services import entity_wiki_service

    class FakeResearcher:
        async def research_organization(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {
                "description": "Generic outlet description.",
                "website": "https://generic-outlet.example",
                "funding_type": "commercial",
                "funding_sources": ["advertising"],
                "parent_org": "Generic Parent Corp",
                "org_type": "private company",
                "owned_by": ["Generic Parent Corp"],
                "parent_orgs": ["Generic Parent Corp"],
                "research_sources": ["wikidata"],
                "research_confidence": "medium",
            }

    async def _fake_fetch_ads_txt(*_args: Any, **_kwargs: Any) -> dict[str, Any] | None:
        return {
            "url": "https://generic-outlet.example/ads.txt",
            "authorized_sellers": 3,
            "direct_sellers": 2,
            "resellers": 1,
            "duplicate_records": 0,
            "invalid_lines": 0,
            "owner_domains": [],
            "manager_domains": [],
            "contact": [],
        }

    async def _fake_build_sellers_json_summary(
        *_args: Any, **_kwargs: Any
    ) -> dict[str, Any] | None:
        return {
            "checked_ad_systems": 1,
            "available_sellers_json": 1,
            "checked_records": 1,
            "matched_records": 1,
            "missing_seller_ids": 0,
            "owner_domain_matches": 0,
            "manager_domain_matches": 0,
            "systems": [],
        }

    monkeypatch.setattr(entity_wiki_service, "get_funding_researcher", lambda: FakeResearcher())

    async def _fake_site_pages_none(*_args: Any, **_kwargs: Any) -> list[dict[str, str]]:
        return []

    monkeypatch.setattr(
        entity_wiki_service,
        "_try_fetch_site_pages",
        _fake_site_pages_none,
    )
    monkeypatch.setattr(entity_wiki_service, "_fetch_ads_txt", _fake_fetch_ads_txt)
    monkeypatch.setattr(
        entity_wiki_service,
        "_build_sellers_json_summary",
        _fake_build_sellers_json_summary,
    )

    profile = await entity_wiki_service.build_source_profile(
        "Generic Outlet", "https://generic-outlet.example"
    )
    fields = profile["fields"]

    # All completeness fields populated without name checks
    pub_records_values = {item["value"] for item in fields.get("public_records", [])}
    assert "private company" in pub_records_values

    funding_values = {item["value"] for item in fields.get("funding", [])}
    assert "commercial" in funding_values
    assert "advertising" in funding_values

    assert any(item["label"] == "Ad supply evidence" for item in fields.get("funding", []))

    ownership_values = {item["value"] for item in fields.get("ownership", [])}
    assert "Generic Parent Corp" in ownership_values
