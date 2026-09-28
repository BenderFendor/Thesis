use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use thesis_api::entity_research::OrganizationResearchResponse;

use crate::providers::SafeHttpFetcher;

use super::http::{api_url, get_json};
use super::normalize::normalize_organization_name;

const WIKIPEDIA_API: &str = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API: &str = "https://www.wikidata.org/w/api.php";
const PROPUBLICA_API: &str = "https://projects.propublica.org/nonprofits/api/v2";
const SEC_TICKERS_URL: &str = "https://www.sec.gov/files/company_tickers.json";

#[derive(Clone, Debug)]
pub(super) struct OrganizationFacts {
    pub(super) response: OrganizationResearchResponse,
    pub(super) description: Option<String>,
}

#[derive(Clone, Copy)]
struct KnownOrganization {
    key: &'static str,
    name: &'static str,
    org_type: Option<&'static str>,
    funding_type: Option<&'static str>,
    parent: Option<&'static str>,
    ownership_percentage: Option<&'static str>,
    funding_sources: &'static [&'static str],
    cik: Option<&'static str>,
    description: &'static str,
    media_bias_rating: Option<&'static str>,
    factual_reporting: Option<&'static str>,
}

const KNOWN_ORGANIZATIONS: &[KnownOrganization] = &[
    KnownOrganization {
        key: "bbc",
        name: "BBC",
        org_type: Some("public broadcaster"),
        funding_type: Some("public"),
        parent: None,
        ownership_percentage: None,
        funding_sources: &["license fee", "government grant"],
        cik: None,
        description: "British Broadcasting Corporation, UK public broadcaster",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "cnn",
        name: "CNN",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Warner Bros. Discovery"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Cable News Network, American news channel",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "fox news",
        name: "Fox News",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Fox Corporation"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American conservative news channel",
        media_bias_rating: Some("right"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "new york times",
        name: "The New York Times",
        org_type: Some("publisher"),
        funding_type: Some("commercial"),
        parent: Some("The New York Times Company"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: Some("0000071691"),
        description: "American newspaper of record",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "washington post",
        name: "The Washington Post",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Nash Holdings (Jeff Bezos)"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American newspaper based in Washington D.C.",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "npr",
        name: "NPR",
        org_type: Some("nonprofit"),
        funding_type: Some("non-profit"),
        parent: None,
        ownership_percentage: None,
        funding_sources: &["corporate sponsorships", "member station dues", "grants"],
        cik: None,
        description: "National Public Radio, American non-profit media organization",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("very-high"),
    },
    KnownOrganization {
        key: "reuters",
        name: "Reuters",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Thomson Reuters"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "International news organization",
        media_bias_rating: Some("center"),
        factual_reporting: Some("very-high"),
    },
    KnownOrganization {
        key: "associated press",
        name: "Associated Press",
        org_type: None,
        funding_type: Some("non-profit"),
        parent: None,
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American non-profit news agency",
        media_bias_rating: Some("center"),
        factual_reporting: Some("very-high"),
    },
    KnownOrganization {
        key: "al jazeera",
        name: "Al Jazeera",
        org_type: None,
        funding_type: Some("state-funded"),
        parent: Some("Al Jazeera Media Network (Qatar)"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Qatari state-funded news network",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "rt",
        name: "RT (Russia Today)",
        org_type: None,
        funding_type: Some("state-funded"),
        parent: Some("Russian Government"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Russian state-controlled international news network",
        media_bias_rating: Some("right"),
        factual_reporting: Some("very-low"),
    },
    KnownOrganization {
        key: "abc news",
        name: "ABC News",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("The Walt Disney Company"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American broadcast news division of ABC",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "american spectator",
        name: "American Spectator",
        org_type: None,
        funding_type: Some("non-profit"),
        parent: Some("American Spectator Foundation"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Conservative American magazine (501(c)(3))",
        media_bias_rating: Some("right"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "axios",
        name: "Axios",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Cox Enterprises"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American news website focused on business, politics, tech",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "big think",
        name: "Big Think",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Freethink Media"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Knowledge platform covering science, philosophy, innovation",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "bloomberg",
        name: "Bloomberg",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Bloomberg L.P."),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American financial, software, and media company",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "cbc",
        name: "CBC",
        org_type: None,
        funding_type: Some("public"),
        parent: Some("Canadian Broadcasting Corporation"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Canadian public broadcaster",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "hacker news",
        name: "Hacker News",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Y Combinator"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Social news site focused on computer science and entrepreneurship",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "ign",
        name: "IGN",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Ziff Davis"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American video game and entertainment media company",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "le monde",
        name: "Le Monde",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Groupe Le Monde"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "French daily newspaper of record",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "mother jones",
        name: "Mother Jones",
        org_type: None,
        funding_type: Some("non-profit"),
        parent: Some("Foundation for National Progress"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American non-profit investigative journalism magazine",
        media_bias_rating: Some("left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "national geographic",
        name: "National Geographic",
        org_type: Some("media brand"),
        funding_type: Some("commercial"),
        parent: Some("National Geographic Partners (Disney 73%)"),
        ownership_percentage: Some("73%"),
        funding_sources: &[],
        cik: None,
        description: "American magazine and media brand",
        media_bias_rating: Some("center"),
        factual_reporting: Some("very-high"),
    },
    KnownOrganization {
        key: "national post",
        name: "National Post",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Postmedia Network"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "Canadian English-language newspaper",
        media_bias_rating: Some("center-right"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "national review",
        name: "National Review",
        org_type: None,
        funding_type: Some("non-profit"),
        parent: Some("National Review Institute"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American conservative magazine (501(c)(3) since 2015)",
        media_bias_rating: Some("right"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "realclearpolitics",
        name: "RealClearPolitics",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Real Clear Holdings LLC"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American political news aggregator",
        media_bias_rating: Some("center-right"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "reason",
        name: "Reason",
        org_type: None,
        funding_type: Some("non-profit"),
        parent: Some("Reason Foundation"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American libertarian magazine (501(c)(3))",
        media_bias_rating: Some("libertarian"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "the atlantic",
        name: "The Atlantic",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Emerson Collective"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American magazine covering politics, culture, international affairs",
        media_bias_rating: Some("center-left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "the dispatch",
        name: "The Dispatch",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Dispatch Media Inc."),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American center-right digital media company",
        media_bias_rating: Some("center-right"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "the economist",
        name: "The Economist",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("The Economist Group"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "British weekly international affairs newspaper",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "the guardian",
        name: "The Guardian",
        org_type: None,
        funding_type: Some("trust-owned"),
        parent: Some("Scott Trust Limited"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "British daily newspaper owned by the Scott Trust",
        media_bias_rating: Some("left"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "the nation",
        name: "The Nation",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("The Nation Company, L.P."),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American progressive weekly magazine",
        media_bias_rating: Some("left"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "variety",
        name: "Variety",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Penske Media Corporation"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American entertainment trade magazine",
        media_bias_rating: Some("center"),
        factual_reporting: Some("high"),
    },
    KnownOrganization {
        key: "washington times",
        name: "Washington Times",
        org_type: None,
        funding_type: Some("commercial"),
        parent: Some("Operations Holdings (Unification Church)"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American daily newspaper",
        media_bias_rating: Some("right"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "democracy now!",
        name: "Democracy Now!",
        org_type: None,
        funding_type: Some("non-profit"),
        parent: Some("Democracy Now! Productions"),
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American non-profit daily news program",
        media_bias_rating: Some("left"),
        factual_reporting: Some("mixed"),
    },
    KnownOrganization {
        key: "warner bros. discovery",
        name: "Warner Bros. Discovery",
        org_type: Some("public company"),
        funding_type: Some("commercial"),
        parent: None,
        ownership_percentage: None,
        funding_sources: &[],
        cik: None,
        description: "American multinational media conglomerate",
        media_bias_rating: None,
        factual_reporting: None,
    },
];

pub(super) async fn research_organization(
    fetcher: &SafeHttpFetcher,
    name: String,
    website: Option<String>,
) -> OrganizationFacts {
    let normalized_name = normalize_organization_name(&name);
    let known = known_organization(&name);
    let (wikipedia, nonprofit, wikidata) = tokio::join!(
        search_wikipedia(fetcher, &name),
        search_propublica(fetcher, &name),
        resolve_wikidata(fetcher, &name),
    );
    let sec = if normalized_name.is_empty() {
        None
    } else {
        search_sec(fetcher, &normalized_name).await
    };
    let wikidata = match wikidata {
        Some(candidate) => fetch_wikidata(fetcher, &candidate).await,
        None => None,
    };

    let mut result = OrganizationResearchResponse {
        id: None,
        name: name.clone(),
        normalized_name: Some(normalized_name),
        org_type: None,
        parent_org: None,
        ownership_percentage: None,
        funding_type: None,
        funding_sources: Vec::new(),
        major_advertisers: Vec::new(),
        ein: None,
        annual_revenue: None,
        top_donors: Vec::new(),
        media_bias_rating: None,
        factual_reporting: None,
        wikipedia_url: None,
        website: website.clone(),
        owned_by: Vec::new(),
        parent_orgs: Vec::new(),
        part_of: Vec::new(),
        subsidiaries: Vec::new(),
        headquarters: Vec::new(),
        inception: None,
        official_website: None,
        cik: None,
        conflict_flags: Vec::new(),
        research_sources: Some(Vec::new()),
        research_confidence: Some("low".to_owned()),
        cached: false,
    };
    let mut description = None;

    if let Some(known) = known {
        let _ = known.name;
        result.org_type = known.org_type.map(str::to_owned);
        result.funding_type = known.funding_type.map(str::to_owned);
        result.parent_org = known.parent.map(str::to_owned);
        result.ownership_percentage = known.ownership_percentage.map(str::to_owned);
        result.funding_sources = known
            .funding_sources
            .iter()
            .map(|value| (*value).to_owned())
            .collect();
        result.cik = known.cik.map(str::to_owned);
        result.media_bias_rating = known.media_bias_rating.map(str::to_owned);
        result.factual_reporting = known.factual_reporting.map(str::to_owned);
        description = Some(known.description.to_owned());
        record_source(&mut result, "known_data", "high");
    }

    if let Some(wikipedia) = wikipedia {
        if result.parent_org.is_none() {
            result.parent_org = wikipedia.parent;
        }
        if result.funding_type.is_none() {
            result.funding_type = wikipedia.funding_type;
        }
        if description.is_none() {
            description = wikipedia.description;
        }
        result.wikipedia_url = wikipedia.url;
        record_source(&mut result, "wikipedia", "medium");
    }

    if let Some(wikidata) = wikidata {
        result.owned_by = wikidata.owned_by;
        result.parent_orgs = wikidata.parent_orgs;
        result.part_of = wikidata.part_of;
        result.headquarters = wikidata.headquarters;
        result.subsidiaries = wikidata.subsidiaries;
        result.inception = wikidata.inception;
        result.official_website = wikidata.official_website;
        if result.org_type.is_none() {
            result.org_type = wikidata.org_type;
        }
        if result.parent_org.is_none() {
            result.parent_org = result.parent_orgs.first().cloned();
        }
        if result.ownership_percentage.is_none() {
            result.ownership_percentage = wikidata.ownership_percentage;
        }
        result.website = result.website.or_else(|| result.official_website.clone());
        record_source(&mut result, "wikidata", "medium");
    }

    if let Some(nonprofit) = nonprofit {
        if result.funding_type.as_deref() != Some("commercial")
            && !matches!(result.org_type.as_deref(), Some("human" | "person"))
        {
            result.ein = nonprofit.ein;
            result.annual_revenue = nonprofit.annual_revenue;
            if result.funding_type.is_none() {
                result.funding_type = Some("non-profit".to_owned());
            }
            record_source(&mut result, "propublica", "high");
        }
    }

    if let Some(sec) = sec {
        result.cik = Some(sec.cik);
        result.ein = result.ein.or(sec.ein);
        if !sec.tickers.is_empty() {
            result
                .funding_type
                .get_or_insert_with(|| "commercial".to_owned());
            result
                .org_type
                .get_or_insert_with(|| "public company".to_owned());
        }
        result.annual_revenue = result.annual_revenue.or(sec.revenue).or(sec.total_assets);
        record_source(&mut result, "sec_edgar", "medium");
    }

    OrganizationFacts {
        response: result,
        description,
    }
}

#[derive(Default)]
struct WikipediaData {
    description: Option<String>,
    url: Option<String>,
    parent: Option<String>,
    funding_type: Option<String>,
}

async fn search_wikipedia(fetcher: &SafeHttpFetcher, name: &str) -> Option<WikipediaData> {
    let search_url = api_url(
        WIKIPEDIA_API,
        &[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", &format!("{name} news organization")),
            ("format", "json"),
            ("srlimit", "3"),
        ],
    );
    let search = get_json(fetcher, &search_url).await?;
    let results = search.get("query")?.get("search")?.as_array()?;
    if results.is_empty() {
        return None;
    }
    let normalized_name = normalize_organization_name(name);
    let title = results
        .iter()
        .find(|result| {
            result
                .get("title")
                .and_then(Value::as_str)
                .is_some_and(|title| normalize_organization_name(title) == normalized_name)
        })
        .or_else(|| results.first())?
        .get("title")?
        .as_str()?;
    let extract_url = api_url(
        WIKIPEDIA_API,
        &[
            ("action", "query"),
            ("titles", title),
            ("prop", "extracts|info"),
            ("exintro", "true"),
            ("explaintext", "true"),
            ("format", "json"),
            ("inprop", "url"),
        ],
    );
    let extract = get_json(fetcher, &extract_url).await?;
    let pages = extract.get("query")?.get("pages")?.as_object()?;
    let page = pages.iter().find(|(id, _)| id.as_str() != "-1")?.1;
    let text = page
        .get("extract")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let lower_text = text.to_lowercase();
    let funding_type = if lower_text.contains("non-profit") || lower_text.contains("nonprofit") {
        Some("non-profit")
    } else if lower_text.contains("public broadcasting") {
        Some("public")
    } else if lower_text.contains("state-owned") || lower_text.contains("government-funded") {
        Some("state-funded")
    } else {
        None
    };
    Some(WikipediaData {
        description: (!text.is_empty()).then(|| text.chars().take(500).collect()),
        url: page
            .get("fullurl")
            .and_then(Value::as_str)
            .map(str::to_owned),
        parent: extract_parent(text),
        funding_type: funding_type.map(str::to_owned),
    })
}

#[derive(Default)]
struct NonprofitData {
    ein: Option<String>,
    annual_revenue: Option<String>,
}

async fn search_propublica(fetcher: &SafeHttpFetcher, name: &str) -> Option<NonprofitData> {
    let endpoint = format!("{PROPUBLICA_API}/search.json");
    let search_url = api_url(&endpoint, &[("q", name)]);
    let search = get_json(fetcher, &search_url).await?;
    let organizations = search.get("organizations")?.as_array()?;
    let candidate = organizations.iter().find(|item| {
        item.get("name")
            .and_then(Value::as_str)
            .is_some_and(|candidate| nonprofit_name_matches(name, candidate))
    })?;
    let ein = candidate.get("ein").and_then(value_string)?;
    if ein.is_empty() {
        return None;
    }
    let org_url = format!("{PROPUBLICA_API}/organizations/{ein}.json");
    let Some(record) = get_json(fetcher, &org_url).await else {
        return Some(NonprofitData {
            ein: Some(ein),
            annual_revenue: None,
        });
    };
    let latest = record
        .get("filings_with_data")
        .and_then(Value::as_array)
        .and_then(|filings| filings.first());
    Some(NonprofitData {
        ein: Some(ein),
        annual_revenue: latest
            .and_then(|filing| filing.get("totrevenue"))
            .and_then(value_string),
    })
}

fn value_string(value: &Value) -> Option<String> {
    if value.is_null() {
        None
    } else {
        Some(
            value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string()),
        )
    }
}

fn nonprofit_name_matches(query: &str, candidate: &str) -> bool {
    let query = normalize_organization_name(query);
    let candidate = normalize_organization_name(candidate);
    if query.is_empty() || candidate.is_empty() {
        return false;
    }
    if query == candidate {
        return true;
    }
    let query_tokens: BTreeSet<_> = query.split_whitespace().collect();
    let candidate_tokens: BTreeSet<_> = candidate.split_whitespace().collect();
    if query_tokens.len() == 1 {
        let acronym = query.chars().filter(char::is_ascii_alphabetic).count();
        return (2..=4).contains(&acronym)
            && candidate_tokens.iter().next() == query_tokens.iter().next();
    }
    let overlap = query_tokens.intersection(&candidate_tokens).count();
    let union = query_tokens.union(&candidate_tokens).count();
    query.contains(&candidate)
        || candidate.contains(&query)
        || (union > 0 && overlap as f64 / union as f64 >= 0.5)
}

#[derive(Default)]
struct SecData {
    cik: String,
    ein: Option<String>,
    tickers: Vec<String>,
    revenue: Option<String>,
    total_assets: Option<String>,
}

async fn search_sec(fetcher: &SafeHttpFetcher, normalized_name: &str) -> Option<SecData> {
    let tickers = get_json(fetcher, SEC_TICKERS_URL).await?;
    let entries = tickers.as_object()?;
    let exact = entries.values().find(|entry| {
        entry
            .get("title")
            .and_then(Value::as_str)
            .is_some_and(|title| normalize_organization_name(title) == normalized_name)
    });
    let candidate = exact.or_else(|| {
        entries
            .values()
            .filter_map(|entry| {
                let title = entry.get("title")?.as_str()?;
                let score = token_overlap(normalized_name, &normalize_organization_name(title));
                (score > 0.7).then_some((score, entry))
            })
            .max_by(|left, right| left.0.total_cmp(&right.0))
            .map(|(_, entry)| entry)
    })?;
    let cik_value = candidate.get("cik_str")?.as_u64()?;
    let cik = format!("{cik_value:010}");
    let submissions_url = format!("https://data.sec.gov/submissions/CIK{cik}.json");
    let submissions = get_json(fetcher, &submissions_url).await;
    let facts_url = format!("https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json");
    let facts = get_json(fetcher, &facts_url).await;
    let gaap = facts
        .as_ref()
        .and_then(|facts| facts.get("facts"))
        .and_then(|facts| facts.get("us-gaap"));
    Some(SecData {
        cik,
        ein: submissions
            .as_ref()
            .and_then(|submissions| submissions.get("ein"))
            .and_then(value_string),
        tickers: submissions
            .as_ref()
            .and_then(|submissions| submissions.get("tickers"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        revenue: gaap.and_then(|gaap| {
            first_sec_fact(
                gaap,
                &[
                    "RevenueFromContractWithCustomerExcludingAssessedTax",
                    "Revenues",
                    "SalesRevenueNet",
                ],
            )
        }),
        total_assets: gaap.and_then(|gaap| latest_sec_fact(gaap, "Assets")),
    })
}

#[derive(Default)]
struct WikidataData {
    owned_by: Vec<String>,
    parent_orgs: Vec<String>,
    part_of: Vec<String>,
    headquarters: Vec<String>,
    subsidiaries: Vec<String>,
    org_type: Option<String>,
    ownership_percentage: Option<String>,
    inception: Option<String>,
    official_website: Option<String>,
}

async fn resolve_wikidata(fetcher: &SafeHttpFetcher, name: &str) -> Option<String> {
    let url = api_url(
        WIKIDATA_API,
        &[
            ("action", "wbsearchentities"),
            ("search", name),
            ("language", "en"),
            ("format", "json"),
            ("limit", "3"),
            ("type", "item"),
        ],
    );
    let search = get_json(fetcher, &url).await?;
    let results = search.get("search")?.as_array()?;
    let normalized_name = normalize_organization_name(name);
    for result in results {
        let Some(id) = result.get("id").and_then(Value::as_str) else {
            continue;
        };
        let label = result
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if token_overlap(&normalized_name, &normalize_organization_name(label)) >= 0.5 {
            return Some(id.to_owned());
        }
    }
    resolve_wikidata_sparql(fetcher, name).await
}

async fn resolve_wikidata_sparql(fetcher: &SafeHttpFetcher, name: &str) -> Option<String> {
    let escaped_name = name.replace('\\', "\\\\").replace('"', "\\\"");
    let query = format!(
        "SELECT ?item WHERE {{ SERVICE wikibase:mwapi {{ bd:serviceParam wikibase:api \"EntitySearch\"; wikibase:endpoint \"www.wikidata.org\"; mwapi:search \"{escaped_name}\"; mwapi:language \"en\"; ?item wikibase:apiOutputItem mwapi:item. }} ?item wdt:P31 ?type. VALUES ?type {{ wd:Q11032 wd:Q192283 wd:Q5296 wd:Q35127 wd:Q5633421 wd:Q16735862 wd:Q43229 }} }} LIMIT 5"
    );
    let url = api_url(
        "https://query.wikidata.org/sparql",
        &[("format", "json"), ("query", &query)],
    );
    let response = get_json(fetcher, &url).await?;
    response
        .get("results")?
        .get("bindings")?
        .as_array()?
        .iter()
        .filter_map(|binding| binding.get("item")?.get("value")?.as_str())
        .find_map(|item_url| item_url.rsplit('/').next().map(str::to_owned))
}

async fn fetch_wikidata(fetcher: &SafeHttpFetcher, qid: &str) -> Option<WikidataData> {
    let url = api_url(
        WIKIDATA_API,
        &[
            ("action", "wbgetentities"),
            ("ids", qid),
            ("props", "claims|labels|descriptions|sitelinks"),
            ("format", "json"),
            ("formatversion", "2"),
            ("languages", "en"),
        ],
    );
    let response = get_json(fetcher, &url).await?;
    let entity = response.get("entities")?.get(qid)?;
    let claims = entity.get("claims")?;
    let properties = ["P127", "P749", "P361", "P159", "P355", "P31"];
    let ids: BTreeSet<String> = properties
        .iter()
        .flat_map(|property| claim_item_ids(claims, property))
        .collect();
    let labels = fetch_labels(fetcher, &ids).await;
    let owned_by = claim_labels(claims, "P127", &labels);
    let parent_orgs = claim_labels(claims, "P749", &labels);
    let part_of = claim_labels(claims, "P361", &labels);
    let headquarters = claim_labels(claims, "P159", &labels);
    let subsidiaries = claim_labels(claims, "P355", &labels);
    let org_type = claim_labels(claims, "P31", &labels).into_iter().next();
    let inception = claim_value(claims, "P571", "time");
    let official_website = claim_string(claims, "P856");
    Some(WikidataData {
        owned_by,
        parent_orgs,
        part_of,
        headquarters,
        subsidiaries,
        org_type,
        ownership_percentage: None,
        inception,
        official_website,
    })
}

async fn fetch_labels(
    fetcher: &SafeHttpFetcher,
    ids: &BTreeSet<String>,
) -> BTreeMap<String, String> {
    if ids.is_empty() {
        return BTreeMap::new();
    }
    let joined = ids.iter().cloned().collect::<Vec<_>>().join("|");
    let url = api_url(
        WIKIDATA_API,
        &[
            ("action", "wbgetentities"),
            ("ids", &joined),
            ("props", "labels"),
            ("format", "json"),
            ("formatversion", "2"),
            ("languages", "en"),
        ],
    );
    let Some(response) = get_json(fetcher, &url).await else {
        return BTreeMap::new();
    };
    response
        .get("entities")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|entities| entities.values())
        .filter_map(|entity| {
            Some((
                entity.get("id")?.as_str()?.to_owned(),
                entity
                    .get("labels")?
                    .get("en")?
                    .get("value")?
                    .as_str()?
                    .to_owned(),
            ))
        })
        .collect()
}

fn claim_item_ids(claims: &Value, property: &str) -> Vec<String> {
    claims
        .get(property)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|claim| {
            claim
                .get("mainsnak")?
                .get("datavalue")?
                .get("value")?
                .get("id")?
                .as_str()
                .map(str::to_owned)
        })
        .collect()
}

fn claim_labels(claims: &Value, property: &str, labels: &BTreeMap<String, String>) -> Vec<String> {
    claim_item_ids(claims, property)
        .into_iter()
        .filter_map(|id| labels.get(&id).cloned())
        .collect()
}

fn claim_string(claims: &Value, property: &str) -> Option<String> {
    let value = claims
        .get(property)?
        .as_array()?
        .first()?
        .get("mainsnak")?
        .get("datavalue")?
        .get("value")?;
    value.as_str().map(str::to_owned)
}

fn claim_value(claims: &Value, property: &str, key: &str) -> Option<String> {
    claims
        .get(property)?
        .as_array()?
        .first()?
        .get("mainsnak")?
        .get("datavalue")?
        .get("value")?
        .get(key)?
        .as_str()
        .map(str::to_owned)
}

fn extract_parent(text: &str) -> Option<String> {
    [
        "owned by ",
        "subsidiary of ",
        "parent company ",
        "parent company is ",
        "acquired by ",
    ]
    .into_iter()
    .find_map(|pattern| {
        let start = text.to_lowercase().find(pattern)? + pattern.len();
        let tail = text.get(start..)?;
        let length = tail
            .char_indices()
            .find(|(_, character)| matches!(character, '.' | ',' | ';' | '\n'))
            .map(|(index, _)| index)
            .unwrap_or(tail.len());
        let value = tail.get(..length)?.trim();
        (!value.is_empty()).then(|| value.to_owned())
    })
}

fn record_source(result: &mut OrganizationResearchResponse, source: &str, confidence: &str) {
    let sources = result.research_sources.get_or_insert_with(Vec::new);
    if !sources.iter().any(|existing| existing == source) {
        sources.push(source.to_owned());
    }
    if result.research_confidence.as_deref() == Some("low") || confidence == "high" {
        result.research_confidence = Some(confidence.to_owned());
    }
}

fn known_organization(name: &str) -> Option<&'static KnownOrganization> {
    let normalized = normalize_organization_name(name);
    KNOWN_ORGANIZATIONS
        .iter()
        .find(|known| normalize_organization_name(known.key) == normalized)
}

fn first_sec_fact(facts: &Value, tags: &[&str]) -> Option<String> {
    tags.iter().find_map(|tag| latest_sec_fact(facts, tag))
}

fn latest_sec_fact(facts: &Value, tag: &str) -> Option<String> {
    let entries = facts.get(tag)?.get("units")?.get("USD")?.as_array()?;
    let annual: Vec<&Value> = entries
        .iter()
        .filter(|entry| entry.get("form").and_then(Value::as_str) == Some("10-K"))
        .collect();
    let candidates = if annual.is_empty() {
        entries.iter().collect::<Vec<_>>()
    } else {
        annual
    };
    candidates
        .into_iter()
        .filter(|entry| entry.get("end").and_then(Value::as_str).is_some())
        .max_by_key(|entry| {
            (
                entry.get("end").and_then(Value::as_str).unwrap_or_default(),
                entry
                    .get("filed")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
        })
        .or_else(|| entries.first())
        .and_then(|entry| entry.get("val"))
        .map(value_to_string)
}

fn value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn token_overlap(left: &str, right: &str) -> f64 {
    let left: BTreeSet<String> = left
        .split_whitespace()
        .map(|value| value.to_lowercase())
        .collect();
    let right: BTreeSet<String> = right
        .split_whitespace()
        .map(|value| value.to_lowercase())
        .collect();
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let overlap = left.intersection(&right).count();
    let union = left.union(&right).count();
    overlap as f64 / union as f64
}

#[cfg(test)]
mod tests {
    use super::{known_organization, nonprofit_name_matches};

    #[test]
    fn known_organizations_and_nonprofit_matching_are_deterministic() {
        let reuters = known_organization("Reuters, Inc.").expect("known Reuters profile");
        assert_eq!(reuters.parent, Some("Thomson Reuters"));
        assert_eq!(reuters.factual_reporting, Some("very-high"));
        assert!(nonprofit_name_matches("NPR", "National Public Radio"));
        assert!(nonprofit_name_matches(
            "American Spectator Foundation",
            "American Spectator Foundation Inc."
        ));
        assert!(!nonprofit_name_matches("Reuters", "National Public Radio"));
    }
}
