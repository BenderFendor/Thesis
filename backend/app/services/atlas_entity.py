"""Entity, search, and paginated index services for the Intelligence Atlas."""

from __future__ import annotations

import base64
from collections import Counter
from collections.abc import Sequence
from datetime import datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.data.rss_sources import get_rss_sources
from app.database import (
    Organization,
    Reporter,
    SourceClaim,
    SourceClaimEvidence,
    SourceAnalysisScore,
    SourceMetadata,
)
from app.models.atlas import (
    AtlasConnectionRecord,
    AtlasEntityRecord,
    AtlasEntityType,
    AtlasGraphFilters,
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
            {
                **_node_summary(self_node),
                "percentage": None,
                "percentage_range": None,
                "evidence_count": 0,
                "claim_ids": [],
            }
        )
    for edge in chain_edges:
        owner_node = node_by_id.get(edge.source_id)
        if owner_node is None:
            continue
        chain.append(
            {
                **_node_summary(owner_node),
                "percentage": edge.ownership_percentage,
                "percentage_range": edge.qualifiers.get("pct_range"),
                "evidence_count": edge.evidence_count,
                "claim_ids": edge.claim_ids,
            }
        )

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

    siblings: list[dict[str, Any]] = []
    if entity_id.startswith("outlet:"):
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
            limit_nodes=600,
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


async def get_atlas_entity(db: AsyncSession, entity_id: str) -> AtlasEntityRecord | None:
    """Load one Atlas entity with its details, evidence, and connections."""
    entity_id = normalize_entity_id_alias(entity_id)
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["outlet", "organization", "person", "reporter"],
            selected=entity_id,
            neighbors=1,
            limit_nodes=350,
            limit_edges=1500,
            include_evidence_preview=True,
        ),
    )
    node = next((item for item in graph.nodes if item.id == entity_id), None)
    if node is None:
        return None

    node_by_id = {item.id: item for item in graph.nodes}
    connections: list[AtlasConnectionRecord] = []
    evidence = []
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

    details: dict[str, Any] = {}
    last_verified_at: datetime | None = None
    if entity_id.startswith("outlet:"):
        source_name = await _outlet_name_for_id(db, entity_id)
        if source_name is None:
            return None
        config = _catalog_sources().get(source_name, {})
        metadata = (
            await db.execute(
                select(SourceMetadata).where(SourceMetadata.source_name == source_name)
            )
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
                        select(SourceClaimEvidence).where(
                            SourceClaimEvidence.claim_id.in_(claim_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
        details = {
            "source_name": source_name,
            "website": config.get("site_url") or config.get("url"),
            "source_type": metadata.source_type if metadata else None,
            "category": config.get("category"),
            "funding_type": cast(
                str | None,
                (metadata.funding_type if metadata else None) or config.get("funding_type"),
            ),
            "bias_rating": cast(
                str | None,
                (metadata.political_bias if metadata else None) or config.get("bias_rating"),
            ),
            "factual_reporting": cast(
                str | None,
                (metadata.factual_rating if metadata else None) or config.get("factual_reporting"),
            ),
            "credibility_score": cast(
                float | None, metadata.credibility_score if metadata else None
            ),
            "parent_company": metadata.parent_company if metadata else None,
            "geographic_focus": cast(list[str], metadata.geographic_focus if metadata else []),
            "topic_focus": cast(list[str], metadata.topic_focus if metadata else []),
            "claims": [
                {
                    "id": claim.id,
                    "type": claim.claim_type,
                    "value": claim.claim_value,
                    "kind": claim.claim_kind,
                    "confidence": claim.confidence,
                    "valid_from": claim.valid_from,
                    "valid_to": claim.valid_to,
                }
                for claim in claims
            ],
            "analysis_scores": {
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
            },
        }
        if claim_evidence:
            last_verified_at = max(
                (row.retrieved_at for row in claim_evidence if row.retrieved_at),
                default=None,
            )
        outlet_evidence_entity_id = await _outlet_evidence_entity_id(db, entity_id)
        details["funding_and_bias"] = await _funding_and_bias_block(
            db,
            outlet_evidence_entity_id,
            legacy_funding_type=cast(str | None, details["funding_type"]),
            legacy_bias_rating=cast(str | None, details["bias_rating"]),
            legacy_factual_reporting=cast(str | None, details["factual_reporting"]),
        )
        details.update(await _ownership_context(db, entity_id, node_by_id))
    elif entity_id.startswith("organization:"):
        evidence_entity_id = entity_id.split(":", 1)[1]
        entity = await db.get(EvidenceEntity, evidence_entity_id)
        if entity is None:
            return None
        details = {
            "organization_type": entity.record_kind,
            "legal_name": entity.canonical_name,
            "status": entity.status,
            "external_ids": await _external_ids_for_entity(db, evidence_entity_id),
            "role_breakdown": dict(
                Counter(
                    item.edge.raw_relation_type or item.edge.relation_type for item in connections
                )
            ),
        }
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
        if legacy_id_row is not None:
            try:
                org = await db.get(Organization, int(cast(str, legacy_id_row.value)))
            except ValueError:
                org = None
            if org is not None:
                details.update(
                    {
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
                )
                last_verified_at = org.last_researched_at
        if last_verified_at is None:
            last_verified_at = entity.updated_at
        details["funding_and_bias"] = await _funding_and_bias_block(
            db,
            evidence_entity_id,
            legacy_funding_type=cast(str | None, details.get("funding_type")),
            legacy_bias_rating=cast(str | None, details.get("media_bias_rating")),
            legacy_factual_reporting=cast(str | None, details.get("factual_reporting")),
        )
        details.update(await _ownership_context(db, entity_id, node_by_id))
    elif entity_id.startswith("person:"):
        evidence_entity_id = entity_id.split(":", 1)[1]
        entity = await db.get(EvidenceEntity, evidence_entity_id)
        if entity is None:
            return None
        details = {
            "canonical_name": entity.canonical_name,
            "status": entity.status,
            "external_ids": await _external_ids_for_entity(db, evidence_entity_id),
            "role_breakdown": dict(
                Counter(
                    item.edge.raw_relation_type or item.edge.relation_type for item in connections
                )
            ),
        }
        last_verified_at = entity.updated_at
        details.update(await _ownership_context(db, entity_id, node_by_id))
    elif entity_id.startswith("reporter:"):
        try:
            reporter_id = int(entity_id.split(":", 1)[1])
        except ValueError:
            return None
        reporter = await db.get(Reporter, reporter_id)
        if reporter is None:
            return None
        person_evidence = [
            value
            for value in (
                reporter.author_page_url,
                reporter.canonical_author_url,
                reporter.wikipedia_url,
                reporter.wikidata_url,
            )
            if value
        ]
        details = {
            "canonical_name": reporter.canonical_name or reporter.name,
            "match_status": reporter.match_status,
            "person_level_evidence": person_evidence,
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
        last_verified_at = reporter.last_researched_at

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


async def list_atlas_index(
    db: AsyncSession,
    *,
    entity_types: list[AtlasEntityType],
    query: str | None,
    country: list[str],
    funding: list[str],
    bias: list[str],
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
            limit_nodes=600,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )
    items = list(graph.nodes)
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

    offset = _decode_cursor(cursor)
    page = items[offset : offset + limit]
    next_offset = offset + len(page)
    facets: dict[str, dict[str, int]] = {
        "entity_type": dict(Counter(node.entity_type for node in items)),
        "country": dict(Counter(node.country_code for node in items if node.country_code)),
        "funding": dict(Counter(node.funding_type for node in items if node.funding_type)),
        "bias": dict(Counter(node.bias_rating for node in items if node.bias_rating)),
        "status": dict(Counter(node.status for node in items if node.status)),
        "confidence": dict(Counter(node.confidence_tier for node in items if node.confidence_tier)),
    }
    return AtlasIndexResponse(
        items=page,
        total=len(items),
        next_cursor=_encode_cursor(next_offset) if next_offset < len(items) else None,
        facets=facets,
    )
