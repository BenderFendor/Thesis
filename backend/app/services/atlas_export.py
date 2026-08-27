"""Stable JSON and CSV export builders for Atlas investigations."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.atlas import AtlasExportRequest
from app.services.atlas_graph import build_atlas_graph


def _json_export(graph: Any, request: AtlasExportRequest) -> tuple[str, str, bytes]:
    evidence_by_id = {
        evidence.id: evidence.model_dump(mode="json")
        for edge in graph.edges
        for evidence in edge.evidence_preview
    }
    payload: dict[str, Any] = {
        "schema_version": "1.0",
        "generated_at": graph.generated_at.isoformat(),
        "graph_version": graph.graph_version,
        "filters": graph.applied_filters.model_dump(mode="json"),
        "selected_entity": request.selected_entity,
        "nodes": [node.model_dump(mode="json") for node in graph.nodes],
        "relationships": [edge.model_dump(mode="json") for edge in graph.edges],
        "evidence": list(evidence_by_id.values()),
        "layout_positions": request.visible_layout_positions or {},
        "truncated": graph.truncated,
        "truncation_reason": graph.truncation_reason,
    }
    return (
        "atlas-investigation.json",
        "application/json",
        json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8"),
    )


def _csv_bytes(header: list[str], rows: Iterable[list[Any]]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def _node_row(node: Any) -> list[Any]:
    return [
        node.id,
        node.entity_type,
        node.label,
        node.subtitle or "",
        node.country_code or "",
        node.funding_type or "",
        node.bias_rating or "",
        node.article_count,
        node.connection_count,
        node.status or "",
        node.confidence_tier or "",
        node.updated_at.isoformat() if node.updated_at else "",
    ]


def _nodes_export(graph: Any) -> tuple[str, str, bytes]:
    header = [
        "id",
        "entity_type",
        "label",
        "subtitle",
        "country_code",
        "funding_type",
        "bias_rating",
        "article_count",
        "connection_count",
        "status",
        "confidence_tier",
        "updated_at",
    ]
    return "atlas-entities.csv", "text/csv; charset=utf-8", _csv_bytes(
        header, (_node_row(node) for node in graph.nodes)
    )


def _relationship_row(edge: Any) -> list[Any]:
    return [
        edge.id,
        edge.source_id,
        edge.target_id,
        edge.relation_type,
        edge.raw_relation_type or "",
        edge.confidence if edge.confidence is not None else "",
        edge.confidence_tier or "",
        edge.evidence_count,
        edge.ownership_percentage if edge.ownership_percentage is not None else "",
        edge.valid_from.isoformat() if edge.valid_from else "",
        edge.valid_to.isoformat() if edge.valid_to else "",
        edge.last_verified_at.isoformat() if edge.last_verified_at else "",
        edge.is_inferred,
    ]


def _relationships_export(graph: Any) -> tuple[str, str, bytes]:
    header = [
        "id",
        "source_id",
        "target_id",
        "relation_type",
        "raw_relation_type",
        "confidence",
        "confidence_tier",
        "evidence_count",
        "ownership_percentage",
        "valid_from",
        "valid_to",
        "last_verified_at",
        "is_inferred",
    ]
    return "atlas-relationships.csv", "text/csv; charset=utf-8", _csv_bytes(
        header, (_relationship_row(edge) for edge in graph.edges)
    )


def _evidence_rows(graph: Any) -> Iterable[list[Any]]:
    for edge in graph.edges:
        for evidence in edge.evidence_preview:
            yield [
                evidence.id,
                edge.id,
                evidence.source_type,
                evidence.source_name or "",
                evidence.source_url or "",
                evidence.retrieved_at.isoformat() if evidence.retrieved_at else "",
                evidence.excerpt or "",
            ]


def _evidence_export(graph: Any) -> tuple[str, str, bytes]:
    header = [
        "id",
        "relationship_id",
        "source_type",
        "source_name",
        "source_url",
        "retrieved_at",
        "excerpt",
    ]
    return "atlas-evidence.csv", "text/csv; charset=utf-8", _csv_bytes(
        header, _evidence_rows(graph)
    )


def _export_for_format(graph: Any, request: AtlasExportRequest) -> tuple[str, str, bytes]:
    exporters = {
        "json": lambda: _json_export(graph, request),
        "csv_nodes": lambda: _nodes_export(graph),
        "csv_relationships": lambda: _relationships_export(graph),
    }
    exporter = exporters.get(request.format, lambda: _evidence_export(graph))
    return exporter()


async def build_atlas_export(
    db: AsyncSession, request: AtlasExportRequest
) -> tuple[str, str, bytes]:
    """Build a stable JSON or CSV export for an Atlas investigation."""
    filters = request.filters.model_copy(
        update={
            "selected": request.selected_entity or request.filters.selected,
            "include_evidence_preview": request.include_evidence,
        }
    )
    graph = await build_atlas_graph(db, filters)
    return _export_for_format(graph, request)
