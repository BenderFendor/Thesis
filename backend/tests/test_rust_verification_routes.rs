use super::super::{
    router, ConfidenceLevel, VerificationConfig, VerificationFuture, VerificationProvider,
    VerificationState,
};
use super::{
    config, fixture_result, FailingCache, LocalExpiredCache, LocalWorkspaceScheduler,
    PendingProvider,
};
use axum::body::{Body, Bytes};
use axum::http::header::CONTENT_TYPE;
use axum::http::{Method, Request, StatusCode};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;
use tower::ServiceExt;

fn post_request(uri: &'static str) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(Bytes::from_static(
            br#"{"query":"court decision"}"#,
        )))
        .expect("verification request")
}

fn delete_request(uri: &'static str) -> Request<Body> {
    Request::builder()
        .method(Method::DELETE)
        .uri(uri)
        .body(Body::empty())
        .expect("cache cleanup request")
}

fn sse_event(frame: &Bytes) -> Value {
    let frame = std::str::from_utf8(frame).expect("SSE frame is UTF-8");
    let payload = frame
        .strip_prefix("data: ")
        .expect("SSE frame starts with data")
        .strip_suffix("\n\n")
        .expect("SSE frame ends with a blank line");
    serde_json::from_str(payload).expect("SSE event JSON")
}

struct TwoClaimProvider;

impl VerificationProvider for TwoClaimProvider {
    fn verify(
        &self,
        request: super::super::VerificationRequest,
        _config: VerificationConfig,
    ) -> VerificationFuture<super::super::VerificationResult> {
        let mut result = fixture_result(request.query, "https://reuters.com/story");
        let mut second_claim = result.verified_claims[0].clone();
        second_claim.id = "fixture-claim-2".to_owned();
        second_claim.claim_text = "A second court-related claim.".to_owned();
        second_claim.confidence = 0.6;
        second_claim.confidence_level = ConfidenceLevel::Medium;
        result.verified_claims.push(second_claim);
        Box::pin(async move { Ok(result) })
    }
}

struct EmptyProvider;

impl VerificationProvider for EmptyProvider {
    fn verify(
        &self,
        request: super::super::VerificationRequest,
        _config: VerificationConfig,
    ) -> VerificationFuture<super::super::VerificationResult> {
        let mut result = fixture_result(request.query, "https://reuters.com/story");
        result.overall_confidence = 0.0;
        result.overall_confidence_level = ConfidenceLevel::VeryLow;
        result.verified_claims.clear();
        result.sources.clear();
        Box::pin(async move { Ok(result) })
    }
}

#[tokio::test]
async fn production_router_serves_result_json_and_expired_cache_operations() {
    let expired_rows = Arc::new(Mutex::new(vec![true, false, true]));
    let scheduled_age = Arc::new(AtomicI64::new(0));
    let app = router(VerificationState::with_adapters(
        config(true),
        Some(Arc::new(TwoClaimProvider)),
        Some(Arc::new(LocalExpiredCache {
            expired_rows: expired_rows.clone(),
        })),
        Some(Arc::new(LocalWorkspaceScheduler(scheduled_age.clone()))),
    ));

    let response = app
        .clone()
        .oneshot(post_request("/api/verification/verify"))
        .await
        .expect("verify route response");
    let (status, result) = super::response_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["query"], "court decision");
    assert_eq!(
        result["verified_claims"]
            .as_array()
            .expect("verified claim list")
            .len(),
        2
    );
    assert_eq!(result["verified_claims"][1]["id"], "fixture-claim-2");

    let response = app
        .clone()
        .oneshot(post_request("/api/verification/verify/json"))
        .await
        .expect("JSON route response");
    let (status, formatted) = super::response_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(formatted["summary"]["total_claims"], 2);
    assert_eq!(formatted["summary"]["high_confidence"], 1);
    assert_eq!(formatted["summary"]["medium_confidence"], 1);
    assert_eq!(
        formatted["claims"][1]["text"],
        "A second court-related claim."
    );

    let response = app
        .oneshot(delete_request("/api/verification/cache"))
        .await
        .expect("cache route response");
    let (status, cleanup) = super::response_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        cleanup,
        json!({"deleted_cache_entries": 2, "workspace_cleanup": "scheduled"})
    );
    assert_eq!(
        *expired_rows.lock().expect("remaining cache rows"),
        vec![false]
    );
    assert_eq!(scheduled_age.load(Ordering::SeqCst), 24);
    let failed_cleanup_age = Arc::new(AtomicI64::new(0));
    let failing_cache_app = router(VerificationState::with_adapters(
        config(true),
        None,
        Some(Arc::new(FailingCache)),
        Some(Arc::new(LocalWorkspaceScheduler(
            failed_cleanup_age.clone(),
        ))),
    ));
    let response = failing_cache_app
        .oneshot(delete_request("/api/verification/cache"))
        .await
        .expect("cache error response");
    let (status, failed_cleanup) = super::response_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        failed_cleanup,
        json!({"deleted_cache_entries": 0, "workspace_cleanup": "scheduled"})
    );
    assert_eq!(failed_cleanup_age.load(Ordering::SeqCst), 24);
}

#[tokio::test]
async fn cache_cleanup_without_workspace_adapter_fails_before_deleting_rows() {
    let rows = Arc::new(Mutex::new(vec![true, false]));
    let app = router(VerificationState::with_adapters(
        config(true),
        None,
        Some(Arc::new(LocalExpiredCache {
            expired_rows: rows.clone(),
        })),
        None,
    ));
    let response = app
        .oneshot(delete_request("/api/verification/cache"))
        .await
        .expect("cache cleanup response");
    let (status, body) = super::response_json(response).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body,
        json!({"detail": "Verification workspace cleanup is not available"})
    );
    assert_eq!(
        *rows.lock().expect("cache rows remain unchanged"),
        vec![true, false]
    );
}

#[tokio::test]
async fn production_router_preserves_validation_and_missing_adapter_errors() {
    let disabled = router(VerificationState::unavailable(config(false)));
    let invalid = Request::builder()
        .method(Method::POST)
        .uri("/api/verification/verify")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(Bytes::from_static(br#"{"query":7}"#)))
        .expect("invalid verification request");
    let response = disabled
        .clone()
        .oneshot(invalid)
        .await
        .expect("validation response");
    let (status, validation) = super::response_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(validation["detail"][0]["loc"], json!(["body", "query"]));
    assert_eq!(validation["detail"][0]["type"], "string_type");

    for path in [
        "/api/verification/verify",
        "/api/verification/verify/json",
        "/api/verification/verify/stream",
    ] {
        let response = disabled
            .clone()
            .oneshot(post_request(path))
            .await
            .expect("disabled verification response");
        let (status, disabled_body) = super::response_json(response).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{path}");
        assert_eq!(
            disabled_body,
            json!({"detail": "Verification is disabled"}),
            "{path}"
        );
    }

    let unavailable = router(VerificationState::unavailable(config(true)));
    let response = unavailable
        .clone()
        .oneshot(post_request("/api/verification/verify"))
        .await
        .expect("unavailable verify response");
    let (status, verify_error) = super::response_json(response).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        verify_error,
        json!({"detail": "Verification failed: Verification provider is not available"})
    );

    let response = unavailable
        .clone()
        .oneshot(post_request("/api/verification/verify/json"))
        .await
        .expect("unavailable JSON response");
    let (status, json_error) = super::response_text(response).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_error, "Internal Server Error");

    let response = unavailable
        .clone()
        .oneshot(post_request("/api/verification/verify/stream"))
        .await
        .expect("unavailable stream response");
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body().into_data_stream();
    let started = sse_event(&body.next().await.expect("started frame").expect("SSE body"));
    let error = sse_event(&body.next().await.expect("error frame").expect("SSE body"));
    assert_eq!(started["type"], "started");
    assert_eq!(error["type"], "error");
    assert_eq!(error["content"], "Verification provider is not available");
    assert!(body.next().await.is_none());

    let response = unavailable
        .oneshot(delete_request("/api/verification/cache"))
        .await
        .expect("unavailable cache response");
    let (status, cache_error) = super::response_json(response).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        cache_error,
        json!({"detail": "Verification cache provider is not available"})
    );
}
#[tokio::test]
async fn verify_timeout_is_504_through_the_production_router() {
    let mut runtime_config = config(true);
    runtime_config.max_duration_seconds = -5;
    let app = router(VerificationState::with_adapters(
        runtime_config,
        Some(Arc::new(PendingProvider)),
        None,
        None,
    ));
    let response = app
        .oneshot(post_request("/api/verification/verify"))
        .await
        .expect("timed-out verify response");
    let (status, body) = super::response_json(response).await;
    assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(body, json!({"detail": "Verification timed out"}));
}

#[tokio::test]
async fn stream_route_emits_each_event_as_a_separate_body_frame() {
    let app = router(VerificationState::with_adapters(
        config(true),
        Some(Arc::new(TwoClaimProvider)),
        None,
        None,
    ));
    let response = app
        .oneshot(post_request("/api/verification/verify/stream"))
        .await
        .expect("stream route response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[CONTENT_TYPE], "text/event-stream");
    assert_eq!(response.headers()["cache-control"], "no-cache");
    assert_eq!(response.headers()["connection"], "keep-alive");
    assert_eq!(response.headers()["x-accel-buffering"], "no");

    let mut body = response.into_body().into_data_stream();
    let started = sse_event(&body.next().await.expect("started frame").expect("SSE body"));
    let first_claim = sse_event(
        &body
            .next()
            .await
            .expect("first claim frame")
            .expect("SSE body"),
    );
    let second_claim = sse_event(
        &body
            .next()
            .await
            .expect("second claim frame")
            .expect("SSE body"),
    );
    let complete = sse_event(
        &body
            .next()
            .await
            .expect("complete frame")
            .expect("SSE body"),
    );
    assert_eq!(
        started,
        json!({"type": "started", "query": "court decision"})
    );
    assert_eq!(first_claim["type"], "claim");
    assert_eq!(first_claim["claim"]["id"], "fixture-claim-1");
    assert_eq!(first_claim["progress"], 0.5);
    assert_eq!(second_claim["type"], "claim");
    assert_eq!(second_claim["claim"]["id"], "fixture-claim-2");
    assert_eq!(second_claim["progress"], 1.0);
    assert_eq!(complete["type"], "complete");
    assert_eq!(complete["result"]["query"], "court decision");
    assert!(body.next().await.is_none());
}

#[tokio::test]
async fn empty_result_stream_starts_then_completes_without_claim_frames() {
    let app = router(VerificationState::with_adapters(
        config(true),
        Some(Arc::new(EmptyProvider)),
        None,
        None,
    ));
    let response = app
        .oneshot(post_request("/api/verification/verify/stream"))
        .await
        .expect("empty stream response");
    let mut body = response.into_body().into_data_stream();
    let started = sse_event(&body.next().await.expect("started frame").expect("SSE body"));
    let complete = sse_event(
        &body
            .next()
            .await
            .expect("complete frame")
            .expect("SSE body"),
    );
    assert_eq!(started["type"], "started");
    assert_eq!(complete["type"], "complete");
    assert_eq!(complete["result"]["verified_claims"], json!([]));
    assert!(body.next().await.is_none());
}

struct BlockingProvider {
    started: Mutex<Option<oneshot::Sender<()>>>,
    release: Mutex<Option<oneshot::Receiver<()>>>,
    dropped: Mutex<Option<oneshot::Sender<()>>>,
}

impl VerificationProvider for BlockingProvider {
    fn verify(
        &self,
        request: super::super::VerificationRequest,
        _config: VerificationConfig,
    ) -> VerificationFuture<super::super::VerificationResult> {
        let started = self
            .started
            .lock()
            .expect("provider start sender")
            .take()
            .expect("provider is called once");
        let release = self
            .release
            .lock()
            .expect("provider release receiver")
            .take()
            .expect("provider is called once");
        let dropped = self
            .dropped
            .lock()
            .expect("provider drop sender")
            .take()
            .expect("provider is called once");
        Box::pin(async move {
            let _drop_signal = DropSignal(Some(dropped));
            let _ = started.send(());
            release
                .await
                .map_err(|_| "verification client disconnected".to_owned())?;
            Ok(fixture_result(request.query, "https://reuters.com/story"))
        })
    }
}

struct DropSignal(Option<oneshot::Sender<()>>);

impl Drop for DropSignal {
    fn drop(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.send(());
        }
    }
}

#[tokio::test]
async fn disconnect_drops_the_pending_provider_without_prefetching() {
    let (started_sender, mut started_receiver) = oneshot::channel();
    let (_release_sender, release_receiver) = oneshot::channel();
    let (dropped_sender, dropped_receiver) = oneshot::channel();
    let provider = Arc::new(BlockingProvider {
        started: Mutex::new(Some(started_sender)),
        release: Mutex::new(Some(release_receiver)),
        dropped: Mutex::new(Some(dropped_sender)),
    });
    let app = router(VerificationState::with_adapters(
        config(true),
        Some(provider),
        None,
        None,
    ));
    let response = app
        .oneshot(post_request("/api/verification/verify/stream"))
        .await
        .expect("stream route response");
    let mut body = response.into_body().into_data_stream();

    let started = sse_event(&body.next().await.expect("started frame").expect("SSE body"));
    assert_eq!(started["type"], "started");
    assert!(started_receiver.try_recv().is_err());

    let pending_next = tokio::time::timeout(Duration::from_millis(25), body.next()).await;
    assert!(
        pending_next.is_err(),
        "no next frame exists before provider completion"
    );
    tokio::time::timeout(Duration::from_secs(1), &mut started_receiver)
        .await
        .expect("provider starts when the client requests the next frame")
        .expect("provider start signal");

    drop(body);
    tokio::time::timeout(Duration::from_secs(1), dropped_receiver)
        .await
        .expect("dropping the response body cancels the pending provider")
        .expect("provider drop signal");
}
