"""Ad supply-chain transparency helpers for source dossiers."""

from __future__ import annotations

import json
import re
from typing import Any, cast
from collections.abc import Iterable, Sequence
from urllib.parse import urlparse

import httpx

from app.core.config import SCOOP_BROWSER_UA

ADS_TXT_RELATIONSHIPS = {"DIRECT", "RESELLER"}
ADS_TXT_MAX_BYTES = 200_000
SELLERS_JSON_MAX_AD_SYSTEMS = 8
SELLERS_JSON_MAX_BYTES = 2_000_000


def _unique_strings(values: Iterable[str | None]) -> list[str]:
    unique: dict[str, None] = {}
    for value in values:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in unique:
            unique[cleaned] = None
    return list(unique.keys())


def _root_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url if "://" in url else f"https://{url}")
    if not parsed.netloc:
        return None
    return f"{parsed.scheme or 'https'}://{parsed.netloc}"


def ads_txt_url(website: str | None) -> str | None:
    """Build the publisher-root ads.txt URL for a website."""
    root_url = _root_url(website)
    return f"{root_url}/ads.txt" if root_url else None


def sellers_json_url(ad_system_domain: str | None) -> str | None:
    """Build the conventional sellers.json URL for an ad-system domain."""
    domain = (ad_system_domain or "").strip().lower()
    if not domain or "/" in domain or "." not in domain:
        return None
    return f"https://{domain}/sellers.json"


def parse_ads_txt(text: str) -> dict[str, Any]:
    """Parse ads.txt text into seller records and transparency variables."""
    records: list[dict[str, str]] = []
    variables: dict[str, list[str]] = {}
    invalid_lines = 0
    duplicate_records = 0
    seen_records: set[tuple[str, str, str]] = set()

    for raw_line in text.replace("\ufeff", "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        line_without_comment = line.split("#", 1)[0].strip()
        if not line_without_comment:
            continue

        if "=" in line_without_comment and "," not in line_without_comment.split("=", 1)[0]:
            key, value = line_without_comment.split("=", 1)
            key = key.strip().upper()
            value = value.strip()
            if key and value:
                variables.setdefault(key, []).append(value)
            else:
                invalid_lines += 1
            continue

        parts = [part.strip() for part in line_without_comment.split(",")]
        if len(parts) < 3:
            invalid_lines += 1
            continue

        ad_system_domain = parts[0].lower()
        publisher_account_id = parts[1]
        relationship = parts[2].upper()
        certification_authority_id = parts[3] if len(parts) > 3 else ""
        if (
            not ad_system_domain
            or not publisher_account_id
            or relationship not in ADS_TXT_RELATIONSHIPS
        ):
            invalid_lines += 1
            continue

        record_key = (ad_system_domain, publisher_account_id, relationship)
        if record_key in seen_records:
            duplicate_records += 1
        seen_records.add(record_key)
        records.append(
            {
                "ad_system_domain": ad_system_domain,
                "publisher_account_id": publisher_account_id,
                "relationship": relationship,
                "certification_authority_id": certification_authority_id,
            }
        )

    direct_sellers = sum(1 for record in records if record["relationship"] == "DIRECT")
    resellers = sum(1 for record in records if record["relationship"] == "RESELLER")
    return {
        "records": records,
        "authorized_sellers": len(records),
        "direct_sellers": direct_sellers,
        "resellers": resellers,
        "duplicate_records": duplicate_records,
        "invalid_lines": invalid_lines,
        "owner_domains": _unique_strings(variables.get("OWNERDOMAIN", [])),
        "manager_domains": _unique_strings(variables.get("MANAGERDOMAIN", [])),
        "contact": _unique_strings(
            [
                *variables.get("CONTACT", []),
                *variables.get("CONTACT-EMAIL", []),
                *variables.get("CONTACTEMAIL", []),
            ]
        ),
    }


def _normalize_supply_domain(value: str | None) -> str | None:
    if not value:
        return None
    first_value = value.split(",", 1)[0].strip().lower()
    parsed = urlparse(first_value if "://" in first_value else f"https://{first_value}")
    host = parsed.netloc or parsed.path
    host = host.lower().replace("www.", "").strip(".")
    return host or None


def _domain_matches_supply_declaration(value: str | None, declared_domains: Sequence[str]) -> bool:
    candidate = _normalize_supply_domain(value)
    if not candidate:
        return False
    for declared in declared_domains:
        normalized_declared = _normalize_supply_domain(declared)
        if not normalized_declared:
            continue
        if candidate == normalized_declared or candidate.endswith(f".{normalized_declared}"):
            return True
    return False


def parse_sellers_json(text: str) -> dict[str, Any] | None:
    """Parse sellers.json text and index sellers by seller_id."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    raw_sellers = data.get("sellers")
    if not isinstance(raw_sellers, list):
        return None
    sellers_by_id: dict[str, dict[str, str]] = {}
    confidential_sellers = 0
    for raw_seller in raw_sellers:
        if not isinstance(raw_seller, dict):
            continue
        seller_id = str(raw_seller.get("seller_id") or "").strip()
        if not seller_id:
            continue
        is_confidential = bool(raw_seller.get("is_confidential"))
        if is_confidential:
            confidential_sellers += 1
        sellers_by_id[seller_id] = {
            "seller_id": seller_id,
            "seller_type": str(raw_seller.get("seller_type") or "").strip(),
            "name": str(raw_seller.get("name") or "").strip(),
            "domain": str(raw_seller.get("domain") or "").strip(),
            "is_confidential": str(is_confidential).lower(),
        }
    return {
        "seller_count": len(sellers_by_id),
        "confidential_sellers": confidential_sellers,
        "sellers_by_id": sellers_by_id,
    }


def public_ads_txt_summary(ads_txt: dict[str, Any] | None) -> dict[str, Any] | None:
    """Remove internal seller records from an ads.txt summary."""
    if not ads_txt:
        return None
    return {key: value for key, value in ads_txt.items() if key != "records"}


async def fetch_ads_txt(
    http_client: httpx.AsyncClient, website: str | None
) -> dict[str, Any] | None:
    """Fetch and parse a publisher-root ads.txt file."""
    url = ads_txt_url(website)
    if not url:
        return None
    try:
        response = await http_client.get(
            url,
            headers={"User-Agent": SCOOP_BROWSER_UA, "Accept": "text/plain,*/*;q=0.8"},
            follow_redirects=True,
        )
    except Exception:
        return None
    if response.status_code != 200:
        return None
    content_type = response.headers.get("content-type", "").lower()
    if "text/html" in content_type:
        return None
    content = response.content[:ADS_TXT_MAX_BYTES]
    text = content.decode(response.encoding or "utf-8", errors="replace")
    if re.search(r"(?is)<\s*(html|doctype)\b", text[:500]):
        return None
    parsed = parse_ads_txt(text)
    if not any(
        [
            parsed["authorized_sellers"],
            parsed["owner_domains"],
            parsed["manager_domains"],
            parsed["contact"],
        ]
    ):
        return None
    return {
        "url": str(response.url),
        **parsed,
    }


async def _fetch_sellers_json(
    http_client: httpx.AsyncClient, ad_system_domain: str
) -> dict[str, Any] | None:
    url = sellers_json_url(ad_system_domain)
    if not url:
        return None
    try:
        response = await http_client.get(
            url,
            headers={"User-Agent": SCOOP_BROWSER_UA, "Accept": "application/json,*/*;q=0.8"},
            follow_redirects=True,
        )
    except Exception:
        return None
    if response.status_code != 200:
        return None
    content_type = response.headers.get("content-type", "").lower()
    if "text/html" in content_type:
        return None
    content = response.content[:SELLERS_JSON_MAX_BYTES]
    text = content.decode(response.encoding or "utf-8", errors="replace")
    parsed = parse_sellers_json(text)
    if not parsed:
        return None
    return {
        "ad_system_domain": ad_system_domain,
        "url": str(response.url),
        **parsed,
    }


async def build_sellers_json_summary(
    http_client: httpx.AsyncClient, ads_txt: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Cross-check a bounded set of ads.txt rows against sellers.json files."""
    if not ads_txt:
        return None
    records = cast(list[dict[str, str]], ads_txt.get("records") or [])
    if not records:
        return None

    record_counts: dict[str, int] = {}
    for record in records:
        domain = record.get("ad_system_domain")
        if domain:
            record_counts[domain] = record_counts.get(domain, 0) + 1
    ad_system_domains = [
        domain
        for domain, _ in sorted(record_counts.items(), key=lambda item: (-item[1], item[0]))[
            :SELLERS_JSON_MAX_AD_SYSTEMS
        ]
    ]

    checked_systems: list[dict[str, Any]] = []
    matched_records = 0
    owner_domain_matches = 0
    manager_domain_matches = 0
    missing_seller_ids = 0
    checked_records = 0
    owner_domains = cast(list[str], ads_txt.get("owner_domains") or [])
    manager_domains = cast(list[str], ads_txt.get("manager_domains") or [])

    for domain in ad_system_domains:
        sellers_json = await _fetch_sellers_json(http_client, domain)
        domain_records = [record for record in records if record.get("ad_system_domain") == domain]
        if not sellers_json:
            checked_systems.append(
                {
                    "ad_system_domain": domain,
                    "status": "missing",
                    "ads_txt_records": len(domain_records),
                    "sellers_json_url": sellers_json_url(domain),
                }
            )
            continue

        sellers_by_id = cast(dict[str, dict[str, str]], sellers_json.get("sellers_by_id") or {})
        system_matched = 0
        system_owner_matches = 0
        system_manager_matches = 0
        system_missing = 0
        for record in domain_records:
            checked_records += 1
            seller = sellers_by_id.get(record.get("publisher_account_id") or "")
            if not seller:
                system_missing += 1
                missing_seller_ids += 1
                continue
            system_matched += 1
            matched_records += 1
            if _domain_matches_supply_declaration(seller.get("domain"), owner_domains):
                system_owner_matches += 1
                owner_domain_matches += 1
            if _domain_matches_supply_declaration(seller.get("domain"), manager_domains):
                system_manager_matches += 1
                manager_domain_matches += 1

        checked_systems.append(
            {
                "ad_system_domain": domain,
                "status": "available",
                "ads_txt_records": len(domain_records),
                "seller_count": sellers_json["seller_count"],
                "confidential_sellers": sellers_json["confidential_sellers"],
                "matched_records": system_matched,
                "missing_seller_ids": system_missing,
                "owner_domain_matches": system_owner_matches,
                "manager_domain_matches": system_manager_matches,
                "sellers_json_url": sellers_json["url"],
            }
        )

    available_systems = [system for system in checked_systems if system["status"] == "available"]
    if not checked_systems:
        return None
    return {
        "checked_ad_systems": len(checked_systems),
        "available_sellers_json": len(available_systems),
        "checked_records": checked_records,
        "matched_records": matched_records,
        "missing_seller_ids": missing_seller_ids,
        "owner_domain_matches": owner_domain_matches,
        "manager_domain_matches": manager_domain_matches,
        "systems": checked_systems,
    }
