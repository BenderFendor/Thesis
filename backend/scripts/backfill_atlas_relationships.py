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
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode("utf-8")
    ).hexdigest()


async def run_backfill(
    *, dry_run: bool, source_only: str | None, audit_path: Path
) -> None:
    if AsyncSessionLocal is None:
        raise RuntimeError("Database is disabled")
    async with AsyncSessionLocal() as session:
        orgs = list((await session.execute(select(Organization))).scalars().all())
        metadata = list((await session.execute(select(SourceMetadata))).scalars().all())
        aliases: dict[str, list[Organization]] = {}
        for org in orgs:
            for raw_alias in (
                cast(str, org.name),
                cast(str | None, org.normalized_name),
            ):
                alias = normalize_entity_label(raw_alias)
                if alias:
                    aliases.setdefault(alias, []).append(org)

        audits: list[AuditRow] = []
        created = 0
        for row in metadata:
            source_name = cast(str, row.source_name)
            if source_only and normalize_entity_label(
                source_name
            ) != normalize_entity_label(source_only):
                continue
            parent_company = cast(str | None, row.parent_company)
            if not parent_company:
                audits.append(
                    AuditRow(
                        source_name,
                        None,
                        "unresolved",
                        reason="no parent_company metadata",
                    )
                )
                continue
            matches = aliases.get(normalize_entity_label(parent_company), [])
            if not matches:
                audits.append(
                    AuditRow(
                        source_name,
                        parent_company,
                        "unresolved",
                        reason="no exact organization alias",
                    )
                )
                continue
            if len(matches) > 1:
                audits.append(
                    AuditRow(
                        source_name,
                        parent_company,
                        "ambiguous",
                        reason="multiple exact organization aliases",
                    )
                )
                continue
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
            stronger = [
                claim for claim in existing if float(claim.confidence or 0) >= 0.68
            ]
            if stronger:
                audits.append(
                    AuditRow(
                        source_name,
                        parent_company,
                        "retained",
                        cast(int, org.id),
                        cast(str, org.name),
                        "existing equal-or-stronger claim",
                    )
                )
                continue
            audits.append(
                AuditRow(
                    source_name,
                    parent_company,
                    "linked",
                    cast(int, org.id),
                    cast(str, org.name),
                )
            )
            if dry_run:
                continue
            claim_value = {
                "name": cast(str, org.name),
                "organization_id": cast(int, org.id),
            }
            claim = SourceClaim(
                source_name=source_name,
                claim_type="parent_company",
                claim_value=claim_value,
                claim_kind="factual",
                confidence=0.68,
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
            created += 1

        if not dry_run:
            await session.commit()
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        audit_path.write_text(
            json.dumps(
                {
                    "dry_run": dry_run,
                    "created": created,
                    "counts": {
                        result: sum(item.result == result for item in audits)
                        for result in {item.result for item in audits}
                    },
                    "rows": [asdict(item) for item in audits],
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true", help="Persist claims; default is dry run"
    )
    parser.add_argument("--source", help="Only process one source")
    parser.add_argument(
        "--audit",
        type=Path,
        default=Path("artifacts/atlas-relationship-backfill.json"),
    )
    args = parser.parse_args()
    asyncio.run(
        run_backfill(
            dry_run=not args.apply, source_only=args.source, audit_path=args.audit
        )
    )


if __name__ == "__main__":
    main()
