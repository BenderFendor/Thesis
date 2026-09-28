use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use tower::ServiceExt;

use super::similarity::{
    ArticleEmbedding, ArticleTopic, RelatedHit, RelatedSnapshot, SearchSuggestion,
    SimilarityArticle, SourceCoveragePayload,
};
use super::trending::{
    AllCluster, ClusterArticle, ClusterDetail, ClusterSnapshot, LineageStory, StoryLineage,
    TrendingCluster, TrendingStats,
};
use super::{
    router, ClusterSnapshotCache, DiscoveryError, DiscoveryFuture, DiscoveryProvider,
    DiscoveryState,
};

#[derive(Clone, Copy)]
enum FixtureMode {
    Populated,
    Unavailable,
    Failed,
    Malformed,
}

struct FixtureProvider(FixtureMode);

struct FixtureSnapshots {
    snapshot: Option<ClusterSnapshot>,
    fail: bool,
}

fn future<T: Send + 'static>(mode: FixtureMode, value: T) -> DiscoveryFuture<T> {
    let result = match mode {
        FixtureMode::Unavailable => Err(DiscoveryError::VectorStoreUnavailable),
        FixtureMode::Failed => Err(DiscoveryError::Backend("fixture failure".to_owned())),
        FixtureMode::Populated | FixtureMode::Malformed => Ok(value),
    };
    Box::pin(async move { result })
}

fn article(id: i64, title: &str, source: &str) -> ClusterArticle {
    ClusterArticle {
        id,
        title: title.to_owned(),
        source: source.to_owned(),
        source_id: Some(source.to_lowercase()),
        url: format!("https://{}/story/{id}", source.to_lowercase()),
        image_url: None,
        published_at: Some("2026-09-25T10:00:00+00:00".to_owned()),
        summary: Some("A source-reported update.".to_owned()),
        similarity: Some(0.91),
        author: None,
        authors: Vec::new(),
        gdelt_context: None,
    }
}

fn trending_cluster(cluster_id: i64) -> TrendingCluster {
    TrendingCluster {
        cluster_id,
        label: Some("Climate policy".to_owned()),
        keywords: vec!["climate".to_owned(), "policy".to_owned()],
        article_count: 3,
        window_count: 2,
        source_diversity: 3,
        trending_score: 12.5,
        velocity: 2.0,
        representative_article: Some(article(11, "Climate policy update", "North News")),
        articles: vec![
            article(11, "Climate policy update", "North News"),
            article(12, "Policy agreement reported", "South News"),
        ],
        gdelt_context: None,
    }
}

fn breaking_cluster() -> super::trending::BreakingCluster {
    super::trending::BreakingCluster {
        cluster_id: 42,
        label: Some("Climate policy".to_owned()),
        keywords: vec!["climate".to_owned()],
        article_count_3h: 4,
        source_count_3h: 3,
        spike_magnitude: 2.5,
        is_new_story: true,
        representative_article: Some(article(11, "Climate policy update", "North News")),
        articles: vec![article(11, "Climate policy update", "North News")],
        gdelt_context: None,
    }
}

fn all_cluster(cluster_id: i64) -> AllCluster {
    AllCluster {
        cluster_id,
        label: Some("Climate policy".to_owned()),
        keywords: vec!["climate".to_owned(), "policy".to_owned()],
        article_count: 3,
        window_count: 3,
        source_diversity: 3,
        representative_article: Some(article(11, "Climate policy update", "North News")),
        articles: vec![article(11, "Climate policy update", "North News")],
        gdelt_context: None,
    }
}

fn cluster_detail(cluster_id: i64) -> ClusterDetail {
    ClusterDetail {
        id: cluster_id,
        label: Some("Climate policy".to_owned()),
        keywords: vec!["climate".to_owned(), "policy".to_owned()],
        article_count: 3,
        first_seen: Some("2026-09-24T10:00:00+00:00".to_owned()),
        last_seen: Some("2026-09-25T10:00:00+00:00".to_owned()),
        is_active: true,
        articles: vec![
            article(
                11,
                "Officials report 12 climate aid workers were rescued",
                "North News",
            ),
            article(
                12,
                "Officials report 20 climate aid workers were rescued",
                "South News",
            ),
            article(
                13,
                "Officials report 30 climate aid workers were rescued",
                "West News",
            ),
        ],
        gdelt_context: None,
    }
}

fn similarity_article(id: i64) -> SimilarityArticle {
    SimilarityArticle {
        id,
        title: format!("Article {id}"),
        source: format!("Source {id}"),
        source_id: Some(format!("source-{id}")),
        summary: Some(format!("Summary {id}")),
        image: None,
        published_at: Some("2026-09-25T10:00:00+00:00".to_owned()),
        category: Some("World".to_owned()),
        url: format!("https://news.test/{id}"),
    }
}

fn topic() -> ArticleTopic {
    ArticleTopic {
        cluster_id: 42,
        label: Some("Climate policy".to_owned()),
        similarity: Some(0.92),
        keywords: vec!["climate".to_owned(), "policy".to_owned()],
    }
}

fn state(mode: FixtureMode, snapshot: Option<ClusterSnapshot>) -> DiscoveryState {
    DiscoveryState::with_adapters(
        Some(Arc::new(FixtureProvider(mode))),
        Some(Arc::new(FixtureSnapshots {
            snapshot,
            fail: matches!(mode, FixtureMode::Failed),
        })),
    )
}

fn app(mode: FixtureMode, snapshot: Option<ClusterSnapshot>) -> Router {
    router(state(mode, snapshot))
}

async fn request(
    app: Router,
    method: Method,
    uri: &str,
    body: &str,
) -> (StatusCode, HeaderMap, Value) {
    request_with_content_type(app, method, uri, body, Some("application/json")).await
}

async fn request_with_content_type(
    app: Router,
    method: Method,
    uri: &str,
    body: &str,
    content_type: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(content_type) = content_type {
        builder = builder.header("content-type", content_type);
    }
    let response = app
        .oneshot(builder.body(Body::from(body.to_owned())).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    let payload = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, headers, payload)
}

#[tokio::test]
async fn trending_routes_serve_ranked_data_and_the_latest_stale_snapshot() {
    let stale_snapshot = ClusterSnapshot {
        clusters: vec![all_cluster(42)],
        computed_at: Some("2025-01-01T00:00:00+00:00".to_owned()),
    };
    let app = app(FixtureMode::Populated, Some(stale_snapshot));

    let (status, headers, trending) =
        request(app.clone(), Method::GET, "/trending?window=1w&limit=2", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers["cache-control"],
        "public, max-age=60, stale-while-revalidate=120"
    );
    assert_eq!(trending["window"], "1w");
    assert_eq!(trending["total"], 1);
    assert_eq!(trending["clusters"][0]["cluster_id"], 42);
    assert_eq!(trending["clusters"][0]["trending_score"], 12.5);

    let (status, headers, breaking) =
        request(app.clone(), Method::GET, "/trending/breaking?limit=1", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers["cache-control"],
        "public, max-age=30, stale-while-revalidate=60"
    );
    assert_eq!(breaking["window_hours"], 3);
    assert_eq!(breaking["clusters"][0]["spike_magnitude"], 2.5);

    let (status, _, snapshot) =
        request(app.clone(), Method::GET, "/trending/clusters?window=1w", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(snapshot["status"], "ok");
    assert_eq!(snapshot["computed_at"], "2025-01-01T00:00:00+00:00");
    assert_eq!(snapshot["clusters"][0]["cluster_id"], 42);

    let (status, _, detail) = request(app.clone(), Method::GET, "/trending/clusters/42", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["id"], 42);
    assert_eq!(
        detail["articles"]
            .as_array()
            .expect("detail articles")
            .len(),
        3
    );

    let (status, _, panel) = request(
        app.clone(),
        Method::GET,
        "/trending/clusters/42/contradictions",
        "",
    )
    .await;
    assert_eq!(
        panel["claims"][0]["claim"],
        "Sources diverge on details involving officials."
    );
    assert_eq!(status, StatusCode::OK);
    assert_eq!(panel["claims"][0]["status"], "disputed");
    assert_eq!(panel["article_count"], 3);

    let (status, _, lineage) = request(
        app.clone(),
        Method::GET,
        "/trending/clusters/42/lineage",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(lineage["status"], "ok");
    assert_eq!(lineage["story"]["external_cluster_id"], 42);

    let (status, _, stats) = request(app, Method::GET, "/trending/stats", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stats["total_article_assignments"], 17);
    assert_eq!(stats["similarity_threshold"], 0.82);
}

#[tokio::test]
async fn trending_empty_malformed_and_provider_failures_keep_their_http_contracts() {
    let (status, headers, empty) = request(
        app(FixtureMode::Unavailable, None),
        Method::GET,
        "/trending?window=1d",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers["cache-control"],
        "public, max-age=60, stale-while-revalidate=120"
    );
    assert_eq!(empty, json!({"window":"1d","clusters":[],"total":0}));

    let (status, _, initializing) = request(
        app(FixtureMode::Populated, None),
        Method::GET,
        "/trending/clusters",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initializing["status"], "initializing");
    assert_eq!(initializing["clusters"], json!([]));

    let malformed_snapshot = ClusterSnapshot {
        clusters: vec![all_cluster(0)],
        computed_at: Some("2026-09-25T00:00:00+00:00".to_owned()),
    };
    let (status, _, malformed) = request(
        app(FixtureMode::Populated, Some(malformed_snapshot)),
        Method::GET,
        "/trending/clusters",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(malformed, json!("Internal Server Error"));

    let (status, headers, malformed) = request(
        app(FixtureMode::Malformed, None),
        Method::GET,
        "/trending",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        headers["cache-control"],
        "public, max-age=60, stale-while-revalidate=120"
    );
    assert_eq!(malformed, json!("Internal Server Error"));

    let (status, _, failed) =
        request(app(FixtureMode::Failed, None), Method::GET, "/trending", "").await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(failed, json!("Internal Server Error"));

    let (status, _, missing) = request(
        app(FixtureMode::Populated, None),
        Method::GET,
        "/trending/clusters/0",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["detail"], "Cluster not found");
}

#[tokio::test]
async fn unconfigured_discovery_is_not_reported_as_empty_data() {
    let app = router(DiscoveryState::unavailable());
    for (method, uri, body) in [
        (Method::GET, "/trending", ""),
        (Method::GET, "/trending/breaking", ""),
        (Method::GET, "/trending/stats", ""),
        (Method::GET, "/api/similarity/article-topics/7", ""),
        (Method::POST, "/api/similarity/bulk-article-topics", "[7]"),
    ] {
        let (status, _, payload) = request(app.clone(), method, uri, body).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        assert_eq!(payload["detail"], "Vector store not available", "{uri}");
    }

    let (status, _, empty_bulk) = request(
        app.clone(),
        Method::POST,
        "/api/similarity/bulk-article-topics",
        "[]",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(empty_bulk, json!({"articles":{}}));

    let (status, _, unavailable_snapshot) =
        request(app, Method::GET, "/trending/clusters", "").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        unavailable_snapshot["detail"],
        "Cluster snapshot cache is not available"
    );
}

#[tokio::test]
async fn known_chroma_unavailability_keeps_fastapi_empty_fallbacks() {
    let app = app(FixtureMode::Unavailable, None);

    let (status, _, stats) = request(app.clone(), Method::GET, "/trending/stats", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stats["breaking_window_hours"], 3);
    assert_eq!(stats["similarity_threshold"], 0.0);

    let (status, _, topics) = request(
        app.clone(),
        Method::GET,
        "/api/similarity/article-topics/7",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(topics, json!({"article_id":7,"topics":[]}));

    let (status, _, bulk) = request(
        app,
        Method::POST,
        "/api/similarity/bulk-article-topics",
        "[7]",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bulk, json!({"articles":{}}));
}

#[tokio::test]
async fn similarity_routes_preserve_rank_order_compute_novelty_and_fill_bulk_gaps() {
    let app = app(FixtureMode::Populated, None);

    let (status, _, related) = request(
        app.clone(),
        Method::GET,
        "/api/similarity/related/9?limit=3",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(related["total"], 2);
    assert_eq!(
        related["related"]
            .as_array()
            .expect("related rows")
            .iter()
            .map(|row| row["id"].as_i64().expect("id"))
            .collect::<Vec<_>>(),
        vec![2, 1]
    );
    assert_eq!(related["related"][0]["similarity_score"], 0.9);

    let (status, _, suggestions) = request(
        app.clone(),
        Method::GET,
        "/api/similarity/search-suggestions?query=climate&limit=2",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(suggestions["suggestions"][0]["cluster_id"], 51);
    assert_eq!(suggestions["suggestions"][1]["relevance"], 0.71);

    let (status, _, coverage) = request(
        app.clone(),
        Method::GET,
        "/api/similarity/source-coverage?source_ids=north,south&sample_size=20",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(coverage["global_article_count"], 4);
    assert_eq!(coverage["sources"]["north"]["article_count"], 3);

    let (status, _, novelty) = request(
        app.clone(),
        Method::POST,
        "/api/similarity/novelty-score?article_id=101",
        "[201.0,\"202\"]",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(novelty["novelty_score"], 0.293);
    assert_eq!(novelty["max_similarity_to_history"], 0.707);
    assert_eq!(novelty["avg_similarity_to_history"], 0.354);
    assert_eq!(novelty["history_size"], 2);

    let (status, _, empty_history) = request(
        app.clone(),
        Method::POST,
        "/api/similarity/novelty-score?article_id=-1",
        "[]",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        empty_history,
        json!({"article_id":-1,"novelty_score":1.0,"reason":"empty_history"})
    );

    let (status, _, topics) = request(
        app.clone(),
        Method::GET,
        "/api/similarity/article-topics/101",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(topics["topics"][0]["cluster_id"], 42);

    let (status, _, zero_topics) = request(
        app.clone(),
        Method::GET,
        "/api/similarity/article-topics/0",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(zero_topics, json!({"article_id":0,"topics":[]}));

    let (status, _, fractional_id) = request(
        app.clone(),
        Method::POST,
        "/api/similarity/bulk-article-topics",
        "[1.5]",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(fractional_id["detail"][0]["type"], "int_from_float");
    assert_eq!(fractional_id["detail"][0]["loc"], json!(["body", 0]));

    let (status, _, boolean_ids) = request(
        app.clone(),
        Method::POST,
        "/api/similarity/bulk-article-topics",
        "[true,false]",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(boolean_ids["articles"], json!({"0":[],"1":[]}));

    let (status, _, bulk) = request(
        app,
        Method::POST,
        "/api/similarity/bulk-article-topics",
        "[101.0,\"202\",101]",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bulk["articles"]["101"][0]["cluster_id"], 42);
    assert_eq!(bulk["articles"]["202"], json!([]));
}

#[tokio::test]
async fn json_list_routes_match_fastapi_content_type_and_aggregate_errors() {
    let app = app(FixtureMode::Populated, None);
    let expected_raw_body_error = json!({
        "detail": [{
            "type": "list_type",
            "loc": ["body"],
            "msg": "Input should be a valid list",
            "input": "[]"
        }]
    });
    for uri in [
        "/api/similarity/bulk-article-topics",
        "/api/similarity/novelty-score?article_id=101",
    ] {
        for content_type in [None, Some("text/plain")] {
            let (status, _, response) =
                request_with_content_type(app.clone(), Method::POST, uri, "[]", content_type).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
            assert_eq!(response, expected_raw_body_error, "{uri}");
        }

        let (status, _, missing_body) =
            request_with_content_type(app.clone(), Method::POST, uri, "", Some("application/json"))
                .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
        assert_eq!(
            missing_body,
            json!({"detail":[{"type":"missing","loc":["body"],"msg":"Field required","input":null}]})
        );
    }

    let (status, _, multiple_errors) = request_with_content_type(
        app,
        Method::POST,
        "/api/similarity/bulk-article-topics",
        "[1.5,\"bad\",null]",
        Some("application/json"),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        multiple_errors["detail"]
            .as_array()
            .expect("validation errors")
            .iter()
            .map(|error| error["type"].as_str().expect("error type"))
            .collect::<Vec<_>>(),
        vec!["int_from_float", "int_parsing", "int_type"]
    );
    assert_eq!(
        multiple_errors["detail"]
            .as_array()
            .expect("validation errors")
            .iter()
            .map(|error| error["loc"].clone())
            .collect::<Vec<_>>(),
        vec![json!(["body", 0]), json!(["body", 1]), json!(["body", 2])]
    );
}

#[tokio::test]
async fn similarity_unavailable_malformed_and_missing_rows_are_not_fabricated() {
    let (status, _, missing_source) = request(
        app(FixtureMode::Populated, None),
        Method::GET,
        "/api/similarity/related/0",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing_source["detail"], "Article not found");

    let (status, _, unavailable) = request(
        app(FixtureMode::Unavailable, None),
        Method::GET,
        "/api/similarity/related/9",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(unavailable["detail"], "Vector store not available");

    let (status, _, failed) = request(
        app(FixtureMode::Failed, None),
        Method::GET,
        "/api/similarity/search-suggestions?query=climate",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(failed, json!("Internal Server Error"));
}

impl DiscoveryProvider for FixtureProvider {
    fn trending_clusters(
        &self,
        _window: String,
        _limit: i64,
    ) -> DiscoveryFuture<Vec<TrendingCluster>> {
        let cluster_id = if matches!(self.0, FixtureMode::Malformed) {
            0
        } else {
            42
        };
        future(self.0, vec![trending_cluster(cluster_id)])
    }

    fn breaking_clusters(
        &self,
        _limit: i64,
    ) -> DiscoveryFuture<Vec<super::trending::BreakingCluster>> {
        future(self.0, vec![breaking_cluster()])
    }

    fn all_clusters(
        &self,
        _window: String,
        _min_articles: i64,
        _limit: i64,
    ) -> DiscoveryFuture<Vec<AllCluster>> {
        future(self.0, vec![all_cluster(42)])
    }

    fn cluster_detail(&self, cluster_id: i64) -> DiscoveryFuture<Option<ClusterDetail>> {
        future(
            self.0,
            (cluster_id == 42).then(|| cluster_detail(cluster_id)),
        )
    }

    fn story_lineage(&self, _detail: ClusterDetail) -> DiscoveryFuture<StoryLineage> {
        future(
            self.0,
            StoryLineage {
                status: "ok".to_owned(),
                reason: None,
                story: Some(LineageStory {
                    id: 77,
                    external_cluster_id: 42,
                    label: Some("Climate policy".to_owned()),
                    keywords: vec!["climate".to_owned()],
                    first_seen_at: Some("2026-09-24T10:00:00+00:00".to_owned()),
                    last_seen_at: Some("2026-09-25T10:00:00+00:00".to_owned()),
                    earliest_article_id: Some(11),
                    current_summary: Some("Climate policy".to_owned()),
                    confidence: Some(0.5),
                }),
                article_edges: Vec::new(),
                claims: Vec::new(),
                claim_edges: Vec::new(),
                corrections: Vec::new(),
            },
        )
    }

    fn trending_stats(&self) -> DiscoveryFuture<TrendingStats> {
        future(
            self.0,
            TrendingStats {
                active_clusters: 0,
                baseline_days: 0,
                breaking_window_hours: 3,
                recent_spikes: 0,
                similarity_threshold: 0.82,
                total_article_assignments: 17,
            },
        )
    }

    fn related_articles(
        &self,
        article_id: i64,
        _limit: i64,
        _exclude_same_source: bool,
    ) -> DiscoveryFuture<Option<RelatedSnapshot>> {
        let snapshot = (article_id == 9).then(|| RelatedSnapshot {
            source_article_id: 9,
            hits: vec![
                RelatedHit {
                    article_id: 2,
                    similarity_score: 0.9,
                },
                RelatedHit {
                    article_id: 3,
                    similarity_score: 0.8,
                },
                RelatedHit {
                    article_id: 1,
                    similarity_score: 0.7,
                },
            ],
            articles: BTreeMap::from([(1, similarity_article(1)), (2, similarity_article(2))]),
        });
        future(self.0, snapshot)
    }

    fn search_suggestions(
        &self,
        _query: String,
        _limit: i64,
    ) -> DiscoveryFuture<Vec<SearchSuggestion>> {
        future(
            self.0,
            vec![
                SearchSuggestion {
                    cluster_id: 51,
                    label: "Climate negotiations".to_owned(),
                    relevance: 0.91,
                },
                SearchSuggestion {
                    cluster_id: 52,
                    label: "Climate funding".to_owned(),
                    relevance: 0.71,
                },
            ],
        )
    }

    fn source_coverage(
        &self,
        _source_ids: Vec<String>,
        _sample_size: i64,
    ) -> DiscoveryFuture<SourceCoveragePayload> {
        future(
            self.0,
            BTreeMap::from([
                (
                    "sources".to_owned(),
                    json!({"north":{"article_count":3,"spread":0.2},"south":{"article_count":1}}),
                ),
                ("global_article_count".to_owned(), json!(4)),
            ]),
        )
    }

    fn embeddings(&self, article_ids: Vec<i64>) -> DiscoveryFuture<Vec<ArticleEmbedding>> {
        let mut rows = vec![
            ArticleEmbedding {
                article_id: 202,
                values: vec![1.0, 1.0],
            },
            ArticleEmbedding {
                article_id: 201,
                values: vec![0.0, 1.0],
            },
            ArticleEmbedding {
                article_id: 101,
                values: vec![1.0, 0.0],
            },
        ];
        rows.retain(|row| article_ids.contains(&row.article_id));
        future(self.0, rows)
    }

    fn article_topics(&self, article_id: i64) -> DiscoveryFuture<Vec<ArticleTopic>> {
        future(
            self.0,
            if article_id > 0 {
                vec![topic()]
            } else {
                Vec::new()
            },
        )
    }

    fn bulk_article_topics(
        &self,
        article_ids: Vec<i64>,
    ) -> DiscoveryFuture<BTreeMap<i64, Vec<ArticleTopic>>> {
        let articles = article_ids
            .into_iter()
            .map(|article_id| {
                let topics = if article_id == 101 {
                    vec![topic()]
                } else {
                    Vec::new()
                };
                (article_id, topics)
            })
            .collect();
        future(self.0, articles)
    }
}

impl ClusterSnapshotCache for FixtureSnapshots {
    fn latest_snapshot(&self, _window: String) -> DiscoveryFuture<Option<ClusterSnapshot>> {
        if self.fail {
            return Box::pin(async {
                Err(DiscoveryError::Backend(
                    "snapshot fixture failure".to_owned(),
                ))
            });
        }
        let snapshot = self.snapshot.clone();
        Box::pin(async move { Ok(snapshot) })
    }

    fn save_snapshot(&self, _window: String, _clusters: Vec<AllCluster>) -> DiscoveryFuture<()> {
        Box::pin(async { Ok(()) })
    }
}
