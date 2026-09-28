use std::env;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use axum::body::Body;
use axum::http::header::{self, HeaderValue};
use axum::http::Request;
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::Router;
use regex::Regex;
use tower_http::compression::predicate::{NotForContentType, Predicate, SizeAbove};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

const DEFAULT_CORS_ORIGINS: &str = "http://localhost:3000,http://localhost:3001";
const COMPRESSION_MINIMUM_BYTES: u16 = 1_000;
const SKIP_TRACE_PREFIXES: [&str; 4] = [
    "/health",
    "/favicon.ico",
    "/static/",
    "/debug/observability/health",
];
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
struct RequestId(String);

/// Apply the FastAPI-equivalent browser, request-correlation, tracing and gzip layers.
pub(crate) fn apply(router: Router) -> Router {
    let cors = cors_layer_from_env();
    let compression = CompressionLayer::new().gzip(true).compress_when(
        SizeAbove::new(COMPRESSION_MINIMUM_BYTES)
            .and(NotForContentType::GRPC)
            .and(NotForContentType::IMAGES)
            .and(NotForContentType::SSE),
    );
    let trace = TraceLayer::new_for_http()
        .make_span_with(|request: &Request<Body>| {
            if SKIP_TRACE_PREFIXES
                .iter()
                .any(|prefix| request.uri().path().starts_with(prefix))
            {
                return tracing::Span::none();
            }
            let request_id = request
                .extensions()
                .get::<RequestId>()
                .map(|request_id| request_id.0.as_str())
                .unwrap_or("unknown");
            tracing::info_span!(
                "http_request",
                method = %request.method(),
                path = %request.uri().path(),
                request_id,
            )
        })
        .on_response(|response: &Response, latency: std::time::Duration, span: &tracing::Span| {
            if span.is_disabled() {
                return;
            }
            let status = response.status();
            if status.is_server_error() {
                tracing::error!(parent: span, status = status.as_u16(), ?latency, "request completed");
            } else {
                tracing::info!(parent: span, status = status.as_u16(), ?latency, "request completed");
            }
        });

    router
        .layer(cors)
        .layer(trace)
        .layer(middleware::from_fn(request_context))
        .layer(compression)
}

fn cors_layer_from_env() -> CorsLayer {
    let origins = env::var("CORS_ORIGINS").unwrap_or_else(|_| DEFAULT_CORS_ORIGINS.to_owned());
    let origins = origins
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let origin_regex = env::var("CORS_ORIGIN_REGEX")
        .ok()
        .filter(|pattern| !pattern.trim().is_empty())
        .and_then(|pattern| match Regex::new(&pattern) {
            Ok(regex) => Some(regex),
            Err(error) => {
                tracing::warn!(%error, "CORS_ORIGIN_REGEX is invalid; regex origins are disabled");
                None
            }
        });
    cors_layer_from_config(&origins, origin_regex)
}

async fn request_context(mut request: Request<Body>, next: Next) -> Response {
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(generated_request_id);
    request
        .extensions_mut()
        .insert(RequestId(request_id.clone()));
    let started_at = Instant::now();
    let mut response = next.run(request).await;
    let duration_ms = started_at.elapsed().as_secs_f64() * 1_000.0;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", value);
    }
    let response_time = format!("{duration_ms:.1}ms");
    if let Ok(value) = HeaderValue::from_str(&response_time) {
        response.headers_mut().insert("x-response-time", value);
    }
    let server_timing = format!("app;dur={duration_ms:.1}");
    if let Ok(value) = HeaderValue::from_str(&server_timing) {
        response.headers_mut().insert(header::SERVER_TIMING, value);
    }
    response
}

fn generated_request_id() -> String {
    format!(
        "req_{:012x}",
        REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed) & 0x000f_ffff_ffff_ffff
    )
}

#[cfg(test)]
mod tests {
    use axum::body::{to_bytes, Body};
    use axum::http::header::{self};
    use axum::http::{Method, Request, StatusCode};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    use super::{cors_layer_from_config, request_context, DEFAULT_CORS_ORIGINS};
    use regex::Regex;

    #[tokio::test]
    async fn cors_allows_configured_origins_with_credentials_any_method_and_headers() {
        let app = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(cors_layer_from_config(
                &[
                    "http://localhost:3000".to_owned(),
                    "http://localhost:3001".to_owned(),
                ],
                None,
            ));
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/")
                    .header(header::ORIGIN, "http://localhost:3000")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "PATCH")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "x-client-token")
                    .body(Body::empty())
                    .expect("preflight request"),
            )
            .await
            .expect("preflight response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://localhost:3000"
        );
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_CREDENTIALS],
            "true"
        );
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_METHODS],
            "PATCH"
        );
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS],
            "x-client-token"
        );
    }

    #[tokio::test]
    async fn cors_regex_allows_matching_origins_and_rejects_nonmatching_origins() {
        let app = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(cors_layer_from_config(
                &[],
                Some(Regex::new(r"^https://[a-z]+\.example\.org$").expect("valid regex")),
            ));
        let allowed = app
            .clone()
            .oneshot(
                Request::get("/")
                    .header(header::ORIGIN, "https://news.example.org")
                    .body(Body::empty())
                    .expect("allowed request"),
            )
            .await
            .expect("allowed response");
        assert_eq!(
            allowed.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://news.example.org"
        );
        let denied = app
            .oneshot(
                Request::get("/")
                    .header(header::ORIGIN, "https://evil.example.com")
                    .body(Body::empty())
                    .expect("denied request"),
            )
            .await
            .expect("denied response");
        assert!(!denied
            .headers()
            .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    #[tokio::test]
    async fn request_context_preserves_request_id_and_adds_timing_headers() {
        let app = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(request_context));
        let response = app
            .oneshot(
                Request::get("/")
                    .header("x-request-id", "test-request-17")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.headers()["x-request-id"], "test-request-17");
        assert!(response.headers()["x-response-time"]
            .to_str()
            .unwrap()
            .ends_with("ms"));
        assert!(response.headers()[header::SERVER_TIMING]
            .to_str()
            .unwrap()
            .starts_with("app;dur="));
    }

    #[tokio::test]
    async fn gzip_compresses_only_responses_above_one_kibibyte() {
        let app = super::apply(
            Router::new()
                .route("/large", get(|| async { "x".repeat(1_500) }))
                .route("/small", get(|| async { "x".repeat(999) })),
        );
        let response = app
            .oneshot(
                Request::get("/large")
                    .header(header::ACCEPT_ENCODING, "gzip")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
        let compressed = to_bytes(response.into_body(), 4_096)
            .await
            .expect("compressed body");
        assert!(compressed.len() < 1_500);
        let response = app
            .oneshot(
                Request::get("/small")
                    .header(header::ACCEPT_ENCODING, "gzip")
                    .body(Body::empty())
                    .expect("small request"),
            )
            .await
            .expect("small response");
        assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    }

    #[test]
    fn cors_defaults_match_fastapi_frontend_origins() {
        assert_eq!(
            DEFAULT_CORS_ORIGINS.split(',').collect::<Vec<_>>(),
            ["http://localhost:3000", "http://localhost:3001"]
        );
    }
}

fn cors_layer_from_config(origins: &[String], origin_regex: Option<Regex>) -> CorsLayer {
    let allowed_origins = origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin.trim()).ok())
        .collect::<Vec<_>>();
    let allow_origin = AllowOrigin::predicate(move |origin, _| {
        allowed_origins.iter().any(|allowed| allowed == origin)
            || origin.to_str().ok().is_some_and(|origin| {
                origin_regex
                    .as_ref()
                    .is_some_and(|regex| regex.is_match(origin))
            })
    });
    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_credentials(true)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
}
