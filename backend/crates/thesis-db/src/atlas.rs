#[path = "atlas_materialization.rs"]
mod materialization;
#[path = "atlas_timeline.rs"]
mod timeline;

pub use timeline::AtlasReporterOwnershipEdgeRecord;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Transaction};

use crate::{Database, RelationshipRecord, WikiIndexStatusRecord, WikiSourceAnalysisScoreRecord};

#[derive(Clone, Debug, FromRow)]
pub struct AtlasSourceMetadataRecord {
    pub source_name: String,
    pub source_type: Option<String>,
    pub country: Option<String>,
    pub funding_type: Option<String>,
    pub political_bias: Option<String>,
    pub factual_rating: Option<String>,
    pub credibility_score: Option<f64>,
    pub parent_company: Option<String>,
    pub research_confidence: Option<String>,
    pub geographic_focus: Option<Vec<String>>,
    pub topic_focus: Option<Vec<String>>,
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasArticleCountRecord {
    pub source: String,
    pub count: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasReporterRecord {
    pub id: i64,
    pub name: String,
    pub canonical_name: Option<String>,
    pub article_count: Option<i32>,
    pub political_leaning: Option<String>,
    pub match_status: Option<String>,
    pub research_confidence: Option<String>,
    pub author_page_url: Option<String>,
    pub canonical_author_url: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_url: Option<String>,
    pub updated_at: Option<NaiveDateTime>,
    pub last_researched_at: Option<NaiveDateTime>,
    pub retirement_reason: Option<String>,
    pub is_collective: bool,
    pub institutional_affiliations: Option<Json<Value>>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasReporterBylineCountRecord {
    pub canonical_name: String,
    pub object_entity_id: String,
    pub evidence_count: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasEvidenceEntityRecord {
    pub id: String,
    pub record_kind: String,
    pub entity_kind: String,
    pub canonical_name: String,
    pub status: String,
    pub privacy_scope: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasEntityResolutionRecord {
    pub left_entity_id: String,
    pub right_entity_id: String,
    pub decision: String,
    pub status: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasExternalIdRecord {
    pub entity_id: String,
    pub scheme: String,
    pub value: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasEvidenceClaimRecord {
    pub id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: Option<String>,
    pub object_value: Option<Json<Value>>,
    pub qualifiers: Json<Value>,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
    pub recorded_at: NaiveDateTime,
    pub retracted_at: Option<NaiveDateTime>,
    pub asserted_by: String,
    pub evidence_class: String,
    pub status: String,
    pub method_version: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasClaimEvidenceLinkRecord {
    pub claim_id: String,
    pub observation_id: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasObservationRecord {
    pub id: String,
    pub snapshot_id: String,
    pub locator: Json<Value>,
    pub quoted_text: Option<String>,
    pub structured_value: Option<Json<Value>>,
    pub context_before: Option<String>,
    pub context_after: Option<String>,
    pub extractor: String,
    pub extractor_version: String,
    pub ocr_confidence: Option<f64>,
    pub entailment: String,
    pub reviewed_by: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasSnapshotRecord {
    pub id: String,
    pub document_id: String,
    pub sha256_raw: String,
    pub retrieved_at: NaiveDateTime,
    pub sha256_canonical_text: Option<String>,
    pub extraction_tool: Option<String>,
    pub extraction_version: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasDocumentRecord {
    pub id: String,
    pub source_url: String,
    pub document_type: String,
    pub title: Option<String>,
    pub published_at: Option<NaiveDateTime>,
    pub source_class: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasAcceptedRelationshipRecord {
    pub id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: String,
    pub qualifiers: Json<Value>,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
    pub recorded_at: NaiveDateTime,
    pub retracted_at: Option<NaiveDateTime>,
    pub acceptance_policy_version: String,
    pub status: String,
    pub lifecycle_state: String,
    pub materialized_at: NaiveDateTime,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasRelationshipClaimLinkRecord {
    pub relationship_id: String,
    pub claim_id: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasSourceLineageRecord {
    pub parent_document_id: String,
    pub child_document_id: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasClaimEvidenceRootCountRecord {
    pub claim_id: String,
    pub evidence_root_count: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasRelationshipEvidenceRootCountRecord {
    pub relationship_id: String,
    pub evidence_root_count: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct CalculationTraceRecord {
    pub id: String,
    pub relationship_id: Option<String>,
    pub measurement_name: String,
    pub input_claim_ids: Json<Vec<String>>,
    pub subgraph: Json<Value>,
    pub algorithm_version: String,
    pub result: Json<Value>,
    pub created_at: NaiveDateTime,
}

#[derive(Clone, Debug)]
pub struct CalculationTraceWrite {
    pub id: String,
    pub measurement_name: String,
    pub input_claim_ids: Vec<String>,
    pub subgraph: Value,
    pub algorithm_version: String,
    pub result: Value,
}

#[derive(Clone, Debug)]
pub struct AtlasProjectionData {
    pub source_metadata: Vec<AtlasSourceMetadataRecord>,
    pub source_analysis_scores: Vec<WikiSourceAnalysisScoreRecord>,
    pub article_counts: Vec<AtlasArticleCountRecord>,
    pub wiki_index_statuses: Vec<WikiIndexStatusRecord>,
    pub reporters: Vec<AtlasReporterRecord>,
    pub reporter_byline_counts: Vec<AtlasReporterBylineCountRecord>,
    pub entities: Vec<AtlasEvidenceEntityRecord>,
    pub entity_resolutions: Vec<AtlasEntityResolutionRecord>,
    pub external_ids: Vec<AtlasExternalIdRecord>,
    pub claims: Vec<AtlasEvidenceClaimRecord>,
    pub claim_evidence_links: Vec<AtlasClaimEvidenceLinkRecord>,
    pub observations: Vec<AtlasObservationRecord>,
    pub snapshots: Vec<AtlasSnapshotRecord>,
    pub documents: Vec<AtlasDocumentRecord>,
    pub accepted_relationships: Vec<AtlasAcceptedRelationshipRecord>,
    pub relationship_claim_links: Vec<AtlasRelationshipClaimLinkRecord>,
    pub source_lineage: Vec<AtlasSourceLineageRecord>,
    pub claim_evidence_root_counts: Vec<AtlasClaimEvidenceRootCountRecord>,
    pub relationship_evidence_root_counts: Vec<AtlasRelationshipEvidenceRootCountRecord>,
    pub calculation_traces: Vec<CalculationTraceRecord>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasSourceClaimRecord {
    pub id: i64,
    pub source_name: String,
    pub claim_type: String,
    pub claim_value: Json<Value>,
    pub claim_kind: String,
    pub confidence: Option<f64>,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasSourceClaimEvidenceRecord {
    pub claim_id: i64,
    pub source_type: String,
    pub source_name: Option<String>,
    pub source_url: String,
    pub retrieved_at: NaiveDateTime,
    pub raw_excerpt: Option<String>,
    pub raw_hash: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasReporterDetailRecord {
    pub id: i64,
    pub name: String,
    pub canonical_name: Option<String>,
    pub author_page_url: Option<String>,
    pub canonical_author_url: Option<String>,
    pub wikipedia_url: Option<String>,
    pub wikidata_url: Option<String>,
    pub career_history: Option<Json<Value>>,
    pub topics: Option<Vec<String>>,
    pub education: Option<Json<Value>>,
    pub political_leaning: Option<String>,
    pub leaning_confidence: Option<String>,
    pub research_sources: Option<Json<Value>>,
    pub match_status: Option<String>,
    pub research_confidence: Option<String>,
    pub match_explanation: Option<String>,
    pub institutional_affiliations: Option<Json<Value>>,
    pub updated_at: Option<NaiveDateTime>,
    pub last_researched_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasLegacyOrganizationRecord {
    pub funding_type: Option<String>,
    pub funding_sources: Option<Json<Value>>,
    pub major_advertisers: Option<Json<Value>>,
    pub annual_revenue: Option<String>,
    pub website: Option<String>,
    pub official_website: Option<String>,
    pub wikipedia_url: Option<String>,
    pub research_sources: Option<Json<Value>>,
    pub conflict_flags: Option<Json<Value>>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
    pub last_researched_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug)]
pub struct AtlasEntityDetailData {
    pub projection: AtlasProjectionData,
    pub source_name: Option<String>,
    pub source_metadata: Option<AtlasSourceMetadataRecord>,
    pub source_claims: Vec<AtlasSourceClaimRecord>,
    pub source_claim_evidence: Vec<AtlasSourceClaimEvidenceRecord>,
    pub source_analysis_scores: Vec<WikiSourceAnalysisScoreRecord>,
    pub reporter: Option<AtlasReporterDetailRecord>,
    pub evidence_entity: Option<AtlasEvidenceEntityRecord>,
    pub external_ids: Vec<AtlasExternalIdRecord>,
    pub accepted_attribute_claims: Vec<AtlasEvidenceClaimRecord>,
    pub claim_evidence_links: Vec<AtlasClaimEvidenceLinkRecord>,
    pub observations: Vec<AtlasObservationRecord>,
    pub snapshots: Vec<AtlasSnapshotRecord>,
    pub documents: Vec<AtlasDocumentRecord>,
    pub legacy_organization: Option<AtlasLegacyOrganizationRecord>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasMediaArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub content: Option<String>,
    pub published_at: NaiveDateTime,
    pub author: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasMediaArticleAuthorRecord {
    pub article_id: i64,
    pub reporter_name: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasMediaOwnershipRelationshipRecord {
    pub id: String,
    pub object_entity_id: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct AtlasOwnerEntityRecord {
    pub id: String,
    pub canonical_name: String,
}

#[derive(Clone, Debug)]
pub struct AtlasMediaMeasurementData {
    pub articles: Vec<AtlasMediaArticleRecord>,
    pub article_authors: Vec<AtlasMediaArticleAuthorRecord>,
    pub ownership_relationships: Vec<AtlasMediaOwnershipRelationshipRecord>,
    pub owner_entities: Vec<AtlasOwnerEntityRecord>,
}

#[derive(Clone, Debug, FromRow)]
pub struct RelationshipProofEndpoint {
    pub id: String,
    pub record_kind: String,
    pub canonical_name: String,
    pub privacy_scope: String,
}

#[derive(Clone, Debug)]
pub struct RelationshipProofClaim {
    pub id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: Option<String>,
    pub object_value: Option<Json<Value>>,
    pub qualifiers: Json<Value>,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
    pub recorded_at: NaiveDateTime,
    pub retracted_at: Option<NaiveDateTime>,
    pub asserted_by: String,
    pub evidence_class: String,
    pub status: String,
    pub method_version: String,
    pub observation_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RelationshipProofData {
    pub relationship: AtlasAcceptedRelationshipRecord,
    pub subject: RelationshipProofEndpoint,
    pub object_entity: RelationshipProofEndpoint,
    pub claims: Vec<RelationshipProofClaim>,
    pub observations: Vec<AtlasObservationRecord>,
    pub snapshots: Vec<AtlasSnapshotRecord>,
    pub documents: Vec<AtlasDocumentRecord>,
    pub calculation_traces: Vec<CalculationTraceRecord>,
}

#[derive(Debug)]
pub enum RelationshipProofLoadError {
    NotFound,
    EndpointsNotFound,
    Database(sqlx::Error),
}

impl std::fmt::Display for RelationshipProofLoadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("relationship not found"),
            Self::EndpointsNotFound => formatter.write_str("relationship endpoints do not resolve"),
            Self::Database(error) => {
                write!(formatter, "failed to load relationship proof: {error}")
            }
        }
    }
}

impl std::error::Error for RelationshipProofLoadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::NotFound | Self::EndpointsNotFound => None,
        }
    }
}

impl From<sqlx::Error> for RelationshipProofLoadError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug)]
pub enum MaterializeClaimError {
    EvidenceSpine(String),
    Database(sqlx::Error),
}

impl std::fmt::Display for MaterializeClaimError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EvidenceSpine(message) => formatter.write_str(message),
            Self::Database(error) => {
                write!(formatter, "failed to materialize evidence claim: {error}")
            }
        }
    }
}

impl std::error::Error for MaterializeClaimError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::EvidenceSpine(_) => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for MaterializeClaimError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

async fn fetch_observations(
    executor: &mut Transaction<'_, Postgres>,
    ids: &[String],
) -> Result<Vec<AtlasObservationRecord>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, AtlasObservationRecord>(
        "SELECT id, snapshot_id, locator, quoted_text, structured_value, context_before, \
                context_after, extractor, extractor_version, ocr_confidence, entailment, reviewed_by \
         FROM evidence_observations WHERE id = ANY($1) ORDER BY id",
    )
    .bind(ids)
    .fetch_all(&mut **executor)
    .await
}

async fn fetch_snapshots(
    executor: &mut Transaction<'_, Postgres>,
    ids: &[String],
) -> Result<Vec<AtlasSnapshotRecord>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, AtlasSnapshotRecord>(
        "SELECT id, document_id, sha256_raw, retrieved_at, sha256_canonical_text, \
                extraction_tool, extraction_version FROM document_snapshots \
         WHERE id = ANY($1) ORDER BY id",
    )
    .bind(ids)
    .fetch_all(&mut **executor)
    .await
}

async fn fetch_documents(
    executor: &mut Transaction<'_, Postgres>,
    ids: &[String],
) -> Result<Vec<AtlasDocumentRecord>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, AtlasDocumentRecord>(
        "SELECT id, source_url, document_type, title, published_at, source_class \
         FROM evidence_documents WHERE id = ANY($1) ORDER BY id",
    )
    .bind(ids)
    .fetch_all(&mut **executor)
    .await
}

async fn fetch_claim_evidence_links(
    executor: &mut Transaction<'_, Postgres>,
    claim_ids: &[String],
) -> Result<Vec<AtlasClaimEvidenceLinkRecord>, sqlx::Error> {
    if claim_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, AtlasClaimEvidenceLinkRecord>(
        "SELECT claim_id, observation_id FROM claim_evidence_links \
         WHERE claim_id = ANY($1) ORDER BY claim_id, observation_id",
    )
    .bind(claim_ids)
    .fetch_all(&mut **executor)
    .await
}

async fn root_ids_by_claim(
    executor: &mut Transaction<'_, Postgres>,
    claim_ids: &[String],
    lineage: &[AtlasSourceLineageRecord],
) -> Result<BTreeMap<String, BTreeSet<String>>, sqlx::Error> {
    let mut result = BTreeMap::<String, BTreeSet<String>>::new();
    if claim_ids.is_empty() {
        return Ok(result);
    }
    let evidence_documents = sqlx::query_as::<_, (String, String)>(
        "SELECT links.claim_id, snapshots.document_id \
         FROM claim_evidence_links AS links \
         JOIN evidence_observations AS observations ON observations.id = links.observation_id \
         JOIN document_snapshots AS snapshots ON snapshots.id = observations.snapshot_id \
         WHERE links.claim_id = ANY($1)",
    )
    .bind(claim_ids)
    .fetch_all(&mut **executor)
    .await?;
    let roots = lineage_root_map(lineage);
    for (claim_id, document_id) in evidence_documents {
        result
            .entry(claim_id)
            .or_default()
            .insert(roots.get(&document_id).cloned().unwrap_or(document_id));
    }
    Ok(result)
}

fn lineage_root_map(lineage: &[AtlasSourceLineageRecord]) -> HashMap<String, String> {
    fn resolve(
        id: &str,
        parents: &BTreeMap<String, BTreeSet<String>>,
        cache: &mut HashMap<String, String>,
        stack: &mut HashSet<String>,
    ) -> String {
        if let Some(root) = cache.get(id) {
            return root.clone();
        }
        if !stack.insert(id.to_owned()) {
            return id.to_owned();
        }
        let root = match parents.get(id) {
            None => id.to_owned(),
            Some(upstream) => upstream
                .iter()
                .map(|parent| resolve(parent, parents, cache, stack))
                .min()
                .unwrap_or_else(|| id.to_owned()),
        };
        stack.remove(id);
        cache.insert(id.to_owned(), root.clone());
        root
    }

    let mut parents = BTreeMap::<String, BTreeSet<String>>::new();
    let mut documents = BTreeSet::new();
    for edge in lineage {
        parents
            .entry(edge.child_document_id.clone())
            .or_default()
            .insert(edge.parent_document_id.clone());
        documents.insert(edge.parent_document_id.clone());
        documents.insert(edge.child_document_id.clone());
    }
    let mut cache = HashMap::new();
    for document in documents {
        resolve(&document, &parents, &mut cache, &mut HashSet::new());
    }
    cache
}

async fn load_projection(
    pool: &PgPool,
    as_of: NaiveDateTime,
    known_at: NaiveDateTime,
    reporter_limit: Option<i64>,
) -> Result<AtlasProjectionData, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let source_metadata = sqlx::query_as::<_, AtlasSourceMetadataRecord>(
        "SELECT source_name, source_type, country, funding_type, political_bias, factual_rating, \
                credibility_score, parent_company, research_confidence, geographic_focus, \
                topic_focus, updated_at FROM source_metadata",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let source_analysis_scores = sqlx::query_as::<_, WikiSourceAnalysisScoreRecord>(
        "SELECT source_name, axis_name, score, confidence, prose_explanation, citations, \
                empirical_basis, scored_by, last_scored_at FROM source_analysis_scores",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let article_counts = sqlx::query_as::<_, AtlasArticleCountRecord>(
        "SELECT source, COUNT(*)::bigint AS count FROM articles GROUP BY source",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let wiki_index_statuses = sqlx::query_as::<_, WikiIndexStatusRecord>(
        "SELECT entity_type, entity_name, status, last_indexed_at FROM wiki_index_status",
    )
    .fetch_all(&mut *transaction)
    .await?;

    let mut reporter_query = QueryBuilder::<Postgres>::new(
        "SELECT id, name, canonical_name, article_count, political_leaning, match_status, \
                research_confidence, author_page_url, canonical_author_url, wikipedia_url, \
                wikidata_url, updated_at, last_researched_at, retirement_reason, is_collective, \
                institutional_affiliations FROM reporters \
         WHERE article_count > 0 AND retirement_reason IS NULL AND is_collective = FALSE \
         ORDER BY article_count DESC",
    );
    if let Some(limit) = reporter_limit {
        reporter_query.push(" LIMIT ").push_bind(limit);
    }
    let reporters = reporter_query
        .build_query_as::<AtlasReporterRecord>()
        .fetch_all(&mut *transaction)
        .await?;

    let reporter_byline_counts = sqlx::query_as::<_, AtlasReporterBylineCountRecord>(
        "SELECT entities.canonical_name, claims.object_entity_id, \
                COUNT(DISTINCT links.observation_id)::bigint AS evidence_count \
         FROM evidence_claims AS claims \
         JOIN evidence_entities AS entities ON entities.id = claims.subject_entity_id \
         JOIN claim_evidence_links AS links ON links.claim_id = claims.id \
         WHERE claims.predicate IN ('authored_by', 'employed_by') \
           AND claims.object_entity_id IS NOT NULL AND claims.retracted_at IS NULL \
           AND entities.record_kind = 'person' \
         GROUP BY entities.canonical_name, claims.object_entity_id",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let entities = sqlx::query_as::<_, AtlasEvidenceEntityRecord>(
        "SELECT entity.id, entity.record_kind, entity.entity_kind, entity.canonical_name, \
                entity.status, entity.privacy_scope, entity.created_at, entity.updated_at \
         FROM evidence_entities AS entity \
         WHERE entity.record_kind IN ( \
             'legal_entity', 'organization_without_legal_identity', 'public_company', 'nonprofit', \
             'family_control_group', 'trust', 'government_award', 'seller_account', 'person', \
             'publication', 'publication_brand', 'digital_property', 'feed', 'broadcast_station' \
         ) AND entity.status <> 'merged' \
           AND NOT EXISTS (SELECT 1 FROM entity_resolutions AS resolution \
                           WHERE resolution.left_entity_id = entity.id \
                             AND resolution.decision = 'same_as' AND resolution.status = 'accepted')",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let entity_resolutions = sqlx::query_as::<_, AtlasEntityResolutionRecord>(
        "SELECT left_entity_id, right_entity_id, decision, status FROM entity_resolutions \
         WHERE decision = 'same_as' AND status = 'accepted'",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let external_ids = sqlx::query_as::<_, AtlasExternalIdRecord>(
        "SELECT entity_id, scheme, value FROM entity_external_ids",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let accepted_relationships = sqlx::query_as::<_, AtlasAcceptedRelationshipRecord>(
        "SELECT id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, valid_to, \
                recorded_at, retracted_at, acceptance_policy_version, status, lifecycle_state, materialized_at \
         FROM accepted_relationships \
         WHERE predicate IN ('directly_owns', 'owns_equity_in', 'controls', 'brand_of', 'operated_by', \
             'successor_of', 'founded_by', 'employed_by', 'authored_by', 'publishes', 'distributed_by', \
             'syndicated_by', 'authorizes_inventory_seller', 'sponsors_content', 'political_ad_purchase', \
             'advertising_inventory_sold_by', 'funds') \
           AND (valid_from IS NULL OR valid_from <= $1) AND (valid_to IS NULL OR valid_to >= $1) \
           AND recorded_at <= $2 AND (retracted_at IS NULL OR retracted_at > $2)",
    )
    .bind(as_of)
    .bind(known_at)
    .fetch_all(&mut *transaction)
    .await?;
    let accepted_ids = accepted_relationships
        .iter()
        .map(|row| row.id.clone())
        .collect::<Vec<_>>();
    let relationship_claim_links = if accepted_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, AtlasRelationshipClaimLinkRecord>(
            "SELECT relationship_id, claim_id FROM relationship_claim_links \
             WHERE relationship_id = ANY($1) ORDER BY relationship_id, claim_id",
        )
        .bind(&accepted_ids)
        .fetch_all(&mut *transaction)
        .await?
    };
    let claims = sqlx::query_as::<_, AtlasEvidenceClaimRecord>(
        "SELECT claim.id, claim.subject_entity_id, claim.predicate, claim.object_entity_id, \
                claim.object_value, claim.qualifiers, claim.valid_from, claim.valid_to, \
                claim.recorded_at, claim.retracted_at, claim.asserted_by, claim.evidence_class, \
                claim.status, claim.method_version \
         FROM evidence_claims AS claim \
         WHERE ( \
             (claim.predicate IN ('directly_owns', 'owns_equity_in', 'controls', 'brand_of', \
                 'operated_by', 'successor_of', 'founded_by', 'employed_by', 'authored_by', \
                 'publishes', 'distributed_by', 'syndicated_by', 'authorizes_inventory_seller', \
                 'sponsors_content', 'political_ad_purchase', 'advertising_inventory_sold_by', 'funds') \
              AND claim.status = 'candidate' AND claim.object_entity_id IS NOT NULL \
              AND (claim.valid_from IS NULL OR claim.valid_from <= $1) \
              AND (claim.valid_to IS NULL OR claim.valid_to >= $1) \
              AND claim.recorded_at <= $2 AND (claim.retracted_at IS NULL OR claim.retracted_at > $2)) \
             OR claim.id IN (SELECT link.claim_id FROM relationship_claim_links AS link \
                 JOIN accepted_relationships AS relationship ON relationship.id = link.relationship_id \
                 WHERE relationship.predicate IN ('directly_owns', 'owns_equity_in', 'controls', 'brand_of', \
                     'operated_by', 'successor_of', 'founded_by', 'employed_by', 'authored_by', 'publishes', \
                     'distributed_by', 'syndicated_by', 'authorizes_inventory_seller', 'sponsors_content', \
                     'political_ad_purchase', 'advertising_inventory_sold_by', 'funds') \
                   AND (relationship.valid_from IS NULL OR relationship.valid_from <= $1) \
                   AND (relationship.valid_to IS NULL OR relationship.valid_to >= $1) \
                   AND relationship.recorded_at <= $2 \
                   AND (relationship.retracted_at IS NULL OR relationship.retracted_at > $2)) \
             OR (claim.predicate IN ('authored_by', 'employed_by') AND claim.object_entity_id IS NOT NULL \
                 AND claim.retracted_at IS NULL))",
    )
    .bind(as_of)
    .bind(known_at)
    .fetch_all(&mut *transaction)
    .await?;
    let claim_ids = claims.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let claim_evidence_links = fetch_claim_evidence_links(&mut transaction, &claim_ids).await?;
    let observation_ids = claim_evidence_links
        .iter()
        .map(|row| row.observation_id.clone())
        .collect::<Vec<_>>();
    let observations = fetch_observations(&mut transaction, &observation_ids).await?;
    let snapshot_ids = observations
        .iter()
        .map(|row| row.snapshot_id.clone())
        .collect::<Vec<_>>();
    let snapshots = fetch_snapshots(&mut transaction, &snapshot_ids).await?;
    let document_ids = snapshots
        .iter()
        .map(|row| row.document_id.clone())
        .collect::<Vec<_>>();
    let documents = fetch_documents(&mut transaction, &document_ids).await?;
    let source_lineage = sqlx::query_as::<_, AtlasSourceLineageRecord>(
        "SELECT parent_document_id, child_document_id FROM source_lineage",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let roots_by_claim = root_ids_by_claim(&mut transaction, &claim_ids, &source_lineage).await?;
    let claim_evidence_root_counts = roots_by_claim
        .iter()
        .map(|(claim_id, roots)| AtlasClaimEvidenceRootCountRecord {
            claim_id: claim_id.clone(),
            evidence_root_count: roots.len() as i64,
        })
        .collect::<Vec<_>>();
    let mut roots_by_relationship = BTreeMap::<String, BTreeSet<String>>::new();
    for link in &relationship_claim_links {
        if let Some(roots) = roots_by_claim.get(&link.claim_id) {
            roots_by_relationship
                .entry(link.relationship_id.clone())
                .or_default()
                .extend(roots.iter().cloned());
        }
    }
    let relationship_evidence_root_counts = roots_by_relationship
        .iter()
        .map(
            |(relationship_id, roots)| AtlasRelationshipEvidenceRootCountRecord {
                relationship_id: relationship_id.clone(),
                evidence_root_count: roots.len() as i64,
            },
        )
        .collect::<Vec<_>>();
    let calculation_traces = if accepted_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, CalculationTraceRecord>(
            "SELECT id, relationship_id, measurement_name, input_claim_ids, subgraph, \
                    algorithm_version, result, created_at FROM calculation_traces \
             WHERE measurement_name = 'ownership_interest' AND relationship_id = ANY($1) \
             ORDER BY id",
        )
        .bind(&accepted_ids)
        .fetch_all(&mut *transaction)
        .await?
    };
    transaction.commit().await?;
    Ok(AtlasProjectionData {
        source_metadata,
        source_analysis_scores,
        article_counts,
        wiki_index_statuses,
        reporters,
        reporter_byline_counts,
        entities,
        entity_resolutions,
        external_ids,
        claims,
        claim_evidence_links,
        observations,
        snapshots,
        documents,
        accepted_relationships,
        relationship_claim_links,
        source_lineage,
        claim_evidence_root_counts,
        relationship_evidence_root_counts,
        calculation_traces,
    })
}

async fn load_media_measurement_data(
    pool: &PgPool,
    source_name: Option<&str>,
) -> Result<AtlasMediaMeasurementData, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let mut article_query = QueryBuilder::<Postgres>::new(
        "SELECT id::bigint AS id, title, source, content, published_at, author, tags FROM articles",
    );
    if let Some(source_name) = source_name.filter(|value| !value.is_empty()) {
        article_query
            .push(" WHERE source = ")
            .push_bind(source_name);
    }
    let articles = article_query
        .push(" ORDER BY published_at")
        .build_query_as::<AtlasMediaArticleRecord>()
        .fetch_all(&mut *transaction)
        .await?;
    let article_ids = articles.iter().map(|row| row.id).collect::<Vec<_>>();
    let article_authors = if article_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, AtlasMediaArticleAuthorRecord>(
            "SELECT authors.article_id::bigint AS article_id, reporters.name AS reporter_name \
             FROM article_authors AS authors \
             JOIN reporters ON reporters.id = authors.reporter_id \
             WHERE authors.article_id = ANY($1) \
             ORDER BY authors.article_id, reporters.name",
        )
        .bind(&article_ids)
        .fetch_all(&mut *transaction)
        .await?
    };
    let ownership_relationships = sqlx::query_as::<_, AtlasMediaOwnershipRelationshipRecord>(
        "SELECT id, object_entity_id FROM accepted_relationships \
         WHERE predicate IN ('directly_owns', 'controls', 'owns_equity_in') \
           AND status = 'accepted' AND lifecycle_state = 'current' AND valid_to IS NULL",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let owner_ids = ownership_relationships
        .iter()
        .map(|row| row.object_entity_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let owner_entities = if owner_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, AtlasOwnerEntityRecord>(
            "SELECT id, canonical_name FROM evidence_entities WHERE id = ANY($1)",
        )
        .bind(&owner_ids)
        .fetch_all(&mut *transaction)
        .await?
    };
    transaction.commit().await?;
    Ok(AtlasMediaMeasurementData {
        articles,
        article_authors,
        ownership_relationships,
        owner_entities,
    })
}

async fn load_relationship_proof_data(
    pool: &PgPool,
    relationship_id: &str,
) -> Result<Option<RelationshipProofData>, RelationshipProofLoadError> {
    let mut transaction = pool.begin().await?;
    let Some(relationship) = sqlx::query_as::<_, AtlasAcceptedRelationshipRecord>(
        "SELECT id, subject_entity_id, predicate, object_entity_id, qualifiers, valid_from, valid_to, \
                recorded_at, retracted_at, acceptance_policy_version, status, lifecycle_state, materialized_at \
         FROM accepted_relationships WHERE id = $1",
    )
    .bind(relationship_id)
    .fetch_optional(&mut *transaction)
    .await?
    else {
        transaction.rollback().await?;
        return Ok(None);
    };
    let endpoint_ids = [
        relationship.subject_entity_id.clone(),
        relationship.object_entity_id.clone(),
    ];
    let endpoints = sqlx::query_as::<_, RelationshipProofEndpoint>(
        "SELECT id, record_kind, canonical_name, privacy_scope FROM evidence_entities \
         WHERE id = ANY($1) ORDER BY id",
    )
    .bind(endpoint_ids.as_slice())
    .fetch_all(&mut *transaction)
    .await?;
    let by_id = endpoints
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect::<HashMap<_, _>>();
    let Some(subject) = by_id.get(&relationship.subject_entity_id).cloned() else {
        return Err(RelationshipProofLoadError::EndpointsNotFound);
    };
    let Some(object_entity) = by_id.get(&relationship.object_entity_id).cloned() else {
        return Err(RelationshipProofLoadError::EndpointsNotFound);
    };
    let link_rows = sqlx::query_as::<_, AtlasRelationshipClaimLinkRecord>(
        "SELECT relationship_id, claim_id FROM relationship_claim_links \
         WHERE relationship_id = $1 ORDER BY claim_id",
    )
    .bind(relationship_id)
    .fetch_all(&mut *transaction)
    .await?;
    let claim_ids = link_rows
        .iter()
        .map(|row| row.claim_id.clone())
        .collect::<Vec<_>>();
    let claim_rows = if claim_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, AtlasEvidenceClaimRecord>(
            "SELECT id, subject_entity_id, predicate, object_entity_id, object_value, qualifiers, \
                    valid_from, valid_to, recorded_at, retracted_at, asserted_by, evidence_class, status, method_version \
             FROM evidence_claims WHERE id = ANY($1) ORDER BY id",
        )
        .bind(&claim_ids)
        .fetch_all(&mut *transaction)
        .await?
    };
    let claim_evidence_links = fetch_claim_evidence_links(&mut transaction, &claim_ids).await?;
    let mut observation_ids_by_claim = BTreeMap::<String, Vec<String>>::new();
    for link in &claim_evidence_links {
        observation_ids_by_claim
            .entry(link.claim_id.clone())
            .or_default()
            .push(link.observation_id.clone());
    }
    let claims = claim_rows
        .into_iter()
        .map(|claim| RelationshipProofClaim {
            observation_ids: observation_ids_by_claim
                .remove(&claim.id)
                .unwrap_or_default(),
            id: claim.id,
            subject_entity_id: claim.subject_entity_id,
            predicate: claim.predicate,
            object_entity_id: claim.object_entity_id,
            object_value: claim.object_value,
            qualifiers: claim.qualifiers,
            valid_from: claim.valid_from,
            valid_to: claim.valid_to,
            recorded_at: claim.recorded_at,
            retracted_at: claim.retracted_at,
            asserted_by: claim.asserted_by,
            evidence_class: claim.evidence_class,
            status: claim.status,
            method_version: claim.method_version,
        })
        .collect::<Vec<_>>();
    let observation_ids = claim_evidence_links
        .iter()
        .map(|row| row.observation_id.clone())
        .collect::<Vec<_>>();
    let observations = fetch_observations(&mut transaction, &observation_ids).await?;
    let snapshot_ids = observations
        .iter()
        .map(|row| row.snapshot_id.clone())
        .collect::<Vec<_>>();
    let snapshots = fetch_snapshots(&mut transaction, &snapshot_ids).await?;
    let document_ids = snapshots
        .iter()
        .map(|row| row.document_id.clone())
        .collect::<Vec<_>>();
    let documents = fetch_documents(&mut transaction, &document_ids).await?;
    let calculation_traces = sqlx::query_as::<_, CalculationTraceRecord>(
        "SELECT id, relationship_id, measurement_name, input_claim_ids, subgraph, algorithm_version, result, created_at \
         FROM calculation_traces WHERE relationship_id = $1 ORDER BY id",
    )
    .bind(relationship_id)
    .fetch_all(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(Some(RelationshipProofData {
        relationship,
        subject,
        object_entity,
        claims,
        observations,
        snapshots,
        documents,
        calculation_traces,
    }))
}

impl Database {
    pub async fn load_atlas_projection_data(
        &self,
        as_of: NaiveDateTime,
        known_at: NaiveDateTime,
        reporter_limit: Option<i64>,
    ) -> Result<AtlasProjectionData, sqlx::Error> {
        load_projection(&self.pool, as_of, known_at, reporter_limit).await
    }

    pub async fn load_atlas_media_measurement_data(
        &self,
        source_name: Option<&str>,
    ) -> Result<AtlasMediaMeasurementData, sqlx::Error> {
        load_media_measurement_data(&self.pool, source_name).await
    }

    pub async fn load_relationship_proof_data(
        &self,
        relationship_id: &str,
    ) -> Result<Option<RelationshipProofData>, RelationshipProofLoadError> {
        load_relationship_proof_data(&self.pool, relationship_id).await
    }
}
async fn load_claim_evidence_data(
    pool: &PgPool,
    claim_ids: &[String],
) -> Result<
    (
        Vec<AtlasClaimEvidenceLinkRecord>,
        Vec<AtlasObservationRecord>,
        Vec<AtlasSnapshotRecord>,
        Vec<AtlasDocumentRecord>,
    ),
    sqlx::Error,
> {
    let mut transaction = pool.begin().await?;
    let links = fetch_claim_evidence_links(&mut transaction, claim_ids).await?;
    let observation_ids = links
        .iter()
        .map(|row| row.observation_id.clone())
        .collect::<Vec<_>>();
    let observations = fetch_observations(&mut transaction, &observation_ids).await?;
    let snapshot_ids = observations
        .iter()
        .map(|row| row.snapshot_id.clone())
        .collect::<Vec<_>>();
    let snapshots = fetch_snapshots(&mut transaction, &snapshot_ids).await?;
    let document_ids = snapshots
        .iter()
        .map(|row| row.document_id.clone())
        .collect::<Vec<_>>();
    let documents = fetch_documents(&mut transaction, &document_ids).await?;
    transaction.commit().await?;
    Ok((links, observations, snapshots, documents))
}

async fn resolve_outlet_source(
    pool: &PgPool,
    outlet_id: &str,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT entities.id, entities.canonical_name \
         FROM entity_external_ids AS external_id \
         JOIN evidence_entities AS entities ON entities.id = external_id.entity_id \
         WHERE external_id.scheme = 'rss_catalog_key' AND 'outlet:' || external_id.value = $1 \
         LIMIT 1",
    )
    .bind(outlet_id)
    .fetch_optional(pool)
    .await
}

async fn load_atlas_entity_detail_data(
    pool: &PgPool,
    entity_id: &str,
) -> Result<Option<AtlasEntityDetailData>, sqlx::Error> {
    let now = chrono::Utc::now().naive_utc();
    let projection = load_projection(pool, now, now, None).await?;
    let mut source_name = None;
    let mut evidence_entity_id = None;
    let mut reporter_id = None;
    if let Some(outlet_id) = entity_id.strip_prefix("outlet:") {
        if let Some((id, name)) =
            resolve_outlet_source(pool, &format!("outlet:{outlet_id}")).await?
        {
            evidence_entity_id = Some(id);
            source_name = Some(name);
        }
    } else if let Some(id) = entity_id
        .strip_prefix("organization:")
        .or_else(|| entity_id.strip_prefix("person:"))
    {
        evidence_entity_id = Some(id.to_owned());
    } else if let Some(id) = entity_id.strip_prefix("reporter:") {
        reporter_id = id.parse::<i64>().ok();
    } else if !entity_id.contains(':') {
        evidence_entity_id = Some(entity_id.to_owned());
    }

    let evidence_entity = if let Some(id) = evidence_entity_id.as_deref() {
        sqlx::query_as::<_, AtlasEvidenceEntityRecord>(
            "SELECT id, record_kind, entity_kind, canonical_name, status, privacy_scope, \
                    created_at, updated_at FROM evidence_entities WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };
    if source_name.is_none() && entity_id.starts_with("outlet:") {
        source_name = evidence_entity
            .as_ref()
            .map(|entity| entity.canonical_name.clone());
    }
    let source_metadata = if let Some(name) = source_name.as_deref() {
        sqlx::query_as::<_, AtlasSourceMetadataRecord>(
            "SELECT source_name, source_type, country, funding_type, political_bias, factual_rating, \
                    credibility_score, parent_company, research_confidence, geographic_focus, \
                    topic_focus, updated_at FROM source_metadata WHERE source_name = $1 LIMIT 1",
        )
        .bind(name)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };
    let source_claims = if let Some(name) = source_name.as_deref() {
        sqlx::query_as::<_, AtlasSourceClaimRecord>(
            "SELECT id, source_name, claim_type, claim_value, claim_kind, confidence, valid_from, valid_to \
             FROM source_claims WHERE source_name = $1 AND is_current = TRUE ORDER BY id",
        )
        .bind(name)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };
    let source_claim_ids = source_claims.iter().map(|row| row.id).collect::<Vec<_>>();
    let source_claim_evidence = if source_claim_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, AtlasSourceClaimEvidenceRecord>(
            "SELECT claim_id, source_type, source_name, source_url, retrieved_at, raw_excerpt, raw_hash \
             FROM source_claim_evidence WHERE claim_id = ANY($1) ORDER BY claim_id, id",
        )
        .bind(&source_claim_ids)
        .fetch_all(pool)
        .await?
    };
    let source_analysis_scores = if let Some(name) = source_name.as_deref() {
        sqlx::query_as::<_, WikiSourceAnalysisScoreRecord>(
            "SELECT source_name, axis_name, score, confidence, prose_explanation, citations, \
                    empirical_basis, scored_by, last_scored_at FROM source_analysis_scores \
             WHERE source_name = $1",
        )
        .bind(name)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };
    let reporter = if let Some(id) = reporter_id {
        sqlx::query_as::<_, AtlasReporterDetailRecord>(
            "SELECT id, name, canonical_name, author_page_url, canonical_author_url, wikipedia_url, \
                    wikidata_url, career_history, topics, education, political_leaning, \
                    leaning_confidence, research_sources, match_status, research_confidence, \
                    match_explanation, institutional_affiliations, updated_at, last_researched_at \
             FROM reporters WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };
    let external_ids = if let Some(id) = evidence_entity_id.as_deref() {
        sqlx::query_as::<_, AtlasExternalIdRecord>(
            "SELECT entity_id, scheme, value FROM entity_external_ids \
             WHERE entity_id = $1 ORDER BY scheme, value",
        )
        .bind(id)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };
    let accepted_attribute_claims = if let Some(id) = evidence_entity_id.as_deref() {
        sqlx::query_as::<_, AtlasEvidenceClaimRecord>(
            "SELECT id, subject_entity_id, predicate, object_entity_id, object_value, qualifiers, \
                    valid_from, valid_to, recorded_at, retracted_at, asserted_by, evidence_class, \
                    status, method_version FROM evidence_claims \
             WHERE subject_entity_id = $1 AND predicate IN ('funding_type', 'political_bias', 'factual_reporting') \
               AND status = 'accepted' AND retracted_at IS NULL ORDER BY id",
        )
        .bind(id)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };
    let attribute_claim_ids = accepted_attribute_claims
        .iter()
        .map(|claim| claim.id.clone())
        .collect::<Vec<_>>();
    let (claim_evidence_links, observations, snapshots, documents) =
        load_claim_evidence_data(pool, &attribute_claim_ids).await?;
    let legacy_organization = if let Some(id) = evidence_entity_id.as_deref() {
        sqlx::query_as::<_, AtlasLegacyOrganizationRecord>(
            "SELECT organization.funding_type, organization.funding_sources, \
                    organization.major_advertisers, organization.annual_revenue, \
                    organization.website, organization.official_website, organization.wikipedia_url, \
                    organization.research_sources, organization.conflict_flags, \
                    organization.media_bias_rating, organization.factual_reporting, \
                    organization.last_researched_at \
             FROM entity_external_ids AS external_id \
             JOIN organizations AS organization ON organization.id::text = external_id.value \
             WHERE external_id.entity_id = $1 AND external_id.scheme = 'legacy_organization_id' \
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };
    if source_name.is_none() && evidence_entity.is_none() && reporter.is_none() {
        return Ok(None);
    }
    Ok(Some(AtlasEntityDetailData {
        projection,
        source_name,
        source_metadata,
        source_claims,
        source_claim_evidence,
        source_analysis_scores,
        reporter,
        evidence_entity,
        external_ids,
        accepted_attribute_claims,
        claim_evidence_links,
        observations,
        snapshots,
        documents,
        legacy_organization,
    }))
}

impl Database {
    pub async fn load_atlas_entity_detail_data(
        &self,
        entity_id: &str,
    ) -> Result<Option<AtlasEntityDetailData>, sqlx::Error> {
        load_atlas_entity_detail_data(&self.pool, entity_id).await
    }

    pub async fn persist_calculation_traces(
        &self,
        traces: Vec<CalculationTraceWrite>,
    ) -> Result<Vec<CalculationTraceRecord>, sqlx::Error> {
        if traces.is_empty() {
            return Ok(Vec::new());
        }
        let mut transaction = self.pool.begin().await?;
        let mut query = QueryBuilder::<Postgres>::new(
            "INSERT INTO calculation_traces \
             (id, relationship_id, measurement_name, input_claim_ids, subgraph, algorithm_version, result, created_at) ",
        );
        query.push_values(&traces, |mut row, trace| {
            row.push_bind(&trace.id)
                .push_bind(Option::<String>::None)
                .push_bind(&trace.measurement_name)
                .push_bind(Json(&trace.input_claim_ids))
                .push_bind(Json(&trace.subgraph))
                .push_bind(&trace.algorithm_version)
                .push_bind(Json(&trace.result))
                .push_bind(chrono::Utc::now().naive_utc());
        });
        query.push(" ON CONFLICT (id) DO NOTHING");
        query.build().execute(&mut *transaction).await?;
        let ids = traces
            .iter()
            .map(|trace| trace.id.clone())
            .collect::<Vec<_>>();
        let records = sqlx::query_as::<_, CalculationTraceRecord>(
            "SELECT id, relationship_id, measurement_name, input_claim_ids, subgraph, \
                    algorithm_version, result, created_at FROM calculation_traces \
             WHERE id = ANY($1) ORDER BY id",
        )
        .bind(&ids)
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(records)
    }
}
