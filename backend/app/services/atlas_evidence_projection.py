"""Project accepted evidence-spine records into the Intelligence Atlas."""

from __future__ import annotations
from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Any, cast
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.atlas import AtlasEdge, AtlasEvidenceRef, AtlasGraphFilters, AtlasNode, AtlasRelationType
from app.models.evidence import AcceptedRelationship, ClaimEvidence, DocumentSnapshot, EvidenceDocument, EvidenceEntity, EvidenceObservation, RelationshipClaim


def _atlas_entity_type(record_kind: str) -> str | None:
    if record_kind in {"publication", "digital_property", "feed"}:
        return "source"
    if record_kind in {"legal_entity", "organization_without_legal_identity"}:
        return "organization"
    if record_kind == "person":
        return "reporter"
    return None


def _canonical_relation(predicate: str) -> AtlasRelationType:
    if predicate in {"owns_equity_in", "directly_owns", "controls", "ultimate_control", "accounting_consolidated_by"}:
        return "ownership"
    if predicate in {"brand_of", "operated_by", "licensee", "state_chartered_independent"}:
        return "publishes"
    if predicate in {"employed_by", "board_member_of"}:
        return "employed_by"
    if predicate in {"formerly_known_as", "successor_of"}:
        return "parent_org"
    return "part_of"


def _atlas_endpoints(predicate: str, subject_id: str, object_id: str) -> tuple[str, str]:
    if predicate in {"owned_by", "brand_of", "operated_by", "accounting_consolidated_by", "parent_org", "licensee", "state_chartered_independent"}:
        return object_id, subject_id
    return subject_id, object_id


def _as_naive(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC).replace(tzinfo=None)
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


async def load_evidence_atlas_projection(db: AsyncSession, filters: AtlasGraphFilters) -> tuple[list[AtlasNode], list[AtlasEdge]]:
    as_of = _as_naive(filters.as_of)
    known_at = _as_naive(filters.known_at)
    relationships = list((await db.execute(select(AcceptedRelationship).where(
        or_(AcceptedRelationship.valid_from.is_(None), AcceptedRelationship.valid_from <= as_of),
        or_(AcceptedRelationship.valid_to.is_(None), AcceptedRelationship.valid_to >= as_of),
        AcceptedRelationship.recorded_at <= known_at,
        or_(AcceptedRelationship.retracted_at.is_(None), AcceptedRelationship.retracted_at > known_at),
    ))).scalars().all())
    if not relationships:
        return [], []

    entity_ids = {cast(str, value) for row in relationships for value in (row.subject_entity_id, row.object_entity_id)}
    entities = list((await db.execute(select(EvidenceEntity).where(EvidenceEntity.id.in_(entity_ids)))).scalars().all())
    relationship_ids = [cast(str, row.id) for row in relationships]
    links = list((await db.execute(select(RelationshipClaim).where(RelationshipClaim.relationship_id.in_(relationship_ids)))).scalars().all())
    claim_ids_by_relationship: dict[str, list[str]] = defaultdict(list)
    for link in links:
        claim_ids_by_relationship[cast(str, link.relationship_id)].append(cast(str, link.claim_id))
    claim_ids = sorted({claim_id for values in claim_ids_by_relationship.values() for claim_id in values})
    evidence_links = list((await db.execute(select(ClaimEvidence).where(ClaimEvidence.claim_id.in_(claim_ids)))).scalars().all()) if claim_ids else []
    observation_ids_by_claim: dict[str, list[str]] = defaultdict(list)
    for link in evidence_links:
        observation_ids_by_claim[cast(str, link.claim_id)].append(cast(str, link.observation_id))
    observation_ids = sorted({value for values in observation_ids_by_claim.values() for value in values})
    observations = list((await db.execute(select(EvidenceObservation).where(EvidenceObservation.id.in_(observation_ids)))).scalars().all()) if observation_ids else []
    observation_by_id = {cast(str, row.id): row for row in observations}
    snapshot_ids = sorted({cast(str, row.snapshot_id) for row in observations})
    snapshots = list((await db.execute(select(DocumentSnapshot).where(DocumentSnapshot.id.in_(snapshot_ids)))).scalars().all()) if snapshot_ids else []
    snapshot_by_id = {cast(str, row.id): row for row in snapshots}
    document_ids = sorted({cast(str, row.document_id) for row in snapshots})
    documents = list((await db.execute(select(EvidenceDocument).where(EvidenceDocument.id.in_(document_ids)))).scalars().all()) if document_ids else []
    document_by_id = {cast(str, row.id): row for row in documents}

    degree = Counter[str]()
    for relationship in relationships:
        degree[cast(str, relationship.subject_entity_id)] += 1
        degree[cast(str, relationship.object_entity_id)] += 1
    nodes = []
    for entity in entities:
        entity_type = _atlas_entity_type(cast(str, entity.record_kind))
        if entity_type is None:
            continue
        entity_id = cast(str, entity.id)
        nodes.append(AtlasNode(
            id=f"evidence:{entity_id}", entity_type=cast(Any, entity_type),
            label=cast(str, entity.canonical_name), subtitle=cast(str, entity.record_kind).replace("_", " "),
            status=cast(str, entity.status), confidence_tier="verified" if entity.status == "accepted" else "unresolved",
            connection_count=degree[entity_id], profile_path=f"/wiki/ownership?selected=evidence:{entity_id}",
            updated_at=entity.updated_at, flags=[] if entity.status == "accepted" else ["candidate-entity"],
        ))

    visible_entity_ids = {node.id.removeprefix("evidence:") for node in nodes}
    edges = []
    for relationship in relationships:
        subject_id, object_id = cast(str, relationship.subject_entity_id), cast(str, relationship.object_entity_id)
        if subject_id not in visible_entity_ids or object_id not in visible_entity_ids:
            continue
        relationship_id = cast(str, relationship.id)
        claim_ids_for_relationship = sorted(claim_ids_by_relationship.get(relationship_id, []))
        observation_ids_for_relationship = {value for claim_id in claim_ids_for_relationship for value in observation_ids_by_claim.get(claim_id, [])}
        evidence_refs = []
        for observation_id in sorted(observation_ids_for_relationship):
            observation = observation_by_id.get(observation_id)
            if observation is None:
                continue
            snapshot = snapshot_by_id.get(cast(str, observation.snapshot_id))
            document = document_by_id.get(cast(str, snapshot.document_id)) if snapshot else None
            evidence_refs.append(AtlasEvidenceRef(
                id=f"evidence-observation:{observation_id}", source_type=cast(str, document.source_class if document else "snapshot"),
                source_name=cast(str | None, document.title if document else None), source_url=cast(str | None, document.source_url if document else None),
                retrieved_at=snapshot.retrieved_at if snapshot else None, excerpt=cast(str | None, observation.quoted_text),
                snapshot_sha256=cast(str | None, snapshot.sha256_raw if snapshot else None), locator=cast(dict[str, Any], observation.locator or {}),
                entailment=cast(str, observation.entailment),
            ))
        qualifiers = dict(cast(dict[str, Any], relationship.qualifiers or {}))
        pct = qualifiers.get("pct")
        source_id, target_id = _atlas_endpoints(cast(str, relationship.predicate), subject_id, object_id)
        edges.append(AtlasEdge(
            id=f"evidence-edge:{relationship_id}", source_id=f"evidence:{source_id}", target_id=f"evidence:{target_id}",
            relation_type=_canonical_relation(cast(str, relationship.predicate)), ownership_percentage=float(pct) if isinstance(pct, (int, float)) else None,
            confidence=1.0, confidence_tier="verified", evidence_count=len(evidence_refs),
            evidence_preview=evidence_refs[:3] if filters.include_evidence_preview else [], valid_from=relationship.valid_from, valid_to=relationship.valid_to,
            last_verified_at=max((item.retrieved_at for item in evidence_refs if item.retrieved_at), default=relationship.materialized_at),
            raw_relation_type=cast(str, relationship.predicate), fact_status="accepted", accepted_fact=True, qualifiers=qualifiers,
            claim_ids=claim_ids_for_relationship, recorded_at=relationship.recorded_at, retracted_at=relationship.retracted_at,
            acceptance_policy_version=cast(str, relationship.acceptance_policy_version),
            evidence_root_count=len({item.snapshot_sha256 for item in evidence_refs if item.snapshot_sha256}),
        ))
    return nodes, edges
