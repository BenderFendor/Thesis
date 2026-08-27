"""Clean-room proof-suite assertions and reproducible run manifests.

The database evaluator compares human-reviewed truth bundles with relationships,
claims, observations, and proof exports produced by the real evidence spine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evidence import (
    AcceptedRelationship,
    AdjudicationItem,
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceEntity,
    EvidenceObservation,
)
from app.proof_suite.cases import CASE_BY_ID, PUBLIC_CASES
from app.services.evidence_export import ProofBundleError, build_relationship_proof_bundle
from app.services.evidence_policy import CATALOG_ONLY_CLASSES
from app.services.evidence_spine import evaluate_claim_by_id, list_relationships

ASSERTION_NAMES = (
    "correct_entities",
    "correct_record_kinds",
    "correct_predicates",
    "correct_direction",
    "correct_dates",
    "correct_qualifiers",
    "correct_transaction_status",
    "predicate_gate_satisfied",
    "exact_snapshot_hashes",
    "valid_locators",
    "supporting_claims_resolve",
    "no_forbidden_relationship",
    "no_catalog_only_acceptance",
    "deterministic_rerun",
    "standards_exports_validate",
)


@dataclass(slots=True)
class AssertionResult:
    """The pass/fail outcome of one named proof-suite assertion."""

    name: str
    passed: bool
    detail: str = ""


@dataclass(slots=True)
class ProofCaseResult:
    """The full assertion and mutation-test outcome for one proof case run."""

    case_id: str
    assertions: list[AssertionResult] = field(default_factory=list)
    mutations: dict[str, bool] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        """True only when all assertions and mutation classes passed."""
        assertion_set_complete = len(self.assertions) == len(ASSERTION_NAMES)
        mutations_complete = len(self.mutations) == 6
        return (
            assertion_set_complete
            and all(item.passed for item in self.assertions)
            and mutations_complete
            and all(self.mutations.values())
        )


@dataclass(slots=True)
class _EvaluationAccumulator:
    outcomes: dict[str, list[bool]] = field(
        default_factory=lambda: {name: [] for name in ASSERTION_NAMES}
    )
    details: dict[str, str] = field(default_factory=dict)

    def record(self, name: str, passed: bool) -> None:
        self.outcomes[name].append(passed)

    def fail_unresolved_edge(self, expected: dict[str, Any]) -> None:
        self.record("correct_entities", False)
        self.record("correct_predicates", False)
        self.record("correct_direction", False)
        self.details["correct_entities"] = (
            f"no accepted relationship matches {expected.get('subject_entity_id')} "
            f"-{expected.get('predicate')}-> {expected.get('object_entity_id')}"
        )
        unresolved = set(ASSERTION_NAMES) - {
            "correct_entities",
            "correct_predicates",
            "correct_direction",
        }
        for name in unresolved:
            self.record(name, False)

    def finish(self) -> list[AssertionResult]:
        return [
            AssertionResult(
                name,
                bool(self.outcomes[name]) and all(self.outcomes[name]),
                self.details.get(name, "checked against materialized database state"),
            )
            for name in ASSERTION_NAMES
        ]


def canonical_digest(value: Any) -> str:
    """Return a stable SHA-256 digest over the canonical JSON of *value*."""
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _truth_relationships(truth: dict[str, Any]) -> list[dict[str, Any]]:
    raw = truth.get("relationships")
    if not isinstance(raw, list):
        return []
    return [edge for edge in raw if isinstance(edge, dict)]


def assert_snapshot_pinned_truth(truth: dict[str, Any]) -> list[AssertionResult]:
    """Check that expected edges cite snapshots, locators, and supporting claims."""
    relationships = _truth_relationships(truth)
    if not relationships:
        return [AssertionResult("correct_entities", False, "truth has no relationships")]

    checks: dict[str, tuple[bool, str]] = {
        "exact_snapshot_hashes": (
            all(isinstance(edge.get("snapshot_sha256"), str) and len(edge["snapshot_sha256"]) == 64 for edge in relationships),
            "every expected edge must cite a SHA-256 snapshot",
        ),
        "valid_locators": (
            all(isinstance(edge.get("locator"), dict) and bool(edge["locator"]) for edge in relationships),
            "every expected edge must cite a locator",
        ),
        "supporting_claims_resolve": (
            all(isinstance(edge.get("claim_ids"), list) and bool(edge["claim_ids"]) for edge in relationships),
            "every expected edge must cite claim IDs",
        ),
    }
    default = (True, "validated by case evaluator")
    return [AssertionResult(name, *checks.get(name, default)) for name in ASSERTION_NAMES]


async def _matching_accepted_relationship(
    db: AsyncSession, expected: dict[str, Any]
) -> AcceptedRelationship | None:
    as_of = datetime.now(UTC).replace(tzinfo=None)
    query = await list_relationships(
        db,
        as_of=as_of,
        known_at=as_of,
        entity_id=expected.get("subject_entity_id"),
    )
    target = (
        expected.get("subject_entity_id"),
        expected.get("predicate"),
        expected.get("object_entity_id"),
    )
    for record in query.relationships:
        actual = (record.subject_entity_id, record.predicate, record.object_entity_id)
        if actual == target:
            return await db.get(AcceptedRelationship, record.id)
    return None


async def _record_relationship_shape(
    db: AsyncSession,
    accumulator: _EvaluationAccumulator,
    expected: dict[str, Any],
    relationship: AcceptedRelationship,
) -> None:
    accumulator.record("correct_entities", True)
    accumulator.record("correct_predicates", True)
    accumulator.record("correct_direction", True)

    subject = await db.get(EvidenceEntity, cast(str, relationship.subject_entity_id))
    object_entity = await db.get(EvidenceEntity, cast(str, relationship.object_entity_id))
    expected_subject_kind = expected.get("subject_record_kind")
    expected_object_kind = expected.get("object_record_kind")
    subject_kind_ok = expected_subject_kind is None or (
        subject is not None and subject.record_kind == expected_subject_kind
    )
    object_kind_ok = expected_object_kind is None or (
        object_entity is not None and object_entity.record_kind == expected_object_kind
    )
    accumulator.record("correct_record_kinds", subject_kind_ok and object_kind_ok)

    expected_qualifiers = expected.get("qualifiers") or {}
    actual_qualifiers = dict(cast(dict[str, Any], relationship.qualifiers or {}))
    accumulator.record(
        "correct_qualifiers",
        all(actual_qualifiers.get(key) == value for key, value in expected_qualifiers.items()),
    )
    expected_txn_status = expected_qualifiers.get("txn_status")
    accumulator.record(
        "correct_transaction_status",
        expected_txn_status is None or actual_qualifiers.get("txn_status") == expected_txn_status,
    )

    expected_valid_from = expected.get("valid_from")
    expected_valid_to = expected.get("valid_to")
    date_bounds = (
        expected_valid_from is None or relationship.valid_from == expected_valid_from,
        expected_valid_to is None or relationship.valid_to == expected_valid_to,
    )
    accumulator.record("correct_dates", all(date_bounds))


async def _relationship_claims(
    db: AsyncSession, relationship: AcceptedRelationship
) -> list[EvidenceClaim]:
    result = await db.execute(
        select(EvidenceClaim).where(
            EvidenceClaim.subject_entity_id == relationship.subject_entity_id,
            EvidenceClaim.predicate == relationship.predicate,
            EvidenceClaim.object_entity_id == relationship.object_entity_id,
        )
    )
    return list(result.scalars().all())


def _record_claim_resolution(
    accumulator: _EvaluationAccumulator,
    expected: dict[str, Any],
    claims: list[EvidenceClaim],
) -> None:
    expected_ids = set(expected.get("claim_ids") or [])
    actual_ids = {cast(str, row.id) for row in claims}
    accumulator.record(
        "supporting_claims_resolve",
        not expected_ids or expected_ids.issubset(actual_ids),
    )
    catalog_only = bool(claims) and all(
        claim.evidence_class in CATALOG_ONLY_CLASSES for claim in claims
    )
    accumulator.record("no_catalog_only_acceptance", not catalog_only)


async def _record_claim_evaluations(
    db: AsyncSession,
    accumulator: _EvaluationAccumulator,
    claims: list[EvidenceClaim],
) -> None:
    accepted_results: list[bool] = []
    deterministic_results: list[bool] = []
    for claim in claims:
        claim_id = cast(str, claim.id)
        first = await evaluate_claim_by_id(db, claim_id)
        rerun = await evaluate_claim_by_id(db, claim_id)
        accepted_results.append(first.accepted)
        deterministic_results.append(rerun.accepted == first.accepted)
    accumulator.record("predicate_gate_satisfied", any(accepted_results))
    accumulator.record("deterministic_rerun", all(deterministic_results))


async def _claim_observations(
    db: AsyncSession, claims: list[EvidenceClaim]
) -> list[EvidenceObservation]:
    observations: list[EvidenceObservation] = []
    for claim in claims:
        result = await db.execute(select(ClaimEvidence).where(ClaimEvidence.claim_id == claim.id))
        for link in result.scalars().all():
            observation = await db.get(EvidenceObservation, cast(str, link.observation_id))
            if observation is not None:
                observations.append(observation)
    return observations


async def _snapshot_hash_matches(
    db: AsyncSession,
    observations: list[EvidenceObservation],
    expected_hash: object,
) -> bool:
    if expected_hash is None:
        return True
    for observation in observations:
        snapshot = await db.get(DocumentSnapshot, cast(str, observation.snapshot_id))
        if snapshot is not None and snapshot.sha256_raw == expected_hash:
            return True
    return False


async def _record_observation_integrity(
    db: AsyncSession,
    accumulator: _EvaluationAccumulator,
    expected: dict[str, Any],
    observations: list[EvidenceObservation],
) -> None:
    accumulator.record(
        "exact_snapshot_hashes",
        await _snapshot_hash_matches(db, observations, expected.get("snapshot_sha256")),
    )
    accumulator.record("valid_locators", any(bool(item.locator) for item in observations))


async def _record_conflict_status(
    db: AsyncSession,
    accumulator: _EvaluationAccumulator,
    relationship: AcceptedRelationship,
) -> None:
    result = await db.execute(
        select(AdjudicationItem).where(
            AdjudicationItem.item_type == "claim_contradiction",
            AdjudicationItem.status == "open",
        )
    )
    subject_id = relationship.subject_entity_id
    has_subject_conflict = any(subject_id in (item.entity_ids or []) for item in result.scalars().all())
    accumulator.record("no_forbidden_relationship", not has_subject_conflict)


async def _record_export_validation(
    db: AsyncSession,
    accumulator: _EvaluationAccumulator,
    relationship: AcceptedRelationship,
) -> None:
    now = datetime.now(UTC).replace(tzinfo=None)
    try:
        await build_relationship_proof_bundle(
            db,
            cast(str, relationship.id),
            as_of=now,
            known_at=now,
            commit_sha="proof-suite-run",
            dataset_snapshot="proof-suite-run",
        )
    except ProofBundleError as exc:
        accumulator.record("standards_exports_validate", False)
        accumulator.details["standards_exports_validate"] = str(exc)
        return
    accumulator.record("standards_exports_validate", True)


async def _evaluate_expected_edge(
    db: AsyncSession,
    accumulator: _EvaluationAccumulator,
    expected: dict[str, Any],
) -> None:
    relationship = await _matching_accepted_relationship(db, expected)
    if relationship is None:
        accumulator.fail_unresolved_edge(expected)
        return

    await _record_relationship_shape(db, accumulator, expected, relationship)
    claims = await _relationship_claims(db, relationship)
    _record_claim_resolution(accumulator, expected, claims)
    await _record_claim_evaluations(db, accumulator, claims)
    observations = await _claim_observations(db, claims)
    await _record_observation_integrity(db, accumulator, expected, observations)
    await _record_conflict_status(db, accumulator, relationship)
    await _record_export_validation(db, accumulator, relationship)


async def evaluate_case_against_database(
    db: AsyncSession, truth: dict[str, Any]
) -> list[AssertionResult]:
    """Run all named assertions against materialized evidence-spine state."""
    expected_edges = _truth_relationships(truth)
    if not expected_edges:
        return [
            AssertionResult(name, False, "truth bundle has no relationships to check")
            for name in ASSERTION_NAMES
        ]

    accumulator = _EvaluationAccumulator()
    for expected in expected_edges:
        await _evaluate_expected_edge(db, accumulator, expected)
    return accumulator.finish()


def compare_deterministic_runs(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Return True if manifests match once timestamps/run IDs are stripped."""
    strip_keys = {"generated_at", "started_at", "completed_at", "run_id"}

    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key not in strip_keys}
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value

    return canonical_digest(clean(left)) == canonical_digest(clean(right))


def validate_case_result(result: ProofCaseResult) -> None:
    """Raise if a case result is missing an assertion, mutation, or known case ID."""
    if result.case_id not in CASE_BY_ID:
        raise ValueError(f"unknown proof case {result.case_id}")
    if [item.name for item in result.assertions] != list(ASSERTION_NAMES):
        raise ValueError("case result must report all 15 assertions in canonical order")
    if set(result.mutations) != set(CASE_BY_ID[result.case_id].required_mutations):
        raise ValueError("case result must report all six mutation classes")


def empty_run_manifest(commit_sha: str, dataset_snapshot: str) -> dict[str, Any]:
    """Return a blank, reproducible run manifest scaffold for the proof suite."""
    return {
        "suite_version": "scoop-proof-suite/2.0",
        "commit_sha": commit_sha,
        "dataset_snapshot": dataset_snapshot,
        "public_cases": [case.case_id for case in PUBLIC_CASES],
        "hidden_case_count": 5,
        "assertions_per_case": list(ASSERTION_NAMES),
        "clean_room": {
            "network_access": False,
            "raw_artifacts_persist": True,
            "derived_tables_truncated_before_run": True,
        },
    }


def main(argv: Iterable[str] | None = None) -> int:
    """CLI entry point: write an empty proof-suite run manifest to stdout or a file."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--relationship")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--commit", default="unknown")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(list(argv) if argv is not None else None)
    manifest = empty_run_manifest(args.commit, args.dataset)
    if args.relationship:
        manifest["relationship_id"] = args.relationship
    payload = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
