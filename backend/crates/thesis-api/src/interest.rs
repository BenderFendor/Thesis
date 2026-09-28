use std::collections::BTreeMap;

use axum::extract::{Query, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_evidence::ownership::{
    compute_indirect_interest, InterestCalculationTrace, InterestType, PercentRange,
    DEFAULT_MAX_INTEREST_PATHS, OWNERSHIP_ALGORITHM_VERSION,
};
use utoipa::openapi::schema::{AnyOfBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

fn security_class_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .max_length(Some(64))
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn interest_map_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(ObjectBuilder::new().schema_type(Type::Number)))
        .build()
        .into()
}

fn optional_interest_map_schema() -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(interest_map_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct OwnershipInterestQueryParameters {
    #[param(required = true, max_length = 128)]
    owner_id: Option<String>,
    #[param(required = true, max_length = 128)]
    target_id: Option<String>,
    #[param(required = false, default = "economic", max_length = 32)]
    interest_type: Option<String>,
    #[param(required = false, schema_with = security_class_schema)]
    security_class: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct OwnershipInterestQuery {
    owner_id: String,
    target_id: String,
    interest_type: String,
    security_class: Option<String>,
}

fn validation_detail(
    field: Option<&str>,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> ValidationError {
    let mut loc = vec![ValidationLocation::Text("query".to_owned())];
    if let Some(field) = field {
        loc.push(ValidationLocation::Text(field.to_owned()));
    }
    ValidationError {
        loc,
        msg: message.to_owned(),
        error_type: error_type.to_owned(),
        input,
        ctx,
    }
}

fn max_length_detail(field: &str, value: &str, limit: usize) -> ValidationError {
    validation_detail(
        Some(field),
        Value::String(value.to_owned()),
        "string_too_long",
        &format!("String should have at most {limit} characters"),
        Some(Map::from_iter([(
            "max_length".to_owned(),
            Value::from(limit),
        )])),
    )
}

fn missing_detail(field: &str) -> ValidationError {
    validation_detail(Some(field), Value::Null, "missing", "Field required", None)
}

fn validate_required(
    value: Option<String>,
    field: &str,
    limit: usize,
    details: &mut Vec<ValidationError>,
) -> Option<String> {
    let Some(value) = value else {
        details.push(missing_detail(field));
        return None;
    };
    if value.chars().count() > limit {
        details.push(max_length_detail(field, &value, limit));
    }
    Some(value)
}

fn validate_optional(
    value: Option<String>,
    field: &str,
    limit: usize,
    details: &mut Vec<ValidationError>,
) -> Option<String> {
    let value = value?;
    if value.chars().count() > limit {
        details.push(max_length_detail(field, &value, limit));
    }
    Some(value)
}

fn parse_query(uri: &Uri) -> Result<OwnershipInterestQuery, HttpValidationError> {
    let Query(values) =
        Query::<OwnershipInterestQueryParameters>::try_from_uri(uri).map_err(|_| {
            HttpValidationError {
                detail: vec![validation_detail(
                    None,
                    Value::String(uri.query().unwrap_or_default().to_owned()),
                    "query_parsing",
                    "Invalid query string",
                    None,
                )],
            }
        })?;

    let mut details = Vec::new();
    let owner_id = validate_required(values.owner_id, "owner_id", 128, &mut details);
    let target_id = validate_required(values.target_id, "target_id", 128, &mut details);
    let interest_type = validate_optional(values.interest_type, "interest_type", 32, &mut details);
    let security_class =
        validate_optional(values.security_class, "security_class", 64, &mut details);
    if !details.is_empty() {
        return Err(HttpValidationError { detail: details });
    }

    Ok(OwnershipInterestQuery {
        owner_id: owner_id.expect("required owner_id was validated"),
        target_id: target_id.expect("required target_id was validated"),
        interest_type: interest_type.unwrap_or_else(|| "economic".to_owned()),
        security_class,
    })
}

#[derive(Clone, Debug, Serialize, ToSchema, PartialEq)]
#[schema(as = OwnershipInterestPath)]
pub(super) struct OwnershipInterestPath {
    pub entity_ids: Vec<String>,
    pub claim_ids: Vec<String>,
    #[schema(schema_with = interest_map_schema)]
    pub interest: BTreeMap<String, f64>,
    #[schema(required = false)]
    pub disjoint_group: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema, PartialEq)]
#[schema(as = OwnershipInterestResponse)]
pub(super) struct OwnershipInterestResponse {
    pub owner_id: String,
    pub target_id: String,
    pub interest_type: String,
    #[schema(required = false)]
    pub security_class: Option<String>,
    #[schema(required = false, schema_with = optional_interest_map_schema)]
    pub aggregate: Option<BTreeMap<String, f64>>,
    pub possibly_overlapping: bool,
    pub cross_holding_unresolved: bool,
    pub algorithm_version: String,
    #[schema(required = false)]
    pub paths: Vec<OwnershipInterestPath>,
}

fn percentage_map(range: PercentRange) -> BTreeMap<String, f64> {
    BTreeMap::from([
        ("lower".to_owned(), range.lower),
        ("upper".to_owned(), range.upper),
    ])
}

impl From<InterestCalculationTrace> for OwnershipInterestResponse {
    fn from(trace: InterestCalculationTrace) -> Self {
        Self {
            owner_id: trace.owner_id,
            target_id: trace.target_id,
            interest_type: trace.interest_type.as_str().to_owned(),
            security_class: trace.security_class,
            aggregate: trace.aggregate.map(percentage_map),
            possibly_overlapping: trace.possibly_overlapping,
            cross_holding_unresolved: trace.cross_holding_unresolved,
            algorithm_version: trace.algorithm_version,
            paths: trace
                .paths
                .into_iter()
                .map(|path| OwnershipInterestPath {
                    entity_ids: path.entity_ids,
                    claim_ids: path.claim_ids,
                    interest: percentage_map(path.interest),
                    disjoint_group: path.disjoint_group,
                })
                .collect(),
        }
    }
}

fn empty_response(query: &OwnershipInterestQuery) -> OwnershipInterestResponse {
    OwnershipInterestResponse {
        owner_id: query.owner_id.clone(),
        target_id: query.target_id.clone(),
        interest_type: query.interest_type.clone(),
        security_class: query.security_class.clone(),
        aggregate: None,
        possibly_overlapping: false,
        cross_holding_unresolved: false,
        algorithm_version: OWNERSHIP_ALGORITHM_VERSION.to_owned(),
        paths: Vec::new(),
    }
}

fn supported_interest_type(value: &str) -> Option<InterestType> {
    match value {
        "economic" => Some(InterestType::Economic),
        "voting" => Some(InterestType::Voting),
        _ => None,
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/evidence/interest",
    operation_id = "get_ownership_interest_api_wiki_evidence_interest_get",
    tag = "wiki-evidence",
    params(OwnershipInterestQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = OwnershipInterestResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError)
    )
)]
pub(super) async fn get_ownership_interest(State(state): State<AppState>, uri: Uri) -> Response {
    let query = match parse_query(&uri) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };

    let Some(interest_type) = supported_interest_type(&query.interest_type) else {
        return Json(empty_response(&query)).into_response();
    };

    let edges = match state.database.load_ownership_edges().await {
        Ok(edges) => edges,
        Err(error) => {
            tracing::error!(%error, "ownership interest edge load failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let calculation = match compute_indirect_interest(
        &edges,
        &query.owner_id,
        &query.target_id,
        interest_type,
        query.security_class.as_deref(),
        DEFAULT_MAX_INTEREST_PATHS,
    ) {
        Ok(calculation) => calculation,
        Err(error) => {
            tracing::error!(%error, "ownership interest calculation failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    Json(OwnershipInterestResponse::from(calculation.trace())).into_response()
}

#[cfg(test)]
mod tests {
    use super::{parse_query, OwnershipInterestResponse};
    use crate::ApiDoc;
    use axum::http::Uri;
    use serde_json::json;
    use utoipa::OpenApi;

    #[test]
    fn missing_query_fields_match_fastapi_validation_shape() {
        let uri: Uri = "/api/wiki/evidence/interest".parse().expect("valid URI");
        let error = parse_query(&uri).expect_err("required fields should be rejected");
        assert_eq!(
            serde_json::to_value(&error.detail[0].loc).unwrap(),
            json!(["query", "owner_id"])
        );
        assert_eq!(error.detail[0].error_type, "missing");
        assert_eq!(
            serde_json::to_value(&error.detail[1].loc).unwrap(),
            json!(["query", "target_id"])
        );
        assert_eq!(error.detail[1].input, json!(null));
    }

    #[test]
    fn max_lengths_count_unicode_characters() {
        let encoded_owner_id = "%C3%A9".repeat(129);
        let uri: Uri =
            format!("/api/wiki/evidence/interest?owner_id={encoded_owner_id}&target_id=target")
                .parse()
                .expect("valid URI");
        let error = parse_query(&uri).expect_err("overlong owner id should be rejected");
        assert_eq!(error.detail[0].error_type, "string_too_long");
        assert_eq!(
            error.detail[0].ctx.as_ref().expect("max length context")["max_length"],
            json!(128)
        );
    }

    #[test]
    fn openapi_interest_route_exposes_query_limits_and_response_schema() {
        let spec: serde_json::Value =
            serde_json::from_str(&ApiDoc::openapi().to_json().expect("OpenAPI JSON"))
                .expect("valid OpenAPI JSON");
        let operation = &spec["paths"]["/api/wiki/evidence/interest"]["get"];
        assert_eq!(
            operation["operationId"],
            "get_ownership_interest_api_wiki_evidence_interest_get"
        );
        assert!(operation["responses"]["200"].is_object());
        assert!(operation["responses"]["422"].is_object());
        for (name, required, max_length) in [
            ("owner_id", true, 128),
            ("target_id", true, 128),
            ("interest_type", false, 32),
            ("security_class", false, 64),
        ] {
            let parameter = operation["parameters"]
                .as_array()
                .expect("query parameters")
                .iter()
                .find(|parameter| parameter["name"] == name)
                .expect("parameter present");
            assert_eq!(parameter["required"], required);
            let schema = &parameter["schema"];
            let max = schema["maxLength"].as_u64().or_else(|| {
                schema["anyOf"]
                    .as_array()
                    .and_then(|values| values.first())
                    .and_then(|value| value["maxLength"].as_u64())
            });
            assert_eq!(max, Some(max_length));
        }
        assert_eq!(
            spec["components"]["schemas"]["OwnershipInterestResponse"]["properties"]
                ["possibly_overlapping"]["type"],
            "boolean"
        );
        let _ = std::mem::size_of::<OwnershipInterestResponse>();
    }
}
