"""Bounded graph queries and statistics for the Intelligence Atlas."""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict, deque
from datetime import UTC, datetime
from typing import cast

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
from app.services.atlas_graph_helpers import (
    _RELATION_GROUPS,
    _edge_matches,
    _node_matches,
)
from app.services.atlas_graph_projection import _load_graph_projection


def _apply_neighborhood(
    nodes: list[AtlasNode],
    edges: list[AtlasEdge],
    selected: str | None,
    neighbors: int,
) -> tuple[list[AtlasNode], list[AtlasEdge]]:
    if not selected or neighbors <= 0:
        return nodes, edges
    node_ids = {node.id for node in nodes}
    if selected not in node_ids:
        return nodes, edges
    adjacency: dict[str, set[str]] = defaultdict(set)
    for edge in edges:
        adjacency[edge.source_id].add(edge.target_id)
        adjacency[edge.target_id].add(edge.source_id)
    visible = {selected}
    queue: deque[tuple[str, int]] = deque([(selected, 0)])
    while queue:
        node_id, depth = queue.popleft()
        if depth >= neighbors:
            continue
        for related in adjacency.get(node_id, set()):
            if related in visible:
                continue
            visible.add(related)
            queue.append((related, depth + 1))
    return (
        [node for node in nodes if node.id in visible],
        [
            edge
            for edge in edges
            if edge.source_id in visible and edge.target_id in visible
        ],
    )


def _rank_nodes(
    nodes: list[AtlasNode], edges: list[AtlasEdge], selected: str | None
) -> list[AtlasNode]:
    degree = Counter[str]()
    ownership_degree = Counter[str]()
    for edge in edges:
        degree[edge.source_id] += 1
        degree[edge.target_id] += 1
        if edge.relation_type in {"ownership", "owned_by", "parent_org"}:
            ownership_degree[edge.source_id] += 1
            ownership_degree[edge.target_id] += 1
    ranked: list[AtlasNode] = []
    for node in nodes:
        ranked.append(
            node.model_copy(
                update={
                    "connection_count": degree[node.id],
                    "ownership_connection_count": ownership_degree[node.id],
                }
            )
        )
    type_priority: dict[AtlasEntityType, int] = {
        "organization": 0,
        "source": 1,
        "reporter": 2,
    }
    ranked.sort(
        key=lambda node: (
            0 if node.id == selected else 1,
            type_priority[node.entity_type],
            -node.connection_count,
            -node.article_count,
            node.label.casefold(),
        )
    )
    return ranked


def _graph_version(nodes: list[AtlasNode], edges: list[AtlasEdge]) -> str:
    payload = {
        "nodes": sorted(
            (node.id, node.updated_at.isoformat() if node.updated_at else "")
            for node in nodes
        ),
        "edges": sorted(
            (
                edge.id,
                edge.last_verified_at.isoformat() if edge.last_verified_at else "",
            )
            for edge in edges
        ),
    }
    digest = hashlib.sha256(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return digest[:20]


async def build_atlas_graph(
    db: AsyncSession, filters: AtlasGraphFilters
) -> AtlasGraphResponse:
    generated_at = datetime.now(UTC)
    (
        all_nodes,
        all_edges,
        unresolved,
        _index_counts,
        _last_indexed,
        _indexing,
    ) = await _load_graph_projection(db, filters)

    # A committed selection is a neighborhood lookup, not a label-only search.
    # Preserve q in the response contract/URL while allowing connected entities
    # that do not repeat the query text to remain visible.
    node_match_filters = (
        filters.model_copy(update={"q": None}) if filters.selected else filters
    )
    node_filtered = [
        node for node in all_nodes if _node_matches(node, node_match_filters)
    ]
    allowed_node_ids = {node.id for node in node_filtered}
    edge_filtered = [
        edge
        for edge in all_edges
        if _edge_matches(edge, filters)
        and edge.source_id in allowed_node_ids
        and edge.target_id in allowed_node_ids
    ]

    node_filtered, edge_filtered = _apply_neighborhood(
        node_filtered,
        edge_filtered,
        filters.selected,
        min(max(filters.neighbors, 0), 2),
    )
    ranked_nodes = _rank_nodes(node_filtered, edge_filtered, filters.selected)

    truncated = False
    reasons: list[str] = []
    if len(ranked_nodes) > filters.limit_nodes:
        truncated = True
        reasons.append("node_limit")
        ranked_nodes = ranked_nodes[: filters.limit_nodes]
    visible_ids = {node.id for node in ranked_nodes}
    edge_filtered = [
        edge
        for edge in edge_filtered
        if edge.source_id in visible_ids and edge.target_id in visible_ids
    ]
    if len(edge_filtered) > filters.limit_edges:
        truncated = True
        reasons.append("edge_limit")
        edge_filtered = sorted(
            edge_filtered,
            key=lambda edge: (-(edge.confidence or 0.0), -edge.evidence_count, edge.id),
        )[: filters.limit_edges]

    evidence_edges = sum(1 for edge in edge_filtered if edge.evidence_count > 0)
    ownership_edges = [
        edge
        for edge in all_edges
        if edge.relation_type in {"ownership", "owned_by", "parent_org"}
    ]
    source_nodes = [node for node in all_nodes if node.entity_type == "source"]
    sources_with_owner = {
        edge.target_id
        for edge in ownership_edges
        if edge.target_id.startswith("source:") and edge.valid_to is None
    }

    stats = AtlasGraphStats(
        total_sources=len(source_nodes),
        total_organizations=sum(
            node.entity_type == "organization" for node in all_nodes
        ),
        total_reporters=sum(node.entity_type == "reporter" for node in all_nodes),
        visible_sources=sum(node.entity_type == "source" for node in ranked_nodes),
        visible_organizations=sum(
            node.entity_type == "organization" for node in ranked_nodes
        ),
        visible_reporters=sum(node.entity_type == "reporter" for node in ranked_nodes),
        visible_relationships=len(edge_filtered),
        current_relationships=sum(edge.valid_to is None for edge in all_edges),
        ownership_coverage=AtlasCoverageMetric(
            numerator=len(sources_with_owner), denominator=len(source_nodes)
        ),
        evidence_coverage=AtlasCoverageMetric(
            numerator=evidence_edges, denominator=len(edge_filtered)
        ),
        unresolved_source_links=unresolved,
    )

    return AtlasGraphResponse(
        graph_version=_graph_version(all_nodes, all_edges),
        generated_at=generated_at,
        nodes=ranked_nodes,
        edges=edge_filtered,
        stats=stats,
        applied_filters=filters,
        truncated=truncated,
        truncation_reason=",".join(reasons) if reasons else None,
        next_expansion_token=(
            filters.selected if truncated and filters.selected else None
        ),
    )


async def build_atlas_stats(db: AsyncSession) -> AtlasStatsResponse:
    filters = AtlasGraphFilters(
        entity_types=["source", "organization", "reporter"],
        limit_nodes=600,
        limit_edges=2500,
        include_evidence_preview=False,
    )
    graph = await build_atlas_graph(db, filters)
    relation_counts = Counter(edge.relation_type for edge in graph.edges)
    index_rows = list((await db.execute(select(WikiIndexStatus))).scalars().all())
    index_counts = Counter(cast(str, row.status) for row in index_rows)
    last_indexed_at = max(
        (
            cast(datetime, row.last_indexed_at)
            for row in index_rows
            if row.last_indexed_at
        ),
        default=None,
    )
    return AtlasStatsResponse(
        graph_version=graph.graph_version,
        generated_at=graph.generated_at,
        stats=graph.stats,
        by_entity_type={
            "source": graph.stats.total_sources,
            "organization": graph.stats.total_organizations,
            "reporter": graph.stats.total_reporters,
        },
        by_relation_type=dict(relation_counts),
        by_index_status=dict(index_counts),
        last_indexed_at=last_indexed_at,
        indexing_active=any(cast(str, row.status) == "indexing" for row in index_rows),
    )


def canonical_relation_type(value: str) -> AtlasRelationType | None:
    return _RELATION_GROUPS.get(value)
