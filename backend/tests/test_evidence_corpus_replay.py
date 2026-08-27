"""Evidence replay fails closed until captures and reviews exist."""

import json

import pytest

from app.scripts.replay_evidence_corpus import (
    DEFAULT_CORPUS,
    CorpusReplayError,
    replay_corpus,
    validate_corpus,
)


def test_default_corpus_manifest_exists():
    assert (DEFAULT_CORPUS / "manifest.json").is_file()


def test_replay_rejects_unreviewed_or_captureless_case(tmp_path):
    manifest = {
        "network_access": False,
        "cases": [
            {
                "case_id": case_id,
                "captures": [],
                "expectations": [],
                "review": {"status": "pending"},
            }
            for case_id in (
                "washington-post",
                "new-york-times",
                "wall-street-journal",
                "reuters",
                "fox-news",
                "financial-times",
                "guardian",
                "bbc",
                "associated-press",
                "npr",
                "politico",
                "economist",
                "philadelphia-inquirer",
                "tampa-bay-times",
                "usa-today-rename",
                "nbc-news",
                "msnbc-versant",
                "abc-news",
                "cnn",
                "sinclair",
            )
        ],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(CorpusReplayError, match="no immutable captures"):
        validate_corpus(tmp_path)


def test_default_corpus_has_pinned_inputs_and_is_blocked_only_on_review() -> None:
    manifest = json.loads((DEFAULT_CORPUS / "manifest.json").read_text(encoding="utf-8"))
    assert len(manifest["cases"]) == 20
    assert all(case["captures"] for case in manifest["cases"])
    assert all(case["expectations"] for case in manifest["cases"])
    assert all(case["records"] for case in manifest["cases"])
    with pytest.raises(CorpusReplayError, match="independent reviewer signoff missing") as error:
        validate_corpus(DEFAULT_CORPUS)
    assert "no immutable captures" not in str(error.value)
    assert "reviewed expectations missing" not in str(error.value)


def test_replay_engine_uses_disposable_postgres_and_exercises_dossier(monkeypatch) -> None:
    manifest = json.loads((DEFAULT_CORPUS / "manifest.json").read_text(encoding="utf-8"))
    for case in manifest["cases"]:
        # This identity is scoped to engine verification and is never written
        # to the release manifest or represented as an independent review.
        case["review"]["reviewer"] = "automated-replay-engine-test"
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://invalid/never_connect")

    report = replay_corpus(manifest, DEFAULT_CORPUS)

    assert report["status"] == "passed"
    assert report["database"] == "disposable_postgresql"
    assert report["migrations"] == "head"
    assert report["case_count"] == 20
    assert report["network_access"] is False
    assert report["dossier_api_exercised"] is True
    assert report["counts"] == manifest["expected_counts"]
    assert all(not case["rejection_reasons"] for case in report["cases"])
    assert all(case["claim_bundle"] for case in report["cases"])
