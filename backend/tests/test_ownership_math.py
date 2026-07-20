from decimal import Decimal
import pytest
from app.services.ownership_math import ControlEdge, InterestRange, OwnershipEdge, OwnershipMathError, compute_indirect_interest, resolve_control_paths


def edge(owner: str, owned: str, pct: str, *, group: str | None = None) -> OwnershipEdge:
    return OwnershipEdge(owner, owned, InterestRange.point(Decimal(pct)), "economic", claim_id=f"{owner}-{owned}", disjoint_group=group)


def test_single_dag_path_multiplies_interest() -> None:
    result = compute_indirect_interest([edge("a", "b", "0.5"), edge("b", "c", "0.4")], owner_id="a", target_id="c", interest_type="economic")
    assert result.aggregate == InterestRange.point("0.20")


def test_cross_holding_is_refused_not_fabricated() -> None:
    result = compute_indirect_interest([edge("a", "b", "0.5"), edge("b", "a", "0.1"), edge("b", "c", "0.4")], owner_id="a", target_id="c", interest_type="economic")
    assert result.cross_holding_unresolved and result.aggregate is None


def test_multiple_paths_are_not_summed_without_disjoint_evidence() -> None:
    result = compute_indirect_interest([edge("a", "b", "0.5"), edge("b", "d", "0.5"), edge("a", "c", "0.5"), edge("c", "d", "0.5")], owner_id="a", target_id="d", interest_type="economic")
    assert result.aggregate is None and result.possibly_overlapping and len(result.paths) == 2


def test_documented_disjoint_paths_can_sum() -> None:
    result = compute_indirect_interest([edge("a", "b", "0.5", group="holding-1"), edge("b", "d", "0.5", group="holding-1"), edge("a", "c", "0.5", group="holding-2"), edge("c", "d", "0.5", group="holding-2")], owner_id="a", target_id="d", interest_type="economic")
    assert result.aggregate == InterestRange.point("0.50") and not result.possibly_overlapping


def test_ranges_propagate() -> None:
    result = compute_indirect_interest([OwnershipEdge("a", "b", InterestRange(Decimal("0.25"), Decimal("0.50")), "economic"), OwnershipEdge("b", "c", InterestRange(Decimal("0.50"), Decimal("0.75")), "economic")], owner_id="a", target_id="c", interest_type="economic")
    assert result.aggregate == InterestRange(Decimal("0.1250"), Decimal("0.3750"))


def test_invalid_percentages_fail() -> None:
    with pytest.raises(OwnershipMathError):
        InterestRange.point("1.01")


def test_control_paths_carry_mechanisms_not_thresholds() -> None:
    paths = resolve_control_paths([ControlEdge("family", "trust", "trust_instrument", "c1"), ControlEdge("trust", "company", "dual_class_voting", "c2"), ControlEdge("company", "publication", "majority_voting", "c3")], controller_id="family", target_id="publication")
    assert paths[0].mechanisms == ("trust_instrument", "dual_class_voting", "majority_voting")
