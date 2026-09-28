//! Database-backed runtime adapters for the source catalog API.

use std::fmt::Display;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};
use thesis_api::source_catalog::{
    configured_catalog, PromotedSource, SourceCatalogEntry, SourceCatalogFuture,
    SourceCatalogIntegrationError, SourceCatalogStore, SourceCredibilityProvider, SourceUrlValue,
};
use thesis_db::{
    Database, PersistedSourceCatalogRecord, SourceCatalogPromotion, WikiSourceCredibilityData,
};
mod rss;

pub(crate) use rss::SafeRssFeedProvider;

/// Lists the configured catalog followed by durably promoted sources.
pub(crate) struct DatabaseSourceCatalogStore {
    database: Database,
}

impl DatabaseSourceCatalogStore {
    pub(crate) fn new(database: Database) -> Self {
        Self { database }
    }
}

impl SourceCatalogStore for DatabaseSourceCatalogStore {
    fn list(&self) -> SourceCatalogFuture<Vec<SourceCatalogEntry>> {
        let database = self.database.clone();
        Box::pin(async move {
            let promoted = database
                .list_promoted_sources()
                .await
                .map_err(|error| catalog_database_error("list", error))?;
            Ok(catalog_entries(configured_catalog().to_vec(), promoted))
        })
    }

    fn promote(&self, source: PromotedSource) -> SourceCatalogFuture<()> {
        let database = self.database.clone();
        Box::pin(async move {
            let name = source.name.clone();
            let inserted = database
                .promote_source(SourceCatalogPromotion {
                    name: source.name,
                    url: source.url,
                    category: source.category,
                    country: source.country,
                    source_type: source.source_type,
                    funding_type: source.funding_type,
                    bias_rating: source.bias_rating,
                    ownership_label: source.ownership_label,
                    factual_reporting: source.factual_reporting,
                    is_paywalled: source.is_paywalled,
                })
                .await
                .map_err(|error| catalog_database_error("promote", error))?;
            promotion_outcome(name, inserted)
        })
    }
}

/// Computes the same six source-credibility dimensions as the Python service.
pub(crate) struct DatabaseSourceCredibilityProvider {
    database: Database,
}

impl DatabaseSourceCredibilityProvider {
    pub(crate) fn new(database: Database) -> Self {
        Self { database }
    }
}

impl SourceCredibilityProvider for DatabaseSourceCredibilityProvider {
    fn compute(&self, domain: String) -> SourceCatalogFuture<Value> {
        let database = self.database.clone();
        Box::pin(async move {
            let domain = normalize_domain(&domain);
            let Some(data) = database
                .load_source_credibility_data(&domain)
                .await
                .map_err(credibility_database_error)?
            else {
                return Ok(empty_profile(&domain, None));
            };
            let result_domain = data
                .metadata
                .domain
                .as_deref()
                .filter(|value| !value.is_empty())
                .unwrap_or(&domain);
            Ok(compute_profile(result_domain, &data, &utc_isoformat()))
        })
    }
}

fn catalog_entries(
    mut configured: Vec<SourceCatalogEntry>,
    promoted: Vec<PersistedSourceCatalogRecord>,
) -> Vec<SourceCatalogEntry> {
    configured.reserve(promoted.len());
    configured.extend(promoted.into_iter().map(promoted_entry));
    configured
}

fn promoted_entry(source: PersistedSourceCatalogRecord) -> SourceCatalogEntry {
    let slug = source_slug(&source.name);
    let url = SourceUrlValue::String(source.url);
    SourceCatalogEntry {
        id: slug.clone(),
        slug,
        name: source.name,
        url: url.clone(),
        rss_url: url,
        category: source.category,
        country: source.country,
        source_type: source.source_type,
        is_paywalled: source.is_paywalled,
        funding_type: source.funding_type,
        bias_rating: source.bias_rating,
        ownership_label: source.ownership_label,
    }
}

fn source_slug(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
        .to_lowercase()
}

fn promotion_outcome(name: String, inserted: bool) -> Result<(), SourceCatalogIntegrationError> {
    if inserted {
        Ok(())
    } else {
        Err(SourceCatalogIntegrationError::AlreadyExists(name))
    }
}

fn catalog_database_error(
    operation: &'static str,
    error: impl Display,
) -> SourceCatalogIntegrationError {
    tracing::error!(operation, error = %error, "source catalog database operation failed");
    SourceCatalogIntegrationError::Failed("Source catalog persistence failed.".to_owned())
}

fn credibility_database_error(error: impl Display) -> SourceCatalogIntegrationError {
    tracing::error!(error = %error, "source credibility database operation failed");
    SourceCatalogIntegrationError::Failed("Source credibility could not be computed.".to_owned())
}

fn normalize_domain(domain: &str) -> String {
    let normalized = domain.trim();
    let host = if let Some((_, remainder)) = normalized.split_once("://") {
        let authority = remainder.split(['/', '?', '#']).next().unwrap_or(remainder);
        let host_port = authority.rsplit('@').next().unwrap_or(authority);
        if let Some(host) = host_port.strip_prefix('[') {
            host.split(']').next().unwrap_or(host)
        } else {
            host_port.split(':').next().unwrap_or(host_port)
        }
    } else {
        normalized
            .split('/')
            .next()
            .unwrap_or(normalized)
            .split(':')
            .next()
            .unwrap_or(normalized)
            .trim()
    };
    let host = if host
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("www."))
    {
        &host[4..]
    } else {
        host
    };
    host.to_ascii_lowercase()
}

const CREDIBILITY_DIMENSIONS: [&str; 6] = [
    "funding_transparency",
    "source_network_diversity",
    "political_orientation_disclosure",
    "correction_record",
    "methodology_transparency",
    "cross_verification_alignment",
];

const CORRECTION_AXES: [&str; 3] = ["correction_record", "corrections", "corrections_history"];
const CORRECTION_POLICY_IDS: [&str; 2] = ["corrections_process", "corrections_policy"];
const METHODOLOGY_AXES: [&str; 3] = [
    "methodology_transparency",
    "editorial_standards",
    "transparency",
];
const METHODOLOGY_POLICY_IDS: [&str; 6] = [
    "editorial_independence",
    "ethics_or_standards",
    "staff_or_byline_disclosure",
    "anonymous_sources_policy",
    "ai_or_synthetic_media_policy",
    "conflicts_policy",
];

fn empty_profile(domain: &str, last_updated: Option<&str>) -> Value {
    let mut dimensions = Map::new();
    for dimension in CREDIBILITY_DIMENSIONS {
        dimensions.insert(dimension.to_owned(), empty_dimension(dimension));
    }
    json!({
        "domain": domain,
        "dimensions": dimensions,
        "data_quality": {
            "dimensions_available": 0,
            "dimensions_total": 6,
            "completeness_pct": 0.0,
            "last_updated": last_updated,
        },
        "status": "insufficient_data",
    })
}

fn empty_dimension(dimension: &str) -> Value {
    json!({
        "score": null,
        "confidence": 0.0,
        "explanation": "No data available for this dimension.",
        "signals_available": 0,
        "signals_missing": 6,
        "provenance": [],
        "status": "insufficient_data",
        "dimension": dimension,
    })
}

fn compute_profile(domain: &str, data: &WikiSourceCredibilityData, now: &str) -> Value {
    let mut dimensions = Map::new();
    dimensions.insert(
        "funding_transparency".to_owned(),
        funding_transparency(data, now),
    );
    dimensions.insert(
        "source_network_diversity".to_owned(),
        source_network_diversity(data, now),
    );
    dimensions.insert(
        "political_orientation_disclosure".to_owned(),
        political_orientation(data, now),
    );
    dimensions.insert("correction_record".to_owned(), correction_record(data, now));
    dimensions.insert(
        "methodology_transparency".to_owned(),
        methodology_transparency(data, now),
    );
    dimensions.insert(
        "cross_verification_alignment".to_owned(),
        cross_verification_alignment(data, now),
    );

    let dimensions_available = dimensions
        .values()
        .filter(|dimension| !dimension["score"].is_null())
        .count();
    json!({
        "domain": domain,
        "dimensions": dimensions,
        "data_quality": {
            "dimensions_available": dimensions_available,
            "dimensions_total": 6,
            "completeness_pct": round_to_precision(dimensions_available as f64 / 6.0 * 100.0, 1),
            "last_updated": now,
        },
        "status": if dimensions_available > 0 { "data_available" } else { "insufficient_data" },
    })
}

fn funding_transparency(data: &WikiSourceCredibilityData, now: &str) -> Value {
    let mut scores = Vec::with_capacity(5);
    let mut provenance = Vec::with_capacity(5);
    if let Some(organization) = &data.organization {
        if let Some(funding_type) = organization
            .funding_type
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            scores.push((
                if matches!(funding_type, "public" | "independent" | "non-profit") {
                    75.0
                } else {
                    40.0
                },
                0.25,
            ));
            provenance.push(provenance_entry("wikidata_organization", "", now));
        }
        if let Some(parent_orgs) = organization
            .parent_orgs
            .as_ref()
            .map(|value| &value.0)
            .and_then(Value::as_array)
            .filter(|values| !values.is_empty())
        {
            scores.push(((parent_orgs.len().min(5) * 20) as f64, 0.20));
            provenance.push(provenance_entry("wikidata_ownership_chain", "", now));
        }
        if organization
            .ein
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        {
            scores.push((60.0, 0.20));
            provenance.push(provenance_entry("irs_990_data", "", now));
        }
        if organization
            .funding_sources
            .as_ref()
            .map(|value| &value.0)
            .is_some_and(python_truthy)
        {
            scores.push((50.0, 0.20));
            provenance.push(provenance_entry("organization_funding", "", now));
        }
        if organization
            .annual_revenue
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        {
            scores.push((40.0, 0.15));
            provenance.push(provenance_entry("organization_revenue", "", now));
        }
    }
    if scores.is_empty() {
        return empty_dimension("funding_transparency");
    }
    let signals_available = scores.len();
    let score = weighted_score(&scores);
    dimension_value(
        "funding_transparency",
        round_to_precision(score, 1),
        round_to_precision(0.4 + (signals_available as f64 / 5.0) * 0.6, 2),
        format!("Funding transparency assessed from {signals_available} signals."),
        signals_available,
        5 - signals_available,
        provenance,
        if signals_available < 3 {
            "partial_data"
        } else {
            "data_available"
        },
    )
}

fn source_network_diversity(data: &WikiSourceCredibilityData, now: &str) -> Value {
    let gdelt = &data.gdelt;
    let mut scores = Vec::with_capacity(3);
    let mut provenance = Vec::with_capacity(3);
    if gdelt.distinct_actor_names > 0 {
        scores.push((
            (gdelt.distinct_actor_names as f64 / 50.0 * 100.0).min(100.0),
            0.40,
        ));
        provenance.push(provenance_entry("gdelt_actor_counts", "", now));
    }
    if gdelt.distinct_actor_countries > 0 {
        scores.push((
            (gdelt.distinct_actor_countries as f64 / 20.0 * 100.0).min(100.0),
            0.35,
        ));
        provenance.push(provenance_entry("gdelt_geographic_spread", "", now));
    }
    if gdelt.event_count > 0 {
        scores.push(((gdelt.event_count as f64 / 1000.0 * 100.0).min(100.0), 0.25));
        provenance.push(provenance_entry("gdelt_article_volume", "", now));
    }
    if scores.is_empty() {
        return empty_dimension("source_network_diversity");
    }
    let signals_available = scores.len();
    dimension_value(
        "source_network_diversity",
        round_to_precision(weighted_score(&scores), 1),
        round_to_precision(0.4 + (signals_available as f64 / 3.0) * 0.6, 2),
        format!("Network diversity from {signals_available} GDELT signals."),
        signals_available,
        3 - signals_available,
        provenance,
        if signals_available < 2 {
            "partial_data"
        } else {
            "data_available"
        },
    )
}

fn political_orientation(data: &WikiSourceCredibilityData, now: &str) -> Value {
    let mut scores = Vec::with_capacity(2);
    let mut provenance = Vec::with_capacity(2);
    if data
        .metadata
        .political_bias
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        scores.push((70.0, 0.40));
        provenance.push(provenance_entry("source_metadata_bias", "", now));
    }
    if data
        .organization
        .as_ref()
        .and_then(|organization| organization.media_bias_rating.as_deref())
        .is_some_and(|value| !value.is_empty())
    {
        scores.push((60.0, 0.40));
        let mut entry = provenance_entry("mbfc_bias_rating", "", now);
        entry["provenance_tag"] = json!("mbfc_dataset_v1");
        provenance.push(entry);
    }
    if scores.is_empty() {
        return empty_dimension("political_orientation_disclosure");
    }
    let signals_available = scores.len();
    dimension_value(
        "political_orientation_disclosure",
        round_to_precision(weighted_score(&scores), 1),
        round_to_precision(0.3 + (signals_available as f64 / 4.0) * 0.7, 2),
        format!("Political orientation assessed from {signals_available} signals."),
        signals_available,
        4 - signals_available,
        provenance,
        "partial_data",
    )
}

fn correction_record(data: &WikiSourceCredibilityData, now: &str) -> Value {
    let mut scores = Vec::with_capacity(2);
    let mut signals_available = 0;
    let mut provenance = Vec::new();
    if let Some((score, count, rows)) = analysis_score_signal(data, &CORRECTION_AXES, now) {
        scores.push((score, 0.55));
        signals_available += count;
        provenance.extend(rows);
    }
    let policy_signals = matching_policy_signals(
        data.metadata
            .research_sources
            .as_ref()
            .map(|value| &value.0),
        &CORRECTION_POLICY_IDS,
    );
    if !policy_signals.is_empty() {
        scores.push((85.0, 0.45));
        signals_available += 1;
        provenance.extend(policy_provenance(&policy_signals, now));
    }
    if scores.is_empty() {
        return empty_dimension("correction_record");
    }
    dimension_value(
        "correction_record",
        round_to_precision(weighted_score(&scores).min(100.0), 1),
        round_to_precision((signals_available as f64 / 2.0).min(1.0), 2),
        "Correction accountability assessed from published correction-policy or scored source-analysis evidence.".to_owned(),
        signals_available,
        3_usize.saturating_sub(signals_available),
        provenance,
        "data_available",
    )
}

fn methodology_transparency(data: &WikiSourceCredibilityData, now: &str) -> Value {
    let mut scores = Vec::with_capacity(2);
    let mut signals_available = 0;
    let mut provenance = Vec::new();
    if let Some((score, count, rows)) = analysis_score_signal(data, &METHODOLOGY_AXES, now) {
        scores.push((score, 0.45));
        signals_available += count;
        provenance.extend(rows);
    }
    let policy_signals = matching_policy_signals(
        data.metadata
            .research_sources
            .as_ref()
            .map(|value| &value.0),
        &METHODOLOGY_POLICY_IDS,
    );
    if !policy_signals.is_empty() {
        scores.push(((35.0 + policy_signals.len() as f64 * 12.5).min(100.0), 0.55));
        signals_available += policy_signals.len();
        provenance.extend(policy_provenance(&policy_signals, now));
    }
    if scores.is_empty() {
        return empty_dimension("methodology_transparency");
    }
    dimension_value(
        "methodology_transparency",
        round_to_precision(weighted_score(&scores).min(100.0), 1),
        round_to_precision((signals_available as f64 / 4.0).min(1.0), 2),
        "Methodology transparency assessed from editorial standards, sourcing, staff disclosure, and policy evidence.".to_owned(),
        signals_available,
        4_usize.saturating_sub(signals_available),
        provenance,
        "data_available",
    )
}

fn cross_verification_alignment(data: &WikiSourceCredibilityData, now: &str) -> Value {
    let gdelt = &data.gdelt;
    let (Some(source_avg_tone), Some(global_avg_tone)) =
        (gdelt.source_avg_tone, gdelt.global_avg_tone)
    else {
        return empty_dimension("cross_verification_alignment");
    };

    let global_stddev = gdelt
        .global_stddev_tone
        .filter(|value| *value != 0.0)
        .unwrap_or(1.0);
    let deviation = (source_avg_tone - global_avg_tone) / global_stddev.max(0.01);
    let sigma_abs = deviation.abs();
    let score = (100.0 - sigma_abs * 15.0).max(0.0).min(100.0);
    let mut signals_available = 1;
    let mut provenance = vec![provenance_entry("gdelt_tone_deviation_vs_global", "", now)];
    if gdelt.source_avg_goldstein.is_some() && gdelt.global_avg_goldstein.is_some() {
        signals_available += 1;
        provenance.push(provenance_entry("gdelt_goldstein_deviation", "", now));
    }
    dimension_value(
        "cross_verification_alignment",
        round_to_precision(score, 1),
        round_to_precision(0.5 + (signals_available as f64 / 2.0) * 0.5, 2),
        format!(
            "Cross-verification alignment: tone sigma={}",
            round_to_precision(deviation, 2)
        ),
        signals_available,
        2 - signals_available,
        provenance,
        if signals_available < 2 {
            "partial_data"
        } else {
            "data_available"
        },
    )
}

fn analysis_score_signal(
    data: &WikiSourceCredibilityData,
    axes: &[&str],
    now: &str,
) -> Option<(f64, usize, Vec<Value>)> {
    let score_row = data.analysis_scores.iter().find(|row| {
        row.source_name
            .eq_ignore_ascii_case(&data.metadata.source_name)
            && axes.iter().any(|axis| row.axis_name == *axis)
    })?;
    let mut provenance = Vec::new();
    if let Some(citations) = score_row
        .citations
        .as_ref()
        .map(|value| &value.0)
        .and_then(Value::as_array)
    {
        for citation in citations.iter().filter_map(Value::as_object) {
            let url = citation
                .get("url")
                .filter(|value| python_truthy(value))
                .map(python_string)
                .unwrap_or_default();
            provenance.push(provenance_entry("source_analysis_score", &url, now));
        }
    }
    if provenance.is_empty() {
        provenance.push(provenance_entry("source_analysis_score", "", now));
    }
    Some((score_row.score as f64 * 20.0, 1, provenance))
}

fn matching_policy_signals<'a>(
    research_sources: Option<&'a Value>,
    wanted_ids: &[&str],
) -> Vec<&'a Map<String, Value>> {
    research_sources
        .and_then(|value| value.get("policy_transparency"))
        .and_then(Value::as_object)
        .and_then(|policy| policy.get("signals"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter(|signal| {
            let id = signal
                .get("id")
                .filter(|value| python_truthy(value))
                .or_else(|| signal.get("signal").filter(|value| python_truthy(value)))
                .map(python_string)
                .unwrap_or_default();
            wanted_ids
                .iter()
                .any(|wanted| id.eq_ignore_ascii_case(wanted))
        })
        .collect()
}

fn policy_provenance(signals: &[&Map<String, Value>], now: &str) -> Vec<Value> {
    let mut provenance = Vec::new();
    for signal in signals {
        if let Some(urls) = signal.get("urls").filter(|value| python_truthy(value)) {
            if let Some(urls) = urls.as_array() {
                provenance.extend(
                    urls.iter()
                        .filter_map(Value::as_str)
                        .map(|url| provenance_entry("official_policy_page", url, now)),
                );
            }
        }
    }
    provenance
}

fn dimension_value(
    dimension: &str,
    score: f64,
    confidence: f64,
    explanation: String,
    signals_available: usize,
    signals_missing: usize,
    provenance: Vec<Value>,
    status: &str,
) -> Value {
    json!({
        "score": score,
        "confidence": confidence,
        "explanation": explanation,
        "signals_available": signals_available,
        "signals_missing": signals_missing,
        "provenance": provenance,
        "status": status,
        "dimension": dimension,
    })
}

fn provenance_entry(source: &str, url: &str, now: &str) -> Value {
    json!({"source": source, "url": url, "last_updated": now})
}

fn weighted_score(signals: &[(f64, f64)]) -> f64 {
    let mut weighted = 0.0;
    let mut weights = 0.0;
    for (score, weight) in signals {
        weighted += score * weight;
        weights += weight;
    }
    if weights == 0.0 {
        0.0
    } else {
        (weighted / weights).min(100.0)
    }
}

fn python_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn python_string(value: &Value) -> String {
    match value {
        Value::Null => "None".to_owned(),
        Value::Bool(true) => "True".to_owned(),
        Value::Bool(false) => "False".to_owned(),
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn round_to_precision(value: f64, decimal_places: u32) -> f64 {
    let scale = 10_f64.powi(decimal_places as i32);
    let scaled = value * scale;
    let lower = scaled.floor();
    let fraction = scaled - lower;
    let rounded = if fraction == 0.5 {
        if lower.rem_euclid(2.0) == 0.0 {
            lower
        } else {
            lower + 1.0
        }
    } else {
        scaled.round()
    };
    rounded / scale
}

// Match the Python ISO-8601 timestamp format without adding a chrono dependency.

fn utc_isoformat() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX);
    let days = seconds / 86_400;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:06}+00:00",
        elapsed.subsec_micros()
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let shifted_days = days_since_epoch + 719_468;
    let era = (if shifted_days >= 0 {
        shifted_days
    } else {
        shifted_days - 146_096
    }) / 146_097;
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{
        catalog_entries, civil_from_days, compute_profile, empty_profile, promotion_outcome,
        round_to_precision, source_slug,
    };
    use serde_json::{json, Value};
    use thesis_api::source_catalog::{
        SourceCatalogEntry, SourceCatalogIntegrationError, SourceUrlValue,
    };
    use thesis_db::{
        PersistedSourceCatalogRecord, WikiCredibilityOrganizationRecord, WikiGdeltCredibilityStats,
        WikiSourceAnalysisScoreRecord, WikiSourceCredibilityData,
        WikiSourceCredibilityMetadataRecord,
    };

    fn persisted_source(name: &str, url: &str, id: i64) -> PersistedSourceCatalogRecord {
        PersistedSourceCatalogRecord {
            id,
            name: name.to_owned(),
            url: url.to_owned(),
            category: "general".to_owned(),
            country: "GB".to_owned(),
            source_type: "newspaper".to_owned(),
            funding_type: "independent".to_owned(),
            bias_rating: "center".to_owned(),
            ownership_label: "public trust".to_owned(),
            factual_reporting: "high".to_owned(),
            is_paywalled: true,
        }
    }

    fn configured_source(name: &str) -> SourceCatalogEntry {
        let url = SourceUrlValue::String("https://configured.example/feed.xml".to_owned());
        SourceCatalogEntry {
            id: name.to_owned(),
            slug: name.to_owned(),
            name: name.to_owned(),
            url: url.clone(),
            rss_url: url,
            category: "general".to_owned(),
            country: String::new(),
            source_type: String::new(),
            is_paywalled: false,
            funding_type: String::new(),
            bias_rating: String::new(),
            ownership_label: String::new(),
        }
    }

    fn credibility_data() -> WikiSourceCredibilityData {
        WikiSourceCredibilityData {
            metadata: WikiSourceCredibilityMetadataRecord {
                source_name: "Example News".to_owned(),
                domain: Some("example.com".to_owned()),
                political_bias: Some("center".to_owned()),
                research_sources: Some(
                    json!({"policy_transparency": {"signals": [
                        {"id": "corrections_policy", "urls": ["https://example.com/corrections"]},
                        {"id": "editorial_independence", "urls": ["https://example.com/standards"]},
                        {"id": "ethics_or_standards", "urls": []}
                    ]}})
                    .into(),
                ),
            },
            organization: Some(WikiCredibilityOrganizationRecord {
                name: "Example News".to_owned(),
                funding_type: Some("public".to_owned()),
                parent_orgs: Some(json!(["Parent A", "Parent B"]).into()),
                ein: Some("12-3456789".to_owned()),
                funding_sources: Some(json!(["membership"]).into()),
                annual_revenue: Some("£1m".to_owned()),
                media_bias_rating: Some("Center".to_owned()),
            }),
            analysis_scores: vec![
                WikiSourceAnalysisScoreRecord {
                    source_name: "Example News".to_owned(),
                    axis_name: "correction_record".to_owned(),
                    score: 4,
                    confidence: None,
                    prose_explanation: None,
                    citations: Some(json!([{"url": "https://example.com/analysis"}]).into()),
                    empirical_basis: None,
                    scored_by: None,
                    last_scored_at: None,
                },
                WikiSourceAnalysisScoreRecord {
                    source_name: "Example News".to_owned(),
                    axis_name: "methodology_transparency".to_owned(),
                    score: 3,
                    confidence: None,
                    prose_explanation: None,
                    citations: None,
                    empirical_basis: None,
                    scored_by: None,
                    last_scored_at: None,
                },
            ],
            gdelt: WikiGdeltCredibilityStats {
                distinct_actor_names: 25,
                distinct_actor_countries: 10,
                event_count: 500,
                source_avg_tone: Some(0.0),
                global_avg_tone: Some(-1.0),
                global_stddev_tone: Some(2.0),
                source_avg_goldstein: Some(1.0),
                global_avg_goldstein: Some(2.0),
            },
        }
    }

    #[test]
    fn catalog_keeps_configured_order_and_appends_promotions() {
        let entries = catalog_entries(
            vec![
                configured_source("configured-first"),
                configured_source("configured-second"),
            ],
            vec![
                persisted_source("Promoted One", "https://one.example/feed", 9),
                persisted_source("Promoted Two", "https://two.example/feed", 10),
            ],
        );
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            [
                "configured-first",
                "configured-second",
                "Promoted One",
                "Promoted Two"
            ]
        );
        assert_eq!(entries[2].id, "promoted-one");
        assert_eq!(
            entries[2].url,
            SourceUrlValue::String("https://one.example/feed".to_owned())
        );
        assert_eq!(entries[2].rss_url, entries[2].url);
        assert_eq!(entries[2].ownership_label, "public trust");
    }

    #[test]
    fn promotion_conflict_preserves_the_exact_source_name() {
        assert_eq!(
            promotion_outcome("BBC News".to_owned(), false),
            Err(SourceCatalogIntegrationError::AlreadyExists(
                "BBC News".to_owned()
            ))
        );
        assert_eq!(promotion_outcome("bbc news".to_owned(), true), Ok(()));
    }

    #[test]
    fn slug_and_rounding_follow_python_catalog_rules() {
        assert_eq!(source_slug("BBC News - World"), "bbc-news---world");
        assert_eq!(round_to_precision(82.25, 1), 82.2);
        assert_eq!(round_to_precision(54.75, 1), 54.8);
    }

    #[test]
    fn missing_metadata_matches_the_python_empty_profile_shape() {
        let profile = empty_profile("missing.example", None);
        assert_eq!(profile["status"], "insufficient_data");
        assert_eq!(profile["data_quality"]["dimensions_total"], 6);
        assert_eq!(profile["data_quality"]["last_updated"], Value::Null);
        assert_eq!(
            profile["dimensions"]["correction_record"]["signals_missing"],
            6
        );
        assert_eq!(
            profile["dimensions"]["correction_record"]["score"],
            Value::Null
        );
    }

    #[test]
    fn credibility_profile_projects_all_six_python_dimensions() {
        let profile = compute_profile(
            "example.com",
            &credibility_data(),
            "2026-01-02T03:04:05.123456+00:00",
        );
        assert_eq!(profile["status"], "data_available");
        assert_eq!(profile["data_quality"]["dimensions_available"], 6);
        assert_eq!(profile["data_quality"]["completeness_pct"], 100.0);
        assert_eq!(profile["dimensions"]["funding_transparency"]["score"], 54.8);
        assert_eq!(
            profile["dimensions"]["source_network_diversity"]["score"],
            50.0
        );
        assert_eq!(
            profile["dimensions"]["political_orientation_disclosure"]["score"],
            65.0
        );
        assert_eq!(
            profile["dimensions"]["political_orientation_disclosure"]["provenance"][1]
                ["provenance_tag"],
            "mbfc_dataset_v1"
        );
        assert_eq!(profile["dimensions"]["correction_record"]["score"], 82.2);
        assert_eq!(
            profile["dimensions"]["correction_record"]["signals_available"],
            2
        );
        assert_eq!(
            profile["dimensions"]["methodology_transparency"]["score"],
            60.0
        );
        assert_eq!(
            profile["dimensions"]["cross_verification_alignment"]["score"],
            92.5
        );
        assert_eq!(
            profile["dimensions"]["cross_verification_alignment"]["signals_available"],
            2
        );
        assert_eq!(
            profile["dimensions"]["correction_record"]["provenance"][1]["url"],
            "https://example.com/corrections"
        );
        assert_eq!(
            profile["dimensions"]["methodology_transparency"]["provenance"][0]["source"],
            "source_analysis_score"
        );
    }

    #[test]
    fn utc_calendar_conversion_matches_known_epoch_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_454), (2026, 1, 1));
    }
}
