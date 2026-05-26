"""Official-page policy transparency signals for source dossiers."""

from __future__ import annotations

import re
from typing import Any
from collections.abc import Iterable, Sequence


POLICY_SIGNAL_PATTERNS: Sequence[tuple[str, str, Sequence[str]]] = (
    (
        "editorial_independence",
        "Editorial independence",
        (
            r"\beditorial independence\b",
            r"\beditorially independent\b",
            r"\bindependent journalism\b",
            r"\bindependent newsroom\b",
        ),
    ),
    (
        "ethics_standards",
        "Ethics or standards",
        (
            r"\bethics\b",
            r"\bcode of conduct\b",
            r"\bstandards\b",
            r"\baccuracy\b",
            r"\bfairness\b",
        ),
    ),
    (
        "corrections_process",
        "Corrections process",
        (
            r"\bcorrection(s)?\b",
            r"\bcorrect errors\b",
            r"\bclarification(s)?\b",
            r"\bupdate(d)?\b",
        ),
    ),
    (
        "ownership_disclosure",
        "Ownership disclosure",
        (
            r"\bownership\b",
            r"\bowned by\b",
            r"\bparent (company|organization)\b",
            r"\bsubsidiar(y|ies)\b",
        ),
    ),
    (
        "funding_disclosure",
        "Funding disclosure",
        (
            r"\bfunded by\b",
            r"\bfunding\b",
            r"\bdonors?\b",
            r"\bgrants?\b",
            r"\badvertising revenue\b",
        ),
    ),
    (
        "staff_or_bylines",
        "Staff or byline disclosure",
        (
            r"\bmasthead\b",
            r"\bstaff\b",
            r"\bauthors?\b",
            r"\breporters?\b",
            r"\bcontact\b",
        ),
    ),
    (
        "anonymous_sources_policy",
        "Anonymous sources policy",
        (
            r"\banonymous sources?\b",
            r"\bunnamed sources?\b",
            r"\bconfidential sources?\b",
            r"\bon background\b",
        ),
    ),
    (
        "ai_or_synthetic_media_policy",
        "AI or synthetic media policy",
        (
            r"\bartificial intelligence\b",
            r"\bgenerative ai\b",
            r"\bai-generated\b",
            r"\bsynthetic media\b",
        ),
    ),
    (
        "conflicts_policy",
        "Conflicts disclosure",
        (
            r"\bconflict(s)? of interest\b",
            r"\bdisclosure(s)?\b",
            r"\brecusal\b",
        ),
    ),
)


def _unique_strings(values: Iterable[str | None]) -> list[str]:
    unique: dict[str, None] = {}
    for value in values:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in unique:
            unique[cleaned] = None
    return list(unique.keys())


def _matched_terms(text: str, patterns: Sequence[str]) -> list[str]:
    matches: list[str] = []
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            matches.append(re.sub(r"\s+", " ", match.group(0)).strip().lower())
    return _unique_strings(matches)


def build_policy_transparency_summary(
    official_pages: Sequence[dict[str, Any]],
) -> dict[str, Any] | None:
    """Extract deterministic policy signals from fetched official source pages."""
    checked_pages = [
        page
        for page in official_pages
        if str(page.get("url") or "").strip() and str(page.get("summary") or "").strip()
    ]
    if not checked_pages:
        return None

    signals: list[dict[str, Any]] = []
    for signal_id, label, patterns in POLICY_SIGNAL_PATTERNS:
        sources: list[str] = []
        matched: list[str] = []
        for page in checked_pages:
            summary = str(page.get("summary") or "")
            page_matches = _matched_terms(summary, patterns)
            if not page_matches:
                continue
            sources.append(str(page["url"]))
            matched.extend(page_matches)
        if sources:
            signals.append(
                {
                    "id": signal_id,
                    "label": label,
                    "status": "available",
                    "sources": _unique_strings(sources),
                    "matched_terms": _unique_strings(matched),
                }
            )

    if not signals:
        return {
            "checked_pages": len(checked_pages),
            "available_signals": 0,
            "signals": [],
        }

    return {
        "checked_pages": len(checked_pages),
        "available_signals": len(signals),
        "signals": signals,
    }
