from datetime import datetime
from app.services.claim_comparison import ComparableClaim, compare_claims


def claim(
    claim_id: str,
    object_id: str,
    *,
    qualifiers: dict | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    predicate: str = "owns_equity_in",
) -> ComparableClaim:
    return ComparableClaim(
        claim_id, "publication", predicate, object_id, None, qualifiers or {}, start, end
    )


def test_share_classes_are_not_false_conflicts() -> None:
    result = compare_claims(
        claim("a", "owner", qualifiers={"security_class": "A", "pct": 40}),
        claim("b", "owner", qualifiers={"security_class": "B", "pct": 70}),
    )
    assert result.classification == "different_share_class"


def test_nonoverlapping_owners_are_temporal_successors() -> None:
    result = compare_claims(
        claim("a", "old", start=datetime(2020, 1, 1), end=datetime(2024, 12, 31)),
        claim("b", "new", start=datetime(2025, 1, 1)),
    )
    assert result.classification == "temporal_successor"


def test_overlapping_competing_owners_enter_adjudication() -> None:
    assert (
        compare_claims(claim("a", "owner-a"), claim("b", "owner-b")).classification
        == "apparently_conflicting"
    )


def test_overlapping_percentage_bands_are_compatible() -> None:
    result = compare_claims(
        claim("a", "owner", qualifiers={"pct_band": {"lower": 25, "upper": 50}}),
        claim("b", "owner", qualifiers={"pct": 40}),
    )
    assert result.classification == "compatible"
