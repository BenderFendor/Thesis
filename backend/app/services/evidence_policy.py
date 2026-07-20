"""Predicate-specific evidence acceptance policy.

Candidate claims may render, but only a positive decision from this module can
materialize an accepted relationship.

`POLICIES` (keyed by predicate) plus `POLICY_VERSION` is the sole, versioned
source of truth for active acceptance policy -- there is no separate
DB-backed policy table. An earlier `EvidencePolicyRow` model existed for this
but was never read; it was removed rather than wired up (see
docs/agents/traces/review-pr-8-evidence-spine.md and
alembic/versions/20260720_0003_drop_evidence_policy_rows.py) to avoid two
unsynchronized copies of policy state. Every `AcceptedRelationship` still
records the `POLICY_VERSION` string that accepted it
(`acceptance_policy_version`), so which rule accepted a given fact remains
reproducible from history -- bump `POLICY_VERSION` whenever `POLICIES`
changes in a way that could flip a past decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable, Mapping, Sequence

POLICY_VERSION = "evidence-policy/2.0"

CATALOG_ONLY_CLASSES = {
    "catalog_metadata",
    "generated",
    "third_party_assessment",
    "model_general_knowledge",
}


@dataclass(frozen=True, slots=True)
class PredicatePolicy:
    """The evidence-class and independence gate for one predicate."""

    predicate: str
    allowed_evidence_classes: frozenset[str]
    minimum_independent_roots: int = 1
    requires_complete_path: bool = False
    permits_catalog_only: bool = False


@dataclass(frozen=True, slots=True)
class ObservationEvidence:
    """The subset of an observation's fields needed for acceptance evaluation."""

    observation_id: str
    evidence_class: str
    root_id: str
    entailment: str


@dataclass(frozen=True, slots=True)
class AcceptanceDecision:
    """The outcome of evaluating a claim's evidence against its predicate policy."""

    accepted: bool
    policy_version: str
    reasons: tuple[str, ...]
    independent_root_count: int
    qualifying_observation_count: int


REGISTRY_CLASSES = frozenset(
    {
        "registry_filing",
        "proxy_filing",
        "beneficial_ownership_filing",
        "transaction_filing",
        "court_record",
        "government_record",
        "audited_statement",
        "charter_or_statute",
    }
)

POLICIES: dict[str, PredicatePolicy] = {
    "official_website": PredicatePolicy(
        "official_website", frozenset({"own_site", "registry_filing"})
    ),
    "declared_mission": PredicatePolicy(
        "declared_mission", frozenset({"own_site", "registry_filing"})
    ),
    "named_editor": PredicatePolicy("named_editor", frozenset({"own_site", "registry_filing"})),
    "same_legal_record": PredicatePolicy("same_legal_record", frozenset({"registry_filing"})),
    "legal_form": PredicatePolicy("legal_form", frozenset({"registry_filing"})),
    "jurisdiction": PredicatePolicy("jurisdiction", frozenset({"registry_filing"})),
    "owns_equity_in": PredicatePolicy("owns_equity_in", REGISTRY_CLASSES),
    "directly_owns": PredicatePolicy("directly_owns", REGISTRY_CLASSES),
    "brand_of": PredicatePolicy(
        "brand_of", frozenset({"registry_filing", "transaction_filing", "trademark_assignment"})
    ),
    "operated_by": PredicatePolicy(
        "operated_by",
        frozenset(
            {
                "registry_filing",
                "transaction_filing",
                "fcc_filing",
                "own_site",
                "contract_record",
            }
        ),
    ),
    "controls": PredicatePolicy("controls", REGISTRY_CLASSES),
    "ultimate_control": PredicatePolicy(
        "ultimate_control", REGISTRY_CLASSES, requires_complete_path=True
    ),
    "accounting_consolidated_by": PredicatePolicy(
        "accounting_consolidated_by",
        frozenset({"gleif_level_2", "audited_statement"}),
    ),
    "funds": PredicatePolicy(
        "funds",
        frozenset(
            {
                "appropriation_record",
                "grantor_record",
                "audited_statement",
                "government_record",
            }
        ),
    ),
    "authored_by": PredicatePolicy(
        "authored_by", frozenset({"article_structured_data", "article_byline"})
    ),
    "employed_by": PredicatePolicy(
        "employed_by", frozenset({"employer_profile", "person_profile", "registry_filing"})
    ),
    "advertises_with": PredicatePolicy(
        "advertises_with",
        frozenset({"sponsorship_disclosure", "transaction_record", "fcc_political_file"}),
    ),
    "political_ad_purchase": PredicatePolicy(
        "political_ad_purchase", frozenset({"fcc_political_file"})
    ),
    "authorizes_inventory_seller": PredicatePolicy(
        "authorizes_inventory_seller", frozenset({"ads_txt", "sellers_json"})
    ),
    "coverage_measurement": PredicatePolicy(
        "coverage_measurement", frozenset({"reproducible_measurement_run"})
    ),
    "formerly_known_as": PredicatePolicy(
        "formerly_known_as", frozenset({"registry_filing", "transaction_filing"})
    ),
    "successor_of": PredicatePolicy(
        "successor_of", frozenset({"registry_filing", "transaction_filing", "court_record"})
    ),
    "state_chartered_independent": PredicatePolicy(
        "state_chartered_independent", frozenset({"charter_or_statute"})
    ),
    "member_of": PredicatePolicy(
        "member_of", frozenset({"own_site", "registry_filing", "membership_record"})
    ),
}

DEFAULT_POLICY = PredicatePolicy(
    predicate="*",
    allowed_evidence_classes=frozenset(
        {
            "registry_filing",
            "government_record",
            "court_record",
            "audited_statement",
            "own_site",
            "article_structured_data",
        }
    ),
)


def policy_for(predicate: str) -> PredicatePolicy:
    """Return the active rule for a predicate."""
    return POLICIES.get(predicate, DEFAULT_POLICY)


def _coerce_evidence(item: ObservationEvidence | Mapping[str, str]) -> ObservationEvidence:
    if isinstance(item, ObservationEvidence):
        return item
    return ObservationEvidence(
        observation_id=str(item.get("observation_id", "")),
        evidence_class=str(item.get("evidence_class", "")),
        root_id=str(item.get("root_id", "")),
        entailment=str(item.get("entailment", "unevaluated")),
    )


def evaluate_acceptance(
    *,
    predicate: str,
    evidence: Iterable[ObservationEvidence | Mapping[str, str]],
    complete_control_path: bool = False,
    policy: PredicatePolicy | None = None,
) -> AcceptanceDecision:
    """Evaluate a claim without mutating it or materializing a relationship."""
    active = policy or policy_for(predicate)
    items = tuple(_coerce_evidence(item) for item in evidence)
    reasons: list[str] = []

    entailing = tuple(item for item in items if item.entailment == "reviewed_yes")
    qualifying = tuple(
        item for item in entailing if item.evidence_class in active.allowed_evidence_classes
    )
    root_ids = {item.root_id for item in qualifying if item.root_id}

    if not entailing:
        reasons.append("no reviewed evidence entails the claim")
    if entailing and not qualifying:
        reasons.append("no entailing observation satisfies the predicate evidence gate")
    if len(root_ids) < active.minimum_independent_roots:
        reasons.append(
            f"requires {active.minimum_independent_roots} independent evidence root(s); found {len(root_ids)}"
        )
    if active.requires_complete_path and not complete_control_path:
        reasons.append("predicate requires a complete accepted control path")

    evidence_classes = {item.evidence_class for item in entailing}
    if (
        evidence_classes
        and evidence_classes.issubset(CATALOG_ONLY_CLASSES)
        and not active.permits_catalog_only
    ):
        reasons.append("catalog or generated evidence cannot establish an accepted fact")

    return AcceptanceDecision(
        accepted=not reasons,
        policy_version=POLICY_VERSION,
        reasons=tuple(reasons),
        independent_root_count=len(root_ids),
        qualifying_observation_count=len(qualifying),
    )


def serialize_policies() -> Sequence[dict[str, object]]:
    """Return stable API/seed rows for every explicit policy."""
    return tuple(
        {
            "predicate": item.predicate,
            "version": POLICY_VERSION,
            "allowed_evidence_classes": sorted(item.allowed_evidence_classes),
            "minimum_independent_roots": item.minimum_independent_roots,
            "requires_complete_path": item.requires_complete_path,
            "permits_catalog_only": item.permits_catalog_only,
        }
        for item in sorted(POLICIES.values(), key=lambda row: row.predicate)
    )
