use chrono::Datelike;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use thesis_ingest::gdelt::{extract_domain, filter_events_by_domain, parse_gdelt_tsv, GdeltRecord};

fn record_to_pydict<'py>(py: Python<'py>, record: &GdeltRecord) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new_bound(py);
    dict.set_item("gdelt_id", &record.global_event_id)?;
    dict.set_item("url", &record.source_url)?;

    let title = &record.document_identifier;
    dict.set_item("title", title)?;

    let domain = extract_domain(&record.source_url);
    dict.set_item("source", domain)?;

    let date = chrono::NaiveDate::parse_from_str(&record.sql_date, "%Y%m%d").unwrap_or_else(|_| {
        chrono::NaiveDate::from_ymd_opt(1970, 1, 1).expect("1970-01-01 is a valid date")
    });
    let py_datetime = py.import_bound("datetime")?;
    let py_timezone = py_datetime.getattr("timezone")?.getattr("utc")?;
    let published = py_datetime.call_method1(
        "datetime",
        (
            date.year(),
            date.month(),
            date.day(),
            0,
            0,
            0,
            0,
            py_timezone,
        ),
    )?;
    dict.set_item("published_at", published)?;

    dict.set_item("event_code", &record.event_code)?;
    dict.set_item("event_root_code", &record.event_root_code)?;
    dict.set_item("actor1_name", &record.actor1_name)?;
    dict.set_item("actor1_country", &record.actor1_country_code)?;
    dict.set_item("actor2_name", &record.actor2_name)?;
    dict.set_item("actor2_country", &record.actor2_country_code)?;

    let tone: f64 = record.avg_tone.parse().unwrap_or(0.0);
    dict.set_item("tone", tone)?;

    let goldstein: f64 = record.goldstein_scale.parse().unwrap_or(0.0);
    dict.set_item("goldstein_scale", goldstein)?;

    Ok(dict)
}

/// Parses a GDELT tab-separated CSV string into a list of Python
/// dictionaries, each with fields including `gdelt_id`, `url`, `title`,
/// `source`, `published_at`, event codes, actor names, tone, and Goldstein
/// scale.
#[pyfunction]
pub fn parse_gdelt_csv<'py>(
    py: Python<'py>,
    content: String,
    limit: usize,
) -> PyResult<Vec<Bound<'py, PyDict>>> {
    let records = parse_gdelt_tsv(&content, limit);
    let mut results = Vec::with_capacity(records.len());
    for record in &records {
        results.push(record_to_pydict(py, record)?);
    }
    Ok(results)
}

/// Filters a list of GDELT event dicts (from Python) to only those whose
/// source URL matches the given domain, returning simplified dicts with
/// `gdelt_id`, `url`, `title`, and `domain`.
#[pyfunction]
pub fn filter_gdelt_by_domain<'py>(
    py: Python<'py>,
    events: Vec<std::collections::HashMap<String, String>>,
    domain: String,
) -> PyResult<Vec<Bound<'py, PyDict>>> {
    let records: Vec<GdeltRecord> = events
        .iter()
        .filter_map(|e| {
            Some(GdeltRecord {
                global_event_id: e.get("gdelt_id")?.clone(),
                sql_date: String::new(),
                source_url: e.get("url")?.clone(),
                document_identifier: e.get("title").cloned().unwrap_or_default(),
                event_code: e.get("event_code").cloned().unwrap_or_default(),
                event_root_code: e.get("event_root_code").cloned().unwrap_or_default(),
                actor1_name: e.get("actor1_name").cloned().unwrap_or_default(),
                actor1_country_code: e.get("actor1_country").cloned().unwrap_or_default(),
                actor2_name: e.get("actor2_name").cloned().unwrap_or_default(),
                actor2_country_code: e.get("actor2_country").cloned().unwrap_or_default(),
                avg_tone: String::new(),
                goldstein_scale: String::new(),
            })
        })
        .collect();

    let filtered = filter_events_by_domain(&records, &domain);
    let mut results = Vec::with_capacity(filtered.len());
    for record in &filtered {
        let dict = PyDict::new_bound(py);
        dict.set_item("gdelt_id", &record.global_event_id)?;
        dict.set_item("url", &record.source_url)?;
        dict.set_item("title", &record.document_identifier)?;
        dict.set_item("domain", extract_domain(&record.source_url))?;
        results.push(dict);
    }
    Ok(results)
}
