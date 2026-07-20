"""Safe economic/voting-interest and control-path calculations."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal
from collections.abc import Iterable

InterestType = Literal["economic", "voting"]


class OwnershipMathError(ValueError):
    """Raised when an ownership calculation would produce an invalid fact."""


@dataclass(frozen=True, slots=True)
class InterestRange:
    """A [lower, upper] ownership-interest band expressed as fractions of one."""

    lower: Decimal
    upper: Decimal

    def __post_init__(self) -> None:
        """Validate the band is non-negative, ordered, and at most 100%."""
        if self.lower < 0 or self.upper < 0:
            raise OwnershipMathError("ownership interests cannot be negative")
        if self.lower > self.upper:
            raise OwnershipMathError("ownership range lower bound exceeds upper bound")
        if self.upper > 1:
            raise OwnershipMathError("ownership interests must be expressed from zero to one")

    @classmethod
    def point(cls, value: Decimal | float | int | str) -> InterestRange:
        """Build a degenerate band (lower == upper) from a single value."""
        decimal_value = _decimal(value)
        return cls(decimal_value, decimal_value)

    def multiply(self, other: InterestRange) -> InterestRange:
        """Multiply two bands element-wise (used to chain interests along a path)."""
        return InterestRange(self.lower * other.lower, self.upper * other.upper)

    def add(self, other: InterestRange) -> InterestRange:
        """Sum two disjoint bands, refusing to produce more than 100%."""
        lower = self.lower + other.lower
        upper = self.upper + other.upper
        if upper > 1:
            raise OwnershipMathError("summed ownership interest exceeds 100%")
        return InterestRange(lower, upper)

    def as_percent(self) -> dict[str, float]:
        """Return the band as a {lower, upper} percentage dict for serialization."""
        return {
            "lower": float((self.lower * Decimal(100)).quantize(Decimal("0.0001"))),
            "upper": float((self.upper * Decimal(100)).quantize(Decimal("0.0001"))),
        }


@dataclass(frozen=True, slots=True)
class OwnershipEdge:
    """A single documented owner -> owned interest edge feeding path enumeration."""

    owner_id: str
    owned_id: str
    interest: InterestRange
    interest_type: InterestType
    security_class: str | None = None
    direct: bool = True
    claim_id: str | None = None
    disjoint_group: str | None = None


@dataclass(frozen=True, slots=True)
class InterestPath:
    """One enumerated owner-to-target chain and the interest it carries."""

    entity_ids: tuple[str, ...]
    claim_ids: tuple[str, ...]
    interest: InterestRange
    disjoint_group: str | None


@dataclass(frozen=True, slots=True)
class InterestCalculation:
    """The result of computing owner->target interest across all safe paths."""

    owner_id: str
    target_id: str
    interest_type: InterestType
    security_class: str | None
    aggregate: InterestRange | None
    paths: tuple[InterestPath, ...]
    possibly_overlapping: bool
    cross_holding_unresolved: bool
    algorithm_version: str = "ownership-math/2.0"

    def trace(self) -> dict[str, object]:
        """Return a JSON-serializable trace of this calculation for CalculationTrace."""
        return {
            "algorithm_version": self.algorithm_version,
            "owner_id": self.owner_id,
            "target_id": self.target_id,
            "interest_type": self.interest_type,
            "security_class": self.security_class,
            "aggregate": self.aggregate.as_percent() if self.aggregate else None,
            "possibly_overlapping": self.possibly_overlapping,
            "cross_holding_unresolved": self.cross_holding_unresolved,
            "paths": [
                {
                    "entity_ids": list(path.entity_ids),
                    "claim_ids": list(path.claim_ids),
                    "interest": path.interest.as_percent(),
                    "disjoint_group": path.disjoint_group,
                }
                for path in self.paths
            ],
        }


@dataclass(frozen=True, slots=True)
class ControlEdge:
    """A single documented control mechanism from controller to controlled entity."""

    controller_id: str
    controlled_id: str
    mechanism: str
    claim_id: str
    valid: bool = True


@dataclass(frozen=True, slots=True)
class ControlPath:
    """One enumerated chain of control mechanisms from controller to target."""

    entity_ids: tuple[str, ...]
    mechanisms: tuple[str, ...]
    claim_ids: tuple[str, ...]


def _decimal(value: Decimal | float | int | str) -> Decimal:
    try:
        return value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise OwnershipMathError(f"invalid ownership number: {value!r}") from exc


def _filtered_edges(
    edges: Iterable[OwnershipEdge],
    *,
    interest_type: InterestType,
    security_class: str | None,
) -> tuple[OwnershipEdge, ...]:
    return tuple(
        edge
        for edge in edges
        if edge.interest_type == interest_type
        and (security_class is None or edge.security_class == security_class)
    )


def strongly_connected_components(edges: Iterable[OwnershipEdge]) -> tuple[tuple[str, ...], ...]:
    """Return Tarjan SCCs for the owner-to-owned graph."""
    graph: dict[str, list[str]] = {}
    nodes: set[str] = set()
    for edge in edges:
        graph.setdefault(edge.owner_id, []).append(edge.owned_id)
        graph.setdefault(edge.owned_id, [])
        nodes.update((edge.owner_id, edge.owned_id))

    index = 0
    indices: dict[str, int] = {}
    lowlinks: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    components: list[tuple[str, ...]] = []

    def visit(node: str) -> None:
        nonlocal index
        indices[node] = index
        lowlinks[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)
        for neighbor in graph.get(node, []):
            if neighbor not in indices:
                visit(neighbor)
                lowlinks[node] = min(lowlinks[node], lowlinks[neighbor])
            elif neighbor in on_stack:
                lowlinks[node] = min(lowlinks[node], indices[neighbor])
        if lowlinks[node] == indices[node]:
            component: list[str] = []
            while True:
                member = stack.pop()
                on_stack.remove(member)
                component.append(member)
                if member == node:
                    break
            components.append(tuple(sorted(component)))

    for node in sorted(nodes):
        if node not in indices:
            visit(node)
    return tuple(components)


def _has_cycle(edges: tuple[OwnershipEdge, ...]) -> bool:
    if any(edge.owner_id == edge.owned_id for edge in edges):
        return True
    return any(len(component) > 1 for component in strongly_connected_components(edges))


def _enumerate_paths(
    edges: tuple[OwnershipEdge, ...], owner_id: str, target_id: str, *, max_paths: int
) -> tuple[InterestPath, ...]:
    adjacency: dict[str, list[OwnershipEdge]] = {}
    for edge in edges:
        adjacency.setdefault(edge.owner_id, []).append(edge)
    for values in adjacency.values():
        values.sort(key=lambda edge: (edge.owned_id, edge.claim_id or ""))
    paths: list[InterestPath] = []

    def walk(
        current: str,
        entity_ids: tuple[str, ...],
        claim_ids: tuple[str, ...],
        interest: InterestRange,
        groups: tuple[str, ...],
    ) -> None:
        if len(paths) >= max_paths:
            raise OwnershipMathError(f"ownership path count exceeds safety limit {max_paths}")
        if current == target_id:
            group_values = {group for group in groups if group}
            paths.append(
                InterestPath(
                    entity_ids=entity_ids,
                    claim_ids=claim_ids,
                    interest=interest,
                    disjoint_group=next(iter(group_values)) if len(group_values) == 1 else None,
                )
            )
            return
        for edge in adjacency.get(current, []):
            if edge.owned_id in entity_ids:
                continue
            walk(
                edge.owned_id,
                (*entity_ids, edge.owned_id),
                (*claim_ids, *((edge.claim_id,) if edge.claim_id else ())),
                interest.multiply(edge.interest),
                (*groups, *((edge.disjoint_group,) if edge.disjoint_group else ())),
            )

    walk(owner_id, (owner_id,), (), InterestRange.point(1), ())
    return tuple(paths)


def compute_indirect_interest(
    edges: Iterable[OwnershipEdge],
    *,
    owner_id: str,
    target_id: str,
    interest_type: InterestType,
    security_class: str | None = None,
    max_paths: int = 10_000,
) -> InterestCalculation:
    """Compute interest on a verified DAG without double-counting paths."""
    relevant = _filtered_edges(edges, interest_type=interest_type, security_class=security_class)
    if _has_cycle(relevant):
        return InterestCalculation(
            owner_id, target_id, interest_type, security_class, None, (), False, True
        )
    paths = _enumerate_paths(relevant, owner_id, target_id, max_paths=max_paths)
    if not paths:
        return InterestCalculation(
            owner_id, target_id, interest_type, security_class, None, (), False, False
        )
    if len(paths) == 1:
        return InterestCalculation(
            owner_id,
            target_id,
            interest_type,
            security_class,
            paths[0].interest,
            paths,
            False,
            False,
        )
    groups = [path.disjoint_group for path in paths]
    if not (all(groups) and len(set(groups)) == len(groups)):
        return InterestCalculation(
            owner_id, target_id, interest_type, security_class, None, paths, True, False
        )
    aggregate = InterestRange.point(0)
    for path in paths:
        aggregate = aggregate.add(path.interest)
    return InterestCalculation(
        owner_id, target_id, interest_type, security_class, aggregate, paths, False, False
    )


def resolve_control_paths(
    edges: Iterable[ControlEdge], *, controller_id: str, target_id: str, max_paths: int = 1_000
) -> tuple[ControlPath, ...]:
    """Resolve mechanism-carrying control paths without percentage thresholds."""
    adjacency: dict[str, list[ControlEdge]] = {}
    for edge in edges:
        if edge.valid:
            adjacency.setdefault(edge.controller_id, []).append(edge)
    for values in adjacency.values():
        values.sort(key=lambda edge: (edge.controlled_id, edge.mechanism, edge.claim_id))
    results: list[ControlPath] = []

    def walk(
        current: str,
        entity_ids: tuple[str, ...],
        mechanisms: tuple[str, ...],
        claim_ids: tuple[str, ...],
    ) -> None:
        if len(results) >= max_paths:
            raise OwnershipMathError(f"control path count exceeds safety limit {max_paths}")
        if current == target_id:
            results.append(ControlPath(entity_ids, mechanisms, claim_ids))
            return
        for edge in adjacency.get(current, []):
            if edge.controlled_id in entity_ids:
                continue
            walk(
                edge.controlled_id,
                (*entity_ids, edge.controlled_id),
                (*mechanisms, edge.mechanism),
                (*claim_ids, edge.claim_id),
            )

    walk(controller_id, (controller_id,), (), ())
    return tuple(results)
