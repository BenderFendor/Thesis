use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use thesis_api::embedding::EmbeddingClient;
use thesis_api::entity_research::{JsonObject, ReporterProfileRequest, ReporterProfileResponse};

use crate::providers::SafeHttpFetcher;

use super::http::{api_url, get_json};
use super::normalize::normalize_reporter_name;

const WIKIDATA_API: &str = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API: &str = "https://en.wikipedia.org/w/api.php";
const JOURNALISM_KEYWORDS: &[&str] = &[
    "journalist",
    "reporter",
    "correspondent",
    "editor",
    "columnist",
    "writer",
    "news",
    "anchor",
    "commentator",
    "broadcaster",
    "presenter",
];
const NON_JOURNALIST_KEYWORDS: &[&str] = &[
    "researcher",
    "scientist",
    "physician",
    "doctor",
    "engineer",
    "attorney",
    "lawyer",
    "musician",
    "actor",
    "actress",
    "athlete",
    "professor",
    "teacher",
    "artist",
    "politician",
    "nurse",
    "chef",
    "police",
];

#[derive(Clone, Debug)]
struct Candidate {
    id: String,
    label: String,
    description: String,
    occupations: Vec<String>,
    employers: Vec<String>,
    education: Vec<String>,
    field_of_work: Vec<String>,
    affiliations: Vec<String>,
    citizenships: Vec<String>,
    political_party: Vec<String>,
    political_ideology: Vec<String>,
    member_of: Vec<String>,
    official_website: Option<String>,
    twitter_handle: Option<String>,
    linkedin_url: Option<String>,
    wikipedia_title: Option<String>,
    human_score: f64,
    name_score: f64,
    context_score: f64,
    organization_score: f64,
    total_score: f64,
}

pub(super) async fn research_reporter(
    fetcher: &SafeHttpFetcher,
    embedding: &EmbeddingClient,
    request: ReporterProfileRequest,
) -> ReporterProfileResponse {
    let name = normalize_reporter_name(&request.name);
    let name_lower = name.to_lowercase();
    let search_url = api_url(
        WIKIDATA_API,
        &[
            ("action", "wbsearchentities"),
            ("search", &name),
            ("language", "en"),
            ("limit", "8"),
            ("type", "item"),
            ("format", "json"),
        ],
    );
    let Some(search) = get_json(fetcher, &search_url).await else {
        return empty_profile(&name, "Wikidata search failed.", vec!["wikidata_search"]);
    };
    let Some(search_results) = search.get("search").and_then(Value::as_array) else {
        return empty_profile(
            &name,
            "No public Wikimedia record cleared the search step.",
            vec!["wikidata_search"],
        );
    };
    if search_results.is_empty() {
        return empty_profile(
            &name,
            "No public Wikimedia record cleared the search step.",
            vec!["wikidata_search"],
        );
    }

    let candidate_ids: Vec<String> = search_results
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    if candidate_ids.is_empty() {
        return empty_profile(
            &name,
            "Candidates were returned, but none exposed usable public facts.",
            vec!["wikidata_search", "wikidata_entities"],
        );
    }

    let entities_url = api_url(
        WIKIDATA_API,
        &[
            ("action", "wbgetentities"),
            ("ids", &candidate_ids.join("|")),
            ("props", "claims|labels|descriptions|sitelinks"),
            ("languages", "en"),
            ("format", "json"),
            ("formatversion", "2"),
        ],
    );
    let Some(entities_response) = get_json(fetcher, &entities_url).await else {
        return empty_profile(
            &name,
            "Candidates were returned, but none exposed usable public facts.",
            vec!["wikidata_search", "wikidata_entities"],
        );
    };
    let entities = entity_values_in_order(&entities_response, &candidate_ids);
    if entities.is_empty() {
        return empty_profile(
            &name,
            "Candidates were returned, but none exposed usable public facts.",
            vec!["wikidata_search", "wikidata_entities"],
        );
    }

    let label_ids: BTreeSet<String> = entities
        .iter()
        .flat_map(|entity| {
            [
                "P31", "P106", "P108", "P69", "P27", "P101", "P1416", "P102", "P1142", "P463",
            ]
            .into_iter()
            .flat_map(|property| claim_item_ids(entity, property))
        })
        .collect();
    let label_map = fetch_labels(fetcher, &label_ids).await;

    let mut candidates = Vec::with_capacity(entities.len());
    for entity in &entities {
        let Some(candidate) =
            parse_candidate(entity, &label_map, &name, request.organization.as_deref())
        else {
            continue;
        };
        candidates.push(candidate);
    }
    apply_context_scores(
        &mut candidates,
        request.article_context.as_deref(),
        embedding,
    )
    .await;
    candidates.sort_by(|left, right| right.total_score.total_cmp(&left.total_score));
    if candidates.is_empty() {
        return empty_profile(
            &name,
            "Candidates were returned, but none exposed usable public facts.",
            vec!["wikidata_search", "wikidata_entities"],
        );
    }

    let journalist_candidates: Vec<&Candidate> = candidates
        .iter()
        .filter(|candidate| is_journalist(candidate))
        .collect();
    let Some(best) = journalist_candidates.first().copied() else {
        return empty_profile(
            &name,
            "No journalist Wikidata candidates found for this name -- bylines are from a news outlet, not a known public entity.",
            vec!["wikidata_search"],
        );
    };
    let second_score = journalist_candidates
        .get(1)
        .map(|candidate| candidate.total_score)
        .or_else(|| {
            candidates
                .first()
                .filter(|candidate| candidate.id != best.id)
                .map(|candidate| candidate.total_score)
        })
        .unwrap_or(0.0);
    let threshold = if candidates.len() == 1 { 0.65 } else { 0.55 };
    let matched = best.total_score >= threshold && best.total_score - second_score >= 0.08;

    let wikidata_url = Some(format!("https://www.wikidata.org/wiki/{}", best.id));
    let summary = best
        .wikipedia_title
        .as_deref()
        .map(|title| fetch_wikipedia_summary(fetcher, title));
    let summary = match summary {
        Some(future) => future.await,
        None => None,
    }
    .unwrap_or_default();
    let wikipedia_url = summary
        .get("url")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let overview = summary
        .get("extract")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| (!best.description.is_empty()).then(|| best.description.clone()));
    let canonical_name = summary
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(&best.label)
        .to_owned();

    let citations = [
        wikipedia_url
            .as_deref()
            .map(|url| citation("Wikipedia lead", url)),
        wikidata_url
            .as_deref()
            .map(|url| citation("Wikidata item", url)),
    ]
    .into_iter()
    .flatten()
    .collect();
    let mut citation_urls = Vec::new();
    for url in [
        wikipedia_url.as_deref(),
        wikidata_url.as_deref(),
        best.official_website.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !citation_urls.iter().any(|existing| existing == url) {
            citation_urls.push(url.to_owned());
        }
    }
    let explanation = if matched {
        format!(
            "Matched {canonical_name} with score {:.3}.",
            best.total_score
        )
    } else {
        format!("Best candidate was {canonical_name}, but the margin over the next candidate was too small.")
    };
    let dossier_sections = reporter_sections(
        &canonical_name,
        &explanation,
        overview.as_deref(),
        best,
        wikipedia_url.as_deref(),
        wikidata_url.as_deref(),
    );
    let mut search_links = BTreeMap::new();
    search_links.insert(
        "wikipedia".to_owned(),
        wikipedia_url
            .clone()
            .unwrap_or_else(|| wikipedia_search_url(&name)),
    );
    search_links.insert(
        "wikidata".to_owned(),
        wikidata_url
            .clone()
            .unwrap_or_else(|| wikidata_search_url(&name)),
    );
    let career_history = (!best.employers.is_empty()).then(|| {
        best.employers
            .iter()
            .map(|employer| {
                object(json!({"organization": employer, "role": "employer", "source": "wikidata"}))
            })
            .collect()
    });
    let education = (!best.education.is_empty()).then(|| {
        best.education
            .iter()
            .map(|institution| object(json!({"institution": institution, "source": "wikidata"})))
            .collect()
    });
    let mut topics = best.occupations.clone();
    for topic in &best.field_of_work {
        if !topics.contains(topic) {
            topics.push(topic.clone());
        }
    }

    ReporterProfileResponse {
        id: None,
        redirected_from_id: None,
        name: name.clone(),
        normalized_name: Some(name_lower),
        bio: overview.clone(),
        career_history,
        topics: (!topics.is_empty()).then_some(topics),
        education,
        political_leaning: None,
        leaning_confidence: None,
        twitter_handle: best.twitter_handle.clone(),
        leaning_sources: None,
        linkedin_url: best.linkedin_url.clone(),
        wikipedia_url,
        wikidata_qid: Some(best.id.clone()),
        wikidata_url,
        canonical_name: Some(canonical_name.clone()),
        match_status: Some(if matched { "matched" } else { "ambiguous" }.to_owned()),
        overview,
        dossier_sections: Some(dossier_sections),
        citations: Some(citations),
        search_links: Some(search_links),
        match_explanation: Some(explanation),
        research_sources: Some(vec![
            "wikidata_search".to_owned(),
            "wikidata_entities".to_owned(),
            "wikipedia".to_owned(),
        ]),
        research_confidence: Some(if matched { "high" } else { "medium" }.to_owned()),
        cached: false,
    }
}

fn empty_profile(name: &str, explanation: &str, sources: Vec<&str>) -> ReporterProfileResponse {
    let mut search_links = BTreeMap::new();
    search_links.insert("wikipedia".to_owned(), wikipedia_search_url(name));
    search_links.insert("wikidata".to_owned(), wikidata_search_url(name));
    ReporterProfileResponse {
        id: None,
        redirected_from_id: None,
        name: name.to_owned(),
        normalized_name: Some(name.to_lowercase()),
        bio: None,
        career_history: Some(Vec::new()),
        topics: Some(Vec::new()),
        education: Some(Vec::new()),
        political_leaning: None,
        leaning_confidence: None,
        twitter_handle: None,
        leaning_sources: None,
        linkedin_url: None,
        wikipedia_url: None,
        wikidata_qid: None,
        wikidata_url: None,
        canonical_name: Some(name.to_owned()),
        match_status: Some("none".to_owned()),
        overview: None,
        dossier_sections: Some(Vec::new()),
        citations: Some(Vec::new()),
        search_links: Some(search_links),
        match_explanation: Some(explanation.to_owned()),
        research_sources: Some(sources.into_iter().map(str::to_owned).collect()),
        research_confidence: Some("low".to_owned()),
        cached: false,
    }
}

fn entity_values_in_order(response: &Value, ids: &[String]) -> Vec<Value> {
    let Some(entities) = response.get("entities") else {
        return Vec::new();
    };
    if let Some(object) = entities.as_object() {
        ids.iter()
            .filter_map(|id| object.get(id).cloned())
            .collect()
    } else {
        entities.as_array().cloned().unwrap_or_default()
    }
}

fn entity_values(response: &Value) -> Vec<Value> {
    let Some(entities) = response.get("entities") else {
        return Vec::new();
    };
    if let Some(object) = entities.as_object() {
        object.values().cloned().collect()
    } else {
        entities.as_array().cloned().unwrap_or_default()
    }
}

async fn fetch_labels(
    fetcher: &SafeHttpFetcher,
    ids: &BTreeSet<String>,
) -> BTreeMap<String, String> {
    if ids.is_empty() {
        return BTreeMap::new();
    }
    let ids = ids.iter().cloned().collect::<Vec<_>>().join("|");
    let url = api_url(
        WIKIDATA_API,
        &[
            ("action", "wbgetentities"),
            ("ids", &ids),
            ("props", "labels"),
            ("languages", "en"),
            ("format", "json"),
            ("formatversion", "2"),
        ],
    );
    let Some(response) = get_json(fetcher, &url).await else {
        return BTreeMap::new();
    };
    entity_values(&response)
        .into_iter()
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

fn parse_candidate(
    entity: &Value,
    labels: &BTreeMap<String, String>,
    requested_name: &str,
    organization: Option<&str>,
) -> Option<Candidate> {
    let id = entity.get("id")?.as_str()?.to_owned();
    let label = entity
        .get("labels")
        .and_then(|labels| labels.get("en"))
        .and_then(|label| label.get("value"))
        .and_then(Value::as_str)
        .unwrap_or(requested_name)
        .to_owned();
    let description = entity
        .get("descriptions")
        .and_then(|descriptions| descriptions.get("en"))
        .and_then(|description| description.get("value"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let claims = entity.get("claims").unwrap_or(&Value::Null);
    let instance_ids = claim_item_ids_from(claims, "P31");
    let occupations = claim_labels(claims, "P106", labels);
    let employers = claim_labels(claims, "P108", labels);
    let education = claim_labels(claims, "P69", labels);
    let field_of_work = claim_labels(claims, "P101", labels);
    let affiliations = claim_labels(claims, "P1416", labels);
    let citizenships = claim_labels(claims, "P27", labels);
    let political_party = claim_labels(claims, "P102", labels);
    let political_ideology = claim_labels(claims, "P1142", labels);
    let member_of = claim_labels(claims, "P463", labels);
    let human_score = if instance_ids.iter().any(|item| item == "Q5") {
        1.0
    } else {
        0.0
    };
    let organization_score = employers
        .iter()
        .map(|employer| token_overlap(organization.unwrap_or_default(), employer))
        .fold(0.0_f64, f64::max);
    let name_score = text_similarity(requested_name, &label);
    let official_website = claim_string(claims, "P856");
    let context_score = 0.0;
    let mut candidate = Candidate {
        id,
        label,
        description,
        occupations,
        employers,
        education,
        field_of_work,
        affiliations,
        citizenships,
        political_party,
        political_ideology,
        member_of,
        official_website,
        twitter_handle: claim_string(claims, "P2002"),
        linkedin_url: claim_string(claims, "P6634"),
        wikipedia_title: entity
            .get("sitelinks")
            .and_then(|sitelinks| sitelinks.get("enwiki"))
            .and_then(|sitelink| sitelink.get("title"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        human_score,
        name_score,
        context_score,
        organization_score,
        total_score: 0.0,
    };
    candidate.total_score = total_score(&candidate);
    Some(candidate)
}

fn total_score(candidate: &Candidate) -> f64 {
    let occupation_text = candidate.occupations.join(" ").to_lowercase();
    let is_journalist = JOURNALISM_KEYWORDS
        .iter()
        .any(|keyword| occupation_text.contains(keyword));
    let is_non_journalist = NON_JOURNALIST_KEYWORDS
        .iter()
        .any(|keyword| occupation_text.contains(keyword));
    let score = candidate.name_score * 0.30
        + candidate.human_score * 0.18
        + if is_journalist { 0.26 } else { 0.0 }
        + candidate.organization_score * 0.14
        + candidate.context_score * 0.12;
    if is_non_journalist && !is_journalist {
        score - 0.4
    } else {
        score
    }
}

async fn apply_context_scores(
    candidates: &mut [Candidate],
    article_context: Option<&str>,
    embedding: &EmbeddingClient,
) {
    let Some(context) = article_context
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    let candidate_indices: Vec<usize> = candidates
        .iter()
        .enumerate()
        .filter_map(|(index, candidate)| (!candidate.description.is_empty()).then_some(index))
        .collect();
    if candidate_indices.is_empty() {
        return;
    }
    let mut texts = Vec::with_capacity(candidate_indices.len() + 1);
    texts.push(context.to_owned());
    texts.extend(
        candidate_indices
            .iter()
            .map(|index| candidates[*index].description.clone()),
    );
    let vectors = embedding
        .embed(&texts, texts.len())
        .await
        .ok()
        .map(|response| response.embeddings);
    for (offset, index) in candidate_indices.into_iter().enumerate() {
        let score = vectors
            .as_ref()
            .and_then(|vectors| cosine_similarity(vectors.first()?, vectors.get(offset + 1)?))
            .map(|similarity| ((similarity + 1.0) / 2.0).clamp(0.0, 1.0))
            .unwrap_or_else(|| token_overlap(context, &candidates[index].description));
        candidates[index].context_score = score;
        candidates[index].total_score = total_score(&candidates[index]);
    }
}

fn cosine_similarity(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.len() != right.len() || left.is_empty() {
        return None;
    }
    let dot = left
        .iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum::<f64>();
    let left_norm = left.iter().map(|value| value * value).sum::<f64>().sqrt();
    let right_norm = right.iter().map(|value| value * value).sum::<f64>().sqrt();
    (left_norm > 0.0 && right_norm > 0.0).then_some(dot / (left_norm * right_norm))
}

fn is_journalist(candidate: &Candidate) -> bool {
    let occupations = candidate.occupations.join(" ").to_lowercase();
    JOURNALISM_KEYWORDS
        .iter()
        .any(|keyword| occupations.contains(keyword))
}

fn claim_item_ids(entity: &Value, property: &str) -> Vec<String> {
    claim_item_ids_from(entity.get("claims").unwrap_or(&Value::Null), property)
}

fn claim_item_ids_from(claims: &Value, property: &str) -> Vec<String> {
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
    claim_item_ids_from(claims, property)
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
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.get("time")?.as_str().map(str::to_owned))
}

async fn fetch_wikipedia_summary(fetcher: &SafeHttpFetcher, title: &str) -> Option<Value> {
    let url = api_url(
        WIKIPEDIA_API,
        &[
            ("action", "query"),
            ("titles", title),
            ("prop", "extracts|info"),
            ("exintro", "true"),
            ("explaintext", "true"),
            ("inprop", "url"),
            ("format", "json"),
        ],
    );
    let response = get_json(fetcher, &url).await?;
    let pages = response.get("query")?.get("pages")?;
    let pages = pages.as_object()?;
    pages.iter().find_map(|(page_id, page)| {
        if page_id == "-1" {
            return None;
        }
        Some(json!({
            "title": page.get("title")?,
            "extract": page.get("extract"),
            "url": page.get("fullurl"),
        }))
    })
}

fn reporter_sections(
    canonical_name: &str,
    explanation: &str,
    overview: Option<&str>,
    candidate: &Candidate,
    wikipedia_url: Option<&str>,
    wikidata_url: Option<&str>,
) -> Vec<JsonObject> {
    let citation_urls: Vec<&str> = [wikipedia_url, wikidata_url]
        .into_iter()
        .flatten()
        .collect();
    let mut identity_items = vec![section_item("Name", canonical_name, &citation_urls)];
    if let Some(overview) = overview {
        identity_items.push(section_item("Overview", overview, &citation_urls));
    }
    identity_items.push(section_item("Match", explanation, &citation_urls));
    let public_record_items = labeled_items(
        [
            ("Occupation", candidate.occupations.as_slice()),
            ("Field of work", candidate.field_of_work.as_slice()),
            ("Employer", candidate.employers.as_slice()),
            ("Affiliation", candidate.affiliations.as_slice()),
            ("Citizenship", candidate.citizenships.as_slice()),
        ],
        wikidata_url,
    );
    let education_items = labeled_items(
        [("Educated at", candidate.education.as_slice())],
        wikidata_url,
    );
    let alignment_items = labeled_items(
        [
            ("Political party", candidate.political_party.as_slice()),
            (
                "Political ideology",
                candidate.political_ideology.as_slice(),
            ),
            ("Member of", candidate.member_of.as_slice()),
        ],
        wikidata_url,
    );
    let mut links_items = Vec::new();
    if let Some(url) = wikipedia_url {
        links_items.push(section_item("Wikipedia", url, &[url]));
    }
    if let Some(url) = wikidata_url {
        links_items.push(section_item("Wikidata", url, &[url]));
    }
    if let Some(url) = candidate.official_website.as_deref() {
        links_items.push(section_item("Official website", url, &[url]));
    }
    vec![
        section("identity", "Identity", identity_items, "available"),
        section("occupations", "Public Record", public_record_items, ""),
        section("education", "Education", education_items, ""),
        section("alignment", "Alignment", alignment_items, ""),
        section("links", "Links", links_items, ""),
    ]
}

fn labeled_items<'a>(
    groups: impl IntoIterator<Item = (&'a str, &'a [String])>,
    source_url: Option<&str>,
) -> Vec<JsonObject> {
    groups
        .into_iter()
        .flat_map(|(label, values)| {
            values.iter().map(move |value| {
                let sources = source_url
                    .into_iter()
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                object(json!({"label": label, "value": value, "sources": sources}))
            })
        })
        .collect()
}

fn section_item(label: &str, value: &str, source_urls: &[&str]) -> JsonObject {
    object(json!({
        "label": label,
        "value": value,
        "sources": source_urls.iter().copied().map(str::to_owned).collect::<Vec<_>>(),
    }))
}

fn section(id: &str, title: &str, items: Vec<JsonObject>, forced_status: &str) -> JsonObject {
    let status = if forced_status.is_empty() {
        if items.is_empty() {
            "missing"
        } else {
            "available"
        }
    } else {
        forced_status
    };
    object(json!({"id": id, "title": title, "status": status, "items": items}))
}

fn citation(label: &str, url: &str) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("label".to_owned(), label.to_owned()),
        ("url".to_owned(), url.to_owned()),
    ])
}

fn object(value: Value) -> JsonObject {
    serde_json::from_value(value).expect("fixed entity dossier object")
}

fn wikipedia_search_url(name: &str) -> String {
    api_url("https://en.wikipedia.org/w/index.php", &[("search", name)])
}

fn wikidata_search_url(name: &str) -> String {
    api_url("https://www.wikidata.org/w/index.php", &[("search", name)])
}

fn text_similarity(left: &str, right: &str) -> f64 {
    let left: Vec<char> = left.to_lowercase().chars().collect();
    let right: Vec<char> = right.to_lowercase().chars().collect();
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0; right.len() + 1];
    for (left_index, left_char) in left.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_char) in right.iter().enumerate() {
            current[right_index + 1] = (previous[right_index + 1] + 1)
                .min(current[right_index] + 1)
                .min(previous[right_index] + usize::from(left_char != right_char));
        }
        std::mem::swap(&mut previous, &mut current);
    }
    1.0 - previous[right.len()] as f64 / left.len().max(right.len()) as f64
}

fn token_overlap(left: &str, right: &str) -> f64 {
    let left: BTreeSet<String> = tokenize(left);
    let right: BTreeSet<String> = tokenize(right);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(&right).count();
    let union = left.union(&right).count();
    intersection as f64 / union as f64
}

fn tokenize(value: &str) -> BTreeSet<String> {
    let mut tokens = BTreeSet::new();
    let mut token = String::new();
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            token.push(character);
        } else if !token.is_empty() {
            tokens.insert(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        tokens.insert(token);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::{claim_item_ids_from, is_journalist, text_similarity, token_overlap, Candidate};
    use serde_json::json;

    #[test]
    fn reporter_evidence_helpers_respect_wikidata_shapes_and_distinct_tokens() {
        let claims = json!({
            "P31": [{"mainsnak":{"datavalue":{"value":{"id":"Q5"}}}}],
            "P106": [{"mainsnak":{"datavalue":{"value":{"id":"Q1930187"}}}}]
        });
        assert_eq!(claim_item_ids_from(&claims, "P31"), ["Q5"]);
        assert_eq!(
            token_overlap("Reuters reporter", "reporter at Reuters"),
            1.0
        );
        assert_eq!(text_similarity("Jane Doe", "Jane Doe"), 1.0);
        assert!(text_similarity("Jane Doe", "Jane Smith") < 1.0);
    }

    #[test]
    fn journalist_filter_uses_public_occupation_labels() {
        let candidate = Candidate {
            id: "Q1".to_owned(),
            label: "Example Person".to_owned(),
            description: String::new(),
            occupations: vec!["Investigative journalist".to_owned()],
            employers: Vec::new(),
            education: Vec::new(),
            field_of_work: Vec::new(),
            affiliations: Vec::new(),
            citizenships: Vec::new(),
            political_party: Vec::new(),
            political_ideology: Vec::new(),
            member_of: Vec::new(),
            official_website: None,
            twitter_handle: None,
            linkedin_url: None,
            wikipedia_title: None,
            human_score: 1.0,
            name_score: 1.0,
            context_score: 0.0,
            organization_score: 0.0,
            total_score: 0.74,
        };
        assert!(is_journalist(&candidate));
    }
}
