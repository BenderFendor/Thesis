#!/usr/bin/env python3
"""Plan source-by-source reporter author-page enrichment.

This script reads existing reporter/article attribution rows and recommends
which sources should be enriched next. It does not verify reporters itself; it
only reports the current verified rows and estimates the remaining work needed
to reach a 70% verified reporter target per source.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import math
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import urlparse, urlunparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.data.rss_sources import get_rss_sources  # noqa: E402
from app.database import Article, ArticleAuthor, Reporter  # noqa: E402
from app.services.reporter_confidence_scorer import is_author_profile_url  # noqa: E402
from app.services.reporter_public_records import clean_author_name  # noqa: E402


VERIFIED_TARGET_RATIO = 0.70
DISALLOWED_LOCAL_BYLINE_SOURCE_TERMS = (
    "academic preprint",
    "aggregator",
    "link aggregator",
    "platform-owned",
)
BLOCKED_ACCESS_SOURCE_TERMS = (
    "axios",
    "bloomberg",
    "newsnation",
    "report.az",
    "wall street journal",
    "wsj",
)
SOURCE_STRATEGY_OVERRIDES: dict[str, str] = {
    "abc news australia": "official_author_page_extraction",
    "new york times": "guessed_author_page_profiles",
    "the guardian": "guessed_author_page_profiles",
    "guardian": "guessed_author_page_profiles",
    "guardian - uk": "guessed_author_page_profiles",
    "the diplomat": "guessed_author_page_profiles",
    "diplomat": "guessed_author_page_profiles",
    "war on the rocks": "guessed_author_page_profiles",
    "washington times": "guessed_author_page_profiles",
    "washington times - politics": "guessed_author_page_profiles",
}
TIER_ORDER = ("verified", "strong", "likely", "unmatched", "unknown")


@dataclass(frozen=True)
class ReporterSourceFact:
    source: str
    reporter_id: int
    confidence_tier: str | None = None
    author_page_url: str | None = None
    article_count: int = 1
    reporter_name: str = ""
    canonical_name: str | None = None


@dataclass(frozen=True)
class Strategy:
    strategy_id: str
    workflow: str
    command_template: str
    reason: str


@dataclass(frozen=True)
class SourceEnrichmentRow:
    source: str
    eligible_reporters: int
    verified_reporters: int
    strong_reporters: int
    likely_reporters: int
    unmatched_reporters: int
    unknown_tier_reporters: int
    unverified_reporters: int
    likely_backlog: int
    verified_target_70pct: int
    verified_shortfall: int
    strategy_id: str
    workflow: str
    command_template: str
    rank_score: tuple[int, int, int, str]

    def as_csv_row(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "eligible_reporters": self.eligible_reporters,
            "verified_reporters": self.verified_reporters,
            "strong_reporters": self.strong_reporters,
            "likely_reporters": self.likely_reporters,
            "unmatched_reporters": self.unmatched_reporters,
            "unknown_tier_reporters": self.unknown_tier_reporters,
            "unverified_reporters": self.unverified_reporters,
            "likely_backlog": self.likely_backlog,
            "verified_target_70pct": self.verified_target_70pct,
            "verified_shortfall": self.verified_shortfall,
            "strategy_id": self.strategy_id,
            "workflow": self.workflow,
            "command_template": self.command_template,
        }


@dataclass(frozen=True)
class ReporterBacklogRow:
    source: str
    reporter_id: int
    reporter_name: str
    canonical_name: str
    confidence_tier: str
    article_count: int
    strategy_id: str
    source_verified_shortfall: int
    command_template: str

    def as_csv_row(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "reporter_id": self.reporter_id,
            "reporter_name": self.reporter_name,
            "canonical_name": self.canonical_name,
            "confidence_tier": self.confidence_tier,
            "article_count": self.article_count,
            "strategy_id": self.strategy_id,
            "source_verified_shortfall": self.source_verified_shortfall,
            "command_template": self.command_template,
        }


def _normalized_author_url(value: str | None) -> str:
    if not is_author_profile_url(value):
        return ""
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower().removeprefix("www."),
            parsed.path.rstrip("/"),
            "",
            "",
            "",
        )
    )


def _normalized_source_label(value: str | None) -> str:
    normalized = " ".join(str(value or "").lower().split())
    if normalized.startswith("the "):
        return normalized[4:]
    return normalized


def _source_matches_filter(source_name: str, requested_source: str | None) -> bool:
    if not requested_source:
        return True
    return _normalized_source_label(source_name) == _normalized_source_label(requested_source)


def _is_combined_byline_name(value: str | None) -> bool:
    name = clean_author_name(str(value or ""))
    if not name:
        return False
    lowered = name.lower()
    return bool(
        " and " in lowered
        or " with " in lowered
        or " & " in lowered
        or " y " in lowered
        or "," in name
    )


def _is_source_label_byline(author: str | None, source: str | None) -> bool:
    author_label = _normalized_source_label(author)
    source_label = _normalized_source_label(source)
    return bool(author_label and source_label and author_label == source_label)


def reporter_fact_is_eligible(fact: ReporterSourceFact) -> bool:
    """Return whether a reporter/source fact matches the broad eligible cohort."""
    name_value = fact.canonical_name or fact.reporter_name
    if not name_value:
        return fact.article_count >= 1
    reporter_name = clean_author_name(name_value)
    raw_name = fact.reporter_name or fact.canonical_name or ""
    return bool(
        fact.article_count >= 1
        and reporter_name
        and not _is_combined_byline_name(raw_name)
        and not _is_source_label_byline(raw_name, fact.source)
    )


def _identity_key_for_fact(fact: ReporterSourceFact) -> str:
    author_url = _normalized_author_url(fact.author_page_url)
    if author_url:
        return f"author_url:{author_url}"
    clean_name = clean_author_name(fact.canonical_name or fact.reporter_name) or ""
    return f"source:{_normalized_source_label(fact.source)}|name:{clean_name.casefold()}"


def _best_fact_for_identity(facts: Iterable[ReporterSourceFact]) -> ReporterSourceFact:
    """Choose the strongest representative row for one reporter identity."""
    tier_rank = {tier: index for index, tier in enumerate(TIER_ORDER)}

    def sort_key(fact: ReporterSourceFact) -> tuple[int, int, int, str]:
        tier = _tier(fact.confidence_tier)
        has_author_url = int(bool(_normalized_author_url(fact.author_page_url)))
        return (
            -has_author_url,
            tier_rank.get(tier, len(tier_rank)),
            -int(fact.article_count),
            fact.reporter_name.casefold(),
        )

    return sorted(facts, key=sort_key)[0]


def dedupe_reporter_facts_by_identity(
    facts: Iterable[ReporterSourceFact],
) -> list[ReporterSourceFact]:
    """Collapse obvious byline aliases before planning source work."""
    groups: dict[tuple[str, str], list[ReporterSourceFact]] = {}
    for fact in facts:
        groups.setdefault((fact.source, _identity_key_for_fact(fact)), []).append(fact)
    return [_best_fact_for_identity(group) for group in groups.values()]


def _source_config_for_name(
    source_name: str,
    source_configs: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    if source_name in source_configs:
        return source_configs[source_name]
    normalized_source = _normalized_source_label(source_name)
    for name, config in source_configs.items():
        if _normalized_source_label(name) == normalized_source:
            return config
    return None


def source_is_eligible(
    source_name: str,
    source_configs: dict[str, dict[str, Any]],
) -> bool:
    """Return whether local reporter enrichment is appropriate for the source."""
    config = _source_config_for_name(source_name, source_configs)
    if config is None:
        return True
    evidence_text = " ".join(
        str(config.get(key) or "") for key in ("ownership_label", "category", "funding_type", "url")
    ).lower()
    return not any(term in evidence_text for term in DISALLOWED_LOCAL_BYLINE_SOURCE_TERMS)


def _tier(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in TIER_ORDER else "unknown"


def _source_likely_blocked(
    source_name: str,
    source_configs: dict[str, dict[str, Any]],
) -> bool:
    config = _source_config_for_name(source_name, source_configs) or {}
    haystack = " ".join(
        [source_name, str(config.get("url") or ""), str(config.get("website") or "")]
    ).lower()
    return any(term in haystack for term in BLOCKED_ACCESS_SOURCE_TERMS)


def _source_strategy_override(source_name: str) -> str | None:
    normalized = _normalized_source_label(source_name)
    return SOURCE_STRATEGY_OVERRIDES.get(normalized)


def _quote_source(source: str) -> str:
    return "'" + source.replace("'", "'\"'\"'") + "'"


def build_enrichment_command(
    source: str,
    *,
    strategy_id: str,
    target_promotions: int,
    max_articles_per_reporter: int = 3,
) -> str:
    """Return a dry-run command template for the existing author-page enricher."""
    base = (
        "uv run python backend/scripts/enrich_local_reporter_author_pages.py"
        f" --source {_quote_source(source)}"
        f" --target-promotions {max(target_promotions, 1)}"
        f" --max-articles-per-reporter {max_articles_per_reporter}"
    )
    if strategy_id == "guessed_author_page_profiles":
        return f"{base} --include-guessed-author-pages --max-guessed-author-pages 10"
    if strategy_id == "blocked_cloudflare_manual":
        return (
            f"{base} --limit-reporters {max(target_promotions * 2, 10)}"
            " # review access_barriers before any --apply run"
        )
    return base


def choose_strategy(
    source: str,
    *,
    likely_backlog: int,
    unverified_reporters: int,
    source_configs: dict[str, dict[str, Any]],
    target_promotions: int,
) -> Strategy:
    """Choose the recommended source-specific workflow."""
    if _source_likely_blocked(source, source_configs):
        strategy_id = "blocked_cloudflare_manual"
        return Strategy(
            strategy_id=strategy_id,
            workflow=(
                "Blocked or challenge-prone source. Run a bounded dry run, inspect "
                "access_barriers and sample_rejected, then handle manually before applying."
            ),
            command_template=build_enrichment_command(
                source,
                strategy_id=strategy_id,
                target_promotions=target_promotions,
            ),
            reason="source has known access-barrier risk",
        )
    strategy_override = _source_strategy_override(source)
    if strategy_override == "guessed_author_page_profiles":
        return Strategy(
            strategy_id=strategy_override,
            workflow=(
                "Use bounded source-specific author-page guesses after article metadata "
                "fails. Guesses still require a fetched same-host profile-name match."
            ),
            command_template=build_enrichment_command(
                source,
                strategy_id=strategy_override,
                target_promotions=target_promotions,
            ),
            reason="source has stable public author-page URL patterns",
        )
    if strategy_override == "official_author_page_extraction":
        return Strategy(
            strategy_id=strategy_override,
            workflow=(
                "Use article-exposed official author links first. Promote only fetched "
                "same-host author pages whose profile name matches the reporter."
            ),
            command_template=build_enrichment_command(
                source,
                strategy_id=strategy_override,
                target_promotions=target_promotions,
            ),
            reason="source exposes official author profile links in article metadata",
        )
    if likely_backlog > 0:
        strategy_id = "official_author_page_extraction"
        return Strategy(
            strategy_id=strategy_id,
            workflow=(
                "Start with article-exposed author links. Promote only fetched same-host "
                "author pages whose profile name matches the reporter."
            ),
            command_template=build_enrichment_command(
                source,
                strategy_id=strategy_id,
                target_promotions=target_promotions,
            ),
            reason="likely local-byline reporters are ready for official extraction",
        )
    strategy_id = "guessed_author_page_profiles"
    return Strategy(
        strategy_id=strategy_id,
        workflow=(
            "Use bounded same-host author-page guesses after article metadata fails. "
            "Guesses still require a fetched profile-name match before promotion."
        ),
        command_template=build_enrichment_command(
            source,
            strategy_id=strategy_id,
            target_promotions=max(target_promotions, unverified_reporters),
        ),
        reason="remaining backlog needs guessed profile patterns",
    )


def summarize_source_backlog(
    facts: Iterable[ReporterSourceFact],
    *,
    source_configs: dict[str, dict[str, Any]] | None = None,
    target_ratio: float = VERIFIED_TARGET_RATIO,
) -> list[SourceEnrichmentRow]:
    """Aggregate reporter enrichment backlog by source."""
    source_configs = source_configs or {}
    grouped: dict[str, dict[int, ReporterSourceFact]] = {}
    for fact in facts:
        if (
            not fact.source
            or not source_is_eligible(fact.source, source_configs)
            or not reporter_fact_is_eligible(fact)
        ):
            continue
        grouped.setdefault(fact.source, {})
        current = grouped[fact.source].get(fact.reporter_id)
        if current is None or fact.article_count > current.article_count:
            grouped[fact.source][fact.reporter_id] = fact

    rows: list[SourceEnrichmentRow] = []
    for source, by_reporter in grouped.items():
        tier_counts = dict.fromkeys(TIER_ORDER, 0)
        for fact in by_reporter.values():
            tier_counts[_tier(fact.confidence_tier)] += 1
        eligible = len(by_reporter)
        verified = tier_counts["verified"]
        unverified = eligible - verified
        likely_backlog = tier_counts["likely"] + tier_counts["unmatched"] + tier_counts["unknown"]
        target = math.ceil(eligible * target_ratio)
        shortfall = max(target - verified, 0)
        strategy = choose_strategy(
            source,
            likely_backlog=likely_backlog,
            unverified_reporters=unverified,
            source_configs=source_configs,
            target_promotions=shortfall,
        )
        rank_score = (likely_backlog, unverified, shortfall, source.lower())
        rows.append(
            SourceEnrichmentRow(
                source=source,
                eligible_reporters=eligible,
                verified_reporters=verified,
                strong_reporters=tier_counts["strong"],
                likely_reporters=tier_counts["likely"],
                unmatched_reporters=tier_counts["unmatched"],
                unknown_tier_reporters=tier_counts["unknown"],
                unverified_reporters=unverified,
                likely_backlog=likely_backlog,
                verified_target_70pct=target,
                verified_shortfall=shortfall,
                strategy_id=strategy.strategy_id,
                workflow=strategy.workflow,
                command_template=strategy.command_template,
                rank_score=rank_score,
            )
        )

    return sorted(
        rows,
        key=lambda row: (
            -row.likely_backlog,
            -row.unverified_reporters,
            -row.verified_shortfall,
            row.source,
        ),
    )


def summarize_reporter_backlog(
    facts: Iterable[ReporterSourceFact],
    *,
    source_configs: dict[str, dict[str, Any]] | None = None,
    target_ratio: float = VERIFIED_TARGET_RATIO,
) -> list[ReporterBacklogRow]:
    """Return unverified eligible reporter/source facts with source workflow context."""
    fact_list = list(facts)
    source_rows = {
        row.source: row
        for row in summarize_source_backlog(
            fact_list,
            source_configs=source_configs,
            target_ratio=target_ratio,
        )
    }
    rows: list[ReporterBacklogRow] = []
    seen: set[tuple[str, int]] = set()
    for fact in fact_list:
        source_row = source_rows.get(fact.source)
        if source_row is None:
            continue
        tier = _tier(fact.confidence_tier)
        if tier == "verified" or not reporter_fact_is_eligible(fact):
            continue
        key = (fact.source, fact.reporter_id)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            ReporterBacklogRow(
                source=fact.source,
                reporter_id=fact.reporter_id,
                reporter_name=fact.reporter_name,
                canonical_name=fact.canonical_name or "",
                confidence_tier=tier,
                article_count=fact.article_count,
                strategy_id=source_row.strategy_id,
                source_verified_shortfall=source_row.verified_shortfall,
                command_template=source_row.command_template,
            )
        )

    return sorted(
        rows,
        key=lambda row: (
            -row.source_verified_shortfall,
            row.source,
            -row.article_count,
            row.reporter_name.casefold(),
            row.reporter_id,
        ),
    )


async def load_reporter_source_facts(
    session: AsyncSession,
    *,
    limit_sources: int | None = None,
) -> list[ReporterSourceFact]:
    """Load source/reporter coverage facts from persisted article attribution rows."""
    stmt = (
        select(
            Article.source,
            Reporter.id,
            Reporter.name,
            Reporter.canonical_name,
            Reporter.confidence_tier,
            Reporter.author_page_url,
            func.count(ArticleAuthor.id).label("article_count"),
        )
        .join(ArticleAuthor, ArticleAuthor.article_id == Article.id)
        .join(Reporter, Reporter.id == ArticleAuthor.reporter_id)
        .where(Article.source.isnot(None))
        .where(Article.source != "")
        .group_by(
            Article.source,
            Reporter.id,
            Reporter.name,
            Reporter.canonical_name,
            Reporter.confidence_tier,
            Reporter.author_page_url,
        )
        .order_by(func.count(ArticleAuthor.id).desc(), Article.source, Reporter.id)
    )
    rows = (await session.execute(stmt)).all()
    facts = [
        ReporterSourceFact(
            source=str(source),
            reporter_id=int(reporter_id),
            reporter_name=str(reporter_name or ""),
            canonical_name=str(canonical_name) if canonical_name else None,
            confidence_tier=str(confidence_tier) if confidence_tier is not None else None,
            author_page_url=str(author_page_url) if author_page_url else None,
            article_count=int(article_count or 0),
        )
        for (
            source,
            reporter_id,
            reporter_name,
            canonical_name,
            confidence_tier,
            author_page_url,
            article_count,
        ) in rows
    ]
    if limit_sources is None:
        return facts
    ranked_sources = {
        row.source
        for row in summarize_source_backlog(facts, source_configs=get_rss_sources())[:limit_sources]
    }
    return [fact for fact in facts if fact.source in ranked_sources]


def write_rows_csv(rows: list[SourceEnrichmentRow], output: TextIO) -> None:
    fieldnames = list(
        SourceEnrichmentRow("", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "", "", "", ()).as_csv_row()
    )
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.as_csv_row())


def write_reporter_rows_csv(rows: list[ReporterBacklogRow], output: TextIO) -> None:
    fieldnames = list(ReporterBacklogRow("", 0, "", "", "", 0, "", 0, "").as_csv_row())
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.as_csv_row())


async def _get_session() -> AsyncSession:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def main_async(args: argparse.Namespace) -> int:
    session = await _get_session()
    try:
        facts = await load_reporter_source_facts(session)
    finally:
        await session.close()

    if args.source:
        facts = [fact for fact in facts if _source_matches_filter(fact.source, args.source)]
    if args.dedupe_identities:
        facts = dedupe_reporter_facts_by_identity(facts)

    source_configs = get_rss_sources()
    output: TextIO
    output_path = Path(args.output) if args.output and args.output != "-" else None
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output = output_path.open("w", encoding="utf-8", newline="")
    else:
        output = sys.stdout
    if args.mode == "reporters":
        reporter_rows = summarize_reporter_backlog(facts, source_configs=source_configs)
        if args.limit_reporters and args.limit_reporters > 0:
            reporter_rows = reporter_rows[: args.limit_reporters]
        try:
            write_reporter_rows_csv(reporter_rows, output)
        finally:
            if output_path:
                output.close()
        return 0

    rows = summarize_source_backlog(facts, source_configs=source_configs)
    if args.limit_sources and args.limit_sources > 0:
        rows = rows[: args.limit_sources]
    try:
        write_rows_csv(rows, output)
    finally:
        if output_path:
            output.close()
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Plan source-by-source reporter author-page enrichment backlog."
    )
    parser.add_argument(
        "--mode",
        choices=("sources", "reporters"),
        default="sources",
        help="Print source-level plan rows or reporter-level unverified backlog rows.",
    )
    parser.add_argument(
        "--limit-sources",
        type=int,
        default=25,
        help="Maximum ranked source rows to print. Use 0 for all rows.",
    )
    parser.add_argument(
        "--limit-reporters",
        type=int,
        default=200,
        help="Maximum reporter backlog rows to print in --mode reporters. Use 0 for all rows.",
    )
    parser.add_argument(
        "--source",
        help="Restrict planning to one source label. The match ignores a leading 'The'.",
    )
    parser.add_argument(
        "--dedupe-identities",
        action="store_true",
        help=(
            "Plan by cleaned source/name or public author-page identity instead of raw "
            "reporter rows."
        ),
    )
    parser.add_argument(
        "--output",
        default="-",
        help="CSV output path. Defaults to stdout.",
    )
    return parser.parse_args()


def main() -> int:
    return asyncio.run(main_async(parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
