"""Plan or apply a candidate-only migration from legacy ownership metadata.

Dry-run is the default. Legacy catalog rows never become accepted facts.
"""

from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, cast
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import AsyncSessionLocal, Organization, SourceClaim, SourceMetadata
from app.models.evidence import EvidenceClaim, EvidenceEntity
from app.services.atlas_graph_helpers import normalize_entity_label
from app.services.evidence_spine import canonical_json, stable_hash

@dataclass(frozen=True)
class CandidateRelation:
    subject_name: str
    predicate: str
    object_name: str
    source_field: str
    qualifiers: dict[str, Any]


def entity_id(kind: str, name: str) -> str:
    digest = hashlib.sha256(f"{kind}\x1f{normalize_entity_label(name)}".encode()).hexdigest()[:32]
    return f"legacy_{digest}"


def plan_organization_candidates(organizations: Iterable[Organization]) -> list[CandidateRelation]:
    rows = list(organizations)
    by_id = {int(row.id): row for row in rows if row.id is not None}
    planned = []
    for row in rows:
        child = cast(str, row.name)
        if row.parent_org_id and int(row.parent_org_id) in by_id:
            planned.append(CandidateRelation(child, "owned_by", cast(str, by_id[int(row.parent_org_id)].name), "Organization.parent_org_id", {"pct_raw": row.ownership_percentage}))
        for field_name, predicate, values in (
            ("Organization.owned_by", "owned_by", row.owned_by or []),
            ("Organization.parent_orgs", "parent_org", row.parent_orgs or []),
            ("Organization.part_of", "part_of", row.part_of or []),
        ):
            if isinstance(values, list):
                for value in values:
                    if isinstance(value, str) and value.strip():
                        planned.append(CandidateRelation(child, predicate, value.strip(), field_name, {}))
    return planned


def contradiction_report(candidates: Iterable[CandidateRelation]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], set[str]] = {}
    for candidate in candidates:
        key = (normalize_entity_label(candidate.subject_name), candidate.predicate)
        grouped.setdefault(key, set()).add(normalize_entity_label(candidate.object_name))
    return [{"subject": subject, "predicate": predicate, "objects": sorted(objects)} for (subject, predicate), objects in sorted(grouped.items()) if len(objects) > 1]


async def _load_candidates(db: AsyncSession) -> list[CandidateRelation]:
    organizations = list((await db.execute(select(Organization))).scalars().all())
    metadata = list((await db.execute(select(SourceMetadata))).scalars().all())
    source_claims = list((await db.execute(select(SourceClaim).where(SourceClaim.is_current.is_(True), SourceClaim.claim_type.in_(("parent_company", "owner", "ownership", "owned_by"))))).scalars().all())
    candidates = plan_organization_candidates(organizations)
    for row in metadata:
        if row.parent_company:
            candidates.append(CandidateRelation(cast(str, row.source_name), "owned_by", cast(str, row.parent_company), "SourceMetadata.parent_company", {}))
    for row in source_claims:
        value = row.claim_value if isinstance(row.claim_value, dict) else {}
        object_name = next((value[key] for key in ("name", "organization", "owner", "parent_company") if isinstance(value.get(key), str) and value[key].strip()), None)
        if object_name:
            candidates.append(CandidateRelation(cast(str, row.source_name), "owned_by", object_name.strip(), "SourceClaim", {"legacy_claim_id": row.id}))
    unique = {canonical_json(asdict(candidate)): candidate for candidate in candidates if normalize_entity_label(candidate.subject_name) and normalize_entity_label(candidate.object_name)}
    return [unique[key] for key in sorted(unique)]


async def _upsert_entity(db: AsyncSession, name: str, kind: str) -> EvidenceEntity:
    key = entity_id(kind, name)
    row = await db.get(EvidenceEntity, key)
    if row is None:
        row = EvidenceEntity(id=key, record_kind=kind, canonical_name=name, status="candidate")
        db.add(row)
    return row


async def _apply(db: AsyncSession, candidates: list[CandidateRelation]) -> int:
    inserted = 0
    for candidate in candidates:
        subject_kind = "publication" if candidate.source_field.startswith("Source") else "legal_entity"
        subject = await _upsert_entity(db, candidate.subject_name, subject_kind)
        object_row = await _upsert_entity(db, candidate.object_name, "legal_entity")
        claim_hash = stable_hash(subject.id, candidate.predicate, object_row.id, candidate.qualifiers, "catalog_metadata")
        existing = (await db.execute(select(EvidenceClaim).where(EvidenceClaim.claim_hash == claim_hash))).scalar_one_or_none()
        if existing is not None:
            continue
        db.add(EvidenceClaim(
            id=f"claim_{claim_hash[:32]}", subject_entity_id=subject.id, predicate=candidate.predicate,
            object_entity_id=object_row.id, qualifiers={**candidate.qualifiers, "legacy_source_field": candidate.source_field},
            asserted_by="legacy-ownership-migration", evidence_class="catalog_metadata", status="candidate",
            method_version="legacy-ownership-migration/1.0", claim_hash=claim_hash,
        ))
        inserted += 1
    return inserted


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("runtime-data/reports/legacy-ownership.json"))
    args = parser.parse_args()
    if AsyncSessionLocal is None:
        raise RuntimeError("database is disabled")
    async with AsyncSessionLocal() as db:
        candidates = await _load_candidates(db)
        inserted = 0
        if args.apply:
            inserted = await _apply(db, candidates)
            await db.commit()
        report = {
            "mode": "apply" if args.apply else "dry-run", "candidate_count": len(candidates),
            "inserted_count": inserted, "accepted_count": 0,
            "candidates": [asdict(candidate) for candidate in candidates],
            "contradictions": contradiction_report(candidates),
            "rule": "legacy metadata remains candidate-only until snapshot evidence passes a predicate gate",
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps({key: report[key] for key in ("mode", "candidate_count", "inserted_count", "accepted_count")}, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
