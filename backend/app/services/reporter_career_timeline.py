"""Reporter career timeline built from bylines and institutional affiliations.

Merges the two sources chronologically and detects shared-ultimate-owner
outlets. Phase 4 of the Atlas rebuild plan (replaces the deleted synthetic
`coauthor`/`shared_outlet` reporter edges with a real, evidenced career
surface). Two data sources are merged:

- Byline history: `ArticleAuthor` join `Article`, grouped by outlet, giving
  each outlet's first/last article date and article count in this corpus.
- `Reporter.institutional_affiliations` (already evidenced by
  `littlesis_integration.py` / `reporter_indexer.py`): non-outlet
  affiliations with an evidence URL where available.

Shared-owner detection reuses Phase 2/3's cycle-guarded, depth-capped
ownership-chain helpers (`atlas_evidence_projection.build_interest_edge_index`
/ `walk_ownership_chain`) and the same outlet-id derivation
(`atlas_graph_helpers.stable_source_id`) the Atlas graph projection uses --
no ownership resolution logic is re-derived here.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Article, ArticleAuthor, Reporter
from app.models.atlas import AtlasEdge, AtlasEntityType, AtlasGraphFilters, AtlasNode
from app.services.atlas_evidence_projection import (
    build_interest_edge_index,
    walk_ownership_chain,
)
from app.services.atlas_graph import build_atlas_graph
from app.services.atlas_graph_helpers import stable_source_id

_OWNERSHIP_ENTITY_TYPES: list[AtlasEntityType] = ["outlet", "organization", "person"]


async def _byline_timeline_entries(db: AsyncSession, reporter_id: int) -> list[dict[str, Any]]:
    """One entry per outlet the reporter has bylines at, from `ArticleAuthor`."""
    stmt = (
        select(
            Article.source,
            func.min(Article.published_at).label("earliest"),
            func.max(Article.published_at).label("latest"),
            func.count(Article.id).label("article_count"),
        )
        .select_from(ArticleAuthor)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(ArticleAuthor.reporter_id == reporter_id, Article.source.is_not(None))
        .group_by(Article.source)
    )
    rows = (await db.execute(stmt)).all()

    entries: list[dict[str, Any]] = []
    for source_name, earliest, latest, article_count in rows:
        if not source_name:
            continue
        entries.append(
            {
                "source": "byline",
                "outlet": source_name,
                "start_date": earliest.isoformat() if earliest else None,
                "end_date": latest.isoformat() if latest else None,
                "article_count": int(article_count or 0),
                "role": None,
                "evidence_url": None,
            }
        )
    return entries


def _affiliation_timeline_entries(reporter: Reporter) -> list[dict[str, Any]]:
    """One entry per `Reporter.institutional_affiliations` record with an org name."""
    affiliations = cast(list[Any] | None, reporter.institutional_affiliations) or []
    if not isinstance(affiliations, list):
        return []

    entries: list[dict[str, Any]] = []
    for affiliation in affiliations:
        if not isinstance(affiliation, dict):
            continue
        raw_name = (
            affiliation.get("org") or affiliation.get("name") or affiliation.get("organization")
        )
        if not isinstance(raw_name, str) or not raw_name.strip():
            continue
        evidence_url = (
            affiliation.get("url")
            or affiliation.get("source_url")
            or affiliation.get("littlesis_url")
        )
        entries.append(
            {
                "source": "affiliation",
                "outlet": raw_name,
                "start_date": affiliation.get("start_date") or affiliation.get("start"),
                "end_date": affiliation.get("end_date") or affiliation.get("end"),
                "article_count": None,
                "role": affiliation.get("role") or affiliation.get("category"),
                "evidence_url": evidence_url if isinstance(evidence_url, str) else None,
            }
        )
    return entries


def _timeline_sort_key(entry: dict[str, Any]) -> tuple[int, str]:
    """Sort chronologically by start date, undated entries last."""
    start = entry.get("start_date")
    if not isinstance(start, str) or not start:
        return (1, "")
    return (0, start)


def _node_ref(node: AtlasNode | None, *, fallback_id: str, fallback_label: str) -> dict[str, Any]:
    if node is None:
        return {
            "entity_id": fallback_id,
            "label": fallback_label,
            "entity_type": None,
            "profile_path": f"/wiki/source/{fallback_label}",
        }
    return {
        "entity_id": node.id,
        "label": node.label,
        "entity_type": node.entity_type,
        "profile_path": node.profile_path,
    }


async def _shared_owner_findings(db: AsyncSession, outlet_names: list[str]) -> list[dict[str, Any]]:
    """Group the reporter's outlets by ultimate accepted owner.

    Resolves each outlet name to its Atlas outlet node id the same way the
    Atlas graph projection does (`stable_source_id`), walks each one's
    accepted ownership chain upward (`walk_ownership_chain`, cycle-guarded
    and depth-capped), and groups outlets that resolve to the same root
    owner. Outlets with no recorded owner are excluded rather than treated
    as sharing a "no owner" root.
    """
    unique_names = sorted({name for name in outlet_names if name})
    if len(unique_names) < 2:
        return []

    graph = await build_atlas_graph(
        db,
        AtlasGraphFilters(
            entity_types=_OWNERSHIP_ENTITY_TYPES,
            limit_nodes=600,
            limit_edges=2500,
            include_evidence_preview=False,
        ),
    )
    node_by_id = {node.id: node for node in graph.nodes}
    edge_by_owned = build_interest_edge_index(graph.edges)

    groups: dict[str, list[tuple[str, str, list[AtlasEdge]]]] = defaultdict(list)
    for name in unique_names:
        outlet_node_id = stable_source_id(name)
        chain = walk_ownership_chain(outlet_node_id, edge_by_owned)
        if not chain:
            continue
        root_id = chain[-1].source_id
        groups[root_id].append((outlet_node_id, name, chain))

    findings: list[dict[str, Any]] = []
    for root_id, members in groups.items():
        if len(members) < 2:
            continue
        owner_node = node_by_id.get(root_id)
        if owner_node is None:
            continue

        outlets: list[dict[str, Any]] = []
        claim_ids: set[str] = set()
        evidence_count = 0
        for outlet_node_id, name, chain in members:
            outlet_node = node_by_id.get(outlet_node_id)
            outlets.append(_node_ref(outlet_node, fallback_id=outlet_node_id, fallback_label=name))
            for edge in chain:
                claim_ids.update(edge.claim_ids)
                evidence_count += edge.evidence_count

        findings.append(
            {
                "owner": _node_ref(
                    owner_node, fallback_id=root_id, fallback_label=owner_node.label
                ),
                "outlets": outlets,
                "evidence_count": evidence_count,
                "claim_ids": sorted(claim_ids),
            }
        )

    findings.sort(key=lambda finding: cast(str, finding["owner"]["label"]))
    return findings


async def build_reporter_career_timeline(db: AsyncSession, reporter: Reporter) -> dict[str, Any]:
    """Merge byline + affiliation history into one chronological timeline.

    Returns `{"timeline": [...], "shared_owner_findings": [...]}`. Each
    timeline entry carries `source` ("byline" or "affiliation") so the UI can
    badge it distinctly; `shared_owner_findings` is only non-empty when two
    or more of the reporter's byline outlets share a recorded ultimate owner.
    """
    byline_entries = await _byline_timeline_entries(db, cast(int, reporter.id))
    affiliation_entries = _affiliation_timeline_entries(reporter)
    timeline = sorted(byline_entries + affiliation_entries, key=_timeline_sort_key)

    shared_owner_findings = await _shared_owner_findings(
        db, [entry["outlet"] for entry in byline_entries]
    )

    return {"timeline": timeline, "shared_owner_findings": shared_owner_findings}
