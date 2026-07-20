"""Typed contracts for the SCOOP Intelligence Atlas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AtlasEntityType = Literal["source", "organization", "reporter"]
AtlasRelationType = Literal[
    "ownership",
    "owned_by",
    "parent_org",
    "part_of",
    "publishes",
    "employed_by",
    "current_outlet",
    "coauthor",
    "shared_outlet",
]
AtlasConfidenceTier = Literal[
    "verified",
    "strong",
    "likely",
    "unresolved",
    "conflicting",
    "stale",
]
AtlasFactStatus = Literal["candidate", "accepted", "disputed", "rejected", "superseded"]


class AtlasEvidenceRef(BaseModel):
    id: str
    source_type: str
    source_name: str | None = None
    source_url: str | None = None
    retrieved_at: datetime | None = None
    excerpt: str | None = None
    snapshot_sha256: str | None = None
    locator: dict[str, Any] = Field(default_factory=dict)
    entailment: str | None = None


class AtlasNode(BaseModel):
    id: str
    entity_type: AtlasEntityType
    label: str
    subtitle: str | None = None
    country_code: str | None = None
    funding_type: str | None = None
    bias_rating: str | None = None
    factual_reporting: str | None = None
    credibility_score: float | None = None
    article_count: int = 0
    connection_count: int = 0
    ownership_connection_count: int = 0
    status: str | None = None
    confidence_tier: AtlasConfidenceTier | None = None
    profile_path: str | None = None
    updated_at: datetime | None = None
    flags: list[str] = Field(default_factory=list)


class AtlasEdge(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation_type: AtlasRelationType
    direction: Literal["directed", "undirected"] = "directed"
    weight: float = 1.0
    ownership_percentage: float | None = None
    confidence: float | None = None
    confidence_tier: AtlasConfidenceTier | None = None
    evidence_count: int = 0
    evidence_preview: list[AtlasEvidenceRef] = Field(default_factory=list)
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    last_verified_at: datetime | None = None
    is_inferred: bool = False
    raw_relation_type: str | None = None
    fact_status: AtlasFactStatus = "candidate"
    accepted_fact: bool = False
    qualifiers: dict[str, Any] = Field(default_factory=dict)
    claim_ids: list[str] = Field(default_factory=list)
    recorded_at: datetime | None = None
    retracted_at: datetime | None = None
    acceptance_policy_version: str | None = None
    evidence_root_count: int = 0


class AtlasCoverageMetric(BaseModel):
    numerator: int = 0
    denominator: int = 0

    @property
    def percentage(self) -> float:
        if self.denominator <= 0:
            return 0.0
        return round((self.numerator / self.denominator) * 100, 1)


class AtlasGraphStats(BaseModel):
    total_sources: int = 0
    total_organizations: int = 0
    total_reporters: int = 0
    visible_sources: int = 0
    visible_organizations: int = 0
    visible_reporters: int = 0
    visible_relationships: int = 0
    current_relationships: int = 0
    accepted_relationships: int = 0
    candidate_relationships: int = 0
    disputed_relationships: int = 0
    ownership_coverage: AtlasCoverageMetric = Field(default_factory=AtlasCoverageMetric)
    evidence_coverage: AtlasCoverageMetric = Field(default_factory=AtlasCoverageMetric)
    unresolved_source_links: int = 0


class AtlasGraphFilters(BaseModel):
    q: str | None = None
    entity_types: list[AtlasEntityType] = Field(default_factory=list)
    relation_types: list[AtlasRelationType] = Field(default_factory=list)
    country: list[str] = Field(default_factory=list)
    funding: list[str] = Field(default_factory=list)
    bias: list[str] = Field(default_factory=list)
    min_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    selected: str | None = None
    neighbors: int = Field(default=0, ge=0, le=2)
    layout: Literal["clustered", "ownership", "geography", "radial"] = "clustered"
    limit_nodes: int = Field(default=350, ge=1, le=600)
    limit_edges: int = Field(default=1500, ge=1, le=2500)
    include_evidence_preview: bool = True
    as_of: datetime | None = None
    known_at: datetime | None = None
    accepted_only: bool = False


class AtlasGraphResponse(BaseModel):
    graph_version: str
    generated_at: datetime
    nodes: list[AtlasNode] = Field(default_factory=list)
    edges: list[AtlasEdge] = Field(default_factory=list)
    stats: AtlasGraphStats
    applied_filters: AtlasGraphFilters
    truncated: bool = False
    truncation_reason: str | None = None
    next_expansion_token: str | None = None


class AtlasStatsResponse(BaseModel):
    graph_version: str
    generated_at: datetime
    stats: AtlasGraphStats
    by_entity_type: dict[str, int] = Field(default_factory=dict)
    by_relation_type: dict[str, int] = Field(default_factory=dict)
    by_index_status: dict[str, int] = Field(default_factory=dict)
    last_indexed_at: datetime | None = None
    indexing_active: bool = False


class AtlasSearchItem(BaseModel):
    id: str
    entity_type: AtlasEntityType
    label: str
    subtitle: str | None = None
    country_code: str | None = None
    confidence_tier: AtlasConfidenceTier | None = None
    profile_path: str | None = None


class AtlasSearchResponse(BaseModel):
    query: str
    sources: list[AtlasSearchItem] = Field(default_factory=list)
    organizations: list[AtlasSearchItem] = Field(default_factory=list)
    reporters: list[AtlasSearchItem] = Field(default_factory=list)


class AtlasConnectionRecord(BaseModel):
    edge: AtlasEdge
    entity: AtlasNode


class AtlasEntityRecord(BaseModel):
    id: str
    entity_type: AtlasEntityType
    label: str
    subtitle: str | None = None
    country_code: str | None = None
    status: str | None = None
    confidence_tier: AtlasConfidenceTier | None = None
    last_verified_at: datetime | None = None
    profile_path: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    evidence: list[AtlasEvidenceRef] = Field(default_factory=list)
    connections: list[AtlasConnectionRecord] = Field(default_factory=list)


class AtlasIndexResponse(BaseModel):
    items: list[AtlasNode] = Field(default_factory=list)
    total: int = 0
    next_cursor: str | None = None
    facets: dict[str, dict[str, int]] = Field(default_factory=dict)


class AtlasExportRequest(BaseModel):
    filters: AtlasGraphFilters = Field(default_factory=AtlasGraphFilters)
    selected_entity: str | None = None
    format: Literal["json", "csv_nodes", "csv_relationships", "csv_evidence"] = "json"
    include_evidence: bool = True
    visible_layout_positions: dict[str, dict[str, float]] | None = None
