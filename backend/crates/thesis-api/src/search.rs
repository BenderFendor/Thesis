//! Typed boundary for the semantic-search operation.
//!
//! The vector store and persisted article lookup remain runtime integrations. This
//! module owns query validation, deterministic result projection, and the public
//! FastAPI response/status contract without attempting network or provider work.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::RawQuery;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use utoipa::IntoParams;
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

/// A future returned by the semantic-search integration.
pub type SearchFuture<T> = Pin<Box<dyn Future<Output = Result<T, SemanticSearchError>> + Send>>;

/// A runtime failure returned by the semantic-search integration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SemanticSearchError {
    /// A provider was invoked despite its vector-store configuration being absent.
    VectorStoreUnavailable,
    /// A database or configured provider failure that must not become a successful payload.
    Backend(String),
}

/// Normalized input passed to the semantic-search integration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticSearchRequest {
    /// The original query string, including intentional whitespace.
    pub query: String,
    /// The validated result limit. FastAPI permits values below zero because the
    /// public query only declares an upper bound.
    pub limit: i64,
    /// Lowercase category metadata for Chroma, or `None` for an unrestricted search.
    pub category: Option<String>,
}

/// A vector-store hit before persisted article projection.
#[derive(Clone, Debug, PartialEq)]
pub struct SemanticSearchHit {
    /// Persisted article id, when the vector row identifies one.
    pub article_id: Option<i64>,
    /// Chroma distance for this hit.
    pub distance: f64,
    /// Similarity score exposed by the public response.
    pub similarity_score: f64,
}

/// Persisted article fields used by the semantic-search response.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticArticle {
    /// Article id.
    pub id: i64,
    /// Article headline.
    pub title: String,
    /// Source display name.
    pub source: String,
    /// Optional article summary.
    pub summary: Option<String>,
    /// Optional image URL.
    pub image: Option<String>,
    /// Optional ISO publication timestamp.
    pub published: Option<String>,
    /// Optional category.
    pub category: Option<String>,
    /// Canonical article URL from the persisted record.
    pub url: String,
}

/// Snapshot returned by the runtime integration or a deterministic cache.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SemanticSearchSnapshot {
    /// Chroma hits in provider order.
    pub hits: Vec<SemanticSearchHit>,
    /// Articles keyed by their persisted ids.
    pub articles: BTreeMap<i64, SemanticArticle>,
}

/// Sidecar for Chroma search plus persisted article lookup/history recording.
///
/// Implementations must perform the provider/database work outside this crate. A
/// successful snapshot must contain only decoded, persisted article data; an
/// unavailable vector store must return [`SemanticSearchError::VectorStoreUnavailable`].
pub trait SemanticSearchProvider: Send + Sync {
    /// Execute one validated semantic-search request.
    fn search(&self, request: SemanticSearchRequest) -> SearchFuture<SemanticSearchSnapshot>;
    /// Whether all required embedding and vector-store dependencies are configured.
    fn is_configured(&self) -> bool {
        true
    }
}

/// State needed by the semantic-search route.
#[derive(Clone, Default)]
pub struct SemanticSearchState {
    /// Optional runtime provider. `None` deliberately produces FastAPI's 503 response.
    pub provider: Option<Arc<dyn SemanticSearchProvider>>,
}

impl SemanticSearchState {
    /// Build state with an optional semantic-search provider.
    pub fn new(provider: Option<Arc<dyn SemanticSearchProvider>>) -> Self {
        Self { provider }
    }

    /// Build state with a configured semantic-search provider.
    pub fn with_provider(provider: impl SemanticSearchProvider + 'static) -> Self {
        Self::new(Some(Arc::new(provider)))
    }

    /// Whether a semantic-search provider is configured.
    pub fn is_configured(&self) -> bool {
        self.provider
            .as_ref()
            .is_some_and(|provider| provider.is_configured())
    }
}

/// Construct the semantic-search route with its runtime sidecar state.
pub(crate) fn router(state: SemanticSearchState) -> Router {
    Router::new()
        .route("/api/search/semantic", get(semantic_search))
        .with_state(state)
}

/// One projected semantic-search result.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub(crate) struct SemanticSearchResult {
    /// Persisted article id.
    pub id: i64,
    /// Article headline.
    pub title: String,
    /// Source display name.
    pub source: String,
    /// Optional article summary.
    #[schema(required = false)]
    pub summary: Option<String>,
    /// Optional image URL.
    #[schema(required = false)]
    pub image: Option<String>,
    /// Optional ISO publication timestamp.
    #[schema(required = false)]
    pub published: Option<String>,
    /// Optional article category.
    #[schema(required = false)]
    pub category: Option<String>,
    /// Canonical article URL from the persisted record.
    pub url: String,
    /// Chroma-derived similarity score.
    pub similarity_score: f64,
    /// Chroma distance.
    pub distance: f64,
}

/// Public response for `GET /api/search/semantic`.
#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub(crate) struct SemanticSearchResponse {
    /// Original query string.
    pub query: String,
    /// Matching persisted articles.
    pub results: Vec<SemanticSearchResult>,
    /// Number of projected results.
    pub total: usize,
}

/// Query parameters documented by the public FastAPI operation.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SemanticSearchParameters {
    #[param(min_length = 3)]
    pub query: String,
    #[param(required = false, default = 10, maximum = 50)]
    pub limit: Option<i64>,
    #[param(required = false, nullable = true)]
    pub category: Option<String>,
}

/// Project a provider snapshot without performing I/O.
pub(crate) fn project_semantic_response(
    query: String,
    snapshot: SemanticSearchSnapshot,
) -> SemanticSearchResponse {
    let SemanticSearchSnapshot { hits, articles } = snapshot;
    let results = hits
        .into_iter()
        .filter_map(|hit| {
            let article_id = hit.article_id.filter(|article_id| *article_id > 0)?;
            let article = articles.get(&article_id)?;
            Some(SemanticSearchResult {
                id: article.id,
                title: article.title.clone(),
                source: article.source.clone(),
                summary: article.summary.clone(),
                image: article.image.clone(),
                published: article.published.clone(),
                category: article.category.clone(),
                url: article.url.clone(),
                similarity_score: hit.similarity_score,
                distance: hit.distance,
            })
        })
        .collect::<Vec<_>>();
    SemanticSearchResponse {
        query,
        total: results.len(),
        results,
    }
}

#[utoipa::path(
    get,
    path = "/api/search/semantic",
    operation_id = "semantic_search_api_search_semantic_get",
    tag = "search",
    params(SemanticSearchParameters),
    responses(
        (status = 200, description = "Successful Response", body = SemanticSearchResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn semantic_search(
    axum::extract::State(state): axum::extract::State<SemanticSearchState>,
    RawQuery(raw_query): RawQuery,
) -> Response {
    let request = match parse_semantic_query(raw_query.as_deref()) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider.filter(|provider| provider.is_configured()) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"detail": "Vector store is not available"})),
        )
            .into_response();
    };
    let query = request.query.clone();
    let snapshot = match provider.search(request).await {
        Ok(snapshot) => snapshot,
        Err(SemanticSearchError::VectorStoreUnavailable) => {
            tracing::error!("configured semantic-search provider reported no vector-store config");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
        Err(SemanticSearchError::Backend(error)) => {
            tracing::error!(%error, "semantic search provider failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    Json(project_semantic_response(query, snapshot)).into_response()
}

fn parse_semantic_query(
    raw_query: Option<&str>,
) -> Result<SemanticSearchRequest, HttpValidationError> {
    let mut query: Option<String> = None;
    let mut limit: Option<(String, Value)> = None;
    let mut category: Option<String> = None;
    for pair in raw_query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = percent_decode_query_component(raw_key).map_err(|_| {
            query_error(
                "query",
                Value::String(raw_key.to_owned()),
                "query_string_parsing",
                "Invalid query string",
                None,
            )
        })?;
        let value = percent_decode_query_component(raw_value).map_err(|_| {
            query_error(
                &key,
                Value::String(raw_value.to_owned()),
                "query_string_parsing",
                "Invalid query string",
                None,
            )
        })?;
        match key.as_str() {
            "query" => query = Some(value),
            "limit" => limit = Some((value.clone(), Value::String(value))),
            "category" => category = Some(value),
            _ => {}
        }
    }

    let query = query
        .ok_or_else(|| query_error("query", Value::Null, "missing", "Field required", None))?;
    if query.chars().count() < 3 {
        return Err(query_error(
            "query",
            Value::String(query),
            "string_too_short",
            "String should have at least 3 characters",
            Some(Map::from_iter([("min_length".to_owned(), Value::from(3))])),
        ));
    }

    let limit = match limit {
        None => 10,
        Some((raw, input)) => {
            let parsed = raw.trim().parse::<i64>().map_err(|_| {
                query_error(
                    "limit",
                    input.clone(),
                    "int_parsing",
                    "Input should be a valid integer, unable to parse string as an integer",
                    None,
                )
            })?;
            if parsed > 50 {
                return Err(query_error(
                    "limit",
                    input,
                    "less_than_equal",
                    "Input should be less than or equal to 50",
                    Some(Map::from_iter([("le".to_owned(), Value::from(50))])),
                ));
            }
            parsed
        }
    };

    let category = category
        .map(|value| value.to_lowercase())
        .filter(|value| !value.is_empty() && value != "all");
    Ok(SemanticSearchRequest {
        query,
        limit,
        category,
    })
}

fn query_error(
    field: &str,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text(field.to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx,
        }],
    }
}

fn percent_decode_query_component(value: &str) -> Result<String, ()> {
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

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Arc;

    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use serde_json::Value;
    use tower::ServiceExt;

    use super::{
        parse_semantic_query, project_semantic_response, SearchFuture, SemanticArticle,
        SemanticSearchError, SemanticSearchHit, SemanticSearchProvider, SemanticSearchSnapshot,
        SemanticSearchState,
    };

    struct CapturedProvider {
        result: Result<SemanticSearchSnapshot, SemanticSearchError>,
    }

    impl SemanticSearchProvider for CapturedProvider {
        fn search(
            &self,
            _request: super::SemanticSearchRequest,
        ) -> SearchFuture<SemanticSearchSnapshot> {
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }

    fn state(provider: Option<Arc<dyn SemanticSearchProvider>>) -> SemanticSearchState {
        SemanticSearchState { provider }
    }

    #[test]
    fn query_validation_matches_fastapi_bounds_and_normalization() {
        assert_eq!(
            parse_semantic_query(Some("query=Climate%20change&limit=50&category=ALL"))
                .expect("valid query"),
            super::SemanticSearchRequest {
                query: "Climate change".to_owned(),
                limit: 50,
                category: None,
            }
        );
        assert_eq!(
            parse_semantic_query(Some("query=abc&limit=-1"))
                .expect("negative limit")
                .limit,
            -1
        );
        for (raw, error_type, field) in [
            (None, "missing", "query"),
            (Some("query=ab"), "string_too_short", "query"),
            (Some("query=abc&limit=51"), "less_than_equal", "limit"),
            (Some("query=abc&limit=bad"), "int_parsing", "limit"),
        ] {
            let error = parse_semantic_query(raw).expect_err("invalid query");
            assert_eq!(error.detail[0].error_type, error_type);
            assert!(matches!(
                &error.detail[0].loc[1],
                super::ValidationLocation::Text(value) if value == field
            ));
        }
    }

    #[test]
    fn projection_skips_unpersisted_and_nonpositive_articles_but_preserves_provider_order() {
        let response = project_semantic_response(
            "query".to_owned(),
            SemanticSearchSnapshot {
                hits: vec![
                    SemanticSearchHit {
                        article_id: Some(2),
                        distance: 0.2,
                        similarity_score: 0.8,
                    },
                    SemanticSearchHit {
                        article_id: Some(1),
                        distance: 0.1,
                        similarity_score: 0.9,
                    },
                    SemanticSearchHit {
                        article_id: Some(0),
                        distance: 0.0,
                        similarity_score: 1.0,
                    },
                    SemanticSearchHit {
                        article_id: None,
                        distance: 0.0,
                        similarity_score: 1.0,
                    },
                ],
                articles: BTreeMap::from([
                    (
                        0,
                        SemanticArticle {
                            id: 0,
                            title: "Non-persisted".to_owned(),
                            source: "Source".to_owned(),
                            summary: None,
                            image: None,
                            published: None,
                            category: None,
                            url: "https://example.test/0".to_owned(),
                        },
                    ),
                    (
                        1,
                        SemanticArticle {
                            id: 1,
                            title: "First".to_owned(),
                            source: "Source".to_owned(),
                            summary: None,
                            image: None,
                            published: None,
                            category: Some("world".to_owned()),
                            url: "https://example.test/1".to_owned(),
                        },
                    ),
                ]),
            },
        );
        assert_eq!(response.total, 1);
        assert_eq!(response.results[0].id, 1);
    }

    struct FixtureSemanticSearchProvider {
        configured: bool,
    }

    impl SemanticSearchProvider for FixtureSemanticSearchProvider {
        fn search(
            &self,
            request: super::SemanticSearchRequest,
        ) -> SearchFuture<SemanticSearchSnapshot> {
            Box::pin(async move {
                if request.query != "climate policy"
                    || request.limit != 2
                    || request.category.as_deref() != Some("world")
                {
                    return Ok(SemanticSearchSnapshot::default());
                }
                Ok(SemanticSearchSnapshot {
                    hits: vec![
                        SemanticSearchHit {
                            article_id: Some(11),
                            distance: 0.14,
                            similarity_score: 0.86,
                        },
                        SemanticSearchHit {
                            article_id: Some(12),
                            distance: 0.3,
                            similarity_score: 0.7,
                        },
                    ],
                    articles: BTreeMap::from([
                        (
                            11,
                            SemanticArticle {
                                id: 11,
                                title: "Climate policy changes".to_owned(),
                                source: "Climate Desk".to_owned(),
                                summary: Some("A persisted summary.".to_owned()),
                                image: Some("https://example.test/image.jpg".to_owned()),
                                published: Some("2026-09-01T00:00:00+00:00".to_owned()),
                                category: Some("world".to_owned()),
                                url: "https://example.test/climate-policy".to_owned(),
                            },
                        ),
                        (
                            12,
                            SemanticArticle {
                                id: 12,
                                title: "Carbon reporting".to_owned(),
                                source: "Daily Ledger".to_owned(),
                                summary: None,
                                image: None,
                                published: None,
                                category: Some("world".to_owned()),
                                url: "https://example.test/carbon".to_owned(),
                            },
                        ),
                    ]),
                })
            })
        }

        fn is_configured(&self) -> bool {
            self.configured
        }
    }
    #[test]
    fn semantic_search_state_reports_provider_configuration() {
        assert!(!SemanticSearchState::default().is_configured());
        assert!(
            SemanticSearchState::with_provider(FixtureSemanticSearchProvider { configured: true })
                .is_configured()
        );
        assert!(
            !SemanticSearchState::with_provider(FixtureSemanticSearchProvider {
                configured: false
            })
            .is_configured()
        );
    }

    #[tokio::test]
    async fn semantic_search_route_filters_category_and_projects_ranked_rows() {
        let router = super::router(state(Some(Arc::new(FixtureSemanticSearchProvider {
            configured: true,
        }))));
        let response = router
            .oneshot(
                Request::get("/api/search/semantic?query=climate%20policy&limit=2&category=WoRLD")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("body"),
        )
        .expect("JSON");
        assert_eq!(payload["query"], "climate policy");
        assert_eq!(payload["total"], 2);
        assert_eq!(payload["results"][0]["id"], 11);
        assert_eq!(payload["results"][0]["title"], "Climate policy changes");
        assert_eq!(payload["results"][0]["source"], "Climate Desk");
        assert_eq!(payload["results"][0]["summary"], "A persisted summary.");
        assert_eq!(
            payload["results"][0]["image"],
            "https://example.test/image.jpg"
        );
        assert_eq!(
            payload["results"][0]["published"],
            "2026-09-01T00:00:00+00:00"
        );
        assert_eq!(payload["results"][0]["category"], "world");
        assert_eq!(
            payload["results"][0]["url"],
            "https://example.test/climate-policy"
        );
        assert_eq!(payload["results"][0]["similarity_score"], 0.86);
        assert_eq!(payload["results"][0]["distance"], 0.14);
        assert_eq!(payload["results"][1]["id"], 12);
        assert_eq!(payload["results"][1]["similarity_score"], 0.7);
    }

    #[tokio::test]
    async fn unavailable_vector_store_keeps_fastapi_503_shape() {
        let router = super::router(state(None));
        let response = router
            .oneshot(
                Request::get("/api/search/semantic?query=climate")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("body"),
        )
        .expect("JSON");
        assert_eq!(
            payload,
            serde_json::json!({"detail": "Vector store is not available"})
        );
    }

    #[tokio::test]
    async fn provider_marked_unconfigured_is_not_invoked() {
        let router = super::router(state(Some(Arc::new(FixtureSemanticSearchProvider {
            configured: false,
        }))));
        let response = router
            .oneshot(
                Request::get("/api/search/semantic?query=climate")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
    #[tokio::test]
    async fn configured_provider_unavailable_error_is_internal_not_503() {
        let router = super::router(state(Some(Arc::new(CapturedProvider {
            result: Err(SemanticSearchError::VectorStoreUnavailable),
        }))));
        let response = router
            .oneshot(
                Request::get("/api/search/semantic?query=climate")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn backend_provider_failure_is_500_not_an_empty_success() {
        let router = super::router(state(Some(Arc::new(CapturedProvider {
            result: Err(SemanticSearchError::Backend("database offline".to_owned())),
        }))));
        let response = router
            .oneshot(
                Request::get("/api/search/semantic?query=climate")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        assert_eq!(body.as_ref(), b"Internal Server Error");
    }

    #[allow(dead_code)]
    fn _future_type_is_object_safe<
        T: Future<Output = Result<SemanticSearchSnapshot, SemanticSearchError>> + Send + 'static,
    >(
        future: T,
    ) -> Pin<Box<dyn Future<Output = Result<SemanticSearchSnapshot, SemanticSearchError>> + Send>>
    {
        Box::pin(future)
    }
}
