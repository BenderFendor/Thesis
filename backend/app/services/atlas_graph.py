"""Bounded graph queries and statistics for the Intelligence Atlas."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import Counter, defaultdict, deque
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import WikiIndexStatus
from app.models.atlas import (
    AtlasCoverageMetric,
    AtlasEdge,
    AtlasEntityType,
    AtlasGraphFilters,
    AtlasGraphResponse,
    AtlasGraphStats,
    AtlasNode,
    AtlasRelationType,
    AtlasStatsResponse,
)
from app.services.atlas_evidence_projection import load_evidence_atlas_projection
from app.services.atlas_graph_helpers import (
    _RELATION_GROUPS,
    _dedupe_edges,
    _edge_matches,
    _node_matches,
)
from app.services.atlas_graph_projection import _load_graph_projection


def _build_adjacency(edges: list[AtlasEdge]) -> dict[str, set[str]]:
    adjacency: dict[str, set[str]] = defaultdict(set)
    for edge in edges:
        adjacency[edge.source_id].add(edge.target_id)
        adjacency[edge.target_id].add(edge.source_id)
    return adjacency


def _collect_neighborhood(
    selected: str,
    neighbors: int,
    adjacency: dict[str, set[str]],
) -> set[str]:
    visible = {selected}
    queue: deque[tuple[str, int]] = deque([(selected, 0)])
    while queue:
        node_id, depth = queue.popleft()
        if depth >= neighbors:
            continue
        for related in adjacency.get(node_id, set()):
            if related not in visible:
                visible.add(related)
                queue.append((related, depth + 1))
    return visible


def _apply_neighborhood(
    nodes: list[AtlasNode], edges: list[AtlasEdge], selected: str | None, neighbors: int
) -> tuple[list[AtlasNode], list[AtlasEdge]]:
    if not selected or neighbors <= 0:
        return nodes, edges
    if selected not in {node.id for node in nodes}:
        return nodes, edges
    visible = _collect_neighborhood(selected, neighbors, _build_adjacency(edges))
    return [node for node in nodes if node.id in visible], [
        edge for edge in edges if edge.source_id in visible and edge.target_id in visible
    ]


def _ownership_signals(
    edges: list[AtlasEdge], node_by_id: dict[str, AtlasNode]
) -> tuple[Counter[str], Counter[str], dict[str, str], dict[str, str], dict[str, str]]:
    degree = Counter[str]()
    ownership_degree = Counter[str]()
    current_parent: dict[str, str] = {}
    current_parent_id: dict[str, str] = {}
    pending_change: dict[str, str] = {}
    for edge in edges:
        degree[edge.source_id] += 1
        degree[edge.target_id] += 1
        if edge.relation_type in {"ownership", "owned_by", "parent_org"}:
            ownership_degree[edge.source_id] += 1
            ownership_degree[edge.target_id] += 1
        if edge.predicate in {
            "directly_owns",
            "owns_equity_in",
            "controls",
            "brand_of",
            "operated_by",
        }:
            owner = node_by_id.get(edge.source_id)
            if owner and edge.accepted_fact and edge.lifecycle_state == "current":
                current_parent[edge.target_id] = owner.label
                current_parent_id[edge.target_id] = edge.source_id
            elif owner and edge.lifecycle_state in {"proposed", "pending", "disputed"}:
                pending_change[edge.target_id] = f"{edge.lifecycle_state}: {owner.label}"
    return degree, ownership_degree, current_parent, current_parent_id, pending_change


def _apply_pending_change_overrides(
    edges: list[AtlasEdge],
    node_by_id: dict[str, AtlasNode],
    current_parent_id: dict[str, str],
    pending_change: dict[str, str],
) -> None:
    for edge in edges:
        if edge.lifecycle_state not in {"proposed", "pending", "disputed"}:
            continue
        for child_id, parent_id in current_parent_id.items():
            if parent_id not in {edge.source_id, edge.target_id}:
                continue
            other_id = edge.target_id if edge.source_id == parent_id else edge.source_id
            other = node_by_id.get(other_id)
            if other is not None:
                pending_change[child_id] = f"{edge.lifecycle_state}: {other.label}"


def _node_signals(
    edges: list[AtlasEdge], node_by_id: dict[str, AtlasNode]
) -> dict[str, dict[str, Any]]:
    (
        degree,
        ownership_degree,
        current_parent,
        current_parent_id,
        pending_change,
    ) = _ownership_signals(edges, node_by_id)
    evidence_counts, verified_at = _evidence_signals(edges)
    _apply_pending_change_overrides(edges, node_by_id, current_parent_id, pending_change)
    return {
        node_id: _format_node_signals(
            node_id,
            node_by_id,
            degree,
            ownership_degree,
            current_parent,
            pending_change,
            evidence_counts,
            verified_at,
        )
        for node_id in node_by_id
    }


def _evidence_signals(
    edges: list[AtlasEdge],
) -> tuple[Counter[str], dict[str, datetime]]:
    evidence_counts = Counter[str]()
    verified_at: dict[str, datetime] = {}
    for edge in edges:
        for entity_id in (edge.source_id, edge.target_id):
            evidence_counts[entity_id] += edge.evidence_count
            if edge.last_verified_at and (
                entity_id not in verified_at or edge.last_verified_at > verified_at[entity_id]
            ):
                verified_at[entity_id] = edge.last_verified_at
    return evidence_counts, verified_at


def _format_node_signals(
    node_id: str,
    node_by_id: dict[str, AtlasNode],
    degree: Counter[str],
    ownership_degree: Counter[str],
    current_parent: dict[str, str],
    pending_change: dict[str, str],
    evidence_counts: Counter[str],
    verified_at: dict[str, datetime],
) -> dict[str, Any]:
    evidence_count = evidence_counts[node_id]
    node = node_by_id[node_id]
    return {
        "connection_count": degree[node_id],
        "ownership_connection_count": ownership_degree[node_id],
        "current_parent": current_parent.get(node_id),
        "pending_change": pending_change.get(node_id),
        "evidence_coverage": (
            f"{evidence_count} cited observations" if evidence_count else "not researched"
        ),
        "freshness": verified_at[node_id].isoformat() if node_id in verified_at else "unknown",
        "unresolved_gap": (
            "chain incomplete"
            if node.entity_type == "outlet" and node_id not in current_parent
            else None
        ),
    }


def _rank_nodes(
    nodes: list[AtlasNode], edges: list[AtlasEdge], selected: str | None
) -> list[AtlasNode]:
    node_by_id = {node.id: node for node in nodes}
    signals = _node_signals(edges, node_by_id)
    ranked = [
        node.model_copy(
            update={
                "connection_count": signals[node.id]["connection_count"],
                "ownership_connection_count": signals[node.id]["ownership_connection_count"],
                "current_parent": signals[node.id]["current_parent"],
                "pending_change": signals[node.id]["pending_change"],
                "evidence_coverage": signals[node.id]["evidence_coverage"],
                "freshness": signals[node.id]["freshness"],
                "unresolved_gap": signals[node.id]["unresolved_gap"],
            }
        )
        for node in nodes
    ]
    type_priority: dict[AtlasEntityType, int] = {
        "organization": 0,
        "outlet": 1,
        "person": 2,
        "reporter": 3,
    }
    ranked.sort(
        key=lambda node: (
            0 if node.id == selected else 1,
            -node.connection_count,
            -node.article_count,
            type_priority[node.entity_type],
            node.label.casefold(),
        )
    )
    return ranked


def _graph_version(nodes: list[AtlasNode], edges: list[AtlasEdge]) -> str:
    payload = {
        "nodes": sorted(
            (node.id, node.updated_at.isoformat() if node.updated_at else "") for node in nodes
        ),
        "edges": sorted(
            (
                edge.id,
                edge.fact_status,
                edge.last_verified_at.isoformat() if edge.last_verified_at else "",
                edge.recorded_at.isoformat() if edge.recorded_at else "",
                edge.retracted_at.isoformat() if edge.retracted_at else "",
            )
            for edge in edges
        ),
    }
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode("utf-8")).hexdigest()[
        :20
    ]


async def _merged_graph(
    db: AsyncSession, filters: AtlasGraphFilters
) -> tuple[list[AtlasNode], list[AtlasEdge]]:
    (
        legacy_nodes,
        legacy_edges,
        _index_counts,
        _last_indexed,
        _indexing,
    ) = await _load_graph_projection(db, filters)
    evidence_nodes, evidence_edges = await load_evidence_atlas_projection(db, filters)
    return legacy_nodes + evidence_nodes, _dedupe_edges([*legacy_edges, *evidence_edges])


def _filter_graph(
    nodes: list[AtlasNode], edges: list[AtlasEdge], filters: AtlasGraphFilters
) -> tuple[list[AtlasNode], list[AtlasEdge]]:
    node_match_filters = filters.model_copy(update={"q": None}) if filters.selected else filters
    node_filtered = [node for node in nodes if _node_matches(node, node_match_filters)]
    allowed_node_ids = {node.id for node in node_filtered}
    edge_filtered = [
        edge
        for edge in edges
        if _edge_matches(edge, filters)
        and edge.source_id in allowed_node_ids
        and edge.target_id in allowed_node_ids
    ]
    return _apply_neighborhood(
        node_filtered, edge_filtered, filters.selected, min(max(filters.neighbors, 0), 2)
    )


def _edge_priority(edge: AtlasEdge) -> tuple[int, float, int, int, str]:
    return (
        -(1 if edge.accepted_fact else 0),
        -(edge.confidence or 0.0),
        -edge.evidence_root_count,
        -edge.evidence_count,
        edge.id,
    )


def _truncate_graph(
    nodes: list[AtlasNode], edges: list[AtlasEdge], filters: AtlasGraphFilters
) -> tuple[list[AtlasNode], list[AtlasEdge], bool, list[str]]:
    ranked_nodes = _rank_nodes(nodes, edges, filters.selected)
    truncated = False
    reasons: list[str] = []
    if filters.limit_nodes is not None and len(ranked_nodes) > filters.limit_nodes:
        truncated = True
        reasons.append("node_limit")
        ranked_nodes = ranked_nodes[: filters.limit_nodes]
    visible_ids = {node.id for node in ranked_nodes}
    visible_edges = [
        edge for edge in edges if edge.source_id in visible_ids and edge.target_id in visible_ids
    ]
    if len(visible_edges) > filters.limit_edges:
        truncated = True
        reasons.append("edge_limit")
        visible_edges = sorted(visible_edges, key=_edge_priority)[: filters.limit_edges]
    return ranked_nodes, visible_edges, truncated, reasons


def _count_by_entity_type(nodes: list[AtlasNode]) -> Counter[str]:
    return Counter(node.entity_type for node in nodes)


def _owned_outlet_ids(
    edges: list[AtlasEdge], outlet_node_ids: set[str], accepted_only: bool
) -> set[str]:
    return {
        edge.target_id
        for edge in edges
        if edge.target_id in outlet_node_ids
        and edge.valid_to is None
        and edge.retracted_at is None
        and (edge.accepted_fact or not accepted_only)
    }


def _relationship_counts(edges: list[AtlasEdge]) -> tuple[int, int, int, int]:
    current = 0
    accepted = 0
    candidates = 0
    disputed = 0
    for edge in edges:
        if edge.valid_to is None and edge.retracted_at is None:
            current += 1
        if edge.accepted_fact:
            accepted += 1
        if edge.fact_status == "candidate":
            candidates += 1
        if edge.fact_status == "disputed":
            disputed += 1
    return current, accepted, candidates, disputed


def _graph_stats(
    all_nodes: list[AtlasNode],
    all_edges: list[AtlasEdge],
    visible_edges: list[AtlasEdge],
    ranked_nodes: list[AtlasNode],
    filters: AtlasGraphFilters,
) -> AtlasGraphStats:
    outlet_nodes = [node for node in all_nodes if node.entity_type == "outlet"]
    outlet_node_ids = {node.id for node in outlet_nodes}
    type_counts = _count_by_entity_type(all_nodes)
    visible_type_counts = _count_by_entity_type(ranked_nodes)
    outlets_with_owner = _owned_outlet_ids(all_edges, outlet_node_ids, filters.accepted_only)
    evidence_count = sum(edge.evidence_count > 0 for edge in visible_edges)
    current, accepted, candidates, disputed = _relationship_counts(all_edges)
    return AtlasGraphStats(
        total_outlets=len(outlet_nodes),
        total_organizations=type_counts["organization"],
        total_people=type_counts["person"],
        total_reporters=type_counts["reporter"],
        visible_outlets=visible_type_counts["outlet"],
        visible_organizations=visible_type_counts["organization"],
        visible_people=visible_type_counts["person"],
        visible_reporters=visible_type_counts["reporter"],
        visible_relationships=len(visible_edges),
        current_relationships=current,
        accepted_relationships=accepted,
        candidate_relationships=candidates,
        disputed_relationships=disputed,
        ownership_coverage=AtlasCoverageMetric(
            numerator=len(outlets_with_owner), denominator=len(outlet_nodes)
        ),
        evidence_coverage=AtlasCoverageMetric(
            numerator=evidence_count, denominator=len(visible_edges)
        ),
        unresolved_source_links=len(outlet_nodes) - len(outlets_with_owner),
    )


async def build_atlas_graph(db: AsyncSession, filters: AtlasGraphFilters) -> AtlasGraphResponse:
    """Merge the outlet/reporter and organization/person/ownership projections."""
    generated_at = datetime.now(UTC)
    all_nodes, all_edges = await _merged_graph(db, filters)
    filtered_nodes, filtered_edges = _filter_graph(all_nodes, all_edges, filters)
    ranked_nodes, visible_edges, truncated, reasons = _truncate_graph(
        filtered_nodes, filtered_edges, filters
    )
    stats = _graph_stats(all_nodes, all_edges, visible_edges, ranked_nodes, filters)
    return AtlasGraphResponse(
        graph_version=_graph_version(all_nodes, all_edges),
        generated_at=generated_at,
        nodes=ranked_nodes,
        edges=visible_edges,
        stats=stats,
        applied_filters=filters,
        truncated=truncated,
        truncation_reason=",".join(reasons) if reasons else None,
        next_expansion_token=filters.selected if truncated and filters.selected else None,
    )


def _index_status_summary(
    index_rows: list[WikiIndexStatus],
) -> tuple[Counter[str], datetime | None, bool]:
    index_counts = Counter(cast(str, row.status) for row in index_rows)
    last_indexed_at = max(
        (row.last_indexed_at for row in index_rows if row.last_indexed_at), default=None
    )
    indexing_active = any(cast(str, row.status) == "indexing" for row in index_rows)
    return index_counts, last_indexed_at, indexing_active


def _research_coverage(
    graph: AtlasGraphResponse,
) -> tuple[AtlasCoverageMetric, dict[str, AtlasCoverageMetric]]:
    researched_nodes = [node for node in graph.nodes if node.evidence_coverage != "not researched"]
    research_coverage = AtlasCoverageMetric(
        numerator=len(researched_nodes), denominator=len(graph.nodes)
    )
    totals_by_type = Counter(node.entity_type for node in graph.nodes)
    researched_by_type = Counter(node.entity_type for node in researched_nodes)
    coverage_by_entity_type = {
        entity_type: AtlasCoverageMetric(
            numerator=researched_by_type.get(entity_type, 0), denominator=total
        )
        for entity_type, total in totals_by_type.items()
    }
    return research_coverage, coverage_by_entity_type


async def build_atlas_stats(db: AsyncSession) -> AtlasStatsResponse:
    """Return aggregate Atlas graph statistics without node/edge payloads."""
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization", "person", "reporter"],
            limit_nodes=None,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )
    relation_counts = Counter(edge.relation_type for edge in graph.edges)
    index_rows = list((await db.execute(select(WikiIndexStatus))).scalars().all())
    index_counts, last_indexed_at, indexing_active = _index_status_summary(index_rows)
    research_coverage, coverage_by_entity_type = _research_coverage(graph)
    return AtlasStatsResponse(
        graph_version=graph.graph_version,
        generated_at=graph.generated_at,
        stats=graph.stats,
        by_entity_type={
            "outlet": graph.stats.total_outlets,
            "organization": graph.stats.total_organizations,
            "person": graph.stats.total_people,
            "reporter": graph.stats.total_reporters,
        },
        by_relation_type={str(key): value for key, value in relation_counts.items()},
        by_index_status=dict(index_counts),
        last_indexed_at=last_indexed_at,
        indexing_active=indexing_active,
        research_coverage=research_coverage,
        research_coverage_by_entity_type=coverage_by_entity_type,
    )


def canonical_relation_type(value: str) -> AtlasRelationType | None:
    """Map a raw predicate/relation string to its canonical Atlas relation type."""
    return _RELATION_GROUPS.get(value)


# --- Stats cache ---------------------------------------------------------
#
# `build_atlas_stats` walks the full, unbounded graph projection (every
# outlet/organization/person/reporter -- ~11.7k entities incl. ~11.4k
# reporters) on every call. The UI's status strip polls `/api/wiki/atlas/stats`
# repeatedly, so without a cache each poll re-runs that full scan. A short
# TTL cache avoids that; it's invalidated eagerly whenever auto-ingest
# finishes a run (see `app.services.auto_ingest.run_auto_ingest`), so the
# cache never serves stats older than the newest ingested data by more than
# one in-flight request.
_STATS_CACHE_TTL_SECONDS = 300.0
_stats_cache_lock = asyncio.Lock()
_stats_cache_value: AtlasStatsResponse | None = None
_stats_cache_expires_at: float = 0.0


def invalidate_atlas_stats_cache() -> None:
    """Drop the cached stats response so the next request recomputes it."""
    global _stats_cache_value, _stats_cache_expires_at
    _stats_cache_value = None
    _stats_cache_expires_at = 0.0


async def get_atlas_stats_cached(db: AsyncSession) -> AtlasStatsResponse:
    """Return `build_atlas_stats`, cached for `_STATS_CACHE_TTL_SECONDS`.

    Uses a module-level cache guarded by an `asyncio.Lock` so concurrent
    pollers awaiting a cold cache share one computation instead of each
    triggering their own full graph rebuild.
    """
    global _stats_cache_value, _stats_cache_expires_at

    now = time.monotonic()
    if _stats_cache_value is not None and now < _stats_cache_expires_at:
        return _stats_cache_value

    async with _stats_cache_lock:
        # Re-check after acquiring the lock: another request may have
        # already refreshed the cache while we were waiting.
        now = time.monotonic()
        if _stats_cache_value is not None and now < _stats_cache_expires_at:
            return _stats_cache_value

        result = await build_atlas_stats(db)
        _stats_cache_value = result
        _stats_cache_expires_at = time.monotonic() + _STATS_CACHE_TTL_SECONDS
        return result
