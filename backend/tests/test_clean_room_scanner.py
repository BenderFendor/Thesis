from pathlib import Path
from scripts.check_proof_suite_clean_room import PIPELINE_ALLOWLIST, scan_paths


def test_scanner_rejects_outlet_specific_parser_condition(tmp_path: Path) -> None:
    path = tmp_path / "adapters" / "ownership_parser.py"
    path.parent.mkdir()
    path.write_text('if outlet == "Washington Post":\n    owner = "Bezos"\n', encoding="utf-8")
    violations = scan_paths([tmp_path])
    assert violations and violations[0].reason == "outlet-specific conditional"


def test_scanner_allows_generic_parser(tmp_path: Path) -> None:
    path = tmp_path / "adapters" / "ownership_parser.py"
    path.parent.mkdir()
    path.write_text("if registry_id:\n    candidates.append(registry_id)\n", encoding="utf-8")
    assert scan_paths([tmp_path]) == []


def test_scanner_does_not_false_positive_on_short_alias_inside_ordinary_words(
    tmp_path: Path,
) -> None:
    """ "AP" (Associated Press) is a real alias but must not fire inside "append"/"api"."""
    path = tmp_path / "adapters" / "generic.py"
    path.parent.mkdir()
    path.write_text(
        "def apply(api_client, results):\n    results.append(api_client.fetch())\n",
        encoding="utf-8",
    )
    assert scan_paths([tmp_path]) == []


def test_scanner_covers_the_real_pipeline_surface_regardless_of_filename(tmp_path: Path) -> None:
    """A file with a generic name (no adapter/parser/resolver/extractor/materialize
    in its path) must still be scanned once it's a real evidence-spine pipeline
    module -- this is the path-scoping bypass from issue #12: a fixed
    directory-name heuristic alone missed the actual pipeline files entirely.
    """
    allowlisted_suffix = PIPELINE_ALLOWLIST[0]
    path = tmp_path / allowlisted_suffix
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('if outlet == "Reuters":\n    owner = "unknown"\n', encoding="utf-8")
    violations = scan_paths([tmp_path])
    assert violations and violations[0].reason == "outlet-specific conditional"


def test_scanner_catches_a_name_split_across_a_multiline_literal(tmp_path: Path) -> None:
    """An implicitly-concatenated string split across lines must not evade a
    same-line-only regex (the source has real newlines between the two
    halves of the name, joined only by Python's adjacent-string-literal
    concatenation)."""
    path = tmp_path / "adapters" / "generic.py"
    path.parent.mkdir()
    path.write_text(
        'owner = (\n    "Washington "\n    "Post"\n)\n',
        encoding="utf-8",
    )
    violations = scan_paths([tmp_path])
    assert violations and violations[0].reason == "outlet-specific fact table"


def test_scanner_recognizes_outlet_abbreviations(tmp_path: Path) -> None:
    """Aliases/abbreviations (not just the canonical full name) must be caught."""
    path = tmp_path / "adapters" / "generic.py"
    path.parent.mkdir()
    path.write_text('if outlet_code == "WaPo":\n    owner = "Bezos"\n', encoding="utf-8")
    violations = scan_paths([tmp_path])
    assert violations and violations[0].reason == "outlet-specific conditional"
