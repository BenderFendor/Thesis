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

#[cfg(test)]
mod tests {
    use super::parse_gdelt_tsv;
    use proptest::prelude::*;

    const HEADER: &str = "GlobalEventID\tSQLDATE\tSOURCEURL\tDocumentIdentifier\tEventCode\tEventRootCode\tActor1Name\tActor1CountryCode\tActor2Name\tActor2CountryCode\tAvgTone\tGoldsteinScale\n";

    proptest! {
        #[test]
        fn parsed_rows_are_valid_ordered_and_bounded(
            missing_fields in prop::collection::vec((any::<bool>(), any::<bool>()), 0..24),
            limit in 0usize..25,
        ) {
            let mut input = HEADER.to_owned();
            for (index, (missing_id, missing_url)) in missing_fields.iter().copied().enumerate() {
                let id = if missing_id { String::new() } else { format!("event-{index}") };
                let url = if missing_url {
                    String::new()
                } else {
                    format!("https://source-{index}.example/article")
                };
                input.push_str(&format!(
                    "{id}\t20240923\t{url}\ttitle-{index}\t01\t01\tActor\tUS\tOther\tGB\t1.2\t2.0\n"
                ));
            }

            let actual: Vec<String> = parse_gdelt_tsv(&input, limit)
                .into_iter()
                .map(|record| record.global_event_id)
                .collect();
            let expected: Vec<String> = missing_fields
                .iter()
                .enumerate()
                .filter(|&(_, &(missing_id, missing_url))| !missing_id && !missing_url)
                .map(|(index, _)| format!("event-{index}"))
                .take(limit)
                .collect();

            prop_assert_eq!(actual, expected);
        }
    }

    #[test]
    fn extract_domain_removes_scheme_www_and_path() {
        assert_eq!(
            super::extract_domain("https://www.example.org/news/story"),
            "example.org"
        );
    }
}
