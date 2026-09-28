use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{NaiveDate, NaiveDateTime, Timelike};
use serde_json::{json, Map, Value};
use thesis_db::{
    sha256_hex, AtlasMediaMeasurementData, CalculationTraceRecord, CalculationTraceWrite,
};

use crate::models::HttpValidationError;
use crate::{wiki, AppState};

use super::{
    AtlasMeasurementResponse, AtlasMeasurementsResponse, AtlasMediaMeasurementQueryParameters,
};

const METHOD_VERSION: &str = "media_measurements/1.0";
const CORRECTION_MARKERS: [&str; 4] =
    ["correction:", "corrected:", "editor's note:", "retraction:"];
const SYNDICATION_MARKERS: [&str; 3] = [
    "reuters",
    "associated press",
    " republished with permission",
];
const MEASUREMENT_NAMES: [&str; 6] = [
    "publication_cadence",
    "corrections_retractions",
    "byline_coauthor_network",
    "original_vs_syndicated",
    "reporter_movement",
    "ownership_concentration",
];

#[derive(Clone, Debug)]
struct MediaArticle {
    id: i64,
    title: String,
    source: String,
    content: Option<String>,
    published_at: NaiveDateTime,
    author: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Clone, Debug)]
struct MediaArticleAuthor {
    article_id: i64,
    reporter_name: String,
}

#[derive(Clone, Debug)]
struct MediaOwnershipRelationship {
    id: String,
    object_entity_id: String,
}

#[derive(Clone, Debug)]
struct MediaOwnerEntity {
    id: String,
    canonical_name: String,
}

#[derive(Clone, Debug)]
struct MediaMeasurementInput {
    articles: Vec<MediaArticle>,
    article_authors: Vec<MediaArticleAuthor>,
    ownership_relationships: Vec<MediaOwnershipRelationship>,
    owner_entities: Vec<MediaOwnerEntity>,
}

impl From<AtlasMediaMeasurementData> for MediaMeasurementInput {
    fn from(data: AtlasMediaMeasurementData) -> Self {
        Self {
            articles: data
                .articles
                .into_iter()
                .map(|row| MediaArticle {
                    id: row.id,
                    title: row.title,
                    source: row.source,
                    content: row.content,
                    published_at: row.published_at,
                    author: row.author,
                    tags: row.tags,
                })
                .collect(),
            article_authors: data
                .article_authors
                .into_iter()
                .map(|row| MediaArticleAuthor {
                    article_id: row.article_id,
                    reporter_name: row.reporter_name,
                })
                .collect(),
            ownership_relationships: data
                .ownership_relationships
                .into_iter()
                .map(|row| MediaOwnershipRelationship {
                    id: row.id,
                    object_entity_id: row.object_entity_id,
                })
                .collect(),
            owner_entities: data
                .owner_entities
                .into_iter()
                .map(|row| MediaOwnerEntity {
                    id: row.id,
                    canonical_name: row.canonical_name,
                })
                .collect(),
        }
    }
}

fn datetime_iso(value: NaiveDateTime) -> String {
    let whole_seconds = value.format("%Y-%m-%dT%H:%M:%S").to_string();
    let microseconds = value.nanosecond() / 1_000;
    if microseconds == 0 {
        whole_seconds
    } else {
        format!("{whole_seconds}.{microseconds:06}")
    }
}

fn corpus_window(articles: &[MediaArticle]) -> Value {
    json!({
        "start": articles.first().map(|article| datetime_iso(article.published_at)),
        "end": articles.last().map(|article| datetime_iso(article.published_at)),
    })
}

fn python_json_string(value: &str, output: &mut String) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{20}'..='\u{7e}' => output.push(character),
            '\u{00}'..='\u{1f}' | '\u{7f}'..='\u{ffff}' => {
                write!(output, "\\u{:04x}", character as u32).expect("String write cannot fail");
            }
            _ => {
                let codepoint = character as u32 - 0x1_0000;
                let high = 0xd800 + (codepoint >> 10);
                let low = 0xdc00 + (codepoint & 0x3ff);
                write!(output, "\\u{high:04x}\\u{low:04x}").expect("String write cannot fail");
            }
        }
    }
    output.push('"');
}

fn python_canonical_json(value: &Value, output: &mut String) {
    python_canonical_json_inner(value, output, false);
}

fn python_canonical_json_inner(value: &Value, output: &mut String, numeric_object_keys: bool) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(true) => output.push_str("true"),
        Value::Bool(false) => output.push_str("false"),
        Value::Number(number) => output.push_str(&number.to_string()),
        Value::String(value) => python_json_string(value, output),
        Value::Array(values) => {
            output.push('[');
            for (index, item) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                python_canonical_json_inner(item, output, false);
            }
            output.push(']');
        }
        Value::Object(values) => {
            output.push('{');
            let mut keys = values.keys().collect::<Vec<_>>();
            if numeric_object_keys {
                keys.sort_by_key(|key| key.parse::<i64>().expect("numeric JSON object key"));
            } else {
                keys.sort_unstable();
            }
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                python_json_string(key, output);
                output.push(':');
                python_canonical_json_inner(&values[key], output, key == "article_authors");
            }
            output.push('}');
        }
    }
}

fn trace_id(name: &str, result: &Value, subgraph: &Value) -> String {
    let mut canonical = String::new();
    python_json_string(name, &mut canonical);
    canonical.push('\u{1f}');
    python_canonical_json(result, &mut canonical);
    canonical.push('\u{1f}');
    python_canonical_json(subgraph, &mut canonical);
    canonical.push('\u{1f}');
    canonical.push_str("[]");

    let digest = sha256_hex(canonical.as_bytes());
    format!("calc_{}", &digest[..32])
}

fn trace_write(
    name: &str,
    window: &Value,
    denominator: usize,
    coverage_numerator: usize,
    measurement_result: Value,
    subgraph: Value,
) -> CalculationTraceWrite {
    let mut result = Map::from_iter([
        ("corpus_window".to_owned(), window.clone()),
        ("denominator".to_owned(), Value::from(denominator as i64)),
        (
            "coverage".to_owned(),
            json!({
                "numerator": coverage_numerator,
                "denominator": denominator,
            }),
        ),
        (
            "method_version".to_owned(),
            Value::String(METHOD_VERSION.to_owned()),
        ),
    ]);
    if let Value::Object(fields) = measurement_result {
        result.extend(fields);
    }
    let result = Value::Object(result);
    CalculationTraceWrite {
        id: trace_id(name, &result, &subgraph),
        measurement_name: name.to_owned(),
        input_claim_ids: Vec::new(),
        subgraph,
        algorithm_version: METHOD_VERSION.to_owned(),
        result,
    }
}

fn calculate_publication_cadence_write(
    articles: &[MediaArticle],
    source_name: Option<&str>,
    window: &Value,
) -> CalculationTraceWrite {
    let article_count = articles.len();
    let active_days = articles
        .iter()
        .map(|article| article.published_at.date())
        .collect::<BTreeSet<NaiveDate>>()
        .len();
    let span_days = articles
        .first()
        .zip(articles.last())
        .map(|(first, last)| {
            (last.published_at - first.published_at)
                .num_days()
                .saturating_add(1)
                .max(1)
        })
        .unwrap_or(0);
    let articles_per_day =
        (span_days > 0).then(|| format!("{:.6}", article_count as f64 / span_days as f64));
    let article_ids = articles
        .iter()
        .map(|article| article.id)
        .collect::<Vec<_>>();

    trace_write(
        MEASUREMENT_NAMES[0],
        window,
        article_count,
        article_count,
        json!({
            "article_count": article_count,
            "active_days": active_days,
            "span_days": span_days,
            "articles_per_day": articles_per_day,
        }),
        json!({
            "source_name": source_name,
            "article_ids": article_ids,
        }),
    )
}

fn calculate_corrections_retractions_write(
    articles: &[MediaArticle],
    window: &Value,
) -> CalculationTraceWrite {
    let mut corrected_ids = Vec::new();
    let mut retracted_ids = Vec::new();
    for article in articles {
        let searchable = format!(
            "{}\n{}",
            article.title,
            article.content.as_deref().unwrap_or("")
        )
        .to_lowercase();
        if CORRECTION_MARKERS
            .iter()
            .any(|marker| searchable.contains(marker))
        {
            corrected_ids.push(article.id);
        }
        if searchable.contains("retraction:") || searchable.contains("retracted") {
            retracted_ids.push(article.id);
        }
    }
    trace_write(
        MEASUREMENT_NAMES[1],
        window,
        articles.len(),
        articles
            .iter()
            .filter(|article| article.content.is_some())
            .count(),
        json!({
            "correction_count": corrected_ids.len(),
            "retraction_count": retracted_ids.len(),
        }),
        json!({
            "corrected_article_ids": corrected_ids,
            "retracted_article_ids": retracted_ids,
        }),
    )
}

fn calculate_byline_coauthor_write(
    articles: &[MediaArticle],
    article_authors: &[MediaArticleAuthor],
    window: &Value,
) -> CalculationTraceWrite {
    let mut by_article = BTreeMap::<i64, Vec<&str>>::new();
    for row in article_authors {
        by_article
            .entry(row.article_id)
            .or_default()
            .push(row.reporter_name.as_str());
    }
    let unique_reporter_count = by_article
        .values()
        .flat_map(|names| names.iter().copied())
        .collect::<BTreeSet<_>>()
        .len();
    let mut coauthor_pairs = BTreeMap::<(&str, &str), usize>::new();
    let mut coauthor_names = Vec::<&str>::new();
    for names in by_article.values() {
        coauthor_names.clear();
        coauthor_names.extend(names.iter().copied());
        coauthor_names.sort_unstable();
        coauthor_names.dedup();
        for left_index in 0..coauthor_names.len() {
            let reporter_a = coauthor_names[left_index];
            for reporter_b in coauthor_names.iter().skip(left_index + 1) {
                *coauthor_pairs.entry((reporter_a, *reporter_b)).or_default() += 1;
            }
        }
    }
    let byline_coverage = by_article.len();
    let measurement_result = json!({
        "unique_reporters": unique_reporter_count,
        "coauthor_edges": coauthor_pairs
            .iter()
            .map(|((reporter_a, reporter_b), article_count)| json!({
                "reporter_a": reporter_a,
                "reporter_b": reporter_b,
                "article_count": article_count,
            }))
            .collect::<Vec<_>>(),
    });
    let subgraph = json!({ "article_authors": by_article });
    trace_write(
        MEASUREMENT_NAMES[2],
        window,
        articles.len(),
        byline_coverage,
        measurement_result,
        subgraph,
    )
}

fn calculate_syndication_write(articles: &[MediaArticle], window: &Value) -> CalculationTraceWrite {
    let mut syndicated_ids = Vec::new();
    let mut coverage_numerator = 0;
    for article in articles {
        let author = article
            .author
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        let has_tags = article.tags.as_ref().is_some_and(|tags| !tags.is_empty());
        let tags = article.tags.as_deref().unwrap_or_default().join(" ");
        let content = article
            .content
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        let searchable = format!("{author} {tags} {content}").to_lowercase();
        if SYNDICATION_MARKERS
            .iter()
            .any(|marker| searchable.contains(marker))
        {
            syndicated_ids.push(article.id);
        }
        if !author.is_empty() || has_tags || !content.is_empty() {
            coverage_numerator += 1;
        }
    }
    trace_write(
        MEASUREMENT_NAMES[3],
        window,
        articles.len(),
        coverage_numerator,
        json!({
            "syndicated_count": syndicated_ids.len(),
            "original_or_unmarked_count": articles.len() - syndicated_ids.len(),
        }),
        json!({
            "syndicated_article_ids": syndicated_ids,
            "classification": "explicit_marker_only",
        }),
    )
}

fn calculate_reporter_movement_write(
    article_authors: &[MediaArticleAuthor],
    article_by_id: &HashMap<i64, &MediaArticle>,
    window: &Value,
) -> CalculationTraceWrite {
    let mut reporter_names = Vec::new();
    let mut reporter_events = HashMap::<String, Vec<(NaiveDateTime, String)>>::new();
    for row in article_authors {
        let Some(article) = article_by_id.get(&row.article_id) else {
            continue;
        };
        let events = reporter_events
            .entry(row.reporter_name.clone())
            .or_default();
        if events.is_empty() {
            reporter_names.push(row.reporter_name.clone());
        }
        events.push((article.published_at, article.source.clone()));
    }
    let mut movements = Vec::new();
    let mut reporter_sources = Map::new();
    for reporter_name in &reporter_names {
        let events = reporter_events
            .get_mut(reporter_name)
            .expect("reporter name has events");
        reporter_sources.insert(
            reporter_name.clone(),
            Value::Array(
                events
                    .iter()
                    .map(|(date, source)| json!([datetime_iso(*date), source]))
                    .collect(),
            ),
        );
        events.sort_by(|left, right| left.cmp(right));
        let mut previous_source: Option<&str> = None;
        for (event_date, source) in events {
            if previous_source.is_some_and(|previous| previous != source) {
                movements.push(json!({
                    "reporter": reporter_name,
                    "from": previous_source,
                    "to": source,
                    "observed_at": datetime_iso(*event_date),
                }));
            }
            previous_source = Some(source);
        }
    }
    let movement_count = movements.len();
    trace_write(
        MEASUREMENT_NAMES[4],
        window,
        reporter_events.len(),
        reporter_events.len(),
        json!({
            "observed_movements": movements,
            "movement_count": movement_count,
        }),
        json!({ "reporter_sources": reporter_sources }),
    )
}

fn calculate_ownership_concentration_write(
    relationships: &[MediaOwnershipRelationship],
    owner_entities: &[MediaOwnerEntity],
) -> CalculationTraceWrite {
    let mut ownership_counts = HashMap::<&str, usize>::new();
    let mut owner_order = Vec::new();
    let mut relationship_ids = Vec::with_capacity(relationships.len());
    for relationship in relationships {
        relationship_ids.push(relationship.id.clone());
        let owner_id = relationship.object_entity_id.as_str();
        match ownership_counts.entry(owner_id) {
            std::collections::hash_map::Entry::Occupied(mut entry) => *entry.get_mut() += 1,
            std::collections::hash_map::Entry::Vacant(entry) => {
                owner_order.push(owner_id);
                entry.insert(1);
            }
        }
    }
    let total_relationships = relationships.len();
    let concentration = (total_relationships > 0).then(|| {
        owner_order
            .iter()
            .map(|owner_id| {
                let share = ownership_counts[owner_id] as f64 / total_relationships as f64;
                share * share
            })
            .sum::<f64>()
    });
    let owner_names = owner_entities
        .iter()
        .map(|owner| (owner.id.as_str(), owner.canonical_name.as_str()))
        .collect::<HashMap<_, _>>();
    let mut owners = owner_order
        .iter()
        .map(|owner_id| {
            (
                *owner_id,
                owner_names.get(owner_id).copied().unwrap_or(*owner_id),
                ownership_counts[owner_id],
            )
        })
        .collect::<Vec<_>>();
    owners.sort_by(|left, right| right.2.cmp(&left.2));
    trace_write(
        MEASUREMENT_NAMES[5],
        &json!({"start": null, "end": null}),
        total_relationships,
        total_relationships,
        json!({
            "herfindahl_hirschman_index": concentration.map(|value| format!("{value:.6}")),
            "owners": owners
                .iter()
                .map(|(entity_id, name, count)| json!({
                    "entity_id": entity_id,
                    "name": name,
                    "current_relationships": count,
                }))
                .collect::<Vec<_>>(),
        }),
        json!({ "relationship_ids": relationship_ids }),
    )
}

fn calculate_measurement_writes(
    input: MediaMeasurementInput,
    source_name: Option<&str>,
) -> Vec<CalculationTraceWrite> {
    let window = corpus_window(&input.articles);
    let article_by_id = input
        .articles
        .iter()
        .map(|article| (article.id, article))
        .collect::<HashMap<_, _>>();
    vec![
        calculate_publication_cadence_write(&input.articles, source_name, &window),
        calculate_corrections_retractions_write(&input.articles, &window),
        calculate_byline_coauthor_write(&input.articles, &input.article_authors, &window),
        calculate_syndication_write(&input.articles, &window),
        calculate_reporter_movement_write(&input.article_authors, &article_by_id, &window),
        calculate_ownership_concentration_write(
            &input.ownership_relationships,
            &input.owner_entities,
        ),
    ]
}

fn response_from_records(
    source_name: Option<String>,
    records: Vec<CalculationTraceRecord>,
) -> Result<AtlasMeasurementsResponse, ()> {
    if records.len() != MEASUREMENT_NAMES.len() {
        return Err(());
    }
    let mut records_by_name = records
        .into_iter()
        .map(|record| (record.measurement_name.clone(), record))
        .collect::<HashMap<_, _>>();
    let mut measurements = Vec::with_capacity(MEASUREMENT_NAMES.len());
    for measurement_name in MEASUREMENT_NAMES {
        let Some(record) = records_by_name.remove(measurement_name) else {
            return Err(());
        };
        measurements.push(AtlasMeasurementResponse {
            id: record.id,
            measurement_name: record.measurement_name,
            algorithm_version: record.algorithm_version,
            result: record.result.0,
            created_at: record.created_at,
        });
    }
    if !records_by_name.is_empty() {
        return Err(());
    }
    Ok(AtlasMeasurementsResponse {
        source_name,
        measurements,
    })
}

#[utoipa::path(
    get,
    path = "/api/wiki/atlas/analysis/media-measurements",
    operation_id = "get_media_measurements_api_wiki_atlas_analysis_media_measurements_get",
    params(AtlasMediaMeasurementQueryParameters),
    responses(
        (status = 200, description = "Successful Response", body = AtlasMeasurementsResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    ),
    tag = "wiki-atlas",
    summary = "Get Media Measurements",
    description = "Calculate and persist six reproducible, versioned Atlas media measurements. An empty source_name is echoed but does not scope articles."
)]
pub(crate) async fn get_media_measurements(State(state): State<AppState>, uri: Uri) -> Response {
    let values = match wiki::query_values(&uri) {
        Ok(values) => values,
        Err(error) => return error.into_response(),
    };
    let source_name = match super::query_source_name(&values) {
        Ok(source_name) => source_name,
        Err(error) => return error.into_response(),
    };
    let data = match state
        .database
        .load_atlas_media_measurement_data(source_name.as_deref())
        .await
    {
        Ok(data) => data,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let writes = calculate_measurement_writes(data.into(), source_name.as_deref());
    let records = match state.database.persist_calculation_traces(writes).await {
        Ok(records) => records,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match response_from_records(source_name, records) {
        Ok(response) => Json(response).into_response(),
        Err(()) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
#[path = "media_measurements_tests.rs"]
mod tests;
