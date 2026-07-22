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
from typing import Any, cast

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


async def _load_graph_projection(
    db: AsyncSession,
    filters: AtlasGraphFilters,
) -> tuple[list[AtlasNode], list[AtlasEdge], dict[str, int], datetime | None, bool]:
    catalog = _catalog_sources()
    metadata = list((await db.execute(select(SourceMetadata))).scalars().all())
    score_rows = list((await db.execute(select(SourceAnalysisScore))).scalars().all())

    reporter_enabled = (
        not filters.entity_types
        or "reporter" in filters.entity_types
        or bool(filters.selected and filters.selected.startswith("reporter:"))
    )
    reporters: list[Reporter] = []
    if reporter_enabled:
        reporter_stmt = (
            select(Reporter)
            .where(Reporter.article_count > 0)
            .order_by(Reporter.article_count.desc())
            .limit(min(max(filters.limit_nodes, 50), 600))
        )
        reporters = list((await db.execute(reporter_stmt)).scalars().all())

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

    survivors = await entity_survivor_map(db)
    publications = [
        entity for entity in await live_entities_by_kind(db, _PUBLICATION_KINDS, survivors)
    ]
    outlet_id_by_entity = await outlet_node_ids(db, publications)

    def _emit_outlet(source_name: str, node_id: str, config: dict[str, Any]) -> None:
        normalized = normalize_entity_label(source_name)
        meta = metadata_by_source.get(normalized)
        status = index_by_key.get(("source", normalized))
        article_count = article_counts.get(source_name, 0)
        nodes.append(
            AtlasNode(
                id=node_id,
                entity_type="outlet",
                label=source_name,
                subtitle=cast(
                    str | None,
                    (meta.source_type if meta else None) or config.get("category"),
                ),
                country_code=cast(
                    str | None,
                    (meta.country if meta else None) or config.get("country"),
                ),
                funding_type=cast(
                    str | None,
                    (meta.funding_type if meta else None) or config.get("funding_type"),
                ),
                bias_rating=cast(
                    str | None,
                    (meta.political_bias if meta else None) or config.get("bias_rating"),
                ),
                factual_reporting=cast(
                    str | None,
                    (meta.factual_rating if meta else None) or config.get("factual_reporting"),
                ),
                credibility_score=cast(float | None, meta.credibility_score if meta else None),
                analysis_scores=scores_by_source.get(normalized, {}),
                article_count=article_count,
                status=status.status if status else None,
                confidence_tier=confidence_tier(
                    _research_confidence(meta.research_confidence) if meta else None
                ),
                profile_path=f"/wiki/source/{source_name}",
                updated_at=(status.last_indexed_at if status else None)
                or (meta.updated_at if meta else None),
                flags=["needs-review"]
                if status and cast(str, status.status) in {"failed", "stale"}
                else [],
            )
        )

    if publications:
        for entity in publications:
            node_id = outlet_id_by_entity[cast(str, entity.id)]
            source_name = cast(str, entity.canonical_name)
            config = catalog.get(source_name, {})
            _emit_outlet(source_name, node_id, config)
    else:
        # Fallback: Phase 0 backfill has not run on this database yet. Project
        # outlets straight from the RSS catalog so the Atlas is never empty.
        for source_name, config in catalog.items():
            _emit_outlet(source_name, stable_source_id(source_name), config)

    for reporter in reporters:
        reporter_id = reporter.id
        normalized = normalize_entity_label(cast(str, reporter.name))
        status = index_by_key.get(("reporter", normalized))
        nodes.append(
            AtlasNode(
                id=f"reporter:{reporter_id}",
                entity_type="reporter",
                label=cast(str, reporter.canonical_name or reporter.name),
                subtitle="Reporter",
                article_count=int(reporter.article_count or 0),
                bias_rating=reporter.political_leaning,
                status=status.status if status else reporter.match_status,
                confidence_tier=reporter_confidence_tier(reporter),
                profile_path=f"/wiki/reporter/{reporter_id}",
                updated_at=(status.last_indexed_at if status else None) or reporter.updated_at,
            )
        )

    # Reporter -> organization `employed_by` edges, sourced from evidenced
    # `institutional_affiliations` only (no synthetic coauthor/shared_outlet
    # edges -- see module docstring / Phase 2 plan).
    if reporters:
        organizations = await live_entities_by_kind(db, _ORGANIZATION_KINDS, survivors)
        org_id_by_normalized: dict[str, str] = {}
        for org_entity in organizations:
            normalized_name = normalize_entity_label(cast(str, org_entity.canonical_name))
            if normalized_name:
                org_id_by_normalized.setdefault(
                    normalized_name,
                    f"organization:{canonical_entity_id(cast(str, org_entity.id), survivors)}",
                )

        for reporter in reporters:
            affiliations = reporter.institutional_affiliations or []
            if not isinstance(affiliations, list):
                continue
            for affiliation in affiliations:
                if not isinstance(affiliation, dict):
                    continue
                raw_name = (
                    affiliation.get("org")
                    or affiliation.get("name")
                    or affiliation.get("organization")
                )
                if not isinstance(raw_name, str):
                    continue
                affiliation_org_id = org_id_by_normalized.get(normalize_entity_label(raw_name))
                if not affiliation_org_id:
                    continue
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
                edges.append(
                    AtlasEdge(
                        id=_edge_id(source_id, affiliation_org_id, "employed_by", raw_name),
                        source_id=source_id,
                        target_id=affiliation_org_id,
                        relation_type="employed_by",
                        confidence=confidence,
                        confidence_tier=confidence_tier(confidence),
                        evidence_count=len(evidence),
                        evidence_preview=evidence if filters.include_evidence_preview else [],
                        is_inferred=not bool(evidence),
                        raw_relation_type="institutional_affiliation",
                    )
                )

    return (
        nodes,
        _dedupe_edges(edges),
        dict(index_counts),
        last_indexed_at,
        indexing_active,
    )
