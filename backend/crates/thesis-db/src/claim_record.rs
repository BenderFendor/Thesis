use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::{types::Json, FromRow};

#[derive(Clone, Debug)]
pub struct ClaimRecord {
    pub id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: Option<String>,
    pub object_value: Option<Value>,
    pub qualifiers: Value,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
    pub date_precision: Option<String>,
    pub recorded_at: NaiveDateTime,
    pub retracted_at: Option<NaiveDateTime>,
    pub asserted_by: String,
    pub evidence_class: String,
    pub status: String,
    pub method_version: String,
    pub evidence: Vec<ClaimEvidenceRecord>,
}

#[derive(Clone, Debug)]
pub struct ClaimEvidenceRecord {
    pub id: String,
    pub snapshot_id: String,
    pub locator: Value,
    pub quoted_text: Option<String>,
    pub structured_value: Option<Value>,
    pub context_before: Option<String>,
    pub context_after: Option<String>,
    pub entailment: String,
    pub extractor: String,
    pub extractor_version: String,
    pub ocr_confidence: Option<f64>,
}

#[derive(Debug, FromRow)]
struct ClaimRow {
    id: String,
    subject_entity_id: String,
    predicate: String,
    object_entity_id: Option<String>,
    object_value: Option<Json<Value>>,
    qualifiers: Json<Value>,
    valid_from: Option<NaiveDateTime>,
    valid_to: Option<NaiveDateTime>,
    date_precision: Option<String>,
    recorded_at: NaiveDateTime,
    retracted_at: Option<NaiveDateTime>,
    asserted_by: String,
    evidence_class: String,
    status: String,
    method_version: String,
}

#[derive(Debug, FromRow)]
struct EvidenceRow {
    id: String,
    snapshot_id: String,
    locator: Json<Value>,
    quoted_text: Option<String>,
    structured_value: Option<Json<Value>>,
    context_before: Option<String>,
    context_after: Option<String>,
    entailment: String,
    extractor: String,
    extractor_version: String,
    ocr_confidence: Option<f64>,
}

impl ClaimRow {
    fn into_record(self, evidence: Vec<EvidenceRow>) -> ClaimRecord {
        ClaimRecord {
            id: self.id,
            subject_entity_id: self.subject_entity_id,
            predicate: self.predicate,
            object_entity_id: self.object_entity_id,
            object_value: self.object_value.map(|json| json.0),
            qualifiers: self.qualifiers.0,
            valid_from: self.valid_from,
            valid_to: self.valid_to,
            date_precision: self.date_precision,
            recorded_at: self.recorded_at,
            retracted_at: self.retracted_at,
            asserted_by: self.asserted_by,
            evidence_class: self.evidence_class,
            status: self.status,
            method_version: self.method_version,
            evidence: evidence.into_iter().map(EvidenceRow::into_record).collect(),
        }
    }
}

impl EvidenceRow {
    fn into_record(self) -> ClaimEvidenceRecord {
        ClaimEvidenceRecord {
            id: self.id,
            snapshot_id: self.snapshot_id,
            locator: self.locator.0,
            quoted_text: self.quoted_text,
            structured_value: self.structured_value.map(|json| json.0),
            context_before: self.context_before,
            context_after: self.context_after,
            entailment: self.entailment,
            extractor: self.extractor,
            extractor_version: self.extractor_version,
            ocr_confidence: self.ocr_confidence,
        }
    }
}

pub(super) async fn load_claim_record(
    pool: &sqlx::PgPool,
    claim_id: &str,
) -> Result<Option<ClaimRecord>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let claim = sqlx::query_as::<_, ClaimRow>(
        "SELECT id, subject_entity_id, predicate, object_entity_id, object_value, qualifiers, \
            valid_from, valid_to, date_precision, recorded_at, retracted_at, asserted_by, \
            evidence_class, status, method_version \
         FROM evidence_claims WHERE id = $1",
    )
    .bind(claim_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(claim) = claim else {
        transaction.commit().await?;
        return Ok(None);
    };

    let evidence = sqlx::query_as::<_, EvidenceRow>(
        "SELECT o.id, o.snapshot_id, o.locator, o.quoted_text, o.structured_value, \
            o.context_before, o.context_after, o.entailment, o.extractor, \
            o.extractor_version, o.ocr_confidence \
         FROM evidence_observations o \
         JOIN claim_evidence_links ce ON ce.observation_id = o.id \
         WHERE ce.claim_id = $1",
    )
    .bind(claim_id)
    .fetch_all(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok(Some(claim.into_record(evidence)))
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;
    use serde_json::json;
    use sqlx::types::Json;

    use super::{ClaimRow, EvidenceRow};

    #[test]
    fn record_mapping_preserves_json_shapes_and_naive_timestamps() {
        let recorded_at = NaiveDate::from_ymd_opt(2026, 7, 20)
            .expect("valid date")
            .and_hms_micro_opt(12, 30, 0, 123_000)
            .expect("valid time");
        let record = ClaimRow {
            id: "claim-1".into(),
            subject_entity_id: "subject-1".into(),
            predicate: "owns_equity_in".into(),
            object_entity_id: Some("object-1".into()),
            object_value: None,
            qualifiers: Json(json!({"interest": {"lower": 0.2, "upper": 0.3}})),
            valid_from: None,
            valid_to: None,
            date_precision: None,
            recorded_at,
            retracted_at: None,
            asserted_by: "reviewer".into(),
            evidence_class: "registry_filing".into(),
            status: "candidate".into(),
            method_version: "v1".into(),
        }
        .into_record(vec![EvidenceRow {
            id: "observation-1".into(),
            snapshot_id: "snapshot-1".into(),
            locator: Json(json!({"page": 3, "path": ["owners", 0]})),
            quoted_text: Some("20 percent".into()),
            structured_value: Some(Json(json!([{"lower": 0.2}]))),
            context_before: None,
            context_after: Some("continued".into()),
            entailment: "reviewed_yes".into(),
            extractor: "manual".into(),
            extractor_version: "1".into(),
            ocr_confidence: Some(0.98),
        }]);

        assert_eq!(
            record.qualifiers,
            json!({"interest": {"lower": 0.2, "upper": 0.3}})
        );
        assert_eq!(
            record.evidence[0].locator,
            json!({"page": 3, "path": ["owners", 0]})
        );
        assert_eq!(
            record.evidence[0].structured_value,
            Some(json!([{"lower": 0.2}]))
        );
        assert_eq!(record.recorded_at, recorded_at);
        assert_eq!(record.evidence[0].ocr_confidence, Some(0.98));
    }
}
