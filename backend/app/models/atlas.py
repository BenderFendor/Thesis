"""Typed contracts for the SCOOP Intelligence Atlas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

AtlasEntityType = Literal["outlet", "organization", "person", "reporter"]
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
    "founded_by",
    "sibling_via_owner",
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
AtlasLifecycleState = Literal[
    "current", "historical", "proposed", "pending", "disputed", "rejected", "superseded"
]


class AtlasEvidenceRef(BaseModel):
    """A single evidence citation attached to an Atlas node or edge."""

    id: str
    source_type: str
    source_name: str | None = None
    source_url: str | None = None
    retrieved_at: datetime | None = None
    excerpt: str | None = None
    snapshot_sha256: str | None = None
    locator: dict[str, Any] = Field(default_factory=dict)
    entailment: str | None = None
    evidence_class: str | None = None
    policy_version: str | None = None
    acceptance_decision: str | None = None
    contradictions: list[str] = Field(default_factory=list)


class AtlasNode(BaseModel):
    """A single entity (source, organization, or reporter) in the Atlas graph."""

    id: str
    entity_type: AtlasEntityType
    label: str
    subtitle: str | None = None
    country_code: str | None = None
    funding_type: str | None = None
    bias_rating: str | None = None
    factual_reporting: str | None = None
    credibility_score: float | None = None
    analysis_scores: dict[str, int] = Field(default_factory=dict)
    article_count: int = 0
    connection_count: int = 0
    ownership_connection_count: int = 0
    status: str | None = None
    confidence_tier: AtlasConfidenceTier | None = None
    profile_path: str | None = None
    updated_at: datetime | None = None
    flags: list[str] = Field(default_factory=list)
    current_parent: str | None = None
    pending_change: str | None = None
    evidence_coverage: str = "not researched"
    freshness: str = "unknown"
    unresolved_gap: str | None = None


class AtlasEdge(BaseModel):
    """A relationship between two Atlas nodes, candidate or accepted."""

    id: str
    source_id: str
    target_id: str
    relation_type: AtlasRelationType
    predicate: str = ""
    display_group: str = "other"
    relation_type_deprecated: bool = True
    direction: Literal["directed", "undirected"] = "directed"
    weight: float = 1.0
    ownership_percentage: float | None = None
    voting_interest: dict[str, str] | None = None
    economic_interest: dict[str, str] | None = None
    beneficial_interest: dict[str, str] | None = None
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
    lifecycle_state: AtlasLifecycleState = "current"
    accepted_fact: bool = False
    qualifiers: dict[str, Any] = Field(default_factory=dict)
    claim_ids: list[str] = Field(default_factory=list)
    recorded_at: datetime | None = None
    retracted_at: datetime | None = None
    acceptance_policy_version: str | None = None
    evidence_root_count: int = 0

    @model_validator(mode="after")
    def fill_exact_relationship_contract(self) -> AtlasEdge:
        """Ensure compatibility edges still expose a predicate and display group."""
        if not self.predicate:
            self.predicate = self.raw_relation_type or self.relation_type
        if self.display_group == "other":
            if self.predicate in {
                "directly_owns",
                "owns_equity_in",
                "controls",
                "brand_of",
                "operated_by",
                "successor_of",
                "ownership",
            }:
                self.display_group = "ownership_control"
            elif self.predicate in {
                "employed_by",
                "current_outlet",
                "coauthor",
                "shared_outlet",
                "founded_by",
            }:
                self.display_group = "newsroom_people"
            elif self.predicate in {"publishes", "distributed_by", "syndicated_by"}:
                self.display_group = "publishing_distribution"
            elif self.predicate in {
                "authorizes_inventory_seller",
                "sponsors_content",
                "political_ad_purchase",
                "advertising_inventory_sold_by",
            }:
                self.display_group = "advertising_sponsorship"
            elif self.predicate == "funds":
                self.display_group = "funding_government_awards"
        return self


class AtlasCoverageMetric(BaseModel):
    """A numerator/denominator pair reported as a rounded percentage."""

    numerator: int = 0
    denominator: int = 0

    @property
    def percentage(self) -> float:
        """Return the coverage ratio as a percentage, 0 when there is no denominator."""
        if self.denominator <= 0:
            return 0.0
        return round((self.numerator / self.denominator) * 100, 1)


class AtlasGraphStats(BaseModel):
    """Aggregate node/edge counts and coverage metrics for a graph response."""

    total_outlets: int = 0
    total_organizations: int = 0
    total_people: int = 0
    total_reporters: int = 0
    visible_outlets: int = 0
    visible_organizations: int = 0
    visible_people: int = 0
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
    """Query parameters that select and shape a requested Atlas graph view."""

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
    limit_nodes: int | None = Field(default=350, ge=1, le=600)
    """Max ranked nodes to keep. `None` means no cap (used by the entity
    index/search, which page or group the full corpus themselves)."""
    limit_edges: int = Field(default=1500, ge=1, le=2500)
    include_evidence_preview: bool = True
    as_of: datetime | None = None
    known_at: datetime | None = None
    accepted_only: bool = False


class AtlasGraphResponse(BaseModel):
    """The full node/edge payload returned by the Atlas graph endpoint."""

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
    """Summary statistics for the Atlas graph, without node/edge payloads."""

    graph_version: str
    generated_at: datetime
    stats: AtlasGraphStats
    by_entity_type: dict[str, int] = Field(default_factory=dict)
    by_relation_type: dict[str, int] = Field(default_factory=dict)
    by_index_status: dict[str, int] = Field(default_factory=dict)
    last_indexed_at: datetime | None = None
    indexing_active: bool = False
    research_coverage: AtlasCoverageMetric = Field(default_factory=AtlasCoverageMetric)
    """Entities with `evidence_coverage != "not researched"` (at least one
    edge citing evidence touches the entity) versus the corpus total."""
    research_coverage_by_entity_type: dict[str, AtlasCoverageMetric] = Field(default_factory=dict)


class AtlasSearchItem(BaseModel):
    """A single search-result row for one Atlas entity."""

    id: str
    entity_type: AtlasEntityType
    label: str
    subtitle: str | None = None
    country_code: str | None = None
    confidence_tier: AtlasConfidenceTier | None = None
    profile_path: str | None = None
    current_parent: str | None = None
    pending_change: str | None = None
    evidence_coverage: str = "not researched"
    freshness: str = "unknown"
    unresolved_gap: str | None = None


class AtlasDossierStatement(BaseModel):
    """One plain-language dossier answer with its exact evidence state."""

    label: str
    answer: str
    state: Literal["known", "unknown", "not_researched", "source_unavailable", "chain_incomplete"]
    predicate: str | None = None
    lifecycle_state: AtlasLifecycleState | None = None
    evidence: list[AtlasEvidenceRef] = Field(default_factory=list)
    qualifiers: dict[str, Any] = Field(default_factory=dict)


class AtlasDossierSection(BaseModel):
    """A typed, non-empty dossier section."""

    key: Literal[
        "summary",
        "identity_public_records",
        "ownership_control",
        "newsroom_people",
        "funding_government_awards",
        "advertising_sponsorship",
        "publishing_distribution",
        "evidence_conflicts_freshness_gaps",
    ]
    title: str
    statements: list[AtlasDossierStatement] = Field(default_factory=list)


class AtlasSearchResponse(BaseModel):
    """Search results grouped by entity type."""

    query: str
    outlets: list[AtlasSearchItem] = Field(default_factory=list)
    organizations: list[AtlasSearchItem] = Field(default_factory=list)
    people: list[AtlasSearchItem] = Field(default_factory=list)
    reporters: list[AtlasSearchItem] = Field(default_factory=list)


class AtlasConnectionRecord(BaseModel):
    """One neighboring entity and the edge connecting it to the queried entity."""

    edge: AtlasEdge
    entity: AtlasNode


class AtlasEntityRecord(BaseModel):
    """The full inspector payload for a single Atlas entity."""

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
    entity_kind: str | None = None
    dossier_sections: list[AtlasDossierSection] = Field(default_factory=list)
    evidence: list[AtlasEvidenceRef] = Field(default_factory=list)
    connections: list[AtlasConnectionRecord] = Field(default_factory=list)


class AtlasMeasurementRecord(BaseModel):
    """One reproducible media measurement with complete scope metadata."""

    id: str
    measurement_name: str
    algorithm_version: str
    result: dict[str, Any]
    created_at: datetime


class AtlasMeasurementsResponse(BaseModel):
    """The measurement traces calculated for an outlet or the full corpus."""

    source_name: str | None = None
    measurements: list[AtlasMeasurementRecord] = Field(default_factory=list)


class EvidenceIngestRunRecord(BaseModel):
    """Public status for one persisted adapter run."""

    id: str
    adapter: str
    adapter_version: str
    scope: dict[str, Any] = Field(default_factory=dict)
    started_at: datetime
    completed_at: datetime | None = None
    status: Literal["running", "success", "partial", "failed", "blocked", "skipped"]
    network_mode: Literal["live", "offline", "disabled"]
    documents_count: int = 0
    snapshots_count: int = 0
    observations_count: int = 0
    claims_count: int = 0
    accepted_count: int = 0
    candidate_count: int = 0
    failure: str | None = None
    retryable: bool = False
    missing_credentials: list[str] = Field(default_factory=list)


class AtlasIngestStatusResponse(BaseModel):
    """Freshness and failure summary for Atlas ingestion."""

    freshness: Literal["fresh", "stale", "never", "running", "partial"]
    last_success_at: datetime | None = None
    has_retryable_failures: bool = False
    missing_credentials: list[str] = Field(default_factory=list)
    runs: list[EvidenceIngestRunRecord] = Field(default_factory=list)


class AtlasIndexResponse(BaseModel):
    """A paginated, faceted listing of Atlas entities."""

    items: list[AtlasNode] = Field(default_factory=list)
    total: int = 0
    next_cursor: str | None = None
    facets: dict[str, dict[str, int]] = Field(default_factory=dict)


class FundingBiasMethodology(BaseModel):
    """The locked, pre-registered methodology for the funding-vs-bias measurement."""

    preregistration_id: str
    title: str
    locked_at: datetime
    specification: dict[str, Any]
    deviations: list[Any] = Field(default_factory=list)


class FundingBiasStatistic(BaseModel):
    """The contingency table and Cramer's V association statistic over it."""

    n: int
    rows: list[str]
    cols: list[str]
    table: list[list[int]]
    chi_square: float | None = None
    degrees_of_freedom: int | None = None
    cramers_v: float | None = None
    interpretation: str | None = None
    note: str | None = None


class FundingBiasAnalysisResponse(BaseModel):
    """Catalog-wide funding-type vs. bias-rating correlation, as last computed.

    `available=False` (an otherwise-empty response, not a 404/500) is the
    honest state before `app.scripts.run_funding_bias_analysis` has ever
    run against this database.
    """

    available: bool = False
    methodology: FundingBiasMethodology | None = None
    statistic: FundingBiasStatistic | None = None
    trace_id: str | None = None
    algorithm_version: str | None = None
    computed_at: datetime | None = None
    population_size: int = 0
    validation_card_skip_reason: str | None = None


class AtlasExportRequest(BaseModel):
    """Parameters selecting what slice of the Atlas graph to export and in what format."""

    filters: AtlasGraphFilters = Field(default_factory=AtlasGraphFilters)
    selected_entity: str | None = None
    format: Literal["json", "csv_nodes", "csv_relationships", "csv_evidence"] = "json"
    include_evidence: bool = True
    visible_layout_positions: dict[str, dict[str, float]] | None = None
