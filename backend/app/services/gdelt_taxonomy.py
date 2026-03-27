"""Shared helpers for GDELT labels and compact UI summaries."""

from __future__ import annotations

from collections import Counter
from typing import Iterable, Optional


_CAMEO_ROOT_LABELS: dict[str, str] = {
    "01": "Public statement",
    "02": "Appeal",
    "03": "Intent to cooperate",
    "04": "Consultation",
    "05": "Diplomatic engagement",
    "06": "Material cooperation",
    "07": "Aid",
    "08": "Yield",
    "09": "Investigate",
    "10": "Demand",
    "11": "Disapprove",
    "12": "Reject",
    "13": "Threaten",
    "14": "Protest",
    "15": "Exhibit force",
    "16": "Reduce relations",
    "17": "Coerce",
    "18": "Assault",
    "19": "Fight",
    "20": "Use unconventional violence",
}


def normalize_cameo_root_code(code: Optional[str]) -> Optional[str]:
    if code is None:
        return None
    normalized = "".join(ch for ch in code if ch.isdigit())
    if not normalized:
        return None
    if len(normalized) == 1:
        normalized = f"0{normalized}"
    return normalized[:2]


def cameo_root_label(code: Optional[str]) -> Optional[str]:
    normalized = normalize_cameo_root_code(code)
    if normalized is None:
        return None
    return _CAMEO_ROOT_LABELS.get(normalized)


def goldstein_bucket(value: float | None) -> str | None:
    if value is None:
        return None
    if value >= 4.0:
        return "cooperation"
    if value <= -4.0:
        return "conflict"
    return "mixed"


def dominant_cameo_roots(
    codes: Iterable[str | None], limit: int = 3
) -> list[dict[str, object]]:
    counts: Counter[str] = Counter()
    for code in codes:
        normalized = normalize_cameo_root_code(code)
        if normalized:
            counts[normalized] += 1

    rows: list[dict[str, object]] = []
    for code, count in counts.most_common(limit):
        rows.append(
            {
                "code": code,
                "label": cameo_root_label(code),
                "count": count,
            }
        )
    return rows
