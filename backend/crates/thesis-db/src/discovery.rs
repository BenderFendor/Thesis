use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::Value;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::collections::{HashMap, HashSet};

use crate::Database;

#[derive(Clone, Debug, FromRow)]
pub struct DiscoveryArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub source_id: Option<String>,
    pub summary: Option<String>,
    pub image_url: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub category: Option<String>,
    pub url: Option<String>,
    pub content: Option<String>,
    pub author: Option<String>,
    pub authors: Vec<String>,
    pub credibility: Option<String>,
}

pub type ArticleRecordById = DiscoveryArticleRecord;

async fn load_discovery_articles_since(
    pool: &PgPool,
    since: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<DiscoveryArticleRecord>, sqlx::Error> {
    sqlx::query_as::<_, DiscoveryArticleRecord>(
        "SELECT id, title, source, source_id, summary, image_url, \
                published_at::timestamptz AS published_at, category, url, content, author, \
                COALESCE(authors, ARRAY[]::text[]) AS authors, credibility \
         FROM articles \
         WHERE published_at >= $1 AND content IS NOT NULL \
         ORDER BY published_at DESC, id DESC LIMIT $2",
    )
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await
}

async fn load_discovery_articles_by_ids(
    pool: &PgPool,
    ids: &[i64],
) -> Result<Vec<ArticleRecordById>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, ArticleRecordById>(
        "SELECT id, title, source, source_id, summary, image_url, \
                published_at::timestamptz AS published_at, category, url, content, author, \
                COALESCE(authors, ARRAY[]::text[]) AS authors, credibility \
         FROM articles WHERE id = ANY($1) ORDER BY id ASC",
    )
    .bind(ids)
    .fetch_all(pool)
    .await
}

async fn count_discovery_articles_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*)::bigint FROM articles WHERE published_at >= $1")
        .bind(since)
        .fetch_one(pool)
        .await
}

async fn list_article_gdelt_events_by_article_ids(
    pool: &PgPool,
    article_ids: &[i64],
) -> Result<Vec<ArticleGdeltEventRecord>, sqlx::Error> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, ArticleGdeltEventRecord>(
        "SELECT id, article_id, event_root_code, tone, goldstein_scale \
         FROM gdelt_events WHERE article_id = ANY($1) \
         ORDER BY published_at DESC, id DESC",
    )
    .bind(article_ids)
    .fetch_all(pool)
    .await
}

#[derive(Clone, Debug, FromRow)]
pub struct ArticleGdeltEventRecord {
    pub id: i64,
    pub article_id: Option<i64>,
    pub event_root_code: Option<String>,
    pub tone: Option<f64>,
    pub goldstein_scale: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct StoryLineageWrite {
    pub external_cluster_id: i64,
    pub label: Option<String>,
    pub keywords: Vec<String>,
    pub first_seen_at: Option<NaiveDateTime>,
    pub last_seen_at: Option<NaiveDateTime>,
    pub articles: Vec<StoryLineageArticleRef>,
    pub article_edges: Vec<StoryLineageArticleEdgeWrite>,
    pub claims: Vec<StoryLineageClaimWrite>,
    pub claim_edges: Vec<StoryLineageClaimEdgeWrite>,
}

#[derive(Clone, Debug)]
pub struct StoryLineageArticleRef {
    pub article_id: i64,
    pub source: String,
}

#[derive(Clone, Debug)]
pub struct StoryLineageArticleEdgeWrite {
    pub from_article_id: i64,
    pub to_article_id: i64,
    pub relation: String,
    pub evidence: Value,
    pub confidence: f64,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct StoryLineageClaimKey {
    pub article_id: i64,
    pub claim_hash: String,
}

#[derive(Clone, Debug)]
pub struct StoryLineageClaimWrite {
    pub article_id: i64,
    pub claim_text: String,
    pub normalized_claim: String,
    pub claim_hash: String,
    pub claim_type: String,
    pub checkability: String,
    pub evidence_span: Option<String>,
    pub entities: Value,
    pub numbers: Value,
}

#[derive(Clone, Debug)]
pub struct StoryLineageClaimEdgeWrite {
    pub from_claim: StoryLineageClaimKey,
    pub to_claim: StoryLineageClaimKey,
    pub relation: String,
    pub evidence: Value,
    pub confidence: f64,
}

#[derive(Clone, Debug, FromRow)]
pub struct StoryLineageRecord {
    pub id: i64,
    pub external_cluster_id: i64,
    pub label: Option<String>,
    pub keywords: Option<Json<Value>>,
    pub first_seen_at: Option<NaiveDateTime>,
    pub last_seen_at: Option<NaiveDateTime>,
    pub earliest_article_id: Option<i64>,
    pub current_summary: Option<String>,
    pub confidence: Option<f64>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct StoryLineageArticleEdgeRecord {
    pub id: i64,
    pub story_cluster_id: i64,
    pub from_article_id: i64,
    pub to_article_id: i64,
    pub relation: String,
    pub evidence: Option<Json<Value>>,
    pub confidence: Option<f64>,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct StoryLineageClaimRecord {
    pub id: i64,
    pub story_cluster_id: i64,
    pub article_id: i64,
    pub claim_text: String,
    pub normalized_claim: String,
    pub claim_hash: String,
    pub claim_type: Option<String>,
    pub checkability: Option<String>,
    pub evidence_span: Option<String>,
    pub entities: Option<Json<Value>>,
    pub numbers: Option<Json<Value>>,
    pub extracted_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct StoryLineageClaimEdgeRecord {
    pub id: i64,
    pub story_cluster_id: i64,
    pub from_claim_id: i64,
    pub to_claim_id: i64,
    pub relation: String,
    pub evidence: Option<Json<Value>>,
    pub confidence: Option<f64>,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow)]
pub struct StoryLineageCorrectionRecord {
    pub id: i64,
    pub source: String,
    pub article_id: Option<i64>,
    pub correction_url: Option<String>,
    pub correction_text: String,
    pub corrected_claim_id: Option<i64>,
    pub downstream_article_ids: Option<Json<Value>>,
    pub published_at: Option<NaiveDateTime>,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug)]
pub struct PersistedStoryLineage {
    pub story: StoryLineageRecord,
    pub article_edges: Vec<StoryLineageArticleEdgeRecord>,
    pub claims: Vec<StoryLineageClaimRecord>,
    pub claim_edges: Vec<StoryLineageClaimEdgeRecord>,
    pub corrections: Vec<StoryLineageCorrectionRecord>,
}

fn story_lineage_pg_id(value: i64, field: &str) -> Result<i32, sqlx::Error> {
    i32::try_from(value).map_err(|_| {
        sqlx::Error::Protocol(format!(
            "{field} {value} is outside the PostgreSQL INTEGER range"
        ))
    })
}
impl Database {
    pub async fn load_discovery_articles_since(
        &self,
        since: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<DiscoveryArticleRecord>, sqlx::Error> {
        load_discovery_articles_since(&self.pool, since, limit).await
    }

    pub async fn load_discovery_articles_by_ids(
        &self,
        ids: &[i64],
    ) -> Result<Vec<ArticleRecordById>, sqlx::Error> {
        load_discovery_articles_by_ids(&self.pool, ids).await
    }

    pub async fn count_discovery_articles_since(
        &self,
        since: DateTime<Utc>,
    ) -> Result<i64, sqlx::Error> {
        count_discovery_articles_since(&self.pool, since).await
    }

    pub async fn list_article_gdelt_events_by_article_ids(
        &self,
        article_ids: &[i64],
    ) -> Result<Vec<ArticleGdeltEventRecord>, sqlx::Error> {
        list_article_gdelt_events_by_article_ids(&self.pool, article_ids).await
    }
}

impl Database {
    pub async fn persist_story_lineage(
        &self,
        input: &StoryLineageWrite,
    ) -> Result<Option<PersistedStoryLineage>, sqlx::Error> {
        persist_story_lineage_in_pool(&self.pool, input).await
    }
}

async fn persist_story_lineage_in_pool(
    pool: &PgPool,
    input: &StoryLineageWrite,
) -> Result<Option<PersistedStoryLineage>, sqlx::Error> {
    if input.articles.is_empty() {
        return Ok(None);
    }

    let external_cluster_id =
        story_lineage_pg_id(input.external_cluster_id, "external cluster id")?;
    let article_ids = input
        .articles
        .iter()
        .map(|article| story_lineage_pg_id(article.article_id, "article id"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut transaction = pool.begin().await?;

    match persist_story_lineage_in_transaction(
        &mut transaction,
        input,
        external_cluster_id,
        &article_ids,
    )
    .await
    {
        Ok(persisted) => {
            transaction.commit().await?;
            Ok(Some(persisted))
        }
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

async fn persist_story_lineage_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    input: &StoryLineageWrite,
    external_cluster_id: i32,
    article_ids: &[i32],
) -> Result<PersistedStoryLineage, sqlx::Error> {
    let existing_ids = sqlx::query_scalar::<_, i32>("SELECT id FROM articles WHERE id = ANY($1)")
        .bind(article_ids)
        .fetch_all(&mut **transaction)
        .await?
        .into_iter()
        .collect::<HashSet<_>>();

    let usable_articles = input
        .articles
        .iter()
        .zip(article_ids.iter().copied())
        .filter(|(_, article_id)| existing_ids.is_empty() || existing_ids.contains(article_id))
        .collect::<Vec<_>>();
    let usable_article_ids = usable_articles
        .iter()
        .map(|(article, _)| article.article_id)
        .collect::<HashSet<_>>();
    let Some((earliest_article, _)) = usable_articles.first() else {
        return Err(sqlx::Error::Protocol(
            "story-lineage filtering produced no usable article".to_owned(),
        ));
    };
    let earliest_article_id = earliest_article.article_id;
    let unique_source_count = usable_articles
        .iter()
        .map(|(article, _)| article.source.as_str())
        .collect::<HashSet<_>>()
        .len();
    let confidence = (unique_source_count as f64 / 6.0).clamp(0.1, 1.0);
    let earliest_article_id_db = story_lineage_pg_id(earliest_article_id, "earliest article id")?;
    let story_label = input
        .label
        .as_deref()
        .filter(|label| !label.is_empty())
        .unwrap_or("Topic");
    let current_summary = input.label.as_deref().unwrap_or("");

    let story = sqlx::query_as::<_, StoryLineageRecord>(
        "INSERT INTO story_clusters \
             (external_cluster_id, label, keywords, first_seen_at, last_seen_at, \
              earliest_article_id, current_summary, confidence, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) \
         ON CONFLICT (external_cluster_id) DO UPDATE SET \
             label = EXCLUDED.label, keywords = EXCLUDED.keywords, \
             first_seen_at = EXCLUDED.first_seen_at, \
             last_seen_at = EXCLUDED.last_seen_at, \
             earliest_article_id = EXCLUDED.earliest_article_id, \
             current_summary = EXCLUDED.current_summary, \
             confidence = EXCLUDED.confidence, updated_at = CURRENT_TIMESTAMP \
         RETURNING id::bigint AS id, \
             external_cluster_id::bigint AS external_cluster_id, label, keywords, \
             first_seen_at, last_seen_at, earliest_article_id::bigint AS earliest_article_id, \
             current_summary, confidence, created_at, updated_at",
    )
    .bind(external_cluster_id)
    .bind(story_label)
    .bind(Json(&input.keywords))
    .bind(input.first_seen_at)
    .bind(input.last_seen_at)
    .bind(earliest_article_id_db)
    .bind(current_summary)
    .bind(confidence)
    .fetch_one(&mut **transaction)
    .await?;
    let story_cluster_id = story_lineage_pg_id(story.id, "story cluster id")?;

    let mut article_edges = Vec::new();
    for edge in &input.article_edges {
        if edge.from_article_id != earliest_article_id
            || !usable_article_ids.contains(&edge.to_article_id)
        {
            continue;
        }

        let from_article_id = story_lineage_pg_id(edge.from_article_id, "article edge source id")?;
        let to_article_id = story_lineage_pg_id(edge.to_article_id, "article edge target id")?;
        let record = sqlx::query_as::<_, StoryLineageArticleEdgeRecord>(
            "INSERT INTO article_edges \
                 (story_cluster_id, from_article_id, to_article_id, relation, evidence, confidence, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) \
             ON CONFLICT (story_cluster_id, from_article_id, to_article_id, relation) \
             DO UPDATE SET evidence = EXCLUDED.evidence, confidence = EXCLUDED.confidence \
             RETURNING id::bigint AS id, story_cluster_id::bigint AS story_cluster_id, \
                 from_article_id::bigint AS from_article_id, \
                 to_article_id::bigint AS to_article_id, relation, evidence, confidence, created_at",
        )
        .bind(story_cluster_id)
        .bind(from_article_id)
        .bind(to_article_id)
        .bind(&edge.relation)
        .bind(Json(&edge.evidence))
        .bind(edge.confidence)
        .fetch_one(&mut **transaction)
        .await?;
        article_edges.push(record);
    }

    let mut claims_by_key = HashMap::new();
    let mut claims = Vec::new();
    for claim in &input.claims {
        if !usable_article_ids.contains(&claim.article_id) {
            continue;
        }

        let article_id = story_lineage_pg_id(claim.article_id, "claim article id")?;
        let record = sqlx::query_as::<_, StoryLineageClaimRecord>(
            "INSERT INTO extracted_claims \
                 (story_cluster_id, article_id, claim_text, normalized_claim, claim_hash, \
                  claim_type, checkability, evidence_span, entities, numbers, extracted_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP) \
             ON CONFLICT (article_id, claim_hash) DO UPDATE SET \
                 claim_text = EXCLUDED.claim_text, \
                 normalized_claim = EXCLUDED.normalized_claim, \
                 claim_type = EXCLUDED.claim_type, checkability = EXCLUDED.checkability, \
                 evidence_span = EXCLUDED.evidence_span, entities = EXCLUDED.entities, \
                 numbers = EXCLUDED.numbers \
             RETURNING id::bigint AS id, story_cluster_id::bigint AS story_cluster_id, \
                 article_id::bigint AS article_id, claim_text, normalized_claim, claim_hash, \
                 claim_type, checkability, evidence_span, entities, numbers, extracted_at",
        )
        .bind(story_cluster_id)
        .bind(article_id)
        .bind(&claim.claim_text)
        .bind(&claim.normalized_claim)
        .bind(&claim.claim_hash)
        .bind(&claim.claim_type)
        .bind(&claim.checkability)
        .bind(&claim.evidence_span)
        .bind(Json(&claim.entities))
        .bind(Json(&claim.numbers))
        .fetch_one(&mut **transaction)
        .await?;
        let key = StoryLineageClaimKey {
            article_id: claim.article_id,
            claim_hash: claim.claim_hash.clone(),
        };
        claims_by_key.insert(key, story_lineage_pg_id(record.id, "claim id")?);
        claims.push(record);
    }

    let mut claim_edges = Vec::new();
    for edge in &input.claim_edges {
        let (Some(&from_claim_id), Some(&to_claim_id)) = (
            claims_by_key.get(&edge.from_claim),
            claims_by_key.get(&edge.to_claim),
        ) else {
            continue;
        };

        let record = sqlx::query_as::<_, StoryLineageClaimEdgeRecord>(
            "INSERT INTO claim_edges \
                 (story_cluster_id, from_claim_id, to_claim_id, relation, evidence, confidence, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) \
             ON CONFLICT (story_cluster_id, from_claim_id, to_claim_id, relation) \
             DO UPDATE SET evidence = EXCLUDED.evidence, confidence = EXCLUDED.confidence \
             RETURNING id::bigint AS id, story_cluster_id::bigint AS story_cluster_id, \
                 from_claim_id::bigint AS from_claim_id, to_claim_id::bigint AS to_claim_id, \
                 relation, evidence, confidence, created_at",
        )
        .bind(story_cluster_id)
        .bind(from_claim_id)
        .bind(to_claim_id)
        .bind(&edge.relation)
        .bind(Json(&edge.evidence))
        .bind(edge.confidence)
        .fetch_one(&mut **transaction)
        .await?;
        claim_edges.push(record);
    }

    let mut corrections = sqlx::query_as::<_, StoryLineageCorrectionRecord>(
        "SELECT id::bigint AS id, source, article_id::bigint AS article_id, \
                correction_url, correction_text, \
                corrected_claim_id::bigint AS corrected_claim_id, \
                downstream_article_ids, published_at, created_at \
         FROM corrections \
         WHERE corrected_claim_id IN \
             (SELECT id FROM extracted_claims WHERE story_cluster_id = $1) \
         ORDER BY id",
    )
    .bind(story_cluster_id)
    .fetch_all(&mut **transaction)
    .await?;

    if corrections.is_empty() {
        corrections = sqlx::query_as::<_, StoryLineageCorrectionRecord>(
            "SELECT id::bigint AS id, source, article_id::bigint AS article_id, \
                    correction_url, correction_text, \
                    corrected_claim_id::bigint AS corrected_claim_id, \
                    downstream_article_ids, published_at, created_at \
             FROM corrections WHERE article_id = $1 ORDER BY id",
        )
        .bind(earliest_article_id_db)
        .fetch_all(&mut **transaction)
        .await?;
    }

    Ok(PersistedStoryLineage {
        story,
        article_edges,
        claims,
        claim_edges,
        corrections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn create_story_lineage_tables(pool: &PgPool, reject_claim_edges: bool) {
        for statement in [
            "CREATE TABLE articles (id INTEGER PRIMARY KEY)",
            "CREATE TABLE story_clusters (\
                 id SERIAL PRIMARY KEY, external_cluster_id INTEGER NOT NULL UNIQUE, \
                 label VARCHAR, keywords JSON, first_seen_at TIMESTAMP, last_seen_at TIMESTAMP, \
                 earliest_article_id INTEGER, current_summary TEXT, confidence FLOAT, \
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\
             )",
            "CREATE TABLE article_edges (\
                 id SERIAL PRIMARY KEY, story_cluster_id INTEGER NOT NULL, \
                 from_article_id INTEGER NOT NULL, to_article_id INTEGER NOT NULL, \
                 relation VARCHAR NOT NULL, evidence JSON, confidence FLOAT, \
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                 UNIQUE (story_cluster_id, from_article_id, to_article_id, relation)\
             )",
            "CREATE TABLE extracted_claims (\
                 id SERIAL PRIMARY KEY, story_cluster_id INTEGER NOT NULL, \
                 article_id INTEGER NOT NULL, claim_text TEXT NOT NULL, \
                 normalized_claim TEXT NOT NULL, claim_hash VARCHAR NOT NULL, \
                 claim_type VARCHAR, checkability VARCHAR, evidence_span TEXT, \
                 entities JSON, numbers JSON, extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                 UNIQUE (article_id, claim_hash)\
             )",
        ] {
            sqlx::query(statement)
                .execute(pool)
                .await
                .expect("create story-lineage test table");
        }

        let claim_edge_constraint = if reject_claim_edges {
            ", CHECK (relation <> 'force_error')"
        } else {
            ""
        };
        let claim_edges_sql = format!(
            "CREATE TABLE claim_edges (\
                 id SERIAL PRIMARY KEY, story_cluster_id INTEGER NOT NULL, \
                 from_claim_id INTEGER NOT NULL, to_claim_id INTEGER NOT NULL, \
                 relation VARCHAR NOT NULL, evidence JSON, confidence FLOAT, \
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                 UNIQUE (story_cluster_id, from_claim_id, to_claim_id, relation){claim_edge_constraint}\
             )"
        );
        sqlx::query(&claim_edges_sql)
            .execute(pool)
            .await
            .expect("create claim-edge test table");

        sqlx::query(
            "CREATE TABLE corrections (\
                 id SERIAL PRIMARY KEY, source VARCHAR NOT NULL, article_id INTEGER, \
                 correction_url VARCHAR UNIQUE, correction_text TEXT NOT NULL, \
                 corrected_claim_id INTEGER, downstream_article_ids JSON, \
                 published_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\
             )",
        )
        .execute(pool)
        .await
        .expect("create correction test table");
    }

    fn story_input(external_cluster_id: i64, articles: &[(i64, &str)]) -> StoryLineageWrite {
        let article_refs = articles
            .iter()
            .map(|(article_id, source)| StoryLineageArticleRef {
                article_id: *article_id,
                source: (*source).to_owned(),
            })
            .collect::<Vec<_>>();
        let mut article_edges = Vec::new();
        for from_index in 0..articles.len() {
            for to_index in from_index + 1..articles.len() {
                article_edges.push(StoryLineageArticleEdgeWrite {
                    from_article_id: articles[from_index].0,
                    to_article_id: articles[to_index].0,
                    relation: "same_wire_story".to_owned(),
                    evidence: json!({"from": articles[from_index].0, "to": articles[to_index].0}),
                    confidence: 0.8,
                });
            }
        }

        let claims = articles
            .iter()
            .map(|(article_id, _)| StoryLineageClaimWrite {
                article_id: *article_id,
                claim_text: format!("Claim for article {article_id}."),
                normalized_claim: format!("claim for article {article_id}."),
                claim_hash: format!("claim-{article_id}"),
                claim_type: "statement".to_owned(),
                checkability: "checkable".to_owned(),
                evidence_span: None,
                entities: json!([]),
                numbers: json!([]),
            })
            .collect::<Vec<_>>();
        let mut claim_edges = Vec::new();
        for from_index in 0..claims.len() {
            for to_index in from_index + 1..claims.len() {
                claim_edges.push(StoryLineageClaimEdgeWrite {
                    from_claim: StoryLineageClaimKey {
                        article_id: claims[from_index].article_id,
                        claim_hash: claims[from_index].claim_hash.clone(),
                    },
                    to_claim: StoryLineageClaimKey {
                        article_id: claims[to_index].article_id,
                        claim_hash: claims[to_index].claim_hash.clone(),
                    },
                    relation: "supports".to_owned(),
                    evidence: json!({"basis": "shared topic"}),
                    confidence: 0.6,
                });
            }
        }

        StoryLineageWrite {
            external_cluster_id,
            label: Some("Election".to_owned()),
            keywords: vec!["vote".to_owned()],
            first_seen_at: Some(
                chrono::NaiveDateTime::parse_from_str("2026-10-01 10:00:00", "%Y-%m-%d %H:%M:%S")
                    .expect("valid test timestamp"),
            ),
            last_seen_at: Some(
                chrono::NaiveDateTime::parse_from_str("2026-10-02 10:00:00", "%Y-%m-%d %H:%M:%S")
                    .expect("valid test timestamp"),
            ),
            articles: article_refs,
            article_edges,
            claims,
            claim_edges,
        }
    }

    #[sqlx::test(migrations = false)]
    async fn lineage_upserts_are_idempotent_and_claim_corrections_win(pool: PgPool) {
        create_story_lineage_tables(&pool, false).await;
        sqlx::query("INSERT INTO articles (id) VALUES (10), (20), (30)")
            .execute(&pool)
            .await
            .expect("insert articles");
        let database = Database { pool: pool.clone() };
        let input = story_input(44, &[(10, "Reuters"), (20, "AP"), (30, "Reuters")]);

        let first = database
            .persist_story_lineage(&input)
            .await
            .expect("persist first lineage")
            .expect("non-empty lineage is persisted");
        assert_eq!(first.story.label.as_deref(), Some("Election"));
        assert_eq!(first.story.current_summary.as_deref(), Some("Election"));
        assert_eq!(first.story.earliest_article_id, Some(10));
        assert!((first.story.confidence.unwrap() - 1.0 / 3.0).abs() < f64::EPSILON);
        assert_eq!(first.article_edges.len(), 2);
        assert_eq!(first.claims.len(), 3);
        assert_eq!(first.claim_edges.len(), 3);
        assert!(first.corrections.is_empty());

        let corrected_claim_id = first
            .claims
            .iter()
            .find(|claim| claim.article_id == 20)
            .expect("claim for article 20")
            .id;
        sqlx::query(
            "INSERT INTO corrections \
                 (source, article_id, correction_url, correction_text, corrected_claim_id, \
                  downstream_article_ids) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind("AP")
        .bind(10_i32)
        .bind("https://example.test/claim-correction")
        .bind("The claim was corrected.")
        .bind(story_lineage_pg_id(corrected_claim_id, "claim id").expect("test claim id"))
        .bind(Json(json!([20])))
        .execute(&pool)
        .await
        .expect("insert claim correction");
        sqlx::query(
            "INSERT INTO corrections \
                 (source, article_id, correction_url, correction_text) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind("Reuters")
        .bind(10_i32)
        .bind("https://example.test/article-correction")
        .bind("The article was corrected.")
        .execute(&pool)
        .await
        .expect("insert article correction");

        let mut updated_input = input.clone();
        updated_input.label = Some("Election update".to_owned());
        updated_input.keywords = vec!["economy".to_owned()];
        updated_input.article_edges[0].evidence = json!({"basis": "updated evidence"});
        updated_input.article_edges[0].confidence = 0.95;
        updated_input
            .claims
            .iter_mut()
            .find(|claim| claim.article_id == 20)
            .expect("claim for article 20")
            .claim_text = "claim for article 20.".to_owned();

        let second = database
            .persist_story_lineage(&updated_input)
            .await
            .expect("persist updated lineage")
            .expect("non-empty lineage is persisted");
        assert_eq!(second.story.id, first.story.id);
        assert_eq!(second.story.label.as_deref(), Some("Election update"));
        assert_eq!(
            second.story.current_summary.as_deref(),
            Some("Election update")
        );
        assert_eq!(
            second.story.keywords.as_ref().map(|value| &value.0),
            Some(&json!(["economy"]))
        );
        assert_eq!(second.article_edges[0].id, first.article_edges[0].id);
        assert_eq!(
            second.article_edges[0]
                .evidence
                .as_ref()
                .map(|value| &value.0),
            Some(&json!({"basis": "updated evidence"}))
        );
        assert_eq!(second.claims[1].id, first.claims[1].id);
        assert_eq!(second.claims[1].claim_text, "claim for article 20.");
        assert_eq!(second.claim_edges[0].id, first.claim_edges[0].id);
        assert_eq!(second.corrections.len(), 1);
        assert_eq!(
            second.corrections[0].correction_url.as_deref(),
            Some("https://example.test/claim-correction")
        );

        let counts = sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT \
                 (SELECT COUNT(*) FROM story_clusters)::BIGINT, \
                 (SELECT COUNT(*) FROM article_edges)::BIGINT, \
                 (SELECT COUNT(*) FROM extracted_claims)::BIGINT, \
                 (SELECT COUNT(*) FROM claim_edges)::BIGINT",
        )
        .fetch_one(&pool)
        .await
        .expect("count persisted rows");
        assert_eq!(counts, (1, 2, 3, 3));
    }

    #[sqlx::test(migrations = false)]
    async fn existing_article_claim_keeps_its_original_story_cluster(pool: PgPool) {
        create_story_lineage_tables(&pool, false).await;
        let database = Database { pool: pool.clone() };
        let first_input = story_input(60, &[(10, "Reuters")]);
        let first = database
            .persist_story_lineage(&first_input)
            .await
            .expect("persist first story")
            .expect("non-empty lineage is persisted");

        let mut second_input = story_input(61, &[(10, "Reuters")]);
        second_input.claims[0].claim_text = "claim for article 10.".to_owned();
        let second = database
            .persist_story_lineage(&second_input)
            .await
            .expect("persist second story")
            .expect("non-empty lineage is persisted");

        assert_ne!(second.story.id, first.story.id);
        assert_eq!(second.claims.len(), 1);
        assert_eq!(second.claims[0].story_cluster_id, first.story.id);
        assert_eq!(second.claims[0].claim_text, "claim for article 10.");
        let counts = sqlx::query_as::<_, (i64, i64)>(
            "SELECT (SELECT COUNT(*) FROM story_clusters)::BIGINT, \
                    (SELECT COUNT(*) FROM extracted_claims)::BIGINT",
        )
        .fetch_one(&pool)
        .await
        .expect("count unique story claims");
        assert_eq!(counts, (2, 1));
    }

    #[sqlx::test(migrations = false)]
    async fn lineage_filters_existing_articles_and_falls_back_when_none_exist(pool: PgPool) {
        create_story_lineage_tables(&pool, false).await;
        sqlx::query("INSERT INTO articles (id) VALUES (20), (30)")
            .execute(&pool)
            .await
            .expect("insert existing articles");
        sqlx::query(
            "INSERT INTO corrections (source, article_id, correction_url, correction_text) \
             VALUES ('AP', 20, 'https://example.test/fallback', 'Article correction')",
        )
        .execute(&pool)
        .await
        .expect("insert article correction");
        let database = Database { pool: pool.clone() };
        let filtered_input = story_input(50, &[(10, "Reuters"), (20, "AP"), (30, "BBC")]);

        let filtered = database
            .persist_story_lineage(&filtered_input)
            .await
            .expect("persist filtered lineage")
            .expect("non-empty lineage is persisted");
        assert_eq!(filtered.story.earliest_article_id, Some(20));
        assert_eq!(filtered.article_edges.len(), 1);
        assert_eq!(filtered.article_edges[0].from_article_id, 20);
        assert_eq!(filtered.article_edges[0].to_article_id, 30);
        assert_eq!(
            filtered
                .claims
                .iter()
                .map(|claim| claim.article_id)
                .collect::<HashSet<_>>(),
            HashSet::from([20, 30])
        );
        assert_eq!(filtered.claim_edges.len(), 1);
        assert_eq!(filtered.corrections.len(), 1);
        assert_eq!(
            filtered.corrections[0].correction_url.as_deref(),
            Some("https://example.test/fallback")
        );

        let no_database_rows_input = story_input(51, &[(40, "Reuters"), (50, "AP")]);
        let fallback = database
            .persist_story_lineage(&no_database_rows_input)
            .await
            .expect("persist fallback lineage")
            .expect("non-empty lineage is persisted");
        assert_eq!(fallback.story.earliest_article_id, Some(40));
        assert_eq!(fallback.article_edges.len(), 1);
        assert_eq!(fallback.claims.len(), 2);
        assert_eq!(fallback.claim_edges.len(), 1);

        let empty_input = story_input(52, &[]);
        assert!(database
            .persist_story_lineage(&empty_input)
            .await
            .expect("empty lineage is a no-op")
            .is_none());
        let story_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM story_clusters")
            .fetch_one(&pool)
            .await
            .expect("count stories");
        assert_eq!(story_count, 2);
    }

    #[sqlx::test(migrations = false)]
    async fn lineage_failure_rolls_back_all_graph_rows(pool: PgPool) {
        create_story_lineage_tables(&pool, true).await;
        let database = Database { pool: pool.clone() };
        let mut input = story_input(77, &[(10, "Reuters"), (20, "AP")]);
        input.claim_edges[0].relation = "force_error".to_owned();

        assert!(database.persist_story_lineage(&input).await.is_err());
        let counts = sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT \
                 (SELECT COUNT(*) FROM story_clusters)::BIGINT, \
                 (SELECT COUNT(*) FROM article_edges)::BIGINT, \
                 (SELECT COUNT(*) FROM extracted_claims)::BIGINT, \
                 (SELECT COUNT(*) FROM claim_edges)::BIGINT",
        )
        .fetch_one(&pool)
        .await
        .expect("count rolled-back rows");
        assert_eq!(counts, (0, 0, 0, 0));
    }
}
