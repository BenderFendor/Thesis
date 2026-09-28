#![deny(missing_docs)]
#![warn(clippy::unwrap_used)]
#![allow(clippy::wildcard_imports)]

//! High-performance RSS feed parsing, article deduplication, topic clustering,
//! and GDELT event processing, exposed as a Python extension module via PyO3.
//!
//! The crate provides:
//!
//! - **Feed ingestion**: Concurrent RSS/Atom fetching and parsing with
//!   configurable concurrency limits.
//! - **Article extraction**: HTML-based extraction of article bodies, Open
//!   Graph images, and metadata from raw web pages.
//! - **Deduplication**: MinHash-based duplicate detection and deduplication of
//!   article groups using character n-gram shingling.
//! - **Topic clustering**: Lexical clustering of articles by title keyword
//!   overlap, with cluster labeling and keyword extraction.
//! - **GDELT processing**: Parsing of GDELT tab-separated event files and
//!   filtering by source domain.
//! - **Feed ranking**: Personalized article ranking based on user interest
//!   profiles derived from bookmarks, likes, and favorite sources.
//! - **Blindspot analysis**: Semantic axis construction and article scoring
//!   for identifying coverage gaps across news sources.
//! - **Country mentions**: High-performance country name extraction from
//!   article text using Aho-Corasick automata and multi-token alias matching.

use pyo3::prelude::*;
use pyo3::types::PyDict;
use tokio::runtime::Runtime;

mod algorithms;
mod blindspot;
mod country_mentions;
mod feed_rank;
mod fetcher;
mod gdelt;
mod gdelt_taxonomy;
mod parser;
mod source_url_guard;
mod topics;
mod types;

use crate::algorithms::{
    compare_articles_json, comparison_keywords, deduplicate_article_groups,
    minhash_duplicate_pairs, sentence_diff, text_similarity,
};
use crate::feed_rank::rank_articles;
use crate::gdelt::{filter_gdelt_by_domain, parse_gdelt_csv};
use crate::parser::parse_sources;
use crate::types::{ensure_source_requests, parse_result_to_pydict};
use thesis_ingest::html_extract::{extract_article_from_html, extract_og_image_from_html};

/// Fetches and parses multiple RSS/Atom feeds concurrently and returns all
/// extracted articles, per-source statistics, and timing metrics.
///
/// Accepts a list of named source groups (each with one or more feed URLs) and
/// an optional maximum concurrency limit. Returns a Python dictionary with
/// keys `articles`, `source_stats`, and `metrics`.
#[pyfunction(signature = (sources, max_concurrent=None, timeout_ms=None))]
fn parse_feeds_parallel<'py>(
    py: Python<'py>,
    sources: Vec<(String, Vec<String>)>,
    max_concurrent: Option<usize>,
    timeout_ms: Option<u64>,
) -> PyResult<Bound<'py, PyDict>> {
    let runtime = Runtime::new().map_err(|err| {
        PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
            "Failed to start Tokio runtime: {err}"
        ))
    })?;
    let source_requests = ensure_source_requests(sources);
    let limit = max_concurrent.unwrap_or(32).max(1);
    let request_timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(25_000).max(1));

    let result = runtime.block_on(parse_sources(source_requests, limit, request_timeout));
    parse_result_to_pydict(py, &result)
}

/// Extracts article body text, title, authors, publish date, top image, all
/// images, and meta description from a raw HTML string.
///
/// Returns a Python dictionary with keys `text`, `title`, `authors`,
/// `publish_date`, `top_image`, `images`, and `meta_description`.
#[pyfunction]
fn extract_article_html<'py>(py: Python<'py>, html: String) -> PyResult<Bound<'py, PyDict>> {
    let result = extract_article_from_html(&html);
    let dict = PyDict::new_bound(py);
    dict.set_item("text", result.text)?;
    dict.set_item("title", result.title)?;
    dict.set_item("authors", result.authors)?;
    dict.set_item("publish_date", result.publish_date)?;
    dict.set_item("top_image", result.top_image)?;
    dict.set_item("images", result.images)?;
    dict.set_item("meta_description", result.meta_description)?;
    Ok(dict)
}

/// Extracts Open Graph and Twitter image URLs from an HTML document along with
/// a ranked list of image candidates from multiple sources.
///
/// Returns a Python dictionary with keys `image_url` and `candidates`.
/// Each candidate includes `url`, `source`, and `priority` fields.
#[pyfunction]
fn extract_og_image_html<'py>(py: Python<'py>, html: String) -> PyResult<Bound<'py, PyDict>> {
    let result = extract_og_image_from_html(&html);
    let dict = PyDict::new_bound(py);
    dict.set_item("image_url", result.image_url)?;

    let candidates = pyo3::types::PyList::empty_bound(py);
    for candidate in result.candidates {
        let item = PyDict::new_bound(py);
        item.set_item("url", candidate.url)?;
        item.set_item("source", candidate.source)?;
        item.set_item("priority", candidate.priority)?;
        candidates.append(item)?;
    }
    dict.set_item("candidates", candidates)?;
    Ok(dict)
}

#[derive(serde::Deserialize)]
struct EvidenceEvaluationInput {
    predicate: String,
    evidence: Vec<thesis_evidence::ObservationEvidence>,
    #[serde(default)]
    complete_control_path: bool,
}

/// Evaluate a JSON evidence payload with the Rust acceptance policy.
#[pyfunction]
fn evaluate_evidence_claim_json(payload: &str) -> PyResult<String> {
    let input: EvidenceEvaluationInput = serde_json::from_str(payload).map_err(|error| {
        PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
            "invalid evidence evaluation payload: {error}"
        ))
    })?;
    let decision = thesis_evidence::evaluate_acceptance(
        &input.predicate,
        &input.evidence,
        input.complete_control_path,
    );
    serde_json::to_string(&decision).map_err(|error| {
        PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
            "could not serialize evidence decision: {error}"
        ))
    })
}

/// Return the stable Rust copy of the active evidence policy rows as JSON.
#[pyfunction]
fn evidence_policies_json() -> PyResult<String> {
    serde_json::to_string(thesis_evidence::policies()).map_err(|error| {
        PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
            "could not serialize evidence policies: {error}"
        ))
    })
}

/// Analyze article language and return the typed search-core payload as JSON.
#[pyfunction(signature = (text, title=None))]
fn analyze_language_diagnostics_json(text: String, title: Option<String>) -> PyResult<String> {
    let payload =
        thesis_search::language_diagnostics::analyze_language_diagnostics(&text, title.as_deref());
    serde_json::to_string(&payload).map_err(|error| {
        PyErr::new::<pyo3::exceptions::PyValueError, _>(format!(
            "could not serialize language diagnostics: {error}"
        ))
    })
}

/// Registers all functions, constants, and metadata on the `rss_parser_rust`
/// Python module during import.
#[pymodule]
fn rss_parser_rust(py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(parse_feeds_parallel, module)?)?;
    module.add_function(wrap_pyfunction!(extract_article_html, module)?)?;
    module.add_function(wrap_pyfunction!(extract_og_image_html, module)?)?;
    module.add_function(wrap_pyfunction!(evaluate_evidence_claim_json, module)?)?;
    module.add_function(wrap_pyfunction!(evidence_policies_json, module)?)?;
    module.add_function(wrap_pyfunction!(analyze_language_diagnostics_json, module)?)?;
    module.add_function(wrap_pyfunction!(
        source_url_guard::rust_normalize_host,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        source_url_guard::rust_hosts_match,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(minhash_duplicate_pairs, module)?)?;
    module.add_function(wrap_pyfunction!(deduplicate_article_groups, module)?)?;
    module.add_function(wrap_pyfunction!(text_similarity, module)?)?;
    module.add_function(wrap_pyfunction!(comparison_keywords, module)?)?;
    module.add_function(wrap_pyfunction!(compare_articles_json, module)?)?;
    module.add_function(wrap_pyfunction!(sentence_diff, module)?)?;
    module.add_function(wrap_pyfunction!(parse_gdelt_csv, module)?)?;
    module.add_function(wrap_pyfunction!(filter_gdelt_by_domain, module)?)?;
    module.add_function(wrap_pyfunction!(
        gdelt_taxonomy::rust_normalize_cameo_root_code,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        gdelt_taxonomy::rust_cameo_root_label,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        gdelt_taxonomy::rust_goldstein_bucket,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        gdelt_taxonomy::rust_dominant_cameo_roots,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(rank_articles, module)?)?;

    // Topic clustering
    module.add_function(wrap_pyfunction!(topics::rust_lexical_cluster, module)?)?;
    module.add_function(wrap_pyfunction!(topics::rust_extract_keywords, module)?)?;
    module.add_function(wrap_pyfunction!(
        topics::rust_extract_keywords_from_titles,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        topics::rust_generate_cluster_label,
        module
    )?)?;

    // Blindspot vector math
    module.add_function(wrap_pyfunction!(blindspot::rust_mean_vector, module)?)?;
    module.add_function(wrap_pyfunction!(blindspot::rust_subtract_vectors, module)?)?;
    module.add_function(wrap_pyfunction!(blindspot::rust_normalize_vector, module)?)?;
    module.add_function(wrap_pyfunction!(blindspot::rust_dot_product, module)?)?;
    module.add_function(wrap_pyfunction!(blindspot::rust_cosine_similarity, module)?)?;
    module.add_function(wrap_pyfunction!(blindspot::rust_quantile, module)?)?;
    module.add_function(wrap_pyfunction!(blindspot::rust_build_semaxis, module)?)?;
    module.add_function(wrap_pyfunction!(
        blindspot::rust_score_against_axis,
        module
    )?)?;

    // Country mentions
    module.add_function(wrap_pyfunction!(
        country_mentions::rust_extract_mentioned_countries,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        country_mentions::rust_build_article_text,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        country_mentions::rust_extract_article_mentioned_countries,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        country_mentions::rust_reload_country_aliases,
        module
    )?)?;

    module.add("__version__", env!("CARGO_PKG_VERSION"))?;

    let info = PyDict::new_bound(py);
    info.set_item("description", "Rust-powered RSS ingestion helpers")?;
    info.set_item("author", "Bender")?;
    module.add("__info__", info)?;

    Ok(())
}
