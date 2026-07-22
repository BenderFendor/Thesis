"""Shared EvidenceEntity merge/survivor resolution for the Atlas projections.

Phase 0's `entity_backfill.py` and Phase 1's ingestors mark a shadow entity
`status="merged"` and record an accepted `EntityResolution(decision="same_as")`
pointing at the surviving entity (see `entity_backfill._process_publisher_org`).
Both Atlas projection modules (`atlas_graph_projection.py` for outlets/
reporters, `atlas_evidence_projection.py` for organizations/people/ownership
edges) must collapse merged entities to their survivor identically, so a
merged entity never renders as a second, shadow node and every edge that
still references the shadow id resolves to the one visible node.
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evidence import EntityExternalId, EntityResolution, EvidenceEntity
from app.services.atlas_graph_helpers import stable_source_id


async def entity_survivor_map(db: AsyncSession) -> dict[str, str]:
    """Return {non-survivor entity id -> survivor entity id}, chains resolved.

    Only entities that appear as the `left_entity_id` of an accepted
    `same_as` resolution are keys; every other entity id maps to itself
    (callers should use `canonical_entity_id` rather than indexing this dict
    directly).
    """
    rows = list(
        (
            await db.execute(
                select(EntityResolution).where(
                    EntityResolution.decision == "same_as",
                    EntityResolution.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    direct = {cast(str, row.left_entity_id): cast(str, row.right_entity_id) for row in rows}

    def _resolve(entity_id: str) -> str:
        current = entity_id
        seen: set[str] = set()
        while current in direct and current not in seen:
            seen.add(current)
            current = direct[current]
        return current

    return {entity_id: _resolve(entity_id) for entity_id in direct}


def canonical_entity_id(entity_id: str, survivors: dict[str, str]) -> str:
    """Resolve `entity_id` to its survivor id, or itself if it was never merged."""
    return survivors.get(entity_id, entity_id)


async def live_entities_by_kind(
    db: AsyncSession, record_kinds: tuple[str, ...], survivors: dict[str, str]
) -> list[EvidenceEntity]:
    """Return non-merged, non-shadow entities of the given record kinds.

    Excludes entities with `status="merged"` and any entity that is a
    non-survivor side of an accepted `same_as` resolution (defense in depth
    alongside the status check -- a resolution can be recorded without the
    shadow's status having been updated yet).
    """
    rows = list(
        (
            await db.execute(
                select(EvidenceEntity).where(EvidenceEntity.record_kind.in_(record_kinds))
            )
        )
        .scalars()
        .all()
    )
    return [
        entity
        for entity in rows
        if cast(str, entity.status) != "merged" and cast(str, entity.id) not in survivors
    ]


async def outlet_node_ids(db: AsyncSession, publications: list[EvidenceEntity]) -> dict[str, str]:
    """Map publication entity id -> Atlas outlet node id ("outlet:<digest>").

    Prefers the preserved `rss_catalog_key` external id (the pre-rename
    `stable_source_id` digest, seeded by Phase 0's `entity_backfill.py`) so
    outlet node ids never change across the `source` -> `outlet` rename;
    falls back to a fresh id derived from the entity's canonical name for
    publications with no catalog key (e.g. outlets discovered later by an
    ingestor rather than the RSS catalog backfill).

    Shared by `atlas_graph_projection.py` (which emits the outlet nodes) and
    `atlas_evidence_projection.py` (whose ownership edges must resolve to
    the exact same outlet node ids to connect to them).
    """
    entity_ids = [cast(str, entity.id) for entity in publications]
    if not entity_ids:
        return {}
    rows = list(
        (
            await db.execute(
                select(EntityExternalId).where(
                    EntityExternalId.scheme == "rss_catalog_key",
                    EntityExternalId.entity_id.in_(entity_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    by_entity = {cast(str, row.entity_id): cast(str, row.value) for row in rows}
    return {
        entity_id: by_entity.get(entity_id) or stable_source_id(cast(str, entity.canonical_name))
        for entity_id, entity in zip(entity_ids, publications, strict=True)
    }
