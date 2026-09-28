use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use thesis_api::entity_research::{
    EntityResearchProvider, OrganizationResearchRequest, ReporterProfileRequest,
    ReporterProfileResponse,
};
use thesis_api::wiki_indexing::{
    WikiIndexError, WikiIndexFuture, WikiIndexer, WikiReporterIndexMode, WikiReporterIndexPhase,
    WikiReporterIndexRequest, WikiReporterIndexResult, WikiSourceIndexConfig,
    WikiSourceIndexRequest,
};
use thesis_db::{
    Database, WikiArticleAuthorLinkInput, WikiOrganizationWriteRecord,
    WikiReporterProfileWriteRecord, WikiSourceAnalysisScoreInput, WikiSourceClaimEvidenceInput,
    WikiSourceClaimInput, WikiUnresolvedAuthorArticle, WikiUnresolvedAuthorCandidate,
};
use thesis_ingest::source_url_guard::{hosts_match, normalize_host};

use super::{
    validate_source_scores, WikiSourceOrganizationUpdates, WikiSourceScorer,
    WikiSourceScoringError, WikiSourceScoringMetadata, WikiSourceScoringRequest,
};

#[derive(Clone)]
pub(crate) struct WikiIndexerProvider {
    database: Database,
    http: reqwest::Client,
    entity_research: Arc<dyn EntityResearchProvider>,
    scorer: Arc<dyn WikiSourceScorer>,
}

impl WikiIndexerProvider {
    pub(crate) fn new(
        database: Database,
        http: reqwest::Client,
        entity_research: Arc<dyn EntityResearchProvider>,
        scorer: Arc<dyn WikiSourceScorer>,
    ) -> Self {
        Self {
            database,
            http,
            entity_research,
            scorer,
        }
    }

    pub(crate) async fn index_source(
        &self,
        request: WikiSourceIndexRequest,
    ) -> Result<bool, WikiIndexError> {
        self.database
            .wiki_upsert_index_status("source", &request.source_name, "indexing", None, None)
            .await
            .map_err(|error| WikiIndexError::Failed(error.to_string()))?;
        let started_at = Instant::now();
        if let Err(error) = self.index_source_work(&request).await {
            self.database
                .wiki_upsert_index_status(
                    "source",
                    &request.source_name,
                    "failed",
                    Some(&error),
                    None,
                )
                .await
                .map_err(|status_error| {
                    WikiIndexError::Failed(format!(
                        "{error}; failed to persist failure status: {status_error}"
                    ))
                })?;
            return Ok(false);
        }

        let duration_ms = i64::try_from(started_at.elapsed().as_millis()).unwrap_or(i64::MAX);
        if let Err(error) = self
            .database
            .wiki_upsert_index_status(
                "source",
                &request.source_name,
                "complete",
                None,
                Some(duration_ms),
            )
            .await
        {
            let message = error.to_string();
            self.database
                .wiki_upsert_index_status(
                    "source",
                    &request.source_name,
                    "failed",
                    Some(&message),
                    None,
                )
                .await
                .map_err(|status_error| {
                    WikiIndexError::Failed(format!(
                        "{message}; failed to persist failure status: {status_error}"
                    ))
                })?;
            return Ok(false);
        }
        Ok(true)
    }

    async fn index_source_work(&self, request: &WikiSourceIndexRequest) -> Result<(), String> {
        let research = self
            .entity_research
            .research_organization(OrganizationResearchRequest {
                name: request.source_name.clone(),
                website: None,
            })
            .await
            .map_err(|error| format!("organization research failed: {error:?}"))?;
        let mut organization_data = serde_json::to_value(research.value)
            .map_err(|error| format!("organization research result was invalid: {error}"))?;
        let Some(organization) = organization_data.as_object_mut() else {
            return Err("organization research result was not an object".to_owned());
        };
        if organization
            .get("research_sources")
            .is_none_or(Value::is_null)
        {
            organization.insert("research_sources".to_owned(), Value::Array(Vec::new()));
        }
        if let Some(config) = request.source_config.as_ref() {
            let funding_type = config.funding_type.trim();
            let known_data = organization
                .get("research_sources")
                .and_then(Value::as_array)
                .is_some_and(|sources| sources.iter().any(|source| source == "known_data"));
            if !funding_type.is_empty() && !known_data {
                organization.insert(
                    "funding_type".to_owned(),
                    Value::String(funding_type.to_lowercase()),
                );
                let sources = organization
                    .get_mut("research_sources")
                    .and_then(Value::as_array_mut)
                    .expect("research_sources normalized to an array");
                if !sources.iter().any(|source| source == "rss_config") {
                    sources.push(Value::String("rss_config".to_owned()));
                }
            }
            if let Some(site_url) = config
                .site_url
                .as_deref()
                .filter(|site_url| !site_url.trim().is_empty())
            {
                organization
                    .entry("website".to_owned())
                    .or_insert_with(|| Value::String(site_url.trim().to_owned()));
            }
        }
        let mut organization_data = Arc::new(organization_data);
        let scoring = self
            .scorer
            .score_source(WikiSourceScoringRequest {
                source_name: request.source_name.clone(),
                organization_data: Arc::clone(&organization_data),
                source_metadata: scoring_metadata(request.source_config.as_ref()),
            })
            .await
            .map_err(|error| match error {
                WikiSourceScoringError::Unavailable => {
                    "source analysis scorer is unavailable".to_owned()
                }
                WikiSourceScoringError::Failed(message) => {
                    format!("source analysis scoring failed: {message}")
                }
            })?;
        validate_source_scores(&scoring.scores).map_err(str::to_owned)?;
        apply_organization_updates(
            Arc::make_mut(&mut organization_data),
            scoring.organization_updates.as_ref(),
        )?;

        let organization_write =
            organization_write_record(&request.source_name, organization_data.as_ref())?;
        self.database
            .wiki_upsert_organization(organization_write.clone())
            .await
            .map_err(|error| format!("organization persistence failed: {error}"))?
            .ok_or_else(|| "organization persistence returned no id".to_owned())?;
        self.database
            .wiki_upsert_source_analysis_scores(
                &request.source_name,
                scoring
                    .scores
                    .into_iter()
                    .map(|score| WikiSourceAnalysisScoreInput {
                        axis_name: score.axis.as_str().to_owned(),
                        score: score.score,
                        confidence: score.confidence,
                        prose_explanation: score.prose_explanation,
                        citations: score.citations,
                        empirical_basis: score.empirical_basis,
                        scored_by: score.scored_by,
                    })
                    .collect(),
            )
            .await
            .map_err(|error| format!("source score persistence failed: {error}"))?;

        let behavior = self
            .database
            .collect_article_behavior_stats(&request.source_name, 30)
            .await
            .map_err(|error| format!("article behavior query failed: {error}"))?;
        let claims = source_claim_inputs(
            &request.source_name,
            request.source_config.as_ref(),
            organization_data.as_ref(),
            behavior.article_count,
            &behavior.top_categories,
        );
        self.database
            .wiki_sync_source_claims(&request.source_name, claims)
            .await
            .map_err(|error| format!("source claim persistence failed: {error}"))?;
        self.database
            .wiki_upsert_organization(organization_write)
            .await
            .map_err(|error| format!("organization claim refresh failed: {error}"))?;
        Ok(())
    }
}

fn apply_organization_updates(
    organization_data: &mut Value,
    updates: Option<&WikiSourceOrganizationUpdates>,
) -> Result<(), String> {
    let Some(updates) = updates else {
        return Ok(());
    };
    let Some(organization) = organization_data.as_object_mut() else {
        return Err("organization research result was not an object".to_owned());
    };
    for (field, update) in [
        ("funding_type", updates.funding_type.as_deref()),
        ("parent_org", updates.parent_org.as_deref()),
        ("media_bias_rating", updates.media_bias_rating.as_deref()),
        ("factual_reporting", updates.factual_reporting.as_deref()),
    ] {
        let Some(update) = update.filter(|value| !value.is_empty()) else {
            continue;
        };
        if organization
            .get(field)
            .is_none_or(|current| !json_truthy(current))
        {
            organization.insert(field.to_owned(), Value::String(update.to_owned()));
        }
    }
    let research_sources = organization
        .entry("research_sources".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(research_sources) = research_sources.as_array_mut() else {
        return Err("organization research_sources was not an array".to_owned());
    };
    if !research_sources
        .iter()
        .any(|source| source == "ai_inference")
    {
        research_sources.push(Value::String("ai_inference".to_owned()));
    }
    Ok(())
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

fn organization_write_record(
    source_name: &str,
    organization: &Value,
) -> Result<WikiOrganizationWriteRecord, String> {
    let name = organization
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(source_name)
        .to_owned();
    let normalized_name = organization
        .get("normalized_name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "organization research did not provide normalized_name".to_owned())?
        .to_owned();
    Ok(WikiOrganizationWriteRecord {
        name,
        normalized_name,
        org_type: json_string(organization, "org_type"),
        ownership_percentage: None,
        funding_type: json_string(organization, "funding_type"),
        funding_sources: json_value(organization, "funding_sources"),
        major_advertisers: None,
        ein: json_string(organization, "ein"),
        annual_revenue: json_string(organization, "annual_revenue"),
        top_donors: None,
        media_bias_rating: json_string(organization, "media_bias_rating"),
        factual_reporting: json_string(organization, "factual_reporting"),
        website: json_string(organization, "website"),
        wikipedia_url: json_string(organization, "wikipedia_url"),
        research_sources: json_value(organization, "research_sources"),
        research_confidence: json_string(organization, "research_confidence"),
        owned_by: json_value(organization, "owned_by"),
        parent_orgs: json_value(organization, "parent_orgs"),
        part_of: json_value(organization, "part_of"),
        subsidiaries: None,
        headquarters: json_value(organization, "headquarters"),
        inception: json_string(organization, "inception"),
        official_website: json_string(organization, "official_website"),
        cik: json_string(organization, "cik"),
        opensecrets_data: json_value(organization, "opensecrets_data"),
        conflict_flags: json_value(organization, "conflict_flags"),
        parent_org: json_string(organization, "parent_org"),
        parent_org_id: None,
    })
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn json_value(value: &Value, key: &str) -> Option<Value> {
    value.get(key).filter(|field| !field.is_null()).cloned()
}

const CLAIMS_PARSER_VERSION: &str = "source-claims/v1";

pub(crate) fn scoring_metadata(
    config: Option<&WikiSourceIndexConfig>,
) -> WikiSourceScoringMetadata {
    let Some(config) = config else {
        return WikiSourceScoringMetadata {
            source_type: "general".to_owned(),
            ..WikiSourceScoringMetadata::default()
        };
    };
    WikiSourceScoringMetadata {
        country: config.country.clone(),
        funding_type: config.funding_type.clone(),
        political_bias: config.bias_rating.clone(),
        source_type: config.category.clone(),
        site_url: config.site_url.clone().unwrap_or_default(),
    }
}

pub(crate) fn source_claim_inputs(
    source_name: &str,
    config: Option<&WikiSourceIndexConfig>,
    organization: &Value,
    article_count_30d: i64,
    top_topics_30d: &[String],
) -> Vec<WikiSourceClaimInput> {
    let mut claims = Vec::new();
    let evidence = base_evidence(source_name, config);

    let domain_value = config
        .and_then(|value| nonempty_string(value.site_url.as_deref()))
        .map(Value::String)
        .or_else(|| config.map(|value| value.url.clone()))
        .or_else(|| organization.get("website").cloned())
        .unwrap_or(Value::Null);
    if let Some(domain) = extract_domain(&domain_value) {
        claims.push(claim(
            "domain",
            json!({ "domain": domain }),
            "factual",
            0.95,
            evidence.clone(),
        ));
    }

    let feed_url = config.map(|value| &value.url).unwrap_or(&Value::Null);
    let website_url = organization
        .get("website")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    claims.push(claim(
        "source_url_guard",
        build_source_url_guard(feed_url, website_url),
        "computed",
        0.7,
        evidence.clone(),
    ));

    if let Some(config) = config {
        if !config.country.trim().is_empty() {
            claims.push(claim(
                "country",
                json!({ "country": config.country.trim() }),
                "factual",
                0.9,
                evidence.clone(),
            ));
        }
    }

    let funding_type = organization
        .get("funding_type")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            config
                .map(|value| value.funding_type.as_str())
                .filter(|value| !value.trim().is_empty())
        })
        .map(str::trim)
        .map(str::to_lowercase)
        .map(|value| {
            if value == "non-profit" {
                "nonprofit".to_owned()
            } else {
                value
            }
        });
    if let Some(funding_type) = funding_type {
        claims.push(claim(
            "funding_type",
            json!({ "funding_type": funding_type }),
            "factual",
            0.9,
            evidence.clone(),
        ));
        claims.push(claim(
            "nonprofit_status",
            json!({ "nonprofit": funding_type == "nonprofit" }),
            "factual",
            0.9,
            evidence.clone(),
        ));
    }

    let legal_name = organization
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(source_name)
        .trim();
    if !legal_name.is_empty() {
        let mut legal_evidence = evidence.clone();
        if let Some(url) = nonempty_json_string(organization.get("wikipedia_url")) {
            legal_evidence.push(evidence_item(
                "wikipedia",
                url,
                Some(source_name),
                Some("organization profile"),
            ));
        }
        claims.push(claim(
            "legal_entity_name",
            json!({ "name": legal_name }),
            "factual",
            0.85,
            legal_evidence,
        ));
    }

    if let Some(parent_name) = nonempty_json_string(organization.get("parent_org")) {
        let mut parent_evidence = evidence.clone();
        if let Some(url) = nonempty_json_string(organization.get("wikidata_url")) {
            parent_evidence.push(evidence_item(
                "wikidata",
                url,
                Some(source_name),
                Some("parent organization metadata"),
            ));
        }
        claims.push(claim(
            "parent_company",
            json!({ "name": parent_name }),
            "factual",
            0.9,
            parent_evidence,
        ));
    }

    if let Some(config) = config {
        for (value, claim_type, value_key, confidence) in [
            (
                config.bias_rating.as_str(),
                "bias_label_catalog",
                "label",
                0.6,
            ),
            (
                config.factual_reporting.as_str(),
                "factual_reporting_catalog",
                "label",
                0.65,
            ),
        ] {
            let value = value.trim();
            if !value.is_empty() {
                let mut claim_value = serde_json::Map::new();
                claim_value.insert(value_key.to_owned(), Value::String(value.to_lowercase()));
                claim_value.insert(
                    "provider".to_owned(),
                    Value::String("rss_catalog".to_owned()),
                );
                claims.push(claim(
                    claim_type,
                    Value::Object(claim_value),
                    "third_party_opinion",
                    confidence,
                    evidence.clone(),
                ));
            }
        }
    }

    let evidence_url = format!("internal://articles?source={source_name}&window=30d");
    claims.push(claim(
        "article_count_30d",
        json!({ "count": article_count_30d }),
        "computed",
        0.8,
        vec![evidence_item(
            "internal_articles_query",
            &evidence_url,
            Some(source_name),
            Some(&format!("count={article_count_30d}")),
        )],
    ));
    claims.push(claim(
        "top_topics_30d",
        json!({ "topics": top_topics_30d }),
        "computed",
        0.75,
        vec![evidence_item(
            "internal_articles_query",
            &format!("{evidence_url}&group=category"),
            Some(source_name),
            Some(&top_topics_30d.join(", ")),
        )],
    ));
    claims
}

fn claim(
    claim_type: &str,
    claim_value: Value,
    claim_kind: &str,
    confidence: f64,
    evidence: Vec<WikiSourceClaimEvidenceInput>,
) -> WikiSourceClaimInput {
    WikiSourceClaimInput {
        claim_type: claim_type.to_owned(),
        claim_value,
        claim_kind: claim_kind.to_owned(),
        confidence,
        parser_version: CLAIMS_PARSER_VERSION.to_owned(),
        evidence,
    }
}

fn base_evidence(
    source_name: &str,
    config: Option<&WikiSourceIndexConfig>,
) -> Vec<WikiSourceClaimEvidenceInput> {
    let mut evidence = Vec::new();
    if let Some(config) = config {
        match &config.url {
            Value::String(url) if !url.trim().is_empty() => evidence.push(evidence_item(
                "rss_catalog",
                url.trim(),
                Some(source_name),
                Some(&format!("rss source: {source_name}")),
            )),
            Value::Array(urls) => evidence.extend(urls.iter().filter_map(|url| {
                url.as_str()
                    .filter(|value| !value.trim().is_empty())
                    .map(|url| {
                        evidence_item(
                            "rss_catalog",
                            url.trim(),
                            Some(source_name),
                            Some(&format!("rss source: {source_name}")),
                        )
                    })
            })),
            _ => {}
        }
        if let Some(site_url) = nonempty_string(config.site_url.as_deref()) {
            evidence.push(evidence_item(
                "rss_catalog_site",
                site_url.trim(),
                Some(source_name),
                Some(&format!("site url: {source_name}")),
            ));
        }
    }
    evidence
}

fn evidence_item(
    source_type: &str,
    source_url: &str,
    source_name: Option<&str>,
    raw_excerpt: Option<&str>,
) -> WikiSourceClaimEvidenceInput {
    WikiSourceClaimEvidenceInput {
        source_type: source_type.to_owned(),
        source_name: source_name.map(str::to_owned),
        source_url: source_url.to_owned(),
        retrieved_at: None,
        raw_excerpt: raw_excerpt.map(str::to_owned),
    }
}

fn nonempty_string(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.trim().is_empty())
}

fn nonempty_json_string(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .and_then(|value| nonempty_string(Some(value)))
}

fn extract_domain(value: &Value) -> Option<String> {
    let candidate = match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim()),
        Value::Array(values) => values.iter().find_map(|item| {
            item.as_str()
                .filter(|value| !value.trim().is_empty())
                .map(str::trim)
        }),
        _ => None,
    }?;
    final_domain(candidate)
}

fn final_domain(value: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(value)
        .or_else(|_| reqwest::Url::parse(&format!("https://{value}")))
        .ok()?;
    let host = normalize_host(parsed.host_str()?);
    let host = site_host_from_google_news(&parsed).unwrap_or(host);
    let host = host
        .strip_prefix("feeds.")
        .or_else(|| host.strip_prefix("rss."))
        .unwrap_or(&host);
    (!host.is_empty()).then(|| host.to_owned())
}

fn site_host_from_google_news(url: &reqwest::Url) -> Option<String> {
    if normalize_host(url.host_str()?) != "news.google.com" {
        return None;
    }
    let query = url
        .query_pairs()
        .find_map(|(key, value)| (key == "q").then_some(value))?;
    let query = query.as_ref();
    let bytes = query.as_bytes();
    let mut start = 0;
    while start + 5 <= bytes.len() {
        if bytes[start..].get(..5)?.eq_ignore_ascii_case(b"site:") {
            let host_start = start + 5;
            let host_end = bytes[host_start..]
                .iter()
                .position(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')))
                .map_or(bytes.len(), |offset| host_start + offset);
            if host_end > host_start {
                let host = std::str::from_utf8(&bytes[host_start..host_end]).ok()?;
                return Some(normalize_host(host));
            }
        }
        start += 1;
    }
    None
}

fn extract_raw_feed_host(value: &Value) -> Option<String> {
    let first = match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim()),
        Value::Array(values) => values.iter().find_map(|item| {
            item.as_str()
                .filter(|value| !value.trim().is_empty())
                .map(str::trim)
        }),
        _ => None,
    }?;
    let url = reqwest::Url::parse(first).ok()?;
    url.host_str().map(normalize_host)
}

fn build_source_url_guard(feed_urls: &Value, website_url: Option<&str>) -> Value {
    let raw_feed_host = extract_raw_feed_host(feed_urls);
    let configured_host = extract_domain(feed_urls);
    let website_host = website_url.and_then(|value| final_domain(value));
    let mut status = "unknown";
    let mut reason = None;
    if let (Some(configured_host), Some(website_host)) = (&configured_host, &website_host) {
        let is_aggregator = raw_feed_host.as_deref().is_some_and(|host| {
            ["news.google.com", "feedproxy.google.com", "feedburner.com"].contains(&host)
        });
        if is_aggregator {
            if hosts_match(configured_host, website_host) {
                status = "ok";
                reason = Some("site_scoped_aggregator_matches_inferred_website");
            } else {
                status = "mismatch";
                reason = Some("configured_feed_is_aggregator");
            }
        } else if hosts_match(configured_host, website_host) {
            status = "ok";
            reason = Some("configured_host_matches_inferred_website");
        } else {
            status = "mismatch";
            reason = Some("configured_host_differs_from_inferred_website");
        }
    }
    json!({
        "status": status,
        "feed_host": raw_feed_host,
        "configured_host": configured_host,
        "website_host": website_host,
        "reason": reason,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use thesis_api::wiki_indexing::WikiSourceIndexConfig;

    use super::{scoring_metadata, source_claim_inputs};

    fn config() -> WikiSourceIndexConfig {
        WikiSourceIndexConfig {
            url: json!("https://feeds.example.com/news.xml"),
            site_url: Some("https://www.example.com".to_owned()),
            country: "US".to_owned(),
            funding_type: "Non-profit".to_owned(),
            bias_rating: "Center".to_owned(),
            category: "newspaper".to_owned(),
            factual_reporting: "High".to_owned(),
        }
    }

    fn find<'a>(claims: &'a [thesis_db::WikiSourceClaimInput], name: &str) -> &'a Value {
        &claims
            .iter()
            .find(|claim| claim.claim_type == name)
            .expect("expected claim")
            .claim_value
    }

    #[test]
    fn source_claims_keep_catalog_research_and_behavior_evidence() {
        let source_config = config();
        let organization = json!({
            "name": "Example News Group",
            "website": "https://www.example.com/",
            "funding_type": "non-profit",
            "parent_org": "Example Holdings",
            "wikipedia_url": "https://en.wikipedia.org/wiki/Example_News",
            "wikidata_url": "https://www.wikidata.org/wiki/Q123",
        });
        let claims = source_claim_inputs(
            "Example News",
            Some(&source_config),
            &organization,
            42,
            &["Politics".to_owned(), "World".to_owned()],
        );

        assert_eq!(find(&claims, "domain"), &json!({ "domain": "example.com" }));
        assert_eq!(
            find(&claims, "source_url_guard"),
            &json!({
                "status": "ok",
                "feed_host": "feeds.example.com",
                "configured_host": "example.com",
                "website_host": "example.com",
                "reason": "configured_host_matches_inferred_website"
            })
        );
        assert_eq!(
            find(&claims, "funding_type"),
            &json!({ "funding_type": "nonprofit" })
        );
        assert_eq!(
            find(&claims, "nonprofit_status"),
            &json!({ "nonprofit": true })
        );
        assert_eq!(
            find(&claims, "parent_company"),
            &json!({ "name": "Example Holdings" })
        );
        assert_eq!(find(&claims, "article_count_30d"), &json!({ "count": 42 }));
        assert_eq!(
            find(&claims, "top_topics_30d"),
            &json!({ "topics": ["Politics", "World"] })
        );

        let domain = claims
            .iter()
            .find(|claim| claim.claim_type == "domain")
            .expect("domain claim");
        assert_eq!(domain.evidence.len(), 2);
        assert!(domain
            .evidence
            .iter()
            .any(|item| item.source_type == "rss_catalog_site"));
        assert!(claims
            .iter()
            .any(|claim| claim.claim_type == "factual_reporting_catalog"));
    }

    #[test]
    fn unknown_sources_use_fastapi_general_metadata_and_no_catalog_claims() {
        assert_eq!(
            scoring_metadata(None).source_type,
            "general",
            "unknown source config falls back to category=general"
        );
        let claims = source_claim_inputs("Unknown Outlet", None, &json!({}), 0, &[]);
        assert!(claims
            .iter()
            .any(|claim| claim.claim_type == "legal_entity_name"));
        assert!(claims
            .iter()
            .any(|claim| claim.claim_type == "source_url_guard"));
        assert!(!claims.iter().any(|claim| claim.claim_type == "country"));
        assert!(!claims
            .iter()
            .any(|claim| claim.claim_type == "bias_label_catalog"));
        assert_eq!(
            find(&claims, "source_url_guard"),
            &json!({
                "status": "unknown",
                "feed_host": null,
                "configured_host": null,
                "website_host": null,
                "reason": null
            })
        );
    }
}
const RSS_SOURCE_CATALOG: &str = include_str!("../../../../../app/data/rss_sources.json");
const WIKIDATA_SPARQL_ENDPOINT: &str = "https://query.wikidata.org/sparql";
const WIKIMEDIA_USER_AGENT: &str =
    "ScoopNewsBot/1.0 (https://github.com/anomalyco/Thesis; wikipedia:en; User:BenderFendor)";
const REPORTER_INDEX_DELAY: Duration = Duration::from_millis(300);

impl WikiIndexer for WikiIndexerProvider {
    fn index_source(
        &self,
        request: WikiSourceIndexRequest,
    ) -> WikiIndexFuture<Result<bool, WikiIndexError>> {
        let provider = self.clone();
        Box::pin(async move { provider.index_source(request).await })
    }

    fn index_reporters(
        &self,
        request: WikiReporterIndexRequest,
    ) -> WikiIndexFuture<Result<WikiReporterIndexResult, WikiIndexError>> {
        let provider = self.clone();
        Box::pin(async move { provider.index_reporters_work(request).await })
    }
}

impl WikiIndexerProvider {
    async fn index_reporters_work(
        &self,
        request: WikiReporterIndexRequest,
    ) -> Result<WikiReporterIndexResult, WikiIndexError> {
        let sparql_seed = if request.mode == WikiReporterIndexMode::Unresolved {
            empty_reporter_phase(None)
        } else {
            self.seed_reporters_from_wikidata().await?
        };
        let unresolved_author_index = if request.mode == WikiReporterIndexMode::Sparql {
            empty_reporter_phase(Some(0))
        } else {
            self.index_unresolved_reporters(request.limit).await?
        };
        Ok(WikiReporterIndexResult {
            sparql_seed,
            unresolved_author_index,
        })
    }

    async fn seed_reporters_from_wikidata(&self) -> Result<WikiReporterIndexPhase, WikiIndexError> {
        let pairs = self.fetch_wikidata_journalist_pairs().await?;
        let total = pairs.len();
        let mut resolved = 0_i64;
        let mut failed = 0_i64;
        for (index, (name, employer)) in pairs.iter().enumerate() {
            let entity_name = reporter_resolver_key(name, Some(employer));
            let result = self
                .seed_reporter_from_wikidata_pair(name, employer, &entity_name)
                .await;
            let skipped = matches!(&result, Ok(SeedReporterResult::Skipped));
            match result {
                Ok(_) => resolved += 1,
                Err(error) => {
                    self.persist_reporter_status(&entity_name, "failed", Some(&error))
                        .await?;
                    failed += 1;
                }
            }
            if index + 1 < total && !skipped {
                tokio::time::sleep(REPORTER_INDEX_DELAY).await;
            }
        }
        Ok(WikiReporterIndexPhase {
            total: i64::try_from(total).unwrap_or(i64::MAX),
            resolved,
            failed,
            skipped: None,
            completed_at: Some(utc_timestamp()),
        })
    }

    async fn seed_reporter_from_wikidata_pair(
        &self,
        name: &str,
        employer: &str,
        entity_name: &str,
    ) -> Result<SeedReporterResult, String> {
        let resolver_key = reporter_resolver_key(name, Some(employer));
        if self
            .database
            .reporter_by_resolver_key(&resolver_key)
            .await
            .map_err(|error| format!("existing reporter lookup failed: {error}"))?
            .is_some_and(|reporter| reporter.match_status.as_deref() == Some("matched"))
        {
            return Ok(SeedReporterResult::Skipped);
        }

        let profile = self
            .entity_research
            .profile_reporter(ReporterProfileRequest {
                name: name.to_owned(),
                organization: Some(employer.to_owned()),
                article_context: None,
            })
            .await
            .map_err(|error| format!("reporter research failed: {error:?}"))?
            .value;
        if profile.match_status.as_deref() != Some("matched") {
            return Ok(SeedReporterResult::Resolved);
        }

        let articles = self
            .database
            .wiki_author_byline_articles(name, Some(employer))
            .await
            .map_err(|error| format!("reporter byline query failed: {error}"))?;
        let profile_record = reporter_profile_write_record(&profile, Some(employer));
        let reporter_id = self
            .database
            .wiki_upsert_reporter_profile(profile_record)
            .await
            .map_err(|error| format!("reporter profile persistence failed: {error}"))?;
        self.insert_reporter_article_links(reporter_id, &articles, 0.8)
            .await
            .map_err(|error| format!("reporter article links failed: {error}"))?;
        self.persist_reporter_status(entity_name, "complete", None)
            .await
            .map_err(|error| format!("reporter completion status failed: {error}"))?;
        Ok(SeedReporterResult::Resolved)
    }

    async fn index_unresolved_reporters(
        &self,
        limit: i64,
    ) -> Result<WikiReporterIndexPhase, WikiIndexError> {
        let candidates = self
            .database
            .wiki_unresolved_author_candidates(limit, None)
            .await
            .map_err(|error| {
                WikiIndexError::Failed(format!("unresolved reporter query failed: {error}"))
            })?;
        let total = candidates.len();
        let mut resolved = 0_i64;
        let mut failed = 0_i64;
        let mut skipped = 0_i64;
        for (index, candidate) in candidates.iter().enumerate() {
            match self.index_unresolved_reporter(candidate).await {
                Ok(UnresolvedReporterResult::Resolved) => resolved += 1,
                Ok(UnresolvedReporterResult::Skipped) => skipped += 1,
                Err(error) => {
                    let entity_name = reporter_resolver_key(
                        &candidate.author_name,
                        candidate.source_name.as_deref(),
                    );
                    self.persist_reporter_status(&entity_name, "failed", Some(&error))
                        .await?;
                    failed += 1;
                }
            }
            if index + 1 < total {
                tokio::time::sleep(REPORTER_INDEX_DELAY).await;
            }
        }
        Ok(WikiReporterIndexPhase {
            total: i64::try_from(total).unwrap_or(i64::MAX),
            resolved,
            failed,
            skipped: Some(skipped),
            completed_at: Some(utc_timestamp()),
        })
    }

    async fn index_unresolved_reporter(
        &self,
        candidate: &WikiUnresolvedAuthorCandidate,
    ) -> Result<UnresolvedReporterResult, String> {
        let author_name = candidate.author_name.trim();
        let source_name = candidate
            .source_name
            .as_deref()
            .filter(|source| !source.trim().is_empty());
        let entity_name = reporter_resolver_key(author_name, source_name);
        self.persist_reporter_status(&entity_name, "indexing", None)
            .await
            .map_err(|error| format!("reporter indexing status failed: {error}"))?;

        if let Some(authors) = split_composite_byline(author_name) {
            let articles = candidate.articles.as_slice();
            for author in authors {
                let normalized_name = normalize_reporter_name(&author);
                let reporter_id = self
                    .database
                    .wiki_get_or_create_split_reporter(&author, &normalized_name)
                    .await
                    .map_err(|error| format!("split reporter persistence failed: {error}"))?;
                self.insert_reporter_article_links(reporter_id, articles, 0.8)
                    .await
                    .map_err(|error| format!("split reporter article links failed: {error}"))?;
            }
            self.persist_reporter_status(&entity_name, "complete", None)
                .await
                .map_err(|error| format!("split reporter completion status failed: {error}"))?;
            return Ok(UnresolvedReporterResult::Resolved);
        }

        let profile = self
            .entity_research
            .profile_reporter(ReporterProfileRequest {
                name: author_name.to_owned(),
                organization: source_name.map(str::to_owned),
                article_context: None,
            })
            .await
            .map_err(|error| format!("reporter research failed: {error:?}"))?
            .value;
        let articles = candidate.articles.as_slice();

        let (profile_record, resolved) = if profile.match_status.as_deref() == Some("matched") {
            (reporter_profile_write_record(&profile, source_name), true)
        } else {
            (
                local_byline_profile_record(author_name, source_name, articles),
                false,
            )
        };
        let reporter_id = self
            .database
            .wiki_upsert_reporter_profile(profile_record)
            .await
            .map_err(|error| format!("reporter profile persistence failed: {error}"))?;
        self.insert_reporter_article_links(reporter_id, articles, 0.8)
            .await
            .map_err(|error| format!("reporter article links failed: {error}"))?;
        self.persist_reporter_status(&entity_name, "complete", None)
            .await
            .map_err(|error| format!("reporter completion status failed: {error}"))?;
        Ok(if resolved {
            UnresolvedReporterResult::Resolved
        } else {
            UnresolvedReporterResult::Skipped
        })
    }

    async fn insert_reporter_article_links(
        &self,
        reporter_id: i64,
        articles: &[WikiUnresolvedAuthorArticle],
        confidence: f64,
    ) -> Result<(), sqlx::Error> {
        if !articles.is_empty() {
            let links = articles
                .iter()
                .map(|article| WikiArticleAuthorLinkInput {
                    article_id: article.article_id,
                    author_role: "author".to_owned(),
                    author_confidence: Some(confidence),
                    observation_source: Some("rss_byline".to_owned()),
                    author_url_raw: article.author_url_raw.clone(),
                })
                .collect();
            self.database
                .wiki_insert_article_author_links(reporter_id, links)
                .await?;
        }
        self.database
            .wiki_refresh_reporter_article_count(reporter_id)
            .await?;
        Ok(())
    }

    async fn persist_reporter_status(
        &self,
        entity_name: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), WikiIndexError> {
        self.database
            .wiki_upsert_index_status("reporter", entity_name, status, error_message, None)
            .await
            .map_err(|error| {
                WikiIndexError::Failed(format!("reporter status persistence failed: {error}"))
            })?;
        Ok(())
    }

    async fn fetch_wikidata_journalist_pairs(
        &self,
    ) -> Result<Vec<(String, String)>, WikiIndexError> {
        let employer_names = rss_catalog_employer_names()?;
        let mut pairs = Vec::new();
        let mut seen = HashSet::new();
        for batch in employer_names.chunks(20) {
            let quoted_names = batch
                .iter()
                .map(|employer| serde_json::to_string(employer))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| {
                    WikiIndexError::Failed(format!("SPARQL employer encoding failed: {error}"))
                })?;
            let query = format!(
                "SELECT DISTINCT ?journalist ?journalistLabel ?employerLabel ?twitter ?beatLabel WHERE {{ \
                 VALUES ?employerLabel {{ {} }} \
                 ?journalist wdt:P106 wd:Q1930187 . \
                 ?journalist wdt:P108 ?employer . \
                 ?employer rdfs:label ?employerLabel . \
                 FILTER(LANG(?employerLabel) = \"en\") \
                 SERVICE wikibase:label {{ bd:serviceParam wikibase:language \"en\". }} \
                 OPTIONAL {{ ?journalist wdt:P2002 ?twitter . }} \
                 OPTIONAL {{ ?journalist wdt:P101 ?beat . ?beat rdfs:label ?beatLabel . FILTER(LANG(?beatLabel) = \"en\") }} \
                 }}",
                quoted_names.join(" ")
            );
            let response = self
                .http
                .get(WIKIDATA_SPARQL_ENDPOINT)
                .query(&[("format", "json"), ("query", query.as_str())])
                .header(reqwest::header::ACCEPT, "application/json")
                .header(reqwest::header::USER_AGENT, WIKIMEDIA_USER_AGENT)
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .map_err(|error| {
                    WikiIndexError::Failed(format!("Wikidata SPARQL request failed: {error}"))
                })?;
            if response.status() != reqwest::StatusCode::OK {
                continue;
            }
            let data = response.json::<Value>().await.map_err(|error| {
                WikiIndexError::Failed(format!(
                    "Wikidata SPARQL response was invalid JSON: {error}"
                ))
            })?;
            if !data.is_object() {
                return Err(WikiIndexError::Failed(
                    "Wikidata SPARQL response was not an object".to_owned(),
                ));
            }
            let bindings = data
                .get("results")
                .and_then(|results| results.get("bindings"))
                .and_then(Value::as_array);
            for binding in bindings.into_iter().flatten() {
                let name = binding
                    .pointer("/journalistLabel/value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim();
                let employer = binding
                    .pointer("/employerLabel/value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim();
                if !name.is_empty()
                    && !employer.is_empty()
                    && seen.insert((name.to_owned(), employer.to_owned()))
                {
                    pairs.push((name.to_owned(), employer.to_owned()));
                }
            }
        }
        Ok(pairs)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SeedReporterResult {
    Resolved,
    Skipped,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum UnresolvedReporterResult {
    Resolved,
    Skipped,
}

fn empty_reporter_phase(skipped: Option<i64>) -> WikiReporterIndexPhase {
    WikiReporterIndexPhase {
        total: 0,
        resolved: 0,
        failed: 0,
        skipped,
        completed_at: None,
    }
}

fn utc_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
}

fn rss_catalog_employer_names() -> Result<Vec<String>, WikiIndexError> {
    let catalog = serde_json::from_str::<serde_json::Map<String, Value>>(RSS_SOURCE_CATALOG)
        .map_err(|error| {
            WikiIndexError::Failed(format!("RSS source catalog is invalid JSON: {error}"))
        })?;
    let mut seen = HashSet::new();
    let mut employer_names = Vec::new();
    for name in catalog.keys() {
        let employer = name.split(" - ").next().unwrap_or(name).trim();
        if employer.chars().count() > 2 && seen.insert(employer.to_owned()) {
            employer_names.push(employer.to_owned());
        }
    }
    employer_names.sort();
    Ok(employer_names)
}

fn normalize_reporter_name(name: &str) -> String {
    name.trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn reporter_resolver_key(name: &str, context: Option<&str>) -> String {
    let cleaned = name.trim();
    let name = cleaned
        .get(..3)
        .filter(|prefix| prefix.eq_ignore_ascii_case("by "))
        .map(|_| &cleaned[3..])
        .unwrap_or(cleaned);
    let normalized = name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let suffix = context.unwrap_or_default().trim().to_lowercase();
    if suffix.is_empty() {
        normalized
    } else {
        format!("{normalized}::{suffix}")
    }
}

fn reporter_profile_write_record(
    profile: &ReporterProfileResponse,
    organization: Option<&str>,
) -> WikiReporterProfileWriteRecord {
    let name = profile.name.trim();
    WikiReporterProfileWriteRecord {
        name: if name.is_empty() {
            profile
                .canonical_name
                .as_deref()
                .unwrap_or_default()
                .to_owned()
        } else {
            name.to_owned()
        },
        normalized_name: profile
            .normalized_name
            .clone()
            .or_else(|| Some(normalize_reporter_name(&profile.name))),
        resolver_key: Some(reporter_resolver_key(&profile.name, organization)),
        raw_name: Some(profile.name.clone()),
        bio: profile.bio.clone(),
        career_history: profile
            .career_history
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        topics: profile.topics.clone().unwrap_or_default(),
        education: profile
            .education
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        political_leaning: profile.political_leaning.clone(),
        leaning_confidence: profile.leaning_confidence.clone(),
        leaning_sources: profile
            .leaning_sources
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        twitter_handle: profile.twitter_handle.clone(),
        linkedin_url: profile.linkedin_url.clone(),
        wikipedia_url: profile.wikipedia_url.clone(),
        wikidata_qid: profile.wikidata_qid.clone(),
        wikidata_url: profile.wikidata_url.clone(),
        canonical_name: profile.canonical_name.clone(),
        match_status: profile.match_status.clone(),
        overview: profile.overview.clone(),
        dossier_sections: profile
            .dossier_sections
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        citations: profile
            .citations
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        search_links: profile
            .search_links
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        match_explanation: profile.match_explanation.clone(),
        research_sources: profile
            .research_sources
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok()),
        research_confidence: profile.research_confidence.clone(),
        littlesis_url: None,
        article_count: None,
        last_article_at: None,
        canonical_author_url: None,
        author_page_url: None,
        confidence_tier: None,
        confidence_score: None,
        claims_count: None,
        institutional_affiliations: None,
    }
}

fn local_byline_profile_record(
    author_name: &str,
    source_name: Option<&str>,
    articles: &[WikiUnresolvedAuthorArticle],
) -> WikiReporterProfileWriteRecord {
    let name = author_name.trim();
    let article_urls = articles
        .iter()
        .filter(|article| !article.url.trim().is_empty())
        .take(5)
        .map(|article| article.url.clone())
        .collect::<Vec<_>>();
    let mut topics = articles
        .iter()
        .filter_map(|article| article.category.as_deref())
        .map(str::trim)
        .filter(|topic| !topic.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    topics.sort();
    topics.dedup();
    let article_items = articles
        .iter()
        .take(10)
        .map(|article| {
            json!({
                "label": "Local article evidence",
                "value": article.title,
                "sources": [article.url],
                "category": article.category,
                "published_at": article.published_at.format("%Y-%m-%dT%H:%M:%S%.f").to_string(),
            })
        })
        .collect::<Vec<_>>();
    let source_items = source_name
        .map(|source| {
            vec![json!({
                "label": "Observed outlet",
                "value": source,
                "sources": [],
            })]
        })
        .unwrap_or_default();
    let identity_items = vec![
        json!({ "label": "Name", "value": name, "sources": article_urls }),
        json!({
            "label": "Match",
            "value": "No unambiguous public entity match was found; this profile is grounded in RSS bylines and local article records.",
            "sources": article_urls,
        }),
    ];
    let author_page_url = articles
        .iter()
        .filter_map(|article| article.author_url_raw.as_deref())
        .find(|url| is_http_url(url))
        .map(str::to_owned);
    let latest_article_at = articles
        .iter()
        .take(10)
        .map(|article| article.published_at)
        .max();
    let article_count = i32::try_from(articles.len()).unwrap_or(i32::MAX);
    let overview = match source_name {
        Some(source) if !source.is_empty() => {
            format!("{name} appears as an RSS/local-corpus byline for {source}.")
        }
        _ => format!("{name} appears as an RSS/local-corpus byline."),
    };
    let career_history = source_name.map(|source| {
        json!([{
            "organization": source,
            "role": "byline outlet",
            "source": "rss_catalog",
        }])
    });
    let dossier_sections = json!([
        { "id": "identity", "title": "Identity", "status": "available", "items": identity_items },
        { "id": "source_context", "title": "Source Context", "status": if source_items.is_empty() { "missing" } else { "available" }, "items": source_items },
        { "id": "online_presence", "title": "Online Presence", "status": "missing", "items": [] },
        { "id": "article_evidence", "title": "Article Evidence", "status": if article_items.is_empty() { "missing" } else { "available" }, "items": article_items },
        { "id": "official_author_records", "title": "Official Author Records", "status": if author_page_url.is_some() { "available" } else { "missing" }, "items": author_page_url.as_ref().map(|url| vec![json!({ "label": "Observed author page URL", "value": url, "sources": [url] })]).unwrap_or_default() },
    ]);
    let citations = article_urls
        .iter()
        .map(|url| json!({ "label": "Local article evidence", "url": url }))
        .collect::<Vec<_>>();
    WikiReporterProfileWriteRecord {
        name: name.to_owned(),
        normalized_name: Some(normalize_reporter_name(name)),
        resolver_key: Some(reporter_resolver_key(name, source_name)),
        raw_name: Some(author_name.to_owned()),
        bio: None,
        career_history,
        topics,
        education: Some(json!([])),
        political_leaning: None,
        leaning_confidence: None,
        leaning_sources: Some(json!([])),
        twitter_handle: None,
        linkedin_url: None,
        wikipedia_url: None,
        wikidata_qid: None,
        wikidata_url: None,
        canonical_name: Some(name.to_owned()),
        match_status: Some("local_byline".to_owned()),
        overview: Some(overview),
        dossier_sections: Some(dossier_sections),
        citations: Some(json!(citations)),
        search_links: Some(json!({})),
        match_explanation: Some(
            "Stored as a local byline profile because public entity matching was absent or ambiguous."
                .to_owned(),
        ),
        research_sources: Some(json!(["rss_byline", "local_article_corpus"])),
        research_confidence: Some(if articles.is_empty() {
            "low".to_owned()
        } else {
            "medium".to_owned()
        }),
        littlesis_url: None,
        article_count: Some(article_count),
        last_article_at: latest_article_at,
        canonical_author_url: author_page_url.clone(),
        author_page_url,
        confidence_tier: None,
        confidence_score: None,
        claims_count: None,
        institutional_affiliations: None,
    }
}

fn is_http_url(value: &str) -> bool {
    reqwest::Url::parse(value)
        .ok()
        .is_some_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

fn split_composite_byline(raw: &str) -> Option<Vec<String>> {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    let mut parts = split_byline_delimiters(&text);
    if parts.len() < 2 {
        return None;
    }
    if parts
        .last()
        .is_some_and(|part| is_agency_segment(part.trim()))
    {
        parts.pop();
    }
    if parts.len() >= 2 {
        let last = split_comma_parts(parts.last().copied().unwrap_or_default());
        if last.len() >= 2 && is_agency_segment(last.last().unwrap_or(&"")) {
            parts.pop();
            parts.push(last[0]);
        }
    }
    let mut authors = Vec::new();
    for part in parts {
        let comma_parts = split_comma_parts(part);
        if comma_parts.len() > 1 && comma_parts.iter().all(|name| looks_like_person_name(name)) {
            authors.extend(comma_parts.into_iter().map(str::to_owned));
        } else {
            authors.push(part.trim().to_owned());
        }
    }
    (authors.len() > 1).then_some(authors)
}

fn split_byline_delimiters(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (index, ch) in text.char_indices() {
        if ch == '&' {
            parts.push(text[start..index].trim());
            start = index + ch.len_utf8();
            continue;
        }
        if !ch.eq_ignore_ascii_case(&'a') {
            continue;
        }
        let Some(token) = text.get(index..index.saturating_add(3)) else {
            continue;
        };
        if !token.eq_ignore_ascii_case("and") {
            continue;
        }
        let before_is_space = text[..index]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace);
        let after = index + 3;
        let after_is_space = text[after..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace);
        if before_is_space && after_is_space {
            parts.push(text[start..index].trim());
            start = after;
        }
    }
    parts.push(text[start..].trim());
    parts.into_iter().filter(|part| !part.is_empty()).collect()
}

fn split_comma_parts(value: &str) -> Vec<&str> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn is_agency_segment(value: &str) -> bool {
    matches!(
        value.to_lowercase().as_str(),
        "associated press"
            | "ap"
            | "reuters"
            | "afp"
            | "agence france-presse"
            | "agence france-press"
            | "bloomberg"
            | "bloomberg news"
            | "agencies"
            | "staff"
            | "guardian staff"
    )
}

fn looks_like_person_name(value: &str) -> bool {
    let tokens = value.split_whitespace().collect::<Vec<_>>();
    !tokens.is_empty()
        && tokens.len() <= 4
        && tokens.iter().all(|token| {
            let mut characters = token.chars();
            characters
                .next()
                .is_some_and(|first| first.is_ascii_uppercase())
                && characters.all(|character| {
                    character.is_ascii_alphabetic() || matches!(character, '\'' | '.' | '-')
                })
        })
}

#[cfg(test)]
mod reporter_indexer_tests {
    use chrono::NaiveDate;

    use super::{
        is_agency_segment, local_byline_profile_record, looks_like_person_name,
        normalize_reporter_name, reporter_resolver_key, rss_catalog_employer_names,
        split_composite_byline,
    };
    use thesis_db::WikiUnresolvedAuthorArticle;

    #[test]
    fn catalog_employers_collapse_sections_then_sort() {
        let employers = rss_catalog_employer_names().expect("parse bundled catalog");
        assert!(employers.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(employers.iter().any(|employer| employer == "BBC"));
        assert!(!employers.iter().any(|employer| employer == "BBC News"));
    }

    #[test]
    fn reporter_resolver_key_normalizes_byline_and_context() {
        assert_eq!(
            reporter_resolver_key("  By  Alice   Smith ", Some(" Example News ")),
            "alice smith::example news"
        );
        assert_eq!(normalize_reporter_name(" Alice   Smith "), "alice smith");
    }

    #[test]
    fn composite_byline_splits_only_when_separator_is_present() {
        assert_eq!(
            split_composite_byline("Alice Smith and Bob Jones, Associated Press"),
            Some(vec!["Alice Smith".to_owned(), "Bob Jones".to_owned()])
        );
        assert_eq!(
            split_composite_byline("Alice Smith, Bob Jones and Charlie Smith"),
            Some(vec![
                "Alice Smith".to_owned(),
                "Bob Jones".to_owned(),
                "Charlie Smith".to_owned()
            ])
        );
        assert_eq!(split_composite_byline("Alice Smith, Bob Jones"), None);
        assert_eq!(split_composite_byline("Alice Smith, Staff"), None);
        assert!(!looks_like_person_name("Alice Smith, Editor"));
        assert!(is_agency_segment("Associated Press"));
    }

    #[test]
    fn local_profile_uses_only_observed_articles_and_author_links() {
        let article = WikiUnresolvedAuthorArticle {
            article_id: 17,
            title: "Observed headline".to_owned(),
            url: "https://example.com/story".to_owned(),
            published_at: NaiveDate::from_ymd_opt(2025, 2, 3)
                .unwrap()
                .and_hms_opt(4, 5, 6)
                .unwrap(),
            category: Some("World".to_owned()),
            author_url_raw: Some("https://example.com/author/alice".to_owned()),
        };
        let profile = local_byline_profile_record("Alice Smith", Some("Example News"), &[article]);
        assert_eq!(profile.match_status.as_deref(), Some("local_byline"));
        assert_eq!(profile.topics, ["World"]);
        assert_eq!(profile.article_count, Some(1));
        assert_eq!(
            profile.author_page_url.as_deref(),
            Some("https://example.com/author/alice")
        );
        let sections = profile.dossier_sections.expect("local evidence sections");
        assert_eq!(sections[3]["items"][0]["value"], "Observed headline");
    }
}
