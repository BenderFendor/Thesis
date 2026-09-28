Warning: truncated output (original token count: 27607)
Total output lines: 2954

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
            .a…15607 tokens truncated…|value| !value.is_empty()) {
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
