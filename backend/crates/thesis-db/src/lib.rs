mod analytics;
mod atlas;
mod claim_record;
mod discovery;
mod highlights;
mod image_cache;
mod library;
mod material_interest;
mod news;
mod news_by_country;
mod ownership_interest;
mod reading_queue;
mod relationships;
mod verification_cache;
mod wiki;
pub use analytics::{
    BlindspotArticleRecord, BlindspotSourceArticleRecord, DailyArticleCoverageRecord,
    GdeltArticleCountRecord, GdeltEventRecord, GdeltEventUpsert, GdeltStatsRecord,
    SourceCoverageStatsWrite, TopicClusterSnapshotRecord,
};
pub use atlas::{
    AtlasEntityDetailData, AtlasMediaMeasurementData, AtlasProjectionData,
    AtlasReporterOwnershipEdgeRecord, CalculationTraceRecord, CalculationTraceWrite,
    MaterializeClaimError, RelationshipProofData, RelationshipProofLoadError,
};
pub use claim_record::{ClaimEvidenceRecord, ClaimRecord};
pub use discovery::{
    ArticleRecordById, DiscoveryArticleRecord, PersistedStoryLineage,
    StoryLineageArticleEdgeRecord, StoryLineageArticleEdgeWrite, StoryLineageArticleRef,
    StoryLineageClaimEdgeRecord, StoryLineageClaimEdgeWrite, StoryLineageClaimKey,
    StoryLineageClaimRecord, StoryLineageClaimWrite, StoryLineageCorrectionRecord,
    StoryLineageRecord, StoryLineageWrite,
};
pub use highlights::{
    HighlightCreate, HighlightError, HighlightPatch, HighlightRecord, DEFAULT_HIGHLIGHT_USER_ID,
};
pub use image_cache::{ImageCacheRecord, ImageCacheStats};
pub use library::{LibraryError, SavedArticleCreateResult, SavedArticleItem, SavedArticleRecord};
pub use material_interest::{
    WikiMaterialAnalysisScore, WikiMaterialCommodityContext, WikiMaterialCountryResource,
    WikiMaterialGdeltContext, WikiMaterialInterestSnapshot, WikiMaterialOrganization,
    WikiMaterialSourceOwnerInterests, WikiMaterialTradeFlow, WikiMaterialTradePair,
    WikiMaterialTradeProduct,
};
pub use news::{
    ArticleChromaMapping, DebugArticlePage, DebugArticleRecord, DebugArticleRequest,
    ImageBackfillArticle, ImageBackfillSource, ImageBackfillUpdate, MentionedCountryArticle,
    MentionedCountryUpdate, NewsArticleRecord, NewsCursor, NewsFilter, NewsIndexRequest, NewsPage,
    NewsPageRequest, NewsSortOrder, NewsSourceRecord, RecentNewsRequest, SearchArticleRecord,
};
pub use news_by_country::{
    CountryArticlePage, CountryArticleRecord, CountryCountSnapshot, CountryMatchKind,
    CountrySummary, CountryView,
};
pub use ownership_interest::OwnershipEdgeLoadError;
pub use reading_queue::{
    DailyDigestRecord, QueueOverviewRecord, ReadingQueueCreate, ReadingQueueError,
    ReadingQueueItemRecord, ReadingQueueUpdate, ReadingShelfCreate, ReadingShelfRecord,
    ReadingShelfUpdate,
};
pub use relationships::RelationshipRecord;
pub use verification_cache::{
    verification_claim_hash, VerificationCacheRecord, VerificationCacheWrite,
};
pub use wiki::{
    sha256_hex, PersistedSourceCatalogRecord, SourceCatalogPromotion, WikiArticleAuthorLinkInput,
    WikiArticleBehaviorStats, WikiCredibilityOrganizationRecord, WikiFundingBiasData,
    WikiFundingBiasTrace, WikiFundingPreregistration, WikiGdeltCredibilityStats,
    WikiIndexStatusRecord, WikiIngestRunRecord, WikiOrganizationRecord,
    WikiOrganizationResearchRecord, WikiOrganizationWriteRecord, WikiReporterArticleRecord,
    WikiReporterBylineSummaryRecord, WikiReporterCardRecord, WikiReporterDossierData,
    WikiReporterDossierRecord, WikiReporterProfileWriteRecord, WikiReporterResearchRecord,
    WikiSourceAnalysisScoreInput, WikiSourceAnalysisScoreRecord, WikiSourceClaimEvidenceInput,
    WikiSourceClaimEvidenceRecord, WikiSourceClaimInput, WikiSourceClaimRecord,
    WikiSourceClaimWithEvidence, WikiSourceCredibilityData, WikiSourceCredibilityMetadataRecord,
    WikiSourceCredibilityRecord, WikiSourceLedgerArticleRecord, WikiSourceLedgerData,
    WikiSourceLedgerRelationCount, WikiSourceMetadataRecord, WikiSourceOrganizationRecord,
    WikiSourceReporterSummaryRecord, WikiUnresolvedAuthorArticle, WikiUnresolvedAuthorCandidate,
};

use chrono::{DateTime, NaiveDateTime, Utc};
use std::collections::{BTreeSet, HashMap};

use sqlx::postgres::{PgConnection, PgPoolOptions};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use thesis_evidence::ownership::OwnershipEdge;
use thesis_evidence::ObservationEvidence;

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

pub(crate) fn empty_json_array() -> sqlx::types::Json<serde_json::Value> {
    sqlx::types::Json(serde_json::Value::Array(Vec::new()))
}

/// The current Alembic revision accepted as the one-way SQLx handoff baseline.
pub const ALEMBIC_HANDOFF_REVISION: &str = "20260722_0006";

/// Source schema state observed before an explicit SQLx migration run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MigrationSource {
    /// The PostgreSQL public schema had no application objects.
    Empty,
    /// The database was stamped at the complete Alembic handoff revision.
    AlembicHead,
    /// The database already carried the current SQLx schema marker.
    Sqlx,
}

/// Result of applying the current SQLx migration set.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MigrationReport {
    pub source: MigrationSource,
    pub latest_version: i64,
    pub alembic_handoff_revision: &'static str,
}

/// A rejected database state or failure while applying SQLx migrations.
#[derive(Debug)]
pub enum MigrationError {
    Database(sqlx::Error),
    Runner(sqlx::migrate::MigrateError),
    Readiness(SchemaReadinessError),
    UnsupportedState(&'static str),
    LockNotHeld,
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => {
                write!(formatter, "database migration preflight failed: {error}")
            }
            Self::Runner(error) => write!(formatter, "SQLx migration runner failed: {error}"),
            Self::Readiness(error) => {
                write!(
                    formatter,
                    "schema readiness failed after migration: {error}"
                )
            }
            Self::UnsupportedState(reason) => {
                write!(formatter, "unsupported database schema state: {reason}")
            }
            Self::LockNotHeld => formatter.write_str("schema migration advisory lock was not held"),
        }
    }
}

impl std::error::Error for MigrationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::Runner(error) => Some(error),
            Self::Readiness(error) => Some(error),
            Self::UnsupportedState(_) | Self::LockNotHeld => None,
        }
    }
}

/// Why an already-running application cannot use the current schema.
#[derive(Debug)]
pub enum SchemaReadinessError {
    Database(sqlx::Error),
    AuthorityTableMissing,
    AuthorityMarkerMismatch,
    MigrationHistoryMissing,
    MigrationHistoryMismatch,
    RequiredTableMissing,
    AlembicRevisionMismatch,
}

impl std::fmt::Display for SchemaReadinessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "schema readiness query failed: {error}"),
            Self::AuthorityTableMissing => {
                formatter.write_str("SQLx schema authority marker is missing")
            }
            Self::AuthorityMarkerMismatch => {
                formatter.write_str("SQLx schema authority marker is not current")
            }
            Self::MigrationHistoryMissing => {
                formatter.write_str("SQLx migration history is missing")
            }
            Self::MigrationHistoryMismatch => {
                formatter.write_str("SQLx migration history is incomplete or unknown")
            }
            Self::RequiredTableMissing => {
                formatter.write_str("one or more required SQLx application tables are missing")
            }
            Self::AlembicRevisionMismatch => {
                formatter.write_str("Alembic revision is not the recorded handoff head")
            }
        }
    }
}

impl std::error::Error for SchemaReadinessError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}

/// Holds a PostgreSQL transaction-scoped advisory lease on the shared pool.
///
/// Dropping this value, including when its owning task is cancelled, drops the
/// SQLx transaction and releases the lease through transaction rollback.
pub struct AdvisoryLease {
    transaction: Transaction<'static, Postgres>,
}

impl AdvisoryLease {
    /// Release the distributed lease immediately.
    pub async fn release(self) -> Result<(), sqlx::Error> {
        self.transaction.rollback().await
    }
}

#[derive(Clone, Debug)]
pub struct ClaimEvidence {
    pub predicate: String,
    pub observations: Vec<ObservationEvidence>,
}

#[derive(Debug, FromRow)]
struct ClaimRow {
    predicate: String,
    evidence_class: String,
}

#[derive(Debug, FromRow)]
struct ObservationRow {
    observation_id: String,
    entailment: String,
    reviewed_by: Option<String>,
    evidence_class: Option<String>,
    document_id: Option<String>,
}

#[derive(Debug, FromRow)]
struct LineageRow {
    parent_document_id: String,
    child_document_id: String,
}

impl Database {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(12)
            .connect(database_url)
            .await?;
        Ok(Self { pool })
    }

    pub fn connect_lazy(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new().connect_lazy(database_url)?;
        Ok(Self { pool })
    }

    /// Probe the shared database pool with a read-only query.
    pub async fn ping(&self) -> Result<(), sqlx::Error> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    /// Close every clone of this database's shared connection pool.
    pub async fn close(&self) {
        self.pool.close().await;
    }

    /// Apply SQLx migrations after validating an empty or exact Alembic-head schema.
    ///
    /// This is an explicit operator action; server startup must use
    /// `check_schema_readiness` and must not invoke this method automatically.
    pub async fn migrate(&self) -> Result<MigrationReport, MigrationError> {
        migrate_database(&self.pool).await
    }

    /// Verify that this pool is connected to the current SQLx-owned schema.
    pub async fn check_schema_readiness(&self) -> Result<(), SchemaReadinessError> {
        check_schema_readiness(&self.pool).await
    }

    /// Try to acquire a distributed, transaction-scoped PostgreSQL advisory lease.
    ///
    /// The lock is held on this database's shared pool connection until the
    /// returned guard is explicitly released or dropped.
    pub async fn try_advisory_lease(&self, key: i64) -> Result<Option<AdvisoryLease>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let acquired = sqlx::query_scalar::<_, bool>("SELECT pg_try_advisory_xact_lock($1)")
            .bind(key)
            .fetch_one(&mut *transaction)
            .await?;
        if !acquired {
            transaction.rollback().await?;
            return Ok(None);
        }
        Ok(Some(AdvisoryLease { transaction }))
    }

    pub async fn load_ownership_edges(&self) -> Result<Vec<OwnershipEdge>, OwnershipEdgeLoadError> {
        ownership_interest::load_ownership_edges(&self.pool).await
    }

    pub async fn load_claim_evidence(
        &self,
        claim_id: &str,
    ) -> Result<Option<ClaimEvidence>, sqlx::Error> {
        let Some(claim) = sqlx::query_as::<_, ClaimRow>(
            "SELECT predicate, evidence_class FROM evidence_claims WHERE id = $1",
        )
        .bind(claim_id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };

        let observations = sqlx::query_as::<_, ObservationRow>(
            "SELECT o.id AS observation_id, o.entailment, o.reviewed_by, \
                d.source_class AS evidence_class, d.id AS document_id \
         FROM evidence_observations o \
         JOIN claim_evidence_links ce ON ce.observation_id = o.id \
         LEFT JOIN document_snapshots s ON s.id = o.snapshot_id \
         LEFT JOIN evidence_documents d ON d.id = s.document_id \
         WHERE ce.claim_id = $1",
        )
        .bind(claim_id)
        .fetch_all(&self.pool)
        .await?;

        let lineage = sqlx::query_as::<_, LineageRow>(
            "SELECT parent_document_id, child_document_id FROM source_lineage",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut parents: HashMap<String, BTreeSet<String>> = HashMap::new();
        for row in lineage {
            parents
                .entry(row.child_document_id)
                .or_default()
                .insert(row.parent_document_id);
        }

        let evidence = observations
            .into_iter()
            .filter_map(|row| {
                let document_id = row.document_id?;
                Some(ObservationEvidence {
                    observation_id: row.observation_id,
                    evidence_class: row
                        .evidence_class
                        .unwrap_or_else(|| claim.evidence_class.clone()),
                    root_id: lineage_root(&document_id, &parents),
                    entailment: row.entailment,
                    reviewed_by: row.reviewed_by,
                })
            })
            .collect::<Vec<_>>();

        Ok(Some(ClaimEvidence {
            predicate: claim.predicate,
            observations: evidence,
        }))
    }

    pub async fn load_claim_record(
        &self,
        claim_id: &str,
    ) -> Result<Option<ClaimRecord>, sqlx::Error> {
        claim_record::load_claim_record(&self.pool, claim_id).await
    }

    pub async fn list_relationships(
        &self,
        as_of: NaiveDateTime,
        known_at: NaiveDateTime,
        predicates: Option<Vec<String>>,
        entity_id: Option<String>,
    ) -> Result<Vec<RelationshipRecord>, sqlx::Error> {
        relationships::list_relationships(&self.pool, as_of, known_at, predicates, entity_id).await
    }
    pub async fn list_news_page(&self, request: NewsPageRequest) -> Result<NewsPage, sqlx::Error> {
        news::list_news_page(&self.pool, request).await
    }

    pub async fn list_news_index(
        &self,
        request: NewsIndexRequest,
    ) -> Result<Vec<NewsArticleRecord>, sqlx::Error> {
        news::list_news_index(&self.pool, request).await
    }

    pub async fn list_recent_news(
        &self,
        request: RecentNewsRequest,
    ) -> Result<NewsPage, sqlx::Error> {
        news::list_recent_news(&self.pool, request).await
    }

    pub async fn list_news_sources(&self) -> Result<Vec<NewsSourceRecord>, sqlx::Error> {
        news::list_news_sources(&self.pool).await
    }

    pub async fn list_news_categories(&self) -> Result<Vec<String>, sqlx::Error> {
        news::list_news_categories(&self.pool).await
    }

    pub async fn load_country_counts(
        &self,
        since: DateTime<Utc>,
    ) -> Result<CountryCountSnapshot, sqlx::Error> {
        news_by_country::load_country_counts(&self.pool, since).await
    }

    pub async fn load_country_articles(
        &self,
        code: &str,
        view: CountryView,
        since: Option<DateTime<Utc>>,
        limit: i64,
        offset: i64,
    ) -> Result<CountryArticlePage, sqlx::Error> {
        news_by_country::load_country_articles(&self.pool, code, view, since, limit, offset).await
    }

    pub async fn load_available_countries(&self) -> Result<Vec<CountrySummary>, sqlx::Error> {
        news_by_country::load_available_countries(&self.pool).await
    }
}

fn lineage_root(start: &str, parents: &HashMap<String, BTreeSet<String>>) -> String {
    let mut pending = vec![start.to_owned()];
    let mut visited = BTreeSet::new();
    let mut roots = BTreeSet::new();
    while let Some(document_id) = pending.pop() {
        if !visited.insert(document_id.clone()) {
            continue;
        }
        match parents.get(&document_id) {
            Some(upstream) if !upstream.is_empty() => pending.extend(upstream.iter().cloned()),
            _ => {
                roots.insert(document_id);
            }
        }
    }
    roots
        .into_iter()
        .next()
        // A cycle-only reachable component has no terminal root; choose its lexical member.
        .or_else(|| visited.into_iter().next())
        .unwrap_or_else(|| start.to_owned())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap};

    use super::lineage_root;

    #[test]
    fn lineage_uses_the_lexically_first_independent_root() {
        let mut parents = HashMap::new();
        parents.insert("copy-b".to_owned(), BTreeSet::from(["root-z".to_owned()]));
        parents.insert("copy-a".to_owned(), BTreeSet::from(["root-a".to_owned()]));
        parents.insert(
            "observation".to_owned(),
            BTreeSet::from(["copy-a".to_owned(), "copy-b".to_owned()]),
        );
        assert_eq!(lineage_root("observation", &parents), "root-a");
    }

    #[test]
    fn lineage_cycles_resolve_deterministically_without_recursion() {
        let mut parents = HashMap::new();
        parents.insert("a".to_owned(), BTreeSet::from(["b".to_owned()]));
        parents.insert("b".to_owned(), BTreeSet::from(["a".to_owned()]));
        assert_eq!(lineage_root("a", &parents), "a");
        assert_eq!(lineage_root("b", &parents), "a");
    }
}
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

const SCHEMA_MIGRATION_LOCK_KEY: i64 = 0x5448_4553_4953;
const EVIDENCE_SPINE_TABLES: &[&str] = &[
    "evidence_entities",
    "entity_external_ids",
    "entity_resolutions",
    "evidence_documents",
    "document_snapshots",
    "archive_requests",
    "evidence_observations",
    "evidence_claims",
    "claim_evidence_links",
    "accepted_relationships",
    "relationship_claim_links",
    "source_lineage",
    "adjudication_items",
    "calculation_traces",
    "external_material_events",
    "preregistrations",
    "measurement_validation_cards",
    "corpus_coverage_windows",
    "proof_runs",
    "evidence_ingest_runs",
];

const LEGACY_NON_EVIDENCE_TABLES: &[&str] = &[
    "article_authors",
    "article_edges",
    "articles",
    "bookmarks",
    "claim_edges",
    "commodity_prices",
    "corrections",
    "country_resources",
    "event_clusters",
    "extracted_claims",
    "gdelt_events",
    "highlights",
    "identity_edges",
    "liked_articles",
    "material_interest_analyses",
    "organizations",
    "preferences",
    "reading_queue",
    "reading_shelves",
    "reporter_claims",
    "reporters",
    "search_history",
    "source_analysis_scores",
    "source_claim_evidence",
    "source_claims",
    "source_coverage_stats",
    "source_credibility",
    "source_metadata",
    "story_clusters",
    "topic_blind_spots",
    "topic_cluster_snapshots",
    "trade_flows",
    "verification_cache",
    "wiki_index_status",
];

const SQLX_RUNTIME_TABLES: &[&str] = &["image_cache", "source_catalog"];
const ALEMBIC_HANDOFF_TABLES: &[&str] = &["alembic_version", "propaganda_filter_scores"];

#[derive(Debug, FromRow)]
struct SchemaAuthorityRow {
    schema_authority: String,
    alembic_handoff_revision: String,
}

#[derive(Debug, FromRow)]
struct AppliedMigrationRow {
    version: i64,
    success: bool,
    checksum: Vec<u8>,
}
async fn migrate_database(pool: &PgPool) -> Result<MigrationReport, MigrationError> {
    let mut connection = pool.acquire().await.map_err(MigrationError::Database)?;
    // A session lock must not escape into the pool if migration is cancelled.
    connection.close_on_drop();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(SCHEMA_MIGRATION_LOCK_KEY)
        .fetch_one(&mut *connection)
        .await
        .map_err(MigrationError::Database)?;

    let result = migrate_locked(&mut connection).await;
    let unlocked = sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock($1)")
        .bind(SCHEMA_MIGRATION_LOCK_KEY)
        .fetch_one(&mut *connection)
        .await;
    match (result, unlocked) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(MigrationError::Database(error)),
        (Ok(_), Ok(false)) => Err(MigrationError::LockNotHeld),
        (Ok(report), Ok(true)) => Ok(report),
    }
}

async fn migrate_locked(connection: &mut PgConnection) -> Result<MigrationReport, MigrationError> {
    let source = inspect_migration_source(&mut *connection).await?;
    let latest_version = MIGRATOR
        .iter()
        .last()
        .map(|migration| migration.version)
        .ok_or(MigrationError::UnsupportedState(
            "the SQLx migration set is empty",
        ))?;
    // SQLx creates its migration history in the session's current schema.
    sqlx::query("SET search_path TO public")
        .execute(&mut *connection)
        .await
        .map_err(MigrationError::Database)?;
    MIGRATOR
        .run_direct(&mut *connection)
        .await
        .map_err(MigrationError::Runner)?;
    check_schema_readiness_on(&mut *connection)
        .await
        .map_err(MigrationError::Readiness)?;
    Ok(MigrationReport {
        source,
        latest_version,
        alembic_handoff_revision: ALEMBIC_HANDOFF_REVISION,
    })
}

async fn inspect_migration_source(
    connection: &mut PgConnection,
) -> Result<MigrationSource, MigrationError> {
    let has_authority = relation_exists(&mut *connection, "public.thesis_schema_authority")
        .await
        .map_err(MigrationError::Database)?;
    let has_sqlx_history = relation_exists(&mut *connection, "public._sqlx_migrations")
        .await
        .map_err(MigrationError::Database)?;
    let has_alembic = relation_exists(&mut *connection, "public.alembic_version")
        .await
        .map_err(MigrationError::Database)?;

    if has_authority || has_sqlx_history {
        if !has_authority || !has_sqlx_history {
            return Err(MigrationError::UnsupportedState(
                "partial SQLx migration state; operator inspection is required",
            ));
        }
        if has_alembic {
            validate_alembic_revision(&mut *connection)
                .await
                .map_err(MigrationError::UnsupportedState)?;
        }
        check_schema_readiness_on(&mut *connection)
            .await
            .map_err(MigrationError::Readiness)?;
        return Ok(MigrationSource::Sqlx);
    }

    if has_alembic {
        validate_alembic_revision(&mut *connection)
            .await
            .map_err(MigrationError::UnsupportedState)?;
        validate_alembic_head_schema(&mut *connection).await?;
        return Ok(MigrationSource::AlembicHead);
    }

    let user_objects = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM pg_class AS c \
         JOIN pg_namespace AS n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(MigrationError::Database)?;
    if user_objects != 0 {
        return Err(MigrationError::UnsupportedState(
            "unversioned application objects exist without a recognized authority marker",
        ));
    }
    Ok(MigrationSource::Empty)
}

async fn validate_alembic_revision(connection: &mut PgConnection) -> Result<(), &'static str> {
    let revisions = sqlx::query_scalar::<_, String>(
        "SELECT version_num FROM public.alembic_version ORDER BY version_num",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| "Alembic revision table is unreadable")?;
    if revisions.len() != 1 || revisions[0] != ALEMBIC_HANDOFF_REVISION {
        return Err("only the single current Alembic head 20260722_0006 is supported");
    }
    Ok(())
}

async fn validate_alembic_head_schema(connection: &mut PgConnection) -> Result<(), MigrationError> {
    let present_tables = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM unnest($1::text[]) AS expected(name) \
         WHERE to_regclass('public.' || quote_ident(expected.name)) IS NOT NULL",
    )
    .bind(EVIDENCE_SPINE_TABLES)
    .fetch_one(&mut *connection)
    .await
    .map_err(MigrationError::Database)?;
    if present_tables != EVIDENCE_SPINE_TABLES.len() as i64 {
        return Err(MigrationError::UnsupportedState(
            "the current Alembic head is missing evidence-spine tables",
        ));
    }

    let required_columns = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM (VALUES \
            ('accepted_relationships', 'materialized_by'), \
            ('accepted_relationships', 'lifecycle_state'), \
            ('evidence_entities', 'entity_kind')) AS expected(table_name, column_name) \
         JOIN pg_class AS t ON t.relname = expected.table_name \
         JOIN pg_namespace AS n ON n.oid = t.relnamespace AND n.nspname = 'public' \
         JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attname = expected.column_name \
           AND NOT a.attisdropped",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(MigrationError::Database)?;
    if required_columns != 3 {
        return Err(MigrationError::UnsupportedState(
            "the current Alembic head is missing required revision columns",
        ));
    }

    let required_constraints = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM pg_constraint AS c \
         WHERE (c.conrelid = 'public.evidence_observations'::regclass \
                  AND c.conname = 'ck_evidence_observation_reviewed_yes_has_reviewer') \
            OR (c.conrelid = 'public.accepted_relationships'::regclass \
                  AND c.conname = 'ck_accepted_relationship_lifecycle_state')",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(MigrationError::Database)?;
    if required_constraints != 2 {
        return Err(MigrationError::UnsupportedState(
            "the current Alembic head is missing required revision constraints",
        ));
    }

    let policy_table_exists = relation_exists(&mut *connection, "public.evidence_policy_rows")
        .await
        .map_err(MigrationError::Database)?;
    if policy_table_exists {
        return Err(MigrationError::UnsupportedState(
            "the obsolete evidence_policy_rows table remains after Alembic revision 20260720_0003",
        ));
    }

    let unknown_tables = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM pg_class AS c \
         JOIN pg_namespace AS n ON n.oid = c.relnamespace \
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') \
           AND c.relname <> ALL($1::text[]) \
           AND c.relname <> ALL($2::text[]) \
           AND c.relname <> ALL($3::text[])",
    )
    .bind(LEGACY_NON_EVIDENCE_TABLES)
    .bind(EVIDENCE_SPINE_TABLES)
    .bind(ALEMBIC_HANDOFF_TABLES)
    .fetch_one(&mut *connection)
    .await
    .map_err(MigrationError::Database)?;
    if unknown_tables != 0 {
        return Err(MigrationError::UnsupportedState(
            "public schema contains relations outside the recognized Alembic handoff",
        ));
    }

    for (table, column) in [
        ("organizations", "subsidiaries"),
        ("reporters", "raw_name"),
        ("reporters", "merged_into"),
        ("reporters", "retirement_reason"),
        ("reporters", "split_into"),
        ("reporters", "is_collective"),
    ] {
        if relation_exists(&mut *connection, &format!("public.{table}"))
            .await
            .map_err(MigrationError::Database)?
            && !column_exists(&mut *connection, table, column)
                .await
                .map_err(MigrationError::Database)?
        {
            return Err(MigrationError::UnsupportedState(
                "an existing legacy table is missing its current Alembic-head columns",
            ));
        }
    }
    Ok(())
}

async fn relation_exists(
    connection: &mut PgConnection,
    relation: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
        .bind(relation)
        .fetch_one(&mut *connection)
        .await
}

async fn column_exists(
    connection: &mut PgConnection,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM pg_attribute \
         WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped)",
    )
    .bind(format!("public.{table}"))
    .bind(column)
    .fetch_one(&mut *connection)
    .await
}

async fn check_schema_readiness(pool: &PgPool) -> Result<(), SchemaReadinessError> {
    let mut connection = pool
        .acquire()
        .await
        .map_err(SchemaReadinessError::Database)?;
    check_schema_readiness_on(&mut connection).await
}

async fn check_schema_readiness_on(
    connection: &mut PgConnection,
) -> Result<(), SchemaReadinessError> {
    if !relation_exists(&mut *connection, "public.thesis_schema_authority")
        .await
        .map_err(SchemaReadinessError::Database)?
    {
        return Err(SchemaReadinessError::AuthorityTableMissing);
    }
    let authority = sqlx::query_as::<_, SchemaAuthorityRow>(
        "SELECT schema_authority, alembic_handoff_revision \
         FROM public.thesis_schema_authority WHERE singleton = TRUE",
    )
    .fetch_optional(&mut *connection)
    .await
    .map_err(SchemaReadinessError::Database)?;
    let Some(authority) = authority else {
        return Err(SchemaReadinessError::AuthorityMarkerMismatch);
    };
    if authority.schema_authority != "sqlx"
        || authority.alembic_handoff_revision != ALEMBIC_HANDOFF_REVISION
    {
        return Err(SchemaReadinessError::AuthorityMarkerMismatch);
    }

    if !relation_exists(&mut *connection, "public._sqlx_migrations")
        .await
        .map_err(SchemaReadinessError::Database)?
    {
        return Err(SchemaReadinessError::MigrationHistoryMissing);
    }
    let applied = sqlx::query_as::<_, AppliedMigrationRow>(
        "SELECT version, success, checksum FROM public._sqlx_migrations ORDER BY version",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(SchemaReadinessError::Database)?;
    if applied.len() != MIGRATOR.iter().len()
        || applied
            .iter()
            .zip(MIGRATOR.iter())
            .any(|(record, migration)| {
                record.version != migration.version
                    || !record.success
                    || record.checksum.as_slice() != migration.checksum.as_ref()
            })
    {
        return Err(SchemaReadinessError::MigrationHistoryMismatch);
    }
    let missing_tables = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM ( \
             SELECT unnest($1::text[]) AS name \
             UNION ALL SELECT unnest($2::text[]) \
             UNION ALL SELECT unnest($3::text[]) \
         ) AS expected \
         WHERE NOT EXISTS (SELECT 1 FROM pg_class AS c \
             JOIN pg_namespace AS n ON n.oid = c.relnamespace \
             WHERE n.nspname = 'public' AND c.relname = expected.name \
               AND c.relkind IN ('r', 'p'))",
    )
    .bind(LEGACY_NON_EVIDENCE_TABLES)
    .bind(EVIDENCE_SPINE_TABLES)
    .bind(SQLX_RUNTIME_TABLES)
    .fetch_one(&mut *connection)
    .await
    .map_err(SchemaReadinessError::Database)?;
    if missing_tables != 0 {
        return Err(SchemaReadinessError::RequiredTableMissing);
    }

    if relation_exists(&mut *connection, "public.alembic_version")
        .await
        .map_err(SchemaReadinessError::Database)?
    {
        validate_alembic_revision(&mut *connection)
            .await
            .map_err(|_| SchemaReadinessError::AlembicRevisionMismatch)?;
    }
    Ok(())
}
#[cfg(test)]
mod migration_tests {
    use super::{
        Database, MigrationError, MigrationSource, SchemaReadinessError, ALEMBIC_HANDOFF_REVISION,
        MIGRATOR,
    };
    use sqlx::PgPool;

    async fn apply_legacy_schema(pool: &PgPool) {
        let migration = MIGRATOR
            .iter()
            .next()
            .expect("legacy schema migration exists");
        let mut transaction = pool.begin().await.expect("test transaction begins");
        sqlx::raw_sql(migration.sql.as_ref())
            .execute(&mut *transaction)
            .await
            .expect("legacy schema migration applies to fixture");
        transaction
            .commit()
            .await
            .expect("test transaction commits");
    }

    async fn stamp_alembic_head(pool: &PgPool) {
        sqlx::query("CREATE TABLE public.alembic_version (version_num VARCHAR(32) NOT NULL)")
            .execute(pool)
            .await
            .expect("Alembic revision table is created");
        sqlx::query("INSERT INTO public.alembic_version (version_num) VALUES ($1)")
            .bind(ALEMBIC_HANDOFF_REVISION)
            .execute(pool)
            .await
            .expect("current Alembic head is recorded");
    }

    #[sqlx::test(migrations = false)]
    async fn empty_schema_migrates_completely_and_is_idempotent(pool: PgPool) {
        let database = Database { pool: pool.clone() };
        let first = database.migrate().await.expect("empty schema migrates");
        assert_eq!(first.source, MigrationSource::Empty);
        assert_eq!(first.latest_version, 202609250002);
        database
            .check_schema_readiness()
            .await
            .expect("migrated schema is ready");

        let required_article_columns = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::bigint FROM information_schema.columns \
             WHERE table_schema = 'public' AND table_name = 'articles' \
               AND column_name = ANY($1::text[]) AND is_nullable = 'NO'",
        )
        .bind(vec![
            "title".to_owned(),
            "source".to_owned(),
            "published_at".to_owned(),
            "url".to_owned(),
        ])
        .fetch_one(&pool)
        .await
        .expect("article constraints are inspectable");
        assert_eq!(required_article_columns, 4);

        let second = database.migrate().await.expect("repeat migration is safe");
        assert_eq!(second.source, MigrationSource::Sqlx);
    }

    #[sqlx::test(migrations = false)]
    async fn source_catalog_conflicts_only_on_exact_name(pool: PgPool) {
        let database = Database { pool: pool.clone() };
        database.migrate().await.expect("empty schema migrates");
        let insert = "INSERT INTO public.source_catalog \
            (name, url, category, country, source_type, funding_type, bias_rating, \
             ownership_label, factual_reporting) \
            VALUES ($1, $2, 'news', 'US', 'rss', 'private', 'center', 'owner', 'unknown')";

        for name in ["Wire A", "Wire B", "wire a"] {
            sqlx::query(insert)
                .bind(name)
                .bind("https://shared.example/feed")
                .execute(&pool)
                .await
                .expect("same URL and case-distinct names are allowed");
        }
        let duplicate_name = sqlx::query(insert)
            .bind("Wire A")
            .bind("https://different.example/feed")
            .execute(&pool)
            .await;
        assert!(matches!(
            duplicate_name,
            Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505")
        ));
    }

    #[sqlx::test(migrations = false)]
    async fn current_alembic_head_hands_off_to_sqlx(pool: PgPool) {
        apply_legacy_schema(&pool).await;
        stamp_alembic_head(&pool).await;

        let database = Database { pool: pool.clone() };
        let report = database
            .migrate()
            .await
            .expect("exact current Alembic schema hands off");
        assert_eq!(report.source, MigrationSource::AlembicHead);
        database
            .check_schema_readiness()
            .await
            .expect("handoff schema is ready");

        let seed_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM public.source_credibility")
                .fetch_one(&pool)
                .await
                .expect("seeded credibility rows remain present");
        assert_eq!(seed_count, 21);
    }

    #[sqlx::test(migrations = false)]
    async fn unsupported_alembic_revision_is_rejected_before_migration(pool: PgPool) {
        sqlx::query("CREATE TABLE public.alembic_version (version_num VARCHAR(32) NOT NULL)")
            .execute(&pool)
            .await
            .expect("Alembic revision table is created");
        sqlx::query("INSERT INTO public.alembic_version (version_num) VALUES ('20260720_0003')")
            .execute(&pool)
            .await
            .expect("unsupported revision is recorded");

        let database = Database { pool: pool.clone() };
        assert!(matches!(
            database.migrate().await,
            Err(MigrationError::UnsupportedState(_))
        ));
        let sqlx_history_exists = sqlx::query_scalar::<_, bool>(
            "SELECT to_regclass('public._sqlx_migrations') IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("migration history state is inspectable");
        assert!(!sqlx_history_exists);
    }

    #[sqlx::test(migrations = false)]
    async fn unknown_public_table_at_alembic_head_is_rejected(pool: PgPool) {
        apply_legacy_schema(&pool).await;
        stamp_alembic_head(&pool).await;
        sqlx::query("CREATE TABLE public.unrecognized_legacy_table (id INTEGER)")
            .execute(&pool)
            .await
            .expect("unknown relation is created");

        let database = Database { pool };
        assert!(matches!(
            database.migrate().await,
            Err(MigrationError::UnsupportedState(_))
        ));
    }

    #[sqlx::test(migrations = false)]
    async fn readiness_rejects_marker_or_migration_checksum_drift(pool: PgPool) {
        let database = Database { pool: pool.clone() };
        database.migrate().await.expect("empty schema migrates");

        sqlx::query(
            "UPDATE public.thesis_schema_authority \
             SET alembic_handoff_revision = 'unsupported'",
        )
        .execute(&pool)
        .await
        .expect("authority marker is changed");
        assert!(matches!(
            database.check_schema_readiness().await,
            Err(SchemaReadinessError::AuthorityMarkerMismatch)
        ));

        sqlx::query(
            "UPDATE public.thesis_schema_authority \
             SET alembic_handoff_revision = $1",
        )
        .bind(ALEMBIC_HANDOFF_REVISION)
        .execute(&pool)
        .await
        .expect("authority marker is restored");
        sqlx::query(
            "UPDATE public._sqlx_migrations \
             SET checksum = decode(repeat('00', 48), 'hex') WHERE version = $1",
        )
        .bind(MIGRATOR.iter().next().expect("migration exists").version)
        .execute(&pool)
        .await
        .expect("migration checksum is changed");
        assert!(matches!(
            database.check_schema_readiness().await,
            Err(SchemaReadinessError::MigrationHistoryMismatch)
        ));
    }

    #[sqlx::test(migrations = false)]
    async fn readiness_rejects_missing_required_table(pool: PgPool) {
        let database = Database { pool: pool.clone() };
        database.migrate().await.expect("empty schema migrates");
        sqlx::query("DROP TABLE public.source_catalog")
            .execute(&pool)
            .await
            .expect("test-only schema fixture removes a required relation");

        assert!(matches!(
            database.check_schema_readiness().await,
            Err(SchemaReadinessError::RequiredTableMissing)
        ));
    }

    #[sqlx::test(migrations = false)]
    async fn ping_uses_and_close_shuts_down_the_shared_pool(pool: PgPool) {
        let database = Database { pool };
        database.ping().await.expect("live pool responds to ping");
        database.close().await;
        assert!(database.ping().await.is_err());
    }

    #[sqlx::test(migrations = false)]
    async fn advisory_lease_excludes_competitors_and_drop_releases_it(pool: PgPool) {
        let database = Database { pool: pool.clone() };
        let key = 0x5448_4553_4954;
        let lease = database
            .try_advisory_lease(key)
            .await
            .expect("lease query succeeds")
            .expect("first owner acquires lease");
        assert!(database
            .try_advisory_lease(key)
            .await
            .expect("competing lease query succeeds")
            .is_none());
        lease.release().await.expect("explicit release succeeds");

        let dropped = database
            .try_advisory_lease(key)
            .await
            .expect("lease query succeeds")
            .expect("lease is reacquired after explicit release");
        drop(dropped);

        let mut transaction = pool.begin().await.expect("lease probe transaction begins");
        sqlx::query("SET LOCAL lock_timeout = '2s'")
            .execute(&mut *transaction)
            .await
            .expect("lease probe has a bounded lock wait");
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(key)
            .execute(&mut *transaction)
            .await
            .expect("dropping the lease releases its transaction lock");
        transaction
            .rollback()
            .await
            .expect("lease probe rolls back");
    }
}
