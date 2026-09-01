"""Shared normalization and trust helpers for Intelligence Atlas graph services."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from typing import Any

from app.data.rss_sources import get_rss_sources
from app.database import Reporter
from app.models.atlas import (
    AtlasConfidenceTier,
    AtlasEdge,
    AtlasEntityType,
    AtlasGraphFilters,
    AtlasNode,
    AtlasRelationType,
)

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
    "directly_owns": "ownership",
    "owns_equity_in": "ownership",
    "controls": "ownership",
    "founded_by": "founded_by",
    "sibling_via_owner": "sibling_via_owner",
}

# Legacy entity-type query-param alias: old bookmarks/URLs/clients may still
# send "source" for what is now the "outlet" entity type. Accept it on the
# way in; every response emits only "outlet".
_ENTITY_TYPE_ALIASES: dict[str, AtlasEntityType] = {"source": "outlet"}


def normalize_entity_type_alias(value: str) -> str:
    """Map a legacy entity-type query value ("source") onto its current name."""
    return _ENTITY_TYPE_ALIASES.get(value, value)


def normalize_entity_id_alias(value: str) -> str:
    """Rewrite a legacy "source:<digest>" node/selected id to "outlet:<digest>"."""
    if value.startswith("source:"):
        return f"outlet:{value[len('source:') :]}"
    return value


def normalize_entity_label(value: str | None) -> str:
    """Casefold and collapse whitespace/punctuation for stable entity-name matching."""
    if not value:
        return ""
    return " ".join(re.sub(r"[\W_]+", " ", value.casefold().strip(), flags=re.UNICODE).split())


def stable_source_id(source_name: str) -> str:
    """Derive a stable Atlas outlet node id from a normalized source name.

    The digest is the durable part of the id (also stored as Phase 0's
    `EntityExternalId(scheme="rss_catalog_key")`); only the human-readable
    prefix changed from "source:" to "outlet:" in the outlet rename.
    """
    digest = hashlib.sha1(
        normalize_entity_label(source_name).encode("utf-8"), usedforsecurity=False
    ).hexdigest()[:12]
    return f"outlet:{digest}"


def confidence_tier(value: float | None, *, stale: bool = False) -> AtlasConfidenceTier:
    """Bucket a numeric confidence score into an Atlas confidence tier."""
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
    """Derive a reporter's confidence tier from match status and profile evidence."""
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
        unique.setdefault(raw_name.split(" - ")[0].strip(), raw_config)
    return unique


def _edge_id(source_id: str, target_id: str, relation: str, discriminator: str = "") -> str:
    raw = f"{source_id}|{target_id}|{relation}|{discriminator}"
    return f"edge:{hashlib.sha1(raw.encode('utf-8'), usedforsecurity=False).hexdigest()[:16]}"


def _research_confidence(value: str | None) -> float | None:
    return {"verified": 0.95, "high": 0.85, "medium": 0.65, "low": 0.4, "ambiguous": 0.45}.get(
        (value or "").strip().casefold()
    )


def _matches_filter_value(value: str | None, expected: list[str] | None) -> bool:
    if not expected:
        return True
    return (value or "").casefold() in {item.casefold() for item in expected}


def _node_search_text(node: AtlasNode) -> str:
    values = (
        node.label,
        node.subtitle,
        node.country_code,
        node.funding_type,
        node.bias_rating,
    )
    return " ".join(value for value in values if value).casefold()


def _node_matches(node: AtlasNode, filters: AtlasGraphFilters) -> bool:
    if filters.entity_types and node.entity_type not in filters.entity_types:
        return False
    if not _matches_filter_value(node.country_code, filters.country):
        return False
    if not _matches_filter_value(node.funding_type, filters.funding):
        return False
    if not _matches_filter_value(node.bias_rating, filters.bias):
        return False
    query = filters.q.casefold().strip() if filters.q else ""
    return not query or query in _node_search_text(node)


def _edge_matches(edge: AtlasEdge, filters: AtlasGraphFilters) -> bool:
    if filters.relation_types and edge.relation_type not in filters.relation_types:
        return False
    if filters.accepted_only and not edge.accepted_fact:
        return False
    if edge.confidence is not None and edge.confidence < filters.min_confidence:
        return False
    return not (edge.confidence is None and filters.min_confidence > 0)


def _dedupe_edges(edges: Iterable[AtlasEdge]) -> list[AtlasEdge]:
    best: dict[tuple[str, str, str], AtlasEdge] = {}
    for edge in edges:
        key = (edge.source_id, edge.target_id, edge.raw_relation_type or edge.relation_type)
        current = best.get(key)
        if current is None:
            best[key] = edge
            continue
        current_score = (
            1 if current.accepted_fact else 0,
            current.confidence or 0.0,
            current.evidence_root_count,
            current.evidence_count,
        )
        candidate_score = (
            1 if edge.accepted_fact else 0,
            edge.confidence or 0.0,
            edge.evidence_root_count,
            edge.evidence_count,
        )
        if candidate_score > current_score:
            best[key] = edge
    return list(best.values())
