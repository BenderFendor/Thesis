//! Persisted, user-scoped highlight storage for the reading workspace.
//!
//! Every operation takes an explicit owner and executes through one SQL
//! transaction.  Rust also serializes the logical highlight key before
//! inserting it, so concurrent Rust writers cannot create a duplicate range
//! for the same user and article.  FastAPI currently permits duplicate rows;
//! that weaker write invariant is an intentional migration divergence.
//!
//! The legacy Python service also treats a JSON `null` note in a patch as an
//! omitted update.  Rust treats an explicit null as a request to clear the
//! note, which is the useful interpretation of the nullable public field and
//! keeps patch operations composable.

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use std::fmt;

use super::Database;

/// The single-user owner retained by the public FastAPI contract.
pub const DEFAULT_HIGHLIGHT_USER_ID: i32 = 1;

/// A persisted highlight in the public response shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HighlightRecord {
    pub id: Option<i32>,
    pub user_id: Option<i32>,
    pub article_url: String,
    pub highlighted_text: String,
    pub color: String,
    pub note: Option<String>,
    pub character_start: i32,
    pub character_end: i32,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Fields accepted when a highlight is created.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HighlightCreate {
    pub article_url: String,
    pub highlighted_text: String,
    pub color: String,
    pub note: Option<String>,
    pub character_start: i32,
    pub character_end: i32,
}

/// Fields accepted by a highlight patch.
///
/// The outer `Option` records whether `note` was present.  The inner option
/// records whether it was explicitly null, allowing a caller to clear a note
/// without confusing that request with an omitted field.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HighlightPatch {
    pub color: Option<String>,
    pub note: Option<Option<String>>,
}

/// Persistence and integrity failures for highlight mutations.
#[derive(Debug)]
pub enum HighlightError {
    InvalidInput {
        field: &'static str,
        message: &'static str,
    },
    Database(sqlx::Error),
}

impl fmt::Display for HighlightError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput { field, message } => write!(formatter, "{field}: {message}"),
            Self::Database(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for HighlightError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidInput { .. } => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for HighlightError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug, FromRow)]
struct HighlightRow {
    id: i32,
    user_id: Option<i32>,
    article_url: String,
    highlighted_text: String,
    color: String,
    note: Option<String>,
    character_start: i32,
    character_end: i32,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
}

impl From<HighlightRow> for HighlightRecord {
    fn from(row: HighlightRow) -> Self {
        Self {
            id: Some(row.id),
            user_id: row.user_id,
            article_url: row.article_url,
            highlighted_text: row.highlighted_text,
            color: row.color,
            note: row.note,
            character_start: row.character_start,
            character_end: row.character_end,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

const LIST_HIGHLIGHTS_QUERY: &str =
    "SELECT id, user_id, article_url, highlighted_text, color, note, \
    character_start, character_end, created_at, updated_at \
    FROM highlights \
    WHERE user_id = $1 \
    ORDER BY created_at DESC NULLS LAST, id DESC";

const LIST_ARTICLE_HIGHLIGHTS_QUERY: &str =
    "SELECT id, user_id, article_url, highlighted_text, color, note, \
    character_start, character_end, created_at, updated_at \
    FROM highlights \
    WHERE user_id = $1 AND article_url = $2 \
    ORDER BY created_at ASC NULLS LAST, id ASC";

const FIND_DUPLICATE_HIGHLIGHT_QUERY: &str =
    "SELECT id, user_id, article_url, highlighted_text, color, note, \
    character_start, character_end, created_at, updated_at \
    FROM highlights \
    WHERE user_id = $1 AND article_url = $2 AND highlighted_text = $3 \
      AND character_start = $4 AND character_end = $5 \
    ORDER BY id ASC \
    LIMIT 1 \
    FOR UPDATE";

const INSERT_HIGHLIGHT_QUERY: &str = "INSERT INTO highlights \
    (user_id, article_url, highlighted_text, color, note, character_start, character_end, created_at, updated_at) \
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) \
    RETURNING id, user_id, article_url, highlighted_text, color, note, character_start, character_end, created_at, updated_at";

const UPDATE_HIGHLIGHT_QUERY: &str = "UPDATE highlights \
    SET color = COALESCE($3, color), \
        note = CASE WHEN $4 THEN $5 ELSE note END, \
        updated_at = NOW() \
    WHERE id = $1 AND user_id = $2 \
    RETURNING id, user_id, article_url, highlighted_text, color, note, character_start, character_end, created_at, updated_at";

const DELETE_HIGHLIGHT_QUERY: &str = "DELETE FROM highlights \
    WHERE id = $1 AND user_id = $2 \
    RETURNING id";

fn validate_owner(user_id: i32) -> Result<(), HighlightError> {
    if user_id > 0 {
        Ok(())
    } else {
        Err(HighlightError::InvalidInput {
            field: "user_id",
            message: "must be a positive integer",
        })
    }
}

fn validate_create(user_id: i32, request: &HighlightCreate) -> Result<(), HighlightError> {
    validate_owner(user_id)?;
    if request.article_url.trim().is_empty() {
        return Err(HighlightError::InvalidInput {
            field: "article_url",
            message: "must not be empty",
        });
    }
    if request.highlighted_text.trim().is_empty() {
        return Err(HighlightError::InvalidInput {
            field: "highlighted_text",
            message: "must not be empty",
        });
    }
    if request.color.trim().is_empty() {
        return Err(HighlightError::InvalidInput {
            field: "color",
            message: "must not be empty",
        });
    }
    if request.character_start < 0 {
        return Err(HighlightError::InvalidInput {
            field: "character_start",
            message: "must be non-negative",
        });
    }
    if request.character_end <= request.character_start {
        return Err(HighlightError::InvalidInput {
            field: "character_end",
            message: "must be greater than character_start",
        });
    }
    Ok(())
}

fn duplicate_lock_key(user_id: i32, request: &HighlightCreate) -> String {
    format!(
        "{user_id}\u{1f}{}:{}\u{1f}{}:{}\u{1f}{}\u{1f}{}",
        request.article_url.len(),
        request.article_url,
        request.highlighted_text.len(),
        request.highlighted_text,
        request.character_start,
        request.character_end,
    )
}

impl Database {
    /// List highlights owned by one user in newest-created order.
    pub async fn list_highlights(&self, user_id: i32) -> Result<Vec<HighlightRecord>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let rows = sqlx::query_as::<_, HighlightRow>(LIST_HIGHLIGHTS_QUERY)
            .bind(user_id)
            .fetch_all(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// List one user's highlights for an exact article URL.
    pub async fn list_highlights_for_article(
        &self,
        user_id: i32,
        article_url: &str,
    ) -> Result<Vec<HighlightRecord>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let rows = sqlx::query_as::<_, HighlightRow>(LIST_ARTICLE_HIGHLIGHTS_QUERY)
            .bind(user_id)
            .bind(article_url)
            .fetch_all(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Persist one highlight, returning the existing logical row on a duplicate.
    ///
    /// The advisory lock is transaction-scoped and keyed by the full logical
    /// identity because the deployed legacy table has no uniqueness constraint
    /// for highlight ranges.  It closes the check-then-insert race for Rust
    /// writers without changing the public schema or deleting legacy rows.
    pub async fn create_highlight(
        &self,
        user_id: i32,
        request: HighlightCreate,
    ) -> Result<HighlightRecord, HighlightError> {
        validate_create(user_id, &request)?;
        let mut transaction = self.pool.begin().await?;
        let lock_key = duplicate_lock_key(user_id, &request);
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))")
            .bind(lock_key)
            .execute(&mut *transaction)
            .await?;

        if let Some(row) = sqlx::query_as::<_, HighlightRow>(FIND_DUPLICATE_HIGHLIGHT_QUERY)
            .bind(user_id)
            .bind(&request.article_url)
            .bind(&request.highlighted_text)
            .bind(request.character_start)
            .bind(request.character_end)
            .fetch_optional(&mut *transaction)
            .await?
        {
            transaction.commit().await?;
            return Ok(row.into());
        }

        let row = sqlx::query_as::<_, HighlightRow>(INSERT_HIGHLIGHT_QUERY)
            .bind(user_id)
            .bind(&request.article_url)
            .bind(&request.highlighted_text)
            .bind(&request.color)
            .bind(&request.note)
            .bind(request.character_start)
            .bind(request.character_end)
            .fetch_one(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(row.into())
    }

    /// Update one owned highlight, returning `None` when it is not visible to the user.
    pub async fn update_highlight(
        &self,
        user_id: i32,
        highlight_id: i32,
        patch: HighlightPatch,
    ) -> Result<Option<HighlightRecord>, HighlightError> {
        validate_owner(user_id)?;
        if let Some(color) = patch.color.as_deref() {
            if color.trim().is_empty() {
                return Err(HighlightError::InvalidInput {
                    field: "color",
                    message: "must not be empty",
                });
            }
        }
        let mut transaction = self.pool.begin().await?;
        let note_present = patch.note.is_some();
        let note = patch.note.flatten();
        let row = sqlx::query_as::<_, HighlightRow>(UPDATE_HIGHLIGHT_QUERY)
            .bind(highlight_id)
            .bind(user_id)
            .bind(patch.color)
            .bind(note_present)
            .bind(note)
            .fetch_optional(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(row.map(Into::into))
    }

    /// Delete one owned highlight and report whether a row was removed.
    pub async fn delete_highlight(
        &self,
        user_id: i32,
        highlight_id: i32,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let deleted = sqlx::query(DELETE_HIGHLIGHT_QUERY)
            .bind(highlight_id)
            .bind(user_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();
        transaction.commit().await?;
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::{duplicate_lock_key, HighlightCreate};

    #[test]
    fn duplicate_lock_key_includes_owner_and_range_identity() {
        let request = HighlightCreate {
            article_url: "https://example.test/story".to_owned(),
            highlighted_text: "A sentence".to_owned(),
            color: "yellow".to_owned(),
            note: None,
            character_start: 2,
            character_end: 12,
        };
        assert_ne!(
            duplicate_lock_key(1, &request),
            duplicate_lock_key(2, &request)
        );
        assert!(duplicate_lock_key(1, &request).contains("https://example.test/story"));
    }
}
