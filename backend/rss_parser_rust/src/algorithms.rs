use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use thesis_search::article_comparison::{calculate_text_similarity, generate_sentence_diff};

const DEFAULT_NUM_HASHES: usize = 128;
// also after we are done mirigating from python to rust fully we should push the whole of this
// rss_parser_rust into a crates in the /crates folders as something like thesis-rss as the
// subfolder in the crates folder

/// Detects near-duplicate document pairs using MinHash signatures.
///
/// Accepts a list of `(doc_id, text)` tuples and an optional Jaccard
/// threshold. Returns a list of dicts with `doc_id_1`, `doc_id_2`, and
/// `similarity` keys, sorted by similarity descending.
#[pyfunction]
pub fn minhash_duplicate_pairs<'py>(
    py: Python<'py>,
    documents: Vec<(String, String)>,
    threshold: Option<f64>,
    num_hashes: Option<usize>,
) -> PyResult<Bound<'py, PyList>> {
    let threshold = threshold.unwrap_or(0.85);
    let num_hashes = num_hashes.unwrap_or(DEFAULT_NUM_HASHES).max(1);
    let duplicates =
        thesis_search::minhash::find_duplicate_pairs(&documents, threshold, num_hashes);

    let result = PyList::empty_bound(py);
    for item in duplicates {
        let pair = PyDict::new_bound(py);
        pair.set_item("doc_id_1", item.doc_id_1)?;
        pair.set_item("doc_id_2", item.doc_id_2)?;
        pair.set_item("similarity", item.similarity)?;
        result.append(pair)?;
    }
    Ok(result)
}

/// Python-facing wrapper for [`calculate_text_similarity`].
///
/// Returns the normalized Levenshtein similarity between two strings as a
/// Python float.
#[pyfunction]
pub fn text_similarity(text1: &str, text2: &str) -> f64 {
    calculate_text_similarity(text1, text2)
}

/// Extracts frequency-ranked keywords for the article comparison service.
#[pyfunction]
pub fn comparison_keywords(
    py: Python<'_>,
    text: &str,
    top_n: usize,
) -> PyResult<Vec<(String, usize)>> {
    let unicode_version: String = PyModule::import_bound(py, "unicodedata")?
        .getattr("unidata_version")?
        .extract()?;
    let mut version_parts = unicode_version.split('.');
    let major = version_parts
        .next()
        .and_then(|part| part.parse::<u16>().ok())
        .unwrap_or_default();
    let minor = version_parts
        .next()
        .and_then(|part| part.parse::<u16>().ok())
        .unwrap_or_default();
    let unicode_15_1 = major > 15 || (major == 15 && minor >= 1);
    Ok(thesis_search::comparison_keywords::extract_keywords(
        text,
        top_n,
        unicode_15_1,
    ))
}

/// Serialize the Rust article comparison response for service-level differential tests.
#[pyfunction]
pub fn compare_articles_json(
    content_1: &str,
    content_2: &str,
    title_1: &str,
    title_2: &str,
) -> PyResult<String> {
    serde_json::to_string(&thesis_search::article_comparison::compare_articles(
        content_1, content_2, title_1, title_2,
    ))
    .map_err(|error| {
        PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
            "could not serialize article comparison: {error}"
        ))
    })
}

/// Compares two texts sentence-by-sentence and returns a sentence-level
/// diff.
///
/// Returns a Python dict with `added`, `removed`, and `similar` keys. Each
/// sentence entry includes index, text, similarity, and type metadata.
#[pyfunction]
pub fn sentence_diff<'py>(
    py: Python<'py>,
    text1: &str,
    text2: &str,
) -> PyResult<Bound<'py, PyDict>> {
    let diff = generate_sentence_diff(text1, text2);
    let result = PyDict::new_bound(py);

    let added_list = PyList::empty_bound(py);
    for item in diff.added {
        let entry = PyDict::new_bound(py);
        entry.set_item("index", item.index)?;
        entry.set_item("text", item.text)?;
        entry.set_item("type", item.kind)?;
        added_list.append(entry)?;
    }

    let removed_list = PyList::empty_bound(py);
    for item in diff.removed {
        let entry = PyDict::new_bound(py);
        entry.set_item("index", item.index)?;
        entry.set_item("text", item.text)?;
        entry.set_item("type", item.kind)?;
        removed_list.append(entry)?;
    }

    let similar_list = PyList::empty_bound(py);
    for item in diff.similar {
        let entry = PyDict::new_bound(py);
        entry.set_item("source_1_index", item.source_1_index)?;
        entry.set_item("source_2_index", item.source_2_index)?;
        entry.set_item("source_1_text", item.source_1_text)?;
        entry.set_item("source_2_text", item.source_2_text)?;
        entry.set_item("similarity", item.similarity)?;
        similar_list.append(entry)?;
    }

    result.set_item("added", added_list)?;
    result.set_item("removed", removed_list)?;
    result.set_item("similar", similar_list)?;
    Ok(result)
}

/// Groups exact and near-duplicate articles through the Rust search domain.
///
/// Accepts a list of `(doc_id, text)` tuples and returns a Python dict
/// mapping each group representative ID to a list of all member IDs.
#[pyfunction]
pub fn deduplicate_article_groups<'py>(
    py: Python<'py>,
    articles: Vec<(String, String)>,
    threshold: Option<f64>,
    num_hashes: Option<usize>,
) -> PyResult<Bound<'py, PyDict>> {
    let threshold = threshold.unwrap_or(0.85);
    let num_hashes = num_hashes.unwrap_or(DEFAULT_NUM_HASHES).max(1);
    let groups =
        thesis_search::minhash::deduplicate_article_groups(&articles, threshold, num_hashes);
    let result = PyDict::new_bound(py);
    for (representative, group) in groups {
        let members = PyList::empty_bound(py);
        let mut sorted_members = group.into_iter().collect::<Vec<_>>();
        sorted_members.sort();
        for member in sorted_members {
            members.append(member)?;
        }
        result.set_item(representative, members)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{calculate_text_similarity, generate_sentence_diff};
    use thesis_search::minhash::{
        compute_minhash_signature, estimate_jaccard_similarity, shingle_text,
    };

    #[test]
    fn shingles_handle_short_inputs() {
        let shingles = shingle_text("abc", 5);
        assert_eq!(shingles.len(), 1);
        assert!(shingles.contains("abc"));
    }

    #[test]
    fn identical_signatures_match_perfectly() {
        let left = compute_minhash_signature("alpha beta gamma", 32, 42);
        let right = compute_minhash_signature("alpha beta gamma", 32, 42);
        assert_eq!(estimate_jaccard_similarity(&left, &right), 1.0);
    }

    #[test]
    fn text_similarity_respects_empty_inputs() {
        assert_eq!(calculate_text_similarity("", "alpha"), 0.0);
    }

    #[test]
    fn text_similarity_treats_identical_control_whitespace_as_exact_match() {
        assert_eq!(calculate_text_similarity("\u{0085}", "\u{0085}"), 1.0);
    }

    #[test]
    fn sentence_diff_reports_unique_sentences() {
        let diff = generate_sentence_diff("Alpha wins. Beta holds.", "Alpha wins. Gamma reacts.");
        assert_eq!(diff.similar.len(), 1);
        assert_eq!(diff.removed.len(), 1);
        assert_eq!(diff.added.len(), 1);
    }
}
