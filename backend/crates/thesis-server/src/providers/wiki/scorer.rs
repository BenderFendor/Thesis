use serde_json::{json, Map, Value};

use crate::providers::ChatCompletionClient;

use super::{
    WikiScoreFuture, WikiSourceAnalysisAxis, WikiSourceAxisScore, WikiSourceOrganizationUpdates,
    WikiSourceScorer, WikiSourceScoringError, WikiSourceScoringRequest, WikiSourceScoringResult,
};

const SCORER_SYSTEM_PROMPT: &str = "You are a media systems analyst. Score a news source against a source-analysis rubric using supplied context. Return valid JSON only, without markdown fences or extra prose. Keep prose direct, specific, and evidence-based.";
const LLM_AXES: [WikiSourceAnalysisAxis; 3] = [
    WikiSourceAnalysisAxis::SourceNetwork,
    WikiSourceAnalysisAxis::PoliticalBias,
    WikiSourceAnalysisAxis::FramingOmission,
];
const DEFAULT_EMPIRICAL_BASIS: &str =
    "No empirical data available. Score defaulted to 3 (neutral risk) rather than guessing.";
const MISSING_EMPIRICAL_BASIS: &str =
    "This score is primarily based on LLM analysis and should be verified with empirical research.";

#[derive(Clone)]
pub(crate) struct ConfiguredWikiSourceScorer {
    chat: Option<ChatCompletionClient>,
}

impl ConfiguredWikiSourceScorer {
    pub(crate) fn new(chat: Option<ChatCompletionClient>) -> Self {
        Self { chat }
    }

    async fn score(&self, request: WikiSourceScoringRequest) -> WikiSourceScoringResult {
        let organization = request.organization_data.as_ref();
        let include_organization_updates = organization.is_object()
            && organization
                .get("research_confidence")
                .and_then(Value::as_str)
                != Some("high");
        let funding = score_funding(&request.source_name, organization, &request.source_metadata);
        let credibility = score_credibility(&request.source_name, organization);

        let llm_output = if let Some(chat) = &self.chat {
            let prompt = build_user_prompt(
                &request.source_name,
                organization,
                &request.source_metadata,
                include_organization_updates,
            );
            match chat
                .complete(
                    SCORER_SYSTEM_PROMPT,
                    &prompt,
                    if include_organization_updates {
                        2200
                    } else {
                        1800
                    },
                    0.3,
                )
                .await
            {
                Ok(content) => parse_llm_output(&content, include_organization_updates),
                Err(_) => None,
            }
        } else {
            None
        };

        let source_network =
            parsed_axis_score(llm_output.as_ref(), WikiSourceAnalysisAxis::SourceNetwork);
        let political_bias =
            parsed_axis_score(llm_output.as_ref(), WikiSourceAnalysisAxis::PoliticalBias);
        let framing_omission =
            parsed_axis_score(llm_output.as_ref(), WikiSourceAnalysisAxis::FramingOmission);
        let scores = vec![
            funding,
            source_network,
            political_bias,
            credibility,
            framing_omission,
        ];
        WikiSourceScoringResult {
            scores,
            organization_updates: include_organization_updates
                .then(|| llm_output.and_then(|output| output.organization_updates))
                .flatten(),
        }
    }
}

impl WikiSourceScorer for ConfiguredWikiSourceScorer {
    fn score_source(
        &self,
        request: WikiSourceScoringRequest,
    ) -> WikiScoreFuture<Result<WikiSourceScoringResult, WikiSourceScoringError>> {
        let scorer = self.clone();
        Box::pin(async move { Ok(scorer.score(request).await) })
    }
}

struct ParsedLlmOutput {
    scores: [Option<WikiSourceAxisScore>; 3],
    organization_updates: Option<WikiSourceOrganizationUpdates>,
}

fn parse_llm_output(content: &str, include_organization_updates: bool) -> Option<ParsedLlmOutput> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    let payload = serde_json::from_str::<Value>(content.get(start..=end)?).ok()?;
    let object = payload.as_object()?;
    let scores = LLM_AXES
        .map(|axis| parse_axis(object, axis))
        .into_iter()
        .collect::<Option<Vec<_>>>()?;
    let scores = scores.try_into().ok()?;
    let organization_updates = if include_organization_updates {
        object
            .get("organization")
            .and_then(Value::as_object)
            .map(organization_updates)
    } else {
        None
    };
    Some(ParsedLlmOutput {
        scores,
        organization_updates,
    })
}

fn parse_axis(
    object: &Map<String, Value>,
    axis: WikiSourceAnalysisAxis,
) -> Option<Option<WikiSourceAxisScore>> {
    let Some(axis_data) = object.get(axis.as_str()).and_then(Value::as_object) else {
        return Some(None);
    };
    if axis_data.is_empty() {
        return Some(None);
    }

    let score = match axis_data.get("score") {
        None => 3,
        Some(Value::Number(value)) => parse_number_score(value)?,
        Some(Value::String(value)) => value.parse::<i64>().ok()?.clamp(1, 5) as i32,
        Some(_) => return None,
    };
    let citations = axis_data
        .get("citations")
        .and_then(Value::as_array)
        .cloned()
        .map(Value::Array)
        .unwrap_or_else(|| json!([]));
    Some(Some(WikiSourceAxisScore {
        axis,
        score,
        confidence: Some(
            axis_data
                .get("confidence")
                .map_or_else(|| "low".to_owned(), value_to_text),
        ),
        prose_explanation: Some(
            axis_data
                .get("prose")
                .map_or_else(String::new, value_to_text),
        ),
        citations: Some(citations),
        empirical_basis: Some(
            axis_data
                .get("empirical_basis")
                .map_or_else(|| MISSING_EMPIRICAL_BASIS.to_owned(), value_to_text),
        ),
        scored_by: Some("llm".to_owned()),
    }))
}
fn parse_number_score(value: &serde_json::Number) -> Option<i32> {
    if let Some(value) = value.as_i64() {
        return Some(value.clamp(1, 5) as i32);
    }
    if let Some(value) = value.as_u64() {
        return Some(if value >= 5 { 5 } else { value as i32 });
    }
    value
        .as_f64()
        .map(|value| value.trunc().clamp(1.0, 5.0) as i32)
}

fn organization_updates(organization: &Map<String, Value>) -> WikiSourceOrganizationUpdates {
    WikiSourceOrganizationUpdates {
        funding_type: string_field(organization, "funding_type"),
        parent_org: string_field(organization, "parent_org"),
        media_bias_rating: string_field(organization, "media_bias_rating"),
        factual_reporting: string_field(organization, "factual_reporting"),
    }
}

fn parsed_axis_score(
    output: Option<&ParsedLlmOutput>,
    axis: WikiSourceAnalysisAxis,
) -> WikiSourceAxisScore {
    output
        .and_then(|output| {
            LLM_AXES
                .iter()
                .position(|candidate| *candidate == axis)
                .and_then(|index| output.scores[index].clone())
        })
        .unwrap_or_else(|| default_axis(axis))
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn default_axis(axis: WikiSourceAnalysisAxis) -> WikiSourceAxisScore {
    WikiSourceAxisScore {
        axis,
        score: 3,
        confidence: Some("low".to_owned()),
        prose_explanation: Some("Insufficient data to score this axis.".to_owned()),
        citations: Some(json!([])),
        empirical_basis: Some(DEFAULT_EMPIRICAL_BASIS.to_owned()),
        scored_by: Some("llm".to_owned()),
    }
}

fn score_funding(
    source_name: &str,
    organization: &Value,
    metadata: &super::WikiSourceScoringMetadata,
) -> WikiSourceAxisScore {
    let funding_type = normalized_value(
        organization.get("funding_type"),
        Some(metadata.funding_type.as_str()),
    );
    let transparency = normalized_value(organization.get("funding_transparency"), None);
    let parents = array_field(organization, "parent_orgs");
    let owners = array_field(organization, "owned_by");
    let advertisers = array_field(organization, "major_advertisers");
    let mut risks = ownership_risks(parents, owners);
    let (mut score, transparency_risks) =
        transparency_adjustment(&transparency, &funding_type, organization);
    risks.extend(transparency_risks);
    risks.extend(advertiser_risks(advertisers));
    if !parents.is_empty() && !owners.is_empty() {
        score = score.max(4);
    }

    let summary = if risks.is_empty() {
        "minimal funding data available".to_owned()
    } else {
        risks.join("; ")
    };
    let confidence = if matches!(transparency.as_str(), "transparent" | "partial") {
        "high"
    } else if string_field_from_value(organization.get("funding_type")).is_some()
        && transparency.is_empty()
    {
        "medium"
    } else {
        "low"
    };
    let advertiser_count = advertisers.len();
    WikiSourceAxisScore {
        axis: WikiSourceAnalysisAxis::Funding,
        score,
        confidence: Some(confidence.to_owned()),
        prose_explanation: Some(format!(
            "{source_name} funding risk analysis: {summary}. Score {score}/5 reflects transparency and concentration of the funding structure, not the funding model itself."
        )),
        citations: Some(wikipedia_citations(
            organization,
            &format!("{source_name} funding context"),
        )),
        empirical_basis: Some(format!(
            "Funding transparency={}, funding_type={}, observed parent_orgs={}, disclosed advertisers={advertiser_count}.",
            if transparency.is_empty() { "missing" } else { transparency.as_str() },
            if funding_type.is_empty() { "missing" } else { funding_type.as_str() },
            parents.len(),
        )),
        scored_by: Some("data".to_owned()),
    }
}

fn score_credibility(source_name: &str, organization: &Value) -> WikiSourceAxisScore {
    let citations = wikipedia_citations(organization, &format!("{source_name} profile"));
    let factual_reporting = string_field_from_value(organization.get("factual_reporting"))
        .unwrap_or_default()
        .to_lowercase();
    let factual_score = match factual_reporting.as_str() {
        "very-high" => Some(1),
        "high" => Some(2),
        "mixed" => Some(3),
        "low" => Some(4),
        "very-low" => Some(5),
        _ => None,
    };
    let (score, confidence, prose, basis) = match factual_score {
        Some(score) => (
            score,
            "medium",
            format!(
                "{source_name} lacks a stored credibility score, so this axis uses factual-reporting label '{factual_reporting}'."
            ),
            format!("Credibility risk is inferred from factual_reporting={factual_reporting}."),
        ),
        None => (
            3,
            "low",
            format!(
                "Credibility data for {source_name} is incomplete, so this axis defaults to neutral risk."
            ),
            "No verified credibility or factual-reporting data was available.".to_owned(),
        ),
    };
    WikiSourceAxisScore {
        axis: WikiSourceAnalysisAxis::Credibility,
        score,
        confidence: Some(confidence.to_owned()),
        prose_explanation: Some(prose),
        citations: Some(citations),
        empirical_basis: Some(basis),
        scored_by: Some("data".to_owned()),
    }
}

fn transparency_adjustment(
    transparency: &str,
    funding_type: &str,
    organization: &Value,
) -> (i32, Vec<String>) {
    match transparency {
        "transparent" => (2, vec!["discloses funding sources publicly".to_owned()]),
        "partial" => (3, vec!["partial funding disclosure".to_owned()]),
        "opaque" => (4, vec!["opaque funding structure".to_owned()]),
        "unknown" => (3, vec!["funding transparency unknown".to_owned()]),
        _ => funding_model_adjustment(funding_type, organization),
    }
}

fn funding_model_adjustment(funding_type: &str, organization: &Value) -> (i32, Vec<String>) {
    match funding_type {
        "state-funded" | "state" => (
            4,
            vec!["state-linked funding with uncertain transparency".to_owned()],
        ),
        "public" | "public broadcaster" => (3, vec!["public funding model".to_owned()]),
        "commercial" | "corporate" => {
            if !array_field(organization, "major_advertisers").is_empty() {
                (3, vec!["commercial with disclosed advertisers".to_owned()])
            } else {
                (4, vec!["commercial but undisclosed advertisers".to_owned()])
            }
        }
        "non-profit" | "nonprofit" | "independent" => {
            if !array_field(organization, "top_donors").is_empty() {
                (2, vec!["nonprofit with disclosed donors".to_owned()])
            } else {
                (3, vec!["nonprofit with undisclosed donors".to_owned()])
            }
        }
        _ => (3, Vec::new()),
    }
}

fn ownership_risks(parents: &[Value], owners: &[Value]) -> Vec<String> {
    let mut risks = Vec::new();
    if parents.len() == 1 || owners.len() == 1 {
        risks.push("single concentrated owner".to_owned());
    } else if parents.len() >= 3 || owners.len() >= 3 {
        risks.push("complex multi-owner structure".to_owned());
    }
    if !parents.is_empty() && !owners.is_empty() {
        risks.push("vertical integration detected".to_owned());
    }
    risks
}

fn advertiser_risks(advertisers: &[Value]) -> Vec<String> {
    if advertisers.len() >= 5 {
        vec!["high advertiser diversity".to_owned()]
    } else if (1..=2).contains(&advertisers.len()) {
        vec!["heavy reliance on few advertisers".to_owned()]
    } else {
        Vec::new()
    }
}

fn normalized_value(primary: Option<&Value>, fallback: Option<&str>) -> String {
    primary
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or(fallback.filter(|value| !value.is_empty()))
        .unwrap_or_default()
        .to_lowercase()
}

fn array_field<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn string_field_from_value(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn wikipedia_citations(organization: &Value, title: &str) -> Value {
    match string_field_from_value(organization.get("wikipedia_url")) {
        Some(url) => json!([{"url": url, "title": title}]),
        None => json!([]),
    }
}

fn value_to_text(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn build_user_prompt(
    source_name: &str,
    organization: &Value,
    metadata: &super::WikiSourceScoringMetadata,
    include_organization_updates: bool,
) -> String {
    let mut context = Vec::new();
    for (key, label) in [
        ("funding_type", "Funding type"),
        ("media_bias_rating", "Media bias rating"),
        ("factual_reporting", "Factual reporting"),
        ("parent_org", "Parent organization"),
    ] {
        if let Some(value) = organization
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            context.push(format!("{label}: {value}"));
        }
    }
    for (key, label) in [
        ("major_advertisers", "Major advertisers"),
        ("funding_sources", "Funding sources"),
    ] {
        let values = array_field(organization, key);
        if !values.is_empty() {
            let values = values
                .iter()
                .take(5)
                .map(value_to_text)
                .collect::<Vec<_>>()
                .join(", ");
            context.push(format!("{label}: {values}"));
        }
    }
    for (value, label) in [
        (&metadata.country, "Country"),
        (&metadata.source_type, "Source type"),
        (&metadata.political_bias, "Catalog political bias"),
    ] {
        if !value.is_empty() {
            context.push(format!("{label}: {value}"));
        }
    }
    let context = if context.is_empty() {
        "No structured data available. Score based on general knowledge of this source.".to_owned()
    } else {
        context.join("\n")
    };
    let organization_task = if include_organization_updates {
        let known = [
            ("funding_type", "Funding type"),
            ("parent_org", "Parent organization"),
            ("media_bias_rating", "Media bias rating"),
            ("factual_reporting", "Factual reporting"),
        ]
        .into_iter()
        .map(|(key, label)| {
            let value = organization
                .get(key)
                .map(value_to_text)
                .unwrap_or_else(|| "Unknown".to_owned());
            format!("- {label}: {value}")
        })
        .collect::<Vec<_>>()
        .join("\n");
        format!(
            "\n\nADDITIONAL TASK - ORGANIZATION METADATA:\nThe following organization fields are incomplete. Based on your knowledge of {source_name}, provide best-effort values for any missing fields.\nCurrently known:\n{known}\n"
        )
    } else {
        String::new()
    };
    let organization_schema = if include_organization_updates {
        ",\n  \"organization\": {\n    \"funding_type\": \"commercial|public|non-profit|state-funded|independent\",\n    \"parent_org\": \"Parent Company Name or null\",\n    \"media_bias_rating\": \"left|center-left|center|center-right|right\",\n    \"factual_reporting\": \"very-high|high|mixed|low|very-low\"\n  }"
    } else {
        ""
    };
    format!(
        "SOURCE: {source_name}\n\nAVAILABLE CONTEXT:\n{context}{organization_task}\nScore this source on these three axes. Each score is 1-5 where 1 is low structural risk and 5 is high structural risk.\nFor each axis provide score, confidence, prose, citations, and empirical_basis.\n\nSOURCE_NETWORK: weigh official state/corporate sourcing against local reporting, on-the-ground reporting, diaspora voices, NGOs, scholars, and independent experts.\nPOLITICAL_BIAS: assess recurring ideological or partisan orientation in framing, sourcing, and editorial stance.\nFRAMING_OMISSION: assess omission, loaded wording, euphemism, selective emphasis, and language that nudges readers toward a preferred view.\n\nRespond ONLY with valid JSON:\n{{\n  \"source_network\": {{\"score\": 3, \"confidence\": \"medium\", \"prose\": \"...\", \"citations\": [], \"empirical_basis\": \"...\"}},\n  \"political_bias\": {{\"score\": 3, \"confidence\": \"medium\", \"prose\": \"...\", \"citations\": [], \"empirical_basis\": \"...\"}},\n  \"framing_omission\": {{\"score\": 3, \"confidence\": \"medium\", \"prose\": \"...\", \"citations\": [], \"empirical_basis\": \"...\"}}{organization_schema}\n}}"
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        parse_llm_output, parsed_axis_score, score_credibility, score_funding,
        ConfiguredWikiSourceScorer, WikiSourceAnalysisAxis, WikiSourceScoringMetadata,
        WikiSourceScoringRequest, DEFAULT_EMPIRICAL_BASIS,
    };
    use std::sync::Arc;

    #[test]
    fn funding_score_uses_transparency_ownership_and_advertiser_evidence() {
        let organization = json!({
            "funding_type": "commercial",
            "funding_transparency": "opaque",
            "parent_orgs": ["Parent"],
            "owned_by": ["Owner"],
            "major_advertisers": ["Ad 1", "Ad 2"],
            "wikipedia_url": "https://en.wikipedia.org/wiki/Example"
        });
        let score = score_funding(
            "Example News",
            &organization,
            &WikiSourceScoringMetadata::default(),
        );
        assert_eq!(score.axis, WikiSourceAnalysisAxis::Funding);
        assert_eq!(score.score, 4);
        assert_eq!(score.confidence.as_deref(), Some("low"));
        assert!(score
            .prose_explanation
            .as_deref()
            .unwrap()
            .contains("single concentrated owner"));
        assert!(score
            .prose_explanation
            .as_deref()
            .unwrap()
            .contains("vertical integration detected"));
        assert!(score
            .prose_explanation
            .as_deref()
            .unwrap()
            .contains("heavy reliance on few advertisers"));
        assert_eq!(
            score.citations.as_ref().unwrap()[0]["title"],
            "Example News funding context"
        );
    }

    #[test]
    fn funding_uses_catalog_fallback_and_neutral_missing_transparency() {
        let organization = json!({"funding_transparency": "unknown"});
        let metadata = WikiSourceScoringMetadata {
            funding_type: "state-funded".to_owned(),
            ..WikiSourceScoringMetadata::default()
        };
        let score = score_funding("Outlet", &organization, &metadata);
        assert_eq!(score.score, 3);
        assert!(score
            .prose_explanation
            .as_deref()
            .unwrap()
            .contains("funding transparency unknown"));
        assert!(score
            .empirical_basis
            .as_deref()
            .unwrap()
            .contains("funding_type=state-funded"));
    }

    #[test]
    fn credibility_maps_factual_reporting_labels_and_unknown_to_neutral() {
        let high = score_credibility("Example", &json!({"factual_reporting": "very-high"}));
        assert_eq!(high.score, 1);
        assert_eq!(high.confidence.as_deref(), Some("medium"));
        let unknown = score_credibility("Example", &json!({}));
        assert_eq!(unknown.score, 3);
        assert_eq!(unknown.confidence.as_deref(), Some("low"));
    }

    #[test]
    fn llm_parser_clamps_scores_and_defaults_missing_axis_only() {
        let parsed = parse_llm_output(
            r#"prefix {"source_network":{"score":8,"confidence":"high","prose":"evidence","citations":[{"url":"https://example.com"}],"empirical_basis":"reports"},"political_bias":{},"framing_omission":{"score":"2"},"organization":{"funding_type":"public","unsupported":"discard"}} suffix"#,
            true,
        )
        .expect("valid LLM JSON");
        assert_eq!(parsed.scores[0].as_ref().unwrap().score, 5);
        assert!(parsed.scores[1].is_none());
        assert_eq!(parsed.scores[2].as_ref().unwrap().score, 2);
        assert_eq!(
            parsed_axis_score(Some(&parsed), WikiSourceAnalysisAxis::FramingOmission).score,
            2
        );
        let updates = parsed.organization_updates.unwrap();
        assert_eq!(updates.funding_type.as_deref(), Some("public"));
        assert_eq!(updates.parent_org, None);
        assert_eq!(updates.media_bias_rating, None);
        assert_eq!(updates.factual_reporting, None);
    }

    #[test]
    fn invalid_llm_scores_fall_back_without_partial_axis_payload() {
        let parsed = parse_llm_output(
            r#"{"source_network":{"score":"not a score"},"political_bias":{"score":2},"framing_omission":{"score":4}}"#,
            true,
        );
        assert!(parsed.is_none());
        assert_eq!(DEFAULT_EMPIRICAL_BASIS, "No empirical data available. Score defaulted to 3 (neutral risk) rather than guessing.");
    }

    #[tokio::test]
    async fn missing_chat_returns_neutral_llm_axes_and_keeps_deterministic_axes() {
        let scorer = ConfiguredWikiSourceScorer::new(None);
        let result = scorer
            .score(WikiSourceScoringRequest {
                source_name: "Example News".to_owned(),
                organization_data: Arc::new(json!({
                    "funding_type": "commercial",
                    "factual_reporting": "low",
                    "research_confidence": "medium"
                })),
                source_metadata: WikiSourceScoringMetadata::default(),
            })
            .await;

        let axes = result
            .scores
            .iter()
            .map(|score| score.axis)
            .collect::<Vec<_>>();
        assert_eq!(axes, WikiSourceAnalysisAxis::ALL.to_vec());
        assert_eq!(result.scores[0].score, 4);
        assert_eq!(result.scores[1].score, 3);
        assert_eq!(result.scores[1].confidence.as_deref(), Some("low"));
        assert_eq!(
            result.scores[1].prose_explanation.as_deref(),
            Some("Insufficient data to score this axis.")
        );
        assert_eq!(result.scores[3].score, 4);
        assert!(result.organization_updates.is_none());
    }
}
