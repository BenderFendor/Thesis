use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use axum::body::Bytes;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_search::language_diagnostics::{
    DiagnosticExample, DiagnosticMetric, DiagnosticOverall, DiagnosticStatus,
    LanguageDiagnosticsPayload,
};
use utoipa::openapi::schema::{ArrayBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const RSS_SOURCE_CATALOG: &str = include_str!("../../../app/data/rss_sources.json");
const NO_ARTICLE_TEXT_ERROR: &str = "No article text extracted";

/// OpenAPI schema marker for FastAPI's `dict[str, str]` responses.
#[derive(Debug)]
pub(crate) struct StringMapSchema;

impl PartialSchema for StringMapSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ObjectBuilder::new().schema_type(Type::String)))
            .build()
            .into()
    }
}

impl ToSchema for StringMapSchema {}

/// OpenAPI schema marker for FastAPI's `dict[str, list[str]]` response.
#[derive(Debug)]
pub(crate) struct StringListMapSchema;

impl PartialSchema for StringListMapSchema {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(Type::Object)
            .additional_properties(Some(ArrayBuilder::new().items(String::schema())))
            .build()
            .into()
    }
}

impl ToSchema for StringListMapSchema {}

#[derive(Debug, Serialize)]
pub(crate) struct RootResponse {
    message: String,
    version: String,
    docs: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct HealthResponse {
    status: String,
    timestamp: String,
}

/// Return the public API welcome payload.
#[utoipa::path(
    get,
    path = "/",
    operation_id = "read_root__get",
    responses((
        status = 200,
        description = "Successful Response",
        body = inline(StringMapSchema)
    ))
)]
pub(crate) async fn read_root() -> Json<RootResponse> {
    Json(RootResponse {
        message: "Global News Aggregation API is running!".to_owned(),
        version: "1.0.0".to_owned(),
        docs: "/docs".to_owned(),
    })
}

/// Return a liveness response with a UTC ISO-8601 timestamp.
#[utoipa::path(
    get,
    path = "/health",
    operation_id = "health_check_health_get",
    responses((
        status = 200,
        description = "Successful Response",
        body = inline(StringMapSchema)
    ))
)]
pub(crate) async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_owned(),
        timestamp: utc_isoformat(),
    })
}

fn utc_isoformat() -> String {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    format!("{}+00:00", timestamp.trim_end_matches('Z'))
}

/// Return a stable, sorted view of the configured RSS source categories.
#[utoipa::path(
    get,
    path = "/categories",
    operation_id = "get_categories_categories_get",
    responses((
        status = 200,
        description = "Successful Response",
        body = inline(StringListMapSchema)
    ))
)]
pub(crate) async fn get_categories() -> Json<BTreeMap<String, Vec<String>>> {
    Json(BTreeMap::from([(
        "categories".to_owned(),
        configured_categories(),
    )]))
}

fn configured_categories() -> Vec<String> {
    static CATEGORIES: LazyLock<Vec<String>> = LazyLock::new(|| {
        let catalog: Value = serde_json::from_str(RSS_SOURCE_CATALOG)
            .expect("the checked-in RSS source catalog must be valid JSON");
        let Some(sources) = catalog.as_object() else {
            return Vec::new();
        };
        let mut categories = BTreeSet::new();
        for source in sources.values() {
            let Some(source) = source.as_object() else {
                continue;
            };
            if !has_configured_url(source.get("url")) {
                continue;
            }
            let category = source
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("general");
            categories.insert(category.to_owned());
        }
        categories.into_iter().collect()
    });
    CATEGORIES.clone()
}

fn has_configured_url(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(url)) => !url.trim().is_empty(),
        Some(Value::Array(urls)) => urls
            .iter()
            .any(|url| url.as_str().is_some_and(|url| !url.trim().is_empty())),
        _ => false,
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub(crate) struct LanguageDiagnosticsRequest {
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) text: Option<String>,
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default)]
    pub(crate) source_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct LanguageDiagnosticExample {
    pub(crate) sentence: String,
    #[schema(required = false)]
    pub(crate) term: Option<String>,
    #[schema(required = false)]
    pub(crate) pattern: Option<String>,
    #[schema(required = false)]
    pub(crate) category: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LanguageDiagnosticStatus {
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct LanguageDiagnosticMetric {
    #[schema(value_type = i64)]
    pub(crate) count: usize,
    pub(crate) rate: f64,
    pub(crate) status: LanguageDiagnosticStatus,
    pub(crate) examples: Vec<LanguageDiagnosticExample>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct LanguageDiagnosticOverall {
    pub(crate) score: f64,
    pub(crate) status: LanguageDiagnosticStatus,
    pub(crate) summary: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct LanguageDiagnosticsResponse {
    pub(crate) success: bool,
    pub(crate) article_url: String,
    pub(crate) title: Option<String>,
    #[schema(required = false, default = 0, value_type = i64)]
    pub(crate) sentence_count: usize,
    #[schema(required = false, default = 0, value_type = i64)]
    pub(crate) word_count: usize,
    pub(crate) passive_voice: Option<LanguageDiagnosticMetric>,
    pub(crate) actor_omission: Option<LanguageDiagnosticMetric>,
    pub(crate) euphemisms: Option<LanguageDiagnosticMetric>,
    pub(crate) sanitized_language: Option<LanguageDiagnosticMetric>,
    pub(crate) overall: Option<LanguageDiagnosticOverall>,
    pub(crate) error: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/article/language-diagnostics",
    operation_id = "analyze_article_language_api_article_language_diagnostics_post",
    request_body = LanguageDiagnosticsRequest,
    responses(
        (status = 200, description = "Successful Response", body = LanguageDiagnosticsResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError)
    )
)]
pub(crate) async fn analyze_article_language(body: Bytes) -> Response {
    let request = match parse_language_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let LanguageDiagnosticsRequest {
        url,
        text,
        title,
        source_name,
    } = request;
    // The deterministic shadow route accepts this field but intentionally does not use it.
    std::mem::drop(source_name);

    let Some(text) = text.as_deref().filter(|text| !text.is_empty()) else {
        // URL extraction is intentionally not attempted by this deterministic shadow route.
        // FastAPI remains the public path for URL-only requests until a Rust HTTP extraction
        // boundary is wired. Returning the same 200/error response shape avoids an unbounded
        // provider call and makes the unsupported branch explicit to callers.
        return Json(failed_language_diagnostics(
            url,
            title,
            NO_ARTICLE_TEXT_ERROR,
        ))
        .into_response();
    };

    let payload =
        thesis_search::language_diagnostics::analyze_language_diagnostics(text, title.as_deref());
    Json(successful_language_diagnostics(url, title, payload)).into_response()
}

fn parse_language_request(body: &[u8]) -> Result<LanguageDiagnosticsRequest, HttpValidationError> {
    let value: Value = serde_json::from_slice(body).map_err(|error| HttpValidationError {
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
    })?;
    let Some(fields) = value.as_object() else {
        return Err(HttpValidationError::body(
            value,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    };

    let url = fields.get("url").ok_or_else(|| {
        HttpValidationError::field(value.clone(), "url", "missing", "Field required")
    })?;
    let url = url.as_str().map(str::to_owned).ok_or_else(|| {
        HttpValidationError::field(
            url.clone(),
            "url",
            "string_type",
            "Input should be a valid string",
        )
    })?;

    Ok(LanguageDiagnosticsRequest {
        url,
        text: optional_string(fields, "text")?,
        title: optional_string(fields, "title")?,
        source_name: optional_string(fields, "source_name")?,
    })
}

fn optional_string(
    fields: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, HttpValidationError> {
    match fields.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_str().map(str::to_owned).map(Some).ok_or_else(|| {
            HttpValidationError::field(
                value.clone(),
                field,
                "string_type",
                "Input should be a valid string",
            )
        }),
    }
}

fn successful_language_diagnostics(
    article_url: String,
    title: Option<String>,
    payload: LanguageDiagnosticsPayload,
) -> LanguageDiagnosticsResponse {
    LanguageDiagnosticsResponse {
        success: true,
        article_url,
        title,
        sentence_count: payload.sentence_count,
        word_count: payload.word_count,
        passive_voice: Some(payload.passive_voice.into()),
        actor_omission: Some(payload.actor_omission.into()),
        euphemisms: Some(payload.euphemisms.into()),
        sanitized_language: Some(payload.sanitized_language.into()),
        overall: Some(payload.overall.into()),
        error: None,
    }
}

fn failed_language_diagnostics(
    article_url: String,
    title: Option<String>,
    error: &str,
) -> LanguageDiagnosticsResponse {
    LanguageDiagnosticsResponse {
        success: false,
        article_url,
        title,
        sentence_count: 0,
        word_count: 0,
        passive_voice: None,
        actor_omission: None,
        euphemisms: None,
        sanitized_language: None,
        overall: None,
        error: Some(error.to_owned()),
    }
}

impl From<DiagnosticStatus> for LanguageDiagnosticStatus {
    fn from(status: DiagnosticStatus) -> Self {
        match status {
            DiagnosticStatus::Low => Self::Low,
            DiagnosticStatus::Medium => Self::Medium,
            DiagnosticStatus::High => Self::High,
        }
    }
}

impl From<DiagnosticExample> for LanguageDiagnosticExample {
    fn from(example: DiagnosticExample) -> Self {
        Self {
            sentence: example.sentence,
            term: example.term,
            pattern: example.pattern,
            category: example.category,
        }
    }
}

impl From<DiagnosticMetric> for LanguageDiagnosticMetric {
    fn from(metric: DiagnosticMetric) -> Self {
        Self {
            count: metric.count,
            rate: metric.rate,
            status: metric.status.into(),
            examples: metric.examples.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<DiagnosticOverall> for LanguageDiagnosticOverall {
    fn from(overall: DiagnosticOverall) -> Self {
        Self {
            score: overall.score,
            status: overall.status.into(),
            summary: overall.summary,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        analyze_article_language, configured_categories, get_categories, health_check, read_root,
    };
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::routing::{get, post};
    use axum::Router;
    use serde_json::Value;
    use tower::ServiceExt;

    fn core_router() -> Router {
        Router::new()
            .route("/", get(read_root))
            .route("/health", get(health_check))
            .route("/categories", get(get_categories))
            .route(
                "/api/article/language-diagnostics",
                post(analyze_article_language),
            )
    }

    async fn json_body(response: axum::response::Response) -> Value {
        serde_json::from_slice(
            &to_bytes(response.into_body(), 131_072)
                .await
                .expect("response body"),
        )
        .expect("JSON response")
    }

    #[tokio::test]
    async fn general_routes_preserve_response_shapes_and_sorted_catalog() {
        let root = core_router()
            .oneshot(Request::get("/").body(Body::empty()).expect("request"))
            .await
            .expect("root response");
        assert_eq!(root.status(), StatusCode::OK);
        assert_eq!(
            json_body(root).await,
            serde_json::json!({
                "message": "Global News Aggregation API is running!",
                "version": "1.0.0",
                "docs": "/docs"
            })
        );

        let health = core_router()
            .oneshot(
                Request::get("/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("health response");
        assert_eq!(health.status(), StatusCode::OK);
        let health_payload = json_body(health).await;
        assert_eq!(health_payload["status"], "healthy");
        let timestamp = health_payload["timestamp"].as_str().expect("timestamp");
        assert!(timestamp.ends_with("+00:00"));
        assert_eq!(timestamp.len(), 32);

        let categories = core_router()
            .oneshot(
                Request::get("/categories")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("categories response");
        assert_eq!(categories.status(), StatusCode::OK);
        let categories_payload = json_body(categories).await;
        let categories = categories_payload["categories"]
            .as_array()
            .expect("category list");
        let sorted = categories
            .iter()
            .map(|category| category.as_str().expect("string category"))
            .collect::<Vec<_>>();
        let mut expected = sorted.clone();
        expected.sort_unstable();
        expected.dedup();
        assert_eq!(sorted, expected);
        assert_eq!(
            sorted,
            configured_categories()
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn language_route_matches_search_payload_for_inline_text() {
        let response = core_router()
            .oneshot(
                Request::post("/api/article/language-diagnostics")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"url":"https://example.com/story","title":"Example","text":"People were detained overnight. Officials described unrest near the square."}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("diagnostic response");
        assert_eq!(response.status(), StatusCode::OK);
        let payload = json_body(response).await;
        assert_eq!(payload["success"], true);
        assert_eq!(payload["article_url"], "https://example.com/story");
        assert_eq!(payload["title"], "Example");
        assert_eq!(payload["actor_omission"]["count"], 1);
        assert_eq!(payload["sanitized_language"]["count"], 1);
        for key in [
            "sentence_count",
            "word_count",
            "passive_voice",
            "actor_omission",
            "euphemisms",
            "sanitized_language",
            "overall",
        ] {
            assert!(!payload[key].is_null(), "missing response field {key}");
        }
        assert!(payload["error"].is_null());
    }

    #[tokio::test]
    async fn language_route_returns_fastapi_shape_for_empty_and_malformed_inputs() {
        let empty = core_router()
            .clone()
            .oneshot(
                Request::post("/api/article/language-diagnostics")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"url":"https://example.com/story","text":""}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("empty response");
        assert_eq!(empty.status(), StatusCode::OK);
        let empty_payload = json_body(empty).await;
        assert_eq!(empty_payload["success"], false);
        assert_eq!(empty_payload["error"], "No article text extracted");
        assert_eq!(empty_payload["sentence_count"], 0);
        assert!(empty_payload["passive_voice"].is_null());

        for body in [
            r#"{}"#,
            r#"{"url":12}"#,
            r#"{"url":"https://example.com","text":false}"#,
            r#"not-json"#,
        ] {
            let response = core_router()
                .clone()
                .oneshot(
                    Request::post("/api/article/language-diagnostics")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .expect("request"),
                )
                .await
                .expect("malformed response");
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
            let payload = json_body(response).await;
            assert!(payload["detail"].is_array());
            assert!(!payload["detail"][0]["loc"].is_null());
            assert!(!payload["detail"][0]["type"].is_null());
        }
    }

    #[tokio::test]
    async fn language_route_keeps_unicode_boundary_and_title_ignored_by_domain() {
        let body = r#"{"url":"u","title":"was killed","text":"İ ı ſ K café café 123 _word word-word word's"}"#;
        let response = core_router()
            .oneshot(
                Request::post("/api/article/language-diagnostics")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("unicode response");
        assert_eq!(response.status(), StatusCode::OK);
        let payload = json_body(response).await;
        assert_eq!(payload["success"], true);
        assert_eq!(payload["word_count"], 10);
        assert_eq!(payload["passive_voice"]["count"], 0);
        assert_eq!(payload["overall"]["status"], "low");
    }
}
