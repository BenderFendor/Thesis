use chrono::{DateTime, Utc};
use sqlx::{FromRow, Postgres, Transaction};

use super::Database;

/// The single-user scope retained by the existing FastAPI routes.
pub const DEFAULT_READING_QUEUE_USER_ID: i32 = 1;

#[derive(Clone, Debug)]
pub struct ReadingQueueCreate {
    pub article_id: i32,
    pub article_title: String,
    pub article_url: String,
    pub article_source: String,
    pub article_image: Option<String>,
    pub queue_type: String,
    pub why_saved: Option<String>,
    pub unresolved_question: Option<String>,
    pub shelf_id: Option<i32>,
}

#[derive(Clone, Debug, Default)]
pub struct ReadingQueueUpdate {
    pub read_status: Option<String>,
    pub queue_type: Option<String>,
    pub position: Option<i32>,
    pub archived_at: Option<DateTime<Utc>>,
    pub why_saved: Option<String>,
    pub unresolved_question: Option<String>,
    pub shelf_id: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct ReadingShelfCreate {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ReadingShelfUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ReadingQueueItemRecord {
    pub id: i32,
    pub user_id: Option<i32>,
    pub article_id: i32,
    pub article_title: String,
    pub article_url: String,
    pub article_source: String,
    pub article_image: Option<String>,
    pub queue_type: String,
    pub position: i32,
    pub read_status: String,
    pub added_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub word_count: Option<i32>,
    pub estimated_read_time_minutes: Option<i32>,
    pub full_text: Option<String>,
    pub why_saved: Option<String>,
    pub unresolved_question: Option<String>,
    pub shelf_id: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct ReadingShelfRecord {
    pub id: i32,
    pub user_id: Option<i32>,
    pub name: String,
    pub description: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct QueueOverviewRecord {
    pub total_items: i64,
    pub daily_items: i64,
    pub permanent_items: i64,
    pub unread_count: i64,
    pub reading_count: i64,
    pub completed_count: i64,
    pub estimated_total_read_time_minutes: i64,
}

#[derive(Clone, Debug)]
pub struct DailyDigestRecord {
    pub digest_items: Vec<ReadingQueueItemRecord>,
    pub total_items: i64,
    pub estimated_read_time_minutes: i64,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug)]
pub enum ReadingQueueError {
    Database(sqlx::Error),
    ShelfNotFound,
    EmptyShelfName,
}

impl std::fmt::Display for ReadingQueueError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "{error}"),
            Self::ShelfNotFound => formatter.write_str("shelf not found"),
            Self::EmptyShelfName => formatter.write_str("Shelf name is required"),
        }
    }
}

impl std::error::Error for ReadingQueueError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::ShelfNotFound | Self::EmptyShelfName => None,
        }
    }
}

impl From<sqlx::Error> for ReadingQueueError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug, FromRow)]
struct ReadingQueueItemRow {
    id: i32,
    user_id: Option<i32>,
    article_id: i32,
    article_title: String,
    article_url: String,
    article_source: String,
    article_image: Option<String>,
    queue_type: String,
    position: i32,
    read_status: String,
    added_at: DateTime<Utc>,
    archived_at: Option<DateTime<Utc>>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    word_count: Option<i32>,
    estimated_read_time_minutes: Option<i32>,
    full_text: Option<String>,
    why_saved: Option<String>,
    unresolved_question: Option<String>,
    shelf_id: Option<i32>,
}

impl From<ReadingQueueItemRow> for ReadingQueueItemRecord {
    fn from(row: ReadingQueueItemRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            article_id: row.article_id,
            article_title: row.article_title,
            article_url: row.article_url,
            article_source: row.article_source,
            article_image: row.article_image,
            queue_type: row.queue_type,
            position: row.position,
            read_status: row.read_status,
            added_at: row.added_at,
            archived_at: row.archived_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            word_count: row.word_count,
            estimated_read_time_minutes: row.estimated_read_time_minutes,
            full_text: row.full_text,
            why_saved: row.why_saved,
            unresolved_question: row.unresolved_question,
            shelf_id: row.shelf_id,
        }
    }
}

#[derive(Debug, FromRow)]
struct ReadingShelfRow {
    id: i32,
    user_id: Option<i32>,
    name: String,
    description: Option<String>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
}

impl From<ReadingShelfRow> for ReadingShelfRecord {
    fn from(row: ReadingShelfRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            name: row.name,
            description: row.description,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, FromRow)]
struct QueueOverviewRow {
    total_items: i64,
    daily_items: i64,
    permanent_items: i64,
    unread_count: i64,
    reading_count: i64,
    completed_count: i64,
    estimated_total_read_time_minutes: i64,
}

impl From<QueueOverviewRow> for QueueOverviewRecord {
    fn from(row: QueueOverviewRow) -> Self {
        Self {
            total_items: row.total_items,
            daily_items: row.daily_items,
            permanent_items: row.permanent_items,
            unread_count: row.unread_count,
            reading_count: row.reading_count,
            completed_count: row.completed_count,
            estimated_total_read_time_minutes: row.estimated_total_read_time_minutes,
        }
    }
}

const QUEUE_SELECT: &str = "SELECT id, user_id, article_id, article_title, article_url, \
    article_source, article_image, queue_type, position, read_status, added_at, \
    archived_at, created_at, updated_at, word_count, estimated_read_time_minutes, \
    full_text, why_saved, unresolved_question, shelf_id FROM reading_queue";

const SHELF_SELECT: &str =
    "SELECT id, user_id, name, description, created_at, updated_at FROM reading_shelves";

impl Database {
    /// Add an item or update the optional memory fields of the existing URL row.
    ///
    /// The operation is one transaction so the unique URL invariant and position
    /// assignment remain race-safe. Article extraction is intentionally not part
    /// of this persistence boundary; callers must provide only locally available
    /// article metadata.
    pub async fn add_reading_queue_item(
        &self,
        request: ReadingQueueCreate,
    ) -> Result<ReadingQueueItemRecord, ReadingQueueError> {
        let mut transaction = self.pool.begin().await?;
        if let Some(shelf_id) = request.shelf_id {
            ensure_shelf(&mut transaction, shelf_id).await?;
        }

        let existing_query =
            format!("{QUEUE_SELECT} WHERE article_url = $1 AND user_id = $2 FOR UPDATE");
        if let Some(existing) = sqlx::query_as::<_, ReadingQueueItemRow>(&existing_query)
            .bind(&request.article_url)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_optional(&mut *transaction)
            .await?
        {
            // FastAPI updates only these optional fields on a duplicate add. Null
            // request values are no-ops, preserving existing annotations.
            if request.why_saved.is_none()
                && request.unresolved_question.is_none()
                && request.shelf_id.is_none()
            {
                transaction.commit().await?;
                return Ok(existing.into());
            }
            let updated = sqlx::query_as::<_, ReadingQueueItemRow>(concat!(
                "UPDATE reading_queue SET ",
                "why_saved = COALESCE($2, why_saved), ",
                "unresolved_question = COALESCE($3, unresolved_question), ",
                "shelf_id = COALESCE($4, shelf_id), updated_at = NOW() ",
                "WHERE id = $1 RETURNING id, user_id, article_id, article_title, article_url, ",
                "article_source, article_image, queue_type, position, read_status, added_at, ",
                "archived_at, created_at, updated_at, word_count, estimated_read_time_minutes, ",
                "full_text, why_saved, unresolved_question, shelf_id"
            ))
            .bind(existing.id)
            .bind(request.why_saved)
            .bind(request.unresolved_question)
            .bind(request.shelf_id)
            .fetch_one(&mut *transaction)
            .await?;
            transaction.commit().await?;
            return Ok(updated.into());
        }

        let position = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM reading_queue WHERE user_id = $1",
        )
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .fetch_one(&mut *transaction)
        .await?;

        let inserted = sqlx::query_as::<_, ReadingQueueItemRow>(concat!(
            "INSERT INTO reading_queue (user_id, article_id, article_title, article_url, ",
            "article_source, article_image, queue_type, position, read_status, added_at, ",
            "word_count, estimated_read_time_minutes, full_text, why_saved, ",
            "unresolved_question, shelf_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ",
            "'unread', NOW(), NULL, NULL, NULL, $9, $10, $11) ",
            "ON CONFLICT (article_url) DO UPDATE SET ",
            "why_saved = COALESCE(EXCLUDED.why_saved, reading_queue.why_saved), ",
            "unresolved_question = COALESCE(EXCLUDED.unresolved_question, reading_queue.unresolved_question), ",
            "shelf_id = COALESCE(EXCLUDED.shelf_id, reading_queue.shelf_id), updated_at = NOW() ",
            "WHERE reading_queue.user_id = EXCLUDED.user_id RETURNING id, user_id, ",
            "article_id, article_title, article_url, article_source, article_image, queue_type, ",
            "position, read_status, added_at, archived_at, created_at, updated_at, word_count, ",
            "estimated_read_time_minutes, full_text, why_saved, unresolved_question, shelf_id"
        ))
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .bind(request.article_id)
        .bind(request.article_title)
        .bind(request.article_url)
        .bind(request.article_source)
        .bind(request.article_image)
        .bind(request.queue_type)
        .bind(position)
        .bind(request.why_saved)
        .bind(request.unresolved_question)
        .bind(request.shelf_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(inserted) = inserted else {
            transaction.rollback().await?;
            return Err(ReadingQueueError::Database(sqlx::Error::RowNotFound));
        };
        transaction.commit().await?;
        Ok(inserted.into())
    }

    pub async fn remove_reading_queue_item(&self, queue_id: i32) -> Result<bool, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let deleted = sqlx::query("DELETE FROM reading_queue WHERE id = $1 AND user_id = $2")
            .bind(queue_id)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .execute(&mut *transaction)
            .await?
            .rows_affected();
        transaction.commit().await?;
        Ok(deleted == 1)
    }

    pub async fn remove_reading_queue_item_by_url(
        &self,
        article_url: &str,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let deleted =
            sqlx::query("DELETE FROM reading_queue WHERE article_url = $1 AND user_id = $2")
                .bind(article_url)
                .bind(DEFAULT_READING_QUEUE_USER_ID)
                .execute(&mut *transaction)
                .await?
                .rows_affected();
        transaction.commit().await?;
        Ok(deleted == 1)
    }

    pub async fn list_reading_queue(&self) -> Result<Vec<ReadingQueueItemRecord>, sqlx::Error> {
        let query =
            format!("{QUEUE_SELECT} WHERE user_id = $1 ORDER BY queue_type DESC, position DESC");
        let rows = sqlx::query_as::<_, ReadingQueueItemRow>(&query)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn update_reading_queue_item(
        &self,
        queue_id: i32,
        request: ReadingQueueUpdate,
    ) -> Result<Option<ReadingQueueItemRecord>, ReadingQueueError> {
        let mut transaction = self.pool.begin().await?;
        let lookup = format!("{QUEUE_SELECT} WHERE id = $1 AND user_id = $2 FOR UPDATE");
        if sqlx::query_as::<_, ReadingQueueItemRow>(&lookup)
            .bind(queue_id)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_optional(&mut *transaction)
            .await?
            .is_none()
        {
            transaction.commit().await?;
            return Ok(None);
        }
        if let Some(shelf_id) = request.shelf_id {
            ensure_shelf(&mut transaction, shelf_id).await?;
        }

        let updated = sqlx::query_as::<_, ReadingQueueItemRow>(concat!(
            "UPDATE reading_queue SET ",
            "read_status = COALESCE($2, read_status), ",
            "queue_type = COALESCE($3, queue_type), ",
            "position = COALESCE($4, position), ",
            "archived_at = COALESCE($5, archived_at), ",
            "why_saved = COALESCE($6, why_saved), ",
            "unresolved_question = COALESCE($7, unresolved_question), ",
            "shelf_id = COALESCE($8, shelf_id), updated_at = NOW() ",
            "WHERE id = $1 AND user_id = $9 RETURNING id, user_id, article_id, ",
            "article_title, article_url, article_source, article_image, queue_type, position, ",
            "read_status, added_at, archived_at, created_at, updated_at, word_count, ",
            "estimated_read_time_minutes, full_text, why_saved, unresolved_question, shelf_id"
        ))
        .bind(queue_id)
        .bind(request.read_status)
        .bind(request.queue_type)
        .bind(request.position)
        .bind(request.archived_at)
        .bind(request.why_saved)
        .bind(request.unresolved_question)
        .bind(request.shelf_id)
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(updated.into()))
    }

    pub async fn move_expired_reading_queue_items(&self) -> Result<u64, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let moved = sqlx::query(
            "UPDATE reading_queue SET queue_type = 'permanent', updated_at = NOW() \
             WHERE user_id = $1 AND queue_type = 'daily' \
               AND added_at < NOW() - INTERVAL '7 days'",
        )
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        transaction.commit().await?;
        Ok(moved)
    }

    pub async fn reading_queue_overview(&self) -> Result<QueueOverviewRecord, sqlx::Error> {
        let row = sqlx::query_as::<_, QueueOverviewRow>(
            "SELECT COUNT(*)::BIGINT AS total_items, \
                COUNT(*) FILTER (WHERE queue_type = 'daily')::BIGINT AS daily_items, \
                COUNT(*) FILTER (WHERE queue_type = 'permanent')::BIGINT AS permanent_items, \
                COUNT(*) FILTER (WHERE read_status = 'unread')::BIGINT AS unread_count, \
                COUNT(*) FILTER (WHERE read_status = 'reading')::BIGINT AS reading_count, \
                COUNT(*) FILTER (WHERE read_status = 'completed')::BIGINT AS completed_count, \
                COALESCE(SUM(CASE WHEN read_status = 'unread' \
                    THEN COALESCE(estimated_read_time_minutes, 0) ELSE 0 END), 0)::BIGINT \
                    AS estimated_total_read_time_minutes \
             FROM reading_queue WHERE user_id = $1",
        )
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.into())
    }

    pub async fn list_reading_shelves(&self) -> Result<Vec<ReadingShelfRecord>, sqlx::Error> {
        let query = format!("{SHELF_SELECT} WHERE user_id = $1 ORDER BY name ASC");
        let rows = sqlx::query_as::<_, ReadingShelfRow>(&query)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn create_reading_shelf(
        &self,
        request: ReadingShelfCreate,
    ) -> Result<ReadingShelfRecord, ReadingQueueError> {
        let name = request.name.trim().to_owned();
        if name.is_empty() {
            return Err(ReadingQueueError::EmptyShelfName);
        }
        let row = sqlx::query_as::<_, ReadingShelfRow>(concat!(
            "INSERT INTO reading_shelves (user_id, name, description) VALUES ($1, $2, $3) ",
            "ON CONFLICT (user_id, name) DO UPDATE SET ",
            "description = CASE WHEN EXCLUDED.description IS NOT NULL ",
            "THEN EXCLUDED.description ELSE reading_shelves.description END, ",
            "updated_at = CASE WHEN EXCLUDED.description IS NOT NULL ",
            "THEN NOW() ELSE reading_shelves.updated_at END ",
            "RETURNING id, user_id, name, description, created_at, updated_at"
        ))
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .bind(name)
        .bind(request.description)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.into())
    }

    pub async fn update_reading_shelf(
        &self,
        shelf_id: i32,
        request: ReadingShelfUpdate,
    ) -> Result<Option<ReadingShelfRecord>, ReadingQueueError> {
        let name = request.name.map(|value| value.trim().to_owned());
        if name.as_deref() == Some("") {
            return Err(ReadingQueueError::EmptyShelfName);
        }
        let mut transaction = self.pool.begin().await?;
        let lookup = format!("{SHELF_SELECT} WHERE id = $1 AND user_id = $2 FOR UPDATE");
        if sqlx::query_as::<_, ReadingShelfRow>(&lookup)
            .bind(shelf_id)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_optional(&mut *transaction)
            .await?
            .is_none()
        {
            transaction.commit().await?;
            return Ok(None);
        }
        let row = sqlx::query_as::<_, ReadingShelfRow>(concat!(
            "UPDATE reading_shelves SET name = COALESCE($2, name), ",
            "description = COALESCE($3, description), updated_at = NOW() ",
            "WHERE id = $1 AND user_id = $4 ",
            "RETURNING id, user_id, name, description, created_at, updated_at"
        ))
        .bind(shelf_id)
        .bind(name)
        .bind(request.description)
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(row.into()))
    }

    pub async fn archive_completed_reading_queue_items(&self) -> Result<u64, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let archived = sqlx::query(
            "UPDATE reading_queue SET archived_at = NOW(), updated_at = NOW() \
             WHERE user_id = $1 AND read_status = 'completed' \
               AND updated_at < NOW() - INTERVAL '30 days' AND archived_at IS NULL",
        )
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        transaction.commit().await?;
        Ok(archived)
    }

    pub async fn get_reading_queue_item(
        &self,
        queue_id: i32,
    ) -> Result<Option<ReadingQueueItemRecord>, sqlx::Error> {
        let query = format!("{QUEUE_SELECT} WHERE id = $1 AND user_id = $2");
        let row = sqlx::query_as::<_, ReadingQueueItemRow>(&query)
            .bind(queue_id)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(Into::into))
    }

    pub async fn daily_reading_queue_digest(&self) -> Result<DailyDigestRecord, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let item_query = format!(
            "{QUEUE_SELECT} WHERE user_id = $1 AND read_status = 'unread' \
             AND queue_type = 'daily' ORDER BY position DESC LIMIT 5"
        );
        let digest_items = sqlx::query_as::<_, ReadingQueueItemRow>(&item_query)
            .bind(DEFAULT_READING_QUEUE_USER_ID)
            .fetch_all(&mut *transaction)
            .await?;
        let stats = sqlx::query_as::<_, QueueDigestStatsRow>(
            "SELECT COUNT(*)::BIGINT AS total_items, \
                COALESCE(SUM(CASE WHEN read_status = 'unread' \
                    THEN COALESCE(estimated_read_time_minutes, 0) ELSE 0 END), 0)::BIGINT \
                    AS estimated_read_time_minutes \
             FROM reading_queue WHERE user_id = $1",
        )
        .bind(DEFAULT_READING_QUEUE_USER_ID)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(DailyDigestRecord {
            digest_items: digest_items.into_iter().map(Into::into).collect(),
            total_items: stats.total_items,
            estimated_read_time_minutes: stats.estimated_read_time_minutes,
            generated_at: Utc::now(),
        })
    }
}

#[derive(Debug, FromRow)]
struct QueueDigestStatsRow {
    total_items: i64,
    estimated_read_time_minutes: i64,
}

async fn ensure_shelf(
    transaction: &mut Transaction<'_, Postgres>,
    shelf_id: i32,
) -> Result<(), ReadingQueueError> {
    let exists = sqlx::query_scalar::<_, i32>(
        "SELECT id FROM reading_shelves WHERE id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(shelf_id)
    .bind(DEFAULT_READING_QUEUE_USER_ID)
    .fetch_optional(&mut **transaction)
    .await?;
    if exists.is_none() {
        return Err(ReadingQueueError::ShelfNotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ReadingQueueError, DEFAULT_READING_QUEUE_USER_ID};

    #[test]
    fn persistence_scope_is_the_fastapi_single_user_default() {
        assert_eq!(DEFAULT_READING_QUEUE_USER_ID, 1);
        assert!(matches!(
            ReadingQueueError::ShelfNotFound,
            ReadingQueueError::ShelfNotFound
        ));
    }
}
