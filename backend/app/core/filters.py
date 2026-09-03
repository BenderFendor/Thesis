"""Query-parameter normalization helpers shared by API routes."""

from __future__ import annotations

_CATEGORY_ALL_SENTINELS = frozenset({"all"})


def normalize_category(category: str | None) -> str | None:
    """Map the UI's "all" category sentinel to no filter.

    The frontend surfaces a single "All" tab whose id is "all"; clients send
    either "all" or "All" as the category value. Backend category filters
    compare equality against stored category names, so a sentinel value must
    be dropped (treated as no filter) before filtering. Real category names
    are returned unchanged (case-sensitive).
    """
    if category is None:
        return None
    stripped = category.strip()
    if stripped.lower() in _CATEGORY_ALL_SENTINELS:
        return None
    return stripped or None
