"""Load evidence chains and package standards-compliant proof bundles."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypedDict, Unpack, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evidence import (
    AcceptedRelationship,
    CalculationTrace,
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
    RelationshipClaim,
)
from app.services.evidence_export_formats import (
    BundleBuildOptions,
    ProofBundleError,
    build_bundle_files,
    validate_bods_shape as validate_bods_shape,
    zip_bundle,
)


class RelationshipProofOptions(TypedDict):
    """Keyword options for relationship proof-bundle generation."""

    as_of: datetime
    known_at: datetime
    commit_sha: str
    dataset_snapshot: str


@dataclass(slots=True)
class _EvidenceChainRows:
    relationship: AcceptedRelationship
    subject: EvidenceEntity
    object_entity: EvidenceEntity
    claims: list[EvidenceClaim]
    evidence_links: list[ClaimEvidence]
    observations: list[EvidenceObservation]
    snapshots: list[DocumentSnapshot]
    documents: list[EvidenceDocument]
    calculation_traces: list[CalculationTrace]


async def _load_by_ids(
    db: AsyncSession,
    model: Any,
    column: Any,
    ids: list[str],
) -> list[Any]:
    if not ids:
        return []
    result = await db.execute(select(model).where(column.in_(ids)))
    return list(result.scalars().all())


async def _relationship_context(
    db: AsyncSession,
    relationship_id: str,
) -> tuple[AcceptedRelationship, EvidenceEntity, EvidenceEntity]:
    relationship = await db.get(AcceptedRelationship, relationship_id)
    if relationship is None:
        raise ProofBundleError("relationship not found")
    subject = await db.get(EvidenceEntity, relationship.subject_entity_id)
    object_entity = await db.get(EvidenceEntity, relationship.object_entity_id)
    if subject is None or object_entity is None:
        raise ProofBundleError("relationship endpoints do not resolve")
    return relationship, subject, object_entity


async def _load_evidence_chain(
    db: AsyncSession,
    relationship_id: str,
) -> _EvidenceChainRows:
    relationship, subject, object_entity = await _relationship_context(db, relationship_id)
    result = await db.execute(
        select(RelationshipClaim).where(RelationshipClaim.relationship_id == relationship_id)
    )
    relationship_links = list(result.scalars().all())
    claim_ids = [cast(str, link.claim_id) for link in relationship_links]
    claims = await _load_by_ids(db, EvidenceClaim, EvidenceClaim.id, claim_ids)
    evidence_links = await _load_by_ids(db, ClaimEvidence, ClaimEvidence.claim_id, claim_ids)
    observation_ids = [cast(str, link.observation_id) for link in evidence_links]
    observations = await _load_by_ids(
        db,
        EvidenceObservation,
        EvidenceObservation.id,
        observation_ids,
    )
    snapshot_ids = [cast(str, row.snapshot_id) for row in observations]
    snapshots = await _load_by_ids(db, DocumentSnapshot, DocumentSnapshot.id, snapshot_ids)
    document_ids = [cast(str, row.document_id) for row in snapshots]
    documents = await _load_by_ids(db, EvidenceDocument, EvidenceDocument.id, document_ids)
    trace_result = await db.execute(
        select(CalculationTrace).where(CalculationTrace.relationship_id == relationship_id)
    )
    return _EvidenceChainRows(
        relationship=relationship,
        subject=subject,
        object_entity=object_entity,
        claims=claims,
        evidence_links=evidence_links,
        observations=observations,
        snapshots=snapshots,
        documents=documents,
        calculation_traces=list(trace_result.scalars().all()),
    )


def _optional_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _relationship_data(row: AcceptedRelationship, relationship_id: str) -> dict[str, Any]:
    return {
        "id": relationship_id,
        "subject_entity_id": row.subject_entity_id,
        "predicate": row.predicate,
        "object_entity_id": row.object_entity_id,
        "qualifiers": row.qualifiers or {},
        "valid_from": _optional_datetime(row.valid_from),
        "valid_to": _optional_datetime(row.valid_to),
        "recorded_at": cast(datetime, row.recorded_at).isoformat(),
        "retracted_at": _optional_datetime(row.retracted_at),
        "acceptance_policy_version": row.acceptance_policy_version,
        "status": row.status,
    }


def _entity_data(row: EvidenceEntity) -> dict[str, Any]:
    return {
        "id": row.id,
        "record_kind": row.record_kind,
        "canonical_name": row.canonical_name,
    }


def _observation_ids_by_claim(rows: _EvidenceChainRows) -> dict[str, list[str]]:
    observation_ids: dict[str, list[str]] = defaultdict(list)
    for link in rows.evidence_links:
        observation_ids[cast(str, link.claim_id)].append(cast(str, link.observation_id))
    return observation_ids


def _claim_data(
    row: EvidenceClaim,
    observation_ids: dict[str, list[str]],
) -> dict[str, Any]:
    return {
        "id": row.id,
        "subject_entity_id": row.subject_entity_id,
        "predicate": row.predicate,
        "object_entity_id": row.object_entity_id,
        "object_value": row.object_value,
        "qualifiers": row.qualifiers or {},
        "valid_from": _optional_datetime(row.valid_from),
        "valid_to": _optional_datetime(row.valid_to),
        "recorded_at": cast(datetime, row.recorded_at).isoformat(),
        "retracted_at": _optional_datetime(row.retracted_at),
        "asserted_by": row.asserted_by,
        "evidence_class": row.evidence_class,
        "status": row.status,
        "method_version": row.method_version,
        "observation_ids": sorted(observation_ids.get(cast(str, row.id), [])),
    }


def _observation_data(row: EvidenceObservation) -> dict[str, Any]:
    return {
        "id": row.id,
        "snapshot_id": row.snapshot_id,
        "locator": row.locator,
        "quoted_text": row.quoted_text,
        "structured_value": row.structured_value,
        "context_before": row.context_before,
        "context_after": row.context_after,
        "extractor": row.extractor,
        "extractor_version": row.extractor_version,
        "ocr_confidence": row.ocr_confidence,
        "entailment": row.entailment,
    }


def _snapshot_data(row: DocumentSnapshot) -> dict[str, Any]:
    return {
        "id": row.id,
        "document_id": row.document_id,
        "sha256_raw": row.sha256_raw,
        "retrieved_at": cast(datetime, row.retrieved_at).isoformat(),
        "sha256_canonical_text": row.sha256_canonical_text,
        "extraction_tool": row.extraction_tool,
        "extraction_version": row.extraction_version,
    }


def _document_data(row: EvidenceDocument) -> dict[str, Any]:
    return {
        "id": row.id,
        "source_url": row.source_url,
        "document_type": row.document_type,
        "title": row.title,
        "published_at": _optional_datetime(row.published_at),
        "source_class": row.source_class,
    }


def _trace_data(row: CalculationTrace) -> dict[str, Any]:
    return {
        "id": row.id,
        "measurement_name": row.measurement_name,
        "input_claim_ids": row.input_claim_ids,
        "subgraph": row.subgraph,
        "algorithm_version": row.algorithm_version,
        "result": row.result,
        "created_at": cast(datetime, row.created_at).isoformat(),
    }


def _bundle_options(
    rows: _EvidenceChainRows,
    relationship_id: str,
    request: RelationshipProofOptions,
) -> BundleBuildOptions:
    observation_ids = _observation_ids_by_claim(rows)
    return {
        "relationship": _relationship_data(rows.relationship, relationship_id),
        "subject": _entity_data(rows.subject),
        "object_entity": _entity_data(rows.object_entity),
        "claims": [_claim_data(row, observation_ids) for row in rows.claims],
        "observations": [_observation_data(row) for row in rows.observations],
        "snapshots": [_snapshot_data(row) for row in rows.snapshots],
        "documents": [_document_data(row) for row in rows.documents],
        "calculation_traces": [_trace_data(row) for row in rows.calculation_traces],
        "as_of": request["as_of"],
        "known_at": request["known_at"],
        "generated_at": datetime.now(UTC),
        "commit_sha": request["commit_sha"],
        "dataset_snapshot": request["dataset_snapshot"],
    }


async def build_relationship_proof_bundle(
    db: AsyncSession,
    relationship_id: str,
    **options: Unpack[RelationshipProofOptions],
) -> bytes:
    """Load an accepted relationship's full evidence chain and zip it as a proof bundle."""
    rows = await _load_evidence_chain(db, relationship_id)
    files = build_bundle_files(**_bundle_options(rows, relationship_id, options))
    return zip_bundle(files)
