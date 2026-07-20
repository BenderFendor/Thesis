"""Public proof-suite registry without hardcoded expected owner paths."""

from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ProofCase:
    """One named proof-suite benchmark case and its required mutation classes."""

    case_id: str
    label: str
    unique_guard: str
    required_mutations: tuple[str, ...] = (
        "remove_critical_filing",
        "alter_owner_name",
        "move_completion_date_future",
        "inject_conflicting_filing",
        "insert_similarly_named_entity",
        "delete_percentage",
    )


PUBLIC_CASES: tuple[ProofCase, ...] = (
    ProofCase("washington-post", "Washington Post", "person-owned must not become company-owned"),
    ProofCase("new-york-times", "New York Times", "voting control must not become total equity"),
    ProofCase("wall-street-journal", "Wall Street Journal", "split corporations remain distinct"),
    ProofCase("reuters", "Reuters", "part-of and direct ownership remain distinct"),
    ProofCase("fox-news", "Fox News", "dual-class control and post-split identity"),
    ProofCase("financial-times", "Financial Times", "dated foreign acquisition"),
    ProofCase("guardian", "The Guardian", "trust chain without personal trustee ownership"),
    ProofCase("bbc", "BBC", "chartered independence is not state equity ownership"),
    ProofCase("associated-press", "Associated Press", "no ultimate controller is publishable"),
    ProofCase("npr", "NPR", "membership is not station ownership"),
    ProofCase("politico", "POLITICO", "separate transactions remain separately dated"),
    ProofCase("economist", "The Economist", "minority interest is not ultimate control"),
    ProofCase(
        "philadelphia-inquirer", "Philadelphia Inquirer", "non-controlling qualifier survives"
    ),
    ProofCase("tampa-bay-times", "Tampa Bay Times", "nonprofit owner and operator stay distinct"),
    ProofCase("usa-today-rename", "USA TODAY / Gannett rename", "rename never creates acquisition"),
    ProofCase("nbc-news", "NBC News", "announced separation does not rewrite current state"),
    ProofCase(
        "msnbc-versant", "MSNBC / Versant", "completed separation closes but preserves history"
    ),
    ProofCase("abc-news", "ABC News", "subsidiary lists have positive-only semantics"),
    ProofCase("cnn", "CNN", "proposed transactions never overwrite as-of state"),
    ProofCase("sinclair", "Sinclair", "operating agreements are not ownership"),
)
CASE_BY_ID = {case.case_id: case for case in PUBLIC_CASES}


def validate_registry() -> None:
    """Fail fast if the registry doesn't have exactly 20 unique, fully-specified cases."""
    ids = [case.case_id for case in PUBLIC_CASES]
    if len(ids) != 20 or len(ids) != len(set(ids)):
        raise ValueError("proof suite must define 20 unique public cases")
    for case in PUBLIC_CASES:
        if len(case.required_mutations) != 6:
            raise ValueError(f"case {case.case_id} does not define all six mutations")


validate_registry()
