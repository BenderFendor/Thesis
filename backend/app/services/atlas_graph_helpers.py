"""Shared normalization and trust helpers for Intelligence Atlas graph services."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any, Iterable, cast

from app.data.rss_sources import get_rss_sources
from app.database import Reporter, SourceClaim, SourceClaimEvidence
from app.models.atlas import (
    AtlasConfidenceTier,
    AtlasEdge,
    AtlasEvidenceRef,
    AtlasGraphFilters,
    AtlasNode,
    AtlasRelationType,
)

_OWNER_CLAIM_TYPES = {"parent_company", "owner", "ownership", "owned_by"}
_LEGAL_ENTITY_CLAIM_TYPES = {"legal_entity_name", "organization"}
_RELATION_GROUPS: dict[str, AtlasRelationType] = {
    "ownership": "ownership",
    "owned_by": "owned_by",
    "parent_org": "parent_org",
    "part_of": "part_of",
    "publishes": "publishes",
    "employed_by": "employed_by",
    "current_outlet": "current_outlet",
    "current_outlet_verified": "current_outlet",
    "historical_outlet": "employed_by",
    "article_attributed_to_source": "current_outlet",
    "coauthor": "coauthor",
    "shared_outlet": "shared_outlet",
}


def normalize_entity_label(value: str | None) -> str:
    """Normalize an entity label for exact alias matching, never substring matching."""

    if not value:
        return ""
    lowered = value.casefold().strip()
    lowered = re.sub(r"[\W_]+", " ", lowered, flags=re.UNICODE)
    return " ".join(lowered.split())


def stable_source_id(source_name: str) -> str:
    normalized = normalize_entity_label(source_name)
    digest = hashlib.sha1(
        normalized.encode("utf-8"), usedforsecurity=False
    ).hexdigest()[:12]
    return f"source:{digest}"


def confidence_tier(value: float | None, *, stale: bool = False) -> AtlasConfidenceTier:
    if stale:
        return "stale"
    if value is None:
        return "unresolved"
    if value >= 0.9:
        return "verified"
    if value >= 0.75:
        return "strong"
    if value >= 0.5:
        return "likely"
    return "unresolved"


def reporter_confidence_tier(reporter: Reporter) -> AtlasConfidenceTier:
    """Person-level verification requires a person profile, not only repeated bylines."""

    has_person_profile = bool(reporter.author_page_url or reporter.canonical_author_url)
    if reporter.match_status == "matched" and has_person_profile:
        return "verified"
    if has_person_profile and reporter.research_confidence in {"high", "verified"}:
        return "strong"
    if reporter.match_status in {"matched", "ambiguous"}:
        return "likely"
    return "unresolved"


def _catalog_sources() -> dict[str, dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for raw_name, raw_config in get_rss_sources().items():
        name = raw_name.split(" - ")[0].strip()
        unique.setdefault(name, cast(dict[str, Any], raw_config))
    return unique


def _claim_name(claim: SourceClaim) -> str:
    value = claim.claim_value
    if not isinstance(value, dict):
        return ""
    for key in ("name", "organization", "owner", "parent_company"):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return ""


def _edge_id(
    source_id: str, target_id: str, relation: str, discriminator: str = ""
) -> str:
    raw = f"{source_id}|{target_id}|{relation}|{discriminator}"
    digest = hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]
    return f"edge:{digest}"


def _parse_percentage(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        match = re.search(r"\d+(?:\.\d+)?", str(value))
        if not match:
            return None
        number = float(match.group(0))
    if number > 1:
        return min(number, 100.0)
    return max(number * 100.0, 0.0)


def _research_confidence(value: str | None) -> float | None:
    normalized = (value or "").strip().casefold()
    return {
        "verified": 0.95,
        "high": 0.85,
        "medium": 0.65,
        "low": 0.4,
        "ambiguous": 0.45,
    }.get(normalized)


def _evidence_ref(row: SourceClaimEvidence) -> AtlasEvidenceRef:
    return AtlasEvidenceRef(
        id=f"source-claim-evidence:{row.id}",
        source_type=cast(str, row.source_type),
        source_name=cast(str | None, row.source_name),
        source_url=cast(str | None, row.source_url),
        retrieved_at=cast(datetime | None, row.retrieved_at),
        excerpt=cast(str | None, row.raw_excerpt),
    )


def _node_matches(node: AtlasNode, filters: AtlasGraphFilters) -> bool:
    if filters.entity_types and node.entity_type not in filters.entity_types:
        return False
    if filters.country and (node.country_code or "").casefold() not in {
        value.casefold() for value in filters.country
    }:
        return False
    if filters.funding and (node.funding_type or "").casefold() not in {
        value.casefold() for value in filters.funding
    }:
        return False
    if filters.bias and (node.bias_rating or "").casefold() not in {
        value.casefold() for value in filters.bias
    }:
        return False
    if filters.q:
        query = filters.q.casefold().strip()
        haystack = " ".join(
            value
            for value in (
                node.label,
                node.subtitle or "",
                node.country_code or "",
                node.funding_type or "",
                node.bias_rating or "",
            )
            if value
        ).casefold()
        if query not in haystack:
            return False
    return True


def _edge_matches(edge: AtlasEdge, filters: AtlasGraphFilters) -> bool:
    if filters.relation_types and edge.relation_type not in filters.relation_types:
        return False
    if edge.confidence is not None and edge.confidence < filters.min_confidence:
        return False
    if edge.confidence is None and filters.min_confidence > 0:
        return False
    return True


def _dedupe_edges(edges: Iterable[AtlasEdge]) -> list[AtlasEdge]:
    best: dict[tuple[str, str, str], AtlasEdge] = {}
    for edge in edges:
        key = (edge.source_id, edge.target_id, edge.relation_type)
        current = best.get(key)
        if current is None:
            best[key] = edge
            continue
        current_score = (current.confidence or 0.0, current.evidence_count)
        candidate_score = (edge.confidence or 0.0, edge.evidence_count)
        if candidate_score > current_score:
            best[key] = edge
    return list(best.values())
