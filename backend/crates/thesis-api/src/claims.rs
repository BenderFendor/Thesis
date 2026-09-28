use crate::models::{HttpValidationError, ValidationError, ValidationLocation};
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use thesis_db::{ClaimEvidenceRecord, ClaimRecord, MaterializeClaimError};
use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder};
use utoipa::openapi::{RefOr, Schema};
use utoipa::{IntoParams, ToSchema};

fn json_object_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
        .into()
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum ClaimStatus {
    Candidate,
    Accepted,
    Disputed,
    Rejected,
    Superseded,
}

impl TryFrom<String> for ClaimStatus {
    type Error = &'static str;

    fn try_from(status: String) -> Result<Self, Self::Error> {
        match status.as_str() {
            "candidate" => Ok(Self::Candidate),
            "accepted" => Ok(Self::Accepted),
            "disputed" => Ok(Self::Disputed),
            "rejected" => Ok(Self::Rejected),
            "superseded" => Ok(Self::Superseded),
            _ => Err("unknown claim status"),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum EntailmentStatus {
    ReviewedYes,
    ReviewedNo,
    ModelSuggested,
    Unevaluated,
}

impl TryFrom<String> for EntailmentStatus {
    type Error = &'static str;

    fn try_from(status: String) -> Result<Self, Self::Error> {
        match status.as_str() {
            "reviewed_yes" => Ok(Self::ReviewedYes),
            "reviewed_no" => Ok(Self::ReviewedNo),
            "model_suggested" => Ok(Self::ModelSuggested),
            "unevaluated" => Ok(Self::Unevaluated),
            _ => Err("unknown evidence entailment"),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = EvidenceObservationRecord)]
pub(super) struct ObservationResponse {
    id: String,
    snapshot_id: String,
    #[schema(schema_with = json_object_schema)]
    locator: Value,
    quoted_text: Option<String>,
    structured_value: Option<Value>,
    context_before: Option<String>,
    context_after: Option<String>,
    entailment: EntailmentStatus,
    extractor: String,
    extractor_version: String,
    ocr_confidence: Option<f64>,
}

impl TryFrom<ClaimEvidenceRecord> for ObservationResponse {
    type Error = &'static str;

    fn try_from(record: ClaimEvidenceRecord) -> Result<Self, Self::Error> {
        Ok(Self {
            id: record.id,
            snapshot_id: record.snapshot_id,
            locator: record.locator,
            quoted_text: record.quoted_text,
            structured_value: record.structured_value,
            context_before: record.context_before,
            context_after: record.context_after,
            entailment: record.entailment.try_into()?,
            extractor: record.extractor,
            extractor_version: record.extractor_version,
            ocr_confidence: record.ocr_confidence,
        })
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[schema(as = EvidenceClaimRecord)]
pub(super) struct ClaimResponse {
    id: String,
    subject_entity_id: String,
    predicate: String,
    object_entity_id: Option<String>,
    object_value: Option<Value>,
    #[schema(required = false, schema_with = json_object_schema)]
    qualifiers: Value,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    date_precision: Option<String>,
    recorded_at: NaiveDateTime,
    retracted_at: Option<NaiveDateTime>,
    asserted_by: String,
    evidence_class: String,
    status: ClaimStatus,
    method_version: String,
    #[schema(required = false)]
    evidence: Vec<ObservationResponse>,
}

impl TryFrom<ClaimRecord> for ClaimResponse {
    type Error = &'static str;

    fn try_from(record: ClaimRecord) -> Result<Self, Self::Error> {
        let status = record.status.try_into()?;
        let evidence = record
            .evidence
            .into_iter()
            .map(ObservationResponse::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            id: record.id,
            subject_entity_id: record.subject_entity_id,
            predicate: record.predicate,
            object_entity_id: record.object_entity_id,
            object_value: record.object_value,
            qualifiers: record.qualifiers,
            valid_from: record.valid_from,
            valid_to: record.valid_to,
            date_precision: record.date_precision,
            recorded_at: record.recorded_at,
            retracted_at: record.retracted_at,
            asserted_by: record.asserted_by,
            evidence_class: record.evidence_class,
            status,
            method_version: record.method_version,
            evidence,
        })
    }
}

#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
struct MaterializeClaimQueryParameters {
    #[param(required = false, default = false)]
    complete_control_path: Option<bool>,
}

const MATERIALIZE_TOKEN_DISABLED: &str =
    "materialization is disabled: SCOOP_MATERIALIZE_TOKEN is not configured";
const MATERIALIZE_TOKEN_INVALID: &str = "missing or invalid materialize token";
const MATERIALIZE_REVIEWER_EMPTY: &str = "X-Scoop-Reviewer must not be empty";
const MATERIALIZE_RELATIONSHIP_RELOAD_FAILED: &str =
    "materialized relationship could not be reloaded";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MaterializeAuthorizationError {
    TokenNotConfigured,
    InvalidToken,
}

impl MaterializeAuthorizationError {
    fn status_and_detail(self) -> (StatusCode, &'static str) {
        match self {
            Self::TokenNotConfigured => {
                (StatusCode::SERVICE_UNAVAILABLE, MATERIALIZE_TOKEN_DISABLED)
            }
            Self::InvalidToken => (StatusCode::UNAUTHORIZED, MATERIALIZE_TOKEN_INVALID),
        }
    }

    fn into_response(self) -> Response {
        let (status, detail) = self.status_and_detail();
        (status, Json(json!({"detail": detail}))).into_response()
    }
}

fn authorize_materialization(
    configured_token: Option<&str>,
    supplied_token: Option<&str>,
) -> Result<(), MaterializeAuthorizationError> {
    let Some(configured_token) = configured_token.filter(|token| !token.is_empty()) else {
        return Err(MaterializeAuthorizationError::TokenNotConfigured);
    };
    if supplied_token != Some(configured_token) {
        return Err(MaterializeAuthorizationError::InvalidToken);
    }
    Ok(())
}

fn parse_complete_control_path(uri: &Uri) -> Result<bool, HttpValidationError> {
    let values = crate::wiki::query_values(uri)?;
    let Some(raw) = values.get("complete_control_path") else {
        return Ok(false);
    };
    if raw.eq_ignore_ascii_case("1")
        || raw.eq_ignore_ascii_case("true")
        || raw.eq_ignore_ascii_case("t")
        || raw.eq_ignore_ascii_case("yes")
        || raw.eq_ignore_ascii_case("y")
        || raw.eq_ignore_ascii_case("on")
    {
        return Ok(true);
    }
    if raw.eq_ignore_ascii_case("0")
        || raw.eq_ignore_ascii_case("false")
        || raw.eq_ignore_ascii_case("f")
        || raw.eq_ignore_ascii_case("no")
        || raw.eq_ignore_ascii_case("n")
        || raw.eq_ignore_ascii_case("off")
    {
        return Ok(false);
    }
    Err(HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("query".to_owned()),
                ValidationLocation::Text("complete_control_path".to_owned()),
            ],
            msg: "Input should be a valid boolean, unable to interpret input".to_owned(),
            error_type: "bool_parsing".to_owned(),
            input: Value::String(raw.clone()),
            ctx: None,
        }],
    })
}

fn reviewer_header_error(input: Value, error_type: &str, message: &str) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![
                ValidationLocation::Text("header".to_owned()),
                ValidationLocation::Text("X-Scoop-Reviewer".to_owned()),
            ],
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: None,
        }],
    }
}

fn reviewer_from_headers(headers: &HeaderMap) -> Result<&str, HttpValidationError> {
    let Some(value) = headers.get("X-Scoop-Reviewer") else {
        return Err(reviewer_header_error(
            Value::Null,
            "missing",
            "Field required",
        ));
    };
    value.to_str().map_err(|_| {
        reviewer_header_error(
            Value::String(String::from_utf8_lossy(value.as_bytes()).into_owned()),
            "string_unicode",
            "Input should be a valid string, unable to parse raw data as a unicode string",
        )
    })
}

fn blank_reviewer_response() -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(json!({"detail": MATERIALIZE_REVIEWER_EMPTY})),
    )
        .into_response()
}

fn validate_reviewer(reviewer: &str) -> Result<(), Response> {
    if reviewer.trim().is_empty() {
        Err(blank_reviewer_response())
    } else {
        Ok(())
    }
}

#[utoipa::path(
    post,
    path = "/api/wiki/evidence/claims/{claim_id}/materialize",
    operation_id = "materialize_evidence_claim_api_wiki_evidence_claims__claim_id__materialize_post",
    tag = "wiki-evidence",
    summary = "Materialize Evidence Claim",
    description = "Materialize a qualifying claim into an accepted relationship.\n\nRequires an operator secret (``X-Scoop-Materialize-Token``) and a non-empty\nreviewer identity (``X-Scoop-Reviewer``) — this endpoint mutates accepted\nresearch facts, so it cannot be left open to unauthenticated callers.",
    params(
        ("claim_id" = String, Path, description = "Evidence claim ID"),
        MaterializeClaimQueryParameters,
        ("X-Scoop-Reviewer" = String, Header, description = "Reviewer identity"),
        ("X-Scoop-Materialize-Token" = Option<String>, Header, description = "Operator secret")
    ),
    responses(
        (status = 200, description = "Successful Response", body = crate::relationships::RelationshipResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError)
    )
)]
pub(crate) async fn materialize_claim(
    State(state): State<AppState>,
    Path(claim_id): Path<String>,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let complete_control_path = match parse_complete_control_path(&uri) {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let reviewer = match reviewer_from_headers(&headers) {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };

    let configured_token = std::env::var("SCOOP_MATERIALIZE_TOKEN").ok();
    let supplied_token = headers
        .get("X-Scoop-Materialize-Token")
        .and_then(|value| value.to_str().ok());
    if let Err(error) = authorize_materialization(configured_token.as_deref(), supplied_token) {
        return error.into_response();
    }
    if let Err(response) = validate_reviewer(reviewer) {
        return response;
    }

    let materialized = match state
        .database
        .materialize_claim(&claim_id, reviewer, complete_control_path)
        .await
    {
        Ok(record) => record,
        Err(MaterializeClaimError::EvidenceSpine(detail)) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"detail": detail})),
            )
                .into_response();
        }
        Err(MaterializeClaimError::Database(error)) => {
            tracing::error!(%error, "evidence claim materialization failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    tracing::info!(
        claim_id = %claim_id,
        reviewer = %reviewer,
        relationship_id = %materialized.id,
        "materialized evidence claim"
    );

    let now = Utc::now().naive_utc();
    let relationships = match state
        .database
        .list_relationships(now, now, None, Some(materialized.subject_entity_id.clone()))
        .await
    {
        Ok(records) => records,
        Err(error) => {
            tracing::error!(%error, "materialized relationship reload failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };
    let Some(relationship) = relationships
        .into_iter()
        .find(|record| record.id == materialized.id)
    else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"detail": MATERIALIZE_RELATIONSHIP_RELOAD_FAILED})),
        )
            .into_response();
    };

    match crate::relationships::RelationshipResponse::try_from(relationship) {
        Ok(response) => Json(response).into_response(),
        Err(error) => {
            tracing::error!(%error, "materialized relationship violates its response contract");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/wiki/evidence/claims/{claim_id}",
    operation_id = "get_evidence_claim_api_wiki_evidence_claims__claim_id__get",
    params(("claim_id" = String, Path, description = "Evidence claim ID")),
    responses(
        (status = 200, description = "Successful Response", body = ClaimResponse),
        (status = 422, description = "Validation Error", body = crate::models::HttpValidationError)
    )
)]
pub(crate) async fn get_claim(
    State(state): State<AppState>,
    Path(claim_id): Path<String>,
) -> Response {
    match state.database.load_claim_record(&claim_id).await {
        Ok(Some(record)) => match ClaimResponse::try_from(record) {
            Ok(response) => Json(response).into_response(),
            Err(error) => {
                tracing::error!(%error, "evidence claim violates its response contract");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
            }
        },
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"detail": "Evidence claim not found"})),
        )
            .into_response(),
        Err(error) => {
            tracing::error!(%error, "evidence claim query failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_materialization, blank_reviewer_response, parse_complete_control_path,
        reviewer_from_headers, validate_reviewer, ClaimStatus, EntailmentStatus,
        MaterializeAuthorizationError,
    };
    use axum::body::to_bytes;
    use axum::http::{HeaderMap, StatusCode, Uri};
    use axum::response::Response;
    use serde_json::{json, Value};

    async fn response_json(response: Response) -> Value {
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        serde_json::from_slice(&body).expect("JSON response")
    }

    #[test]
    fn claim_status_matches_all_api_literal_values() {
        for value in [
            "candidate",
            "accepted",
            "disputed",
            "rejected",
            "superseded",
        ] {
            let status = ClaimStatus::try_from(value.to_owned()).expect("valid claim status");
            assert_eq!(
                serde_json::to_string(&status).expect("serialized status"),
                format!("\"{value}\"")
            );
        }
        assert!(ClaimStatus::try_from("unknown".to_owned()).is_err());
    }

    #[test]
    fn entailment_matches_all_api_literal_values() {
        for value in [
            "reviewed_yes",
            "reviewed_no",
            "model_suggested",
            "unevaluated",
        ] {
            let entailment =
                EntailmentStatus::try_from(value.to_owned()).expect("valid entailment");
            assert_eq!(
                serde_json::to_string(&entailment).expect("serialized entailment"),
                format!("\"{value}\"")
            );
        }
        assert!(EntailmentStatus::try_from("unknown".to_owned()).is_err());
    }
    #[test]
    fn complete_control_path_matches_fastapi_boolean_values_and_default() {
        assert!(!parse_complete_control_path(&Uri::from_static("/")).expect("default"));
        for (raw, expected) in [
            ("1", true),
            ("true", true),
            ("t", true),
            ("TRUE", true),
            ("yes", true),
            ("y", true),
            ("on", true),
            ("0", false),
            ("false", false),
            ("f", false),
            ("no", false),
            ("False", false),
            ("n", false),
            ("off", false),
        ] {
            let uri = format!("/?complete_control_path={raw}")
                .parse()
                .expect("valid URI");
            assert_eq!(
                parse_complete_control_path(&uri).expect("boolean"),
                expected
            );
        }

        let uri = Uri::from_static("/?complete_control_path=not-a-bool");
        let error = parse_complete_control_path(&uri).expect_err("invalid boolean");
        assert_eq!(
            serde_json::to_value(&error.detail[0].loc).expect("validation location"),
            json!(["query", "complete_control_path"])
        );
        assert_eq!(error.detail[0].error_type, "bool_parsing");
        assert_eq!(
            error.detail[0].msg,
            "Input should be a valid boolean, unable to interpret input"
        );
        assert_eq!(error.detail[0].input, json!("not-a-bool"));
        for raw in ["%20true", "true%20", "%20true%20"] {
            let uri = format!("/?complete_control_path={raw}")
                .parse()
                .expect("valid URI");
            let error = parse_complete_control_path(&uri).expect_err("whitespace is invalid");
            assert_eq!(error.detail[0].error_type, "bool_parsing");
            assert_eq!(error.detail[0].input, json!(raw.replace("%20", " ")));
        }
    }

    #[tokio::test]
    async fn materialize_token_auth_matches_fastapi_statuses_and_details() {
        for (configured, supplied, expected) in [
            (
                None,
                None,
                MaterializeAuthorizationError::TokenNotConfigured,
            ),
            (
                None,
                Some("secret"),
                MaterializeAuthorizationError::TokenNotConfigured,
            ),
            (
                Some(""),
                Some("secret"),
                MaterializeAuthorizationError::TokenNotConfigured,
            ),
            (
                Some("secret"),
                None,
                MaterializeAuthorizationError::InvalidToken,
            ),
            (
                Some("secret"),
                Some("wrong"),
                MaterializeAuthorizationError::InvalidToken,
            ),
        ] {
            let error =
                authorize_materialization(configured, supplied).expect_err("authorization error");
            assert_eq!(error, expected);
            let (status, detail) = error.status_and_detail();
            let response = error.into_response();
            assert_eq!(response.status(), status);
            assert_eq!(response_json(response).await, json!({"detail": detail}));
        }

        assert!(authorize_materialization(Some("secret"), Some("secret")).is_ok());
    }

    #[tokio::test]
    async fn reviewer_header_and_blank_value_match_fastapi_validation() {
        let error = reviewer_from_headers(&HeaderMap::new()).expect_err("required header");
        assert_eq!(
            serde_json::to_value(&error.detail[0].loc).expect("validation location"),
            json!(["header", "X-Scoop-Reviewer"])
        );
        assert_eq!(error.detail[0].error_type, "missing");
        assert_eq!(error.detail[0].msg, "Field required");
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body = response_json(response).await;
        assert_eq!(
            body["detail"][0]["loc"],
            json!(["header", "X-Scoop-Reviewer"])
        );
        assert_eq!(body["detail"][0]["type"], "missing");

        let response = validate_reviewer(" \t").expect_err("blank reviewer");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response_json(response).await,
            json!({"detail": "X-Scoop-Reviewer must not be empty"})
        );
        assert!(validate_reviewer(" reviewer ").is_ok());
        assert_eq!(
            blank_reviewer_response().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
