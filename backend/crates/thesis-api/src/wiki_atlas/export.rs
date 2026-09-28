use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, NaiveDateTime, Timelike, Utc};
use serde::ser::SerializeSeq;
use serde::{Serialize, Serializer};
use serde_json::{Map, Value};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

use super::graph::{build_response, project};
use super::{
    AtlasConfidenceTier, AtlasDirection, AtlasEdgeResponse, AtlasEntityType,
    AtlasEvidenceRefResponse, AtlasExportFormat, AtlasExportRequest, AtlasFactStatus,
    AtlasGraphFiltersInput, AtlasGraphResponse, AtlasLifecycleState, AtlasNodeResponse,
    AtlasRelationType,
};

const NODE_COLUMNS: [&str; 12] = [
    "id",
    "entity_type",
    "label",
    "subtitle",
    "country_code",
    "funding_type",
    "bias_rating",
    "article_count",
    "connection_count",
    "status",
    "confidence_tier",
    "updated_at",
];
const RELATIONSHIP_COLUMNS: [&str; 13] = [
    "id",
    "source_id",
    "target_id",
    "relation_type",
    "raw_relation_type",
    "confidence",
    "confidence_tier",
    "evidence_count",
    "ownership_percentage",
    "valid_from",
    "valid_to",
    "last_verified_at",
    "is_inferred",
];
const EVIDENCE_COLUMNS: [&str; 7] = [
    "id",
    "relationship_id",
    "source_type",
    "source_name",
    "source_url",
    "retrieved_at",
    "excerpt",
];

#[derive(Serialize)]
struct AtlasJsonExport<'a> {
    schema_version: &'static str,
    generated_at: String,
    graph_version: &'a str,
    filters: &'a AtlasGraphFiltersInput,
    selected_entity: Option<&'a str>,
    nodes: AtlasNodeListJson<'a>,
    relationships: AtlasEdgeListJson<'a>,
    evidence: AtlasEvidenceRefsJson<'a>,
    layout_positions: &'a BTreeMap<String, BTreeMap<String, f64>>,
    truncated: bool,
    truncation_reason: Option<&'a str>,
}

#[derive(Serialize)]
struct AtlasEvidenceJson<'a> {
    id: &'a str,
    source_type: &'a str,
    source_name: Option<&'a str>,
    source_url: Option<&'a str>,
    retrieved_at: Option<PythonDatetime<'a>>,
    excerpt: Option<&'a str>,
    snapshot_sha256: Option<&'a str>,
    locator: &'a serde_json::Value,
    entailment: Option<&'a str>,
    evidence_class: Option<&'a str>,
    policy_version: Option<&'a str>,
    acceptance_decision: Option<&'a str>,
    contradictions: &'a [String],
}

impl<'a> From<&'a AtlasEvidenceRefResponse> for AtlasEvidenceJson<'a> {
    fn from(evidence: &'a AtlasEvidenceRefResponse) -> Self {
        Self {
            id: &evidence.id,
            source_type: &evidence.source_type,
            source_name: evidence.source_name.as_deref(),
            source_url: evidence.source_url.as_deref(),
            retrieved_at: evidence.retrieved_at.as_ref().map(PythonDatetime),
            excerpt: evidence.excerpt.as_deref(),
            snapshot_sha256: evidence.snapshot_sha256.as_deref(),
            locator: &evidence.locator,
            entailment: evidence.entailment.as_deref(),
            evidence_class: evidence.evidence_class.as_deref(),
            policy_version: evidence.policy_version.as_deref(),
            acceptance_decision: evidence.acceptance_decision.as_deref(),
            contradictions: &evidence.contradictions,
        }
    }
}

struct PythonDatetime<'a>(&'a NaiveDateTime);

impl Serialize for PythonDatetime<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&naive_datetime_iso(*self.0))
    }
}

#[derive(Serialize)]
struct AtlasNodeJson<'a> {
    id: &'a str,
    entity_type: AtlasEntityType,
    label: &'a str,
    subtitle: Option<&'a str>,
    country_code: Option<&'a str>,
    funding_type: Option<&'a str>,
    bias_rating: Option<&'a str>,
    factual_reporting: Option<&'a str>,
    credibility_score: Option<f64>,
    analysis_scores: &'a BTreeMap<String, i32>,
    article_count: i64,
    connection_count: i64,
    ownership_connection_count: i64,
    status: Option<&'a str>,
    confidence_tier: Option<AtlasConfidenceTier>,
    profile_path: Option<&'a str>,
    updated_at: Option<PythonDatetime<'a>>,
    flags: &'a [String],
    current_parent: Option<&'a str>,
    pending_change: Option<&'a str>,
    evidence_coverage: &'a str,
    freshness: &'a str,
    unresolved_gap: Option<&'a str>,
}

impl<'a> From<&'a AtlasNodeResponse> for AtlasNodeJson<'a> {
    fn from(node: &'a AtlasNodeResponse) -> Self {
        Self {
            id: &node.id,
            entity_type: node.entity_type,
            label: &node.label,
            subtitle: node.subtitle.as_deref(),
            country_code: node.country_code.as_deref(),
            funding_type: node.funding_type.as_deref(),
            bias_rating: node.bias_rating.as_deref(),
            factual_reporting: node.factual_reporting.as_deref(),
            credibility_score: node.credibility_score,
            analysis_scores: &node.analysis_scores,
            article_count: node.article_count,
            connection_count: node.connection_count,
            ownership_connection_count: node.ownership_connection_count,
            status: node.status.as_deref(),
            confidence_tier: node.confidence_tier,
            profile_path: node.profile_path.as_deref(),
            updated_at: node.updated_at.as_ref().map(PythonDatetime),
            flags: &node.flags,
            current_parent: node.current_parent.as_deref(),
            pending_change: node.pending_change.as_deref(),
            evidence_coverage: &node.evidence_coverage,
            freshness: &node.freshness,
            unresolved_gap: node.unresolved_gap.as_deref(),
        }
    }
}

#[derive(Serialize)]
struct AtlasEdgeJson<'a> {
    id: &'a str,
    source_id: &'a str,
    target_id: &'a str,
    relation_type: AtlasRelationType,
    predicate: &'a str,
    display_group: &'a str,
    relation_type_deprecated: bool,
    direction: AtlasDirection,
    weight: f64,
    ownership_percentage: Option<f64>,
    voting_interest: Option<&'a serde_json::Value>,
    economic_interest: Option<&'a serde_json::Value>,
    beneficial_interest: Option<&'a serde_json::Value>,
    confidence: Option<f64>,
    confidence_tier: Option<AtlasConfidenceTier>,
    evidence_count: i64,
    evidence_preview: AtlasEvidenceSliceJson<'a>,
    valid_from: Option<PythonDatetime<'a>>,
    valid_to: Option<PythonDatetime<'a>>,
    last_verified_at: Option<PythonDatetime<'a>>,
    is_inferred: bool,
    raw_relation_type: Option<&'a str>,
    fact_status: AtlasFactStatus,
    lifecycle_state: AtlasLifecycleState,
    accepted_fact: bool,
    qualifiers: &'a serde_json::Value,
    claim_ids: &'a [String],
    recorded_at: Option<PythonDatetime<'a>>,
    retracted_at: Option<PythonDatetime<'a>>,
    acceptance_policy_version: Option<&'a str>,
    evidence_root_count: i64,
}

impl<'a> From<&'a AtlasEdgeResponse> for AtlasEdgeJson<'a> {
    fn from(edge: &'a AtlasEdgeResponse) -> Self {
        Self {
            id: &edge.id,
            source_id: &edge.source_id,
            target_id: &edge.target_id,
            relation_type: edge.relation_type,
            predicate: &edge.predicate,
            display_group: &edge.display_group,
            relation_type_deprecated: edge.relation_type_deprecated,
            direction: edge.direction,
            weight: edge.weight,
            ownership_percentage: edge.ownership_percentage,
            voting_interest: edge.voting_interest.as_ref(),
            economic_interest: edge.economic_interest.as_ref(),
            beneficial_interest: edge.beneficial_interest.as_ref(),
            confidence: edge.confidence,
            confidence_tier: edge.confidence_tier,
            evidence_count: edge.evidence_count,
            evidence_preview: AtlasEvidenceSliceJson(&edge.evidence_preview),
            valid_from: edge.valid_from.as_ref().map(PythonDatetime),
            valid_to: edge.valid_to.as_ref().map(PythonDatetime),
            last_verified_at: edge.last_verified_at.as_ref().map(PythonDatetime),
            is_inferred: edge.is_inferred,
            raw_relation_type: edge.raw_relation_type.as_deref(),
            fact_status: edge.fact_status,
            lifecycle_state: edge.lifecycle_state,
            accepted_fact: edge.accepted_fact,
            qualifiers: &edge.qualifiers,
            claim_ids: &edge.claim_ids,
            recorded_at: edge.recorded_at.as_ref().map(PythonDatetime),
            retracted_at: edge.retracted_at.as_ref().map(PythonDatetime),
            acceptance_policy_version: edge.acceptance_policy_version.as_deref(),
            evidence_root_count: edge.evidence_root_count,
        }
    }
}

struct AtlasNodeListJson<'a>(&'a [AtlasNodeResponse]);
struct AtlasEdgeListJson<'a>(&'a [AtlasEdgeResponse]);
struct AtlasEvidenceSliceJson<'a>(&'a [AtlasEvidenceRefResponse]);
struct AtlasEvidenceRefsJson<'a>(&'a [&'a AtlasEvidenceRefResponse]);

impl Serialize for AtlasNodeListJson<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for node in self.0 {
            sequence.serialize_element(&AtlasNodeJson::from(node))?;
        }
        sequence.end()
    }
}

impl Serialize for AtlasEdgeListJson<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for edge in self.0 {
            sequence.serialize_element(&AtlasEdgeJson::from(edge))?;
        }
        sequence.end()
    }
}

impl Serialize for AtlasEvidenceSliceJson<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for evidence in self.0 {
            sequence.serialize_element(&AtlasEvidenceJson::from(evidence))?;
        }
        sequence.end()
    }
}

impl Serialize for AtlasEvidenceRefsJson<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for evidence in self.0 {
            sequence.serialize_element(&AtlasEvidenceJson::from(*evidence))?;
        }
        sequence.end()
    }
}

fn json_decode_error(error: serde_json::Error) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![ValidationLocation::Text("body".to_owned())],
            msg: "JSON decode error".to_owned(),
            error_type: "json_invalid".to_owned(),
            input: Value::Null,
            ctx: Some(Map::from_iter([(
                "error".to_owned(),
                Value::String(error.to_string()),
            )])),
        }],
    }
}

fn parse_export_request(body: &[u8]) -> Result<AtlasExportRequest, HttpValidationError> {
    let request: AtlasExportRequest = serde_json::from_slice(body).map_err(json_decode_error)?;
    super::validate_export_filters(&request.filters)?;
    Ok(request)
}
#[utoipa::path(
    post,
    path = "/api/wiki/atlas/export",
    operation_id = "export_atlas_api_wiki_atlas_export_post",
    request_body = AtlasExportRequest,
    responses(
        (status = 200, description = "JSON or CSV export attachment; media type is selected by format"),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki-atlas",
    summary = "Export Atlas Graph",
    description = "Download the bounded Atlas graph as JSON or one of the CSV exports."
)]
pub(crate) async fn export_atlas(State(state): State<AppState>, body: Bytes) -> Response {
    let request = match parse_export_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };

    let AtlasExportRequest {
        mut filters,
        selected_entity,
        format,
        include_evidence,
        visible_layout_positions,
    } = request;

    apply_export_overrides(&mut filters, selected_entity.as_deref(), include_evidence);
    normalize_filter_datetimes(&mut filters);

    let generated_at = Utc::now();
    let as_of = filters
        .as_of
        .as_deref()
        .and_then(super::parse_datetime)
        .unwrap_or_else(|| generated_at.naive_utc());
    let known_at = filters
        .known_at
        .as_deref()
        .and_then(super::parse_datetime)
        .unwrap_or_else(|| generated_at.naive_utc());
    let reporters_enabled = filters.entity_types.is_empty()
        || filters
            .entity_types
            .iter()
            .any(|entity_type| matches!(entity_type, AtlasEntityType::Reporter))
        || filters
            .selected
            .as_deref()
            .is_some_and(|selected| selected.starts_with("reporter:"));
    let reporter_limit = if reporters_enabled {
        filters.limit_nodes.map(|limit| limit.clamp(50, 600))
    } else {
        Some(0)
    };
    let projection = match state
        .database
        .load_atlas_projection_data(as_of, known_at, reporter_limit)
        .await
    {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let graph_data = project(&projection, &filters, as_of, known_at);
    let graph = build_response(graph_data, filters, generated_at);

    match render_export_response(
        &graph,
        format,
        selected_entity.as_deref(),
        visible_layout_positions.as_ref(),
    ) {
        Ok(response) => response,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn apply_export_overrides(
    filters: &mut AtlasGraphFiltersInput,
    selected_entity: Option<&str>,
    include_evidence: bool,
) {
    if let Some(selected_entity) = selected_entity.filter(|selected| !selected.is_empty()) {
        filters.selected = Some(selected_entity.to_owned());
    }
    filters.include_evidence_preview = include_evidence;
}

fn normalize_filter_datetimes(filters: &mut AtlasGraphFiltersInput) {
    filters.as_of = filters.as_of.as_deref().map(normalize_datetime_input);
    filters.known_at = filters.known_at.as_deref().map(normalize_datetime_input);
}

fn normalize_datetime_input(raw: &str) -> String {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(raw) {
        let local = naive_datetime_iso(datetime.naive_local());
        return format!("{local}{}", datetime.format("%:z"));
    }
    naive_datetime_iso(super::parse_datetime(raw).expect("validated Atlas export datetime"))
}

fn render_export_response(
    graph: &AtlasGraphResponse,
    format: AtlasExportFormat,
    selected_entity: Option<&str>,
    visible_layout_positions: Option<&BTreeMap<String, BTreeMap<String, f64>>>,
) -> Result<Response, serde_json::Error> {
    let (media_type, disposition, body) = match format {
        AtlasExportFormat::Json => (
            "application/json",
            "attachment; filename=\"atlas-investigation.json\"",
            json_export_bytes(graph, selected_entity, visible_layout_positions)?,
        ),
        AtlasExportFormat::CsvNodes => (
            "text/csv; charset=utf-8",
            "attachment; filename=\"atlas-entities.csv\"",
            csv_nodes(graph),
        ),
        AtlasExportFormat::CsvRelationships => (
            "text/csv; charset=utf-8",
            "attachment; filename=\"atlas-relationships.csv\"",
            csv_relationships(graph),
        ),
        AtlasExportFormat::CsvEvidence => (
            "text/csv; charset=utf-8",
            "attachment; filename=\"atlas-evidence.csv\"",
            csv_evidence(graph),
        ),
    };
    let mut response = Response::new(Body::from(body));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(media_type));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static(disposition),
    );
    Ok(response)
}

fn json_export_bytes(
    graph: &AtlasGraphResponse,
    selected_entity: Option<&str>,
    visible_layout_positions: Option<&BTreeMap<String, BTreeMap<String, f64>>>,
) -> Result<Vec<u8>, serde_json::Error> {
    let empty_layout_positions = BTreeMap::new();
    let layout_positions = visible_layout_positions.unwrap_or(&empty_layout_positions);
    let evidence_capacity = graph.edges.len().saturating_mul(3);
    let mut evidence_by_id = Vec::with_capacity(evidence_capacity);
    let mut evidence_positions = HashMap::with_capacity(evidence_capacity);
    for evidence in graph.edges.iter().flat_map(|edge| &edge.evidence_preview) {
        if let Some(index) = evidence_positions.get(evidence.id.as_str()).copied() {
            evidence_by_id[index] = evidence;
        } else {
            evidence_positions.insert(evidence.id.as_str(), evidence_by_id.len());
            evidence_by_id.push(evidence);
        }
    }

    let payload = AtlasJsonExport {
        schema_version: "1.0",
        generated_at: aware_datetime_iso(graph.generated_at),
        graph_version: &graph.graph_version,
        filters: &graph.applied_filters,
        selected_entity,
        nodes: AtlasNodeListJson(&graph.nodes),
        relationships: AtlasEdgeListJson(&graph.edges),
        evidence: AtlasEvidenceRefsJson(&evidence_by_id),
        layout_positions,
        truncated: graph.truncated,
        truncation_reason: graph.truncation_reason.as_deref(),
    };
    serde_json::to_vec_pretty(&payload)
}

fn csv_nodes(graph: &AtlasGraphResponse) -> Vec<u8> {
    let rows = graph.nodes.iter().map(|node| {
        [
            CsvField::Text(&node.id),
            CsvField::Text(entity_type_name(node.entity_type)),
            CsvField::Text(&node.label),
            optional_text(node.subtitle.as_deref()),
            optional_text(node.country_code.as_deref()),
            optional_text(node.funding_type.as_deref()),
            optional_text(node.bias_rating.as_deref()),
            CsvField::Integer(node.article_count),
            CsvField::Integer(node.connection_count),
            optional_text(node.status.as_deref()),
            CsvField::Text(node.confidence_tier.map(confidence_tier_name).unwrap_or("")),
            CsvField::Date(node.updated_at.as_ref()),
        ]
    });
    csv_bytes(NODE_COLUMNS, rows)
}

fn csv_relationships(graph: &AtlasGraphResponse) -> Vec<u8> {
    let rows = graph.edges.iter().map(|edge| {
        [
            CsvField::Text(&edge.id),
            CsvField::Text(&edge.source_id),
            CsvField::Text(&edge.target_id),
            CsvField::Text(relation_type_name(edge.relation_type)),
            optional_text(edge.raw_relation_type.as_deref()),
            optional_float(edge.confidence),
            CsvField::Text(edge.confidence_tier.map(confidence_tier_name).unwrap_or("")),
            CsvField::Integer(edge.evidence_count),
            optional_float(edge.ownership_percentage),
            CsvField::Date(edge.valid_from.as_ref()),
            CsvField::Date(edge.valid_to.as_ref()),
            CsvField::Date(edge.last_verified_at.as_ref()),
            CsvField::Boolean(edge.is_inferred),
        ]
    });
    csv_bytes(RELATIONSHIP_COLUMNS, rows)
}

fn csv_evidence(graph: &AtlasGraphResponse) -> Vec<u8> {
    let rows = graph.edges.iter().flat_map(|edge| {
        edge.evidence_preview.iter().map(move |evidence| {
            [
                CsvField::Text(&evidence.id),
                CsvField::Text(&edge.id),
                CsvField::Text(&evidence.source_type),
                optional_text(evidence.source_name.as_deref()),
                optional_text(evidence.source_url.as_deref()),
                CsvField::Date(evidence.retrieved_at.as_ref()),
                optional_text(evidence.excerpt.as_deref()),
            ]
        })
    });
    csv_bytes(EVIDENCE_COLUMNS, rows)
}

#[derive(Clone, Copy)]
enum CsvField<'a> {
    Text(&'a str),
    Float(f64),
    Integer(i64),
    Boolean(bool),
    Date(Option<&'a NaiveDateTime>),
}

fn optional_text(value: Option<&str>) -> CsvField<'_> {
    CsvField::Text(value.unwrap_or(""))
}

fn optional_float(value: Option<f64>) -> CsvField<'static> {
    value.map_or(CsvField::Text(""), CsvField::Float)
}

fn csv_bytes<'a, const N: usize, I>(headers: [&'static str; N], rows: I) -> Vec<u8>
where
    I: Iterator<Item = [CsvField<'a>; N]>,
{
    let mut output = String::new();
    write_csv_row(&mut output, headers.map(CsvField::Text));
    for row in rows {
        write_csv_row(&mut output, row);
    }
    output.into_bytes()
}

fn write_csv_row<'a, const N: usize>(output: &mut String, fields: [CsvField<'a>; N]) {
    for (index, field) in fields.into_iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        match field {
            CsvField::Text(value) => write_csv_text(output, value),
            CsvField::Float(value) => write_python_float(output, value),
            CsvField::Integer(value) => {
                let _ = write!(output, "{value}");
            }
            CsvField::Boolean(value) => {
                output.push_str(if value { "True" } else { "False" });
            }
            CsvField::Date(Some(value)) => write_naive_datetime(output, value),
            CsvField::Date(None) => {}
        }
    }
    output.push_str("\r\n");
}

fn write_csv_text(output: &mut String, value: &str) {
    if value
        .bytes()
        .any(|byte| matches!(byte, b',' | b'"' | b'\r' | b'\n'))
    {
        output.push('"');
        for character in value.chars() {
            if character == '"' {
                output.push_str("\"\"");
            } else {
                output.push(character);
            }
        }
        output.push('"');
    } else {
        output.push_str(value);
    }
}

fn write_python_float(output: &mut String, value: f64) {
    if write_special_float(output, value) {
        return;
    }
    if value.is_sign_negative() {
        output.push('-');
    }

    // Reposition Rust's shortest digits to match Python's notation thresholds.
    let mut digits = value.abs().to_string();
    let exponent_index = digits.find('e').or_else(|| digits.find('E'));
    let exponent = exponent_index.map_or(0, |index| {
        let exponent = digits[index + 1..]
            .parse::<i32>()
            .expect("float display exponent");
        digits.truncate(index);
        exponent
    });
    let decimal_position = digits.find('.').unwrap_or(digits.len()) as i32 + exponent;
    digits.retain(|character| character != '.');
    let first_nonzero = digits
        .bytes()
        .position(|digit| digit != b'0')
        .expect("finite nonzero float digit");
    let last_nonzero = digits
        .bytes()
        .rposition(|digit| digit != b'0')
        .expect("finite nonzero float digit");
    let significant = &digits[first_nonzero..=last_nonzero];
    let power = decimal_position - first_nonzero as i32 - 1;

    if !(-4..16).contains(&power) {
        write_scientific_float(output, significant, power);
        return;
    }
    write_fixed_float(output, significant, power);
}

fn write_special_float(output: &mut String, value: f64) -> bool {
    if value.is_nan() {
        output.push_str("nan");
        true
    } else if value.is_infinite() {
        output.push_str(if value.is_sign_negative() {
            "-inf"
        } else {
            "inf"
        });
        true
    } else if value == 0.0 {
        output.push_str(if value.is_sign_negative() {
            "-0.0"
        } else {
            "0.0"
        });
        true
    } else {
        false
    }
}

fn write_scientific_float(output: &mut String, significant: &str, power: i32) {
    output.push(significant.as_bytes()[0] as char);
    if significant.len() > 1 {
        output.push('.');
        output.push_str(&significant[1..]);
    }
    output.push('e');
    output.push(if power >= 0 { '+' } else { '-' });
    let _ = write!(output, "{:02}", power.unsigned_abs());
}

fn write_fixed_float(output: &mut String, significant: &str, power: i32) {
    let fixed_decimal_position = power + 1;
    if fixed_decimal_position <= 0 {
        output.push_str("0.");
        output.extend(std::iter::repeat_n('0', (-fixed_decimal_position) as usize));
        output.push_str(significant);
    } else if fixed_decimal_position as usize >= significant.len() {
        output.push_str(significant);
        output.extend(std::iter::repeat_n(
            '0',
            fixed_decimal_position as usize - significant.len(),
        ));
        output.push_str(".0");
    } else {
        let split = fixed_decimal_position as usize;
        output.push_str(&significant[..split]);
        output.push('.');
        output.push_str(&significant[split..]);
    }
}

fn write_naive_datetime(output: &mut String, value: &NaiveDateTime) {
    let _ = write!(output, "{}", value.format("%Y-%m-%dT%H:%M:%S"));
    let microseconds = value.nanosecond() / 1_000;
    if microseconds != 0 {
        let _ = write!(output, ".{microseconds:06}");
    }
}

fn naive_datetime_iso(value: NaiveDateTime) -> String {
    let mut output = String::new();
    write_naive_datetime(&mut output, &value);
    output
}

fn aware_datetime_iso(value: DateTime<Utc>) -> String {
    format!("{}+00:00", naive_datetime_iso(value.naive_utc()))
}

fn entity_type_name(value: AtlasEntityType) -> &'static str {
    match value {
        AtlasEntityType::Outlet => "outlet",
        AtlasEntityType::Organization => "organization",
        AtlasEntityType::Person => "person",
        AtlasEntityType::Reporter => "reporter",
    }
}

fn relation_type_name(value: AtlasRelationType) -> &'static str {
    match value {
        AtlasRelationType::Ownership => "ownership",
        AtlasRelationType::OwnedBy => "owned_by",
        AtlasRelationType::ParentOrg => "parent_org",
        AtlasRelationType::PartOf => "part_of",
        AtlasRelationType::Publishes => "publishes",
        AtlasRelationType::EmployedBy => "employed_by",
        AtlasRelationType::CurrentOutlet => "current_outlet",
        AtlasRelationType::Coauthor => "coauthor",
        AtlasRelationType::SharedOutlet => "shared_outlet",
        AtlasRelationType::FoundedBy => "founded_by",
        AtlasRelationType::SiblingViaOwner => "sibling_via_owner",
    }
}

fn confidence_tier_name(value: AtlasConfidenceTier) -> &'static str {
    match value {
        AtlasConfidenceTier::Verified => "verified",
        AtlasConfidenceTier::Strong => "strong",
        AtlasConfidenceTier::Likely => "likely",
        AtlasConfidenceTier::Unresolved => "unresolved",
        AtlasConfidenceTier::Conflicting => "conflicting",
        AtlasConfidenceTier::Stale => "stale",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use chrono::NaiveDate;
    use serde_json::json;

    fn graph(nodes: Vec<AtlasNodeResponse>, edges: Vec<AtlasEdgeResponse>) -> AtlasGraphResponse {
        AtlasGraphResponse {
            graph_version: "atlas-v1".to_owned(),
            generated_at: DateTime::<Utc>::from_timestamp(0, 123_456_000).expect("valid timestamp"),
            nodes,
            edges,
            stats: super::super::AtlasGraphStatsResponse::default(),
            applied_filters: AtlasGraphFiltersInput::default(),
            truncated: false,
            truncation_reason: None,
            next_expansion_token: None,
        }
    }

    fn node(id: &str, label: &str) -> AtlasNodeResponse {
        AtlasNodeResponse {
            id: id.to_owned(),
            entity_type: AtlasEntityType::Outlet,
            label: label.to_owned(),
            subtitle: None,
            country_code: None,
            funding_type: None,
            bias_rating: None,
            factual_reporting: None,
            credibility_score: None,
            analysis_scores: BTreeMap::new(),
            article_count: 0,
            connection_count: 0,
            ownership_connection_count: 0,
            status: None,
            confidence_tier: None,
            profile_path: None,
            updated_at: None,
            flags: Vec::new(),
            current_parent: None,
            pending_change: None,
            evidence_coverage: "not researched".to_owned(),
            freshness: "unknown".to_owned(),
            unresolved_gap: None,
        }
    }

    fn edge(id: &str) -> AtlasEdgeResponse {
        AtlasEdgeResponse {
            id: id.to_owned(),
            source_id: "source".to_owned(),
            target_id: "target".to_owned(),
            relation_type: AtlasRelationType::Ownership,
            predicate: "directly_owns".to_owned(),
            display_group: "ownership_control".to_owned(),
            relation_type_deprecated: true,
            direction: super::super::AtlasDirection::Directed,
            weight: 1.0,
            ownership_percentage: None,
            voting_interest: None,
            economic_interest: None,
            beneficial_interest: None,
            confidence: None,
            confidence_tier: None,
            evidence_count: 0,
            evidence_preview: Vec::new(),
            valid_from: None,
            valid_to: None,
            last_verified_at: None,
            is_inferred: false,
            raw_relation_type: None,
            fact_status: super::super::AtlasFactStatus::Candidate,
            lifecycle_state: super::super::AtlasLifecycleState::Current,
            accepted_fact: false,
            qualifiers: json!({}),
            claim_ids: Vec::new(),
            recorded_at: None,
            retracted_at: None,
            acceptance_policy_version: None,
            evidence_root_count: 0,
        }
    }

    fn evidence(id: &str, excerpt: &str) -> AtlasEvidenceRefResponse {
        AtlasEvidenceRefResponse {
            id: id.to_owned(),
            source_type: "registry".to_owned(),
            source_name: None,
            source_url: None,
            retrieved_at: None,
            excerpt: Some(excerpt.to_owned()),
            snapshot_sha256: None,
            locator: json!({}),
            entailment: None,
            evidence_class: None,
            policy_version: None,
            acceptance_decision: None,
            contradictions: Vec::new(),
        }
    }

    async fn response_bytes(response: Response) -> Vec<u8> {
        to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body")
            .to_vec()
    }

    #[tokio::test]
    async fn csv_nodes_match_python_quoting_unicode_and_datetime_format() {
        let mut atlas_node = node("outlet:é", "Café, \"Source\"\r\nGroup");
        atlas_node.country_code = Some("FR".to_owned());
        atlas_node.bias_rating = Some("center".to_owned());
        atlas_node.article_count = 7;
        atlas_node.connection_count = 4;
        atlas_node.confidence_tier = Some(AtlasConfidenceTier::Verified);
        atlas_node.updated_at = Some(
            NaiveDate::from_ymd_opt(2024, 1, 2)
                .unwrap()
                .and_hms_micro_opt(3, 4, 5, 6_000)
                .unwrap(),
        );
        let response = render_export_response(
            &graph(vec![atlas_node], Vec::new()),
            AtlasExportFormat::CsvNodes,
            None,
            None,
        )
        .expect("CSV response");
        let actual = response_bytes(response).await;
        let expected = concat!(
            "id,entity_type,label,subtitle,country_code,funding_type,bias_rating,article_count,connection_count,status,confidence_tier,updated_at\r\n",
            "outlet:é,outlet,\"Café, \"\"Source\"\"\r\nGroup\",,FR,,center,7,4,,verified,2024-01-02T03:04:05.006000\r\n"
        );
        assert_eq!(String::from_utf8_lossy(&actual), expected);
    }

    #[tokio::test]
    async fn csv_relationships_keep_integral_floats_booleans_and_empty_options() {
        let timestamp = NaiveDate::from_ymd_opt(2024, 1, 2)
            .unwrap()
            .and_hms_micro_opt(3, 4, 5, 6_000)
            .unwrap();
        let mut first = edge("relation-1");
        first.raw_relation_type = Some("directly_owns".to_owned());
        first.confidence = Some(1.0);
        first.confidence_tier = Some(AtlasConfidenceTier::Verified);
        first.evidence_count = 4;
        first.ownership_percentage = Some(1.0);
        first.valid_from = Some(timestamp);
        first.last_verified_at = Some(timestamp);
        first.is_inferred = true;
        let second = edge("relation-2");
        let response = render_export_response(
            &graph(Vec::new(), vec![first, second]),
            AtlasExportFormat::CsvRelationships,
            None,
            None,
        )
        .expect("CSV response");
        let actual = response_bytes(response).await;
        let expected = concat!(
            "id,source_id,target_id,relation_type,raw_relation_type,confidence,confidence_tier,evidence_count,ownership_percentage,valid_from,valid_to,last_verified_at,is_inferred\r\n",
            "relation-1,source,target,ownership,directly_owns,1.0,verified,4,1.0,2024-01-02T03:04:05.006000,,2024-01-02T03:04:05.006000,True\r\n",
            "relation-2,source,target,ownership,,,,0,,,,,False\r\n"
        );
        assert_eq!(String::from_utf8_lossy(&actual), expected);
    }

    #[tokio::test]
    async fn csv_evidence_quotes_text_and_preserves_duplicate_edge_rows() {
        let mut first = edge("edge-first");
        let mut first_evidence = evidence("evidence-1", "Line 1,\r\n\"quoted\" — café");
        first_evidence.source_name = Some("Éditeur".to_owned());
        first_evidence.source_url = Some("https://example.test/evidence".to_owned());
        first_evidence.retrieved_at = Some(
            NaiveDate::from_ymd_opt(2024, 1, 2)
                .unwrap()
                .and_hms_micro_opt(3, 4, 5, 0)
                .unwrap(),
        );
        first.evidence_preview.push(first_evidence);
        let mut second = edge("edge-second");
        second
            .evidence_preview
            .push(evidence("evidence-1", "last duplicate"));
        let response = render_export_response(
            &graph(Vec::new(), vec![first, second]),
            AtlasExportFormat::CsvEvidence,
            None,
            None,
        )
        .expect("CSV response");
        let actual = response_bytes(response).await;
        let expected = concat!(
            "id,relationship_id,source_type,source_name,source_url,retrieved_at,excerpt\r\n",
            "evidence-1,edge-first,registry,Éditeur,https://example.test/evidence,2024-01-02T03:04:05,\"Line 1,\r\n\"\"quoted\"\" — café\"\r\n",
            "evidence-1,edge-second,registry,,,,last duplicate\r\n"
        );
        assert_eq!(String::from_utf8_lossy(&actual), expected);
    }

    #[tokio::test]
    async fn json_export_keeps_field_and_evidence_order_and_last_duplicate_value() {
        let timestamp = NaiveDate::from_ymd_opt(2024, 1, 2)
            .unwrap()
            .and_hms_micro_opt(3, 4, 5, 6_000)
            .unwrap();
        let mut first = edge("edge-first");
        first.valid_from = Some(timestamp);
        let mut first_evidence = evidence("evidence-1", "first value");
        first_evidence.retrieved_at = Some(timestamp);
        first.evidence_preview = vec![first_evidence, evidence("evidence-2", "middle value")];
        let mut second = edge("edge-second");
        let mut last_evidence = evidence("evidence-1", "last value");
        last_evidence.retrieved_at = Some(timestamp);
        second.evidence_preview.push(last_evidence);
        let mut atlas_node = node("outlet:1", "Éditeur");
        atlas_node.updated_at = Some(timestamp);
        let graph = graph(vec![atlas_node], vec![first, second]);
        let response =
            render_export_response(&graph, AtlasExportFormat::Json, Some("outlet:1"), None)
                .expect("JSON response");
        let body = response_bytes(response).await;
        let json_text = String::from_utf8(body.clone()).expect("UTF-8 JSON");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("valid JSON");
        let evidence = parsed["evidence"].as_array().expect("evidence list");
        assert_eq!(evidence.len(), 2);
        assert_eq!(evidence[0]["id"], "evidence-1");
        assert_eq!(evidence[0]["excerpt"], "last value");
        assert_eq!(evidence[1]["id"], "evidence-2");
        assert_eq!(parsed["generated_at"], "1970-01-01T00:00:00.123456+00:00");
        assert_eq!(
            parsed["nodes"][0]["updated_at"],
            "2024-01-02T03:04:05.006000"
        );
        assert_eq!(
            parsed["relationships"][0]["valid_from"],
            "2024-01-02T03:04:05.006000"
        );
        assert_eq!(evidence[0]["retrieved_at"], "2024-01-02T03:04:05.006000");
        assert_eq!(parsed["layout_positions"], json!({}));
        assert_eq!(parsed["selected_entity"], "outlet:1");
        assert!(json_text.contains("Éditeur"));
        assert!(!json_text.contains("\\u00c9"));

        let fields = [
            "\"schema_version\"",
            "\"generated_at\"",
            "\"graph_version\"",
            "\"filters\"",
            "\"selected_entity\"",
            "\"nodes\"",
            "\"relationships\"",
            "\"evidence\"",
            "\"layout_positions\"",
            "\"truncated\"",
            "\"truncation_reason\"",
        ];
        let positions: Vec<_> = fields
            .iter()
            .map(|field| json_text.find(field).expect("top-level field"))
            .collect();
        assert!(positions.windows(2).all(|pair| pair[0] < pair[1]));
    }
    #[tokio::test]
    async fn json_export_keeps_supplied_layout_positions() {
        let positions = BTreeMap::from([(
            "outlet:1".to_owned(),
            BTreeMap::from([("x".to_owned(), 1.0), ("y".to_owned(), 2.0)]),
        )]);
        let response = render_export_response(
            &graph(Vec::new(), Vec::new()),
            AtlasExportFormat::Json,
            None,
            Some(&positions),
        )
        .expect("JSON response");
        let body = response_bytes(response).await;
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("valid JSON");
        assert_eq!(parsed["layout_positions"]["outlet:1"]["x"], 1.0);
        assert_eq!(parsed["layout_positions"]["outlet:1"]["y"], 2.0);
    }

    #[test]
    fn export_overrides_match_python_truthiness_without_query_length_caps() {
        let mut filters = AtlasGraphFiltersInput {
            selected: Some("fallback:selected".to_owned()),
            q: Some("q".repeat(201)),
            ..AtlasGraphFiltersInput::default()
        };
        apply_export_overrides(&mut filters, Some(""), false);
        assert_eq!(filters.selected.as_deref(), Some("fallback:selected"));
        assert!(!filters.include_evidence_preview);
        assert!(super::super::validate_export_filters(&filters).is_ok());

        apply_export_overrides(&mut filters, Some("chosen:selected"), true);
        assert_eq!(filters.selected.as_deref(), Some("chosen:selected"));
        assert!(filters.include_evidence_preview);

        filters.selected = Some("s".repeat(161));
        assert!(super::super::validate_export_filters(&filters).is_ok());
    }

    #[test]
    fn export_validation_rejects_invalid_dates_without_query_length_constraints() {
        let filters = AtlasGraphFiltersInput {
            as_of: Some("not-a-date".to_owned()),
            ..AtlasGraphFiltersInput::default()
        };
        let error = super::super::validate_export_filters(&filters).expect_err("invalid date");
        assert_eq!(error.detail[0].loc.len(), 3);
        assert!(matches!(
            error.detail[0].loc.as_slice(),
            [
                crate::models::ValidationLocation::Text(location),
                crate::models::ValidationLocation::Text(field),
                crate::models::ValidationLocation::Text(name),
            ] if location == "body" && field == "filters" && name == "as_of"
        ));
    }

    #[test]
    fn export_body_syntax_and_validation_errors_use_422() {
        let invalid_bodies: [&[u8]; 5] = [
            b"{",
            b"[]",
            br#"{"format":"invalid"}"#,
            br#"{"filters":{"limit_edges":0}}"#,
            br#"{"filters":{"as_of":"not-a-date"}}"#,
        ];
        for body in invalid_bodies {
            let response = parse_export_request(body)
                .expect_err("invalid export request")
                .into_response();
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    #[test]
    fn each_format_returns_the_python_attachment_filename_and_media_type() {
        let graph = graph(Vec::new(), Vec::new());
        for (format, media_type, disposition) in [
            (
                AtlasExportFormat::Json,
                "application/json",
                "attachment; filename=\"atlas-investigation.json\"",
            ),
            (
                AtlasExportFormat::CsvNodes,
                "text/csv; charset=utf-8",
                "attachment; filename=\"atlas-entities.csv\"",
            ),
            (
                AtlasExportFormat::CsvRelationships,
                "text/csv; charset=utf-8",
                "attachment; filename=\"atlas-relationships.csv\"",
            ),
            (
                AtlasExportFormat::CsvEvidence,
                "text/csv; charset=utf-8",
                "attachment; filename=\"atlas-evidence.csv\"",
            ),
        ] {
            let response = render_export_response(&graph, format, None, None).expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()[header::CONTENT_TYPE]
                    .to_str()
                    .expect("content type"),
                media_type
            );
            assert_eq!(
                response.headers()[header::CONTENT_DISPOSITION]
                    .to_str()
                    .expect("content disposition"),
                disposition
            );
        }
    }

    #[test]
    fn float_csv_text_matches_python_integral_and_exponent_forms() {
        let python_float_string = |value| {
            let mut output = String::new();
            write_python_float(&mut output, value);
            output
        };
        assert_eq!(python_float_string(1.0), "1.0");
        assert_eq!(python_float_string(-0.0), "-0.0");
        assert_eq!(python_float_string(0.0001), "0.0001");
        assert_eq!(python_float_string(0.00001), "1e-05");
        assert_eq!(python_float_string(1e15), "1000000000000000.0");
        assert_eq!(python_float_string(1e16), "1e+16");
    }
}
