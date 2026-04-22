from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Dict, List, Optional, Sequence, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Article, SourceClaim, SourceClaimEvidence, get_utc_now
from app.services.source_url_guard import build_source_url_guard, extract_domain

logger = get_logger("source_claims")

CLAIMS_PARSER_VERSION = "source-claims/v1"


@dataclass
class ClaimEvidenceInput:
    source_type: str
    source_url: str
    source_name: Optional[str] = None
    raw_excerpt: Optional[str] = None
    retrieved_at: Optional[Any] = None


@dataclass
class SourceClaimInput:
    claim_type: str
    claim_value: Dict[str, Any]
    claim_kind: str
    confidence: float
    parser_version: str = CLAIMS_PARSER_VERSION
    evidence: List[ClaimEvidenceInput] = field(default_factory=list)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash_evidence(evidence: ClaimEvidenceInput, claim_value: Dict[str, Any]) -> str:
    payload = {
        "source_type": evidence.source_type,
        "source_url": evidence.source_url,
        "source_name": evidence.source_name,
        "raw_excerpt": evidence.raw_excerpt,
        "claim_value": claim_value,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def _normalized_funding_type(
    org_data: Dict[str, Any], source_config: Dict[str, Any]
) -> str:
    value = (
        str(org_data.get("funding_type") or source_config.get("funding_type") or "")
        .strip()
        .lower()
    )
    if value == "non-profit":
        return "nonprofit"
    return value


def _base_evidence(
    source_name: str, source_config: Dict[str, Any]
) -> List[ClaimEvidenceInput]:
    evidence: List[ClaimEvidenceInput] = []
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


def build_source_claim_inputs(
    source_name: str,
    source_config: Dict[str, Any],
    org_data: Dict[str, Any],
    article_count_30d: int,
    top_topics_30d: Sequence[str],
) -> List[SourceClaimInput]:
    claims: List[SourceClaimInput] = []
    base_evidence = _base_evidence(source_name, source_config)

    domain = extract_domain(
        source_config.get("site_url")
        or source_config.get("url")
        or org_data.get("website")
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

    source_url_guard = build_source_url_guard(
        source_config.get("url"),
        str(org_data.get("website") or "") or None,
    )

    claims.append(
        SourceClaimInput(
            claim_type="source_url_guard",
            claim_value=source_url_guard,
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

    funding_type = _normalized_funding_type(org_data, source_config)
    if funding_type:
        claims.append(
            SourceClaimInput(
                claim_type="funding_type",
                claim_value={"funding_type": funding_type},
                claim_kind="factual",
                confidence=0.9,
                evidence=base_evidence,
            )
        )
        claims.append(
            SourceClaimInput(
                claim_type="nonprofit_status",
                claim_value={"nonprofit": funding_type in {"nonprofit", "nonprofit"}},
                claim_kind="factual",
                confidence=0.9,
                evidence=base_evidence,
            )
        )

    legal_name = str(org_data.get("name") or source_name).strip()
    if legal_name:
        legal_evidence = list(base_evidence)
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
        claims.append(
            SourceClaimInput(
                claim_type="legal_entity_name",
                claim_value={"name": legal_name},
                claim_kind="factual",
                confidence=0.85,
                evidence=legal_evidence,
            )
        )

    parent_company = str(org_data.get("parent_org") or "").strip()
    if parent_company:
        parent_evidence = list(base_evidence)
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
        claims.append(
            SourceClaimInput(
                claim_type="parent_company",
                claim_value={"name": parent_company},
                claim_kind="factual",
                confidence=0.9,
                evidence=parent_evidence,
            )
        )

    bias_rating = str(source_config.get("bias_rating") or "").strip()
    if bias_rating:
        claims.append(
            SourceClaimInput(
                claim_type="bias_label_catalog",
                claim_value={"label": bias_rating.lower(), "provider": "rss_catalog"},
                claim_kind="third_party_opinion",
                confidence=0.6,
                evidence=base_evidence,
            )
        )

    factual_reporting = str(source_config.get("factual_reporting") or "").strip()
    if factual_reporting:
        claims.append(
            SourceClaimInput(
                claim_type="factual_reporting_catalog",
                claim_value={
                    "label": factual_reporting.lower(),
                    "provider": "rss_catalog",
                },
                claim_kind="third_party_opinion",
                confidence=0.65,
                evidence=base_evidence,
            )
        )

    claims.append(
        SourceClaimInput(
            claim_type="article_count_30d",
            claim_value={"count": int(article_count_30d)},
            claim_kind="computed",
            confidence=0.8,
            evidence=[
                ClaimEvidenceInput(
                    source_type="internal_articles_query",
                    source_url=f"internal://articles?source={source_name}&window=30d",
                    source_name=source_name,
                    raw_excerpt=f"count={article_count_30d}",
                )
            ],
        )
    )

    claims.append(
        SourceClaimInput(
            claim_type="top_topics_30d",
            claim_value={"topics": list(top_topics_30d)},
            claim_kind="computed",
            confidence=0.75,
            evidence=[
                ClaimEvidenceInput(
                    source_type="internal_articles_query",
                    source_url=f"internal://articles?source={source_name}&window=30d&group=category",
                    source_name=source_name,
                    raw_excerpt=", ".join(top_topics_30d),
                )
            ],
        )
    )

    return claims


async def collect_article_behavior_stats(
    session: AsyncSession,
    source_name: str,
    days: int = 30,
) -> tuple[int, List[str]]:
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
    now = get_utc_now()
    for incoming in claims:
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

        confidence_value = float(incoming.confidence)

        if matching is not None:
            cast(Any, matching).confidence = confidence_value
            matching.parser_version = incoming.parser_version
            matching.updated_at = now
            claim_row = matching
        else:
            for current in active_claims:
                current.is_current = False
                current.valid_to = now
                current.updated_at = now

            claim_row = SourceClaim(
                source_name=source_name,
                claim_type=incoming.claim_type,
                claim_value=incoming.claim_value,
                claim_kind=incoming.claim_kind,
                confidence=cast(Any, confidence_value),
                parser_version=incoming.parser_version,
                is_current=True,
                valid_from=now,
            )
            session.add(claim_row)
            await session.flush()

        evidence_result = await session.execute(
            select(SourceClaimEvidence).where(
                SourceClaimEvidence.claim_id == claim_row.id
            )
        )
        existing_hashes = {
            e.raw_hash for e in evidence_result.scalars().all() if e.raw_hash
        }
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

    await session.commit()
    logger.info("Synced %d claim types for %s", len(claims), source_name)
