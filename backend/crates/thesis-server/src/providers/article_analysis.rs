use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use reqwest::header::{HeaderMap, CONTENT_TYPE};
use reqwest::Url;
use serde_json::{json, Value};
use thesis_api::article_analysis::{
    ArticleAnalysisInput, ArticleAnalysisSidecar, ArticleExtractionPayload,
    ArticleExtractionSidecar, SidecarError, SidecarFuture,
};
use thesis_ingest::article_analysis::extract_article_response;
use thesis_ingest::html_extract::extract_article_from_html;
use tokio::time::sleep;

use super::chat::{ChatCompletionRequest, ChatMessage, ChatRole};
use super::{ChatClientError, ChatCompletionClient, SafeHttpFetcher};

const ARTICLE_REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const ARTICLE_MAX_REDIRECTS: u8 = 30;
const ARTICLE_MAX_HTML_BYTES: usize = 8 * 1024 * 1024;
const ARTICLE_ANALYSIS_ATTEMPTS: u8 = 5;
const ARTICLE_ANALYSIS_RETRY_MIN: Duration = Duration::from_secs(4);
const ARTICLE_ANALYSIS_RETRY_MAX: Duration = Duration::from_secs(60);
const DEFAULT_OPENROUTER_MODEL: &str = "z-ai/glm-4.5-air:free";
const ARTICLE_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REBELMOUSE_BOOTSTRAP_USER_AGENT: &str = "Mozilla/5.0";

/// Production extraction and analysis sidecars for the FastAPI article routes.
#[derive(Clone)]
pub(crate) struct ArticleAnalysisProvider {
    fetcher: SafeHttpFetcher,
    chat: Option<ChatCompletionClient>,
}

/// Build the two trait objects from the process-owned provider clients.
///
/// Both sidecars share one provider allocation. Extraction is always available
/// as a safe-fetch boundary; analysis reports the Python-compatible missing-key
/// error when no chat client is configured.
pub(crate) fn build_article_analysis_sidecars(
    fetcher: SafeHttpFetcher,
    chat: Option<ChatCompletionClient>,
) -> (
    Arc<dyn ArticleExtractionSidecar>,
    Arc<dyn ArticleAnalysisSidecar>,
) {
    let provider = Arc::new(ArticleAnalysisProvider { fetcher, chat });
    let extraction: Arc<dyn ArticleExtractionSidecar> = provider.clone();
    let analysis: Arc<dyn ArticleAnalysisSidecar> = provider;
    (extraction, analysis)
}

impl ArticleExtractionSidecar for ArticleAnalysisProvider {
    fn extract(&self, url: String) -> SidecarFuture<ArticleExtractionPayload> {
        let fetcher = self.fetcher;
        Box::pin(async move { Ok(extract_article_url(fetcher, &url).await) })
    }
}

impl ArticleAnalysisSidecar for ArticleAnalysisProvider {
    fn analyze(&self, input: ArticleAnalysisInput) -> SidecarFuture<Value> {
        let chat = self.chat.clone();
        Box::pin(async move {
            let Some(chat) = chat else {
                return Err(SidecarError::new("OpenRouter API key not configured"));
            };
            let openrouter_model = std::env::var("OPEN_ROUTER_MODEL")
                .unwrap_or_else(|_| DEFAULT_OPENROUTER_MODEL.to_owned());
            let provider = chat.active_provider().to_owned();
            let model = chat
                .resolve_service_model(&openrouter_model)
                .await
                .map_err(|error| SidecarError::new(chat_error_message(&error)))?;
            let system_prompt = analysis_system_prompt();
            let user_prompt = analysis_user_prompt(&input);

            for attempt in 0..ARTICLE_ANALYSIS_ATTEMPTS {
                let request = ChatCompletionRequest {
                    service: "article_analysis".to_owned(),
                    provider: provider.clone(),
                    model: model.clone(),
                    session_id: None,
                    messages: vec![
                        ChatMessage {
                            role: ChatRole::System,
                            content: Some(system_prompt.clone()),
                            tool_calls: Vec::new(),
                            tool_call_id: None,
                            name: None,
                        },
                        ChatMessage {
                            role: ChatRole::User,
                            content: Some(user_prompt.clone()),
                            tool_calls: Vec::new(),
                            tool_call_id: None,
                            name: None,
                        },
                    ],
                    tools: Vec::new(),
                    tool_choice: None,
                    parallel_tool_calls: None,
                    response_format: Some(json!({"type": "json_object"})),
                    max_tokens: None,
                    temperature: None,
                };

                match chat.complete(request).await {
                    Ok(completion) => {
                        let response_text = completion.content.unwrap_or_default();
                        let response_text = response_text.trim();
                        return Ok(parse_analysis_response(response_text).unwrap_or_else(|| {
                            json!({
                                "error": "Failed to parse analysis results",
                                "raw_response": response_text
                            })
                        }));
                    }
                    Err(error) => {
                        if attempt + 1 < ARTICLE_ANALYSIS_ATTEMPTS
                            && should_retry_analysis(
                                error.upstream_status(),
                                error.upstream_message().unwrap_or_default(),
                            )
                        {
                            sleep(article_analysis_retry_delay(attempt)).await;
                            continue;
                        }
                        return Err(SidecarError::new(chat_error_message(&error)));
                    }
                }
            }

            Err(SidecarError::new("Article analysis provider failed"))
        })
    }

    fn is_configured(&self) -> bool {
        self.chat.is_some()
    }
}

async fn extract_article_url(fetcher: SafeHttpFetcher, url: &str) -> ArticleExtractionPayload {
    let response = match fetcher
        .fetch_with_user_agent(
            url,
            ARTICLE_REQUEST_TIMEOUT,
            ARTICLE_MAX_REDIRECTS,
            ARTICLE_MAX_HTML_BYTES,
            None,
            ARTICLE_USER_AGENT,
        )
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::debug!(%error, "article page fetch failed");
            return extraction_failure("No article text extracted");
        }
    };
    if !is_article_content_type(&response.headers) {
        return extraction_failure("No article text extracted");
    }

    let html = String::from_utf8_lossy(&response.body);
    if let Some(payload) = extract_rebelmouse_article(fetcher, url, &html).await {
        return payload;
    }

    extraction_payload_from_html(&html, response.status.as_u16())
}

fn is_article_content_type(headers: &HeaderMap) -> bool {
    let Some(content_type) = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    else {
        return true;
    };
    let content_type = content_type.to_ascii_lowercase();
    content_type.is_empty() || content_type.contains("html") || content_type.contains("xml")
}

fn extraction_payload_from_html(html: &str, status_code: u16) -> ArticleExtractionPayload {
    let extraction = extract_article_response(html, Some(status_code));
    ArticleExtractionPayload {
        success: extraction.success,
        text: extraction.text,
        title: extraction.title,
        authors: extraction.authors,
        publish_date: extraction.publish_date,
        error: extraction.error,
    }
}

async fn extract_rebelmouse_article(
    fetcher: SafeHttpFetcher,
    page_url: &str,
    html: &str,
) -> Option<ArticleExtractionPayload> {
    if html.is_empty() {
        return None;
    }
    let bootstrap_url = Url::parse(page_url)
        .ok()?
        .join(&rebelmouse_bootstrap_path(html)?)
        .ok()?;
    let response = fetcher
        .fetch_with_user_agent(
            bootstrap_url.as_str(),
            ARTICLE_REQUEST_TIMEOUT,
            ARTICLE_MAX_REDIRECTS,
            ARTICLE_MAX_HTML_BYTES,
            None,
            REBELMOUSE_BOOTSTRAP_USER_AGENT,
        )
        .await
        .ok()?;
    if response.status.as_u16() != 200 {
        return None;
    }
    let payload: Value = serde_json::from_slice(&response.body).ok()?;
    let post = payload.get("post")?.as_object()?;
    let body = post.get("body")?.as_str()?.trim();
    if body.is_empty() {
        return None;
    }

    let parsed = extract_article_from_html(body);
    let text = normalize_rebelmouse_text(&parsed.text);
    if text.is_empty() {
        return None;
    }

    let title = first_nonempty_string(post, &["headline", "title"]).or(parsed.title);
    let authors = post
        .get("author_name")
        .and_then(Value::as_str)
        .filter(|author| !author.is_empty())
        .map(|author| vec![author.to_owned()])
        .unwrap_or(parsed.authors);
    let publish_date = first_nonempty_string(
        post,
        &["last_published_date", "created_date", "formated_created_ts"],
    )
    .or(parsed.publish_date);
    Some(ArticleExtractionPayload {
        success: true,
        text: Some(text),
        title,
        authors,
        publish_date,
        error: None,
    })
}

fn rebelmouse_bootstrap_path(html: &str) -> Option<String> {
    let property = "\"fullBootstrapUrl\"";
    let start = html.find(property)? + property.len();
    let remainder = html.get(start..)?.trim_start();
    let value = remainder.strip_prefix(':')?.trim_start();
    let quoted = value.strip_prefix('"')?;
    let mut escaped = false;
    for (index, character) in quoted.char_indices() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            let json_string = &value[..index + 2];
            return serde_json::from_str(json_string).ok();
        }
    }
    None
}

fn normalize_rebelmouse_text(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    let mut in_horizontal_whitespace = false;
    for character in text.chars() {
        if matches!(character, ' ' | '\t' | '\r' | '\u{000c}' | '\u{000b}') {
            if !in_horizontal_whitespace {
                normalized.push(' ');
                in_horizontal_whitespace = true;
            }
        } else {
            in_horizontal_whitespace = false;
            normalized.push(character);
        }
    }

    let mut collapsed = String::with_capacity(normalized.len());
    let mut characters = normalized.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\n' {
            let mut lookahead = characters.clone();
            let mut has_another_newline = false;
            while let Some(next) = lookahead.peek().copied() {
                if next == '\n' {
                    has_another_newline = true;
                    break;
                }
                if !next.is_whitespace() {
                    break;
                }
                lookahead.next();
            }
            if has_another_newline {
                collapsed.push_str("\n\n");
                while characters.peek().is_some_and(|next| next.is_whitespace()) {
                    characters.next();
                }
                continue;
            }
        }
        collapsed.push(character);
    }
    collapsed.trim().to_owned()
}

fn first_nonempty_string(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn extraction_failure(error: &str) -> ArticleExtractionPayload {
    ArticleExtractionPayload {
        success: false,
        text: None,
        title: None,
        authors: Vec::new(),
        publish_date: None,
        error: Some(error.to_owned()),
    }
}

fn analysis_system_prompt() -> String {
    format!(
        "Current date is {}. You are Scoop's news analyst.\n\nAnalyze a news article, assess source and framing, and return the result as structured data.\n\nUse the provided context first. Do not invent facts. If something is uncertain, say so plainly. Cite URLs when they are available.\n\nWrite direct prose. Keep sentences short and plain. Use a modern, casual tone. Do not use emojis or em dashes. Avoid expectation flips and contrast framing. Do not add meta commentary about the writing process. Do not write listicles or stack fragments. Do not claim that facts show or reveal anything. Do not use the following words in prose unless they are part of quoted source material, fixed field names, or required schema keys: align, crucial, delve, emphasize, enduring, enhance, fostering, garnered, highlight, interplay, intricate, pivotal, showcase, tapestry, underscore. Keep qualifiers light and avoid jargon.\n\nReturn valid JSON only. No markdown fences or extra prose.",
        Utc::now().format("%Y-%m-%d")
    )
}

fn analysis_user_prompt(input: &ArticleAnalysisInput) -> String {
    let title = input.title.as_deref().unwrap_or("None");
    let source = input
        .source_name
        .as_deref()
        .filter(|source| !source.is_empty())
        .unwrap_or("Unknown");
    let authors = if input.authors.is_empty() {
        "Unknown".to_owned()
    } else {
        input.authors.join(", ")
    };
    let publish_date = input.publish_date.as_deref().unwrap_or("None");
    let text = input.full_text.chars().take(4000).collect::<String>();

    format!(
        "\nYou are an expert media analyst and fact-checker. Analyze the following news article comprehensively.\n\n**Article Title:** {title}\n**Source:** {source}\n**Authors:** {authors}\n**Published:** {publish_date}\n\n**Article Text:**\n{text}  \n\nWork from the article text provided in this request. If verification is incomplete, mark it clearly in the JSON fields instead of guessing.\n\nPlease provide a detailed analysis in the following JSON format:\n\n{{\n  \"summary\": \"A concise 2-3 sentence summary of the article\",\n  \"source_analysis\": {{\n    \"credibility_assessment\": \"Assessment of source credibility (high/medium/low)\",\n    \"ownership\": \"Information about who owns this publication\",\n    \"funding_model\": \"How is this source funded\",\n    \"political_leaning\": \"Political bias assessment (left/center/right)\",\n    \"reputation\": \"General reputation and track record\"\n  }},\n  \"reporter_analysis\": {{\n    \"background\": \"Background information on the reporter(s) if available\",\n    \"expertise\": \"Reporter's area of expertise\",\n    \"known_biases\": \"Any known biases or perspectives\",\n    \"track_record\": \"Notable past work or controversies\"\n  }},\n  \"bias_analysis\": {{\n    \"tone_bias\": \"Analysis of emotional tone and word choice\",\n    \"framing_bias\": \"How the story is framed or presented\",\n    \"selection_bias\": \"What information is included or excluded\",\n    \"source_diversity\": \"Diversity of sources quoted in the article\",\n    \"overall_bias_score\": \"Overall bias rating (1-10, where 5 is neutral)\"\n  }},\n  \"fact_check_suggestions\": [\n    \"Key claim 1 that should be fact-checked\",\n    \"Key claim 2 that should be fact-checked\",\n    \"Key claim 3 that should be fact-checked\"\n  ],\n  \"fact_check_results\": [\n    {{\n      \"claim\": \"Specific claim from the article (quote it exactly)\",\n      \"verification_status\": \"verified/partially-verified/unverified/false\",\n      \"evidence\": \"What evidence was found via Google Search\",\n      \"sources\": [\"URL 1\", \"URL 2\"],\n      \"confidence\": \"high/medium/low\",\n      \"notes\": \"Additional context or caveats\"\n    }}\n  ],\n  \"context\": \"Important background context for understanding this story\",\n  \"missing_perspectives\": \"What perspectives or information might be missing\"\n}}\n\nCRITICAL: For fact_check_results, verify ALL specific details including:\n- Names of people, companies, organizations\n- Numbers, statistics, financial figures\n- Dates and timelines\n- Quotes and statements\n- Events and their descriptions\n- Any claims that can be objectively verified\n\nWrite direct field values with plain wording.\n\nKeep summaries and notes concise.\n\nProvide only the JSON response, no additional text.\n"
    )
}

fn parse_analysis_response(response_text: &str) -> Option<Value> {
    if response_text.is_empty() {
        return None;
    }
    let cleaned = strip_code_fence(response_text);
    let parsed = serde_json::from_str::<Value>(&cleaned).ok()?;
    parsed.is_object().then_some(parsed)
}

fn strip_code_fence(response_text: &str) -> String {
    if !response_text.starts_with("```") {
        return response_text.to_owned();
    }
    let Some((_, after_open)) = response_text.split_once("```") else {
        return response_text.to_owned();
    };
    let Some((fenced, _)) = after_open.split_once("```") else {
        return response_text.to_owned();
    };
    fenced
        .strip_prefix("json")
        .unwrap_or(fenced)
        .trim()
        .to_owned()
}

fn should_retry_analysis(status: Option<u16>, message: &str) -> bool {
    if status == Some(429) {
        return true;
    }
    let lower = message.to_ascii_lowercase();
    lower.contains("429") || lower.contains("rate limit") || lower.contains("too many requests")
}

fn article_analysis_retry_delay(retry_index: u8) -> Duration {
    let multiplier = 1_u32
        .checked_shl(u32::from(retry_index))
        .unwrap_or(u32::MAX);
    ARTICLE_ANALYSIS_RETRY_MIN
        .saturating_mul(multiplier)
        .min(ARTICLE_ANALYSIS_RETRY_MAX)
}

fn chat_error_message(error: &ChatClientError) -> String {
    if let Some(message) = error.upstream_message() {
        let Some(status) = error.upstream_status() else {
            return message.to_owned();
        };
        return format!("Error code: {status} - {message}");
    }
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        article_analysis_retry_delay, extraction_payload_from_html, normalize_rebelmouse_text,
        parse_analysis_response, should_retry_analysis,
    };
    use std::time::Duration;

    #[test]
    fn html_extraction_uses_the_production_barrier_and_success_contract() {
        let html = "<html><head><title>Captured title</title><meta name=author content='Jane Doe'></head><body><article><p>First reported paragraph.</p><p>Second reported paragraph.</p></article></body></html>";
        let success = extraction_payload_from_html(html, 200);
        assert!(success.success);
        assert_eq!(
            success.text.as_deref(),
            Some("First reported paragraph.\n\nSecond reported paragraph.")
        );
        assert_eq!(success.title.as_deref(), Some("Captured title"));
        assert_eq!(success.authors, ["Jane Doe"]);

        let blocked = extraction_payload_from_html(
            "<html><body><p>Verify you are human</p></body></html>",
            403,
        );
        assert!(!blocked.success);
        assert_eq!(
            blocked.error.as_deref(),
            Some("Publisher blocked automated access with a verification page")
        );
        assert!(blocked.text.is_none());
    }

    #[test]
    fn rebelmouse_text_normalization_preserves_single_newlines_and_collapses_blank_lines() {
        assert_eq!(
            normalize_rebelmouse_text("  first \t\t line\ncontinued\n \t\n\nthird  "),
            "first line\ncontinued\n\nthird"
        );
    }

    #[test]
    fn analysis_response_parser_matches_python_object_and_raw_error_semantics() {
        assert_eq!(
            parse_analysis_response("{\"summary\":\"captured\"}")
                .and_then(|value| value.get("summary").cloned()),
            Some(serde_json::json!("captured"))
        );
        assert_eq!(
            parse_analysis_response("```json\n{\"summary\":\"captured\"}\n```")
                .and_then(|value| value.get("summary").cloned()),
            Some(serde_json::json!("captured"))
        );
        assert!(parse_analysis_response("[1,2]").is_none());
        assert!(parse_analysis_response("not-json").is_none());
    }

    #[test]
    fn retries_only_python_rate_limit_signatures_with_its_backoff_schedule() {
        assert!(should_retry_analysis(Some(429), "quota"));
        assert!(should_retry_analysis(Some(503), "Rate limit exceeded"));
        assert!(should_retry_analysis(None, "too many requests"));
        assert!(!should_retry_analysis(Some(503), "temporarily unavailable"));
        assert!(!should_retry_analysis(Some(408), "request timed out"));
        assert_eq!(article_analysis_retry_delay(0), Duration::from_secs(4));
        assert_eq!(article_analysis_retry_delay(1), Duration::from_secs(8));
        assert_eq!(article_analysis_retry_delay(2), Duration::from_secs(16));
        assert_eq!(article_analysis_retry_delay(10), Duration::from_secs(60));
    }
}
