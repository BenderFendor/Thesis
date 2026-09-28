use crate::{cache_stream, router, router_with_sidecars, source_catalog, RouterSidecars};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::response::Response;
use axum::Router;
use thesis_db::Database;
use tower::ServiceExt;

const RESPONSE_LIMIT_BYTES: usize = 256 * 1024;
const TEST_TIMESTAMP: &str = "2026-09-24T00:00:00+00:00";

fn test_database() -> Database {
    Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
        .expect("valid lazy PostgreSQL URL")
}

fn populated_cache() -> cache_stream::CacheStreamState {
    let state = cache_stream::CacheStreamState::new();
    state.replace_cache(cache_stream::CacheSnapshot::new(
        vec![
            serde_json::json!({
                "id": 1,
                "title": "Reuters economy analysis",
                "link": "https://example.org/reuters/economy",
                "description": "First analysis result",
                "published": "2026-09-24T00:00:00+00:00",
                "source": "Reuters",
                "category": "world"
            }),
            serde_json::json!({
                "id": 2,
                "title": "Reuters policy analysis",
                "link": "https://example.org/reuters/policy",
                "description": "Second analysis result",
                "published": "2026-09-23T00:00:00+00:00",
                "source": "Reuters",
                "category": "world"
            }),
            serde_json::json!({
                "id": 3,
                "title": "Local update",
                "link": "https://example.org/local/update",
                "description": "A separate cache entry",
                "published": "2026-09-22T00:00:00+00:00",
                "source": "Unconfigured Source",
                "category": "politics"
            }),
        ],
        vec![serde_json::json!({
            "article_count": 2,
            "bias_rating": "CENTER",
            "category": "general",
            "country": "US",
            "error_message": null,
            "funding_type": "commercial",
            "last_checked": TEST_TIMESTAMP,
            "name": "Reuters",
            "status": "working",
            "url": "https://www.reuters.com"
        })],
        0.0,
        TEST_TIMESTAMP,
    ));
    state
}

fn app_with_cache(state: cache_stream::CacheStreamState) -> Router {
    router_with_sidecars(
        test_database(),
        RouterSidecars::default().with_cache_stream(state),
    )
}

async fn get(app: &Router, uri: &str) -> Response {
    app.clone()
        .oneshot(Request::get(uri).body(Body::empty()).expect("GET request"))
        .await
        .expect("GET response")
}

async fn success_json(response: Response) -> serde_json::Value {
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(
        &to_bytes(response.into_body(), RESPONSE_LIMIT_BYTES)
            .await
            .expect("successful JSON response body"),
    )
    .expect("successful JSON response")
}

async fn assert_internal_server_error(response: Response) {
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response.headers()["content-type"],
        "text/plain; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), 16_384)
        .await
        .expect("internal server error body");
    assert_eq!(body.as_ref(), b"Internal Server Error");
}

#[tokio::test]
async fn cached_page_filters_sources_and_paginates() {
    let app = app_with_cache(populated_cache());

    let page = success_json(
        get(
            &app,
            "/news/page/cached?limit=1&offset=1&category=ALL&sources=reuters%2CREUTERS&search=analysis",
        )
        .await,
    )
    .await;
    assert_eq!(page["total"], 2);
    assert_eq!(page["articles"][0]["title"], "Reuters policy analysis");
    assert_eq!(page["articles"][0]["article_id"], 2);
    assert_eq!(page["articles"][0]["summary"], "Second analysis result");
    assert_eq!(page["next_cursor"], serde_json::Value::Null);
    assert_eq!(page["prev_cursor"], serde_json::Value::Null);
    assert_eq!(page["has_more"], false);

    let first_page = success_json(
        get(
            &app,
            "/news/page/cached?limit=1&sources=reuters&search=analysis",
        )
        .await,
    )
    .await;
    assert_eq!(
        first_page["articles"][0]["title"],
        "Reuters economy analysis"
    );
    assert_eq!(first_page["next_cursor"], "1");
    assert_eq!(first_page["has_more"], true);

    let source_list_precedence = success_json(
        get(
            &app,
            "/news/page/cached?source=Unconfigured%20Source&sources=Reuters&limit=10",
        )
        .await,
    )
    .await;
    assert_eq!(source_list_precedence["total"], 2);
    assert!(source_list_precedence["articles"]
        .as_array()
        .expect("filtered articles")
        .iter()
        .all(|article| article["source"] == "Reuters"));

    let source_fallback = success_json(
        get(
            &app,
            "/news/page/cached?source=Reuters&sources=%2C&limit=10",
        )
        .await,
    )
    .await;
    assert_eq!(source_fallback["total"], 2);
    assert!(source_fallback["articles"]
        .as_array()
        .expect("fallback articles")
        .iter()
        .all(|article| article["source"] == "Reuters"));

    let local_source_page =
        success_json(get(&app, "/news/page/cached?source=Unconfigured%20Source").await).await;
    assert_eq!(local_source_page["total"], 1);
    assert_eq!(
        local_source_page["articles"][0]["source_id"],
        "unconfigured-source"
    );

    let invalid_offset = get(&app, "/news/page/cached?offset=-1").await;
    assert_eq!(invalid_offset.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn cached_index_filters_and_sets_cache_headers() {
    let app = app_with_cache(populated_cache());
    let response = get(
        &app,
        "/news/index/cached?category=world&source=Reuters&search=ANALYSIS",
    )
    .await;
    assert_eq!(
        response.headers()["cache-control"],
        "public, max-age=5, stale-while-revalidate=15"
    );
    assert_eq!(response.headers()["vary"], "Accept-Encoding");
    let index = success_json(response).await;
    assert_eq!(index["total"], 2);
}

#[tokio::test]
async fn cached_page_and_index_project_the_same_filtered_snapshot() {
    let app = app_with_cache(populated_cache());
    let index = success_json(
        get(
            &app,
            "/news/index/cached?category=world&source=Reuters&search=analysis",
        )
        .await,
    )
    .await;
    let first_page = success_json(
        get(
            &app,
            "/news/page/cached?limit=1&offset=0&category=world&source=Reuters&search=analysis",
        )
        .await,
    )
    .await;
    let second_page = success_json(
        get(
            &app,
            "/news/page/cached?limit=1&offset=1&category=world&source=Reuters&search=analysis",
        )
        .await,
    )
    .await;

    assert_eq!(index["total"], 2);
    assert_eq!(first_page["total"], index["total"]);
    assert_eq!(second_page["total"], index["total"]);
    assert_eq!(first_page["articles"][0], index["articles"][0]);
    assert_eq!(second_page["articles"][0], index["articles"][1]);
    assert!(first_page["has_more"]
        .as_bool()
        .expect("first page has more"));
    assert!(!second_page["has_more"]
        .as_bool()
        .expect("second page is final"));
}

#[tokio::test]
async fn source_and_category_routes_project_configured_articles() {
    let app = app_with_cache(populated_cache());

    let by_source = success_json(get(&app, "/news/source/Reuters").await).await;
    assert_eq!(by_source.as_array().expect("source article list").len(), 2);

    let unknown_source = get(&app, "/news/source/Not-Configured").await;
    assert_eq!(unknown_source.status(), StatusCode::NOT_FOUND);

    let by_category = success_json(get(&app, "/news/category/world").await).await;
    assert_eq!(by_category["total"], 2);
    assert_eq!(by_category["sources"], serde_json::json!(["Reuters"]));
}

#[tokio::test]
async fn source_stats_reject_invalid_rows_and_accept_valid_rows() {
    let state = populated_cache();
    let app = app_with_cache(state.clone());

    assert_internal_server_error(get(&app, "/news/sources/stats").await).await;

    let valid_source_stats: Vec<serde_json::Value> = source_catalog::configured_catalog()
        .iter()
        .map(|source| {
            serde_json::json!({
                "article_count": 0,
                "category": source.category,
                "country": source.country,
                "last_checked": TEST_TIMESTAMP,
                "name": source.name,
                "status": "working",
                "url": "https://example.org/feed"
            })
        })
        .collect();
    state.replace_cache(cache_stream::CacheSnapshot::new(
        Vec::new(),
        valid_source_stats,
        0.0,
        TEST_TIMESTAMP,
    ));

    let stats = success_json(get(&app, "/news/sources/stats").await).await;
    let sources = stats["sources"].as_array().expect("source stats list");
    assert_eq!(stats["total_sources"], serde_json::json!(sources.len()));
    assert_eq!(sources.len(), source_catalog::configured_catalog().len());
    assert!(sources
        .iter()
        .all(|source| source["last_checked"].is_string() && source["url"].is_string()));
}

#[tokio::test]
async fn default_empty_routes_return_empty_data_and_source_stats_error() {
    let app = router(test_database());

    let page = success_json(get(&app, "/news/page/cached").await).await;
    assert_eq!(page["articles"], serde_json::json!([]));
    assert_eq!(page["total"], 0);
    assert_eq!(page["limit"], 50);

    let source = success_json(get(&app, "/news/source/Reuters").await).await;
    assert_eq!(source, serde_json::json!([]));

    assert_internal_server_error(get(&app, "/news/sources/stats").await).await;
}

fn cache_with_articles(articles: Vec<serde_json::Value>) -> cache_stream::CacheStreamState {
    let state = cache_stream::CacheStreamState::new();
    state.replace_cache(cache_stream::CacheSnapshot::new(
        articles,
        Vec::new(),
        0.0,
        TEST_TIMESTAMP,
    ));
    state
}

#[tokio::test]
async fn debug_cache_filters_exact_source_paginates_and_projects_nullable_fields() {
    let app = app_with_cache(cache_with_articles(vec![
        serde_json::json!({
            "title": "First Reuters story",
            "link": "https://example.org/first",
            "description": "First description",
            "published": "2026-09-24T00:00:00+00:00",
            "source": "Reuters",
            "category": "world"
        }),
        serde_json::json!({
            "title": "Second Reuters story",
            "link": "https://example.org/second",
            "description": "Second description",
            "published": "2026-09-23T00:00:00+00:00",
            "source": "Reuters",
            "author": "Ignored author",
            "authors": ["Ignored author"],
            "author_urls": ["https://example.org/author"],
            "mentioned_countries": ["US"],
            "extra": "ignored"
        }),
        serde_json::json!({
            "id": 3,
            "title": "Local story",
            "link": "https://example.org/local",
            "description": "Local description",
            "published": "2026-09-22T00:00:00+00:00",
            "source": "Local",
            "category": "politics"
        }),
    ]));

    let page = success_json(
        get(
            &app,
            "/debug/cache/articles?source=Reuters&limit=1&offset=1",
        )
        .await,
    )
    .await;
    assert_eq!(page["limit"], 1);
    assert_eq!(page["offset"], 1);
    assert_eq!(page["source"], "Reuters");
    assert_eq!(page["total"], 2);
    assert_eq!(page["returned"], 1);
    let article = &page["articles"][0];
    assert_eq!(article["title"], "Second Reuters story");
    assert_eq!(article["category"], "general");
    assert_eq!(article["country"], serde_json::Value::Null);
    assert_eq!(article["id"], serde_json::Value::Null);
    assert_eq!(article["image"], serde_json::Value::Null);
    let article_fields = article.as_object().expect("article object");
    assert_eq!(article_fields.len(), 9);
    assert!(!article_fields.contains_key("author"));
    assert!(!article_fields.contains_key("authors"));
    assert!(!article_fields.contains_key("author_urls"));
    assert!(!article_fields.contains_key("mentioned_countries"));
    assert!(!article_fields.contains_key("extra"));

    let wrong_case = success_json(get(&app, "/debug/cache/articles?source=reuters").await).await;
    assert_eq!(wrong_case["total"], 0);
    assert_eq!(wrong_case["articles"], serde_json::json!([]));
}

#[tokio::test]
async fn debug_cache_defaults_and_blank_source_return_cache_order() {
    let app = app_with_cache(cache_with_articles(vec![
        serde_json::json!({
            "title": "Older first",
            "link": "https://example.org/older",
            "description": "Older",
            "published": "2026-09-20T00:00:00+00:00",
            "source": "Source A",
            "category": "world"
        }),
        serde_json::json!({
            "title": "Newer second",
            "link": "https://example.org/newer",
            "description": "Newer",
            "published": "2026-09-24T00:00:00+00:00",
            "source": "Source B",
            "category": "world"
        }),
    ]));

    let default_page = success_json(get(&app, "/debug/cache/articles").await).await;
    assert_eq!(default_page["limit"], 50);
    assert_eq!(default_page["offset"], 0);
    assert_eq!(default_page["source"], serde_json::Value::Null);
    assert_eq!(default_page["total"], 2);
    assert_eq!(default_page["returned"], 2);
    assert_eq!(default_page["articles"][0]["title"], "Older first");
    assert_eq!(default_page["articles"][1]["title"], "Newer second");
    let empty_page = success_json(get(&app, "/debug/cache/articles?offset=50").await).await;
    assert_eq!(empty_page["articles"], serde_json::json!([]));
    assert_eq!(empty_page["returned"], 0);
    assert_eq!(empty_page["total"], 2);

    let blank_source = success_json(get(&app, "/debug/cache/articles?source=").await).await;
    assert_eq!(blank_source["source"], "");
    assert_eq!(blank_source["total"], 2);
    assert_eq!(blank_source["returned"], 2);
    assert_eq!(blank_source["articles"][0]["title"], "Older first");
    assert_eq!(blank_source["articles"][1]["title"], "Newer second");
}

#[tokio::test]
async fn debug_cache_rejects_invalid_page_bounds() {
    let app = app_with_cache(cache_with_articles(Vec::new()));
    for (uri, field, error_type) in [
        (
            "/debug/cache/articles?limit=0",
            "limit",
            "greater_than_equal",
        ),
        (
            "/debug/cache/articles?limit=501",
            "limit",
            "less_than_equal",
        ),
        (
            "/debug/cache/articles?offset=-1",
            "offset",
            "greater_than_equal",
        ),
        ("/debug/cache/articles?limit=abc", "limit", "int_parsing"),
    ] {
        let response = get(&app, uri).await;
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), RESPONSE_LIMIT_BYTES)
            .await
            .expect("validation response body");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("validation response JSON");
        assert_eq!(
            payload["detail"][0]["loc"],
            serde_json::json!(["query", field])
        );
        assert_eq!(payload["detail"][0]["type"], error_type);
    }
}

#[tokio::test]
async fn debug_cache_reports_malformed_articles_as_generic_server_errors() {
    let app = app_with_cache(cache_with_articles(vec![serde_json::json!({
        "title": "Malformed nonmatching article",
        "source": "Other"
    })]));

    assert_internal_server_error(get(&app, "/debug/cache/articles?source=Reuters").await).await;
}

fn schema_allows_null(schema: &serde_json::Value) -> bool {
    schema["nullable"] == serde_json::json!(true)
        || schema["type"].as_array().is_some_and(|types| {
            types
                .iter()
                .any(|type_name| type_name.as_str() == Some("null"))
        })
        || schema["anyOf"]
            .as_array()
            .is_some_and(|variants| variants.iter().any(|variant| variant["type"] == "null"))
}

#[test]
fn openapi_registers_debug_cache_operation_and_exact_schemas() {
    use utoipa::OpenApi;

    let document: serde_json::Value =
        serde_json::from_str(&crate::ApiDoc::openapi().to_json().expect("OpenAPI JSON"))
            .expect("valid OpenAPI");
    let operation = &document["paths"]["/debug/cache/articles"]["get"];
    assert_eq!(
        operation["operationId"],
        "list_cached_articles_debug_cache_articles_get"
    );
    assert_eq!(operation["summary"], "List Cached Articles");
    assert_eq!(operation["description"], "List Cached Articles.");
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CacheDebugResponse"
    );
    assert_eq!(
        operation["responses"]["422"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/HTTPValidationError"
    );

    let parameters = operation["parameters"]
        .as_array()
        .expect("query parameters");
    assert_eq!(parameters.len(), 3);
    let limit = parameters
        .iter()
        .find(|parameter| parameter["name"] == "limit")
        .expect("limit parameter");
    assert_eq!(limit["required"], false);
    assert_eq!(limit["schema"]["minimum"], 1);
    assert_eq!(limit["schema"]["maximum"], 500);
    assert_eq!(limit["schema"]["default"], 50);
    let offset = parameters
        .iter()
        .find(|parameter| parameter["name"] == "offset")
        .expect("offset parameter");
    assert_eq!(offset["required"], false);
    assert_eq!(offset["schema"]["minimum"], 0);
    assert_eq!(offset["schema"]["default"], 0);
    let source = parameters
        .iter()
        .find(|parameter| parameter["name"] == "source")
        .expect("source parameter");
    assert_eq!(source["required"], false);
    assert!(
        schema_allows_null(&source["schema"]),
        "source parameter schema: {}",
        source["schema"]
    );

    let article_schema = &document["components"]["schemas"]["CacheDebugArticle"];
    let article_properties = article_schema["properties"]
        .as_object()
        .expect("article properties");
    assert_eq!(article_properties.len(), 9);
    let required_article_fields: std::collections::BTreeSet<_> = article_schema["required"]
        .as_array()
        .expect("required article fields")
        .iter()
        .map(|field| field.as_str().expect("field name"))
        .collect();
    assert_eq!(
        required_article_fields,
        [
            "category",
            "description",
            "link",
            "published",
            "source",
            "title",
        ]
        .into_iter()
        .collect()
    );
    assert_eq!(article_properties["category"]["type"], "string");
    assert_eq!(article_properties["description"]["type"], "string");
    assert_eq!(article_properties["link"]["type"], "string");
    assert_eq!(article_properties["published"]["type"], "string");
    assert_eq!(article_properties["source"]["type"], "string");
    assert_eq!(article_properties["title"]["type"], "string");
    assert!(schema_allows_null(&article_properties["country"]));
    assert!(schema_allows_null(&article_properties["id"]));
    assert!(schema_allows_null(&article_properties["image"]));

    let response_schema = &document["components"]["schemas"]["CacheDebugResponse"];
    let required_response_fields: std::collections::BTreeSet<_> = response_schema["required"]
        .as_array()
        .expect("required response fields")
        .iter()
        .map(|field| field.as_str().expect("field name"))
        .collect();
    assert_eq!(
        required_response_fields,
        ["articles", "limit", "offset", "returned", "total"]
            .into_iter()
            .collect()
    );
    assert!(schema_allows_null(&response_schema["properties"]["source"]));
}
