use std::collections::{BTreeMap, BTreeSet};

use reqwest::Url;
use serde_json::{json, Value};
use thesis_api::entity_research::{
    JsonObject, OrganizationResearchResponse, SourceResearchRequest, SourceResearchResponse,
    SourceResearchValue, StringMap,
};
use thesis_db::Database;
use thesis_ingest::cleaner::clean_html;

use crate::providers::SafeHttpFetcher;

use super::http::{api_url, get_html, get_json, get_text, site_url};
use super::organization::research_organization;

const ADS_TXT_MAX_RECORDS: usize = 200_000;
const SELLERS_JSON_MAX_SYSTEMS: usize = 8;

pub(super) async fn research_source(
    fetcher: &SafeHttpFetcher,
    _database: &Database,
    request: SourceResearchRequest,
) -> SourceResearchResponse {
    let name = request.name.trim().to_owned();
    let facts = research_organization(fetcher, name.clone(), request.website.clone()).await;
    let organization = facts.response;
    let official_website = organization
        .website
        .clone()
        .or_else(|| organization.official_website.clone())
        .or(request.website);
    let evidence = fetch_official_evidence(fetcher, official_website.as_deref()).await;
    let about_page = evidence
        .official_pages
        .iter()
        .find(|page| page.label == "about");
    let wikipedia_description = facts
        .description
        .as_deref()
        .filter(|description| !description.trim().is_empty());
    let citation_sources = unique_strings([
        organization.wikipedia_url.as_deref(),
        organization.wikidata_url.as_deref(),
        official_website.as_deref(),
        about_page.map(|page| page.url.as_str()),
    ]);
    let mut fields = build_fields(
        &organization,
        wikipedia_description,
        official_website.as_deref(),
        &evidence,
        about_page,
        &citation_sources,
    );
    let fallback = fallback_overview(&name, &organization);
    if fields
        .get("overview")
        .is_none_or(|items| items.iter().all(|item| item.value.is_empty()))
    {
        if let Some(fallback) = fallback.as_deref() {
            add_field(
                &mut fields,
                "overview",
                "Profile summary",
                fallback,
                &citation_sources,
                None,
            );
        }
    }
    let overview = wikipedia_description
        .map(str::to_owned)
        .or_else(|| about_page.map(|page| page.summary.clone()))
        .or(fallback);
    let match_status = if wikipedia_description.is_some()
        || organization.wikidata_url.is_some()
        || official_website.is_some()
    {
        "matched"
    } else {
        "none"
    };
    let citations = profile_citations(
        &citation_sources,
        official_website.as_deref(),
        organization.ein.as_deref(),
    );
    let mut search_links = StringMap::new();
    search_links.insert(
        "wikipedia".to_owned(),
        organization
            .wikipedia_url
            .clone()
            .unwrap_or_else(|| search_url("https://en.wikipedia.org/w/index.php", &name)),
    );
    search_links.insert(
        "wikidata".to_owned(),
        organization
            .wikidata_url
            .clone()
            .unwrap_or_else(|| search_url("https://www.wikidata.org/w/index.php", &name)),
    );
    search_links.insert(
        "source_search".to_owned(),
        api_url(
            "https://duckduckgo.com/",
            &[("q", &format!("{name} media outlet"))],
        ),
    );
    let wikidata_qid = organization
        .wikidata_url
        .as_deref()
        .and_then(wikidata_qid_from_url);
    let dossier_sections = source_sections(&fields);
    SourceResearchResponse {
        name: name.clone(),
        canonical_name: Some(name),
        website: official_website,
        fetched_at: Some(chrono::Utc::now().to_rfc3339()),
        cached: false,
        fields,
        key_reporters: Vec::new(),
        overview,
        match_status: Some(match_status.to_owned()),
        wikipedia_url: organization.wikipedia_url,
        wikidata_qid,
        wikidata_url: organization.wikidata_url,
        dossier_sections: Some(dossier_sections),
        citations: Some(citations),
        search_links: Some(search_links),
        match_explanation: Some(
            "Built from Wikipedia, Wikidata, official site metadata, and public-record links."
                .to_owned(),
        ),
        policy_transparency: evidence.policy_transparency.and_then(json_object),
        ads_txt: evidence.ads_txt.and_then(json_object),
        sellers_json: evidence.sellers_json.and_then(json_object),
    }
}

#[derive(Clone, Debug)]
struct OfficialPage {
    label: String,
    url: String,
    summary: String,
}

#[derive(Default)]
struct OfficialEvidence {
    official_pages: Vec<OfficialPage>,
    ads_txt: Option<Value>,
    sellers_json: Option<Value>,
    policy_transparency: Option<Value>,
}

#[derive(Clone, Debug)]
struct AdsRecord {
    domain: String,
    account_id: String,
    relationship: String,
}

async fn fetch_official_evidence(
    fetcher: &SafeHttpFetcher,
    website: Option<&str>,
) -> OfficialEvidence {
    let Some(website) = website.and_then(site_url) else {
        return OfficialEvidence::default();
    };
    let official_pages = fetch_official_pages(fetcher, &website).await;
    let (ads_txt, ads_records) = fetch_ads_txt(fetcher, &website).await;
    let sellers_json = fetch_sellers_json(fetcher, &ads_records).await;
    let policy_transparency = build_policy_summary(&official_pages);
    OfficialEvidence {
        official_pages,
        ads_txt,
        sellers_json,
        policy_transparency,
    }
}

async fn fetch_official_pages(fetcher: &SafeHttpFetcher, website: &Url) -> Vec<OfficialPage> {
    const CANDIDATES: &[(&str, &[&str])] = &[
        ("about", &["/about", "/about-us", "/about/", "/about-us/"]),
        ("masthead", &["/masthead", "/staff", "/team", "/authors"]),
        (
            "editorial_standards",
            &[
                "/editorial",
                "/editorial-policy",
                "/editorial-policies",
                "/editorial-guidelines",
                "/editorial-standards",
                "/standards",
                "/standards-and-practices",
                "/ethics",
                "/principles",
            ],
        ),
        (
            "corrections",
            &[
                "/corrections",
                "/corrections-policy",
                "/corrections-and-clarifications",
                "/clarifications",
            ],
        ),
        ("ownership", &["/ownership", "/company", "/about/ownership"]),
    ];
    let mut pages = Vec::new();
    let mut seen_urls = BTreeSet::new();
    for (label, paths) in CANDIDATES {
        for path in *paths {
            let Ok(url) = website.join(path) else {
                continue;
            };
            let Some((html, final_url)) = get_html(fetcher, url.as_str()).await else {
                continue;
            };
            let summary = clean_html(&html);
            if summary.chars().count() < 80
                || seen_urls.contains(&final_url)
                || !is_official_host(&final_url, Some(website.as_str()))
                || !official_page_url_matches(label, &final_url)
            {
                continue;
            }
            seen_urls.insert(final_url.clone());
            pages.push(OfficialPage {
                label: (*label).to_owned(),
                url: final_url,
                summary: summary.chars().take(420).collect(),
            });
            break;
        }
    }
    pages
}

fn official_page_url_matches(label: &str, url: &str) -> bool {
    let Ok(url) = Url::parse(url) else {
        return false;
    };
    let path = url.path().trim_matches('/').to_lowercase();
    let normalized: String = path
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect();
    let terms: &[&str] = match label {
        "about" => &["about", "about-us", "mission"],
        "masthead" => &["masthead", "staff", "team", "author", "people"],
        "editorial_standards" => &[
            "editorial",
            "policy",
            "policies",
            "guidelines",
            "standards",
            "ethics",
            "principles",
        ],
        "corrections" => &["correction", "clarification"],
        "ownership" => &["ownership", "company", "corporate", "who-we-are"],
        _ => return false,
    };
    terms.iter().any(|term| normalized.contains(term))
}

async fn fetch_ads_txt(
    fetcher: &SafeHttpFetcher,
    website: &Url,
) -> (Option<Value>, Vec<AdsRecord>) {
    let mut url = website.clone();
    url.set_path("/ads.txt");
    url.set_query(None);
    url.set_fragment(None);
    let Some((text, final_url)) = get_text(fetcher, url.as_str()).await else {
        return (None, Vec::new());
    };
    if !is_official_host(&final_url, Some(website.as_str())) {
        return (None, Vec::new());
    }
    let prefix = text
        .chars()
        .take(500)
        .collect::<String>()
        .to_ascii_lowercase();
    if prefix.contains("<html") || prefix.contains("<!doctype") {
        return (None, Vec::new());
    }
    let (mut summary, records) = parse_ads_txt(&text);
    let authorized_sellers = summary
        .get("authorized_sellers")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let owner_domains = summary.get("owner_domains");
    let manager_domains = summary.get("manager_domains");
    let contact = summary.get("contact");
    if authorized_sellers == 0
        && owner_domains
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
        && manager_domains
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
        && contact.and_then(Value::as_array).is_none_or(Vec::is_empty)
    {
        return (None, Vec::new());
    }
    if let Some(object) = summary.as_object_mut() {
        object.insert("url".to_owned(), Value::String(final_url));
    }
    (Some(summary), records)
}

fn parse_ads_txt(text: &str) -> (Value, Vec<AdsRecord>) {
    let mut records = Vec::new();
    let mut seen_records = BTreeSet::new();
    let mut owner_domains = Vec::new();
    let mut manager_domains = Vec::new();
    let mut contact = Vec::new();
    let mut invalid_lines = 0_i64;
    let mut duplicate_records = 0_i64;
    for line in text
        .trim_start_matches('\u{feff}')
        .lines()
        .take(ADS_TXT_MAX_RECORDS)
    {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let content = trimmed.split('#').next().unwrap_or_default().trim();
        if content.is_empty() {
            continue;
        }
        if let Some((key, value)) = content.split_once('=') {
            if !key.contains(',') {
                let values = match key.trim().to_ascii_uppercase().as_str() {
                    "OWNERDOMAIN" => &mut owner_domains,
                    "MANAGERDOMAIN" => &mut manager_domains,
                    "CONTACT" | "CONTACT-EMAIL" | "CONTACTEMAIL" => &mut contact,
                    _ => continue,
                };
                let value = value.trim();
                if !value.is_empty() && !values.iter().any(|existing| existing == value) {
                    values.push(value.to_owned());
                }
                continue;
            }
        }
        let parts: Vec<&str> = content.split(',').map(str::trim).collect();
        if parts.len() < 3 {
            invalid_lines += 1;
            continue;
        }
        let domain = parts[0].to_ascii_lowercase();
        let account_id = parts[1].to_owned();
        let relationship = parts[2].to_ascii_uppercase();
        if domain.is_empty()
            || account_id.is_empty()
            || !matches!(relationship.as_str(), "DIRECT" | "RESELLER")
        {
            invalid_lines += 1;
            continue;
        }
        if !seen_records.insert(key) {
            duplicate_records += 1;
        }
        records.push(AdsRecord {
            domain,
            account_id,
            relationship,
        });
    }
    let direct_sellers = records
        .iter()
        .filter(|record| record.relationship == "DIRECT")
        .count();
    let reseller_sellers = records
        .iter()
        .filter(|record| record.relationship == "RESELLER")
        .count();
    (
        json!({
            "authorized_sellers": records.len(),
            "direct_sellers": direct_sellers,
            "resellers": reseller_sellers,
            "duplicate_records": duplicate_records,
            "invalid_lines": invalid_lines,
            "owner_domains": owner_domains,
            "manager_domains": manager_domains,
            "contact": contact,
        }),
        records,
    )
}

async fn fetch_sellers_json(fetcher: &SafeHttpFetcher, records: &[AdsRecord]) -> Option<Value> {
    if records.is_empty() {
        return None;
    }
    let mut counts = BTreeMap::<String, usize>::new();
    for record in records {
        *counts.entry(record.domain.clone()).or_default() += 1;
    }
    let mut domains: Vec<_> = counts.into_iter().collect();
    domains.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    domains.truncate(SELLERS_JSON_MAX_SYSTEMS);

    let mut systems = Vec::new();
    for (domain, _) in domains {
        let system_records: Vec<&AdsRecord> = records
            .iter()
            .filter(|record| record.domain == domain)
            .collect();
        let Some(url) = sellers_url(&domain) else {
            systems.push(missing_seller_system(&domain, system_records.len(), None));
            continue;
        };
        let Some(data) = get_json(fetcher, &url).await else {
            systems.push(missing_seller_system(
                &domain,
                system_records.len(),
                Some(&url),
            ));
            continue;
        };
        let Some(sellers) = data.get("sellers").and_then(Value::as_array) else {
            systems.push(missing_seller_system(
                &domain,
                system_records.len(),
                Some(&url),
            ));
            continue;
        };
        let mut sellers_by_id = BTreeMap::new();
        let mut confidential_sellers = 0_i64;
        for seller in sellers {
            let Some(seller_id) = seller
                .get("seller_id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            else {
                continue;
            };
            if seller
                .get("is_confidential")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                confidential_sellers += 1;
            }
            sellers_by_id.insert(seller_id.to_owned(), seller);
        }
        let owner_domains = data
            .get("owner_domains")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let manager_domains = data
            .get("manager_domains")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut matched_records = 0_i64;
        let mut missing_seller_ids = 0_i64;
        let mut owner_domain_matches = 0_i64;
        let mut manager_domain_matches = 0_i64;
        for record in &system_records {
            let Some(seller) = sellers_by_id.get(&record.account_id) else {
                missing_seller_ids += 1;
                continue;
            };
            matched_records += 1;
            let seller_domain = seller
                .get("domain")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if supply_domain_matches(seller_domain, &owner_domains) {
                owner_domain_matches += 1;
            }
            if supply_domain_matches(seller_domain, &manager_domains) {
                manager_domain_matches += 1;
            }
        }
        systems.push(json!({
            "ad_system_domain": domain,
            "status": "available",
            "seller_count": sellers_by_id.len(),
            "confidential_sellers": confidential_sellers,
            "ads_txt_records": system_records.len(),
            "matched_records": matched_records,
            "missing_seller_ids": missing_seller_ids,
            "owner_domain_matches": owner_domain_matches,
            "manager_domain_matches": manager_domain_matches,
            "sellers_json_url": url,
        }));
    }
    if systems.is_empty() {
        return None;
    }
    let total = |key: &str| {
        systems
            .iter()
            .filter_map(|system| system.get(key).and_then(Value::as_i64))
            .sum::<i64>()
    };
    let available = systems
        .iter()
        .filter(|system| system.get("status").and_then(Value::as_str) == Some("available"))
        .count();
    Some(json!({
        "checked_ad_systems": systems.len(),
        "available_sellers_json": available,
        "checked_records": total("matched_records") + total("missing_seller_ids"),
        "matched_records": total("matched_records"),
        "missing_seller_ids": total("missing_seller_ids"),
        "owner_domain_matches": total("owner_domain_matches"),
        "manager_domain_matches": total("manager_domain_matches"),
        "systems": systems,
    }))
}

fn missing_seller_system(domain: &str, ads_txt_records: usize, url: Option<&str>) -> Value {
    json!({
        "ad_system_domain": domain,
        "status": "missing",
        "ads_txt_records": ads_txt_records,
        "sellers_json_url": url,
    })
}

fn sellers_url(domain: &str) -> Option<String> {
    if domain.is_empty() || domain.contains('/') || !domain.contains('.') {
        return None;
    }
    let url = Url::parse(&format!("https://{domain}/sellers.json")).ok()?;
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(url.to_string())
}

fn supply_domain_matches(domain: &str, declarations: &[Value]) -> bool {
    let Some(domain) = normalize_supply_domain(domain) else {
        return false;
    };
    declarations
        .iter()
        .filter_map(Value::as_str)
        .any(|declared| {
            normalize_supply_domain(declared).is_some_and(|declared| {
                domain == declared || domain.ends_with(&format!(".{declared}"))
            })
        })
}

fn normalize_supply_domain(value: &str) -> Option<String> {
    let first = value.split(',').next()?.trim().to_lowercase();
    if first.is_empty() {
        return None;
    }
    let candidate = if first.contains("://") {
        first
    } else {
        format!("https://{first}")
    };
    let url = Url::parse(&candidate).ok()?;
    url.host_str()
        .map(|host| host.trim_start_matches("www.").trim_matches('.').to_owned())
}

fn build_policy_summary(pages: &[OfficialPage]) -> Option<Value> {
    if pages.is_empty() {
        return None;
    }
    const SIGNALS: &[(&str, &str, &[&str])] = &[
        (
            "editorial_independence",
            "Editorial independence",
            &[
                "editorial independence",
                "editorially independent",
                "independent journalism",
                "independent newsroom",
            ],
        ),
        (
            "ethics_standards",
            "Ethics or standards",
            &[
                "ethics",
                "code of conduct",
                "standards",
                "accuracy",
                "fairness",
            ],
        ),
        (
            "corrections_process",
            "Corrections process",
            &[
                "correction",
                "corrections",
                "correct errors",
                "clarification",
                "clarifications",
                "update",
                "updated",
            ],
        ),
        (
            "ownership_disclosure",
            "Ownership disclosure",
            &[
                "ownership",
                "owned by",
                "parent company",
                "parent organization",
                "subsidiary",
                "subsidiaries",
            ],
        ),
        (
            "funding_disclosure",
            "Funding disclosure",
            &[
                "funded by",
                "funding",
                "donor",
                "donors",
                "grant",
                "grants",
                "advertising revenue",
            ],
        ),
        (
            "staff_or_bylines",
            "Staff or byline disclosure",
            &[
                "masthead",
                "staff",
                "author",
                "authors",
                "reporter",
                "reporters",
                "contact",
            ],
        ),
        (
            "anonymous_sources_policy",
            "Anonymous sources policy",
            &[
                "anonymous source",
                "anonymous sources",
                "unnamed source",
                "unnamed sources",
                "confidential sources",
                "on background",
            ],
        ),
        (
            "ai_or_synthetic_media_policy",
            "AI or synthetic media policy",
            &[
                "artificial intelligence",
                "generative ai",
                "ai-generated",
                "synthetic media",
            ],
        ),
        (
            "conflicts_policy",
            "Conflicts disclosure",
            &[
                "conflict of interest",
                "conflicts of interest",
                "disclosure",
                "disclosures",
                "recusal",
            ],
        ),
    ];
    let checked_pages: Vec<&OfficialPage> = pages
        .iter()
        .filter(|page| !page.url.trim().is_empty() && !page.summary.trim().is_empty())
        .collect();
    if checked_pages.is_empty() {
        return None;
    }
    let signals: Vec<Value> = SIGNALS
        .iter()
        .filter_map(|(signal_id, label, terms)| {
            let mut sources = Vec::new();
            let mut matched_terms = Vec::new();
            for page in &checked_pages {
                let normalized = normalize_text(&page.summary);
                for term in *terms {
                    if contains_phrase(&normalized, term) {
                        if !sources.contains(&page.url) {
                            sources.push(page.url.clone());
                        }
                        if !matched_terms.iter().any(|matched: &String| matched == term) {
                            matched_terms.push((*term).to_owned());
                        }
                    }
                }
            }
            (!sources.is_empty()).then(|| {
                json!({
                    "id": signal_id,
                    "label": label,
                    "status": "available",
                    "sources": sources,
                    "matched_terms": matched_terms,
                })
            })
        })
        .collect();
    Some(json!({
        "checked_pages": checked_pages.len(),
        "available_signals": signals.len(),
        "signals": signals,
    }))
}

fn normalize_text(text: &str) -> String {
    text.split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn contains_phrase(normalized_text: &str, phrase: &str) -> bool {
    let padded_text = format!(" {normalized_text} ");
    let padded_phrase = format!(" {} ", normalize_text(phrase));
    padded_text.contains(&padded_phrase)
}

fn title_case_page_label(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for word in value.split('_') {
        if !output.is_empty() {
            output.push(' ');
        }
        let mut characters = word.chars();
        if let Some(first) = characters.next() {
            output.extend(first.to_uppercase());
            output.push_str(characters.as_str());
        }
    }
    output
}

fn build_fields(
    organization: &OrganizationResearchResponse,
    description: Option<&str>,
    official_website: Option<&str>,
    evidence: &OfficialEvidence,
    about_page: Option<&OfficialPage>,
    citation_sources: &[String],
) -> BTreeMap<String, Vec<SourceResearchValue>> {
    let mut fields: BTreeMap<String, Vec<SourceResearchValue>> = [
        "overview",
        "about",
        "funding",
        "ownership",
        "affiliations",
        "founded",
        "headquarters",
        "official_website",
        "nonprofit_filings",
        "public_records",
        "transparency",
    ]
    .into_iter()
    .map(|field| (field.to_owned(), Vec::new()))
    .collect();
    if let Some(description) = description {
        let sources = organization
            .wikipedia_url
            .clone()
            .into_iter()
            .collect::<Vec<_>>();
        add_field(
            &mut fields,
            "overview",
            "Wikipedia",
            description,
            &sources,
            None,
        );
    }
    if let Some(page) = about_page {
        add_field(
            &mut fields,
            "about",
            "About page",
            &page.summary,
            std::slice::from_ref(&page.url),
            None,
        );
    }
    for page in &evidence.official_pages {
        if page.label == "about" {
            continue;
        }
        let group = match page.label.as_str() {
            "ownership" => "ownership",
            "editorial_standards" | "corrections" | "masthead" => "transparency",
            _ => "public_records",
        };
        add_field(
            &mut fields,
            group,
            &title_case_page_label(&page.label),
            &page.summary,
            std::slice::from_ref(&page.url),
            None,
        );
    }
    if let Some(website) = official_website {
        add_field(
            &mut fields,
            "official_website",
            "Official website",
            website,
            &[website.to_owned()],
            None,
        );
    }
    if let Some(funding_type) = organization.funding_type.as_deref() {
        add_field(
            &mut fields,
            "funding",
            "Funding type",
            funding_type,
            citation_sources,
            None,
        );
    }
    if !organization.funding_sources.is_empty() {
        add_field(
            &mut fields,
            "funding",
            "Funding sources",
            &organization.funding_sources.join(", "),
            citation_sources,
            None,
        );
    }
    if let Some(ads_txt) = &evidence.ads_txt {
        let count = ads_txt
            .get("authorized_sellers")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if count > 0 {
            let sources = ads_txt
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .into_iter()
                .collect::<Vec<_>>();
            add_field(
                &mut fields,
                "funding",
                "Ad supply evidence",
                &format!("{count} authorized ad sellers"),
                &sources,
                None,
            );
        }
    }
    for (label, value) in [
        (
            "Catalog bias rating",
            organization.media_bias_rating.as_deref(),
        ),
        (
            "Catalog factual reporting",
            organization.factual_reporting.as_deref(),
        ),
        ("Organization type", organization.org_type.as_deref()),
    ] {
        if let Some(value) = value {
            add_field(
                &mut fields,
                "public_records",
                label,
                value,
                citation_sources,
                None,
            );
        }
    }
    let wikidata_sources = organization
        .wikidata_url
        .clone()
        .into_iter()
        .collect::<Vec<_>>();
    let ownership_sources = unique_strings([
        organization.wikidata_url.as_deref(),
        organization.wikipedia_url.as_deref(),
    ]);
    if let Some(parent) = organization.parent_org.as_deref() {
        add_field(
            &mut fields,
            "ownership",
            "Current parent",
            parent,
            &ownership_sources,
            None,
        );
    } else {
        for owner in unique_strings(
            organization
                .owned_by
                .iter()
                .chain(organization.parent_orgs.iter())
                .map(String::as_str),
        ) {
            add_field(
                &mut fields,
                "ownership",
                "Owner",
                &owner,
                &ownership_sources,
                None,
            );
        }
    }
    for affiliation in &organization.part_of {
        add_field(
            &mut fields,
            "affiliations",
            "Affiliation",
            affiliation,
            &wikidata_sources,
            None,
        );
    }
    if let Some(inception) = organization.inception.as_deref() {
        add_field(
            &mut fields,
            "founded",
            "Founded",
            inception,
            &wikidata_sources,
            None,
        );
    }
    for headquarters in &organization.headquarters {
        add_field(
            &mut fields,
            "headquarters",
            "Headquarters",
            headquarters,
            &wikidata_sources,
            None,
        );
    }
    if let Some(ein) = organization.ein.as_deref() {
        add_field(
            &mut fields,
            "nonprofit_filings",
            "EIN",
            ein,
            &[format!(
                "https://projects.propublica.org/nonprofits/organizations/{ein}"
            )],
            None,
        );
    }
    if let Some(revenue) = organization.annual_revenue.as_deref() {
        let sources = organization
            .ein
            .as_deref()
            .map(|ein| format!("https://projects.propublica.org/nonprofits/organizations/{ein}"))
            .into_iter()
            .collect::<Vec<_>>();
        add_field(
            &mut fields,
            "nonprofit_filings",
            "Revenue",
            revenue,
            &sources,
            None,
        );
    }
    let transparency_items = transparency_fields(evidence, &fields);
    fields
        .get_mut("transparency")
        .expect("transparency field exists")
        .extend(transparency_items);
}

fn add_field(
    fields: &mut BTreeMap<String, Vec<SourceResearchValue>>,
    group: &str,
    label: &str,
    value: &str,
    sources: &[String],
    notes: Option<&str>,
) {
    if value.trim().is_empty() {
        return;
    }
    let Some(fields) = fields.get_mut(group) else {
        return;
    };
    let normalized_value = value.trim();
    if fields.iter().any(|existing| {
        existing.label.as_deref() == Some(label) && existing.value == normalized_value
    }) {
        return;
    }
    fields.push(SourceResearchValue {
        label: Some(label.to_owned()),
        value: normalized_value.to_owned(),
        sources: Some(unique_strings(sources.iter().map(String::as_str))),
        notes: notes.map(str::to_owned),
    });
}

fn source_sections(fields: &BTreeMap<String, Vec<SourceResearchValue>>) -> Vec<JsonObject> {
    const SECTIONS: &[(&str, &str, &[&str])] = &[
        (
            "overview",
            "Overview",
            &["overview", "about", "official_website"],
        ),
        ("ownership", "Ownership", &["ownership", "affiliations"]),
        ("funding", "Funding", &["funding", "nonprofit_filings"]),
        ("transparency", "Transparency", &["transparency"]),
        (
            "public_records",
            "Public Records",
            &["founded", "headquarters", "public_records"],
        ),
    ];
    SECTIONS
        .iter()
        .map(|(section_id, title, keys)| {
            let items: Vec<Value> = keys
                .iter()
                .flat_map(|key| fields.get(*key).into_iter().flatten())
                .filter(|item| !item.value.is_empty())
                .map(|item| {
                    json!({
                        "label": item.label,
                        "value": item.value,
                        "sources": item.sources,
                        "notes": item.notes,
                    })
                })
                .collect();
            serde_json::from_value(json!({
                "id": section_id,
                "title": title,
                "status": if items.is_empty() { "missing" } else { "available" },
                "items": items,
            }))
            .expect("fixed source dossier section")
        })
        .collect()
}

fn fallback_overview(name: &str, organization: &OrganizationResearchResponse) -> Option<String> {
    let mut pieces = Vec::new();
    if let Some(funding_type) = organization
        .funding_type
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pieces.push(format!("Funding model: {funding_type}."));
    }
    if let Some(parent) = organization
        .parent_org
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pieces.push(format!("Parent organization: {parent}."));
    }
    if let Some(media_bias) = organization
        .media_bias_rating
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pieces.push(format!("Catalog bias label: {media_bias}."));
    }
    if let Some(factual) = organization
        .factual_reporting
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        pieces.push(format!("Catalog factual reporting label: {factual}."));
    }
    if pieces.is_empty() {
        None
    } else {
        Some(condense(
            &format!("{name} public profile summary. {}", pieces.join(" ")),
            900,
        ))
    }
}

fn condense(value: &str, max_chars: usize) -> String {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.chars().count() <= max_chars {
        return cleaned;
    }
    let mut summary = String::new();
    for sentence in cleaned.split_inclusive(['.', '!', '?']) {
        let piece = sentence.trim();
        if piece.is_empty() {
            continue;
        }
        if !summary.is_empty() && summary.chars().count() + piece.chars().count() + 1 > max_chars {
            break;
        }
        if !summary.is_empty() {
            summary.push(' ');
        }
        summary.push_str(piece);
    }
    if summary.is_empty() {
        cleaned.chars().take(max_chars).collect::<String>() + "..."
    } else {
        summary
    }
}

fn transparency_fields(
    evidence: &OfficialEvidence,
    profile_fields: &BTreeMap<String, Vec<SourceResearchValue>>,
) -> Vec<SourceResearchValue> {
    let mut fields = Vec::new();
    const PAGE_CHECKS: &[(&str, &str, &str)] = &[
        (
            "About page",
            "about",
            "Trust/JTI-style identity signal: source publishes an about or mission page.",
        ),
        (
            "Masthead or author directory",
            "masthead",
            "Trust/JTI-style people signal: source exposes staff, team, or author information.",
        ),
        (
            "Editorial standards",
            "editorial_standards",
            "Trust/JTI-style policy signal: source exposes editorial standards, ethics, or policy information.",
        ),
        (
            "Corrections policy",
            "corrections",
            "Trust/JTI-style accountability signal: source exposes a corrections page or policy.",
        ),
        (
            "Ownership page",
            "ownership",
            "Trust/JTI-style governance signal: source exposes ownership or company information.",
        ),
    ];
    for &(label, page_label, notes) in PAGE_CHECKS {
        if let Some(page) = evidence
            .official_pages
            .iter()
            .find(|page| page.label.as_str() == page_label)
        {
            fields.push(source_value(
                label,
                "available",
                std::slice::from_ref(&page.url),
                Some(notes),
            ));
        }
    }
    let ownership_sources = field_sources(profile_fields, &["ownership", "affiliations"]);
    if !ownership_sources.is_empty() {
        fields.push(source_value(
            "Structured ownership record",
            "available",
            &ownership_sources,
            Some("Ownership or affiliation was resolved from public structured records."),
        ));
    }
    let funding_sources = field_sources(profile_fields, &["funding", "nonprofit_filings"]);
    if !funding_sources.is_empty() {
        fields.push(source_value(
            "Funding record",
            "available",
            &funding_sources,
            Some("Funding type or nonprofit filing evidence is present."),
        ));
    }
    if let Some(ads_txt) = &evidence.ads_txt {
        let url = ads_txt
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let authorized_sellers = ads_txt
            .get("authorized_sellers")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let direct = ads_txt
            .get("direct_sellers")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let resellers = ads_txt
            .get("resellers")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        fields.push(source_value(
            "ads.txt authorized sellers",
            &format!(
                "{authorized_sellers} authorized sellers ({direct} DIRECT, {resellers} RESELLER)"
            ),
            &[url.to_owned()],
            Some("IAB ads.txt signal: publisher declares authorized digital advertising sellers."),
        ));
        for (label, key, note) in [
            ("ads.txt owner domain", "owner_domains", "IAB ads.txt OWNERDOMAIN signal links publisher inventory to declared ownership domain."),
            ("ads.txt manager domain", "manager_domains", "IAB ads.txt MANAGERDOMAIN signal names the declared monetization manager."),
        ] {
            let values = ads_txt
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>();
            if !values.is_empty() {
                fields.push(source_value(label, &values.join(", "), &[url.to_owned()], Some(note)));
            }
        }
        let duplicate_records = ads_txt
            .get("duplicate_records")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let invalid_lines = ads_txt
            .get("invalid_lines")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        if duplicate_records != 0 || invalid_lines != 0 {
            fields.push(source_value(
                "ads.txt diagnostics",
                &format!("{duplicate_records} duplicate records; {invalid_lines} invalid lines"),
                &[url.to_owned()],
                Some("Local parser diagnostics for malformed or repeated ads.txt seller declarations."),
            ));
        }
    }
    if let Some(sellers_json) = &evidence.sellers_json {
        let checked = sellers_json
            .get("checked_records")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let matched = sellers_json
            .get("matched_records")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let available = sellers_json
            .get("available_sellers_json")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let checked_systems = sellers_json
            .get("checked_ad_systems")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let systems = sellers_json
            .get("systems")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let urls = systems
            .iter()
            .filter(|system| system.get("status").and_then(Value::as_str) == Some("available"))
            .filter_map(|system| system.get("sellers_json_url").and_then(Value::as_str))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        fields.push(source_value(
            "sellers.json cross-check",
            &format!("{matched}/{checked} checked ads.txt rows matched across {available}/{checked_systems} ad systems"),
            &urls,
            Some("IAB sellers.json signal: ad-system seller IDs were checked against published seller identity files."),
        ));
        let owner = sellers_json
            .get("owner_domain_matches")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let manager = sellers_json
            .get("manager_domain_matches")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        if owner > 0 || manager > 0 {
            fields.push(source_value(
                "sellers.json domain alignment",
                &format!("{owner} OWNERDOMAIN matches; {manager} MANAGERDOMAIN matches"),
                &urls,
                Some("Matched sellers.json domains are compared with ads.txt OWNERDOMAIN and MANAGERDOMAIN declarations."),
            ));
        }
    }
    if let Some(policy) = &evidence.policy_transparency {
        if let Some(signals) = policy.get("signals").and_then(Value::as_array) {
            for signal in signals {
                let sources = signal
                    .get("sources")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                if sources.is_empty() {
                    continue;
                }
                let label = signal
                    .get("label")
                    .and_then(Value::as_str)
                    .or_else(|| signal.get("id").and_then(Value::as_str))
                    .unwrap_or("Policy signal");
                let terms = signal
                    .get("matched_terms")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .take(6)
                    .collect::<Vec<_>>();
                let notes = if terms.is_empty() {
                    "Official-page policy text matched deterministic transparency terms.".to_owned()
                } else {
                    format!(
                        "Official-page policy text matched deterministic transparency terms. Terms: {}.",
                        terms.join(", ")
                    )
                };
                fields.push(source_value(
                    &format!("Policy signal: {label}"),
                    "available",
                    &sources,
                    Some(&notes),
                ));
            }
        }
    }
    fields
}
fn field_sources(
    fields: &BTreeMap<String, Vec<SourceResearchValue>>,
    groups: &[&str],
) -> Vec<String> {
    let sources = groups
        .iter()
        .flat_map(|group| fields.get(*group).into_iter().flatten())
        .flat_map(|field| field.sources.iter().flatten().cloned())
        .collect::<Vec<_>>();
    unique_strings(sources.iter().map(String::as_str))
}

fn source_value(
    label: &str,
    value: &str,
    sources: &[String],
    notes: Option<&str>,
) -> SourceResearchValue {
    SourceResearchValue {
        label: Some(label.to_owned()),
        value: value.to_owned(),
        sources: Some(unique_strings(sources.iter().map(String::as_str))),
        notes: notes.map(str::to_owned),
    }
}

fn json_object(value: Value) -> Option<JsonObject> {
    serde_json::from_value(value).ok()
}
fn profile_citations(
    candidates: &[String],
    official_website: Option<&str>,
    ein: Option<&str>,
) -> Vec<StringMap> {
    let mut urls = candidates.to_vec();
    if let Some(ein) = ein {
        urls.push(format!(
            "https://projects.propublica.org/nonprofits/organizations/{ein}"
        ));
    }
    unique_strings(urls.iter().map(String::as_str))
        .map(|url| {
            let lowered = url.to_lowercase();
            let label = if lowered.contains("wikipedia.org/") {
                "Wikipedia profile"
            } else if lowered.contains("wikidata.org/") {
                "Wikidata public record"
            } else if lowered.contains("projects.propublica.org/nonprofits/") {
                "ProPublica Nonprofit Explorer"
            } else if is_official_host(&url, official_website) {
                if official_transparency_url(&url) {
                    "Official transparency page"
                } else {
                    "Official website"
                }
            } else {
                "Public source"
            };
            BTreeMap::from([
                ("label".to_owned(), label.to_owned()),
                ("url".to_owned(), url),
            ])
        })
        .collect()
}

fn is_official_host(url: &str, official_website: Option<&str>) -> bool {
    let Some(website_host) = official_website
        .and_then(site_url)
        .and_then(|website| website.host_str().map(normalize_host))
    else {
        return false;
    };
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(normalize_host))
        .is_some_and(|host| host == website_host)
}

fn normalize_host(host: &str) -> String {
    host.strip_prefix("www.").unwrap_or(host).to_owned()
}

fn official_transparency_url(url: &str) -> bool {
    let path = Url::parse(url)
        .map(|url| url.path().to_lowercase())
        .unwrap_or_default();
    [
        "about",
        "ownership",
        "company",
        "masthead",
        "staff",
        "team",
        "editorial",
        "standards",
        "ethics",
    ]
    .iter()
    .any(|term| path.contains(term))
}

fn wikidata_qid_from_url(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if url.host_str()? != "www.wikidata.org" && url.host_str()? != "wikidata.org" {
        return None;
    }
    url.path_segments()?
        .next_back()?
        .strip_prefix('Q')
        .filter(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
        .map(|digits| format!("Q{digits}"))
}

fn unique_strings<'a>(values: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter_map(|value| {
            let value = value.trim();
            (!value.is_empty() && seen.insert(value.to_owned())).then(|| value.to_owned())
        })
        .collect()
}

fn search_url(base: &str, query: &str) -> String {
    api_url(base, &[("search", query)])
}

#[cfg(test)]
mod tests {
    use super::{
        contains_phrase, is_official_host, official_page_url_matches, parse_ads_txt, sellers_url,
        supply_domain_matches, title_case_page_label,
    };
    use serde_json::json;

    #[test]
    fn official_page_labels_use_title_case() {
        assert_eq!(
            title_case_page_label("editorial_standards"),
            "Editorial Standards"
        );
    }

    #[test]
    fn ads_txt_aggregates_records_and_suppresses_record_details() {
        let (summary, records) = parse_ads_txt(
            "example.com, 123, DIRECT, cert\nexample.net, 456, reseller\n# comment\nOWNERDOMAIN=publisher.org\nexample.com, 123, DIRECT, cert\ninvalid\n",
        );
        assert_eq!(summary["authorized_sellers"], 3);
        assert_eq!(summary["direct_sellers"], 2);
        assert_eq!(summary["resellers"], 1);
        assert_eq!(summary["duplicate_records"], 1);
        assert_eq!(summary["invalid_lines"], 1);
        assert_eq!(summary["owner_domains"], json!(["publisher.org"]));
        assert!(summary.get("records").is_none());
        assert_eq!(records.len(), 3);
    }

    #[test]
    fn seller_lookup_is_a_valid_https_host_and_domain_match_is_bounded() {
        assert_eq!(
            sellers_url("example.com").as_deref(),
            Some("https://example.com/sellers.json")
        );
        assert!(sellers_url("https://user@example.com").is_none());
        assert!(supply_domain_matches(
            "cdn.publisher.org",
            &[json!("publisher.org")]
        ));
        assert!(!supply_domain_matches(
            "notpublisher.org",
            &[json!("publisher.org")]
        ));
    }
    #[test]
    fn official_pages_require_site_host_and_classified_paths() {
        assert!(official_page_url_matches(
            "editorial_standards",
            "https://example.org/editorial-policy"
        ));
        assert!(official_page_url_matches(
            "about",
            "https://example.org/mission"
        ));
        assert!(!official_page_url_matches(
            "about",
            "https://example.org/contact"
        ));
        assert!(is_official_host(
            "https://www.example.org/about",
            Some("https://example.org")
        ));
        assert!(!is_official_host(
            "https://example.net/about",
            Some("https://example.org")
        ));
    }

    #[test]
    fn policy_phrases_use_word_boundaries() {
        assert!(contains_phrase(
            "an ethics code of conduct applies",
            "ethics"
        ));
        assert!(!contains_phrase("synthetic media", "ethic"));
    }
}
