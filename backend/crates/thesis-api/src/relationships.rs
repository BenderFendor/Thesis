use axum::extract::{Query, State};
use axum::http::Uri;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, NaiveDate, NaiveDateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thesis_db::RelationshipRecord;
use utoipa::openapi::schema::{AdditionalProperties, AnyOfBuilder, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;

fn json_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

fn nullable_string_schema(max_length: usize) -> RefOr<Schema> {
    Schema::from(
        AnyOfBuilder::new()
            .item(
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .max_length(Some(max_length))
                    .build(),
            )
            .item(ObjectBuilder::new().schema_type(Type::Null).build())
            .build(),
    )
    .into()
}

fn predicates_schema() -> RefOr<Schema> {
    nullable_string_schema(500)
}

fn entity_id_schema() -> RefOr<Schema> {
    nullable_string_schema(128)
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum RelationshipStatus {
    Accepted,
    Historical,
    Disputed,
    Retracted,
}

impl TryFrom<String> for RelationshipStatus {
    type Error = &'static str;

    fn try_from(status: String) -> Result<Self, Self::Error> {
        match status.as_str() {
            "accepted" => Ok(Self::Accepted),
            "historical" => Ok(Self::Historical),
            "disputed" => Ok(Self::Disputed),
            "retracted" => Ok(Self::Retracted),
            _ => Err("unknown relationship status"),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = AcceptedRelationshipRecord)]
pub(super) struct RelationshipResponse {
    id: String,
    subject_entity_id: String,
    predicate: String,
    object_entity_id: String,
    #[schema(required = false, schema_with = json_object_schema)]
    qualifiers: Value,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    recorded_at: NaiveDateTime,
    retracted_at: Option<NaiveDateTime>,
    materialized_at: NaiveDateTime,
    materialized_by: Option<String>,
    acceptance_policy_version: String,
    status: RelationshipStatus,
    #[schema(required = false)]
    claim_ids: Vec<String>,
    #[schema(required = false, default = 0, value_type = i64)]
    evidence_root_count: usize,
}

impl TryFrom<RelationshipRecord> for RelationshipResponse {
    type Error = &'static str;

    fn try_from(record: RelationshipRecord) -> Result<Self, Self::Error> {
        if !record.qualifiers.is_object() {
            return Err("relationship qualifiers must be a JSON object");
        }
        Ok(Self {
            id: record.id,
            subject_entity_id: record.subject_entity_id,
            predicate: record.predicate,
            object_entity_id: record.object_entity_id,
            qualifiers: record.qualifiers,
            valid_from: record.valid_from,
            valid_to: record.valid_to,
            recorded_at: record.recorded_at,
            retracted_at: record.retracted_at,
            materialized_at: record.materialized_at,
            materialized_by: record.materialized_by,
            acceptance_policy_version: record.acceptance_policy_version,
            status: record.status.try_into()?,
            claim_ids: record.claim_ids,
            evidence_root_count: record.evidence_root_count,
        })
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = RelationshipQueryResponse)]
pub(super) struct RelationshipListResponse {
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
    #[schema(required = false)]
    relationships: Vec<RelationshipResponse>,
}

#[derive(Debug)]
struct RelationshipQuery {
    as_of: Option<NaiveDateTime>,
    known_at: Option<NaiveDateTime>,
    predicates: Option<Vec<String>>,
    entity_id: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct RelationshipQueryParameters {
    #[param(required = false, value_type = NaiveDateTime, nullable = true)]
    as_of: Option<String>,
    #[param(required = false, value_type = NaiveDateTime, nullable = true)]
    known_at: Option<String>,
    #[param(schema_with = predicates_schema)]
    predicates: Option<String>,
    #[param(schema_with = entity_id_schema)]
    entity_id: Option<String>,
}

fn validation_error(
    field: Option<&str>,
    input: Value,
    error_type: &str,
    message: &str,
    ctx: Option<Map<String, Value>>,
) -> HttpValidationError {
    let mut loc = vec![ValidationLocation::Text("query".to_owned())];
    if let Some(field) = field {
        loc.push(ValidationLocation::Text(field.to_owned()));
    }
    HttpValidationError {
        detail: vec![ValidationError {
            loc,
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx,
        }],
    }
}

fn max_length_error(field: &str, value: &str, limit: usize) -> HttpValidationError {
    validation_error(
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

fn invalid_datetime_error(field: &str, value: &str) -> HttpValidationError {
    validation_error(
        Some(field),
        Value::String(value.to_owned()),
        "datetime_from_date_parsing",
        "Input should be a valid datetime",
        None,
    )
}

fn parse_query(uri: &Uri) -> Result<RelationshipQuery, HttpValidationError> {
    let Query(values) = Query::<RelationshipQueryParameters>::try_from_uri(uri).map_err(|_| {
        validation_error(
            None,
            Value::String(uri.query().unwrap_or_default().to_owned()),
            "query_parsing",
            "Invalid query string",
            None,
        )
    })?;

    let as_of = parse_optional_datetime(values.as_of.as_deref(), "as_of")?;
    let known_at = parse_optional_datetime(values.known_at.as_deref(), "known_at")?;
    let predicates_value = values.predicates.as_deref();
    if let Some(value) = predicates_value {
        if value.chars().count() > 500 {
            return Err(max_length_error("predicates", value, 500));
        }
    }
    let entity_id = values.entity_id.as_deref();
    if let Some(value) = entity_id {
        if value.chars().count() > 128 {
            return Err(max_length_error("entity_id", value, 128));
        }
    }
    let predicates = predicates_value
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|predicate| !predicate.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty());

    Ok(RelationshipQuery {
        as_of,
        known_at,
        predicates,
        entity_id: entity_id
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
    })
}

fn parse_optional_datetime(
    value: Option<&str>,
    field: &str,
) -> Result<Option<NaiveDateTime>, HttpValidationError> {
    value
        .map(|value| parse_datetime(value).ok_or_else(|| invalid_datetime_error(field, value)))
        .transpose()
}

fn parse_datetime(value: &str) -> Option<NaiveDateTime> {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(value) {
        return Some(to_utc_naive(datetime.with_timezone(&Utc).naive_utc()));
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f%:z",
        "%Y-%m-%d %H:%M:%S%.f%:z",
        "%Y-%m-%dT%H:%M%:z",
        "%Y-%m-%d %H:%M%:z",
    ] {
        if let Ok(datetime) = DateTime::parse_from_str(value, format) {
            return Some(to_utc_naive(datetime.with_timezone(&Utc).naive_utc()));
        }
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(datetime) = NaiveDateTime::parse_from_str(value, format) {
            return Some(to_utc_naive(datetime));
        }
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(0, 0, 0)
        .map(to_utc_naive)
}

fn to_utc_naive(datetime: NaiveDateTime) -> NaiveDateTime {
    datetime
        .with_nanosecond(datetime.nanosecond() / 1_000 * 1_000)
        .expect("truncated microseconds remain a valid timestamp")
}

fn effective_timestamp(timestamp: Option<NaiveDateTime>) -> NaiveDateTime {
    timestamp.unwrap_or_else(|| Utc::now().naive_utc())
}

#[utoipa::path(
    get,
    path = "/api/wiki/evidence/relationships",
    operation_id = "get_evidence_relationships_api_wiki_evidence_relationships_get",
    tag = "wiki-evidence",
    params(RelationshipQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = RelationshipListResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(super) async fn get_relationships(State(state): State<AppState>, uri: Uri) -> Response {
    let query = match parse_query(&uri) {
        Ok(query) => query,
        Err(error) => return error.into_response(),
    };
    let as_of = effective_timestamp(query.as_of);
    let known_at = effective_timestamp(query.known_at);
    match state
        .database
        .list_relationships(as_of, known_at, query.predicates, query.entity_id)
        .await
    {
        Ok(records) => {
            let relationships = match records
                .into_iter()
                .map(RelationshipResponse::try_from)
                .collect::<Result<Vec<_>, _>>()
            {
                Ok(relationships) => relationships,
                Err(error) => {
                    tracing::error!(%error, "relationship violates its response contract");
                    return (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        "Internal Server Error",
                    )
                        .into_response();
                }
            };
            Json(RelationshipListResponse {
                as_of,
                known_at,
                relationships,
            })
            .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "evidence relationship query failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Internal Server Error",
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode, Uri};
    use tower::ServiceExt;

    use crate::{router, ApiDoc};
    use thesis_db::Database;
    use utoipa::OpenApi;

    use super::{parse_datetime, parse_query};

    #[test]
    fn parses_offset_naive_and_date_only_python_datetime_inputs() {
        assert_eq!(
            parse_datetime("2026-09-23T12:34:56+02:30")
                .expect("offset datetime")
                .to_string(),
            "2026-09-23 10:04:56"
        );
        assert_eq!(
            parse_datetime("2026-09-23 12:34")
                .expect("naive minute datetime")
                .to_string(),
            "2026-09-23 12:34:00"
        );
        assert_eq!(
            parse_datetime("2026-09-23")
                .expect("date-only datetime")
                .to_string(),
            "2026-09-23 00:00:00"
        );
    }

    #[test]
    fn parses_filters_like_the_fastapi_route_and_leaves_missing_times_unset() {
        let uri: Uri =
            "/api/wiki/evidence/relationships?predicates=owns%2C%20%2Ccontrols&entity_id=entity-1"
                .parse()
                .expect("valid URI");
        let query = parse_query(&uri).expect("valid query");
        assert_eq!(
            query.predicates,
            Some(vec!["owns".into(), "controls".into()])
        );
        assert_eq!(query.entity_id.as_deref(), Some("entity-1"));
        assert!(query.as_of.is_none());
        assert!(query.known_at.is_none());
    }

    #[tokio::test]
    async fn invalid_query_values_return_fastapi_validation_status_before_db_access() {
        let database = Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")
            .expect("valid lazy PostgreSQL URL");
        let response = router(database)
            .oneshot(
                Request::get("/api/wiki/evidence/relationships?as_of=not-a-timestamp")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = to_bytes(response.into_body(), 16_384)
            .await
            .expect("response body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("JSON body");
        assert_eq!(
            body["detail"][0]["loc"],
            serde_json::json!(["query", "as_of"])
        );
        assert_eq!(body["detail"][0]["type"], "datetime_from_date_parsing");
    }

    #[test]
    fn openapi_relationship_route_matches_query_and_response_contract() {
        let spec: serde_json::Value =
            serde_json::from_str(&ApiDoc::openapi().to_json().expect("OpenAPI JSON"))
                .expect("valid OpenAPI JSON");
        let operation = &spec["paths"]["/api/wiki/evidence/relationships"]["get"];
        assert_eq!(
            operation["operationId"],
            "get_evidence_relationships_api_wiki_evidence_relationships_get"
        );
        assert!(operation["responses"]["200"].is_object());
        assert!(operation["responses"]["422"].is_object());
        let params = operation["parameters"]
            .as_array()
            .expect("query parameters");
        assert_eq!(params.len(), 4);
        for name in ["as_of", "known_at", "predicates", "entity_id"] {
            let parameter = params
                .iter()
                .find(|parameter| parameter["name"] == name)
                .expect("parameter present");
            assert_eq!(parameter["in"], "query");
            assert_eq!(parameter["required"], false);
        }
        assert_eq!(
            spec["components"]["schemas"]["RelationshipStatus"]["enum"],
            serde_json::json!(["accepted", "historical", "disputed", "retracted"])
        );
    }
}
