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
    reviewed_by: str | None = None


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
        "fcc_filing",
        # A Wikidata statement that carries an explicit citation (a
        # `references` block on the statement, not just an unsourced
        # community edit) -- per the Atlas rebuild plan's user decision #2,
        # "referenced Wikidata claims auto-materialize as accepted facts with
        # provenance." Distinct from `third_party_assessment` (used for
        # unreferenced Wikidata statements and other uncited third-party
        # data), which stays outside REGISTRY_CLASSES so those claims cannot
        # auto-accept for ownership/control predicates.
        "wikidata_referenced_statement",
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
        "brand_of",
        frozenset({"registry_filing", "transaction_filing", "trademark_assignment", "own_site"}),
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
                "own_site",
            }
        ),
    ),
    "reports_contribution": PredicatePolicy(
        "reports_contribution", frozenset({"irs_990", "audited_statement"})
    ),
    "reports_revenue": PredicatePolicy(
        "reports_revenue", frozenset({"irs_990", "audited_statement"})
    ),
    "reports_compensation": PredicatePolicy(
        "reports_compensation", frozenset({"irs_990", "audited_statement"})
    ),
    "reports_grant": PredicatePolicy("reports_grant", frozenset({"irs_990", "audited_statement"})),
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
    "sponsors_content": PredicatePolicy(
        "sponsors_content", frozenset({"sponsorship_disclosure", "transaction_record"})
    ),
    "advertising_inventory_sold_by": PredicatePolicy(
        "advertising_inventory_sold_by", frozenset({"own_site", "contract_record"})
    ),
    "authorizes_inventory_seller": PredicatePolicy(
        "authorizes_inventory_seller", frozenset({"ads_txt", "sellers_json"})
    ),
    "syndicated_by": PredicatePolicy(
        "syndicated_by", frozenset({"article_structured_data", "own_site"})
    ),
    "coverage_measurement": PredicatePolicy(
        "coverage_measurement", frozenset({"reproducible_measurement_run"})
    ),
    "formerly_known_as": PredicatePolicy(
        "formerly_known_as", frozenset({"registry_filing", "transaction_filing"})
    ),
    "successor_of": PredicatePolicy(
        "successor_of",
        frozenset({"registry_filing", "transaction_filing", "transaction_record", "court_record"}),
    ),
    "state_chartered_independent": PredicatePolicy(
        "state_chartered_independent", frozenset({"charter_or_statute"})
    ),
    "member_of": PredicatePolicy(
        "member_of", frozenset({"own_site", "registry_filing", "membership_record"})
    ),
    "founded_by": PredicatePolicy(
        "founded_by",
        frozenset(
            {
                "registry_filing",
                "own_site",
                "article_structured_data",
                "wikidata_referenced_statement",
            }
        ),
    ),
    # MBFC bias/factuality labels are the outlet's own published assessment,
    # not an asserted ground-truth fact -- attributed to MBFC and gated to the
    # "third_party_assessment" evidence class (see CATALOG_ONLY_CLASSES).
    # `permits_catalog_only=True` is what lets that class alone accept the
    # claim; every other predicate in this table explicitly withholds that
    # permission because catalog/third-party assessments are too weak to
    # establish e.g. an ownership fact.
    "bias_rating": PredicatePolicy(
        "bias_rating", frozenset({"third_party_assessment"}), permits_catalog_only=True
    ),
    "factual_reporting": PredicatePolicy(
        "factual_reporting", frozenset({"third_party_assessment"}), permits_catalog_only=True
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
    reviewed_by = item.get("reviewed_by")
    return ObservationEvidence(
        observation_id=str(item.get("observation_id", "")),
        evidence_class=str(item.get("evidence_class", "")),
        root_id=str(item.get("root_id", "")),
        entailment=str(item.get("entailment", "unevaluated")),
        reviewed_by=str(reviewed_by) if reviewed_by else None,
    )


def _qualifying_observations(
    items: Sequence[ObservationEvidence],
    active: PredicatePolicy,
) -> tuple[tuple[ObservationEvidence, ...], tuple[ObservationEvidence, ...]]:
    claimed_entailing = tuple(item for item in items if item.entailment == "reviewed_yes")
    entailing = tuple(item for item in claimed_entailing if item.reviewed_by)
    qualifying = tuple(
        item for item in entailing if item.evidence_class in active.allowed_evidence_classes
    )
    return entailing, qualifying


def _acceptance_reasons(
    *,
    active: PredicatePolicy,
    claimed_entailing: Sequence[ObservationEvidence],
    entailing: Sequence[ObservationEvidence],
    qualifying: Sequence[ObservationEvidence],
    root_ids: set[str],
    complete_control_path: bool,
) -> list[str]:
    reasons: list[str] = []
    reasons.extend(
        _basic_acceptance_reasons(
            active=active,
            claimed_entailing=claimed_entailing,
            entailing=entailing,
            qualifying=qualifying,
            root_ids=root_ids,
            complete_control_path=complete_control_path,
        )
    )
    catalog_reason = _catalog_only_reason(active, entailing)
    if catalog_reason:
        reasons.append(catalog_reason)
    return reasons


def _basic_acceptance_reasons(
    *,
    active: PredicatePolicy,
    claimed_entailing: Sequence[ObservationEvidence],
    entailing: Sequence[ObservationEvidence],
    qualifying: Sequence[ObservationEvidence],
    root_ids: set[str],
    complete_control_path: bool,
) -> list[str]:
    reasons: list[str] = []
    unattributed = len(claimed_entailing) - len(entailing)
    if not entailing:
        reasons.append("no reviewed evidence entails the claim")
    if unattributed:
        reasons.append(
            f"{unattributed} observation(s) marked reviewed_yes without a recorded reviewer; "
            "review action incomplete"
        )
    if entailing and not qualifying:
        reasons.append("no entailing observation satisfies the predicate evidence gate")
    if len(root_ids) < active.minimum_independent_roots:
        reasons.append(
            f"requires {active.minimum_independent_roots} independent evidence root(s); found {len(root_ids)}"
        )
    if active.requires_complete_path and not complete_control_path:
        reasons.append("predicate requires a complete accepted control path")
    return reasons


def _catalog_only_reason(
    active: PredicatePolicy,
    entailing: Sequence[ObservationEvidence],
) -> str | None:
    evidence_classes = {item.evidence_class for item in entailing}
    if (
        evidence_classes
        and evidence_classes.issubset(CATALOG_ONLY_CLASSES)
        and not active.permits_catalog_only
    ):
        return "catalog or generated evidence cannot establish an accepted fact"
    return None


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
    claimed_entailing = tuple(item for item in items if item.entailment == "reviewed_yes")
    entailing, qualifying = _qualifying_observations(items, active)
    root_ids = {item.root_id for item in qualifying if item.root_id}
    reasons = _acceptance_reasons(
        active=active,
        claimed_entailing=claimed_entailing,
        entailing=entailing,
        qualifying=qualifying,
        root_ids=root_ids,
        complete_control_path=complete_control_path,
    )

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
