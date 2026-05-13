use pyo3::prelude::*;
use pyo3::types::PyDict;
use serde::Deserialize;

/// One row from a GDELT 1.0 or 2.0 event export in tab-separated format.
#[derive(Debug, Clone, Deserialize)]
pub struct GdeltRecord {
    /// Globally unique event identifier assigned by GDELT.
    #[serde(rename = "GlobalEventID")]
    pub global_event_id: String,
    /// Date of the event in YYYYMMDD format.
    #[serde(rename = "SQLDATE")]
    pub sql_date: String,
    /// URL of the source document reporting the event.
    #[serde(rename = "SOURCEURL")]
    pub source_url: String,
    /// Document identifier (often the article headline or URL).
    #[serde(rename = "DocumentIdentifier")]
    pub document_identifier: String,
    /// Full CAMEO event code.
    #[serde(rename = "EventCode")]
    pub event_code: String,
    /// Root-level CAMEO event code.
    #[serde(rename = "EventRootCode")]
    pub event_root_code: String,
    /// Name of the primary actor in the event.
    #[serde(rename = "Actor1Name")]
    pub actor1_name: String,
    /// ISO country code of the primary actor.
    #[serde(rename = "Actor1CountryCode")]
    pub actor1_country_code: String,
    /// Name of the secondary actor in the event.
    #[serde(rename = "Actor2Name")]
    pub actor2_name: String,
    /// ISO country code of the secondary actor.
    #[serde(rename = "Actor2CountryCode")]
    pub actor2_country_code: String,
    /// Average sentiment tone score for the event.
    #[serde(rename = "AvgTone")]
    pub avg_tone: String,
    /// Goldstein conflict-cooperation scale value for the event.
    #[serde(rename = "GoldsteinScale")]
    pub goldstein_scale: String,
}

/// Parses a GDELT tab-separated event file into a list of [`GdeltRecord`]
/// values, respecting an upper bound on the number of records to return.
///
/// Skips rows with empty global event IDs or source URLs.
pub fn parse_gdelt_tsv(content: &str, limit: usize) -> Vec<GdeltRecord> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(true)
        .flexible(true)
        .from_reader(content.as_bytes());

    let mut records: Vec<GdeltRecord> = Vec::with_capacity(limit.min(1024));

    for result in reader.deserialize::<GdeltRecord>() {
        if records.len() >= limit {
            break;
        }
        match result {
            Ok(record) => {
                if record.global_event_id.is_empty() || record.source_url.is_empty() {
                    continue;
                }
                records.push(record);
            }
            Err(_) => continue,
        }
    }

    records
}

/// Strips the protocol and `www.` prefix from a URL, returning the bare
/// domain name.
pub fn extract_domain(url: &str) -> &str {
    let without_prefix = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .unwrap_or(url);

    let host = without_prefix.split('/').next().unwrap_or(without_prefix);

    host.strip_prefix("www.").unwrap_or(host)
}

/// Filters a collection of GDELT event records to those whose source URL
/// matches the given domain (case-insensitive).
pub fn filter_events_by_domain(events: &[GdeltRecord], domain: &str) -> Vec<GdeltRecord> {
    let domain_lower = domain.to_lowercase();
    events
        .iter()
        .filter(|e| extract_domain(&e.source_url).to_lowercase() == domain_lower)
        .cloned()
        .collect()
}

fn record_to_pydict<'py>(py: Python<'py>, record: &GdeltRecord) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new_bound(py);
    dict.set_item("gdelt_id", &record.global_event_id)?;
    dict.set_item("url", &record.source_url)?;

    let title = &record.document_identifier;
    dict.set_item("title", title)?;

    let domain = extract_domain(&record.source_url);
    dict.set_item("source", domain)?;

    let published = if record.sql_date.len() == 8 {
        let year: i32 = record.sql_date[0..4].parse().unwrap_or(1970);
        let month: u8 = record.sql_date[4..6].parse().unwrap_or(1);
        let day: u8 = record.sql_date[6..8].parse().unwrap_or(1);

        let py_datetime = py.import_bound("datetime")?;
        let py_timezone = py_datetime.getattr("timezone")?.getattr("utc")?;
        py_datetime.call_method1("datetime", (year, month, day, 0, 0, 0, 0, py_timezone))?
    } else {
        let py_datetime = py.import_bound("datetime")?;
        let py_timezone = py_datetime.getattr("timezone")?.getattr("utc")?;
        py_datetime.call_method1("datetime", (1970, 1, 1, 0, 0, 0, 0, py_timezone))?
    };
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
