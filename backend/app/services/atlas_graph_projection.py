"""Database projection for the Intelligence Atlas graph."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import (
    Article,
    ArticleAuthor,
    Organization,
    Reporter,
    SourceAnalysisScore,
    SourceClaim,
    SourceClaimEvidence,
    SourceMetadata,
    WikiIndexStatus,
)
from app.models.atlas import (
    AtlasEdge,
    AtlasEvidenceRef,
    AtlasGraphFilters,
    AtlasNode,
    AtlasRelationType,
)
from app.services.atlas_graph_helpers import (
    _LEGAL_ENTITY_CLAIM_TYPES,
    _OWNER_CLAIM_TYPES,
    _catalog_sources,
    _claim_name,
    _dedupe_edges,
    _edge_id,
    _evidence_ref,
    _parse_percentage,
    _research_confidence,
    confidence_tier,
    normalize_entity_label,
    reporter_confidence_tier,
    stable_source_id,
)


async def _load_graph_projection(
    db: AsyncSession,
    filters: AtlasGraphFilters,
) -> tuple[list[AtlasNode], list[AtlasEdge], int, dict[str, int], datetime | None, bool]:
    catalog = _catalog_sources()
    orgs = list((await db.execute(select(Organization))).scalars().all())
    metadata = list((await db.execute(select(SourceMetadata))).scalars().all())
    score_rows = list((await db.execute(select(SourceAnalysisScore))).scalars().all())
    claims = list(
        (await db.execute(select(SourceClaim).where(SourceClaim.is_current.is_(True))))
        .scalars()
        .all()
    )
    claim_ids = [claim.id for claim in claims if claim.id is not None]
    evidence_rows: list[SourceClaimEvidence] = []
    if claim_ids:
        evidence_rows = list(
            (
                await db.execute(
                    select(SourceClaimEvidence).where(SourceClaimEvidence.claim_id.in_(claim_ids))
                )
            )
            .scalars()
            .all()
        )

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
    evidence_by_claim: dict[int, list[AtlasEvidenceRef]] = defaultdict(list)
    for row in evidence_rows:
        evidence_by_claim[cast(int, row.claim_id)].append(_evidence_ref(row))
    claims_by_source: dict[str, list[SourceClaim]] = defaultdict(list)
    for claim in claims:
        claims_by_source[normalize_entity_label(cast(str, claim.source_name))].append(claim)

    org_alias_to_id: dict[str, int] = {}
    org_by_id: dict[int, Organization] = {}
    for org in orgs:
        org_id = cast(int, org.id)
        org_by_id[org_id] = org
        for alias in (cast(str, org.name), org.normalized_name):
            normalized = normalize_entity_label(alias)
            if normalized:
                org_alias_to_id.setdefault(normalized, org_id)

    nodes: list[AtlasNode] = []
    edges: list[AtlasEdge] = []
    unresolved_source_links = 0

    source_id_by_normalized: dict[str, str] = {}
    source_name_by_id: dict[str, str] = {}
    for source_name, config in catalog.items():
        normalized = normalize_entity_label(source_name)
        source_id = stable_source_id(source_name)
        source_id_by_normalized[normalized] = source_id
        source_name_by_id[source_id] = source_name
        meta = metadata_by_source.get(normalized)
        status = index_by_key.get(("source", normalized))
        article_count = article_counts.get(source_name, 0)
        nodes.append(
            AtlasNode(
                id=source_id,
                entity_type="source",
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

    for org in orgs:
        org_pk = org.id
        normalized = normalize_entity_label(cast(str, org.name))
        status = index_by_key.get(("organization", normalized))
        nodes.append(
            AtlasNode(
                id=f"organization:{org_pk}",
                entity_type="organization",
                label=cast(str, org.name),
                subtitle=org.org_type,
                funding_type=org.funding_type,
                bias_rating=org.media_bias_rating,
                factual_reporting=org.factual_reporting,
                status=status.status if status else None,
                confidence_tier=confidence_tier(_research_confidence(org.research_confidence)),
                profile_path=f"/wiki/ownership?selected=organization:{org_pk}",
                updated_at=(status.last_indexed_at if status else None) or org.updated_at,
            )
        )

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

    reporter_ids = [cast(int, reporter.id) for reporter in reporters]
    if reporter_ids:
        author_rows = (
            await db.execute(
                select(
                    ArticleAuthor.article_id,
                    ArticleAuthor.reporter_id,
                    Article.source,
                    Article.url,
                    Article.title,
                    Article.updated_at,
                )
                .join(Article, Article.id == ArticleAuthor.article_id)
                .where(ArticleAuthor.reporter_id.in_(reporter_ids))
            )
        ).all()
        article_reporters: dict[int, set[int]] = defaultdict(set)
        source_reporters: dict[str, set[int]] = defaultdict(set)
        article_evidence: dict[int, AtlasEvidenceRef] = {}
        for article_id, reporter_id, source_name, url, title, updated_at in author_rows:
            article_pk = int(article_id)
            reporter_pk = int(reporter_id)
            article_reporters[article_pk].add(reporter_pk)
            if source_name:
                source_reporters[cast(str, source_name)].add(reporter_pk)
            if filters.include_evidence_preview:
                article_evidence.setdefault(
                    article_pk,
                    AtlasEvidenceRef(
                        id=f"article:{article_pk}",
                        source_type="article_byline",
                        source_name=cast(str | None, source_name),
                        source_url=cast(str | None, url),
                        retrieved_at=cast(datetime | None, updated_at),
                        excerpt=cast(str | None, title),
                    ),
                )

        coauthor_weights: Counter[tuple[int, int]] = Counter()
        coauthor_articles: dict[tuple[int, int], list[int]] = defaultdict(list)
        for article_id, reporter_set in article_reporters.items():
            article_reporter_ids = sorted(reporter_set)
            for index, reporter_id in enumerate(article_reporter_ids):
                for peer_id in article_reporter_ids[index + 1 :]:
                    pair = (reporter_id, peer_id)
                    coauthor_weights[pair] += 1
                    if len(coauthor_articles[pair]) < 3:
                        coauthor_articles[pair].append(article_id)

        shared_outlet_weights: Counter[tuple[int, int]] = Counter()
        shared_outlet_names: dict[tuple[int, int], list[str]] = defaultdict(list)
        for source_name, reporter_set in source_reporters.items():
            source_reporter_ids = sorted(reporter_set)
            for index, reporter_id in enumerate(source_reporter_ids):
                for peer_id in source_reporter_ids[index + 1 :]:
                    pair = (reporter_id, peer_id)
                    if pair in coauthor_weights:
                        continue
                    shared_outlet_weights[pair] += 1
                    if len(shared_outlet_names[pair]) < 3:
                        shared_outlet_names[pair].append(source_name)

        network_edges: list[AtlasEdge] = []
        for (reporter_id, peer_id), weight in coauthor_weights.items():
            confidence = min(0.65 + (weight - 1) * 0.1, 0.95)
            evidence = [
                article_evidence[article_id]
                for article_id in coauthor_articles[(reporter_id, peer_id)]
                if article_id in article_evidence
            ]
            network_edges.append(
                AtlasEdge(
                    id=_edge_id(
                        f"reporter:{reporter_id}",
                        f"reporter:{peer_id}",
                        "coauthor",
                        str(weight),
                    ),
                    source_id=f"reporter:{reporter_id}",
                    target_id=f"reporter:{peer_id}",
                    relation_type="coauthor",
                    direction="undirected",
                    weight=float(weight),
                    confidence=confidence,
                    confidence_tier=confidence_tier(confidence),
                    evidence_count=weight,
                    evidence_preview=evidence,
                    last_verified_at=max(
                        (item.retrieved_at for item in evidence if item.retrieved_at),
                        default=None,
                    ),
                    raw_relation_type="article_author_cooccurrence",
                )
            )

        for (reporter_id, peer_id), weight in shared_outlet_weights.items():
            confidence = min(0.55 + (weight - 1) * 0.08, 0.82)
            outlet_names = shared_outlet_names[(reporter_id, peer_id)]
            network_edges.append(
                AtlasEdge(
                    id=_edge_id(
                        f"reporter:{reporter_id}",
                        f"reporter:{peer_id}",
                        "shared_outlet",
                        "|".join(outlet_names),
                    ),
                    source_id=f"reporter:{reporter_id}",
                    target_id=f"reporter:{peer_id}",
                    relation_type="shared_outlet",
                    direction="undirected",
                    weight=float(weight),
                    confidence=confidence,
                    confidence_tier=confidence_tier(confidence),
                    evidence_count=weight,
                    evidence_preview=[
                        AtlasEvidenceRef(
                            id=f"shared-outlet:{reporter_id}:{peer_id}:{normalize_entity_label(name)}",
                            source_type="article_byline_corpus",
                            source_name=name,
                            excerpt="Both reporters have observed article bylines at this outlet.",
                        )
                        for name in outlet_names
                    ]
                    if filters.include_evidence_preview
                    else [],
                    is_inferred=True,
                    raw_relation_type="shared_article_source",
                )
            )

        network_edges.sort(
            key=lambda edge: (-edge.weight, edge.relation_type, edge.source_id, edge.target_id)
        )
        edges.extend(network_edges[: filters.limit_edges])

    # Organization-to-organization links are exact ID or exact normalized alias links.
    for org in orgs:
        child_id = f"organization:{org.id}"
        org_confidence = _research_confidence(org.research_confidence)
        if org.parent_org_id and org.parent_org_id in org_by_id:
            parent_id = f"organization:{org.parent_org_id}"
            edges.append(
                AtlasEdge(
                    id=_edge_id(parent_id, child_id, "ownership", str(org.id)),
                    source_id=parent_id,
                    target_id=child_id,
                    relation_type="ownership",
                    ownership_percentage=_parse_percentage(org.ownership_percentage),
                    confidence=org_confidence or 0.85,
                    confidence_tier=confidence_tier(org_confidence or 0.85),
                    last_verified_at=org.last_researched_at,
                    raw_relation_type="parent_org_id",
                )
            )

        alias_relations = (
            (cast(list[Any], org.owned_by or []), "owned_by", False),
            (cast(list[Any], org.parent_orgs or []), "parent_org", False),
            (cast(list[Any], org.part_of or []), "part_of", True),
        )
        for values, alias_relation, reverse in alias_relations:
            for raw_name in values:
                if not isinstance(raw_name, str):
                    continue
                related_org_id = org_alias_to_id.get(normalize_entity_label(raw_name))
                if not related_org_id or related_org_id == org.id:
                    continue
                related_id = f"organization:{related_org_id}"
                source_id, target_id = (child_id, related_id) if reverse else (related_id, child_id)
                relation_type = cast(AtlasRelationType, alias_relation)
                edges.append(
                    AtlasEdge(
                        id=_edge_id(source_id, target_id, alias_relation, raw_name),
                        source_id=source_id,
                        target_id=target_id,
                        relation_type=relation_type,
                        confidence=org_confidence or 0.72,
                        confidence_tier=confidence_tier(org_confidence or 0.72),
                        last_verified_at=org.last_researched_at,
                        is_inferred=False,
                        raw_relation_type=alias_relation,
                    )
                )

    # Source links: claims first, then explicit SourceMetadata parent_company, then exact legal identity.
    for normalized_source, source_id in source_id_by_normalized.items():
        source_claims = claims_by_source.get(normalized_source, [])
        linked = False
        for claim in source_claims:
            claim_type = cast(str, claim.claim_type)
            if claim_type not in _OWNER_CLAIM_TYPES | _LEGAL_ENTITY_CLAIM_TYPES:
                continue
            org_name = _claim_name(claim)
            source_org_id = org_alias_to_id.get(normalize_entity_label(org_name))
            if not source_org_id:
                continue
            claim_relation: AtlasRelationType = (
                "ownership" if claim_type in _OWNER_CLAIM_TYPES else "publishes"
            )
            organization_id = f"organization:{source_org_id}"
            source_edge_id = organization_id
            target_edge_id = source_id
            evidence = evidence_by_claim.get(cast(int, claim.id), [])
            confidence = float(claim.confidence or 0.0)
            edges.append(
                AtlasEdge(
                    id=_edge_id(source_edge_id, target_edge_id, claim_relation, str(claim.id)),
                    source_id=source_edge_id,
                    target_id=target_edge_id,
                    relation_type=claim_relation,
                    confidence=confidence,
                    confidence_tier=confidence_tier(confidence),
                    evidence_count=len(evidence),
                    evidence_preview=evidence[:3] if filters.include_evidence_preview else [],
                    valid_from=claim.valid_from,
                    valid_to=claim.valid_to,
                    last_verified_at=max(
                        (item.retrieved_at for item in evidence if item.retrieved_at),
                        default=claim.updated_at,
                    ),
                    is_inferred=claim.claim_kind == "computed",
                    raw_relation_type=claim_type,
                )
            )
            linked = True

        meta = metadata_by_source.get(normalized_source)
        if meta and meta.parent_company:
            metadata_org_id = org_alias_to_id.get(normalize_entity_label(meta.parent_company))
            if metadata_org_id:
                organization_id = f"organization:{metadata_org_id}"
                edges.append(
                    AtlasEdge(
                        id=_edge_id(organization_id, source_id, "ownership", "source_metadata"),
                        source_id=organization_id,
                        target_id=source_id,
                        relation_type="ownership",
                        confidence=0.68,
                        confidence_tier="likely",
                        evidence_count=0,
                        last_verified_at=meta.updated_at,
                        is_inferred=True,
                        raw_relation_type="source_metadata.parent_company",
                    )
                )
                linked = True

        exact_org_id = org_alias_to_id.get(normalized_source)
        if exact_org_id:
            organization_id = f"organization:{exact_org_id}"
            edges.append(
                AtlasEdge(
                    id=_edge_id(organization_id, source_id, "publishes", "exact-label"),
                    source_id=organization_id,
                    target_id=source_id,
                    relation_type="publishes",
                    confidence=0.72,
                    confidence_tier="likely",
                    is_inferred=True,
                    raw_relation_type="exact_canonical_label",
                )
            )
            linked = True

        if not linked:
            unresolved_source_links += 1

    # Reporter affiliations only use exact organization aliases. They never upgrade bylines to verification.
    for reporter in reporters:
        affiliations = reporter.institutional_affiliations or []
        if not isinstance(affiliations, list):
            continue
        for affiliation in affiliations:
            if not isinstance(affiliation, dict):
                continue
            raw_name = (
                affiliation.get("org") or affiliation.get("name") or affiliation.get("organization")
            )
            if not isinstance(raw_name, str):
                continue
            affiliation_org_id = org_alias_to_id.get(normalize_entity_label(raw_name))
            if not affiliation_org_id:
                continue
            evidence_url = affiliation.get("url") or affiliation.get("source_url")
            evidence = []
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
            target_id = f"organization:{affiliation_org_id}"
            edges.append(
                AtlasEdge(
                    id=_edge_id(source_id, target_id, "employed_by", raw_name),
                    source_id=source_id,
                    target_id=target_id,
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
        unresolved_source_links,
        dict(index_counts),
        last_indexed_at,
        indexing_active,
    )
