use chrono::NaiveDateTime;
use serde_json::Value;
use sqlx::types::Json;
use sqlx::FromRow;

use crate::Database;

/// Current, bitemporally visible ownership edge and its complete endpoint/evidence summary.
#[derive(Clone, Debug, FromRow)]
pub struct AtlasReporterOwnershipEdgeRecord {
    pub outlet_entity_id: String,
    pub outlet_name: String,
    pub outlet_catalog_key: String,
    pub chain_depth: i32,
    pub relationship_id: String,
    pub subject_entity_id: String,
    pub subject_record_kind: String,
    pub subject_entity_kind: String,
    pub subject_name: String,
    pub subject_privacy_scope: String,
    pub subject_rss_catalog_key: Option<String>,
    pub subject_scoop_reporter_id: Option<String>,
    pub predicate: String,
    pub object_entity_id: String,
    pub object_record_kind: String,
    pub object_entity_kind: String,
    pub object_name: String,
    pub object_privacy_scope: String,
    pub object_rss_catalog_key: Option<String>,
    pub object_scoop_reporter_id: Option<String>,
    pub qualifiers: Json<Value>,
    pub valid_from: Option<NaiveDateTime>,
    pub valid_to: Option<NaiveDateTime>,
    pub recorded_at: NaiveDateTime,
    pub retracted_at: Option<NaiveDateTime>,
    pub acceptance_policy_version: String,
    pub status: String,
    pub lifecycle_state: String,
    pub materialized_at: NaiveDateTime,
    pub claim_ids: Vec<String>,
    pub evidence_count: i64,
}

impl Database {
    /// Load direct/equity ownership chains for RSS outlet names resolved through their catalog key.
    ///
    /// Each returned edge points from the owned entity (`subject`) to its owner (`object`), which
    /// is the persisted relationship orientation used by the evidence spine. Atlas graph edges
    /// reverse that orientation when they are built for display.
    pub async fn load_atlas_reporter_ownership_data(
        &self,
        outlet_names: &[String],
    ) -> Result<Vec<AtlasReporterOwnershipEdgeRecord>, sqlx::Error> {
        if outlet_names.is_empty() {
            return Ok(Vec::new());
        }
        let now = chrono::Utc::now().naive_utc();
        sqlx::query_as::<_, AtlasReporterOwnershipEdgeRecord>(
            r#"WITH RECURSIVE outlet_seeds AS (
                   SELECT DISTINCT entity.id, entity.canonical_name AS outlet_name,
                          external_id.value AS outlet_catalog_key
                   FROM evidence_entities AS entity
                   JOIN entity_external_ids AS external_id ON external_id.entity_id = entity.id
                   WHERE external_id.scheme = 'rss_catalog_key'
                     AND entity.canonical_name = ANY($1)
               ), ownership_edges AS (
                   SELECT relationship.* FROM accepted_relationships AS relationship
                   WHERE relationship.predicate IN ('directly_owns', 'owns_equity_in')
                     AND (relationship.valid_from IS NULL OR relationship.valid_from <= $2)
                     AND (relationship.valid_to IS NULL OR relationship.valid_to >= $2)
                     AND relationship.recorded_at <= $3
                     AND (relationship.retracted_at IS NULL OR relationship.retracted_at > $3)
               ), ownership_chain(outlet_entity_id, outlet_name, outlet_catalog_key, entity_id, depth, visited) AS (
                   SELECT seed.id, seed.outlet_name, seed.outlet_catalog_key,
                          seed.id, 0, ARRAY[seed.id]::varchar[]
                   FROM outlet_seeds AS seed
                   UNION ALL
                   SELECT chain.outlet_entity_id, chain.outlet_name, chain.outlet_catalog_key,
                          edge.object_entity_id, chain.depth + 1,
                          chain.visited || edge.object_entity_id
                   FROM ownership_chain AS chain
                   JOIN ownership_edges AS edge ON edge.subject_entity_id = chain.entity_id
                   WHERE chain.depth < 12 AND NOT edge.object_entity_id = ANY(chain.visited)
               ), selected_edges AS (
                   SELECT DISTINCT ON (chain.outlet_entity_id, edge.id)
                          chain.outlet_entity_id, chain.outlet_name, chain.outlet_catalog_key,
                          chain.depth, edge.*
                   FROM ownership_chain AS chain
                   JOIN ownership_edges AS edge ON edge.subject_entity_id = chain.entity_id
                   WHERE chain.depth < 12 AND NOT edge.object_entity_id = ANY(chain.visited)
                   ORDER BY chain.outlet_entity_id, edge.id, chain.depth
               )
               SELECT relationship.outlet_entity_id, relationship.outlet_name,
                      relationship.outlet_catalog_key, relationship.depth AS chain_depth,
                      relationship.id AS relationship_id,
                      subject.id AS subject_entity_id,
                      subject.record_kind AS subject_record_kind,
                      subject.entity_kind AS subject_entity_kind,
                      subject.canonical_name AS subject_name,
                      subject.privacy_scope AS subject_privacy_scope,
                      (SELECT external_id.value FROM entity_external_ids AS external_id
                       WHERE external_id.entity_id = subject.id
                         AND external_id.scheme = 'rss_catalog_key'
                       ORDER BY external_id.value LIMIT 1) AS subject_rss_catalog_key,
                      (SELECT external_id.value FROM entity_external_ids AS external_id
                       WHERE external_id.entity_id = subject.id
                         AND external_id.scheme = 'scoop_reporter_id'
                       ORDER BY external_id.value LIMIT 1) AS subject_scoop_reporter_id,
                      relationship.predicate,
                      owner.id AS object_entity_id,
                      owner.record_kind AS object_record_kind,
                      owner.entity_kind AS object_entity_kind,
                      owner.canonical_name AS object_name,
                      owner.privacy_scope AS object_privacy_scope,
                      (SELECT external_id.value FROM entity_external_ids AS external_id
                       WHERE external_id.entity_id = owner.id
                         AND external_id.scheme = 'rss_catalog_key'
                       ORDER BY external_id.value LIMIT 1) AS object_rss_catalog_key,
                      (SELECT external_id.value FROM entity_external_ids AS external_id
                       WHERE external_id.entity_id = owner.id
                         AND external_id.scheme = 'scoop_reporter_id'
                       ORDER BY external_id.value LIMIT 1) AS object_scoop_reporter_id,
                      relationship.qualifiers, relationship.valid_from, relationship.valid_to,
                      relationship.recorded_at, relationship.retracted_at,
                      relationship.acceptance_policy_version, relationship.status,
                      relationship.lifecycle_state, relationship.materialized_at,
                      COALESCE(ARRAY_AGG(DISTINCT link.claim_id ORDER BY link.claim_id)
                          FILTER (WHERE link.claim_id IS NOT NULL), ARRAY[]::varchar[]) AS claim_ids,
                      COUNT(DISTINCT evidence.observation_id)::bigint AS evidence_count
               FROM selected_edges AS relationship
               JOIN evidence_entities AS subject ON subject.id = relationship.subject_entity_id
               JOIN evidence_entities AS owner ON owner.id = relationship.object_entity_id
               LEFT JOIN relationship_claim_links AS link ON link.relationship_id = relationship.id
               LEFT JOIN claim_evidence_links AS evidence ON evidence.claim_id = link.claim_id
               GROUP BY relationship.outlet_entity_id, relationship.outlet_name,
                        relationship.outlet_catalog_key, relationship.depth,
                        relationship.id, subject.id, owner.id
               ORDER BY relationship.outlet_name, relationship.depth, relationship.id"#,
        )
        .bind(outlet_names)
        .bind(now)
        .bind(now)
        .fetch_all(&self.pool)
        .await
    }
}
