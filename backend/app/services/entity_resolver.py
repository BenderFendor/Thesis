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

from app.database import Reporter
from app.models.evidence import EntityExternalId, EvidenceEntity
from app.services.evidence_spine import stable_hash


def _normalize_for_reporter_match(value: str) -> str:
    """Match `Reporter.normalized_name`'s own normalization exactly.

    `Reporter.normalized_name` (see `app/services/reporter_indexer.py`'s
    `_normalize_for_resolver`) is lowercase + collapsed whitespace, no
    punctuation stripping -- reuse that exact rule so the SQL equality below
    can hit the indexed column instead of scanning/normalizing in Python.
    """
    return " ".join(value.lower().strip().split())


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


async def _match_reporter_id(db: AsyncSession, candidate_name: str) -> str | None:
    """Return the id of the single `Reporter` row whose normalized name matches.

    Ontology: "all reporters are people; not all people are reporters" --
    when a `person` evidence entity's name unambiguously matches an existing
    `Reporter` row, its evidence belongs on that reporter's unified Atlas
    node (see `atlas_evidence_projection.py`). Returns `None` (no link) when
    zero or more than one `Reporter` row shares the normalized name --
    reporter name collisions are common enough (hundreds of duplicate
    normalized names in the corpus) that a wrong auto-link would silently
    merge two different journalists' evidence onto one node, which is worse
    than leaving the person un-unified.
    """
    normalized = _normalize_for_reporter_match(candidate_name)
    if not normalized:
        return None
    rows = (
        (
            await db.execute(
                select(Reporter.id).where(Reporter.normalized_name == normalized).limit(2)
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != 1:
        return None
    return str(rows[0])


async def resolve_or_create(
    db: AsyncSession,
    record_kind: str,
    external_ids: dict[str, str],
    candidate_name: str,
    entity_kind: str | None = None,
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

    is_person = record_kind == "person" or entity_kind == "person"
    if is_person and "scoop_reporter_id" not in clean_ids:
        # Reporter is a subtype of person: when this person's name unambiguously
        # matches an existing `Reporter` row, attach the `scoop_reporter_id`
        # external id so the Atlas projection unifies this entity's evidence
        # onto that reporter's node instead of minting a duplicate person node.
        # Skipped when the caller already supplied the id directly (the bulk
        # byline ingestor knows its reporter id exactly and shouldn't pay for
        # a name-match query on every one of its ~11k calls).
        reporter_id = await _match_reporter_id(db, candidate_name)
        if reporter_id is not None:
            clean_ids["scoop_reporter_id"] = reporter_id

    entity = await _find_by_external_ids(db, clean_ids)
    if entity is None:
        entity_id = f"ent_{stable_hash(record_kind, clean_ids, candidate_name)[:24]}"
        entity = EvidenceEntity(
            id=entity_id,
            record_kind=record_kind,
            entity_kind=entity_kind or record_kind,
            canonical_name=candidate_name,
            status="accepted",
        )
        db.add(entity)
        await db.flush()
    elif entity_kind and entity.entity_kind == entity.record_kind:
        entity.entity_kind = entity_kind

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
