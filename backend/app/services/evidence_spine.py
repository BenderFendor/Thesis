"""Bitemporal claim evaluation, materialization, and relationship queries."""

from __future__ import annotations
import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, cast
from collections.abc import Iterable
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.evidence import (
    AcceptedRelationship,
    AdjudicationItem,
    CalculationTrace,
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceObservation,
    RelationshipClaim,
    SourceLineage,
)
from app.models.evidence_api import (
    AcceptanceEvaluationResponse,
    AcceptedRelationshipRecord,
    EvidenceClaimRecord,
    EvidenceObservationRecord,
    RelationshipQueryResponse,
)
from app.services.claim_comparison import ComparableClaim, compare_claims
from app.services.evidence_policy import ObservationEvidence, evaluate_acceptance
from app.services.ownership_math import (
    InterestRange,
    OwnershipEdge,
    OwnershipMathError,
    compute_indirect_interest,
)

# Predicates whose qualifiers carry an ownership-interest percentage/band and
# therefore participate in ownership_math's safe disjoint-summation check.
INTEREST_PREDICATES = frozenset({"owns_equity_in", "directly_owns"})

# compare_claims classifications that do not indicate a real contradiction
# between the candidate claim and an existing accepted relationship.
_NON_CONFLICTING_CLASSIFICATIONS = frozenset(
    {"compatible", "temporal_successor", "different_relation", "different_share_class"}
)


class EvidenceSpineError(RuntimeError):
    """Raised for any evidence-spine lookup, evaluation, or materialization failure."""


def canonical_json(value: Any) -> str:
    """Serialize *value* deterministically for stable hashing."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def stable_hash(*parts: Any) -> str:
    """Return a stable SHA-256 hash over the canonical JSON of *parts*."""
    payload = "\x1f".join(canonical_json(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def relationship_hash(
    subject_entity_id: str,
    predicate: str,
    object_entity_id: str,
    qualifiers: dict[str, Any],
    valid_from: datetime | None,
    valid_to: datetime | None,
) -> str:
    """Return the identity hash used to dedupe accepted relationships."""
    return stable_hash(
        subject_entity_id,
        predicate,
        object_entity_id,
        qualifiers,
        valid_from.isoformat() if valid_from else None,
        valid_to.isoformat() if valid_to else None,
    )


def _valid_at(model: type[Any], as_of: datetime) -> Any:
    return and_(
        or_(model.valid_from.is_(None), model.valid_from <= as_of),
        or_(model.valid_to.is_(None), model.valid_to >= as_of),
    )


def _known_at(model: type[Any], known_at: datetime) -> Any:
    return and_(
        model.recorded_at <= known_at,
        or_(model.retracted_at.is_(None), model.retracted_at > known_at),
    )


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
        roots = sorted(resolve(parent, {*stack, document_id}) for parent in upstream)
        root = roots[0]
        cache[document_id] = root
        return root

    for document_id in documents:
        resolve(document_id, set())
    return cache


async def _claim_evidence_rows(
    db: AsyncSession, claim_id: str
) -> tuple[list[EvidenceObservation], dict[str, DocumentSnapshot], dict[str, EvidenceDocument]]:
    observations = list(
        (
            await db.execute(
                select(EvidenceObservation)
                .join(ClaimEvidence, ClaimEvidence.observation_id == EvidenceObservation.id)
                .where(ClaimEvidence.claim_id == claim_id)
            )
        )
        .scalars()
        .all()
    )
    snapshot_ids = [cast(str, row.snapshot_id) for row in observations]
    snapshots: list[DocumentSnapshot] = []
    if snapshot_ids:
        snapshots = list(
            (
                await db.execute(
                    select(DocumentSnapshot).where(DocumentSnapshot.id.in_(snapshot_ids))
                )
            )
            .scalars()
            .all()
        )
    snapshot_by_id = {cast(str, row.id): row for row in snapshots}
    document_ids = [cast(str, row.document_id) for row in snapshots]
    documents: list[EvidenceDocument] = []
    if document_ids:
        documents = list(
            (
                await db.execute(
                    select(EvidenceDocument).where(EvidenceDocument.id.in_(document_ids))
                )
            )
            .scalars()
            .all()
        )
    return (observations, snapshot_by_id, {cast(str, row.id): row for row in documents})


async def evaluate_claim_by_id(
    db: AsyncSession, claim_id: str, *, complete_control_path: bool = False
) -> AcceptanceEvaluationResponse:
    """Evaluate whether a claim's linked evidence satisfies its predicate's policy."""
    claim = await db.get(EvidenceClaim, claim_id)
    if claim is None:
        raise EvidenceSpineError(f"claim {claim_id!r} does not exist")
    observations, snapshot_by_id, documents = await _claim_evidence_rows(db, claim_id)
    roots = await _lineage_root_map(db)
    evidence: list[ObservationEvidence] = []
    for observation in observations:
        snapshot = snapshot_by_id.get(cast(str, observation.snapshot_id))
        if snapshot is None:
            continue
        document_id = cast(str, snapshot.document_id)
        document = documents.get(document_id)
        evidence.append(
            ObservationEvidence(
                observation_id=cast(str, observation.id),
                evidence_class=cast(
                    str, document.source_class if document else claim.evidence_class
                ),
                root_id=roots.get(document_id, document_id),
                entailment=cast(str, observation.entailment),
                reviewed_by=observation.reviewed_by,
            )
        )
    decision = evaluate_acceptance(
        predicate=cast(str, claim.predicate),
        evidence=evidence,
        complete_control_path=complete_control_path,
    )
    return AcceptanceEvaluationResponse(
        claim_id=claim_id,
        accepted=decision.accepted,
        policy_version=decision.policy_version,
        reasons=list(decision.reasons),
        independent_root_count=decision.independent_root_count,
        qualifying_observation_count=decision.qualifying_observation_count,
    )


def _claim_comparable(
    claim_id: str,
    subject_entity_id: str,
    predicate: str,
    object_entity_id: str | None,
    object_value: Any | None,
    qualifiers: dict[str, Any],
    valid_from: datetime | None,
    valid_to: datetime | None,
) -> ComparableClaim:
    return ComparableClaim(
        id=claim_id,
        subject_entity_id=subject_entity_id,
        predicate=predicate,
        object_entity_id=object_entity_id,
        object_value=object_value,
        qualifiers=qualifiers,
        valid_from=valid_from,
        valid_to=valid_to,
    )


async def _find_conflicting_relationship(
    db: AsyncSession, claim: EvidenceClaim
) -> tuple[AcceptedRelationship, Any] | None:
    """Classify *claim* against every current accepted relationship sharing its subject and predicate.

    Returns the first real contradiction found. A relationship carrying the exact same digest is handled separately by the
    idempotent dedupe path in `materialize_claim`, so this only ever surfaces
    genuinely competing facts (see `app.services.claim_comparison`).
    """
    candidates = list(
        (
            await db.execute(
                select(AcceptedRelationship).where(
                    AcceptedRelationship.subject_entity_id == claim.subject_entity_id,
                    AcceptedRelationship.predicate == claim.predicate,
                    AcceptedRelationship.retracted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    left = _claim_comparable(
        cast(str, claim.id),
        cast(str, claim.subject_entity_id),
        cast(str, claim.predicate),
        claim.object_entity_id,
        claim.object_value,
        dict(cast(dict[str, Any], claim.qualifiers or {})),
        claim.valid_from,
        claim.valid_to,
    )
    for relationship in candidates:
        right = _claim_comparable(
            cast(str, relationship.id),
            cast(str, relationship.subject_entity_id),
            cast(str, relationship.predicate),
            relationship.object_entity_id,
            None,
            dict(cast(dict[str, Any], relationship.qualifiers or {})),
            relationship.valid_from,
            relationship.valid_to,
        )
        comparison = compare_claims(left, right)
        if comparison.classification not in _NON_CONFLICTING_CLASSIFICATIONS:
            return relationship, comparison
    return None


async def _open_adjudication_item(
    db: AsyncSession, claim: EvidenceClaim, relationship: AcceptedRelationship, comparison: Any
) -> AdjudicationItem:
    """Raise (or fetch) the durable human-review item for a claim contradiction."""
    item_id = f"adj_{stable_hash(claim.id, relationship.id)[:32]}"
    existing = await db.get(AdjudicationItem, item_id)
    if existing is not None:
        return existing
    entity_ids = [cast(str, claim.subject_entity_id)]
    if claim.object_entity_id:
        entity_ids.append(claim.object_entity_id)
    item = AdjudicationItem(
        id=item_id,
        item_type="claim_contradiction",
        claim_ids=[claim.id],
        entity_ids=entity_ids,
        normalized_dimensions=json.loads(canonical_json(comparison.normalized_dimensions)),
        reason=comparison.reason,
        status="open",
    )
    db.add(item)
    await db.flush()
    return item


def _interest_range_from_qualifiers(qualifiers: dict[str, Any]) -> InterestRange | None:
    """Parse a claim's `pct`/`pct_band` qualifier into an `InterestRange`.

    Returns `None` when the qualifiers simply don't carry an interest (not an
    error). A qualifier that does carry one but is out of domain (negative,
    inverted, or over 100%) raises `OwnershipMathError` -- callers that should
    reject such a claim call this directly; `_record_interest_trace` is only
    ever reached after `_check_interest_claim` has already validated it.
    """
    point = qualifiers.get("pct")
    if point is not None:
        try:
            fraction = Decimal(str(point)) / Decimal(100)
        except (ArithmeticError, ValueError):
            return None
        return InterestRange.point(fraction)
    band = qualifiers.get("pct_band")
    lower = upper = None
    if isinstance(band, dict):
        lower, upper = band.get("lower"), band.get("upper")
    elif isinstance(band, (list, tuple)) and len(band) == 2:
        lower, upper = band[0], band[1]
    if lower is None or upper is None:
        return None
    try:
        lower_fraction = Decimal(str(lower)) / Decimal(100)
        upper_fraction = Decimal(str(upper)) / Decimal(100)
    except (ArithmeticError, ValueError):
        return None
    return InterestRange(lower_fraction, upper_fraction)


def _check_interest_claim(claim: EvidenceClaim) -> None:
    """Reject a claim whose own interest qualifiers are out of domain.

    `_interest_range_from_qualifiers` raises `OwnershipMathError` for a
    negative, inverted, or over-100% `pct`/`pct_band` value; without this
    guard that exception would otherwise surface deep inside
    `_record_interest_trace`, after the relationship had already been created.
    """
    if claim.predicate not in INTEREST_PREDICATES:
        return
    qualifiers = dict(cast(dict[str, Any], claim.qualifiers or {}))
    try:
        _interest_range_from_qualifiers(qualifiers)
    except OwnershipMathError as exc:
        raise EvidenceSpineError(f"invalid ownership interest qualifiers: {exc}") from exc


async def _all_accepted_interest_edges(db: AsyncSession) -> list[OwnershipEdge]:
    """Load every current accepted interest-predicate relationship as an edge."""
    rows = list(
        (
            await db.execute(
                select(AcceptedRelationship).where(
                    AcceptedRelationship.predicate.in_(INTEREST_PREDICATES),
                    AcceptedRelationship.retracted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    edges: list[OwnershipEdge] = []
    for row in rows:
        qualifiers = dict(cast(dict[str, Any], row.qualifiers or {}))
        interest = _interest_range_from_qualifiers(qualifiers)
        if interest is None:
            continue
        edges.append(
            OwnershipEdge(
                owner_id=cast(str, row.object_entity_id),
                owned_id=cast(str, row.subject_entity_id),
                interest=interest,
                interest_type=cast(Any, qualifiers.get("interest", "economic")),
                security_class=qualifiers.get("security_class"),
                direct=bool(qualifiers.get("direct", True)),
                claim_id=cast(str, row.id),
                disjoint_group=qualifiers.get("disjoint_group"),
            )
        )
    return edges


async def compute_ownership_interest(
    db: AsyncSession,
    *,
    owner_id: str,
    target_id: str,
    interest_type: str = "economic",
    security_class: str | None = None,
) -> dict[str, object]:
    """Serve an owner's aggregate interest in a target across the full accepted graph.

    Unlike a single accepted relationship's raw `pct`/`pct_band` qualifier
    (see `evidence_export.build_relationship_proof_bundle`), this walks every
    accepted `directly_owns`/`owns_equity_in` edge to compute indirect and
    cross-holding-aware interest via `ownership_math.compute_indirect_interest`
    -- the safe path-enumeration math previously only exercised in unit tests.
    """
    edges = await _all_accepted_interest_edges(db)
    calculation = compute_indirect_interest(
        edges,
        owner_id=owner_id,
        target_id=target_id,
        interest_type=cast(Any, interest_type),
        security_class=security_class,
    )
    return calculation.trace()


async def _record_interest_trace(
    db: AsyncSession, claim: EvidenceClaim, relationship: AcceptedRelationship
) -> None:
    """Store the ownership_math calculation trace backing an accepted interest claim."""
    if claim.predicate not in INTEREST_PREDICATES:
        return
    qualifiers = dict(cast(dict[str, Any], claim.qualifiers or {}))
    if _interest_range_from_qualifiers(qualifiers) is None:
        return
    owner_id = cast(str, claim.object_entity_id)
    owned_id = cast(str, claim.subject_entity_id)
    interest_type = qualifiers.get("interest", "economic")
    security_class = qualifiers.get("security_class")
    trace_id = f"calc_{stable_hash(relationship.id, owner_id, owned_id, interest_type)[:32]}"
    if await db.get(CalculationTrace, trace_id) is not None:
        return
    all_edges = await _all_accepted_interest_edges(db)
    calculation = compute_indirect_interest(
        all_edges,
        owner_id=owner_id,
        target_id=owned_id,
        interest_type=cast(Any, interest_type),
        security_class=security_class,
    )
    db.add(
        CalculationTrace(
            id=trace_id,
            relationship_id=relationship.id,
            measurement_name="ownership_interest",
            input_claim_ids=[claim.id],
            subgraph={"edges": [f"{edge.owner_id}->{edge.owned_id}" for edge in all_edges]},
            algorithm_version=calculation.algorithm_version,
            result=calculation.trace(),
        )
    )
    await db.flush()


async def materialize_claim(
    db: AsyncSession, claim_id: str, *, complete_control_path: bool = False, reviewer: str
) -> AcceptedRelationship:
    """Accept a qualifying claim into an `AcceptedRelationship`, idempotently.

    `reviewer` records who is accepting the claim and is required on every call —
    it is the audit trail for what would otherwise be an anonymous fact-acceptance
    action.
    """
    reviewer = reviewer.strip()
    if not reviewer:
        raise EvidenceSpineError("materialization requires a non-empty reviewer identity")
    claim = await db.get(EvidenceClaim, claim_id)
    if claim is None:
        raise EvidenceSpineError(f"claim {claim_id!r} does not exist")
    if claim.object_entity_id is None:
        raise EvidenceSpineError("only entity-to-entity claims materialize as relationships")
    if claim.retracted_at is not None or claim.status in {"rejected", "superseded"}:
        raise EvidenceSpineError("retracted or rejected claims cannot materialize")
    evaluation = await evaluate_claim_by_id(
        db, claim_id, complete_control_path=complete_control_path
    )
    if not evaluation.accepted:
        raise EvidenceSpineError("; ".join(evaluation.reasons))
    qualifiers = dict(cast(dict[str, Any], claim.qualifiers or {}))
    digest = relationship_hash(
        cast(str, claim.subject_entity_id),
        cast(str, claim.predicate),
        claim.object_entity_id,
        qualifiers,
        claim.valid_from,
        claim.valid_to,
    )
    existing = (
        await db.execute(
            select(AcceptedRelationship).where(
                AcceptedRelationship.relationship_hash == digest,
                AcceptedRelationship.retracted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        link = await db.get(
            RelationshipClaim, {"relationship_id": existing.id, "claim_id": claim_id}
        )
        if link is None:
            db.add(
                RelationshipClaim(
                    relationship_id=existing.id, claim_id=claim_id, derivation_role="supporting"
                )
            )
        return existing
    conflict = await _find_conflicting_relationship(db, claim)
    if conflict is not None:
        conflicting_relationship, comparison = conflict
        item = await _open_adjudication_item(db, claim, conflicting_relationship, comparison)
        raise EvidenceSpineError(
            f"claim contradicts accepted relationship {conflicting_relationship.id} "
            f"({comparison.reason}); opened adjudication item {item.id}"
        )
    _check_interest_claim(claim)
    relationship_id = f"rel_{digest[:32]}"
    relationship = AcceptedRelationship(
        id=relationship_id,
        subject_entity_id=claim.subject_entity_id,
        predicate=claim.predicate,
        object_entity_id=claim.object_entity_id,
        qualifiers=qualifiers,
        valid_from=claim.valid_from,
        valid_to=claim.valid_to,
        recorded_at=claim.recorded_at,
        materialized_at=datetime.now(UTC).replace(tzinfo=None),
        materialized_by=reviewer,
        acceptance_policy_version=evaluation.policy_version,
        status="accepted",
        relationship_hash=digest,
    )
    db.add(relationship)
    db.add(
        RelationshipClaim(
            relationship_id=relationship_id, claim_id=claim_id, derivation_role="primary"
        )
    )
    claim.status = "accepted"
    await db.flush()
    await _record_interest_trace(db, claim, relationship)
    return relationship


async def list_relationships(
    db: AsyncSession,
    *,
    as_of: datetime,
    known_at: datetime,
    predicates: Iterable[str] | None = None,
    entity_id: str | None = None,
) -> RelationshipQueryResponse:
    """Query accepted relationships current as of the given valid/transaction times."""
    stmt = select(AcceptedRelationship).where(
        _valid_at(AcceptedRelationship, as_of), _known_at(AcceptedRelationship, known_at)
    )
    predicate_values = tuple(predicates or ())
    if predicate_values:
        stmt = stmt.where(AcceptedRelationship.predicate.in_(predicate_values))
    if entity_id:
        stmt = stmt.where(
            or_(
                AcceptedRelationship.subject_entity_id == entity_id,
                AcceptedRelationship.object_entity_id == entity_id,
            )
        )
    relationships = list((await db.execute(stmt)).scalars().all())
    ids = [cast(str, row.id) for row in relationships]
    links: list[RelationshipClaim] = []
    if ids:
        links = list(
            (
                await db.execute(
                    select(RelationshipClaim).where(RelationshipClaim.relationship_id.in_(ids))
                )
            )
            .scalars()
            .all()
        )
    claim_ids_by_relationship: dict[str, list[str]] = defaultdict(list)
    for link in links:
        claim_ids_by_relationship[cast(str, link.relationship_id)].append(cast(str, link.claim_id))
    records: list[AcceptedRelationshipRecord] = []
    for relationship in relationships:
        relationship_id = cast(str, relationship.id)
        claim_ids = sorted(claim_ids_by_relationship.get(relationship_id, []))
        root_count = await count_relationship_evidence_roots(db, claim_ids)
        records.append(
            AcceptedRelationshipRecord(
                id=relationship_id,
                subject_entity_id=cast(str, relationship.subject_entity_id),
                predicate=cast(str, relationship.predicate),
                object_entity_id=cast(str, relationship.object_entity_id),
                qualifiers=dict(cast(dict[str, Any], relationship.qualifiers or {})),
                valid_from=relationship.valid_from,
                valid_to=relationship.valid_to,
                recorded_at=cast(datetime, relationship.recorded_at),
                retracted_at=relationship.retracted_at,
                materialized_at=cast(datetime, relationship.materialized_at),
                materialized_by=relationship.materialized_by,
                acceptance_policy_version=cast(str, relationship.acceptance_policy_version),
                status=cast(Any, relationship.status),
                claim_ids=claim_ids,
                evidence_root_count=root_count,
            )
        )
    records.sort(
        key=lambda row: (row.predicate, row.subject_entity_id, row.object_entity_id, row.id)
    )
    return RelationshipQueryResponse(as_of=as_of, known_at=known_at, relationships=records)


async def count_relationship_evidence_roots(db: AsyncSession, claim_ids: Iterable[str]) -> int:
    """Count distinct lineage-resolved source roots backing the given claims.

    Mirrored/copied documents linked by `SourceLineage` collapse to a single
    root; this is the definition of "independent evidence root" the Atlas
    projection must also use (see atlas_evidence_projection.py).
    """
    claim_values = tuple(claim_ids)
    if not claim_values:
        return 0
    rows = (
        await db.execute(
            select(DocumentSnapshot.document_id)
            .join(EvidenceObservation, EvidenceObservation.snapshot_id == DocumentSnapshot.id)
            .join(ClaimEvidence, ClaimEvidence.observation_id == EvidenceObservation.id)
            .where(ClaimEvidence.claim_id.in_(claim_values))
        )
    ).all()
    roots = await _lineage_root_map(db)
    document_ids = {cast(str, row[0]) for row in rows}
    return len({roots.get(document_id, document_id) for document_id in document_ids})


async def get_claim_record(db: AsyncSession, claim_id: str) -> EvidenceClaimRecord | None:
    """Fetch a single claim with its linked evidence observations."""
    claim = await db.get(EvidenceClaim, claim_id)
    if claim is None:
        return None
    observations, _, _ = await _claim_evidence_rows(db, claim_id)
    return EvidenceClaimRecord(
        id=cast(str, claim.id),
        subject_entity_id=cast(str, claim.subject_entity_id),
        predicate=cast(str, claim.predicate),
        object_entity_id=claim.object_entity_id,
        object_value=claim.object_value,
        qualifiers=dict(cast(dict[str, Any], claim.qualifiers or {})),
        valid_from=claim.valid_from,
        valid_to=claim.valid_to,
        date_precision=claim.date_precision,
        recorded_at=cast(datetime, claim.recorded_at),
        retracted_at=claim.retracted_at,
        asserted_by=cast(str, claim.asserted_by),
        evidence_class=cast(str, claim.evidence_class),
        status=cast(Any, claim.status),
        method_version=cast(str, claim.method_version),
        evidence=[
            EvidenceObservationRecord(
                id=cast(str, observation.id),
                snapshot_id=cast(str, observation.snapshot_id),
                locator=dict(cast(dict[str, Any], observation.locator or {})),
                quoted_text=observation.quoted_text,
                structured_value=observation.structured_value,
                context_before=observation.context_before,
                context_after=observation.context_after,
                entailment=cast(Any, observation.entailment),
                extractor=cast(str, observation.extractor),
                extractor_version=cast(str, observation.extractor_version),
                ocr_confidence=cast(float | None, observation.ocr_confidence),
            )
            for observation in observations
        ],
    )
