"""Backfill exact Atlas source-to-organization claims without substring matching."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import (
    AsyncSessionLocal,
    Organization,
    SourceClaim,
    SourceClaimEvidence,
    SourceMetadata,
    get_utc_now,
)
from app.services.atlas_graph_helpers import normalize_entity_label


@dataclass
class AuditRow:
    source_name: str
    parent_company: str | None
    result: str
    organization_id: int | None = None
    organization_name: str | None = None
    reason: str | None = None


def _hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _organization_aliases(orgs: list[Organization]) -> dict[str, list[Organization]]:
    aliases: dict[str, list[Organization]] = {}
    for org in orgs:
        for raw_alias in (
            cast(str, org.name),
            cast(str | None, org.normalized_name),
        ):
            alias = normalize_entity_label(raw_alias)
            if alias:
                aliases.setdefault(alias, []).append(org)
    return aliases


async def _resolve_backfill_row(
    session: AsyncSession,
    source_name: str,
    parent_company: str | None,
    aliases: dict[str, list[Organization]],
) -> tuple[AuditRow, Organization | None]:
    """Classify one metadata row, returning its audit row and link target."""
    if not parent_company:
        return (
            AuditRow(
                source_name,
                None,
                "unresolved",
                reason="no parent_company metadata",
            ),
            None,
        )
    matches = aliases.get(normalize_entity_label(parent_company), [])
    if not matches:
        return (
            AuditRow(
                source_name,
                parent_company,
                "unresolved",
                reason="no exact organization alias",
            ),
            None,
        )
    if len(matches) > 1:
        return (
            AuditRow(
                source_name,
                parent_company,
                "ambiguous",
                reason="multiple exact organization aliases",
            ),
            None,
        )
    org = matches[0]
    existing = (
        (
            await session.execute(
                select(SourceClaim).where(
                    SourceClaim.source_name == source_name,
                    SourceClaim.claim_type == "parent_company",
                    SourceClaim.is_current.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    stronger = [claim for claim in existing if float(claim.confidence or 0) >= 0.68]
    if stronger:
        return (
            AuditRow(
                source_name,
                parent_company,
                "retained",
                cast(int, org.id),
                cast(str, org.name),
                "existing equal-or-stronger claim",
            ),
            None,
        )
    return (
        AuditRow(
            source_name,
            parent_company,
            "linked",
            cast(int, org.id),
            cast(str, org.name),
        ),
        org,
    )


async def _persist_backfill_claim(
    session: AsyncSession,
    source_name: str,
    parent_company: str,
    org: Organization,
) -> None:
    claim_value = {
        "name": cast(str, org.name),
        "organization_id": cast(int, org.id),
    }
    claim = SourceClaim(
        source_name=source_name,
        claim_type="parent_company",
        claim_value=claim_value,
        claim_kind="factual",
        confidence=cast(Any, 0.68),
        parser_version="atlas-backfill/v1",
        is_current=True,
        valid_from=get_utc_now(),
    )
    session.add(claim)
    await session.flush()
    evidence_payload = {
        "source_name": source_name,
        "parent_company": parent_company,
        "organization_id": cast(int, org.id),
    }
    session.add(
        SourceClaimEvidence(
            claim_id=claim.id,
            source_type="source_metadata",
            source_name=source_name,
            source_url="urn:thesis:source-metadata",
            retrieved_at=get_utc_now(),
            raw_excerpt=f"parent_company={parent_company}",
            raw_hash=_hash_payload(evidence_payload),
        )
    )


async def run_backfill(*, dry_run: bool, source_only: str | None, audit_path: Path) -> None:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database is disabled")
    async with AsyncSessionLocal() as session:
        orgs = list((await session.execute(select(Organization))).scalars().all())
        metadata = list((await session.execute(select(SourceMetadata))).scalars().all())
        aliases = _organization_aliases(orgs)

        audits: list[AuditRow] = []
        created = 0
        for row in metadata:
            processed = await _process_metadata_row(session, row, source_only, aliases, dry_run)
            if processed is None:
                continue
            audit, row_created = processed
            audits.append(audit)
            created += row_created

        if not dry_run:
            await session.commit()
        _write_audit(audit_path, dry_run, created, audits)


async def _process_metadata_row(
    session: AsyncSession,
    row: SourceMetadata,
    source_only: str | None,
    aliases: dict[str, list[Organization]],
    dry_run: bool,
) -> tuple[AuditRow, int] | None:
    source_name = cast(str, row.source_name)
    if source_only and normalize_entity_label(source_name) != normalize_entity_label(source_only):
        return None
    parent_company = cast(str | None, row.parent_company)
    audit, org = await _resolve_backfill_row(session, source_name, parent_company, aliases)
    if org is None or parent_company is None or dry_run:
        return audit, 0
    await _persist_backfill_claim(session, source_name, parent_company, org)
    return audit, 1


def _write_audit(
    audit_path: Path,
    dry_run: bool,
    created: int,
    audits: list[AuditRow],
) -> None:
    counts = {
        result: sum(item.result == result for item in audits)
        for result in {item.result for item in audits}
    }
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(
        json.dumps(
            {
                "dry_run": dry_run,
                "created": created,
                "counts": counts,
                "rows": [asdict(item) for item in audits],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Persist claims; default is dry run")
    parser.add_argument("--source", help="Only process one source")
    parser.add_argument(
        "--audit",
        type=Path,
        default=Path("artifacts/atlas-relationship-backfill.json"),
    )
    args = parser.parse_args()
    asyncio.run(
        run_backfill(dry_run=not args.apply, source_only=args.source, audit_path=args.audit)
    )


if __name__ == "__main__":
    main()
