use std::sync::{Arc, Mutex};

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use tower::ServiceExt;
use utoipa::OpenApi;

use crate::queue_digest::{
    QueueDigestError, QueueDigestFuture, QueueDigestProvider, QueueDigestState,
};
use crate::{router_with_sidecars, ApiDoc, RouterSidecars};
use thesis_db::Database;

#[derive(Clone)]
struct CapturedPrompt {
    system: String,
    user: String,
}

struct FixedProvider {
    captured: Arc<Mutex<Option<CapturedPrompt>>>,
    result: Result<String, QueueDigestError>,
}

impl QueueDigestProvider for FixedProvider {
    fn generate(&self, system_prompt: String, user_prompt: String) -> QueueDigestFuture<String> {
        let captured = self.captured.clone();
        let result = self.result.clone();
        Box::pin(async move {
            *captured.lock().expect("prompt capture lock") = Some(CapturedPrompt {
                system: system_prompt,
                user: user_prompt,
            });
            result
        })
    }
}

fn route(state: QueueDigestState) -> Router {
    let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
        .expect("valid lazy PostgreSQL URL");
    router_with_sidecars(database, RouterSidecars::default().with_queue_digest(state))
}

async fn post_digest(router: Router, body: Value) -> (StatusCode, Value) {
    let body = body.to_string();
    post_digest_raw(router, &body).await
}

async fn post_digest_raw(router: Router, body: &str) -> (StatusCode, Value) {
    let response = router
        .oneshot(
            Request::post("/api/queue/digest")
                .header("content-type", "application/json")
                .body(Body::from(body.to_owned()))
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload = serde_json::from_slice(&bytes).expect("JSON response");
    (status, payload)
}

#[tokio::test]
async fn required_article_validation_precedes_grouped_type_error() {
    let (status, body) = post_digest(
        route(QueueDigestState::unavailable()),
        json!({"grouped": []}),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["detail"][0]["loc"], json!(["body", "articles"]));
    assert_eq!(body["detail"][0]["type"], "missing");
    assert_eq!(body["detail"][0]["msg"], "Field required");
}

#[tokio::test]
async fn malformed_json_returns_json_decode_validation() {
    let (status, body) = post_digest_raw(route(QueueDigestState::unavailable()), "{").await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["detail"][0]["loc"], json!(["body"]));
    assert_eq!(body["detail"][0]["type"], "json_invalid");
    assert!(!body["detail"][0]["ctx"]["error"]
        .as_str()
        .unwrap_or_default()
        .is_empty());
}

#[tokio::test]
async fn missing_digest_provider_returns_generic_fastapi_failure() {
    let request = json!({"articles": [], "grouped": {}});
    let (status, body) = post_digest(route(QueueDigestState::unavailable()), request).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"detail": "Failed to generate digest"}));
}

#[tokio::test]
async fn provider_failure_does_not_expose_upstream_details() {
    let provider = FixedProvider {
        captured: Arc::new(Mutex::new(None)),
        result: Err(QueueDigestError),
    };
    let request = json!({"articles": [], "grouped": {}});
    let (status, body) =
        post_digest(route(QueueDigestState::with_provider(provider)), request).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"detail": "Failed to generate digest"}));
}

#[tokio::test]
async fn injected_provider_receives_ordered_prompts_and_response_has_normalized_fence() {
    let captured = Arc::new(Mutex::new(None));
    let provider = FixedProvider {
        captured: captured.clone(),
        result: Ok("  Captured digest\n\n  ".to_owned()),
    };
    let request = json!({
        "articles": [
            {
                "headline": "Story A",
                "link": "https://news.example/a",
                "description": "Alias summary",
                "publisher": "Alias source",
                "image_url": "/a.png",
                "published_at": "2026-10-03",
                "retrieval_method": "semantic",
                "chroma_id": "chroma-a",
                "semantic_score": 0.92,
                "author": {"name": "Reporter", "profile": {"active": true}}
            },
            {
                "title": "Untitled",
                "headline": "Story A",
                "link": "https://news.example/a"
            },
            {
                "title": "Story B",
                "url": "https://news.example/b"
            },
            {}
        ],
        "grouped": {
            "Alpha": [
                {
                    "title": null,
                    "source": null,
                    "url": null,
                    "link": "https://links.example/item",
                    "summary": "",
                    "description": "Fallback body"
                }
            ],
            "Beta": [{"title": "Story B", "source": "Outlet"}],
            "Empty": []
        }
    });
    let (status, body) =
        post_digest(route(QueueDigestState::with_provider(provider)), request).await;

    assert_eq!(status, StatusCode::OK);
    let digest = body["digest"].as_str().expect("digest string");
    assert!(digest.starts_with("Captured digest\n\n```json:articles\n"));
    assert!(digest.ends_with("\n```"));
    let block = digest
        .strip_prefix("Captured digest\n\n```json:articles\n")
        .and_then(|value| value.strip_suffix("\n```"))
        .expect("structured article fence");
    let structured: Value = serde_json::from_str(block).expect("structured JSON");
    assert_eq!(structured["total"], 4);
    assert_eq!(structured["clusters"], json!([]));
    assert_eq!(structured["articles"][0]["title"], "Story A");
    assert_eq!(structured["articles"][1]["title"], "Untitled");
    assert_eq!(structured["articles"][0]["summary"], "Alias summary");
    assert_eq!(structured["articles"][0]["url"], "https://news.example/a");
    assert_eq!(structured["articles"][0]["image"], "/a.png");
    assert_eq!(structured["articles"][0]["source"], "Alias source");
    assert_eq!(structured["articles"][0]["published"], "2026-10-03");
    assert_eq!(structured["articles"][0]["category"], "general");
    assert_eq!(
        structured["articles"][0]["author"],
        json!({"name": "Reporter", "profile": {"active": true}})
    );
    assert_eq!(
        structured["articles"][0]["meta"]["retrieval_method"],
        "semantic"
    );
    assert_eq!(structured["articles"][0]["meta"]["chroma_id"], "chroma-a");
    assert_eq!(structured["articles"][0]["meta"]["semantic_score"], 0.92);
    assert_eq!(structured["articles"][3]["title"], "Untitled");
    assert_eq!(structured["articles"][3]["summary"], "");
    assert_eq!(structured["articles"][3]["url"], "");
    assert_eq!(structured["articles"][3]["image"], "/placeholder.svg");
    assert_eq!(structured["articles"][3]["source"], "Unknown");
    assert_eq!(structured["articles"][3]["published"], Value::Null);
    assert_eq!(structured["articles"][3]["author"], Value::Null);
    assert_eq!(
        structured["articles"][3]["meta"],
        json!({"retrieval_method": null, "chroma_id": null, "semantic_score": null})
    );

    let prompt = captured.lock().expect("prompt capture lock");
    let prompt = prompt.as_ref().expect("provider received prompts");
    assert!(prompt
        .system
        .contains("You are Scoop's news digest writer."));
    assert!(prompt.system.contains("Write in markdown."));
    assert!(prompt
        .user
        .contains("Synthesize the following 4 articles across 3 topics"));
    assert!(prompt.user.contains(
        "Title: None\nSource: None\nURL: https://links.example/item\nSummary: Fallback body"
    ));
    assert!(
        prompt.user.find("## Alpha").expect("Alpha section")
            < prompt.user.find("## Beta").expect("Beta section")
    );
    assert_eq!(
        prompt
            .user
            .matches("- [Untitled](https://news.example/a)")
            .count(),
        1
    );
    assert!(!prompt.user.contains("- [Story A](https://news.example/a)"));
}

#[tokio::test]
async fn grouped_categories_follow_json_object_insertion_order() {
    let captured = Arc::new(Mutex::new(None));
    let provider = FixedProvider {
        captured: captured.clone(),
        result: Ok("digest".to_owned()),
    };
    let request = r#"{"articles":[],"grouped":{"Zulu":[{"title":"Zulu story"}],"Alpha":[{"title":"Alpha story"}]}}"#;
    let (status, _) =
        post_digest_raw(route(QueueDigestState::with_provider(provider)), request).await;

    assert_eq!(status, StatusCode::OK);
    let captured = captured.lock().expect("prompt capture lock");
    let prompt = captured.as_ref().expect("provider received prompts");
    assert!(
        prompt.user.find("## Zulu").expect("Zulu section")
            < prompt.user.find("## Alpha").expect("Alpha section")
    );
}

#[tokio::test]
async fn typed_request_still_rejects_non_object_articles() {
    let request = json!({"articles": [1], "grouped": {}});
    let (status, body) = post_digest(route(QueueDigestState::unavailable()), request).await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["detail"][0]["loc"], json!(["body", "articles", 0]));
    assert_eq!(body["detail"][0]["type"], "dict_type");
}

#[tokio::test]
async fn fallback_validation_preserves_grouped_insertion_order() {
    let request = r#"{"articles":[],"grouped":{"Zulu":"invalid","Alpha":"invalid"}}"#;
    let (status, body) = post_digest_raw(route(QueueDigestState::unavailable()), request).await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["detail"][0]["loc"], json!(["body", "grouped", "Zulu"]));
    assert_eq!(body["detail"][0]["type"], "list_type");
}

#[test]
fn openapi_registers_digest_operation_and_schemas() {
    let document: Value = serde_json::from_str(&ApiDoc::openapi().to_json().expect("OpenAPI JSON"))
        .expect("valid OpenAPI");
    let operation = &document["paths"]["/api/queue/digest"]["post"];

    assert_eq!(
        operation["operationId"],
        "generate_ai_digest_api_queue_digest_post"
    );
    assert_eq!(operation["summary"], "Generate Ai Digest");
    assert_eq!(
        operation["description"],
        "Generate an AI-powered reading digest from queued articles."
    );
    assert_eq!(
        operation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/QueueDigestRequest"
    );
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/QueueDigestResponse"
    );
    assert_eq!(
        operation["responses"]["422"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/HTTPValidationError"
    );
    let request_schema = &document["components"]["schemas"]["QueueDigestRequest"];
    assert_eq!(request_schema["required"], json!(["articles", "grouped"]));
    assert_eq!(
        request_schema["description"],
        "Request for generating AI digest."
    );
    assert_eq!(
        request_schema["properties"]["articles"]["items"]["type"],
        "object"
    );
    assert_eq!(
        request_schema["properties"]["articles"]["items"]["additionalProperties"],
        true
    );
    assert_eq!(
        request_schema["properties"]["grouped"]["additionalProperties"]["type"],
        "array"
    );
    let response_schema = &document["components"]["schemas"]["QueueDigestResponse"];
    assert_eq!(response_schema["required"], json!(["digest"]));
    assert_eq!(response_schema["properties"]["digest"]["type"], "string");
    assert_eq!(
        response_schema["description"],
        "Response containing generated digest."
    );
}
