use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

#[derive(Clone, Debug, FromRow)]
pub struct GdeltEventRecord {
    pub id: i64,
    pub gdelt_id: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub source: Option<String>,
    pub published_at: Option<NaiveDateTime>,
    pub event_code: Option<String>,
    pub event_root_code: Option<String>,
    pub actor1_name: Option<String>,
    pub actor2_name: Option<String>,
    pub tone: Option<f64>,
    pub goldstein_scale: Option<f64>,
    pub article_id: Option<i64>,
    pub match_method: Option<String>,
    pub similarity_score: Option<f64>,
    pub matched_at: Option<NaiveDateTime>,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Clone, Debug, FromRow, PartialEq, Eq)]
pub struct GdeltArticleCountRecord {
    pub article_id: i64,
    pub event_count: i64,
    pub ranking: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct GdeltStatsRecord {
    pub total_events: i64,
    pub matched_events: i64,
    pub url_matched: i64,
    pub embedding_matched: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct TopicClusterSnapshotRecord {
    pub window: String,
    pub clusters_json: Value,
    pub cluster_count: i32,
    pub computed_at: NaiveDateTime,
}

#[derive(Clone, Debug, FromRow)]
pub struct BlindspotArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub source_id: Option<String>,
    pub url: String,
    pub image_url: Option<String>,
    pub published_at: Option<NaiveDateTime>,
    pub summary: Option<String>,
    pub category: Option<String>,
    pub bias: Option<String>,
    pub credibility: Option<String>,
    pub author: Option<String>,
    pub authors: Vec<String>,
    pub country: Option<String>,
    pub paywall_status: Option<String>,
    pub source_country: Option<String>,
    pub source_bias: Option<String>,
    pub source_factual_reporting: Option<String>,
}

#[derive(Clone, Debug)]
pub struct GdeltEventUpsert {
    pub gdelt_id: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub source: Option<String>,
    pub published_at: Option<NaiveDateTime>,
    pub event_code: Option<String>,
    pub event_root_code: Option<String>,
    pub actor1_name: Option<String>,
    pub actor1_country: Option<String>,
    pub actor2_name: Option<String>,
    pub actor2_country: Option<String>,
    pub tone: Option<f64>,
    pub goldstein_scale: Option<f64>,
    pub article_id: Option<i64>,
    pub matched_at: Option<NaiveDateTime>,
    pub match_method: Option<String>,
    pub similarity_score: Option<f64>,
    pub raw_data: Value,
}

#[derive(Clone, Debug, FromRow)]
pub struct BlindspotSourceArticleRecord {
    pub id: i64,
    pub source: Option<String>,
    pub published_at: Option<NaiveDateTime>,
    pub category: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
pub struct DailyArticleCoverageRecord {
    pub source_name: String,
    pub article_ids: Vec<i64>,
    pub article_count: i64,
    pub article_count_by_category: Value,
}

#[derive(Clone, Debug)]
pub struct SourceCoverageStatsWrite {
    pub source_name: String,
    pub date: NaiveDate,
    pub article_count: i64,
    pub article_count_by_category: Value,
    pub topics_covered: i64,
    pub cluster_ids: Value,
}

async fn upsert_gdelt_events(
    pool: &PgPool,
    events: &[GdeltEventUpsert],
) -> Result<u64, sqlx::Error> {
    if events.is_empty() {
        return Ok(0);
    }

    let mut transaction = pool.begin().await?;
    let mut query = QueryBuilder::<Postgres>::new(
        "INSERT INTO gdelt_events (gdelt_id, url, title, source, published_at, event_code, \
         event_root_code, actor1_name, actor1_country, actor2_name, actor2_country, tone, \
         goldstein_scale, article_id, matched_at, match_method, similarity_score, raw_data) ",
    );
    query.push_values(events, |mut row, event| {
        row.push_bind(&event.gdelt_id)
            .push_bind(&event.url)
            .push_bind(&event.title)
            .push_bind(&event.source)
            .push_bind(event.published_at)
            .push_bind(&event.event_code)
            .push_bind(&event.event_root_code)
            .push_bind(&event.actor1_name)
            .push_bind(&event.actor1_country)
            .push_bind(&event.actor2_name)
            .push_bind(&event.actor2_country)
            .push_bind(event.tone)
            .push_bind(event.goldstein_scale)
            .push_bind(event.article_id)
            .push_bind(event.matched_at)
            .push_bind(&event.match_method)
            .push_bind(event.similarity_score)
            .push_bind(sqlx::types::Json(&event.raw_data));
    });
    query.push(" ON CONFLICT (gdelt_id) DO NOTHING");
    let inserted = query
        .build()
        .execute(&mut *transaction)
        .await?
        .rows_affected();
    transaction.commit().await?;
    Ok(inserted)
}

async fn list_blindspot_source_articles(
    pool: &PgPool,
    source: Option<&str>,
    since: NaiveDateTime,
) -> Result<Vec<BlindspotSourceArticleRecord>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT id::bigint AS id, source, published_at, category FROM articles \
         WHERE published_at >= ",
    );
    query.push_bind(since);
    if let Some(source) = source.filter(|source| !source.is_empty()) {
        query.push(" AND source = ").push_bind(source);
    }
    query.push(" ORDER BY published_at DESC");
    query
        .build_query_as::<BlindspotSourceArticleRecord>()
        .fetch_all(pool)
        .await
}

async fn list_recent_article_ids(
    pool: &PgPool,
    since: NaiveDateTime,
    limit: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id::bigint FROM articles WHERE published_at >= $1 LIMIT $2",
    )
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await
}
async fn list_recent_blindspot_article_ids(
    pool: &PgPool,
    since: NaiveDateTime,
    limit: i64,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id::bigint FROM articles \
         WHERE published_at >= $1 AND content IS NOT NULL \
         ORDER BY published_at DESC LIMIT $2",
    )
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await
}

async fn list_recent_article_source_names(
    pool: &PgPool,
    since: NaiveDateTime,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT source FROM articles \
         WHERE published_at >= $1 AND source IS NOT NULL AND source <> ''",
    )
    .bind(since)
    .fetch_all(pool)
    .await
}

async fn list_active_source_names(
    pool: &PgPool,
    since: NaiveDateTime,
) -> Result<Vec<String>, sqlx::Error> {
    let active = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT source_name FROM source_metadata \
         WHERE last_analyzed_at IS NOT NULL AND source_name <> ''",
    )
    .fetch_all(pool)
    .await?;
    if !active.is_empty() {
        return Ok(active);
    }
    list_recent_article_source_names(pool, since).await
}

async fn list_covering_source_names(
    pool: &PgPool,
    article_ids: &[i64],
) -> Result<Vec<String>, sqlx::Error> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT source FROM articles \
         WHERE id::bigint = ANY($1) AND source IS NOT NULL AND source <> ''",
    )
    .bind(article_ids)
    .fetch_all(pool)
    .await
}

async fn list_daily_article_coverage(
    pool: &PgPool,
    date: NaiveDate,
) -> Result<Vec<DailyArticleCoverageRecord>, sqlx::Error> {
    let start = date.and_time(NaiveTime::MIN);
    let end = date
        .succ_opt()
        .ok_or_else(|| sqlx::Error::Protocol("coverage date exceeds supported range".into()))?
        .and_time(NaiveTime::MIN);
    sqlx::query_as::<_, DailyArticleCoverageRecord>(
        "WITH source_articles AS ( \
             SELECT source, id::bigint AS id, \
                    COALESCE(NULLIF(category, ''), 'general') AS category \
             FROM articles WHERE published_at >= $1 AND published_at < $2 \
               AND source IS NOT NULL \
         ), per_category AS ( \
             SELECT source, category, COUNT(*)::bigint AS category_count \
             FROM source_articles GROUP BY source, category \
         ), per_source AS ( \
             SELECT source, ARRAY_AGG(id ORDER BY id) AS article_ids, \
                    COUNT(*)::bigint AS article_count \
             FROM source_articles GROUP BY source \
         ) \
         SELECT per_source.source AS source_name, per_source.article_ids, \
                per_source.article_count, \
                COALESCE(JSON_OBJECT_AGG(per_category.category, per_category.category_count), \
                         '{}'::json) AS article_count_by_category \
         FROM per_source JOIN per_category USING (source) \
         GROUP BY per_source.source, per_source.article_ids, per_source.article_count \
         ORDER BY per_source.source",
    )
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await
}

async fn upsert_source_coverage_stats(
    pool: &PgPool,
    records: &[SourceCoverageStatsWrite],
) -> Result<u64, sqlx::Error> {
    if records.is_empty() {
        return Ok(0);
    }
    let mut transaction = pool.begin().await?;
    let mut query = QueryBuilder::<Postgres>::new(
        "INSERT INTO source_coverage_stats \
         (source_name, date, article_count, article_count_by_category, topics_covered, cluster_ids) ",
    );
    query.push_values(records, |mut row, record| {
        row.push_bind(&record.source_name)
            .push_bind(record.date)
            .push_bind(record.article_count)
            .push_bind(sqlx::types::Json(&record.article_count_by_category))
            .push_bind(record.topics_covered)
            .push_bind(sqlx::types::Json(&record.cluster_ids));
    });
    query.push(
        " ON CONFLICT (source_name, date) DO UPDATE SET \
             article_count = EXCLUDED.article_count, \
             article_count_by_category = EXCLUDED.article_count_by_category, \
             topics_covered = EXCLUDED.topics_covered, \
             cluster_ids = EXCLUDED.cluster_ids",
    );
    let result = query.build().execute(&mut *transaction).await?;
    let committed_sources = result.rows_affected();
    transaction.commit().await?;
    Ok(committed_sources)
}

pub(crate) async fn list_article_gdelt_events(
    pool: &PgPool,
    article_id: i32,
    limit: i64,
) -> Result<(Vec<GdeltEventRecord>, i64), sqlx::Error> {
    let events = sqlx::query_as::<_, GdeltEventRecord>(
        "SELECT id::bigint AS id, gdelt_id, url, title, source, \
            published_at, event_code, event_root_code, actor1_name, actor2_name, tone, \
            goldstein_scale, article_id::bigint AS article_id, match_method, similarity_score, \
            matched_at, created_at \
         FROM gdelt_events WHERE article_id = $1 \
         ORDER BY published_at DESC LIMIT $2",
    )
    .bind(article_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(id)::bigint FROM gdelt_events WHERE article_id = $1",
    )
    .bind(article_id)
    .fetch_one(pool)
    .await?;
    Ok((events, total))
}

pub(crate) async fn load_gdelt_stats(
    pool: &PgPool,
    since: NaiveDateTime,
) -> Result<(GdeltStatsRecord, Vec<GdeltArticleCountRecord>), sqlx::Error> {
    let stats = sqlx::query_as::<_, GdeltStatsRecord>(
        "SELECT \
            COUNT(*)::bigint AS total_events, \
            COUNT(*) FILTER (WHERE article_id IS NOT NULL)::bigint AS matched_events, \
            COUNT(*) FILTER (WHERE match_method = 'url')::bigint AS url_matched, \
            COUNT(*) FILTER (WHERE match_method = 'embedding')::bigint AS embedding_matched \
         FROM gdelt_events WHERE created_at >= $1",
    )
    .bind(since)
    .fetch_one(pool)
    .await?;

    let top_articles = sqlx::query_as::<_, GdeltArticleCountRecord>(
        "SELECT article_id::bigint AS article_id, event_count, ranking FROM ( \
            SELECT article_id, COUNT(*)::bigint AS event_count, \
                ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS ranking \
            FROM gdelt_events WHERE created_at >= $1 \
            GROUP BY article_id ORDER BY COUNT(*) DESC LIMIT 10 \
         ) AS ranked WHERE article_id IS NOT NULL ORDER BY ranking",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;
    Ok((stats, top_articles))
}

pub(crate) async fn list_recent_gdelt_events(
    pool: &PgPool,
    limit: i64,
    include_unmatched: bool,
) -> Result<Vec<GdeltEventRecord>, sqlx::Error> {
    sqlx::query_as::<_, GdeltEventRecord>(
        "SELECT id::bigint AS id, gdelt_id, url, title, source, \
            published_at, event_code, event_root_code, actor1_name, actor2_name, tone, \
            goldstein_scale, article_id::bigint AS article_id, match_method, similarity_score, \
            matched_at, created_at \
         FROM gdelt_events WHERE ($2 OR article_id IS NOT NULL) \
         ORDER BY created_at DESC LIMIT $1",
    )
    .bind(limit)
    .bind(include_unmatched)
    .fetch_all(pool)
    .await
}

pub(crate) async fn load_latest_topic_snapshot(
    pool: &PgPool,
    window: &str,
) -> Result<Option<TopicClusterSnapshotRecord>, sqlx::Error> {
    sqlx::query_as::<_, TopicClusterSnapshotRecord>(
        "SELECT \"window\", clusters_json, cluster_count, computed_at \
         FROM topic_cluster_snapshots WHERE \"window\" = $1 \
         ORDER BY computed_at DESC, id DESC LIMIT 1",
    )
    .bind(window)
    .fetch_optional(pool)
    .await
}

pub(crate) async fn save_topic_cluster_snapshot(
    pool: &PgPool,
    window: &str,
    clusters: &[Value],
) -> Result<TopicClusterSnapshotRecord, sqlx::Error> {
    let cluster_count =
        i32::try_from(clusters.len()).map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let mut transaction = pool.begin().await?;
    let snapshot = sqlx::query_as::<_, TopicClusterSnapshotRecord>(
        "INSERT INTO topic_cluster_snapshots (\"window\", clusters_json, cluster_count, computed_at) \
         VALUES ($1, $2, $3, NOW()) \
         RETURNING \"window\", clusters_json, cluster_count, computed_at",
    )
    .bind(window)
    .bind(sqlx::types::Json(clusters))
    .bind(cluster_count)
    .fetch_one(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM topic_cluster_snapshots WHERE \"window\" = $1 AND id NOT IN ( \
             SELECT id FROM topic_cluster_snapshots WHERE \"window\" = $1 \
             ORDER BY computed_at DESC, id DESC LIMIT 5)",
    )
    .bind(window)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(snapshot)
}

pub(crate) async fn load_blindspot_articles(
    pool: &PgPool,
    article_ids: &[i64],
) -> Result<Vec<BlindspotArticleRecord>, sqlx::Error> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, BlindspotArticleRecord>(
        "SELECT a.id::bigint AS id, a.title, a.source, a.source_id, a.url, a.image_url, \
            a.published_at, a.summary, a.category, a.bias, a.credibility, a.author, \
            COALESCE(a.authors, ARRAY[]::text[]) AS authors, \
            a.country, a.paywall_status, sm.country AS source_country, \
            sm.political_bias AS source_bias, sm.factual_rating AS source_factual_reporting \
         FROM articles a \
         LEFT JOIN source_metadata sm ON lower(sm.source_name) = lower(a.source) \
         WHERE a.id::bigint = ANY($1) \
         ORDER BY a.id",
    )
    .bind(article_ids)
    .fetch_all(pool)
    .await
}

impl crate::Database {
    pub async fn list_article_gdelt_events(
        &self,
        article_id: i32,
        limit: i64,
    ) -> Result<(Vec<GdeltEventRecord>, i64), sqlx::Error> {
        list_article_gdelt_events(&self.pool, article_id, limit).await
    }

    pub async fn load_gdelt_stats(
        &self,
        since: NaiveDateTime,
    ) -> Result<(GdeltStatsRecord, Vec<GdeltArticleCountRecord>), sqlx::Error> {
        load_gdelt_stats(&self.pool, since).await
    }

    pub async fn list_recent_gdelt_events(
        &self,
        limit: i64,
        include_unmatched: bool,
    ) -> Result<Vec<GdeltEventRecord>, sqlx::Error> {
        list_recent_gdelt_events(&self.pool, limit, include_unmatched).await
    }

    pub async fn load_latest_topic_snapshot(
        &self,
        window: &str,
    ) -> Result<Option<TopicClusterSnapshotRecord>, sqlx::Error> {
        load_latest_topic_snapshot(&self.pool, window).await
    }

    pub async fn load_blindspot_articles(
        &self,
        article_ids: &[i64],
    ) -> Result<Vec<BlindspotArticleRecord>, sqlx::Error> {
        load_blindspot_articles(&self.pool, article_ids).await
    }

    pub async fn save_topic_cluster_snapshot(
        &self,
        window: &str,
        clusters: &[Value],
    ) -> Result<TopicClusterSnapshotRecord, sqlx::Error> {
        save_topic_cluster_snapshot(&self.pool, window, clusters).await
    }
}

impl crate::Database {
    pub async fn upsert_gdelt_events(
        &self,
        events: &[GdeltEventUpsert],
    ) -> Result<u64, sqlx::Error> {
        upsert_gdelt_events(&self.pool, events).await
    }

    pub async fn list_blindspot_source_articles(
        &self,
        source: Option<&str>,
        since: NaiveDateTime,
    ) -> Result<Vec<BlindspotSourceArticleRecord>, sqlx::Error> {
        list_blindspot_source_articles(&self.pool, source, since).await
    }

    pub async fn list_recent_article_ids(
        &self,
        since: NaiveDateTime,
        limit: i64,
    ) -> Result<Vec<i64>, sqlx::Error> {
        list_recent_article_ids(&self.pool, since, limit).await
    }

    pub async fn list_recent_blindspot_article_ids(
        &self,
        since: NaiveDateTime,
        limit: i64,
    ) -> Result<Vec<i64>, sqlx::Error> {
        list_recent_blindspot_article_ids(&self.pool, since, limit).await
    }

    pub async fn list_recent_article_source_names(
        &self,
        since: NaiveDateTime,
    ) -> Result<Vec<String>, sqlx::Error> {
        list_recent_article_source_names(&self.pool, since).await
    }

    pub async fn list_active_source_names(
        &self,
        since: NaiveDateTime,
    ) -> Result<Vec<String>, sqlx::Error> {
        list_active_source_names(&self.pool, since).await
    }

    pub async fn list_covering_source_names(
        &self,
        article_ids: &[i64],
    ) -> Result<Vec<String>, sqlx::Error> {
        list_covering_source_names(&self.pool, article_ids).await
    }

    pub async fn list_daily_article_coverage(
        &self,
        date: NaiveDate,
    ) -> Result<Vec<DailyArticleCoverageRecord>, sqlx::Error> {
        list_daily_article_coverage(&self.pool, date).await
    }

    pub async fn upsert_source_coverage_stats(
        &self,
        records: &[SourceCoverageStatsWrite],
    ) -> Result<u64, sqlx::Error> {
        upsert_source_coverage_stats(&self.pool, records).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = false)]
    async fn gdelt_queries_limit_top_groups_before_dropping_unmatched(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE gdelt_events (\
                id SERIAL PRIMARY KEY, gdelt_id TEXT NOT NULL, url TEXT, title TEXT, source TEXT, \
                published_at TIMESTAMP, event_code TEXT, event_root_code TEXT, actor1_name TEXT, \
                actor2_name TEXT, tone DOUBLE PRECISION, goldstein_scale DOUBLE PRECISION, \
                article_id INTEGER, match_method TEXT, similarity_score DOUBLE PRECISION, \
                matched_at TIMESTAMP, created_at TIMESTAMP NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create isolated GDELT fixture table");
        sqlx::query(
            "INSERT INTO gdelt_events \
             (gdelt_id, published_at, article_id, match_method, created_at) VALUES \
             ('one', '2026-09-25 10:00:00', 7, 'url', '2026-09-25 10:00:00'), \
             ('two', '2026-09-25 11:00:00', 7, 'embedding', '2026-09-25 11:00:00'), \
             ('unmatched', '2026-09-25 12:00:00', NULL, NULL, '2026-09-25 12:00:00'), \
             ('unmatched-second', '2026-09-25 12:30:00', NULL, NULL, '2026-09-25 12:30:00'), \
             ('unmatched-third', '2026-09-25 13:00:00', NULL, NULL, '2026-09-25 13:00:00')",
        )
        .execute(&pool)
        .await
        .expect("seed isolated GDELT fixtures");
        sqlx::query(
            "INSERT INTO gdelt_events (gdelt_id, article_id, created_at) \
             SELECT 'article-' || article_id::text, article_id, '2026-09-25 09:30:00' \
             FROM generate_series(8, 16) AS generated(article_id)",
        )
        .execute(&pool)
        .await
        .expect("seed additional matched GDELT fixtures");

        let (article_events, total) = list_article_gdelt_events(&pool, 7, 1)
            .await
            .expect("query article events");
        assert_eq!(total, 2);
        assert_eq!(article_events.len(), 1);
        assert_eq!(article_events[0].gdelt_id, "two");

        let since = NaiveDateTime::parse_from_str("2026-09-25 09:00:00", "%Y-%m-%d %H:%M:%S")
            .expect("fixed test date");
        let (stats, top) = load_gdelt_stats(&pool, since)
            .await
            .expect("query aggregate stats");
        assert_eq!(stats.total_events, 14);
        assert_eq!(stats.matched_events, 11);
        assert_eq!(stats.url_matched, 1);
        assert_eq!(stats.embedding_matched, 1);
        assert_eq!(top.len(), 9, "the null group occupies one of the ten slots");
        assert_eq!(top[0].article_id, 7);
        assert_eq!(top[0].event_count, 2);
        assert!(top.windows(2).all(|pair| pair[0].ranking < pair[1].ranking));
        assert!(top
            .windows(2)
            .all(|pair| pair[0].event_count >= pair[1].event_count));

        let matched = list_recent_gdelt_events(&pool, 2, false)
            .await
            .expect("query matched recent events");
        assert_eq!(
            matched
                .iter()
                .map(|row| row.gdelt_id.as_str())
                .collect::<Vec<_>>(),
            ["two", "one"]
        );
        let all = list_recent_gdelt_events(&pool, 20, true)
            .await
            .expect("query all recent events");
        assert_eq!(all.len(), 14);
    }

    #[sqlx::test(migrations = false)]
    async fn snapshot_article_loader_uses_persisted_snapshot_and_source_metadata(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE topic_cluster_snapshots (\
                id SERIAL PRIMARY KEY, \"window\" TEXT NOT NULL, clusters_json JSON NOT NULL, \
                cluster_count INTEGER NOT NULL, computed_at TIMESTAMP NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create isolated snapshot table");
        sqlx::query(
            "CREATE TABLE articles (\
                id SERIAL PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT, \
                url TEXT NOT NULL, image_url TEXT, published_at TIMESTAMP NOT NULL, summary TEXT, \
                category TEXT, bias TEXT, credibility TEXT, author TEXT, authors TEXT[], country TEXT, \
                paywall_status TEXT)",
        )
        .execute(&pool)
        .await
        .expect("create isolated articles table");
        sqlx::query(
            "CREATE TABLE source_metadata (\
                source_name TEXT NOT NULL, country TEXT, political_bias TEXT, factual_rating TEXT)",
        )
        .execute(&pool)
        .await
        .expect("create isolated source metadata table");
        sqlx::query(
            "INSERT INTO topic_cluster_snapshots \
             (\"window\", clusters_json, cluster_count, computed_at) VALUES \
             ('1w', '[{\"cluster_id\":7}]', 1, '2026-09-25 10:00:00')",
        )
        .execute(&pool)
        .await
        .expect("seed snapshot");
        sqlx::query(
            "INSERT INTO articles \
             (id, title, source, source_id, url, published_at, authors, paywall_status) \
             VALUES (7, 'Story', 'Example News', 'example-news', 'https://example.test/story', \
                '2026-09-25 10:00:00', ARRAY['A Reporter']::text[], 'free')",
        )
        .execute(&pool)
        .await
        .expect("seed article");
        sqlx::query(
            "INSERT INTO source_metadata (source_name, country, political_bias, factual_rating) \
             VALUES ('Example News', 'US', 'center', 'high')",
        )
        .execute(&pool)
        .await
        .expect("seed source metadata");

        let snapshot = load_latest_topic_snapshot(&pool, "1w")
            .await
            .expect("query persisted snapshot")
            .expect("snapshot exists");
        assert_eq!(snapshot.cluster_count, 1);
        assert_eq!(snapshot.clusters_json[0]["cluster_id"], 7);
        let articles = load_blindspot_articles(&pool, &[7])
            .await
            .expect("query fixture article");
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].source_country.as_deref(), Some("US"));
        assert_eq!(articles[0].source_bias.as_deref(), Some("center"));
        assert_eq!(
            articles[0].source_factual_reporting.as_deref(),
            Some("high")
        );
        assert_eq!(articles[0].authors, ["A Reporter"]);
    }
    #[sqlx::test(migrations = false)]
    async fn bounded_blindspot_article_ids_filter_content_and_apply_database_limit(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE articles (\
                id BIGINT PRIMARY KEY, published_at TIMESTAMP NOT NULL, content TEXT)",
        )
        .execute(&pool)
        .await
        .expect("create isolated article fixtures");
        sqlx::query(
            "INSERT INTO articles (id, published_at, content) VALUES \
             (1, '2026-09-24 23:59:00', 'old'), \
             (2, '2026-09-25 10:00:00', 'eligible'), \
             (3, '2026-09-25 11:00:00', NULL), \
             (4, '2026-09-25 12:00:00', 'newest')",
        )
        .execute(&pool)
        .await
        .expect("seed article fixtures");

        let since = NaiveDateTime::parse_from_str("2026-09-25 00:00:00", "%Y-%m-%d %H:%M:%S")
            .expect("fixed test date");
        let ids = list_recent_blindspot_article_ids(&pool, since, 2)
            .await
            .expect("query bounded recent articles");

        assert_eq!(ids, [4, 2]);
    }
}
