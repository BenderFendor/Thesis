use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use axum::Json;
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use utoipa::openapi::schema::{ArrayBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};

const RSS_SOURCE_CATALOG: &str = include_str!("../../../app/data/rss_sources.json");

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

#[cfg(test)]
mod tests {
    use super::{configured_categories, get_categories, health_check, read_root};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::routing::get;
    use axum::Router;
    use serde_json::Value;
    use tower::ServiceExt;

    fn core_router() -> Router {
        Router::new()
            .route("/", get(read_root))
            .route("/health", get(health_check))
            .route("/categories", get(get_categories))
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
}
