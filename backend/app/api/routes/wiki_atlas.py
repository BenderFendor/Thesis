"""SCOOP Intelligence Atlas API routes."""

from __future__ import annotations
from datetime import datetime
from typing import Literal, cast
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.atlas import (
    AtlasConnectionRecord,
    AtlasEntityRecord,
    AtlasEntityType,
    AtlasExportRequest,
    AtlasGraphFilters,
    AtlasGraphResponse,
    AtlasIndexResponse,
    AtlasIngestStatusResponse,
    AtlasMeasurementRecord,
    AtlasMeasurementsResponse,
    AtlasRelationType,
    AtlasSearchResponse,
    AtlasStatsResponse,
    FundingBiasAnalysisResponse,
)
from app.services.atlas_entity import get_atlas_entity, list_atlas_index, search_atlas
from app.services.atlas_export import build_atlas_export
from app.services.atlas_graph import build_atlas_graph, get_atlas_stats_cached
from app.services.atlas_graph_helpers import normalize_entity_id_alias, normalize_entity_type_alias
from app.services.funding_bias_analysis import get_funding_bias_analysis_response
from app.services.auto_ingest import get_ingest_status
from app.services.media_measurements import calculate_media_measurements

router = APIRouter(prefix="/api/wiki/atlas", tags=["wiki-atlas"])
_ENTITY_TYPES = {"outlet", "organization", "person", "reporter"}
_RELATION_TYPES = {
    "ownership",
    "owned_by",
    "parent_org",
    "part_of",
    "publishes",
    "employed_by",
    "current_outlet",
    "coauthor",
    "shared_outlet",
    "founded_by",
    "sibling_via_owner",
}


def _split_csv(value: str | None) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()] if value else []


def _validated_entity_types(value: str | None) -> list[AtlasEntityType]:
    # Legacy alias: old clients/bookmarks may still send "source" for what is
    # now the "outlet" entity type -- accept it, normalize it, never emit it.
    values = [normalize_entity_type_alias(item) for item in _split_csv(value)]
    unsupported = sorted(set(values) - _ENTITY_TYPES)
    if unsupported:
        raise HTTPException(
            status_code=422, detail=f"Unsupported entity types: {', '.join(unsupported)}"
        )
    return cast(list[AtlasEntityType], values)


def _validated_relation_types(value: str | None) -> list[AtlasRelationType]:
    values = _split_csv(value)
    unsupported = sorted(set(values) - _RELATION_TYPES)
    if unsupported:
        raise HTTPException(
            status_code=422, detail=f"Unsupported relation types: {', '.join(unsupported)}"
        )
    return cast(list[AtlasRelationType], values)


@router.get("/graph", response_model=AtlasGraphResponse)
async def get_atlas_graph(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, max_length=200),
    entity_types: str | None = Query(None),
    relation_types: str | None = Query(None),
    country: str | None = Query(None),
    funding: str | None = Query(None),
    bias: str | None = Query(None),
    min_confidence: float = Query(0.0, ge=0.0, le=1.0),
    selected: str | None = Query(None, max_length=160),
    neighbors: int = Query(0, ge=0, le=2),
    limit_nodes: int = Query(350, ge=1, le=600),
    limit_edges: int = Query(1500, ge=1, le=2500),
    layout: Literal["clustered", "ownership", "geography", "radial"] = Query("clustered"),
    include_evidence_preview: bool = Query(True),
    as_of: datetime | None = Query(None),
    known_at: datetime | None = Query(None),
    accepted_only: bool = Query(False),
) -> AtlasGraphResponse:
    """Return the filtered Atlas graph (nodes, edges, stats) for the given view."""
    return await build_atlas_graph(
        db,
        AtlasGraphFilters(
            q=q,
            entity_types=_validated_entity_types(entity_types),
            relation_types=_validated_relation_types(relation_types),
            country=_split_csv(country),
            funding=_split_csv(funding),
            bias=_split_csv(bias),
            min_confidence=min_confidence,
            selected=normalize_entity_id_alias(selected) if selected else selected,
            neighbors=neighbors,
            limit_nodes=limit_nodes,
            limit_edges=limit_edges,
            layout=layout,
            include_evidence_preview=include_evidence_preview,
            as_of=as_of,
            known_at=known_at,
            accepted_only=accepted_only,
        ),
    )


@router.get("/stats", response_model=AtlasStatsResponse)
async def get_atlas_stats(db: AsyncSession = Depends(get_db)) -> AtlasStatsResponse:
    """Return aggregate Atlas graph statistics without node/edge payloads."""
    return await get_atlas_stats_cached(db)


@router.get("/ingestion-status", response_model=AtlasIngestStatusResponse)
async def get_atlas_ingestion_status(
    db: AsyncSession = Depends(get_db), limit: int = Query(40, ge=1, le=200)
) -> AtlasIngestStatusResponse:
    """Return adapter freshness, partial runs, credentials, and retryable failures."""
    return await get_ingest_status(db, limit=limit)


@router.get("/search", response_model=AtlasSearchResponse)
async def search_atlas_entities(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(8, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> AtlasSearchResponse:
    """Search Atlas entities by label, grouped by entity type."""
    return await search_atlas(db, q, limit=limit)


@router.get("/entities/{entity_id}", response_model=AtlasEntityRecord)
async def get_atlas_entity_record(
    entity_id: str, db: AsyncSession = Depends(get_db)
) -> AtlasEntityRecord:
    """Return the full inspector record for one Atlas entity."""
    record = await get_atlas_entity(db, entity_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Atlas entity not found")
    return record


@router.get("/entities/{entity_id}/connections", response_model=list[AtlasConnectionRecord])
async def get_atlas_entity_connections(
    entity_id: str, db: AsyncSession = Depends(get_db)
) -> list[AtlasConnectionRecord]:
    """Return the neighboring entities and edges connected to this entity."""
    record = await get_atlas_entity(db, entity_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Atlas entity not found")
    return record.connections


@router.get("/index", response_model=AtlasIndexResponse)
async def get_atlas_index(
    db: AsyncSession = Depends(get_db),
    entity_types: str | None = Query(None),
    q: str | None = Query(None, max_length=200),
    country: str | None = Query(None),
    funding: str | None = Query(None),
    bias: str | None = Query(None),
    kind: str | None = Query(None),
    sort: Literal[
        "name", "most_connected", "most_articles", "recently_indexed", "lowest_confidence"
    ] = Query("name"),
    cursor: str | None = Query(None, max_length=100),
    limit: int = Query(60, ge=1, le=100),
) -> AtlasIndexResponse:
    """Return a paginated, faceted listing of Atlas entities."""
    return await list_atlas_index(
        db,
        entity_types=_validated_entity_types(entity_types),
        query=q,
        country=_split_csv(country),
        funding=_split_csv(funding),
        bias=_split_csv(bias),
        kind=_split_csv(kind),
        sort=sort,
        cursor=cursor,
        limit=limit,
    )


@router.get("/analysis/funding-bias", response_model=FundingBiasAnalysisResponse)
async def get_funding_bias_analysis(
    db: AsyncSession = Depends(get_db),
) -> FundingBiasAnalysisResponse:
    """Return the latest pre-registered funding-vs-bias correlation trace.

    Read-only -- `available=False` (not a 404/500) when
    `app.scripts.run_funding_bias_analysis` has never run against this
    database.
    """
    return await get_funding_bias_analysis_response(db)


@router.get("/analysis/media-measurements", response_model=AtlasMeasurementsResponse)
async def get_media_measurements(
    db: AsyncSession = Depends(get_db),
    source_name: str | None = Query(None, max_length=200),
) -> AtlasMeasurementsResponse:
    """Calculate and return reproducible article and ownership measurements."""
    traces = await calculate_media_measurements(db, source_name=source_name)
    await db.commit()
    return AtlasMeasurementsResponse(
        source_name=source_name,
        measurements=[
            AtlasMeasurementRecord.model_validate(trace, from_attributes=True) for trace in traces
        ],
    )


@router.post("/export")
async def export_atlas(request: AtlasExportRequest, db: AsyncSession = Depends(get_db)) -> Response:
    """Export the requested Atlas slice as JSON or CSV."""
    filename, content_type, content = await build_atlas_export(db, request)
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
