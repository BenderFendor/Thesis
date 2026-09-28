use chrono::{DateTime, Utc};
use sqlx::FromRow;
use std::fmt;

use super::Database;

/// A saved article row joined with the canonical article metadata.
#[derive(Clone, Debug)]
pub struct SavedArticleRecord {
    pub id: i32,
    pub article_id: i32,
    pub created_at: Option<DateTime<Utc>>,
    pub title: String,
    pub source: String,
    pub summary: Option<String>,
    pub image_url: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub category: Option<String>,
    pub url: String,
}

/// The persistence row returned by create, update, and delete operations.
#[derive(Clone, Debug)]
pub struct SavedArticleItem {
    pub id: i32,
    pub article_id: i32,
    pub created_at: Option<DateTime<Utc>>,
}

/// The result of an idempotent saved-article create.
#[derive(Clone, Debug)]
pub struct SavedArticleCreateResult {
    pub item: SavedArticleItem,
    pub created: bool,
}

/// Errors that can occur while changing a saved-article collection.
#[derive(Debug)]
pub enum LibraryError {
    ArticleNotFound,
    Database(sqlx::Error),
}

impl fmt::Display for LibraryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ArticleNotFound => formatter.write_str("article not found"),
            Self::Database(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for LibraryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ArticleNotFound => None,
            Self::Database(error) => Some(error),
        }
    }
}

impl From<sqlx::Error> for LibraryError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Clone, Copy)]
enum SavedArticleKind {
    Bookmark,
    Liked,
}

impl SavedArticleKind {
    fn list_query(self) -> &'static str {
        match self {
            Self::Bookmark => BOOKMARK_LIST_QUERY,
            Self::Liked => LIKED_LIST_QUERY,
        }
    }

    fn detail_query(self) -> &'static str {
        match self {
            Self::Bookmark => BOOKMARK_DETAIL_QUERY,
            Self::Liked => LIKED_DETAIL_QUERY,
        }
    }

    fn item_query(self) -> &'static str {
        match self {
            Self::Bookmark => BOOKMARK_ITEM_QUERY,
            Self::Liked => LIKED_ITEM_QUERY,
        }
    }

    fn create_query(self) -> &'static str {
        match self {
            Self::Bookmark => BOOKMARK_CREATE_QUERY,
            Self::Liked => LIKED_CREATE_QUERY,
        }
    }

    fn delete_query(self) -> &'static str {
        match self {
            Self::Bookmark => BOOKMARK_DELETE_QUERY,
            Self::Liked => LIKED_DELETE_QUERY,
        }
    }
}

#[derive(Debug, FromRow)]
struct SavedArticleRow {
    id: i32,
    article_id: i32,
    created_at: Option<DateTime<Utc>>,
    title: String,
    source: String,
    summary: Option<String>,
    image_url: Option<String>,
    published_at: Option<DateTime<Utc>>,
    category: Option<String>,
    url: String,
}

impl From<SavedArticleRow> for SavedArticleRecord {
    fn from(row: SavedArticleRow) -> Self {
        Self {
            id: row.id,
            article_id: row.article_id,
            created_at: row.created_at,
            title: row.title,
            source: row.source,
            summary: row.summary,
            image_url: row.image_url,
            published_at: row.published_at,
            category: row.category,
            url: row.url,
        }
    }
}

#[derive(Debug, FromRow)]
struct SavedArticleItemRow {
    id: i32,
    article_id: i32,
    created_at: Option<DateTime<Utc>>,
}

impl From<SavedArticleItemRow> for SavedArticleItem {
    fn from(row: SavedArticleItemRow) -> Self {
        Self {
            id: row.id,
            article_id: row.article_id,
            created_at: row.created_at,
        }
    }
}

impl Database {
    /// List bookmarks in the same newest-created order as FastAPI.
    pub async fn list_bookmarks(&self) -> Result<Vec<SavedArticleRecord>, sqlx::Error> {
        self.list_saved_articles(SavedArticleKind::Bookmark).await
    }

    /// List liked articles in the same newest-created order as FastAPI.
    pub async fn list_liked_articles(&self) -> Result<Vec<SavedArticleRecord>, sqlx::Error> {
        self.list_saved_articles(SavedArticleKind::Liked).await
    }

    /// Get a bookmark and its article metadata by article id.
    pub async fn get_bookmark(
        &self,
        article_id: i32,
    ) -> Result<Option<SavedArticleRecord>, sqlx::Error> {
        self.get_saved_article(SavedArticleKind::Bookmark, article_id)
            .await
    }

    /// Get a liked article and its article metadata by article id.
    pub async fn get_liked_article(
        &self,
        article_id: i32,
    ) -> Result<Option<SavedArticleRecord>, sqlx::Error> {
        self.get_saved_article(SavedArticleKind::Liked, article_id)
            .await
    }

    /// Get the bookmark persistence row used by update and delete responses.
    pub async fn get_bookmark_item(
        &self,
        article_id: i32,
    ) -> Result<Option<SavedArticleItem>, sqlx::Error> {
        self.get_saved_item(SavedArticleKind::Bookmark, article_id)
            .await
    }

    /// Get the liked-article persistence row used by delete responses.
    pub async fn get_liked_item(
        &self,
        article_id: i32,
    ) -> Result<Option<SavedArticleItem>, sqlx::Error> {
        self.get_saved_item(SavedArticleKind::Liked, article_id)
            .await
    }

    /// Create a bookmark with article validation and race-safe idempotency.
    pub async fn create_bookmark(
        &self,
        article_id: i32,
    ) -> Result<SavedArticleCreateResult, LibraryError> {
        self.create_saved_article(SavedArticleKind::Bookmark, article_id)
            .await
    }

    /// Create a liked article with article validation and race-safe idempotency.
    pub async fn create_liked_article(
        &self,
        article_id: i32,
    ) -> Result<SavedArticleCreateResult, LibraryError> {
        self.create_saved_article(SavedArticleKind::Liked, article_id)
            .await
    }

    /// Delete a bookmark by article id.
    pub async fn delete_bookmark(
        &self,
        article_id: i32,
    ) -> Result<Option<SavedArticleItem>, sqlx::Error> {
        self.delete_saved_article(SavedArticleKind::Bookmark, article_id)
            .await
    }

    /// Delete a liked article by article id.
    pub async fn delete_liked_article(
        &self,
        article_id: i32,
    ) -> Result<Option<SavedArticleItem>, sqlx::Error> {
        self.delete_saved_article(SavedArticleKind::Liked, article_id)
            .await
    }

    async fn list_saved_articles(
        &self,
        kind: SavedArticleKind,
    ) -> Result<Vec<SavedArticleRecord>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let rows = sqlx::query_as::<_, SavedArticleRow>(kind.list_query())
            .fetch_all(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    async fn get_saved_article(
        &self,
        kind: SavedArticleKind,
        article_id: i32,
    ) -> Result<Option<SavedArticleRecord>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query_as::<_, SavedArticleRow>(kind.detail_query())
            .bind(article_id)
            .fetch_optional(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(row.map(Into::into))
    }

    async fn get_saved_item(
        &self,
        kind: SavedArticleKind,
        article_id: i32,
    ) -> Result<Option<SavedArticleItem>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query_as::<_, SavedArticleItemRow>(kind.item_query())
            .bind(article_id)
            .fetch_optional(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(row.map(Into::into))
    }

    async fn create_saved_article(
        &self,
        kind: SavedArticleKind,
        article_id: i32,
    ) -> Result<SavedArticleCreateResult, LibraryError> {
        let mut transaction = self.pool.begin().await?;
        let article_exists =
            sqlx::query_scalar::<_, i32>("SELECT id FROM articles WHERE id = $1 FOR KEY SHARE")
                .bind(article_id)
                .fetch_optional(&mut *transaction)
                .await?;
        if article_exists.is_none() {
            transaction.rollback().await?;
            return Err(LibraryError::ArticleNotFound);
        }

        let inserted = sqlx::query_as::<_, SavedArticleItemRow>(kind.create_query())
            .bind(article_id)
            .fetch_optional(&mut *transaction)
            .await?;
        let (item, created) = if let Some(row) = inserted {
            (row.into(), true)
        } else {
            let existing = sqlx::query_as::<_, SavedArticleItemRow>(kind.item_query())
                .bind(article_id)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(sqlx::Error::RowNotFound)?;
            (existing.into(), false)
        };
        transaction.commit().await?;
        Ok(SavedArticleCreateResult { item, created })
    }

    async fn delete_saved_article(
        &self,
        kind: SavedArticleKind,
        article_id: i32,
    ) -> Result<Option<SavedArticleItem>, sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query_as::<_, SavedArticleItemRow>(kind.delete_query())
            .bind(article_id)
            .fetch_optional(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(row.map(Into::into))
    }
}

const BOOKMARK_LIST_QUERY: &str = "SELECT saved.id, saved.article_id, saved.created_at, \
    article.title, article.source, article.summary, article.image_url, article.published_at, \
    article.category, article.url \
    FROM bookmarks AS saved \
    JOIN articles AS article ON article.id = saved.article_id \
    ORDER BY saved.created_at DESC";

const LIKED_LIST_QUERY: &str = "SELECT saved.id, saved.article_id, saved.created_at, \
    article.title, article.source, article.summary, article.image_url, article.published_at, \
    article.category, article.url \
    FROM liked_articles AS saved \
    JOIN articles AS article ON article.id = saved.article_id \
    ORDER BY saved.created_at DESC";

const BOOKMARK_DETAIL_QUERY: &str = "SELECT saved.id, saved.article_id, saved.created_at, \
    article.title, article.source, article.summary, article.image_url, article.published_at, \
    article.category, article.url \
    FROM bookmarks AS saved \
    JOIN articles AS article ON article.id = saved.article_id \
    WHERE saved.article_id = $1";

const LIKED_DETAIL_QUERY: &str = "SELECT saved.id, saved.article_id, saved.created_at, \
    article.title, article.source, article.summary, article.image_url, article.published_at, \
    article.category, article.url \
    FROM liked_articles AS saved \
    JOIN articles AS article ON article.id = saved.article_id \
    WHERE saved.article_id = $1";

const BOOKMARK_ITEM_QUERY: &str =
    "SELECT id, article_id, created_at FROM bookmarks WHERE article_id = $1";
const LIKED_ITEM_QUERY: &str =
    "SELECT id, article_id, created_at FROM liked_articles WHERE article_id = $1";

const BOOKMARK_CREATE_QUERY: &str = "INSERT INTO bookmarks (article_id) VALUES ($1) \
    ON CONFLICT (article_id) DO NOTHING \
    RETURNING id, article_id, created_at";
const LIKED_CREATE_QUERY: &str = "INSERT INTO liked_articles (article_id) VALUES ($1) \
    ON CONFLICT (article_id) DO NOTHING \
    RETURNING id, article_id, created_at";

const BOOKMARK_DELETE_QUERY: &str =
    "DELETE FROM bookmarks WHERE article_id = $1 RETURNING id, article_id, created_at";
const LIKED_DELETE_QUERY: &str =
    "DELETE FROM liked_articles WHERE article_id = $1 RETURNING id, article_id, created_at";

#[cfg(test)]
mod tests {
    use super::SavedArticleKind;

    #[test]
    fn writes_use_unique_article_conflicts_for_idempotency() {
        for kind in [SavedArticleKind::Bookmark, SavedArticleKind::Liked] {
            assert!(kind
                .create_query()
                .contains("ON CONFLICT (article_id) DO NOTHING"));
        }
    }

    #[test]
    fn reads_join_the_canonical_article_row() {
        for query in [
            SavedArticleKind::Bookmark.list_query(),
            SavedArticleKind::Liked.list_query(),
            SavedArticleKind::Bookmark.detail_query(),
            SavedArticleKind::Liked.detail_query(),
        ] {
            assert!(query.contains("JOIN articles AS article ON article.id = saved.article_id"));
        }
    }
}
