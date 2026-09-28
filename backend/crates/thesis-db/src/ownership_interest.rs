use std::error::Error;
use std::fmt;

use serde_json::{Map, Value};
use sqlx::types::Json;
use sqlx::{FromRow, PgPool};
use thesis_evidence::ownership::{InterestRange, InterestType, OwnershipEdge, OwnershipMathError};

const OWNERSHIP_EDGE_QUERY: &str = "SELECT id, subject_entity_id, object_entity_id, qualifiers \
    FROM accepted_relationships \
    WHERE predicate IN ('owns_equity_in', 'directly_owns') AND retracted_at IS NULL";

#[derive(Debug, FromRow)]
struct OwnershipRelationshipRow {
    id: String,
    subject_entity_id: String,
    object_entity_id: String,
    qualifiers: Json<Value>,
}

#[derive(Debug)]
pub enum OwnershipEdgeLoadError {
    Database(sqlx::Error),
    Math(OwnershipMathError),
}

impl fmt::Display for OwnershipEdgeLoadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "failed to load ownership edges: {error}"),
            Self::Math(error) => write!(formatter, "invalid ownership edge: {error}"),
        }
    }
}

impl Error for OwnershipEdgeLoadError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Math(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for OwnershipEdgeLoadError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl From<OwnershipMathError> for OwnershipEdgeLoadError {
    fn from(error: OwnershipMathError) -> Self {
        Self::Math(error)
    }
}

pub(super) async fn load_ownership_edges(
    pool: &PgPool,
) -> Result<Vec<OwnershipEdge>, OwnershipEdgeLoadError> {
    let rows = sqlx::query_as::<_, OwnershipRelationshipRow>(OWNERSHIP_EDGE_QUERY)
        .fetch_all(pool)
        .await?;

    rows.into_iter()
        .map(ownership_edge_from_row)
        .filter_map(|result| match result {
            Ok(Some(edge)) => Some(Ok(edge)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

fn ownership_edge_from_row(
    row: OwnershipRelationshipRow,
) -> Result<Option<OwnershipEdge>, OwnershipEdgeLoadError> {
    let Some(qualifiers) = row.qualifiers.0.as_object() else {
        return Ok(None);
    };
    let Some(interest) = interest_range(qualifiers)? else {
        return Ok(None);
    };
    let Some(interest_type) = interest_type(qualifiers) else {
        return Ok(None);
    };

    Ok(Some(OwnershipEdge {
        owner_id: row.object_entity_id,
        owned_id: row.subject_entity_id,
        interest,
        interest_type,
        security_class: string_qualifier(qualifiers, "security_class"),
        direct: qualifiers
            .get("direct")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        claim_id: Some(row.id),
        disjoint_group: string_qualifier(qualifiers, "disjoint_group"),
    }))
}

fn interest_type(qualifiers: &Map<String, Value>) -> Option<InterestType> {
    match qualifiers.get("interest") {
        None | Some(Value::Null) => Some(InterestType::Economic),
        Some(Value::String(value)) => InterestType::try_from(value.as_str()).ok(),
        Some(_) => None,
    }
}

fn string_qualifier(qualifiers: &Map<String, Value>, key: &str) -> Option<String> {
    qualifiers
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn interest_range(
    qualifiers: &Map<String, Value>,
) -> Result<Option<InterestRange>, OwnershipEdgeLoadError> {
    if let Some(point) = qualifiers.get("pct") {
        if !point.is_null() {
            let Some(point) = percentage_text(point) else {
                return Ok(None);
            };
            return parse_percentages(&point, &point);
        }
    }

    let Some(band) = qualifiers.get("pct_band") else {
        return Ok(None);
    };
    let Some((lower, upper)) = band_bounds(band) else {
        return Ok(None);
    };
    let (Some(lower), Some(upper)) = (percentage_text(lower), percentage_text(upper)) else {
        return Ok(None);
    };
    parse_percentages(&lower, &upper)
}

fn band_bounds(value: &Value) -> Option<(&Value, &Value)> {
    match value {
        Value::Object(values) => Some((values.get("lower")?, values.get("upper")?)),
        Value::Array(values) if values.len() == 2 => Some((&values[0], &values[1])),
        _ => None,
    }
}

fn percentage_text(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => Some(number.to_string()),
        Value::String(value) => Some(value.clone()),
        _ => None,
    }
}

fn parse_percentages(
    lower: &str,
    upper: &str,
) -> Result<Option<InterestRange>, OwnershipEdgeLoadError> {
    match InterestRange::from_percentages(lower, upper) {
        Ok(range) => Ok(Some(range)),
        Err(error) if is_out_of_domain(&error) => Err(error.into()),
        Err(_) => Ok(None),
    }
}

fn is_out_of_domain(error: &OwnershipMathError) -> bool {
    matches!(
        error,
        OwnershipMathError::NegativeOwnershipInterest
            | OwnershipMathError::InvertedOwnershipRange
            | OwnershipMathError::OwnershipInterestAboveOne
    )
}

#[cfg(test)]
mod tests {
    use super::{interest_range, interest_type};
    use serde_json::json;
    use thesis_evidence::ownership::{InterestRange, InterestType, OwnershipMathError};

    #[test]
    fn parses_points_before_bands() {
        let qualifiers = json!({"pct": "25", "pct_band": {"lower": 40, "upper": 50}});
        let range = interest_range(qualifiers.as_object().unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(range, InterestRange::from_percentages("25", "25").unwrap());
    }

    #[test]
    fn parses_object_and_array_bands() {
        for qualifiers in [
            json!({"pct_band": {"lower": "25", "upper": 50}}),
            json!({"pct_band": [25, "50"]}),
        ] {
            let range = interest_range(qualifiers.as_object().unwrap())
                .unwrap()
                .unwrap();
            assert_eq!(range, InterestRange::from_percentages("25", "50").unwrap());
        }
    }

    #[test]
    fn skips_malformed_and_unquantified_values() {
        for qualifiers in [
            json!({}),
            json!({"pct": "not-a-number", "pct_band": {"lower": 25, "upper": 50}}),
            json!({"pct_band": {"lower": 25}}),
            json!({"pct_band": [25, 50, 75]}),
        ] {
            assert!(interest_range(qualifiers.as_object().unwrap())
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn propagates_out_of_domain_values() {
        for (qualifiers, expected) in [
            (
                json!({"pct": -1}),
                OwnershipMathError::NegativeOwnershipInterest,
            ),
            (
                json!({"pct_band": {"lower": 75, "upper": 25}}),
                OwnershipMathError::InvertedOwnershipRange,
            ),
            (
                json!({"pct": 101}),
                OwnershipMathError::OwnershipInterestAboveOne,
            ),
        ] {
            let error = interest_range(qualifiers.as_object().unwrap()).unwrap_err();
            assert!(
                matches!(error, super::OwnershipEdgeLoadError::Math(actual) if actual == expected)
            );
        }
    }

    #[test]
    fn defaults_and_filters_interest_types() {
        assert_eq!(
            interest_type(json!({}).as_object().unwrap()),
            Some(InterestType::Economic)
        );
        assert_eq!(
            interest_type(json!({"interest": "voting"}).as_object().unwrap()),
            Some(InterestType::Voting)
        );
        assert_eq!(
            interest_type(json!({"interest": "other"}).as_object().unwrap()),
            None
        );
    }
}
