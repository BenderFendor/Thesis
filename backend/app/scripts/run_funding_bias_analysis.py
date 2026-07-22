"""CLI entry point for the Phase 5 funding-vs-bias correlation analysis.

Usage:
    python -m app.scripts.run_funding_bias_analysis

Preregisters the methodology (idempotent, a no-op after the first run),
then computes and persists the current funding_type x bias_rating
contingency table and Cramer's V as a `CalculationTrace`. Safe to run
repeatedly -- see `app.services.funding_bias_analysis.run_funding_bias_
analysis` for the idempotency guarantee (same population data -> same
trace id, no duplicate rows).

Runs against the app's configured database (see
`app.database.AsyncSessionLocal`), same as `ingest_evidence.py`.
"""

from __future__ import annotations

import asyncio
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import configure_logging, get_logger
from app.database import AsyncSessionLocal, init_db
from app.services.funding_bias_analysis import (
    VALIDATION_CARD_SKIP_REASON,
    FundingBiasRun,
    run_funding_bias_analysis,
)

logger = get_logger(__name__)


def _print_report(run: FundingBiasRun) -> None:
    print("[funding_bias_analysis]")
    print(f"  preregistration id:   {run.preregistration.id}")
    print(f"  calculation trace id: {run.trace.id}")
    print(f"  population size:      {run.population_size}")
    print(f"  contingency table:    {run.rows} x {run.cols}")
    for row_label, row in zip(run.rows, run.table, strict=True):
        print(f"    {row_label}: {row}")
    print(f"  n:                    {run.statistic.get('n')}")
    print(f"  chi-square:           {run.statistic.get('chi_square')}")
    print(f"  degrees of freedom:   {run.statistic.get('degrees_of_freedom')}")
    print(f"  Cramer's V:           {run.statistic.get('cramers_v')}")
    print(f"  interpretation:       {run.statistic.get('interpretation')}")
    if run.statistic.get("note"):
        print(f"  note:                 {run.statistic.get('note')}")
    print(f"  validation card:      skipped -- {VALIDATION_CARD_SKIP_REASON}")


async def main() -> None:
    """Run the preregister-then-compute pipeline and print a summary report."""
    configure_logging()
    await init_db()
    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available for funding-bias analysis")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)

    async with factory() as db:
        run = await run_funding_bias_analysis(db)
        await db.commit()
        _print_report(run)


if __name__ == "__main__":
    asyncio.run(main())
