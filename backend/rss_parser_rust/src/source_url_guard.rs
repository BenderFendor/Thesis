use pyo3::prelude::*;

/// Normalize a hostname with the existing RSS source-guard rules.
#[pyfunction]
pub fn rust_normalize_host(host: &str) -> String {
    thesis_ingest::source_url_guard::normalize_host(host)
}

/// Compare hostname identity using parent, subdomain, and source-family rules.
#[pyfunction]
pub fn rust_hosts_match(expected: &str, actual: &str) -> bool {
    thesis_ingest::source_url_guard::hosts_match(expected, actual)
}
