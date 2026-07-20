import io
import json
import zipfile
from datetime import UTC, datetime
from app.services.evidence_export import build_bundle_files, validate_bods_shape, zip_bundle


def test_proof_bundle_contains_required_research_objects() -> None:
    now = datetime(2026, 7, 20, tzinfo=UTC)
    files = build_bundle_files(
        relationship={
            "id": "rel-1",
            "predicate": "directly_owns",
            "qualifiers": {"direct": True, "pct": 100},
            "acceptance_policy_version": "evidence-policy/2.0",
            "valid_from": None,
            "valid_to": None,
        },
        subject={"id": "pub", "record_kind": "publication", "canonical_name": "Example News"},
        object_entity={"id": "co", "record_kind": "legal_entity", "canonical_name": "Example LLC"},
        claims=[{"id": "claim-1", "asserted_by": "parser/v1", "observation_ids": ["obs-1"]}],
        observations=[
            {
                "id": "obs-1",
                "snapshot_id": "snap-1",
                "locator": {"page": 1},
                "entailment": "reviewed_yes",
            }
        ],
        snapshots=[
            {
                "id": "snap-1",
                "document_id": "doc-1",
                "sha256_raw": "a" * 64,
                "retrieved_at": now.isoformat(),
            }
        ],
        documents=[
            {
                "id": "doc-1",
                "document_type": "registry_filing",
                "source_url": "https://example.test/filing",
            }
        ],
        calculation_traces=[],
        as_of=now,
        known_at=now,
        generated_at=now,
        commit_sha="abc",
        dataset_snapshot="dataset-1",
    )
    required = {
        "proof.json",
        "manifest.json",
        "bods.json",
        "prov.jsonld",
        "ro-crate-metadata.json",
        "human-readable-report.html",
    }
    assert required <= set(files)
    assert validate_bods_shape(json.loads(files["bods.json"])) == []
    with zipfile.ZipFile(io.BytesIO(zip_bundle(files))) as bundle:
        assert required <= set(bundle.namelist())
