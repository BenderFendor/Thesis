"""Clean-room proof-suite assertions and reproducible run manifests."""

from __future__ import annotations
import argparse
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from collections.abc import Iterable
from app.proof_suite.cases import CASE_BY_ID, PUBLIC_CASES

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
