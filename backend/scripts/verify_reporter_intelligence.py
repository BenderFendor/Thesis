#!/usr/bin/env python3
"""Verify reporter intelligence - per-source aggregation.

Iterates over all reporters, groups by source, and reports per-source
intelligence metrics: total reporters, confidence tier distribution,
average score, author page coverage, and claims coverage.

Usage:
    python scripts/verify_reporter_intelligence.py
    python scripts/verify_reporter_intelligence.py --trend
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

from sqlalchemy import func, select

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

from app.database import Article, ArticleAuthor, Reporter  # noqa: E402
from app.services.reporter_confidence_scorer import (  # noqa: E402
    compute_confidence_tier,
    has_supporting_byline_evidence,
    has_verified_author_page_citation,
    has_journalism_profile_evidence,
    has_person_like_reporter_name,
    is_author_profile_url,
)
from app.services.reporter_public_records import clean_author_name  # noqa: E402

TREND_CACHE_PATH = Path(REPO_BACKEND) / "scripts" / ".reporter_intel_trend_cache.json"


@dataclass(frozen=True)
class EligibleReporter:
    reporter: Reporter
    article_link_count: int
    sources: tuple[str, ...]


async def _get_session() -> Any:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database not available")
    return AsyncSessionLocal()


async def _load_reporters(session: Any) -> list[Reporter]:
    result = await session.execute(select(Reporter).order_by(Reporter.name))
    return list(result.scalars().all())


async def _load_reporter_sources(session: Any, reporter_ids: list[int]) -> dict[int, list[str]]:
    if not reporter_ids:
        return {}
    result = await session.execute(
        select(ArticleAuthor.reporter_id, Article.source)
        .join(Article, Article.id == ArticleAuthor.article_id)
        .where(ArticleAuthor.reporter_id.in_(reporter_ids))
        .distinct()
    )
    source_map: dict[int, list[str]] = {}
    for rid, source_name in result.all():
        source_map.setdefault(int(rid), []).append(str(source_name))
    return source_map


async def _load_reporter_article_counts(session: Any) -> dict[int, int]:
    result = await session.execute(
        select(ArticleAuthor.reporter_id, func.count(ArticleAuthor.id)).group_by(
            ArticleAuthor.reporter_id
        )
    )
    return {int(reporter_id): int(count or 0) for reporter_id, count in result.all()}


def _author_page_citation_present(reporter: Reporter) -> bool:
    return has_verified_author_page_citation(reporter)


def _sample_reporter(reporter: Reporter) -> str:
    return f"{reporter.id or '-'}:{reporter.name or '-'}"


def _is_qid_like_name(value: str | None) -> bool:
    normalized = str(value or "").strip().lower()
    return bool(normalized.startswith("q") and normalized[1:].isdigit())


def _is_combined_byline_name(value: str | None) -> bool:
    name = clean_author_name(str(value or ""))
    if not name:
        return False
    lowered = name.lower()
    if any(separator in lowered for separator in (" and ", " with ", " & ", " y ")):
        return True
    if "," not in name:
        return False
    parts = [part.strip() for part in name.split(",") if part.strip()]
    if len(parts) < 2:
        return False
    suffixes = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d."}
    return parts[1].lower() not in suffixes


def _normalized_source_label(value: str | None) -> str:
    normalized = " ".join(str(value or "").lower().strip().split())
    if normalized.startswith("the "):
        normalized = normalized[4:]
    return normalized


def _is_source_label_byline(author: str | None, source: str | None) -> bool:
    author_label = _normalized_source_label(author)
    source_label = _normalized_source_label(source)
    return bool(author_label and source_label and author_label == source_label)


def _profile_issue_samples(
    reporters: list[Reporter],
    reporter_sources: dict[int, list[str]],
) -> dict[str, Any]:
    issue_counts: Counter[str] = Counter()
    samples: dict[str, list[str]] = {}
    blocking_failure_count = 0
    backlog_issue_count = 0

    def record(issue: str, reporter: Reporter) -> None:
        nonlocal blocking_failure_count, backlog_issue_count
        issue_counts[issue] += 1
        tier = str(reporter.confidence_tier or "unmatched")
        if tier in {"verified", "strong"}:
            blocking_failure_count += 1
        else:
            backlog_issue_count += 1
        bucket = samples.setdefault(issue, [])
        if len(bucket) < 10:
            source_hint = ", ".join(reporter_sources.get(int(reporter.id or 0), [])[:2])
            bucket.append(
                f"{_sample_reporter(reporter)}"
                f"|tier={tier}"
                f"|canonical={reporter.canonical_name or '-'}"
                f"|qid={reporter.wikidata_qid or '-'}"
                f"|source={source_hint or '-'}"
            )

    for reporter in reporters:
        tier = str(reporter.confidence_tier or "unmatched")
        if tier in {"verified", "strong"}:
            if not has_person_like_reporter_name(reporter):
                record(f"{tier}_missing_person_like_name", reporter)
            if _is_qid_like_name(str(reporter.name or "")) and _is_qid_like_name(
                str(reporter.canonical_name or "")
            ):
                record(f"{tier}_qid_label_name", reporter)
            has_author_profile = is_author_profile_url(
                str(reporter.author_page_url or "")
            ) or is_author_profile_url(str(reporter.canonical_author_url or ""))
            if (
                tier == "strong"
                and not has_journalism_profile_evidence(reporter)
                and not has_author_profile
                and not has_supporting_byline_evidence(reporter)
            ):
                record(f"{tier}_missing_journalism_profile_evidence", reporter)

        if reporter.match_status == "local_byline":
            if reporter.id is None or int(reporter.id) not in reporter_sources:
                record(f"{tier}_local_byline_without_article_links", reporter)
            if _is_combined_byline_name(str(reporter.name or "")):
                record(f"{tier}_combined_local_byline_name", reporter)
            source_candidates = list(reporter_sources.get(int(reporter.id or 0), []))
            source_candidates.extend(_source_names_from_career_history(reporter))
            if any(
                _is_source_label_byline(str(reporter.name or ""), source)
                for source in source_candidates
            ):
                record(f"{tier}_source_label_local_byline_name", reporter)

    return {
        "total_reporters": len(reporters),
        "issue_counts": dict(issue_counts),
        "sample_issues": samples,
        "quality_failures": blocking_failure_count,
        "backlog_issues": backlog_issue_count,
        "total_issues": blocking_failure_count + backlog_issue_count,
    }


def _eligible_reporters(
    reporters: list[Reporter],
    reporter_sources: dict[int, list[str]],
    reporter_article_counts: dict[int, int],
    *,
    min_article_links: int,
) -> list[EligibleReporter]:
    eligible: list[EligibleReporter] = []
    for reporter in reporters:
        reporter_id = reporter.id
        if reporter_id is None:
            continue
        rid = int(reporter_id)
        article_count = reporter_article_counts.get(rid, 0)
        sources = tuple(sorted(set(reporter_sources.get(rid, []))))
        if (
            article_count < min_article_links
            or not sources
            or not has_person_like_reporter_name(reporter)
            or _is_combined_byline_name(str(reporter.name or ""))
            or any(_is_source_label_byline(str(reporter.name or ""), source) for source in sources)
        ):
            continue
        eligible.append(
            EligibleReporter(
                reporter=reporter,
                article_link_count=article_count,
                sources=sources,
            )
        )
    return eligible


def _target_verified_count(total: int, target_verified_percent: float) -> int:
    if total <= 0:
        return 0
    import math

    return int(math.ceil(total * (target_verified_percent / 100.0)))


def _eligible_cohort_audit(
    reporters: list[Reporter],
    reporter_sources: dict[int, list[str]],
    reporter_article_counts: dict[int, int],
    *,
    min_article_links: int,
    target_verified_percent: float,
    top_sources_limit: int,
) -> dict[str, Any]:
    all_tier_counts: Counter[str] = Counter(
        str(reporter.confidence_tier or "unmatched") for reporter in reporters
    )
    all_total = len(reporters)
    all_verified = int(all_tier_counts.get("verified", 0))
    all_target_verified = _target_verified_count(all_total, target_verified_percent)
    all_verified_percent = round((all_verified / all_total) * 100, 2) if all_total else 0.0
    eligible = _eligible_reporters(
        reporters,
        reporter_sources,
        reporter_article_counts,
        min_article_links=min_article_links,
    )
    tier_counts: Counter[str] = Counter(
        str(item.reporter.confidence_tier or "unmatched") for item in eligible
    )
    total = len(eligible)
    verified = int(tier_counts.get("verified", 0))
    target_verified = _target_verified_count(total, target_verified_percent)
    verified_shortfall = max(target_verified - verified, 0)
    non_strong_leakage = int(tier_counts.get("likely", 0) + tier_counts.get("unmatched", 0))
    verified_percent = round((verified / total) * 100, 2) if total else 0.0

    source_rows: dict[str, Counter[str]] = {}
    source_article_counts: dict[str, int] = {}
    for item in eligible:
        tier = str(item.reporter.confidence_tier or "unmatched")
        for source_name in item.sources:
            source_rows.setdefault(source_name, Counter())[tier] += 1
            source_article_counts[source_name] = source_article_counts.get(source_name, 0) + int(
                item.article_link_count
            )

    top_sources = []
    for source_name, counts in source_rows.items():
        source_total = int(sum(counts.values()))
        unverified = source_total - int(counts.get("verified", 0))
        leakage = int(counts.get("likely", 0) + counts.get("unmatched", 0))
        top_sources.append(
            {
                "source": source_name,
                "eligible": source_total,
                "verified": int(counts.get("verified", 0)),
                "strong": int(counts.get("strong", 0)),
                "likely": int(counts.get("likely", 0)),
                "unmatched": int(counts.get("unmatched", 0)),
                "unverified": unverified,
                "non_strong_leakage": leakage,
                "article_links": source_article_counts.get(source_name, 0),
            }
        )
    top_sources.sort(
        key=lambda row: (
            -int(row["unverified"]),
            -int(row["non_strong_leakage"]),
            -int(row["eligible"]),
            str(row["source"]),
        )
    )

    failure_count = int(bool(verified_shortfall) + bool(non_strong_leakage))
    return {
        "denominator_rule": (
            "article-attributed reporters from persisted RSS/catalog articles with "
            f"person-like names, at least {min_article_links} ArticleAuthor links, "
            "non-source-label bylines, and no combined byline names"
        ),
        "all_reporters": all_total,
        "all_verified_reporters": all_verified,
        "all_verified_percent": all_verified_percent,
        "all_target_verified_reporters": all_target_verified,
        "all_verified_shortfall": max(all_target_verified - all_verified, 0),
        "min_article_links": min_article_links,
        "target_verified_percent": target_verified_percent,
        "eligible_reporters": total,
        "verified_reporters": verified,
        "strong_reporters": int(tier_counts.get("strong", 0)),
        "likely_reporters": int(tier_counts.get("likely", 0)),
        "unmatched_reporters": int(tier_counts.get("unmatched", 0)),
        "verified_percent": verified_percent,
        "target_verified_reporters": target_verified,
        "verified_shortfall": verified_shortfall,
        "non_strong_leakage": non_strong_leakage,
        "quality_failures": failure_count,
        "top_sources": top_sources[:top_sources_limit],
    }


def _format_eligible_cohort_audit(audit: dict[str, Any]) -> list[str]:
    lines = [
        f"eligible_denominator_rule={audit['denominator_rule']}",
        f"coverage_all_reporters={audit['all_reporters']}",
        f"coverage_all_verified_reporters={audit['all_verified_reporters']}",
        f"coverage_all_verified_percent={float(audit['all_verified_percent']):.2f}",
        f"coverage_all_target_verified_reporters={audit['all_target_verified_reporters']}",
        f"coverage_all_verified_shortfall={audit['all_verified_shortfall']}",
        f"eligible_min_article_links={audit['min_article_links']}",
        f"eligible_target_verified_percent={float(audit['target_verified_percent']):.2f}",
        f"eligible_total_reporters={audit['eligible_reporters']}",
        f"eligible_verified_reporters={audit['verified_reporters']}",
        f"eligible_strong_reporters={audit['strong_reporters']}",
        f"eligible_likely_reporters={audit['likely_reporters']}",
        f"eligible_unmatched_reporters={audit['unmatched_reporters']}",
        f"eligible_verified_percent={float(audit['verified_percent']):.2f}",
        f"eligible_target_verified_reporters={audit['target_verified_reporters']}",
        f"eligible_verified_shortfall={audit['verified_shortfall']}",
        f"eligible_non_strong_leakage={audit['non_strong_leakage']}",
        f"eligible_quality_failures={audit['quality_failures']}",
    ]
    top_sources = audit.get("top_sources") or []
    if top_sources:
        lines.append(
            "eligible_top_sources=source|eligible|verified|strong|likely|unmatched|unverified|non_strong_leakage|article_links"
        )
        for row in top_sources:
            lines.append(
                "eligible_source="
                f"{row['source']}|{row['eligible']}|{row['verified']}|"
                f"{row['strong']}|{row['likely']}|{row['unmatched']}|"
                f"{row['unverified']}|{row['non_strong_leakage']}|{row['article_links']}"
            )
    return lines


def _format_profile_audit(audit: dict[str, Any]) -> list[str]:
    lines = [
        f"profile_total_reporters={audit['total_reporters']}",
        f"profile_quality_failures={audit['quality_failures']}",
        f"profile_backlog_issues={audit.get('backlog_issues', 0)}",
        f"profile_total_issues={audit.get('total_issues', audit['quality_failures'])}",
    ]
    for issue, count in sorted((audit.get("issue_counts") or {}).items()):
        lines.append(f"profile_issue_{issue}={count}")
        samples = (audit.get("sample_issues") or {}).get(issue) or []
        if samples:
            lines.append(f"profile_sample_{issue}={samples}")
    return lines


def _normalized_author_url(value: str | None) -> str:
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


def _normalized_identity_label(value: str | None) -> str:
    return " ".join(str(value or "").split()).casefold()


def _identity_alias_audit(reporters: list[Reporter]) -> dict[str, Any]:
    """Report tiered reporter rows that are likely aliases of the same person."""
    tiered = [
        reporter
        for reporter in reporters
        if str(reporter.confidence_tier or "") in {"verified", "strong"}
    ]
    raw_residue_count = 0
    raw_residue_samples: list[str] = []
    author_url_groups: dict[str, list[Reporter]] = {}

    for reporter in tiered:
        raw_name = str(reporter.name or "").strip()
        cleaned_raw = clean_author_name(raw_name)
        if (
            cleaned_raw
            and raw_name
            and _normalized_identity_label(raw_name) != _normalized_identity_label(cleaned_raw)
        ):
            raw_residue_count += 1
            if len(raw_residue_samples) < 20:
                raw_residue_samples.append(
                    f"{_sample_reporter(reporter)}|cleaned={cleaned_raw}"
                    f"|canonical={reporter.canonical_name or '-'}"
                    f"|url={reporter.author_page_url or '-'}"
                )

        identity_url = ""
        if is_author_profile_url(str(reporter.author_page_url or "")):
            identity_url = str(reporter.author_page_url or "")
        elif is_author_profile_url(str(reporter.canonical_author_url or "")):
            identity_url = str(reporter.canonical_author_url or "")
        normalized_url = _normalized_author_url(identity_url)
        if normalized_url:
            author_url_groups.setdefault(normalized_url, []).append(reporter)

    duplicate_groups: list[dict[str, Any]] = []
    duplicate_rows = 0
    duplicate_conflict_rows = 0
    for author_url, group in sorted(author_url_groups.items()):
        if len(group) < 2:
            continue
        identity_labels = {
            label
            for reporter in group
            if (
                label := _normalized_identity_label(
                    clean_author_name(str(reporter.canonical_name or reporter.name or ""))
                )
            )
        }
        conflict_rows = len(group) - 1 if len(identity_labels) > 1 else 0
        duplicate_rows += len(group) - 1
        duplicate_conflict_rows += conflict_rows
        duplicate_groups.append(
            {
                "author_url": author_url,
                "rows": len(group),
                "conflict_rows": conflict_rows,
                "identity_labels": sorted(identity_labels),
                "sample": [
                    f"{_sample_reporter(reporter)}|canonical={reporter.canonical_name or '-'}"
                    for reporter in group[:8]
                ],
            }
        )

    duplicate_groups.sort(
        key=lambda row: (-int(row["rows"]), str(row["author_url"])),
    )
    unique_author_page_identities = len(
        {url for url, group in author_url_groups.items() if len(group) >= 1}
    )
    return {
        "tiered_reporters": len(tiered),
        "tiered_author_page_identities": unique_author_page_identities,
        "duplicate_author_page_groups": len(duplicate_groups),
        "duplicate_author_page_rows": duplicate_rows,
        "duplicate_author_page_conflict_rows": duplicate_conflict_rows,
        "raw_byline_residue": raw_residue_count,
        "sample_raw_byline_residue": raw_residue_samples,
        "sample_duplicate_author_pages": duplicate_groups[:20],
        "quality_failures": duplicate_conflict_rows,
    }


def _format_identity_alias_audit(audit: dict[str, Any]) -> list[str]:
    lines = [
        f"identity_tiered_reporters={audit['tiered_reporters']}",
        f"identity_tiered_author_page_identities={audit['tiered_author_page_identities']}",
        f"identity_duplicate_author_page_groups={audit['duplicate_author_page_groups']}",
        f"identity_duplicate_author_page_rows={audit['duplicate_author_page_rows']}",
        f"identity_duplicate_author_page_conflict_rows={audit['duplicate_author_page_conflict_rows']}",
        f"identity_raw_byline_residue={audit['raw_byline_residue']}",
        f"identity_quality_failures={audit['quality_failures']}",
    ]
    raw_samples = audit.get("sample_raw_byline_residue") or []
    if raw_samples:
        lines.append(f"identity_sample_raw_byline_residue={raw_samples}")
    duplicate_samples = audit.get("sample_duplicate_author_pages") or []
    for row in duplicate_samples:
        lines.append(
            "identity_duplicate_author_page="
            f"{row['author_url']}|rows={row['rows']}|conflict_rows={row['conflict_rows']}"
            f"|labels={row['identity_labels']}|sample={row['sample']}"
        )
    return lines


def _audit_reporter_quality(reporters: list[Reporter]) -> dict[str, Any]:
    verified = [reporter for reporter in reporters if reporter.confidence_tier == "verified"]
    bad_non_person = [
        reporter for reporter in verified if not clean_author_name(str(reporter.name or ""))
    ]
    bad_author_page = [
        reporter
        for reporter in verified
        if not (
            is_author_profile_url(str(reporter.author_page_url or ""))
            or is_author_profile_url(str(reporter.canonical_author_url or ""))
        )
    ]
    bad_author_page_citation = [
        reporter for reporter in verified if not _author_page_citation_present(reporter)
    ]

    failures = {
        "verified_non_person_names": bad_non_person,
        "verified_non_public_author_pages": bad_author_page,
        "verified_missing_author_page_citations": bad_author_page_citation,
    }
    failure_count = sum(len(items) for items in failures.values())
    return {
        "total_reporters": len(reporters),
        "verified_reporters": len(verified),
        "verified_person_names": len(verified) - len(bad_non_person),
        "verified_public_author_pages": len(verified) - len(bad_author_page),
        "verified_author_profile_pages": len(verified) - len(bad_author_page),
        "verified_author_page_citations": len(verified) - len(bad_author_page_citation),
        "quality_failures": failure_count,
        "sample_verified_non_person_names": [_sample_reporter(r) for r in bad_non_person[:10]],
        "sample_verified_non_public_author_pages": [
            f"{_sample_reporter(r)}:{r.author_page_url or '-'}" for r in bad_author_page[:10]
        ],
        "sample_verified_missing_author_page_citations": [
            f"{_sample_reporter(r)}:{r.author_page_url or '-'}"
            for r in bad_author_page_citation[:10]
        ],
    }


def _format_quality_audit(audit: dict[str, Any]) -> list[str]:
    lines = [
        f"quality_total_reporters={audit['total_reporters']}",
        f"quality_verified_reporters={audit['verified_reporters']}",
        f"quality_verified_person_names={audit['verified_person_names']}",
        f"quality_verified_public_author_pages={audit['verified_public_author_pages']}",
        f"quality_verified_author_profile_pages={audit['verified_author_profile_pages']}",
        f"quality_verified_author_page_citations={audit['verified_author_page_citations']}",
        f"quality_failures={audit['quality_failures']}",
    ]
    for key in (
        "sample_verified_non_person_names",
        "sample_verified_non_public_author_pages",
        "sample_verified_missing_author_page_citations",
    ):
        sample = audit.get(key) or []
        if sample:
            lines.append(f"{key}={sample}")
    return lines


def _source_names_from_career_history(reporter: Reporter) -> list[str]:
    """Return deduped organization names from reporter career history."""
    source_names: list[str] = []
    seen: set[str] = set()
    entries = reporter.career_history or []
    if not isinstance(entries, list):
        return source_names

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        organization = str(entry.get("organization") or "").strip()
        if not organization:
            continue
        normalized = " ".join(organization.split()).casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        source_names.append(" ".join(organization.split()))

    return source_names


def _source_attribution_for_reporter(
    reporter: Reporter,
    reporter_sources: dict[int, list[str]],
) -> tuple[list[str], str]:
    reporter_id = reporter.id
    if reporter_id is not None:
        article_sources = reporter_sources.get(int(reporter_id)) or []
        if article_sources:
            return article_sources, "article"

    career_sources = _source_names_from_career_history(reporter)
    if career_sources:
        return career_sources, "career"

    return ["unknown"], "unknown"


def _reporter_attribution_totals(
    reporters: list[Reporter],
    reporter_sources: dict[int, list[str]],
) -> dict[str, int]:
    totals = {"article": 0, "career": 0, "unknown": 0}
    seen_ids: set[int] = set()
    for reporter in reporters:
        if reporter.id is None:
            continue
        reporter_id = int(reporter.id)
        if reporter_id in seen_ids:
            continue
        seen_ids.add(reporter_id)
        _, attribution_type = _source_attribution_for_reporter(reporter, reporter_sources)
        totals[attribution_type] += 1
    return totals


async def _compute_source_metrics(
    reporters: list[Reporter],
    reporter_sources: dict[int, list[str]],
    session: Any,
    *,
    recompute: bool = False,
) -> dict[str, dict[str, Any]]:
    sources: dict[str, dict[str, Any]] = {}

    seen_ids: set[int] = set()
    for reporter in reporters:
        rid = reporter.id
        if rid is None:
            continue
        rid = int(rid)
        if rid in seen_ids:
            continue
        seen_ids.add(rid)

        tier = reporter.confidence_tier or "unmatched"
        score: float | None = (
            float(reporter.confidence_score) if reporter.confidence_score is not None else None
        )
        if recompute:
            tries = 0
            while tries < 2:
                try:
                    computed_tier, computed_score, _ = await compute_confidence_tier(
                        session, reporter
                    )
                    tier = computed_tier
                    score = computed_score
                    break
                except Exception:
                    tries += 1

        src_list, attribution_type = _source_attribution_for_reporter(reporter, reporter_sources)
        for source_name in src_list:
            if source_name not in sources:
                sources[source_name] = {
                    "source": source_name,
                    "total_reporters": 0,
                    "article_source_reporters": 0,
                    "career_source_reporters": 0,
                    "unknown_source_reporters": 0,
                    "tier_counts": Counter(),
                    "score_sum": 0.0,
                    "with_author_page_url": 0,
                    "with_public_author_page_url": 0,
                    "verified_author_page_citations": 0,
                    "with_claims": 0,
                    "score_count": 0,
                }
            m = sources[source_name]
            m["total_reporters"] += 1
            if attribution_type == "article":
                m["article_source_reporters"] += 1
            elif attribution_type == "career":
                m["career_source_reporters"] += 1
            else:
                m["unknown_source_reporters"] += 1

            m["tier_counts"][tier] += 1

            if score is not None:
                m["score_sum"] += score
            m["score_count"] += 1

            if reporter.author_page_url:
                m["with_author_page_url"] += 1
                if is_author_profile_url(str(reporter.author_page_url)) or is_author_profile_url(
                    str(reporter.canonical_author_url or "")
                ):
                    m["with_public_author_page_url"] += 1
                    if tier == "verified" and has_verified_author_page_citation(reporter):
                        m["verified_author_page_citations"] += 1
            if reporter.claims_count and reporter.claims_count > 0:
                m["with_claims"] += 1

    return sources


def _format_table(sources: dict[str, dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    header = (
        "source\ttotal_reporters\tarticle_source_reporters\tcareer_source_reporters\t"
        "unknown_source_reporters\tconfidence_verified\tconfidence_strong\t"
        "confidence_likely\tconfidence_unmatched\tavg_score\t"
        "with_author_page_url\twith_public_author_page_url\t"
        "verified_author_page_citations\twith_claims"
    )
    lines.append(header)

    for source_name in sorted(sources.keys()):
        m = sources[source_name]
        tc = m["tier_counts"]
        avg_score = round(m["score_sum"] / m["score_count"], 3) if m["score_count"] > 0 else 0.0
        lines.append(
            f"{m['source']}\t{m['total_reporters']}\t"
            f"{m['article_source_reporters']}\t{m['career_source_reporters']}\t"
            f"{m['unknown_source_reporters']}\t"
            f"{tc.get('verified', 0)}\t{tc.get('strong', 0)}\t"
            f"{tc.get('likely', 0)}\t{tc.get('unmatched', 0)}\t"
            f"{avg_score:.3f}\t{m['with_author_page_url']}\t"
            f"{m['with_public_author_page_url']}\t"
            f"{m['verified_author_page_citations']}\t{m['with_claims']}"
        )

    return lines


def _cache_current(sources: dict[str, dict[str, Any]]) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for source_name, m in sources.items():
        tc = m["tier_counts"]
        avg_score = round(m["score_sum"] / m["score_count"], 3) if m["score_count"] > 0 else 0.0
        snapshot[source_name] = {
            "total_reporters": m["total_reporters"],
            "article_source_reporters": m.get("article_source_reporters", 0),
            "career_source_reporters": m.get("career_source_reporters", 0),
            "unknown_source_reporters": m.get("unknown_source_reporters", 0),
            "verified": tc.get("verified", 0),
            "strong": tc.get("strong", 0),
            "likely": tc.get("likely", 0),
            "unmatched": tc.get("unmatched", 0),
            "avg_score": avg_score,
            "with_author_page_url": m["with_author_page_url"],
            "with_public_author_page_url": m.get("with_public_author_page_url", 0),
            "verified_author_page_citations": m.get("verified_author_page_citations", 0),
            "with_claims": m["with_claims"],
        }
    return {
        "captured_at": datetime.now(UTC).isoformat(),
        "sources": snapshot,
    }


def _load_previous_cache() -> dict[str, Any] | None:
    if not TREND_CACHE_PATH.exists():
        return None
    try:
        data = json.loads(TREND_CACHE_PATH.read_text())
        if not isinstance(data, dict):
            return None
        return data
    except (json.JSONDecodeError, OSError):
        return None


def _format_trend(
    current: dict[str, Any],
) -> list[str]:
    prev_data = _load_previous_cache()
    if prev_data is None:
        return ["TREND: no previous cache found; run without --trend first."]
    prev = prev_data.get("sources", {})

    lines: list[str] = []
    header = (
        "source\ttotal_reporters\tdelta_total\t"
        "article_source_reporters\tcareer_source_reporters\tunknown_source_reporters\t"
        "verified\tstrong\tlikely\tunmatched\t"
        "avg_score\tdelta_avg_score\twith_author_page_url\t"
        "with_public_author_page_url\tverified_author_page_citations\twith_claims"
    )
    lines.append(header)

    cur_sources = current.get("sources", {})
    for source_name in sorted(cur_sources.keys()):
        c = cur_sources[source_name]
        p = prev.get(source_name, {})
        delta_total = c["total_reporters"] - p.get("total_reporters", 0)
        delta_score = round(c["avg_score"] - p.get("avg_score", 0.0), 3)
        lines.append(
            f"{source_name}\t{c['total_reporters']}\t{delta_total:+d}\t"
            f"{c.get('article_source_reporters', 0)}\t"
            f"{c.get('career_source_reporters', 0)}\t"
            f"{c.get('unknown_source_reporters', 0)}\t"
            f"{c['verified']}\t{c['strong']}\t{c['likely']}\t{c['unmatched']}\t"
            f"{c['avg_score']:.3f}\t{delta_score:+.3f}\t"
            f"{c['with_author_page_url']}\t"
            f"{c.get('with_public_author_page_url', 0)}\t"
            f"{c.get('verified_author_page_citations', 0)}\t"
            f"{c['with_claims']}"
        )

    lines.append(f"captured_at={current.get('captured_at', '?')}")
    if prev_data:
        lines.append(f"previous_captured_at={prev_data.get('captured_at', '?')}")
    return lines


async def main_async(
    trend: bool,
    recompute: bool = False,
    audit_quality: bool = False,
    audit_profiles: bool = False,
    audit_aliases: bool = False,
    audit_eligible_cohort: bool = False,
    eligible_min_article_links: int = 1,
    eligible_target_verified_percent: float = 70.0,
    eligible_top_sources: int = 10,
) -> int:
    session = await _get_session()
    try:
        reporters = await _load_reporters(session)
        if not reporters:
            print("total_reporters=0")
            return 0
        if audit_quality:
            audit = _audit_reporter_quality(reporters)
            for line in _format_quality_audit(audit):
                print(line)
            return 1 if int(audit["quality_failures"]) > 0 else 0
        if audit_aliases:
            audit = _identity_alias_audit(reporters)
            for line in _format_identity_alias_audit(audit):
                print(line)
            return 1 if int(audit["quality_failures"]) > 0 else 0

        reporter_ids = [int(r.id) for r in reporters if r.id]
        reporter_sources = await _load_reporter_sources(session, reporter_ids)
        if audit_eligible_cohort:
            reporter_article_counts = await _load_reporter_article_counts(session)
            audit = _eligible_cohort_audit(
                reporters,
                reporter_sources,
                reporter_article_counts,
                min_article_links=eligible_min_article_links,
                target_verified_percent=eligible_target_verified_percent,
                top_sources_limit=eligible_top_sources,
            )
            for line in _format_eligible_cohort_audit(audit):
                print(line)
            return 1 if int(audit["quality_failures"]) > 0 else 0

        if audit_profiles:
            audit = _profile_issue_samples(reporters, reporter_sources)
            for line in _format_profile_audit(audit):
                print(line)
            return 1 if int(audit["quality_failures"]) > 0 else 0

        sources = await _compute_source_metrics(
            reporters,
            reporter_sources,
            session,
            recompute=recompute,
        )
        attribution_totals = _reporter_attribution_totals(reporters, reporter_sources)

        current_snapshot = _cache_current(sources)

        if trend:
            lines = _format_trend(current_snapshot)
        else:
            lines = _format_table(sources)

        for line in lines:
            print(line)

        total_reporters = len(reporters)
        total_sources = len(sources)
        print(f"total_reporters={total_reporters}")
        print(f"total_sources_with_reporters={total_sources}")
        print(f"source_attribution_article_reporters={attribution_totals['article']}")
        print(f"source_attribution_career_reporters={attribution_totals['career']}")
        print(f"source_attribution_unknown_reporters={attribution_totals['unknown']}")

        TREND_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        TREND_CACHE_PATH.write_text(json.dumps(current_snapshot, indent=2))

    finally:
        await session.close()

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify reporter intelligence - per-source aggregation."
    )
    parser.add_argument(
        "--trend",
        action="store_true",
        help="Compare against previous cached run and show deltas.",
    )
    parser.add_argument(
        "--recompute",
        action="store_true",
        help="Recompute confidence from evidence tables instead of using persisted tiers/scores.",
    )
    parser.add_argument(
        "--audit-quality",
        action="store_true",
        help="Fail if verified reporter rows lack person names, public author pages, or citations.",
    )
    parser.add_argument(
        "--audit-profiles",
        action="store_true",
        help="Fail if tiered reporter profiles have unusable names, missing evidence, or stale local bylines.",
    )
    parser.add_argument(
        "--audit-aliases",
        action="store_true",
        help=(
            "Fail if verified/strong reporter rows share an official author-page URL across "
            "conflicting identity labels; also report dedupe backlog and raw byline residue."
        ),
    )
    parser.add_argument(
        "--audit-eligible-cohort",
        action="store_true",
        help="Fail unless the eligible real-RSS reporter cohort is at the requested verified percentage with no likely/unmatched leakage.",
    )
    parser.add_argument(
        "--eligible-min-articles",
        type=int,
        default=1,
        help="Minimum ArticleAuthor links required for a reporter to enter the eligible cohort.",
    )
    parser.add_argument(
        "--eligible-target-verified-percent",
        type=float,
        default=70.0,
        help="Required verified percentage for the eligible cohort.",
    )
    parser.add_argument(
        "--eligible-top-sources",
        type=int,
        default=10,
        help="Number of source backlog rows to print for the eligible cohort.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return asyncio.run(
        main_async(
            trend=args.trend,
            recompute=args.recompute,
            audit_quality=args.audit_quality,
            audit_profiles=args.audit_profiles,
            audit_aliases=args.audit_aliases,
            audit_eligible_cohort=args.audit_eligible_cohort,
            eligible_min_article_links=args.eligible_min_articles,
            eligible_target_verified_percent=args.eligible_target_verified_percent,
            eligible_top_sources=args.eligible_top_sources,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
