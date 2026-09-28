//! Rust-side contract boundary for trending, topic, and similarity discovery.
//!
//! Database snapshots and vector-store operations are explicit runtime sidecars.
//! This module owns validation, response shaping, cache/fallback semantics, and
//! integrity checks, but it does not synthesize unavailable clusters or scores.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder};
use utoipa::openapi::{RefOr, Schema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

#[cfg(test)]
mod runtime_tests;
pub mod similarity;
pub mod trending;

const VECTOR_STORE_UNAVAILABLE_DETAIL: &str = "Vector store not available";
const CLUSTER_SNAPSHOT_UNAVAILABLE_DETAIL: &str = "Cluster snapshot cache is not available";

/// A future returned by a discovery provider or snapshot cache.
pub type DiscoveryFuture<T> = Pin<Box<dyn Future<Output = Result<T, DiscoveryError>> + Send>>;

/// A failure crossing a discovery runtime boundary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscoveryError {
    /// The vector store is not configured or cannot be reached.
    VectorStoreUnavailable,
    /// The provider or database failed. The detail is logged, not exposed.
    Backend(String),
    /// A provider returned rows that violate identity or numeric invariants.
    InvalidData(String),
}

/// Runtime provider for Chroma-backed discovery and persisted article projection.
///
/// Implementations must return typed database rows, keep vector-row identifiers
/// attached to their embeddings, and return provider-ranked hits in provider order.
pub trait DiscoveryProvider: Send + Sync {
    /// Return ranked trending clusters for a validated window and limit.
    fn trending_clusters(
        &self,
        window: String,
        limit: i64,
    ) -> DiscoveryFuture<Vec<trending::TrendingCluster>>;
    /// Return ranked breaking clusters for a validated limit.
    fn breaking_clusters(&self, limit: i64) -> DiscoveryFuture<Vec<trending::BreakingCluster>>;
    /// Compute a current precomputed cluster snapshot for the background worker.
    ///
    /// The caller supplies the same bounds as FastAPI's worker (normally
    /// `min_articles = 2`, `limit = 1000`) and persists only successful results.
    fn all_clusters(
        &self,
        window: String,
        min_articles: i64,
        limit: i64,
    ) -> DiscoveryFuture<Vec<trending::AllCluster>>;
    /// Return a persisted cluster detail, if the cluster does not exist.
    fn cluster_detail(&self, cluster_id: i64) -> DiscoveryFuture<Option<trending::ClusterDetail>>;
    /// Build durable story lineage from an existing cluster detail.
    fn story_lineage(
        &self,
        detail: trending::ClusterDetail,
    ) -> DiscoveryFuture<trending::StoryLineage>;
    /// Return current trending system statistics.
    fn trending_stats(&self) -> DiscoveryFuture<trending::TrendingStats>;
    /// Find the source article and ordered vector hits, with persisted articles keyed by id.
    fn related_articles(
        &self,
        article_id: i64,
        limit: i64,
        exclude_same_source: bool,
    ) -> DiscoveryFuture<Option<similarity::RelatedSnapshot>>;
    /// Return ranked cluster-label suggestions for the original query.
    fn search_suggestions(
        &self,
        query: String,
        limit: i64,
    ) -> DiscoveryFuture<Vec<similarity::SearchSuggestion>>;
    /// Compute source coverage and return its JSON object payload.
    fn source_coverage(
        &self,
        source_ids: Vec<String>,
        sample_size: i64,
    ) -> DiscoveryFuture<similarity::SourceCoveragePayload>;
    /// Retrieve stored embeddings for the requested persisted article ids.
    ///
    /// Every returned row must retain its article id. Rows may arrive in any order;
    /// the handler restores request order and rejects unknown or duplicate ids.
    fn embeddings(
        &self,
        article_ids: Vec<i64>,
    ) -> DiscoveryFuture<Vec<similarity::ArticleEmbedding>>;
    /// Return topic assignments for one article.
    fn article_topics(&self, article_id: i64) -> DiscoveryFuture<Vec<similarity::ArticleTopic>>;
    /// Return topic assignments keyed by article id.
    fn bulk_article_topics(
        &self,
        article_ids: Vec<i64>,
    ) -> DiscoveryFuture<BTreeMap<i64, Vec<similarity::ArticleTopic>>>;
}

/// Cache boundary for persisted cluster snapshots read by routes and refreshed
/// by the central background worker.
pub trait ClusterSnapshotCache: Send + Sync {
    /// Load the latest snapshot for one validated window, without consulting Chroma.
    fn latest_snapshot(&self, window: String)
        -> DiscoveryFuture<Option<trending::ClusterSnapshot>>;
    /// Persist a complete successful snapshot with its database computation timestamp.
    ///
    /// Implementations insert the snapshot and prune older rows atomically; an error
    /// must leave the most recent successful snapshot available to route readers.
    fn save_snapshot(
        &self,
        window: String,
        clusters: Vec<trending::AllCluster>,
    ) -> DiscoveryFuture<()>;
}

/// State required by the B11 discovery operations.
#[derive(Clone)]
pub struct DiscoveryState {
    provider: Option<Arc<dyn DiscoveryProvider>>,
    snapshots: Option<Arc<dyn ClusterSnapshotCache>>,
}

impl DiscoveryState {
    /// Bind the independently available discovery provider and snapshot cache.
    pub fn with_adapters(
        provider: Option<Arc<dyn DiscoveryProvider>>,
        snapshots: Option<Arc<dyn ClusterSnapshotCache>>,
    ) -> Self {
        Self {
            provider,
            snapshots,
        }
    }

    /// Represent the current deployment with no discovery data sources.
    pub fn unavailable() -> Self {
        Self::with_adapters(None, None)
    }
}

impl Default for DiscoveryState {
    fn default() -> Self {
        Self::unavailable()
    }
}

pub(super) fn free_form_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

pub(super) struct FreeFormObjectResponseSchema;

impl utoipa::PartialSchema for FreeFormObjectResponseSchema {
    fn schema() -> RefOr<Schema> {
        free_form_object_schema()
    }
}

impl utoipa::ToSchema for FreeFormObjectResponseSchema {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("FreeFormObjectResponseSchema")
    }
}

/// Build a ready-to-merge router with its runtime providers bound.
pub(crate) fn router(state: DiscoveryState) -> Router {
    Router::new()
        .merge(trending::router(state.clone()))
        .merge(similarity::router(state))
}

fn validate_finite(value: Option<f64>, label: &str) -> Result<(), DiscoveryError> {
    if value.is_some_and(|value| !value.is_finite()) {
        return Err(DiscoveryError::InvalidData(format!(
            "{label} must be finite"
        )));
    }
    Ok(())
}

fn ensure_positive_id(id: i64, label: &str) -> Result<(), DiscoveryError> {
    if id <= 0 {
        return Err(DiscoveryError::InvalidData(format!(
            "{label} must be positive"
        )));
    }
    Ok(())
}

fn ensure_positive_id_option(id: Option<i64>, label: &str) -> Result<(), DiscoveryError> {
    if let Some(id) = id {
        ensure_positive_id(id, label)?;
    }
    Ok(())
}

fn unavailable_response(detail: &str) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"detail": detail})),
    )
        .into_response()
}

fn not_found_response(detail: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({"detail": detail}))).into_response()
}

fn provider_error_response(error: DiscoveryError) -> Response {
    match error {
        DiscoveryError::VectorStoreUnavailable => {
            unavailable_response(VECTOR_STORE_UNAVAILABLE_DETAIL)
        }
        DiscoveryError::Backend(message) | DiscoveryError::InvalidData(message) => {
            tracing::error!(%message, "discovery provider failed integrity or backend contract");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

fn parse_integer_query(
    raw_query: Option<&str>,
    field: &str,
    default: i64,
    minimum: Option<i64>,
    maximum: Option<i64>,
) -> Result<i64, HttpValidationError> {
    let Some(raw) = scalar_query(raw_query, field)? else {
        return Ok(default);
    };
    let parsed = raw.trim().parse::<i64>().map_err(|_| {
        invalid_query(
            field,
            Value::String(raw.clone()),
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
            None,
        )
    })?;
    if let Some(minimum) = minimum {
        if parsed < minimum {
            return Err(invalid_query(
                field,
                Value::String(raw),
                "greater_than_equal",
                &format!("Input should be greater than or equal to {minimum}"),
                Some(Map::from_iter([("ge".to_owned(), Value::from(minimum))])),
            ));
        }
    }
    if let Some(maximum) = maximum {
        if parsed > maximum {
            return Err(invalid_query(
                field,
                Value::String(raw),
                "less_than_equal",
                &format!("Input should be less than or equal to {maximum}"),
                Some(Map::from_iter([("le".to_owned(), Value::from(maximum))])),
            ));
        }
    }
    Ok(parsed)
}

fn scalar_query(
    raw_query: Option<&str>,
    name: &str,
) -> Result<Option<String>, HttpValidationError> {
    let mut found = None;
    for (key, value) in decoded_query_pairs(raw_query).map_err(|_| HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![ValidationLocation::Text("query".to_owned())],
            msg: "Invalid query string".to_owned(),
            error_type: "query_parsing".to_owned(),
            input: Value::String(raw_query.unwrap_or_default().to_owned()),
            ctx: None,
        }],
    })? {
        if key == name {
            found = Some(value);
        }
    }
    Ok(found)
}

fn decoded_query_pairs(raw_query: Option<&str>) -> Result<Vec<(String, String)>, ()> {
    raw_query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Ok((percent_decode(key)?, percent_decode(value)?))
        })
        .collect()
}

fn percent_decode(value: &str) -> Result<String, ()> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let high = hex_digit(bytes[index + 1]).ok_or(())?;
                let low = hex_digit(bytes[index + 2]).ok_or(())?;
                decoded.push((high << 4) | low);
                index += 3;
            }
            b'%' => return Err(()),
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).map_err(|_| ())
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn parse_integer_path_id(raw: &str, field: &str) -> Result<i64, HttpValidationError> {
    raw.trim().parse::<i64>().map_err(|_| {
        invalid_path(
            field,
            Value::String(raw.to_owned()),
            "int_parsing",
            "Input should be a valid integer, unable to parse string as an integer",
            None,
        )
    })
}

fn missing_query(field: &str) -> HttpValidationError {
    invalid_query(field, Value::Null, "missing", "Field required", None)
}

fn invalid_query(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    validation_error("query", field, input, error_type, message, ctx)
}

fn invalid_path(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    validation_error("path", field, input, error_type, message, ctx)
}

fn validation_error(
    location: &str,
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text(location.to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx,
        }],
    }
}
