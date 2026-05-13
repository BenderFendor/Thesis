use std::collections::HashMap;

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use serde::{Deserialize, Serialize};

/// Describes a named news source and the list of RSS/Atom feed URLs to fetch
/// from it.
#[derive(Clone, Debug, Deserialize)]
pub struct SourceRequest {
    /// Human-readable name of the source (e.g. "BBC News").
    pub name: String,
    /// One or more feed URLs belonging to this source.
    pub urls: Vec<String>,
}

/// Raw response body for a single feed URL that was successfully fetched.
#[derive(Clone, Debug)]
pub struct RawFeed {
    /// Name of the source this feed belongs to.
    pub source_name: String,
    /// Exact URL that was fetched.
    pub url: String,
    /// Raw XML body of the feed response.
    pub xml: String,
}

/// Describes a fetch failure for a single feed URL.
#[derive(Clone, Debug)]
pub struct FetchError {
    /// Name of the source this fetch attempt belonged to.
    pub source_name: String,
    /// URL that failed to fetch.
    pub url: String,
    /// Human-readable error description.
    pub message: String,
}

/// Outcome of a single feed fetch operation.
#[derive(Clone, Debug)]
pub enum FetchResult {
    /// The feed was fetched and its raw XML is available.
    Success(RawFeed),
    /// The fetch attempt failed with the enclosed error details.
    Error(FetchError),
}

/// Represents a single article parsed from an RSS or Atom feed entry.
#[derive(Clone, Debug, Serialize)]
pub struct ParsedArticle {
    /// Article headline extracted from the feed item.
    pub title: String,
    /// URL linking to the full article on the web.
    pub link: String,
    /// Cleaned article summary or description text.
    pub description: String,
    /// Publication date in RFC 3339 format, or the current time if
    /// unavailable.
    pub published: String,
    /// Name of the news source that published this article.
    pub source: String,
    /// List of author names extracted from the feed entry.
    pub authors: Vec<String>,
    /// URL of the lead image, if one was found in the entry metadata.
    pub image: Option<String>,
    /// Category or section label assigned to the article by the publisher.
    pub category: Option<String>,
}

/// Per-URL statistics for a single sub-feed within a source.
#[derive(Clone, Debug, Serialize, Default)]
pub struct SubFeedStat {
    /// The feed URL these statistics describe.
    pub url: String,
    /// Status string: "success" or "error".
    pub status: String,
    /// Number of articles successfully parsed from this sub-feed.
    pub article_count: usize,
    /// Error message if the sub-feed fetch or parse failed.
    pub error_message: Option<String>,
}

/// Aggregate statistics for one news source across all of its sub-feeds.
#[derive(Clone, Debug, Serialize, Default)]
pub struct SourceStats {
    /// Name of the source.
    pub name: String,
    /// Overall status: "success", "warning", or "error".
    pub status: String,
    /// Total number of articles parsed from all sub-feeds of this source.
    pub article_count: usize,
    /// Joined error messages from any failed sub-feeds.
    pub error_message: Option<String>,
    /// Per-sub-feed breakdown, present when the source has multiple feed
    /// URLs.
    pub sub_feeds: Option<Vec<SubFeedStat>>,
}

/// Timing and count metrics for a complete parse run.
#[derive(Clone, Debug, Serialize, Default)]
pub struct RustMetrics {
    /// Total wall-clock duration of the entire fetch-and-parse pipeline in
    /// milliseconds.
    pub total_duration_ms: u128,
    /// Wall-clock duration of the fetch phase in milliseconds.
    pub fetch_duration_ms: u128,
    /// Wall-clock duration of the parse phase in milliseconds.
    pub parse_duration_ms: u128,
    /// Total number of articles successfully parsed.
    pub articles_parsed: usize,
}

/// Top-level result of a full fetch-and-parse pipeline run.
#[derive(Clone, Debug, Default)]
pub struct ParseResult {
    /// All articles extracted from every feed.
    pub articles: Vec<ParsedArticle>,
    /// Per-source statistics keyed by source name.
    pub source_stats: HashMap<String, SourceStats>,
    /// Timing and count metrics for the run.
    pub metrics: RustMetrics,
}

/// Converts a list of Python `(name, [url, ...])` tuples into validated
/// [`SourceRequest`] values, filtering out empty URLs and sources with no
/// valid URLs.
pub fn ensure_source_requests(raw: Vec<(String, Vec<String>)>) -> Vec<SourceRequest> {
    raw.into_iter()
        .map(|(name, urls)| SourceRequest {
            name,
            urls: urls
                .into_iter()
                .filter(|url| !url.trim().is_empty())
                .collect(),
        })
        .filter(|req| !req.urls.is_empty())
        .collect()
}

/// Serializes an entire [`ParseResult`] into a nested Python dictionary
/// suitable for returning to Python callers.
///
/// The returned dict contains `articles`, `source_stats`, and `metrics`
/// keys.
pub fn parse_result_to_pydict<'py>(
    py: Python<'py>,
    result: &ParseResult,
) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new_bound(py);

    let article_dicts = PyList::empty_bound(py);
    for article in &result.articles {
        let item = PyDict::new_bound(py);
        item.set_item("title", &article.title)?;
        item.set_item("link", &article.link)?;
        item.set_item("description", &article.description)?;
        item.set_item("published", &article.published)?;
        item.set_item("source", &article.source)?;
        item.set_item("authors", &article.authors)?;
        item.set_item("image", &article.image)?;
        item.set_item("category", &article.category)?;
        article_dicts.append(item)?;
    }
    dict.set_item("articles", article_dicts)?;

    let stats_dict = PyDict::new_bound(py);
    for (name, stat) in &result.source_stats {
        let stat_dict = PyDict::new_bound(py);
        stat_dict.set_item("name", &stat.name)?;
        stat_dict.set_item("status", &stat.status)?;
        stat_dict.set_item("article_count", stat.article_count)?;
        stat_dict.set_item("error_message", &stat.error_message)?;

        if let Some(subs) = &stat.sub_feeds {
            let sub_list = PyList::empty_bound(py);
            for sub in subs {
                let sub_dict = PyDict::new_bound(py);
                sub_dict.set_item("url", &sub.url)?;
                sub_dict.set_item("status", &sub.status)?;
                sub_dict.set_item("article_count", sub.article_count)?;
                sub_dict.set_item("error_message", &sub.error_message)?;
                sub_list.append(sub_dict)?;
            }
            stat_dict.set_item("sub_feeds", sub_list)?;
        }

        stats_dict.set_item(name, stat_dict)?;
    }
    dict.set_item("source_stats", stats_dict)?;

    let metrics_dict = PyDict::new_bound(py);
    metrics_dict.set_item("total_duration_ms", result.metrics.total_duration_ms)?;
    metrics_dict.set_item("fetch_duration_ms", result.metrics.fetch_duration_ms)?;
    metrics_dict.set_item("parse_duration_ms", result.metrics.parse_duration_ms)?;
    metrics_dict.set_item("articles_parsed", result.metrics.articles_parsed)?;
    dict.set_item("metrics", metrics_dict)?;

    Ok(dict)
}
