from app.proof_suite.cases import PUBLIC_CASES
from app.proof_suite.runner import (
    ASSERTION_NAMES,
    AssertionResult,
    ProofCaseResult,
    validate_case_result,
)


def test_suite_has_twenty_cases_six_mutations_and_fifteen_assertions() -> None:
    assert len(PUBLIC_CASES) == 20
    assert len(ASSERTION_NAMES) == 15
    assert all(len(case.required_mutations) == 6 for case in PUBLIC_CASES)


def test_complete_case_result_validates() -> None:
    case = PUBLIC_CASES[0]
    result = ProofCaseResult(
        case_id=case.case_id,
        assertions=[AssertionResult(name, True) for name in ASSERTION_NAMES],
        mutations={name: True for name in case.required_mutations},
    )
    validate_case_result(result)
    assert result.passed
