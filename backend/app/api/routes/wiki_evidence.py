"""Evidence-spine, bitemporal relationship, and proof-bundle API."""

from __future__ import annotations

import os
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.evidence_api import (
    AcceptanceEvaluationRequest,
    AcceptanceEvaluationResponse,
    AcceptedRelationshipRecord,
    EvidenceClaimRecord,
    EvidencePolicyRecord,
    RelationshipQueryResponse,
)
from app.services.evidence_export import ProofBundleError, build_relationship_proof_bundle
from app.services.evidence_policy import serialize_policies
from app.services.evidence_spine import (
    EvidenceSpineError,
    evaluate_claim_by_id,
    get_claim_record,
    list_relationships,
    materialize_claim,
)

router = APIRouter(prefix="/api/wiki/evidence", tags=["wiki-evidence"])


def _utc_naive(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC).replace(tzinfo=None)
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


@router.get("/policies", response_model=list[EvidencePolicyRecord])
async def get_evidence_policies() -> list[EvidencePolicyRecord]:
    return [EvidencePolicyRecord.model_validate(item) for item in serialize_policies()]


@router.get("/claims/{claim_id}", response_model=EvidenceClaimRecord)
async def get_evidence_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
) -> EvidenceClaimRecord:
    record = await get_claim_record(db, claim_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Evidence claim not found")
    return record


@router.post("/claims/evaluate", response_model=AcceptanceEvaluationResponse)
async def evaluate_evidence_claim(
    request: AcceptanceEvaluationRequest,
    db: AsyncSession = Depends(get_db),
) -> AcceptanceEvaluationResponse:
    try:
        return await evaluate_claim_by_id(
            db,
            request.claim_id,
            complete_control_path=request.complete_control_path,
        )
    except EvidenceSpineError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/claims/{claim_id}/materialize", response_model=AcceptedRelationshipRecord)
async def materialize_evidence_claim(
    claim_id: str,
    complete_control_path: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> AcceptedRelationshipRecord:
    try:
        relationship = await materialize_claim(
            db,
            claim_id,
            complete_control_path=complete_control_path,
        )
        await db.flush()
        query = await list_relationships(
            db,
            as_of=datetime.now(UTC).replace(tzinfo=None),
            known_at=datetime.now(UTC).replace(tzinfo=None),
            entity_id=str(relationship.subject_entity_id),
        )
        for record in query.relationships:
            if record.id == relationship.id:
                return record
        raise EvidenceSpineError("materialized relationship could not be reloaded")
    except EvidenceSpineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/relationships", response_model=RelationshipQueryResponse)
async def get_evidence_relationships(
    db: AsyncSession = Depends(get_db),
    as_of: datetime | None = Query(None),
    known_at: datetime | None = Query(None),
    predicates: str | None = Query(None, max_length=500),
    entity_id: str | None = Query(None, max_length=128),
) -> RelationshipQueryResponse:
    predicate_values = [item.strip() for item in (predicates or "").split(",") if item.strip()]
    return await list_relationships(
        db,
        as_of=_utc_naive(as_of),
        known_at=_utc_naive(known_at),
        predicates=predicate_values,
        entity_id=entity_id,
    )


@router.get("/relationships/{relationship_id}/proof")
async def download_relationship_proof(
    relationship_id: str,
    db: AsyncSession = Depends(get_db),
    as_of: datetime | None = Query(None),
    known_at: datetime | None = Query(None),
    dataset_snapshot: str = Query("working-tree", max_length=128),
) -> Response:
    try:
        content = await build_relationship_proof_bundle(
            db,
            relationship_id,
            as_of=_utc_naive(as_of),
            known_at=_utc_naive(known_at),
            commit_sha=os.getenv("SCOOP_COMMIT_SHA", "unknown"),
            dataset_snapshot=dataset_snapshot,
        )
    except ProofBundleError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="scoop-proof-{relationship_id}.zip"'},
    )
