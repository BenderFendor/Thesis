"""Flag pure wire/agency reporter rows (audit rec 4).

13 covered reporter rows are literally agency names (AP, Associated Press,
Reuters, AFP, Bloomberg News, ...), plus 3 "wire-code stub" rows (AP, RT,
SG) the audit's `absurd_length_short` tag caught separately. Their
`authored_by -> <syndication client outlet>` edges read as "AP is employed
by NewsNation," which fails an employment reading even though the literal
byline-to-article fact ("this article's byline said AP") is true.

This never deletes or renames those rows -- `Reporter.is_collective=True`
is a marker the Atlas graph projection filters out of both the node list
and the coverage denominator (see `atlas_graph_projection.py`), and the
byline-ingest stage skips minting new claims for flagged rows (see
`ingest_reporter_bylines.py`). Existing `authored_by` candidate claims for
already-flagged rows are retracted -- never deleted -- since crediting a
named client outlet as an agency's "author" is the misleading fact the
audit called out.

Detection is a small explicit list (the audit's confirmed 13+3 names,
case/whitespace-normalized) rather than a broad heuristic: agency detection
false-positiving on a real journalist's name would wrongly hide a person
from the Atlas, which is worse than under-flagging a few more wire rows in
a future pass.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Reporter, get_utc_now
from app.models.evidence import EntityExternalId, EvidenceClaim

logger = get_logger("reporter_agency_flag")

# Normalized (lowercase, collapsed-whitespace) exact names -- see module
# docstring. Matches `Reporter.normalized_name`'s own normalization rule.
AGENCY_NORMALIZED_NAMES: frozenset[str] = frozenset(
    {
        "ap",
        "rt",
        "sg",
        "afp",
        "reuters",
        "agencies",
        "bloomberg news",
        "associated press",
        "the associated press",
        "agence france-presse",
        "agence france-press",  # typo variant present in the corpus
    }
)


@dataclass
class AgencyFlagReport:
    """Summary counters for one flagging pass."""

    reporters_flagged: int = 0
    claims_retracted: int = 0


def is_agency_name(normalized_name: str) -> bool:
    """Return True when `normalized_name` is an exact known wire/agency name."""
    return normalized_name.strip().lower() in AGENCY_NORMALIZED_NAMES


async def flag_agency_reporters(db: AsyncSession) -> AgencyFlagReport:
    """Set `is_collective=True` on matching rows and retract their authored_by claims.

    Idempotent: rows already flagged, and claims already retracted, are
    left untouched on a re-run.
    """
    report = AgencyFlagReport()
    rows = list(
        (
            await db.execute(
                select(Reporter).where(
                    Reporter.is_collective.is_(False),
                    Reporter.retirement_reason.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    newly_flagged_ids: list[int] = []
    for reporter in rows:
        normalized = str(reporter.normalized_name or reporter.name or "")
        if not is_agency_name(normalized):
            continue
        reporter.is_collective = True
        report.reporters_flagged += 1
        newly_flagged_ids.append(cast(int, reporter.id))

    if newly_flagged_ids:
        now = get_utc_now()
        claim_rows = (
            (
                await db.execute(
                    select(EvidenceClaim)
                    .join(
                        EntityExternalId,
                        (EntityExternalId.entity_id == EvidenceClaim.subject_entity_id)
                        & (EntityExternalId.scheme == "scoop_reporter_id"),
                    )
                    .where(
                        EvidenceClaim.predicate == "authored_by",
                        EvidenceClaim.retracted_at.is_(None),
                        EntityExternalId.value.in_([str(rid) for rid in newly_flagged_ids]),
                    )
                )
            )
            .scalars()
            .all()
        )
        for claim in claim_rows:
            claim.retracted_at = now
            report.claims_retracted += 1

    if report.reporters_flagged:
        logger.info(
            "reporter_agency_flag: flagged=%d claims_retracted=%d",
            report.reporters_flagged,
            report.claims_retracted,
        )
    return report
