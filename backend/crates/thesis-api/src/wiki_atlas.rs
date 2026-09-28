use crate::models::Rejection;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) mod media_measurements;
pub(crate) use media_measurements::get_media_measurements;
pub(crate) mod graph;
pub(crate) use graph::{get_connections, get_graph};
pub(crate) mod search;
pub(crate) use search::get_atlas_search;
pub(crate) mod index;
pub(crate) use index::get_atlas_index;
pub(crate) mod export;
pub(crate) use export::export_atlas;
pub(crate) mod stats;
pub(crate) use stats::get_atlas_stats;

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::{wiki, AppState};

const FUNDING_BIAS_VALIDATION_SKIP_REASON: &str = "MeasurementValidationCard validates an extraction measurement's accuracy against a hand-annotated gold document snapshot (gold_set_snapshot_id is a required foreign key, annotation_guide_uri is required text). A catalog-wide chi-square/Cramer's V association statistic has no such gold-labeled document to grade against -- there is nothing to annotate and compare per-example. Writing a row here would mean fabricating an annotation guide and a gold snapshot that don't exist, so this measurement intentionally never writes one.";

#[derive(Debug)]
struct AtlasFreeFormObjectSchema;

impl PartialSchema for AtlasFreeFormObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for AtlasFreeFormObjectSchema {}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
#[schema(as = AtlasFreshness)]
pub(crate) enum AtlasFreshness {
    Fresh,
    Stale,
    Never,
    Running,
    Partial,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
#[schema(as = EvidenceIngestStatus)]
pub(crate) enum EvidenceIngestStatus {
    Running,
    Success,
    Partial,
    Failed,
    Blocked,
    Skipped,
}

impl TryFrom<&str> for EvidenceIngestStatus {
    type Error = ();

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "running" => Ok(Self::Running),
            "success" => Ok(Self::Success),
            "partial" => Ok(Self::Partial),
            "failed" => Ok(Self::Failed),
            "blocked" => Ok(Self::Blocked),
            "skipped" => Ok(Self::Skipped),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
#[schema(as = EvidenceNetworkMode)]
pub(crate) enum EvidenceNetworkMode {
    Live,
    Offline,
    Disabled,
}

impl TryFrom<&str> for EvidenceNetworkMode {
    type Error = ();

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "live" => Ok(Self::Live),
            "offline" => Ok(Self::Offline),
            "disabled" => Ok(Self::Disabled),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = EvidenceIngestRunRecord, description = "Public status for one persisted adapter run.")]
pub(crate) struct EvidenceIngestRunResponse {
    id: String,
    adapter: String,
    adapter_version: String,
    #[schema(schema_with = free_form_object_schema)]
    scope: Value,
    started_at: NaiveDateTime,
    completed_at: Option<NaiveDateTime>,
    status: EvidenceIngestStatus,
    network_mode: EvidenceNetworkMode,
    #[schema(default = 0)]
    documents_count: i32,
    #[schema(default = 0)]
    snapshots_count: i32,
    #[schema(default = 0)]
    observations_count: i32,
    #[schema(default = 0)]
    claims_count: i32,
    #[schema(default = 0)]
    accepted_count: i32,
    #[schema(default = 0)]
    candidate_count: i32,
    failure: Option<String>,
    #[schema(default = false)]
    retryable: bool,
    missing_credentials: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasIngestStatusResponse, description = "Freshness and failure summary for Atlas ingestion.")]
pub(crate) struct AtlasIngestStatusResponse {
    freshness: AtlasFreshness,
    last_success_at: Option<NaiveDateTime>,
    #[schema(default = false)]
    has_retryable_failures: bool,
    missing_credentials: Vec<String>,
    runs: Vec<EvidenceIngestRunResponse>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct AtlasIngestStatusParameters {
    #[param(required = false, default = 40, minimum = 1, maximum = 200)]
    limit: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = FundingBiasMethodology, description = "The locked, pre-registered methodology for the funding-vs-bias measurement.")]
pub(crate) struct FundingBiasMethodologyResponse {
    preregistration_id: String,
    title: String,
    locked_at: NaiveDateTime,
    #[schema(schema_with = free_form_object_schema)]
    specification: Value,
    deviations: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = FundingBiasStatistic, description = "The contingency table and Cramer's V association statistic over it.")]
pub(crate) struct FundingBiasStatisticResponse {
    n: i64,
    rows: Vec<String>,
    cols: Vec<String>,
    table: Vec<Vec<i64>>,
    chi_square: Option<f64>,
    degrees_of_freedom: Option<i64>,
    cramers_v: Option<f64>,
    interpretation: Option<String>,
    note: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = FundingBiasAnalysisResponse, description = "Catalog-wide funding-type vs. bias-rating correlation, as last computed.")]
pub(crate) struct FundingBiasAnalysisResponse {
    #[schema(default = false)]
    available: bool,
    methodology: Option<FundingBiasMethodologyResponse>,
    statistic: Option<FundingBiasStatisticResponse>,
    trace_id: Option<String>,
    algorithm_version: Option<String>,
    computed_at: Option<NaiveDateTime>,
    #[schema(default = 0)]
    population_size: i64,
    validation_card_skip_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasEntityType {
    Outlet,
    Organization,
    Person,
    Reporter,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasRelationType {
    Ownership,
    OwnedBy,
    ParentOrg,
    PartOf,
    Publishes,
    EmployedBy,
    CurrentOutlet,
    Coauthor,
    SharedOutlet,
    FoundedBy,
    SiblingViaOwner,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasConfidenceTier {
    Verified,
    Strong,
    Likely,
    Unresolved,
    Conflicting,
    Stale,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasFactStatus {
    Candidate,
    Accepted,
    Disputed,
    Rejected,
    Superseded,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasLifecycleState {
    Current,
    Historical,
    Proposed,
    Pending,
    Disputed,
    Rejected,
    Superseded,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasLayout {
    Clustered,
    Ownership,
    Geography,
    Radial,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasDossierState {
    Known,
    Unknown,
    NotResearched,
    SourceUnavailable,
    ChainIncomplete,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasDossierSectionKey {
    Summary,
    IdentityPublicRecords,
    OwnershipControl,
    NewsroomPeople,
    FundingGovernmentAwards,
    AdvertisingSponsorship,
    PublishingDistribution,
    EvidenceConflictsFreshnessGaps,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasDirection {
    Directed,
    Undirected,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasEvidenceRef)]
pub(crate) struct AtlasEvidenceRefResponse {
    id: String,
    source_type: String,
    source_name: Option<String>,
    source_url: Option<String>,
    retrieved_at: Option<NaiveDateTime>,
    excerpt: Option<String>,
    snapshot_sha256: Option<String>,
    #[schema(schema_with = free_form_object_schema)]
    locator: Value,
    entailment: Option<String>,
    evidence_class: Option<String>,
    policy_version: Option<String>,
    acceptance_decision: Option<String>,
    contradictions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasNode)]
pub(crate) struct AtlasNodeResponse {
    id: String,
    entity_type: AtlasEntityType,
    label: String,
    subtitle: Option<String>,
    country_code: Option<String>,
    funding_type: Option<String>,
    bias_rating: Option<String>,
    factual_reporting: Option<String>,
    credibility_score: Option<f64>,
    analysis_scores: BTreeMap<String, i32>,
    article_count: i64,
    connection_count: i64,
    ownership_connection_count: i64,
    status: Option<String>,
    confidence_tier: Option<AtlasConfidenceTier>,
    profile_path: Option<String>,
    updated_at: Option<NaiveDateTime>,
    flags: Vec<String>,
    current_parent: Option<String>,
    pending_change: Option<String>,
    evidence_coverage: String,
    freshness: String,
    unresolved_gap: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasEdge)]
pub(crate) struct AtlasEdgeResponse {
    id: String,
    source_id: String,
    target_id: String,
    relation_type: AtlasRelationType,
    predicate: String,
    display_group: String,
    relation_type_deprecated: bool,
    direction: AtlasDirection,
    weight: f64,
    ownership_percentage: Option<f64>,
    #[schema(schema_with = free_form_object_schema)]
    voting_interest: Option<Value>,
    #[schema(schema_with = free_form_object_schema)]
    economic_interest: Option<Value>,
    #[schema(schema_with = free_form_object_schema)]
    beneficial_interest: Option<Value>,
    confidence: Option<f64>,
    confidence_tier: Option<AtlasConfidenceTier>,
    evidence_count: i64,
    evidence_preview: Vec<AtlasEvidenceRefResponse>,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    last_verified_at: Option<NaiveDateTime>,
    is_inferred: bool,
    raw_relation_type: Option<String>,
    fact_status: AtlasFactStatus,
    lifecycle_state: AtlasLifecycleState,
    accepted_fact: bool,
    #[schema(schema_with = free_form_object_schema)]
    qualifiers: Value,
    claim_ids: Vec<String>,
    recorded_at: Option<NaiveDateTime>,
    retracted_at: Option<NaiveDateTime>,
    acceptance_policy_version: Option<String>,
    evidence_root_count: i64,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[schema(as = AtlasCoverageMetric)]
pub(crate) struct AtlasCoverageMetricResponse {
    numerator: i64,
    denominator: i64,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[schema(as = AtlasGraphStats)]
pub(crate) struct AtlasGraphStatsResponse {
    total_outlets: i64,
    total_organizations: i64,
    total_people: i64,
    total_reporters: i64,
    visible_outlets: i64,
    visible_organizations: i64,
    visible_people: i64,
    visible_reporters: i64,
    visible_relationships: i64,
    current_relationships: i64,
    accepted_relationships: i64,
    candidate_relationships: i64,
    disputed_relationships: i64,
    ownership_coverage: AtlasCoverageMetricResponse,
    evidence_coverage: AtlasCoverageMetricResponse,
    unresolved_source_links: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasGraphResponse)]
pub(crate) struct AtlasGraphResponse {
    graph_version: String,
    generated_at: chrono::DateTime<Utc>,
    nodes: Vec<AtlasNodeResponse>,
    edges: Vec<AtlasEdgeResponse>,
    stats: AtlasGraphStatsResponse,
    applied_filters: AtlasGraphFiltersInput,
    truncated: bool,
    truncation_reason: Option<String>,
    next_expansion_token: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasStatsResponse)]
pub(crate) struct AtlasStatsResponse {
    graph_version: String,
    generated_at: chrono::DateTime<Utc>,
    stats: AtlasGraphStatsResponse,
    by_entity_type: BTreeMap<String, i64>,
    by_relation_type: BTreeMap<String, i64>,
    by_index_status: BTreeMap<String, i64>,
    last_indexed_at: Option<NaiveDateTime>,
    indexing_active: bool,
    research_coverage: AtlasCoverageMetricResponse,
    research_coverage_by_entity_type: BTreeMap<String, AtlasCoverageMetricResponse>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasSearchItem)]
pub(crate) struct AtlasSearchItemResponse {
    id: String,
    entity_type: AtlasEntityType,
    label: String,
    subtitle: Option<String>,
    country_code: Option<String>,
    confidence_tier: Option<AtlasConfidenceTier>,
    profile_path: Option<String>,
    current_parent: Option<String>,
    pending_change: Option<String>,
    evidence_coverage: String,
    freshness: String,
    unresolved_gap: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasSearchResponse)]
pub(crate) struct AtlasSearchResponse {
    query: String,
    outlets: Vec<AtlasSearchItemResponse>,
    organizations: Vec<AtlasSearchItemResponse>,
    people: Vec<AtlasSearchItemResponse>,
    reporters: Vec<AtlasSearchItemResponse>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasDossierStatement)]
pub(crate) struct AtlasDossierStatementResponse {
    label: String,
    answer: String,
    state: AtlasDossierState,
    predicate: Option<String>,
    lifecycle_state: Option<AtlasLifecycleState>,
    evidence: Vec<AtlasEvidenceRefResponse>,
    #[schema(schema_with = free_form_object_schema)]
    qualifiers: Value,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasDossierSection)]
pub(crate) struct AtlasDossierSectionResponse {
    key: AtlasDossierSectionKey,
    title: String,
    statements: Vec<AtlasDossierStatementResponse>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasConnectionRecord)]
pub(crate) struct AtlasConnectionResponse {
    edge: AtlasEdgeResponse,
    entity: AtlasNodeResponse,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasEntityRecord)]
pub(crate) struct AtlasEntityResponse {
    id: String,
    entity_type: AtlasEntityType,
    label: String,
    subtitle: Option<String>,
    country_code: Option<String>,
    status: Option<String>,
    confidence_tier: Option<AtlasConfidenceTier>,
    last_verified_at: Option<NaiveDateTime>,
    profile_path: Option<String>,
    #[schema(schema_with = free_form_object_schema)]
    details: Value,
    entity_kind: Option<String>,
    dossier_sections: Vec<AtlasDossierSectionResponse>,
    evidence: Vec<AtlasEvidenceRefResponse>,
    connections: Vec<AtlasConnectionResponse>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasMeasurementRecord)]
pub(crate) struct AtlasMeasurementResponse {
    id: String,
    measurement_name: String,
    algorithm_version: String,
    #[schema(schema_with = free_form_object_schema)]
    result: Value,
    created_at: NaiveDateTime,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasMeasurementsResponse)]
pub(crate) struct AtlasMeasurementsResponse {
    source_name: Option<String>,
    measurements: Vec<AtlasMeasurementResponse>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AtlasIndexResponse)]
pub(crate) struct AtlasIndexResponse {
    items: Vec<AtlasNodeResponse>,
    total: i64,
    next_cursor: Option<String>,
    facets: BTreeMap<String, BTreeMap<String, i64>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AtlasExportFormat {
    Json,
    CsvNodes,
    CsvRelationships,
    CsvEvidence,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[schema(as = AtlasExportRequest)]
pub(crate) struct AtlasExportRequest {
    #[serde(default)]
    filters: AtlasGraphFiltersInput,
    selected_entity: Option<String>,
    #[serde(default = "default_export_format")]
    format: AtlasExportFormat,
    #[serde(default = "default_true")]
    include_evidence: bool,
    visible_layout_positions: Option<BTreeMap<String, BTreeMap<String, f64>>>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum AtlasIndexSort {
    Name,
    MostConnected,
    MostArticles,
    RecentlyIndexed,
    LowestConfidence,
}

#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
struct AtlasGraphQueryParameters {
    q: Option<String>,
    entity_types: Option<String>,
    relation_types: Option<String>,
    country: Option<String>,
    funding: Option<String>,
    bias: Option<String>,
    min_confidence: Option<f64>,
    selected: Option<String>,
    neighbors: Option<i64>,
    limit_nodes: Option<i64>,
    limit_edges: Option<i64>,
    layout: Option<AtlasLayout>,
    include_evidence_preview: Option<bool>,
    as_of: Option<String>,
    known_at: Option<String>,
    accepted_only: Option<bool>,
}

#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
struct AtlasIndexQueryParameters {
    entity_types: Option<String>,
    #[param(required = false, max_length = 200)]
    q: Option<String>,
    country: Option<String>,
    funding: Option<String>,
    bias: Option<String>,
    kind: Option<String>,
    #[param(required = false, default = "name")]
    sort: Option<AtlasIndexSort>,
    #[param(required = false, max_length = 100)]
    cursor: Option<String>,
    #[param(required = false, minimum = 1, maximum = 100, default = 60)]
    limit: Option<i64>,
}

#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
struct AtlasMediaMeasurementQueryParameters {
    #[param(required = false, max_length = 200)]
    source_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[schema(as = AtlasGraphFilters)]
pub(crate) struct AtlasGraphFiltersInput {
    q: Option<String>,
    #[serde(default)]
    entity_types: Vec<AtlasEntityType>,
    #[serde(default)]
    relation_types: Vec<AtlasRelationType>,
    #[serde(default)]
    country: Vec<String>,
    #[serde(default)]
    funding: Vec<String>,
    #[serde(default)]
    bias: Vec<String>,
    #[serde(default)]
    min_confidence: f64,
    selected: Option<String>,
    #[serde(default)]
    neighbors: i64,
    #[serde(default = "default_layout")]
    layout: AtlasLayout,
    #[serde(default = "default_node_limit")]
    limit_nodes: Option<i64>,
    #[serde(default = "default_edge_limit")]
    limit_edges: i64,
    #[serde(default = "default_true")]
    include_evidence_preview: bool,
    as_of: Option<String>,
    known_at: Option<String>,
    #[serde(default)]
    accepted_only: bool,
}

fn default_true() -> bool {
    true
}

fn default_node_limit() -> Option<i64> {
    Some(350)
}

fn default_edge_limit() -> i64 {
    1500
}

fn default_layout() -> AtlasLayout {
    AtlasLayout::Clustered
}

fn default_export_format() -> AtlasExportFormat {
    AtlasExportFormat::Json
}

impl Default for AtlasGraphFiltersInput {
    fn default() -> Self {
        Self {
            q: None,
            entity_types: Vec::new(),
            relation_types: Vec::new(),
            country: Vec::new(),
            funding: Vec::new(),
            bias: Vec::new(),
            min_confidence: 0.0,
            selected: None,
            neighbors: 0,
            layout: default_layout(),
            limit_nodes: default_node_limit(),
            limit_edges: default_edge_limit(),
            include_evidence_preview: true,
            as_of: None,
            known_at: None,
            accepted_only: false,
        }
    }
}

fn free_form_object_schema() -> RefOr<Schema> {
    AtlasFreeFormObjectSchema::schema()
}

fn ingest_status(value: &str) -> Result<EvidenceIngestStatus, ()> {
    EvidenceIngestStatus::try_from(value)
}

fn network_mode(value: &str) -> Result<EvidenceNetworkMode, ()> {
    EvidenceNetworkMode::try_from(value)
}

fn json_string_list(value: &Value) -> Result<Vec<String>, ()> {
    value
        .as_array()
        .ok_or(())?
        .iter()
        .map(|item| item.as_str().map(str::to_owned).ok_or(()))
        .collect()
}

fn json_string_list_or_empty(value: &Value) -> Result<Vec<String>, ()> {
    if value.is_null() || value.as_array().is_some_and(Vec::is_empty) {
        Ok(Vec::new())
    } else {
        json_string_list(value)
    }
}

fn ingest_run_response(
    row: thesis_db::WikiIngestRunRecord,
) -> Result<EvidenceIngestRunResponse, ()> {
    if !row.scope.0.is_object() {
        return Err(());
    }
    Ok(EvidenceIngestRunResponse {
        id: row.id,
        adapter: row.adapter,
        adapter_version: row.adapter_version,
        scope: row.scope.0,
        started_at: row.started_at,
        completed_at: row.completed_at,
        status: ingest_status(&row.status)?,
        network_mode: network_mode(&row.network_mode)?,
        documents_count: row.documents_count,
        snapshots_count: row.snapshots_count,
        observations_count: row.observations_count,
        claims_count: row.claims_count,
        accepted_count: row.accepted_count,
        candidate_count: row.candidate_count,
        failure: row.failure,
        retryable: row.retryable,
        missing_credentials: json_string_list_or_empty(&row.missing_credentials.0)?,
    })
}

fn freshness_label(statuses: &[&str], last_success_at: Option<NaiveDateTime>) -> AtlasFreshness {
    if statuses.contains(&"running") {
        return AtlasFreshness::Running;
    }
    let incomplete = statuses
        .iter()
        .any(|status| matches!(*status, "partial" | "failed" | "blocked"));
    let newest_status = statuses.first().copied();
    if incomplete && (last_success_at.is_none() || newest_status != Some("success")) {
        return AtlasFreshness::Partial;
    }
    let Some(last_success_at) = last_success_at else {
        return AtlasFreshness::Never;
    };
    let interval_hours = std::env::var("SCOOP_AUTO_INGEST_INTERVAL_HOURS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(24);
    if Utc::now().naive_utc() - last_success_at < chrono::Duration::hours(interval_hours) {
        AtlasFreshness::Fresh
    } else {
        AtlasFreshness::Stale
    }
}

fn ingest_status_response(
    rows: Vec<thesis_db::WikiIngestRunRecord>,
) -> Result<AtlasIngestStatusResponse, ()> {
    let last_success_at = rows
        .iter()
        .filter(|row| row.status == "success")
        .filter_map(|row| row.completed_at)
        .max();
    let statuses = rows
        .iter()
        .map(|row| row.status.as_str())
        .collect::<Vec<_>>();
    let freshness = freshness_label(&statuses, last_success_at);
    let has_retryable_failures = rows.iter().any(|row| row.retryable);
    let missing_credentials = rows
        .iter()
        .map(|row| json_string_list_or_empty(&row.missing_credentials.0))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let runs = rows
        .into_iter()
        .map(ingest_run_response)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AtlasIngestStatusResponse {
        freshness,
        last_success_at,
        has_retryable_failures,
        missing_credentials,
        runs,
    })
}

fn optional_string(value: Option<&Value>) -> Result<Option<String>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(()),
    }
}

fn optional_number(value: Option<&Value>) -> Result<Option<f64>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_f64().map(Some).ok_or(()),
    }
}

fn optional_integer(value: Option<&Value>) -> Result<Option<i64>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_i64().map(Some).ok_or(()),
    }
}

fn funding_statistic(result: &Value, subgraph: &Value) -> Result<FundingBiasStatisticResponse, ()> {
    let statistic = result.as_object().ok_or(())?;
    let subgraph = subgraph.as_object().ok_or(())?;
    let n = statistic
        .get("n")
        .map_or(Ok(0), |value| value.as_i64().ok_or(()))?;
    let rows = subgraph
        .get("rows")
        .map(json_string_list)
        .transpose()?
        .unwrap_or_default();
    let cols = subgraph
        .get("cols")
        .map(json_string_list)
        .transpose()?
        .unwrap_or_default();
    let table = match statistic.get("table") {
        None => Vec::new(),
        Some(value) => value
            .as_array()
            .ok_or(())?
            .iter()
            .map(|row| {
                row.as_array()
                    .ok_or(())?
                    .iter()
                    .map(|cell| cell.as_i64().ok_or(()))
                    .collect::<Result<Vec<_>, _>>()
            })
            .collect::<Result<Vec<_>, _>>()?,
    };
    Ok(FundingBiasStatisticResponse {
        n,
        rows,
        cols,
        table,
        chi_square: optional_number(statistic.get("chi_square"))?,
        degrees_of_freedom: optional_integer(statistic.get("degrees_of_freedom"))?,
        cramers_v: optional_number(statistic.get("cramers_v"))?,
        interpretation: optional_string(statistic.get("interpretation"))?,
        note: optional_string(statistic.get("note"))?,
    })
}

fn funding_bias_response(
    data: thesis_db::WikiFundingBiasData,
) -> Result<FundingBiasAnalysisResponse, ()> {
    let specification = data.preregistration.specification.0;
    if !specification.is_object() {
        return Err(());
    }
    let deviations = match data.preregistration.deviations.0 {
        Value::Null | Value::Bool(false) => Vec::new(),
        Value::Array(values) => values,
        _ => return Err(()),
    };
    let subgraph = data.trace.subgraph.0;
    let population_size = subgraph
        .get("population_outlets")
        .and_then(Value::as_array)
        .map_or(0, |values| values.len()) as i64;
    let statistic = funding_statistic(&data.trace.result.0, &subgraph)?;
    Ok(FundingBiasAnalysisResponse {
        available: true,
        methodology: Some(FundingBiasMethodologyResponse {
            preregistration_id: data.preregistration.id,
            title: data.preregistration.title,
            locked_at: data.preregistration.locked_at,
            specification,
            deviations,
        }),
        statistic: Some(statistic),
        trace_id: Some(data.trace.id),
        algorithm_version: Some(data.trace.algorithm_version),
        computed_at: Some(data.trace.created_at),
        population_size,
        validation_card_skip_reason: Some(FUNDING_BIAS_VALIDATION_SKIP_REASON.to_owned()),
    })
}

fn validation_error(
    location: &str,
    field: &str,
    input: Value,
    error_type: &str,
    message: impl Into<String>,
    context: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: std::iter::once(ValidationLocation::Text(location.to_owned()))
                .chain(
                    field
                        .split('.')
                        .map(|part| ValidationLocation::Text(part.to_owned())),
                )
                .collect(),
            msg: message.into(),
            error_type: error_type.to_owned(),
            input,
            ctx: context,
        }],
    }
}

fn length_error(
    location: &str,
    field: &str,
    raw: &str,
    minimum: Option<usize>,
    maximum: Option<usize>,
) -> HttpValidationError {
    let (error_type, message, bound_name, bound) = match (minimum, maximum) {
        (Some(minimum), _) if raw.chars().count() < minimum => (
            "string_too_short",
            format!(
                "String should have at least {minimum} {}",
                if minimum == 1 {
                    "character"
                } else {
                    "characters"
                }
            ),
            "min_length",
            minimum,
        ),
        (_, Some(maximum)) => (
            "string_too_long",
            format!("String should have at most {maximum} characters"),
            "max_length",
            maximum,
        ),
        _ => unreachable!("length_error requires a violated bound"),
    };
    validation_error(
        location,
        field,
        Value::String(raw.to_owned()),
        error_type,
        message,
        Some(Map::from_iter([(
            bound_name.to_owned(),
            Value::from(bound as u64),
        )])),
    )
}

fn query_optional_string(
    values: &std::collections::HashMap<String, String>,
    field: &str,
    maximum: Option<usize>,
) -> Result<Option<String>, HttpValidationError> {
    let Some(raw) = values.get(field) else {
        return Ok(None);
    };
    if maximum.is_some_and(|maximum| raw.chars().count() > maximum) {
        return Err(length_error("query", field, raw, None, maximum));
    }
    Ok(Some(raw.clone()))
}

fn query_required_string(
    values: &std::collections::HashMap<String, String>,
    field: &str,
    minimum: usize,
    maximum: usize,
) -> Result<String, HttpValidationError> {
    let Some(raw) = values.get(field) else {
        return Err(validation_error(
            "query",
            field,
            Value::Null,
            "missing",
            "Field required",
            None,
        ));
    };
    let length = raw.chars().count();
    if length < minimum || length > maximum {
        return Err(length_error(
            "query",
            field,
            raw,
            (length < minimum).then_some(minimum),
            (length > maximum).then_some(maximum),
        ));
    }
    Ok(raw.clone())
}

fn split_csv(value: Option<&String>) -> Vec<String> {
    value
        .into_iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

fn parse_entity_types(value: Option<&String>) -> Result<Vec<AtlasEntityType>, Rejection> {
    let mut result = Vec::new();
    let mut unsupported = BTreeSet::new();
    for value in split_csv(value) {
        match value.as_str() {
            "outlet" | "source" => result.push(AtlasEntityType::Outlet),
            "organization" => result.push(AtlasEntityType::Organization),
            "person" => result.push(AtlasEntityType::Person),
            "reporter" => result.push(AtlasEntityType::Reporter),
            _ => {
                unsupported.insert(value);
            }
        }
    }
    if unsupported.is_empty() {
        Ok(result)
    } else {
        Err(Rejection::from((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "detail": format!("Unsupported entity types: {}", unsupported.into_iter().collect::<Vec<_>>().join(", "))
            })),
        )
            .into_response()))
    }
}

fn parse_relation_types(value: Option<&String>) -> Result<Vec<AtlasRelationType>, Rejection> {
    let mut result = Vec::new();
    let mut unsupported = BTreeSet::new();
    for value in split_csv(value) {
        match value.as_str() {
            "ownership" => result.push(AtlasRelationType::Ownership),
            "owned_by" => result.push(AtlasRelationType::OwnedBy),
            "parent_org" => result.push(AtlasRelationType::ParentOrg),
            "part_of" => result.push(AtlasRelationType::PartOf),
            "publishes" => result.push(AtlasRelationType::Publishes),
            "employed_by" => result.push(AtlasRelationType::EmployedBy),
            "current_outlet" => result.push(AtlasRelationType::CurrentOutlet),
            "coauthor" => result.push(AtlasRelationType::Coauthor),
            "shared_outlet" => result.push(AtlasRelationType::SharedOutlet),
            "founded_by" => result.push(AtlasRelationType::FoundedBy),
            "sibling_via_owner" => result.push(AtlasRelationType::SiblingViaOwner),
            _ => {
                unsupported.insert(value);
            }
        }
    }
    if unsupported.is_empty() {
        Ok(result)
    } else {
        Err(Rejection::from((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({
                "detail": format!("Unsupported relation types: {}", unsupported.into_iter().collect::<Vec<_>>().join(", "))
            })),
        )
            .into_response()))
    }
}

fn query_float(
    values: &std::collections::HashMap<String, String>,
    field: &str,
    default: f64,
    minimum: f64,
    maximum: f64,
) -> Result<f64, HttpValidationError> {
    let Some(raw) = values.get(field) else {
        return Ok(default);
    };
    let parsed = raw
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite());
    let Some(parsed) = parsed else {
        return Err(validation_error(
            "query",
            field,
            Value::String(raw.clone()),
            "float_parsing",
            "Input should be a valid number, unable to parse string as a number",
            None,
        ));
    };
    for (bound, value, error_type, message) in [
        (
            "ge",
            minimum,
            "greater_than_equal",
            format!("Input should be greater than or equal to {minimum}"),
        ),
        (
            "le",
            maximum,
            "less_than_equal",
            format!("Input should be less than or equal to {maximum}"),
        ),
    ] {
        if (bound == "ge" && parsed < value) || (bound == "le" && parsed > value) {
            return Err(validation_error(
                "query",
                field,
                Value::from(parsed),
                error_type,
                message,
                Some(Map::from_iter([(bound.to_owned(), Value::from(value))])),
            ));
        }
    }
    Ok(parsed)
}

fn query_bool(
    values: &std::collections::HashMap<String, String>,
    field: &str,
    default: bool,
) -> Result<bool, HttpValidationError> {
    let Some(raw) = values.get(field) else {
        return Ok(default);
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "t" | "yes" | "y" | "on" => Ok(true),
        "0" | "false" | "f" | "no" | "n" | "off" => Ok(false),
        _ => Err(validation_error(
            "query",
            field,
            Value::String(raw.clone()),
            "bool_parsing",
            "Input should be a valid boolean",
            None,
        )),
    }
}

fn parse_datetime(raw: &str) -> Option<NaiveDateTime> {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(raw) {
        return Some(datetime.with_timezone(&Utc).naive_utc());
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(datetime) = NaiveDateTime::parse_from_str(raw, format) {
            return Some(datetime);
        }
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
}

fn query_datetime(
    values: &std::collections::HashMap<String, String>,
    field: &str,
) -> Result<Option<String>, HttpValidationError> {
    let Some(raw) = values.get(field) else {
        return Ok(None);
    };
    if parse_datetime(raw).is_none() {
        return Err(validation_error(
            "query",
            field,
            Value::String(raw.clone()),
            "datetime_parsing",
            "Input should be a valid datetime or date",
            None,
        ));
    }
    Ok(Some(raw.clone()))
}

fn query_layout(
    values: &std::collections::HashMap<String, String>,
) -> Result<AtlasLayout, HttpValidationError> {
    match values.get("layout").map(String::as_str) {
        None | Some("clustered") => Ok(AtlasLayout::Clustered),
        Some("ownership") => Ok(AtlasLayout::Ownership),
        Some("geography") => Ok(AtlasLayout::Geography),
        Some("radial") => Ok(AtlasLayout::Radial),
        Some(raw) => Err(validation_error(
            "query",
            "layout",
            Value::String(raw.to_owned()),
            "literal_error",
            "Input should be 'clustered', 'ownership', 'geography' or 'radial'",
            Some(Map::from_iter([(
                "expected".to_owned(),
                Value::String("'clustered', 'ownership', 'geography' or 'radial'".to_owned()),
            )])),
        )),
    }
}

fn query_graph_filters(
    values: &std::collections::HashMap<String, String>,
) -> Result<AtlasGraphFiltersInput, Rejection> {
    let entity_types = parse_entity_types(values.get("entity_types"))?;
    let relation_types = parse_relation_types(values.get("relation_types"))?;
    let q = query_optional_string(values, "q", Some(200)).map_err(IntoResponse::into_response)?;
    let selected = query_optional_string(values, "selected", Some(160))
        .map_err(IntoResponse::into_response)?
        .map(|value| {
            value
                .strip_prefix("source:")
                .map_or(value.clone(), |suffix| format!("outlet:{suffix}"))
        });
    let neighbors = wiki::parse_integer_parameter(values, "neighbors", 0, 0, Some(2))
        .map_err(IntoResponse::into_response)?;
    let limit_nodes = wiki::parse_integer_parameter(values, "limit_nodes", 350, 1, Some(600))
        .map_err(IntoResponse::into_response)?;
    let limit_edges = wiki::parse_integer_parameter(values, "limit_edges", 1500, 1, Some(2500))
        .map_err(IntoResponse::into_response)?;
    let layout = query_layout(values).map_err(IntoResponse::into_response)?;
    let min_confidence = query_float(values, "min_confidence", 0.0, 0.0, 1.0)
        .map_err(IntoResponse::into_response)?;
    let include_evidence_preview = query_bool(values, "include_evidence_preview", true)
        .map_err(IntoResponse::into_response)?;
    let accepted_only =
        query_bool(values, "accepted_only", false).map_err(IntoResponse::into_response)?;
    let as_of = query_datetime(values, "as_of").map_err(IntoResponse::into_response)?;
    let known_at = query_datetime(values, "known_at").map_err(IntoResponse::into_response)?;
    Ok(AtlasGraphFiltersInput {
        q,
        entity_types,
        relation_types,
        country: split_csv(values.get("country")),
        funding: split_csv(values.get("funding")),
        bias: split_csv(values.get("bias")),
        min_confidence,
        selected,
        neighbors,
        layout,
        limit_nodes: Some(limit_nodes),
        limit_edges,
        include_evidence_preview,
        as_of,
        known_at,
        accepted_only,
    })
}

struct AtlasIndexQuery {
    entity_types: Vec<AtlasEntityType>,
    query: Option<String>,
    country: Vec<String>,
    funding: Vec<String>,
    bias: Vec<String>,
    kind: Vec<String>,
    sort: AtlasIndexSort,
    cursor: Option<String>,
    limit: i64,
}

fn query_index_sort(
    values: &std::collections::HashMap<String, String>,
) -> Result<AtlasIndexSort, HttpValidationError> {
    match values.get("sort").map(String::as_str) {
        None | Some("name") => Ok(AtlasIndexSort::Name),
        Some("most_connected") => Ok(AtlasIndexSort::MostConnected),
        Some("most_articles") => Ok(AtlasIndexSort::MostArticles),
        Some("recently_indexed") => Ok(AtlasIndexSort::RecentlyIndexed),
        Some("lowest_confidence") => Ok(AtlasIndexSort::LowestConfidence),
        Some(raw) => Err(validation_error(
            "query",
            "sort",
            Value::String(raw.to_owned()),
            "literal_error",
            "Input should be 'name', 'most_connected', 'most_articles', 'recently_indexed' or 'lowest_confidence'",
            Some(Map::from_iter([(
                "expected".to_owned(),
                Value::String("'name', 'most_connected', 'most_articles', 'recently_indexed' or 'lowest_confidence'".to_owned()),
            )])),
        )),
    }
}

fn query_index(
    values: &std::collections::HashMap<String, String>,
) -> Result<AtlasIndexQuery, Rejection> {
    Ok(AtlasIndexQuery {
        entity_types: parse_entity_types(values.get("entity_types"))?,
        query: query_optional_string(values, "q", Some(200))
            .map_err(IntoResponse::into_response)?,
        country: split_csv(values.get("country")),
        funding: split_csv(values.get("funding")),
        bias: split_csv(values.get("bias")),
        kind: split_csv(values.get("kind")),
        sort: query_index_sort(values).map_err(IntoResponse::into_response)?,
        cursor: query_optional_string(values, "cursor", Some(100))
            .map_err(IntoResponse::into_response)?,
        limit: wiki::parse_integer_parameter(values, "limit", 60, 1, Some(100))
            .map_err(IntoResponse::into_response)?,
    })
}

fn query_search(
    values: &std::collections::HashMap<String, String>,
) -> Result<(String, i64), HttpValidationError> {
    Ok((
        query_required_string(values, "q", 1, 200)?,
        wiki::parse_integer_parameter(values, "limit", 8, 1, Some(20))?,
    ))
}

fn query_source_name(
    values: &std::collections::HashMap<String, String>,
) -> Result<Option<String>, HttpValidationError> {
    query_optional_string(values, "source_name", Some(200))
}

fn validate_export_filters(filters: &AtlasGraphFiltersInput) -> Result<(), HttpValidationError> {
    let value = filters.min_confidence;
    if !value.is_finite() || value < 0.0 || value > 1.0 {
        return Err(validation_error(
            "body",
            "filters.min_confidence",
            serde_json::Number::from_f64(value)
                .map(Value::Number)
                .unwrap_or(Value::Null),
            if value > 1.0 {
                "less_than_equal"
            } else {
                "greater_than_equal"
            },
            "Input should be between 0 and 1",
            Some(Map::from_iter([
                ("ge".to_owned(), Value::from(0.0)),
                ("le".to_owned(), Value::from(1.0)),
            ])),
        ));
    }
    if !(0..=2).contains(&filters.neighbors) {
        return Err(validation_error(
            "body",
            "filters.neighbors",
            Value::from(filters.neighbors),
            if filters.neighbors < 0 {
                "greater_than_equal"
            } else {
                "less_than_equal"
            },
            "Input should be between 0 and 2",
            Some(Map::from_iter([
                ("ge".to_owned(), Value::from(0)),
                ("le".to_owned(), Value::from(2)),
            ])),
        ));
    }
    if let Some(limit) = filters
        .limit_nodes
        .filter(|limit| !(1..=600).contains(limit))
    {
        return Err(validation_error(
            "body",
            "filters.limit_nodes",
            Value::from(limit),
            if limit < 1 {
                "greater_than_equal"
            } else {
                "less_than_equal"
            },
            "Input should be between 1 and 600",
            Some(Map::from_iter([
                ("ge".to_owned(), Value::from(1)),
                ("le".to_owned(), Value::from(600)),
            ])),
        ));
    }
    if !(1..=2500).contains(&filters.limit_edges) {
        return Err(validation_error(
            "body",
            "filters.limit_edges",
            Value::from(filters.limit_edges),
            if filters.limit_edges < 1 {
                "greater_than_equal"
            } else {
                "less_than_equal"
            },
            "Input should be between 1 and 2500",
            Some(Map::from_iter([
                ("ge".to_owned(), Value::from(1)),
                ("le".to_owned(), Value::from(2500)),
            ])),
        ));
    }
    for (name, raw) in [
        ("as_of", filters.as_of.as_deref()),
        ("known_at", filters.known_at.as_deref()),
    ] {
        if let Some(raw) = raw.filter(|raw| parse_datetime(raw).is_none()) {
            let field = format!("filters.{name}");
            return Err(validation_error(
                "body",
                &field,
                Value::String(raw.to_owned()),
                "datetime_parsing",
                "Input should be a valid datetime or date",
                None,
            ));
        }
    }
    Ok(())
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/wiki/atlas/ingestion-status",
            get(get_atlas_ingestion_status),
        )
        .route(
            "/api/wiki/atlas/analysis/funding-bias",
            get(get_funding_bias_analysis),
        )
        .route(
            "/api/wiki/atlas/analysis/media-measurements",
            get(get_media_measurements),
        )
        .route("/api/wiki/atlas/graph", get(get_graph))
        .route(
            "/api/wiki/atlas/entities/{entity_id}/connections",
            get(get_connections),
        )
        .route("/api/wiki/atlas/index", get(get_atlas_index))
        .route("/api/wiki/atlas/export", post(export_atlas))
        .route("/api/wiki/atlas/search", get(get_atlas_search))
        .route("/api/wiki/atlas/stats", get(get_atlas_stats))
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/ingestion-status",
    operation_id = "get_atlas_ingestion_status_api_wiki_atlas_ingestion_status_get",
    params(AtlasIngestStatusParameters),
    responses(
        (status = 200, description = "Successful Response", body = AtlasIngestStatusResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki-atlas",
    summary = "Get Atlas Ingestion Status",
    description = "Return adapter freshness, partial runs, credentials, and retryable failures."
)]
pub(crate) async fn get_atlas_ingestion_status(
    State(state): State<AppState>,
    uri: Uri,
) -> Response {
    let values = match wiki::query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match wiki::parse_integer_parameter(&values, "limit", 40, 1, Some(200)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let params = AtlasIngestStatusParameters { limit };
    let rows = match state.database.wiki_ingest_runs(params.limit).await {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match ingest_status_response(rows) {
        Ok(response) => Json(response).into_response(),
        Err(()) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/analysis/funding-bias",
    operation_id = "get_funding_bias_analysis_api_wiki_atlas_analysis_funding_bias_get",
    responses((status = 200, description = "Successful Response", body = FundingBiasAnalysisResponse)),
    tag = "wiki-atlas",
    summary = "Get Funding Bias Analysis",
    description = "Return the latest pre-registered funding-vs-bias correlation trace.\n\nRead-only -- `available=False` (an otherwise-empty response, not a 404/500) when `app.scripts.run_funding_bias_analysis` has never run against this database."
)]
pub(crate) async fn get_funding_bias_analysis(State(state): State<AppState>) -> Response {
    match state.database.wiki_funding_bias_data().await {
        Ok(None) => Json(FundingBiasAnalysisResponse {
            available: false,
            methodology: None,
            statistic: None,
            trace_id: None,
            algorithm_version: None,
            computed_at: None,
            population_size: 0,
            validation_card_skip_reason: None,
        })
        .into_response(),
        Ok(Some(data)) => match funding_bias_response(data) {
            Ok(response) => Json(response).into_response(),
            Err(()) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::{freshness_label, funding_statistic, AtlasFreshness};
    use chrono::{Duration, Utc};
    use serde_json::json;

    #[test]
    fn funding_statistic_uses_persisted_trace_projection() {
        let result = json!({
            "n": 3,
            "table": [[1, 2], [0, 0]],
            "chi_square": 0.5,
            "degrees_of_freedom": 1,
            "cramers_v": 0.4,
            "interpretation": "moderate association",
            "note": null
        });
        let subgraph = json!({"rows": ["commercial", "non-profit"], "cols": ["center", "right"]});
        let response = funding_statistic(&result, &subgraph).unwrap();
        assert_eq!(response.n, 3);
        assert_eq!(response.rows, ["commercial", "non-profit"]);
        assert_eq!(response.table, [vec![1, 2], vec![0, 0]]);
        assert_eq!(response.chi_square, Some(0.5));
        assert_eq!(
            response.interpretation.as_deref(),
            Some("moderate association")
        );
    }

    #[test]
    fn ingestion_freshness_prioritizes_running_then_incomplete_then_age() {
        let now = Utc::now().naive_utc();
        assert!(matches!(
            freshness_label(&["success"], Some(now)),
            AtlasFreshness::Fresh
        ));
        assert!(matches!(
            freshness_label(&["partial"], Some(now)),
            AtlasFreshness::Partial
        ));
        assert!(matches!(
            freshness_label(&["running"], Some(now)),
            AtlasFreshness::Running
        ));
        assert!(matches!(
            freshness_label(&[], Some(now - Duration::hours(30))),
            AtlasFreshness::Stale
        ));
        assert!(matches!(freshness_label(&[], None), AtlasFreshness::Never));
    }
}
