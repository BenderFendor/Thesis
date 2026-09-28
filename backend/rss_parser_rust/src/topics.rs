use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use thesis_search::topics::{
    cluster_articles_lexical, extract_keywords, extract_keywords_from_titles,
    generate_cluster_label, ArticleInput,
};

/// Python-facing wrapper for [`cluster_articles_lexical`].
///
/// Accepts a list of `(article_id, title, order_index)` tuples and returns a
/// list of cluster dicts, each with `anchor_id`, `member_ids`, and
/// `similarities` keys.
#[pyfunction]
pub fn rust_lexical_cluster<'py>(
    py: Python<'py>,
    articles: Vec<(i64, String, u32)>,
) -> PyResult<Bound<'py, PyList>> {
    let inputs: Vec<ArticleInput> = articles
        .into_iter()
        .map(|(article_id, title, order_index)| ArticleInput {
            article_id,
            title,
            order_index,
        })
        .collect();

    let clusters = cluster_articles_lexical(inputs);
    let result = PyList::empty_bound(py);

    for cluster in clusters {
        let entry = PyDict::new_bound(py);
        entry.set_item("anchor_id", cluster.anchor_id)?;

        let member_list = PyList::empty_bound(py);
        for member_id in &cluster.member_ids {
            member_list.append(member_id)?;
        }
        entry.set_item("member_ids", member_list)?;

        let sim_dict = PyDict::new_bound(py);
        for (k, v) in &cluster.similarities {
            sim_dict.set_item(*k, *v)?;
        }
        entry.set_item("similarities", sim_dict)?;

        result.append(entry)?;
    }

    Ok(result)
}

/// Python-facing wrapper for [`extract_keywords`].
///
/// Returns up to 10 normalized keywords from a single article title.
#[pyfunction]
pub fn rust_extract_keywords(title: String) -> Vec<String> {
    extract_keywords(&title)
}

/// Python-facing wrapper for [`extract_keywords_from_titles`].
///
/// Accepts a list of title strings and returns deduplicated keywords across
/// all of them.
#[pyfunction]
pub fn rust_extract_keywords_from_titles(titles: Vec<String>) -> Vec<String> {
    extract_keywords_from_titles(titles)
}

/// Python-facing wrapper for [`generate_cluster_label`].
///
/// Accepts a list of `(title, score)` tuples and returns the best label for
/// the cluster.
#[pyfunction]
pub fn rust_generate_cluster_label(title_scores: Vec<(String, f64)>) -> String {
    generate_cluster_label(title_scores)
}
