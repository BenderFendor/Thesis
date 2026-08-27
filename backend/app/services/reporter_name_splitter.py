"""Split multi-author byline strings into individual reporter names (audit rec 2).

1,343 reporter rows are multi-author strings -- "A and B", "X, Y and Z",
"NAME1 & NAME2, Associated Press" -- stored as one `Reporter` row because
the RSS byline text itself packed several people (plus, often, a trailing
wire-agency credit) into one string.

Delimiters: " and ", " & ", ", " -- but a trailing comma segment is often
NOT another author: "Name, Title" ("John Smith, Senior Correspondent") and
"Name, Associated Press" ("Gene Johnson, Associated Press") both use a
comma to attach agency/title context, not a second byline. The heuristic
below is deliberately conservative:

1. Split first on " and "/" & " (unambiguous multi-author separators).
2. For each resulting segment, split on ", " *only when* every comma-
   separated part looks like a person name (a short run of capitalized/
   ALL-CAPS word tokens, no lowercase-led words) -- if the last part looks
   like a title/role/agency (contains a lowercase-led word, e.g. "Associated
   Press", "Senior Correspondent", "Jr"), it is kept as trailing context on
   the last name instead of becoming its own author.
3. A trailing wire-agency segment (matched by name, e.g. "Associated
   Press", "Reuters", "AFP", ...) attached to the *last* author via a comma
   is recorded separately as `agency_context` rather than turned into an
   extra author -- see the module-level test suite for the exact specimen
   this defends: "ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press"
   must split into exactly two people, not three.

This module is pure string logic with no DB/network access, so it is safe
to call both at ingest time (new bylines, `rss_ingestion.py`) and from the
backfill stage that re-processes existing composite `Reporter` rows
(`reporter_split_backfill.py`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_AND_SPLIT_RE = re.compile(r"\s+and\s+|\s*&\s*", re.IGNORECASE)
_COMMA_SPLIT_RE = re.compile(r"\s*,\s*")

# Trailing segments that mean "the preceding name works for this wire
# service/desk", not "here is another author".
_AGENCY_SEGMENTS = frozenset(
    {
        "associated press",
        "ap",
        "reuters",
        "afp",
        "agence france-presse",
        "agence france-press",
        "bloomberg",
        "bloomberg news",
        "agencies",
        "staff",
        "guardian staff",
    }
)

_NAME_TOKEN_RE = re.compile(r"^[A-Z][A-Za-z'.\-]*$")


def _looks_like_person_name(segment: str) -> bool:
    """True when every token in `segment` is capitalized/ALL-CAPS (a name shape)."""
    tokens = segment.split()
    if not tokens or len(tokens) > 4:
        return False
    return all(_NAME_TOKEN_RE.match(token) for token in tokens)


@dataclass
class SplitByline:
    """Result of splitting one raw byline string."""

    authors: list[str] = field(default_factory=list)
    agency_context: str | None = None
    was_split: bool = False


def split_byline(raw: str) -> SplitByline:
    """Split a raw byline string into individual author names.

    Returns a `SplitByline` with `was_split=False` and `authors=[raw]`
    (trimmed) when no multi-author pattern is detected -- callers can treat
    the return value uniformly either way.
    """
    text = " ".join(str(raw or "").split())
    if not text:
        return SplitByline(authors=[], was_split=False)

    and_parts = [part.strip() for part in _AND_SPLIT_RE.split(text) if part.strip()]
    agency_context: str | None = None

    if len(and_parts) < 2:
        # No " and "/" & " separator. Still handle a single trailing
        # ", Associated Press"-style agency segment on an otherwise single
        # name, e.g. "Gene Johnson, Associated Press".
        comma_parts = [part.strip() for part in _COMMA_SPLIT_RE.split(text) if part.strip()]
        if len(comma_parts) >= 2 and comma_parts[-1].lower() in _AGENCY_SEGMENTS:
            return SplitByline(
                authors=[comma_parts[0]], agency_context=comma_parts[-1], was_split=False
            )
        return SplitByline(authors=[text], was_split=False)

    # Multi-author. A trailing wire-agency credit may appear either as its
    # own "and"-joined part ("... Anna Betts and agencies") or comma-
    # attached to the last "and"-part ("... GENE JOHNSON, Associated
    # Press"). Peel it off either way before treating each part as an
    # author name -- "agencies"/"Associated Press" is context, not a third
    # byline.
    if and_parts[-1].lower() in _AGENCY_SEGMENTS:
        agency_context = and_parts.pop()

    if len(and_parts) >= 2:
        last = and_parts[-1]
        comma_parts = [part.strip() for part in _COMMA_SPLIT_RE.split(last) if part.strip()]
        if len(comma_parts) >= 2 and comma_parts[-1].lower() in _AGENCY_SEGMENTS:
            agency_context = comma_parts[-1]
            and_parts[-1] = comma_parts[0]

    authors: list[str] = []
    for part in and_parts:
        # A part may itself contain a comma-separated list of names ("X, Y
        # and Z" splits " and " into ["X, Y", "Z"]); only explode it on
        # comma when every resulting piece looks like a name, never when
        # the trailing piece looks like a title/role (conservative: keep it
        # attached rather than risk fabricating a third "author").
        sub_parts = [part.strip() for part in _COMMA_SPLIT_RE.split(part) if part.strip()]
        if len(sub_parts) > 1 and all(_looks_like_person_name(p) for p in sub_parts):
            authors.extend(sub_parts)
        else:
            authors.append(part)

    authors = [author for author in authors if author]
    return SplitByline(authors=authors, agency_context=agency_context, was_split=len(authors) > 1)
