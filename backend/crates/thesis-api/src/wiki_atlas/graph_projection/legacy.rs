use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use chrono::NaiveDateTime;
use serde_json::{json, Value};
use thesis_db::AtlasProjectionData;

use super::super::super::{
    AtlasConfidenceTier, AtlasEdgeResponse, AtlasEntityType, AtlasEvidenceRefResponse,
    AtlasGraphFiltersInput, AtlasNodeResponse, AtlasRelationType,
};
use super::super::GraphData;
use super::super::{casefold, confidence_tier, edge_id, normalize_entity_label, stable_source_id};
use super::shared::{
    canonical_entity_id, edge_base, entities, json_truthy, live_entities, outlet_node_ids,
    survivor_map, Entity, LEGACY_ORGANIZATION_KINDS, LEGACY_PUBLICATION_KINDS,
};

static RSS_CATALOG: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../../../app/data/rss_sources.json"))
        .expect("checked-in RSS catalog must be valid JSON")
});

#[derive(Clone, Debug)]
struct CatalogSource<'a> {
    name: String,
    config: Option<&'a Value>,
}

#[derive(Clone, Copy)]
struct SourceMetadata<'a> {
    source_type: Option<&'a str>,
    country: Option<&'a str>,
    funding_type: Option<&'a str>,
    political_bias: Option<&'a str>,
    factual_rating: Option<&'a str>,
    credibility_score: Option<f64>,
    research_confidence: Option<&'a str>,
    updated_at: Option<NaiveDateTime>,
}

#[derive(Clone, Copy)]
struct IndexStatus<'a> {
    status: Option<&'a str>,
    last_indexed_at: Option<NaiveDateTime>,
}

struct Lookups<'a> {
    metadata_by_source: HashMap<String, SourceMetadata<'a>>,
    index_by_key: HashMap<(String, String), IndexStatus<'a>>,
    article_counts: HashMap<String, i64>,
    scores_by_source: HashMap<String, BTreeMap<String, i32>>,
}

impl<'a> Lookups<'a> {
    fn from_projection(data: &'a AtlasProjectionData) -> Self {
        let mut lookups = Self {
            metadata_by_source: HashMap::new(),
            index_by_key: HashMap::new(),
            article_counts: HashMap::new(),
            scores_by_source: HashMap::new(),
        };
        for row in &data.source_metadata {
            lookups.metadata_by_source.insert(
                normalize_entity_label(&row.source_name),
                SourceMetadata {
                    source_type: row.source_type.as_deref(),
                    country: row.country.as_deref(),
                    funding_type: row.funding_type.as_deref(),
                    political_bias: row.political_bias.as_deref(),
                    factual_rating: row.factual_rating.as_deref(),
                    credibility_score: row.credibility_score,
                    research_confidence: row.research_confidence.as_deref(),
                    updated_at: row.updated_at,
                },
            );
        }
        for row in &data.wiki_index_statuses {
            lookups.index_by_key.insert(
                (
                    row.entity_type.clone(),
                    normalize_entity_label(&row.entity_name),
                ),
                IndexStatus {
                    status: row.status.as_deref(),
                    last_indexed_at: row.last_indexed_at,
                },
            );
        }
        for row in &data.article_counts {
            lookups.article_counts.insert(row.source.clone(), row.count);
        }
        for row in &data.source_analysis_scores {
            lookups
                .scores_by_source
                .entry(normalize_entity_label(&row.source_name))
                .or_default()
                .insert(row.axis_name.clone(), row.score);
        }
        lookups
    }

    fn metadata(&self, name: &str) -> Option<&SourceMetadata<'a>> {
        self.metadata_by_source.get(&normalize_entity_label(name))
    }

    fn index(&self, entity_type: &str, name: &str) -> Option<&IndexStatus<'a>> {
        self.index_by_key
            .get(&(entity_type.to_owned(), normalize_entity_label(name)))
    }
}

#[derive(Clone, Copy)]
struct Reporter<'a> {
    id: i64,
    name: &'a str,
    canonical_name: Option<&'a str>,
    article_count: Option<i32>,
    political_leaning: Option<&'a str>,
    match_status: Option<&'a str>,
    research_confidence: Option<&'a str>,
    author_page_url: Option<&'a str>,
    canonical_author_url: Option<&'a str>,
    updated_at: Option<NaiveDateTime>,
    institutional_affiliations: Option<&'a Value>,
}

fn catalog_sources() -> Vec<CatalogSource<'static>> {
    let Some(raw_catalog) = RSS_CATALOG.as_object() else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for entry in crate::source_catalog::configured_catalog() {
        let name = entry
            .name
            .split(" - ")
            .next()
            .unwrap_or(&entry.name)
            .trim()
            .to_owned();
        if !seen.insert(name.clone()) {
            continue;
        }
        let config = raw_catalog
            .get(entry.name.as_str())
            .or_else(|| raw_catalog.get(name.as_str()));
        sources.push(CatalogSource { name, config });
    }
    sources
}

fn reporters<'a>(
    data: &'a AtlasProjectionData,
    filters: &AtlasGraphFiltersInput,
) -> Vec<Reporter<'a>> {
    let enabled = filters.entity_types.is_empty()
        || filters
            .entity_types
            .iter()
            .any(|entity_type| matches!(entity_type, AtlasEntityType::Reporter))
        || filters
            .selected
            .as_deref()
            .is_some_and(|selected| selected.starts_with("reporter:"));
    if !enabled {
        return Vec::new();
    }
    let limit = filters
        .limit_nodes
        .map(|limit| usize::try_from(limit.clamp(50, 600)).unwrap_or(600));
    data.reporters
        .iter()
        .filter(|row| {
            row.article_count.is_some_and(|count| count > 0)
                && row.retirement_reason.is_none()
                && !row.is_collective
        })
        .take(limit.unwrap_or(usize::MAX))
        .map(|row| Reporter {
            id: row.id,
            name: &row.name,
            canonical_name: row.canonical_name.as_deref(),
            article_count: row.article_count,
            political_leaning: row.political_leaning.as_deref(),
            match_status: row.match_status.as_deref(),
            research_confidence: row.research_confidence.as_deref(),
            author_page_url: row.author_page_url.as_deref(),
            canonical_author_url: row.canonical_author_url.as_deref(),
            updated_at: row.updated_at,
            institutional_affiliations: row
                .institutional_affiliations
                .as_ref()
                .map(|value| &value.0),
        })
        .collect()
}

fn config_string<'a>(config: Option<&'a Value>, key: &str) -> Option<&'a str> {
    config?.get(key)?.as_str()
}

fn metadata_or_config(
    metadata_value: Option<&str>,
    config: Option<&Value>,
    config_key: &str,
) -> Option<String> {
    metadata_value
        .filter(|value| !value.is_empty())
        .or_else(|| config_string(config, config_key))
        .map(str::to_owned)
}

fn research_confidence(value: Option<&str>) -> Option<f64> {
    match casefold(value.unwrap_or("").trim()).as_str() {
        "verified" => Some(0.95),
        "high" => Some(0.85),
        "medium" => Some(0.65),
        "low" => Some(0.4),
        "ambiguous" => Some(0.45),
        _ => None,
    }
}

fn outlet_node(
    source_name: &str,
    node_id: String,
    config: Option<&Value>,
    lookups: &Lookups<'_>,
) -> AtlasNodeResponse {
    let normalized = normalize_entity_label(source_name);
    let metadata = lookups.metadata(source_name);
    let status = lookups.index("source", source_name);
    let flags = if status.is_some_and(|status| matches!(status.status, Some("failed" | "stale"))) {
        vec!["needs-review".to_owned()]
    } else {
        Vec::new()
    };
    let confidence = confidence_tier(
        metadata.and_then(|metadata| research_confidence(metadata.research_confidence)),
    );
    AtlasNodeResponse {
        id: node_id,
        entity_type: AtlasEntityType::Outlet,
        label: source_name.to_owned(),
        subtitle: metadata_or_config(
            metadata.and_then(|metadata| metadata.source_type),
            config,
            "category",
        ),
        country_code: metadata_or_config(
            metadata.and_then(|metadata| metadata.country),
            config,
            "country",
        ),
        funding_type: metadata_or_config(
            metadata.and_then(|metadata| metadata.funding_type),
            config,
            "funding_type",
        ),
        bias_rating: metadata_or_config(
            metadata.and_then(|metadata| metadata.political_bias),
            config,
            "bias_rating",
        ),
        factual_reporting: metadata_or_config(
            metadata.and_then(|metadata| metadata.factual_rating),
            config,
            "factual_reporting",
        ),
        credibility_score: metadata.and_then(|metadata| metadata.credibility_score),
        analysis_scores: lookups
            .scores_by_source
            .get(&normalized)
            .cloned()
            .unwrap_or_default(),
        article_count: lookups
            .article_counts
            .get(source_name)
            .copied()
            .unwrap_or_default(),
        connection_count: 0,
        ownership_connection_count: 0,
        status: status.and_then(|status| status.status.map(str::to_owned)),
        confidence_tier: Some(confidence),
        profile_path: Some(format!("/wiki/source/{source_name}")),
        updated_at: status
            .and_then(|status| status.last_indexed_at)
            .or_else(|| metadata.and_then(|metadata| metadata.updated_at)),
        flags,
        current_parent: None,
        pending_change: None,
        evidence_coverage: "not researched".to_owned(),
        freshness: "unknown".to_owned(),
        unresolved_gap: None,
    }
}

fn outlet_nodes(
    publications: &[Entity<'_>],
    outlet_ids: &HashMap<String, String>,
    catalog: &[CatalogSource<'_>],
    lookups: &Lookups<'_>,
) -> Vec<AtlasNodeResponse> {
    if publications.is_empty() {
        return catalog
            .iter()
            .map(|source| {
                outlet_node(
                    &source.name,
                    stable_source_id(&source.name),
                    source.config,
                    lookups,
                )
            })
            .collect();
    }
    let catalog_by_name = catalog
        .iter()
        .map(|source| (source.name.as_str(), source.config))
        .collect::<HashMap<_, _>>();
    publications
        .iter()
        .filter_map(|entity| {
            outlet_ids.get(entity.id).map(|node_id| {
                outlet_node(
                    entity.canonical_name,
                    node_id.clone(),
                    catalog_by_name
                        .get(entity.canonical_name)
                        .copied()
                        .flatten(),
                    lookups,
                )
            })
        })
        .collect()
}

fn reporter_confidence(reporter: Reporter<'_>) -> AtlasConfidenceTier {
    let has_person_profile = reporter
        .author_page_url
        .is_some_and(|value| !value.is_empty())
        || reporter
            .canonical_author_url
            .is_some_and(|value| !value.is_empty());
    if reporter.match_status == Some("matched") && has_person_profile {
        return AtlasConfidenceTier::Verified;
    }
    if has_person_profile && matches!(reporter.research_confidence, Some("high" | "verified")) {
        return AtlasConfidenceTier::Strong;
    }
    if matches!(reporter.match_status, Some("matched" | "ambiguous")) {
        return AtlasConfidenceTier::Likely;
    }
    AtlasConfidenceTier::Unresolved
}

fn reporter_node(reporter: Reporter<'_>, lookups: &Lookups<'_>) -> AtlasNodeResponse {
    let status = lookups.index("reporter", reporter.name);
    let label = reporter
        .canonical_name
        .filter(|name| !name.is_empty())
        .unwrap_or(reporter.name);
    AtlasNodeResponse {
        id: format!("reporter:{}", reporter.id),
        entity_type: AtlasEntityType::Reporter,
        label: label.to_owned(),
        subtitle: Some("Reporter".to_owned()),
        country_code: None,
        funding_type: None,
        bias_rating: reporter.political_leaning.map(str::to_owned),
        factual_reporting: None,
        credibility_score: None,
        analysis_scores: BTreeMap::new(),
        article_count: i64::from(reporter.article_count.unwrap_or_default()),
        connection_count: 0,
        ownership_connection_count: 0,
        status: status
            .map(|status| status.status.map(str::to_owned))
            .unwrap_or_else(|| reporter.match_status.map(str::to_owned)),
        confidence_tier: Some(reporter_confidence(reporter)),
        profile_path: Some(format!("/wiki/reporter/{}", reporter.id)),
        updated_at: status
            .and_then(|status| status.last_indexed_at)
            .or(reporter.updated_at),
        flags: Vec::new(),
        current_parent: None,
        pending_change: None,
        evidence_coverage: "not researched".to_owned(),
        freshness: "unknown".to_owned(),
        unresolved_gap: None,
    }
}

fn legacy_organization_ids(
    organizations: &[Entity<'_>],
    survivors: &HashMap<String, String>,
) -> HashMap<String, String> {
    organizations
        .iter()
        .map(|entity| {
            (
                entity.id.to_owned(),
                format!("organization:{}", canonical_entity_id(entity.id, survivors)),
            )
        })
        .collect()
}

fn first_truthy<'a>(object: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find(|value| json_truthy(value))
}

fn byline_edge_index(data: &AtlasProjectionData) -> HashMap<String, Vec<(String, i64)>> {
    let mut index = HashMap::<String, Vec<(String, i64)>>::new();
    for row in &data.reporter_byline_counts {
        let reporter_name = normalize_entity_label(&row.canonical_name);
        if reporter_name.is_empty() {
            continue;
        }
        let outlets = index.entry(reporter_name).or_default();
        if let Some((_, count)) = outlets
            .iter_mut()
            .find(|(entity_id, _)| entity_id == &row.object_entity_id)
        {
            *count = row.evidence_count;
        } else {
            outlets.push((row.object_entity_id.clone(), row.evidence_count));
        }
    }
    index
}

fn byline_edges(
    reporters: &[Reporter<'_>],
    outlet_ids: &HashMap<String, String>,
    organization_ids: &HashMap<String, String>,
    byline_index: &HashMap<String, Vec<(String, i64)>>,
) -> Vec<AtlasEdgeResponse> {
    let mut edges = Vec::new();
    for reporter in reporters {
        let normalized_name = normalize_entity_label(reporter.name);
        let source_id = format!("reporter:{}", reporter.id);
        for (object_entity_id, evidence_count) in
            byline_index.get(&normalized_name).into_iter().flatten()
        {
            if *evidence_count <= 0 {
                continue;
            }
            let target_id = outlet_ids
                .get(object_entity_id)
                .or_else(|| organization_ids.get(object_entity_id));
            let Some(target_id) = target_id else {
                continue;
            };
            let mut edge = edge_base(
                edge_id(&source_id, target_id, "authored_by", "byline"),
                source_id.clone(),
                target_id.clone(),
                AtlasRelationType::EmployedBy,
                Some("authored_by"),
                Some("newsroom_people"),
                Some("article_byline"),
            );
            edge.confidence = Some(0.6);
            edge.confidence_tier = Some(confidence_tier(Some(0.6)));
            edge.evidence_count = *evidence_count;
            edges.push(edge);
        }
    }
    edges
}

fn affiliation_edges(
    reporters: &[Reporter<'_>],
    organization_ids_by_name: &HashMap<String, String>,
    include_evidence_preview: bool,
) -> Vec<AtlasEdgeResponse> {
    let mut edges = Vec::new();
    for reporter in reporters {
        let Some(Value::Array(affiliations)) = reporter.institutional_affiliations else {
            continue;
        };
        for affiliation in affiliations {
            let Some(raw_name) =
                first_truthy(affiliation, &["org", "name", "organization"]).and_then(Value::as_str)
            else {
                continue;
            };
            let Some(target_id) = organization_ids_by_name.get(&normalize_entity_label(raw_name))
            else {
                continue;
            };
            let evidence_url = first_truthy(affiliation, &["url", "source_url"])
                .and_then(Value::as_str)
                .filter(|url| !url.is_empty());
            let evidence = evidence_url.map(|url| AtlasEvidenceRefResponse {
                id: format!("reporter-affiliation:{}:{target_id}", reporter.id),
                source_type: "person_profile".to_owned(),
                source_name: Some(reporter.name.to_owned()),
                source_url: Some(url.to_owned()),
                retrieved_at: None,
                excerpt: affiliation
                    .get("role")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                snapshot_sha256: None,
                locator: json!({}),
                entailment: None,
                evidence_class: None,
                policy_version: None,
                acceptance_decision: None,
                contradictions: Vec::new(),
            });
            let confidence = if evidence.is_some() { 0.9 } else { 0.62 };
            let source_id = format!("reporter:{}", reporter.id);
            let mut edge = edge_base(
                edge_id(&source_id, target_id, "employed_by", raw_name),
                source_id,
                target_id.clone(),
                AtlasRelationType::EmployedBy,
                None,
                None,
                Some("institutional_affiliation"),
            );
            edge.confidence = Some(confidence);
            edge.confidence_tier = Some(confidence_tier(Some(confidence)));
            edge.evidence_count = i64::from(evidence.is_some());
            edge.evidence_preview = if include_evidence_preview {
                evidence.into_iter().collect()
            } else {
                Vec::new()
            };
            edge.is_inferred = edge.evidence_count == 0;
            edges.push(edge);
        }
    }
    edges
}

fn legacy_edges(
    data: &AtlasProjectionData,
    reporters: &[Reporter<'_>],
    outlet_ids: &HashMap<String, String>,
    legacy_organizations: &[Entity<'_>],
    survivors: &HashMap<String, String>,
    include_evidence_preview: bool,
) -> Vec<AtlasEdgeResponse> {
    if reporters.is_empty() {
        return Vec::new();
    }
    let organization_ids = legacy_organization_ids(legacy_organizations, survivors);
    let bylines = byline_edges(
        reporters,
        outlet_ids,
        &organization_ids,
        &byline_edge_index(data),
    );
    let mut organization_ids_by_name = HashMap::new();
    for organization in legacy_organizations {
        let normalized_name = normalize_entity_label(organization.canonical_name);
        if !normalized_name.is_empty() {
            organization_ids_by_name
                .entry(normalized_name)
                .or_insert_with(|| {
                    format!(
                        "organization:{}",
                        canonical_entity_id(organization.id, survivors)
                    )
                });
        }
    }
    let mut edges = bylines;
    edges.extend(affiliation_edges(
        reporters,
        &organization_ids_by_name,
        include_evidence_preview,
    ));
    edges
}

pub(super) fn project(data: &AtlasProjectionData, filters: &AtlasGraphFiltersInput) -> GraphData {
    let catalog = catalog_sources();
    let lookups = Lookups::from_projection(data);
    let survivors = survivor_map(data);
    let all_entities = entities(data);
    let legacy_publications = live_entities(&all_entities, &survivors, LEGACY_PUBLICATION_KINDS);
    let legacy_outlet_ids = outlet_node_ids(&legacy_publications, data);
    let mut nodes = outlet_nodes(&legacy_publications, &legacy_outlet_ids, &catalog, &lookups);
    let reporters = reporters(data, filters);
    nodes.extend(
        reporters
            .iter()
            .copied()
            .map(|reporter| reporter_node(reporter, &lookups)),
    );
    let legacy_organizations = live_entities(&all_entities, &survivors, LEGACY_ORGANIZATION_KINDS);
    let edges = legacy_edges(
        data,
        &reporters,
        &legacy_outlet_ids,
        &legacy_organizations,
        &survivors,
        filters.include_evidence_preview,
    );
    GraphData { nodes, edges }
}
