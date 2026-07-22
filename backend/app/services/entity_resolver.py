"""Deterministic entity resolution against the evidence spine.

Single chokepoint for turning a (record_kind, external_ids, candidate_name)
tuple into a canonical `EvidenceEntity`. Every writer that mints entities
(RSS catalog backfill, Organization backfill, and later Phase 1 ingestors)
must go through `resolve_or_create` so the publication/legal-entity stores
never re-diverge.

Matching is external-id only: two records are the same entity if and only if
they share a recorded `EntityExternalId` (scheme, value) pair. Name never
participates in matching -- only in the `canonical_name` set on first
creation -- so two same-named-but-distinct entities never collapse together.
"""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evidence import EntityExternalId, EvidenceEntity
from app.services.evidence_spine import stable_hash


async def _find_by_external_ids(
    db: AsyncSession, external_ids: dict[str, str]
) -> EvidenceEntity | None:
    """Return the entity owning any of the given (scheme, value) pairs, if any."""
    if not external_ids:
        return None
    conditions = [
        (EntityExternalId.scheme == scheme) & (EntityExternalId.value == value)
        for scheme, value in external_ids.items()
    ]
    row = (
        await db.execute(select(EntityExternalId).where(or_(*conditions)).limit(1))
    ).scalar_one_or_none()
    if row is None:
        return None
    return await db.get(EvidenceEntity, row.entity_id)


async def resolve_or_create(
    db: AsyncSession,
    record_kind: str,
    external_ids: dict[str, str],
    candidate_name: str,
) -> EvidenceEntity:
    """Resolve `external_ids` to an existing entity, or create a new one.

    Lookup order: match any provided external id against `EntityExternalId`
    and return the owning entity (attaching any external ids passed here
    that weren't already recorded on it). Only when no external id matches
    anything is a new `EvidenceEntity` created. Entities are never merged
    on `candidate_name` alone.
    """
    clean_ids = {
        scheme: value.strip() for scheme, value in external_ids.items() if value and value.strip()
    }

    entity = await _find_by_external_ids(db, clean_ids)
    if entity is None:
        entity_id = f"ent_{stable_hash(record_kind, clean_ids, candidate_name)[:24]}"
        entity = EvidenceEntity(
            id=entity_id,
            record_kind=record_kind,
            canonical_name=candidate_name,
            status="accepted",
        )
        db.add(entity)
        await db.flush()

    existing_rows = (
        (await db.execute(select(EntityExternalId).where(EntityExternalId.entity_id == entity.id)))
        .scalars()
        .all()
    )
    existing_pairs = {(row.scheme, row.value) for row in existing_rows}

    for scheme, value in clean_ids.items():
        if (scheme, value) in existing_pairs:
            continue
        # Guard against a value already claimed by a *different* entity --
        # the (scheme, value) unique constraint would otherwise raise.
        collision = (
            await db.execute(
                select(EntityExternalId).where(
                    EntityExternalId.scheme == scheme, EntityExternalId.value == value
                )
            )
        ).scalar_one_or_none()
        if collision is not None:
            continue
        db.add(EntityExternalId(entity_id=entity.id, scheme=scheme, value=value))

    await db.flush()
    return entity
