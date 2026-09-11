"""Entity, search, and paginated index services for the Intelligence Atlas."""

from __future__ import annotations

import base64
from collections import Counter
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.rss_sources import get_rss_sources
from app.database import (
    Organization,
    Reporter,
    SourceAnalysisScore,
    SourceClaim,
    SourceClaimEvidence,
    SourceMetadata,
)
from app.models.atlas import (
    AtlasConnectionRecord,
    AtlasDossierSection,
    AtlasDossierStatement,
    AtlasEdge,
    AtlasEntityRecord,
    AtlasEntityType,
    AtlasGraphFilters,
    AtlasGraphResponse,
    AtlasIndexResponse,
    AtlasNode,
    AtlasSearchItem,
    AtlasSearchResponse,
)
from app.models.evidence import EntityExternalId, EvidenceClaim, EvidenceEntity
from app.services.atlas_evidence_projection import (
    build_controls_index,
    build_interest_edge_index,
    evidence_refs_for_claims,
    walk_controls_downward,
    walk_ownership_chain,
)
from app.services.atlas_graph import build_atlas_graph
from app.services.atlas_graph_helpers import (
    normalize_entity_id_alias,
    normalize_entity_label,
    stable_source_id,
)

_EXTERNAL_ID_LINK_TEMPLATES: dict[str, str] = {
    "wikidata_qid": "https://www.wikidata.org/wiki/{value}",
    "cik": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={value}&type=10-K",
    "littlesis_id": "https://littlesis.org/entities/{value}",
    "mbfc_id": "https://mediabiasfactcheck.com/?s={value}",
}
# Internal bookkeeping ids, not meaningful external references -- never surfaced.
_INTERNAL_EXTERNAL_ID_SCHEMES = {"rss_catalog_key", "legacy_organization_id", "domain"}

_OWNERSHIP_ENTITY_TYPES: list[AtlasEntityType] = ["outlet", "organization", "person"]

# Attribute (object_value-only) claims consulted for the Phase 5 Funding &
# Bias panel. "funding_type" has no ingestor writing it today (Phase 1 only
# populates entity-to-entity ownership facts and MBFC's bias_rating/
# factual_reporting), so in practice it always falls back to the legacy
# SourceMetadata/Organization value -- kept in the query so a future
# ingestor's accepted claims are picked up without another code change.
_FUNDING_BIAS_PREDICATES = ("funding_type", "bias_rating", "factual_reporting")


def _unknown_statement(label: str, state: str = "not_researched") -> AtlasDossierStatement:
    answer_by_state = {
        "unknown": "Unknown.",
        "not_researched": "Not researched.",
        "source_unavailable": "Source unavailable.",
        "chain_incomplete": "The legal chain is incomplete.",
    }
    return AtlasDossierStatement(
        label=label,
        answer=answer_by_state[state],
        state=cast(Any, state),
    )


def _ownership_answer(
    connections: list[AtlasConnectionRecord],
    entity_id: str,
    details: dict[str, Any],
) -> AtlasDossierStatement:
    """Current-owner statement for the summary and ownership sections."""
    current_owners = [
        item
        for item in connections
        if item.edge.target_id == entity_id
        and item.edge.accepted_fact
        and item.edge.lifecycle_state == "current"
        and item.edge.predicate
        in {"directly_owns", "owns_equity_in", "controls", "brand_of", "operated_by"}
    ]
    if current_owners:
        owner = current_owners[0]
        return AtlasDossierStatement(
            label="Current owner or operator",
            answer=owner.entity.label,
            state="known",
            predicate=owner.edge.predicate,
            lifecycle_state=owner.edge.lifecycle_state,
            evidence=owner.edge.evidence_preview,
            qualifiers=owner.edge.qualifiers,
        )
    return _unknown_statement(
        "Current owner or operator",
        "chain_incomplete" if details.get("parent_company") else "not_researched",
    )


def _identity_statement(details: dict[str, Any]) -> AtlasDossierStatement:
    name = details.get("legal_name") or details.get("canonical_name") or details.get("source_name")
    if name:
        return AtlasDossierStatement(
            label="Legal or canonical name", answer=str(name), state="known"
        )
    return _unknown_statement("Legal or canonical name")


def _newsroom_statement(newsroom_value: Any) -> AtlasDossierStatement:
    if newsroom_value:
        return AtlasDossierStatement(
            label="Newsroom affiliations", answer=str(newsroom_value), state="known"
        )
    return _unknown_statement("Newsroom affiliations")


def _relationship_statements(
    items: list[AtlasConnectionRecord],
    fallback_label: str,
    *,
    include_qualifiers: bool = False,
) -> list[AtlasDossierStatement]:
    statements: list[AtlasDossierStatement] = []
    for item in items:
        kwargs: dict[str, Any] = {
            "label": item.edge.predicate or fallback_label,
            "answer": item.entity.label,
            "state": "known",
            "predicate": item.edge.predicate,
            "lifecycle_state": item.edge.lifecycle_state,
            "evidence": item.edge.evidence_preview,
        }
        if include_qualifiers:
            kwargs["qualifiers"] = item.edge.qualifiers
        statements.append(AtlasDossierStatement(**kwargs))
    return statements


def _relationship_section(
    key: Literal["advertising_sponsorship", "publishing_distribution"],
    title: str,
    items: list[AtlasConnectionRecord],
    fallback_label: str,
    unknown_label: str,
) -> AtlasDossierSection:
    return AtlasDossierSection(
        key=key,
        title=title,
        statements=_relationship_statements(items, fallback_label)
        or [_unknown_statement(unknown_label)],
    )


def _evidence_coverage_statement(
    ownership_answer: AtlasDossierStatement,
    connections: list[AtlasConnectionRecord],
) -> AtlasDossierStatement:
    if ownership_answer.state == "chain_incomplete":
        return _unknown_statement("Known gaps", "chain_incomplete")
    return AtlasDossierStatement(
        label="Evidence coverage",
        answer=f"{sum(item.edge.evidence_count for item in connections)} cited observations.",
        state="known" if connections else "not_researched",
    )


def _pending_relationship_statements(
    connections: list[AtlasConnectionRecord],
) -> list[AtlasDossierStatement]:
    pending = [
        item
        for item in connections
        if item.edge.lifecycle_state in {"proposed", "pending", "disputed"}
    ]
    return [
        AtlasDossierStatement(
            label=f"{item.edge.lifecycle_state.title()} relationship",
            answer=item.entity.label,
            state="known",
            predicate=item.edge.predicate,
            lifecycle_state=item.edge.lifecycle_state,
            evidence=item.edge.evidence_preview,
            qualifiers=item.edge.qualifiers,
        )
        for item in pending
    ]


def _connections_in_group(
    connections: list[AtlasConnectionRecord],
    display_group: str,
) -> list[AtlasConnectionRecord]:
    return [item for item in connections if item.edge.display_group == display_group]


def _funding_statements(
    funding: list[AtlasConnectionRecord],
    funding_value: Any,
) -> list[AtlasDossierStatement]:
    statements = _relationship_statements(funding, "Funding relationship", include_qualifiers=True)
    if funding_value and not statements:
        statements = [
            AtlasDossierStatement(label="Funding model", answer=str(funding_value), state="known")
        ]
    return statements


def _build_dossier_sections(
    entity_id: str,
    details: dict[str, Any],
    connections: list[AtlasConnectionRecord],
) -> list[AtlasDossierSection]:
    """Turn graph facts into direct answers without treating missing rows as negatives."""
    ownership_answer = _ownership_answer(connections, entity_id, details)
    pending_statements = _pending_relationship_statements(connections)
    publishing = _connections_in_group(connections, "publishing_distribution")
    advertising = _connections_in_group(connections, "advertising_sponsorship")
    funding = _connections_in_group(connections, "funding_government_awards")
    funding_statements = _funding_statements(funding, details.get("funding_type"))
    newsroom_value = details.get("institutional_affiliations") or details.get("career_history")

    return [
        AtlasDossierSection(key="summary", title="Summary", statements=[ownership_answer]),
        AtlasDossierSection(
            key="identity_public_records",
            title="Identity and public records",
            statements=[_identity_statement(details)],
        ),
        AtlasDossierSection(
            key="ownership_control",
            title="Ownership and control",
            statements=[ownership_answer, *pending_statements],
        ),
        AtlasDossierSection(
            key="newsroom_people",
            title="Newsroom and people",
            statements=[_newsroom_statement(newsroom_value)],
        ),
        AtlasDossierSection(
            key="funding_government_awards",
            title="Funding and government awards",
            statements=funding_statements or [_unknown_statement("Funding model")],
        ),
        _relationship_section(
            key="advertising_sponsorship",
            title="Advertising and sponsorship",
            items=advertising,
            fallback_label="Advertising relationship",
            unknown_label="Advertising and sponsorship",
        ),
        _relationship_section(
            key="publishing_distribution",
            title="Publishing and distribution",
            items=publishing,
            fallback_label="Publishing relationship",
            unknown_label="Publishing and distribution",
        ),
        AtlasDossierSection(
            key="evidence_conflicts_freshness_gaps",
            title="Evidence, conflicts, freshness, and known gaps",
            statements=[_evidence_coverage_statement(ownership_answer, connections)],
        ),
    ]


async def _accepted_attribute_claims(
    db: AsyncSession, subject_entity_id: str, predicates: Sequence[str]
) -> dict[str, EvidenceClaim]:
    """Return the latest accepted, non-retracted attribute claim per predicate.

    "Attribute" claims are `object_value`-only assertions about the subject
    itself (e.g. MBFC's `bias_rating`) rather than a relationship to another
    entity -- they never pass through `AcceptedRelationship` (see
    `evidence_ingest._auto_accept_attribute_claim`), so this reads
    `EvidenceClaim.status == "accepted"` directly. When more than one claim
    for the same predicate is accepted (a re-ingestion that changed the
    rated value), the most recently recorded one wins.
    """
    rows = list(
        (
            await db.execute(
                select(EvidenceClaim).where(
                    EvidenceClaim.subject_entity_id == subject_entity_id,
                    EvidenceClaim.predicate.in_(predicates),
                    EvidenceClaim.status == "accepted",
                    EvidenceClaim.retracted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    latest: dict[str, EvidenceClaim] = {}
    for row in rows:
        predicate = cast(str, row.predicate)
        current = latest.get(predicate)
        if current is None or cast(datetime, row.recorded_at) > cast(datetime, current.recorded_at):
            latest[predicate] = row
    return latest


def _claim_object_text(claim: EvidenceClaim) -> str | None:
    """Pull the human-readable rated value out of an attribute claim's `object_value`.

    MBFC claims store `{"rating": ..., "source": "mbfc"}`; a future
    `funding_type` ingestor is not pinned to a specific key yet, so a couple
    of reasonable alternates are checked too.
    """
    value = cast(dict[str, Any] | None, claim.object_value)
    if not isinstance(value, dict):
        return None
    for key in ("rating", "funding_type", "value"):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return None


async def _funding_and_bias_block(
    db: AsyncSession,
    evidence_entity_id: str | None,
    *,
    legacy_funding_type: str | None,
    legacy_bias_rating: str | None,
    legacy_factual_reporting: str | None,
) -> dict[str, Any]:
    """Build the Phase 5 `funding_and_bias` details block for an outlet/organization.

    Each of the three fields independently prefers an accepted evidence-spine
    claim (carrying `claim_ids`/`evidence_count`/the citing evidence itself,
    origin="claim") and falls back to the legacy SourceMetadata/Organization
    value the rest of the Atlas already shows (origin="legacy", no evidence).
    A field with no value at all (neither claim nor legacy) carries
    `origin=None` so the UI can render "not recorded" rather than a false
    "legacy" attribution.
    """
    claims: dict[str, EvidenceClaim] = {}
    if evidence_entity_id is not None:
        claims = await _accepted_attribute_claims(db, evidence_entity_id, _FUNDING_BIAS_PREDICATES)
    claim_ids = [cast(str, claim.id) for claim in claims.values()]
    evidence_by_claim = await evidence_refs_for_claims(db, claim_ids) if claim_ids else {}

    def _field(predicate: str, legacy_value: str | None) -> dict[str, Any]:
        claim = claims.get(predicate)
        if claim is not None:
            value = _claim_object_text(claim)
            if value is not None:
                refs = evidence_by_claim.get(cast(str, claim.id), [])
                object_value = cast(dict[str, Any] | None, claim.object_value) or {}
                return {
                    "value": value,
                    "origin": "claim",
                    "asserted_by": claim.asserted_by,
                    "source": object_value.get("source"),
                    "claim_ids": [cast(str, claim.id)],
                    "evidence_count": len(refs),
                    "evidence": [ref.model_dump(mode="json") for ref in refs],
                }
        legacy_value = (legacy_value or "").strip() or None
        return {
            "value": legacy_value,
            "origin": "legacy" if legacy_value else None,
            "asserted_by": None,
            "source": None,
            "claim_ids": [],
            "evidence_count": 0,
            "evidence": [],
        }

    return {
        "funding_type": _field("funding_type", legacy_funding_type),
        "bias_rating": _field("bias_rating", legacy_bias_rating),
        "factual_reporting": _field("factual_reporting", legacy_factual_reporting),
    }


async def _external_ids_for_entity(
    db: AsyncSession, evidence_entity_id: str
) -> list[dict[str, Any]]:
    """Return public external identifiers for an entity, with a link where the scheme is known."""
    rows = list(
        (
            await db.execute(
                select(EntityExternalId).where(EntityExternalId.entity_id == evidence_entity_id)
            )
        )
        .scalars()
        .all()
    )
    results: list[dict[str, Any]] = []
    for row in rows:
        scheme = cast(str, row.scheme)
        if scheme in _INTERNAL_EXTERNAL_ID_SCHEMES:
            continue
        value = cast(str, row.value)
        template = _EXTERNAL_ID_LINK_TEMPLATES.get(scheme)
        results.append(
            {
                "scheme": scheme,
                "value": value,
                "url": template.format(value=value) if template else None,
            }
        )
    return results


def _node_summary(node: AtlasNode) -> dict[str, Any]:
    return {
        "entity_id": node.id,
        "label": node.label,
        "entity_type": node.entity_type,
        "profile_path": node.profile_path,
    }


def _ownership_chain_entry(
    node: AtlasNode,
    *,
    percentage: float | None,
    percentage_range: Any,
    evidence_count: int,
    claim_ids: list[str],
) -> dict[str, Any]:
    return {
        **_node_summary(node),
        "percentage": percentage,
        "percentage_range": percentage_range,
        "evidence_count": evidence_count,
        "claim_ids": claim_ids,
    }


def _controls_walk(
    entity_id: str,
    node_by_id: dict[str, AtlasNode],
    controls_index: dict[str, list[AtlasEdge]],
) -> list[dict[str, Any]]:
    controls: list[dict[str, Any]] = []
    for edge in walk_controls_downward(entity_id, controls_index):
        owned_node = node_by_id.get(edge.target_id)
        if owned_node is None:
            continue
        controls.append(
            {
                **_node_summary(owned_node),
                "relation_type": edge.raw_relation_type,
                "percentage": edge.ownership_percentage,
                "evidence_count": edge.evidence_count,
                "claim_ids": edge.claim_ids,
            }
        )
    return controls


def _siblings_via_owner(
    ownership_graph: AtlasGraphResponse,
    entity_id: str,
    node_by_id: dict[str, AtlasNode],
) -> list[dict[str, Any]]:
    siblings: list[dict[str, Any]] = []
    for edge in ownership_graph.edges:
        if edge.relation_type != "sibling_via_owner":
            continue
        if edge.source_id == entity_id:
            sibling_id = edge.target_id
        elif edge.target_id == entity_id:
            sibling_id = edge.source_id
        else:
            continue
        sibling_node = node_by_id.get(sibling_id)
        if sibling_node is None:
            continue
        siblings.append(
            {
                **_node_summary(sibling_node),
                "evidence_count": edge.evidence_count,
                "claim_ids": edge.claim_ids,
            }
        )
    return siblings


async def _ownership_context(
    db: AsyncSession, entity_id: str, fallback_node_by_id: dict[str, AtlasNode]
) -> dict[str, Any]:
    """Ownership chain, downward "controls" rollup, and outlet siblings for one entity.

    Fetches the full outlet/organization/person Atlas projection (not
    neighbor-limited, unlike the rest of `get_atlas_entity`) so multi-hop
    chains and downward control walks see beyond the entity's immediate
    connections. Reuses the Phase 2 root-walk helpers from
    `atlas_evidence_projection` (`walk_ownership_chain`/
    `walk_controls_downward`, backed by `build_interest_edge_index`/
    `build_controls_index`) rather than re-deriving the walk here --
    the exact same cycle-guarded, depth-capped logic that powers the
    `sibling_via_owner` rollup.
    """
    ownership_graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=_OWNERSHIP_ENTITY_TYPES,
            limit_nodes=600,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )
    node_by_id = {item.id: item for item in ownership_graph.nodes}
    edge_by_owned = build_interest_edge_index(ownership_graph.edges)
    controls_index = build_controls_index(ownership_graph.edges)

    chain_edges = walk_ownership_chain(entity_id, edge_by_owned)
    chain: list[dict[str, Any]] = []
    self_node = node_by_id.get(entity_id) or fallback_node_by_id.get(entity_id)
    if self_node is not None:
        chain.append(
            _ownership_chain_entry(
                self_node,
                percentage=None,
                percentage_range=None,
                evidence_count=0,
                claim_ids=[],
            )
        )
    for edge in chain_edges:
        owner_node = node_by_id.get(edge.source_id)
        if owner_node is None:
            continue
        chain.append(
            _ownership_chain_entry(
                owner_node,
                percentage=edge.ownership_percentage,
                percentage_range=edge.qualifiers.get("pct_range"),
                evidence_count=edge.evidence_count,
                claim_ids=edge.claim_ids,
            )
        )

    controls = _controls_walk(entity_id, node_by_id, controls_index)
    siblings = _siblings_via_owner(ownership_graph, entity_id, node_by_id)
    return {"ownership_chain": chain, "controls": controls, "siblings_via_owner": siblings}


def _catalog_sources() -> dict[str, dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for raw_name, raw_config in get_rss_sources().items():
        name = raw_name.split(" - ")[0].strip()
        unique.setdefault(name, raw_config)
    return unique


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii") + b"===").decode("ascii")
        return max(int(decoded), 0)
    except (ValueError, UnicodeDecodeError):
        return 0


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode("ascii")).decode("ascii").rstrip("=")


async def _outlet_evidence_entity_id(db: AsyncSession, entity_id: str) -> str | None:
    """Resolve an "outlet:<digest>" Atlas id to its underlying `EvidenceEntity.id`.

    `None` when the outlet hasn't gone through Phase 0's catalog backfill
    yet (no `rss_catalog_key` external id recorded for it) -- callers treat
    that as "no evidence-spine entity to query claims against", not an
    error.
    """
    row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "rss_catalog_key",
                EntityExternalId.value == entity_id,
            )
        )
    ).scalar_one_or_none()
    return cast(str, row.entity_id) if row is not None else None


async def _outlet_name_for_id(db: AsyncSession, entity_id: str) -> str | None:
    """Resolve an "outlet:<digest>" Atlas id back to a catalog source name.

    Checks the evidence spine's preserved `rss_catalog_key` external id
    first (the authoritative post-backfill mapping), then falls back to
    recomputing the digest from every catalog name for a fresh DB that has
    not run Phase 0's backfill yet.
    """
    evidence_entity_id = await _outlet_evidence_entity_id(db, entity_id)
    if evidence_entity_id is not None:
        entity = await db.get(EvidenceEntity, evidence_entity_id)
        if entity is not None:
            return cast(str, entity.canonical_name)
    for source_name in _catalog_sources():
        if stable_source_id(source_name) == entity_id:
            return source_name
    return None


async def search_atlas(db: AsyncSession, query: str, limit: int = 8) -> AtlasSearchResponse:
    """Search the bounded Atlas projection for grouped entity matches."""
    normalized_query = normalize_entity_label(query)
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization", "person", "reporter"],
            limit_nodes=None,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )

    def score(node: AtlasNode) -> tuple[int, int, str]:
        normalized_label = normalize_entity_label(node.label)
        if normalized_label == normalized_query:
            match_rank = 0
        elif normalized_label.startswith(normalized_query):
            match_rank = 1
        elif normalized_query in normalized_label:
            match_rank = 2
        else:
            metadata = normalize_entity_label(
                " ".join(
                    value
                    for value in (node.subtitle, node.country_code, node.funding_type)
                    if value
                )
            )
            match_rank = 3 if normalized_query in metadata else 9
        return (match_rank, -node.connection_count, node.label.casefold())

    matched = [node for node in graph.nodes if score(node)[0] < 9]
    matched.sort(key=score)

    grouped: dict[str, list[AtlasSearchItem]] = {
        "outlet": [],
        "organization": [],
        "person": [],
        "reporter": [],
    }
    for node in matched:
        bucket = grouped[node.entity_type]
        if len(bucket) >= limit:
            continue
        bucket.append(
            AtlasSearchItem(
                id=node.id,
                entity_type=node.entity_type,
                label=node.label,
                subtitle=node.subtitle,
                country_code=node.country_code,
                confidence_tier=node.confidence_tier,
                profile_path=node.profile_path,
            )
        )
    return AtlasSearchResponse(
        query=query,
        outlets=grouped["outlet"],
        organizations=grouped["organization"],
        people=grouped["person"],
        reporters=grouped["reporter"],
    )


def _direct_connections(
    graph: AtlasGraphResponse,
    entity_id: str,
    node_by_id: dict[str, AtlasNode],
) -> tuple[list[AtlasConnectionRecord], list[Any]]:
    connections: list[AtlasConnectionRecord] = []
    evidence: list[Any] = []
    for edge in graph.edges:
        if edge.source_id == entity_id:
            related = node_by_id.get(edge.target_id)
        elif edge.target_id == entity_id:
            related = node_by_id.get(edge.source_id)
        else:
            continue
        if related is None:
            continue
        connections.append(AtlasConnectionRecord(edge=edge, entity=related))
        evidence.extend(edge.evidence_preview)
    return connections, evidence


def _owner_edge_connections(
    graph: AtlasGraphResponse,
    entity_id: str,
    node_by_id: dict[str, AtlasNode],
    connections: list[AtlasConnectionRecord],
) -> tuple[list[AtlasConnectionRecord], list[Any]]:
    owner_ids = _current_owner_ids(connections, entity_id)
    connected_edge_ids = {item.edge.id for item in connections}
    records: list[AtlasConnectionRecord] = []
    evidence: list[Any] = []
    for edge in graph.edges:
        if not _is_pending_owner_edge(edge, connected_edge_ids, owner_ids):
            continue
        related_id = edge.target_id if edge.source_id in owner_ids else edge.source_id
        related = node_by_id.get(related_id)
        if related is None:
            continue
        records.append(AtlasConnectionRecord(edge=edge, entity=related))
        evidence.extend(edge.evidence_preview)
    return records, evidence


def _current_owner_ids(connections: list[AtlasConnectionRecord], entity_id: str) -> set[str]:
    return {
        item.entity.id
        for item in connections
        if item.edge.accepted_fact
        and item.edge.lifecycle_state == "current"
        and item.edge.target_id == entity_id
        and item.edge.predicate
        in {"directly_owns", "owns_equity_in", "controls", "brand_of", "operated_by"}
    }


def _is_pending_owner_edge(
    edge: AtlasEdge,
    connected_edge_ids: set[str],
    owner_ids: set[str],
) -> bool:
    if edge.id in connected_edge_ids:
        return False
    if edge.lifecycle_state not in {"proposed", "pending", "disputed"}:
        return False
    return bool({edge.source_id, edge.target_id} & owner_ids)


def _collect_connections(
    graph: AtlasGraphResponse,
    entity_id: str,
    node_by_id: dict[str, AtlasNode],
) -> tuple[list[AtlasConnectionRecord], list[Any]]:
    """Build the entity's connection records plus deduplicated evidence preview."""
    connections, evidence = _direct_connections(graph, entity_id, node_by_id)
    owner_records, owner_evidence = _owner_edge_connections(
        graph, entity_id, node_by_id, connections
    )
    connections.extend(owner_records)
    evidence.extend(owner_evidence)
    return connections, evidence


def _claim_payload(claim: SourceClaim) -> dict[str, Any]:
    return {
        "id": claim.id,
        "type": claim.claim_type,
        "value": claim.claim_value,
        "kind": claim.claim_kind,
        "confidence": claim.confidence,
        "valid_from": claim.valid_from,
        "valid_to": claim.valid_to,
    }


def _metadata_fields(
    metadata: SourceMetadata | None,
    config: dict[str, Any],
) -> dict[str, Any]:
    if metadata is None:
        return {
            "source_type": None,
            "funding_type": config.get("funding_type"),
            "bias_rating": config.get("bias_rating"),
            "factual_reporting": config.get("factual_reporting"),
            "credibility_score": None,
            "parent_company": None,
            "geographic_focus": [],
            "topic_focus": [],
        }
    return {
        "source_type": metadata.source_type,
        "funding_type": cast(
            str | None,
            metadata.funding_type or config.get("funding_type"),
        ),
        "bias_rating": cast(
            str | None,
            metadata.political_bias or config.get("bias_rating"),
        ),
        "factual_reporting": cast(
            str | None,
            metadata.factual_rating or config.get("factual_reporting"),
        ),
        "credibility_score": cast(float | None, metadata.credibility_score),
        "parent_company": metadata.parent_company,
        "geographic_focus": cast(list[str], metadata.geographic_focus),
        "topic_focus": cast(list[str], metadata.topic_focus),
    }


def _outlet_detail_payload(
    source_name: str,
    config: dict[str, Any],
    metadata: SourceMetadata | None,
    claims: Sequence[SourceClaim],
    analysis_scores: dict[str, int],
) -> dict[str, Any]:
    metadata_fields = _metadata_fields(metadata, config)
    return {
        "source_name": source_name,
        "website": config.get("site_url") or config.get("url"),
        "source_type": metadata_fields["source_type"],
        "category": config.get("category"),
        "funding_type": metadata_fields["funding_type"],
        "bias_rating": metadata_fields["bias_rating"],
        "factual_reporting": metadata_fields["factual_reporting"],
        "credibility_score": metadata_fields["credibility_score"],
        "parent_company": metadata_fields["parent_company"],
        "geographic_focus": metadata_fields["geographic_focus"],
        "topic_focus": metadata_fields["topic_focus"],
        "claims": [_claim_payload(claim) for claim in claims],
        "analysis_scores": analysis_scores,
    }


async def _outlet_source_details(
    db: AsyncSession, entity_id: str
) -> tuple[str, dict[str, Any], datetime | None] | None:
    """Resolve an outlet id to its catalog details, or None when the outlet is unknown."""
    source_name = await _outlet_name_for_id(db, entity_id)
    if source_name is None:
        return None
    config = _catalog_sources().get(source_name, {})
    metadata = (
        await db.execute(select(SourceMetadata).where(SourceMetadata.source_name == source_name))
    ).scalar_one_or_none()
    claims = list(
        (
            await db.execute(
                select(SourceClaim).where(
                    SourceClaim.source_name == source_name,
                    SourceClaim.is_current.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    claim_ids = [claim.id for claim in claims if claim.id is not None]
    claim_evidence = []
    if claim_ids:
        claim_evidence = list(
            (
                await db.execute(
                    select(SourceClaimEvidence).where(SourceClaimEvidence.claim_id.in_(claim_ids))
                )
            )
            .scalars()
            .all()
        )
    analysis_scores = {
        cast(str, score_row.axis_name): cast(int, score_row.score)
        for score_row in (
            (
                await db.execute(
                    select(SourceAnalysisScore).where(
                        SourceAnalysisScore.source_name == source_name
                    )
                )
            )
            .scalars()
            .all()
        )
    }
    last_verified_at = (
        max(
            (row.retrieved_at for row in claim_evidence if row.retrieved_at),
            default=None,
        )
        if claim_evidence
        else None
    )
    return (
        source_name,
        _outlet_detail_payload(source_name, config, metadata, claims, analysis_scores),
        last_verified_at,
    )


async def _outlet_entity_details(
    db: AsyncSession,
    entity_id: str,
    node_by_id: dict[str, AtlasNode],
) -> tuple[dict[str, Any], str | None, datetime | None] | None:
    """Build the details block for an outlet entity, or None when unknown."""
    resolved = await _outlet_source_details(db, entity_id)
    if resolved is None:
        return None
    _source_name, details, last_verified_at = resolved
    outlet_evidence_entity_id = await _outlet_evidence_entity_id(db, entity_id)
    entity_kind = None
    if outlet_evidence_entity_id:
        outlet_evidence_entity = await db.get(EvidenceEntity, outlet_evidence_entity_id)
        if outlet_evidence_entity is not None:
            entity_kind = cast(str, outlet_evidence_entity.entity_kind)
    details["funding_and_bias"] = await _funding_and_bias_block(
        db,
        outlet_evidence_entity_id,
        legacy_funding_type=cast(str | None, details["funding_type"]),
        legacy_bias_rating=cast(str | None, details["bias_rating"]),
        legacy_factual_reporting=cast(str | None, details["factual_reporting"]),
    )
    details.update(await _ownership_context(db, entity_id, node_by_id))
    return details, entity_kind, last_verified_at


def _legacy_org_details(org: Organization) -> dict[str, Any]:
    return {
        "funding_type": org.funding_type,
        "funding_sources": org.funding_sources or [],
        "major_advertisers": org.major_advertisers or [],
        "annual_revenue": org.annual_revenue,
        "website": org.website or org.official_website,
        "wikipedia_url": org.wikipedia_url,
        "research_sources": org.research_sources or [],
        "conflict_flags": org.conflict_flags or [],
        "media_bias_rating": org.media_bias_rating,
        "factual_reporting": org.factual_reporting,
    }


async def _resolve_legacy_organization(
    db: AsyncSession,
    evidence_entity_id: str,
) -> tuple[dict[str, Any] | None, datetime | None]:
    # Enrich from the legacy `Organization` row when Phase 0's backfill
    # linked one via `legacy_organization_id` -- read-path only, not a
    # node/edge source (see atlas_graph_projection.py module docstring).
    legacy_id_row = (
        await db.execute(
            select(EntityExternalId).where(
                EntityExternalId.scheme == "legacy_organization_id",
                EntityExternalId.entity_id == evidence_entity_id,
            )
        )
    ).scalar_one_or_none()
    if legacy_id_row is None:
        return None, None
    try:
        org = await db.get(Organization, int(cast(str, legacy_id_row.value)))
    except ValueError:
        return None, None
    if org is None:
        return None, None
    return _legacy_org_details(org), org.last_researched_at


async def _organization_entity_details(
    db: AsyncSession,
    entity_id: str,
    connections: list[AtlasConnectionRecord],
    node_by_id: dict[str, AtlasNode],
) -> tuple[dict[str, Any], str | None, datetime | None] | None:
    """Build the details block for an organization entity, or None when unknown."""
    evidence_entity_id = entity_id.split(":", 1)[1]
    entity = await db.get(EvidenceEntity, evidence_entity_id)
    if entity is None:
        return None
    entity_kind = cast(str, entity.entity_kind)
    details = {
        "organization_type": entity.record_kind,
        "legal_name": entity.canonical_name,
        "status": entity.status,
        "external_ids": await _external_ids_for_entity(db, evidence_entity_id),
        "role_breakdown": dict(
            Counter(item.edge.raw_relation_type or item.edge.relation_type for item in connections)
        ),
    }
    legacy_details, legacy_verified_at = await _resolve_legacy_organization(db, evidence_entity_id)
    if legacy_details is not None:
        details.update(legacy_details)
    last_verified_at = legacy_verified_at if legacy_verified_at is not None else entity.updated_at
    details["funding_and_bias"] = await _funding_and_bias_block(
        db,
        evidence_entity_id,
        legacy_funding_type=cast(str | None, details.get("funding_type")),
        legacy_bias_rating=cast(str | None, details.get("media_bias_rating")),
        legacy_factual_reporting=cast(str | None, details.get("factual_reporting")),
    )
    details.update(await _ownership_context(db, entity_id, node_by_id))
    return details, entity_kind, last_verified_at


async def _person_entity_details(
    db: AsyncSession,
    entity_id: str,
    connections: list[AtlasConnectionRecord],
    node_by_id: dict[str, AtlasNode],
) -> tuple[dict[str, Any], str | None, datetime | None] | None:
    """Build the details block for a person entity, or None when unknown."""
    evidence_entity_id = entity_id.split(":", 1)[1]
    entity = await db.get(EvidenceEntity, evidence_entity_id)
    if entity is None:
        return None
    entity_kind = cast(str, entity.entity_kind)
    details = {
        "canonical_name": entity.canonical_name,
        "status": entity.status,
        "external_ids": await _external_ids_for_entity(db, evidence_entity_id),
        "role_breakdown": dict(
            Counter(item.edge.raw_relation_type or item.edge.relation_type for item in connections)
        ),
    }
    details.update(await _ownership_context(db, entity_id, node_by_id))
    return details, entity_kind, entity.updated_at


def _person_level_evidence(reporter: Reporter) -> list[str]:
    return [
        value
        for value in (
            reporter.author_page_url,
            reporter.canonical_author_url,
            reporter.wikipedia_url,
            reporter.wikidata_url,
        )
        if value
    ]


def _reporter_details_fields(reporter: Reporter) -> dict[str, Any]:
    return {
        "canonical_name": reporter.canonical_name or reporter.name,
        "match_status": reporter.match_status,
        "person_level_evidence": _person_level_evidence(reporter),
        "career_history": reporter.career_history or [],
        "institutional_affiliations": reporter.institutional_affiliations or [],
        "topics": reporter.topics or [],
        "education": reporter.education or [],
        "article_count": reporter.article_count or 0,
        "political_leaning": reporter.political_leaning,
        "leaning_confidence": reporter.leaning_confidence,
        "research_sources": reporter.research_sources or [],
        "match_explanation": reporter.match_explanation,
    }


async def _reporter_entity_details(
    db: AsyncSession, entity_id: str
) -> tuple[dict[str, Any], str | None, datetime | None] | None:
    """Build the details block for a reporter entity, or None when unknown."""
    try:
        reporter_id = int(entity_id.split(":", 1)[1])
    except ValueError:
        return None
    reporter = await db.get(Reporter, reporter_id)
    if reporter is None:
        return None
    return _reporter_details_fields(reporter), "reporter", reporter.last_researched_at


async def _entity_detail_block(
    db: AsyncSession,
    entity_id: str,
    connections: list[AtlasConnectionRecord],
    node_by_id: dict[str, AtlasNode],
) -> tuple[dict[str, Any], str | None, datetime | None] | None:
    if entity_id.startswith("outlet:"):
        return await _outlet_entity_details(db, entity_id, node_by_id)
    if entity_id.startswith("organization:"):
        return await _organization_entity_details(db, entity_id, connections, node_by_id)
    if entity_id.startswith("person:"):
        return await _person_entity_details(db, entity_id, connections, node_by_id)
    if entity_id.startswith("reporter:"):
        return await _reporter_entity_details(db, entity_id)
    return {}, None, None


async def get_atlas_entity(db: AsyncSession, entity_id: str) -> AtlasEntityRecord | None:
    """Load one Atlas entity with its details, evidence, and connections."""
    entity_id = normalize_entity_id_alias(entity_id)
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization", "person", "reporter"],
            selected=entity_id,
            neighbors=2,
            limit_nodes=350,
            limit_edges=1500,
            include_evidence_preview=True,
        ),
    )
    node = next((item for item in graph.nodes if item.id == entity_id), None)
    if node is None:
        return None

    node_by_id = {item.id: item for item in graph.nodes}
    connections, evidence = _collect_connections(graph, entity_id, node_by_id)

    built = await _entity_detail_block(db, entity_id, connections, node_by_id)
    if built is None:
        return None
    details, entity_kind, last_verified_at = built

    deduped_evidence = {item.id: item for item in evidence}
    return AtlasEntityRecord(
        id=node.id,
        entity_type=node.entity_type,
        label=node.label,
        subtitle=node.subtitle,
        country_code=node.country_code,
        status=node.status,
        confidence_tier=node.confidence_tier,
        last_verified_at=last_verified_at or node.updated_at,
        profile_path=node.profile_path,
        details=details,
        entity_kind=entity_kind,
        dossier_sections=_build_dossier_sections(entity_id, details, connections),
        evidence=list(deduped_evidence.values()),
        connections=sorted(
            connections,
            key=lambda item: (
                -(item.edge.confidence or 0),
                -item.edge.evidence_count,
                item.entity.label.casefold(),
            ),
        ),
    )


def _sort_index_items(items: list[AtlasNode], sort: str) -> None:
    """Sort index items in place per the requested order."""
    if sort == "most_connected":
        items.sort(key=lambda node: (-node.connection_count, node.label.casefold()))
    elif sort == "most_articles":
        items.sort(key=lambda node: (-node.article_count, node.label.casefold()))
    elif sort == "recently_indexed":
        items.sort(
            key=lambda node: (
                -(node.updated_at.timestamp() if node.updated_at else 0),
                node.label.casefold(),
            )
        )
    elif sort == "lowest_confidence":
        tier_order = {
            "unresolved": 0,
            "likely": 1,
            "strong": 2,
            "verified": 3,
            None: -1,
        }
        items.sort(
            key=lambda node: (
                tier_order.get(node.confidence_tier, 0),
                node.label.casefold(),
            )
        )
    else:
        items.sort(key=lambda node: node.label.casefold())


def _facet_counter(items: list[AtlasNode], attr: str) -> dict[str, int]:
    return dict(Counter(getattr(item, attr) for item in items if getattr(item, attr)))


def _build_index_facets(
    items: list[AtlasNode], kind_facet: dict[str, int]
) -> dict[str, dict[str, int]]:
    return {
        "entity_type": _facet_counter(items, "entity_type"),
        "country": _facet_counter(items, "country_code"),
        "funding": _facet_counter(items, "funding_type"),
        "bias": _facet_counter(items, "bias_rating"),
        "status": _facet_counter(items, "status"),
        "confidence": _facet_counter(items, "confidence_tier"),
        "kind": kind_facet,
    }


async def list_atlas_index(
    db: AsyncSession,
    *,
    entity_types: list[AtlasEntityType],
    query: str | None,
    country: list[str],
    funding: list[str],
    bias: list[str],
    kind: list[str] | None = None,
    sort: str,
    cursor: str | None,
    limit: int,
) -> AtlasIndexResponse:
    """Return a filtered, sorted, cursor-based entity index page."""
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=entity_types,
            q=query,
            country=country,
            funding=funding,
            bias=bias,
            limit_nodes=None,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )
    items = list(graph.nodes)
    # Facet the available kinds (node subtitle, e.g. "legal entity",
    # "organization without legal identity") before narrowing by `kind`
    # itself, so the filter pills stay populated once one is selected.
    kind_facet = dict(Counter(node.subtitle for node in items if node.subtitle))
    # `kind` narrows on the node subtitle -- the finer-grained entity
    # subtype the graph projection already stamps on every node. It is
    # applied client-side (post-graph) rather than threaded through
    # AtlasGraphFilters/build_atlas_graph because it is purely a facet over
    # already-loaded nodes, not a query-shaping concern.
    if kind:
        wanted = {value.casefold() for value in kind}
        items = [node for node in items if (node.subtitle or "").casefold() in wanted]
    _sort_index_items(items, sort)

    offset = _decode_cursor(cursor)
    page = items[offset : offset + limit]
    next_offset = offset + len(page)
    facets = _build_index_facets(items, kind_facet)
    return AtlasIndexResponse(
        items=page,
        total=len(items),
        next_cursor=_encode_cursor(next_offset) if next_offset < len(items) else None,
        facets=facets,
    )
