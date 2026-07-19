"""Stable JSON and CSV export builders for Atlas investigations."""

from __future__ import annotations

import csv
import io
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.atlas import AtlasExportRequest
from app.services.atlas_graph import build_atlas_graph


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

    if request.format == "json":
        evidence_by_id = {
            evidence_ref.id: evidence_ref.model_dump(mode="json")
            for edge in graph.edges
            for evidence_ref in edge.evidence_preview
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
        import json

        return (
            "atlas-investigation.json",
            "application/json",
            json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8"),
        )

    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    if request.format == "csv_nodes":
        writer.writerow(
            [
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
        )
        for node in graph.nodes:
            writer.writerow(
                [
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
            )
        filename = "atlas-entities.csv"
    elif request.format == "csv_relationships":
        writer.writerow(
            [
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
        )
        for edge in graph.edges:
            writer.writerow(
                [
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
            )
        filename = "atlas-relationships.csv"
    else:
        writer.writerow(
            [
                "id",
                "relationship_id",
                "source_type",
                "source_name",
                "source_url",
                "retrieved_at",
                "excerpt",
            ]
        )
        for edge in graph.edges:
            for evidence_ref in edge.evidence_preview:
                writer.writerow(
                    [
                        evidence_ref.id,
                        edge.id,
                        evidence_ref.source_type,
                        evidence_ref.source_name or "",
                        evidence_ref.source_url or "",
                        evidence_ref.retrieved_at.isoformat() if evidence_ref.retrieved_at else "",
                        evidence_ref.excerpt or "",
                    ]
                )
        filename = "atlas-evidence.csv"

    return filename, "text/csv; charset=utf-8", buffer.getvalue().encode("utf-8")
