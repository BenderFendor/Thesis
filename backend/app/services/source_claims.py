"""Source Claims."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article, SourceClaim, SourceClaimEvidence, get_utc_now
from app.services.source_url_guard import build_source_url_guard, extract_domain

logger = get_logger("source_claims")

CLAIMS_PARSER_VERSION = "source-claims/v1"


@dataclass
class ClaimEvidenceInput:
    """Claim Evidence Input."""

    source_type: str
    source_url: str
    source_name: str | None = None
    raw_excerpt: str | None = None
    retrieved_at: Any | None = None


@dataclass
class SourceClaimInput:
    """Source Claim Input."""

    claim_type: str
    claim_value: dict[str, Any]
    claim_kind: str
    confidence: float
    parser_version: str = CLAIMS_PARSER_VERSION
    evidence: list[ClaimEvidenceInput] = field(default_factory=list)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash_evidence(evidence: ClaimEvidenceInput, claim_value: dict[str, Any]) -> str:
    payload = {
        "source_type": evidence.source_type,
        "source_url": evidence.source_url,
        "source_name": evidence.source_name,
        "raw_excerpt": evidence.raw_excerpt,
        "claim_value": claim_value,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def _normalized_funding_type(org_data: dict[str, Any], source_config: dict[str, Any]) -> str:
    value = (
        str(org_data.get("funding_type") or source_config.get("funding_type") or "").strip().lower()
    )
    if value == "non-profit":
        return "nonprofit"
    return value


def _base_evidence(source_name: str, source_config: dict[str, Any]) -> list[ClaimEvidenceInput]:
    evidence: list[ClaimEvidenceInput] = []
    feed_url = source_config.get("url")
    if isinstance(feed_url, str) and feed_url.strip():
        evidence.append(
            ClaimEvidenceInput(
                source_type="rss_catalog",
                source_url=feed_url.strip(),
                source_name=source_name,
                raw_excerpt=f"rss source: {source_name}",
            )
        )
    elif isinstance(feed_url, list):
        for url in feed_url:
            if not isinstance(url, str) or not url.strip():
                continue
            evidence.append(
                ClaimEvidenceInput(
                    source_type="rss_catalog",
                    source_url=url.strip(),
                    source_name=source_name,
                    raw_excerpt=f"rss source: {source_name}",
                )
            )

    site_url = source_config.get("site_url")
    if isinstance(site_url, str) and site_url.strip():
        evidence.append(
            ClaimEvidenceInput(
                source_type="rss_catalog_site",
                source_url=site_url.strip(),
                source_name=source_name,
                raw_excerpt=f"site url: {source_name}",
            )
        )
    return evidence


def _build_identity_claims(
    source_name: str,
    source_config: dict[str, Any],
    org_data: dict[str, Any],
    base_evidence: list[ClaimEvidenceInput],
) -> list[SourceClaimInput]:
    claims: list[SourceClaimInput] = []
    domain = extract_domain(
        source_config.get("site_url") or source_config.get("url") or org_data.get("website")
    )
    if domain:
        claims.append(
            SourceClaimInput(
                claim_type="domain",
                claim_value={"domain": domain},
                claim_kind="factual",
                confidence=0.95,
                evidence=base_evidence,
            )
        )

    claims.append(
        SourceClaimInput(
            claim_type="source_url_guard",
            claim_value=build_source_url_guard(
                source_config.get("url"),
                str(org_data.get("website") or "") or None,
            ),
            claim_kind="computed",
            confidence=0.7,
            evidence=base_evidence,
        )
    )

    country = str(source_config.get("country") or "").strip()
    if country:
        claims.append(
            SourceClaimInput(
                claim_type="country",
                claim_value={"country": country},
                claim_kind="factual",
                confidence=0.9,
                evidence=base_evidence,
            )
        )
    return claims


def _build_organization_claims(
    source_name: str,
    source_config: dict[str, Any],
    org_data: dict[str, Any],
    base_evidence: list[ClaimEvidenceInput],
) -> list[SourceClaimInput]:
    claims: list[SourceClaimInput] = []
    claims.extend(_organization_funding_claims(org_data, source_config, base_evidence))
    claims.extend(_organization_legal_claims(source_name, org_data, base_evidence))
    claims.extend(_organization_parent_claims(source_name, org_data, base_evidence))
    return claims


def _organization_funding_claims(
    org_data: dict[str, Any],
    source_config: dict[str, Any],
    evidence: list[ClaimEvidenceInput],
) -> list[SourceClaimInput]:
    funding_type = _normalized_funding_type(org_data, source_config)
    if not funding_type:
        return []
    return [
        SourceClaimInput(
            claim_type=claim_type,
            claim_value=claim_value,
            claim_kind="factual",
            confidence=0.9,
            evidence=evidence,
        )
        for claim_type, claim_value in (
            ("funding_type", {"funding_type": funding_type}),
            ("nonprofit_status", {"nonprofit": funding_type in {"nonprofit"}}),
        )
    ]


def _organization_legal_claims(
    source_name: str,
    org_data: dict[str, Any],
    evidence: list[ClaimEvidenceInput],
) -> list[SourceClaimInput]:
    legal_name = str(org_data.get("name") or source_name).strip()
    if not legal_name:
        return []
    legal_evidence = list(evidence)
    wikipedia_url = str(org_data.get("wikipedia_url") or "").strip()
    if wikipedia_url:
        legal_evidence.append(
            ClaimEvidenceInput(
                source_type="wikipedia",
                source_url=wikipedia_url,
                source_name=source_name,
                raw_excerpt="organization profile",
            )
        )
    return [
        SourceClaimInput(
            claim_type="legal_entity_name",
            claim_value={"name": legal_name},
            claim_kind="factual",
            confidence=0.85,
            evidence=legal_evidence,
        )
    ]


def _organization_parent_claims(
    source_name: str,
    org_data: dict[str, Any],
    evidence: list[ClaimEvidenceInput],
) -> list[SourceClaimInput]:
    parent_company = str(org_data.get("parent_org") or "").strip()
    if not parent_company:
        return []
    parent_evidence = list(evidence)
    wikidata_url = str(org_data.get("wikidata_url") or "").strip()
    if wikidata_url:
        parent_evidence.append(
            ClaimEvidenceInput(
                source_type="wikidata",
                source_url=wikidata_url,
                source_name=source_name,
                raw_excerpt="parent organization metadata",
            )
        )
    return [
        SourceClaimInput(
            claim_type="parent_company",
            claim_value={"name": parent_company},
            claim_kind="factual",
            confidence=0.9,
            evidence=parent_evidence,
        )
    ]


def _build_catalog_rating_claims(
    source_config: dict[str, Any],
    base_evidence: list[ClaimEvidenceInput],
) -> list[SourceClaimInput]:
    claims: list[SourceClaimInput] = []
    ratings = (
        ("bias_rating", "bias_label_catalog", "label", 0.6),
        ("factual_reporting", "factual_reporting_catalog", "label", 0.65),
    )
    for config_key, claim_type, value_key, confidence in ratings:
        value = str(source_config.get(config_key) or "").strip()
        if value:
            claims.append(
                SourceClaimInput(
                    claim_type=claim_type,
                    claim_value={value_key: value.lower(), "provider": "rss_catalog"},
                    claim_kind="third_party_opinion",
                    confidence=confidence,
                    evidence=base_evidence,
                )
            )
    return claims


def _build_behavior_claims(
    source_name: str,
    article_count_30d: int,
    top_topics_30d: Sequence[str],
) -> list[SourceClaimInput]:
    evidence_url = f"internal://articles?source={source_name}&window=30d"
    return [
        SourceClaimInput(
            claim_type="article_count_30d",
            claim_value={"count": int(article_count_30d)},
            claim_kind="computed",
            confidence=0.8,
            evidence=[
                ClaimEvidenceInput(
                    source_type="internal_articles_query",
                    source_url=evidence_url,
                    source_name=source_name,
                    raw_excerpt=f"count={article_count_30d}",
                )
            ],
        ),
        SourceClaimInput(
            claim_type="top_topics_30d",
            claim_value={"topics": list(top_topics_30d)},
            claim_kind="computed",
            confidence=0.75,
            evidence=[
                ClaimEvidenceInput(
                    source_type="internal_articles_query",
                    source_url=f"{evidence_url}&group=category",
                    source_name=source_name,
                    raw_excerpt=", ".join(top_topics_30d),
                )
            ],
        ),
    ]


def build_source_claim_inputs(
    source_name: str,
    source_config: dict[str, Any],
    org_data: dict[str, Any],
    article_count_30d: int,
    top_topics_30d: Sequence[str],
) -> list[SourceClaimInput]:
    """Build Source Claim Inputs."""
    base_evidence = _base_evidence(source_name, source_config)
    claims = _build_identity_claims(source_name, source_config, org_data, base_evidence)
    claims.extend(_build_organization_claims(source_name, source_config, org_data, base_evidence))
    claims.extend(_build_catalog_rating_claims(source_config, base_evidence))
    claims.extend(_build_behavior_claims(source_name, article_count_30d, top_topics_30d))
    return claims


async def collect_article_behavior_stats(
    session: AsyncSession,
    source_name: str,
    days: int = 30,
) -> tuple[int, list[str]]:
    """Collect Article Behavior Stats."""
    cutoff = get_utc_now() - timedelta(days=days)
    count_stmt = (
        select(func.count())
        .select_from(Article)
        .where(Article.source == source_name, Article.published_at >= cutoff)
    )
    article_count = int((await session.execute(count_stmt)).scalar_one() or 0)

    topics_stmt = (
        select(Article.category, func.count().label("n"))
        .where(Article.source == source_name, Article.published_at >= cutoff)
        .group_by(Article.category)
        .order_by(func.count().desc())
        .limit(5)
    )
    rows = (await session.execute(topics_stmt)).all()
    topics = [str(row[0]) for row in rows if row[0]]
    return article_count, topics


async def sync_source_claims(
    session: AsyncSession,
    source_name: str,
    claims: Sequence[SourceClaimInput],
) -> None:
    """Sync Source Claims."""
    now = get_utc_now()
    for incoming in claims:
        claim_row = await _sync_current_claim(session, source_name, incoming, now)
        await _sync_claim_evidence(session, claim_row, incoming, now)

    await session.commit()
    logger.info("Synced %d claim types for %s", len(claims), source_name)


async def _sync_current_claim(
    session: AsyncSession,
    source_name: str,
    incoming: SourceClaimInput,
    now: Any,
) -> SourceClaim:
    result = await session.execute(
        select(SourceClaim).where(
            SourceClaim.source_name == source_name,
            SourceClaim.claim_type == incoming.claim_type,
            SourceClaim.is_current.is_(True),
        )
    )
    active_claims = list(result.scalars().all())
    incoming_json = _canonical_json(incoming.claim_value)
    matching = next(
        (
            claim
            for claim in active_claims
            if _canonical_json(claim.claim_value) == incoming_json
            and claim.claim_kind == incoming.claim_kind
        ),
        None,
    )
    if matching is not None:
        cast(Any, matching).confidence = float(incoming.confidence)
        matching.parser_version = incoming.parser_version
        matching.updated_at = now
        return matching

    for current in active_claims:
        current.is_current = False
        current.valid_to = now
        current.updated_at = now
    claim_row = SourceClaim(
        source_name=source_name,
        claim_type=incoming.claim_type,
        claim_value=incoming.claim_value,
        claim_kind=incoming.claim_kind,
        confidence=cast(Any, float(incoming.confidence)),
        parser_version=incoming.parser_version,
        is_current=True,
        valid_from=now,
    )
    session.add(claim_row)
    await session.flush()
    return claim_row


async def _sync_claim_evidence(
    session: AsyncSession,
    claim_row: SourceClaim,
    incoming: SourceClaimInput,
    now: Any,
) -> None:
    evidence_result = await session.execute(
        select(SourceClaimEvidence).where(SourceClaimEvidence.claim_id == claim_row.id)
    )
    existing_hashes = {e.raw_hash for e in evidence_result.scalars().all() if e.raw_hash}
    for evidence in incoming.evidence:
        raw_hash = _hash_evidence(evidence, incoming.claim_value)
        if raw_hash in existing_hashes:
            continue
        session.add(
            SourceClaimEvidence(
                claim_id=claim_row.id,
                source_type=evidence.source_type,
                source_name=evidence.source_name,
                source_url=evidence.source_url,
                retrieved_at=evidence.retrieved_at or now,
                raw_excerpt=evidence.raw_excerpt,
                raw_hash=raw_hash,
            )
        )
        existing_hashes.add(raw_hash)
