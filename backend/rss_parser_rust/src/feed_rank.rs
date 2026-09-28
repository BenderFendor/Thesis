use std::collections::HashSet;

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use thesis_search::ranking::{rank_articles as rank_articles_core, ArticleInput};

fn dict_string(dict: &Bound<PyDict>, key: &str) -> Option<String> {
    let value: Option<String> = dict.get_item(key).ok()?.and_then(|v| v.extract().ok());
    Some(value.unwrap_or_default())
}

fn extract_article_meta_from_dict(dict: &Bound<PyDict>) -> Option<ArticleInput> {
    let id: i64 = dict.get_item("id").ok()?.and_then(|v| v.extract().ok())?;
    let tags: Vec<String> = dict
        .get_item("tags")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();

    Some(ArticleInput {
        id,
        title: dict_string(dict, "title")?,
        summary: dict_string(dict, "summary")?,
        category: dict_string(dict, "category")?,
        source: dict_string(dict, "source")?,
        source_id: dict_string(dict, "source_id")?,
        tags,
        image: dict_string(dict, "image")?,
    })
}

/// Scores and ranks a list of articles against a personalized interest
/// profile built from the user's liked and bookmarked articles.
///
/// Accepts a list of Python article dicts, lists of liked and bookmarked
/// article IDs, and a list of favorite source IDs. Returns a list of
/// ranking result dicts sorted by bucket priority then total score
/// (descending).
#[pyfunction]
pub fn rank_articles<'py>(
    py: Python<'py>,
    articles: Bound<'py, PyList>,
    liked_article_ids: Vec<i64>,
    bookmarked_article_ids: Vec<i64>,
    favorite_source_ids: Vec<String>,
) -> PyResult<Bound<'py, PyList>> {
    let liked_set: HashSet<i64> = liked_article_ids.into_iter().collect();
    let bookmarked_set: HashSet<i64> = bookmarked_article_ids.into_iter().collect();
    let favorite_set: HashSet<String> = favorite_source_ids.into_iter().collect();

    let mut metas: Vec<ArticleInput> = Vec::new();
    for item in articles.iter() {
        let dict = item.downcast::<PyDict>()?;
        if let Some(meta) = extract_article_meta_from_dict(dict) {
            metas.push(meta);
        }
    }

    let results = rank_articles_core(&metas, &liked_set, &bookmarked_set, &favorite_set);

    let list = PyList::empty_bound(py);
    for r in &results {
        let d = PyDict::new_bound(py);
        d.set_item("article_id", r.article_id)?;
        d.set_item("total_score", r.total_score)?;
        d.set_item("bucket_rank", r.bucket_rank)?;
        d.set_item("bucket_label", &r.bucket_label)?;
        d.set_item("keyword_score", r.keyword_score)?;
        d.set_item("category_score", r.category_score)?;
        d.set_item("source_score", r.source_score)?;
        d.set_item("matched_keywords", &r.matched_keywords)?;
        d.set_item("matched_categories", &r.matched_categories)?;
        d.set_item("matched_source", &r.matched_source)?;
        list.append(d)?;
    }

    Ok(list)
}
