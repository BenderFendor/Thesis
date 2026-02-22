use pyo3::prelude::*;
use pyo3::types::PyDict;
use tokio::runtime::Runtime;

mod cleaner;
mod fetcher;
mod html_extract;
mod parser;
mod types;

use crate::parser::parse_sources;
use crate::types::{ensure_source_requests, parse_result_to_pydict};
use crate::html_extract::{extract_article_from_html, extract_og_image_from_html};

#[pyfunction]
fn parse_feeds_parallel<'py>(
    py: Python<'py>,
    sources: Vec<(String, Vec<String>)>,
    max_concurrent: Option<usize>,
) -> PyResult<Bound<'py, PyDict>> {
    let runtime = Runtime::new().map_err(|err| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(
        format!("Failed to start Tokio runtime: {err}"),
    ))?;
    let source_requests = ensure_source_requests(sources);
    let limit = max_concurrent.unwrap_or(32).max(1);

    let result = runtime.block_on(parse_sources(source_requests, limit));
    parse_result_to_pydict(py, &result)
}

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

#[pymodule]
fn rss_parser_rust(py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(parse_feeds_parallel, module)?)?;
    module.add_function(wrap_pyfunction!(extract_article_html, module)?)?;
    module.add_function(wrap_pyfunction!(extract_og_image_html, module)?)?;
    module.add("__version__", env!("CARGO_PKG_VERSION"))?;

    // Expose helper metadata
    let info = PyDict::new_bound(py);
    info.set_item("description", "Rust-powered RSS ingestion helpers")?;
    info.set_item("author", "Bender")?;
    module.add("__info__", info)?;

    Ok(())
}
