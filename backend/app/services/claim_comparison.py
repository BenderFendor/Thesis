"""Normalize claim dimensions before classifying apparent contradictions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from collections.abc import Mapping


@dataclass(frozen=True, slots=True)
class ComparableClaim:
    """The subset of a claim's fields needed to compare it against another claim."""

    id: str
    subject_entity_id: str
    predicate: str
    object_entity_id: str | None
    object_value: Any | None
    qualifiers: Mapping[str, Any]
    valid_from: datetime | None
    valid_to: datetime | None


@dataclass(frozen=True, slots=True)
class ClaimComparison:
    """The normalized classification of how two claims relate to each other."""

    classification: str
    normalized_dimensions: dict[str, Any]
    reason: str


def _temporal_overlap(left: ComparableClaim, right: ComparableClaim) -> bool:
    left_start = left.valid_from or datetime.min
    right_start = right.valid_from or datetime.min
    left_end = left.valid_to or datetime.max
    right_end = right.valid_to or datetime.max
    return max(left_start, right_start) <= min(left_end, right_end)


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _band(qualifiers: Mapping[str, Any]) -> tuple[Decimal, Decimal] | None:
    point = _decimal(qualifiers.get("pct"))
    if point is not None:
        return point, point
    raw = qualifiers.get("pct_band")
    if isinstance(raw, Mapping):
        lower = _decimal(raw.get("lower"))
        upper = _decimal(raw.get("upper"))
    elif isinstance(raw, (list, tuple)) and len(raw) == 2:
        lower = _decimal(raw[0])
        upper = _decimal(raw[1])
    else:
        return None
    if lower is None or upper is None:
        return None
    return lower, upper


def _ranges_overlap(left: tuple[Decimal, Decimal], right: tuple[Decimal, Decimal]) -> bool:
    return max(left[0], right[0]) <= min(left[1], right[1])


def compare_claims(left: ComparableClaim, right: ComparableClaim) -> ClaimComparison:
    """Classify claims only after normalizing time, class, interest, and status."""
    normalized = {
        "left": {
            "predicate": left.predicate,
            "object": left.object_entity_id or left.object_value,
            "share_class": left.qualifiers.get("security_class"),
            "interest": left.qualifiers.get("interest"),
            "direct": left.qualifiers.get("direct"),
            "txn_status": left.qualifiers.get("txn_status"),
            "jurisdiction": left.qualifiers.get("jurisdiction"),
            "scope": left.qualifiers.get("legal_entity_scope"),
            "band": _band(left.qualifiers),
        },
        "right": {
            "predicate": right.predicate,
            "object": right.object_entity_id or right.object_value,
            "share_class": right.qualifiers.get("security_class"),
            "interest": right.qualifiers.get("interest"),
            "direct": right.qualifiers.get("direct"),
            "txn_status": right.qualifiers.get("txn_status"),
            "jurisdiction": right.qualifiers.get("jurisdiction"),
            "scope": right.qualifiers.get("legal_entity_scope"),
            "band": _band(right.qualifiers),
        },
    }

    if left.subject_entity_id != right.subject_entity_id:
        return ClaimComparison(
            "different_relation", normalized, "claims concern different subjects"
        )
    if left.predicate != right.predicate:
        return ClaimComparison(
            "different_relation", normalized, "predicates are not the same relation"
        )

    left_class = left.qualifiers.get("security_class")
    right_class = right.qualifiers.get("security_class")
    if left_class and right_class and left_class != right_class:
        return ClaimComparison(
            "different_share_class", normalized, "claims concern different security classes"
        )

    for key in ("interest", "direct", "jurisdiction", "legal_entity_scope"):
        left_value = left.qualifiers.get(key)
        right_value = right.qualifiers.get(key)
        if left_value is not None and right_value is not None and left_value != right_value:
            return ClaimComparison(
                "different_relation", normalized, f"claims differ on normalized dimension {key}"
            )

    if not _temporal_overlap(left, right):
        return ClaimComparison(
            "temporal_successor", normalized, "valid-time intervals do not overlap"
        )

    left_status = left.qualifiers.get("txn_status")
    right_status = right.qualifiers.get("txn_status")
    if left_status != right_status and {left_status, right_status} <= {
        "announced",
        "completed",
        "abandoned",
        "blocked",
        None,
    }:
        return ClaimComparison(
            "different_relation",
            normalized,
            "transaction-status statements are preserved as separate dated claims",
        )

    left_object = left.object_entity_id if left.object_entity_id is not None else left.object_value
    right_object = (
        right.object_entity_id if right.object_entity_id is not None else right.object_value
    )
    if left_object == right_object:
        left_band = _band(left.qualifiers)
        right_band = _band(right.qualifiers)
        if left_band and right_band and not _ranges_overlap(left_band, right_band):
            return ClaimComparison(
                "apparently_conflicting",
                normalized,
                "percentage ranges conflict for the same normalized relation",
            )
        return ClaimComparison("compatible", normalized, "claims can be simultaneously true")

    return ClaimComparison(
        "apparently_conflicting",
        normalized,
        "different objects compete for the same subject, predicate, and overlapping valid time",
    )
