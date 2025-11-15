use pyo3::prelude::*;
use pyo3::types::PyDict;
use tokio::runtime::Runtime;

mod cleaner;
mod fetcher;
mod parser;
mod types;

use crate::parser::parse_sources;
use crate::types::{ensure_source_requests, parse_result_to_pydict};

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

#[pymodule]
fn rss_parser_rust(py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(parse_feeds_parallel, module)?)?;
    module.add("__version__", env!("CARGO_PKG_VERSION"))?;

    // Expose helper metadata
    let info = PyDict::new_bound(py);
    info.set_item("description", "Rust-powered RSS ingestion helpers")?;
    info.set_item("author", "Thesis")?;
    module.add("__info__", info)?;

    Ok(())
}
