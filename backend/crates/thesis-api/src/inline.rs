//! Typed boundary for inline term definitions.
//!
//! OpenRouter/Gemini work stays behind a narrow sidecar. This module owns strict
//! request parsing, deterministic response shaping, and the existing FastAPI
//! success/error statuses without making a provider call or fabricating a definition.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

/// A future returned by the inline-definition integration.
pub type InlineFuture<T> = Pin<Box<dyn Future<Output = Result<T, InlineDefinitionError>> + Send>>;

/// A provider failure that is safe to project into the public response.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InlineDefinitionError {
    /// OpenRouter credentials/client are unavailable.
    ProviderUnavailable,
    /// The configured provider failed after invocation.
    ProviderFailed(String),
}

/// Strict request body accepted by `POST /api/inline/define`.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct InlineDefineRequest {
    /// Highlighted term or phrase.
    pub term: String,
    /// Optional article topic/context.
    #[serde(default)]
    #[schema(required = false)]
    pub context: Option<String>,
}

/// Typed input passed to the provider after FastAPI-compatible whitespace handling.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InlineDefinitionInput {
    /// Trimmed highlighted term.
    pub term: String,
    /// Optional article context, preserved as supplied.
    pub context: Option<String>,
}

/// FastAPI-compatible response for inline definitions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, ToSchema)]
pub(crate) struct InlineDefineResponse {
    /// Whether a provider definition was produced.
    pub success: bool,
    /// Original request term, not the trimmed provider input.
    pub term: String,
    /// Definition text when successful.
    #[schema(required = false)]
    pub definition: Option<String>,
    /// Public provider/validation error when unsuccessful.
    #[schema(required = false)]
    pub error: Option<String>,
}

/// Sidecar for the external OpenRouter/Gemini definition provider.
pub trait InlineDefinitionProvider: Send + Sync {
    /// Define one already-validated, non-empty term.
    fn define(&self, input: InlineDefinitionInput) -> InlineFuture<String>;
    /// Whether the configured language-model client is available.
    fn is_configured(&self) -> bool {
        true
    }
}

/// State needed by the inline-definition route.
#[derive(Clone, Default)]
pub struct InlineDefinitionState {
    /// Optional provider. `None` mirrors FastAPI's unconfigured-client failure.
    pub provider: Option<Arc<dyn InlineDefinitionProvider>>,
}

impl InlineDefinitionState {
    /// Build state with an optional definition provider.
    pub fn new(provider: Option<Arc<dyn InlineDefinitionProvider>>) -> Self {
        Self { provider }
    }

    /// Build state with a configured definition provider.
    pub fn with_provider(provider: impl InlineDefinitionProvider + 'static) -> Self {
        Self::new(Some(Arc::new(provider)))
    }

    /// Whether a definition provider is configured.
    pub fn is_configured(&self) -> bool {
        self.provider
            .as_ref()
            .is_some_and(|provider| provider.is_configured())
    }
}

/// Construct the inline-definition route with its provider state.
pub(crate) fn router(state: InlineDefinitionState) -> Router {
    Router::new()
        .route("/api/inline/define", post(define_inline))
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/api/inline/define",
    operation_id = "define_inline_api_inline_define_post",
    tag = "inline",
    request_body = InlineDefineRequest,
    responses(
        (status = 200, description = "Successful Response", body = InlineDefineResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn define_inline(
    axum::extract::State(state): axum::extract::State<InlineDefinitionState>,
    body: Bytes,
) -> Response {
    let request = match parse_inline_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    if request.term.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"detail": "Term must not be empty"})),
        )
            .into_response();
    }

    let original_term = request.term.clone();
    let input = InlineDefinitionInput {
        term: request.term.trim().to_owned(),
        context: request.context,
    };
    let Some(provider) = state.provider.filter(|provider| provider.is_configured()) else {
        return Json(InlineDefineResponse {
            success: false,
            term: original_term,
            definition: None,
            error: Some("OpenRouter API key not configured".to_owned()),
        })
        .into_response();
    };

    match provider.define(input).await {
        Ok(definition) => Json(InlineDefineResponse {
            success: true,
            term: original_term,
            definition: Some(definition),
            error: None,
        })
        .into_response(),
        Err(InlineDefinitionError::ProviderUnavailable) => Json(InlineDefineResponse {
            success: false,
            term: original_term,
            definition: None,
            error: Some("OpenRouter API key not configured".to_owned()),
        })
        .into_response(),
        Err(InlineDefinitionError::ProviderFailed(error)) => Json(InlineDefineResponse {
            success: false,
            term: original_term,
            definition: None,
            error: Some(error),
        })
        .into_response(),
    }
}

fn parse_inline_request(body: &[u8]) -> Result<InlineDefineRequest, HttpValidationError> {
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
    let Some(term) = fields.get("term") else {
        return Err(HttpValidationError::field(
            value,
            "term",
            "missing",
            "Field required",
        ));
    };
    let Some(term) = term.as_str() else {
        return Err(HttpValidationError::field(
            term.clone(),
            "term",
            "string_type",
            "Input should be a valid string",
        ));
    };
    let context = match fields.get("context") {
        None | Some(Value::Null) => None,
        Some(context) => Some(
            context
                .as_str()
                .ok_or_else(|| {
                    HttpValidationError::field(
                        context.clone(),
                        "context",
                        "string_type",
                        "Input should be a valid string",
                    )
                })?
                .to_owned(),
        ),
    };
    Ok(InlineDefineRequest {
        term: term.to_owned(),
        context,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use serde_json::Value;
    use tower::ServiceExt;

    use super::{
        parse_inline_request, InlineDefinitionError, InlineDefinitionInput,
        InlineDefinitionProvider, InlineDefinitionState, InlineFuture,
    };

    struct CapturedProvider {
        result: Result<String, InlineDefinitionError>,
    }

    impl InlineDefinitionProvider for CapturedProvider {
        fn define(&self, input: InlineDefinitionInput) -> InlineFuture<String> {
            assert_eq!(input.term, "Janet Yellen");
            assert_eq!(input.context.as_deref(), Some("US economics"));
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }
    struct NotConfiguredProvider;

    impl InlineDefinitionProvider for NotConfiguredProvider {
        fn define(&self, _input: InlineDefinitionInput) -> InlineFuture<String> {
            Box::pin(async { Ok("should not be returned".to_owned()) })
        }

        fn is_configured(&self) -> bool {
            false
        }
    }

    fn router(provider: Option<Arc<dyn InlineDefinitionProvider>>) -> axum::Router {
        super::router(InlineDefinitionState { provider })
    }
    #[test]
    fn state_readiness_requires_configured_provider() {
        assert!(!InlineDefinitionState::default().is_configured());
        assert!(!InlineDefinitionState::new(Some(Arc::new(NotConfiguredProvider))).is_configured());
        assert!(InlineDefinitionState::with_provider(CapturedProvider {
            result: Ok("A valid definition.".to_owned())
        })
        .is_configured());
    }

    #[test]
    fn strict_request_parser_preserves_nullable_context_and_ignores_extra_fields() {
        assert_eq!(
            parse_inline_request(br#"{"term":"Janet Yellen","context":null,"future_field":true}"#,)
                .expect("request")
                .context,
            None
        );
        for body in [
            br#"{}"#.as_slice(),
            br#"{"term":null}"#.as_slice(),
            br#"{"term":4}"#.as_slice(),
            br#"{"term":"x","context":4}"#.as_slice(),
            br#"[]"#.as_slice(),
        ] {
            assert_eq!(
                parse_inline_request(body)
                    .expect_err("invalid request")
                    .detail
                    .len(),
                1
            );
        }
    }

    #[tokio::test]
    async fn empty_term_keeps_fastapi_400_error_shape() {
        let response = router(None)
            .oneshot(
                Request::post("/api/inline/define")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"term":"  "}"#))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("body"),
        )
        .expect("JSON");
        assert_eq!(
            payload,
            serde_json::json!({"detail": "Term must not be empty"})
        );
    }

    #[tokio::test]
    async fn missing_or_unconfigured_provider_is_a_200_failure_not_a_fake_definition() {
        let providers = [
            None,
            Some(Arc::new(NotConfiguredProvider) as Arc<dyn InlineDefinitionProvider>),
        ];
        for provider in providers {
            let response = router(provider)
                .oneshot(
                    Request::post("/api/inline/define")
                        .header("content-type", "application/json")
                        .body(Body::from(r#"{"term":"Janet Yellen"}"#))
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
            assert_eq!(
                payload,
                serde_json::json!({
                    "success": false,
                    "term": "Janet Yellen",
                    "definition": null,
                    "error": "OpenRouter API key not configured"
                })
            );
        }
    }

    #[tokio::test]
    async fn provider_success_and_failure_keep_nullable_response_fields() {
        for (result, expected) in [
            (
                Ok("A former United States treasury secretary.".to_owned()),
                serde_json::json!({
                    "success": true,
                    "term": "Janet Yellen",
                    "definition": "A former United States treasury secretary.",
                    "error": null
                }),
            ),
            (
                Err(InlineDefinitionError::ProviderFailed("offline".to_owned())),
                serde_json::json!({
                    "success": false,
                    "term": "Janet Yellen",
                    "definition": null,
                    "error": "offline"
                }),
            ),
        ] {
            let response = router(Some(Arc::new(CapturedProvider { result })))
                .oneshot(
                    Request::post("/api/inline/define")
                        .header("content-type", "application/json")
                        .body(Body::from(
                            r#"{"term":" Janet Yellen ","context":"US economics"}"#,
                        ))
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
            let mut expected = expected;
            expected["term"] = Value::String(" Janet Yellen ".to_owned());
            assert_eq!(payload, expected);
        }
    }
}
