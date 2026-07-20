from app.services.evidence_policy import ObservationEvidence, evaluate_acceptance


def evidence(
    evidence_class: str, root: str, entailment: str = "reviewed_yes"
) -> ObservationEvidence:
    reviewed_by = "reviewer@test" if entailment == "reviewed_yes" else None
    return ObservationEvidence("obs", evidence_class, root, entailment, reviewed_by)


def test_catalog_only_never_accepts_direct_ownership() -> None:
    decision = evaluate_acceptance(
        predicate="directly_owns", evidence=[evidence("catalog_metadata", "catalog")]
    )
    assert not decision.accepted
    assert any("evidence gate" in reason or "catalog" in reason for reason in decision.reasons)


def test_registry_filing_accepts_direct_ownership() -> None:
    decision = evaluate_acceptance(
        predicate="directly_owns", evidence=[evidence("registry_filing", "filing-1")]
    )
    assert decision.accepted
    assert decision.independent_root_count == 1


def test_quote_presence_without_reviewed_entailment_is_not_enough() -> None:
    decision = evaluate_acceptance(
        predicate="directly_owns",
        evidence=[evidence("registry_filing", "filing-1", "model_suggested")],
    )
    assert not decision.accepted
    assert "no reviewed evidence entails the claim" in decision.reasons


def test_reviewed_yes_without_a_recorded_reviewer_does_not_qualify() -> None:
    """`entailment='reviewed_yes'` with no `reviewed_by` means the flag was set
    without a real review action behind it -- it must not be enough to accept
    a claim (see PR #8 review, issue #9)."""
    unattributed = ObservationEvidence("obs", "registry_filing", "filing-1", "reviewed_yes", None)
    decision = evaluate_acceptance(predicate="directly_owns", evidence=[unattributed])
    assert not decision.accepted
    assert any("recorded reviewer" in reason for reason in decision.reasons)

    attributed = ObservationEvidence(
        "obs", "registry_filing", "filing-1", "reviewed_yes", "reviewer@test"
    )
    decision = evaluate_acceptance(predicate="directly_owns", evidence=[attributed])
    assert decision.accepted


def test_ultimate_control_requires_complete_path() -> None:
    incomplete = evaluate_acceptance(
        predicate="ultimate_control",
        evidence=[evidence("proxy_filing", "proxy-1")],
        complete_control_path=False,
    )
    complete = evaluate_acceptance(
        predicate="ultimate_control",
        evidence=[evidence("proxy_filing", "proxy-1")],
        complete_control_path=True,
    )
    assert not incomplete.accepted
    assert complete.accepted
