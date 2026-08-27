"""Clean dirty reporter names (audit rec 5).

~350 reporter rows captured a title/email/annotation alongside the name --
e.g. "BY DASHAN HENDRICKS Business content manager
hendricksd@jamaicaobserver.com" (Jamaica Observer byline furniture) or
"(earlier) Lucy Campbell" (a live-blog update-time annotation). The person
and the article-byline link are correct; only the name text is dirty.

Conservative, reversible normalization:
- Strip a leading "BY " artifact (case-insensitive).
- Strip a leading "(earlier)"/"(later)" annotation.
- Strip a trailing email address.
- Strip a trailing title/role segment -- but only when the name itself is a
  run of 2+ ALL-CAPS tokens followed by a token that isn't (the Jamaica
  Observer byline shape). This is deliberately narrow: it never touches an
  ordinary mixed-case name like "Lucy Campbell" or "Van Der Berg", so it
  can't eat a real (if unusual) surname.

Nothing is lost: the original string is preserved in `Reporter.raw_name`
(set once, on first change) before `name`/`normalized_name` are overwritten.
Idempotent by construction -- cleaning an already-clean name is a no-op --
so no separate skip-marker is needed; the stage just re-scans every active
(non-retired) reporter on each run and only writes rows that actually
change.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.database import Reporter

logger = get_logger("reporter_name_cleanup")

_LEADING_BY_RE = re.compile(r"^\s*by\s+(?=\S)", re.IGNORECASE)
_LEADING_TIME_ANNOTATION_RE = re.compile(r"^\s*\(\s*(earlier|later)\s*\)\s*", re.IGNORECASE)
_TRAILING_EMAIL_RE = re.compile(r"\s*[\w.+-]+@[\w-]+\.[\w.-]+\s*$")
_ALLCAPS_TOKEN_RE = re.compile(r"^[A-Z][A-Z'.\-]*$")


def _strip_trailing_role(name: str) -> str:
    """Drop a trailing title/role run after 2+ leading ALL-CAPS name tokens."""
    tokens = name.split(" ")
    if len(tokens) < 3:
        return name
    caps_run = 0
    for token in tokens:
        if token and _ALLCAPS_TOKEN_RE.match(token):
            caps_run += 1
        else:
            break
    if 2 <= caps_run < len(tokens):
        return " ".join(tokens[:caps_run])
    return name


_MULTI_AUTHOR_MARKERS = (" and ", " & ")


def clean_reporter_name(raw: str) -> str:
    """Return the cleaned form of `raw`; a no-op for already-clean names.

    Deliberately leaves multi-author byline strings (" and "/" & ") alone --
    that pattern belongs to the Fix 2 splitter
    (`reporter_name_splitter.split_byline`), which needs the raw string
    intact to detect and split it. Running this cleanup on such a string
    first would silently truncate it to just the first author.
    """
    if any(marker in raw for marker in _MULTI_AUTHOR_MARKERS):
        return raw
    name = raw.strip()
    name = _LEADING_TIME_ANNOTATION_RE.sub("", name)
    name = _LEADING_BY_RE.sub("", name)
    name = _TRAILING_EMAIL_RE.sub("", name).strip()
    name = _strip_trailing_role(name)
    return " ".join(name.split())


def _normalize(name: str) -> str:
    return " ".join(name.lower().strip().split())


@dataclass
class NameCleanupReport:
    """Summary counters for one cleanup pass."""

    reporters_cleaned: int = 0


async def cleanup_dirty_reporter_names(db: AsyncSession) -> NameCleanupReport:
    """Clean every active reporter's name in place; idempotent, no network."""
    report = NameCleanupReport()
    rows = list(
        (await db.execute(select(Reporter).where(Reporter.retirement_reason.is_(None))))
        .scalars()
        .all()
    )
    for reporter in rows:
        current_name = str(reporter.name or "")
        if not current_name.strip():
            continue
        cleaned = clean_reporter_name(current_name)
        if cleaned == current_name or not cleaned:
            continue
        if reporter.raw_name is None:
            reporter.raw_name = current_name
        reporter.name = cleaned
        reporter.normalized_name = _normalize(cleaned)
        report.reporters_cleaned += 1

    if report.reporters_cleaned:
        logger.info("reporter_name_cleanup: cleaned %d reporter name(s)", report.reporters_cleaned)
    return report
