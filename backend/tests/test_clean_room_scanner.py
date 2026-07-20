from pathlib import Path
from scripts.check_proof_suite_clean_room import scan_paths


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
