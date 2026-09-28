import json

from app.services.evidence_policy import (
    ObservationEvidence,
    evaluate_acceptance,
    serialize_policies,
)
from rss_parser_rust import evaluate_evidence_claim_json, evidence_policies_json


def test_rust_policy_rows_match_python_policy_table() -> None:
    assert json.loads(evidence_policies_json()) == list(serialize_policies())


def test_rust_acceptance_decisions_match_python_reference_cases() -> None:
    cases = [
        {
            "predicate": "directly_owns",
            "evidence": [
                {
                    "observation_id": "catalog",
                    "evidence_class": "third_party_assessment",
                    "root_id": "catalog-doc",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                }
            ],
            "complete_control_path": False,
        },
        {
            "predicate": "directly_owns",
            "evidence": [
                {
                    "observation_id": "registry",
                    "evidence_class": "registry_filing",
                    "root_id": "filing-a",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                },
                {
                    "observation_id": "copy",
                    "evidence_class": "registry_filing",
                    "root_id": "filing-a",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                },
            ],
            "complete_control_path": False,
        },
        {
            "predicate": "ultimate_control",
            "evidence": [
                {
                    "observation_id": "control",
                    "evidence_class": "registry_filing",
                    "root_id": "filing-b",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                }
            ],
            "complete_control_path": False,
        },
        {
            "predicate": "ultimate_control",
            "evidence": [
                {
                    "observation_id": "control",
                    "evidence_class": "registry_filing",
                    "root_id": "filing-b",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                }
            ],
            "complete_control_path": True,
        },
        {
            "predicate": "bias_rating",
            "evidence": [
                {
                    "observation_id": "rating",
                    "evidence_class": "third_party_assessment",
                    "root_id": "rating-source",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                }
            ],
            "complete_control_path": False,
        },
        {
            "predicate": "directly_owns",
            "evidence": [
                {
                    "observation_id": "unreviewed",
                    "evidence_class": "registry_filing",
                    "root_id": "filing-c",
                    "entailment": "reviewed_yes",
                    "reviewed_by": None,
                },
                {
                    "observation_id": "no-entailment",
                    "evidence_class": "registry_filing",
                    "root_id": "filing-d",
                    "entailment": "reviewed_no",
                    "reviewed_by": "reviewer",
                },
            ],
            "complete_control_path": False,
        },
        {
            "predicate": "unlisted_predicate",
            "evidence": [
                {
                    "observation_id": "site",
                    "evidence_class": "own_site",
                    "root_id": "site-root",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                }
            ],
            "complete_control_path": False,
        },
        {
            "predicate": "directly_owns",
            "evidence": [
                {
                    "observation_id": "catalog",
                    "evidence_class": "catalog_metadata",
                    "root_id": "catalog-root",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                },
                {
                    "observation_id": "registry",
                    "evidence_class": "registry_filing",
                    "root_id": "registry-root",
                    "entailment": "reviewed_yes",
                    "reviewed_by": "reviewer",
                },
            ],
            "complete_control_path": False,
        },
    ]

    for case in cases:
        expected = evaluate_acceptance(
            predicate=case["predicate"],
            evidence=[ObservationEvidence(**observation) for observation in case["evidence"]],
            complete_control_path=case["complete_control_path"],
        )
        rust = json.loads(evaluate_evidence_claim_json(json.dumps(case)))
        assert rust == {
            "accepted": expected.accepted,
            "policy_version": expected.policy_version,
            "reasons": list(expected.reasons),
            "independent_root_count": expected.independent_root_count,
            "qualifying_observation_count": expected.qualifying_observation_count,
        }
