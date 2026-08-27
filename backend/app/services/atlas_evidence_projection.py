"""Project the evidence spine's organizations, people, and ownership into Atlas.

Organization and person nodes come from `EvidenceEntity` (`legal_entity`/
`organization_without_legal_identity` -> organization, `person` -> person).
Every ownership-flavored edge -- accepted (`AcceptedRelationship`) and
candidate (un-materialized `EvidenceClaim`) -- for the `directly_owns`,
`owns_equity_in`, `controls`, and `founded_by` predicates is built here too,
fully populated with evidence citations, `fact_status`, `accepted_fact`,
`claim_ids`, and `acceptance_policy_version`. A candidate edge is
`is_inferred=True`/`accepted_fact=False`; the generic `accepted_only` filter
in `atlas_graph_helpers._edge_matches` excludes it when requested.

`sibling_via_owner` is a precomputed, undirected rollup: every accepted
direct/equity ownership edge is walked upward from each outlet to its
ultimate root owner (the entity with no further accepted owner above it,
cycle-guarded); outlets sharing a root are pairwise linked.

Outlet-side edge endpoints resolve through `atlas_entity_resolution.
outlet_node_ids` so they land on the exact same "outlet:<digest>" ids
`atlas_graph_projection.py` emits nodes for.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from itertools import combinations
from typing import Any, cast

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.atlas import (
    AtlasEdge,
    AtlasEvidenceRef,
    AtlasGraphFilters,
    AtlasLifecycleState,
    AtlasNode,
    AtlasRelationType,
)
from app.models.evidence import (
    AcceptedRelationship,
    CalculationTrace,
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceObservation,
    RelationshipClaim,
)
from app.services.atlas_entity_resolution import (
    canonical_entity_id,
    entity_survivor_map,
    live_entities_by_kind,
    outlet_node_ids,
)
from app.services.atlas_graph_helpers import _edge_id
from app.services.evidence_spine import count_relationship_evidence_roots

_ORGANIZATION_KINDS = (
    "legal_entity",
    "organization_without_legal_identity",
    "public_company",
    "nonprofit",
    "family_control_group",
    "trust",
    "government_award",
    "seller_account",
)
_PUBLICATION_KINDS = (
    "publication",
    "publication_brand",
    "digital_property",
    "feed",
    "broadcast_station",
)
_OWNERSHIP_PREDICATES = (
    "directly_owns",
    "owns_equity_in",
    "controls",
    "brand_of",
    "operated_by",
    "successor_of",
    "founded_by",
    "employed_by",
    "authored_by",
    "publishes",
    "distributed_by",
    "syndicated_by",
    "authorizes_inventory_seller",
    "sponsors_content",
    "political_ad_purchase",
    "advertising_inventory_sold_by",
    "funds",
)
_BYLINE_PREDICATES = ("authored_by", "employed_by")
_INTEREST_PREDICATES = ("directly_owns", "owns_equity_in")
# "controls" is included alongside the equity predicates for the downward
# "who else does this owner control" rollup -- broader than the upward
# ownership-chain/sibling walk, which stays interest-predicate-only so its
# percentages mean equity ownership specifically. "founded_by" is excluded:
# founding an org is not the same claim as controlling it.
_CONTROL_PREDICATES = (*_INTEREST_PREDICATES, "controls")


def _relation_type(predicate: str) -> AtlasRelationType:
    if predicate == "founded_by":
        return "founded_by"
    return "ownership"


def _display_group(predicate: str) -> str:
    if predicate in {
        "directly_owns",
        "owns_equity_in",
        "controls",
        "brand_of",
        "operated_by",
        "successor_of",
    }:
        return "ownership_control"
    if predicate in {"employed_by", "founded_by"}:
        return "newsroom_people"
    if predicate in {"publishes", "distributed_by", "syndicated_by"}:
        return "publishing_distribution"
    if predicate in {
        "authorizes_inventory_seller",
        "sponsors_content",
        "political_ad_purchase",
        "advertising_inventory_sold_by",
    }:
        return "advertising_sponsorship"
    if predicate == "funds":
        return "funding_government_awards"
    return "other"


def _decimal_interest(qualifiers: dict[str, Any], key: str) -> dict[str, str] | None:
    raw = qualifiers.get(key)
    if isinstance(raw, dict):
        lower = raw.get("lower")
        upper = raw.get("upper")
        if lower is not None and upper is not None:
            return {"lower": str(lower), "upper": str(upper)}
    if raw is not None and not isinstance(raw, (dict, list)):
        return {"exact": str(raw)}
    return None


def _lifecycle_state(value: object) -> AtlasLifecycleState:
    normalized = str(value or "current").lower()
    aliases = {"announced": "proposed", "approved": "pending", "closed": "historical"}
    normalized = aliases.get(normalized, normalized)
    allowed = {"current", "historical", "proposed", "pending", "disputed", "rejected", "superseded"}
    return cast(AtlasLifecycleState, normalized if normalized in allowed else "current")


def _as_naive(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC).replace(tzinfo=None)
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


async def _reporter_entity_map(db: AsyncSession, survivors: dict[str, str]) -> dict[str, str]:
    """Return {person entity id -> "reporter:<id>" Atlas node id} for unified reporters.

    Ontology: "all reporters are people; not all people are reporters" --
    a `person` `EvidenceEntity` carrying a `scoop_reporter_id` external id
    (see `entity_resolver.resolve_or_create` and
    `app.scripts.ingest_reporter_bylines`) is the *same human* as the
    `reporter:<id>` node `atlas_graph_projection.py` builds from the legacy
    `Reporter` table -- it must not get its own Atlas node. One query,
    O(n) in the number of `scoop_reporter_id` external ids, not per-entity.
    """
    rows = (
        await db.execute(
            select(EntityExternalId.entity_id, EntityExternalId.value).where(
                EntityExternalId.scheme == "scoop_reporter_id"
            )
        )
    ).all()
    result: dict[str, str] = {}
    for entity_id, reporter_id in rows:
        canonical_id = canonical_entity_id(cast(str, entity_id), survivors)
        result[canonical_id] = f"reporter:{reporter_id}"
    return result


async def _endpoint_id_map(
    db: AsyncSession, survivors: dict[str, str], reporter_map: dict[str, str]
) -> tuple[dict[str, str], dict[str, str]]:
    """Return (entity_id -> atlas node id, entity_id -> entity_type) for edge endpoints."""
    organizations = await live_entities_by_kind(db, _ORGANIZATION_KINDS, survivors)
    people = await live_entities_by_kind(db, ("person",), survivors)
    publications = await live_entities_by_kind(db, _PUBLICATION_KINDS, survivors)
    outlet_ids = await outlet_node_ids(db, publications)

    node_id_by_entity: dict[str, str] = {}
    kind_by_entity: dict[str, str] = {}
    for entity in organizations:
        entity_id = cast(str, entity.id)
        node_id_by_entity[entity_id] = f"organization:{entity_id}"
        kind_by_entity[entity_id] = "organization"
    for entity in people:
        entity_id = cast(str, entity.id)
        if entity_id in reporter_map:
            # Unified with an existing reporter node -- see _reporter_entity_map.
            node_id_by_entity[entity_id] = reporter_map[entity_id]
            kind_by_entity[entity_id] = "reporter"
            continue
        node_id_by_entity[entity_id] = f"person:{entity_id}"
        kind_by_entity[entity_id] = "person"
    for entity in publications:
        entity_id = cast(str, entity.id)
        node_id_by_entity[entity_id] = outlet_ids[entity_id]
        kind_by_entity[entity_id] = "outlet"
    return node_id_by_entity, kind_by_entity


async def evidence_refs_for_claims(
    db: AsyncSession, claim_ids: list[str]
) -> dict[str, list[AtlasEvidenceRef]]:
    """Bulk-load evidence citations for a set of claims, keyed by claim id."""
    if not claim_ids:
        return {}
    links = list(
        (await db.execute(select(ClaimEvidence).where(ClaimEvidence.claim_id.in_(claim_ids))))
        .scalars()
        .all()
    )
    observation_ids_by_claim: dict[str, list[str]] = defaultdict(list)
    for link in links:
        observation_ids_by_claim[cast(str, link.claim_id)].append(cast(str, link.observation_id))
    observation_ids = sorted(
        {value for values in observation_ids_by_claim.values() for value in values}
    )
    observations = (
        list(
            (
                await db.execute(
                    select(EvidenceObservation).where(EvidenceObservation.id.in_(observation_ids))
                )
            )
            .scalars()
            .all()
        )
        if observation_ids
        else []
    )
    observation_by_id = {cast(str, row.id): row for row in observations}
    snapshot_ids = sorted({cast(str, row.snapshot_id) for row in observations})
    snapshots = (
        list(
            (
                await db.execute(
                    select(DocumentSnapshot).where(DocumentSnapshot.id.in_(snapshot_ids))
                )
            )
            .scalars()
            .all()
        )
        if snapshot_ids
        else []
    )
    snapshot_by_id = {cast(str, row.id): row for row in snapshots}
    document_ids = sorted({cast(str, row.document_id) for row in snapshots})
    documents = (
        list(
            (
                await db.execute(
                    select(EvidenceDocument).where(EvidenceDocument.id.in_(document_ids))
                )
            )
            .scalars()
            .all()
        )
        if document_ids
        else []
    )
    document_by_id = {cast(str, row.id): row for row in documents}

    result: dict[str, list[AtlasEvidenceRef]] = {}
    for claim_id in claim_ids:
        refs: list[AtlasEvidenceRef] = []
        for observation_id in sorted(observation_ids_by_claim.get(claim_id, [])):
            observation = observation_by_id.get(observation_id)
            if observation is None:
                continue
            snapshot = snapshot_by_id.get(cast(str, observation.snapshot_id))
            document = document_by_id.get(cast(str, snapshot.document_id)) if snapshot else None
            refs.append(
                AtlasEvidenceRef(
                    id=f"evidence-observation:{observation_id}",
                    source_type=cast(str, document.source_class if document else "snapshot"),
                    source_name=document.title if document else None,
                    source_url=document.source_url if document else None,
                    retrieved_at=snapshot.retrieved_at if snapshot else None,
                    excerpt=observation.quoted_text,
                    snapshot_sha256=snapshot.sha256_raw if snapshot else None,
                    locator=cast(dict[str, Any], observation.locator or {}),
                    entailment=cast(str, observation.entailment),
                )
            )
        result[claim_id] = refs
    return result


async def _accepted_ownership_edges(
    db: AsyncSession,
    filters: AtlasGraphFilters,
    node_id_by_entity: dict[str, str],
    survivors: dict[str, str],
    reporter_map: dict[str, str],
) -> list[AtlasEdge]:
    """Build edges for materialized `AcceptedRelationship` ownership facts."""
    as_of = _as_naive(filters.as_of)
    known_at = _as_naive(filters.known_at)
    relationships = list(
        (
            await db.execute(
                select(AcceptedRelationship).where(
                    AcceptedRelationship.predicate.in_(_OWNERSHIP_PREDICATES),
                    or_(
                        AcceptedRelationship.valid_from.is_(None),
                        AcceptedRelationship.valid_from <= as_of,
                    ),
                    or_(
                        AcceptedRelationship.valid_to.is_(None),
                        AcceptedRelationship.valid_to >= as_of,
                    ),
                    AcceptedRelationship.recorded_at <= known_at,
                    or_(
                        AcceptedRelationship.retracted_at.is_(None),
                        AcceptedRelationship.retracted_at > known_at,
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    if not relationships:
        return []

    relationship_ids = [cast(str, row.id) for row in relationships]
    links = list(
        (
            await db.execute(
                select(RelationshipClaim).where(
                    RelationshipClaim.relationship_id.in_(relationship_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    claim_ids_by_relationship: dict[str, list[str]] = defaultdict(list)
    for link in links:
        claim_ids_by_relationship[cast(str, link.relationship_id)].append(cast(str, link.claim_id))
    all_claim_ids = sorted({cid for values in claim_ids_by_relationship.values() for cid in values})
    evidence_by_claim = await evidence_refs_for_claims(db, all_claim_ids)
    claim_rows = (
        list(
            (await db.execute(select(EvidenceClaim).where(EvidenceClaim.id.in_(all_claim_ids))))
            .scalars()
            .all()
        )
        if all_claim_ids
        else []
    )
    claim_by_id = {cast(str, row.id): row for row in claim_rows}

    traces = list(
        (
            await db.execute(
                select(CalculationTrace).where(
                    CalculationTrace.relationship_id.in_(relationship_ids),
                    CalculationTrace.measurement_name == "ownership_interest",
                )
            )
        )
        .scalars()
        .all()
    )
    trace_by_relationship = {cast(str, row.relationship_id): row for row in traces}

    edges: list[AtlasEdge] = []
    for relationship in relationships:
        predicate = cast(str, relationship.predicate)
        subject_entity = canonical_entity_id(cast(str, relationship.subject_entity_id), survivors)
        if predicate in _BYLINE_PREDICATES and subject_entity in reporter_map:
            # `atlas_graph_projection.py`'s `_reporter_byline_edge_index` already
            # builds this reporter's authored_by/employed_by edge straight from
            # EvidenceClaim -- emitting it again here (now pointed at the same
            # unified reporter node) would double-count evidence on that node.
            continue
        object_entity = canonical_entity_id(cast(str, relationship.object_entity_id), survivors)
        source_node = node_id_by_entity.get(object_entity)
        target_node = node_id_by_entity.get(subject_entity)
        if source_node is None or target_node is None:
            continue
        claim_ids = sorted(claim_ids_by_relationship.get(cast(str, relationship.id), []))
        evidence_refs = [
            ref.model_copy(
                update={
                    "evidence_class": cast(str, claim_by_id[claim_id].evidence_class),
                    "policy_version": cast(str, relationship.acceptance_policy_version),
                    "acceptance_decision": "accepted",
                }
            )
            for claim_id in claim_ids
            for ref in evidence_by_claim.get(claim_id, [])
            if claim_id in claim_by_id
        ]
        qualifiers = dict(cast(dict[str, Any], relationship.qualifiers or {}))
        ownership_percentage: float | None = None
        if isinstance(qualifiers.get("pct"), (int, float)):
            ownership_percentage = float(qualifiers["pct"])
        trace = trace_by_relationship.get(cast(str, relationship.id))
        if trace is not None:
            aggregate = cast(
                dict[str, Any] | None, cast(dict[str, Any], trace.result).get("aggregate")
            )
            if aggregate:
                lower, upper = float(aggregate["lower"]), float(aggregate["upper"])
                qualifiers["pct_range"] = {"lower": lower, "upper": upper}
        evidence_root_count = await count_relationship_evidence_roots(db, claim_ids)
        edges.append(
            AtlasEdge(
                id=f"evidence-edge:{relationship.id}",
                source_id=source_node,
                target_id=target_node,
                relation_type=_relation_type(predicate),
                predicate=predicate,
                display_group=_display_group(predicate),
                ownership_percentage=ownership_percentage,
                voting_interest=_decimal_interest(qualifiers, "voting_interest"),
                economic_interest=_decimal_interest(qualifiers, "economic_interest")
                or _decimal_interest(qualifiers, "pct_range")
                or _decimal_interest(qualifiers, "pct"),
                beneficial_interest=_decimal_interest(qualifiers, "beneficial_interest"),
                confidence=1.0,
                confidence_tier="verified",
                evidence_count=len(evidence_refs),
                evidence_preview=evidence_refs[:3] if filters.include_evidence_preview else [],
                valid_from=relationship.valid_from,
                valid_to=relationship.valid_to,
                last_verified_at=max(
                    (item.retrieved_at for item in evidence_refs if item.retrieved_at),
                    default=relationship.materialized_at,
                ),
                raw_relation_type=predicate,
                fact_status="accepted",
                lifecycle_state=_lifecycle_state(relationship.lifecycle_state),
                accepted_fact=True,
                qualifiers=qualifiers,
                claim_ids=claim_ids,
                recorded_at=relationship.recorded_at,
                retracted_at=relationship.retracted_at,
                acceptance_policy_version=cast(str, relationship.acceptance_policy_version),
                evidence_root_count=evidence_root_count,
            )
        )
    return edges


async def _candidate_ownership_edges(
    db: AsyncSession,
    filters: AtlasGraphFilters,
    node_id_by_entity: dict[str, str],
    survivors: dict[str, str],
    reporter_map: dict[str, str],
) -> list[AtlasEdge]:
    """Build edges for un-materialized candidate ownership claims."""
    as_of = _as_naive(filters.as_of)
    known_at = _as_naive(filters.known_at)
    claims = list(
        (
            await db.execute(
                select(EvidenceClaim).where(
                    EvidenceClaim.predicate.in_(_OWNERSHIP_PREDICATES),
                    EvidenceClaim.status == "candidate",
                    EvidenceClaim.object_entity_id.is_not(None),
                    or_(EvidenceClaim.valid_from.is_(None), EvidenceClaim.valid_from <= as_of),
                    or_(EvidenceClaim.valid_to.is_(None), EvidenceClaim.valid_to >= as_of),
                    EvidenceClaim.recorded_at <= known_at,
                    or_(
                        EvidenceClaim.retracted_at.is_(None), EvidenceClaim.retracted_at > known_at
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    if not claims:
        return []

    claim_ids = [cast(str, claim.id) for claim in claims]
    evidence_by_claim = await evidence_refs_for_claims(db, claim_ids)

    edges: list[AtlasEdge] = []
    for claim in claims:
        predicate = cast(str, claim.predicate)
        subject_entity = canonical_entity_id(cast(str, claim.subject_entity_id), survivors)
        if predicate in _BYLINE_PREDICATES and subject_entity in reporter_map:
            # See the matching guard in _accepted_ownership_edges: this fact is
            # already covered by atlas_graph_projection.py's dedicated
            # reporter byline edge builder.
            continue
        object_entity = canonical_entity_id(cast(str, claim.object_entity_id), survivors)
        source_node = node_id_by_entity.get(object_entity)
        target_node = node_id_by_entity.get(subject_entity)
        if source_node is None or target_node is None:
            continue
        evidence_refs = [
            ref.model_copy(
                update={
                    "evidence_class": cast(str, claim.evidence_class),
                    "acceptance_decision": cast(str, claim.status),
                }
            )
            for ref in evidence_by_claim.get(cast(str, claim.id), [])
        ]
        qualifiers = dict(cast(dict[str, Any], claim.qualifiers or {}))
        ownership_percentage = (
            float(qualifiers["pct"]) if isinstance(qualifiers.get("pct"), (int, float)) else None
        )
        edges.append(
            AtlasEdge(
                id=f"evidence-candidate-edge:{claim.id}",
                source_id=source_node,
                target_id=target_node,
                relation_type=_relation_type(predicate),
                predicate=predicate,
                display_group=_display_group(predicate),
                ownership_percentage=ownership_percentage,
                voting_interest=_decimal_interest(qualifiers, "voting_interest"),
                economic_interest=_decimal_interest(qualifiers, "economic_interest")
                or _decimal_interest(qualifiers, "pct_range")
                or _decimal_interest(qualifiers, "pct"),
                beneficial_interest=_decimal_interest(qualifiers, "beneficial_interest"),
                confidence=None,
                confidence_tier="unresolved",
                evidence_count=len(evidence_refs),
                evidence_preview=evidence_refs[:3] if filters.include_evidence_preview else [],
                valid_from=claim.valid_from,
                valid_to=claim.valid_to,
                last_verified_at=max(
                    (item.retrieved_at for item in evidence_refs if item.retrieved_at),
                    default=None,
                ),
                raw_relation_type=predicate,
                fact_status="candidate",
                lifecycle_state=_lifecycle_state(
                    qualifiers.get("lifecycle_state") or qualifiers.get("txn_status")
                ),
                accepted_fact=False,
                qualifiers=qualifiers,
                claim_ids=[cast(str, claim.id)],
                recorded_at=claim.recorded_at,
                retracted_at=claim.retracted_at,
                acceptance_policy_version=None,
                evidence_root_count=await count_relationship_evidence_roots(
                    db, [cast(str, claim.id)]
                ),
                is_inferred=True,
            )
        )
    return edges


def build_interest_edge_index(edges: list[AtlasEdge]) -> dict[str, AtlasEdge]:
    """Map owned-entity atlas node id -> the accepted direct/equity edge to its owner.

    Restricted to `_INTEREST_PREDICATES` (direct/equity ownership only, not
    `controls`/`founded_by`) so the percentages this index carries always
    mean equity ownership. Shared by the upward ownership-chain walk (Phase
    3, `atlas_entity.py`) and the `sibling_via_owner` root walk below --
    both need "who owns this entity" resolved identically. When more than
    one accepted interest edge targets the same owned node, the one with
    the higher recorded percentage wins.
    """
    index: dict[str, AtlasEdge] = {}
    for edge in edges:
        if not edge.accepted_fact or edge.raw_relation_type not in _INTEREST_PREDICATES:
            continue
        existing = index.get(edge.target_id)
        if existing is None or (edge.ownership_percentage or 0) > (
            existing.ownership_percentage or 0
        ):
            index[edge.target_id] = edge
    return index


def walk_ownership_chain(
    start_node_id: str, edge_by_owned: dict[str, AtlasEdge], max_depth: int = 12
) -> list[AtlasEdge]:
    """Walk upward from `start_node_id` through accepted interest-ownership edges.

    Cycle-guarded (stops the instant a node would repeat) and depth-capped
    so cyclic or malformed ownership data can never hang this walk. Returns
    the ordered list of edges from the starting entity to its ultimate
    accepted owner (the root); empty if the entity has no recorded owner.
    """
    chain: list[AtlasEdge] = []
    current = start_node_id
    seen = {current}
    while current in edge_by_owned and len(chain) < max_depth:
        edge = edge_by_owned[current]
        if edge.source_id in seen:
            break
        chain.append(edge)
        current = edge.source_id
        seen.add(current)
    return chain


def build_controls_index(edges: list[AtlasEdge]) -> dict[str, list[AtlasEdge]]:
    """Map owner atlas node id -> its outgoing accepted `_CONTROL_PREDICATES` edges.

    The downward counterpart to `build_interest_edge_index`: used to answer
    "who else does this owner control" (Phase 3 `controls` rollup) by BFS
    from an owner through this index.
    """
    index: dict[str, list[AtlasEdge]] = defaultdict(list)
    for edge in edges:
        if not edge.accepted_fact or edge.raw_relation_type not in _CONTROL_PREDICATES:
            continue
        index[edge.source_id].append(edge)
    return dict(index)


def walk_controls_downward(
    start_node_id: str, controls_index: dict[str, list[AtlasEdge]], max_depth: int = 6
) -> list[AtlasEdge]:
    """BFS downward from an owner through accepted control/ownership edges.

    Cycle-guarded (a node is never visited twice) and depth-capped. Returns
    every edge on the frontier of the walk, in breadth-first order; the
    caller reads each edge's `target_id` for the controlled entity.
    """
    visited = {start_node_id}
    frontier = [start_node_id]
    collected: list[AtlasEdge] = []
    depth = 0
    while frontier and depth < max_depth:
        next_frontier: list[str] = []
        for node_id in frontier:
            for edge in controls_index.get(node_id, []):
                if edge.target_id in visited:
                    continue
                visited.add(edge.target_id)
                collected.append(edge)
                next_frontier.append(edge.target_id)
        frontier = next_frontier
        depth += 1
    return collected


def _sibling_via_owner_edges(
    outlet_ids: set[str], edge_by_owned: dict[str, AtlasEdge]
) -> list[AtlasEdge]:
    """Roll outlets up to their ultimate accepted owner and link siblings pairwise."""

    def root_and_claims(node_id: str) -> tuple[str, list[str]]:
        chain = walk_ownership_chain(node_id, edge_by_owned)
        if not chain:
            return node_id, []
        root = chain[-1].source_id
        claim_ids = [claim_id for edge in chain for claim_id in edge.claim_ids]
        return root, claim_ids

    groups: dict[str, list[tuple[str, list[str]]]] = defaultdict(list)
    for outlet_id in outlet_ids:
        if outlet_id not in edge_by_owned:
            continue
        root, claim_ids = root_and_claims(outlet_id)
        groups[root].append((outlet_id, claim_ids))

    edges: list[AtlasEdge] = []
    for root, members in groups.items():
        if len(members) < 2:
            continue
        for (left_id, left_claims), (right_id, right_claims) in combinations(sorted(members), 2):
            claim_ids = sorted({*left_claims, *right_claims})
            edges.append(
                AtlasEdge(
                    id=_edge_id(left_id, right_id, "sibling_via_owner", root),
                    source_id=left_id,
                    target_id=right_id,
                    relation_type="sibling_via_owner",
                    direction="undirected",
                    confidence=0.75,
                    confidence_tier="strong",
                    evidence_count=len(claim_ids),
                    is_inferred=True,
                    raw_relation_type="sibling_via_owner_rollup",
                    fact_status="candidate",
                    accepted_fact=False,
                    qualifiers={"ultimate_owner_id": root},
                    claim_ids=claim_ids,
                )
            )
    return edges


async def load_evidence_atlas_projection(
    db: AsyncSession, filters: AtlasGraphFilters
) -> tuple[list[AtlasNode], list[AtlasEdge]]:
    """Project organization/person nodes and every ownership edge into the Atlas."""
    survivors = await entity_survivor_map(db)
    reporter_map = await _reporter_entity_map(db, survivors)
    organizations = await live_entities_by_kind(db, _ORGANIZATION_KINDS, survivors)
    people = await live_entities_by_kind(db, ("person",), survivors)
    if not organizations and not people:
        return [], []

    nodes: list[AtlasNode] = []
    for entity in organizations:
        entity_id = cast(str, entity.id)
        nodes.append(
            AtlasNode(
                id=f"organization:{entity_id}",
                entity_type="organization",
                label=cast(str, entity.canonical_name),
                subtitle=cast(str, entity.entity_kind).replace("_", " "),
                status=cast(str, entity.status),
                confidence_tier="verified" if entity.status == "accepted" else "unresolved",
                profile_path=f"/wiki/organization/{entity_id}",
                updated_at=entity.updated_at,
                flags=[] if entity.status == "accepted" else ["candidate-entity"],
            )
        )
    for entity in people:
        entity_id = cast(str, entity.id)
        if entity_id in reporter_map:
            # Unified with an existing `reporter:<id>` node (see
            # _reporter_entity_map) -- its evidence edges attach there
            # instead of to a duplicate person node.
            continue
        nodes.append(
            AtlasNode(
                id=f"person:{entity_id}",
                entity_type="person",
                label=cast(str, entity.canonical_name),
                subtitle="Person",
                status=cast(str, entity.status),
                confidence_tier="verified" if entity.status == "accepted" else "unresolved",
                profile_path=f"/wiki/person/{entity_id}",
                updated_at=entity.updated_at,
                flags=[] if entity.status == "accepted" else ["candidate-entity"],
            )
        )

    node_id_by_entity, _kind_by_entity = await _endpoint_id_map(db, survivors, reporter_map)
    accepted_edges = await _accepted_ownership_edges(
        db, filters, node_id_by_entity, survivors, reporter_map
    )
    candidate_edges = await _candidate_ownership_edges(
        db, filters, node_id_by_entity, survivors, reporter_map
    )

    publications = await live_entities_by_kind(db, _PUBLICATION_KINDS, survivors)
    outlet_ids = set((await outlet_node_ids(db, publications)).values())
    edge_by_owned = build_interest_edge_index(accepted_edges)
    sibling_edges = _sibling_via_owner_edges(outlet_ids, edge_by_owned)

    return nodes, [*accepted_edges, *candidate_edges, *sibling_edges]
