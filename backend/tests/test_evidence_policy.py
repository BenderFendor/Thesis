from app.services.evidence_policy import ObservationEvidence, evaluate_acceptance


def evidence(
    evidence_class: str, root: str, entailment: str = "reviewed_yes"
) -> ObservationEvidence:
    return ObservationEvidence("obs", evidence_class, root, entailment)


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
