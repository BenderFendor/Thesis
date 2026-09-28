use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use thesis_search::country_mentions::{build_article_text, CountryAliases};

static COUNTRY_ALIASES: Lazy<RwLock<Option<Arc<CountryAliases>>>> = Lazy::new(|| {
    RwLock::new(
        read_country_aliases()
            .ok()
            .map(|(aliases, _)| Arc::new(aliases)),
    )
});

enum LoadError {
    Read(std::io::Error),
    Parse(serde_json::Error),
}

fn read_country_aliases() -> Result<(CountryAliases, usize), LoadError> {
    let data_dir =
        std::env::var("RSS_PARSER_DATA_DIR").unwrap_or_else(|_| "backend/app/data".to_string());
    let path = Path::new(&data_dir).join("country_aliases.json");
    let content = std::fs::read_to_string(path).map_err(LoadError::Read)?;
    let raw: HashMap<String, Vec<String>> =
        serde_json::from_str(&content).map_err(LoadError::Parse)?;
    let count = raw.len();
    Ok((CountryAliases::new(&raw), count))
}

fn current_country_aliases() -> Option<Arc<CountryAliases>> {
    COUNTRY_ALIASES.read().ok()?.as_ref().cloned()
}

/// Scan text for country aliases using the loaded country data.
#[pyfunction]
pub fn rust_extract_mentioned_countries(text: &str) -> Vec<String> {
    current_country_aliases().map_or_else(Vec::new, |aliases| aliases.extract(text))
}

/// Join non-empty title, summary, and content in that order.
#[pyfunction]
pub fn rust_build_article_text(
    title: Option<String>,
    summary: Option<String>,
    content: Option<String>,
) -> String {
    build_article_text(title.as_deref(), summary.as_deref(), content.as_deref())
}

/// Build article text and return the sorted country codes it mentions.
#[pyfunction]
pub fn rust_extract_article_mentioned_countries(
    title: Option<String>,
    summary: Option<String>,
    content: Option<String>,
) -> Vec<String> {
    let text = build_article_text(title.as_deref(), summary.as_deref(), content.as_deref());
    rust_extract_mentioned_countries(&text)
}

/// Reload country aliases from disk and report the loaded country count.
#[pyfunction]
pub fn rust_reload_country_aliases<'py>(py: Python<'py>) -> PyResult<Bound<'py, PyDict>> {
    let (aliases, count) = read_country_aliases().map_err(|error| match error {
        LoadError::Read(error) => {
            PyErr::new::<pyo3::exceptions::PyIOError, _>(format!("Failed to read: {error}"))
        }
        LoadError::Parse(error) => {
            PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("Invalid JSON: {error}"))
        }
    })?;
    *COUNTRY_ALIASES
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Arc::new(aliases));

    let dict = PyDict::new_bound(py);
    dict.set_item("loaded", true)?;
    dict.set_item("countries", count)?;
    Ok(dict)
}
