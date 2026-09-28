use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

use crate::Database;

#[derive(Clone, Debug, FromRow)]
pub struct ImageCacheRecord {
    pub bytes: Vec<u8>,
    pub content_type: String,
    pub stored_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
pub struct ImageCacheStats {
    pub total_files: i64,
    pub total_size_bytes: i64,
}

async fn get_cached_image(
    pool: &PgPool,
    url: &str,
) -> Result<Option<ImageCacheRecord>, sqlx::Error> {
    sqlx::query_as::<_, ImageCacheRecord>(
        "SELECT bytes, content_type, stored_at FROM image_cache WHERE url = $1",
    )
    .bind(url)
    .fetch_optional(pool)
    .await
}

async fn put_cached_image(
    pool: &PgPool,
    url: &str,
    bytes: &[u8],
    content_type: &str,
    stored_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO image_cache (url, bytes, content_type, stored_at) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (url) DO UPDATE SET bytes = EXCLUDED.bytes, \
             content_type = EXCLUDED.content_type, stored_at = EXCLUDED.stored_at",
    )
    .bind(url)
    .bind(bytes)
    .bind(content_type)
    .bind(stored_at)
    .execute(pool)
    .await?;
    Ok(())
}

async fn image_cache_stats(pool: &PgPool) -> Result<ImageCacheStats, sqlx::Error> {
    sqlx::query_as::<_, ImageCacheStats>(
        "SELECT COUNT(*)::bigint AS total_files, \
                COALESCE(SUM(OCTET_LENGTH(bytes)), 0)::bigint AS total_size_bytes \
         FROM image_cache",
    )
    .fetch_one(pool)
    .await
}

async fn clear_image_cache(pool: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM image_cache")
        .execute(pool)
        .await?
        .rows_affected())
}

impl Database {
    pub async fn get_cached_image(
        &self,
        url: &str,
    ) -> Result<Option<ImageCacheRecord>, sqlx::Error> {
        get_cached_image(&self.pool, url).await
    }

    pub async fn put_cached_image(
        &self,
        url: &str,
        bytes: &[u8],
        content_type: &str,
        stored_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        put_cached_image(&self.pool, url, bytes, content_type, stored_at).await
    }

    pub async fn image_cache_stats(&self) -> Result<ImageCacheStats, sqlx::Error> {
        image_cache_stats(&self.pool).await
    }

    pub async fn clear_image_cache(&self) -> Result<u64, sqlx::Error> {
        clear_image_cache(&self.pool).await
    }
}
