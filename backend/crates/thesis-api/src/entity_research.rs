//! Contract assembly for the B11 entity and source research operations.
//!
//! The Python routes combine local database/file caches with Wikipedia, Wikidata,
//! SEC, ProPublica, trade, GDELT, and LLM providers. Rust keeps those concerns
//! separate: cache projections cross [`EntityResearchCache`], and live calls
//! cross [`EntityResearchProvider`]. This module mirrors the routes' request
//! constraints, cache decisions, response projections, and best-effort enrichment.
//! It does not make network calls or fabricate successful research results.

use futures_util::stream::FuturesUnordered;
use futures_util::StreamExt;
use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::openapi::schema::{
    AdditionalProperties, AnyOfBuilder, ArrayBuilder, ObjectBuilder, Type,
};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const PROVIDER_UNAVAILABLE_DETAIL: &str = "Entity research provider is not available";
const CACHE_UNAVAILABLE_DETAIL: &str = "Entity research cache is not available";
/// Errors that can safely cross the entity-research boundary.
#[derive(Debug)]
pub enum EntityResearchError {
    /// The corresponding Python dependency is not configured in this process.
    Unavailable,
    /// A configured dependency failed without exposing implementation details.
    Failed(String),
    /// A cache lookup did not find the requested record.
    NotFound,
}

/// A boxed Send future for fallible entity-research operations.
pub type EntityResearchFuture<T> =
    Pin<Box<dyn Future<Output = Result<T, EntityResearchError>> + Send>>;

/// A live result and optional internal attribution from the provider adapter.
///
/// Attribution is not inferred or exposed as response data; the route preserves
/// the Python contract instead of imposing additional evidence requirements.
#[derive(Clone, Debug)]
pub struct ProviderResult<T> {
    pub value: T,
    pub provenance: Vec<String>,
}

/// Live research sidecar.  Implementations own network clients, timeouts,
/// provider authentication, retries, and provider-specific parsing.
///
/// This crate intentionally does not provide a default implementation: a missing
/// adapter must remain a 503 rather than a fabricated research response.
pub trait EntityResearchProvider: Send + Sync {
    fn profile_reporter(
        &self,
        request: ReporterProfileRequest,
    ) -> EntityResearchFuture<ProviderResult<ReporterProfileResponse>>;

    fn research_organization(
        &self,
        request: OrganizationResearchRequest,
    ) -> EntityResearchFuture<ProviderResult<OrganizationResearchResponse>>;

    fn research_source(
        &self,
        request: SourceResearchRequest,
    ) -> EntityResearchFuture<ProviderResult<SourceResearchResponse>>;

    fn ownership_chain(
        &self,
        organization: String,
        max_depth: i64,
    ) -> EntityResearchFuture<ProviderResult<Vec<JsonObject>>>;

    fn material_context(
        &self,
        request: MaterialContextRequest,
    ) -> EntityResearchFuture<ProviderResult<MaterialContextResponse>>;

    fn economic_profile(
        &self,
        country_code: String,
    ) -> EntityResearchFuture<ProviderResult<JsonObject>>;

    /// Normalize Wikipedia URLs to their English langlink where available.
    ///
    /// Failure is best-effort: callers preserve the original URL, matching the
    /// Python route's normalization behavior.
    fn normalize_wikipedia_urls(
        &self,
        urls: Vec<Option<String>>,
    ) -> EntityResearchFuture<Vec<Option<String>>> {
        Box::pin(async move { Ok(urls) })
    }
}

/// Local cache/database sidecar.  It is separate from the live provider so
/// cached reads remain deterministic and provider-free. Source-cache lookups
/// enforce Python's file-cache schema and TTL policy; source profiles are not
/// stored in thesis-db.
pub trait EntityResearchCache: Send + Sync {
    fn reporter_by_resolver_key(
        &self,
        resolver_key: String,
    ) -> EntityResearchFuture<Option<ReporterProfileResponse>>;

    fn reporter_by_id(
        &self,
        reporter_id: i64,
    ) -> EntityResearchFuture<Option<ReporterProfileResponse>>;

    fn list_reporters(
        &self,
        limit: i64,
        offset: i64,
    ) -> EntityResearchFuture<Vec<ReporterProfileResponse>>;

    fn save_reporter(
        &self,
        resolver_key: String,
        response: ReporterProfileResponse,
    ) -> EntityResearchFuture<ReporterProfileResponse>;

    fn organization_by_normalized_name(
        &self,
        normalized_name: String,
    ) -> EntityResearchFuture<Option<OrganizationResearchResponse>>;

    fn organization_by_id(
        &self,
        organization_id: i64,
    ) -> EntityResearchFuture<Option<OrganizationResearchResponse>>;

    fn list_organizations(
        &self,
        limit: i64,
        offset: i64,
    ) -> EntityResearchFuture<Vec<OrganizationResearchResponse>>;

    fn save_organization(
        &self,
        normalized_name: String,
        response: OrganizationResearchResponse,
    ) -> EntityResearchFuture<OrganizationResearchResponse>;

    fn source_by_name(
        &self,
        source_name: String,
    ) -> EntityResearchFuture<Option<SourceResearchResponse>>;

    fn save_source(&self, response: SourceResearchResponse) -> EntityResearchFuture<()>;
}

/// Runtime dependencies for all eleven B11 handlers.
#[derive(Clone)]
pub struct EntityResearchState {
    provider: Option<Arc<dyn EntityResearchProvider>>,
    cache: Option<Arc<dyn EntityResearchCache>>,
}

impl EntityResearchState {
    pub fn new(
        provider: Option<Arc<dyn EntityResearchProvider>>,
        cache: Option<Arc<dyn EntityResearchCache>>,
    ) -> Self {
        Self { provider, cache }
    }
}

impl Default for EntityResearchState {
    fn default() -> Self {
        Self::new(None, None)
    }
}

async fn normalize_wikipedia_url(
    provider: Option<&Arc<dyn EntityResearchProvider>>,
    url: Option<String>,
) -> Option<String> {
    let Some(provider) = provider else {
        return url;
    };
    let original = url.clone();
    match provider.normalize_wikipedia_urls(vec![url]).await {
        Ok(mut normalized) if normalized.len() == 1 => normalized.pop().flatten().or(original),
        _ => original,
    }
}

async fn normalize_wikipedia_urls(
    provider: Option<&Arc<dyn EntityResearchProvider>>,
    urls: Vec<Option<String>>,
) -> Vec<Option<String>> {
    let Some(provider) = provider else {
        return urls;
    };
    let original = urls.clone();
    match provider.normalize_wikipedia_urls(urls).await {
        Ok(normalized) if normalized.len() == original.len() => normalized
            .into_iter()
            .zip(original)
            .map(|(normalized, original)| normalized.or(original))
            .collect(),
        _ => original,
    }
}

type EntityBatchFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

enum SourceBatchOutcome {
    Cached {
        name: String,
        response: SourceResearchResponse,
    },
    Researched {
        name: String,
        response: SourceResearchResponse,
    },
    Failed {
        name: String,
    },
    ProviderUnavailable,
}

async fn gather_limited<T: Send + 'static>(
    futures: Vec<EntityBatchFuture<T>>,
    limit: usize,
) -> Vec<T> {
    let mut pending = futures.into_iter().enumerate();
    let mut active: FuturesUnordered<EntityBatchFuture<(usize, T)>> = FuturesUnordered::new();
    let mut results = std::iter::repeat_with(|| None)
        .take(pending.len())
        .collect::<Vec<Option<T>>>();

    for _ in 0..limit.max(1) {
        let Some((index, future)) = pending.next() else {
            break;
        };
        active.push(Box::pin(async move { (index, future.await) }));
    }

    while let Some((index, result)) = active.next().await {
        results[index] = Some(result);
        if let Some((index, future)) = pending.next() {
            active.push(Box::pin(async move { (index, future.await) }));
        }
    }

    results.into_iter().map(Option::unwrap).collect()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ReporterProfileRequest {
    pub name: String,
    pub organization: Option<String>,
    pub article_context: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct OrganizationResearchRequest {
    pub name: String,
    pub website: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct SourceResearchRequest {
    pub name: String,
    pub website: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct SourceBatchRequest {
    pub sources: Vec<SourceResearchRequest>,
    #[serde(default)]
    #[schema(required = false, default = false)]
    pub force_refresh: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct MaterialContextRequest {
    pub source: String,
    pub source_country: String,
    pub mentioned_countries: Vec<String>,
    #[schema(schema_with = optional_string_array_schema)]
    pub topics: Option<Vec<String>>,
    pub article_text: Option<String>,
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct ReporterProfileParameters {
    #[param(required = false, default = false)]
    force_refresh: Option<bool>,
}

impl ReporterProfileParameters {
    fn from_query(values: &HashMap<String, String>) -> Result<Self, HttpValidationError> {
        Ok(Self {
            force_refresh: Some(query_bool(values, "force_refresh", false)?),
        })
    }

    fn force_refresh(&self) -> bool {
        self.force_refresh.unwrap_or(false)
    }
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct OrganizationResearchParameters {
    #[param(required = false, default = false)]
    force_refresh: Option<bool>,
}

impl OrganizationResearchParameters {
    fn from_query(values: &HashMap<String, String>) -> Result<Self, HttpValidationError> {
        Ok(Self {
            force_refresh: Some(query_bool(values, "force_refresh", false)?),
        })
    }

    fn force_refresh(&self) -> bool {
        self.force_refresh.unwrap_or(false)
    }
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct SourceProfileParameters {
    #[param(required = false, default = false)]
    force_refresh: Option<bool>,
    #[param(required = false, default = false)]
    cache_only: Option<bool>,
}

impl SourceProfileParameters {
    fn from_query(values: &HashMap<String, String>) -> Result<Self, HttpValidationError> {
        Ok(Self {
            force_refresh: Some(query_bool(values, "force_refresh", false)?),
            cache_only: Some(query_bool(values, "cache_only", false)?),
        })
    }

    fn force_refresh(&self) -> bool {
        self.force_refresh.unwrap_or(false)
    }

    fn cache_only(&self) -> bool {
        self.cache_only.unwrap_or(false)
    }
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct OwnershipChainParameters {
    #[param(required = false, default = 5, minimum = 1, maximum = 10)]
    max_depth: Option<i64>,
}

impl OwnershipChainParameters {
    fn from_query(values: &HashMap<String, String>) -> Result<Self, HttpValidationError> {
        Ok(Self {
            max_depth: Some(query_i64(values, "max_depth", 5, 1, 10)?),
        })
    }

    fn max_depth(&self) -> i64 {
        self.max_depth.unwrap_or(5)
    }
}

#[derive(Debug, IntoParams)]
#[into_params(parameter_in = Query)]
struct EntityListParameters {
    #[param(required = false, default = 50, minimum = 1, maximum = 200)]
    limit: Option<i64>,
    #[param(required = false, default = 0, minimum = 0)]
    offset: Option<i64>,
}

impl EntityListParameters {
    fn from_query(values: &HashMap<String, String>) -> Result<Self, HttpValidationError> {
        Ok(Self {
            limit: Some(query_i64(values, "limit", 50, 1, 200)?),
            offset: Some(query_i64(values, "offset", 0, 0, i64::MAX)?),
        })
    }

    fn values(&self) -> (i64, i64) {
        (self.limit.unwrap_or(50), self.offset.unwrap_or(0))
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = ReporterProfileResponse)]
pub struct ReporterProfileResponse {
    pub id: Option<i64>,
    pub redirected_from_id: Option<i64>,
    pub name: String,
    pub normalized_name: Option<String>,
    pub bio: Option<String>,
    #[schema(schema_with = optional_free_form_object_array_schema)]
    pub career_history: Option<Vec<JsonObject>>,
    #[schema(schema_with = optional_string_array_schema)]
    pub topics: Option<Vec<String>>,
    #[schema(schema_with = optional_free_form_object_array_schema)]
    pub education: Option<Vec<JsonObject>>,
    pub political_leaning: Option<String>,
    pub leaning_confidence: Option<String>,
    pub twitter_handle: Option<String>,

    /// Persisted on the Reporter row but intentionally omitted by FastAPI's
    /// response model.
    #[serde(skip_serializing)]
    #[schema(ignore)]
    pub leaning_sources: Option<Vec<String>>,
    pub linkedin_url: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_qid: Option<String>,
    pub wikidata_url: Option<String>,
    pub canonical_name: Option<String>,
    pub match_status: Option<String>,
    pub overview: Option<String>,
    #[schema(schema_with = optional_free_form_object_array_schema)]
    pub dossier_sections: Option<Vec<JsonObject>>,
    #[schema(schema_with = optional_free_form_string_map_array_schema)]
    pub citations: Option<Vec<StringMap>>,
    #[schema(schema_with = optional_free_form_string_map_schema)]
    pub search_links: Option<StringMap>,
    pub match_explanation: Option<String>,
    #[schema(schema_with = optional_string_array_schema)]
    pub research_sources: Option<Vec<String>>,
    pub research_confidence: Option<String>,
    #[schema(required = false, default = false)]
    pub cached: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = OrganizationResearchResponse)]
pub struct OrganizationResearchResponse {
    pub id: Option<i64>,
    pub name: String,
    pub normalized_name: Option<String>,
    pub org_type: Option<String>,
    pub parent_org: Option<String>,
    pub ownership_percentage: Option<String>,
    pub funding_type: Option<String>,
    #[schema(required = false, default = json!([]))]
    pub funding_sources: Vec<String>,
    #[schema(required = false, default = json!([]))]
    pub major_advertisers: Vec<String>,
    pub ein: Option<String>,
    pub annual_revenue: Option<String>,
    #[schema(required = false, default = json!([]))]
    pub top_donors: Vec<String>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
    pub wikipedia_url: Option<String>,
    pub website: Option<String>,
    #[schema(required = false, default = json!([]))]
    pub owned_by: Vec<String>,
    #[schema(required = false, default = json!([]))]
    pub parent_orgs: Vec<String>,
    #[schema(required = false, default = json!([]))]
    pub part_of: Vec<String>,
    #[schema(required = false, default = json!([]))]
    pub subsidiaries: Vec<String>,
    #[schema(required = false, default = json!([]))]
    pub headquarters: Vec<String>,
    pub inception: Option<String>,
    pub official_website: Option<String>,
    pub cik: Option<String>,
    #[schema(
        schema_with = default_free_form_object_array_schema,
        required = false,
        default = json!([])
    )]
    pub conflict_flags: Vec<JsonObject>,
    #[schema(schema_with = optional_string_array_schema)]
    pub research_sources: Option<Vec<String>>,
    pub research_confidence: Option<String>,
    #[schema(required = false, default = false)]
    pub cached: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct SourceResearchValue {
    pub label: Option<String>,
    pub value: String,
    #[schema(schema_with = optional_string_array_schema)]
    pub sources: Option<Vec<String>>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct SourceReporterSummary {
    pub name: String,
    pub article_count: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = SourceResearchResponse)]
pub struct SourceResearchResponse {
    pub name: String,
    pub canonical_name: Option<String>,
    pub website: Option<String>,
    pub fetched_at: Option<String>,
    #[schema(required = false, default = false)]
    pub cached: bool,
    #[schema(schema_with = source_fields_schema)]
    pub fields: BTreeMap<String, Vec<SourceResearchValue>>,
    #[schema(required = false, default = json!([]))]
    pub key_reporters: Vec<SourceReporterSummary>,
    pub overview: Option<String>,
    pub match_status: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_qid: Option<String>,
    pub wikidata_url: Option<String>,
    #[schema(schema_with = optional_free_form_object_array_schema)]
    pub dossier_sections: Option<Vec<JsonObject>>,
    #[schema(schema_with = optional_free_form_string_map_array_schema)]
    pub citations: Option<Vec<StringMap>>,
    #[schema(schema_with = optional_free_form_string_map_schema)]
    pub search_links: Option<StringMap>,
    pub match_explanation: Option<String>,
    #[schema(schema_with = optional_free_form_object_schema)]
    pub policy_transparency: Option<JsonObject>,
    #[schema(schema_with = optional_free_form_object_schema)]
    pub ads_txt: Option<JsonObject>,
    #[schema(schema_with = optional_free_form_object_schema)]
    pub sellers_json: Option<JsonObject>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct SourceBatchResponse {
    #[schema(schema_with = source_batch_results_schema)]
    pub results: BTreeMap<String, Option<SourceResearchResponse>>,
    pub cached_count: i64,
    pub newly_researched_count: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct OwnershipChainResponse {
    pub organization: String,
    #[schema(schema_with = free_form_object_array_schema)]
    pub chain: Vec<JsonObject>,
    pub depth: i64,
}
pub type JsonObject = BTreeMap<String, Value>;
pub type StringMap = BTreeMap<String, String>;
#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = MaterialContextResponse)]
pub struct MaterialContextResponse {
    pub source: String,
    pub source_country: String,
    pub mentioned_countries: Vec<String>,
    #[schema(schema_with = free_form_object_array_schema)]
    pub trade_relationships: Vec<JsonObject>,
    #[schema(schema_with = free_form_object_schema)]
    pub known_interests: JsonObject,
    pub potential_conflicts: Vec<String>,
    pub analysis_summary: Option<String>,
    #[schema(schema_with = optional_string_array_schema)]
    pub reader_warnings: Option<Vec<String>>,
    pub confidence: Option<String>,
    pub analyzed_at: Option<String>,
}

#[derive(Debug)]
pub(crate) struct EntityResearchObjectSchema;

impl PartialSchema for EntityResearchObjectSchema {
    fn schema() -> RefOr<Schema> {
        free_form_object_schema()
    }
}

impl ToSchema for EntityResearchObjectSchema {}

fn free_form_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

fn optional_free_form_object_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(free_form_object_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn free_form_object_array_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(free_form_object_schema())
        .build()
        .into()
}

fn default_free_form_object_array_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(free_form_object_schema())
        .default(Some(json!([])))
        .build()
        .into()
}

fn optional_string_array_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ArrayBuilder::new()
                    .items(ObjectBuilder::new().schema_type(Type::String).build())
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn optional_free_form_object_array_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(free_form_object_array_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn optional_free_form_string_map_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ObjectBuilder::new()
                    .schema_type(Type::Object)
                    .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn optional_free_form_string_map_array_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ArrayBuilder::new()
                    .items(optional_free_form_string_map_schema_value())
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn optional_free_form_string_map_schema_value() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
        .build()
        .into()
}

fn source_fields_schema() -> RefOr<Schema> {
    let value_schema = Schema::from(
        ArrayBuilder::new()
            .items(SourceResearchValue::schema())
            .build(),
    );
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(AdditionalProperties::from(value_schema)))
        .build()
        .into()
}

fn source_batch_results_schema() -> RefOr<Schema> {
    let item_schema = Schema::from(
        AnyOfBuilder::new()
            .item(SourceResearchResponse::schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    );
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(AdditionalProperties::from(item_schema)))
        .build()
        .into()
}

#[utoipa::path(
    post,
    path = "/research/entity/reporter/profile",
    operation_id = "profile_reporter_research_entity_reporter_profile_post",
    tag = "entity-research",
    params(ReporterProfileParameters),
    request_body = ReporterProfileRequest,
    responses(
        (status = 200, description = "Successful Response", body = ReporterProfileResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn profile_reporter(
    State(state): State<EntityResearchState>,
    RawQuery(raw_query): RawQuery,
    body: Bytes,
) -> Response {
    let request = match parse_body::<ReporterProfileRequest>(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let query = match parse_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let parameters = match ReporterProfileParameters::from_query(&query) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let force_refresh = parameters.force_refresh();
    let resolver_key = reporter_resolver_key(&request.name, request.organization.as_deref());
    let Some(cache) = state.cache.clone() else {
        return cache_error_response(EntityResearchError::Unavailable);
    };

    if !force_refresh {
        match cache.reporter_by_resolver_key(resolver_key.clone()).await {
            Ok(Some(mut response)) => {
                response.wikipedia_url =
                    normalize_wikipedia_url(state.provider.as_ref(), response.wikipedia_url).await;
                response.cached = true;
                return Json(response).into_response();
            }
            Ok(None) => {}
            Err(error) => return cache_error_response(error),
        }
    }

    let Some(provider) = state.provider.clone() else {
        return provider_error_response(EntityResearchError::Unavailable);
    };
    let result = match provider.profile_reporter(request).await {
        Ok(result) => result,
        Err(error) => return provider_error_response(error),
    };
    let mut response = result.value;
    response.wikipedia_url = normalize_wikipedia_url(Some(&provider), response.wikipedia_url).await;
    response.cached = false;
    if response.match_status.as_deref() != Some("matched") {
        return Json(response).into_response();
    }
    match cache.save_reporter(resolver_key, response).await {
        Ok(mut saved) => {
            saved.cached = false;
            Json(saved).into_response()
        }
        Err(error) => cache_error_response(error),
    }
}

#[utoipa::path(
    get,
    path = "/research/entity/reporter/{reporter_id}",
    operation_id = "get_reporter_research_entity_reporter__reporter_id__get",
    tag = "entity-research",
    params(("reporter_id" = i64, Path, description = "Reporter id")),
    responses(
        (status = 200, description = "Successful Response", body = ReporterProfileResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_reporter(
    State(state): State<EntityResearchState>,
    Path(reporter_id): Path<String>,
) -> Response {
    let reporter_id = match parse_path_id(&reporter_id, "reporter_id") {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Some(cache) = state.cache else {
        return cache_error_response(EntityResearchError::Unavailable);
    };
    let mut response = match cache.reporter_by_id(reporter_id).await {
        Ok(Some(response)) => response,
        Ok(None) => {
            return cache_not_found_response(EntityResearchError::NotFound, "Reporter not found")
        }
        Err(EntityResearchError::NotFound) => return not_found_response("Reporter not found"),
        Err(error) => return cache_error_response(error),
    };
    response.wikipedia_url =
        normalize_wikipedia_url(state.provider.as_ref(), response.wikipedia_url).await;
    response.cached = true;
    Json(response).into_response()
}

#[utoipa::path(
    post,
    path = "/research/entity/organization/research",
    operation_id = "research_organization_research_entity_organization_research_post",
    tag = "entity-research",
    params(OrganizationResearchParameters),
    request_body = OrganizationResearchRequest,
    responses(
        (status = 200, description = "Successful Response", body = OrganizationResearchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn research_organization(
    State(state): State<EntityResearchState>,
    RawQuery(raw_query): RawQuery,
    body: Bytes,
) -> Response {
    let request = match parse_body::<OrganizationResearchRequest>(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let query = match parse_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let parameters = match OrganizationResearchParameters::from_query(&query) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let force_refresh = parameters.force_refresh();
    let normalized_name = normalize_organization_name(&request.name);
    let Some(cache) = state.cache.clone() else {
        return cache_error_response(EntityResearchError::Unavailable);
    };

    if !force_refresh {
        match cache
            .organization_by_normalized_name(normalized_name.clone())
            .await
        {
            Ok(Some(mut response)) => {
                response.wikipedia_url =
                    normalize_wikipedia_url(state.provider.as_ref(), response.wikipedia_url).await;
                response.cached = true;
                return Json(response).into_response();
            }
            Ok(None) => {}
            Err(error) => return cache_error_response(error),
        }
    }

    let Some(provider) = state.provider.clone() else {
        return provider_error_response(EntityResearchError::Unavailable);
    };
    let result = match provider.research_organization(request).await {
        Ok(result) => result,
        Err(error) => return provider_error_response(error),
    };
    let mut response = result.value;
    if !response.parent_orgs.is_empty()
        && response
            .parent_org
            .as_deref()
            .unwrap_or_default()
            .is_empty()
    {
        response.parent_org = response.parent_orgs.first().cloned();
    }
    response.wikipedia_url = normalize_wikipedia_url(Some(&provider), response.wikipedia_url).await;
    response.cached = false;
    match cache.save_organization(normalized_name, response).await {
        Ok(mut saved) => {
            saved.cached = false;
            Json(saved).into_response()
        }
        Err(error) => cache_error_response(error),
    }
}

#[utoipa::path(
    post,
    path = "/research/entity/source/profile",
    operation_id = "research_source_profile_research_entity_source_profile_post",
    tag = "entity-research",
    params(SourceProfileParameters),
    request_body = SourceResearchRequest,
    responses(
        (status = 200, description = "Successful Response", body = SourceResearchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn research_source_profile(
    State(state): State<EntityResearchState>,
    RawQuery(raw_query): RawQuery,
    body: Bytes,
) -> Response {
    let mut request = match parse_body::<SourceResearchRequest>(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    request.name = request.name.trim().to_owned();
    if request.name.is_empty() {
        return bad_request_response("Source name is required");
    }
    let query = match parse_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let parameters = match SourceProfileParameters::from_query(&query) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let force_refresh = parameters.force_refresh();
    let cache_only = parameters.cache_only();
    if !force_refresh {
        if let Some(cache) = state.cache.as_ref() {
            if let Ok(Some(mut response)) = cache.source_by_name(request.name.clone()).await {
                response.cached = true;
                return Json(response).into_response();
            }
        }
    }
    if cache_only {
        return not_found_response("No cached profile available");
    }
    let Some(provider) = state.provider else {
        return provider_error_response(EntityResearchError::Unavailable);
    };
    let result = match provider.research_source(request).await {
        Ok(result) => result,
        Err(error) => return provider_error_response(error),
    };
    let mut response = result.value;
    response.cached = false;
    if let Some(cache) = state.cache {
        let _ = cache.save_source(response.clone()).await;
    }
    Json(response).into_response()
}

#[utoipa::path(
    post,
    path = "/research/entity/source/batch",
    operation_id = "research_source_batch_research_entity_source_batch_post",
    tag = "entity-research",
    request_body = SourceBatchRequest,
    responses(
        (status = 200, description = "Successful Response", body = SourceBatchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn research_source_batch(
    State(state): State<EntityResearchState>,
    body: Bytes,
) -> Response {
    let request = match parse_body::<SourceBatchRequest>(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    for source in &request.sources {
        if source.name.trim().is_empty() {
            return bad_request_response(&format!(
                "Source name cannot be empty: '{}'",
                source.name
            ));
        }
    }

    let force_refresh = request.force_refresh;
    let mut futures = Vec::with_capacity(request.sources.len());
    for mut source in request.sources {
        source.name = source.name.trim().to_owned();
        let name = source.name.clone();
        let cache = state.cache.clone();
        let provider = state.provider.clone();
        futures.push(Box::pin(async move {
            if !force_refresh {
                if let Some(cache) = cache.as_ref() {
                    if let Ok(Some(mut response)) = cache.source_by_name(name.clone()).await {
                        response.cached = true;
                        return SourceBatchOutcome::Cached { name, response };
                    }
                }
            }

            let Some(provider) = provider else {
                return SourceBatchOutcome::ProviderUnavailable;
            };
            let result = match provider.research_source(source).await {
                Ok(result) => result,
                Err(_) => return SourceBatchOutcome::Failed { name },
            };
            let mut response = result.value;
            response.cached = false;
            if let Some(cache) = cache {
                let _ = cache.save_source(response.clone()).await;
            }
            SourceBatchOutcome::Researched { name, response }
        }) as EntityBatchFuture<SourceBatchOutcome>);
    }

    let mut results = BTreeMap::new();
    let mut cached_count = 0_i64;
    let mut newly_researched_count = 0_i64;
    for outcome in gather_limited(futures, 5).await {
        match outcome {
            SourceBatchOutcome::Cached { name, response } => {
                cached_count += 1;
                results.insert(name, Some(response));
            }
            SourceBatchOutcome::Researched { name, response } => {
                newly_researched_count += 1;
                results.insert(name, Some(response));
            }
            SourceBatchOutcome::Failed { name } => {
                results.insert(name, None);
            }
            SourceBatchOutcome::ProviderUnavailable => {
                return provider_error_response(EntityResearchError::Unavailable);
            }
        }
    }

    Json(SourceBatchResponse {
        results,
        cached_count,
        newly_researched_count,
    })
    .into_response()
}

#[utoipa::path(
    get,
    path = "/research/entity/organization/{org_id}",
    operation_id = "get_organization_research_entity_organization__org_id__get",
    tag = "entity-research",
    params(("org_id" = i64, Path, description = "Organization id")),
    responses(
        (status = 200, description = "Successful Response", body = OrganizationResearchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_organization(
    State(state): State<EntityResearchState>,
    Path(org_id): Path<String>,
) -> Response {
    let org_id = match parse_path_id(&org_id, "org_id") {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let Some(cache) = state.cache else {
        return cache_error_response(EntityResearchError::Unavailable);
    };
    let mut response = match cache.organization_by_id(org_id).await {
        Ok(Some(response)) => response,
        Ok(None) => {
            return cache_not_found_response(
                EntityResearchError::NotFound,
                "Organization not found",
            )
        }
        Err(EntityResearchError::NotFound) => return not_found_response("Organization not found"),
        Err(error) => return cache_error_response(error),
    };
    response.wikipedia_url =
        normalize_wikipedia_url(state.provider.as_ref(), response.wikipedia_url).await;
    response.cached = true;
    Json(response).into_response()
}

#[utoipa::path(
    get,
    path = "/research/entity/organization/{org_name}/ownership-chain",
    operation_id = "get_ownership_chain_research_entity_organization__org_name__ownership_chain_get",
    tag = "entity-research",
    params(
        ("org_name" = String, Path, description = "Organization name"),
        OwnershipChainParameters
    ),
    responses(
        (status = 200, description = "Successful Response", body = OwnershipChainResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_ownership_chain(
    State(state): State<EntityResearchState>,
    Path(org_name): Path<String>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let query = match parse_query(raw_query.as_deref()) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let parameters = match OwnershipChainParameters::from_query(&query) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let max_depth = parameters.max_depth();
    let Some(provider) = state.provider else {
        return provider_error_response(EntityResearchError::Unavailable);
    };
    let result = match provider.ownership_chain(org_name.clone(), max_depth).await {
        Ok(result) => result,
        Err(error) => return provider_error_response(error),
    };
    Json(OwnershipChainResponse {
        organization: org_name,
        depth: result.value.len() as i64,
        chain: result.value,
    })
    .into_response()
}

#[utoipa::path(
    get,
    path = "/research/entity/reporters",
    operation_id = "list_reporters_research_entity_reporters_get",
    tag = "entity-research",
    params(EntityListParameters),
    responses(
        (status = 200, description = "Successful Response", body = [ReporterProfileResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn list_reporters(
    State(state): State<EntityResearchState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let parameters = match parse_list_query(raw_query.as_deref()) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let (limit, offset) = parameters.values();
    let Some(cache) = state.cache else {
        return cache_error_response(EntityResearchError::Unavailable);
    };
    let responses = match cache.list_reporters(limit, offset).await {
        Ok(responses) => responses,
        Err(error) => return cache_error_response(error),
    };
    let urls = responses
        .iter()
        .map(|response| response.wikipedia_url.clone())
        .collect();
    let normalized_urls = normalize_wikipedia_urls(state.provider.as_ref(), urls).await;
    let output = responses
        .into_iter()
        .zip(normalized_urls)
        .map(|(mut response, wikipedia_url)| {
            response.wikipedia_url = wikipedia_url;
            response.cached = true;
            response
        })
        .collect::<Vec<_>>();
    Json(output).into_response()
}

#[utoipa::path(
    get,
    path = "/research/entity/organizations",
    operation_id = "list_organizations_research_entity_organizations_get",
    tag = "entity-research",
    params(EntityListParameters),
    responses(
        (status = 200, description = "Successful Response", body = [OrganizationResearchResponse]),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn list_organizations(
    State(state): State<EntityResearchState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let parameters = match parse_list_query(raw_query.as_deref()) {
        Ok(parameters) => parameters,
        Err(error) => return error.into_response(),
    };
    let (limit, offset) = parameters.values();
    let Some(cache) = state.cache else {
        return cache_error_response(EntityResearchError::Unavailable);
    };
    let responses = match cache.list_organizations(limit, offset).await {
        Ok(responses) => responses,
        Err(error) => return cache_error_response(error),
    };
    let urls = responses
        .iter()
        .map(|response| response.wikipedia_url.clone())
        .collect();
    let normalized_urls = normalize_wikipedia_urls(state.provider.as_ref(), urls).await;
    let output = responses
        .into_iter()
        .zip(normalized_urls)
        .map(|(mut response, wikipedia_url)| {
            response.wikipedia_url = wikipedia_url;
            response.cached = true;
            response
        })
        .collect::<Vec<_>>();
    Json(output).into_response()
}

#[utoipa::path(
    post,
    path = "/research/entity/material-context",
    operation_id = "analyze_material_context_research_entity_material_context_post",
    tag = "entity-research",
    request_body = MaterialContextRequest,
    responses(
        (status = 200, description = "Successful Response", body = MaterialContextResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn analyze_material_context(
    State(state): State<EntityResearchState>,
    body: Bytes,
) -> Response {
    let request = match parse_body::<MaterialContextRequest>(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return provider_error_response(EntityResearchError::Unavailable);
    };
    let result = match provider.material_context(request.clone()).await {
        Ok(result) => result,
        Err(error) => return provider_error_response(error),
    };
    Json(result.value).into_response()
}

#[utoipa::path(
    get,
    path = "/research/entity/country/{country_code}/economic-profile",
    operation_id = "get_country_economic_profile_research_entity_country__country_code__economic_profile_get",
    tag = "entity-research",
    params(("country_code" = String, Path, description = "Country code")),
    responses(
        (status = 200, description = "Successful Response", body = inline(EntityResearchObjectSchema)),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn get_country_economic_profile(
    State(state): State<EntityResearchState>,
    Path(country_code): Path<String>,
) -> Response {
    let country_code = country_code.to_uppercase();
    let Some(provider) = state.provider else {
        return provider_error_response(EntityResearchError::Unavailable);
    };
    let result = match provider.economic_profile(country_code.clone()).await {
        Ok(result) => result,
        Err(error) => return provider_error_response(error),
    };
    Json(json!({"country_code": country_code, "profile": result.value})).into_response()
}

fn parse_body<T: DeserializeOwned>(body: &[u8]) -> Result<T, HttpValidationError> {
    let value: Value = serde_json::from_slice(body).map_err(|error| {
        HttpValidationError::body(
            Value::Null,
            "json_invalid",
            &format!("JSON decode error: {error}"),
        )
    })?;
    if !value.is_object() {
        return Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    }
    serde_json::from_value(value.clone()).map_err(|error| {
        HttpValidationError::body(
            value,
            "model_type",
            &format!("Input should be valid: {error}"),
        )
    })
}

fn parse_query(raw_query: Option<&str>) -> Result<HashMap<String, String>, HttpValidationError> {
    let mut values = HashMap::new();
    let Some(raw_query) = raw_query else {
        return Ok(values);
    };
    for pair in raw_query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = percent_decode(key)
            .map_err(|()| query_error(key, "query", "decode_error", "Invalid query encoding"))?;
        let value = percent_decode(value)
            .map_err(|()| query_error(&key, value, "decode_error", "Invalid query encoding"))?;
        values.insert(key, value);
    }
    Ok(values)
}

fn query_bool(
    values: &HashMap<String, String>,
    field: &str,
    default: bool,
) -> Result<bool, HttpValidationError> {
    let Some(value) = values.get(field) else {
        return Ok(default);
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "t" | "1" | "yes" | "y" | "on" => Ok(true),
        "false" | "f" | "0" | "no" | "n" | "off" => Ok(false),
        _ => Err(query_error(
            field,
            value,
            "bool_parsing",
            "Input should be a valid boolean, unable to interpret input",
        )),
    }
}

fn query_i64(
    values: &HashMap<String, String>,
    field: &str,
    default: i64,
    minimum: i64,
    maximum: i64,
) -> Result<i64, HttpValidationError> {
    let Some(value) = values.get(field) else {
        return Ok(default);
    };
    let parsed = value.parse::<i64>().map_err(|_| {
        query_error(
            field,
            value,
            "int_parsing",
            "Input should be a valid integer",
        )
    })?;
    if parsed < minimum {
        return Err(query_error(
            field,
            value,
            "greater_than_equal",
            &format!("Input should be greater than or equal to {minimum}"),
        ));
    }
    if parsed > maximum {
        return Err(query_error(
            field,
            value,
            "less_than_equal",
            &format!("Input should be less than or equal to {maximum}"),
        ));
    }
    Ok(parsed)
}

fn query_error(
    field: &str,
    input: impl Serialize,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    let input = serde_json::to_value(input).unwrap_or(Value::Null);
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: None,
        }],
    }
}

fn parse_list_query(raw_query: Option<&str>) -> Result<EntityListParameters, HttpValidationError> {
    let query = parse_query(raw_query)?;
    EntityListParameters::from_query(&query)
}

fn parse_path_id(value: &str, field: &str) -> Result<i64, HttpValidationError> {
    value.parse::<i64>().map_err(|_| {
        HttpValidationError::field(
            Value::String(value.to_owned()),
            field,
            "int_parsing",
            "Input should be a valid integer",
        )
    })
}

fn reporter_resolver_key(name: &str, organization: Option<&str>) -> String {
    let normalized = normalize_reporter_name(name).to_lowercase();
    let suffix = organization
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    match suffix {
        Some(suffix) => format!("{normalized}::{suffix}"),
        None => normalized,
    }
}

fn normalize_reporter_name(value: &str) -> String {
    let trimmed = value.trim();
    let without_prefix = if trimmed
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("by "))
    {
        &trimmed[3..]
    } else {
        trimmed
    };
    without_prefix
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_organization_name(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '_' || character.is_whitespace() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .to_lowercase();
    normalized
        .split_whitespace()
        .filter(|token| {
            !matches!(
                *token,
                "inc" | "llc" | "corp" | "corporation" | "company" | "co" | "ltd" | "limited"
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn percent_decode(value: &str) -> Result<String, ()> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => output.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                let high = hex_digit(bytes[index + 1]).ok_or(())?;
                let low = hex_digit(bytes[index + 2]).ok_or(())?;
                output.push((high << 4) | low);
                index += 2;
            }
            b'%' => return Err(()),
            byte => output.push(byte),
        }
        index += 1;
    }
    String::from_utf8(output).map_err(|_| ())
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn provider_unavailable_response() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": PROVIDER_UNAVAILABLE_DETAIL})),
    )
        .into_response()
}

fn cache_unavailable_response() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": CACHE_UNAVAILABLE_DETAIL})),
    )
        .into_response()
}

fn provider_error_response(error: EntityResearchError) -> Response {
    match error {
        EntityResearchError::Unavailable => provider_unavailable_response(),
        EntityResearchError::NotFound => not_found_response("Entity research record not found"),
        EntityResearchError::Failed(_) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"detail": "Entity research provider failed"})),
        )
            .into_response(),
    }
}

fn cache_error_response(error: EntityResearchError) -> Response {
    match error {
        EntityResearchError::Unavailable => cache_unavailable_response(),
        EntityResearchError::NotFound => not_found_response("Entity research record not found"),
        EntityResearchError::Failed(_) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"detail": "Entity research cache failed"})),
        )
            .into_response(),
    }
}

fn cache_not_found_response(error: EntityResearchError, detail: &str) -> Response {
    match error {
        EntityResearchError::NotFound => not_found_response(detail),
        other => cache_error_response(other),
    }
}

fn not_found_response(detail: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({"detail": detail}))).into_response()
}

fn bad_request_response(detail: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"detail": detail}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Method, Request};
    use axum::routing::{get, post};
    use axum::Router;
    use std::collections::{BTreeSet, HashSet};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::task::{Context, Poll};
    use std::time::Duration;
    use tower::ServiceExt;

    #[derive(Default)]
    struct MemoryEntityCache {
        reporters: Mutex<BTreeMap<String, ReporterProfileResponse>>,
        organizations: Mutex<BTreeMap<String, OrganizationResearchResponse>>,
        sources: Mutex<BTreeMap<String, SourceResearchResponse>>,
        expired_sources: Mutex<HashSet<String>>,
        reporter_writes: AtomicUsize,
        organization_writes: AtomicUsize,
        source_writes: AtomicUsize,
    }

    impl MemoryEntityCache {
        fn expire_source(&self, name: &str) {
            self.expired_sources
                .lock()
                .expect("expired source cache")
                .insert(name.to_lowercase());
        }
    }

    impl EntityResearchCache for MemoryEntityCache {
        fn reporter_by_resolver_key(
            &self,
            resolver_key: String,
        ) -> EntityResearchFuture<Option<ReporterProfileResponse>> {
            let response = self
                .reporters
                .lock()
                .expect("reporter cache")
                .get(&resolver_key)
                .cloned();
            Box::pin(async move { Ok(response) })
        }

        fn reporter_by_id(
            &self,
            reporter_id: i64,
        ) -> EntityResearchFuture<Option<ReporterProfileResponse>> {
            let response = self
                .reporters
                .lock()
                .expect("reporter cache")
                .values()
                .find(|response| response.id == Some(reporter_id))
                .cloned();
            Box::pin(async move { Ok(response) })
        }

        fn list_reporters(
            &self,
            limit: i64,
            offset: i64,
        ) -> EntityResearchFuture<Vec<ReporterProfileResponse>> {
            let mut responses = self
                .reporters
                .lock()
                .expect("reporter cache")
                .values()
                .cloned()
                .collect::<Vec<_>>();
            responses.sort_by_key(|response| response.id);
            let responses = responses
                .into_iter()
                .skip(offset as usize)
                .take(limit as usize)
                .collect();
            Box::pin(async move { Ok(responses) })
        }

        fn save_reporter(
            &self,
            resolver_key: String,
            mut response: ReporterProfileResponse,
        ) -> EntityResearchFuture<ReporterProfileResponse> {
            let mut reporters = self.reporters.lock().expect("reporter cache");
            response.id = reporters
                .get(&resolver_key)
                .and_then(|existing| existing.id)
                .or(Some(41));
            response.cached = false;
            reporters.insert(resolver_key, response.clone());
            self.reporter_writes.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move { Ok(response) })
        }

        fn organization_by_normalized_name(
            &self,
            normalized_name: String,
        ) -> EntityResearchFuture<Option<OrganizationResearchResponse>> {
            let response = self
                .organizations
                .lock()
                .expect("organization cache")
                .get(&normalized_name)
                .cloned();
            Box::pin(async move { Ok(response) })
        }

        fn organization_by_id(
            &self,
            organization_id: i64,
        ) -> EntityResearchFuture<Option<OrganizationResearchResponse>> {
            let response = self
                .organizations
                .lock()
                .expect("organization cache")
                .values()
                .find(|response| response.id == Some(organization_id))
                .cloned();
            Box::pin(async move { Ok(response) })
        }

        fn list_organizations(
            &self,
            limit: i64,
            offset: i64,
        ) -> EntityResearchFuture<Vec<OrganizationResearchResponse>> {
            let mut responses = self
                .organizations
                .lock()
                .expect("organization cache")
                .values()
                .cloned()
                .collect::<Vec<_>>();
            responses.sort_by_key(|response| response.id);
            let responses = responses
                .into_iter()
                .skip(offset as usize)
                .take(limit as usize)
                .collect();
            Box::pin(async move { Ok(responses) })
        }

        fn save_organization(
            &self,
            normalized_name: String,
            mut response: OrganizationResearchResponse,
        ) -> EntityResearchFuture<OrganizationResearchResponse> {
            let mut organizations = self.organizations.lock().expect("organization cache");
            response.id = organizations
                .get(&normalized_name)
                .and_then(|existing| existing.id)
                .or(Some(73));
            response.cached = false;
            organizations.insert(normalized_name, response.clone());
            self.organization_writes.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move { Ok(response) })
        }

        fn source_by_name(
            &self,
            source_name: String,
        ) -> EntityResearchFuture<Option<SourceResearchResponse>> {
            let key = source_name.to_lowercase();
            let expired = self
                .expired_sources
                .lock()
                .expect("expired source cache")
                .contains(&key);
            let response = (!expired)
                .then(|| {
                    self.sources
                        .lock()
                        .expect("source cache")
                        .get(&key)
                        .cloned()
                })
                .flatten();
            Box::pin(async move { Ok(response) })
        }

        fn save_source(&self, response: SourceResearchResponse) -> EntityResearchFuture<()> {
            let key = response.name.to_lowercase();
            self.expired_sources
                .lock()
                .expect("expired source cache")
                .remove(&key);
            self.sources
                .lock()
                .expect("source cache")
                .insert(key, response);
            self.source_writes.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }

    #[derive(Default)]
    struct LocalEntityProvider {
        reporter_calls: AtomicUsize,
        reporter_requests: Mutex<Vec<ReporterProfileRequest>>,
        reporter_match_status: Mutex<String>,
        organization_requests: Mutex<Vec<OrganizationResearchRequest>>,
        source_calls: Mutex<Vec<String>>,
        failed_sources: Mutex<BTreeSet<String>>,
        source_call_number: AtomicUsize,
        delay_sources: bool,
        active_sources: Arc<AtomicUsize>,
        max_active_sources: Arc<AtomicUsize>,
        country_codes: Mutex<Vec<String>>,
    }

    impl LocalEntityProvider {
        fn set_reporter_match_status(&self, status: &str) {
            *self
                .reporter_match_status
                .lock()
                .expect("reporter match status") = status.to_owned();
        }

        fn fail_source(&self, name: &str) {
            self.failed_sources
                .lock()
                .expect("failed source names")
                .insert(name.to_owned());
        }
    }

    impl EntityResearchProvider for LocalEntityProvider {
        fn profile_reporter(
            &self,
            request: ReporterProfileRequest,
        ) -> EntityResearchFuture<ProviderResult<ReporterProfileResponse>> {
            self.reporter_requests
                .lock()
                .expect("reporter requests")
                .push(request);
            let call = self.reporter_calls.fetch_add(1, Ordering::SeqCst) + 1;
            let match_status = self
                .reporter_match_status
                .lock()
                .expect("reporter match status")
                .clone();
            let mut value = reporter_response("Jane Doe");
            value.bio = Some(format!("profile-{call}"));
            value.match_status = Some(match_status);
            Box::pin(async move {
                Ok(ProviderResult {
                    value,
                    provenance: Vec::new(),
                })
            })
        }

        fn research_organization(
            &self,
            request: OrganizationResearchRequest,
        ) -> EntityResearchFuture<ProviderResult<OrganizationResearchResponse>> {
            self.organization_requests
                .lock()
                .expect("organization requests")
                .push(request.clone());
            let value = organization_response(&request.name);
            Box::pin(async move {
                Ok(ProviderResult {
                    value,
                    provenance: Vec::new(),
                })
            })
        }

        fn research_source(
            &self,
            request: SourceResearchRequest,
        ) -> EntityResearchFuture<ProviderResult<SourceResearchResponse>> {
            let name = request.name;
            self.source_calls
                .lock()
                .expect("source calls")
                .push(name.clone());
            let failed = self
                .failed_sources
                .lock()
                .expect("failed source names")
                .contains(&name);
            let call = self.source_call_number.fetch_add(1, Ordering::SeqCst) + 1;
            let delay = self.delay_sources;
            let active_sources = self.active_sources.clone();
            let max_active_sources = self.max_active_sources.clone();
            Box::pin(async move {
                if delay {
                    let active = active_sources.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active_sources.fetch_max(active, Ordering::SeqCst);
                    YieldOnce { yielded: false }.await;
                }
                if delay {
                    active_sources.fetch_sub(1, Ordering::SeqCst);
                }
                if failed {
                    return Err(EntityResearchError::Failed(
                        "local provider failure".to_owned(),
                    ));
                }
                Ok(ProviderResult {
                    value: source_response(&name, call),
                    provenance: Vec::new(),
                })
            })
        }

        fn ownership_chain(
            &self,
            _organization: String,
            _max_depth: i64,
        ) -> EntityResearchFuture<ProviderResult<Vec<JsonObject>>> {
            Box::pin(async {
                Ok(ProviderResult {
                    value: Vec::new(),
                    provenance: Vec::new(),
                })
            })
        }

        fn material_context(
            &self,
            request: MaterialContextRequest,
        ) -> EntityResearchFuture<ProviderResult<MaterialContextResponse>> {
            let value = MaterialContextResponse {
                source: request.source,
                source_country: request.source_country,
                mentioned_countries: request.mentioned_countries,
                trade_relationships: Vec::new(),
                known_interests: JsonObject::new(),
                potential_conflicts: Vec::new(),
                analysis_summary: None,
                reader_warnings: None,
                confidence: Some("medium".to_owned()),
                analyzed_at: None,
            };
            Box::pin(async move {
                Ok(ProviderResult {
                    value,
                    provenance: Vec::new(),
                })
            })
        }

        fn economic_profile(
            &self,
            country_code: String,
        ) -> EntityResearchFuture<ProviderResult<JsonObject>> {
            self.country_codes
                .lock()
                .expect("economic profile country codes")
                .push(country_code);
            let value = JsonObject::new();
            Box::pin(async move {
                Ok(ProviderResult {
                    value,
                    provenance: Vec::new(),
                })
            })
        }

        fn normalize_wikipedia_urls(
            &self,
            urls: Vec<Option<String>>,
        ) -> EntityResearchFuture<Vec<Option<String>>> {
            Box::pin(async move {
                Ok(urls
                    .into_iter()
                    .map(|url| {
                        url.map(|url| {
                            url.replace(
                                "https://fr.wikipedia.org/wiki/",
                                "https://en.wikipedia.org/wiki/",
                            )
                        })
                    })
                    .collect())
            })
        }
    }

    struct YieldOnce {
        yielded: bool,
    }

    impl Future for YieldOnce {
        type Output = ();

        fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
            if self.yielded {
                return Poll::Ready(());
            }
            self.yielded = true;
            let waker = context.waker().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(20));
                waker.wake();
            });
            Poll::Pending
        }
    }

    fn reporter_response(name: &str) -> ReporterProfileResponse {
        ReporterProfileResponse {
            id: None,
            redirected_from_id: None,
            name: name.to_owned(),
            normalized_name: Some(name.to_lowercase()),
            bio: None,
            career_history: None,
            topics: None,
            education: None,
            political_leaning: None,
            leaning_confidence: None,
            twitter_handle: None,
            leaning_sources: None,
            linkedin_url: Some("not a URL".to_owned()),
            wikipedia_url: Some("https://fr.wikipedia.org/wiki/Jane_Doe".to_owned()),
            wikidata_qid: None,
            wikidata_url: None,
            canonical_name: Some(name.to_owned()),
            match_status: Some("matched".to_owned()),
            overview: None,
            dossier_sections: None,
            citations: None,
            search_links: None,
            match_explanation: None,
            research_sources: None,
            research_confidence: Some("medium".to_owned()),
            cached: false,
        }
    }

    fn organization_response(name: &str) -> OrganizationResearchResponse {
        OrganizationResearchResponse {
            id: None,
            name: name.to_owned(),
            normalized_name: Some(normalize_organization_name(name)),
            org_type: None,
            parent_org: None,
            ownership_percentage: None,
            funding_type: None,
            funding_sources: Vec::new(),
            major_advertisers: Vec::new(),
            ein: None,
            annual_revenue: None,
            top_donors: Vec::new(),
            media_bias_rating: None,
            factual_reporting: None,
            wikipedia_url: Some("https://fr.wikipedia.org/wiki/Example".to_owned()),
            website: Some("not a URL".to_owned()),
            owned_by: Vec::new(),
            parent_orgs: vec!["Parent Org".to_owned()],
            part_of: Vec::new(),
            subsidiaries: Vec::new(),
            headquarters: Vec::new(),
            inception: None,
            official_website: None,
            cik: None,
            conflict_flags: Vec::new(),
            research_sources: None,
            research_confidence: Some("medium".to_owned()),
            cached: false,
        }
    }

    fn source_response(name: &str, call: usize) -> SourceResearchResponse {
        SourceResearchResponse {
            name: name.to_owned(),
            canonical_name: Some(name.to_owned()),
            website: Some("not a URL".to_owned()),
            fetched_at: Some(format!("call-{call}")),
            cached: false,
            fields: BTreeMap::from([(
                "overview".to_owned(),
                vec![SourceResearchValue {
                    label: Some("Overview".to_owned()),
                    value: format!("profile-{call}"),
                    sources: None,
                    notes: None,
                }],
            )]),
            key_reporters: Vec::new(),
            overview: Some(format!("profile-{call}")),
            match_status: None,
            wikipedia_url: None,
            wikidata_qid: None,
            wikidata_url: None,
            dossier_sections: None,
            citations: None,
            search_links: None,
            match_explanation: None,
            policy_transparency: None,
            ads_txt: None,
            sellers_json: None,
        }
    }

    fn entity_router(state: EntityResearchState) -> Router {
        Router::new()
            .route("/research/entity/reporter/profile", post(profile_reporter))
            .route("/research/entity/reporter/{reporter_id}", get(get_reporter))
            .route(
                "/research/entity/organization/research",
                post(research_organization),
            )
            .route(
                "/research/entity/organization/{org_id}",
                get(get_organization),
            )
            .route(
                "/research/entity/organization/{org_name}/ownership-chain",
                get(get_ownership_chain),
            )
            .route(
                "/research/entity/source/profile",
                post(research_source_profile),
            )
            .route("/research/entity/source/batch", post(research_source_batch))
            .route("/research/entity/reporters", get(list_reporters))
            .route("/research/entity/organizations", get(list_organizations))
            .route(
                "/research/entity/material-context",
                post(analyze_material_context),
            )
            .route(
                "/research/entity/country/{country_code}/economic-profile",
                get(get_country_economic_profile),
            )
            .with_state(state)
    }

    async fn send_json(
        app: Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
            .expect("request");
        let response = app.oneshot(request).await.expect("route response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("JSON response")
        };
        (status, value)
    }

    #[test]
    fn resolver_and_organization_keys_match_python_normalization() {
        assert_eq!(reporter_resolver_key(" By Jane  Doe ", None), "jane doe");
        assert_eq!(
            reporter_resolver_key("Jane Doe", Some(" Other Outlet ")),
            "jane doe::other outlet"
        );
        assert_eq!(normalize_organization_name("Example, Inc."), "example");
        assert_eq!(
            normalize_organization_name("The Example Company Ltd."),
            "the example"
        );
    }

    #[tokio::test]
    async fn reporter_profile_upserts_matched_results_and_reuses_cached_identity() {
        let provider = Arc::new(LocalEntityProvider::default());
        provider.set_reporter_match_status("matched");
        let cache = Arc::new(MemoryEntityCache::default());
        let app = entity_router(EntityResearchState::new(
            Some(provider.clone()),
            Some(cache.clone()),
        ));
        let profile_uri = "/research/entity/reporter/profile";

        let (status, first) = send_json(
            app.clone(),
            Method::POST,
            profile_uri,
            Some(json!({"name":"Jane Doe","organization":"Outlet"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["id"], 41);
        assert_eq!(first["cached"], false);
        assert_eq!(first["linkedin_url"], "not a URL");
        assert_eq!(
            first["wikipedia_url"],
            "https://en.wikipedia.org/wiki/Jane_Doe"
        );
        assert!(first.get("leaning_sources").is_none());

        let (status, cached) = send_json(
            app.clone(),
            Method::POST,
            profile_uri,
            Some(json!({"name":" By Jane  Doe ","organization":" outlet "})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cached["cached"], true);
        assert_eq!(cached["bio"], "profile-1");
        assert_eq!(provider.reporter_calls.load(Ordering::SeqCst), 1);
        assert_eq!(cache.reporter_writes.load(Ordering::SeqCst), 1);
        assert_eq!(cache.reporters.lock().expect("reporter cache").len(), 1);
        {
            let requests = provider
                .reporter_requests
                .lock()
                .expect("reporter requests");
            assert_eq!(requests[0].name, "Jane Doe");
            assert_eq!(requests[0].organization.as_deref(), Some("Outlet"));
        }

        let (status, refreshed) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/reporter/profile?force_refresh=true",
            Some(json!({"name":"Jane Doe","organization":"Outlet"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(refreshed["id"], 41);
        assert_eq!(refreshed["cached"], false);
        assert_eq!(refreshed["bio"], "profile-2");
        assert_eq!(provider.reporter_calls.load(Ordering::SeqCst), 2);
        assert_eq!(cache.reporter_writes.load(Ordering::SeqCst), 2);
        assert_eq!(cache.reporters.lock().expect("reporter cache").len(), 1);

        let (status, by_id) = send_json(
            app.clone(),
            Method::GET,
            "/research/entity/reporter/41",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(by_id["id"], 41);
        assert_eq!(by_id["cached"], true);
        assert_eq!(by_id["bio"], "profile-2");

        let (status, listed) = send_json(
            app,
            Method::GET,
            "/research/entity/reporters?limit=1&offset=0",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed.as_array().expect("reporter list").len(), 1);
        assert_eq!(listed[0]["id"], 41);
        assert_eq!(listed[0]["cached"], true);
    }

    #[tokio::test]
    async fn organization_research_cache_and_id_lists_keep_python_string_contracts() {
        let provider = Arc::new(LocalEntityProvider::default());
        let cache = Arc::new(MemoryEntityCache::default());
        let app = entity_router(EntityResearchState::new(
            Some(provider.clone()),
            Some(cache.clone()),
        ));
        let research_uri = "/research/entity/organization/research";
        let (status, first) = send_json(
            app.clone(),
            Method::POST,
            research_uri,
            Some(json!({"name":"Example, Inc.","website":"not a URL"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["id"], 73);
        assert_eq!(first["cached"], false);
        assert_eq!(first["website"], "not a URL");
        assert_eq!(first["parent_org"], "Parent Org");
        assert_eq!(
            first["wikipedia_url"],
            "https://en.wikipedia.org/wiki/Example"
        );

        let (status, cached) = send_json(
            app.clone(),
            Method::POST,
            research_uri,
            Some(json!({"name":"example"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cached["id"], 73);
        assert_eq!(cached["cached"], true);
        assert_eq!(
            provider
                .organization_requests
                .lock()
                .expect("requests")
                .len(),
            1
        );

        let (status, by_id) = send_json(
            app.clone(),
            Method::GET,
            "/research/entity/organization/73",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(by_id["cached"], true);
        assert_eq!(by_id["website"], "not a URL");

        let (status, listed) = send_json(
            app.clone(),
            Method::GET,
            "/research/entity/organizations?limit=1&offset=0",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed.as_array().expect("organization list").len(), 1);
        assert_eq!(listed[0]["cached"], true);
        assert_eq!(cache.organization_writes.load(Ordering::SeqCst), 1);

        let (status, _) = send_json(
            app,
            Method::GET,
            "/research/entity/organizations?limit=0",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn unmatched_reporter_profiles_are_not_persisted() {
        let provider = Arc::new(LocalEntityProvider::default());
        provider.set_reporter_match_status("not_found");
        let cache = Arc::new(MemoryEntityCache::default());
        let app = entity_router(EntityResearchState::new(
            Some(provider.clone()),
            Some(cache.clone()),
        ));

        for _ in 0..2 {
            let (status, response) = send_json(
                app.clone(),
                Method::POST,
                "/research/entity/reporter/profile",
                Some(json!({"name":"Unlisted Reporter"})),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(response["match_status"], "not_found");
            assert_eq!(response["cached"], false);
        }
        assert_eq!(provider.reporter_calls.load(Ordering::SeqCst), 2);
        assert_eq!(cache.reporter_writes.load(Ordering::SeqCst), 0);
        assert!(cache.reporters.lock().expect("reporter cache").is_empty());
    }

    #[tokio::test]
    async fn source_cache_hit_expiry_force_refresh_and_empty_name_follow_route_rules() {
        let provider = Arc::new(LocalEntityProvider::default());
        let cache = Arc::new(MemoryEntityCache::default());
        let app = entity_router(EntityResearchState::new(
            Some(provider.clone()),
            Some(cache.clone()),
        ));
        let uri = "/research/entity/source/profile";
        let source = json!({"name":" BBC News "});

        let (status, first) = send_json(app.clone(), Method::POST, uri, Some(source.clone())).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["name"], "BBC News");
        assert_eq!(first["cached"], false);
        assert_eq!(first["website"], "not a URL");
        assert_eq!(first["overview"], "profile-1");

        let (status, cached) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/source/profile?cache_only=true",
            Some(source.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cached["cached"], true);
        assert_eq!(cached["overview"], "profile-1");
        assert_eq!(provider.source_call_number.load(Ordering::SeqCst), 1);

        cache.expire_source("BBC News");
        let (status, missing) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/source/profile?cache_only=true",
            Some(source.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(missing["detail"], "No cached profile available");
        assert_eq!(provider.source_call_number.load(Ordering::SeqCst), 1);

        let (status, expired) =
            send_json(app.clone(), Method::POST, uri, Some(source.clone())).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(expired["cached"], false);
        assert_eq!(expired["overview"], "profile-2");

        let (status, refreshed) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/source/profile?force_refresh=true",
            Some(source),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(refreshed["overview"], "profile-3");
        assert_eq!(provider.source_call_number.load(Ordering::SeqCst), 3);
        assert_eq!(cache.source_writes.load(Ordering::SeqCst), 3);
        assert_eq!(cache.sources.lock().expect("source cache").len(), 1);

        let (status, error) = send_json(app, Method::POST, uri, Some(json!({"name":"   "}))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error["detail"], "Source name is required");
    }

    #[tokio::test]
    async fn provider_failure_details_are_not_exposed_to_http_clients() {
        let provider = Arc::new(LocalEntityProvider::default());
        provider.fail_source("Sensitive Source");
        let app = entity_router(EntityResearchState::new(Some(provider), None));
        let (status, body) = send_json(
            app,
            Method::POST,
            "/research/entity/source/profile",
            Some(json!({"name":"Sensitive Source"})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["detail"], "Entity research provider failed");
        assert!(!body["detail"]
            .as_str()
            .expect("sanitized detail")
            .contains("local provider failure"));
    }

    #[tokio::test]
    async fn source_batch_bounds_concurrency_and_keeps_partial_failures() {
        let provider = Arc::new(LocalEntityProvider {
            delay_sources: true,
            ..LocalEntityProvider::default()
        });
        provider.fail_source("Broken");
        let cache = Arc::new(MemoryEntityCache::default());
        let app = entity_router(EntityResearchState::new(
            Some(provider.clone()),
            Some(cache.clone()),
        ));
        let sources = vec![
            json!({"name":"Source 0"}),
            json!({"name":"Source 1"}),
            json!({"name":"Source 2"}),
            json!({"name":"Source 3"}),
            json!({"name":"Source 4"}),
            json!({"name":"Duplicate"}),
            json!({"name":"Duplicate"}),
            json!({"name":"Broken"}),
        ];
        let (status, response) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/source/batch",
            Some(json!({"sources":sources.clone()})),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(response["cached_count"], 0);
        assert_eq!(response["newly_researched_count"], 7);
        assert_eq!(response["results"].as_object().expect("results").len(), 7);
        assert_eq!(response["results"]["Broken"], Value::Null);
        assert_eq!(response["results"]["Duplicate"]["cached"], false);
        {
            let calls = provider.source_calls.lock().expect("source calls");
            assert_eq!(calls.len(), 8);
            let initial_wave: BTreeSet<_> = calls.iter().take(5).cloned().collect();
            let expected_wave: BTreeSet<_> =
                (0..5).map(|index| format!("Source {index}")).collect();
            assert_eq!(initial_wave, expected_wave);
            assert_eq!(calls.iter().filter(|name| *name == "Duplicate").count(), 2);
        }
        assert!(provider.max_active_sources.load(Ordering::SeqCst) >= 2);
        assert!(provider.max_active_sources.load(Ordering::SeqCst) <= 5);
        assert_eq!(cache.source_writes.load(Ordering::SeqCst), 7);

        let (status, cached_response) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/source/batch",
            Some(json!({"sources":sources})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cached_response["cached_count"], 7);
        assert_eq!(cached_response["newly_researched_count"], 0);
        assert_eq!(cached_response["results"]["Duplicate"]["cached"], true);
        assert_eq!(cached_response["results"]["Broken"], Value::Null);
        {
            let calls = provider.source_calls.lock().expect("source calls");
            assert_eq!(calls.len(), 9);
            assert_eq!(calls.last().map(String::as_str), Some("Broken"));
        }
        assert_eq!(cache.source_writes.load(Ordering::SeqCst), 7);

        let (status, error) = send_json(
            app,
            Method::POST,
            "/research/entity/source/batch",
            Some(json!({"sources":[{"name":"  "}]})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error["detail"], "Source name cannot be empty: '  '");
    }

    #[tokio::test]
    async fn missing_provider_is_not_reported_as_empty_batch_success() {
        let app = entity_router(EntityResearchState::new(
            None,
            Some(Arc::new(MemoryEntityCache::default())),
        ));
        let (status, body) = send_json(
            app,
            Method::POST,
            "/research/entity/source/batch",
            Some(json!({"sources":[{"name":"Reuters"}]})),
        )
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["detail"], "Entity research provider is not available");
    }

    #[tokio::test]
    async fn material_context_and_ownership_chain_preserve_provider_results() {
        let provider = Arc::new(LocalEntityProvider::default());
        let app = entity_router(EntityResearchState::new(Some(provider), None));
        let (status, material) = send_json(
            app.clone(),
            Method::POST,
            "/research/entity/material-context",
            Some(json!({
                "source":"Local Outlet",
                "source_country":"US",
                "mentioned_countries":["CA"],
                "topics":["trade"],
                "article_text":"context"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(material["source"], "Local Outlet");
        assert_eq!(material["source_country"], "US");
        assert_eq!(material["mentioned_countries"], json!(["CA"]));
        assert!(material.get("beneficiaries").is_none());

        let (status, chain) = send_json(
            app.clone(),
            Method::GET,
            "/research/entity/organization/News%20Outlet/ownership-chain?max_depth=10",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(chain["organization"], "News Outlet");
        assert_eq!(chain["chain"], json!([]));
        assert_eq!(chain["depth"], 0);

        let (status, error) = send_json(
            app,
            Method::GET,
            "/research/entity/organization/News%20Outlet/ownership-chain?max_depth=11",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(error["detail"][0]["loc"], json!(["query", "max_depth"]));
    }
    #[tokio::test]
    async fn economic_profile_only_uppercases_the_path_string() {
        let provider = Arc::new(LocalEntityProvider::default());
        let app = entity_router(EntityResearchState::new(Some(provider.clone()), None));
        let (status, body) = send_json(
            app,
            Method::GET,
            "/research/entity/country/xy/economic-profile",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["country_code"], "XY");
        assert!(body["profile"]
            .as_object()
            .expect("empty profile")
            .is_empty());
        assert_eq!(
            provider.country_codes.lock().expect("country codes")[0],
            "XY"
        );
    }
}
