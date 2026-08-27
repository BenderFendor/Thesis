"""Behavior tests for candidate-only primary-source adapters."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.models.evidence import EvidenceClaim, EvidenceEntity
from app.services.entity_resolver import resolve_or_create
from app.services.primary_source_adapters import (
    ADAPTER_REGISTRY,
    CapturedPayload,
    ingest_article_records,
    ingest_companies_house_records,
    ingest_fcc_records,
    ingest_gleif_records,
    ingest_irs_990_records,
    ingest_sellers_json_records,
    ingest_sponsorship_records,
    ingest_usaspending_records,
    parse_article_html,
    parse_companies_house_api,
    parse_fcc_records,
    parse_gleif_api,
    parse_irs_990_xml,
    parse_sellers_json_capture,
    parse_usaspending_api,
)

pytestmark = pytest.mark.asyncio


def _capture(name: str, records: list[dict[str, object]]) -> CapturedPayload:
    return CapturedPayload.json(
        f"https://primary.example/{name}",
        {"records": records},
        retrieved_at=datetime(2026, 7, 21, 12, 0, 0),
    )


async def _claims(db_session) -> list[EvidenceClaim]:
    return list((await db_session.execute(select(EvidenceClaim))).scalars().all())


async def test_registry_declares_credentials_and_candidate_only_contract(db_session) -> None:
    assert ADAPTER_REGISTRY["companies_house"].required_credentials == ("COMPANIES_HOUSE_API_KEY",)
    records = [
        {
            "child_lei": "CHILD-LEI",
            "child_name": "News Child Ltd",
            "parent_lei": "PARENT-LEI",
            "parent_name": "News Parent PLC",
            "relationship_status": "ACTIVE",
            "reporting_date": "2026-06-30",
        }
    ]
    report = await ingest_gleif_records(
        db_session, payload=_capture("gleif", records), records=records
    )
    claims = await _claims(db_session)
    assert report.accepted == 0
    assert report.candidates == 2
    assert {claim.predicate for claim in claims} == {"accounting_consolidated_by", "legal_form"}
    assert all(claim.status == "candidate" for claim in claims)


async def test_companies_house_preserves_ranges_and_lifecycle(db_session) -> None:
    records = [
        {
            "company_number": "01234567",
            "company_name": "Example Media Limited",
            "record_type": "psc",
            "record_id": "psc-1",
            "name": "Example Holdings Limited",
            "kind": "corporate-entity-person-with-significant-control",
            "natures_of_control": ["ownership-of-shares-25-to-50-percent"],
            "interests": {"voting_min": "25", "voting_max": "50.00"},
            "notified_on": "2025-03-01",
        }
    ]
    await ingest_companies_house_records(
        db_session, payload=_capture("companies-house", records), records=records
    )
    [claim] = await _claims(db_session)
    assert claim.predicate == "controls"
    assert claim.qualifiers["voting_interest_min"] == "25"
    assert claim.qualifiers["voting_interest_max"] == "50"
    assert claim.qualifiers["lifecycle_state"] == "current"


async def test_funding_adapters_keep_amount_types_separate(db_session) -> None:
    irs_records = [
        {
            "ein": "12-3456789",
            "organization_name": "Public News Foundation",
            "tax_period": "2025",
            "revenue": "1000000.00",
            "contributions": "250000.00",
            "compensation": "125000.00",
        }
    ]
    spending_records = [
        {
            "award_id": "AWARD-1",
            "recipient_id": "RECIPIENT-1",
            "recipient_name": "Public News Foundation",
            "awarding_agency_id": "AGENCY-1",
            "awarding_agency_name": "Agency for Public Media",
            "award_type": "grant",
            "contract_ceiling": "500000.00",
            "obligation": "300000.00",
            "outlay": "125000.00",
        }
    ]
    await ingest_irs_990_records(
        db_session, payload=_capture("irs", irs_records), records=irs_records
    )
    await ingest_usaspending_records(
        db_session, payload=_capture("usaspending", spending_records), records=spending_records
    )
    claims = await _claims(db_session)
    assert {claim.predicate for claim in claims} >= {
        "reports_revenue",
        "reports_contribution",
        "reports_compensation",
        "funds",
    }
    spending = [claim for claim in claims if claim.predicate == "funds"]
    assert {claim.object_value["value_type"] for claim in spending} == {
        "contract_ceiling",
        "obligation",
        "outlay",
    }
    assert all(isinstance(claim.object_value["amount"], str) for claim in spending)


async def test_fcc_ownership_and_political_purchase_are_distinct(db_session) -> None:
    records = [
        {
            "facility_id": "1001",
            "call_sign": "WXYZ-TV",
            "record_type": "ownership",
            "filing_id": "323-1",
            "owner_name": "Local Broadcast LLC",
            "owner_frn": "000111222",
        },
        {
            "facility_id": "1001",
            "call_sign": "WXYZ-TV",
            "record_type": "political_file",
            "filing_id": "POL-1",
            "buyer_name": "Example Campaign",
            "buyer_id": "buyer-1",
            "amount": "4250.75",
        },
    ]
    await ingest_fcc_records(db_session, payload=_capture("fcc", records), records=records)
    claims = await _claims(db_session)
    assert {claim.predicate for claim in claims} == {"directly_owns", "political_ad_purchase"}
    purchase = next(claim for claim in claims if claim.predicate == "political_ad_purchase")
    assert purchase.qualifiers["amount"] == "4250.75"


async def test_article_byline_does_not_create_employment_without_profile(db_session) -> None:
    byline = [
        {
            "record_type": "jsonld_author",
            "article_url": "https://news.example/story",
            "headline": "A story",
            "outlet_name": "Example News",
            "outlet_domain": "news.example",
            "author_name": "Jane Reporter",
            "author_url": "https://news.example/authors/jane",
        }
    ]
    await ingest_article_records(db_session, payload=_capture("article", byline), records=byline)
    assert {claim.predicate for claim in await _claims(db_session)} == {"authored_by"}

    profile = [
        {
            "record_type": "staff_profile",
            "profile_url": "https://news.example/authors/jane",
            "outlet_name": "Example News",
            "outlet_domain": "news.example",
            "person_name": "Jane Reporter",
        }
    ]
    await ingest_article_records(db_session, payload=_capture("profile", profile), records=profile)
    assert {claim.predicate for claim in await _claims(db_session)} == {
        "authored_by",
        "employed_by",
    }


async def test_sellers_and_sponsorship_are_not_advertiser_claims(db_session) -> None:
    publisher = await resolve_or_create(
        db_session,
        record_kind="legal_entity",
        entity_kind="publication_brand",
        external_ids={"domain": "news.example"},
        candidate_name="Example News",
    )
    sellers = [
        {
            "publisher_entity_id": publisher.id,
            "publisher_domain": "news.example",
            "ad_system_domain": "exchange.example",
            "seller_id": "pub-123",
            "seller_name": "Example News Seller",
            "seller_type": "PUBLISHER",
        }
    ]
    sponsorship = [
        {
            "publisher_name": "Example News",
            "publisher_domain": "news.example",
            "sponsor_name": "Example Foundation",
            "sponsor_id": "foundation-1",
            "disclosure_url": "https://news.example/sponsored/story",
            "disclosure_text": "This reporting was supported by Example Foundation.",
        }
    ]
    await ingest_sellers_json_records(
        db_session, payload=_capture("sellers", sellers), records=sellers
    )
    await ingest_sponsorship_records(
        db_session, payload=_capture("sponsorship", sponsorship), records=sponsorship
    )
    predicates = {claim.predicate for claim in await _claims(db_session)}
    assert predicates == {"authorizes_inventory_seller", "sponsors_content"}
    assert "advertises_with" not in predicates


async def test_entity_kinds_do_not_collapse_station_seller_nonprofit_and_person(db_session) -> None:
    # The adapters above run in isolated databases, so build one record of
    # each public distinction here and assert resolution preserves the kinds.
    kinds = ["broadcast_station", "seller_account", "nonprofit", "person"]
    for index, kind in enumerate(kinds):
        await resolve_or_create(
            db_session,
            record_kind="person" if kind == "person" else "legal_entity",
            entity_kind=kind,
            external_ids={f"test_{kind}": str(index)},
            candidate_name=f"Entity {index}",
        )
    entities = list((await db_session.execute(select(EvidenceEntity))).scalars().all())
    assert {entity.entity_kind for entity in entities} == set(kinds)


async def test_native_primary_source_shapes_are_normalized_without_float_midpoints() -> None:
    [gleif] = parse_gleif_api(
        {
            "data": {
                "id": "LEI-1",
                "attributes": {
                    "lei": "LEI-1",
                    "entity": {"legalName": {"name": "Child Ltd"}},
                    "relationship": {
                        "startNode": {"nodeId": "LEI-1"},
                        "endNode": {"nodeId": "LEI-2"},
                        "relationshipType": "IS_DIRECTLY_CONSOLIDATED_BY",
                        "relationshipStatus": "ACTIVE",
                    },
                },
            }
        }
    )
    assert gleif["parent_lei"] == "LEI-2"

    companies = parse_companies_house_api(
        company={"company_number": "0123", "company_name": "News Ltd"},
        psc={
            "items": [
                {
                    "name": "Owner Ltd",
                    "kind": "corporate-entity-person-with-significant-control",
                    "natures_of_control": [
                        "ownership-of-shares-25-to-50-percent",
                        "voting-rights-75-to-100-percent",
                    ],
                }
            ]
        },
        officers={"items": [{"name": "Jane Director", "officer_role": "director"}]},
    )
    assert companies[1]["interests"] == {
        "economic_min": "25",
        "economic_max": "50",
        "voting_min": "75",
        "voting_max": "100",
    }

    [irs] = parse_irs_990_xml(
        b"<Return><EIN>123456789</EIN><BusinessNameLine1Txt>News Foundation</BusinessNameLine1Txt><CYTotalRevenueAmt>100.25</CYTotalRevenueAmt></Return>"
    )
    assert irs["revenue"] == "100.25"

    [award] = parse_usaspending_api(
        {
            "results": [
                {
                    "Award ID": "A-1",
                    "Recipient Name": "News Foundation",
                    "Awarding Agency": "Agency",
                    "Award Amount": "5.25",
                    "Potential Award Amount": "10.50",
                }
            ]
        }
    )
    assert award["obligation"] == "5.25"
    assert award["contract_ceiling"] == "10.50"

    assert parse_fcc_records({"records": [{"facility_id": "1"}]}) == [{"facility_id": "1"}]


async def test_article_and_sellers_parsers_keep_proof_categories_narrow() -> None:
    html = """<script type="application/ld+json">{"@type":"NewsArticle","headline":"Story","author":{"@type":"Person","name":"Jane Reporter","url":"/jane"}}</script><p>Correction: a date was fixed.</p>"""
    records = parse_article_html(
        html,
        article_url="https://news.example/story",
        outlet_name="Example News",
        outlet_domain="news.example",
    )
    assert {record["record_type"] for record in records} == {"jsonld_author", "correction"}

    sellers = parse_sellers_json_capture(
        '{"sellers":[{"seller_id":"pub-1","seller_type":"PUBLISHER","name":"Example News"},{"seller_id":"other","seller_type":"INTERMEDIARY","name":"Other"}]}',
        publisher_entity_id="publisher-1",
        publisher_domain="news.example",
        ad_system_domain="exchange.example",
        authorized_account_ids={"pub-1"},
    )
    assert [record["seller_id"] for record in sellers] == ["pub-1"]
