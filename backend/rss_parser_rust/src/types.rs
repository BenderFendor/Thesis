use std::collections::HashMap;

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct SourceRequest {
    pub name: String,
    pub urls: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RawFeed {
    pub source_name: String,
    pub url: String,
    pub xml: String,
}

#[derive(Clone, Debug)]
pub struct FetchError {
    pub source_name: String,
    pub url: String,
    pub message: String,
}

#[derive(Clone, Debug)]
pub enum FetchResult {
    Success(RawFeed),
    Error(FetchError),
}

#[derive(Clone, Debug, Serialize)]
pub struct ParsedArticle {
    pub title: String,
    pub link: String,
    pub description: String,
    pub published: String,
    pub source: String,
    pub image: Option<String>,
    pub category: Option<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct SubFeedStat {
    pub url: String,
    pub status: String,
    pub article_count: usize,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct SourceStats {
    pub name: String,
    pub status: String,
    pub article_count: usize,
    pub error_message: Option<String>,
    pub sub_feeds: Option<Vec<SubFeedStat>>,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct RustMetrics {
    pub total_duration_ms: u128,
    pub fetch_duration_ms: u128,
    pub parse_duration_ms: u128,
    pub articles_parsed: usize,
}

#[derive(Clone, Debug, Default)]
pub struct ParseResult {
    pub articles: Vec<ParsedArticle>,
    pub source_stats: HashMap<String, SourceStats>,
    pub metrics: RustMetrics,
}

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
