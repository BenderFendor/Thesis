//! Pure evidence acceptance rules shared by the Rust service and PyO3 bridge.
pub mod ownership;

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

pub const POLICY_VERSION: &str = "evidence-policy/2.0";
const CATALOG_ONLY_CLASSES: [&str; 4] = [
    "catalog_metadata",
    "generated",
    "third_party_assessment",
    "model_general_knowledge",
];
const POLICIES_JSON: &str = include_str!("../policies.json");

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PredicatePolicy {
    pub predicate: String,
    pub version: String,
    pub allowed_evidence_classes: Vec<String>,
    pub minimum_independent_roots: usize,
    pub requires_complete_path: bool,
    pub permits_catalog_only: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ObservationEvidence {
    pub observation_id: String,
    pub evidence_class: String,
    pub root_id: String,
    pub entailment: String,
    pub reviewed_by: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AcceptanceDecision {
    pub accepted: bool,
    pub policy_version: String,
    pub reasons: Vec<String>,
    pub independent_root_count: usize,
    pub qualifying_observation_count: usize,
}

static POLICIES: OnceLock<Vec<PredicatePolicy>> = OnceLock::new();

/// Return all explicit policies in stable predicate order.
pub fn policies() -> &'static [PredicatePolicy] {
    POLICIES.get_or_init(|| {
        serde_json::from_str(POLICIES_JSON)
            .expect("embedded evidence acceptance policies must be valid JSON")
    })
}

/// Find the explicit policy for a predicate, or return `None` for the default rule.
pub fn policy_for(predicate: &str) -> Option<&'static PredicatePolicy> {
    policies()
        .iter()
        .find(|policy| policy.predicate == predicate)
}

/// Evaluate a claim against the active predicate policy without mutating state.
pub fn evaluate_acceptance(
    predicate: &str,
    evidence: &[ObservationEvidence],
    complete_control_path: bool,
) -> AcceptanceDecision {
    let default_policy = default_policy();
    evaluate_with_policy(
        evidence,
        complete_control_path,
        policy_for(predicate).unwrap_or(&default_policy),
    )
}

/// Evaluate against a policy selected by the caller.
pub fn evaluate_with_policy(
    evidence: &[ObservationEvidence],
    complete_control_path: bool,
    active: &PredicatePolicy,
) -> AcceptanceDecision {
    let facts = collect_evidence_facts(evidence, active);
    let decision_facts = DecisionFacts {
        claimed_entailing: facts.claimed_entailing,
        entailing: facts.entailing,
        qualifying: facts.qualifying,
        independent_roots: distinct_count(&facts.roots),
        all_entailing_are_catalog_only: facts.all_entailing_are_catalog_only,
    };
    let rules = DecisionRules {
        minimum_independent_roots: active.minimum_independent_roots,
        requires_complete_path: active.requires_complete_path,
        permits_catalog_only: active.permits_catalog_only,
    };
    let failures = decision_failures(decision_facts, rules, complete_control_path);
    let reasons = acceptance_reasons(&facts, active, failures);

    AcceptanceDecision {
        accepted: failures == 0,
        policy_version: POLICY_VERSION.to_owned(),
        reasons,
        independent_root_count: decision_facts.independent_roots,
        qualifying_observation_count: facts.qualifying,
    }
}

#[derive(Default)]
struct EvidenceFacts {
    claimed_entailing: usize,
    entailing: usize,
    qualifying: usize,
    roots: Vec<String>,
    all_entailing_are_catalog_only: bool,
}

fn collect_evidence_facts(
    evidence: &[ObservationEvidence],
    active: &PredicatePolicy,
) -> EvidenceFacts {
    let mut facts = EvidenceFacts {
        claimed_entailing: evidence
            .iter()
            .filter(|item| item.entailment == "reviewed_yes")
            .count(),
        all_entailing_are_catalog_only: true,
        ..EvidenceFacts::default()
    };
    for item in evidence
        .iter()
        .filter(|item| item.entailment == "reviewed_yes")
        .filter(|item| {
            item.reviewed_by
                .as_deref()
                .is_some_and(|reviewer| !reviewer.is_empty())
        })
    {
        record_entailing_evidence(&mut facts, item, active);
    }
    facts
}

fn record_entailing_evidence(
    facts: &mut EvidenceFacts,
    item: &ObservationEvidence,
    active: &PredicatePolicy,
) {
    facts.entailing += 1;
    facts.all_entailing_are_catalog_only &=
        CATALOG_ONLY_CLASSES.contains(&item.evidence_class.as_str());
    if !active
        .allowed_evidence_classes
        .iter()
        .any(|class| class == &item.evidence_class)
    {
        return;
    }
    facts.qualifying += 1;
    if !item.root_id.is_empty() {
        facts.roots.push(item.root_id.clone());
    }
}

fn acceptance_reasons(
    facts: &EvidenceFacts,
    active: &PredicatePolicy,
    failures: u8,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if failures & NO_ENTAILING != 0 {
        reasons.push("no reviewed evidence entails the claim".to_owned());
    }
    let unattributed = facts.claimed_entailing - facts.entailing;
    if failures & INCOMPLETE_REVIEW != 0 {
        reasons.push(format!(
            "{unattributed} observation(s) marked reviewed_yes without a recorded reviewer; review action incomplete"
        ));
    }
    if failures & NO_QUALIFYING_EVIDENCE != 0 {
        reasons.push("no entailing observation satisfies the predicate evidence gate".to_owned());
    }
    if failures & TOO_FEW_ROOTS != 0 {
        reasons.push(format!(
            "requires {} independent evidence root(s); found {}",
            active.minimum_independent_roots,
            distinct_count(&facts.roots)
        ));
    }
    if failures & INCOMPLETE_CONTROL_PATH != 0 {
        reasons.push("predicate requires a complete accepted control path".to_owned());
    }
    if failures & CATALOG_ONLY != 0 {
        reasons.push("catalog or generated evidence cannot establish an accepted fact".to_owned());
    }
    reasons
}

#[derive(Clone, Copy)]
struct DecisionFacts {
    claimed_entailing: usize,
    entailing: usize,
    qualifying: usize,
    independent_roots: usize,
    all_entailing_are_catalog_only: bool,
}

#[derive(Clone, Copy)]
struct DecisionRules {
    minimum_independent_roots: usize,
    requires_complete_path: bool,
    permits_catalog_only: bool,
}

const NO_ENTAILING: u8 = 1;
const INCOMPLETE_REVIEW: u8 = 2;
const NO_QUALIFYING_EVIDENCE: u8 = 4;
const TOO_FEW_ROOTS: u8 = 8;
const INCOMPLETE_CONTROL_PATH: u8 = 16;
const CATALOG_ONLY: u8 = 32;

fn decision_failures(facts: DecisionFacts, rules: DecisionRules, complete_path: bool) -> u8 {
    review_failures(facts) | policy_failures(facts, rules, complete_path)
}

fn review_failures(facts: DecisionFacts) -> u8 {
    let mut failures = 0;
    if facts.entailing == 0 {
        failures |= NO_ENTAILING;
    }
    if facts.claimed_entailing > facts.entailing {
        failures |= INCOMPLETE_REVIEW;
    }
    if facts.entailing > 0 && facts.qualifying == 0 {
        failures |= NO_QUALIFYING_EVIDENCE;
    }
    failures
}

fn policy_failures(facts: DecisionFacts, rules: DecisionRules, complete_path: bool) -> u8 {
    let mut failures = 0;
    if facts.independent_roots < rules.minimum_independent_roots {
        failures |= TOO_FEW_ROOTS;
    }
    if rules.requires_complete_path && !complete_path {
        failures |= INCOMPLETE_CONTROL_PATH;
    }
    if facts.entailing > 0 && facts.all_entailing_are_catalog_only && !rules.permits_catalog_only {
        failures |= CATALOG_ONLY;
    }
    failures
}

fn distinct_count<T: Eq>(values: &[T]) -> usize {
    let mut count = 0;
    for (index, value) in values.iter().enumerate() {
        if !values[..index].contains(value) {
            count += 1;
        }
    }
    count
}

fn default_policy() -> PredicatePolicy {
    PredicatePolicy {
        predicate: "*".to_owned(),
        version: POLICY_VERSION.to_owned(),
        allowed_evidence_classes: [
            "registry_filing",
            "government_record",
            "court_record",
            "audited_statement",
            "own_site",
            "article_structured_data",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
        minimum_independent_roots: 1,
        requires_complete_path: false,
        permits_catalog_only: false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        acceptance_reasons, decision_failures, evaluate_acceptance, policies, policy_failures,
        review_failures, DecisionFacts, DecisionRules, EvidenceFacts, ObservationEvidence,
        PredicatePolicy, CATALOG_ONLY, INCOMPLETE_CONTROL_PATH, INCOMPLETE_REVIEW, NO_ENTAILING,
        NO_QUALIFYING_EVIDENCE, POLICY_VERSION, TOO_FEW_ROOTS,
    };

    fn observation(id: &str, class: &str, root: &str) -> ObservationEvidence {
        ObservationEvidence {
            observation_id: id.to_owned(),
            evidence_class: class.to_owned(),
            root_id: root.to_owned(),
            entailment: "reviewed_yes".to_owned(),
            reviewed_by: Some("reviewer".to_owned()),
        }
    }

    #[test]
    fn policy_catalog_is_versioned_and_sorted() {
        let rows = policies();
        assert_eq!(rows.len(), 34);
        assert!(rows
            .windows(2)
            .all(|pair| pair[0].predicate < pair[1].predicate));
        assert!(rows.iter().all(|row| row.version == POLICY_VERSION));
    }

    #[test]
    fn catalog_only_class_does_not_accept_ownership() {
        let decision = evaluate_acceptance(
            "directly_owns",
            &[observation("obs-1", "third_party_assessment", "doc-1")],
            false,
        );
        assert!(!decision.accepted);
        assert_eq!(decision.independent_root_count, 0);
        assert!(decision.reasons.contains(
            &"catalog or generated evidence cannot establish an accepted fact".to_owned()
        ));
    }

    #[test]
    fn empty_evidence_does_not_report_catalog_only_as_a_failure() {
        let decision = evaluate_acceptance("directly_owns", &[], false);

        assert_eq!(
            decision.reasons,
            vec![
                "no reviewed evidence entails the claim",
                "requires 1 independent evidence root(s); found 0",
            ]
        );
    }

    #[test]
    fn complete_path_is_required_only_for_ultimate_control() {
        let evidence = [observation("obs-1", "registry_filing", "doc-1")];
        let incomplete = evaluate_acceptance("ultimate_control", &evidence, false);
        let complete = evaluate_acceptance("ultimate_control", &evidence, true);
        assert!(!incomplete.accepted);
        assert!(incomplete
            .reasons
            .contains(&"predicate requires a complete accepted control path".to_owned()));
        assert!(complete.accepted);
    }

    #[test]
    fn each_evidence_failure_has_only_its_documented_reason() {
        let facts = EvidenceFacts {
            claimed_entailing: 3,
            entailing: 1,
            qualifying: 0,
            roots: vec!["root-a".into(), "root-a".into()],
            all_entailing_are_catalog_only: true,
        };
        let active = PredicatePolicy {
            predicate: "test".into(),
            version: POLICY_VERSION.into(),
            allowed_evidence_classes: vec![],
            minimum_independent_roots: 2,
            requires_complete_path: false,
            permits_catalog_only: false,
        };
        let cases = [
            (NO_ENTAILING, "no reviewed evidence entails the claim".to_owned()),
            (
                INCOMPLETE_REVIEW,
                "2 observation(s) marked reviewed_yes without a recorded reviewer; review action incomplete".to_owned(),
            ),
            (
                NO_QUALIFYING_EVIDENCE,
                "no entailing observation satisfies the predicate evidence gate".to_owned(),
            ),
            (
                TOO_FEW_ROOTS,
                "requires 2 independent evidence root(s); found 1".to_owned(),
            ),
            (
                INCOMPLETE_CONTROL_PATH,
                "predicate requires a complete accepted control path".to_owned(),
            ),
            (
                CATALOG_ONLY,
                "catalog or generated evidence cannot establish an accepted fact".to_owned(),
            ),
        ];

        for (failure, expected) in cases {
            assert_eq!(acceptance_reasons(&facts, &active, failure), vec![expected]);
        }
    }

    #[test]
    fn evidence_failure_masks_match_rule_boundaries() {
        let accepted = DecisionFacts {
            claimed_entailing: 1,
            entailing: 1,
            qualifying: 1,
            independent_roots: 1,
            all_entailing_are_catalog_only: false,
        };
        let permissive = DecisionRules {
            minimum_independent_roots: 1,
            requires_complete_path: false,
            permits_catalog_only: false,
        };

        assert_eq!(review_failures(accepted), 0);
        assert_eq!(
            review_failures(DecisionFacts {
                claimed_entailing: 0,
                entailing: 0,
                qualifying: 0,
                ..accepted
            }),
            NO_ENTAILING
        );
        assert_eq!(
            review_failures(DecisionFacts {
                claimed_entailing: 2,
                ..accepted
            }),
            INCOMPLETE_REVIEW
        );
        assert_eq!(
            review_failures(DecisionFacts {
                qualifying: 0,
                ..accepted
            }),
            NO_QUALIFYING_EVIDENCE
        );

        assert_eq!(policy_failures(accepted, permissive, true), 0);
        assert_eq!(
            policy_failures(
                DecisionFacts {
                    independent_roots: 0,
                    ..accepted
                },
                permissive,
                true,
            ),
            TOO_FEW_ROOTS
        );
        assert_eq!(
            policy_failures(
                accepted,
                DecisionRules {
                    requires_complete_path: true,
                    ..permissive
                },
                false,
            ),
            INCOMPLETE_CONTROL_PATH
        );
        assert_eq!(
            policy_failures(
                DecisionFacts {
                    all_entailing_are_catalog_only: true,
                    ..accepted
                },
                permissive,
                true,
            ),
            CATALOG_ONLY
        );
        assert_eq!(
            decision_failures(
                DecisionFacts {
                    claimed_entailing: 0,
                    entailing: 0,
                    qualifying: 0,
                    independent_roots: 0,
                    all_entailing_are_catalog_only: false,
                },
                DecisionRules {
                    minimum_independent_roots: 1,
                    requires_complete_path: true,
                    permits_catalog_only: false,
                },
                false,
            ),
            NO_ENTAILING | TOO_FEW_ROOTS | INCOMPLETE_CONTROL_PATH
        );
    }
}

#[cfg(kani)]
mod verification {
    use super::{decision_failures, distinct_count, DecisionFacts, DecisionRules};

    #[kani::proof]
    fn accepted_decisions_satisfy_the_policy_kernel() {
        let facts = DecisionFacts {
            claimed_entailing: usize::from(kani::any::<u8>()),
            entailing: usize::from(kani::any::<u8>()),
            qualifying: usize::from(kani::any::<u8>()),
            independent_roots: usize::from(kani::any::<u8>()),
            all_entailing_are_catalog_only: kani::any::<bool>(),
        };
        let rules = DecisionRules {
            minimum_independent_roots: usize::from(kani::any::<u8>()),
            requires_complete_path: kani::any::<bool>(),
            permits_catalog_only: kani::any::<bool>(),
        };
        let complete_path = kani::any::<bool>();
        let failures = decision_failures(facts, rules, complete_path);
        if failures == 0 {
            assert!(facts.entailing > 0);
            assert!(facts.claimed_entailing <= facts.entailing);
            assert!(facts.qualifying > 0);
            assert!(facts.independent_roots >= rules.minimum_independent_roots);
            assert!(!rules.requires_complete_path || complete_path);
            assert!(
                facts.entailing == 0
                    || !facts.all_entailing_are_catalog_only
                    || rules.permits_catalog_only
            );
        }
    }

    #[kani::proof]
    fn reviewed_registry_fact_has_a_reachable_acceptance() {
        let facts = DecisionFacts {
            claimed_entailing: 1,
            entailing: 1,
            qualifying: 1,
            independent_roots: 1,
            all_entailing_are_catalog_only: false,
        };
        let rules = DecisionRules {
            minimum_independent_roots: 1,
            requires_complete_path: false,
            permits_catalog_only: false,
        };
        assert!(decision_failures(facts, rules, false) == 0);
    }

    #[kani::proof]
    fn same_root_is_counted_once() {
        let roots = [7_u8, 7_u8, 9_u8];
        assert_eq!(distinct_count(&roots), 2);
    }

    #[kani::proof]
    fn duplicate_root_does_not_increase_independent_count() {
        let first = kani::any::<u8>();
        let second = kani::any::<u8>();
        let original = [first, second];
        let with_duplicate = [first, second, second];
        assert_eq!(distinct_count(&original), distinct_count(&with_duplicate));
    }

    #[kani::proof]
    fn catalog_only_evidence_cannot_accept_ownership() {
        let facts = DecisionFacts {
            claimed_entailing: 1,
            entailing: 1,
            qualifying: 1,
            independent_roots: 1,
            all_entailing_are_catalog_only: true,
        };
        let rules = DecisionRules {
            minimum_independent_roots: 1,
            requires_complete_path: false,
            permits_catalog_only: false,
        };
        assert_ne!(decision_failures(facts, rules, false), 0);
    }

    #[kani::proof]
    fn unique_root_count_stays_within_the_input_length() {
        let roots = [kani::any::<u8>(), kani::any::<u8>(), kani::any::<u8>()];
        let count = distinct_count(&roots);
        assert!(count > 0);
        assert!(count <= roots.len());
    }
}

#[cfg(test)]
mod property_tests {
    use super::{evaluate_acceptance, ObservationEvidence};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn duplicate_observations_from_one_source_do_not_increase_independence(
            root in "root-[a-z]{1,8}",
            copies in 1usize..16,
        ) {
            let make_observation = |id: usize| ObservationEvidence {
                observation_id: format!("obs-{id}"),
                evidence_class: "registry_filing".to_owned(),
                root_id: root.clone(),
                entailment: "reviewed_yes".to_owned(),
                reviewed_by: Some("reviewer".to_owned()),
            };
            let base = [make_observation(0)];
            let mut expanded = base.to_vec();
            expanded.extend((1..=copies).map(make_observation));

            let before = evaluate_acceptance("directly_owns", &base, false);
            let after = evaluate_acceptance("directly_owns", &expanded, false);
            prop_assert_eq!(before.independent_root_count, 1);
            prop_assert_eq!(after.independent_root_count, before.independent_root_count);
            prop_assert_eq!(after.qualifying_observation_count, copies + 1);
            prop_assert_eq!(after.accepted, before.accepted);
            prop_assert_eq!(after.reasons, before.reasons);
        }
    }
}
