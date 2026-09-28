use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::collections::BTreeMap;
use utoipa::openapi::schema::{AdditionalProperties, ArrayBuilder, ObjectBuilder};
use utoipa::openapi::{RefOr, Schema};
use utoipa::ToSchema;

pub type JsonArticle = BTreeMap<String, Value>;

fn json_articles_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(
            ObjectBuilder::new()
                .additional_properties(Some(AdditionalProperties::FreeForm(true)))
                .build(),
        )
        .build()
        .into()
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct AcceptanceEvaluationRequest {
    pub claim_id: String,
    #[serde(default)]
    #[schema(required = false, default = false)]
    pub complete_control_path: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct AcceptanceEvaluationResponse {
    pub claim_id: String,
    pub accepted: bool,
    pub policy_version: String,
    #[schema(required = false)]
    pub reasons: Vec<String>,
    #[schema(required = false, default = 0, value_type = i64)]
    pub independent_root_count: usize,
    #[schema(required = false, default = 0, value_type = i64)]
    pub qualifying_observation_count: usize,
}

#[derive(Clone, Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct EvidencePolicyRecord {
    pub predicate: String,
    pub version: String,
    pub allowed_evidence_classes: Vec<String>,
    #[schema(value_type = i64)]
    pub minimum_independent_roots: usize,
    #[schema(required = false, default = false)]
    pub requires_complete_path: bool,
    #[schema(required = false, default = false)]
    pub permits_catalog_only: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RankRequest {
    #[schema(schema_with = json_articles_schema)]
    pub articles: Vec<JsonArticle>,
    #[serde(default)]
    #[schema(required = false)]
    pub liked_article_ids: Vec<i64>,
    #[serde(default)]
    #[schema(required = false)]
    pub bookmarked_article_ids: Vec<i64>,
    #[serde(default)]
    #[schema(required = false)]
    pub favorite_source_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RankResponse {
    #[schema(schema_with = json_articles_schema)]
    pub articles: Vec<JsonArticle>,
    #[schema(value_type = i64)]
    pub total: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ValidationError {
    pub loc: Vec<ValidationLocation>,
    pub msg: String,
    #[serde(rename = "type")]
    pub error_type: String,
    #[schema(required = false)]
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false, value_type = Object)]
    pub ctx: Option<Map<String, Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ValidationLocation {
    Text(String),
    Index(i64),
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[schema(as = HTTPValidationError)]
pub struct HttpValidationError {
    #[schema(required = false)]
    pub detail: Vec<ValidationError>,
}

impl IntoResponse for HttpValidationError {
    /// FastAPI request-validation failures are 422 with a `detail` array.
    fn into_response(self) -> axum::response::Response {
        (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(self)).into_response()
    }
}

impl HttpValidationError {
    pub(crate) fn field(input: Value, field: &str, error_type: &str, message: &str) -> Self {
        Self {
            detail: vec![ValidationError {
                loc: vec![
                    ValidationLocation::Text("body".to_owned()),
                    ValidationLocation::Text(field.to_owned()),
                ],
                msg: message.to_owned(),
                error_type: error_type.to_owned(),
                input,
                ctx: None,
            }],
        }
    }

    pub(crate) fn body(input: Value, error_type: &str, message: &str) -> Self {
        Self {
            detail: vec![ValidationError {
                loc: vec![ValidationLocation::Text("body".to_owned())],
                msg: message.to_owned(),
                error_type: error_type.to_owned(),
                input,
                ctx: None,
            }],
        }
    }

    pub fn into_response(self) -> axum::response::Response {
        (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(self)).into_response()
    }
}

pub fn parse_evaluation_request(
    body: &[u8],
) -> Result<AcceptanceEvaluationRequest, HttpValidationError> {
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
    let Some(claim_id) = fields.get("claim_id") else {
        return Err(HttpValidationError::field(
            value,
            "claim_id",
            "missing",
            "Field required",
        ));
    };
    let Some(claim_id_text) = claim_id.as_str() else {
        return Err(HttpValidationError::field(
            claim_id.clone(),
            "claim_id",
            "string_type",
            "Input should be a valid string",
        ));
    };
    let claim_id = claim_id_text;
    let complete_control_path = match fields.get("complete_control_path") {
        None => false,
        Some(flag) => parse_pydantic_bool(flag).ok_or_else(|| {
            let (error_type, message) = match flag {
                Value::String(_) | Value::Number(_) => (
                    "bool_parsing",
                    "Input should be a valid boolean, unable to interpret input",
                ),
                _ => ("bool_type", "Input should be a valid boolean"),
            };
            HttpValidationError::field(flag.clone(), "complete_control_path", error_type, message)
        })?,
    };
    Ok(AcceptanceEvaluationRequest {
        claim_id: claim_id.to_owned(),
        complete_control_path,
    })
}

fn parse_pydantic_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(value) => parse_number_bool(value),
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "t" | "yes" | "y" | "on" => Some(true),
            "0" | "false" | "f" | "no" | "n" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn parse_number_bool(value: &Number) -> Option<bool> {
    if let Some(integer) = value.as_i64() {
        return match integer {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        };
    }
    if let Some(unsigned) = value.as_u64() {
        return match unsigned {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        };
    }
    match value.as_f64()? {
        0.0 => Some(false),
        1.0 => Some(true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_evaluation_request;

    #[test]
    fn request_defaults_and_coerces_pydantic_boolean_inputs() {
        for (raw, expected) in [
            (r#"{"claim_id":"c"}"#, false),
            (r#"{"claim_id":"c","complete_control_path":true}"#, true),
            (r#"{"claim_id":"c","complete_control_path":"yes"}"#, true),
            (r#"{"claim_id":"c","complete_control_path":1}"#, true),
            (r#"{"claim_id":"c","complete_control_path":0.0}"#, false),
        ] {
            assert_eq!(
                parse_evaluation_request(raw.as_bytes())
                    .expect("valid request")
                    .complete_control_path,
                expected
            );
        }
    }

    #[test]
    fn null_and_non_boolean_values_return_422_validation_shapes() {
        for raw in [
            r#"{"claim_id":"c","complete_control_path":null}"#,
            r#"{"claim_id":"c","complete_control_path":2}"#,
            r#"{"claim_id":null}"#,
            r#"{}"#,
        ] {
            assert_eq!(
                parse_evaluation_request(raw.as_bytes())
                    .expect_err("invalid request")
                    .detail
                    .len(),
                1
            );
        }
    }

    #[test]
    fn unknown_request_fields_are_ignored() {
        let request = parse_evaluation_request(br#"{"claim_id":"c","future_field":true}"#)
            .expect("unknown fields match Pydantic's default extra=ignore behavior");
        assert_eq!(request.claim_id, "c");
        assert!(!request.complete_control_path);
    }
}
