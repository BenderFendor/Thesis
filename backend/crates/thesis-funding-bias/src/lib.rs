use std::collections::HashSet;
use std::error::Error;

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value;
use thesis_db::{sha256_hex, CalculationTraceWrite, Database, FundingBiasCatalogOutlet};
use thesis_search::entity_id::stable_source_id;
use thesis_search::funding_bias::{build_contingency_table, cramers_v};

/// The checked-in RSS catalog, baked into the binary at compile time.
///
/// `include_str!` means catalog edits (`app/data/rss_sources.json`) only
/// take effect after rebuilding `thesis-funding-bias`; unlike the Python
/// runner (`app.services.funding_bias_analysis`, which reads the catalog
/// module at import time but from the same checked-out working tree),
/// this Rust runner has no way to pick up an edited file without a
/// recompile, including in a deployed binary.
const CATALOG_JSON: &str = include_str!("../../../app/data/rss_sources.json");
const METHOD_VERSION: &str = "funding_bias_analysis/2.0";
const MEASUREMENT_NAME: &str = "funding_bias_association";
const PREREGISTRATION_ID: &str = "prereg_funding_bias_methodology_v2";
const PREREGISTRATION_TITLE: &str = "Catalog funding-type vs. MBFC bias-rating association (Rust)";

#[derive(Clone, Debug)]
struct CatalogOutlet {
    name: String,
    funding_type: Option<String>,
    bias_rating: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FundingBiasRunSummary {
    pub preregistration_id: String,
    pub trace_id: String,
    pub population_size: usize,
    pub n: u64,
    pub rows: usize,
    pub cols: usize,
    pub chi_square: Option<f64>,
    pub degrees_of_freedom: Option<usize>,
    pub cramers_v: Option<f64>,
    pub interpretation: Option<String>,
}

fn catalog_sources() -> Result<Vec<CatalogOutlet>, Box<dyn Error>> {
    // IndexMap (not serde_json::Map, which is a BTreeMap without the
    // "preserve_order" feature) keeps the catalog's on-disk order, so the
    // first source name for a set of "Name - Edition" duplicates is
    // whichever one appears first in the file, matching Python's dict
    // insertion-order iteration -- without enabling serde_json's
    // "preserve_order" feature, which Cargo feature unification would
    // otherwise spread to every crate in the workspace.
    let object: IndexMap<String, Value> = serde_json::from_str(CATALOG_JSON)?;
    let mut seen = HashSet::new();
    let mut outlets = Vec::new();
    for (raw_name, config) in &object {
        if !has_valid_feed(config) {
            continue;
        }
        let name = raw_name
            .split_once(" - ")
            .map_or(raw_name.as_str(), |(prefix, _)| prefix)
            .trim()
            .to_owned();
        if !seen.insert(name.clone()) {
            continue;
        }
        let fields = config.as_object();
        outlets.push(CatalogOutlet {
            name,
            funding_type: fields
                .and_then(|fields| fields.get("funding_type"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            bias_rating: fields
                .and_then(|fields| fields.get("bias_rating"))
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    Ok(outlets)
}

fn has_valid_feed(config: &Value) -> bool {
    match config.as_object().and_then(|fields| fields.get("url")) {
        Some(Value::String(url)) => !url.trim().is_empty(),
        Some(Value::Array(urls)) => urls
            .iter()
            .any(|url| url.as_str().is_some_and(|url| !url.trim().is_empty())),
        _ => false,
    }
}

fn methodology_specification() -> Value {
    serde_json::json!({
        "population": "Every outlet in the local RSS catalog (app.data.rss_sources) that has both a known funding_type and a known bias_rating. Each value independently prefers an accepted evidence-spine claim (predicate funding_type / bias_rating) over the legacy SourceMetadata/rss_sources.py fallback value shown elsewhere in the Atlas. Outlets missing either value are excluded, never imputed.",
        "measure": "A funding_type x bias_rating contingency table over the population, plus Cramer's V computed from its Pearson chi-square statistic: V = sqrt(chi2 / (n * (min(rows, cols) - 1))); chi2 = sum((observed - expected)^2 / expected) over every cell, expected[i][j] = row_total[i] * col_total[j] / n. Implemented in Rust by the thesis-search crate with f64 standard library operations; no scipy dependency.",
        "predicates_consulted": ["funding_type", "bias_rating"],
        "algorithm_version": METHOD_VERSION,
        "limitations": [
            "MBFC bias ratings are a single rated source's own editorial judgment, not a ground-truth label for 'true' bias -- this measures agreement with MBFC's categorization, not reality.",
            "The population is this project's curated RSS catalog, not a representative or random sample of all media outlets.",
            "Funding-type categories (public/commercial/non-profit/state-funded/independent) were largely hand-classified in the legacy catalog, not sourced from one consistent registry.",
            "An association statistic, even a large Cramer's V, shows correlation, not that funding causes a given bias rating -- confounds like country, language, and outlet size are not controlled for.",
            "Chi-square and Cramer's V are unreliable when any expected cell count is below roughly 5; small categories should be read with that caveat, not merged after the fact to inflate the statistic.",
            "Cramer's V is a biased estimator at small n (it tends to overstate association); no small-sample bias correction (e.g. Bergsma 2013) is applied here."
        ],
        "interpretation_bands": {
            "0.0-0.1": "negligible association",
            "0.1-0.2": "weak association",
            "0.2-0.4": "moderate association",
            "0.4-0.6": "relatively strong association",
            "0.6-1.0": "strong association"
        }
    })
}

fn canonical_json_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{0008}' => output.push_str("\\b"),
            '\u{000c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{001f}' => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character if character.is_ascii() => output.push(character),
            character if (character as u32) <= 0xffff => {
                output.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => {
                let scalar = character as u32 - 0x1_0000;
                let high = 0xd800 + (scalar >> 10);
                let low = 0xdc00 + (scalar & 0x3ff);
                output.push_str(&format!("\\u{high:04x}\\u{low:04x}"));
            }
        }
    }
    output.push('"');
    output
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => canonical_json_string(value),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        canonical_json_string(key),
                        canonical_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn interpretation(value: Option<f64>) -> Option<String> {
    let value = value?;
    Some(
        if value < 0.1 {
            "negligible association"
        } else if value < 0.2 {
            "weak association"
        } else if value < 0.4 {
            "moderate association"
        } else if value < 0.6 {
            "relatively strong association"
        } else {
            "strong association"
        }
        .to_owned(),
    )
}

fn round_six(value: Option<f64>) -> Option<f64> {
    value.map(|value| (value * 1_000_000.0).round_ties_even() / 1_000_000.0)
}

pub async fn run(database: &Database) -> Result<FundingBiasRunSummary, Box<dyn Error>> {
    let specification = methodology_specification();
    let specification_hash = sha256_hex(canonical_json(&specification).as_bytes());
    database
        .ensure_funding_bias_preregistration(
            PREREGISTRATION_ID,
            PREREGISTRATION_TITLE,
            &specification_hash,
            specification,
        )
        .await?;

    let catalog = catalog_sources()?
        .into_iter()
        .map(|outlet| FundingBiasCatalogOutlet {
            outlet_id: stable_source_id(&outlet.name),
            name: outlet.name,
            catalog_funding_type: outlet.funding_type,
            catalog_bias_rating: outlet.bias_rating,
        })
        .collect::<Vec<_>>();
    let population = database.funding_bias_population(&catalog).await?;
    let pairs = population
        .iter()
        .map(|sample| (sample.funding_type.clone(), sample.bias_rating.clone()))
        .collect::<Vec<_>>();
    let (rows, cols, table) = build_contingency_table(&pairs);
    let statistic = cramers_v(&table)?;
    let chi_square = round_six(statistic.chi_square);
    let cramers_v = round_six(statistic.cramers_v);
    let association_label = interpretation(cramers_v);

    let mut fingerprint = population
        .iter()
        .map(|sample| {
            (
                sample.name.clone(),
                sample.funding_type.clone(),
                sample.bias_rating.clone(),
            )
        })
        .collect::<Vec<_>>();
    fingerprint.sort();
    let fingerprint = Value::Array(
        fingerprint
            .into_iter()
            .map(|(name, funding_type, bias_rating)| {
                Value::Array(vec![
                    Value::String(name),
                    Value::String(funding_type),
                    Value::String(bias_rating),
                ])
            })
            .collect(),
    );
    let identity = Value::Array(vec![
        Value::String(MEASUREMENT_NAME.to_owned()),
        Value::String(PREREGISTRATION_ID.to_owned()),
        Value::String(METHOD_VERSION.to_owned()),
        fingerprint,
    ]);
    let trace_digest = sha256_hex(canonical_json(&identity).as_bytes());
    let trace_id = format!("calc_{}", &trace_digest[..32]);
    let mut claim_ids = population
        .iter()
        .flat_map(|sample| sample.claim_ids.iter().cloned())
        .collect::<Vec<_>>();
    claim_ids.sort();
    claim_ids.dedup();
    let result = serde_json::json!({
        "n": statistic.n,
        "table": table,
        "chi_square": chi_square,
        "degrees_of_freedom": statistic.degrees_of_freedom,
        "cramers_v": cramers_v,
        "interpretation": association_label,
        "note": statistic.note,
    });
    let subgraph = serde_json::json!({
        "preregistration_id": PREREGISTRATION_ID,
        "population_outlets": population.iter().map(|sample| sample.name.clone()).collect::<Vec<_>>(),
        "rows": rows,
        "cols": cols,
    });
    let mut traces = database
        .persist_calculation_traces(vec![CalculationTraceWrite {
            id: trace_id,
            measurement_name: MEASUREMENT_NAME.to_owned(),
            input_claim_ids: claim_ids,
            subgraph,
            algorithm_version: METHOD_VERSION.to_owned(),
            result,
        }])
        .await?;
    let trace = traces
        .pop()
        .ok_or("calculation trace insert did not return a trace")?;

    Ok(FundingBiasRunSummary {
        preregistration_id: PREREGISTRATION_ID.to_owned(),
        trace_id: trace.id,
        population_size: population.len(),
        n: statistic.n,
        rows: statistic.rows,
        cols: statistic.cols,
        chi_square,
        degrees_of_freedom: statistic.degrees_of_freedom,
        cramers_v,
        interpretation: association_label,
    })
}

#[cfg(test)]
mod tests {
    use super::{canonical_json, catalog_sources, interpretation, round_six};
    use serde_json::json;
    use thesis_search::entity_id::stable_source_id;

    #[test]
    fn catalog_deduplicates_editions_by_the_first_source_name() {
        let sources = catalog_sources().expect("checked-in catalog is valid JSON");
        assert!(sources.iter().any(|source| source.name == "BBC"));
        assert_eq!(
            sources.iter().filter(|source| source.name == "BBC").count(),
            1
        );
        assert_eq!(sources[0].name, "BBC");
    }

    // normalize_entity_label/stable_source_id moved to
    // thesis_search::entity_id (shared with thesis-api); their Unicode
    // parity tests now live there.
    #[test]
    fn outlet_id_uses_normalized_sha1_prefix() {
        assert_eq!(stable_source_id("BBC"), "outlet:0fbe2a58568b");
    }

    #[test]
    fn canonical_json_sorts_object_keys_and_escapes_non_ascii() {
        let value = json!({"z": "é", "a": ["x"]});
        assert_eq!(canonical_json(&value), r#"{"a":["x"],"z":"\u00e9"}"#);
    }

    #[test]
    fn six_decimal_rounding_precedes_interpretation_bands() {
        let rounded = round_six(Some(0.099_999_8));
        assert_eq!(rounded, Some(0.1));
        assert_eq!(interpretation(rounded).as_deref(), Some("weak association"));
    }
}
