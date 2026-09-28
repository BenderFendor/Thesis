use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use tokio::sync::RwLock;

/// Process-local dependency blockers for the Rust host readiness endpoint.
#[derive(Clone, Default)]
pub(crate) struct ReadinessState {
    blockers: Arc<RwLock<BTreeMap<String, String>>>,
}

#[derive(Debug, Serialize)]
struct ReadinessReport {
    status: &'static str,
    ready: bool,
    blockers: Vec<ReadinessBlocker>,
}

#[derive(Debug, Serialize)]
struct ReadinessBlocker {
    dependency: String,
    reason: String,
}

impl ReadinessState {
    pub(crate) async fn block(&self, dependency: impl Into<String>, reason: impl Into<String>) {
        self.blockers
            .write()
            .await
            .insert(dependency.into(), reason.into());
    }

    pub(crate) async fn clear(&self, dependency: &str) {
        self.blockers.write().await.remove(dependency);
    }

    async fn report(&self) -> ReadinessReport {
        let blockers = self
            .blockers
            .read()
            .await
            .iter()
            .map(|(dependency, reason)| ReadinessBlocker {
                dependency: dependency.clone(),
                reason: reason.clone(),
            })
            .collect::<Vec<_>>();
        let ready = blockers.is_empty();
        ReadinessReport {
            status: if ready { "ready" } else { "not_ready" },
            ready,
            blockers,
        }
    }
}

/// Build liveness/readiness endpoints outside the generated API contract.
pub(crate) fn router(state: ReadinessState) -> Router {
    Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .with_state(state)
}

async fn liveness() -> StatusCode {
    StatusCode::OK
}

async fn readiness(State(state): State<ReadinessState>) -> impl IntoResponse {
    let report = state.report().await;
    let status = if report.ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(report))
}

#[cfg(test)]
mod tests {
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use super::{router, ReadinessState};

    #[tokio::test]
    async fn readiness_reports_each_blocker_and_recovers_when_cleared() {
        let readiness = ReadinessState::default();
        readiness
            .block("database.schema", "schema handoff is not ready")
            .await;
        readiness
            .block("provider.embedding", "embedding service is unavailable")
            .await;
        let app = router(readiness.clone());

        let blocked = app
            .clone()
            .oneshot(
                Request::get("/health/ready")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(blocked.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(blocked.into_body(), 16_384)
            .await
            .expect("readiness body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("readiness JSON");
        assert_eq!(body["status"], "not_ready");
        assert_eq!(body["ready"], false);
        assert_eq!(body["blockers"].as_array().expect("blockers").len(), 2);
        assert_eq!(body["blockers"][0]["dependency"], "database.schema");
        assert_eq!(body["blockers"][1]["dependency"], "provider.embedding");

        readiness.clear("database.schema").await;
        readiness.clear("provider.embedding").await;
        let ready = app
            .oneshot(
                Request::get("/health/ready")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(ready.status(), StatusCode::OK);
        let body = to_bytes(ready.into_body(), 16_384)
            .await
            .expect("readiness body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("readiness JSON");
        assert_eq!(body["status"], "ready");
        assert_eq!(body["blockers"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn liveness_does_not_depend_on_readiness() {
        let readiness = ReadinessState::default();
        readiness
            .block("database", "database is unavailable")
            .await;
        let response = router(readiness)
            .oneshot(
                Request::get("/health/live")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
    }
}
