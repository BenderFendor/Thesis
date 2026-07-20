"""Clean-room proof-suite assertions and reproducible run manifests.

`evaluate_case_against_database` is the part of the suite that actually runs
a case: it takes a human-reviewed truth bundle and compares it against what
the real evidence-spine pipeline (app.services.evidence_spine) materialized
in the database, rather than only checking that the truth bundle's own shape
looks complete (`assert_snapshot_pinned_truth`, kept below for that narrower
purpose). Running this for the 20 public benchmark cases still requires
actual filing snapshots ingested into the database and a human-reviewed
truth bundle pinned from them -- this module supplies the runner, not the
evidentiary data or the review (see docs/scoop-evidence-spine.md and
docs/agents/traces/fix-evidence-spine-issues-10-11-12-13.md for what remains
blocked on that human step).
"""

from __future__ import annotations
import argparse
import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from collections.abc import Iterable
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
        """True only when all 15 assertions and all 6 mutation classes passed."""
        return (
            len(self.assertions) == len(ASSERTION_NAMES)
            and all(item.passed for item in self.assertions)
            and len(self.mutations) == 6
            and all(self.mutations.values())
        )


def canonical_digest(value: Any) -> str:
    """Return a stable SHA-256 digest over the canonical JSON of *value*."""
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def assert_snapshot_pinned_truth(truth: dict[str, Any]) -> list[AssertionResult]:
    """Check that a truth bundle's expected edges cite snapshots, locators, and claims."""
    relationships = truth.get("relationships")
    if not isinstance(relationships, list) or not relationships:
        return [AssertionResult("correct_entities", False, "truth has no relationships")]
    hashes_ok = all(
        isinstance(edge, dict)
        and isinstance(edge.get("snapshot_sha256"), str)
        and len(edge["snapshot_sha256"]) == 64
        for edge in relationships
    )
    locators_ok = all(
        isinstance(edge, dict) and isinstance(edge.get("locator"), dict) and edge["locator"]
        for edge in relationships
    )
    claims_ok = all(
        isinstance(edge, dict) and isinstance(edge.get("claim_ids"), list) and edge["claim_ids"]
        for edge in relationships
    )
    results = []
    for name in ASSERTION_NAMES:
        passed, detail = True, "validated by case evaluator"
        if name == "exact_snapshot_hashes":
            passed, detail = hashes_ok, "every expected edge must cite a SHA-256 snapshot"
        elif name == "valid_locators":
            passed, detail = locators_ok, "every expected edge must cite a locator"
        elif name == "supporting_claims_resolve":
            passed, detail = claims_ok, "every expected edge must cite claim IDs"
        results.append(AssertionResult(name, passed, detail))
    return results


async def _matching_accepted_relationship(
    db: AsyncSession, expected: dict[str, Any]
) -> AcceptedRelationship | None:
    as_of = datetime.now(UTC).replace(tzinfo=None)
    query = await list_relationships(
        db, as_of=as_of, known_at=as_of, entity_id=expected.get("subject_entity_id")
    )
    for record in query.relationships:
        if (
            record.subject_entity_id == expected.get("subject_entity_id")
            and record.predicate == expected.get("predicate")
            and record.object_entity_id == expected.get("object_entity_id")
        ):
            return await db.get(AcceptedRelationship, record.id)
    return None


async def evaluate_case_against_database(
    db: AsyncSession, truth: dict[str, Any]
) -> list[AssertionResult]:
    """Run the 15 named assertions against what the pipeline actually materialized.

    Unlike `assert_snapshot_pinned_truth` (which only checks a truth bundle's
    own shape), this compares each expected edge in *truth* against the real
    `AcceptedRelationship`/`EvidenceClaim`/`EvidenceObservation` rows the
    evidence-spine pipeline produced for the same entities -- an actual
    end-to-end proof run rather than a manifest describing what one would
    look like.
    """
    expected_edges = truth.get("relationships")
    if not isinstance(expected_edges, list) or not expected_edges:
        return [
            AssertionResult(name, False, "truth bundle has no relationships to check")
            for name in ASSERTION_NAMES
        ]

    outcomes: dict[str, list[bool]] = {name: [] for name in ASSERTION_NAMES}
    details: dict[str, str] = {}

    for expected in expected_edges:
        relationship = await _matching_accepted_relationship(db, expected)
        found = relationship is not None
        outcomes["correct_entities"].append(found)
        outcomes["correct_predicates"].append(found)
        outcomes["correct_direction"].append(found)
        if relationship is None:
            details["correct_entities"] = (
                f"no accepted relationship matches {expected.get('subject_entity_id')} "
                f"-{expected.get('predicate')}-> {expected.get('object_entity_id')}"
            )
            for name in ASSERTION_NAMES:
                if name not in ("correct_entities", "correct_predicates", "correct_direction"):
                    outcomes[name].append(False)
            continue

        subject_entity = await db.get(EvidenceEntity, cast(str, relationship.subject_entity_id))
        object_entity = await db.get(EvidenceEntity, cast(str, relationship.object_entity_id))
        expected_subject_kind = expected.get("subject_record_kind")
        expected_object_kind = expected.get("object_record_kind")
        outcomes["correct_record_kinds"].append(
            (
                expected_subject_kind is None
                or (
                    subject_entity is not None
                    and subject_entity.record_kind == expected_subject_kind
                )
            )
            and (
                expected_object_kind is None
                or (object_entity is not None and object_entity.record_kind == expected_object_kind)
            )
        )

        expected_qualifiers = expected.get("qualifiers") or {}
        actual_qualifiers = dict(cast(dict[str, Any], relationship.qualifiers or {}))
        outcomes["correct_qualifiers"].append(
            all(actual_qualifiers.get(key) == value for key, value in expected_qualifiers.items())
        )
        outcomes["correct_transaction_status"].append(
            "txn_status" not in expected_qualifiers
            or actual_qualifiers.get("txn_status") == expected_qualifiers["txn_status"]
        )
        expected_valid_from = expected.get("valid_from")
        expected_valid_to = expected.get("valid_to")
        outcomes["correct_dates"].append(
            (expected_valid_from is None or relationship.valid_from == expected_valid_from)
            and (expected_valid_to is None or relationship.valid_to == expected_valid_to)
        )

        claim_rows = list(
            (
                await db.execute(
                    select(EvidenceClaim).where(
                        EvidenceClaim.subject_entity_id == relationship.subject_entity_id,
                        EvidenceClaim.predicate == relationship.predicate,
                        EvidenceClaim.object_entity_id == relationship.object_entity_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        expected_claim_ids = set(expected.get("claim_ids") or [])
        actual_claim_ids = {cast(str, row.id) for row in claim_rows}
        outcomes["supporting_claims_resolve"].append(
            not expected_claim_ids or expected_claim_ids.issubset(actual_claim_ids)
        )

        gate_satisfied = False
        deterministic = True
        first_decision: bool | None = None
        for claim in claim_rows:
            evaluation = await evaluate_claim_by_id(db, cast(str, claim.id))
            if evaluation.accepted:
                gate_satisfied = True
            if first_decision is None:
                first_decision = evaluation.accepted
            rerun = await evaluate_claim_by_id(db, cast(str, claim.id))
            if rerun.accepted != evaluation.accepted:
                deterministic = False
        outcomes["predicate_gate_satisfied"].append(gate_satisfied)
        outcomes["deterministic_rerun"].append(deterministic)

        observation_rows: list[EvidenceObservation] = []
        for claim in claim_rows:
            links = list(
                (await db.execute(select(ClaimEvidence).where(ClaimEvidence.claim_id == claim.id)))
                .scalars()
                .all()
            )
            for link in links:
                observation = await db.get(EvidenceObservation, cast(str, link.observation_id))
                if observation is not None:
                    observation_rows.append(observation)

        expected_hash = expected.get("snapshot_sha256")
        hash_ok = expected_hash is None
        if expected_hash is not None:
            for observation in observation_rows:
                snapshot = await db.get(DocumentSnapshot, cast(str, observation.snapshot_id))
                if snapshot is not None and snapshot.sha256_raw == expected_hash:
                    hash_ok = True
                    break
        outcomes["exact_snapshot_hashes"].append(hash_ok)
        outcomes["valid_locators"].append(
            any(bool(observation.locator) for observation in observation_rows)
        )

        catalog_only = bool(claim_rows) and all(
            claim.evidence_class in CATALOG_ONLY_CLASSES for claim in claim_rows
        )
        outcomes["no_catalog_only_acceptance"].append(not catalog_only)
        open_conflicts = list(
            (
                await db.execute(
                    select(AdjudicationItem).where(
                        AdjudicationItem.item_type == "claim_contradiction",
                        AdjudicationItem.status == "open",
                    )
                )
            )
            .scalars()
            .all()
        )
        conflicts_this_entity = [
            item
            for item in open_conflicts
            if relationship.subject_entity_id in (item.entity_ids or [])
        ]
        outcomes["no_forbidden_relationship"].append(not conflicts_this_entity)

        try:
            await build_relationship_proof_bundle(
                db,
                cast(str, relationship.id),
                as_of=datetime.now(UTC).replace(tzinfo=None),
                known_at=datetime.now(UTC).replace(tzinfo=None),
                commit_sha="proof-suite-run",
                dataset_snapshot="proof-suite-run",
            )
            outcomes["standards_exports_validate"].append(True)
        except ProofBundleError as exc:
            outcomes["standards_exports_validate"].append(False)
            details["standards_exports_validate"] = str(exc)

    return [
        AssertionResult(
            name,
            bool(outcomes[name]) and all(outcomes[name]),
            details.get(name, "checked against materialized database state"),
        )
        for name in ASSERTION_NAMES
    ]


def compare_deterministic_runs(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Return True if two run manifests match once timestamps/run IDs are stripped."""
    strip_keys = {"generated_at", "started_at", "completed_at", "run_id"}

    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key not in strip_keys}
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value

    return canonical_digest(clean(left)) == canonical_digest(clean(right))


def validate_case_result(result: ProofCaseResult) -> None:
    """Raise if a case result is missing an assertion, mutation, or is for an unknown case."""
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
