use std::collections::BTreeMap;
use std::env;

use chrono::{Duration, Utc};
use serde_json::{json, Map, Value};
use thesis_api::entity_research::{
    EntityResearchError, JsonObject, MaterialContextRequest, MaterialContextResponse,
};
use thesis_db::{
    Database, WikiMaterialGdeltContext, WikiMaterialInterestSnapshot,
    WikiMaterialSourceOwnerInterests,
};

use crate::providers::chat::{ChatCompletionRequest, ChatMessage, ChatRole};
use crate::providers::{ChatClientError, ChatCompletionClient};
const MATERIAL_SERVICE_NAME: &str = "material";
const OPENROUTER_DEFAULT_MODEL: &str = "z-ai/glm-4.5-air:free";
const COPY_STYLE_GUIDE: &str = "Write direct prose. Keep sentences short and plain. Use a modern, casual tone. Do not use emojis or em dashes. Avoid expectation flips and contrast framing. Do not add meta commentary about the writing process. Do not write listicles or stack fragments. Do not claim that facts show or reveal anything. Do not use the following words in prose unless they are part of quoted source material, fixed field names, or required schema keys: align, crucial, delve, emphasize, enduring, enhance, fostering, garnered, highlight, interplay, intricate, pivotal, showcase, tapestry, underscore. Keep qualifiers light and avoid jargon.";

pub(super) async fn material_context(
    database: &Database,
    chat: Option<&ChatCompletionClient>,
    request: MaterialContextRequest,
) -> Result<MaterialContextResponse, EntityResearchError> {
    let now = Utc::now();
    let mut countries: Vec<String> = std::iter::once(request.source_country.as_str())
        .chain(
            request
                .mentioned_countries
                .iter()
                .take(4)
                .map(String::as_str),
        )
        .filter(|country| !country.is_empty())
        .map(str::to_owned)
        .collect();
    if countries.is_empty() {
        countries = request
            .mentioned_countries
            .iter()
            .filter(|country| !country.is_empty())
            .take(5)
            .cloned()
            .collect();
    }
    countries
        .iter_mut()
        .for_each(|country| *country = country.to_uppercase());
    let snapshot = database
        .wiki_material_interest_snapshot(
            &countries,
            &request.source,
            10,
            (now - Duration::days(180)).naive_utc(),
            (now - Duration::days(30)).naive_utc(),
        )
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "material-interest database session acquisition failed");
            EntityResearchError::Failed(
                "Material context database session is unavailable".to_owned(),
            )
        })?;

    let gdelt_context = gdelt_context(&snapshot.gdelt_context);
    let country_resources = country_resources(&snapshot.country_resources);
    let trade_relationships = trade_relationships(&snapshot);
    let owner_interests = owner_interests(&snapshot.source_owner_interests);
    let commodity_context = commodity_context(&snapshot.commodity_context);
    let (analysis, beneficiary_table) = analyze(
        chat,
        &request,
        &gdelt_context,
        &country_resources,
        &trade_relationships,
        &owner_interests,
        &commodity_context,
    )
    .await;

    let analysis_json = json!({
        "beneficiary_table": beneficiary_table,
        "analysis_summary": analysis.summary,
        "reader_warnings": analysis.reader_warnings,
        "potential_conflicts": analysis.potential_conflicts,
        "confidence": analysis.confidence,
    });
    let created_at = Utc::now().naive_utc();
    let article_url = format!(
        "material_{}_{}",
        request.source,
        created_at.format("%Y%m%d%H%M%S")
    );
    if let Err(error) = database
        .wiki_save_material_interest_analysis(
            &article_url,
            &request.source,
            analysis_json,
            created_at,
        )
        .await
    {
        tracing::error!(error = %error, source = %request.source, "material-interest analysis persistence failed");
    }

    Ok(MaterialContextResponse {
        source: request.source,
        source_country: request.source_country,
        mentioned_countries: request.mentioned_countries,
        trade_relationships,
        known_interests: owner_interests,
        potential_conflicts: analysis.potential_conflicts,
        analysis_summary: Some(analysis.summary),
        reader_warnings: Some(analysis.reader_warnings),
        confidence: Some(analysis.confidence),
        analyzed_at: Some(Utc::now().to_rfc3339()),
    })
}

pub(super) async fn economic_profile(
    database: &Database,
    country_code: &str,
) -> Result<JsonObject, EntityResearchError> {
    let country = country_code.to_uppercase();
    let records = database
        .wiki_country_resources(std::slice::from_ref(&country))
        .await
        .map_err(|error| {
            tracing::error!(error = %error, country = %country, "country resource query failed");
            EntityResearchError::Failed("Country economic profile is unavailable".to_owned())
        })?;
    match records.into_iter().next() {
        Some(record) => Ok(object(json!({
            "natural_resources": record.natural_resources.0,
            "top_exports": record.top_exports.0,
            "top_imports": record.top_imports.0,
            "economic_sectors": record.economic_sectors.0,
        }))),
        None => Ok(object(json!({"note": "Economic data not available"}))),
    }
}

struct Analysis {
    summary: String,
    reader_warnings: Vec<String>,
    potential_conflicts: Vec<String>,
    confidence: String,
}

async fn analyze(
    chat: Option<&ChatCompletionClient>,
    request: &MaterialContextRequest,
    gdelt_context: &Value,
    country_resources: &Value,
    trade_relationships: &[Value],
    owner_interests: &Value,
    commodity_context: &Value,
) -> (Analysis, Value) {
    let Some(chat) = chat else {
        return (fallback_analysis("LLM client not available."), json!([]));
    };
    let now = Utc::now();
    let date = now.format("%Y-%m-%d");
    let system_prompt = format!(
        "Current date is {date}. You are Scoop's material interest analyst.\n\nAssess potential material interests, conflicts, blind spots, and reader warnings from the supplied source, owner, trade, GDELT, and commodity context.\n\nUse the provided context first. Do not invent facts. If something is uncertain, say so plainly. Cite URLs when they are available.\n\n{COPY_STYLE_GUIDE}\n\nReturn valid JSON only. No markdown fences or extra prose."
    );
    let topics = request
        .topics
        .as_deref()
        .filter(|topics| !topics.is_empty())
        .map(|topics| topics.join(", "))
        .unwrap_or_else(|| "general".to_owned());
    let article_excerpt: String = request
        .article_text
        .as_deref()
        .unwrap_or_default()
        .chars()
        .take(2_000)
        .collect();
    let user_prompt = format!(
        "Analyze material interests affecting coverage of this news story.\n\nSource: {} (from {})\nCountries mentioned: {}\nTopics: {}\n\nArticle text (excerpt): {}\n\nGDELT economic context (last 30 days between mentioned countries):\n{}\n\nCountry resources (natural resources, exports, imports):\n{}\n\nTrade flows between mentioned countries:\n{}\n\nSource owner/funding profile:\n{}\n\nCommodity price context:\n{}\n\nAnswer these questions directly:\n\n1. Who benefits economically from stability in this region? Who benefits from instability?\n2. What commodities or trade flows are at stake in this story?\n3. Does the source's ownership or funding create structural pressure on coverage?\n4. What is the reader not being told about economic interests?\n\nReturn ONLY valid JSON:\n\n{{\n  \"beneficiary_table\": [\n    {{\n      \"actor\": \"string (country, company, or organization)\",\n      \"interest_type\": \"stability|instability|economic_gain\",\n      \"interest_description\": \"Brief explanation of the economic stake\",\n      \"evidence\": \"Supporting data or reasoning\",\n      \"certainty\": \"high|medium|low\"\n    }}\n  ],\n  \"analysis_summary\": \"Concise analysis of the economic forces shaping this coverage\",\n  \"reader_warnings\": [\"Things the reader should be aware of regarding economic interests\"],\n  \"potential_conflicts\": [\"Conflicts between coverage and source interests\"]\n}}\n\n{}",
        request.source,
        request.source_country,
        request.mentioned_countries.join(", "),
        topics,
        article_excerpt,
        pretty_json(gdelt_context),
        pretty_json(country_resources),
        pretty_json(&Value::Array(trade_relationships.to_vec())),
        pretty_json(owner_interests),
        pretty_json(commodity_context),
        COPY_STYLE_GUIDE,
    );
    let result = call_material_llm(chat, MATERIAL_SERVICE_NAME, &system_prompt, &user_prompt).await;
    let content = match result {
        Ok(content) => content,
        Err(error) => {
            tracing::error!(service_name = MATERIAL_SERVICE_NAME, error = %error, "material-interest LLM call failed");
            return (fallback_analysis("Analysis failed."), json!([]));
        }
    };
    let Some(parsed) = extract_json_object(&content) else {
        tracing::warn!(
            service_name = MATERIAL_SERVICE_NAME,
            "material-interest LLM response was not valid JSON"
        );
        return (fallback_analysis("Analysis unavailable."), json!([]));
    };
    let beneficiary_table = parsed
        .get("beneficiary_table")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let summary = parsed
        .get("analysis_summary")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let reader_warnings = string_array(parsed.get("reader_warnings"));
    let potential_conflicts = string_array(parsed.get("potential_conflicts"));
    let confidence = parsed
        .get("certainty")
        .and_then(Value::as_str)
        .unwrap_or("medium")
        .to_owned();
    (
        Analysis {
            summary,
            reader_warnings,
            potential_conflicts,
            confidence,
        },
        beneficiary_table,
    )
}

async fn call_material_llm(
    chat: &ChatCompletionClient,
    service_name: &'static str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, ChatClientError> {
    tracing::debug!(service_name, "calling configured material-interest LLM");
    let openrouter_default =
        env::var("OPEN_ROUTER_MODEL").unwrap_or_else(|_| OPENROUTER_DEFAULT_MODEL.to_owned());
    let model = chat.resolve_service_model(&openrouter_default).await?;
    chat.complete(ChatCompletionRequest {
        service: service_name.to_owned(),
        provider: chat.active_provider().to_owned(),
        model,
        session_id: None,
        messages: vec![
            ChatMessage {
                role: ChatRole::System,
                content: Some(system_prompt.to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: None,
                name: None,
            },
            ChatMessage {
                role: ChatRole::User,
                content: Some(user_prompt.to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: None,
                name: None,
            },
        ],
        tools: Vec::new(),
        tool_choice: None,
        parallel_tool_calls: None,
        response_format: None,
        max_tokens: Some(1_200),
        temperature: Some(0.3),
    })
    .await
    .map(|completion| completion.content.unwrap_or_default())
}

fn fallback_analysis(summary: &str) -> Analysis {
    Analysis {
        summary: summary.to_owned(),
        reader_warnings: Vec::new(),
        potential_conflicts: Vec::new(),
        confidence: "medium".to_owned(),
    }
}

fn extract_json_object(content: &str) -> Option<Value> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    if end < start {
        return None;
    }
    let value: Value = serde_json::from_str(content.get(start..=end)?).ok()?;
    value.is_object().then_some(value)
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn gdelt_context(value: &Result<WikiMaterialGdeltContext, sqlx::Error>) -> Value {
    match value {
        Ok(context) => gdelt_value(context),
        Err(error) => {
            tracing::error!(error = %error, "GDELT material context query failed");
            json!({
                "cooperation_events": 0,
                "conflict_events": 0,
                "economic_events": 0,
                "avg_tone": null,
                "avg_goldstein": null,
                "total_events": 0,
                "error": error.to_string(),
            })
        }
    }
}

fn gdelt_value(context: &WikiMaterialGdeltContext) -> Value {
    json!({
        "cooperation_events": context.cooperation_events,
        "conflict_events": context.conflict_events,
        "economic_events": context.economic_events,
        "avg_tone": context.avg_tone,
        "avg_goldstein": context.avg_goldstein,
        "total_events": context.total_events,
    })
}

fn country_resources(
    value: &Result<Vec<thesis_db::WikiMaterialCountryResource>, sqlx::Error>,
) -> Value {
    match value {
        Ok(records) => {
            let resources: BTreeMap<String, Value> = records
                .iter()
                .map(|record| {
                    (
                        record.country_code.clone(),
                        json!({
                            "natural_resources": record.natural_resources.0,
                            "top_exports": record.top_exports.0,
                            "top_imports": record.top_imports.0,
                            "economic_sectors": record.economic_sectors.0,
                        }),
                    )
                })
                .collect();
            serde_json::to_value(resources).unwrap_or_else(|_| json!({}))
        }
        Err(error) => {
            tracing::error!(error = %error, "country resources material context query failed");
            json!({})
        }
    }
}

fn trade_relationships(snapshot: &WikiMaterialInterestSnapshot) -> Vec<Value> {
    snapshot
        .trade_relationships
        .iter()
        .map(|pair| match &pair.data {
            Ok(data) => json!({
                "exporter": pair.exporter,
                "importer": pair.importer,
                "total_trade_value_usd": data.total_trade_value_usd,
                "product_count": data.product_count,
                "top_products": data.top_products.iter().map(|product| json!({
                    "product_code": product.product_code,
                    "product_name": product.product_name,
                    "trade_value_usd": product.trade_value_usd,
                })).collect::<Vec<_>>(),
            }),
            Err(error) => {
                tracing::error!(error = %error, exporter = %pair.exporter, importer = %pair.importer, "material trade pair query failed");
                json!({
                    "exporter": pair.exporter,
                    "importer": pair.importer,
                    "total_trade_value_usd": null,
                    "product_count": 0,
                    "top_products": [],
                })
            }
        })
        .collect()
}

fn owner_interests(value: &Result<WikiMaterialSourceOwnerInterests, sqlx::Error>) -> Value {
    match value {
        Ok(interests) => {
            let organization = interests.organization.as_ref().map(|organization| {
                json!({
                    "name": organization.name,
                    "org_type": organization.org_type,
                    "funding_type": organization.funding_type,
                    "parent_org_id": organization.parent_org_id,
                    "funding_sources": organization.funding_sources.0,
                    "major_advertisers": organization.major_advertisers.0,
                    "media_bias_rating": organization.media_bias_rating,
                    "factual_reporting": organization.factual_reporting,
                })
            });
            let scores = interests
                .analysis_scores
                .iter()
                .map(|score| {
                    json!({
                        "axis": score.axis,
                        "score": score.score,
                        "explanation": score.explanation,
                    })
                })
                .collect::<Vec<_>>();
            let mut result = Map::new();
            result.insert(
                "name".to_owned(),
                organization
                    .as_ref()
                    .and_then(|organization| organization.get("name"))
                    .cloned()
                    .unwrap_or_else(|| json!(interests.source_name)),
            );
            if let Some(organization) = organization {
                if let Some(object) = organization.as_object() {
                    result.extend(
                        object
                            .iter()
                            .map(|(key, value)| (key.clone(), value.clone())),
                    );
                }
            }
            result.insert("analysis_scores".to_owned(), json!(scores));
            Value::Object(result)
        }
        Err(error) => {
            tracing::error!(error = %error, "source-owner material context query failed");
            json!({})
        }
    }
}

fn commodity_context(
    value: &Result<Vec<thesis_db::WikiMaterialCommodityContext>, sqlx::Error>,
) -> Value {
    match value {
        Ok(records) => records
            .iter()
            .map(|record| {
                (
                    record.commodity_name.clone(),
                    json!({
                        "latest_price_usd": record.latest_price_usd,
                        "trend_pct_6mo": record.trend_pct_6mo,
                        "data_points": record.data_points,
                    }),
                )
            })
            .collect::<BTreeMap<_, _>>()
            .into(),
        Err(error) => {
            tracing::error!(error = %error, "commodity context query failed");
            json!({})
        }
    }
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_owned())
}

fn object(value: Value) -> JsonObject {
    serde_json::from_value(value).expect("fixed JSON object")
}

#[cfg(test)]
mod tests {
    use super::{extract_json_object, fallback_analysis, string_array};
    use serde_json::json;

    #[test]
    fn analysis_json_extraction_accepts_surrounding_text_and_rejects_malformed_output() {
        let parsed =
            extract_json_object("Result:\n{\"analysis_summary\":\"clear\"}\n").expect("object");
        assert_eq!(parsed["analysis_summary"], "clear");
        assert!(extract_json_object("not JSON").is_none());
        assert!(extract_json_object("{not-json}").is_none());
    }

    #[test]
    fn material_fallbacks_keep_exact_summary_and_empty_warning_lists() {
        let analysis = fallback_analysis("LLM client not available.");
        assert_eq!(analysis.summary, "LLM client not available.");
        assert_eq!(analysis.confidence, "medium");
        assert!(analysis.reader_warnings.is_empty());
        assert!(analysis.potential_conflicts.is_empty());
        assert_eq!(
            string_array(Some(&json!(["warning", 1, "notice"]))),
            ["warning", "notice"]
        );
    }
}
