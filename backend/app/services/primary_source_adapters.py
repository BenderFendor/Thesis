"""Typed, candidate-only adapters for primary media-intelligence records.

Adapters in this module consume already retrieved response bodies.  Retrieval is
kept outside the parser so corpus replay can run the exact production parsers
with network access disabled.  Every adapter writes the existing immutable
document -> snapshot -> observation -> candidate-claim chain.  It never accepts
or materializes a relationship; policy evaluation remains the only acceptance
path.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evidence import EvidenceEntity
from app.services.entity_resolver import resolve_or_create
from app.services.ad_supply_transparency import parse_sellers_json
from app.services.evidence_ingest import (
    METHOD_VERSION,
    IngestReport,
    _get_or_create_claim,
    _get_or_create_document,
    _get_or_create_observation,
    _get_or_create_snapshot,
    _link_claim_evidence,
)
from app.services.evidence_spine import canonical_json, stable_hash

AdapterName = Literal[
    "gleif",
    "companies_house",
    "irs_990",
    "usaspending",
    "fcc",
    "article_records",
    "sellers_json",
    "sponsorship",
    "corporate_records",
]


@dataclass(frozen=True)
class AdapterContract:
    """Static capabilities and runtime requirements for one adapter."""

    name: AdapterName
    version: str
    source_classes: tuple[str, ...]
    required_credentials: tuple[str, ...] = ()
    network_bound: bool = True


ADAPTER_REGISTRY: dict[AdapterName, AdapterContract] = {
    "gleif": AdapterContract("gleif", METHOD_VERSION, ("gleif_level_1", "gleif_level_2")),
    "companies_house": AdapterContract(
        "companies_house", METHOD_VERSION, ("registry_filing",), ("COMPANIES_HOUSE_API_KEY",)
    ),
    "irs_990": AdapterContract("irs_990", METHOD_VERSION, ("irs_990",)),
    "usaspending": AdapterContract("usaspending", METHOD_VERSION, ("government_record",)),
    "fcc": AdapterContract("fcc", METHOD_VERSION, ("fcc_filing", "fcc_political_file")),
    "article_records": AdapterContract(
        "article_records",
        METHOD_VERSION,
        ("article_structured_data", "article_byline", "employer_profile", "own_site"),
        network_bound=False,
    ),
    "sellers_json": AdapterContract("sellers_json", METHOD_VERSION, ("sellers_json",)),
    "sponsorship": AdapterContract("sponsorship", METHOD_VERSION, ("sponsorship_disclosure",)),
    "corporate_records": AdapterContract(
        "corporate_records",
        METHOD_VERSION,
        (
            "own_site",
            "registry_filing",
            "transaction_filing",
            "transaction_record",
            "court_record",
        ),
    ),
}


@dataclass(frozen=True)
class CapturedPayload:
    """Immutable bytes and retrieval metadata supplied to an adapter."""

    source_url: str
    body: bytes
    retrieved_at: datetime
    http_status: int = 200
    content_type: str = "application/json"

    @classmethod
    def json(
        cls,
        source_url: str,
        value: Any,
        *,
        retrieved_at: datetime | None = None,
    ) -> CapturedPayload:
        """Build a deterministic JSON capture for tests and offline replay."""
        return cls(
            source_url=source_url,
            body=canonical_json(value).encode("utf-8"),
            retrieved_at=retrieved_at or datetime.now(UTC).replace(tzinfo=None),
        )


def _decimal_string(value: Any) -> str | None:
    """Return an exact, non-exponent decimal string without using floats."""
    if value in (None, ""):
        return None
    try:
        result = format(Decimal(str(value)), "f")
    except (InvalidOperation, ValueError):
        return None
    return result.rstrip("0").rstrip(".") if "." in result else result


def _record_str(record: dict[str, Any], *keys: str) -> str:
    """Return the first truthy field among keys, stringified and stripped."""
    for key in keys:
        value = record.get(key)
        if value:
            return str(value).strip()
    return ""


def _gleif_item_lei(attributes: dict[str, Any], item: dict[str, Any], start: dict[str, Any]) -> str:
    return str(attributes.get("lei") or item.get("id") or start.get("nodeId") or "")


def _gleif_reporting_date(periods: list[dict[str, Any]], attributes: dict[str, Any]) -> Any:
    return (periods[-1].get("startDate") if periods else None) or attributes.get("lastUpdateDate")


def _gleif_legal_name(entity: dict[str, Any]) -> Any:
    return cast(dict[str, Any], entity.get("legalName") or {}).get("name")


def _gleif_child_lei(start: dict[str, Any], lei: str) -> str:
    return str(start.get("nodeId") or lei)


def _gleif_child_name(entity: dict[str, Any], attributes: dict[str, Any], lei: str) -> str:
    return str(_gleif_legal_name(entity) or attributes.get("child_name") or lei)


def _gleif_parent_lei(end: dict[str, Any], attributes: dict[str, Any]) -> str:
    return str(end.get("nodeId") or attributes.get("parent_lei") or "")


def _gleif_parent_name(end: dict[str, Any], attributes: dict[str, Any]) -> str:
    return str(attributes.get("parent_name") or end.get("nodeId") or "")


def _gleif_legal_form_id(entity: dict[str, Any]) -> Any:
    return cast(dict[str, Any], entity.get("legalForm") or {}).get("id")


def _gleif_item_record(item: dict[str, Any]) -> dict[str, Any]:
    attributes = cast(dict[str, Any], item.get("attributes") or {})
    entity = cast(dict[str, Any], attributes.get("entity") or {})
    relationship = cast(dict[str, Any], attributes.get("relationship") or {})
    start = cast(dict[str, Any], relationship.get("startNode") or {})
    end = cast(dict[str, Any], relationship.get("endNode") or {})
    periods = cast(list[dict[str, Any]], relationship.get("periods") or [])
    lei = _gleif_item_lei(attributes, item, start)
    return {
        "child_lei": _gleif_child_lei(start, lei),
        "child_name": _gleif_child_name(entity, attributes, lei),
        "parent_lei": _gleif_parent_lei(end, attributes),
        "parent_name": _gleif_parent_name(end, attributes),
        "legal_form": _gleif_legal_form_id(entity),
        "relationship_type": relationship.get("relationshipType"),
        "relationship_status": relationship.get("relationshipStatus"),
        "reporting_date": _gleif_reporting_date(periods, attributes),
    }


def parse_gleif_api(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize GLEIF LEI and relationship API resources."""
    raw_data = payload.get("data")
    items = raw_data if isinstance(raw_data, list) else [raw_data]
    return [_gleif_item_record(item) for item in items if isinstance(item, dict)]


def _companies_house_interest_ranges(natures: list[str]) -> dict[str, str]:
    ranges: dict[str, str] = {}
    for nature in natures:
        match = re.search(r"(shares|voting-rights)-(\d+)-to-(\d+)-percent", nature)
        if match:
            prefix = "economic" if match.group(1) == "shares" else "voting"
            ranges[f"{prefix}_min"] = match.group(2)
            ranges[f"{prefix}_max"] = match.group(3)
    return ranges


def _companies_house_psc_record(number: str, name: str, item: dict[str, Any]) -> dict[str, Any]:
    natures = [str(value) for value in item.get("natures_of_control") or []]
    return {
        "company_number": number,
        "company_name": name,
        "record_type": "psc",
        "record_id": cast(dict[str, Any], item.get("links") or {}).get("self") or item.get("etag"),
        "name": item.get("name"),
        "kind": item.get("kind"),
        "natures_of_control": natures,
        "interests": _companies_house_interest_ranges(natures),
        "notified_on": item.get("notified_on"),
        "ceased_on": item.get("ceased_on"),
    }


def _companies_house_officer_record(number: str, name: str, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "company_number": number,
        "company_name": name,
        "record_type": "officer",
        "record_id": item.get("etag"),
        "name": item.get("name"),
        "officer_role": item.get("officer_role"),
        "ceased_on": item.get("resigned_on"),
    }


def parse_companies_house_api(
    *, company: dict[str, Any], psc: dict[str, Any], officers: dict[str, Any]
) -> list[dict[str, Any]]:
    """Normalize Companies House company, PSC, and officer responses."""
    number = str(company.get("company_number") or "")
    name = str(company.get("company_name") or number)
    records: list[dict[str, Any]] = [
        {
            "company_number": number,
            "company_name": name,
            "record_type": "company",
            "company_status": company.get("company_status"),
            "company_type": company.get("type"),
            "jurisdiction": company.get("jurisdiction"),
        }
    ]
    for item in cast(list[dict[str, Any]], psc.get("items") or []):
        records.append(_companies_house_psc_record(number, name, item))
    for item in cast(list[dict[str, Any]], officers.get("items") or []):
        records.append(_companies_house_officer_record(number, name, item))
    return records


def parse_irs_990_xml(raw: bytes) -> list[dict[str, Any]]:
    """Extract separately typed financial values from one IRS e-file return."""
    root = ET.fromstring(raw)
    values = {
        element.tag.rsplit("}", 1)[-1]: (element.text or "").strip() for element in root.iter()
    }
    tags = {
        "ein": ("EIN",),
        "organization_name": ("BusinessNameLine1Txt", "BusinessName"),
        "tax_period": ("TaxPeriodEndDt", "TaxYr"),
        "revenue": ("TotalRevenueCurrentYear", "CYTotalRevenueAmt"),
        "contributions": ("ContributionsGrantsCurrentYear", "CYContributionsGrantsAmt"),
        "compensation": ("CompensationCurrentYear", "CYCompensationOfOfficersAmt"),
        "grants_paid": ("GrantsAndSimilarAmntsCY", "CYGrantsAndSimilarPaidAmt"),
    }
    record: dict[str, Any] = {"filing_type": "990"}
    for field_name, candidates in tags.items():
        record[field_name] = next((values[tag] for tag in candidates if values.get(tag)), None)
    return [record] if record.get("ein") else []


_USASPENDING_FIELD_KEYS: dict[str, tuple[str, ...]] = {
    "award_id": ("Award ID", "generated_unique_award_id"),
    "recipient_id": ("recipient_id", "Recipient UEI"),
    "recipient_name": ("Recipient Name", "recipient_name"),
    "awarding_agency_id": ("Awarding Agency Code", "awarding_agency_id"),
    "awarding_agency_name": ("Awarding Agency", "awarding_agency_name"),
    "award_type": ("Award Type", "award_type"),
    "contract_ceiling": ("Potential Award Amount", "potential_total_value_of_award"),
    "obligation": ("Award Amount", "obligation"),
    "outlay": ("Outlayed Amount", "outlay"),
}


def _usaspending_pick(item: dict[str, Any], keys: tuple[str, ...]) -> Any:
    """First truthy value among candidate export/API key names."""
    for key in keys:
        value = item.get(key)
        if value:
            return value
    return None


def parse_usaspending_api(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize spending-by-award results without merging amount types."""
    return [
        {field: _usaspending_pick(item, keys) for field, keys in _USASPENDING_FIELD_KEYS.items()}
        for item in cast(list[dict[str, Any]], payload.get("results") or [])
    ]


def parse_fcc_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize checked FCC ownership or political-file JSON exports."""
    return [
        cast(dict[str, Any], item)
        for item in payload.get("records") or payload.get("results") or []
        if isinstance(item, dict)
    ]


_JSONLD_AUTHOR_PATTERN = r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'


def _ld_json_nodes(block: str) -> list[dict[str, Any]]:
    """Return the dict nodes of one JSON-LD script block; empty on parse errors."""
    try:
        parsed = json.loads(block)
    except json.JSONDecodeError:
        return []
    nodes = parsed if isinstance(parsed, list) else [parsed]
    return [node for node in nodes if isinstance(node, dict)]


def _ld_json_author_records(
    node: dict[str, Any], *, article_url: str, outlet_name: str, outlet_domain: str
) -> list[dict[str, Any]]:
    """Normalize authors declared by one JSON-LD node."""
    authors = node.get("author") or []
    author_list = authors if isinstance(authors, list) else [authors]
    records: list[dict[str, Any]] = []
    for author in author_list:
        author = {"name": author} if isinstance(author, str) else author
        if isinstance(author, dict) and author.get("name"):
            records.append(
                {
                    "record_type": "jsonld_author",
                    "article_url": article_url,
                    "headline": node.get("headline"),
                    "outlet_name": outlet_name,
                    "outlet_domain": outlet_domain,
                    "author_name": author.get("name"),
                    "author_url": author.get("url") or author.get("sameAs"),
                    "selector": "script[type=application/ld+json]",
                }
            )
    return records


def _visible_text(html: str) -> str:
    """Return the rendered text of an HTML document with tags stripped."""
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


_NOTICE_MARKERS: tuple[tuple[str, str], ...] = (
    ("correction", "Correction:"),
    ("retraction", "Retraction:"),
)


def _notice_records(
    visible: str, *, article_url: str, outlet_name: str, outlet_domain: str
) -> list[dict[str, Any]]:
    """Find explicit correction or retraction notices in visible text."""
    records: list[dict[str, Any]] = []
    for notice_type, marker in _NOTICE_MARKERS:
        position = visible.casefold().find(marker.casefold())
        if position >= 0:
            records.append(
                {
                    "record_type": notice_type,
                    "article_url": article_url,
                    "outlet_name": outlet_name,
                    "outlet_domain": outlet_domain,
                    "text": visible[position : position + 500],
                }
            )
    return records


def parse_article_html(
    html: str, *, article_url: str, outlet_name: str, outlet_domain: str
) -> list[dict[str, Any]]:
    """Extract JSON-LD authors and explicit correction or retraction notices."""
    records: list[dict[str, Any]] = []
    for block in re.findall(_JSONLD_AUTHOR_PATTERN, html, flags=re.IGNORECASE | re.DOTALL):
        for node in _ld_json_nodes(block):
            records.extend(
                _ld_json_author_records(
                    node,
                    article_url=article_url,
                    outlet_name=outlet_name,
                    outlet_domain=outlet_domain,
                )
            )
    records.extend(
        _notice_records(
            _visible_text(html),
            article_url=article_url,
            outlet_name=outlet_name,
            outlet_domain=outlet_domain,
        )
    )
    return records


def parse_sellers_json_capture(
    raw: str,
    *,
    publisher_entity_id: str,
    publisher_domain: str,
    ad_system_domain: str,
    authorized_account_ids: set[str],
) -> list[dict[str, Any]]:
    """Return only sellers.json rows corroborating exact ads.txt account IDs."""
    parsed = parse_sellers_json(raw)
    if parsed is None:
        return []
    return [
        {
            "publisher_entity_id": publisher_entity_id,
            "publisher_domain": publisher_domain,
            "ad_system_domain": ad_system_domain,
            "seller_id": seller_id,
            "seller_name": seller.get("name"),
            "seller_type": seller.get("seller_type"),
            "is_confidential": seller.get("is_confidential") == "1",
        }
        for seller_id, seller in cast(dict[str, dict[str, str]], parsed["sellers_by_id"]).items()
        if seller_id in authorized_account_ids
    ]


async def _entity(
    db: AsyncSession,
    *,
    name: str,
    entity_kind: str,
    external_ids: dict[str, str],
) -> EvidenceEntity:
    return await resolve_or_create(
        db,
        record_kind="person" if entity_kind == "person" else "legal_entity",
        entity_kind=entity_kind,
        external_ids=external_ids,
        candidate_name=name,
    )


async def _candidate(
    db: AsyncSession,
    *,
    report: IngestReport,
    payload: CapturedPayload,
    adapter: AdapterName,
    document_key: str,
    document_type: str,
    source_class: str,
    subject: EvidenceEntity,
    predicate: str,
    object_entity: EvidenceEntity | None,
    object_value: Any | None,
    qualifiers: dict[str, Any],
    locator: dict[str, Any],
    structured_value: dict[str, Any],
    quoted_text: str | None = None,
) -> None:
    document_id = f"doc_{adapter}_{stable_hash(document_key)[:28]}"
    document = await _get_or_create_document(
        db,
        document_id=document_id,
        source_url=payload.source_url,
        document_type=document_type,
        source_class=source_class,
        issuer_entity_id=cast(str, subject.id),
        report=report,
    )
    snapshot = await _get_or_create_snapshot(
        db,
        document_id=cast(str, document.id),
        raw_bytes=payload.body,
        retriever=f"evidence_adapter.{adapter}",
        retriever_version=METHOD_VERSION,
        retrieved_at=payload.retrieved_at,
        http_status=payload.http_status,
        content_type=payload.content_type,
        report=report,
    )
    observation = await _get_or_create_observation(
        db,
        snapshot_id=cast(str, snapshot.id),
        locator=locator,
        structured_value=structured_value,
        quoted_text=quoted_text,
        extractor=f"evidence_adapter.{adapter}",
        extractor_version=METHOD_VERSION,
        report=report,
    )
    claim, created = await _get_or_create_claim(
        db,
        subject_entity_id=cast(str, subject.id),
        predicate=predicate,
        object_entity_id=cast(str, object_entity.id) if object_entity is not None else None,
        object_value=object_value,
        qualifiers=qualifiers,
        asserted_by=f"evidence_adapter:{adapter}",
        evidence_class=source_class,
        valid_from=payload.retrieved_at,
        report=report,
    )
    await _link_claim_evidence(
        db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
    )
    if created:
        report.candidates += 1


async def _gleif_relationship_candidate(
    db: AsyncSession,
    *,
    report: IngestReport,
    payload: CapturedPayload,
    record: dict[str, Any],
    index: int,
    child: EvidenceEntity,
    child_lei: str,
    parent_lei: str,
    status: str,
    parent: EvidenceEntity,
) -> None:
    await _candidate(
        db,
        report=report,
        payload=payload,
        adapter="gleif",
        document_key=f"{child_lei}:{parent_lei}:{status}",
        document_type="gleif_relationship_record",
        source_class="gleif_level_2",
        subject=child,
        predicate="accounting_consolidated_by",
        object_entity=parent,
        object_value=None,
        qualifiers={
            "relationship_type": str(
                record.get("relationship_type") or "IS_DIRECTLY_CONSOLIDATED_BY"
            ),
            "relationship_status": status,
            "lifecycle_state": "current" if status == "ACTIVE" else "historical",
            "reporting_date": record.get("reporting_date"),
        },
        locator={"record_index": index, "child_lei": child_lei},
        structured_value=record,
    )


async def _gleif_identity_candidate(
    db: AsyncSession,
    *,
    report: IngestReport,
    payload: CapturedPayload,
    record: dict[str, Any],
    index: int,
    child: EvidenceEntity,
    child_lei: str,
) -> None:
    await _candidate(
        db,
        report=report,
        payload=payload,
        adapter="gleif",
        document_key=f"{child_lei}:identity",
        document_type="gleif_lei_record",
        source_class="gleif_level_1",
        subject=child,
        predicate="legal_form",
        object_entity=None,
        object_value={"value": record.get("legal_form"), "lei": child_lei},
        qualifiers={"reporting_date": record.get("reporting_date")},
        locator={"record_index": index, "field": "legal_form"},
        structured_value=record,
    )


def _gleif_record_identities(record: dict[str, Any]) -> tuple[str, str, str, str]:
    """Return (child_lei, child_name, parent_lei, parent_name) for one record."""
    child_lei = _record_str(record, "child_lei", "lei")
    child_name = _record_str(record, "child_name", "legal_name") or child_lei
    parent_lei = _record_str(record, "parent_lei")
    parent_name = _record_str(record, "parent_name") or parent_lei
    return child_lei, child_name, parent_lei, parent_name


async def ingest_gleif_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest GLEIF Level 1 identity and Level 2 accounting-parent records."""
    report = IngestReport(source="gleif")
    for index, record in enumerate(records):
        child_lei, child_name, parent_lei, parent_name = _gleif_record_identities(record)
        if not child_lei or not child_name:
            continue
        child = await _entity(
            db, name=child_name, entity_kind="legal_entity", external_ids={"lei": child_lei}
        )
        if parent_lei and parent_name:
            parent = await _entity(
                db, name=parent_name, entity_kind="legal_entity", external_ids={"lei": parent_lei}
            )
            status = str(record.get("relationship_status") or "ACTIVE").upper()
            await _gleif_relationship_candidate(
                db,
                report=report,
                payload=payload,
                record=record,
                index=index,
                child=child,
                child_lei=child_lei,
                parent_lei=parent_lei,
                status=status,
                parent=parent,
            )
        await _gleif_identity_candidate(
            db,
            report=report,
            payload=payload,
            record=record,
            index=index,
            child=child,
            child_lei=child_lei,
        )
    return report


async def _corporate_entities(
    db: AsyncSession,
    *,
    record: dict[str, Any],
    subject_name: str,
    object_name: str,
    subject_kind: str,
    object_kind: str,
) -> tuple[EvidenceEntity, EvidenceEntity]:
    subject = await _entity(
        db,
        name=subject_name,
        entity_kind=subject_kind,
        external_ids={
            str(record.get("subject_id_scheme") or "corporate_record"): str(
                record.get("subject_id") or subject_name
            )
        },
    )
    object_entity = await _entity(
        db,
        name=object_name,
        entity_kind=object_kind,
        external_ids={
            str(record.get("object_id_scheme") or "corporate_record"): str(
                record.get("object_id") or object_name
            )
        },
    )
    return subject, object_entity


def _corporate_qualifiers(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "lifecycle_state": str(record.get("lifecycle_state") or "current"),
        "event_type": record.get("event_type"),
        "signed_at": record.get("signed_at"),
        "approved_at": record.get("approved_at"),
        "regulatory_review_at": record.get("regulatory_review_at"),
        "closed_at": record.get("closed_at"),
        "terminated_at": record.get("terminated_at"),
        "reporting_date": record.get("reporting_date"),
        "share_class": record.get("share_class"),
        "direct": record.get("direct"),
        "voting_interest_min": _decimal_string(record.get("voting_interest_min")),
        "voting_interest_max": _decimal_string(record.get("voting_interest_max")),
        "economic_interest_min": _decimal_string(record.get("economic_interest_min")),
        "economic_interest_max": _decimal_string(record.get("economic_interest_max")),
        "beneficial_interest_min": _decimal_string(record.get("beneficial_interest_min")),
        "beneficial_interest_max": _decimal_string(record.get("beneficial_interest_max")),
        "value_type": record.get("value_type"),
        "amount": _decimal_string(record.get("amount")),
        "currency": record.get("currency"),
        "valid_through": record.get("valid_through"),
    }


_CORPORATE_PREDICATES = {
    "brand_of",
    "operated_by",
    "directly_owns",
    "owns_equity_in",
    "controls",
    "funds",
    "advertising_inventory_sold_by",
    "formerly_known_as",
    "successor_of",
}


def _corporate_record_fields(record: dict[str, Any]) -> dict[str, str] | None:
    """Return normalized corporate-record fields, or None when the record is invalid."""
    subject_name = _record_str(record, "subject_name")
    object_name = _record_str(record, "object_name")
    predicate = _record_str(record, "predicate")
    if not subject_name or not object_name or predicate not in _CORPORATE_PREDICATES:
        return None
    return {
        "subject_name": subject_name,
        "object_name": object_name,
        "predicate": predicate,
        "subject_kind": _record_str(record, "subject_kind") or "publication_brand",
        "object_kind": _record_str(record, "object_kind") or "legal_entity",
        "document_type": _record_str(record, "document_type") or "official_company_record",
        "lifecycle_state": _record_str(record, "lifecycle_state") or "current",
        "source_class": _record_str(record, "source_class") or "own_site",
    }


async def ingest_corporate_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest official brand, ownership, control, and transaction-event records."""
    report = IngestReport(source="corporate_records")
    for index, record in enumerate(records):
        fields = _corporate_record_fields(record)
        if fields is None:
            continue
        subject, object_entity = await _corporate_entities(
            db,
            record=record,
            subject_name=fields["subject_name"],
            object_name=fields["object_name"],
            subject_kind=fields["subject_kind"],
            object_kind=fields["object_kind"],
        )
        await _candidate(
            db,
            report=report,
            payload=payload,
            adapter="corporate_records",
            document_key=(
                f"{fields['subject_name']}:{fields['predicate']}:{fields['object_name']}:"
                f"{fields['lifecycle_state']}:{index}"
            ),
            document_type=fields["document_type"],
            source_class=fields["source_class"],
            subject=subject,
            predicate=fields["predicate"],
            object_entity=object_entity,
            object_value=None,
            qualifiers=_corporate_qualifiers(record),
            locator={"record_index": index, "locator": record.get("locator")},
            structured_value=record,
            quoted_text=cast(str | None, record.get("quoted_text")),
        )
    return report


async def _companies_house_company_candidate(
    db: AsyncSession,
    *,
    report: IngestReport,
    payload: CapturedPayload,
    index: int,
    record: dict[str, Any],
    company: EvidenceEntity,
    company_number: str,
) -> None:
    await _candidate(
        db,
        report=report,
        payload=payload,
        adapter="companies_house",
        document_key=f"{company_number}:company",
        document_type="companies_house_company",
        source_class="registry_filing",
        subject=company,
        predicate="legal_form",
        object_entity=None,
        object_value={
            "company_status": record.get("company_status"),
            "company_type": record.get("company_type"),
        },
        qualifiers={"jurisdiction": record.get("jurisdiction")},
        locator={"record_index": index},
        structured_value=record,
    )


async def _companies_house_person_controller(
    db: AsyncSession,
    *,
    record: dict[str, Any],
    company_number: str,
    record_type: str,
) -> tuple[EvidenceEntity, str] | None:
    """Resolve the people/controller entity for a PSC or officer record."""
    person_name = _record_str(record, "name")
    if not person_name:
        return None
    is_person = record_type == "officer" or str(record.get("kind") or "").startswith("individual")
    controller = await _entity(
        db,
        name=person_name,
        entity_kind="person" if is_person else "legal_entity",
        external_ids={
            "companies_house_record": _record_str(record, "record_id")
            or stable_hash(company_number, record_type, person_name)[:24]
        },
    )
    return controller, person_name


def _companies_house_person_qualifiers(record: dict[str, Any]) -> dict[str, Any]:
    """Build the candidate qualifiers for a PSC or officer record."""
    interests = cast(dict[str, Any], record.get("interests") or {})
    return {
        "role": record.get("officer_role"),
        "natures_of_control": list(record.get("natures_of_control") or []),
        "voting_interest_min": _decimal_string(interests.get("voting_min")),
        "voting_interest_max": _decimal_string(interests.get("voting_max")),
        "economic_interest_min": _decimal_string(interests.get("economic_min")),
        "economic_interest_max": _decimal_string(interests.get("economic_max")),
        "lifecycle_state": "historical" if record.get("ceased_on") else "current",
        "notified_on": record.get("notified_on"),
        "ceased_on": record.get("ceased_on"),
    }


async def _companies_house_person_candidate(
    db: AsyncSession,
    *,
    report: IngestReport,
    payload: CapturedPayload,
    index: int,
    record: dict[str, Any],
    company: EvidenceEntity,
    company_number: str,
    record_type: str,
) -> None:
    identity = await _companies_house_person_controller(
        db, record=record, company_number=company_number, record_type=record_type
    )
    if identity is None:
        return
    controller, person_name = identity
    is_officer = record_type == "officer"
    predicates = "employed_by" if is_officer else "controls"
    await _candidate(
        db,
        report=report,
        payload=payload,
        adapter="companies_house",
        document_key=f"{company_number}:{record_type}:{record.get('record_id') or person_name}",
        document_type=f"companies_house_{record_type}",
        source_class="registry_filing",
        subject=controller if is_officer else company,
        predicate=predicates,
        object_entity=company if is_officer else controller,
        object_value=None,
        qualifiers=_companies_house_person_qualifiers(record),
        locator={"record_index": index, "record_type": record_type},
        structured_value=record,
    )


async def ingest_companies_house_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest company, officer, and PSC records without collapsing their kinds."""
    report = IngestReport(source="companies_house")
    for index, record in enumerate(records):
        company_number = str(record.get("company_number") or "").strip()
        company_name = str(record.get("company_name") or company_number).strip()
        if not company_number or not company_name:
            continue
        company = await _entity(
            db,
            name=company_name,
            entity_kind="legal_entity",
            external_ids={"companies_house_number": company_number},
        )
        record_type = str(record.get("record_type") or "company")
        if record_type == "company":
            await _companies_house_company_candidate(
                db,
                report=report,
                payload=payload,
                index=index,
                record=record,
                company=company,
                company_number=company_number,
            )
        else:
            await _companies_house_person_candidate(
                db,
                report=report,
                payload=payload,
                index=index,
                record=record,
                company=company,
                company_number=company_number,
                record_type=record_type,
            )
    return report


async def ingest_irs_990_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest distinct Form 990 financial value types as candidate attributes."""
    report = IngestReport(source="irs_990")
    fields = {
        "contributions": "reports_contribution",
        "revenue": "reports_revenue",
        "compensation": "reports_compensation",
        "grants_paid": "reports_grant",
    }
    for index, record in enumerate(records):
        ein = str(record.get("ein") or "").replace("-", "").strip()
        name = str(record.get("organization_name") or ein).strip()
        if not ein or not name:
            continue
        organization = await _entity(
            db, name=name, entity_kind="nonprofit", external_ids={"ein": ein}
        )
        for field_name, predicate in fields.items():
            amount = _decimal_string(record.get(field_name))
            if amount is None:
                continue
            await _candidate(
                db,
                report=report,
                payload=payload,
                adapter="irs_990",
                document_key=f"{ein}:{record.get('tax_period')}:{field_name}",
                document_type="irs_form_990",
                source_class="irs_990",
                subject=organization,
                predicate=predicate,
                object_entity=None,
                object_value={"amount": amount, "currency": "USD", "value_type": field_name},
                qualifiers={
                    "tax_period": record.get("tax_period"),
                    "filing_type": record.get("filing_type"),
                },
                locator={"record_index": index, "field": field_name},
                structured_value=record,
            )
    return report


def _usaspending_amounts(record: dict[str, Any]) -> dict[str, str | None]:
    return {
        "contract_ceiling": _decimal_string(record.get("contract_ceiling")),
        "obligation": _decimal_string(record.get("obligation")),
        "outlay": _decimal_string(record.get("outlay")),
    }


def _usaspending_record_fields(record: dict[str, Any]) -> dict[str, str] | None:
    """Return normalized award identity fields, or None when the record is invalid."""
    award_id = _record_str(record, "award_id")
    recipient_name = _record_str(record, "recipient_name")
    agency_name = _record_str(record, "awarding_agency_name")
    if not award_id or not recipient_name or not agency_name:
        return None
    return {
        "award_id": award_id,
        "recipient_name": recipient_name,
        "recipient_id": _record_str(record, "recipient_id") or recipient_name,
        "agency_name": agency_name,
        "agency_id": _record_str(record, "awarding_agency_id") or agency_name,
    }


async def ingest_usaspending_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest awards while preserving ceiling, obligation, and outlay amounts."""
    report = IngestReport(source="usaspending")
    for index, record in enumerate(records):
        fields = _usaspending_record_fields(record)
        if fields is None:
            continue
        recipient = await _entity(
            db,
            name=fields["recipient_name"],
            entity_kind="legal_entity",
            external_ids={"usaspending_recipient": fields["recipient_id"]},
        )
        agency = await _entity(
            db,
            name=fields["agency_name"],
            entity_kind="government_award",
            external_ids={"usaspending_agency": fields["agency_id"]},
        )
        for value_type, amount in _usaspending_amounts(record).items():
            if amount is None:
                continue
            await _candidate(
                db,
                report=report,
                payload=payload,
                adapter="usaspending",
                document_key=f"{fields['award_id']}:{value_type}",
                document_type="usaspending_award",
                source_class="government_record",
                subject=recipient,
                predicate="funds",
                object_entity=agency,
                object_value={"amount": amount, "currency": "USD", "value_type": value_type},
                qualifiers={
                    "award_id": fields["award_id"],
                    "award_type": record.get("award_type"),
                    "value_type": value_type,
                },
                locator={"record_index": index, "field": value_type},
                structured_value=record,
            )
    return report


async def _fcc_record_target(
    db: AsyncSession, *, record: dict[str, Any], record_type: str
) -> tuple[str, EvidenceEntity, str] | None:
    if record_type == "ownership":
        owner_name = str(record.get("owner_name") or "").strip()
        if not owner_name:
            return None
        owner = await _entity(
            db,
            name=owner_name,
            entity_kind="legal_entity",
            external_ids={"fcc_frn": str(record.get("owner_frn") or owner_name)},
        )
        return "directly_owns", owner, "fcc_filing"
    buyer_name = str(record.get("buyer_name") or "").strip()
    if not buyer_name:
        return None
    object_entity = await _entity(
        db,
        name=buyer_name,
        entity_kind="legal_entity",
        external_ids={"fcc_political_buyer": str(record.get("buyer_id") or buyer_name)},
    )
    return "political_ad_purchase", object_entity, "fcc_political_file"


def _fcc_record_fields(record: dict[str, Any]) -> tuple[str, str, str] | None:
    """Return (facility_id, call_sign, record_type) or None when the record is invalid."""
    facility_id = _record_str(record, "facility_id")
    call_sign = _record_str(record, "call_sign") or facility_id
    if not facility_id or not call_sign:
        return None
    record_type = _record_str(record, "record_type") or "ownership"
    return facility_id, call_sign, record_type


async def ingest_fcc_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest station ownership and political-file purchases as different facts."""
    report = IngestReport(source="fcc")
    for index, record in enumerate(records):
        fields = _fcc_record_fields(record)
        if fields is None:
            continue
        facility_id, call_sign, record_type = fields
        station = await _entity(
            db,
            name=call_sign,
            entity_kind="broadcast_station",
            external_ids={"fcc_facility_id": facility_id},
        )
        target = await _fcc_record_target(db, record=record, record_type=record_type)
        if target is None:
            continue
        predicate, object_entity, source_class = target
        await _candidate(
            db,
            report=report,
            payload=payload,
            adapter="fcc",
            document_key=f"{facility_id}:{record_type}:{record.get('filing_id') or index}",
            document_type=f"fcc_{record_type}_record",
            source_class=source_class,
            subject=station,
            predicate=predicate,
            object_entity=object_entity,
            object_value=None,
            qualifiers={
                "filing_id": record.get("filing_id"),
                "reporting_date": record.get("reporting_date"),
                "amount": _decimal_string(record.get("amount")),
                "currency": "USD" if record.get("amount") is not None else None,
                "lifecycle_state": str(record.get("lifecycle_state") or "current"),
            },
            locator={"record_index": index, "filing_id": record.get("filing_id")},
            structured_value=record,
        )
    return report


async def _article_author_branch(
    db: AsyncSession,
    *,
    record: dict[str, Any],
    url: str,
    source_class: str,
) -> tuple[EvidenceEntity, str, EvidenceEntity, str] | None:
    """Resolve the article and author for a byline/JSON-LD author record."""
    author_name = _record_str(record, "author_name")
    if not author_name:
        return None
    author = await _entity(
        db,
        name=author_name,
        entity_kind="person",
        external_ids={
            "author_profile": _record_str(record, "author_url") or f"{url}#{author_name}"
        },
    )
    article = await _entity(
        db,
        name=_record_str(record, "headline") or url,
        entity_kind="publication_brand",
        external_ids={"article_url": url},
    )
    return article, "authored_by", author, source_class


async def _reporter_byline_branch(
    db: AsyncSession,
    *,
    record: dict[str, Any],
    outlet: EvidenceEntity,
) -> tuple[EvidenceEntity, str, EvidenceEntity, str] | None:
    """Resolve the reporter and outlet for a bulk reporter-byline record."""
    author_name = _record_str(record, "author_name")
    reporter_key = _record_str(record, "reporter_id")
    if not author_name or not reporter_key:
        return None
    author = await _entity(
        db,
        name=author_name,
        entity_kind="person",
        external_ids={"scoop_reporter_id": reporter_key},
    )
    return author, "authored_by", outlet, "article_byline"


async def _staff_profile_branch(
    db: AsyncSession,
    *,
    record: dict[str, Any],
    url: str,
    outlet: EvidenceEntity,
) -> tuple[EvidenceEntity, str, EvidenceEntity, str] | None:
    """Resolve the person for a staff-profile or masthead record."""
    person_name = _record_str(record, "person_name")
    if not person_name:
        return None
    subject = await _entity(
        db, name=person_name, entity_kind="person", external_ids={"staff_profile": url}
    )
    return subject, "employed_by", outlet, "employer_profile"


async def _syndication_branch(
    db: AsyncSession,
    *,
    record: dict[str, Any],
    outlet: EvidenceEntity,
) -> tuple[EvidenceEntity, str, EvidenceEntity, str] | None:
    """Resolve the origin outlet for a syndication record."""
    origin_name = _record_str(record, "origin_name")
    if not origin_name:
        return None
    object_entity = await _entity(
        db,
        name=origin_name,
        entity_kind="publication_brand",
        external_ids={"domain": _record_str(record, "origin_domain") or origin_name},
    )
    return outlet, "syndicated_by", object_entity, "article_structured_data"


async def _article_record_branch(
    db: AsyncSession,
    *,
    record_type: str,
    record: dict[str, Any],
    url: str,
    outlet: EvidenceEntity,
) -> tuple[EvidenceEntity, str, EvidenceEntity | None, str] | None:
    if record_type in {"byline", "jsonld_author"}:
        source_class = (
            "article_structured_data" if record_type == "jsonld_author" else "article_byline"
        )
        return await _article_author_branch(db, record=record, url=url, source_class=source_class)
    if record_type == "reporter_byline":
        return await _reporter_byline_branch(db, record=record, outlet=outlet)
    if record_type in {"staff_profile", "masthead"}:
        return await _staff_profile_branch(db, record=record, url=url, outlet=outlet)
    if record_type == "syndication":
        return await _syndication_branch(db, record=record, outlet=outlet)
    return outlet, "publishing_notice", None, "own_site"


def _article_record_fields(record: dict[str, Any]) -> tuple[str, str, str] | None:
    """Return (url, outlet_name, record_type) or None when the record is invalid."""
    url = _record_str(record, "article_url", "profile_url")
    outlet_name = _record_str(record, "outlet_name")
    if not url or not outlet_name:
        return None
    return url, outlet_name, _record_str(record, "record_type") or "byline"


async def ingest_article_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest JSON-LD/bylines, profiles, staff, corrections, and syndication."""
    report = IngestReport(source="article_records")
    for index, record in enumerate(records):
        fields = _article_record_fields(record)
        if fields is None:
            continue
        url, outlet_name, record_type = fields
        outlet = await _entity(
            db,
            name=outlet_name,
            entity_kind="publication_brand",
            external_ids={"domain": _record_str(record, "outlet_domain") or outlet_name},
        )
        branch = await _article_record_branch(
            db, record_type=record_type, record=record, url=url, outlet=outlet
        )
        if branch is None:
            continue
        subject, predicate, object_entity, source_class = branch
        await _candidate(
            db,
            report=report,
            payload=payload,
            adapter="article_records",
            document_key=f"{url}:{record_type}:{index}",
            document_type=record_type,
            source_class=source_class,
            subject=subject,
            predicate=predicate,
            object_entity=object_entity,
            object_value=(
                {"notice_type": record_type, "text": record.get("text")}
                if object_entity is None
                else None
            ),
            qualifiers={
                "article_url": record.get("article_url"),
                "captured_at": payload.retrieved_at.isoformat(),
                "reporter_id": record.get("reporter_id"),
            },
            locator={"record_index": index, "selector": record.get("selector")},
            structured_value=record,
            quoted_text=cast(str | None, record.get("text")),
        )
    return report


async def ingest_sellers_json_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Corroborate an exact ads.txt account against a sellers.json record."""
    report = IngestReport(source="sellers_json")
    for index, record in enumerate(records):
        publisher_id = str(record.get("publisher_entity_id") or "").strip()
        ad_system = str(record.get("ad_system_domain") or "").lower().strip()
        seller_id = str(record.get("seller_id") or "").strip()
        if not publisher_id or not ad_system or not seller_id:
            continue
        publisher = await db.get(EvidenceEntity, publisher_id)
        if publisher is None:
            continue
        seller = await _entity(
            db,
            name=str(record.get("seller_name") or f"{ad_system} seller {seller_id}"),
            entity_kind="seller_account",
            external_ids={"seller_account": f"{ad_system}:{seller_id}"},
        )
        await _candidate(
            db,
            report=report,
            payload=payload,
            adapter="sellers_json",
            document_key=f"{ad_system}:{seller_id}",
            document_type="sellers_json",
            source_class="sellers_json",
            subject=publisher,
            predicate="authorizes_inventory_seller",
            object_entity=seller,
            object_value=None,
            qualifiers={
                "publisher_domain": record.get("publisher_domain"),
                "ad_system_domain": ad_system,
                "seller_account_id": seller_id,
                "seller_type": record.get("seller_type"),
                "is_confidential": bool(record.get("is_confidential", False)),
                "captured_at": payload.retrieved_at.isoformat(),
                "lifecycle_state": "current",
            },
            locator={"record_index": index, "seller_id": seller_id},
            structured_value=record,
        )
    return report


async def ingest_sponsorship_records(
    db: AsyncSession, *, payload: CapturedPayload, records: list[dict[str, Any]]
) -> IngestReport:
    """Ingest explicit sponsorship disclosures, never inferred advertisers."""
    report = IngestReport(source="sponsorship")
    for index, record in enumerate(records):
        publisher_name = str(record.get("publisher_name") or "").strip()
        sponsor_name = str(record.get("sponsor_name") or "").strip()
        disclosure_url = str(record.get("disclosure_url") or payload.source_url).strip()
        if not publisher_name or not sponsor_name:
            continue
        publisher = await _entity(
            db,
            name=publisher_name,
            entity_kind="publication_brand",
            external_ids={"domain": str(record.get("publisher_domain") or publisher_name)},
        )
        sponsor = await _entity(
            db,
            name=sponsor_name,
            entity_kind="legal_entity",
            external_ids={"sponsor_identity": str(record.get("sponsor_id") or sponsor_name)},
        )
        await _candidate(
            db,
            report=report,
            payload=payload,
            adapter="sponsorship",
            document_key=f"{disclosure_url}:{sponsor_name}",
            document_type="sponsorship_disclosure",
            source_class="sponsorship_disclosure",
            subject=publisher,
            predicate="sponsors_content",
            object_entity=sponsor,
            object_value=None,
            qualifiers={
                "disclosure_url": disclosure_url,
                "campaign": record.get("campaign"),
                "captured_at": payload.retrieved_at.isoformat(),
                "lifecycle_state": str(record.get("lifecycle_state") or "current"),
            },
            locator={"record_index": index, "selector": record.get("selector")},
            structured_value=record,
            quoted_text=cast(str | None, record.get("disclosure_text")),
        )
    return report


__all__ = [
    "ADAPTER_REGISTRY",
    "AdapterContract",
    "CapturedPayload",
    "ingest_article_records",
    "ingest_companies_house_records",
    "ingest_corporate_records",
    "ingest_fcc_records",
    "ingest_gleif_records",
    "ingest_irs_990_records",
    "ingest_sellers_json_records",
    "ingest_sponsorship_records",
    "ingest_usaspending_records",
    "parse_article_html",
    "parse_companies_house_api",
    "parse_fcc_records",
    "parse_gleif_api",
    "parse_irs_990_xml",
    "parse_sellers_json_capture",
    "parse_usaspending_api",
]
