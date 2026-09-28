use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

/// The two client-visible country lens modes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CountryView {
    Internal,
    External,
}

/// The matching strategy reported by `/news/country/{code}`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CountryMatchKind {
    CountryMentions,
    SourceOriginFallback,
}

/// Persisted article fields needed by the country browse response.
///
/// Nullable booleans and arrays intentionally remain nullable at the database
/// boundary. The API serializer applies the same defaults as FastAPI instead
/// of allowing a malformed legacy row to produce an invalid response.
#[derive(Clone, Debug, FromRow)]
pub struct CountryArticleRecord {
    pub id: i64,
    pub title: Option<String>,
    pub source: Option<String>,
    pub source_id: Option<String>,
    pub country: Option<String>,
    pub credibility: Option<String>,
    pub bias: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub image_url: Option<String>,
    pub published_at: DateTime<Utc>,
    pub category: Option<String>,
    pub url: Option<String>,
    pub author: Option<String>,
    pub authors: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub original_language: Option<String>,
    pub translated: Option<bool>,
    pub chroma_id: Option<String>,
    pub embedding_generated: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub mentioned_countries: Option<Vec<String>>,
}

/// Aggregated coverage counts for the heatmap.
#[derive(Clone, Debug, Default)]
pub struct CountryCountSnapshot {
    pub counts: BTreeMap<String, i64>,
    pub source_counts: BTreeMap<String, i64>,
    pub total_articles: i64,
    pub articles_with_country: i64,
}

/// One page of articles for the local lens endpoint.
#[derive(Clone, Debug)]
pub struct CountryArticlePage {
    pub articles: Vec<CountryArticleRecord>,
    pub total: i64,
    pub source_count: i64,
    pub matching_strategy: CountryMatchKind,
}

/// One row in the available-country picker.
#[derive(Clone, Debug)]
pub struct CountrySummary {
    pub code: String,
    pub article_count: i64,
    pub latest_article: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct CountRow {
    count: i64,
}

#[derive(Debug, FromRow)]
struct CountryCountRow {
    country: String,
    count: i64,
}

#[derive(Debug, FromRow)]
struct CountryMentionCountRow {
    country: Option<String>,
    count: i64,
}

const COUNTRY_ARTICLE_SELECT: &str = "SELECT \
    id::bigint AS id, title, source, source_id, country, credibility, bias, summary, content, \
    image_url, published_at, category, url, author, authors, tags, original_language, translated, \
    chroma_id, embedding_generated, created_at, updated_at, mentioned_countries \
    FROM articles";

/// Count recent article mentions and source-origin coverage.
pub async fn load_country_counts(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<CountryCountSnapshot, sqlx::Error> {
    let source_rows = sqlx::query_as::<_, CountryCountRow>(
        "SELECT country, COUNT(*)::bigint AS count \
         FROM articles \
         WHERE published_at >= $1 AND country IS NOT NULL AND country <> '' \
         GROUP BY country \
         ORDER BY count DESC, country ASC",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;

    let mut source_counts = BTreeMap::new();
    for row in source_rows {
        source_counts.insert(row.country, row.count);
    }

    let mention_rows = sqlx::query_as::<_, CountryMentionCountRow>(
        "SELECT country, COUNT(*)::bigint AS count \
         FROM articles, unnest(mentioned_countries) AS country \
         WHERE published_at >= $1 \
           AND mentioned_countries IS NOT NULL \
           AND cardinality(mentioned_countries) > 0 \
         GROUP BY country \
         ORDER BY count DESC, country ASC",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;

    let mut counts = BTreeMap::new();
    for row in mention_rows {
        // PostgreSQL arrays may contain NULL elements; FastAPI skips them.
        if let Some(country) = row.country {
            counts.insert(country, row.count);
        }
    }

    let articles_with_country = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*)::bigint AS count \
         FROM articles \
         WHERE published_at >= $1 \
           AND mentioned_countries IS NOT NULL \
           AND cardinality(mentioned_countries) > 0",
    )
    .bind(since)
    .fetch_one(pool)
    .await?
    .count;

    let total_articles = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*)::bigint AS count FROM articles WHERE published_at >= $1",
    )
    .bind(since)
    .fetch_one(pool)
    .await?
    .count;

    Ok(CountryCountSnapshot {
        counts,
        source_counts,
        total_articles,
        articles_with_country,
    })
}

/// Load a page for `/news/country/{code}` and apply the FastAPI fallback.
///
/// The mention predicate is always parameterized. Internal views first require
/// a same-country mention; when that result is empty, they intentionally fall
/// back to source-origin rows, matching the public Local Lens contract.
pub async fn load_country_articles(
    pool: &PgPool,
    code: &str,
    view: CountryView,
    since: Option<DateTime<Utc>>,
    limit: i64,
    offset: i64,
) -> Result<CountryArticlePage, sqlx::Error> {
    let (articles, total, source_count) =
        load_country_page(pool, code, view, since, true, limit, offset).await?;

    if view == CountryView::Internal && total == 0 {
        let (articles, total, source_count) =
            load_country_page(pool, code, view, since, false, limit, offset).await?;
        return Ok(CountryArticlePage {
            articles,
            total,
            source_count,
            matching_strategy: CountryMatchKind::SourceOriginFallback,
        });
    }

    Ok(CountryArticlePage {
        articles,
        total,
        source_count,
        matching_strategy: CountryMatchKind::CountryMentions,
    })
}

async fn load_country_page(
    pool: &PgPool,
    code: &str,
    view: CountryView,
    since: Option<DateTime<Utc>>,
    match_mentions: bool,
    limit: i64,
    offset: i64,
) -> Result<(Vec<CountryArticleRecord>, i64, i64), sqlx::Error> {
    let mut count_query =
        QueryBuilder::<Postgres>::new("SELECT COUNT(*)::bigint AS count FROM articles");
    append_country_filter(&mut count_query, code, view, since, match_mentions);
    let total = count_query
        .build_query_as::<CountRow>()
        .fetch_one(pool)
        .await?
        .count;

    let mut source_count_query = QueryBuilder::<Postgres>::new(
        "SELECT COUNT(DISTINCT source)::bigint AS count FROM articles",
    );
    append_country_filter(&mut source_count_query, code, view, since, match_mentions);
    let source_count = source_count_query
        .build_query_as::<CountRow>()
        .fetch_one(pool)
        .await?
        .count;

    let mut article_query = QueryBuilder::<Postgres>::new(COUNTRY_ARTICLE_SELECT);
    append_country_filter(&mut article_query, code, view, since, match_mentions);
    article_query
        .push(" ORDER BY published_at DESC, id DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let articles = article_query
        .build_query_as::<CountryArticleRecord>()
        .fetch_all(pool)
        .await?;

    Ok((articles, total, source_count))
}

fn append_country_filter(
    query: &mut QueryBuilder<'_, Postgres>,
    code: &str,
    view: CountryView,
    since: Option<DateTime<Utc>>,
    match_mentions: bool,
) {
    let mut has_condition = false;
    if let Some(since) = since {
        push_condition(query, &mut has_condition);
        query.push("published_at >= ").push_bind(since);
    }

    if match_mentions {
        push_condition(query, &mut has_condition);
        query
            .push_bind(code.to_owned())
            .push(" = ANY(mentioned_countries)");
    }

    match view {
        CountryView::Internal => {
            push_condition(query, &mut has_condition);
            query.push("country = ").push_bind(code.to_owned());
        }
        CountryView::External => {
            push_condition(query, &mut has_condition);
            query
                .push("country IS NOT NULL AND country <> '' AND country <> ")
                .push_bind(code.to_owned());
        }
    }
}

fn push_condition(query: &mut QueryBuilder<'_, Postgres>, has_condition: &mut bool) {
    query.push(if *has_condition { " AND " } else { " WHERE " });
    *has_condition = true;
}

/// Load the persisted source-country picker rows.
pub async fn load_available_countries(pool: &PgPool) -> Result<Vec<CountrySummary>, sqlx::Error> {
    #[derive(Debug, FromRow)]
    struct CountrySummaryRow {
        code: String,
        article_count: i64,
        latest_article: Option<DateTime<Utc>>,
    }

    let rows = sqlx::query_as::<_, CountrySummaryRow>(
        "SELECT country AS code, COUNT(*)::bigint AS article_count, MAX(published_at) AS latest_article \
         FROM articles \
         WHERE country IS NOT NULL AND country <> '' \
         GROUP BY country \
         ORDER BY article_count DESC, code ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| CountrySummary {
            code: row.code,
            article_count: row.article_count,
            latest_article: row.latest_article,
        })
        .collect())
}
