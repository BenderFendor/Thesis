use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

use crate::Database;

#[derive(Clone, Debug, FromRow)]
pub struct VerificationCacheRecord {
    pub claim_hash: String,
    pub claim_text: String,
    pub confidence: f64,
    pub confidence_level: String,
    pub sources_json: Option<Value>,
    pub verified_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct VerificationCacheWrite {
    pub claim_hash: String,
    pub claim_text: String,
    pub confidence: f64,
    pub confidence_level: String,
    pub sources_json: Option<Value>,
    pub expires_at: DateTime<Utc>,
}

async fn get_verification_cache(
    pool: &PgPool,
    claim_hash: &str,
    now: DateTime<Utc>,
) -> Result<Option<VerificationCacheRecord>, sqlx::Error> {
    sqlx::query_as::<_, VerificationCacheRecord>(
        "SELECT claim_hash, claim_text, confidence, confidence_level, sources_json, \
                verified_at, expires_at \
         FROM verification_cache \
         WHERE claim_hash = $1 AND expires_at > $2",
    )
    .bind(claim_hash)
    .bind(now)
    .fetch_optional(pool)
    .await
}

async fn upsert_verification_cache(
    pool: &PgPool,
    write: VerificationCacheWrite,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO verification_cache \
             (claim_hash, claim_text, confidence, confidence_level, sources_json, verified_at, expires_at) \
         VALUES ($1, $2, $3, $4, $5, NOW(), $6) \
         ON CONFLICT (claim_hash) DO UPDATE SET \
             claim_text = EXCLUDED.claim_text, confidence = EXCLUDED.confidence, \
             confidence_level = EXCLUDED.confidence_level, sources_json = EXCLUDED.sources_json, \
             verified_at = EXCLUDED.verified_at, expires_at = EXCLUDED.expires_at",
    )
    .bind(write.claim_hash)
    .bind(write.claim_text)
    .bind(write.confidence)
    .bind(write.confidence_level)
    .bind(write.sources_json)
    .bind(write.expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

async fn clear_expired_verification_cache(
    pool: &PgPool,
    now: DateTime<Utc>,
) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM verification_cache WHERE expires_at < $1")
            .bind(now)
            .execute(pool)
            .await?
            .rows_affected(),
    )
}

pub fn verification_claim_hash(claim_text: &str) -> String {
    let normalized = claim_text
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    crate::wiki::sha256_hex(normalized.as_bytes())[..32].to_owned()
}

#[cfg(test)]
mod tests {
    use super::verification_claim_hash;

    #[test]
    fn claim_hash_normalizes_case_and_whitespace_before_hashing() {
        assert_eq!(
            verification_claim_hash("  A\tB  "),
            "c8687a08aa5d6ed2044328fa6a697ab8"
        );
    }
}

impl Database {
    pub async fn get_verification_cache_now(
        &self,
        claim_hash: &str,
    ) -> Result<Option<VerificationCacheRecord>, sqlx::Error> {
        get_verification_cache(&self.pool, claim_hash, Utc::now()).await
    }

    pub async fn upsert_verification_cache_ttl(
        &self,
        claim_hash: &str,
        claim_text: &str,
        confidence: f64,
        confidence_level: &str,
        sources_json: Option<Value>,
        ttl_hours: i64,
    ) -> Result<(), sqlx::Error> {
        upsert_verification_cache(
            &self.pool,
            VerificationCacheWrite {
                claim_hash: claim_hash.to_owned(),
                claim_text: claim_text.to_owned(),
                confidence,
                confidence_level: confidence_level.to_owned(),
                sources_json,
                expires_at: Utc::now() + chrono::Duration::hours(ttl_hours),
            },
        )
        .await
    }

    pub async fn clear_expired_verification_cache_now(&self) -> Result<u64, sqlx::Error> {
        clear_expired_verification_cache(&self.pool, Utc::now()).await
    }
}

impl Database {
    pub async fn get_verification_cache(
        &self,
        claim_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<VerificationCacheRecord>, sqlx::Error> {
        get_verification_cache(&self.pool, claim_hash, now).await
    }

    pub async fn upsert_verification_cache(
        &self,
        write: VerificationCacheWrite,
    ) -> Result<(), sqlx::Error> {
        upsert_verification_cache(&self.pool, write).await
    }

    pub async fn clear_expired_verification_cache(
        &self,
        now: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        clear_expired_verification_cache(&self.pool, now).await
    }
}
