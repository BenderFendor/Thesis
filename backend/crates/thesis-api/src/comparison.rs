use axum::body::Bytes;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder};
use utoipa::openapi::{RefOr, Schema};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub(crate) struct ComparisonRequest {
    pub content_1: String,
    pub content_2: String,
    #[serde(default)]
    #[schema(required = false, default = "")]
    pub title_1: String,
    #[serde(default)]
    #[schema(required = false, default = "")]
    pub title_2: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub(crate) struct ComparisonResponse {
    #[schema(schema_with = free_form_object_schema)]
    similarity: Value,
    #[schema(schema_with = free_form_object_schema)]
    entities: Value,
    #[schema(schema_with = free_form_object_schema)]
    keywords: Value,
    #[schema(schema_with = free_form_object_schema)]
    diff: Value,
    #[schema(schema_with = free_form_object_schema)]
    summary: Value,
}

fn free_form_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

fn parse_comparison_request(body: &[u8]) -> Result<ComparisonRequest, HttpValidationError> {
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

    Ok(ComparisonRequest {
        content_1: request_string(fields, &value, "content_1", None)?,
        content_2: request_string(fields, &value, "content_2", None)?,
        title_1: request_string(fields, &value, "title_1", Some(""))?,
        title_2: request_string(fields, &value, "title_2", Some(""))?,
    })
}

fn request_string(
    fields: &Map<String, Value>,
    body: &Value,
    field: &str,
    default: Option<&str>,
) -> Result<String, HttpValidationError> {
    let Some(value) = fields.get(field) else {
        return default.map(str::to_owned).ok_or_else(|| {
            HttpValidationError::field(body.clone(), field, "missing", "Field required")
        });
    };
    value.as_str().map(str::to_owned).ok_or_else(|| {
        HttpValidationError::field(
            value.clone(),
            field,
            "string_type",
            "Input should be a valid string",
        )
    })
}

#[utoipa::path(
    post,
    path = "/compare/articles",
    operation_id = "compare_two_articles_compare_articles_post",
    request_body = ComparisonRequest,
    responses(
        (status = 200, description = "Successful Response", body = ComparisonResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn post_compare_articles(body: Bytes) -> Response {
    let request = match parse_comparison_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let result = thesis_search::article_comparison::compare_articles(
        &request.content_1,
        &request.content_2,
        &request.title_1,
        &request.title_2,
    );
    Json(result).into_response()
}

#[cfg(test)]
mod tests {
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use axum::routing::post;
    use axum::Router;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::post_compare_articles;

    fn comparison_router() -> Router {
        Router::new().route("/compare/articles", post(post_compare_articles))
    }

    #[tokio::test]
    async fn comparison_route_defaults_titles_and_returns_the_contract_shape() {
        let response = comparison_router()
            .oneshot(
                Request::post("/compare/articles")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"content_1":"Dr. Ada Lovelace visited London on Monday, March 3, 2025.","content_2":"Dr. Ada Lovelace visited London on Monday, March 3, 2025.","extra":"ignored"}"#,
                    ))
                    .expect("request"),
            )
            .await
            .expect("handler response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("response body"),
        )
        .expect("JSON response");
        for field in ["similarity", "entities", "keywords", "diff", "summary"] {
            assert!(payload[field].is_object(), "missing object field {field}");
        }
        assert_eq!(payload["similarity"]["content_similarity"], 1.0);
        assert_eq!(payload["similarity"]["title_similarity"], 0.0);
    }

    #[tokio::test]
    async fn comparison_route_returns_fastapi_style_422_for_missing_and_nonstring_fields() {
        for (body, error_type, field) in [
            (r#"{"content_2":"article"}"#, "missing", "content_1"),
            (
                r#"{"content_1":12,"content_2":"article"}"#,
                "string_type",
                "content_1",
            ),
            (
                r#"{"content_1":"article","content_2":null}"#,
                "string_type",
                "content_2",
            ),
            (
                r#"{"content_1":"article","content_2":"body","title_1":null}"#,
                "string_type",
                "title_1",
            ),
        ] {
            let response = comparison_router()
                .oneshot(
                    Request::post("/compare/articles")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .expect("request"),
                )
                .await
                .expect("handler response");

            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
            let payload: Value = serde_json::from_slice(
                &to_bytes(response.into_body(), usize::MAX)
                    .await
                    .expect("response body"),
            )
            .expect("JSON response");
            assert_eq!(payload["detail"][0]["type"], error_type);
            assert_eq!(payload["detail"][0]["loc"][1], field);
        }
    }
}
