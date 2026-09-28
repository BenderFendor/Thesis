use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

use crate::{empty_json_array, Database};

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceMetadataRecord {
    pub source_name: String,
    pub parent_company: Option<String>,
    pub credibility_score: Option<f64>,
    pub is_state_media: Option<bool>,
    pub source_type: Option<String>,
    pub geographic_focus: Option<Vec<String>>,
    pub topic_focus: Option<Vec<String>>,
    pub is_paywalled: Option<bool>,
    pub research_sources: Option<Json<Value>>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceAnalysisScoreRecord {
    pub source_name: String,
    pub axis_name: String,
    pub score: i32,
    pub confidence: Option<String>,
    pub prose_explanation: Option<String>,
    pub citations: Option<Json<Value>>,
    pub empirical_basis: Option<String>,
    pub scored_by: Option<String>,
    pub last_scored_at: Option<chrono::NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiIndexStatusRecord {
    pub entity_type: String,
    pub entity_name: String,
    pub status: Option<String>,
    pub last_indexed_at: Option<chrono::NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceCredibilityRecord {
    pub domain: String,
    pub credibility_score: f64,
    pub source_type: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug)]
pub struct WikiArticleBehaviorStats {
    pub article_count: i64,
    pub top_categories: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct WikiUnresolvedAuthorArticle {
    pub article_id: i64,
    pub title: String,
    pub url: String,
    pub published_at: chrono::NaiveDateTime,
    pub category: Option<String>,
    pub author_url_raw: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WikiUnresolvedAuthorCandidate {
    pub author_name: String,
    pub normalized_name: String,
    pub source_name: Option<String>,
    pub articles: Vec<WikiUnresolvedAuthorArticle>,
}

#[derive(Clone, Debug)]
pub struct WikiReporterCardRecord {
    pub id: i64,
    pub name: String,
    pub normalized_name: Option<String>,
    pub bio: Option<String>,
    pub topics: Option<Vec<String>>,
    pub political_leaning: Option<String>,
    pub leaning_confidence: Option<String>,
    pub article_count: Option<i32>,
    pub wikipedia_url: Option<String>,
    pub canonical_name: Option<String>,
    pub match_status: Option<String>,
    pub research_confidence: Option<String>,
}
#[derive(Clone, Debug, FromRow)]
pub struct WikiReporterDossierRecord {
    pub id: i64,
    pub name: String,
    pub normalized_name: Option<String>,
    pub bio: Option<String>,
    pub career_history: Option<Json<Value>>,
    pub topics: Option<Vec<String>>,
    pub education: Option<Json<Value>>,
    pub political_leaning: Option<String>,
    pub leaning_confidence: Option<String>,
    pub leaning_sources: Option<Json<Value>>,
    pub twitter_handle: Option<String>,
    pub linkedin_url: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_qid: Option<String>,
    pub wikidata_url: Option<String>,
    pub canonical_name: Option<String>,
    pub match_status: Option<String>,
    pub overview: Option<String>,
    pub dossier_sections: Option<Json<Value>>,
    pub citations: Option<Json<Value>>,
    pub search_links: Option<Json<Value>>,
    pub match_explanation: Option<String>,
    pub source_patterns: Option<Json<Value>>,
    pub topics_avoided: Option<Json<Value>>,
    pub advertiser_alignment: Option<Json<Value>>,
    pub revolving_door: Option<Json<Value>>,
    pub controversies: Option<Json<Value>>,
    pub institutional_affiliations: Option<Json<Value>>,
    pub coverage_comparison: Option<Json<Value>>,
    pub article_count: Option<i32>,
    pub last_article_at: Option<chrono::NaiveDateTime>,
    pub research_sources: Option<Json<Value>>,
    pub research_confidence: Option<String>,
}

#[derive(Debug, FromRow)]
struct WikiReporterCardRow {
    id: i64,
    name: String,
    normalized_name: Option<String>,
    bio: Option<String>,
    topics: Option<Vec<String>>,
    political_leaning: Option<String>,
    leaning_confidence: Option<String>,
    article_count: Option<i32>,
    wikipedia_url: Option<String>,
    canonical_name: Option<String>,
    match_status: Option<String>,
    research_confidence: Option<String>,
}

impl From<WikiReporterCardRow> for WikiReporterCardRecord {
    fn from(row: WikiReporterCardRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            normalized_name: row.normalized_name,
            bio: row.bio,
            topics: row.topics,
            political_leaning: row.political_leaning,
            leaning_confidence: row.leaning_confidence,
            article_count: row.article_count,
            wikipedia_url: row.wikipedia_url,
            canonical_name: row.canonical_name,
            match_status: row.match_status,
            research_confidence: row.research_confidence,
        }
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiReporterArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub published_at: chrono::NaiveDateTime,
    pub url: String,
    pub category: Option<String>,
    pub image_url: Option<String>,
}
#[derive(Clone, Debug)]
pub struct WikiReporterDossierData {
    pub reporter: WikiReporterDossierRecord,
    pub recent_articles: Vec<WikiReporterArticleRecord>,
}

#[derive(Debug, FromRow)]
pub struct WikiOrganizationRecord {
    pub id: i64,
    pub name: String,
    pub org_type: Option<String>,
    pub funding_type: Option<String>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
    pub parent_org_id: Option<i64>,
    pub wikipedia_url: Option<String>,
    pub research_confidence: Option<String>,
}

impl Database {
    pub async fn wiki_source_metadata(&self) -> Result<Vec<WikiSourceMetadataRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiSourceMetadataRecord>(
            "SELECT source_name, parent_company, credibility_score, is_state_media, source_type, \
                geographic_focus, topic_focus, is_paywalled, research_sources \
             FROM source_metadata",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn wiki_source_analysis_scores(
        &self,
    ) -> Result<Vec<WikiSourceAnalysisScoreRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiSourceAnalysisScoreRecord>(
            "SELECT source_name, axis_name, score, confidence, prose_explanation, citations, \
                empirical_basis, scored_by, last_scored_at \
             FROM source_analysis_scores",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn wiki_index_entries(
        &self,
        entity_type: Option<&str>,
    ) -> Result<Vec<WikiIndexStatusRecord>, sqlx::Error> {
        match entity_type {
            Some(entity_type) => {
                sqlx::query_as::<_, WikiIndexStatusRecord>(
                    "SELECT entity_type, entity_name, status, last_indexed_at \
                     FROM wiki_index_status WHERE entity_type = $1",
                )
                .bind(entity_type)
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, WikiIndexStatusRecord>(
                    "SELECT entity_type, entity_name, status, last_indexed_at \
                     FROM wiki_index_status",
                )
                .fetch_all(&self.pool)
                .await
            }
        }
    }

    pub async fn wiki_source_reporters(
        &self,
        source_name: &str,
        limit: i64,
    ) -> Result<Vec<WikiReporterCardRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiReporterCardRow>(
            "SELECT r.id, r.name, r.normalized_name, r.bio, r.topics, r.political_leaning, \
                r.leaning_confidence, r.article_count, r.wikipedia_url, r.canonical_name, \
                r.match_status, r.research_confidence \
             FROM reporters r \
             WHERE r.id IN ( \
                 SELECT DISTINCT aa.reporter_id \
                 FROM article_authors aa \
                 JOIN articles a ON a.id = aa.article_id \
                 WHERE a.source = $1 \
             ) AND r.retirement_reason IS NULL \
             ORDER BY r.name, r.id LIMIT $2",
        )
        .bind(source_name)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
    }

    pub async fn wiki_reporters(
        &self,
        search: Option<&str>,
        source: Option<&str>,
        leaning: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WikiReporterCardRecord>, sqlx::Error> {
        let mut query = QueryBuilder::<Postgres>::new(
            "SELECT r.id, r.name, r.normalized_name, r.bio, r.topics, r.political_leaning, \
                r.leaning_confidence, r.article_count, r.wikipedia_url, r.canonical_name, \
                r.match_status, r.research_confidence \
             FROM reporters r WHERE r.retirement_reason IS NULL",
        );
        if let Some(search) = search.filter(|value| !value.is_empty()) {
            query
                .push(" AND r.name ILIKE ")
                .push_bind(format!("%{search}%"));
        }
        if let Some(source) = source.filter(|value| !value.is_empty()) {
            let escaped_source = source
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            query
                .push(
                    " AND (r.id IN ( \
                    SELECT DISTINCT aa.reporter_id \
                    FROM article_authors aa \
                    JOIN articles a ON a.id = aa.article_id \
                    WHERE a.source = ",
                )
                .push_bind(source)
                .push(" ) OR CAST(r.career_history AS TEXT) ILIKE ")
                .push_bind(format!("%{escaped_source}%"))
                .push(" ESCAPE E'\\\\')");
        }
        if let Some(leaning) = leaning.filter(|value| !value.is_empty()) {
            query.push(" AND r.political_leaning = ").push_bind(leaning);
        }
        query
            .push(" ORDER BY r.name LIMIT ")
            .push_bind(limit)
            .push(" OFFSET ")
            .push_bind(offset);

        query
            .build_query_as::<WikiReporterCardRow>()
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(Into::into).collect())
    }

    pub async fn wiki_reporter_articles(
        &self,
        reporter_id: i64,
        limit: i64,
        offset: i64,
    ) -> Result<Option<Vec<WikiReporterArticleRecord>>, sqlx::Error> {
        let Some(reporter_id) = self.resolve_reporter_id(reporter_id).await? else {
            return Ok(None);
        };
        let articles = sqlx::query_as::<_, WikiReporterArticleRecord>(
            "SELECT a.id, a.title, a.source, a.published_at, a.url, a.category, a.image_url \
             FROM articles a \
             JOIN article_authors aa ON aa.article_id = a.id \
             WHERE aa.reporter_id = $1 \
             ORDER BY a.published_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(reporter_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(articles))
    }

    pub async fn wiki_reporter_dossier(
        &self,
        reporter_id: i64,
    ) -> Result<Option<WikiReporterDossierData>, sqlx::Error> {
        let Some(reporter_id) = self.resolve_reporter_id(reporter_id).await? else {
            return Ok(None);
        };
        let Some(reporter) = sqlx::query_as::<_, WikiReporterDossierRecord>(
            "SELECT id, name, normalized_name, bio, career_history, topics, education, \
                political_leaning, leaning_confidence, leaning_sources, twitter_handle, \
                linkedin_url, wikipedia_url, wikidata_qid, wikidata_url, canonical_name, \
                match_status, overview, dossier_sections, citations, search_links, \
                match_explanation, source_patterns, topics_avoided, advertiser_alignment, \
                revolving_door, controversies, institutional_affiliations, \
                coverage_comparison, article_count, last_article_at, research_sources, \
                research_confidence \
             FROM reporters WHERE id = $1",
        )
        .bind(reporter_id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let recent_articles = sqlx::query_as::<_, WikiReporterArticleRecord>(
            "SELECT a.id, a.title, a.source, a.published_at, a.url, a.category, a.image_url \
             FROM articles a \
             JOIN article_authors aa ON aa.article_id = a.id \
             WHERE aa.reporter_id = $1 \
             ORDER BY a.published_at DESC LIMIT 20",
        )
        .bind(reporter_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(Some(WikiReporterDossierData {
            reporter,
            recent_articles,
        }))
    }

    async fn resolve_reporter_id(&self, reporter_id: i64) -> Result<Option<i64>, sqlx::Error> {
        let Some(mut reporter) = sqlx::query_as::<_, ReporterMergeRow>(
            "SELECT id, merged_into, retirement_reason FROM reporters WHERE id = $1",
        )
        .bind(reporter_id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let mut seen_ids = std::collections::BTreeSet::from([reporter.id]);
        while reporter.retirement_reason.as_deref() == Some("merged") {
            let Some(next_id) = reporter.merged_into else {
                break;
            };
            let Some(next) = sqlx::query_as::<_, ReporterMergeRow>(
                "SELECT id, merged_into, retirement_reason FROM reporters WHERE id = $1",
            )
            .bind(next_id)
            .fetch_optional(&self.pool)
            .await?
            else {
                break;
            };
            let Some(next) = accept_reporter_merge_target(next, &mut seen_ids) else {
                break;
            };
            reporter = next;
        }
        Ok(Some(reporter.id))
    }

    pub async fn wiki_organizations(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WikiOrganizationRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiOrganizationRecord>(
            "SELECT id, name, org_type, funding_type, media_bias_rating, factual_reporting, \
                parent_org_id, wikipedia_url, research_confidence \
             FROM organizations ORDER BY name LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }
}

#[derive(Debug, FromRow)]
struct ReporterMergeRow {
    id: i64,
    merged_into: Option<i64>,
    retirement_reason: Option<String>,
}

fn accept_reporter_merge_target(
    target: ReporterMergeRow,
    seen_ids: &mut std::collections::BTreeSet<i64>,
) -> Option<ReporterMergeRow> {
    seen_ids.insert(target.id).then_some(target)
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiIngestRunRecord {
    pub id: String,
    pub adapter: String,
    pub adapter_version: String,
    pub scope: Json<Value>,
    pub started_at: chrono::NaiveDateTime,
    pub completed_at: Option<chrono::NaiveDateTime>,
    pub status: String,
    pub network_mode: String,
    pub documents_count: i32,
    pub snapshots_count: i32,
    pub observations_count: i32,
    pub claims_count: i32,
    pub accepted_count: i32,
    pub candidate_count: i32,
    pub failure: Option<String>,
    pub retryable: bool,
    pub missing_credentials: Json<Value>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiFundingPreregistration {
    pub id: String,
    pub title: String,
    pub locked_at: chrono::NaiveDateTime,
    pub specification: Json<Value>,
    pub deviations: Json<Value>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiFundingBiasTrace {
    pub id: String,
    pub algorithm_version: String,
    pub subgraph: Json<Value>,
    pub result: Json<Value>,
    pub created_at: chrono::NaiveDateTime,
}

#[derive(Clone, Debug)]
pub struct WikiFundingBiasData {
    pub preregistration: WikiFundingPreregistration,
    pub trace: WikiFundingBiasTrace,
}

/// One catalog outlet supplied to the funding/bias population loader.
#[derive(Clone, Debug)]
pub struct FundingBiasCatalogOutlet {
    pub name: String,
    pub outlet_id: String,
    pub catalog_funding_type: Option<String>,
    pub catalog_bias_rating: Option<String>,
}

/// A catalog outlet with both funding and bias values resolved from claims,
/// legacy metadata, or the RSS catalog, in that precedence order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FundingBiasSample {
    pub name: String,
    pub funding_type: String,
    pub bias_rating: String,
    pub claim_ids: Vec<String>,
}

#[derive(Clone, Debug, FromRow)]
struct FundingBiasMetadataRow {
    source_name: String,
    funding_type: Option<String>,
    political_bias: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct FundingBiasExternalIdRow {
    value: String,
    entity_id: String,
}

#[derive(Clone, Debug, FromRow)]
struct FundingBiasClaimRow {
    id: String,
    subject_entity_id: String,
    predicate: String,
    object_value: Option<Json<Value>>,
    recorded_at: chrono::NaiveDateTime,
}

fn funding_bias_claim_text(value: Option<&Json<Value>>) -> Option<String> {
    let object = value?.0.as_object()?;
    ["rating", "funding_type", "value"]
        .iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_owned)
}

fn resolve_funding_bias_attribute(
    claim: Option<&FundingBiasClaimRow>,
    legacy_value: Option<&str>,
    catalog_value: Option<&str>,
) -> (Option<String>, Option<String>) {
    if let Some(claim) = claim {
        if let Some(value) = funding_bias_claim_text(claim.object_value.as_ref()) {
            return (Some(value), Some(claim.id.clone()));
        }
    }
    let legacy_value = legacy_value.filter(|value| !value.is_empty());
    let fallback = legacy_value.or(catalog_value).unwrap_or_default().trim();
    ((!fallback.is_empty()).then(|| fallback.to_owned()), None)
}

#[cfg(test)]
mod funding_bias_resolution_tests {
    use super::{resolve_funding_bias_attribute, FundingBiasClaimRow};
    use chrono::NaiveDateTime;
    use serde_json::json;
    use sqlx::types::Json;

    #[test]
    fn accepted_claim_precedes_legacy_and_catalog_values() {
        let claim = FundingBiasClaimRow {
            id: "claim-1".to_owned(),
            subject_entity_id: "outlet-1".to_owned(),
            predicate: "funding_type".to_owned(),
            object_value: Some(Json(json!({"rating": " Public ", "value": "Ignored"}))),
            recorded_at: NaiveDateTime::MIN,
        };
        assert_eq!(
            resolve_funding_bias_attribute(Some(&claim), Some("Legacy"), Some("Catalog")),
            (Some("Public".to_owned()), Some("claim-1".to_owned()))
        );
    }

    #[test]
    fn legacy_precedes_catalog_and_whitespace_is_not_imputed() {
        assert_eq!(
            resolve_funding_bias_attribute(None, Some(" Legacy "), Some("Catalog")),
            (Some("Legacy".to_owned()), None)
        );
        assert_eq!(
            resolve_funding_bias_attribute(None, Some("  "), Some("Catalog")),
            (None, None)
        );
        assert_eq!(
            resolve_funding_bias_attribute(None, None, Some(" Catalog ")),
            (Some("Catalog".to_owned()), None)
        );
    }

    #[test]
    fn empty_legacy_value_falls_back_to_catalog_value() {
        // Matches Python's `(legacy_value or catalog_value or "")`: an empty
        // string is falsy there, so it must fall through to catalog_value
        // rather than being treated as a present-but-blank legacy value.
        assert_eq!(
            resolve_funding_bias_attribute(None, Some(""), Some("Catalog")),
            (Some("Catalog".to_owned()), None)
        );
    }
}

impl Database {
    pub async fn wiki_ingest_runs(
        &self,
        limit: i64,
    ) -> Result<Vec<WikiIngestRunRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiIngestRunRecord>(
            "SELECT id, adapter, adapter_version, scope, started_at, completed_at, status, \
                network_mode, documents_count, snapshots_count, observations_count, claims_count, \
                accepted_count, candidate_count, failure, retryable, missing_credentials \
             FROM evidence_ingest_runs ORDER BY started_at DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn wiki_funding_bias_data(&self) -> Result<Option<WikiFundingBiasData>, sqlx::Error> {
        let Some(trace) = sqlx::query_as::<_, WikiFundingBiasTrace>(
            "SELECT id, algorithm_version, subgraph, result, created_at \
             FROM calculation_traces WHERE measurement_name = $1 \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind("funding_bias_association")
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let preregistration_id = trace
            .subgraph
            .0
            .get("preregistration_id")
            .and_then(Value::as_str)
            .unwrap_or("prereg_funding_bias_methodology_v1");
        let Some(preregistration) = sqlx::query_as::<_, WikiFundingPreregistration>(
            "SELECT id, title, locked_at, specification, deviations \
             FROM preregistrations WHERE id = $1",
        )
        .bind(preregistration_id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        Ok(Some(WikiFundingBiasData {
            preregistration,
            trace,
        }))
    }

    /// Resolve the current catalog population using accepted evidence claims,
    /// then legacy metadata, then the catalog fallback.
    pub async fn funding_bias_population(
        &self,
        catalog: &[FundingBiasCatalogOutlet],
    ) -> Result<Vec<FundingBiasSample>, sqlx::Error> {
        if catalog.is_empty() {
            return Ok(Vec::new());
        }
        let source_names = catalog
            .iter()
            .map(|outlet| outlet.name.clone())
            .collect::<Vec<_>>();
        let metadata_rows = sqlx::query_as::<_, FundingBiasMetadataRow>(
            "SELECT source_name, funding_type, political_bias FROM source_metadata \
             WHERE source_name = ANY($1)",
        )
        .bind(&source_names)
        .fetch_all(&self.pool)
        .await?;
        let metadata = metadata_rows
            .into_iter()
            .map(|row| (row.source_name.clone(), row))
            .collect::<HashMap<_, _>>();

        let outlet_ids = catalog
            .iter()
            .map(|outlet| outlet.outlet_id.clone())
            .collect::<Vec<_>>();
        let external_ids = sqlx::query_as::<_, FundingBiasExternalIdRow>(
            "SELECT value, entity_id FROM entity_external_ids \
             WHERE scheme = 'rss_catalog_key' AND value = ANY($1)",
        )
        .bind(&outlet_ids)
        .fetch_all(&self.pool)
        .await?;
        let entity_ids_by_outlet = external_ids
            .into_iter()
            .map(|row| (row.value, row.entity_id))
            .collect::<HashMap<_, _>>();

        let subject_ids = entity_ids_by_outlet
            .values()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let claim_rows = if subject_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query_as::<_, FundingBiasClaimRow>(
                "SELECT id, subject_entity_id, predicate, object_value, recorded_at \
                 FROM evidence_claims WHERE subject_entity_id = ANY($1) \
                   AND predicate IN ('funding_type', 'bias_rating') \
                   AND status = 'accepted' AND retracted_at IS NULL \
                 ORDER BY recorded_at, id",
            )
            .bind(&subject_ids)
            .fetch_all(&self.pool)
            .await?
        };
        let mut latest_claims = HashMap::<(String, String), FundingBiasClaimRow>::new();
        for claim in claim_rows {
            let key = (claim.subject_entity_id.clone(), claim.predicate.clone());
            let replace = latest_claims
                .get(&key)
                .is_none_or(|current| claim.recorded_at > current.recorded_at);
            if replace {
                latest_claims.insert(key, claim);
            }
        }

        let mut samples = Vec::new();
        for outlet in catalog {
            let metadata = metadata.get(&outlet.name);
            let entity_id = entity_ids_by_outlet.get(&outlet.outlet_id);
            let funding_claim = entity_id
                .and_then(|id| latest_claims.get(&(id.clone(), "funding_type".to_owned())));
            let bias_claim =
                entity_id.and_then(|id| latest_claims.get(&(id.clone(), "bias_rating".to_owned())));
            let (funding_type, funding_claim_id) = resolve_funding_bias_attribute(
                funding_claim,
                metadata.and_then(|row| row.funding_type.as_deref()),
                outlet.catalog_funding_type.as_deref(),
            );
            let (bias_rating, bias_claim_id) = resolve_funding_bias_attribute(
                bias_claim,
                metadata.and_then(|row| row.political_bias.as_deref()),
                outlet.catalog_bias_rating.as_deref(),
            );
            let (Some(funding_type), Some(bias_rating)) = (funding_type, bias_rating) else {
                continue;
            };
            let claim_ids = [funding_claim_id, bias_claim_id]
                .into_iter()
                .flatten()
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            samples.push(FundingBiasSample {
                name: outlet.name.clone(),
                funding_type,
                bias_rating,
                claim_ids,
            });
        }
        Ok(samples)
    }

    /// Lock a methodology once. An existing preregistration is returned
    /// unchanged so repeated runs cannot rewrite it after seeing the data.
    pub async fn ensure_funding_bias_preregistration(
        &self,
        id: &str,
        title: &str,
        canonical_hash: &str,
        specification: Value,
    ) -> Result<WikiFundingPreregistration, sqlx::Error> {
        let now = chrono::Utc::now().naive_utc();
        sqlx::query(
            "INSERT INTO preregistrations \
             (id, title, canonical_hash, external_service, external_identifier, doi, \
              deposited_at, locked_at, specification, deviations, created_at) \
             VALUES ($1, $2, $3, 'internal', $1, NULL, $4, $4, $5, $6, $4) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(title)
        .bind(canonical_hash)
        .bind(now)
        .bind(Json(specification))
        .bind(Json(serde_json::json!([])))
        .execute(&self.pool)
        .await?;
        sqlx::query_as::<_, WikiFundingPreregistration>(
            "SELECT id, title, locked_at, specification, deviations \
             FROM preregistrations WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceReporterSummaryRecord {
    pub id: i64,
    pub name: String,
    pub topics: Option<Vec<String>>,
    pub political_leaning: Option<String>,
    pub article_count: Option<i32>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceOrganizationRecord {
    pub id: i64,
    pub name: String,
    pub org_type: Option<String>,
    pub funding_type: Option<String>,
    pub funding_sources: Option<Json<Value>>,
    pub major_advertisers: Option<Json<Value>>,
    pub ein: Option<String>,
    pub annual_revenue: Option<String>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
    pub wikipedia_url: Option<String>,
    pub research_confidence: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceClaimRecord {
    pub id: i64,
    pub claim_type: String,
    pub claim_kind: String,
    pub claim_value: Json<Value>,
    pub confidence: Option<f64>,
    pub parser_version: String,
    pub valid_from: Option<chrono::NaiveDateTime>,
    pub valid_to: Option<chrono::NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceClaimEvidenceRecord {
    pub source_type: String,
    pub source_name: Option<String>,
    pub source_url: String,
    pub retrieved_at: chrono::NaiveDateTime,
    pub raw_excerpt: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WikiSourceClaimWithEvidence {
    pub claim: WikiSourceClaimRecord,
    pub evidence: Vec<WikiSourceClaimEvidenceRecord>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceLedgerArticleRecord {
    pub author: Option<String>,
    pub authors: Option<Vec<String>>,
    pub paywall_status: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceLedgerRelationCount {
    pub relation: String,
    pub count: i64,
}

#[derive(Clone, Debug)]
pub struct WikiSourceLedgerData {
    pub articles: Vec<WikiSourceLedgerArticleRecord>,
    pub correction_count: i64,
    pub original_count: i64,
    pub relation_counts: Vec<WikiSourceLedgerRelationCount>,
}

impl Database {
    pub async fn wiki_source_article_count(
        &self,
        source_names: &[String],
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*)::BIGINT FROM articles WHERE source = ANY($1)")
            .bind(source_names.to_vec())
            .fetch_one(&self.pool)
            .await
    }

    pub async fn wiki_source_reporter_summaries(
        &self,
        source_names: &[String],
        limit: i64,
    ) -> Result<Vec<WikiSourceReporterSummaryRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiSourceReporterSummaryRecord>(
            "SELECT DISTINCT r.id, r.name, r.topics, r.political_leaning, r.article_count \
             FROM reporters r \
             JOIN article_authors aa ON aa.reporter_id = r.id \
             JOIN articles a ON a.id = aa.article_id \
             WHERE a.source = ANY($1) AND r.retirement_reason IS NULL \
             LIMIT $2",
        )
        .bind(source_names.to_vec())
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn wiki_source_organization(
        &self,
        normalized_name: &str,
    ) -> Result<Option<WikiSourceOrganizationRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiSourceOrganizationRecord>(
            "SELECT id, name, org_type, funding_type, funding_sources, major_advertisers, \
                ein, annual_revenue, media_bias_rating, factual_reporting, wikipedia_url, \
                research_confidence \
             FROM organizations WHERE normalized_name = $1",
        )
        .bind(normalized_name)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn wiki_source_claims(
        &self,
        source_names: &[String],
    ) -> Result<Vec<WikiSourceClaimWithEvidence>, sqlx::Error> {
        let claims = sqlx::query_as::<_, WikiSourceClaimRecord>(
            "SELECT id, claim_type, claim_kind, claim_value, confidence, parser_version, \
                valid_from, valid_to \
             FROM source_claims \
             WHERE source_name = ANY($1) AND is_current = TRUE",
        )
        .bind(source_names.to_vec())
        .fetch_all(&self.pool)
        .await?;
        let mut results = Vec::with_capacity(claims.len());
        for claim in claims {
            let evidence = sqlx::query_as::<_, WikiSourceClaimEvidenceRecord>(
                "SELECT source_type, source_name, source_url, retrieved_at, raw_excerpt \
                 FROM source_claim_evidence WHERE claim_id = $1",
            )
            .bind(claim.id)
            .fetch_all(&self.pool)
            .await?;
            results.push(WikiSourceClaimWithEvidence { claim, evidence });
        }
        Ok(results)
    }

    pub async fn wiki_source_ledger_data(
        &self,
        source_names: &[String],
    ) -> Result<WikiSourceLedgerData, sqlx::Error> {
        let articles = sqlx::query_as::<_, WikiSourceLedgerArticleRecord>(
            "SELECT author, authors, paywall_status FROM articles WHERE source = ANY($1)",
        )
        .bind(source_names.to_vec())
        .fetch_all(&self.pool)
        .await?;
        let correction_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::BIGINT FROM corrections WHERE source = ANY($1)",
        )
        .bind(source_names.to_vec())
        .fetch_one(&self.pool)
        .await?;
        let original_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::BIGINT \
             FROM story_clusters sc \
             JOIN articles a ON a.id = sc.earliest_article_id \
             WHERE a.source = ANY($1)",
        )
        .bind(source_names.to_vec())
        .fetch_one(&self.pool)
        .await?;
        let relation_counts = sqlx::query_as::<_, WikiSourceLedgerRelationCount>(
            "SELECT edge.relation, COUNT(edge.id)::BIGINT AS count \
             FROM article_edges edge \
             JOIN articles target_article ON edge.to_article_id = target_article.id \
             WHERE target_article.source = ANY($1) \
             GROUP BY edge.relation",
        )
        .bind(source_names.to_vec())
        .fetch_all(&self.pool)
        .await?;
        Ok(WikiSourceLedgerData {
            articles,
            correction_count,
            original_count,
            relation_counts,
        })
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiReporterBylineSummaryRecord {
    pub source: String,
    pub first_published_at: Option<chrono::NaiveDateTime>,
    pub last_published_at: Option<chrono::NaiveDateTime>,
    pub article_count: i64,
}

impl Database {
    pub async fn wiki_reporter_byline_summary(
        &self,
        reporter_id: i64,
    ) -> Result<Vec<WikiReporterBylineSummaryRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiReporterBylineSummaryRecord>(
            "SELECT a.source, MIN(a.published_at) AS first_published_at, \
                    MAX(a.published_at) AS last_published_at, COUNT(a.id)::bigint AS article_count \
             FROM article_authors aa \
             JOIN articles a ON a.id = aa.article_id \
             WHERE aa.reporter_id = $1 AND a.source IS NOT NULL \
             GROUP BY a.source ORDER BY a.source",
        )
        .bind(reporter_id)
        .fetch_all(&self.pool)
        .await
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct PersistedSourceCatalogRecord {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub category: String,
    pub country: String,
    pub source_type: String,
    pub funding_type: String,
    pub bias_rating: String,
    pub ownership_label: String,
    pub factual_reporting: String,
    pub is_paywalled: bool,
}

#[derive(Clone, Debug)]
pub struct SourceCatalogPromotion {
    pub name: String,
    pub url: String,
    pub category: String,
    pub country: String,
    pub source_type: String,
    pub funding_type: String,
    pub bias_rating: String,
    pub ownership_label: String,
    pub factual_reporting: String,
    pub is_paywalled: bool,
}

async fn list_promoted_sources(
    pool: &PgPool,
) -> Result<Vec<PersistedSourceCatalogRecord>, sqlx::Error> {
    sqlx::query_as::<_, PersistedSourceCatalogRecord>(
        "SELECT id, name, url, category, country, source_type, funding_type, bias_rating, \
                ownership_label, factual_reporting, is_paywalled \
         FROM source_catalog ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
}

async fn promote_source(
    pool: &PgPool,
    source: &SourceCatalogPromotion,
) -> Result<bool, sqlx::Error> {
    let inserted_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO source_catalog \
             (name, url, category, country, source_type, funding_type, bias_rating, \
              ownership_label, factual_reporting, is_paywalled) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
         ON CONFLICT (name) DO NOTHING RETURNING id",
    )
    .bind(&source.name)
    .bind(&source.url)
    .bind(&source.category)
    .bind(&source.country)
    .bind(&source.source_type)
    .bind(&source.funding_type)
    .bind(&source.bias_rating)
    .bind(&source.ownership_label)
    .bind(&source.factual_reporting)
    .bind(source.is_paywalled)
    .fetch_optional(pool)
    .await?;
    Ok(inserted_id.is_some())
}

impl Database {
    pub async fn list_promoted_sources(
        &self,
    ) -> Result<Vec<PersistedSourceCatalogRecord>, sqlx::Error> {
        list_promoted_sources(&self.pool).await
    }

    pub async fn promote_source(
        &self,
        source: SourceCatalogPromotion,
    ) -> Result<bool, sqlx::Error> {
        promote_source(&self.pool, &source).await
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiSourceCredibilityMetadataRecord {
    pub source_name: String,
    pub domain: Option<String>,
    pub political_bias: Option<String>,
    pub research_sources: Option<Json<Value>>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiCredibilityOrganizationRecord {
    pub name: String,
    pub funding_type: Option<String>,
    pub parent_orgs: Option<Json<Value>>,
    pub ein: Option<String>,
    pub funding_sources: Option<Json<Value>>,
    pub annual_revenue: Option<String>,
    pub media_bias_rating: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiGdeltCredibilityStats {
    pub distinct_actor_names: i64,
    pub distinct_actor_countries: i64,
    pub event_count: i64,
    pub source_avg_tone: Option<f64>,
    pub global_avg_tone: Option<f64>,
    pub global_stddev_tone: Option<f64>,
    pub source_avg_goldstein: Option<f64>,
    pub global_avg_goldstein: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct WikiSourceCredibilityData {
    pub metadata: WikiSourceCredibilityMetadataRecord,
    pub organization: Option<WikiCredibilityOrganizationRecord>,
    pub analysis_scores: Vec<WikiSourceAnalysisScoreRecord>,
    pub gdelt: WikiGdeltCredibilityStats,
}

impl Database {
    pub async fn load_source_credibility_data(
        &self,
        domain: &str,
    ) -> Result<Option<WikiSourceCredibilityData>, sqlx::Error> {
        let Some(metadata) = sqlx::query_as::<_, WikiSourceCredibilityMetadataRecord>(
            "SELECT source_name, domain, political_bias, research_sources \
             FROM source_metadata WHERE domain = $1 LIMIT 1",
        )
        .bind(domain)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };

        let organization = sqlx::query_as::<_, WikiCredibilityOrganizationRecord>(
            "SELECT name, funding_type, parent_orgs, ein, funding_sources, \
                    annual_revenue, media_bias_rating \
             FROM organizations WHERE lower(name) = lower($1) LIMIT 1",
        )
        .bind(&metadata.source_name)
        .fetch_optional(&self.pool)
        .await?;

        let analysis_scores = sqlx::query_as::<_, WikiSourceAnalysisScoreRecord>(
            "SELECT source_name, axis_name, score, confidence, prose_explanation, citations, \
                    empirical_basis, scored_by, last_scored_at \
             FROM source_analysis_scores \
             WHERE lower(source_name) = lower($1) AND axis_name IN ( \
                 'correction_record', 'corrections', 'corrections_history', \
                 'methodology_transparency', 'editorial_standards', 'transparency' \
             )",
        )
        .bind(&metadata.source_name)
        .fetch_all(&self.pool)
        .await?;

        let gdelt_source = metadata
            .domain
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or(domain);
        let gdelt = sqlx::query_as::<_, WikiGdeltCredibilityStats>(
            "SELECT \
                 (SELECT COUNT(DISTINCT actor1_name)::bigint FROM gdelt_events WHERE source = $1) \
                     AS distinct_actor_names, \
                 (SELECT COUNT(DISTINCT actor1_country)::bigint FROM gdelt_events WHERE source = $1) \
                     AS distinct_actor_countries, \
                 (SELECT COUNT(*)::bigint FROM gdelt_events WHERE source = $1) AS event_count, \
                 (SELECT AVG(tone) FROM gdelt_events WHERE source = $1) AS source_avg_tone, \
                 (SELECT AVG(tone) FROM gdelt_events) AS global_avg_tone, \
                 (SELECT STDDEV_POP(tone) FROM gdelt_events) AS global_stddev_tone, \
                 (SELECT AVG(goldstein_scale) FROM gdelt_events WHERE source = $1) \
                     AS source_avg_goldstein, \
                 (SELECT AVG(goldstein_scale) FROM gdelt_events) AS global_avg_goldstein",
        )
        .bind(gdelt_source)
        .fetch_one(&self.pool)
        .await?;
        Ok(Some(WikiSourceCredibilityData {
            metadata,
            organization,
            analysis_scores,
            gdelt,
        }))
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reporter_merge_resolution_stops_at_a_cycle() {
        let mut seen_ids = std::collections::BTreeSet::from([42]);
        let next = ReporterMergeRow {
            id: 43,
            merged_into: Some(42),
            retirement_reason: Some("merged".to_owned()),
        };
        let resolved =
            accept_reporter_merge_target(next, &mut seen_ids).expect("first merge target is new");
        assert_eq!(resolved.id, 43);

        let cycle = ReporterMergeRow {
            id: 42,
            merged_into: Some(43),
            retirement_reason: Some("merged".to_owned()),
        };
        assert!(accept_reporter_merge_target(cycle, &mut seen_ids).is_none());
    }
    fn promotion(name: &str, url: &str) -> SourceCatalogPromotion {
        SourceCatalogPromotion {
            name: name.to_owned(),
            url: url.to_owned(),
            category: "news".to_owned(),
            country: "US".to_owned(),
            source_type: "publisher".to_owned(),
            funding_type: "commercial".to_owned(),
            bias_rating: "center".to_owned(),
            ownership_label: "independent".to_owned(),
            factual_reporting: "high".to_owned(),
            is_paywalled: false,
        }
    }

    #[sqlx::test]
    async fn source_catalog_promotions_are_exact_name_unique_and_ordered(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE source_catalog (\
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, \
                name TEXT COLLATE \"C\" NOT NULL UNIQUE, url TEXT NOT NULL, category TEXT NOT NULL, \
                country TEXT NOT NULL, source_type TEXT NOT NULL, funding_type TEXT NOT NULL, \
                bias_rating TEXT NOT NULL, ownership_label TEXT NOT NULL, \
                factual_reporting TEXT NOT NULL, is_paywalled BOOLEAN NOT NULL DEFAULT FALSE, \
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
        )
        .execute(&pool)
        .await
        .expect("create isolated source catalog");
        let database = crate::Database { pool };

        let shared_url = "https://same.example/";
        assert!(database
            .promote_source(promotion("Example News", shared_url))
            .await
            .expect("promote first source"));
        assert!(database
            .promote_source(promotion("Example Radio", shared_url))
            .await
            .expect("promote second source with same domain"));
        assert!(!database
            .promote_source(promotion("Example News", "https://replacement.example/"))
            .await
            .expect("duplicate name is ignored"));
        assert!(database
            .promote_source(promotion("example news", shared_url))
            .await
            .expect("name uniqueness follows C collation"));

        let rows = database
            .list_promoted_sources()
            .await
            .expect("list promoted sources");
        assert_eq!(
            rows.iter().map(|row| row.name.as_str()).collect::<Vec<_>>(),
            ["Example News", "Example Radio", "example news"]
        );
        assert!(rows.iter().all(|row| row.url == shared_url));
    }
}
#[derive(Clone, Debug)]
pub struct WikiOrganizationWriteRecord {
    pub name: String,
    pub normalized_name: String,
    pub org_type: Option<String>,
    pub ownership_percentage: Option<String>,
    pub funding_type: Option<String>,
    pub funding_sources: Option<Value>,
    pub major_advertisers: Option<Value>,
    pub ein: Option<String>,
    pub annual_revenue: Option<String>,
    pub top_donors: Option<Value>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
    pub website: Option<String>,
    pub wikipedia_url: Option<String>,
    pub research_sources: Option<Value>,
    pub research_confidence: Option<String>,
    pub owned_by: Option<Value>,
    pub parent_orgs: Option<Value>,
    pub part_of: Option<Value>,
    pub subsidiaries: Option<Value>,
    pub headquarters: Option<Value>,
    pub inception: Option<String>,
    pub official_website: Option<String>,
    pub cik: Option<String>,
    pub opensecrets_data: Option<Value>,
    pub conflict_flags: Option<Value>,
    pub parent_org: Option<String>,
    pub parent_org_id: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct WikiSourceAnalysisScoreInput {
    pub axis_name: String,
    pub score: i32,
    pub confidence: Option<String>,
    pub prose_explanation: Option<String>,
    pub citations: Option<Value>,
    pub empirical_basis: Option<String>,
    pub scored_by: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WikiSourceClaimEvidenceInput {
    pub source_type: String,
    pub source_name: Option<String>,
    pub source_url: String,
    pub retrieved_at: Option<chrono::NaiveDateTime>,
    pub raw_excerpt: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WikiSourceClaimInput {
    pub claim_type: String,
    pub claim_value: Value,
    pub claim_kind: String,
    pub confidence: f64,
    pub parser_version: String,
    pub evidence: Vec<WikiSourceClaimEvidenceInput>,
}

#[derive(Clone, Debug)]
pub struct WikiReporterProfileWriteRecord {
    pub name: String,
    pub normalized_name: Option<String>,
    pub resolver_key: Option<String>,
    pub raw_name: Option<String>,
    pub bio: Option<String>,
    pub career_history: Option<Value>,
    pub topics: Vec<String>,
    pub education: Option<Value>,
    pub political_leaning: Option<String>,
    pub leaning_confidence: Option<String>,
    pub leaning_sources: Option<Value>,
    pub twitter_handle: Option<String>,
    pub linkedin_url: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_qid: Option<String>,
    pub wikidata_url: Option<String>,
    pub canonical_name: Option<String>,
    pub match_status: Option<String>,
    pub overview: Option<String>,
    pub dossier_sections: Option<Value>,
    pub citations: Option<Value>,
    pub search_links: Option<Value>,
    pub match_explanation: Option<String>,
    pub research_sources: Option<Value>,
    pub research_confidence: Option<String>,
    pub littlesis_url: Option<String>,
    pub article_count: Option<i32>,
    pub last_article_at: Option<chrono::NaiveDateTime>,
    pub canonical_author_url: Option<String>,
    pub author_page_url: Option<String>,
    pub confidence_tier: Option<String>,
    pub confidence_score: Option<f64>,
    pub claims_count: Option<i32>,
    pub institutional_affiliations: Option<Value>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiReporterResearchRecord {
    pub id: i64,
    pub redirected_from_id: Option<i64>,
    pub name: String,
    pub normalized_name: Option<String>,
    pub bio: Option<String>,
    pub career_history: Option<Json<Value>>,
    pub topics: Option<Vec<String>>,
    pub education: Option<Json<Value>>,
    pub political_leaning: Option<String>,
    pub leaning_confidence: Option<String>,
    pub leaning_sources: Option<Json<Value>>,
    pub twitter_handle: Option<String>,
    pub linkedin_url: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_qid: Option<String>,
    pub wikidata_url: Option<String>,
    pub canonical_name: Option<String>,
    pub resolver_key: Option<String>,
    pub match_status: Option<String>,
    pub overview: Option<String>,
    pub dossier_sections: Option<Json<Value>>,
    pub citations: Option<Json<Value>>,
    pub search_links: Option<Json<Value>>,
    pub match_explanation: Option<String>,
    pub research_sources: Option<Json<Value>>,
    pub research_confidence: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct WikiOrganizationResearchRecord {
    pub id: i64,
    pub name: String,
    pub normalized_name: Option<String>,
    pub org_type: Option<String>,
    pub parent_org_id: Option<i64>,
    pub parent_org: Option<String>,
    pub ownership_percentage: Option<String>,
    pub funding_type: Option<String>,
    pub funding_sources: Option<Json<Value>>,
    pub major_advertisers: Option<Json<Value>>,
    pub ein: Option<String>,
    pub annual_revenue: Option<String>,
    pub top_donors: Option<Json<Value>>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
    pub website: Option<String>,
    pub wikipedia_url: Option<String>,
    pub owned_by: Option<Json<Value>>,
    pub parent_orgs: Option<Json<Value>>,
    pub part_of: Option<Json<Value>>,
    pub subsidiaries: Option<Json<Value>>,
    pub headquarters: Option<Json<Value>>,
    pub inception: Option<String>,
    pub official_website: Option<String>,
    pub cik: Option<String>,
    pub opensecrets_data: Option<Json<Value>>,
    pub conflict_flags: Option<Json<Value>>,
    pub research_sources: Option<Json<Value>>,
    pub research_confidence: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WikiArticleAuthorLinkInput {
    pub article_id: i64,
    pub author_role: String,
    pub author_confidence: Option<f64>,
    pub observation_source: Option<String>,
    pub author_url_raw: Option<String>,
}

pub fn sha256_hex(input: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut data = Vec::with_capacity(input.len() + 72);
    data.extend_from_slice(input);
    let bit_len = (input.len() as u64).wrapping_mul(8);
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());

    let mut state = [
        0x6a09e667_u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    for chunk in data.chunks_exact(64) {
        let mut schedule = [0_u32; 64];
        for (index, word) in chunk.chunks_exact(4).enumerate() {
            schedule[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..64 {
            let x = schedule[index - 15];
            let y = schedule[index - 2];
            let sigma0 = x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3);
            let sigma1 = y.rotate_right(17) ^ y.rotate_right(19) ^ (y >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(sigma0)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(sigma1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for index in 0..64 {
            let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choose = (e & f) ^ (!e & g);
            let temp1 = h
                .wrapping_add(sum1)
                .wrapping_add(choose)
                .wrapping_add(K[index])
                .wrapping_add(schedule[index]);
            let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = sum0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (word, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *word = word.wrapping_add(value);
        }
    }
    let mut digest = String::with_capacity(64);
    for word in state {
        use std::fmt::Write as _;
        write!(&mut digest, "{word:08x}").expect("writing to String cannot fail");
    }
    digest
}

fn push_ascii_json_string(value: &str, output: &mut String) {
    use std::fmt::Write as _;
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{0008}' => output.push_str("\\b"),
            '\u{000c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{001f}' || !character.is_ascii() => {
                let codepoint = character as u32;
                if codepoint <= 0xffff {
                    write!(output, "\\u{codepoint:04x}").expect("String write cannot fail");
                } else {
                    let scalar = codepoint - 0x1_0000;
                    let high = 0xd800 + (scalar >> 10);
                    let low = 0xdc00 + (scalar & 0x3ff);
                    write!(output, "\\u{high:04x}\\u{low:04x}").expect("String write cannot fail");
                }
            }
            character => output.push(character),
        }
    }
    output.push('"');
}

fn append_canonical_json(value: &Value, output: &mut String) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => output.push_str(&value.to_string()),
        Value::String(value) => push_ascii_json_string(value, output),
        Value::Array(values) => {
            output.push('[');
            for (index, item) in values.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                append_canonical_json(item, output);
            }
            output.push(']');
        }
        Value::Object(values) => {
            output.push('{');
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            for (index, key) in keys.into_iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                push_ascii_json_string(key, output);
                output.push(':');
                append_canonical_json(&values[key], output);
            }
            output.push('}');
        }
    }
}

pub(crate) fn canonical_json(value: &Value) -> String {
    let mut output = String::new();
    append_canonical_json(value, &mut output);
    output
}

fn source_claim_evidence_hash(
    evidence: &WikiSourceClaimEvidenceInput,
    claim_value: &Value,
) -> String {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "source_type".to_owned(),
        Value::String(evidence.source_type.clone()),
    );
    payload.insert(
        "source_url".to_owned(),
        Value::String(evidence.source_url.clone()),
    );
    payload.insert(
        "source_name".to_owned(),
        evidence
            .source_name
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    payload.insert(
        "raw_excerpt".to_owned(),
        evidence
            .raw_excerpt
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    payload.insert("claim_value".to_owned(), claim_value.clone());
    sha256_hex(canonical_json(&Value::Object(payload)).as_bytes())
}

pub async fn wiki_upsert_index_status(
    pool: &PgPool,
    entity_type: &str,
    entity_name: &str,
    status: &str,
    error_message: Option<&str>,
    duration_ms: Option<i64>,
) -> Result<(), sqlx::Error> {
    let duration_ms = duration_ms
        .map(i32::try_from)
        .transpose()
        .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("wiki-index:{entity_type}:{entity_name}"))
        .execute(&mut *transaction)
        .await?;
    let existing_id = sqlx::query_scalar::<_, i64>(
        "SELECT id::bigint FROM wiki_index_status \
         WHERE entity_type = $1 AND entity_name = $2 ORDER BY id LIMIT 1",
    )
    .bind(entity_type)
    .bind(entity_name)
    .fetch_optional(&mut *transaction)
    .await?;
    if let Some(id) = existing_id {
        sqlx::query(
            r#"UPDATE wiki_index_status
               SET status = $2,
                   error_message = $3,
                   updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                   last_indexed_at = CASE WHEN $2 = 'complete'
                       THEN CURRENT_TIMESTAMP AT TIME ZONE 'UTC' ELSE last_indexed_at END,
                   next_index_at = CASE WHEN $2 = 'complete'
                       THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '7 days'
                       WHEN $2 = 'failed'
                       THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '6 hours'
                       ELSE next_index_at END,
                   index_duration_ms = CASE WHEN $2 = 'complete'
                       THEN $4 ELSE index_duration_ms END
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(status)
        .bind(error_message)
        .bind(duration_ms)
        .execute(&mut *transaction)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO wiki_index_status
                (entity_type, entity_name, status, error_message, index_duration_ms,
                 last_indexed_at, next_index_at, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $3 = 'complete' THEN CURRENT_TIMESTAMP AT TIME ZONE 'UTC' END,
                 (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') +
                   CASE WHEN $3 = 'complete' THEN INTERVAL '7 days' ELSE INTERVAL '6 hours' END,
                 CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')"#,
        )
        .bind(entity_type)
        .bind(entity_name)
        .bind(status)
        .bind(error_message)
        .bind(duration_ms)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await
}

async fn resolve_organization_parent(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: &WikiOrganizationWriteRecord,
) -> Result<Option<i32>, sqlx::Error> {
    if let Some(parent_id) = input.parent_org_id {
        return i32::try_from(parent_id)
            .map(Some)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()));
    }
    let Some(parent_name) = input.parent_org.as_deref() else {
        return Ok(None);
    };
    let normalized = parent_name.trim().to_lowercase();
    if normalized.is_empty() || normalized == input.normalized_name {
        return Ok(None);
    }
    sqlx::query_scalar::<_, i32>(
        "SELECT id FROM organizations WHERE normalized_name = $1 ORDER BY id DESC LIMIT 1",
    )
    .bind(normalized)
    .fetch_optional(&mut **transaction)
    .await
}

pub async fn wiki_upsert_organization(
    pool: &PgPool,
    input: &WikiOrganizationWriteRecord,
) -> Result<Option<i64>, sqlx::Error> {
    if input.normalized_name.is_empty() {
        return Ok(None);
    }
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("organization:{}", input.normalized_name))
        .execute(&mut *transaction)
        .await?;
    let parent_id = resolve_organization_parent(&mut transaction, input).await?;
    let existing_id = sqlx::query_scalar::<_, i32>(
        "SELECT id FROM organizations WHERE normalized_name = $1 ORDER BY id DESC LIMIT 1",
    )
    .bind(&input.normalized_name)
    .fetch_optional(&mut *transaction)
    .await?;
    let id = if let Some(id) = existing_id {
        sqlx::query(
            r#"UPDATE organizations SET
                name = COALESCE($2, name),
                normalized_name = COALESCE($3, normalized_name),
                org_type = COALESCE($4, org_type),
                parent_org_id = COALESCE($5, parent_org_id),
                ownership_percentage = COALESCE($6, ownership_percentage),
                funding_type = COALESCE($7, funding_type),
                funding_sources = COALESCE($8, funding_sources),
                major_advertisers = COALESCE($9, major_advertisers),
                ein = COALESCE($10, ein),
                annual_revenue = COALESCE($11, annual_revenue),
                top_donors = COALESCE($12, top_donors),
                media_bias_rating = COALESCE($13, media_bias_rating),
                factual_reporting = COALESCE($14, factual_reporting),
                website = COALESCE($15, website),
                wikipedia_url = COALESCE($16, wikipedia_url),
                research_sources = COALESCE($17, research_sources),
                research_confidence = COALESCE($18, research_confidence),
                owned_by = COALESCE($19, owned_by),
                parent_orgs = COALESCE($20, parent_orgs),
                part_of = COALESCE($21, part_of),
                subsidiaries = COALESCE($22, subsidiaries),
                headquarters = COALESCE($23, headquarters),
                inception = COALESCE($24, inception),
                official_website = COALESCE($25, official_website),
                cik = COALESCE($26, cik),
                opensecrets_data = COALESCE($27, opensecrets_data),
                conflict_flags = COALESCE($28, conflict_flags),
                updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
             WHERE id = $1"#,
        )
        .bind(id)
        .bind(&input.name)
        .bind(&input.normalized_name)
        .bind(&input.org_type)
        .bind(parent_id)
        .bind(&input.ownership_percentage)
        .bind(&input.funding_type)
        .bind(input.funding_sources.as_ref().map(Json))
        .bind(input.major_advertisers.as_ref().map(Json))
        .bind(&input.ein)
        .bind(&input.annual_revenue)
        .bind(input.top_donors.as_ref().map(Json))
        .bind(&input.media_bias_rating)
        .bind(&input.factual_reporting)
        .bind(&input.website)
        .bind(&input.wikipedia_url)
        .bind(input.research_sources.as_ref().map(Json))
        .bind(&input.research_confidence)
        .bind(input.owned_by.as_ref().map(Json))
        .bind(input.parent_orgs.as_ref().map(Json))
        .bind(input.part_of.as_ref().map(Json))
        .bind(input.subsidiaries.as_ref().map(Json))
        .bind(input.headquarters.as_ref().map(Json))
        .bind(&input.inception)
        .bind(&input.official_website)
        .bind(&input.cik)
        .bind(input.opensecrets_data.as_ref().map(Json))
        .bind(input.conflict_flags.as_ref().map(Json))
        .execute(&mut *transaction)
        .await?;
        i64::from(id)
    } else {
        sqlx::query_scalar::<_, i64>(
            r#"INSERT INTO organizations
                (name, normalized_name, org_type, parent_org_id, ownership_percentage,
                 funding_type, funding_sources, major_advertisers, ein, annual_revenue, top_donors,
                 media_bias_rating, factual_reporting, website, wikipedia_url, research_sources,
                 research_confidence, owned_by, parent_orgs, part_of, subsidiaries, headquarters,
                 inception, official_website, cik, opensecrets_data, conflict_flags, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                     $15, $16, $17, COALESCE($18, '[]'::json), COALESCE($19, '[]'::json),
                     COALESCE($20, '[]'::json), COALESCE($21, '[]'::json),
                     COALESCE($22, '[]'::json), $23, $24, $25,
                     COALESCE($26, '{}'::json), COALESCE($27, '[]'::json),
                     CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
             RETURNING id::bigint"#,
        )
        .bind(&input.name)
        .bind(&input.normalized_name)
        .bind(&input.org_type)
        .bind(parent_id)
        .bind(&input.ownership_percentage)
        .bind(&input.funding_type)
        .bind(input.funding_sources.as_ref().map(Json))
        .bind(input.major_advertisers.as_ref().map(Json))
        .bind(&input.ein)
        .bind(&input.annual_revenue)
        .bind(input.top_donors.as_ref().map(Json))
        .bind(&input.media_bias_rating)
        .bind(&input.factual_reporting)
        .bind(&input.website)
        .bind(&input.wikipedia_url)
        .bind(input.research_sources.as_ref().map(Json))
        .bind(&input.research_confidence)
        .bind(input.owned_by.as_ref().map(Json))
        .bind(input.parent_orgs.as_ref().map(Json))
        .bind(input.part_of.as_ref().map(Json))
        .bind(input.subsidiaries.as_ref().map(Json))
        .bind(input.headquarters.as_ref().map(Json))
        .bind(&input.inception)
        .bind(&input.official_website)
        .bind(&input.cik)
        .bind(input.opensecrets_data.as_ref().map(Json))
        .bind(input.conflict_flags.as_ref().map(Json))
        .fetch_one(&mut *transaction)
        .await?
    };
    transaction.commit().await?;
    Ok(Some(id))
}

pub async fn wiki_upsert_source_analysis_scores(
    pool: &PgPool,
    source_name: &str,
    scores: &[WikiSourceAnalysisScoreInput],
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    for score in scores {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("source-score:{source_name}:{}", score.axis_name))
            .execute(&mut *transaction)
            .await?;
        let existing_id = sqlx::query_scalar::<_, i32>(
            "SELECT id FROM source_analysis_scores \
             WHERE source_name = $1 AND axis_name = $2 ORDER BY id LIMIT 1",
        )
        .bind(source_name)
        .bind(&score.axis_name)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(id) = existing_id {
            sqlx::query(
                r#"UPDATE source_analysis_scores SET score = $3, confidence = $4,
                       prose_explanation = $5, citations = $6, empirical_basis = $7,
                       scored_by = $8, last_scored_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                       updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                   WHERE id = $1 AND source_name = $2"#,
            )
            .bind(id)
            .bind(source_name)
            .bind(score.score)
            .bind(&score.confidence)
            .bind(&score.prose_explanation)
            .bind(score.citations.as_ref().map(Json))
            .bind(&score.empirical_basis)
            .bind(score.scored_by.as_deref().unwrap_or("llm"))
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query(
                r#"INSERT INTO source_analysis_scores
                    (source_name, axis_name, score, confidence, prose_explanation, citations,
                     empirical_basis, scored_by, last_scored_at, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                           CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                           CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                           CURRENT_TIMESTAMP AT TIME ZONE 'UTC')"#,
            )
            .bind(source_name)
            .bind(&score.axis_name)
            .bind(score.score)
            .bind(&score.confidence)
            .bind(&score.prose_explanation)
            .bind(score.citations.as_ref().map(Json))
            .bind(&score.empirical_basis)
            .bind(score.scored_by.as_deref().unwrap_or("llm"))
            .execute(&mut *transaction)
            .await?;
        }
    }
    transaction.commit().await
}

#[derive(Debug, FromRow)]
struct CurrentSourceClaimRow {
    id: i32,
    claim_value: Json<Value>,
    claim_kind: String,
}

pub async fn wiki_sync_source_claims(
    pool: &PgPool,
    source_name: &str,
    claims: &[WikiSourceClaimInput],
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    for incoming in claims {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "source-claim:{source_name}:{}",
                incoming.claim_type
            ))
            .execute(&mut *transaction)
            .await?;
        let active = sqlx::query_as::<_, CurrentSourceClaimRow>(
            "SELECT id, claim_value, claim_kind FROM source_claims \
             WHERE source_name = $1 AND claim_type = $2 AND is_current = TRUE \
             ORDER BY id",
        )
        .bind(source_name)
        .bind(&incoming.claim_type)
        .fetch_all(&mut *transaction)
        .await?;
        let incoming_json = canonical_json(&incoming.claim_value);
        let matching = active.iter().find(|row| {
            row.claim_kind == incoming.claim_kind
                && canonical_json(&row.claim_value.0) == incoming_json
        });
        let claim_id = if let Some(matching) = matching {
            sqlx::query(
                "UPDATE source_claims SET confidence = $2, parser_version = $3, \
                 updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id = $1",
            )
            .bind(matching.id)
            .bind(incoming.confidence)
            .bind(&incoming.parser_version)
            .execute(&mut *transaction)
            .await?;
            matching.id
        } else {
            sqlx::query(
                "UPDATE source_claims SET is_current = FALSE, \
                    valid_to = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', \
                    updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' \
                 WHERE source_name = $1 AND claim_type = $2 AND is_current = TRUE",
            )
            .bind(source_name)
            .bind(&incoming.claim_type)
            .execute(&mut *transaction)
            .await?;
            sqlx::query_scalar::<_, i32>(
                "INSERT INTO source_claims \
                    (source_name, claim_type, claim_value, claim_kind, confidence, parser_version, \
                     is_current, valid_from, created_at, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, TRUE, \
                         CURRENT_TIMESTAMP AT TIME ZONE 'UTC', \
                         CURRENT_TIMESTAMP AT TIME ZONE 'UTC', \
                         CURRENT_TIMESTAMP AT TIME ZONE 'UTC') RETURNING id",
            )
            .bind(source_name)
            .bind(&incoming.claim_type)
            .bind(Json(&incoming.claim_value))
            .bind(&incoming.claim_kind)
            .bind(incoming.confidence)
            .bind(&incoming.parser_version)
            .fetch_one(&mut *transaction)
            .await?
        };
        let mut existing_hashes = sqlx::query_scalar::<_, String>(
            "SELECT raw_hash FROM source_claim_evidence WHERE claim_id = $1",
        )
        .bind(claim_id)
        .fetch_all(&mut *transaction)
        .await?
        .into_iter()
        .collect::<HashSet<_>>();
        for evidence in &incoming.evidence {
            let raw_hash = source_claim_evidence_hash(evidence, &incoming.claim_value);
            if !existing_hashes.insert(raw_hash.clone()) {
                continue;
            }
            sqlx::query(
                "INSERT INTO source_claim_evidence \
                    (claim_id, source_type, source_name, source_url, retrieved_at, raw_excerpt, raw_hash, created_at) \
                 VALUES ($1, $2, $3, $4, \
                    COALESCE($5, CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), $6, $7, \
                    CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
            )
            .bind(claim_id)
            .bind(&evidence.source_type)
            .bind(&evidence.source_name)
            .bind(&evidence.source_url)
            .bind(evidence.retrieved_at)
            .bind(&evidence.raw_excerpt)
            .bind(raw_hash)
            .execute(&mut *transaction)
            .await?;
        }
    }
    transaction.commit().await
}

fn normalized_profile_topics(topics: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    topics
        .iter()
        .filter_map(|topic| {
            let value = topic.trim();
            if value.is_empty() || !seen.insert(value.to_lowercase()) {
                None
            } else {
                Some(value.to_owned())
            }
        })
        .collect()
}

pub async fn wiki_upsert_reporter_profile(
    pool: &PgPool,
    input: &WikiReporterProfileWriteRecord,
) -> Result<i64, sqlx::Error> {
    let topics = normalized_profile_topics(&input.topics);
    let identity = input
        .resolver_key
        .as_deref()
        .map(|key| format!("resolver:{key}"))
        .unwrap_or_else(|| {
            format!(
                "normalized:{}",
                input.normalized_name.as_deref().unwrap_or_default()
            )
        });
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("reporter:{identity}"))
        .execute(&mut *transaction)
        .await?;
    let existing_id = if let Some(resolver_key) = input.resolver_key.as_deref() {
        sqlx::query_scalar::<_, i32>(
            "SELECT id FROM reporters WHERE resolver_key = $1 ORDER BY id LIMIT 1",
        )
        .bind(resolver_key)
        .fetch_optional(&mut *transaction)
        .await?
    } else if let Some(normalized_name) = input.normalized_name.as_deref() {
        sqlx::query_scalar::<_, i32>(
            "SELECT id FROM reporters WHERE normalized_name = $1 ORDER BY id LIMIT 1",
        )
        .bind(normalized_name)
        .fetch_optional(&mut *transaction)
        .await?
    } else {
        sqlx::query_scalar::<_, i32>(
            "SELECT id FROM reporters WHERE normalized_name IS NULL ORDER BY id LIMIT 1",
        )
        .fetch_optional(&mut *transaction)
        .await?
    };

    let id = if let Some(id) = existing_id {
        let mut query = QueryBuilder::<Postgres>::new("UPDATE reporters SET ");
        query
            .push("name = ")
            .push_bind(&input.name)
            .push(", normalized_name = ")
            .push_bind(&input.normalized_name)
            .push(", resolver_key = ")
            .push_bind(&input.resolver_key)
            .push(", raw_name = ")
            .push_bind(&input.raw_name)
            .push(", bio = ")
            .push_bind(&input.bio)
            .push(", career_history = ")
            .push_bind(input.career_history.as_ref().map(Json))
            .push(", topics = ")
            .push_bind(&topics)
            .push(", education = ")
            .push_bind(input.education.as_ref().map(Json))
            .push(", political_leaning = ")
            .push_bind(&input.political_leaning)
            .push(", leaning_confidence = ")
            .push_bind(&input.leaning_confidence)
            .push(", leaning_sources = ")
            .push_bind(input.leaning_sources.as_ref().map(Json))
            .push(", twitter_handle = ")
            .push_bind(&input.twitter_handle)
            .push(", linkedin_url = ")
            .push_bind(&input.linkedin_url)
            .push(", wikipedia_url = ")
            .push_bind(&input.wikipedia_url)
            .push(", wikidata_qid = ")
            .push_bind(&input.wikidata_qid)
            .push(", wikidata_url = ")
            .push_bind(&input.wikidata_url)
            .push(", canonical_name = ")
            .push_bind(&input.canonical_name)
            .push(", match_status = ")
            .push_bind(&input.match_status)
            .push(", overview = ")
            .push_bind(&input.overview)
            .push(", dossier_sections = ")
            .push_bind(input.dossier_sections.as_ref().map(Json))
            .push(", citations = ")
            .push_bind(input.citations.as_ref().map(Json))
            .push(", search_links = ")
            .push_bind(input.search_links.as_ref().map(Json))
            .push(", match_explanation = ")
            .push_bind(&input.match_explanation)
            .push(", research_sources = ")
            .push_bind(input.research_sources.as_ref().map(Json))
            .push(", research_confidence = ")
            .push_bind(&input.research_confidence)
            .push(", littlesis_url = ")
            .push_bind(&input.littlesis_url)
            .push(", article_count = ")
            .push_bind(input.article_count)
            .push(", last_article_at = ")
            .push_bind(input.last_article_at)
            .push(", canonical_author_url = ")
            .push_bind(&input.canonical_author_url)
            .push(", author_page_url = ")
            .push_bind(&input.author_page_url)
            .push(", confidence_tier = ")
            .push_bind(&input.confidence_tier)
            .push(", confidence_score = ")
            .push_bind(input.confidence_score)
            .push(", claims_count = ")
            .push_bind(input.claims_count)
            .push(", institutional_affiliations = COALESCE(")
            .push_bind(input.institutional_affiliations.as_ref().map(Json))
            .push(", institutional_affiliations)")
            .push(", last_researched_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'")
            .push(", updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id = ")
            .push_bind(id);
        query.build().execute(&mut *transaction).await?;
        id as i64
    } else {
        let mut query = QueryBuilder::<Postgres>::new(
            "INSERT INTO reporters \
             (name, normalized_name, resolver_key, raw_name, bio, career_history, topics, education, \
              political_leaning, leaning_confidence, leaning_sources, twitter_handle, linkedin_url, \
              wikipedia_url, wikidata_qid, wikidata_url, canonical_name, match_status, overview, \
              dossier_sections, citations, search_links, match_explanation, research_sources, \
              research_confidence, littlesis_url, article_count, last_article_at, canonical_author_url, \
              author_page_url, confidence_tier, confidence_score, claims_count, institutional_affiliations, \
              last_researched_at, is_collective, created_at, updated_at) VALUES (",
        );
        {
            let mut values = query.separated(", ");
            values
                .push_bind(&input.name)
                .push_bind(&input.normalized_name)
                .push_bind(&input.resolver_key)
                .push_bind(&input.raw_name)
                .push_bind(&input.bio)
                .push_bind(input.career_history.as_ref().map(Json))
                .push_bind(&topics)
                .push_bind(input.education.as_ref().map(Json))
                .push_bind(&input.political_leaning)
                .push_bind(&input.leaning_confidence)
                .push_bind(input.leaning_sources.as_ref().map(Json))
                .push_bind(&input.twitter_handle)
                .push_bind(&input.linkedin_url)
                .push_bind(&input.wikipedia_url)
                .push_bind(&input.wikidata_qid)
                .push_bind(&input.wikidata_url)
                .push_bind(&input.canonical_name)
                .push_bind(&input.match_status)
                .push_bind(&input.overview)
                .push_bind(input.dossier_sections.as_ref().map(Json))
                .push_bind(input.citations.as_ref().map(Json))
                .push_bind(input.search_links.as_ref().map(Json))
                .push_bind(&input.match_explanation)
                .push_bind(input.research_sources.as_ref().map(Json))
                .push_bind(&input.research_confidence)
                .push_bind(&input.littlesis_url)
                .push_bind(input.article_count)
                .push_bind(input.last_article_at)
                .push_bind(&input.canonical_author_url)
                .push_bind(&input.author_page_url)
                .push_bind(&input.confidence_tier)
                .push_bind(input.confidence_score)
                .push_bind(input.claims_count)
                .push_bind(input.institutional_affiliations.as_ref().map(Json));
            values.push_unseparated(
                ", CURRENT_TIMESTAMP AT TIME ZONE 'UTC', FALSE, \
                 CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'",
            );
        }
        query.push(") RETURNING id::bigint");
        query
            .build_query_scalar::<i64>()
            .fetch_one(&mut *transaction)
            .await?
    };
    transaction.commit().await?;
    Ok(id)
}

pub async fn wiki_insert_article_author_links(
    pool: &PgPool,
    reporter_id: i64,
    links: &[WikiArticleAuthorLinkInput],
) -> Result<u64, sqlx::Error> {
    let reporter_id =
        i32::try_from(reporter_id).map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let mut unique_links = BTreeMap::new();
    for link in links {
        let article_id = i32::try_from(link.article_id)
            .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
        unique_links.entry(article_id).or_insert(link);
    }
    let mut transaction = pool.begin().await?;
    let mut inserted = 0;
    for (article_id, link) in unique_links {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("article-author:{article_id}:{reporter_id}"))
            .execute(&mut *transaction)
            .await?;
        inserted += sqlx::query(
            "INSERT INTO article_authors \
                (article_id, reporter_id, author_role, author_confidence, observation_source, \
                 author_url_raw, created_at) \
             SELECT $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP AT TIME ZONE 'UTC' \
             WHERE NOT EXISTS (SELECT 1 FROM article_authors \
                               WHERE article_id = $1 AND reporter_id = $2)",
        )
        .bind(article_id)
        .bind(reporter_id)
        .bind(&link.author_role)
        .bind(link.author_confidence)
        .bind(&link.observation_source)
        .bind(&link.author_url_raw)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
    }
    transaction.commit().await?;
    Ok(inserted)
}

impl Database {
    pub async fn wiki_upsert_index_status(
        &self,
        entity_type: &str,
        entity_name: &str,
        status: &str,
        error_message: Option<&str>,
        duration_ms: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        wiki_upsert_index_status(
            &self.pool,
            entity_type,
            entity_name,
            status,
            error_message,
            duration_ms,
        )
        .await
    }

    pub async fn wiki_upsert_organization(
        &self,
        input: WikiOrganizationWriteRecord,
    ) -> Result<Option<i64>, sqlx::Error> {
        wiki_upsert_organization(&self.pool, &input).await
    }

    pub async fn wiki_upsert_source_analysis_scores(
        &self,
        source_name: &str,
        scores: Vec<WikiSourceAnalysisScoreInput>,
    ) -> Result<(), sqlx::Error> {
        wiki_upsert_source_analysis_scores(&self.pool, source_name, &scores).await
    }

    pub async fn wiki_sync_source_claims(
        &self,
        source_name: &str,
        claims: Vec<WikiSourceClaimInput>,
    ) -> Result<(), sqlx::Error> {
        wiki_sync_source_claims(&self.pool, source_name, &claims).await
    }

    pub async fn wiki_upsert_reporter_profile(
        &self,
        input: WikiReporterProfileWriteRecord,
    ) -> Result<i64, sqlx::Error> {
        wiki_upsert_reporter_profile(&self.pool, &input).await
    }

    pub async fn wiki_refresh_reporter_article_count(
        &self,
        reporter_id: i64,
    ) -> Result<Option<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            "UPDATE reporters \
             SET article_count = (SELECT COUNT(*)::int FROM article_authors WHERE reporter_id = $1), \
                 updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' \
             WHERE id = $1 \
             RETURNING article_count",
        )
        .bind(reporter_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn wiki_author_byline_articles(
        &self,
        author_name: &str,
        source_name: Option<&str>,
    ) -> Result<Vec<WikiUnresolvedAuthorArticle>, sqlx::Error> {
        let mut query = QueryBuilder::<Postgres>::new(
            "SELECT id::bigint AS article_id, author, source AS source_name, authors, author_urls, \
                    title, url, published_at, category FROM articles WHERE author = ",
        );
        query.push_bind(author_name);
        if let Some(source_name) = source_name.filter(|value| !value.is_empty()) {
            query.push(" AND source = ").push_bind(source_name);
        }
        query.push(" ORDER BY published_at DESC NULLS LAST, id");
        query
            .build_query_as::<WikiUnresolvedArticleRow>()
            .fetch_all(&self.pool)
            .await
            .map(|rows| {
                rows.into_iter()
                    .map(WikiUnresolvedArticleRow::into_article)
                    .collect()
            })
    }
    pub async fn wiki_insert_article_author_links(
        &self,
        reporter_id: i64,
        links: Vec<WikiArticleAuthorLinkInput>,
    ) -> Result<u64, sqlx::Error> {
        wiki_insert_article_author_links(&self.pool, reporter_id, &links).await
    }
}

#[derive(Clone, Debug, FromRow)]
struct WikiUnresolvedAuthorRow {
    author: String,
    source_name: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct WikiUnresolvedArticleRow {
    article_id: i64,
    author: String,
    source_name: Option<String>,
    authors: Option<Vec<String>>,
    author_urls: Option<Vec<String>>,
    title: String,
    url: String,
    published_at: chrono::NaiveDateTime,
    category: Option<String>,
}
impl WikiUnresolvedArticleRow {
    fn into_article(self) -> WikiUnresolvedAuthorArticle {
        let author_url_raw = author_url_for_article(
            self.authors.as_deref(),
            self.author_urls.as_deref(),
            &self.author,
        );
        WikiUnresolvedAuthorArticle {
            article_id: self.article_id,
            title: self.title,
            url: self.url,
            published_at: self.published_at,
            category: self.category,
            author_url_raw,
        }
    }
}

fn normalize_reporter_name(name: &str) -> String {
    name.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn author_url_for_article(
    authors: Option<&[String]>,
    author_urls: Option<&[String]>,
    author_name: &str,
) -> Option<String> {
    let authors = authors?;
    let author_urls = author_urls?;
    authors
        .iter()
        .position(|author| author == author_name)
        .and_then(|index| author_urls.get(index))
        .cloned()
}

impl Database {
    pub async fn active_source_credibility(
        &self,
        domain: &str,
    ) -> Result<Vec<WikiSourceCredibilityRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiSourceCredibilityRecord>(
            "SELECT domain, credibility_score, source_type, is_active \
             FROM source_credibility WHERE domain = $1 AND is_active IS TRUE ORDER BY id",
        )
        .bind(domain)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn list_active_source_credibility(
        &self,
    ) -> Result<Vec<WikiSourceCredibilityRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiSourceCredibilityRecord>(
            "SELECT domain, credibility_score, source_type, is_active \
             FROM source_credibility WHERE is_active IS TRUE ORDER BY domain, id",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn collect_article_behavior_stats(
        &self,
        source_name: &str,
        days: i64,
    ) -> Result<WikiArticleBehaviorStats, sqlx::Error> {
        let cutoff = chrono::Utc::now().naive_utc() - chrono::Duration::days(days);
        let article_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::bigint FROM articles \
             WHERE source = $1 AND published_at >= $2",
        )
        .bind(source_name)
        .bind(cutoff)
        .fetch_one(&self.pool)
        .await?;
        let categories = sqlx::query_as::<_, (Option<String>, i64)>(
            "SELECT category, COUNT(*)::bigint AS article_count FROM articles \
             WHERE source = $1 AND published_at >= $2 \
             GROUP BY category ORDER BY article_count DESC LIMIT 5",
        )
        .bind(source_name)
        .bind(cutoff)
        .fetch_all(&self.pool)
        .await?;
        Ok(WikiArticleBehaviorStats {
            article_count,
            top_categories: categories
                .into_iter()
                .filter_map(|(category, _)| category.filter(|value| !value.is_empty()))
                .collect(),
        })
    }

    pub async fn wiki_unresolved_author_candidates(
        &self,
        limit: i64,
        source_name: Option<&str>,
    ) -> Result<Vec<WikiUnresolvedAuthorCandidate>, sqlx::Error> {
        if limit <= 0 {
            return Ok(Vec::new());
        }
        let mut query = QueryBuilder::<Postgres>::new(
            "SELECT DISTINCT author, source AS source_name FROM articles \
             WHERE author IS NOT NULL AND author <> ''",
        );
        if let Some(source_name) = source_name.filter(|value| !value.is_empty()) {
            query.push(" AND source = ").push_bind(source_name);
        }
        query.push(" LIMIT ").push_bind(limit.saturating_mul(3));
        let rows = query
            .build_query_as::<WikiUnresolvedAuthorRow>()
            .fetch_all(&self.pool)
            .await?;
        let mut all_authors = Vec::new();
        let mut seen = HashSet::new();
        for row in rows {
            let author_name = row.author.trim().to_owned();
            let normalized_name = normalize_reporter_name(&author_name);
            if !normalized_name.is_empty() && seen.insert(normalized_name.clone()) {
                all_authors.push(WikiUnresolvedAuthorCandidate {
                    author_name,
                    normalized_name,
                    source_name: row.source_name,
                    articles: Vec::new(),
                });
                if all_authors.len() >= usize::try_from(limit).unwrap_or(usize::MAX) {
                    break;
                }
            }
        }
        if all_authors.is_empty() {
            return Ok(all_authors);
        }
        let existing_names = sqlx::query_scalar::<_, String>(
            "SELECT normalized_name FROM reporters WHERE normalized_name IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .collect::<HashSet<_>>();
        all_authors.retain(|candidate| !existing_names.contains(&candidate.normalized_name));
        if all_authors.is_empty() {
            return Ok(all_authors);
        }

        let mut article_query = QueryBuilder::<Postgres>::new(
            "SELECT id::bigint AS article_id, author, source AS source_name, authors, author_urls, \
                    title, url, published_at, category FROM articles WHERE ",
        );
        for (index, candidate) in all_authors.iter().enumerate() {
            if index > 0 {
                article_query.push(" OR ");
            }
            article_query
                .push("(author = ")
                .push_bind(&candidate.author_name);
            if let Some(source_name) = candidate
                .source_name
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                article_query.push(" AND source = ").push_bind(source_name);
            }
            article_query.push(")");
        }
        article_query.push(" ORDER BY published_at DESC NULLS LAST, id");
        let article_rows = article_query
            .build_query_as::<WikiUnresolvedArticleRow>()
            .fetch_all(&self.pool)
            .await?;
        let mut articles_by_pair =
            HashMap::<(String, Option<String>), Vec<WikiUnresolvedAuthorArticle>>::new();
        for row in article_rows {
            let author_url_raw = author_url_for_article(
                row.authors.as_deref(),
                row.author_urls.as_deref(),
                &row.author,
            );
            articles_by_pair
                .entry((row.author, row.source_name))
                .or_default()
                .push(WikiUnresolvedAuthorArticle {
                    article_id: row.article_id,
                    title: row.title,
                    url: row.url,
                    published_at: row.published_at,
                    category: row.category,
                    author_url_raw,
                });
        }
        for candidate in &mut all_authors {
            candidate.articles = match candidate
                .source_name
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                Some(source_name) => articles_by_pair
                    .remove(&(candidate.author_name.clone(), Some(source_name.to_owned())))
                    .unwrap_or_default(),
                None => articles_by_pair
                    .iter()
                    .filter(|((author_name, _), _)| author_name == &candidate.author_name)
                    .flat_map(|(_, articles)| articles.iter().cloned())
                    .collect(),
            };
            candidate.articles.sort_by(|left, right| {
                right
                    .published_at
                    .cmp(&left.published_at)
                    .then(left.article_id.cmp(&right.article_id))
            });
        }
        Ok(all_authors)
    }
}

#[cfg(test)]
mod unresolved_author_tests {
    use super::{author_url_for_article, normalize_reporter_name};

    #[test]
    fn reporter_name_normalization_matches_lowercase_and_whitespace_collapse() {
        assert_eq!(normalize_reporter_name("  A\tB  "), "a b");
    }

    #[test]
    fn author_url_selection_uses_the_first_exact_parallel_list_match() {
        let authors = vec!["Alice".to_owned(), "Bob".to_owned(), "Bob".to_owned()];
        let urls = vec!["/alice".to_owned(), "/bob-first".to_owned()];
        assert_eq!(
            author_url_for_article(Some(&authors), Some(&urls), "Bob"),
            Some("/bob-first".to_owned())
        );
        assert_eq!(
            author_url_for_article(Some(&authors), Some(&urls), "BOB"),
            None
        );
    }
}

impl Database {
    pub async fn reporter_by_resolver_key(
        &self,
        resolver_key: &str,
    ) -> Result<Option<WikiReporterResearchRecord>, sqlx::Error> {
        let mut query = QueryBuilder::<Postgres>::new(
            "SELECT id::bigint AS id, NULL::bigint AS redirected_from_id, name, normalized_name, \
                    bio, career_history, topics, education, political_leaning, leaning_confidence, \
                    leaning_sources, twitter_handle, linkedin_url, wikipedia_url, wikidata_qid, \
                    wikidata_url, canonical_name, resolver_key, match_status, overview, \
                    dossier_sections, citations, search_links, match_explanation, research_sources, \
                    research_confidence FROM reporters WHERE resolver_key = ",
        );
        query
            .push_bind(resolver_key)
            .push(" ORDER BY id DESC LIMIT 1");
        query
            .build_query_as::<WikiReporterResearchRecord>()
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn reporter_by_id(
        &self,
        reporter_id: i64,
    ) -> Result<Option<WikiReporterResearchRecord>, sqlx::Error> {
        let Some(resolved_id) = self.resolve_reporter_id(reporter_id).await? else {
            return Ok(None);
        };
        let mut query = QueryBuilder::<Postgres>::new(
            "SELECT id::bigint AS id, NULL::bigint AS redirected_from_id, name, normalized_name, \
                    bio, career_history, topics, education, political_leaning, leaning_confidence, \
                    leaning_sources, twitter_handle, linkedin_url, wikipedia_url, wikidata_qid, \
                    wikidata_url, canonical_name, resolver_key, match_status, overview, \
                    dossier_sections, citations, search_links, match_explanation, research_sources, \
                    research_confidence FROM reporters WHERE id = ",
        );
        query.push_bind(resolved_id);
        let mut record = query
            .build_query_as::<WikiReporterResearchRecord>()
            .fetch_optional(&self.pool)
            .await?;
        if let Some(record) = record.as_mut() {
            if resolved_id != reporter_id {
                record.redirected_from_id = Some(reporter_id);
            }
        }
        Ok(record)
    }

    pub async fn list_reporters(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WikiReporterResearchRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiReporterResearchRecord>(
            "SELECT id::bigint AS id, NULL::bigint AS redirected_from_id, name, normalized_name, \
                    bio, career_history, topics, education, political_leaning, leaning_confidence, \
                    leaning_sources, twitter_handle, linkedin_url, wikipedia_url, wikidata_qid, \
                    wikidata_url, canonical_name, resolver_key, match_status, overview, \
                    dossier_sections, citations, search_links, match_explanation, research_sources, \
                    research_confidence FROM reporters WHERE retirement_reason IS NULL \
             ORDER BY id LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn save_reporter(
        &self,
        input: &WikiReporterProfileWriteRecord,
    ) -> Result<i64, sqlx::Error> {
        wiki_upsert_reporter_profile(&self.pool, input).await
    }

    pub async fn organization_by_normalized_name(
        &self,
        normalized_name: &str,
    ) -> Result<Option<WikiOrganizationResearchRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiOrganizationResearchRecord>(
            "SELECT id::bigint AS id, name, normalized_name, org_type, \
                    parent_org_id::bigint AS parent_org_id, parent_orgs ->> 0 AS parent_org, \
                    ownership_percentage, funding_type, funding_sources, major_advertisers, ein, \
                    annual_revenue, top_donors, media_bias_rating, factual_reporting, website, \
                    wikipedia_url, owned_by, parent_orgs, part_of, subsidiaries, headquarters, \
                    inception, official_website, cik, opensecrets_data, conflict_flags, \
                    research_sources, research_confidence \
             FROM organizations WHERE normalized_name = $1 ORDER BY id DESC LIMIT 1",
        )
        .bind(normalized_name)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn organization_by_id(
        &self,
        organization_id: i64,
    ) -> Result<Option<WikiOrganizationResearchRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiOrganizationResearchRecord>(
            "SELECT id::bigint AS id, name, normalized_name, org_type, \
                    parent_org_id::bigint AS parent_org_id, parent_orgs ->> 0 AS parent_org, \
                    ownership_percentage, funding_type, funding_sources, major_advertisers, ein, \
                    annual_revenue, top_donors, media_bias_rating, factual_reporting, website, \
                    wikipedia_url, owned_by, parent_orgs, part_of, subsidiaries, headquarters, \
                    inception, official_website, cik, opensecrets_data, conflict_flags, \
                    research_sources, research_confidence \
             FROM organizations WHERE id = $1",
        )
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn list_organizations(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WikiOrganizationResearchRecord>, sqlx::Error> {
        sqlx::query_as::<_, WikiOrganizationResearchRecord>(
            "SELECT id::bigint AS id, name, normalized_name, org_type, \
                    parent_org_id::bigint AS parent_org_id, parent_orgs ->> 0 AS parent_org, \
                    ownership_percentage, funding_type, funding_sources, major_advertisers, ein, \
                    annual_revenue, top_donors, media_bias_rating, factual_reporting, website, \
                    wikipedia_url, owned_by, parent_orgs, part_of, subsidiaries, headquarters, \
                    inception, official_website, cik, opensecrets_data, conflict_flags, \
                    research_sources, research_confidence \
             FROM organizations ORDER BY id LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn save_organization(
        &self,
        input: &WikiOrganizationWriteRecord,
    ) -> Result<Option<i64>, sqlx::Error> {
        wiki_save_organization_research_cache(&self.pool, input).await
    }

    pub async fn wiki_get_or_create_split_reporter(
        &self,
        name: &str,
        normalized_name: &str,
    ) -> Result<i64, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("reporter-split:{normalized_name}"))
            .execute(&mut *transaction)
            .await?;
        let existing_id = sqlx::query_scalar::<_, i32>(
            "SELECT id FROM reporters WHERE normalized_name = $1 \
             ORDER BY article_count DESC NULLS LAST, id ASC LIMIT 1",
        )
        .bind(normalized_name)
        .fetch_optional(&mut *transaction)
        .await?;
        let id = if let Some(id) = existing_id {
            i64::from(id)
        } else {
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO reporters (name, normalized_name, created_at, updated_at) \
                 VALUES ($1, $2, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', \
                         CURRENT_TIMESTAMP AT TIME ZONE 'UTC') \
                 RETURNING id::bigint",
            )
            .bind(name.trim())
            .bind(normalized_name)
            .fetch_one(&mut *transaction)
            .await?
        };
        transaction.commit().await?;
        Ok(id)
    }
}

fn json_value_is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn organization_json_list(value: Option<&Value>) -> Json<Value> {
    value
        .filter(|value| json_value_is_truthy(value))
        .cloned()
        .map(Json)
        .unwrap_or_else(empty_json_array)
}

fn organization_parent_orgs(input: &WikiOrganizationWriteRecord) -> Json<Value> {
    if let Some(parent_orgs) = input
        .parent_orgs
        .as_ref()
        .filter(|value| json_value_is_truthy(value))
    {
        return Json(parent_orgs.clone());
    }
    match input
        .parent_org
        .as_deref()
        .filter(|parent| !parent.is_empty())
    {
        Some(parent) => Json(Value::Array(vec![Value::String(parent.to_owned())])),
        None => empty_json_array(),
    }
}

async fn wiki_save_organization_research_cache(
    pool: &PgPool,
    input: &WikiOrganizationWriteRecord,
) -> Result<Option<i64>, sqlx::Error> {
    if input.normalized_name.is_empty() {
        return Ok(None);
    }
    let funding_sources = organization_json_list(input.funding_sources.as_ref());
    let major_advertisers = organization_json_list(input.major_advertisers.as_ref());
    let top_donors = organization_json_list(input.top_donors.as_ref());
    let owned_by = organization_json_list(input.owned_by.as_ref());
    let parent_orgs = organization_parent_orgs(input);
    let part_of = organization_json_list(input.part_of.as_ref());
    let subsidiaries = organization_json_list(input.subsidiaries.as_ref());
    let headquarters = organization_json_list(input.headquarters.as_ref());
    let research_sources = organization_json_list(input.research_sources.as_ref());
    let conflict_flags = organization_json_list(input.conflict_flags.as_ref());

    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("organization:{}", input.normalized_name))
        .execute(&mut *transaction)
        .await?;
    let existing_id = sqlx::query_scalar::<_, i32>(
        "SELECT id FROM organizations WHERE normalized_name = $1 ORDER BY id DESC LIMIT 1",
    )
    .bind(&input.normalized_name)
    .fetch_optional(&mut *transaction)
    .await?;
    let id = if let Some(id) = existing_id {
        sqlx::query(
            "UPDATE organizations SET name = $2, normalized_name = $3, org_type = $4, \
                    ownership_percentage = $5, funding_type = $6, funding_sources = $7, \
                    major_advertisers = $8, ein = $9, annual_revenue = $10, top_donors = $11, \
                    media_bias_rating = $12, factual_reporting = $13, website = $14, \
                    wikipedia_url = $15, research_sources = $16, research_confidence = $17, \
                    owned_by = $18, parent_orgs = $19, part_of = $20, subsidiaries = $21, \
                    headquarters = $22, inception = $23, official_website = $24, cik = $25, \
                    conflict_flags = $26, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' \
             WHERE id = $1",
        )
        .bind(id)
        .bind(&input.name)
        .bind(&input.normalized_name)
        .bind(&input.org_type)
        .bind(&input.ownership_percentage)
        .bind(&input.funding_type)
        .bind(funding_sources)
        .bind(major_advertisers)
        .bind(&input.ein)
        .bind(&input.annual_revenue)
        .bind(top_donors)
        .bind(&input.media_bias_rating)
        .bind(&input.factual_reporting)
        .bind(&input.website)
        .bind(&input.wikipedia_url)
        .bind(research_sources)
        .bind(&input.research_confidence)
        .bind(owned_by)
        .bind(parent_orgs)
        .bind(part_of)
        .bind(subsidiaries)
        .bind(headquarters)
        .bind(&input.inception)
        .bind(&input.official_website)
        .bind(&input.cik)
        .bind(conflict_flags)
        .execute(&mut *transaction)
        .await?;
        i64::from(id)
    } else {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO organizations \
             (name, normalized_name, org_type, ownership_percentage, funding_type, funding_sources, \
              major_advertisers, ein, annual_revenue, top_donors, media_bias_rating, factual_reporting, \
              website, wikipedia_url, research_sources, research_confidence, owned_by, parent_orgs, \
              part_of, subsidiaries, headquarters, inception, official_website, cik, conflict_flags, \
              opensecrets_data, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, \
                     $17, $18, $19, $20, $21, $22, $23, $24, $25, '{}'::json, \
                     CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') \
             RETURNING id::bigint",
        )
        .bind(&input.name)
        .bind(&input.normalized_name)
        .bind(&input.org_type)
        .bind(&input.ownership_percentage)
        .bind(&input.funding_type)
        .bind(funding_sources)
        .bind(major_advertisers)
        .bind(&input.ein)
        .bind(&input.annual_revenue)
        .bind(top_donors)
        .bind(&input.media_bias_rating)
        .bind(&input.factual_reporting)
        .bind(&input.website)
        .bind(&input.wikipedia_url)
        .bind(research_sources)
        .bind(&input.research_confidence)
        .bind(owned_by)
        .bind(parent_orgs)
        .bind(part_of)
        .bind(subsidiaries)
        .bind(headquarters)
        .bind(&input.inception)
        .bind(&input.official_website)
        .bind(&input.cik)
        .bind(conflict_flags)
        .fetch_one(&mut *transaction)
        .await?
    };
    transaction.commit().await?;
    Ok(Some(id))
}
