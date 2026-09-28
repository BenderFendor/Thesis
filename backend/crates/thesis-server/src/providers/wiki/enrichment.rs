use std::collections::{BTreeSet, HashMap, HashSet};
use std::time::Duration;

use serde_json::{json, Map, Value};
use thesis_api::wiki_indexing::{
    ReporterEnrichment, ReporterEnrichmentError, ReporterEnrichmentProvider,
    ReporterEnrichmentRequest, WikiIndexFuture,
};
use thesis_db::{AtlasReporterOwnershipEdgeRecord, Database, WikiReporterBylineSummaryRecord};
use thesis_ingest::cleaner::clean_html;
use tokio::task::JoinSet;

use crate::providers::SafeHttpFetcher;

const MAX_RECENT_ARTICLES: usize = 20;
const ARTICLE_FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const ARTICLE_FETCH_MAX_BYTES: usize = 2 * 1024 * 1024;
const ARTICLE_FETCH_CONTENT_TYPES: &[&str] = &["text/html", "application/xhtml+xml"];
const ARTICLE_AUTHOR_PATHS: &[&str] = &[
    "author",
    "authors",
    "bio",
    "bios",
    "by",
    "byline",
    "columnist",
    "columnists",
    "contributor",
    "contributors",
    "people",
    "person",
    "profile",
    "profiles",
    "staff",
    "team",
];
const AUTHOR_META_KEYS: &[&str] = &[
    "article:author",
    "author",
    "byl",
    "byline",
    "citation_author",
    "dc.creator",
    "dcterms.creator",
    "parsely-author",
    "sailthru.author",
];

#[derive(Clone)]
pub(crate) struct ReporterWikiEnrichmentProvider {
    database: Database,
    safe_http: SafeHttpFetcher,
}

impl ReporterWikiEnrichmentProvider {
    pub(crate) fn new(database: Database, safe_http: SafeHttpFetcher) -> Self {
        Self {
            database,
            safe_http,
        }
    }

    async fn enrich(
        &self,
        request: ReporterEnrichmentRequest,
    ) -> Result<ReporterEnrichment, ReporterEnrichmentError> {
        let bylines = self
            .database
            .wiki_reporter_byline_summary(request.reporter_id)
            .await
            .map_err(|error| {
                ReporterEnrichmentError::Failed(format!("reporter byline summary failed: {error}"))
            })?;
        let career_timeline =
            build_career_timeline(&bylines, request.institutional_affiliations.as_ref());
        let outlet_names = bylines
            .iter()
            .map(|byline| byline.source.clone())
            .collect::<Vec<_>>();
        let ownership_edges = self
            .database
            .load_atlas_reporter_ownership_data(&outlet_names)
            .await
            .map_err(|error| {
                ReporterEnrichmentError::Failed(format!("accepted ownership query failed: {error}"))
            })?;
        let findings = shared_owner_findings(&outlet_names, &ownership_edges);
        let activity_summary = build_activity_summary(
            &request.reporter_name,
            &request.recent_articles,
            self.safe_http,
        )
        .await;
        Ok(ReporterEnrichment {
            career_timeline: json!({
                "timeline": career_timeline,
                "shared_owner_findings": findings,
            }),
            activity_summary,
        })
    }
}

impl ReporterEnrichmentProvider for ReporterWikiEnrichmentProvider {
    fn enrich_reporter(
        &self,
        request: ReporterEnrichmentRequest,
    ) -> WikiIndexFuture<Result<ReporterEnrichment, ReporterEnrichmentError>> {
        let provider = self.clone();
        Box::pin(async move { provider.enrich(request).await })
    }
}

fn build_career_timeline(
    bylines: &[WikiReporterBylineSummaryRecord],
    affiliations: Option<&Value>,
) -> Vec<Value> {
    let mut timeline = bylines
        .iter()
        .filter(|byline| !byline.source.is_empty())
        .map(|byline| {
            json!({
                "source": "byline",
                "outlet": byline.source,
                "start_date": byline.first_published_at.map(format_naive_datetime),
                "end_date": byline.last_published_at.map(format_naive_datetime),
                "article_count": byline.article_count,
                "role": Value::Null,
                "evidence_url": Value::Null,
            })
        })
        .collect::<Vec<_>>();
    if let Some(affiliations) = affiliations.and_then(Value::as_array) {
        timeline.extend(affiliations.iter().filter_map(affiliation_timeline_entry));
    }
    timeline.sort_by(|left, right| timeline_sort_key(left).cmp(&timeline_sort_key(right)));
    timeline
}

fn format_naive_datetime(value: chrono::NaiveDateTime) -> String {
    value.format("%Y-%m-%dT%H:%M:%S%.f").to_string()
}

fn affiliation_timeline_entry(value: &Value) -> Option<Value> {
    let affiliation = value.as_object()?;
    let name = first_truthy_value(affiliation, &["org", "name", "organization"])?;
    let name = name.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let evidence_url = first_truthy_value(affiliation, &["url", "source_url", "littlesis_url"])
        .and_then(Value::as_str)
        .map(str::to_owned);
    Some(json!({
        "source": "affiliation",
        "outlet": name,
        "start_date": first_truthy_value(affiliation, &["start_date", "start"]),
        "end_date": first_truthy_value(affiliation, &["end_date", "end"]),
        "article_count": Value::Null,
        "role": first_truthy_value(affiliation, &["role", "category"]),
        "evidence_url": evidence_url,
    }))
}

fn first_truthy_value<'a>(object: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find(|value| json_truthy(value))
}

fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn timeline_sort_key(entry: &Value) -> (u8, String) {
    match entry.get("start_date").and_then(Value::as_str) {
        Some(start) if !start.is_empty() => (0, start.to_owned()),
        _ => (1, String::new()),
    }
}

#[derive(Clone, Debug, PartialEq)]
struct AtlasEntityRef {
    entity_id: String,
    label: String,
    entity_type: &'static str,
    profile_path: String,
}

impl AtlasEntityRef {
    fn as_value(&self) -> Value {
        json!({
            "entity_id": self.entity_id,
            "label": self.label,
            "entity_type": self.entity_type,
            "profile_path": self.profile_path,
        })
    }
}

#[derive(Clone, Debug)]
struct OwnershipEdge {
    owned: AtlasEntityRef,
    owner: AtlasEntityRef,
    percentage: Option<f64>,
    claim_ids: Vec<String>,
    evidence_count: i64,
}

fn shared_owner_findings(
    outlet_names: &[String],
    records: &[AtlasReporterOwnershipEdgeRecord],
) -> Vec<Value> {
    let mut names = outlet_names
        .iter()
        .filter(|name| !name.is_empty())
        .cloned()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    if names.len() < 2 {
        return Vec::new();
    }

    let mut records_by_outlet = HashMap::<String, Vec<&AtlasReporterOwnershipEdgeRecord>>::new();
    for record in records {
        if record.predicate != "directly_owns" && record.predicate != "owns_equity_in" {
            continue;
        }
        records_by_outlet
            .entry(record.outlet_catalog_key.clone())
            .or_default()
            .push(record);
    }

    let mut findings_by_owner = HashMap::<String, Vec<(AtlasEntityRef, Vec<OwnershipEdge>)>>::new();
    for (catalog_key, chain_records) in records_by_outlet {
        let Some(first) = chain_records.first() else {
            continue;
        };
        let outlet_id = format!("outlet:{catalog_key}");
        let outlet_ref = AtlasEntityRef {
            entity_id: outlet_id.clone(),
            label: first.outlet_name.clone(),
            entity_type: "outlet",
            profile_path: format!("/wiki/source/{}", first.outlet_name),
        };
        let mut by_owned = HashMap::<String, OwnershipEdge>::new();
        for record in chain_records {
            let owned = atlas_endpoint_ref(
                &record.subject_entity_id,
                &record.subject_record_kind,
                &record.subject_name,
                record.subject_rss_catalog_key.as_deref(),
                record.subject_scoop_reporter_id.as_deref(),
                &record.outlet_entity_id,
                &record.outlet_catalog_key,
                &record.outlet_name,
            );
            let owner = atlas_endpoint_ref(
                &record.object_entity_id,
                &record.object_record_kind,
                &record.object_name,
                record.object_rss_catalog_key.as_deref(),
                record.object_scoop_reporter_id.as_deref(),
                &record.outlet_entity_id,
                &record.outlet_catalog_key,
                &record.outlet_name,
            );
            let (Some(owned), Some(owner)) = (owned, owner) else {
                continue;
            };
            let percentage = record.qualifiers.0.get("pct").and_then(Value::as_f64);
            let edge = OwnershipEdge {
                owned: owned.clone(),
                owner,
                percentage,
                claim_ids: record.claim_ids.clone(),
                evidence_count: record.evidence_count,
            };
            match by_owned.get(&owned.entity_id) {
                Some(existing)
                    if percentage.unwrap_or_default()
                        <= existing.percentage.unwrap_or_default() => {}
                _ => {
                    by_owned.insert(owned.entity_id, edge);
                }
            }
        }

        let mut chain = Vec::new();
        let mut current = outlet_id;
        let mut visited = HashSet::from([current.clone()]);
        while chain.len() < 12 {
            let Some(edge) = by_owned.get(&current).cloned() else {
                break;
            };
            if !visited.insert(edge.owner.entity_id.clone()) {
                break;
            }
            current = edge.owner.entity_id.clone();
            chain.push(edge);
        }
        if let Some(root) = chain.last().map(|edge| edge.owner.clone()) {
            findings_by_owner
                .entry(root.entity_id.clone())
                .or_default()
                .push((outlet_ref, chain));
        }
    }

    let mut findings = findings_by_owner
        .into_values()
        .filter_map(|mut members| {
            if members.len() < 2 {
                return None;
            }
            members.sort_by(|left, right| left.0.label.cmp(&right.0.label));
            let owner = members.first()?.1.last()?.owner.clone();
            let mut claim_ids = BTreeSet::new();
            let mut evidence_count = 0_i64;
            let mut outlets = Vec::with_capacity(members.len());
            for (outlet, chain) in members {
                outlets.push(outlet.as_value());
                for edge in chain {
                    claim_ids.extend(edge.claim_ids);
                    evidence_count = evidence_count.saturating_add(edge.evidence_count);
                }
            }
            Some(json!({
                "owner": owner.as_value(),
                "outlets": outlets,
                "evidence_count": evidence_count,
                "claim_ids": claim_ids.into_iter().collect::<Vec<_>>(),
            }))
        })
        .collect::<Vec<_>>();
    findings.sort_by(|left, right| {
        left.pointer("/owner/label")
            .and_then(Value::as_str)
            .cmp(&right.pointer("/owner/label").and_then(Value::as_str))
    });
    findings
}

fn atlas_endpoint_id(
    entity_id: &str,
    record_kind: &str,
    catalog_key: Option<&str>,
    scoop_reporter_id: Option<&str>,
) -> Option<String> {
    if let Some(reporter_id) = scoop_reporter_id {
        return Some(format!("reporter:{reporter_id}"));
    }
    let entity_type = atlas_entity_type(record_kind)?;
    match entity_type {
        "organization" => Some(format!("organization:{entity_id}")),
        "person" => Some(format!("person:{entity_id}")),
        "outlet" => catalog_key.map(|key| format!("outlet:{key}")),
        _ => None,
    }
}

fn atlas_endpoint_ref(
    entity_id: &str,
    record_kind: &str,
    label: &str,
    catalog_key: Option<&str>,
    scoop_reporter_id: Option<&str>,
    outlet_entity_id: &str,
    outlet_catalog_key: &str,
    outlet_name: &str,
) -> Option<AtlasEntityRef> {
    if entity_id == outlet_entity_id {
        return Some(AtlasEntityRef {
            entity_id: format!("outlet:{outlet_catalog_key}"),
            label: outlet_name.to_owned(),
            entity_type: "outlet",
            profile_path: format!("/wiki/source/{outlet_name}"),
        });
    }
    let reference_id = atlas_endpoint_id(entity_id, record_kind, catalog_key, scoop_reporter_id)?;
    let entity_type = if scoop_reporter_id.is_some() {
        "reporter"
    } else {
        atlas_entity_type(record_kind)?
    };
    Some(entity_ref(reference_id, label.to_owned(), entity_type))
}

fn atlas_entity_type(record_kind: &str) -> Option<&'static str> {
    match record_kind {
        "legal_entity"
        | "organization_without_legal_identity"
        | "public_company"
        | "nonprofit"
        | "family_control_group"
        | "trust"
        | "government_award"
        | "seller_account" => Some("organization"),
        "person" => Some("person"),
        "publication" | "publication_brand" | "digital_property" | "feed" | "broadcast_station" => {
            Some("outlet")
        }
        _ => None,
    }
}

fn entity_ref(entity_id: String, label: String, entity_type: &'static str) -> AtlasEntityRef {
    let (path_type, path_id) = match entity_type {
        "organization" => (
            "organization",
            entity_id
                .strip_prefix("organization:")
                .unwrap_or(&entity_id),
        ),
        "person" => (
            "person",
            entity_id.strip_prefix("person:").unwrap_or(&entity_id),
        ),
        "reporter" => (
            "reporter",
            entity_id.strip_prefix("reporter:").unwrap_or(&entity_id),
        ),
        _ => ("source", label.as_str()),
    };
    AtlasEntityRef {
        entity_id,
        label: label.clone(),
        entity_type,
        profile_path: format!("/wiki/{path_type}/{path_id}"),
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
struct ArticleSignals {
    author_pages: Vec<String>,
    social_links: Vec<String>,
    metadata_authors: Vec<String>,
}

async fn build_activity_summary(
    reporter_name: &str,
    articles: &[Value],
    fetcher: SafeHttpFetcher,
) -> Value {
    let source_counts = count_values(articles, "source");
    let category_counts = count_values(articles, "category");
    let domain_counts = count_domains(articles);
    let mut article_dates = articles
        .iter()
        .filter_map(|article| article.get("published_at").and_then(Value::as_str))
        .filter(|date| !date.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    article_dates.sort();

    let urls = fetchable_article_urls(articles);
    let mut signals = vec![None; urls.len()];
    let mut tasks = JoinSet::new();
    for (index, url) in urls.iter().enumerate() {
        let reporter_name = reporter_name.to_owned();
        let url = url.clone();
        tasks.spawn(async move {
            (
                index,
                fetch_article_author_signals(fetcher, &url, &reporter_name).await,
            )
        });
    }
    while let Some(result) = tasks.join_next().await {
        if let Ok((index, article_signals)) = result {
            signals[index] = article_signals;
        }
    }

    let mut author_pages = Vec::new();
    let mut social_links = Vec::new();
    let mut meta_author_matches = 0_i64;
    for article_signals in signals.into_iter().flatten().flatten() {
        if article_signals
            .metadata_authors
            .first()
            .is_some_and(|author| name_matches(author, reporter_name))
        {
            meta_author_matches += 1;
        }
        author_pages.extend(article_signals.author_pages);
        social_links.extend(article_signals.social_links);
    }
    let author_pages = ordered_unique(author_pages)
        .into_iter()
        .take(8)
        .collect::<Vec<_>>();
    let social_links = ordered_unique(social_links)
        .into_iter()
        .take(8)
        .collect::<Vec<_>>();
    json!({
        "article_count": articles.len(),
        "source_count": source_counts.len(),
        "active_since": article_dates.first(),
        "latest_article_at": article_dates.last(),
        "outlets": count_values_json(source_counts, 6, "name"),
        "categories": count_values_json(category_counts, 8, "name"),
        "domains": count_values_json(domain_counts, 6, "domain"),
        "author_pages": author_pages.iter().map(|url| json!({"url": url, "domain": domain(url), "source": "article-page"})).collect::<Vec<_>>(),
        "external_profiles": social_links.iter().map(|url| json!({"url": url, "domain": domain(url), "source": "structured-data"})).collect::<Vec<_>>(),
        "meta_author_matches": meta_author_matches,
    })
}

fn count_values(articles: &[Value], key: &str) -> Vec<(String, usize)> {
    let mut counts = Vec::<(String, usize)>::new();
    let mut indices = HashMap::<String, usize>::new();
    for article in articles {
        let Some(value) = article
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if let Some(index) = indices.get(value).copied() {
            counts[index].1 += 1;
        } else {
            indices.insert(value.to_owned(), counts.len());
            counts.push((value.to_owned(), 1));
        }
    }
    counts.sort_by(|left, right| right.1.cmp(&left.1));
    counts
}

fn count_domains(articles: &[Value]) -> Vec<(String, usize)> {
    let mut counts = Vec::<(String, usize)>::new();
    let mut indices = HashMap::<String, usize>::new();
    for url in articles
        .iter()
        .filter_map(|article| article.get("url").and_then(Value::as_str))
        .filter(|url| !url.is_empty())
    {
        let Some(host) = domain(url) else {
            continue;
        };
        if let Some(index) = indices.get(&host).copied() {
            counts[index].1 += 1;
        } else {
            indices.insert(host.clone(), counts.len());
            counts.push((host, 1));
        }
    }
    counts.sort_by(|left, right| right.1.cmp(&left.1));
    counts
}

fn count_values_json(counts: Vec<(String, usize)>, limit: usize, name_key: &str) -> Vec<Value> {
    counts
        .into_iter()
        .take(limit)
        .map(|(name, article_count)| json!({ name_key: name, "article_count": article_count }))
        .collect()
}

fn fetchable_article_urls(articles: &[Value]) -> Vec<String> {
    articles
        .iter()
        .take(MAX_RECENT_ARTICLES)
        .filter_map(|article| article.get("url").and_then(Value::as_str))
        .filter(|url| !url.is_empty() && is_fetchable_article_url(url))
        .map(str::to_owned)
        .collect()
}

fn is_fetchable_article_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return false;
    }
    let Some(host) = domain(value) else {
        return false;
    };
    host != "example.com" && !host.ends_with(".example.com")
}

fn domain(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    let host = url.host_str()?.to_lowercase();
    let mut authority = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    };
    authority = authority.replace("www.", "");
    (!authority.is_empty()).then_some(authority)
}

async fn fetch_article_author_signals(
    fetcher: SafeHttpFetcher,
    url: &str,
    reporter_name: &str,
) -> Option<ArticleSignals> {
    let response = fetcher
        .fetch(
            url,
            ARTICLE_FETCH_TIMEOUT,
            5,
            ARTICLE_FETCH_MAX_BYTES,
            Some(ARTICLE_FETCH_CONTENT_TYPES),
        )
        .await
        .ok()?;
    if !response.status.is_success() {
        return None;
    }
    let html = String::from_utf8_lossy(&response.body);
    Some(extract_article_signals(
        &html,
        &response.final_url,
        reporter_name,
    ))
}

fn extract_article_signals(html: &str, page_url: &str, reporter_name: &str) -> ArticleSignals {
    let mut signals = ArticleSignals::default();
    for tag in html_elements(html, "meta") {
        let attributes = parse_html_attributes(&tag.attributes);
        let key = attributes
            .get("name")
            .or_else(|| attributes.get("property"))
            .or_else(|| attributes.get("itemprop"))
            .map(|value| value.trim().to_lowercase());
        let Some(key) = key.filter(|key| AUTHOR_META_KEYS.contains(&key.as_str())) else {
            continue;
        };
        let Some(content) = attributes.get("content").map(|value| value.trim()) else {
            continue;
        };
        if content.starts_with("http://")
            || content.starts_with("https://")
            || content.starts_with('/')
        {
            continue;
        }
        signals
            .metadata_authors
            .extend(split_metadata_authors(content));
    }

    for tag in html_elements(html, "script") {
        let attributes = parse_html_attributes(&tag.attributes);
        if !attributes.get("type").is_some_and(|value| {
            value
                .split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .eq_ignore_ascii_case("application/ld+json")
        }) {
            continue;
        }
        if let Ok(payload) = serde_json::from_str::<Value>(tag.inner.trim()) {
            for author in collect_json_ld_authors(&payload) {
                let Some(name) = author.get("name").and_then(Value::as_str) else {
                    continue;
                };
                if !name_matches(name, reporter_name) {
                    continue;
                }
                if let Some(url) = author.get("url").and_then(Value::as_str) {
                    if let Some(url) = absolute_url(page_url, url) {
                        signals.author_pages.push(url);
                    }
                }
                if let Some(same_as) = author.get("sameAs") {
                    match same_as {
                        Value::String(url) => {
                            if let Some(url) = absolute_url(page_url, url) {
                                signals.social_links.push(url);
                            }
                        }
                        Value::Array(urls) => {
                            for url in urls.iter().filter_map(Value::as_str) {
                                if let Some(url) = absolute_url(page_url, url) {
                                    signals.social_links.push(url);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    for tag in html_elements(html, "a") {
        let attributes = parse_html_attributes(&tag.attributes);
        let Some(href) = attributes.get("href") else {
            continue;
        };
        let Some(absolute) = absolute_url(page_url, href) else {
            continue;
        };
        let rel_author = attributes
            .get("rel")
            .is_some_and(|value| value.to_lowercase().contains("author"));
        let author_path = reqwest::Url::parse(&absolute).ok().is_some_and(|url| {
            url.path_segments().is_some_and(|segments| {
                segments
                    .into_iter()
                    .any(|segment| ARTICLE_AUTHOR_PATHS.contains(&segment.to_lowercase().as_str()))
            })
        });
        if !rel_author && !author_path {
            continue;
        }
        let label = clean_html(tag.inner);
        let label = if label.is_empty() {
            attributes
                .get("aria-label")
                .or_else(|| attributes.get("title"))
                .map(String::as_str)
                .unwrap_or_default()
        } else {
            label.as_str()
        };
        if name_matches(label, reporter_name) {
            signals.author_pages.push(absolute);
        }
    }
    signals.author_pages = ordered_unique(signals.author_pages);
    signals.social_links = ordered_unique(signals.social_links);
    signals.metadata_authors = ordered_unique(signals.metadata_authors);
    signals
}

fn split_metadata_authors(value: &str) -> Vec<String> {
    let mut names = Vec::new();
    for section in value.split([',', ';']) {
        let words = section.split_whitespace().collect::<Vec<_>>();
        let mut start = 0;
        for index in 0..words.len() {
            let separator = words[index].eq_ignore_ascii_case("and")
                || words[index].eq_ignore_ascii_case("with");
            if separator {
                let name = clean_html(&words[start..index].join(" "));
                if !name.is_empty() {
                    names.push(name);
                }
                start = index + 1;
            }
        }
        let name = clean_html(&words[start..].join(" "));
        if !name.is_empty() {
            names.push(name);
        }
    }
    names
}

fn collect_json_ld_authors(payload: &Value) -> Vec<Value> {
    let mut authors = Vec::new();
    match payload {
        Value::Array(values) => {
            for value in values {
                authors.extend(collect_json_ld_authors(value));
            }
        }
        Value::Object(object) => {
            if let Some(author) = object.get("author") {
                match author {
                    Value::Array(values) => {
                        for value in values {
                            match value {
                                Value::Object(_) => authors.push(value.clone()),
                                Value::String(name) => authors.push(json!({ "name": name })),
                                _ => {}
                            }
                        }
                    }
                    Value::Object(_) => authors.push(author.clone()),
                    Value::String(name) => authors.push(json!({ "name": name })),
                    _ => {}
                }
            }
            if let Some(graph) = object.get("@graph").and_then(Value::as_array) {
                for value in graph {
                    authors.extend(collect_json_ld_authors(value));
                }
            }
        }
        _ => {}
    }
    authors
}

fn html_elements<'a>(html: &'a str, tag_name: &str) -> Vec<HtmlElement<'a>> {
    let opening = format!("<{tag_name}");
    let closing = format!("</{tag_name}");
    let bytes = html.as_bytes();
    let mut elements = Vec::new();
    let mut cursor = 0;
    while let Some(start) = find_ascii_case_insensitive(bytes, opening.as_bytes(), cursor) {
        let after_name = start + opening.len();
        if bytes
            .get(after_name)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(byte, b'>' | b'/'))
        {
            cursor = after_name;
            continue;
        }
        let Some(end) = find_tag_end(bytes, after_name) else {
            break;
        };
        let attributes = &html[start + 1..end];
        if tag_name.eq_ignore_ascii_case("meta") {
            elements.push(HtmlElement {
                attributes,
                inner: "",
            });
            cursor = end + 1;
            continue;
        }
        let Some(close) = find_ascii_case_insensitive(bytes, closing.as_bytes(), end + 1) else {
            break;
        };
        let Some(close_end) = bytes[close..].iter().position(|byte| *byte == b'>') else {
            break;
        };
        let close_end = close + close_end;
        elements.push(HtmlElement {
            attributes,
            inner: &html[end + 1..close],
        });
        cursor = close_end + 1;
    }
    elements
}

#[derive(Clone, Copy)]
struct HtmlElement<'a> {
    attributes: &'a str,
    inner: &'a str,
}

fn find_ascii_case_insensitive(haystack: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    if needle.is_empty() || start > haystack.len() {
        return None;
    }
    haystack
        .get(start..)?
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
        .map(|offset| offset + start)
}

fn find_tag_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut quote = None;
    for (offset, byte) in bytes.iter().copied().enumerate().skip(start) {
        if let Some(delimiter) = quote {
            if byte == delimiter {
                quote = None;
            }
        } else if matches!(byte, b'\'' | b'"') {
            quote = Some(byte);
        } else if byte == b'>' {
            return Some(offset);
        }
    }
    None
}

fn parse_html_attributes(tag: &str) -> HashMap<String, String> {
    let bytes = tag.as_bytes();
    let mut attributes = HashMap::new();
    let mut cursor = 0;
    while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    while cursor < bytes.len() {
        while cursor < bytes.len() && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'/')
        {
            cursor += 1;
        }
        let name_start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'=' | b'>' | b'/')
        {
            cursor += 1;
        }
        if name_start == cursor {
            cursor += 1;
            continue;
        }
        let name = String::from_utf8_lossy(&bytes[name_start..cursor]).to_lowercase();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            attributes.insert(name, String::new());
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let quote = bytes
            .get(cursor)
            .copied()
            .filter(|byte| matches!(byte, b'\'' | b'"'));
        if quote.is_some() {
            cursor += 1;
        }
        let value_start = cursor;
        while cursor < bytes.len() {
            if let Some(quote) = quote {
                if bytes[cursor] == quote {
                    break;
                }
            } else if bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'>' {
                break;
            }
            cursor += 1;
        }
        let value = String::from_utf8_lossy(&bytes[value_start..cursor]).into_owned();
        attributes.insert(name, value);
        if quote.is_some() && bytes.get(cursor) == quote.as_ref() {
            cursor += 1;
        }
    }
    attributes
}

fn absolute_url(page_url: &str, value: &str) -> Option<String> {
    let base = reqwest::Url::parse(page_url).ok()?;
    let url = base.join(value.trim()).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then(|| url.to_string())
}

fn name_matches(candidate: &str, reporter_name: &str) -> bool {
    let candidate = candidate.trim().to_lowercase();
    let reporter = reporter_name.trim().to_lowercase();
    if candidate.is_empty() || reporter.is_empty() {
        return false;
    }
    if candidate == reporter {
        return true;
    }
    let candidate_tokens = name_tokens(&candidate);
    let reporter_tokens = name_tokens(&reporter);
    !candidate_tokens.is_empty()
        && !reporter_tokens.is_empty()
        && (reporter_tokens.is_subset(&candidate_tokens)
            || candidate_tokens.is_subset(&reporter_tokens))
}

fn name_tokens(value: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut start = None;
    for (index, character) in value.char_indices() {
        if character.is_ascii_alphanumeric() {
            start.get_or_insert(index);
        } else if let Some(start) = start.take() {
            tokens.insert(value[start..index].to_owned());
        }
    }
    if let Some(start) = start {
        tokens.insert(value[start..].to_owned());
    }
    tokens
}

fn ordered_unique(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{
        atlas_endpoint_ref, build_activity_summary, build_career_timeline, extract_article_signals,
        fetchable_article_urls, shared_owner_findings, timeline_sort_key, AtlasEntityRef,
    };
    use thesis_db::{AtlasReporterOwnershipEdgeRecord, WikiReporterBylineSummaryRecord};

    #[test]
    fn timeline_merges_byline_and_affiliation_dates_in_order() {
        let bylines = vec![WikiReporterBylineSummaryRecord {
            source: "Example News".to_owned(),
            first_published_at: Some(
                chrono::NaiveDate::from_ymd_opt(2020, 1, 2)
                    .unwrap()
                    .and_hms_opt(0, 0, 0)
                    .unwrap(),
            ),
            last_published_at: None,
            article_count: 4,
        }];
        let timeline = build_career_timeline(
            &bylines,
            Some(&json!([
                {"org":"Past Outlet", "start":"2018-01-01", "role":"editor"},
                {"name":"Undated Group"}
            ])),
        );
        assert_eq!(timeline[0]["outlet"], "Past Outlet");
        assert_eq!(timeline[0]["source"], "affiliation");
        assert_eq!(timeline[1]["start_date"], "2020-01-02T00:00:00");
        assert_eq!(timeline[2]["start_date"], Value::Null);
    }

    #[test]
    fn article_page_signals_match_metadata_json_ld_and_author_anchors() {
        let html = r#"
            <meta name="author" content="Alice Smith">
            <script type="application/ld+json">
              {"@type":"NewsArticle","author":{"@type":"Person","name":"Alice Smith","url":"/authors/alice","sameAs":["https://social.example/alice"]}}
            </script>
            <a rel="author" href="/staff/alice">Alice Smith</a>
        "#;
        let signals = extract_article_signals(html, "https://news.example/story", "Alice Smith");
        assert_eq!(signals.metadata_authors, ["Alice Smith"]);
        assert!(signals
            .author_pages
            .contains(&"https://news.example/authors/alice".to_owned()));
        assert!(signals
            .author_pages
            .contains(&"https://news.example/staff/alice".to_owned()));
        assert_eq!(signals.social_links, ["https://social.example/alice"]);
    }

    #[tokio::test]
    async fn activity_counts_and_ties_follow_recent_article_order() {
        let articles = vec![
            json!({"source":"Outlet B", "category":"World", "published_at":"2024-02-01", "url":"https://www.example.com/a"}),
            json!({"source":"Outlet A", "category":"Politics", "published_at":"2024-01-01", "url":"https://www.example.com/b"}),
            json!({"source":"Outlet B", "category":"Politics", "published_at":"2024-03-01", "url":"https://www.example.com/c"}),
        ];
        let summary = build_activity_summary("Alice Smith", &articles, Default::default()).await;
        assert_eq!(summary["article_count"], 3);
        assert_eq!(summary["source_count"], 2);
        assert_eq!(summary["active_since"], "2024-01-01");
        assert_eq!(summary["latest_article_at"], "2024-03-01");
        assert_eq!(summary["outlets"][0]["name"], "Outlet B");
        assert_eq!(summary["categories"][0]["name"], "World");
        assert_eq!(summary["meta_author_matches"], 0);
    }

    #[test]
    fn fetchable_urls_filter_only_within_the_recent_twenty_and_keep_duplicates() {
        let mut articles = (0..21)
            .map(|index| json!({"url": format!("https://news-{index}.test/story")}))
            .collect::<Vec<_>>();
        articles[0]["url"] = json!("https://example.com/blocked");
        articles[2]["url"] = articles[1]["url"].clone();

        let urls = fetchable_article_urls(&articles);
        assert_eq!(urls.len(), 19);
        assert_eq!(urls[0], "https://news-1.test/story");
        assert_eq!(urls[1], "https://news-1.test/story");
        assert!(!urls.iter().any(|url| url.contains("news-20")));
    }

    #[test]
    fn shared_owner_findings_require_two_outlets_and_aggregate_unique_claims() {
        let records = vec![
            edge(
                "outlet-1",
                "Example One",
                "key-1",
                "outlet-1",
                "Example One",
                "owner",
                "Owner",
                0,
                &["c1"],
                2,
            ),
            edge(
                "outlet-1",
                "Example One",
                "key-1",
                "owner",
                "Owner",
                "ultimate",
                "Ultimate",
                1,
                &["c2"],
                3,
            ),
            edge(
                "outlet-2",
                "Example Two",
                "key-2",
                "outlet-2",
                "Example Two",
                "owner",
                "Owner",
                0,
                &["c1"],
                5,
            ),
            edge(
                "outlet-2",
                "Example Two",
                "key-2",
                "owner",
                "Owner",
                "ultimate",
                "Ultimate",
                1,
                &["c2"],
                7,
            ),
        ];
        let findings = shared_owner_findings(
            &["Example Two".to_owned(), "Example One".to_owned()],
            &records,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0]["owner"]["entity_id"], "organization:ultimate");
        assert_eq!(findings[0]["evidence_count"], 17);
        assert_eq!(findings[0]["claim_ids"], json!(["c1", "c2"]));
        assert_eq!(findings[0]["outlets"].as_array().unwrap().len(), 2);
        assert_eq!(findings[0]["outlets"][0]["entity_id"], "outlet:key-1");
        assert_eq!(
            findings[0]["outlets"][0]["profile_path"],
            "/wiki/source/Example One"
        );

        assert!(shared_owner_findings(&["Example One".to_owned()], &records).is_empty());
    }

    fn edge(
        outlet_entity_id: &str,
        outlet_name: &str,
        outlet_catalog_key: &str,
        subject_id: &str,
        subject_name: &str,
        object_id: &str,
        object_name: &str,
        depth: i32,
        claim_ids: &[&str],
        evidence_count: i64,
    ) -> AtlasReporterOwnershipEdgeRecord {
        let subject_is_outlet = subject_id == outlet_entity_id;
        let object_is_outlet = object_id == outlet_entity_id;
        AtlasReporterOwnershipEdgeRecord {
            outlet_entity_id: outlet_entity_id.to_owned(),
            outlet_name: outlet_name.to_owned(),
            outlet_catalog_key: outlet_catalog_key.to_owned(),
            chain_depth: depth,
            relationship_id: format!("edge-{outlet_entity_id}-{depth}"),
            subject_entity_id: subject_id.to_owned(),
            subject_record_kind: if subject_is_outlet {
                "publication"
            } else {
                "legal_entity"
            }
            .to_owned(),
            subject_entity_kind: if subject_is_outlet {
                "outlet"
            } else {
                "organization"
            }
            .to_owned(),
            subject_name: subject_name.to_owned(),
            subject_privacy_scope: "public".to_owned(),
            subject_rss_catalog_key: subject_is_outlet.then(|| outlet_catalog_key.to_owned()),
            subject_scoop_reporter_id: None,
            predicate: "directly_owns".to_owned(),
            object_entity_id: object_id.to_owned(),
            object_record_kind: if object_is_outlet {
                "publication"
            } else {
                "legal_entity"
            }
            .to_owned(),
            object_entity_kind: if object_is_outlet {
                "outlet"
            } else {
                "organization"
            }
            .to_owned(),
            object_name: object_name.to_owned(),
            object_privacy_scope: "public".to_owned(),
            object_rss_catalog_key: object_is_outlet.then(|| outlet_catalog_key.to_owned()),
            object_scoop_reporter_id: None,
            qualifiers: sqlx::types::Json(json!({"pct": 100})),
            valid_from: None,
            valid_to: None,
            recorded_at: chrono::NaiveDate::from_ymd_opt(2024, 1, 1)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap(),
            retracted_at: None,
            acceptance_policy_version: "policy-v1".to_owned(),
            status: "accepted".to_owned(),
            lifecycle_state: "current".to_owned(),
            materialized_at: chrono::NaiveDate::from_ymd_opt(2024, 1, 1)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap(),
            claim_ids: claim_ids.iter().map(|value| (*value).to_owned()).collect(),
            evidence_count,
        }
    }

    #[test]
    fn owner_ref_uses_established_atlas_profile_path() {
        let reference = AtlasEntityRef {
            entity_id: "organization:org-id".to_owned(),
            label: "Parent Group".to_owned(),
            entity_type: "organization",
            profile_path: "/wiki/organization/org-id".to_owned(),
        };
        assert_eq!(
            reference.as_value()["profile_path"],
            "/wiki/organization/org-id"
        );
        assert_eq!(
            timeline_sort_key(&json!({"start_date":"2020"})),
            (0, "2020".to_owned())
        );
    }

    #[test]
    fn endpoint_refs_keep_reporter_and_outlet_identity_and_profile_paths() {
        let reporter = atlas_endpoint_ref(
            "person-1",
            "person",
            "Alice Smith",
            None,
            Some("reporter-17"),
            "outlet-1",
            "source-key",
            "Example News",
        )
        .expect("reporter endpoint");
        assert_eq!(reporter.entity_id, "reporter:reporter-17");
        assert_eq!(reporter.entity_type, "reporter");
        assert_eq!(reporter.profile_path, "/wiki/reporter/reporter-17");

        let outlet = atlas_endpoint_ref(
            "outlet-1",
            "publication",
            "Example News",
            Some("source-key"),
            None,
            "outlet-1",
            "source-key",
            "Example News",
        )
        .expect("outlet endpoint");
        assert_eq!(outlet.entity_id, "outlet:source-key");
        assert_eq!(outlet.profile_path, "/wiki/source/Example News");
    }
}
