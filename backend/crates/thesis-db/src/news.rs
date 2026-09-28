use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

/// A keyset cursor for persisted article browsing.
///
/// `search_rank` is retained for wire compatibility with FastAPI cursors. The
/// persisted Rust reader orders every page by publication time and id, so it
/// deliberately does not trust a client-provided relevance score.
#[derive(Clone, Debug)]
pub struct NewsCursor {
    pub published_at: DateTime<Utc>,
    pub article_id: i64,
    pub search_rank: Option<f64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NewsSortOrder {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Default)]
pub struct NewsFilter {
    pub category: Option<String>,
    pub sources: Vec<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewsPageRequest {
    pub limit: i64,
    pub cursor: Option<NewsCursor>,
    pub filter: NewsFilter,
    pub sort_order: NewsSortOrder,
}

#[derive(Clone, Debug)]
pub struct NewsIndexRequest {
    pub filter: NewsFilter,
}

#[derive(Clone, Debug)]
pub struct RecentNewsRequest {
    pub limit: i64,
    pub cursor: Option<NewsCursor>,
    pub category: Option<String>,
    pub source: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewsPage {
    pub articles: Vec<NewsArticleRecord>,
    pub total: i64,
    pub has_more: bool,
    pub next_cursor: Option<NewsCursor>,
}

/// The stable, persisted article shape used by the Rust news browse routes.
///
/// Nullable database values remain nullable here where the public contract
/// permits them. Required wire values are normalized in `from_row` rather than
/// leaking invalid nulls or blank URLs to API callers.
#[derive(Clone, Debug)]
pub struct NewsArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub source_id: Option<String>,
    pub country: Option<String>,
    pub credibility: Option<String>,
    pub bias: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub image_url: Option<String>,
    pub published_at: DateTime<Utc>,
    pub category: String,
    pub url: String,
    pub author: Option<String>,
    pub authors: Vec<String>,
    pub author_urls: Vec<String>,
    pub tags: Vec<String>,
    pub mentioned_countries: Vec<String>,
    pub original_language: Option<String>,
    pub translated: bool,
    pub chroma_id: Option<String>,
    pub embedding_generated: bool,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct NewsSourceRecord {
    pub name: String,
    /// A persisted source domain, not a URL from a live provider catalog.
    pub domain: Option<String>,
    pub category: String,
    pub country: String,
    pub funding_type: Option<String>,
    pub source_type: Option<String>,
    pub is_paywalled: bool,
    pub bias_rating: Option<String>,
    pub ownership_label: Option<String>,
    pub factual_rating: Option<String>,
    pub credibility_score: Option<f64>,
}

#[derive(Debug, FromRow)]
struct NewsArticleRow {
    id: i64,
    title: Option<String>,
    source: Option<String>,
    source_id: Option<String>,
    country: Option<String>,
    credibility: Option<String>,
    bias: Option<String>,
    summary: Option<String>,
    content: Option<String>,
    image_url: Option<String>,
    published_at: DateTime<Utc>,
    category: Option<String>,
    url: Option<String>,
    author: Option<String>,
    authors: Option<Vec<String>>,
    author_urls: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    mentioned_countries: Option<Vec<String>>,
    original_language: Option<String>,
    translated: Option<bool>,
    chroma_id: Option<String>,
    embedding_generated: Option<bool>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct NewsSourceRow {
    name: String,
    domain: Option<String>,
    category: Option<String>,
    country: Option<String>,
    funding_type: Option<String>,
    source_type: Option<String>,
    is_paywalled: Option<bool>,
    bias_rating: Option<String>,
    ownership_label: Option<String>,
    factual_rating: Option<String>,
    credibility_score: Option<f64>,
}

#[derive(Debug, FromRow)]
struct PersistedSourceRow {
    name: String,
    category: Option<String>,
    country: Option<String>,
}

const ARTICLE_SELECT: &str = "SELECT \
    a.id, a.title, a.source, a.source_id, a.country, a.credibility, a.bias, \
    a.summary, a.content, a.image_url, a.published_at::timestamptz AS published_at, a.category, a.url, \
    a.author, a.authors, a.author_urls, a.tags, a.mentioned_countries, \
    a.original_language, a.translated, a.chroma_id, a.embedding_generated, \
    a.created_at::timestamptz AS created_at, a.updated_at::timestamptz AS updated_at \
    FROM articles a";

fn append_article_filters(query: &mut QueryBuilder<'_, Postgres>, filter: &NewsFilter) {
    if let Some(category) = filter.category.as_deref() {
        query
            .push(" AND COALESCE(NULLIF(BTRIM(a.category), ''), 'general') = ")
            .push_bind(category.to_owned());
    }

    if !filter.sources.is_empty() {
        query.push(" AND a.source IN (");
        for (index, source) in filter.sources.iter().enumerate() {
            if index > 0 {
                query.push(", ");
            }
            query.push_bind(source.clone());
        }
        query.push(")");
    }

    if let Some(search) = filter.search.as_deref() {
        query.push(
            " AND to_tsvector('english', concat_ws(' ', a.title, a.summary, a.source, a.category, a.content)) \
             @@ plainto_tsquery('english', ",
        );
        query.push_bind(search.to_owned()).push(")");
    }
}

fn append_cursor_filter(
    query: &mut QueryBuilder<'_, Postgres>,
    cursor: &NewsCursor,
    sort_order: NewsSortOrder,
) {
    let comparison = match sort_order {
        NewsSortOrder::Desc => "<",
        NewsSortOrder::Asc => ">",
    };
    query
        .push(" AND (a.published_at::timestamptz ")
        .push(comparison)
        .push(" ")
        .push_bind(cursor.published_at)
        .push(" OR (a.published_at::timestamptz = ")
        .push_bind(cursor.published_at)
        .push(" AND a.id ")
        .push(comparison)
        .push(" ")
        .push_bind(cursor.article_id)
        .push("))");
}

fn article_from_row(row: NewsArticleRow) -> NewsArticleRecord {
    NewsArticleRecord {
        id: row.id,
        title: non_empty_or(row.title, "Untitled article"),
        source: non_empty_or(row.source, "Unknown"),
        source_id: row.source_id,
        country: row.country,
        credibility: row.credibility,
        bias: row.bias,
        summary: row.summary,
        content: row.content,
        image_url: row.image_url,
        published_at: row.published_at,
        category: non_empty_or(row.category, "general"),
        url: row.url.unwrap_or_default().trim().to_owned(),
        author: row.author,
        authors: row.authors.unwrap_or_default(),
        author_urls: row.author_urls.unwrap_or_default(),
        tags: row.tags.unwrap_or_default(),
        mentioned_countries: row.mentioned_countries.unwrap_or_default(),
        original_language: row.original_language,
        translated: row.translated.unwrap_or(false),
        chroma_id: row.chroma_id,
        embedding_generated: row.embedding_generated.unwrap_or(false),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn non_empty_or(value: Option<String>, default: &str) -> String {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_owned())
}

fn source_from_row(row: NewsSourceRow) -> NewsSourceRecord {
    NewsSourceRecord {
        name: row.name,
        domain: row.domain.filter(|value| !value.trim().is_empty()),
        category: non_empty_or(row.category, "general"),
        country: non_empty_or(row.country, "US"),
        funding_type: row.funding_type,
        source_type: row.source_type,
        is_paywalled: row.is_paywalled.unwrap_or(false),
        bias_rating: row.bias_rating,
        ownership_label: row.ownership_label,
        factual_rating: row.factual_rating,
        credibility_score: row.credibility_score,
    }
}

fn persisted_source_from_row(row: PersistedSourceRow) -> NewsSourceRecord {
    NewsSourceRecord {
        name: row.name,
        domain: None,
        category: non_empty_or(row.category, "general"),
        country: non_empty_or(row.country, "US"),
        funding_type: None,
        source_type: None,
        is_paywalled: false,
        bias_rating: None,
        ownership_label: None,
        factual_rating: None,
        credibility_score: None,
    }
}

fn is_missing_source_metadata(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database_error| database_error.code())
        .is_some_and(|code| matches!(code.as_ref(), "42P01" | "42703"))
}
pub(crate) async fn list_news_page(
    pool: &PgPool,
    request: NewsPageRequest,
) -> Result<NewsPage, sqlx::Error> {
    let limit = request.limit.clamp(1, 500);
    let mut query = QueryBuilder::<Postgres>::new(ARTICLE_SELECT);
    query.push(" WHERE a.id > 0 AND a.published_at IS NOT NULL AND a.url IS NOT NULL AND BTRIM(a.url) <> ''");
    append_article_filters(&mut query, &request.filter);
    if let Some(cursor) = request.cursor.as_ref() {
        append_cursor_filter(&mut query, cursor, request.sort_order);
    }
    match request.sort_order {
        NewsSortOrder::Desc => query.push(" ORDER BY a.published_at::timestamptz DESC, a.id DESC"),
        NewsSortOrder::Asc => query.push(" ORDER BY a.published_at::timestamptz ASC, a.id ASC"),
    };
    query.push(" LIMIT ").push_bind(limit + 1);
    let rows = query
        .build_query_as::<NewsArticleRow>()
        .fetch_all(pool)
        .await?;

    let has_more = rows.len() > limit as usize;
    let articles = rows
        .into_iter()
        .take(limit as usize)
        .map(article_from_row)
        .collect::<Vec<_>>();
    let next_cursor = if has_more {
        articles.last().map(|article| NewsCursor {
            published_at: article.published_at,
            article_id: article.id,
            search_rank: None,
        })
    } else {
        None
    };

    let mut count_query = QueryBuilder::<Postgres>::new("SELECT COUNT(*)::bigint FROM articles a");
    count_query.push(" WHERE a.id > 0 AND a.published_at IS NOT NULL AND a.url IS NOT NULL AND BTRIM(a.url) <> ''");
    append_article_filters(&mut count_query, &request.filter);
    let total = count_query
        .build_query_scalar::<i64>()
        .fetch_one(pool)
        .await?;

    Ok(NewsPage {
        articles,
        total,
        has_more,
        next_cursor,
    })
}

pub(crate) async fn list_news_index(
    pool: &PgPool,
    request: NewsIndexRequest,
) -> Result<Vec<NewsArticleRecord>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(ARTICLE_SELECT);
    query.push(" WHERE a.id > 0 AND a.published_at IS NOT NULL AND a.url IS NOT NULL AND BTRIM(a.url) <> ''");
    append_article_filters(&mut query, &request.filter);
    query.push(" ORDER BY a.published_at::timestamptz DESC, a.id DESC");
    let rows = query
        .build_query_as::<NewsArticleRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(article_from_row).collect())
}

pub(crate) async fn list_recent_news(
    pool: &PgPool,
    request: RecentNewsRequest,
) -> Result<NewsPage, sqlx::Error> {
    let filter = NewsFilter {
        category: request.category,
        sources: request.source.into_iter().collect(),
        search: None,
    };
    list_news_page(
        pool,
        NewsPageRequest {
            limit: request.limit,
            cursor: request.cursor,
            filter,
            sort_order: NewsSortOrder::Desc,
        },
    )
    .await
}

pub(crate) async fn list_news_sources(pool: &PgPool) -> Result<Vec<NewsSourceRecord>, sqlx::Error> {
    let result = sqlx::query_as::<_, NewsSourceRow>(
        "SELECT a.source AS name, sm.domain, \
                COALESCE(NULLIF(MAX(a.category), ''), 'general') AS category, \
                COALESCE(NULLIF(sm.country, ''), NULLIF(MAX(a.country), ''), 'US') AS country, \
                sm.funding_type, sm.source_type, sm.is_paywalled, \
                sm.political_bias AS bias_rating, sm.parent_company AS ownership_label, \
                sm.factual_rating, sm.credibility_score \
         FROM articles a \
         LEFT JOIN source_metadata sm ON sm.source_name = a.source \
         WHERE a.source IS NOT NULL AND BTRIM(a.source) <> '' \
         GROUP BY a.source, sm.domain, sm.country, sm.funding_type, sm.source_type, \
                  sm.is_paywalled, sm.political_bias, sm.parent_company, \
                  sm.factual_rating, sm.credibility_score \
         ORDER BY LOWER(a.source), a.source",
    )
    .fetch_all(pool)
    .await;
    match result {
        Ok(rows) => Ok(rows.into_iter().map(source_from_row).collect()),
        Err(error) if is_missing_source_metadata(&error) => {
            let rows = sqlx::query_as::<_, PersistedSourceRow>(
                "SELECT a.source AS name, \
                        COALESCE(NULLIF(MAX(a.category), ''), 'general') AS category, \
                        COALESCE(NULLIF(MAX(a.country), ''), 'US') AS country \
                 FROM articles a \
                 WHERE a.source IS NOT NULL AND BTRIM(a.source) <> '' \
                 GROUP BY a.source \
                 ORDER BY LOWER(a.source), a.source",
            )
            .fetch_all(pool)
            .await?;
            Ok(rows.into_iter().map(persisted_source_from_row).collect())
        }
        Err(error) => Err(error),
    }
}

pub(crate) async fn list_news_categories(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT COALESCE(NULLIF(BTRIM(category), ''), 'general') AS category \
         FROM articles \
         ORDER BY category",
    )
    .fetch_all(pool)
    .await
}

#[derive(Clone, Debug)]
pub struct SearchArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub source_id: Option<String>,
    pub country: Option<String>,
    pub credibility: Option<String>,
    pub bias: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub image_url: Option<String>,
    pub published_at: NaiveDateTime,
    pub category: Option<String>,
    pub url: String,
    pub author: Option<String>,
    pub authors: Vec<String>,
    pub author_urls: Vec<String>,
    pub tags: Vec<String>,
    pub mentioned_countries: Vec<String>,
    pub original_language: Option<String>,
    pub translated: Option<bool>,
    pub chroma_id: Option<String>,
    pub embedding_generated: Option<bool>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Debug, FromRow)]
struct SearchArticleRow {
    id: i64,
    title: String,
    source: String,
    source_id: Option<String>,
    country: Option<String>,
    credibility: Option<String>,
    bias: Option<String>,
    summary: Option<String>,
    content: Option<String>,
    image_url: Option<String>,
    published_at: NaiveDateTime,
    category: Option<String>,
    url: String,
    author: Option<String>,
    authors: Option<Vec<String>>,
    author_urls: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    mentioned_countries: Option<Vec<String>>,
    original_language: Option<String>,
    translated: Option<bool>,
    chroma_id: Option<String>,
    embedding_generated: Option<bool>,
    created_at: Option<NaiveDateTime>,
    updated_at: Option<NaiveDateTime>,
}

fn search_article_from_row(row: SearchArticleRow) -> SearchArticleRecord {
    SearchArticleRecord {
        id: row.id,
        title: row.title,
        source: row.source,
        source_id: row.source_id,
        country: row.country,
        credibility: row.credibility,
        bias: row.bias,
        summary: row.summary,
        content: row.content,
        image_url: row.image_url,
        published_at: row.published_at,
        category: row.category,
        url: row.url,
        author: row.author,
        authors: row.authors.unwrap_or_default(),
        author_urls: row.author_urls.unwrap_or_default(),
        tags: row.tags.unwrap_or_default(),
        mentioned_countries: row.mentioned_countries.unwrap_or_default(),
        original_language: row.original_language,
        translated: row.translated,
        chroma_id: row.chroma_id,
        embedding_generated: row.embedding_generated,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

const SEARCH_ARTICLE_SELECT: &str = "SELECT \
    id::bigint AS id, title, source, source_id, country, credibility, bias, \
    summary, content, image_url, published_at, category, url, author, \
    COALESCE(authors, ARRAY[]::text[]) AS authors, \
    COALESCE(author_urls, ARRAY[]::text[]) AS author_urls, \
    COALESCE(tags, ARRAY[]::text[]) AS tags, \
    COALESCE(mentioned_countries, ARRAY[]::text[]) AS mentioned_countries, \
    original_language, translated, chroma_id, embedding_generated, created_at, updated_at \
    FROM articles";

async fn load_news_articles_by_ids(
    pool: &PgPool,
    article_ids: &[i64],
) -> Result<Vec<SearchArticleRecord>, sqlx::Error> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_as::<_, SearchArticleRow>(
        "SELECT article.id::bigint AS id, article.title, article.source, \
                article.source_id, article.country, article.credibility, article.bias, \
                article.summary, article.content, article.image_url, article.published_at, \
                article.category, article.url, article.author, \
                COALESCE(article.authors, ARRAY[]::text[]) AS authors, \
                COALESCE(article.author_urls, ARRAY[]::text[]) AS author_urls, \
                COALESCE(article.tags, ARRAY[]::text[]) AS tags, \
                COALESCE(article.mentioned_countries, ARRAY[]::text[]) AS mentioned_countries, \
                article.original_language, article.translated, article.chroma_id, \
                article.embedding_generated, article.created_at, article.updated_at \
         FROM unnest($1::bigint[]) WITH ORDINALITY AS requested(id, position) \
         JOIN articles AS article ON article.id::bigint = requested.id \
         ORDER BY requested.position",
    )
    .bind(article_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(search_article_from_row).collect())
}

async fn insert_search_history(
    pool: &PgPool,
    query: &str,
    search_type: &str,
    results_count: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO search_history (query, search_type, results_count) VALUES ($1, $2, $3)",
    )
    .bind(query)
    .bind(search_type)
    .bind(results_count)
    .execute(pool)
    .await?;
    Ok(())
}

const ARTICLE_SEARCH_VECTOR: &str =
    "setweight(to_tsvector('english', COALESCE(title, '')), 'A') || \
     setweight(to_tsvector('english', COALESCE(summary, '')), 'B') || \
     setweight(to_tsvector('english', COALESCE(source, '')), 'B') || \
     setweight(to_tsvector('english', COALESCE(category, '')), 'C') || \
     setweight(to_tsvector('english', COALESCE(content, '')), 'D')";
async fn search_news_articles_by_keyword(
    pool: &PgPool,
    query: &str,
    limit: i64,
) -> Result<Vec<SearchArticleRecord>, sqlx::Error> {
    let normalized_query = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }
    let mut search_query = QueryBuilder::<Postgres>::new(SEARCH_ARTICLE_SELECT);
    search_query
        .push(" WHERE (")
        .push(ARTICLE_SEARCH_VECTOR)
        .push(") @@ websearch_to_tsquery('english', ")
        .push_bind(normalized_query.as_str())
        .push(") ORDER BY ts_rank_cd((")
        .push(ARTICLE_SEARCH_VECTOR)
        .push("), websearch_to_tsquery('english', ")
        .push_bind(normalized_query.as_str())
        .push(")) DESC, published_at DESC, id DESC LIMIT ")
        .push_bind(limit);
    let rows = search_query
        .build_query_as::<SearchArticleRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(search_article_from_row).collect())
}

async fn list_recent_news_research_articles(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<SearchArticleRecord>, sqlx::Error> {
    let rows = sqlx::query_as::<_, SearchArticleRow>(
        "SELECT id::bigint AS id, title, source, source_id, country, credibility, bias, \
                summary, content, image_url, published_at, category, url, author, \
                COALESCE(authors, ARRAY[]::text[]) AS authors, \
                COALESCE(author_urls, ARRAY[]::text[]) AS author_urls, \
                COALESCE(tags, ARRAY[]::text[]) AS tags, \
                COALESCE(mentioned_countries, ARRAY[]::text[]) AS mentioned_countries, \
                original_language, translated, chroma_id, embedding_generated, \
                created_at, updated_at \
         FROM articles ORDER BY published_at DESC, id DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(search_article_from_row).collect())
}
#[derive(Clone, Debug)]
pub struct DebugArticleRequest {
    pub source: Option<String>,
    pub missing_embeddings_only: bool,
    pub published_before: Option<NaiveDateTime>,
    pub published_after: Option<NaiveDateTime>,
    pub sort_desc: bool,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct DebugArticleRecord {
    pub id: i64,
    pub title: String,
    pub source: String,
    pub url: String,
    pub chroma_id: Option<String>,
    pub content: Option<String>,
    pub image_url: Option<String>,
    pub published_at: NaiveDateTime,
    pub summary: Option<String>,
    pub embedding_generated: Option<bool>,
}

#[derive(Clone, Debug)]
pub struct DebugArticlePage {
    pub articles: Vec<DebugArticleRecord>,
    pub total: i64,
    pub returned: i64,
    pub oldest_published: Option<NaiveDateTime>,
    pub newest_published: Option<NaiveDateTime>,
}

#[derive(Debug, FromRow)]
struct ArticleDateRange {
    oldest_published: Option<NaiveDateTime>,
    newest_published: Option<NaiveDateTime>,
}

fn append_debug_article_filters<'args>(
    query: &mut QueryBuilder<'args, Postgres>,
    request: &'args DebugArticleRequest,
) {
    if let Some(source) = request
        .source
        .as_deref()
        .filter(|source| !source.is_empty())
    {
        query.push(" AND source = ").push_bind(source);
    }
    if request.missing_embeddings_only {
        query.push(" AND (embedding_generated IS FALSE OR embedding_generated IS NULL)");
    }
    if let Some(published_before) = request.published_before {
        query
            .push(" AND published_at <= ")
            .push_bind(published_before);
    }
    if let Some(published_after) = request.published_after {
        query
            .push(" AND published_at >= ")
            .push_bind(published_after);
    }
}

async fn debug_articles(
    pool: &PgPool,
    request: DebugArticleRequest,
) -> Result<DebugArticlePage, sqlx::Error> {
    let mut article_query = QueryBuilder::<Postgres>::new(
        "SELECT id::bigint AS id, title, source, url, chroma_id, content, \
                image_url, published_at, summary, embedding_generated \
         FROM articles WHERE TRUE",
    );
    append_debug_article_filters(&mut article_query, &request);
    article_query.push(if request.sort_desc {
        " ORDER BY published_at DESC, id DESC LIMIT "
    } else {
        " ORDER BY published_at ASC, id DESC LIMIT "
    });
    article_query
        .push_bind(request.limit)
        .push(" OFFSET ")
        .push_bind(request.offset);
    let articles = article_query
        .build_query_as::<DebugArticleRecord>()
        .fetch_all(pool)
        .await?;

    let mut count_query =
        QueryBuilder::<Postgres>::new("SELECT COUNT(*)::bigint FROM articles WHERE TRUE");
    append_debug_article_filters(&mut count_query, &request);
    let total = count_query
        .build_query_scalar::<i64>()
        .fetch_one(pool)
        .await?;

    let mut date_query = QueryBuilder::<Postgres>::new(
        "SELECT MIN(published_at) AS oldest_published, \
                MAX(published_at) AS newest_published FROM articles WHERE TRUE",
    );
    append_debug_article_filters(&mut date_query, &request);
    let date_range = date_query
        .build_query_as::<ArticleDateRange>()
        .fetch_one(pool)
        .await?;
    let returned =
        i64::try_from(articles.len()).map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    Ok(DebugArticlePage {
        articles,
        total,
        returned,
        oldest_published: date_range.oldest_published,
        newest_published: date_range.newest_published,
    })
}

async fn count_articles_for_source(
    pool: &PgPool,
    source: Option<&str>,
) -> Result<i64, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new("SELECT COUNT(*)::bigint FROM articles");
    if let Some(source) = source.filter(|source| !source.is_empty()) {
        query.push(" WHERE source = ").push_bind(source);
    }
    query.build_query_scalar::<i64>().fetch_one(pool).await
}

async fn article_urls_exist(pool: &PgPool, urls: &[String]) -> Result<Vec<String>, sqlx::Error> {
    if urls.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar::<_, String>("SELECT url FROM articles WHERE url = ANY($1)")
        .bind(urls)
        .fetch_all(pool)
        .await
}
async fn article_ids_by_url(
    pool: &PgPool,
    urls: &[String],
) -> Result<Vec<(String, i64)>, sqlx::Error> {
    if urls.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_as::<_, (String, i64)>(
        "SELECT url, id::bigint FROM articles WHERE url = ANY($1) ORDER BY id",
    )
    .bind(urls)
    .fetch_all(pool)
    .await
}

#[derive(Clone, Debug, FromRow)]
pub struct ArticleChromaMapping {
    pub id: i64,
    pub chroma_id: Option<String>,
    pub embedding_generated: Option<bool>,
}

async fn debug_article_chroma_mappings(
    pool: &PgPool,
) -> Result<Vec<ArticleChromaMapping>, sqlx::Error> {
    sqlx::query_as::<_, ArticleChromaMapping>(
        "SELECT id::bigint AS id, chroma_id, embedding_generated FROM articles",
    )
    .fetch_all(pool)
    .await
}

#[derive(Clone, Debug, FromRow)]
pub struct ImageBackfillSource {
    pub source: String,
    pub missing_count: i64,
}

#[derive(Clone, Debug, FromRow)]
pub struct ImageBackfillArticle {
    pub id: i64,
    pub url: String,
}

#[derive(Clone, Debug)]
pub struct ImageBackfillUpdate {
    pub id: i64,
    pub image_url: String,
}

const MISSING_IMAGE_PREDICATE: &str =
    "(image_url IS NULL OR image_url = '' OR image_url LIKE '%placeholder%' OR image_url LIKE '%.svg')";

async fn image_backfill_sources(pool: &PgPool) -> Result<Vec<ImageBackfillSource>, sqlx::Error> {
    let sql = format!(
        "SELECT source, COUNT(id)::bigint AS missing_count FROM articles \
         WHERE {MISSING_IMAGE_PREDICATE} AND source IS NOT NULL AND source <> '' \
         GROUP BY source ORDER BY COUNT(id) ASC"
    );
    sqlx::query_as::<_, ImageBackfillSource>(&sql)
        .fetch_all(pool)
        .await
}

async fn image_backfill_batch(
    pool: &PgPool,
    source: &str,
    limit: i64,
) -> Result<Vec<ImageBackfillArticle>, sqlx::Error> {
    let sql = format!(
        "SELECT id::bigint AS id, url FROM articles \
         WHERE source = $1 AND {MISSING_IMAGE_PREDICATE} LIMIT $2"
    );
    sqlx::query_as::<_, ImageBackfillArticle>(&sql)
        .bind(source)
        .bind(limit)
        .fetch_all(pool)
        .await
}

async fn persist_image_backfill_batch(
    pool: &PgPool,
    updates: &[ImageBackfillUpdate],
) -> Result<u64, sqlx::Error> {
    if updates.is_empty() {
        return Ok(0);
    }
    let mut transaction = pool.begin().await?;
    let mut query = QueryBuilder::<Postgres>::new(
        "UPDATE articles AS article SET image_url = updates.image_url \
         FROM (VALUES ",
    );
    query.push_values(updates, |mut row, update| {
        row.push_bind(update.id).push_bind(&update.image_url);
    });
    query.push(") AS updates(id, image_url) WHERE article.id::bigint = updates.id");
    let updated = query
        .build()
        .execute(&mut *transaction)
        .await?
        .rows_affected();
    transaction.commit().await?;
    Ok(updated)
}

#[derive(Clone, Debug, FromRow)]
pub struct MentionedCountryArticle {
    pub id: i64,
    pub title: String,
    pub summary: Option<String>,
    pub content: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MentionedCountryUpdate {
    pub id: i64,
    pub countries: Vec<String>,
}

async fn mentioned_country_backfill_batch(
    pool: &PgPool,
    after_id: Option<i64>,
    limit: i64,
) -> Result<Vec<MentionedCountryArticle>, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT id::bigint AS id, title, summary, content FROM articles \
         WHERE (mentioned_countries IS NULL OR mentioned_countries = ARRAY[]::text[])",
    );
    if let Some(after_id) = after_id {
        query.push(" AND id > ").push_bind(after_id);
    }
    query.push(" ORDER BY id ASC LIMIT ").push_bind(limit);
    query
        .build_query_as::<MentionedCountryArticle>()
        .fetch_all(pool)
        .await
}

async fn persist_mentioned_country_batch(
    pool: &PgPool,
    updates: &[MentionedCountryUpdate],
) -> Result<u64, sqlx::Error> {
    if updates.is_empty() {
        return Ok(0);
    }
    let mut transaction = pool.begin().await?;
    let mut query = QueryBuilder::<Postgres>::new(
        "UPDATE articles AS article SET mentioned_countries = updates.countries \
         FROM (VALUES ",
    );
    query.push_values(updates, |mut row, update| {
        row.push_bind(update.id).push_bind(&update.countries);
    });
    query.push(") AS updates(id, countries) WHERE article.id::bigint = updates.id");
    let updated = query
        .build()
        .execute(&mut *transaction)
        .await?
        .rows_affected();
    transaction.commit().await?;
    Ok(updated)
}

async fn count_missing_mentioned_countries(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM articles \
         WHERE mentioned_countries IS NULL OR mentioned_countries = ARRAY[]::text[]",
    )
    .fetch_one(pool)
    .await
}

impl crate::Database {
    pub async fn load_news_articles_by_ids(
        &self,
        article_ids: &[i64],
    ) -> Result<Vec<SearchArticleRecord>, sqlx::Error> {
        load_news_articles_by_ids(&self.pool, article_ids).await
    }

    pub async fn insert_search_history(
        &self,
        query: &str,
        search_type: &str,
        results_count: i64,
    ) -> Result<(), sqlx::Error> {
        insert_search_history(&self.pool, query, search_type, results_count).await
    }

    pub async fn search_news_articles_by_keyword(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<SearchArticleRecord>, sqlx::Error> {
        search_news_articles_by_keyword(&self.pool, query, limit).await
    }

    pub async fn list_recent_news_research_articles(
        &self,
        limit: i64,
    ) -> Result<Vec<SearchArticleRecord>, sqlx::Error> {
        list_recent_news_research_articles(&self.pool, limit).await
    }

    pub async fn debug_articles(
        &self,
        request: DebugArticleRequest,
    ) -> Result<DebugArticlePage, sqlx::Error> {
        debug_articles(&self.pool, request).await
    }

    pub async fn count_articles_for_source(
        &self,
        source: Option<&str>,
    ) -> Result<i64, sqlx::Error> {
        count_articles_for_source(&self.pool, source).await
    }

    pub async fn article_urls_exist(&self, urls: &[String]) -> Result<Vec<String>, sqlx::Error> {
        article_urls_exist(&self.pool, urls).await
    }
    pub async fn article_ids_by_url(
        &self,
        urls: &[String],
    ) -> Result<Vec<(String, i64)>, sqlx::Error> {
        article_ids_by_url(&self.pool, urls).await
    }

    pub async fn debug_article_chroma_mappings(
        &self,
    ) -> Result<Vec<ArticleChromaMapping>, sqlx::Error> {
        debug_article_chroma_mappings(&self.pool).await
    }

    pub async fn image_backfill_sources(&self) -> Result<Vec<ImageBackfillSource>, sqlx::Error> {
        image_backfill_sources(&self.pool).await
    }

    pub async fn image_backfill_batch(
        &self,
        source: &str,
        limit: i64,
    ) -> Result<Vec<ImageBackfillArticle>, sqlx::Error> {
        image_backfill_batch(&self.pool, source, limit).await
    }

    pub async fn persist_image_backfill_batch(
        &self,
        updates: &[ImageBackfillUpdate],
    ) -> Result<u64, sqlx::Error> {
        persist_image_backfill_batch(&self.pool, updates).await
    }

    pub async fn mentioned_country_backfill_batch(
        &self,
        after_id: Option<i64>,
        limit: i64,
    ) -> Result<Vec<MentionedCountryArticle>, sqlx::Error> {
        mentioned_country_backfill_batch(&self.pool, after_id, limit).await
    }

    pub async fn persist_mentioned_country_batch(
        &self,
        updates: &[MentionedCountryUpdate],
    ) -> Result<u64, sqlx::Error> {
        persist_mentioned_country_batch(&self.pool, updates).await
    }

    pub async fn count_missing_mentioned_countries(&self) -> Result<i64, sqlx::Error> {
        count_missing_mentioned_countries(&self.pool).await
    }
}
