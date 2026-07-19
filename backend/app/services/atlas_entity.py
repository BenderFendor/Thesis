"""Entity, search, and paginated index services for the Intelligence Atlas."""

from __future__ import annotations

import base64
from collections import Counter
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
    SourceMetadata,
)
from app.models.atlas import (
    AtlasConnectionRecord,
    AtlasEntityRecord,
    AtlasGraphFilters,
    AtlasIndexResponse,
    AtlasNode,
    AtlasSearchItem,
    AtlasSearchResponse,
)
from app.services.atlas_graph import build_atlas_graph
from app.services.atlas_graph_helpers import normalize_entity_label, stable_source_id


def _catalog_sources() -> dict[str, dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for raw_name, raw_config in get_rss_sources().items():
        name = raw_name.split(" - ")[0].strip()
        unique.setdefault(name, cast(dict[str, Any], raw_config))
    return unique


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii") + b"===").decode(
            "ascii"
        )
        return max(int(decoded), 0)
    except (ValueError, UnicodeDecodeError):
        return 0


def _encode_cursor(offset: int) -> str:
    return (
        base64.urlsafe_b64encode(str(offset).encode("ascii"))
        .decode("ascii")
        .rstrip("=")
    )


def _source_name_for_id(entity_id: str) -> str | None:
    for source_name in _catalog_sources():
        if stable_source_id(source_name) == entity_id:
            return source_name
    return None


async def search_atlas(
    db: AsyncSession, query: str, limit: int = 8
) -> AtlasSearchResponse:
    normalized_query = normalize_entity_label(query)
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["source", "organization", "reporter"],
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
        "source": [],
        "organization": [],
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
        sources=grouped["source"],
        organizations=grouped["organization"],
        reporters=grouped["reporter"],
    )


async def get_atlas_entity(
    db: AsyncSession, entity_id: str
) -> AtlasEntityRecord | None:
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=["source", "organization", "reporter"],
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
    if entity_id.startswith("source:"):
        source_name = _source_name_for_id(entity_id)
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
        claim_ids = [cast(int, claim.id) for claim in claims if claim.id is not None]
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
            "source_type": cast(str | None, metadata.source_type if metadata else None),
            "category": config.get("category"),
            "funding_type": cast(
                str | None,
                (metadata.funding_type if metadata else None)
                or config.get("funding_type"),
            ),
            "bias_rating": cast(
                str | None,
                (metadata.political_bias if metadata else None)
                or config.get("bias_rating"),
            ),
            "factual_reporting": cast(
                str | None,
                (metadata.factual_rating if metadata else None)
                or config.get("factual_reporting"),
            ),
            "credibility_score": cast(
                float | None, metadata.credibility_score if metadata else None
            ),
            "parent_company": cast(
                str | None, metadata.parent_company if metadata else None
            ),
            "geographic_focus": cast(
                list[str], metadata.geographic_focus if metadata else []
            ),
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
        }
        if claim_evidence:
            last_verified_at = max(
                (
                    cast(datetime, row.retrieved_at)
                    for row in claim_evidence
                    if row.retrieved_at
                ),
                default=None,
            )
    elif entity_id.startswith("organization:"):
        try:
            org_id = int(entity_id.split(":", 1)[1])
        except ValueError:
            return None
        org = await db.get(Organization, org_id)
        if org is None:
            return None
        details = {
            "organization_type": org.org_type,
            "legal_name": org.name,
            "funding_type": org.funding_type,
            "funding_sources": org.funding_sources or [],
            "major_advertisers": org.major_advertisers or [],
            "annual_revenue": org.annual_revenue,
            "parent_organization_id": org.parent_org_id,
            "ownership_percentage": org.ownership_percentage,
            "owned_by": org.owned_by or [],
            "parent_organizations": org.parent_orgs or [],
            "part_of": org.part_of or [],
            "website": org.website or org.official_website,
            "wikipedia_url": org.wikipedia_url,
            "research_sources": org.research_sources or [],
            "conflict_flags": org.conflict_flags or [],
        }
        last_verified_at = cast(datetime | None, org.last_researched_at)
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
        last_verified_at = cast(datetime | None, reporter.last_researched_at)

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
    entity_types: list[str],
    query: str | None,
    country: list[str],
    funding: list[str],
    bias: list[str],
    sort: str,
    cursor: str | None,
    limit: int,
) -> AtlasIndexResponse:
    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=cast(list[Any], entity_types),
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
    facets = {
        "entity_type": dict(Counter(node.entity_type for node in items)),
        "country": dict(
            Counter(node.country_code for node in items if node.country_code)
        ),
        "funding": dict(
            Counter(node.funding_type for node in items if node.funding_type)
        ),
        "bias": dict(Counter(node.bias_rating for node in items if node.bias_rating)),
        "status": dict(Counter(node.status for node in items if node.status)),
        "confidence": dict(
            Counter(node.confidence_tier for node in items if node.confidence_tier)
        ),
    }
    return AtlasIndexResponse(
        items=page,
        total=len(items),
        next_cursor=_encode_cursor(next_offset) if next_offset < len(items) else None,
        facets=facets,
    )
