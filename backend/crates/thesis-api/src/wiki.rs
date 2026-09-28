use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDateTime;
use serde::Serialize;
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, AnyOfBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

#[path = "wiki_indexing.rs"]
mod indexing;
pub use indexing::{
    ReporterEnrichment, ReporterEnrichmentError, ReporterEnrichmentProvider,
    ReporterEnrichmentRequest, WikiIndexError, WikiIndexFuture, WikiIndexer, WikiIndexingState,
    WikiReporterIndexMode, WikiReporterIndexPhase, WikiReporterIndexRequest,
    WikiReporterIndexResponse, WikiReporterIndexResult, WikiSourceIndexConfig,
    WikiSourceIndexRequest, WikiSourceIndexResponse,
};

/// Provider boundaries composed by the host for wiki write and dossier read operations.
#[derive(Clone, Default)]
pub struct WikiState {
    indexing: WikiIndexingState,
    enrichment: indexing::ReporterEnrichmentState,
}

impl WikiState {
    /// Construct wiki state with the real synchronous indexing provider available to the host.
    pub fn new(indexer: Option<Arc<dyn WikiIndexer>>) -> Self {
        Self {
            indexing: WikiIndexingState::new(indexer),
            enrichment: indexing::ReporterEnrichmentState::default(),
        }
    }

    /// Attach the separate read-time byline, Atlas, and article-activity provider.
    pub fn with_enrichment(mut self, provider: Arc<dyn ReporterEnrichmentProvider>) -> Self {
        self.enrichment = indexing::ReporterEnrichmentState::new(Some(provider));
        self
    }

    /// Whether source and reporter indexing routes have a real provider.
    pub fn indexing_is_configured(&self) -> bool {
        self.indexing.is_configured()
    }

    /// Whether reporter dossier enrichments have a real provider.
    pub fn enrichment_is_configured(&self) -> bool {
        self.enrichment.is_configured()
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceCardResponse, description = "Compact source card for the wiki index grid.")]
pub(crate) struct SourceCardResponse {
    name: String,
    country: Option<String>,
    funding_type: Option<String>,
    bias_rating: Option<String>,
    category: Option<String>,
    parent_company: Option<String>,
    credibility_score: Option<f64>,
    analysis_scores: Option<BTreeMap<String, i32>>,
    index_status: Option<String>,
    last_indexed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AnalysisAxisResponse, description = "Analysis Axis Response.")]
pub(crate) struct AnalysisAxisResponse {
    axis_name: String,
    score: i32,
    confidence: Option<String>,
    prose_explanation: Option<String>,
    citations: Option<Vec<BTreeMap<String, String>>>,
    empirical_basis: Option<String>,
    scored_by: Option<String>,
    last_scored_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceLedgerMetricResponse, description = "Single transparent source-ledger metric.")]
pub(crate) struct SourceLedgerMetricResponse {
    id: String,
    label: String,
    #[schema(schema_with = ledger_metric_value_schema)]
    value: Value,
    unit: String,
    description: String,
    status: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceLedgerResponse, description = "Observed source ledger for a source wiki page.")]
pub(crate) struct SourceLedgerResponse {
    source_name: String,
    article_count: i64,
    #[schema(schema_with = free_form_object_schema)]
    paywall: Value,
    #[schema(schema_with = free_form_object_schema)]
    original_reporting: Value,
    #[schema(schema_with = free_form_object_schema)]
    wire_dependency: Value,
    #[schema(schema_with = free_form_object_schema)]
    author_transparency: Value,
    #[schema(schema_with = free_form_object_schema)]
    source_transparency: Value,
    #[schema(schema_with = free_form_object_schema)]
    rss_health: Value,
    metrics: Vec<SourceLedgerMetricResponse>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceWikiResponse, description = "Full wiki page data for a single source.")]
pub(crate) struct SourceWikiResponse {
    name: String,
    website: Option<String>,
    country: Option<String>,
    funding_type: Option<String>,
    bias_rating: Option<String>,
    category: Option<String>,
    parent_company: Option<String>,
    credibility_score: Option<f64>,
    is_state_media: Option<bool>,
    source_type: Option<String>,
    overview: Option<String>,
    match_status: Option<String>,
    wikipedia_url: Option<String>,
    wikidata_qid: Option<String>,
    wikidata_url: Option<String>,
    #[schema(required = false, default = json!([]), value_type = Vec<WikiFreeFormObjectSchema>)]
    dossier_sections: Vec<Value>,
    #[schema(required = false, default = json!([]))]
    citations: Vec<BTreeMap<String, String>>,
    search_links: Option<BTreeMap<String, String>>,
    match_explanation: Option<String>,
    #[schema(required = false, default = json!([]))]
    official_pages: Vec<BTreeMap<String, String>>,
    #[schema(schema_with = nullable_free_form_object_schema)]
    policy_transparency: Option<Value>,
    #[schema(schema_with = nullable_free_form_object_schema)]
    ads_txt: Option<Value>,
    #[schema(schema_with = nullable_free_form_object_schema)]
    sellers_json: Option<Value>,
    #[schema(required = false, default = json!([]), value_type = Vec<WikiFreeFormObjectSchema>)]
    claims: Vec<Value>,
    source_ledger: Option<SourceLedgerResponse>,
    #[schema(required = false, default = json!([]))]
    analysis_axes: Vec<AnalysisAxisResponse>,
    #[schema(required = false, default = json!([]), value_type = Vec<WikiFreeFormObjectSchema>)]
    reporters: Vec<Value>,
    #[schema(schema_with = nullable_free_form_object_schema)]
    organization: Option<Value>,
    #[schema(required = false, default = json!([]), value_type = Vec<WikiFreeFormObjectSchema>)]
    ownership_chain: Vec<Value>,
    #[schema(required = false, default = 0)]
    article_count: i64,
    #[schema(required = false, default = json!([]))]
    geographic_focus: Vec<String>,
    #[schema(required = false, default = json!([]))]
    topic_focus: Vec<String>,
    index_status: Option<String>,
    last_indexed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = ReporterCardResponse, description = "Compact reporter card for the directory.")]
pub(crate) struct ReporterCardResponse {
    id: i64,
    name: String,
    normalized_name: Option<String>,
    bio: Option<String>,
    topics: Option<Vec<String>>,
    political_leaning: Option<String>,
    leaning_confidence: Option<String>,
    article_count: i64,
    current_outlet: Option<String>,
    wikipedia_url: Option<String>,
    canonical_name: Option<String>,
    match_status: Option<String>,
    research_confidence: Option<String>,
}
#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = ReporterDossierResponse, description = "Full reporter dossier for the wiki page.")]
pub(crate) struct ReporterDossierResponse {
    id: i64,
    name: String,
    normalized_name: Option<String>,
    bio: Option<String>,
    career_history: Option<Value>,
    topics: Option<Vec<String>>,
    education: Option<Value>,
    political_leaning: Option<String>,
    leaning_confidence: Option<String>,
    leaning_sources: Option<Value>,
    twitter_handle: Option<String>,
    linkedin_url: Option<String>,
    wikipedia_url: Option<String>,
    wikidata_qid: Option<String>,
    wikidata_url: Option<String>,
    canonical_name: Option<String>,
    match_status: Option<String>,
    overview: Option<String>,
    #[schema(required = false, default = json!([]), value_type = Vec<WikiFreeFormObjectSchema>)]
    dossier_sections: Vec<Value>,
    #[schema(required = false, default = json!([]))]
    citations: Vec<BTreeMap<String, String>>,
    search_links: Option<Value>,
    match_explanation: Option<String>,
    source_patterns: Option<Value>,
    topics_avoided: Option<Value>,
    advertiser_alignment: Option<Value>,
    revolving_door: Option<Value>,
    controversies: Option<Value>,
    institutional_affiliations: Option<Value>,
    coverage_comparison: Option<Value>,
    career_timeline: Option<Value>,
    #[schema(default = 0)]
    article_count: i64,
    last_article_at: Option<String>,
    #[schema(required = false, default = json!([]), value_type = Vec<WikiFreeFormObjectSchema>)]
    recent_articles: Vec<Value>,
    activity_summary: Option<Value>,
    employer_context: Option<Value>,
    research_sources: Option<Value>,
    research_confidence: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = WikiIndexStatusResponse, description = "Wiki Index Status Response.")]
pub(crate) struct WikiIndexStatusResponse {
    #[schema(default = 0)]
    total_entries: i64,
    #[schema(default = json!({}), value_type = BTreeMap<String, i64>)]
    by_status: BTreeMap<String, i64>,
    #[schema(default = json!({}), value_type = BTreeMap<String, i64>)]
    by_type: BTreeMap<String, i64>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct SourceListParameters {
    /// Filter by ISO country code.
    #[param(required = false)]
    country: Option<String>,
    /// Filter by bias rating.
    #[param(required = false)]
    bias: Option<String>,
    /// Filter by funding type.
    #[param(required = false)]
    funding: Option<String>,
    /// Search by source name.
    #[param(required = false)]
    search: Option<String>,
    /// Sort by: name, country, bias.
    #[param(required = false, default = "name")]
    sort: String,
    #[param(required = false, default = 200, minimum = 1, maximum = 500)]
    limit: i64,
    #[param(required = false, default = 0, minimum = 0)]
    offset: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct SourceReportersParameters {
    #[param(required = false, default = 50, minimum = 1, maximum = 200)]
    limit: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct ReporterListParameters {
    /// Search by reporter name.
    #[param(required = false)]
    search: Option<String>,
    /// Filter by source/outlet.
    #[param(required = false)]
    source: Option<String>,
    /// Filter by political leaning.
    #[param(required = false)]
    leaning: Option<String>,
    #[param(required = false, default = 100, minimum = 1, maximum = 500)]
    limit: i64,
    #[param(required = false, default = 0, minimum = 0)]
    offset: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct ReporterArticlesParameters {
    #[param(required = false, default = 50, minimum = 1, maximum = 200)]
    limit: i64,
    #[param(required = false, default = 0, minimum = 0)]
    offset: i64,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct OrganizationListParameters {
    #[param(required = false, default = 100, minimum = 1, maximum = 500)]
    limit: i64,
    #[param(required = false, default = 0, minimum = 0)]
    offset: i64,
}

#[derive(Debug)]
pub(crate) struct WikiFreeFormObjectSchema;

impl PartialSchema for WikiFreeFormObjectSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(AdditionalProperties::FreeForm(true)))
            .build()
            .into()
    }
}

impl ToSchema for WikiFreeFormObjectSchema {}

fn free_form_object_schema() -> RefOr<Schema> {
    WikiFreeFormObjectSchema::schema()
}

fn nullable_free_form_object_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(free_form_object_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn ledger_metric_value_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(ObjectBuilder::new().schema_type(Type::Integer).build())
            .item(ObjectBuilder::new().schema_type(Type::Number).build())
            .build(),
    )
    .into()
}

pub(crate) fn query_values(uri: &Uri) -> Result<HashMap<String, String>, HttpValidationError> {
    Query::<HashMap<String, String>>::try_from_uri(uri)
        .map(|Query(values)| values)
        .map_err(|_| HttpValidationError {
            detail: vec![ValidationError {
                loc: vec![ValidationLocation::Text("query".to_owned())],
                msg: "Invalid query string".to_owned(),
                error_type: "query_parsing".to_owned(),
                input: Value::String(uri.query().unwrap_or_default().to_owned()),
                ctx: None,
            }],
        })
}

fn query_validation_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: String,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message,
            error_type: error_type.to_owned(),
            input,
            ctx,
        }],
    }
}

fn path_integer_validation_error(field: &str, input: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("path".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: "Input should be a valid integer, unable to parse string as an integer".to_owned(),
            error_type: "int_parsing".to_owned(),
            input: Value::String(input.to_owned()),
            ctx: None,
        }],
    }
}

pub(crate) fn parse_integer_parameter(
    values: &HashMap<String, String>,
    field: &str,
    default: i64,
    minimum: i64,
    maximum: Option<i64>,
) -> Result<i64, HttpValidationError> {
    let Some(raw) = values.get(field) else {
        return Ok(default);
    };
    let parsed = raw.trim().parse::<i64>().map_err(|_| {
        query_validation_error(
            field,
            Value::String(raw.clone()),
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer".to_owned(),
            None,
        )
    })?;
    if parsed < minimum {
        return Err(query_validation_error(
            field,
            Value::from(parsed),
            "greater_than_equal",
            format!("Input should be greater than or equal to {minimum}"),
            Some(Map::from_iter([("ge".to_owned(), Value::from(minimum))])),
        ));
    }
    if let Some(maximum) = maximum.filter(|maximum| parsed > *maximum) {
        return Err(query_validation_error(
            field,
            Value::from(parsed),
            "less_than_equal",
            format!("Input should be less than or equal to {maximum}"),
            Some(Map::from_iter([("le".to_owned(), Value::from(maximum))])),
        ));
    }
    Ok(parsed)
}

fn optional_value(values: &HashMap<String, String>, field: &str) -> Option<String> {
    values.get(field).cloned()
}

fn status_index(
    values: Vec<thesis_db::WikiIndexStatusRecord>,
) -> HashMap<String, thesis_db::WikiIndexStatusRecord> {
    values
        .into_iter()
        .map(|row| (row.entity_name.clone(), row))
        .collect()
}

fn metadata_index(
    values: Vec<thesis_db::WikiSourceMetadataRecord>,
) -> HashMap<String, thesis_db::WikiSourceMetadataRecord> {
    values
        .into_iter()
        .map(|row| (row.source_name.clone(), row))
        .collect()
}

fn scores_index(
    values: Vec<thesis_db::WikiSourceAnalysisScoreRecord>,
) -> HashMap<String, BTreeMap<String, i32>> {
    let mut result = HashMap::new();
    for row in values {
        result
            .entry(row.source_name)
            .or_insert_with(BTreeMap::new)
            .insert(row.axis_name, row.score);
    }
    result
}

fn canonical_source_name(name: &str) -> &str {
    name.split_once(" - ").map_or(name, |(base, _)| base).trim()
}

fn dedupe_catalog_sources(
    entries: &[crate::source_catalog::SourceCatalogEntry],
) -> Vec<(&crate::source_catalog::SourceCatalogEntry, String)> {
    let mut seen = std::collections::HashSet::new();
    entries
        .iter()
        .filter_map(|entry| {
            let canonical_name = canonical_source_name(&entry.name);
            seen.insert(canonical_name.to_owned())
                .then(|| (entry, canonical_name.to_owned()))
        })
        .collect()
}
struct SourceCardFilters<'a> {
    country: Option<&'a str>,
    bias: Option<&'a str>,
    funding: Option<&'a str>,
    search: Option<&'a str>,
    sort: &'a str,
    limit: usize,
    offset: usize,
}

struct SourceCardIndexes {
    metadata: HashMap<String, thesis_db::WikiSourceMetadataRecord>,
    scores: HashMap<String, BTreeMap<String, i32>>,
    statuses: HashMap<String, thesis_db::WikiIndexStatusRecord>,
}
fn source_cards(
    filters: SourceCardFilters<'_>,
    indexes: SourceCardIndexes,
) -> Vec<SourceCardResponse> {
    let SourceCardFilters {
        country,
        bias,
        funding,
        search,
        sort,
        limit,
        offset,
    } = filters;
    let SourceCardIndexes {
        metadata,
        scores,
        statuses,
    } = indexes;
    let catalog = dedupe_catalog_sources(crate::source_catalog::configured_catalog());
    let search_lower = search.map(str::to_lowercase);
    let mut cards = catalog
        .into_iter()
        .filter(|(entry, name)| {
            if country.is_some_and(|country| !entry.country.eq_ignore_ascii_case(country))
                || bias.is_some_and(|bias| !entry.bias_rating.eq_ignore_ascii_case(bias))
                || funding.is_some_and(|funding| !entry.funding_type.eq_ignore_ascii_case(funding))
            {
                return false;
            }
            search_lower
                .as_ref()
                .is_none_or(|search| name.to_lowercase().contains(search))
        })
        .map(|(entry, name)| {
            let metadata = metadata.get(&name);
            let index_status = statuses.get(&name);
            SourceCardResponse {
                name: name.clone(),
                country: (!entry.country.is_empty()).then(|| entry.country.clone()),
                funding_type: (!entry.funding_type.is_empty()).then(|| entry.funding_type.clone()),
                bias_rating: (!entry.bias_rating.is_empty()).then(|| entry.bias_rating.clone()),
                category: Some(entry.category.clone()),
                parent_company: metadata.and_then(|item| item.parent_company.clone()),
                credibility_score: metadata.and_then(|item| item.credibility_score),
                analysis_scores: scores.get(&name).cloned(),
                index_status: Some(
                    index_status
                        .and_then(|item| item.status.clone())
                        .unwrap_or_else(|| "unindexed".to_owned()),
                ),
                last_indexed_at: index_status
                    .and_then(|item| item.last_indexed_at)
                    .map(format_naive_datetime),
            }
        })
        .collect::<Vec<_>>();

    match sort {
        "country" => cards.sort_by(|left, right| {
            left.country
                .as_deref()
                .unwrap_or("ZZ")
                .cmp(right.country.as_deref().unwrap_or("ZZ"))
        }),
        "bias" => cards.sort_by_key(|card| {
            match card
                .bias_rating
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "left" => 0,
                "left-center" => 1,
                "center" => 2,
                "center-right" | "right-center" => 3,
                "right" => 4,
                _ => 5,
            }
        }),
        _ => cards.sort_by_key(|card| card.name.to_lowercase()),
    }
    cards.into_iter().skip(offset).take(limit).collect()
}

fn reporter_card(
    record: thesis_db::WikiReporterCardRecord,
    current_outlet: Option<String>,
) -> ReporterCardResponse {
    let bio = record.bio.map(|bio| {
        if bio.chars().count() > 200 {
            format!("{}...", bio.chars().take(200).collect::<String>())
        } else {
            bio
        }
    });
    ReporterCardResponse {
        id: record.id,
        name: record.name,
        normalized_name: record.normalized_name,
        bio,
        topics: record.topics,
        political_leaning: record.political_leaning,
        leaning_confidence: record.leaning_confidence,
        article_count: i64::from(record.article_count.unwrap_or_default()),
        current_outlet,
        wikipedia_url: record.wikipedia_url,
        canonical_name: record.canonical_name,
        match_status: record.match_status,
        research_confidence: record.research_confidence,
    }
}
fn json_object_array_or_empty(value: Option<Value>) -> Result<Vec<Value>, ()> {
    match value {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(rows)) if rows.iter().all(Value::is_object) => Ok(rows),
        _ => Err(()),
    }
}

fn reporter_enrichment_request(
    data: &thesis_db::WikiReporterDossierData,
) -> ReporterEnrichmentRequest {
    ReporterEnrichmentRequest {
        reporter_id: data.reporter.id,
        reporter_name: data.reporter.name.clone(),
        institutional_affiliations: data
            .reporter
            .institutional_affiliations
            .as_ref()
            .map(|value| value.0.clone()),
        recent_articles: data
            .recent_articles
            .iter()
            .map(|article| {
                json!({
                    "id": article.id,
                    "title": article.title,
                    "source": article.source,
                    "published_at": Some(format_naive_datetime(article.published_at)),
                    "url": article.url,
                    "category": article.category,
                })
            })
            .collect(),
    }
}

fn reporter_dossier_response(
    data: thesis_db::WikiReporterDossierData,
    enrichment: ReporterEnrichment,
) -> Result<ReporterDossierResponse, ()> {
    let reporter = data.reporter;
    let career_history = reporter.career_history.map(|value| value.0);
    let institutional_affiliations = reporter.institutional_affiliations.map(|value| value.0);
    let employer_context = indexing::employer_context(career_history.as_ref());
    let dossier_sections =
        json_object_array_or_empty(reporter.dossier_sections.map(|value| value.0))?;
    let citations_json = reporter.citations.map(|value| value.0);
    let citations = json_string_maps(citations_json.as_ref())?.unwrap_or_default();
    let recent_articles = data
        .recent_articles
        .into_iter()
        .map(|article| {
            json!({
                "id": article.id,
                "title": article.title,
                "source": article.source,
                "published_at": Some(format_naive_datetime(article.published_at)),
                "url": article.url,
                "category": article.category,
            })
        })
        .collect();

    Ok(ReporterDossierResponse {
        id: reporter.id,
        name: reporter.name,
        normalized_name: reporter.normalized_name,
        bio: reporter.bio,
        career_history,
        topics: reporter.topics,
        education: reporter.education.map(|value| value.0),
        political_leaning: reporter.political_leaning,
        leaning_confidence: reporter.leaning_confidence,
        leaning_sources: reporter.leaning_sources.map(|value| value.0),
        twitter_handle: reporter.twitter_handle,
        linkedin_url: reporter.linkedin_url,
        wikipedia_url: reporter.wikipedia_url,
        wikidata_qid: reporter.wikidata_qid,
        wikidata_url: reporter.wikidata_url,
        canonical_name: reporter.canonical_name,
        match_status: reporter.match_status,
        overview: reporter.overview,
        dossier_sections,
        citations,
        search_links: reporter.search_links.map(|value| value.0),
        match_explanation: reporter.match_explanation,
        source_patterns: reporter.source_patterns.map(|value| value.0),
        topics_avoided: reporter.topics_avoided.map(|value| value.0),
        advertiser_alignment: reporter.advertiser_alignment.map(|value| value.0),
        revolving_door: reporter.revolving_door.map(|value| value.0),
        controversies: reporter.controversies.map(|value| value.0),
        institutional_affiliations,
        coverage_comparison: reporter.coverage_comparison.map(|value| value.0),
        career_timeline: Some(enrichment.career_timeline),
        article_count: i64::from(reporter.article_count.unwrap_or_default()),
        last_article_at: reporter.last_article_at.map(format_naive_datetime),
        recent_articles,
        activity_summary: Some(enrichment.activity_summary),
        employer_context,
        research_sources: reporter.research_sources.map(|value| value.0),
        research_confidence: reporter.research_confidence,
    })
}

fn format_naive_datetime(value: NaiveDateTime) -> String {
    value.format("%Y-%m-%dT%H:%M:%S%.f").to_string()
}

fn cache_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_separator = true;
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_separator = false;
        } else if !previous_separator {
            slug.push('-');
            previous_separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "unknown".to_owned()
    } else {
        slug
    }
}

fn cached_source_profile(source_name: &str) -> Option<Map<String, Value>> {
    let directory = std::env::var_os("SOURCE_RESEARCH_CACHE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp/thesis_source_research_cache"));
    let path = directory.join(format!("{}.json", cache_slug(source_name)));
    let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
    let ttl_hours = std::env::var("SOURCE_RESEARCH_CACHE_TTL_HOURS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(168);
    if ttl_hours < 0 {
        return None;
    }
    let ttl = std::time::Duration::from_secs((ttl_hours as u64).saturating_mul(3_600));
    let age = std::time::SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default();
    if age > ttl {
        return None;
    }
    let payload: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let payload = payload.as_object()?;
    let schema_version = match payload.get("cache_schema_version") {
        Some(Value::Number(value)) => value.as_i64().unwrap_or_default(),
        Some(Value::String(value)) => value.parse::<i64>().unwrap_or_default(),
        Some(Value::Bool(value)) => i64::from(*value),
        _ => 0,
    };
    (schema_version >= 4).then(|| payload.clone())
}

fn profile_value<'a>(profile: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a Value> {
    profile
        .and_then(|profile| profile.get(key))
        .filter(|value| !value.is_null())
}

fn profile_string(profile: Option<&Map<String, Value>>, key: &str) -> Result<Option<String>, ()> {
    match profile_value(profile, key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(()),
    }
}

fn profile_string_map(
    profile: Option<&Map<String, Value>>,
    key: &str,
) -> Result<Option<BTreeMap<String, String>>, ()> {
    let Some(value) = profile_value(profile, key) else {
        return Ok(None);
    };
    value
        .as_object()
        .ok_or(())?
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_owned()))
                .ok_or(())
        })
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map(Some)
}

fn profile_string_maps(
    profile: Option<&Map<String, Value>>,
    key: &str,
) -> Result<Vec<BTreeMap<String, String>>, ()> {
    let Some(value) = profile_value(profile, key) else {
        return Ok(Vec::new());
    };
    value
        .as_array()
        .ok_or(())?
        .iter()
        .map(|row| {
            row.as_object()
                .ok_or(())?
                .iter()
                .map(|(key, value)| {
                    value
                        .as_str()
                        .map(|value| (key.clone(), value.to_owned()))
                        .ok_or(())
                })
                .collect::<Result<BTreeMap<_, _>, _>>()
        })
        .collect()
}

fn profile_objects(profile: Option<&Map<String, Value>>, key: &str) -> Result<Vec<Value>, ()> {
    let Some(value) = profile_value(profile, key) else {
        return Ok(Vec::new());
    };
    let rows = value.as_array().ok_or(())?;
    if rows.iter().any(|row| !row.is_object()) {
        return Err(());
    }
    Ok(rows.clone())
}

fn profile_object(profile: Option<&Map<String, Value>>, key: &str) -> Result<Option<Value>, ()> {
    match profile_value(profile, key) {
        None => Ok(None),
        Some(value) if value.is_object() => Ok(Some(value.clone())),
        _ => Err(()),
    }
}

fn json_string_maps(value: Option<&Value>) -> Result<Option<Vec<BTreeMap<String, String>>>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let rows = value.as_array().ok_or(())?;
            rows.iter()
                .map(|row| {
                    row.as_object()
                        .ok_or(())?
                        .iter()
                        .map(|(key, value)| {
                            value
                                .as_str()
                                .map(|value| (key.clone(), value.to_owned()))
                                .ok_or(())
                        })
                        .collect::<Result<BTreeMap<_, _>, _>>()
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some)
        }
    }
}

fn catalog_match(
    source_name: &str,
) -> Option<(
    &'static crate::source_catalog::SourceCatalogEntry,
    Vec<String>,
)> {
    let mut matching_names = Vec::new();
    let mut source_config = None;
    for entry in crate::source_catalog::configured_catalog() {
        let base_name = canonical_source_name(&entry.name);
        if base_name.eq_ignore_ascii_case(source_name)
            || entry.name.eq_ignore_ascii_case(source_name)
        {
            if !matching_names.iter().any(|name| name == base_name) {
                matching_names.push(base_name.to_owned());
            }
            source_config.get_or_insert(entry);
        }
    }
    source_config.map(|config| (config, matching_names))
}
fn canonical_source_name_or_original(source: &str) -> String {
    catalog_match(source)
        .and_then(|(_, names)| names.into_iter().next())
        .unwrap_or_else(|| source.to_owned())
}

fn canonical_source_filter(source: Option<String>) -> Option<String> {
    source.map(|source| canonical_source_name_or_original(&source))
}

fn source_index_status(
    rows: Vec<thesis_db::WikiIndexStatusRecord>,
    matched_names: &[String],
    source_name: &str,
) -> Option<thesis_db::WikiIndexStatusRecord> {
    let mut matching = rows
        .into_iter()
        .filter(|row| {
            row.entity_type == "source" && matched_names.iter().any(|name| name == &row.entity_name)
        })
        .collect::<Vec<_>>();
    if let Some(index) = matching
        .iter()
        .position(|row| row.entity_name.eq_ignore_ascii_case(source_name))
    {
        return Some(matching.remove(index));
    }
    matching.into_iter().min_by(|left, right| {
        let status_order = |status: Option<&str>| match status.unwrap_or_default() {
            "complete" => 0,
            "pending" => 1,
            "failed" => 2,
            "unindexed" => 3,
            _ => 99,
        };
        status_order(left.status.as_deref())
            .cmp(&status_order(right.status.as_deref()))
            .then_with(|| right.last_indexed_at.cmp(&left.last_indexed_at))
    })
}

fn source_overview(
    source_name: &str,
    config: &crate::source_catalog::SourceCatalogEntry,
    metadata: Option<&thesis_db::WikiSourceMetadataRecord>,
    organization: Option<&thesis_db::WikiSourceOrganizationRecord>,
) -> Option<String> {
    let mut parts = Vec::new();
    for (label, value) in [
        (
            "Type",
            metadata
                .and_then(|metadata| metadata.source_type.as_deref())
                .unwrap_or_default()
                .trim(),
        ),
        ("Country", config.country.trim()),
        ("Funding model", config.funding_type.trim()),
        (
            "Parent organization",
            metadata
                .and_then(|metadata| metadata.parent_company.as_deref())
                .unwrap_or_default()
                .trim(),
        ),
        ("Catalog bias label", config.bias_rating.trim()),
    ] {
        if !value.is_empty() {
            parts.push(format!("{label}: {value}."));
        }
    }
    if let Some(factual_reporting) = organization
        .and_then(|organization| organization.factual_reporting.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!(
            "Catalog factual reporting label: {factual_reporting}."
        ));
    }
    (!parts.is_empty()).then(|| format!("{source_name} source profile. {}", parts.join(" ")))
}

fn ratio(numerator: i64, denominator: i64) -> f64 {
    if denominator <= 0 {
        return 0.0;
    }
    let scaled = numerator as f64 / denominator as f64 * 10_000.0;
    let floor = scaled.floor();
    let fraction = scaled - floor;
    let rounded = if (fraction - 0.5).abs() < f64::EPSILON {
        if floor as i64 % 2 == 0 {
            floor
        } else {
            floor + 1.0
        }
    } else {
        scaled.round()
    };
    rounded / 10_000.0
}

fn source_ledger(
    source_name: &str,
    config: &crate::source_catalog::SourceCatalogEntry,
    metadata: Option<&thesis_db::WikiSourceMetadataRecord>,
    data: thesis_db::WikiSourceLedgerData,
) -> SourceLedgerResponse {
    let mut paywalled = 0_i64;
    let mut free = 0_i64;
    let mut unknown_paywall = 0_i64;
    let mut named_author = 0_i64;
    for article in &data.articles {
        match article
            .paywall_status
            .as_deref()
            .unwrap_or("unknown")
            .trim()
            .to_lowercase()
            .as_str()
        {
            "hard_paywall" | "paywalled" | "metered" | "subscription_required" => paywalled += 1,
            "free" | "open" | "available" => free += 1,
            _ => unknown_paywall += 1,
        }
        if article
            .author
            .as_deref()
            .is_some_and(|author| !author.trim().is_empty())
            || article
                .authors
                .as_ref()
                .is_some_and(|authors| authors.iter().any(|author| !author.trim().is_empty()))
        {
            named_author += 1;
        }
    }
    let article_count = data.articles.len() as i64;
    let downstream_edges = data
        .relation_counts
        .iter()
        .map(|row| row.count)
        .sum::<i64>();
    let wire_edges = data
        .relation_counts
        .iter()
        .find(|row| row.relation == "same_wire_story")
        .map_or(0, |row| row.count);
    let source_flagged_paywalled = metadata
        .map(|metadata| metadata.is_paywalled.unwrap_or(false))
        .unwrap_or(config.is_paywalled);
    let paywall_rate = if article_count > 0 {
        ratio(paywalled, article_count)
    } else if source_flagged_paywalled {
        1.0
    } else {
        0.0
    };
    let policy_signal_count = metadata
        .and_then(|metadata| metadata.research_sources.as_ref())
        .and_then(|sources| sources.0.as_object())
        .and_then(|sources| sources.get("policy_transparency"))
        .and_then(Value::as_object)
        .and_then(|policy| policy.get("signals"))
        .and_then(Value::as_array)
        .map_or(0_i64, |signals| {
            signals.iter().filter(|signal| signal.is_object()).count() as i64
        });
    let metric =
        |id: &str, label: &str, value: Value, unit: &str, description: &str, status: &str| {
            SourceLedgerMetricResponse {
                id: id.to_owned(),
                label: label.to_owned(),
                value,
                unit: unit.to_owned(),
                description: description.to_owned(),
                status: status.to_owned(),
            }
        };
    let metrics = vec![
        metric(
            "corrections",
            "Corrections observed",
            json!(data.correction_count),
            "records",
            "Correction-watch records matched to this source.",
            if data.correction_count > 0 {
                "observed"
            } else {
                "not_observed"
            },
        ),
        metric(
            "original_reporting",
            "Earliest in cluster",
            json!(data.original_count),
            "stories",
            "Story clusters where this source is the earliest detected article.",
            if data.original_count > 0 {
                "observed"
            } else {
                "not_observed"
            },
        ),
        metric(
            "wire_dependency",
            "Wire dependency",
            json!(ratio(wire_edges, downstream_edges)),
            "share",
            "Share of lineage edges into this source that look like wire reuse.",
            if downstream_edges > 0 {
                "observed"
            } else {
                "insufficient_data"
            },
        ),
        metric(
            "paywall",
            "Paywall rate",
            json!(paywall_rate),
            "share",
            "Share of stored articles marked as paywalled, with source-level fallback.",
            if article_count > 0 {
                "observed"
            } else {
                "source_metadata"
            },
        ),
        metric(
            "author_transparency",
            "Named bylines",
            json!(ratio(named_author, article_count)),
            "share",
            "Share of stored articles with an author or byline list.",
            if article_count > 0 {
                "observed"
            } else {
                "insufficient_data"
            },
        ),
        metric(
            "source_transparency",
            "Policy signals",
            json!(policy_signal_count),
            "signals",
            "Disclosure signals from policy-transparency extraction.",
            if policy_signal_count > 0 {
                "observed"
            } else {
                "not_observed"
            },
        ),
    ];
    let paywall = json!({
        "paywalled_articles": paywalled,
        "free_articles": free,
        "unknown_articles": unknown_paywall,
        "paywall_rate": paywall_rate,
        "source_flagged_paywalled": source_flagged_paywalled,
    });
    let original_reporting = json!({
        "earliest_story_count": data.original_count,
        "earliest_story_rate": ratio(data.original_count, article_count),
    });
    let wire_dependency = json!({
        "wire_edge_count": wire_edges,
        "downstream_edge_count": downstream_edges,
        "wire_dependency_rate": ratio(wire_edges, downstream_edges),
    });
    let author_transparency = json!({
        "named_author_articles": named_author,
        "named_author_rate": ratio(named_author, article_count),
    });
    let source_transparency = json!({
        "policy_signal_count": policy_signal_count,
        "has_policy_signals": policy_signal_count > 0,
    });
    let url = serde_json::to_value(&config.url).unwrap_or(Value::Null);
    let rss_health = json!({
        "status": if url.is_null() { "unknown" } else { "configured" },
        "feed_url": url,
        "last_successful_fetch_at": null,
        "last_error": null,
    });
    SourceLedgerResponse {
        source_name: source_name.to_owned(),
        article_count,
        paywall,
        original_reporting,
        wire_dependency,
        author_transparency,
        source_transparency,
        rss_health,
        metrics,
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/sources/{source_name}",
    operation_id = "get_source_wiki_api_wiki_sources__source_name__get",
    params(("source_name" = String, Path, description = "Source name")),
    responses(
        (status = 200, description = "Successful Response", body = SourceWikiResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki",
    summary = "Get Source Wiki",
    description = "Get full wiki page data for a single source."
)]
pub(crate) async fn get_source_wiki(
    State(state): State<AppState>,
    Path(source_name): Path<String>,
) -> Response {
    let Some((config, matched_names)) = catalog_match(&source_name) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": format!("Source '{source_name}' not found") })),
        )
            .into_response();
    };
    let source_name = canonical_source_name(&source_name).to_owned();
    let matched_names_set = matched_names
        .iter()
        .collect::<std::collections::HashSet<_>>();
    let metadata_rows = match state.database.wiki_source_metadata().await {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let metadata = metadata_rows
        .iter()
        .filter(|row| matched_names_set.contains(&row.source_name))
        .find(|row| row.source_name.eq_ignore_ascii_case(&source_name))
        .or_else(|| {
            metadata_rows
                .iter()
                .find(|row| matched_names_set.contains(&row.source_name))
        })
        .cloned();

    let score_rows = match state.database.wiki_source_analysis_scores().await {
        Ok(rows) => rows
            .into_iter()
            .filter(|row| matched_names_set.contains(&row.source_name))
            .collect::<Vec<_>>(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let mut latest_scores = Vec::<thesis_db::WikiSourceAnalysisScoreRecord>::new();
    for row in score_rows {
        if let Some(index) = latest_scores
            .iter()
            .position(|score| score.axis_name == row.axis_name)
        {
            let previous = &latest_scores[index];
            if row.last_scored_at.is_some()
                && (previous.last_scored_at.is_none()
                    || row.last_scored_at > previous.last_scored_at)
            {
                latest_scores[index] = row;
            }
        } else {
            latest_scores.push(row);
        }
    }
    let mut analysis_axes = Vec::with_capacity(latest_scores.len());
    for score in latest_scores {
        let citations = match json_string_maps(score.citations.as_ref().map(|value| &value.0)) {
            Ok(citations) => citations,
            Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        analysis_axes.push(AnalysisAxisResponse {
            axis_name: score.axis_name,
            score: score.score,
            confidence: score.confidence,
            prose_explanation: score.prose_explanation,
            citations,
            empirical_basis: score.empirical_basis,
            scored_by: score.scored_by,
            last_scored_at: score.last_scored_at.map(format_naive_datetime),
        });
    }

    let article_count = match state
        .database
        .wiki_source_article_count(&matched_names)
        .await
    {
        Ok(count) => count,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let reporter_rows = match state
        .database
        .wiki_source_reporter_summaries(&matched_names, 50)
        .await
    {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let reporters = reporter_rows
        .into_iter()
        .map(|reporter| {
            json!({
                "id": reporter.id,
                "name": reporter.name,
                "topics": reporter.topics,
                "political_leaning": reporter.political_leaning,
                "article_count": reporter.article_count.unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    let organization_record = match state
        .database
        .wiki_source_organization(&source_name.trim().to_lowercase())
        .await
    {
        Ok(organization) => organization,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let organization = organization_record.as_ref().map(|organization| {
        json!({
            "id": organization.id,
            "name": organization.name,
            "org_type": organization.org_type,
            "funding_type": organization.funding_type,
            "funding_sources": organization.funding_sources.as_ref().map(|value| &value.0),
            "major_advertisers": organization.major_advertisers.as_ref().map(|value| &value.0),
            "ein": organization.ein,
            "annual_revenue": organization.annual_revenue,
            "media_bias_rating": organization.media_bias_rating,
            "factual_reporting": organization.factual_reporting,
            "wikipedia_url": organization.wikipedia_url,
            "research_confidence": organization.research_confidence,
        })
    });
    let profile = std::iter::once(source_name.as_str())
        .chain(matched_names.iter().map(String::as_str))
        .find_map(cached_source_profile);
    let profile_ref = profile.as_ref();
    let profile_overview = match profile_string(profile_ref, "overview") {
        Ok(overview) => overview.filter(|overview| !overview.is_empty()),
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let overview = profile_overview.or_else(|| {
        source_overview(
            &source_name,
            config,
            metadata.as_ref(),
            organization_record.as_ref(),
        )
    });

    let status_rows = match state.database.wiki_index_entries(Some("source")).await {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let status = source_index_status(status_rows, &matched_names, &source_name);
    let claim_rows = match state.database.wiki_source_claims(&matched_names).await {
        Ok(rows) => rows,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let claims = claim_rows
        .into_iter()
        .map(|row| {
            let claim = row.claim;
            json!({
                "id": claim.id,
                "type": claim.claim_type,
                "kind": claim.claim_kind,
                "value": claim.claim_value.0,
                "confidence": claim.confidence,
                "parser_version": claim.parser_version,
                "valid_from": claim.valid_from.map(format_naive_datetime),
                "valid_to": claim.valid_to.map(format_naive_datetime),
                "evidence": row.evidence.into_iter().map(|evidence| json!({
                    "source_type": evidence.source_type,
                    "source_name": evidence.source_name,
                    "source_url": evidence.source_url,
                    "retrieved_at": format_naive_datetime(evidence.retrieved_at),
                    "raw_excerpt": evidence.raw_excerpt,
                })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let ledger_data = match state.database.wiki_source_ledger_data(&matched_names).await {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let source_ledger = source_ledger(&source_name, config, metadata.as_ref(), ledger_data);

    let website = match profile_string(profile_ref, "website") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let match_status = match profile_string(profile_ref, "match_status") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let wikipedia_url = match profile_string(profile_ref, "wikipedia_url") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let wikidata_qid = match profile_string(profile_ref, "wikidata_qid") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let wikidata_url = match profile_string(profile_ref, "wikidata_url") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let match_explanation = match profile_string(profile_ref, "match_explanation") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let dossier_sections = match profile_objects(profile_ref, "dossier_sections") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let citations = match profile_string_maps(profile_ref, "citations") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let search_links = match profile_string_map(profile_ref, "search_links") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let official_pages = match profile_string_maps(profile_ref, "official_pages") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let policy_transparency = match profile_object(profile_ref, "policy_transparency") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let ads_txt = match profile_object(profile_ref, "ads_txt") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let sellers_json = match profile_object(profile_ref, "sellers_json") {
        Ok(value) => value,
        Err(()) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    Json(SourceWikiResponse {
        name: source_name,
        website,
        country: (!config.country.is_empty()).then(|| config.country.clone()),
        funding_type: (!config.funding_type.is_empty()).then(|| config.funding_type.clone()),
        bias_rating: (!config.bias_rating.is_empty()).then(|| config.bias_rating.clone()),
        category: Some(config.category.clone()),
        parent_company: metadata
            .as_ref()
            .and_then(|metadata| metadata.parent_company.clone()),
        credibility_score: metadata
            .as_ref()
            .and_then(|metadata| metadata.credibility_score),
        is_state_media: metadata
            .as_ref()
            .and_then(|metadata| metadata.is_state_media),
        source_type: metadata
            .as_ref()
            .and_then(|metadata| metadata.source_type.clone()),
        overview,
        match_status,
        wikipedia_url,
        wikidata_qid,
        wikidata_url,
        dossier_sections,
        citations,
        search_links,
        match_explanation,
        official_pages,
        policy_transparency,
        ads_txt,
        sellers_json,
        claims,
        source_ledger: Some(source_ledger),
        analysis_axes,
        reporters,
        organization,
        ownership_chain: Vec::new(),
        article_count,
        geographic_focus: metadata
            .as_ref()
            .and_then(|metadata| metadata.geographic_focus.clone())
            .unwrap_or_default(),
        topic_focus: metadata
            .as_ref()
            .and_then(|metadata| metadata.topic_focus.clone())
            .unwrap_or_default(),
        index_status: match status.as_ref() {
            Some(status) => status.status.clone(),
            None => Some("unindexed".to_owned()),
        },
        last_indexed_at: status
            .and_then(|status| status.last_indexed_at)
            .map(format_naive_datetime),
    })
    .into_response()
}
pub(crate) fn router_with_indexing(wiki_state: WikiState) -> Router<AppState> {
    let index_routes = wiki_state.indexing.routes().with_state::<AppState>(());
    Router::new()
        .route("/api/wiki/sources", get(list_wiki_sources))
        .route("/api/wiki/sources/{source_name}", get(get_source_wiki))
        .route(
            "/api/wiki/sources/{source_name}/reporters",
            get(get_source_reporters),
        )
        .route("/api/wiki/reporters", get(list_wiki_reporters))
        .route(
            "/api/wiki/reporters/{reporter_id}",
            get(get_reporter_dossier),
        )
        .route(
            "/api/wiki/reporters/{reporter_id}/articles",
            get(get_reporter_articles),
        )
        .route("/api/wiki/organizations", get(list_wiki_organizations))
        .route("/api/wiki/index/status", get(get_wiki_index_status))
        .merge(index_routes)
        .layer(Extension(wiki_state.enrichment))
}

#[utoipa::path(
    get,
    path = "/api/wiki/sources",
    operation_id = "list_wiki_sources_api_wiki_sources_get",
    params(SourceListParameters),
    responses(
        (status = 200, description = "Successful Response", body = [SourceCardResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki",
    summary = "List Wiki Sources",
    description = "List all sources for the wiki index page with optional filtering."
)]
pub(crate) async fn list_wiki_sources(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match parse_integer_parameter(&values, "limit", 200, 1, Some(500)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let offset = match parse_integer_parameter(&values, "offset", 0, 0, None) {
        Ok(offset) => offset,
        Err(error) => return error.into_response(),
    };
    let params = SourceListParameters {
        country: optional_value(&values, "country"),
        bias: optional_value(&values, "bias"),
        funding: optional_value(&values, "funding"),
        search: optional_value(&values, "search"),
        sort: values
            .get("sort")
            .cloned()
            .unwrap_or_else(|| "name".to_owned()),
        limit,
        offset,
    };

    let metadata = match state.database.wiki_source_metadata().await {
        Ok(values) => metadata_index(values),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let scores = match state.database.wiki_source_analysis_scores().await {
        Ok(values) => scores_index(values),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let statuses = match state.database.wiki_index_entries(Some("source")).await {
        Ok(values) => status_index(values),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    Json(source_cards(
        SourceCardFilters {
            country: params.country.as_deref(),
            bias: params.bias.as_deref(),
            funding: params.funding.as_deref(),
            search: params.search.as_deref(),
            sort: &params.sort,
            limit: params.limit as usize,
            offset: params.offset as usize,
        },
        SourceCardIndexes {
            metadata,
            scores,
            statuses,
        },
    ))
    .into_response()
}

#[utoipa::path(
    get,
    path = "/api/wiki/sources/{source_name}/reporters",
    operation_id = "get_source_reporters_api_wiki_sources__source_name__reporters_get",
    params(
        ("source_name" = String, Path, description = "Source name"),
        SourceReportersParameters
    ),
    responses(
        (status = 200, description = "Successful Response", body = [ReporterCardResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki",
    summary = "Get Source Reporters",
    description = "Get reporters associated with a source."
)]
pub(crate) async fn get_source_reporters(
    State(state): State<AppState>,
    Path(source_name): Path<String>,
    uri: Uri,
) -> Response {
    let source_name = canonical_source_name_or_original(&source_name);
    let values = match query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match parse_integer_parameter(&values, "limit", 50, 1, Some(200)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let params = SourceReportersParameters { limit };
    match state
        .database
        .wiki_source_reporters(&source_name, params.limit)
        .await
    {
        Ok(records) => Json(
            records
                .into_iter()
                .map(|record| reporter_card(record, Some(source_name.clone())))
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/reporters",
    operation_id = "list_wiki_reporters_api_wiki_reporters_get",
    params(ReporterListParameters),
    responses(
        (status = 200, description = "Successful Response", body = [ReporterCardResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki",
    summary = "List Wiki Reporters",
    description = "List all reporters in the wiki directory."
)]
pub(crate) async fn list_wiki_reporters(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match parse_integer_parameter(&values, "limit", 100, 1, Some(500)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let offset = match parse_integer_parameter(&values, "offset", 0, 0, None) {
        Ok(offset) => offset,
        Err(error) => return error.into_response(),
    };
    let params = ReporterListParameters {
        search: optional_value(&values, "search"),
        source: canonical_source_filter(optional_value(&values, "source")),
        leaning: optional_value(&values, "leaning"),
        limit,
        offset,
    };
    match state
        .database
        .wiki_reporters(
            params.search.as_deref(),
            params.source.as_deref(),
            params.leaning.as_deref(),
            params.limit,
            params.offset,
        )
        .await
    {
        Ok(records) => Json(
            records
                .into_iter()
                .map(|record| reporter_card(record, params.source.clone()))
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/reporters/{reporter_id}",
    operation_id = "get_reporter_dossier_api_wiki_reporters__reporter_id__get",
    params(("reporter_id" = i64, Path, description = "Reporter ID")),
    responses(
        (status = 200, description = "Successful Response", body = ReporterDossierResponse),
        (status = 404, description = "Reporter not found"),
        (status = 422, description = "Validation Error", body = HttpValidationError),
        (status = 500, description = "Reporter enrichment failed"),
        (status = 503, description = "Reporter enrichment provider unavailable")
    ),
    tag = "wiki",
    summary = "Get Reporter Dossier",
    description = "Get full reporter dossier for the wiki page."
)]
pub(crate) async fn get_reporter_dossier(
    State(state): State<AppState>,
    Extension(enrichment_provider): Extension<indexing::ReporterEnrichmentState>,
    Path(reporter_id): Path<String>,
) -> Response {
    let reporter_id = match reporter_id.trim().parse::<i64>() {
        Ok(reporter_id) => reporter_id,
        Err(_) => {
            return path_integer_validation_error("reporter_id", &reporter_id).into_response()
        }
    };
    match state.database.wiki_reporter_dossier(reporter_id).await {
        Ok(Some(data)) => {
            let request = reporter_enrichment_request(&data);
            let enrichment = match enrichment_provider.enrich(request).await {
                Ok(enrichment) => enrichment,
                Err(indexing::ReporterEnrichmentError::Unavailable) => {
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        Json(json!({"detail": "Reporter enrichment provider is not available"})),
                    )
                        .into_response()
                }
                Err(indexing::ReporterEnrichmentError::Failed(_)) => {
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            };
            match reporter_dossier_response(data, enrichment) {
                Ok(response) => Json(response).into_response(),
                Err(()) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({"detail": "Reporter not found"})),
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/reporters/{reporter_id}/articles",
    operation_id = "get_reporter_articles_api_wiki_reporters__reporter_id__articles_get",
    params(
        ("reporter_id" = i64, Path, description = "Reporter ID"),
        ReporterArticlesParameters
    ),
    responses(
        (status = 200, description = "Successful Response", body = [WikiFreeFormObjectSchema]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki",
    summary = "Get Reporter Articles",
    description = "Get articles by a specific reporter."
)]
pub(crate) async fn get_reporter_articles(
    State(state): State<AppState>,
    Path(reporter_id): Path<String>,
    uri: Uri,
) -> Response {
    let reporter_id = match reporter_id.trim().parse::<i64>() {
        Ok(reporter_id) => reporter_id,
        Err(_) => {
            return path_integer_validation_error("reporter_id", &reporter_id).into_response()
        }
    };
    let values = match query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match parse_integer_parameter(&values, "limit", 50, 1, Some(200)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let offset = match parse_integer_parameter(&values, "offset", 0, 0, None) {
        Ok(offset) => offset,
        Err(error) => return error.into_response(),
    };
    let params = ReporterArticlesParameters { limit, offset };
    match state
        .database
        .wiki_reporter_articles(reporter_id, params.limit, params.offset)
        .await
    {
        Ok(Some(articles)) => Json(
            articles
                .into_iter()
                .map(|article| {
                    json!({
                        "id": article.id,
                        "title": article.title,
                        "source": article.source,
                        "published_at": Some(format_naive_datetime(article.published_at)),
                        "url": article.url,
                        "category": article.category,
                        "image_url": article.image_url,
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({"detail": "Reporter not found"})),
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/organizations",
    operation_id = "list_wiki_organizations_api_wiki_organizations_get",
    params(OrganizationListParameters),
    responses(
        (status = 200, description = "Successful Response", body = [WikiFreeFormObjectSchema]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki",
    summary = "List Wiki Organizations",
    description = "List all organizations for the wiki."
)]
pub(crate) async fn list_wiki_organizations(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let limit = match parse_integer_parameter(&values, "limit", 100, 1, Some(500)) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    let offset = match parse_integer_parameter(&values, "offset", 0, 0, None) {
        Ok(offset) => offset,
        Err(error) => return error.into_response(),
    };
    let params = OrganizationListParameters { limit, offset };
    match state
        .database
        .wiki_organizations(params.limit, params.offset)
        .await
    {
        Ok(records) => Json(
            records
                .into_iter()
                .map(|record| {
                    json!({
                        "id": record.id,
                        "name": record.name,
                        "org_type": record.org_type,
                        "funding_type": record.funding_type,
                        "media_bias_rating": record.media_bias_rating,
                        "factual_reporting": record.factual_reporting,
                        "parent_org_id": record.parent_org_id,
                        "wikipedia_url": record.wikipedia_url,
                        "research_confidence": record.research_confidence,
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/index/status",
    operation_id = "get_wiki_index_status_api_wiki_index_status_get",
    responses((status = 200, description = "Successful Response", body = WikiIndexStatusResponse)),
    tag = "wiki",
    summary = "Get Wiki Index Status",
    description = "Get wiki indexing status summary."
)]
pub(crate) async fn get_wiki_index_status(State(state): State<AppState>) -> Response {
    let entries = match state.database.wiki_index_entries(None).await {
        Ok(entries) => entries,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let total_entries = entries.len() as i64;
    let mut by_status = BTreeMap::new();
    let mut by_type = BTreeMap::new();
    for entry in entries {
        let Some(status) = entry.status else {
            tracing::error!("wiki index status row has a null status");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        *by_status.entry(status).or_insert(0) += 1;
        *by_type.entry(entry.entity_type).or_insert(0) += 1;
    }
    Json(WikiIndexStatusResponse {
        total_entries,
        by_status,
        by_type,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        catalog_match, parse_integer_parameter, query_validation_error, reporter_dossier_response,
        reporter_enrichment_request, source_cards, ReporterEnrichment, SourceCardFilters,
        SourceCardIndexes,
    };
    use serde_json::Value;
    use std::collections::{BTreeMap, HashMap};

    #[test]
    fn pagination_validation_matches_fastapi_bounds_and_types() {
        let values = HashMap::from([("limit".to_owned(), "501".to_owned())]);
        let error = parse_integer_parameter(&values, "limit", 200, 1, Some(500)).unwrap_err();
        assert_eq!(error.detail[0].error_type, "less_than_equal");
        assert_eq!(error.detail[0].input, Value::from(501));
        assert_eq!(
            error.detail[0].ctx.as_ref().unwrap()["le"],
            Value::from(500)
        );

        let values = HashMap::from([("offset".to_owned(), "-1".to_owned())]);
        let error = parse_integer_parameter(&values, "offset", 0, 0, None).unwrap_err();
        assert_eq!(error.detail[0].error_type, "greater_than_equal");
        assert_eq!(error.detail[0].ctx.as_ref().unwrap()["ge"], Value::from(0));

        let values = HashMap::from([("limit".to_owned(), "one".to_owned())]);
        let error = parse_integer_parameter(&values, "limit", 200, 1, Some(500)).unwrap_err();
        assert_eq!(error.detail[0].error_type, "int_parsing");
        assert_eq!(error.detail[0].input, Value::String("one".to_owned()));
    }

    #[test]
    fn query_validation_errors_have_fastapi_query_location() {
        let error = query_validation_error(
            "limit",
            Value::from(0),
            "greater_than_equal",
            "Input should be greater than or equal to 1".to_owned(),
            None,
        );
        assert_eq!(error.detail[0].loc.len(), 2);
        assert!(matches!(
            error.detail[0].loc.first(),
            Some(super::ValidationLocation::Text(location)) if location.as_str() == "query"
        ));
        assert!(matches!(
            error.detail[0].loc.get(1),
            Some(super::ValidationLocation::Text(location)) if location.as_str() == "limit"
        ));
    }
    #[test]
    fn source_listing_uses_canonical_names_for_deduplication_and_db_joins() {
        assert!(crate::source_catalog::configured_catalog()
            .iter()
            .any(|entry| entry.name.starts_with("BBC News - ")));

        let metadata = HashMap::from([(
            "BBC News".to_owned(),
            thesis_db::WikiSourceMetadataRecord {
                source_name: "BBC News".to_owned(),
                parent_company: Some("BBC Group".to_owned()),
                credibility_score: Some(0.92),
                is_state_media: Some(false),
                source_type: Some("broadcast".to_owned()),
                geographic_focus: None,
                topic_focus: None,
                is_paywalled: Some(false),
                research_sources: None,
            },
        )]);
        let scores = HashMap::from([(
            "BBC News".to_owned(),
            BTreeMap::from([("credibility".to_owned(), 5)]),
        )]);
        let statuses = HashMap::from([(
            "BBC News".to_owned(),
            thesis_db::WikiIndexStatusRecord {
                entity_type: "source".to_owned(),
                entity_name: "BBC News".to_owned(),
                status: Some("complete".to_owned()),
                last_indexed_at: None,
            },
        )]);
        let cards = source_cards(
            SourceCardFilters {
                country: None,
                bias: None,
                funding: None,
                search: Some("BBC News"),
                sort: "name",
                limit: 500,
                offset: 0,
            },
            SourceCardIndexes {
                metadata,
                scores,
                statuses,
            },
        );
        let bbc = cards
            .iter()
            .filter(|card| card.name == "BBC News")
            .collect::<Vec<_>>();

        assert_eq!(bbc.len(), 1);
        assert_eq!(bbc[0].parent_company.as_deref(), Some("BBC Group"));
        assert_eq!(bbc[0].analysis_scores.as_ref().unwrap()["credibility"], 5);
        assert_eq!(bbc[0].index_status.as_deref(), Some("complete"));
        assert!(!cards
            .iter()
            .any(|card| card.name.starts_with("BBC News - ")));
    }
    #[test]
    fn source_aliases_resolve_to_canonical_database_name() {
        let (_, matched_names) =
            catalog_match("BBC News - Home").expect("catalog contains BBC News aliases");

        assert_eq!(matched_names, vec!["BBC News".to_owned()]);
    }
    #[test]
    fn reporter_dossier_projects_persisted_profile_and_recent_articles() {
        let data = thesis_db::WikiReporterDossierData {
            reporter: thesis_db::WikiReporterDossierRecord {
                id: 42,
                name: "Ada Reporter".to_owned(),
                normalized_name: Some("ada reporter".to_owned()),
                bio: None,
                career_history: None,
                topics: Some(vec!["politics".to_owned()]),
                education: None,
                political_leaning: None,
                leaning_confidence: None,
                leaning_sources: None,
                twitter_handle: None,
                linkedin_url: None,
                wikipedia_url: None,
                wikidata_qid: None,
                wikidata_url: None,
                canonical_name: None,
                match_status: None,
                overview: None,
                dossier_sections: None,
                citations: None,
                search_links: None,
                match_explanation: None,
                source_patterns: None,
                topics_avoided: None,
                advertiser_alignment: None,
                revolving_door: None,
                controversies: None,
                institutional_affiliations: None,
                coverage_comparison: None,
                article_count: Some(1),
                last_article_at: None,
                research_sources: None,
                research_confidence: None,
            },
            recent_articles: vec![thesis_db::WikiReporterArticleRecord {
                id: 7,
                title: "A report".to_owned(),
                source: "BBC News".to_owned(),
                published_at: chrono::NaiveDateTime::parse_from_str(
                    "2024-01-02 03:04:05",
                    "%Y-%m-%d %H:%M:%S",
                )
                .unwrap(),
                url: "https://example.com/report".to_owned(),
                category: Some("politics".to_owned()),
                image_url: Some("https://example.com/image.jpg".to_owned()),
            }],
        };
        let request = reporter_enrichment_request(&data);
        assert_eq!(request.reporter_id, 42);
        assert_eq!(request.reporter_name, "Ada Reporter");
        assert_eq!(
            request.recent_articles[0]["published_at"],
            "2024-01-02T03:04:05"
        );
        let response = reporter_dossier_response(
            data,
            ReporterEnrichment {
                career_timeline: serde_json::json!({
                    "timeline": [],
                    "shared_owner_findings": []
                }),
                activity_summary: serde_json::json!({"article_count": 1}),
            },
        )
        .expect("valid persisted dossier");
        let response = serde_json::to_value(response).expect("serializable response");

        assert_eq!(response["id"], 42);
        assert_eq!(response["article_count"], 1);
        assert_eq!(response["recent_articles"][0]["source"], "BBC News");
        assert_eq!(
            response["recent_articles"][0]["published_at"],
            "2024-01-02T03:04:05"
        );
        assert!(response["recent_articles"][0].get("image_url").is_none());
        assert_eq!(
            response["career_timeline"]["shared_owner_findings"],
            serde_json::json!([])
        );
        assert_eq!(response["activity_summary"]["article_count"], 1);
    }
}
