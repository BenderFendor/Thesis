"""API contracts for bitemporal evidence, relationships, and proof bundles."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

FactStatus = Literal["candidate", "accepted", "disputed", "rejected", "superseded"]
EntailmentStatus = Literal[
    "reviewed_yes", "reviewed_no", "model_suggested", "unevaluated"
]


class EvidenceObservationRecord(BaseModel):
    id: str
    snapshot_id: str
    locator: dict[str, Any]
    quoted_text: str | None = None
    structured_value: Any | None = None
    context_before: str | None = None
    context_after: str | None = None
    entailment: EntailmentStatus
    extractor: str
    extractor_version: str
    ocr_confidence: float | None = None


class EvidenceClaimRecord(BaseModel):
    id: str
    subject_entity_id: str
    predicate: str
    object_entity_id: str | None = None
    object_value: Any | None = None
    qualifiers: dict[str, Any] = Field(default_factory=dict)
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    date_precision: str | None = None
    recorded_at: datetime
    retracted_at: datetime | None = None
    asserted_by: str
    evidence_class: str
    status: FactStatus
    method_version: str
    evidence: list[EvidenceObservationRecord] = Field(default_factory=list)


class AcceptedRelationshipRecord(BaseModel):
    id: str
    subject_entity_id: str
    predicate: str
    object_entity_id: str
    qualifiers: dict[str, Any] = Field(default_factory=dict)
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    recorded_at: datetime
    retracted_at: datetime | None = None
    materialized_at: datetime
    acceptance_policy_version: str
    status: Literal["accepted", "historical", "disputed", "retracted"]
    claim_ids: list[str] = Field(default_factory=list)
    evidence_root_count: int = 0


class RelationshipQueryResponse(BaseModel):
    as_of: datetime
    known_at: datetime
    relationships: list[AcceptedRelationshipRecord] = Field(default_factory=list)


class EvidencePolicyRecord(BaseModel):
    predicate: str
    version: str
    allowed_evidence_classes: list[str]
    minimum_independent_roots: int
    requires_complete_path: bool = False
    permits_catalog_only: bool = False


class AcceptanceEvaluationRequest(BaseModel):
    claim_id: str
    complete_control_path: bool = False


class AcceptanceEvaluationResponse(BaseModel):
    claim_id: str
    accepted: bool
    policy_version: str
    reasons: list[str] = Field(default_factory=list)
    independent_root_count: int = 0
    qualifying_observation_count: int = 0


class ProofBundleManifest(BaseModel):
    relationship_id: str
    generated_at: datetime
    as_of: datetime
    known_at: datetime
    files: dict[str, str]
    claim_ids: list[str]
    observation_ids: list[str]
    snapshot_hashes: list[str]
    calculation_trace_ids: list[str]


class ContradictionRecord(BaseModel):
    left_claim_id: str
    right_claim_id: str
    classification: Literal[
        "compatible",
        "temporal_successor",
        "different_share_class",
        "different_relation",
        "apparently_conflicting",
        "confirmed_conflict",
    ]
    normalized_dimensions: dict[str, Any] = Field(default_factory=dict)
    reason: str
