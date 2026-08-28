"""Standards-format builders for evidence proof bundles."""

from __future__ import annotations

import hashlib
import html
import io
import json
import zipfile
from datetime import datetime
from typing import Any, TypedDict, Unpack

BUNDLE_VERSION = "scoop-proof-bundle/2.0"
_ALLOWED_BODS_STATEMENT_TYPES = frozenset(
    {"personStatement", "entityStatement", "ownershipOrControlStatement"}
)


class ProofBundleError(RuntimeError):
    """Raised when a relationship cannot be resolved into a proof bundle."""


class BundleBuildOptions(TypedDict):
    relationship: dict[str, Any]
    subject: dict[str, Any]
    object_entity: dict[str, Any]
    claims: list[dict[str, Any]]
    observations: list[dict[str, Any]]
    snapshots: list[dict[str, Any]]
    documents: list[dict[str, Any]]
    calculation_traces: list[dict[str, Any]]
    as_of: datetime
    known_at: datetime
    generated_at: datetime
    commit_sha: str
    dataset_snapshot: str


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, default=str) + "\n").encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bods_statement_errors(
    statement: object,
    index: int,
    seen: set[str],
) -> list[str]:
    if not isinstance(statement, dict):
        return [f"statement {index} is not an object"]

    errors: list[str] = []
    statement_id = statement.get("statementID")
    if not isinstance(statement_id, str) or not statement_id:
        errors.append(f"statement {index} lacks statementID")
    elif statement_id in seen:
        errors.append(f"duplicate statementID {statement_id}")
    else:
        seen.add(statement_id)

    label = statement_id or index
    if statement.get("statementType") not in _ALLOWED_BODS_STATEMENT_TYPES:
        errors.append(f"statement {label} has unsupported statementType")
    if "source" not in statement:
        errors.append(f"statement {label} lacks source")
    return errors


def validate_bods_shape(document: dict[str, Any]) -> list[str]:
    """Return a list of structural errors in a BODS statements document."""
    statements = document.get("statements")
    if not isinstance(statements, list):
        return ["statements must be a list"]

    seen: set[str] = set()
    errors: list[str] = []
    for index, statement in enumerate(statements):
        errors.extend(_bods_statement_errors(statement, index, seen))
    return errors


def _evidence_sources(options: BundleBuildOptions) -> list[dict[str, Any]]:
    snapshot_by_id = {str(item["id"]): item for item in options["snapshots"]}
    document_by_id = {str(item["id"]): item for item in options["documents"]}
    sources: list[dict[str, Any]] = []
    for observation in options["observations"]:
        snapshot = snapshot_by_id.get(str(observation["snapshot_id"]))
        document = document_by_id.get(str(snapshot["document_id"])) if snapshot else None
        sources.append(
            {
                "observation_id": observation["id"],
                "snapshot_id": snapshot.get("id") if snapshot else None,
                "snapshot_sha256": snapshot.get("sha256_raw") if snapshot else None,
                "document_id": document.get("id") if document else None,
                "document_type": document.get("document_type") if document else None,
                "source_url": document.get("source_url") if document else None,
                "locator": observation.get("locator"),
                "entailment": observation.get("entailment"),
            }
        )
    return sources


def _source_block(
    options: BundleBuildOptions,
    evidence_sources: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "type": ["officialRegister", "officialDocument"],
        "description": "Scoop immutable snapshots and locator-backed observations",
        "retrievedAt": options["generated_at"].isoformat(),
        "assertedBy": [claim.get("asserted_by") for claim in options["claims"]],
        "evidence": evidence_sources,
    }


def _entity_statement(
    entity: dict[str, Any],
    statement_id: str,
    source_block: dict[str, Any],
) -> dict[str, Any]:
    return {
        "statementID": statement_id,
        "statementType": (
            "personStatement" if entity.get("record_kind") == "person" else "entityStatement"
        ),
        "isComponent": False,
        "names": [{"fullName": entity["canonical_name"], "type": "unspecified"}],
        "entityType": {"type": entity.get("record_kind")},
        "source": source_block,
    }


def _share_bounds(qualifiers: dict[str, Any]) -> tuple[Any | None, Any | None]:
    pct_band = qualifiers.get("pct_band")
    if not isinstance(pct_band, dict):
        return None, None
    return pct_band.get("lower"), pct_band.get("upper")


def _relationship_statement(
    relationship: dict[str, Any],
    subject_statement_id: str,
    object_statement_id: str,
    source_block: dict[str, Any],
) -> dict[str, Any]:
    qualifiers = relationship.get("qualifiers", {})
    share_minimum, share_maximum = _share_bounds(qualifiers)
    return {
        "statementID": f"relationship-{relationship['id']}",
        "statementType": "ownershipOrControlStatement",
        "subject": {"describedByEntityStatement": subject_statement_id},
        "interestedParty": {"describedByEntityStatement": object_statement_id},
        "interests": [
            {
                "type": relationship["predicate"],
                "directOrIndirect": "direct" if qualifiers.get("direct") is not False else "indirect",
                "share": qualifiers.get("pct"),
                "shareMinimum": share_minimum,
                "shareMaximum": share_maximum,
                "details": qualifiers,
                "startDate": relationship.get("valid_from"),
                "endDate": relationship.get("valid_to"),
            }
        ],
        "source": source_block,
        "annotations": [
            {
                "motivation": "scoopAcceptancePolicy",
                "description": relationship.get("acceptance_policy_version"),
            }
        ],
    }


def _build_bods(
    options: BundleBuildOptions,
    evidence_sources: list[dict[str, Any]],
) -> dict[str, Any]:
    subject = options["subject"]
    object_entity = options["object_entity"]
    relationship = options["relationship"]
    source_block = _source_block(options, evidence_sources)
    subject_statement_id = f"entity-{subject['id']}"
    object_statement_id = f"entity-{object_entity['id']}"
    bods = {
        "publicationDetails": {
            "publicationDate": options["generated_at"].date().isoformat(),
            "bodsVersion": "0.4",
            "publisher": {"name": "Scoop"},
            "license": "research-output",
        },
        "statements": [
            _entity_statement(subject, subject_statement_id, source_block),
            _entity_statement(object_entity, object_statement_id, source_block),
            _relationship_statement(
                relationship,
                subject_statement_id,
                object_statement_id,
                source_block,
            ),
        ],
    }
    errors = validate_bods_shape(bods)
    if errors:
        raise ProofBundleError("invalid BODS export: " + "; ".join(errors))
    return bods


def _snapshot_prov(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "@id": f"urn:scoop:snapshot:{snapshot['id']}",
        "@type": "prov:Entity",
        "scoop:sha256": snapshot["sha256_raw"],
        "prov:generatedAtTime": snapshot["retrieved_at"],
    }


def _observation_prov(observation: dict[str, Any]) -> dict[str, Any]:
    return {
        "@id": f"urn:scoop:observation:{observation['id']}",
        "@type": "prov:Entity",
        "prov:wasDerivedFrom": {"@id": f"urn:scoop:snapshot:{observation['snapshot_id']}"},
        "scoop:locator": observation.get("locator"),
        "scoop:entailment": observation.get("entailment"),
    }


def _claim_prov(claim: dict[str, Any]) -> dict[str, Any]:
    return {
        "@id": f"urn:scoop:claim:{claim['id']}",
        "@type": "prov:Entity",
        "prov:wasDerivedFrom": [
            {"@id": f"urn:scoop:observation:{observation_id}"}
            for observation_id in claim.get("observation_ids", [])
        ],
        "prov:wasAttributedTo": {
            "@id": f"urn:scoop:agent:{claim.get('asserted_by', 'unknown')}"
        },
    }


def _build_prov(options: BundleBuildOptions) -> dict[str, Any]:
    graph = [_snapshot_prov(item) for item in options["snapshots"]]
    graph.extend(_observation_prov(item) for item in options["observations"])
    graph.extend(_claim_prov(item) for item in options["claims"])
    relationship = options["relationship"]
    graph.append(
        {
            "@id": f"urn:scoop:relationship:{relationship['id']}",
            "@type": "prov:Entity",
            "prov:wasDerivedFrom": [
                {"@id": f"urn:scoop:claim:{claim['id']}"} for claim in options["claims"]
            ],
            "scoop:acceptancePolicy": relationship.get("acceptance_policy_version"),
        }
    )
    return {
        "@context": {
            "prov": "http://www.w3.org/ns/prov#",
            "scoop": "https://example.org/scoop/vocab#",
        },
        "@graph": graph,
    }


def _reproduction(options: BundleBuildOptions) -> dict[str, str]:
    relationship_id = options["relationship"]["id"]
    dataset_snapshot = options["dataset_snapshot"]
    return {
        "commit": options["commit_sha"],
        "dataset_snapshot": dataset_snapshot,
        "command": (
            f"python -m app.proof_suite.runner --relationship {relationship_id} "
            f"--dataset {dataset_snapshot}"
        ),
    }


def _build_proof(
    options: BundleBuildOptions,
    evidence_sources: list[dict[str, Any]],
) -> dict[str, Any]:
    relationship = options["relationship"]
    return {
        "bundle_version": BUNDLE_VERSION,
        "relationship": relationship,
        "conclusion": {
            "subject": options["subject"],
            "predicate": relationship["predicate"],
            "object": options["object_entity"],
            "as_of": options["as_of"].isoformat(),
            "known_at": options["known_at"].isoformat(),
        },
        "claims": options["claims"],
        "observations": options["observations"],
        "evidence_sources": evidence_sources,
        "calculation_traces": options["calculation_traces"],
        "excluded_alternatives": relationship.get("qualifiers", {}).get(
            "excluded_alternatives", []
        ),
        "reproduction": _reproduction(options),
    }


def _report_row(source: dict[str, Any]) -> str:
    document_type = html.escape(str(source.get("document_type") or "document"))
    snapshot_hash = html.escape(str(source.get("snapshot_sha256") or ""))
    locator = html.escape(json.dumps(source.get("locator"), sort_keys=True))
    entailment = html.escape(str(source.get("entailment") or ""))
    return (
        f"<tr><td>{document_type}</td><td><code>{snapshot_hash}</code></td>"
        f"<td><code>{locator}</code></td><td>{entailment}</td></tr>"
    )


def _human_report(
    options: BundleBuildOptions,
    evidence_sources: list[dict[str, Any]],
    proof: dict[str, Any],
) -> bytes:
    relationship = options["relationship"]
    subject = html.escape(str(options["subject"]["canonical_name"]))
    predicate = html.escape(str(relationship["predicate"]))
    object_name = html.escape(str(options["object_entity"]["canonical_name"]))
    rows = "".join(_report_row(source) for source in evidence_sources)
    return (
        "<!doctype html><html><head><meta charset='utf-8'><title>Scoop proof</title>"
        "<style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 24px;}"
        "table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;"
        "vertical-align:top}code{font-size:12px;word-break:break-all}</style></head><body>"
        f"<h1>{subject} {predicate} {object_name}</h1>"
        f"<p><strong>As of:</strong> {html.escape(options['as_of'].isoformat())}</p>"
        f"<p><strong>Known at:</strong> {html.escape(options['known_at'].isoformat())}</p>"
        f"<p><strong>Acceptance policy:</strong> {html.escape(str(relationship.get('acceptance_policy_version')))}</p>"
        f"<p><strong>Claims:</strong> {len(options['claims'])}; "
        f"<strong>observations:</strong> {len(options['observations'])}; "
        f"<strong>snapshots:</strong> {len(options['snapshots'])}.</p>"
        "<h2>Evidence chain</h2><table><thead><tr><th>Document</th><th>Snapshot hash</th>"
        f"<th>Locator</th><th>Entailment</th></tr></thead><tbody>{rows}</tbody></table>"
        "<h2>Reproduction</h2><pre>"
        f"{html.escape(proof['reproduction']['command'])}</pre></body></html>"
    ).encode("utf-8")


def _base_files(
    options: BundleBuildOptions,
    evidence_sources: list[dict[str, Any]],
    bods: dict[str, Any],
    prov: dict[str, Any],
    proof: dict[str, Any],
) -> dict[str, bytes]:
    return {
        "proof.json": _json_bytes(proof),
        "bods.json": _json_bytes(bods),
        "prov.jsonld": _json_bytes(prov),
        "calculation-trace/index.json": _json_bytes(options["calculation_traces"]),
        "snapshots/index.json": _json_bytes(options["snapshots"]),
        "observations/index.json": _json_bytes(options["observations"]),
        "claims/index.json": _json_bytes(options["claims"]),
        "human-readable-report.html": _human_report(options, evidence_sources, proof),
    }


def _manifest(options: BundleBuildOptions, files: dict[str, bytes]) -> dict[str, Any]:
    return {
        "bundle_version": BUNDLE_VERSION,
        "relationship_id": options["relationship"]["id"],
        "generated_at": options["generated_at"].isoformat(),
        "as_of": options["as_of"].isoformat(),
        "known_at": options["known_at"].isoformat(),
        "commit_sha": options["commit_sha"],
        "dataset_snapshot": options["dataset_snapshot"],
        "claim_ids": [item["id"] for item in options["claims"]],
        "observation_ids": [item["id"] for item in options["observations"]],
        "snapshot_hashes": [item["sha256_raw"] for item in options["snapshots"]],
        "calculation_trace_ids": [item["id"] for item in options["calculation_traces"]],
        "files": {name: _sha256(content) for name, content in files.items()},
    }


def _ro_crate(options: BundleBuildOptions, files: dict[str, bytes]) -> dict[str, Any]:
    graph = [
        {
            "@id": "ro-crate-metadata.json",
            "@type": "CreativeWork",
            "about": {"@id": "./"},
            "conformsTo": {"@id": "https://w3id.org/ro/crate/1.1"},
        },
        {
            "@id": "./",
            "@type": "Dataset",
            "name": f"Scoop proof {options['relationship']['id']}",
            "datePublished": options["generated_at"].isoformat(),
            "hasPart": [{"@id": name} for name in sorted(files)],
        },
    ]
    graph.extend(
        {
            "@id": name,
            "@type": "File",
            "sha256": _sha256(content),
            "contentSize": len(content),
        }
        for name, content in sorted(files.items())
    )
    return {"@context": "https://w3id.org/ro/crate/1.1/context", "@graph": graph}


def build_bundle_files(**options: Unpack[BundleBuildOptions]) -> dict[str, bytes]:
    """Build every file in a proof bundle (BODS, PROV-O, RO-Crate, manifest, report)."""
    evidence_sources = _evidence_sources(options)
    bods = _build_bods(options, evidence_sources)
    prov = _build_prov(options)
    proof = _build_proof(options, evidence_sources)
    files = _base_files(options, evidence_sources, bods, prov, proof)
    files["manifest.json"] = _json_bytes(_manifest(options, files))
    files["ro-crate-metadata.json"] = _json_bytes(_ro_crate(options, files))
    return files


def zip_bundle(files: dict[str, bytes]) -> bytes:
    """Deterministically zip a proof bundle's files (fixed timestamps, sorted order)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name)
            info.date_time = (1980, 1, 1, 0, 0, 0)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, files[name])
    return buffer.getvalue()
