from __future__ import annotations
import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any, Iterable, cast
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.evidence import AcceptedRelationship, ClaimEvidence, DocumentSnapshot, EvidenceClaim, EvidenceDocument, EvidenceObservation, RelationshipClaim, SourceLineage
from app.models.evidence_api import AcceptanceEvaluationResponse, AcceptedRelationshipRecord, EvidenceClaimRecord, EvidenceObservationRecord, RelationshipQueryResponse
from app.services.evidence_policy import ObservationEvidence, evaluate_acceptance

class EvidenceSpineError(RuntimeError):
    pass

def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)

def stable_hash(*parts: Any) -> str:
    payload = '\x1f'.join((canonical_json(part) for part in parts))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def relationship_hash(subject_entity_id: str, predicate: str, object_entity_id: str, qualifiers: dict[str, Any], valid_from: datetime | None, valid_to: datetime | None) -> str:
    return stable_hash(subject_entity_id, predicate, object_entity_id, qualifiers, valid_from.isoformat() if valid_from else None, valid_to.isoformat() if valid_to else None)

def _valid_at(model: type[Any], as_of: datetime) -> Any:
    return and_(or_(model.valid_from.is_(None), model.valid_from <= as_of), or_(model.valid_to.is_(None), model.valid_to >= as_of))

def _known_at(model: type[Any], known_at: datetime) -> Any:
    return and_(model.recorded_at <= known_at, or_(model.retracted_at.is_(None), model.retracted_at > known_at))

async def _lineage_root_map(db: AsyncSession) -> dict[str, str]:
    rows = list((await db.execute(select(SourceLineage))).scalars().all())
    parents: dict[str, set[str]] = defaultdict(set)
    documents: set[str] = set()
    for row in rows:
        parent = cast(str, row.parent_document_id)
        child = cast(str, row.child_document_id)
        parents[child].add(parent)
        documents.update((parent, child))
    cache: dict[str, str] = {}
    def resolve(document_id: str, stack: set[str]) -> str:
        if document_id in cache:
            return cache[document_id]
        if document_id in stack:
            return document_id
        upstream = parents.get(document_id)
        if not upstream:
            cache[document_id] = document_id
            return document_id
        roots = sorted((resolve(parent, {*stack, document_id}) for parent in upstream))
        root = roots[0]
        cache[document_id] = root
        return root
    for document_id in documents:
        resolve(document_id, set())
    return cache

async def _claim_evidence_rows(db: AsyncSession, claim_id: str) -> tuple[list[EvidenceObservation], dict[str, DocumentSnapshot], dict[str, EvidenceDocument]]:
    observations = list((await db.execute(select(EvidenceObservation).join(ClaimEvidence, ClaimEvidence.observation_id == EvidenceObservation.id).where(ClaimEvidence.claim_id == claim_id))).scalars().all())
    snapshot_ids = [cast(str, row.snapshot_id) for row in observations]
    snapshots: list[DocumentSnapshot] = []
    if snapshot_ids:
        snapshots = list((await db.execute(select(DocumentSnapshot).where(DocumentSnapshot.id.in_(snapshot_ids)))).scalars().all())
    snapshot_by_id = {cast(str, row.id): row for row in snapshots}
    document_ids = [cast(str, row.document_id) for row in snapshots]
    documents: list[EvidenceDocument] = []
    if document_ids:
        documents = list((await db.execute(select(EvidenceDocument).where(EvidenceDocument.id.in_(document_ids)))).scalars().all())
    return (observations, snapshot_by_id, {cast(str, row.id): row for row in documents})

async def evaluate_claim_by_id(db: AsyncSession, claim_id: str, *, complete_control_path: bool=False) -> AcceptanceEvaluationResponse:
    claim = await db.get(EvidenceClaim, claim_id)
    if claim is None:
        raise EvidenceSpineError(f'claim {claim_id!r} does not exist')
    observations, snapshot_by_id, documents = await _claim_evidence_rows(db, claim_id)
    roots = await _lineage_root_map(db)
    evidence: list[ObservationEvidence] = []
    for observation in observations:
        snapshot = snapshot_by_id.get(cast(str, observation.snapshot_id))
        if snapshot is None:
            continue
        document_id = cast(str, snapshot.document_id)
        document = documents.get(document_id)
        evidence.append(ObservationEvidence(observation_id=cast(str, observation.id), evidence_class=cast(str, document.source_class if document else claim.evidence_class), root_id=roots.get(document_id, document_id), entailment=cast(str, observation.entailment)))
    decision = evaluate_acceptance(predicate=cast(str, claim.predicate), evidence=evidence, complete_control_path=complete_control_path)
    return AcceptanceEvaluationResponse(claim_id=claim_id, accepted=decision.accepted, policy_version=decision.policy_version, reasons=list(decision.reasons), independent_root_count=decision.independent_root_count, qualifying_observation_count=decision.qualifying_observation_count)

async def materialize_claim(db: AsyncSession, claim_id: str, *, complete_control_path: bool=False) -> AcceptedRelationship:
    claim = await db.get(EvidenceClaim, claim_id)
    if claim is None:
        raise EvidenceSpineError(f'claim {claim_id!r} does not exist')
    if claim.object_entity_id is None:
        raise EvidenceSpineError('only entity-to-entity claims materialize as relationships')
    if claim.retracted_at is not None or claim.status in {'rejected', 'superseded'}:
        raise EvidenceSpineError('retracted or rejected claims cannot materialize')
    evaluation = await evaluate_claim_by_id(db, claim_id, complete_control_path=complete_control_path)
    if not evaluation.accepted:
        raise EvidenceSpineError('; '.join(evaluation.reasons))
    qualifiers = dict(cast(dict[str, Any], claim.qualifiers or {}))
    digest = relationship_hash(cast(str, claim.subject_entity_id), cast(str, claim.predicate), cast(str, claim.object_entity_id), qualifiers, claim.valid_from, claim.valid_to)
    existing = (await db.execute(select(AcceptedRelationship).where(AcceptedRelationship.relationship_hash == digest, AcceptedRelationship.retracted_at.is_(None)))).scalar_one_or_none()
    if existing is not None:
        link = await db.get(RelationshipClaim, {'relationship_id': existing.id, 'claim_id': claim_id})
        if link is None:
            db.add(RelationshipClaim(relationship_id=existing.id, claim_id=claim_id, derivation_role='supporting'))
        return existing
    relationship_id = f'rel_{digest[:32]}'
    relationship = AcceptedRelationship(id=relationship_id, subject_entity_id=claim.subject_entity_id, predicate=claim.predicate, object_entity_id=claim.object_entity_id, qualifiers=qualifiers, valid_from=claim.valid_from, valid_to=claim.valid_to, recorded_at=claim.recorded_at, materialized_at=datetime.now(UTC).replace(tzinfo=None), acceptance_policy_version=evaluation.policy_version, status='accepted', relationship_hash=digest)
    db.add(relationship)
    db.add(RelationshipClaim(relationship_id=relationship_id, claim_id=claim_id, derivation_role='primary'))
    claim.status = 'accepted'
    await db.flush()
    return relationship

async def list_relationships(db: AsyncSession, *, as_of: datetime, known_at: datetime, predicates: Iterable[str] | None=None, entity_id: str | None=None) -> RelationshipQueryResponse:
    stmt = select(AcceptedRelationship).where(_valid_at(AcceptedRelationship, as_of), _known_at(AcceptedRelationship, known_at))
    predicate_values = tuple(predicates or ())
    if predicate_values:
        stmt = stmt.where(AcceptedRelationship.predicate.in_(predicate_values))
    if entity_id:
        stmt = stmt.where(or_(AcceptedRelationship.subject_entity_id == entity_id, AcceptedRelationship.object_entity_id == entity_id))
    relationships = list((await db.execute(stmt)).scalars().all())
    ids = [cast(str, row.id) for row in relationships]
    links: list[RelationshipClaim] = []
    if ids:
        links = list((await db.execute(select(RelationshipClaim).where(RelationshipClaim.relationship_id.in_(ids)))).scalars().all())
    claim_ids_by_relationship: dict[str, list[str]] = defaultdict(list)
    for link in links:
        claim_ids_by_relationship[cast(str, link.relationship_id)].append(cast(str, link.claim_id))
    records: list[AcceptedRelationshipRecord] = []
    for relationship in relationships:
        relationship_id = cast(str, relationship.id)
        claim_ids = sorted(claim_ids_by_relationship.get(relationship_id, []))
        root_count = await count_relationship_evidence_roots(db, claim_ids)
        records.append(AcceptedRelationshipRecord(id=relationship_id, subject_entity_id=cast(str, relationship.subject_entity_id), predicate=cast(str, relationship.predicate), object_entity_id=cast(str, relationship.object_entity_id), qualifiers=dict(cast(dict[str, Any], relationship.qualifiers or {})), valid_from=relationship.valid_from, valid_to=relationship.valid_to, recorded_at=relationship.recorded_at, retracted_at=relationship.retracted_at, materialized_at=relationship.materialized_at, acceptance_policy_version=cast(str, relationship.acceptance_policy_version), status=cast(Any, relationship.status), claim_ids=claim_ids, evidence_root_count=root_count))
    records.sort(key=lambda row: (row.predicate, row.subject_entity_id, row.object_entity_id, row.id))
    return RelationshipQueryResponse(as_of=as_of, known_at=known_at, relationships=records)

async def count_relationship_evidence_roots(db: AsyncSession, claim_ids: Iterable[str]) -> int:
    claim_values = tuple(claim_ids)
    if not claim_values:
        return 0
    rows = (await db.execute(select(DocumentSnapshot.document_id).join(EvidenceObservation, EvidenceObservation.snapshot_id == DocumentSnapshot.id).join(ClaimEvidence, ClaimEvidence.observation_id == EvidenceObservation.id).where(ClaimEvidence.claim_id.in_(claim_values)))).all()
    roots = await _lineage_root_map(db)
    document_ids = {cast(str, row[0]) for row in rows}
    return len({roots.get(document_id, document_id) for document_id in document_ids})

async def get_claim_record(db: AsyncSession, claim_id: str) -> EvidenceClaimRecord | None:
    claim = await db.get(EvidenceClaim, claim_id)
    if claim is None:
        return None
    observations, _, _ = await _claim_evidence_rows(db, claim_id)
    return EvidenceClaimRecord(id=cast(str, claim.id), subject_entity_id=cast(str, claim.subject_entity_id), predicate=cast(str, claim.predicate), object_entity_id=cast(str | None, claim.object_entity_id), object_value=claim.object_value, qualifiers=dict(cast(dict[str, Any], claim.qualifiers or {})), valid_from=claim.valid_from, valid_to=claim.valid_to, date_precision=cast(str | None, claim.date_precision), recorded_at=claim.recorded_at, retracted_at=claim.retracted_at, asserted_by=cast(str, claim.asserted_by), evidence_class=cast(str, claim.evidence_class), status=cast(Any, claim.status), method_version=cast(str, claim.method_version), evidence=[EvidenceObservationRecord(id=cast(str, observation.id), snapshot_id=cast(str, observation.snapshot_id), locator=dict(cast(dict[str, Any], observation.locator or {})), quoted_text=cast(str | None, observation.quoted_text), structured_value=observation.structured_value, context_before=cast(str | None, observation.context_before), context_after=cast(str | None, observation.context_after), entailment=cast(Any, observation.entailment), extractor=cast(str, observation.extractor), extractor_version=cast(str, observation.extractor_version), ocr_confidence=cast(float | None, observation.ocr_confidence)) for observation in observations])
