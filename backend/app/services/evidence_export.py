from __future__ import annotations
import hashlib
import html
import io
import json
import zipfile
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any, cast
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.evidence import AcceptedRelationship, CalculationTrace, ClaimEvidence, DocumentSnapshot, EvidenceClaim, EvidenceDocument, EvidenceEntity, EvidenceObservation, RelationshipClaim
BUNDLE_VERSION = 'scoop-proof-bundle/2.0'

class ProofBundleError(RuntimeError):
    pass

def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, default=str) + '\n').encode('utf-8')

def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def validate_bods_shape(document: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    statements = document.get('statements')
    if not isinstance(statements, list):
        return ['statements must be a list']
    seen: set[str] = set()
    for index, statement in enumerate(statements):
        if not isinstance(statement, dict):
            errors.append(f'statement {index} is not an object')
            continue
        statement_id = statement.get('statementID')
        if not isinstance(statement_id, str) or not statement_id:
            errors.append(f'statement {index} lacks statementID')
        elif statement_id in seen:
            errors.append(f'duplicate statementID {statement_id}')
        else:
            seen.add(statement_id)
        if statement.get('statementType') not in {'personStatement', 'entityStatement', 'ownershipOrControlStatement'}:
            errors.append(f'statement {statement_id or index} has unsupported statementType')
        if 'source' not in statement:
            errors.append(f'statement {statement_id or index} lacks source')
    return errors

def build_bundle_files(*, relationship: dict[str, Any], subject: dict[str, Any], object_entity: dict[str, Any], claims: list[dict[str, Any]], observations: list[dict[str, Any]], snapshots: list[dict[str, Any]], documents: list[dict[str, Any]], calculation_traces: list[dict[str, Any]], as_of: datetime, known_at: datetime, generated_at: datetime, commit_sha: str, dataset_snapshot: str) -> dict[str, bytes]:
    snapshot_by_id = {str(item['id']): item for item in snapshots}
    document_by_id = {str(item['id']): item for item in documents}
    evidence_sources: list[dict[str, Any]] = []
    for observation in observations:
        snapshot = snapshot_by_id.get(str(observation['snapshot_id']))
        document = document_by_id.get(str(snapshot['document_id'])) if snapshot else None
        evidence_sources.append({'observation_id': observation['id'], 'snapshot_id': snapshot.get('id') if snapshot else None, 'snapshot_sha256': snapshot.get('sha256_raw') if snapshot else None, 'document_id': document.get('id') if document else None, 'document_type': document.get('document_type') if document else None, 'source_url': document.get('source_url') if document else None, 'locator': observation.get('locator'), 'entailment': observation.get('entailment')})
    subject_statement_id = f"entity-{subject['id']}"
    object_statement_id = f"entity-{object_entity['id']}"
    relation_statement_id = f"relationship-{relationship['id']}"
    source_block = {'type': ['officialRegister', 'officialDocument'], 'description': 'Scoop immutable snapshots and locator-backed observations', 'retrievedAt': generated_at.isoformat(), 'assertedBy': [claim.get('asserted_by') for claim in claims], 'evidence': evidence_sources}
    bods = {'publicationDetails': {'publicationDate': generated_at.date().isoformat(), 'bodsVersion': '0.4', 'publisher': {'name': 'Scoop'}, 'license': 'research-output'}, 'statements': [{'statementID': subject_statement_id, 'statementType': 'personStatement' if subject.get('record_kind') == 'person' else 'entityStatement', 'isComponent': False, 'names': [{'fullName': subject['canonical_name'], 'type': 'unspecified'}], 'entityType': {'type': subject.get('record_kind')}, 'source': source_block}, {'statementID': object_statement_id, 'statementType': 'personStatement' if object_entity.get('record_kind') == 'person' else 'entityStatement', 'isComponent': False, 'names': [{'fullName': object_entity['canonical_name'], 'type': 'unspecified'}], 'entityType': {'type': object_entity.get('record_kind')}, 'source': source_block}, {'statementID': relation_statement_id, 'statementType': 'ownershipOrControlStatement', 'subject': {'describedByEntityStatement': subject_statement_id}, 'interestedParty': {'describedByEntityStatement': object_statement_id}, 'interests': [{'type': relationship['predicate'], 'directOrIndirect': 'direct' if relationship.get('qualifiers', {}).get('direct') is not False else 'indirect', 'share': relationship.get('qualifiers', {}).get('pct'), 'shareMinimum': relationship.get('qualifiers', {}).get('pct_band', {}).get('lower') if isinstance(relationship.get('qualifiers', {}).get('pct_band'), dict) else None, 'shareMaximum': relationship.get('qualifiers', {}).get('pct_band', {}).get('upper') if isinstance(relationship.get('qualifiers', {}).get('pct_band'), dict) else None, 'details': relationship.get('qualifiers', {}), 'startDate': relationship.get('valid_from'), 'endDate': relationship.get('valid_to')}], 'source': source_block, 'annotations': [{'motivation': 'scoopAcceptancePolicy', 'description': relationship.get('acceptance_policy_version')}]}]}
    bods_errors = validate_bods_shape(bods)
    if bods_errors:
        raise ProofBundleError('invalid BODS export: ' + '; '.join(bods_errors))
    prov_graph: list[dict[str, Any]] = []
    for snapshot in snapshots:
        prov_graph.append({'@id': f"urn:scoop:snapshot:{snapshot['id']}", '@type': 'prov:Entity', 'scoop:sha256': snapshot['sha256_raw'], 'prov:generatedAtTime': snapshot['retrieved_at']})
    for observation in observations:
        prov_graph.append({'@id': f"urn:scoop:observation:{observation['id']}", '@type': 'prov:Entity', 'prov:wasDerivedFrom': {'@id': f"urn:scoop:snapshot:{observation['snapshot_id']}"}, 'scoop:locator': observation.get('locator'), 'scoop:entailment': observation.get('entailment')})
    for claim in claims:
        observation_ids = claim.get('observation_ids', [])
        prov_graph.append({'@id': f"urn:scoop:claim:{claim['id']}", '@type': 'prov:Entity', 'prov:wasDerivedFrom': [{'@id': f'urn:scoop:observation:{observation_id}'} for observation_id in observation_ids], 'prov:wasAttributedTo': {'@id': f"urn:scoop:agent:{claim.get('asserted_by', 'unknown')}"}})
    prov_graph.append({'@id': f"urn:scoop:relationship:{relationship['id']}", '@type': 'prov:Entity', 'prov:wasDerivedFrom': [{'@id': f"urn:scoop:claim:{claim['id']}"} for claim in claims], 'scoop:acceptancePolicy': relationship.get('acceptance_policy_version')})
    prov = {'@context': {'prov': 'http://www.w3.org/ns/prov#', 'scoop': 'https://example.org/scoop/vocab#'}, '@graph': prov_graph}
    proof = {'bundle_version': BUNDLE_VERSION, 'relationship': relationship, 'conclusion': {'subject': subject, 'predicate': relationship['predicate'], 'object': object_entity, 'as_of': as_of.isoformat(), 'known_at': known_at.isoformat()}, 'claims': claims, 'observations': observations, 'evidence_sources': evidence_sources, 'calculation_traces': calculation_traces, 'excluded_alternatives': relationship.get('qualifiers', {}).get('excluded_alternatives', []), 'reproduction': {'commit': commit_sha, 'dataset_snapshot': dataset_snapshot, 'command': f"python -m app.proof_suite.runner --relationship {relationship['id']} --dataset {dataset_snapshot}"}}
    rows = [f"<tr><td>{html.escape(str(source.get('document_type') or 'document'))}</td><td><code>{html.escape(str(source.get('snapshot_sha256') or ''))}</code></td><td><code>{html.escape(json.dumps(source.get('locator'), sort_keys=True))}</code></td><td>{html.escape(str(source.get('entailment') or ''))}</td></tr>" for source in evidence_sources]
    human_report = (f"<!doctype html><html><head><meta charset='utf-8'><title>Scoop proof</title><style>body{{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 24px;}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #bbb;padding:8px;vertical-align:top}}code{{font-size:12px;word-break:break-all}}</style></head><body><h1>{html.escape(str(subject['canonical_name']))} {html.escape(str(relationship['predicate']))} {html.escape(str(object_entity['canonical_name']))}</h1><p><strong>As of:</strong> {html.escape(as_of.isoformat())}</p><p><strong>Known at:</strong> {html.escape(known_at.isoformat())}</p><p><strong>Acceptance policy:</strong> {html.escape(str(relationship.get('acceptance_policy_version')))}</p><p><strong>Claims:</strong> {len(claims)}; <strong>observations:</strong> {len(observations)}; <strong>snapshots:</strong> {len(snapshots)}.</p><h2>Evidence chain</h2><table><thead><tr><th>Document</th><th>Snapshot hash</th><th>Locator</th><th>Entailment</th></tr></thead><tbody>" + ''.join(rows) + '</tbody></table><h2>Reproduction</h2><pre>' + html.escape(proof['reproduction']['command']) + '</pre></body></html>').encode('utf-8')
    files: dict[str, bytes] = {'proof.json': _json_bytes(proof), 'bods.json': _json_bytes(bods), 'prov.jsonld': _json_bytes(prov), 'calculation-trace/index.json': _json_bytes(calculation_traces), 'snapshots/index.json': _json_bytes(snapshots), 'observations/index.json': _json_bytes(observations), 'claims/index.json': _json_bytes(claims), 'human-readable-report.html': human_report}
    manifest = {'bundle_version': BUNDLE_VERSION, 'relationship_id': relationship['id'], 'generated_at': generated_at.isoformat(), 'as_of': as_of.isoformat(), 'known_at': known_at.isoformat(), 'commit_sha': commit_sha, 'dataset_snapshot': dataset_snapshot, 'claim_ids': [item['id'] for item in claims], 'observation_ids': [item['id'] for item in observations], 'snapshot_hashes': [item['sha256_raw'] for item in snapshots], 'calculation_trace_ids': [item['id'] for item in calculation_traces], 'files': {name: _sha256(content) for name, content in files.items()}}
    files['manifest.json'] = _json_bytes(manifest)
    crate_graph = [{'@id': 'ro-crate-metadata.json', '@type': 'CreativeWork', 'about': {'@id': './'}, 'conformsTo': {'@id': 'https://w3id.org/ro/crate/1.1'}}, {'@id': './', '@type': 'Dataset', 'name': f"Scoop proof {relationship['id']}", 'datePublished': generated_at.isoformat(), 'hasPart': [{'@id': name} for name in sorted(files)]}]
    for name, content in sorted(files.items()):
        crate_graph.append({'@id': name, '@type': 'File', 'sha256': _sha256(content), 'contentSize': len(content)})
    files['ro-crate-metadata.json'] = _json_bytes({'@context': 'https://w3id.org/ro/crate/1.1/context', '@graph': crate_graph})
    return files

def zip_bundle(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name)
            info.date_time = (1980, 1, 1, 0, 0, 0)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, files[name])
    return buffer.getvalue()

async def build_relationship_proof_bundle(db: AsyncSession, relationship_id: str, *, as_of: datetime, known_at: datetime, commit_sha: str, dataset_snapshot: str) -> bytes:
    relationship = await db.get(AcceptedRelationship, relationship_id)
    if relationship is None:
        raise ProofBundleError('relationship not found')
    subject = await db.get(EvidenceEntity, relationship.subject_entity_id)
    object_entity = await db.get(EvidenceEntity, relationship.object_entity_id)
    if subject is None or object_entity is None:
        raise ProofBundleError('relationship endpoints do not resolve')
    links = list((await db.execute(select(RelationshipClaim).where(RelationshipClaim.relationship_id == relationship_id))).scalars().all())
    claim_ids = [cast(str, link.claim_id) for link in links]
    claim_rows = list((await db.execute(select(EvidenceClaim).where(EvidenceClaim.id.in_(claim_ids)))).scalars().all()) if claim_ids else []
    evidence_links = list((await db.execute(select(ClaimEvidence).where(ClaimEvidence.claim_id.in_(claim_ids)))).scalars().all()) if claim_ids else []
    observation_ids = [cast(str, link.observation_id) for link in evidence_links]
    observation_rows = list((await db.execute(select(EvidenceObservation).where(EvidenceObservation.id.in_(observation_ids)))).scalars().all()) if observation_ids else []
    snapshot_ids = [cast(str, row.snapshot_id) for row in observation_rows]
    snapshot_rows = list((await db.execute(select(DocumentSnapshot).where(DocumentSnapshot.id.in_(snapshot_ids)))).scalars().all()) if snapshot_ids else []
    document_ids = [cast(str, row.document_id) for row in snapshot_rows]
    document_rows = list((await db.execute(select(EvidenceDocument).where(EvidenceDocument.id.in_(document_ids)))).scalars().all()) if document_ids else []
    trace_rows = list((await db.execute(select(CalculationTrace).where(CalculationTrace.relationship_id == relationship_id))).scalars().all())
    observation_ids_by_claim: dict[str, list[str]] = defaultdict(list)
    for link in evidence_links:
        observation_ids_by_claim[cast(str, link.claim_id)].append(cast(str, link.observation_id))
    files = build_bundle_files(relationship={'id': relationship_id, 'subject_entity_id': relationship.subject_entity_id, 'predicate': relationship.predicate, 'object_entity_id': relationship.object_entity_id, 'qualifiers': relationship.qualifiers or {}, 'valid_from': relationship.valid_from.isoformat() if relationship.valid_from else None, 'valid_to': relationship.valid_to.isoformat() if relationship.valid_to else None, 'recorded_at': relationship.recorded_at.isoformat(), 'retracted_at': relationship.retracted_at.isoformat() if relationship.retracted_at else None, 'acceptance_policy_version': relationship.acceptance_policy_version, 'status': relationship.status}, subject={'id': subject.id, 'record_kind': subject.record_kind, 'canonical_name': subject.canonical_name}, object_entity={'id': object_entity.id, 'record_kind': object_entity.record_kind, 'canonical_name': object_entity.canonical_name}, claims=[{'id': row.id, 'subject_entity_id': row.subject_entity_id, 'predicate': row.predicate, 'object_entity_id': row.object_entity_id, 'object_value': row.object_value, 'qualifiers': row.qualifiers or {}, 'valid_from': row.valid_from.isoformat() if row.valid_from else None, 'valid_to': row.valid_to.isoformat() if row.valid_to else None, 'recorded_at': row.recorded_at.isoformat(), 'retracted_at': row.retracted_at.isoformat() if row.retracted_at else None, 'asserted_by': row.asserted_by, 'evidence_class': row.evidence_class, 'status': row.status, 'method_version': row.method_version, 'observation_ids': sorted(observation_ids_by_claim.get(cast(str, row.id), []))} for row in claim_rows], observations=[{'id': row.id, 'snapshot_id': row.snapshot_id, 'locator': row.locator, 'quoted_text': row.quoted_text, 'structured_value': row.structured_value, 'context_before': row.context_before, 'context_after': row.context_after, 'extractor': row.extractor, 'extractor_version': row.extractor_version, 'ocr_confidence': row.ocr_confidence, 'entailment': row.entailment} for row in observation_rows], snapshots=[{'id': row.id, 'document_id': row.document_id, 'sha256_raw': row.sha256_raw, 'storage_path': row.storage_path, 'retrieved_at': row.retrieved_at.isoformat(), 'sha256_canonical_text': row.sha256_canonical_text, 'extraction_tool': row.extraction_tool, 'extraction_version': row.extraction_version} for row in snapshot_rows], documents=[{'id': row.id, 'source_url': row.source_url, 'document_type': row.document_type, 'title': row.title, 'published_at': row.published_at.isoformat() if row.published_at else None, 'source_class': row.source_class} for row in document_rows], calculation_traces=[{'id': row.id, 'measurement_name': row.measurement_name, 'input_claim_ids': row.input_claim_ids, 'subgraph': row.subgraph, 'algorithm_version': row.algorithm_version, 'result': row.result, 'created_at': row.created_at.isoformat()} for row in trace_rows], as_of=as_of, known_at=known_at, generated_at=datetime.now(UTC), commit_sha=commit_sha, dataset_snapshot=dataset_snapshot)
    return zip_bundle(files)
