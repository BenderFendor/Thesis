#!/usr/bin/env python3
"""Recompute and persist reporter confidence tiers from current evidence."""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from sqlalchemy import select

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.database import Reporter  # noqa: E402
from app.services.reporter_confidence_scorer import compute_confidence_tier  # noqa: E402


async def _get_session() -> Any:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def recompute_reporter_confidence(*, apply: bool = False) -> dict[str, Any]:
    session = await _get_session()
    changed = 0
    tier_counts: Counter[str] = Counter()
    try:
        reporters = list(
            (await session.execute(select(Reporter).order_by(Reporter.id))).scalars().all()
        )
        for reporter in reporters:
            old_tier = reporter.confidence_tier
            old_score = reporter.confidence_score
            tier, score, _evidence = await compute_confidence_tier(session, reporter)
            tier_counts[tier] += 1
            if old_tier != tier or old_score != score:
                changed += 1
                if apply:
                    reporter.confidence_tier = tier
                    reporter.confidence_score = score

        if apply:
            await session.commit()
        else:
            await session.rollback()
        return {
            "reporters_scanned": len(reporters),
            "reporters_changed": changed,
            "tier_counts": dict(tier_counts),
        }
    finally:
        await session.close()


async def main_async(args: argparse.Namespace) -> int:
    metrics = await recompute_reporter_confidence(apply=args.apply)
    for key, value in metrics.items():
        print(f"{key}={value}")
    print(f"mode={'apply' if args.apply else 'dry_run'}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recompute reporter confidence tiers from current evidence."
    )
    parser.add_argument("--apply", action="store_true", help="Persist recomputed tiers and scores.")
    return parser.parse_args()


def main() -> int:
    return asyncio.run(main_async(parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
