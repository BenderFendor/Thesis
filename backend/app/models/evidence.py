from __future__ import annotations
from app.database import Base, get_utc_now
from sqlalchemy import JSON, Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint

class EvidenceEntity(Base):
    __tablename__ = 'evidence_entities'
    id = Column(String(64), primary_key=True)
    record_kind = Column(String(64), nullable=False, index=True)
    canonical_name = Column(Text, nullable=False, index=True)
    status = Column(String(32), nullable=False, default='candidate', index=True)
    privacy_scope = Column(String(32), nullable=False, default='public')
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    updated_at = Column(DateTime, nullable=False, default=get_utc_now, onupdate=get_utc_now)
    __table_args__ = (CheckConstraint("record_kind IN ('person','legal_entity','organization_without_legal_identity','publication','digital_property','feed','article','raw_byline')", name='ck_evidence_entities_record_kind'), CheckConstraint("status IN ('candidate','accepted','rejected','merged')", name='ck_evidence_entities_status'))

class EntityExternalId(Base):
    __tablename__ = 'entity_external_ids'
    id = Column(Integer, primary_key=True)
    entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='CASCADE'), nullable=False, index=True)
    scheme = Column(String(64), nullable=False)
    value = Column(String(255), nullable=False)
    source_claim_id = Column(String(64), nullable=True, index=True)
    merge_authority = Column(String(32), nullable=False, default='candidate_only')
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (UniqueConstraint('scheme', 'value', name='uq_entity_external_ids_scheme_value'), Index('ix_entity_external_ids_entity_scheme', 'entity_id', 'scheme'))

class EntityResolution(Base):
    __tablename__ = 'entity_resolutions'
    id = Column(String(64), primary_key=True)
    left_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='CASCADE'), nullable=False, index=True)
    right_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='CASCADE'), nullable=False, index=True)
    decision = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, default='candidate', index=True)
    basis_claim_id = Column(String(64), nullable=True, index=True)
    decided_by = Column(String(255), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (CheckConstraint('left_entity_id <> right_entity_id', name='ck_entity_resolution_distinct'), UniqueConstraint('left_entity_id', 'right_entity_id', 'decision', name='uq_entity_resolution_pair_decision'))

class EvidenceDocument(Base):
    __tablename__ = 'evidence_documents'
    id = Column(String(64), primary_key=True)
    source_url = Column(Text, nullable=False, index=True)
    document_type = Column(String(64), nullable=False, index=True)
    title = Column(Text, nullable=True)
    issuer_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='SET NULL'), nullable=True, index=True)
    published_at = Column(DateTime, nullable=True, index=True)
    jurisdiction = Column(String(32), nullable=True, index=True)
    source_class = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

class DocumentSnapshot(Base):
    __tablename__ = 'document_snapshots'
    id = Column(String(64), primary_key=True)
    document_id = Column(String(64), ForeignKey('evidence_documents.id', ondelete='CASCADE'), nullable=False, index=True)
    sha256_raw = Column(String(64), nullable=False, unique=True, index=True)
    storage_path = Column(Text, nullable=False)
    retrieved_at = Column(DateTime, nullable=False, index=True)
    http_status = Column(Integer, nullable=True)
    content_type = Column(String(255), nullable=True)
    charset = Column(String(64), nullable=True)
    sha256_canonical_text = Column(String(64), nullable=True, index=True)
    extracted_text_path = Column(Text, nullable=True)
    extraction_tool = Column(String(128), nullable=True)
    extraction_version = Column(String(64), nullable=True)
    ocr_confidence = Column(Float, nullable=True)
    language = Column(String(32), nullable=True)
    retriever = Column(String(128), nullable=False)
    retriever_version = Column(String(64), nullable=False)
    response_headers = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

class ArchiveRequest(Base):
    __tablename__ = 'archive_requests'
    id = Column(Integer, primary_key=True)
    snapshot_id = Column(String(64), ForeignKey('document_snapshots.id', ondelete='CASCADE'), nullable=False, index=True)
    service = Column(String(64), nullable=False)
    requested_at = Column(DateTime, nullable=False, default=get_utc_now)
    result_url = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default='queued', index=True)
    error = Column(Text, nullable=True)

class EvidenceObservation(Base):
    __tablename__ = 'evidence_observations'
    id = Column(String(64), primary_key=True)
    snapshot_id = Column(String(64), ForeignKey('document_snapshots.id', ondelete='CASCADE'), nullable=False, index=True)
    locator = Column(JSON, nullable=False)
    quoted_text = Column(Text, nullable=True)
    context_before = Column(Text, nullable=True)
    context_after = Column(Text, nullable=True)
    structured_value = Column(JSON, nullable=True)
    canonical_text_hash = Column(String(64), nullable=True, index=True)
    extractor = Column(String(128), nullable=False)
    extractor_version = Column(String(64), nullable=False)
    ocr_confidence = Column(Float, nullable=True)
    entailment = Column(String(32), nullable=False, default='unevaluated', index=True)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (CheckConstraint('quoted_text IS NOT NULL OR structured_value IS NOT NULL', name='ck_evidence_observation_content'),)

class EvidenceClaim(Base):
    __tablename__ = 'evidence_claims'
    id = Column(String(64), primary_key=True)
    subject_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='CASCADE'), nullable=False, index=True)
    predicate = Column(String(96), nullable=False, index=True)
    object_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='SET NULL'), nullable=True, index=True)
    object_value = Column(JSON, nullable=True)
    qualifiers = Column(JSON, nullable=False, default=dict)
    valid_from = Column(DateTime, nullable=True, index=True)
    valid_to = Column(DateTime, nullable=True, index=True)
    date_precision = Column(String(32), nullable=True)
    recorded_at = Column(DateTime, nullable=False, default=get_utc_now, index=True)
    retracted_at = Column(DateTime, nullable=True, index=True)
    asserted_by = Column(String(255), nullable=False)
    evidence_class = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, default='candidate', index=True)
    superseded_by = Column(String(64), nullable=True, index=True)
    method_version = Column(String(64), nullable=False)
    claim_hash = Column(String(64), nullable=False, unique=True, index=True)
    __table_args__ = (CheckConstraint('object_entity_id IS NOT NULL OR object_value IS NOT NULL', name='ck_evidence_claim_object'), CheckConstraint('valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from', name='ck_evidence_claim_valid_range'), Index('ix_evidence_claims_subject_predicate_current', 'subject_entity_id', 'predicate', 'retracted_at'))

class ClaimEvidence(Base):
    __tablename__ = 'claim_evidence_links'
    claim_id = Column(String(64), ForeignKey('evidence_claims.id', ondelete='CASCADE'), primary_key=True)
    observation_id = Column(String(64), ForeignKey('evidence_observations.id', ondelete='CASCADE'), primary_key=True)
    role = Column(String(32), nullable=False, default='supporting')
    reviewer = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

class AcceptedRelationship(Base):
    __tablename__ = 'accepted_relationships'
    id = Column(String(64), primary_key=True)
    subject_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='CASCADE'), nullable=False, index=True)
    predicate = Column(String(96), nullable=False, index=True)
    object_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='CASCADE'), nullable=False, index=True)
    qualifiers = Column(JSON, nullable=False, default=dict)
    valid_from = Column(DateTime, nullable=True, index=True)
    valid_to = Column(DateTime, nullable=True, index=True)
    recorded_at = Column(DateTime, nullable=False, default=get_utc_now, index=True)
    retracted_at = Column(DateTime, nullable=True, index=True)
    materialized_at = Column(DateTime, nullable=False, default=get_utc_now)
    acceptance_policy_version = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False, default='accepted', index=True)
    relationship_hash = Column(String(64), nullable=False, unique=True, index=True)
    __table_args__ = (CheckConstraint('valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from', name='ck_accepted_relationship_valid_range'), Index('ix_accepted_relationships_asof', 'subject_entity_id', 'predicate', 'valid_from', 'valid_to'))

class RelationshipClaim(Base):
    __tablename__ = 'relationship_claim_links'
    relationship_id = Column(String(64), ForeignKey('accepted_relationships.id', ondelete='CASCADE'), primary_key=True)
    claim_id = Column(String(64), ForeignKey('evidence_claims.id', ondelete='RESTRICT'), primary_key=True)
    derivation_role = Column(String(32), nullable=False, default='supporting')
    added_at = Column(DateTime, nullable=False, default=get_utc_now)

class SourceLineage(Base):
    __tablename__ = 'source_lineage'
    id = Column(Integer, primary_key=True)
    parent_document_id = Column(String(64), ForeignKey('evidence_documents.id', ondelete='CASCADE'), nullable=False, index=True)
    child_document_id = Column(String(64), ForeignKey('evidence_documents.id', ondelete='CASCADE'), nullable=False, index=True)
    relation = Column(String(32), nullable=False)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (CheckConstraint('parent_document_id <> child_document_id', name='ck_source_lineage_distinct'), UniqueConstraint('parent_document_id', 'child_document_id', 'relation', name='uq_source_lineage_edge'))

class AdjudicationItem(Base):
    __tablename__ = 'adjudication_items'
    id = Column(String(64), primary_key=True)
    item_type = Column(String(64), nullable=False, index=True)
    claim_ids = Column(JSON, nullable=False, default=list)
    entity_ids = Column(JSON, nullable=False, default=list)
    normalized_dimensions = Column(JSON, nullable=False, default=dict)
    reason = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default='open', index=True)
    assigned_to = Column(String(255), nullable=True)
    resolution = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    resolved_at = Column(DateTime, nullable=True)

class CalculationTrace(Base):
    __tablename__ = 'calculation_traces'
    id = Column(String(64), primary_key=True)
    relationship_id = Column(String(64), ForeignKey('accepted_relationships.id', ondelete='SET NULL'), nullable=True, index=True)
    measurement_name = Column(String(96), nullable=False, index=True)
    input_claim_ids = Column(JSON, nullable=False, default=list)
    subgraph = Column(JSON, nullable=False)
    algorithm_version = Column(String(64), nullable=False)
    result = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

class EvidencePolicyRow(Base):
    __tablename__ = 'evidence_policy_rows'
    id = Column(Integer, primary_key=True)
    predicate = Column(String(96), nullable=False, index=True)
    version = Column(String(64), nullable=False)
    allowed_evidence_classes = Column(JSON, nullable=False, default=list)
    minimum_independent_roots = Column(Integer, nullable=False, default=1)
    requires_complete_path = Column(Boolean, nullable=False, default=False)
    permits_catalog_only = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (UniqueConstraint('predicate', 'version', name='uq_evidence_policy_predicate_version'),)

class ExternalMaterialEvent(Base):
    __tablename__ = 'external_material_events'
    id = Column(String(64), primary_key=True)
    registry = Column(String(64), nullable=False, index=True)
    external_id = Column(String(255), nullable=False)
    event_type = Column(String(96), nullable=False, index=True)
    subject_entity_id = Column(String(64), ForeignKey('evidence_entities.id', ondelete='SET NULL'), nullable=True, index=True)
    occurred_at = Column(DateTime, nullable=True, index=True)
    announced_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(32), nullable=False, default='recorded', index=True)
    coverage_independence = Column(String(32), nullable=False)
    source_claim_id = Column(String(64), ForeignKey('evidence_claims.id', ondelete='SET NULL'), nullable=True, index=True)
    event_metadata = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (UniqueConstraint('registry', 'external_id', name='uq_external_event_registry_id'),)

class Preregistration(Base):
    __tablename__ = 'preregistrations'
    id = Column(String(64), primary_key=True)
    title = Column(Text, nullable=False)
    canonical_hash = Column(String(64), nullable=False, unique=True, index=True)
    external_service = Column(String(32), nullable=False)
    external_identifier = Column(String(255), nullable=False)
    doi = Column(String(255), nullable=True)
    deposited_at = Column(DateTime, nullable=False)
    locked_at = Column(DateTime, nullable=False)
    specification = Column(JSON, nullable=False)
    deviations = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

class MeasurementValidationCard(Base):
    __tablename__ = 'measurement_validation_cards'
    id = Column(String(64), primary_key=True)
    measurement_name = Column(String(96), nullable=False, index=True)
    version = Column(String(64), nullable=False)
    annotation_guide_uri = Column(Text, nullable=False)
    gold_set_snapshot_id = Column(String(64), ForeignKey('document_snapshots.id', ondelete='RESTRICT'), nullable=False)
    metrics = Column(JSON, nullable=False)
    error_examples = Column(JSON, nullable=False, default=list)
    parser_stability = Column(JSON, nullable=False, default=dict)
    extraction_sensitivity = Column(JSON, nullable=False, default=dict)
    active = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (UniqueConstraint('measurement_name', 'version', name='uq_measurement_validation_name_version'),)

class CorpusCoverageWindow(Base):
    __tablename__ = 'corpus_coverage_windows'
    id = Column(String(64), primary_key=True)
    window_start = Column(DateTime, nullable=False, index=True)
    window_end = Column(DateTime, nullable=False, index=True)
    expected_sources = Column(Integer, nullable=False, default=0)
    observed_sources = Column(Integer, nullable=False, default=0)
    feed_uptime = Column(JSON, nullable=False, default=dict)
    paywall_losses = Column(JSON, nullable=False, default=dict)
    language_distribution = Column(JSON, nullable=False, default=dict)
    source_gaps = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)
    __table_args__ = (CheckConstraint('window_end >= window_start', name='ck_corpus_coverage_window'),)

class ProofRun(Base):
    __tablename__ = 'proof_runs'
    id = Column(String(64), primary_key=True)
    case_id = Column(String(64), nullable=False, index=True)
    commit_sha = Column(String(64), nullable=False)
    dataset_snapshot = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, default='running', index=True)
    manifest = Column(JSON, nullable=False, default=dict)
    started_at = Column(DateTime, nullable=False, default=get_utc_now)
    completed_at = Column(DateTime, nullable=True)
__all__ = ['AcceptedRelationship', 'AdjudicationItem', 'ArchiveRequest', 'CalculationTrace', 'ClaimEvidence', 'CorpusCoverageWindow', 'DocumentSnapshot', 'EntityExternalId', 'EntityResolution', 'EvidenceClaim', 'EvidenceDocument', 'EvidenceEntity', 'EvidenceObservation', 'EvidencePolicyRow', 'ExternalMaterialEvent', 'MeasurementValidationCard', 'Preregistration', 'ProofRun', 'RelationshipClaim', 'SourceLineage']
