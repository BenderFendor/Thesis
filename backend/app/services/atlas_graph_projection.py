"""Database projection for the Intelligence Atlas graph: outlets + reporters.

Outlet and reporter nodes, plus evidenced reporter->organization `employed_by`
edges. Organization/person nodes and every ownership-flavored edge (accepted
or candidate) live in `atlas_evidence_projection.py`; `atlas_graph.py` unions
both projections into one graph.

Outlet nodes are keyed off `EvidenceEntity(record_kind="publication")` rows
seeded by Phase 0's `entity_backfill.py`, which preserves the pre-rename
`stable_source_id` digest as `EntityExternalId(scheme="rss_catalog_key")` --
so an outlet's Atlas node id ("outlet:<digest>") never changes across the
`source` -> `outlet` rename, keeping old bookmarks/URLs valid.

**Fresh-DB fallback:** if the backfill has never run (no publication
entities exist yet), this module falls back to projecting outlet nodes
directly from the RSS catalog (`app/data/rss_sources.py`), exactly as the
pre-evidence-spine implementation did, so the Atlas still renders sources on
a brand new database. In that fallback mode no organization/person nodes or
ownership edges are produced (there is nothing in the spine to source them
from); reporter nodes and their `employed_by` edges are unaffected since
they read `Reporter`/`institutional_affiliations` independently of outlets.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, TypedDict, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import (
    Article,
    Reporter,
    SourceAnalysisScore,
    SourceMetadata,
    WikiIndexStatus,
)
from app.models.atlas import AtlasEdge, AtlasEvidenceRef, AtlasGraphFilters, AtlasNode
from app.models.evidence import ClaimEvidence, EvidenceClaim
from app.models.evidence import EvidenceEntity as EvSpineEntity
from app.services.atlas_entity_resolution import (
    canonical_entity_id,
    entity_survivor_map,
    live_entities_by_kind,
    outlet_node_ids,
)
from app.services.atlas_graph_helpers import (
    _catalog_sources,
    _dedupe_edges,
    _edge_id,
    _research_confidence,
    confidence_tier,
    normalize_entity_label,
    reporter_confidence_tier,
    stable_source_id,
)

_PUBLICATION_KINDS = ("publication", "digital_property", "feed")
_ORGANIZATION_KINDS = ("legal_entity", "organization_without_legal_identity")
_BYLINE_PREDICATES = ("authored_by", "employed_by")


class _OutletLookups(TypedDict):
    """Shared lookup maps passed to _outlet_node."""

    metadata_by_source: dict[str, SourceMetadata]
    index_by_key: dict[tuple[str, str], WikiIndexStatus]
    article_counts: dict[str, int]
    scores_by_source: dict[str, dict[str, int]]


async def _reporter_byline_edge_index(db: AsyncSession) -> dict[str, dict[str, int]]:
    """Aggregate evidence-spine byline claims into {reporter name -> {outlet entity id -> count}}.

    One SQL query, grouped in the database, not per-reporter round trips:
    every current `authored_by`/`employed_by` `EvidenceClaim` whose subject
    is a person, joined to its linked `ClaimEvidence` observations (a claim
    with zero linked observations contributes zero -- no free coverage) and
    grouped by (author canonical name, object entity id). `ingest_reporter_
    bylines.py` writes these claims as person -authored_by-> outlet directly
    (see that module's docstring for why), so the object id is already the
    outlet/organization entity id with no further resolution needed here.
    """
    stmt = (
        select(
            EvSpineEntity.canonical_name,
            EvidenceClaim.object_entity_id,
            func.count(func.distinct(ClaimEvidence.observation_id)),
        )
        .select_from(EvidenceClaim)
        .join(EvSpineEntity, EvSpineEntity.id == EvidenceClaim.subject_entity_id)
        .join(ClaimEvidence, ClaimEvidence.claim_id == EvidenceClaim.id)
        .where(
            EvidenceClaim.predicate.in_(_BYLINE_PREDICATES),
            EvidenceClaim.retracted_at.is_(None),
            EvSpineEntity.record_kind == "person",
            EvidenceClaim.object_entity_id.is_not(None),
        )
        .group_by(EvSpineEntity.canonical_name, EvidenceClaim.object_entity_id)
    )
    rows = (await db.execute(stmt)).all()
    index: dict[str, dict[str, int]] = defaultdict(dict)
    for author_name, object_entity_id, evidence_count in rows:
        if not object_entity_id:
            continue
        key = normalize_entity_label(cast(str, author_name))
        if not key:
            continue
        index[key][cast(str, object_entity_id)] = int(evidence_count)
    return index


async def _reporters(db: AsyncSession, filters: AtlasGraphFilters) -> list[Reporter]:
    reporter_enabled = (
        not filters.entity_types
        or "reporter" in filters.entity_types
        or bool(filters.selected and filters.selected.startswith("reporter:"))
    )
    if not reporter_enabled:
        return []
    # Excludes soft-retired rows (merged into a winner or split into
    # individuals -- audit recs 2-3) and pure wire/agency rows (audit
    # rec 4) from the denominator; none of them are deleted, they just
    # stop projecting as their own reporter node.
    reporter_stmt = (
        select(Reporter)
        .where(
            Reporter.article_count > 0,
            Reporter.retirement_reason.is_(None),
            Reporter.is_collective.is_(False),
        )
        .order_by(Reporter.article_count.desc())
    )
    if filters.limit_nodes is not None:
        reporter_stmt = reporter_stmt.limit(min(max(filters.limit_nodes, 50), 600))
    return list((await db.execute(reporter_stmt)).scalars().all())


def _outlet_meta_or_config(
    meta: SourceMetadata | None,
    attr: str,
    config: dict[str, Any],
    config_key: str,
) -> Any:
    meta_value = getattr(meta, attr) if meta else None
    return meta_value or config.get(config_key)


def _outlet_meta_only(meta: SourceMetadata | None, attr: str) -> Any:
    if meta is None:
        return None
    return getattr(meta, attr)


def _outlet_node(
    source_name: str,
    node_id: str,
    config: dict[str, Any],
    *,
    metadata_by_source: dict[str, SourceMetadata],
    index_by_key: dict[tuple[str, str], WikiIndexStatus],
    article_counts: dict[str, int],
    scores_by_source: dict[str, dict[str, int]],
) -> AtlasNode:
    normalized = normalize_entity_label(source_name)
    meta = metadata_by_source.get(normalized)
    status = index_by_key.get(("source", normalized))
    flags = ["needs-review"] if status and cast(str, status.status) in {"failed", "stale"} else []
    return AtlasNode(
        id=node_id,
        entity_type="outlet",
        label=source_name,
        subtitle=cast(
            str | None, _outlet_meta_or_config(meta, "source_type", config, "category")
        ),
        country_code=cast(
            str | None, _outlet_meta_or_config(meta, "country", config, "country")
        ),
        funding_type=cast(
            str | None,
            _outlet_meta_or_config(meta, "funding_type", config, "funding_type"),
        ),
        bias_rating=cast(
            str | None,
            _outlet_meta_or_config(meta, "political_bias", config, "bias_rating"),
        ),
        factual_reporting=cast(
            str | None,
            _outlet_meta_or_config(meta, "factual_rating", config, "factual_reporting"),
        ),
        credibility_score=cast(float | None, _outlet_meta_only(meta, "credibility_score")),
        analysis_scores=scores_by_source.get(normalized, {}),
        article_count=article_counts.get(source_name, 0),
        status=status.status if status else None,
        confidence_tier=confidence_tier(
            _research_confidence(meta.research_confidence) if meta else None
        ),
        profile_path=f"/wiki/source/{source_name}",
        updated_at=(status.last_indexed_at if status else None)
        or (meta.updated_at if meta else None),
        flags=flags,
    )


def _reporter_node(
    reporter: Reporter, index_by_key: dict[tuple[str, str], WikiIndexStatus]
) -> AtlasNode:
    normalized = normalize_entity_label(cast(str, reporter.name))
    status = index_by_key.get(("reporter", normalized))
    return AtlasNode(
        id=f"reporter:{reporter.id}",
        entity_type="reporter",
        label=cast(str, reporter.canonical_name or reporter.name),
        subtitle="Reporter",
        article_count=int(reporter.article_count or 0),
        bias_rating=reporter.political_leaning,
        status=status.status if status else reporter.match_status,
        confidence_tier=reporter_confidence_tier(reporter),
        profile_path=f"/wiki/reporter/{reporter.id}",
        updated_at=(status.last_indexed_at if status else None) or reporter.updated_at,
    )


def _byline_edges(
    reporters: list[Reporter],
    *,
    outlet_id_by_entity: dict[str, str],
    org_id_by_entity: dict[str, str],
    byline_index: dict[str, dict[str, int]],
) -> list[AtlasEdge]:
    edges: list[AtlasEdge] = []
    for reporter in reporters:
        normalized_reporter_name = normalize_entity_label(cast(str, reporter.name))
        source_id = f"reporter:{reporter.id}"
        for object_entity_id, evidence_count in byline_index.get(
            normalized_reporter_name, {}
        ).items():
            if evidence_count <= 0:
                continue
            # Outlets already in the RSS catalog resolve to the same
            # "publication" `EvidenceEntity` the ingestion backfill seeded
            # (matched by domain external id), so they land in the
            # outlet node map; a byline at an outlet outside the catalog
            # falls back to the organization bucket instead.
            target_id = outlet_id_by_entity.get(object_entity_id) or org_id_by_entity.get(
                object_entity_id
            )
            if not target_id:
                continue
            edges.append(
                AtlasEdge(
                    id=_edge_id(source_id, target_id, "authored_by", "byline"),
                    source_id=source_id,
                    target_id=target_id,
                    relation_type="employed_by",
                    predicate="authored_by",
                    confidence=0.6,
                    confidence_tier=confidence_tier(0.6),
                    evidence_count=evidence_count,
                    evidence_preview=[],
                    is_inferred=False,
                    raw_relation_type="article_byline",
                )
            )
    return edges


def _resolved_affiliations(
    affiliations: list[Any],
    org_id_by_normalized: dict[str, str],
) -> list[tuple[dict[str, Any], str, str]]:
    resolved: list[tuple[dict[str, Any], str, str]] = []
    for affiliation in affiliations:
        if not isinstance(affiliation, dict):
            continue
        raw_name = (
            affiliation.get("org") or affiliation.get("name") or affiliation.get("organization")
        )
        if not isinstance(raw_name, str):
            continue
        affiliation_org_id = org_id_by_normalized.get(normalize_entity_label(raw_name))
        if not affiliation_org_id:
            continue
        resolved.append((affiliation, raw_name, affiliation_org_id))
    return resolved


def _affiliation_edge(
    reporter: Reporter,
    affiliation: dict[str, Any],
    raw_name: str,
    affiliation_org_id: str,
    include_evidence_preview: bool,
) -> AtlasEdge:
    evidence_url = affiliation.get("url") or affiliation.get("source_url")
    evidence: list[AtlasEvidenceRef] = []
    if isinstance(evidence_url, str) and evidence_url:
        evidence.append(
            AtlasEvidenceRef(
                id=f"reporter-affiliation:{reporter.id}:{affiliation_org_id}",
                source_type="person_profile",
                source_name=cast(str, reporter.name),
                source_url=evidence_url,
                excerpt=cast(str | None, affiliation.get("role")),
            )
        )
    confidence = 0.9 if evidence else 0.62
    source_id = f"reporter:{reporter.id}"
    return AtlasEdge(
        id=_edge_id(source_id, affiliation_org_id, "employed_by", raw_name),
        source_id=source_id,
        target_id=affiliation_org_id,
        relation_type="employed_by",
        confidence=confidence,
        confidence_tier=confidence_tier(confidence),
        evidence_count=len(evidence),
        evidence_preview=evidence if include_evidence_preview else [],
        is_inferred=not bool(evidence),
        raw_relation_type="institutional_affiliation",
    )


def _affiliation_edges(
    reporters: list[Reporter],
    *,
    org_id_by_normalized: dict[str, str],
    include_evidence_preview: bool,
) -> list[AtlasEdge]:
    edges: list[AtlasEdge] = []
    for reporter in reporters:
        affiliations = reporter.institutional_affiliations or []
        if not isinstance(affiliations, list):
            continue
        for affiliation, raw_name, affiliation_org_id in _resolved_affiliations(
            affiliations, org_id_by_normalized
        ):
            edges.append(
                _affiliation_edge(
                    reporter,
                    affiliation,
                    raw_name,
                    affiliation_org_id,
                    include_evidence_preview,
                )
            )
    return edges


async def _employee_edges(
    db: AsyncSession,
    reporters: list[Reporter],
    *,
    survivors: dict[str, str],
    outlet_id_by_entity: dict[str, str],
    include_evidence_preview: bool,
) -> list[AtlasEdge]:
    organizations = await live_entities_by_kind(db, _ORGANIZATION_KINDS, survivors)
    org_id_by_entity: dict[str, str] = {}
    org_id_by_normalized: dict[str, str] = {}
    for org_entity in organizations:
        org_entity_id = cast(str, org_entity.id)
        org_node_id = f"organization:{canonical_entity_id(org_entity_id, survivors)}"
        org_id_by_entity[org_entity_id] = org_node_id
        normalized_name = normalize_entity_label(cast(str, org_entity.canonical_name))
        if normalized_name:
            org_id_by_normalized.setdefault(normalized_name, org_node_id)
    # Reporter -> organization `employed_by` edges, sourced from evidenced
    # `institutional_affiliations` only (no synthetic coauthor/shared_outlet
    # edges -- see module docstring / Phase 2 plan).
    byline_index = await _reporter_byline_edge_index(db)
    return _byline_edges(
        reporters,
        outlet_id_by_entity=outlet_id_by_entity,
        org_id_by_entity=org_id_by_entity,
        byline_index=byline_index,
    ) + _affiliation_edges(
        reporters,
        org_id_by_normalized=org_id_by_normalized,
        include_evidence_preview=include_evidence_preview,
    )


async def _load_graph_projection(
    db: AsyncSession,
    filters: AtlasGraphFilters,
) -> tuple[list[AtlasNode], list[AtlasEdge], dict[str, int], datetime | None, bool]:
    catalog = _catalog_sources()
    metadata = list((await db.execute(select(SourceMetadata))).scalars().all())
    score_rows = list((await db.execute(select(SourceAnalysisScore))).scalars().all())

    article_counts = {
        cast(str, source): int(count)
        for source, count in (
            await db.execute(
                select(Article.source, func.count(Article.id)).group_by(Article.source)
            )
        ).all()
    }

    index_rows = list((await db.execute(select(WikiIndexStatus))).scalars().all())
    index_by_key = {
        (
            cast(str, row.entity_type),
            normalize_entity_label(cast(str, row.entity_name)),
        ): row
        for row in index_rows
    }
    index_counts = Counter(cast(str, row.status) for row in index_rows)
    last_indexed_at = max(
        (row.last_indexed_at for row in index_rows if row.last_indexed_at),
        default=None,
    )
    indexing_active = any(cast(str, row.status) == "indexing" for row in index_rows)

    metadata_by_source = {
        normalize_entity_label(cast(str, row.source_name)): row for row in metadata
    }
    scores_by_source: dict[str, dict[str, int]] = defaultdict(dict)
    for score_row in score_rows:
        scores_by_source[normalize_entity_label(cast(str, score_row.source_name))][
            cast(str, score_row.axis_name)
        ] = cast(int, score_row.score)

    nodes: list[AtlasNode] = []
    edges: list[AtlasEdge] = []
    reporters = await _reporters(db, filters)

    survivors = await entity_survivor_map(db)
    publications = [
        entity for entity in await live_entities_by_kind(db, _PUBLICATION_KINDS, survivors)
    ]
    outlet_id_by_entity = await outlet_node_ids(db, publications)

    lookups: _OutletLookups = {
        "metadata_by_source": metadata_by_source,
        "index_by_key": index_by_key,
        "article_counts": article_counts,
        "scores_by_source": scores_by_source,
    }
    if publications:
        nodes = _outlet_nodes(publications, outlet_id_by_entity, catalog, lookups)
    else:
        nodes = _catalog_outlet_nodes(catalog, lookups)

    nodes.extend(_reporter_node(reporter, index_by_key) for reporter in reporters)

    if reporters:
        edges.extend(
            await _employee_edges(
                db,
                reporters,
                survivors=survivors,
                outlet_id_by_entity=outlet_id_by_entity,
                include_evidence_preview=filters.include_evidence_preview,
            )
        )

    return (
        nodes,
        _dedupe_edges(edges),
        dict(index_counts),
        last_indexed_at,
        indexing_active,
    )


def _outlet_nodes(
    publications: list[EvSpineEntity],
    outlet_id_by_entity: dict[str, str],
    catalog: dict[str, dict[str, Any]],
    lookups: _OutletLookups,
) -> list[AtlasNode]:
    nodes: list[AtlasNode] = []
    for entity in publications:
        node_id = outlet_id_by_entity[cast(str, entity.id)]
        source_name = cast(str, entity.canonical_name)
        config = catalog.get(source_name, {})
        nodes.append(_outlet_node(source_name, node_id, config, **lookups))
    return nodes


def _catalog_outlet_nodes(
    catalog: dict[str, dict[str, Any]],
    lookups: _OutletLookups,
) -> list[AtlasNode]:
    # Fallback: Phase 0 backfill has not run on this database yet. Project
    # outlets straight from the RSS catalog so the Atlas is never empty.
    return [
        _outlet_node(source_name, stable_source_id(source_name), config, **lookups)
        for source_name, config in catalog.items()
    ]
