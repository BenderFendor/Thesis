use pyo3::prelude::*;
use thesis_ingest::gdelt_taxonomy::{
    cameo_root_label, dominant_cameo_roots, goldstein_bucket, normalize_cameo_root_code,
};

/// Normalizes a CAMEO root code through the `thesis-ingest` domain core.
#[pyfunction]
pub fn rust_normalize_cameo_root_code(code: Option<String>) -> Option<String> {
    normalize_cameo_root_code(code.as_deref())
}

/// Resolves a CAMEO root label through the `thesis-ingest` domain core.
#[pyfunction]
pub fn rust_cameo_root_label(code: Option<String>) -> Option<String> {
    cameo_root_label(code.as_deref()).map(str::to_owned)
}

/// Classifies a Goldstein value using the established threshold labels.
#[pyfunction]
pub fn rust_goldstein_bucket(value: Option<f64>) -> Option<String> {
    goldstein_bucket(value).map(|bucket| bucket.as_str().to_owned())
}

/// Counts CAMEO roots and returns `(code, label, count)` tuples.
#[pyfunction]
pub fn rust_dominant_cameo_roots(
    codes: Vec<Option<String>>,
    limit: i64,
) -> Vec<(String, Option<String>, usize)> {
    let limit = usize::try_from(limit).unwrap_or(0);
    dominant_cameo_roots(&codes, limit)
        .into_iter()
        .map(|root| (root.code, root.label, root.count))
        .collect()
}
