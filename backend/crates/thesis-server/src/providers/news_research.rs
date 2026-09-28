mod external_search;
mod retrieval;
mod stream;

pub(super) use external_search::{
    is_ddg_challenge, normalize_gdelt_articles, parse_duckduckgo_results, read_limited_body,
};
pub(super) use retrieval::{
    article_record_to_value, ArticleDeduper, NewsResearchProviderImpl, RetrievalResult,
};
pub(super) use stream::ProviderStreamState;

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::{Body, Bytes};
use chrono::{NaiveDateTime, Utc};
use futures_util::{stream, Stream, StreamExt};
use reqwest::Url;
use serde_json::{json, Map, Value};
use thesis_api::chroma::{ChromaInclude, ChromaQueryRequest, ChromaUpsertRequest};
use thesis_api::news_research::{
    NewsResearchError, NewsResearchFuture, NewsResearchProvider, NewsResearchResponse,
    NewsResearchState, NewsResearchStreamRequest, ResearchAgentInput, ResearchArticleSnapshot,
    ResearchModelCatalog, ResearchModelOption, ThinkingStep,
};
use thesis_db::{Database, SearchArticleRecord};
use thesis_ingest::article_analysis::extract_article_response;
use tracing::warn;

use super::chat::{
    ChatCompletion, ChatCompletionRequest, ChatMessage, ChatRole, ChatStreamEvent, ChatTool,
    ChatToolCall,
};
use super::{ChatClientError, ChatCompletionClient, ProviderClients};

const SEMANTIC_LIMIT: usize = 20;
const KEYWORD_LIMIT: i64 = 50;
const RECENT_LIMIT: i64 = 40;
const MAX_RETRIEVED_ARTICLES: usize = 150;
const INTERNAL_KEYWORD_LIMIT: i64 = 10;
const MAX_TOOL_CALLS_PER_SESSION: usize = 10;
const MAX_RESEARCH_ITERATIONS: usize = 3;
const MIN_FINAL_ANSWER_CHARS: usize = 120;
const QUERY_SIMILARITY_THRESHOLD: f64 = 0.7;
const MAX_REFERENCED_SEARCH_RESULTS: usize = 5;
const MAX_TOTAL_REFERENCED_ARTICLES: usize =
    MAX_TOOL_CALLS_PER_SESSION * MAX_REFERENCED_SEARCH_RESULTS;
const MAX_CONTEXT_ARTICLES: usize = 8;
const MAX_TOOL_EVIDENCE_SNIPPETS: usize = 6;
const TOOL_RESULT_EVENT_CHARS: usize = 2_000;
const INTERNAL_ARTICLE_CHARS: usize = 12_000;
const ARTICLE_PREVIEW_CHARS: usize = 8_000;
const ARTICLE_SUMMARY_CHARS: usize = 500;
const MAX_ARTICLE_HTML_BYTES: usize = 5 * 1024 * 1024;
const MAX_DDG_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_GDELT_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const DDG_SEARCH_URL: &str = "https://html.duckduckgo.com/html/";
const GDELT_CONTEXT_URL: &str = "https://api.gdeltproject.org/api/v2/context/context";
const GDELT_DOC_URL: &str = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_DEFAULT_TIMESPAN: &str = "24h";
const MAX_RESEARCH_STREAM_TOOL_CALLS: usize = MAX_TOOL_CALLS_PER_SESSION;

static RESEARCH_SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

const COPY_STYLE_GUIDE: &str = "Write direct prose. Keep sentences short and plain. Use a modern, casual tone. Do not use emojis or em dashes. Avoid expectation flips and contrast framing. Do not add meta commentary about the writing process. Do not write listicles or stack fragments. Do not claim that facts show or reveal anything. Do not use the following words in prose unless they are part of quoted source material, fixed field names, or required schema keys: align, crucial, delve, emphasize, enduring, enhance, fostering, garnered, highlight, interplay, intricate, pivotal, showcase, tapestry, underscore. Keep qualifiers light and avoid jargon.";
const FACT_GROUNDING_RULES: &str = "Use the provided context first. Do not invent facts. If something is uncertain, say so plainly. Cite URLs when they are available.";
const PROVIDED_CONTEXT_ONLY_RULES: &str = "Use the provided context only. Do not add outside facts unless the task explicitly asks for broader research. If the context is incomplete, note the gap plainly.";
const TEXT_OUTPUT_RULES: &str = "Respond with detailed prose that stays concise and well-written.";
const ANSWER_SECTION_RULE: &str = "Respond with a section titled 'Answer'.";
const INTERNAL_SEARCH_TOOL_DESCRIPTION: &str = "Find articles in Scoop's database and RSS archive by topic keywords. Call this first, on its own, and wait for results before other searches. Use short topic queries such as 'climate change' or 'semiconductor', not instructions like 'compare how sources cover news'. Returns titles, publishers, dates, URLs and excerpts. Read returned URLs with fetch_article_content for detailed analysis and citations.";
const GDELT_CONTEXT_TOOL_DESCRIPTION: &str = "Search GDELT Context 2.0 for current-event snippets.";
const GDELT_DOC_TOOL_DESCRIPTION: &str = "Search GDELT DOC 2.0 for current-event articles.";
const WEB_SEARCH_TOOL_DESCRIPTION: &str = "Perform general web search for recent context.";
const NEWS_SEARCH_TOOL_DESCRIPTION: &str = "Search GDELT first and fall back to DuckDuckGo news for current stories.";
const FETCH_ARTICLE_TOOL_DESCRIPTION: &str = "Read an article URL returned by search. Uses stored archive text first. Returns source URL, title and text for citation and comparison. Publisher retrieval is used when no archive text exists; errors mean the article was not read. Compare specific claims and framing, not assumed outlet positions.";
const RAG_INDEX_TOOL_DESCRIPTION: &str = "Persist fresh documents into the vector store for future internal search.";


pub(crate) fn build_news_research_state(
    database: Database,
    clients: &ProviderClients,
) -> NewsResearchState {
    NewsResearchState::with_provider(NewsResearchProviderImpl::new(database, clients.clone()))
}

impl NewsResearchProvider for NewsResearchProviderImpl {
    fn retrieve_articles(&self, query: String) -> NewsResearchFuture<ResearchArticleSnapshot> {
        let provider = self.clone();
        Box::pin(async move {
            let result = provider.retrieve(&query).await?;
            Ok(ResearchArticleSnapshot {
                articles: result.articles,
            })
        })
    }

    fn research(&self, input: ResearchAgentInput) -> NewsResearchFuture<NewsResearchResponse> {
        let provider = self.clone();
        Box::pin(async move {
            let model = provider.resolve_model(input.model.as_deref())?;
            let requested_model = input.model.clone();
            let chat = provider.chat_client()?;
            let mut agent = ResearchAgent::new(
                provider,
                chat,
                model,
                requested_model,
                input.query,
                input.articles,
                input.include_thinking,
                None,
            );
            agent.run_to_completion().await
        })
    }

    fn stream(&self, input: NewsResearchStreamRequest) -> Body {
        let state = ProviderStreamState::Starting {
            provider: self.clone(),
            input,
        };
        Body::from_stream(stream::unfold(state, |state| async move {
            state.next_chunk().await
        }))
    }

    fn is_configured(&self) -> bool {
        self.clients.chat.is_some() && !self.catalog.models.is_empty()
    }
}


fn truthy_string(value: Option<&Value>) -> Option<String> {
    let value = value?.as_str()?;
    (!value.is_empty()).then(|| value.to_owned())
}

fn truthy_value(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => !values.is_empty(),
    })
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        _ => value.to_string(),
    }
}

fn take_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn provider_failed(message: impl Into<String>) -> NewsResearchError {
    NewsResearchError::ProviderFailed(message.into())
}
fn system_prompt(role: &str, task: &str, grounding: &str, output: &str) -> String {
    [
        format!(
            "Current date is {}. You are Scoop's {role}.",
            Utc::now().format("%Y-%m-%d")
        ),
        task.to_owned(),
        grounding.to_owned(),
        COPY_STYLE_GUIDE.to_owned(),
        output.to_owned(),
    ]
    .into_iter()
    .filter(|block| !block.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn research_system_prompt() -> String {
    system_prompt(
        "news research agent",
        "Work for a multi-perspective news platform. Always begin with search_internal_news to ground yourself in cached coverage from the database and RSS-backed archive. If internal search finds relevant articles, inspect those internal URLs with fetch_article_content before using GDELT or news search tools. For current events, prefer gdelt_context_search first, then gdelt_doc_search, and fall back to news_search only when GDELT is sparse or unavailable. Prefer context snippets before fetching full article text when the snippet is enough to answer. Use external search only when internal coverage is missing, stale, or clearly insufficient for the user's question. When you find useful articles that are missing from the archive, call rag_index_documents to update the store. Avoid tool commentary and focus on answering the user. Note differing viewpoints and mention bias or funding details when relevant. Search for the subject, not the wording of the user's task: for a technology coverage comparison, search technology topics such as AI or semiconductors, then compare reporting about the same event from different publishers. Start with one internal search and wait for its result. Read two or more relevant articles before writing a comparison. Do not infer an outlet's general bias from one story. For 'latest', check publication dates against today's date and explicitly disclose stale evidence.",
        FACT_GROUNDING_RULES,
        &format!("{ANSWER_SECTION_RULE}\n\n{TEXT_OUTPUT_RULES}"),
    )
}

fn finalizer_system_prompt() -> String {
    system_prompt(
        "news analyst",
        "Produce the final response from the research context.",
        &format!(
            "{PROVIDED_CONTEXT_ONLY_RULES}\n\nInclude URLs in citations when possible."
        ),
        &format!("{ANSWER_SECTION_RULE}\n\n{TEXT_OUTPUT_RULES}"),
    )
}

fn tool_router_system_prompt() -> String {
    system_prompt(
        "research tool planner",
        "Decide which tools to use for the query. Always use search_internal_news first. If it returns relevant internal articles, read those internal URLs with fetch_article_content before any external search. For current events, prefer gdelt_context_search, then gdelt_doc_search, and use news_search only when GDELT does not answer the question. Prefer context snippets before full article fetches when possible. Use web_search or news_search only after internal coverage has been checked and found insufficient.",
        FACT_GROUNDING_RULES,
        ANSWER_SECTION_RULE,
    )
}

fn research_tools() -> Vec<ChatTool> {
    vec![
        ChatTool {
            name: "search_internal_news".to_owned(),
            description: INTERNAL_SEARCH_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 5}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        ChatTool {
            name: "gdelt_context_search".to_owned(),
            description: GDELT_CONTEXT_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 10},
                    "timespan": {"type": "string", "default": GDELT_DEFAULT_TIMESPAN}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        ChatTool {
            name: "gdelt_doc_search".to_owned(),
            description: GDELT_DOC_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 10},
                    "timespan": {"type": "string", "default": GDELT_DEFAULT_TIMESPAN}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        ChatTool {
            name: "web_search".to_owned(),
            description: WEB_SEARCH_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "num_results": {"type": "integer", "default": 10}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
        ChatTool {
            name: "news_search".to_owned(),
            description: NEWS_SEARCH_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "keywords": {"type": "string"},
                    "max_results": {"type": "integer", "default": 10},
                    "region": {"type": "string", "default": "wt-wt"}
                },
                "required": ["keywords"],
                "additionalProperties": false
            }),
        },
        ChatTool {
            name: "fetch_article_content".to_owned(),
            description: FETCH_ARTICLE_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
                "additionalProperties": false
            }),
        },
        ChatTool {
            name: "rag_index_documents".to_owned(),
            description: RAG_INDEX_TOOL_DESCRIPTION.to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "documents": {
                        "type": "array",
                        "items": {"type": "object", "additionalProperties": true}
                    }
                },
                "required": ["documents"],
                "additionalProperties": false
            }),
        },
    ]
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AgentMode {
    Research,
    ToolRouter,
    FinalPending,
    Done,
}

struct ToolCallFragment {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
}

struct ActiveChatStream {
    stream: Pin<Box<dyn Stream<Item = Result<ChatStreamEvent, ChatClientError>> + Send>>,
    request: ChatCompletionRequest,
    mode: AgentMode,
    content: String,
    fragments: HashMap<usize, ToolCallFragment>,
    retried: bool,
    sent_visible_delta: bool,
}

struct ResearchAgent {
    provider: NewsResearchProviderImpl,
    chat: ChatCompletionClient,
    model: ResearchModelOption,
    requested_model: Option<String>,
    session_id: String,
    query: String,
    final_answer: String,
    articles: Vec<Value>,
    articles_searched: usize,
    include_thinking: bool,
    messages: Vec<ChatMessage>,
    iteration: usize,
    mode: AgentMode,
    tool_history: HashSet<String>,
    search_query_keys: HashSet<String>,
    internal_search_done: bool,
    internal_search_succeeded: bool,
    internal_search_hits: usize,
    internal_fetch_urls: HashSet<String>,
    tool_results: HashMap<String, String>,
    logged_tool_calls: HashSet<String>,
    source_providers: BTreeSet<String>,
    article_lookup: HashMap<String, Value>,
    fetched_urls: HashMap<String, Value>,
    referenced_articles: Vec<Value>,
    tool_snippets: Vec<String>,
    thinking_steps: Vec<ThinkingStep>,
    pending_events: VecDeque<Value>,
    pending_tool_calls: Option<Vec<ChatToolCall>>,
    active_stream: Option<ActiveChatStream>,
    final_events_queued: bool,
}

impl ResearchAgent {
    fn new(
        provider: NewsResearchProviderImpl,
        chat: ChatCompletionClient,
        model: ResearchModelOption,
        requested_model: Option<String>,
        query: String,
        articles: Vec<Value>,
        include_thinking: bool,
        history: Option<Value>,
    ) -> Self {
        let mut article_lookup = HashMap::new();
        for article in &articles {
            register_article_lookup(&mut article_lookup, article);
        }
        let messages = initial_messages(&query, history, &model.provider);
        let articles_searched = articles.len();
        Self {
            provider,
            chat,
            model,
            requested_model,
            session_id: new_research_session_id(),
            query,
            final_answer: String::new(),
            articles,
            articles_searched,
            include_thinking,
            messages,
            iteration: 0,
            mode: AgentMode::Research,
            tool_history: HashSet::new(),
            tool_results: HashMap::new(),
            search_query_keys: HashSet::new(),
            internal_search_done: false,
            internal_search_succeeded: false,
            internal_search_hits: 0,
            internal_fetch_urls: HashSet::new(),
            logged_tool_calls: HashSet::new(),
            source_providers: BTreeSet::new(),
            article_lookup,
            fetched_urls: HashMap::new(),
            referenced_articles: Vec::new(),
            tool_snippets: Vec::new(),
            thinking_steps: Vec::new(),
            pending_events: VecDeque::new(),
            pending_tool_calls: None,
            active_stream: None,
            final_events_queued: false,
        }
    }

    async fn run_to_completion(&mut self) -> Result<NewsResearchResponse, NewsResearchError> {
        while self.mode != AgentMode::Done {
            let call_mode = self.mode;
            let request = self.request_for_mode(call_mode);
            let completion = self
                .complete_with_llamacpp_recovery(request)
                .await
                .map_err(provider_failed)?;
            let tool_calls = self.apply_completion(completion, call_mode, false);
            if !tool_calls.is_empty() && call_mode != AgentMode::FinalPending {
                self.execute_tool_calls(tool_calls).await;
            }
        }

        self.finish_answer().await;
        Ok(self.response())
    }

    fn request_for_mode(&self, mode: AgentMode) -> ChatCompletionRequest {
        let mut messages = match mode {
            AgentMode::ToolRouter => {
                let mut messages = self.messages.clone();
                replace_system_message(&mut messages, tool_router_system_prompt());
                messages
            }
            AgentMode::FinalPending => {
                let mut messages = final_model_messages(&self.messages);
                messages.push(message(ChatRole::User, self.supported_answer_prompt()));
                messages
            }
            AgentMode::Research | AgentMode::Done => self.messages.clone(),
        };
        sanitize_messages_for_provider(&mut messages, &self.model.provider);
        let uses_tools = matches!(mode, AgentMode::Research | AgentMode::ToolRouter);
        ChatCompletionRequest {
            service: "news_research".to_owned(),
            provider: self.model.provider.clone(),
            model: self.model.model.clone(),
            session_id: Some(self.session_id.clone()),
            messages,
            tools: if uses_tools { research_tools() } else { Vec::new() },
            tool_choice: (mode == AgentMode::ToolRouter).then(|| json!("required")),
            parallel_tool_calls: (self.model.provider == "llamacpp").then_some(false),
            max_tokens: None,
            temperature: Some(0.2),
            response_format: None,
        }
    }

    async fn complete_with_llamacpp_recovery(
        &mut self,
        request: ChatCompletionRequest,
    ) -> Result<ChatCompletion, String> {
        match self.chat.complete(request.clone()).await {
            Ok(completion) => Ok(completion),
            Err(error)
                if self.model.provider == "llamacpp" && is_recoverable_llamacpp_error(&error) =>
            {
                let mut retry = request;
                if llama_model_not_found(&error) {
                    let model = self
                        .chat
                        .resolve_llamacpp_model()
                        .await
                        .map_err(|error| chat_error_message(&error))?;
                    self.model.model = model.clone();
                    retry.model = model;
                }
                recover_llamacpp_messages(&mut retry.messages);
                self.chat
                    .complete(retry)
                    .await
                    .map_err(|retry_error| chat_error_message(&retry_error))
            }
            Err(error) => Err(chat_error_message(&error)),
        }
    }

    fn apply_completion(
        &mut self,
        completion: ChatCompletion,
        call_mode: AgentMode,
        streaming: bool,
    ) -> Vec<ChatToolCall> {
        let content = completion.content.unwrap_or_default();
        self.final_answer = content.clone();
        let timestamp = timestamp();
        self.thinking_steps.push(ThinkingStep {
            r#type: "thought".to_owned(),
            content: content.clone(),
            timestamp: timestamp.clone(),
        });

        let new_calls = new_tool_calls(&completion.tool_calls, &mut self.logged_tool_calls);
        for call in &new_calls {
            let action = format!(
                "Tool request: {} {}",
                call.name,
                serde_json::to_string(&call.arguments).expect("JSON values are serializable")
            );
            self.thinking_steps.push(ThinkingStep {
                r#type: "action".to_owned(),
                content: action.clone(),
                timestamp: timestamp(),
            });
            if streaming {
                self.queue_tool_start_event(call, &action);
            }
        }

        self.messages.push(ChatMessage {
            role: ChatRole::Assistant,
            content: Some(content.clone()),
            tool_calls: completion.tool_calls.clone(),
            tool_call_id: None,
            name: None,
        });

        match call_mode {
            AgentMode::Research => {
                self.iteration += 1;
                if self.iteration >= MAX_RESEARCH_ITERATIONS {
                    self.mode = AgentMode::FinalPending;
                } else if completion.tool_calls.is_empty() {
                    self.mode = if needs_final_answer(&content) {
                        AgentMode::ToolRouter
                    } else {
                        AgentMode::Done
                    };
                } else {
                    self.mode = AgentMode::Research;
                }
            }
            AgentMode::ToolRouter => {
                self.iteration += 1;
                self.mode = if completion.tool_calls.is_empty() {
                    AgentMode::FinalPending
                } else {
                    AgentMode::Research
                };
            }
            AgentMode::FinalPending => self.mode = AgentMode::Done,
            AgentMode::Done => self.mode = AgentMode::Done,
        }

        if streaming && !content.is_empty() {
            self.pending_events.push_back(json!({
                "type": "thinking",
                "content": content,
                "timestamp": timestamp()
            }));
        }
        if streaming && call_mode != AgentMode::FinalPending {
            self.pending_tool_calls = Some(completion.tool_calls.clone());
        }
        completion.tool_calls
    }

    async fn invoke_finalizer(&mut self, prompt: String) -> Option<String> {
        let mut messages = vec![
            message(ChatRole::System, finalizer_system_prompt()),
            message(ChatRole::User, prompt),
        ];
        sanitize_messages_for_provider(&mut messages, &self.model.provider);
        let request = ChatCompletionRequest {
            service: "news_research".to_owned(),
            provider: self.model.provider.clone(),
            model: self.model.model.clone(),
            session_id: Some(self.session_id.clone()),
            messages,
            tools: Vec::new(),
            tool_choice: None,
            parallel_tool_calls: (self.model.provider == "llamacpp").then_some(false),
            max_tokens: None,
            temperature: Some(0.2),
            response_format: None,
        };
        match self.complete_with_llamacpp_recovery(request).await {
            Ok(response) => response.content.map(|content| content.trim().to_owned()),
            Err(error) => {
                warn!(%error, "news research finalizer failed");
                None
            }
        }
    }

    async fn finish_answer(&mut self) {
        let should_finalize = needs_final_answer(&self.final_answer)
            || (!self.referenced_articles.is_empty()
                && answer_denies_available_context(&self.final_answer));
        if should_finalize {
            if let Some(synthesized) = self
                .invoke_finalizer(self.supported_answer_prompt())
                .await
                .filter(|answer| !answer.is_empty())
            {
                self.final_answer = synthesized;
            }
        }
        if needs_final_answer(&self.final_answer)
            || (!self.referenced_articles.is_empty()
                && answer_denies_available_context(&self.final_answer))
        {
            self.final_answer = grounded_fallback_answer(&self.query, &self.referenced_articles);
        }
        self.final_answer = sanitize_final_answer(&self.final_answer);
    }

    fn supported_answer_prompt(&self) -> String {
        let context = self
            .referenced_articles
            .iter()
            .take(MAX_CONTEXT_ARTICLES)
            .map(context_snippet_line)
            .collect::<Vec<_>>()
            .join("\n");
        let tool_context = self
            .tool_snippets
            .iter()
            .take(MAX_TOOL_EVIDENCE_SNIPPETS)
            .enumerate()
            .filter_map(|(index, snippet)| {
                let compact = snippet.trim();
                (!compact.is_empty()).then(|| {
                    format!(
                        "Evidence {}:\n{}",
                        index + 1,
                        take_chars(compact, 1_800)
                    )
                })
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let mut parts = vec![
            format!("Question: {}", self.query),
            "Write a direct answer from the evidence below. If the evidence is mixed or incomplete, say what is confirmed and what remains unclear. Do not claim the context is missing if article excerpts or tool evidence are present. Cite the most relevant URLs inline.".to_owned(),
            "Article references:".to_owned(),
            if context.is_empty() {
                "No article context available.".to_owned()
            } else {
                context
            },
        ];
        if !tool_context.is_empty() {
            parts.push("Extracted evidence:".to_owned());
            parts.push(tool_context);
        }
        parts.push("Return the final response.".to_owned());
        parts.join("\n\n")
    }

    fn response(&self) -> NewsResearchResponse {
        let structured = structured_articles_block(
            &self.query,
            &self.referenced_articles,
            &self.source_providers,
        );
        let mut answer = self.final_answer.clone();
        if !structured.is_empty() && !answer.contains(&structured) {
            answer.push_str(&structured);
        }
        NewsResearchResponse {
            success: !answer.is_empty(),
            query: self.query.clone(),
            answer,
            thinking_steps: if self.include_thinking {
                self.thinking_steps.clone()
            } else {
                Vec::new()
            },
            articles_searched: self.articles_searched as i64,
            referenced_articles: self.referenced_articles.clone(),
            source_providers: self.source_providers.iter().cloned().collect(),
            error: None,
        }
    }

    async fn next_stream_event(&mut self) -> Result<Option<Value>, String> {
        loop {
            if let Some(event) = self.pending_events.pop_front() {
                return Ok(Some(event));
            }

            if let Some(mut active) = self.active_stream.take() {
                match active.stream.next().await {
                    Some(Ok(ChatStreamEvent::ContentDelta {
                        message_id,
                        content,
                        reasoning,
                    })) => {
                        active.content.push_str(&content);
                        if !content.is_empty() || !reasoning.is_empty() {
                            active.sent_visible_delta = true;
                            self.active_stream = Some(active);
                            return Ok(Some(json!({
                                "type": "model_delta",
                                "message_id": message_id.unwrap_or_else(|| "model".to_owned()),
                                "content": content,
                                "reasoning": if self.include_thinking { reasoning } else { String::new() },
                                "timestamp": timestamp()
                            })));
                        }
                        self.active_stream = Some(active);
                        continue;
                    }
                    Some(Ok(ChatStreamEvent::ToolCallDelta {
                        index,
                        id,
                        name,
                        arguments,
                    })) => {
                        let fragment = active.fragments.entry(index).or_insert_with(|| ToolCallFragment {
                            id: None,
                            name: None,
                            arguments: String::new(),
                        });
                        if id.is_some() {
                            fragment.id = id;
                        }
                        if name.is_some() {
                            fragment.name = name;
                        }
                        fragment.arguments.push_str(&arguments);
                        self.active_stream = Some(active);
                        continue;
                    }
                    Some(Ok(ChatStreamEvent::Finished {
                        tool_calls,
                        finish_reason: _,
                    })) => {
                        let calls = if tool_calls.is_empty() {
                            assemble_tool_call_fragments(active.fragments)?
                        } else {
                            tool_calls
                        };
                        let call_mode = active.mode;
                        let completion = ChatCompletion {
                            content: Some(active.content),
                            tool_calls: calls,
                            finish_reason: None,
                        };
                        self.apply_completion(completion, call_mode, true);
                        continue;
                    }
                    Some(Err(error)) => {
                        if self.model.provider == "llamacpp"
                            && !active.retried
                            && !active.sent_visible_delta
                            && is_recoverable_llamacpp_error(&error)
                        {
                            if llama_model_not_found(&error) {
                                let model = match self.chat.resolve_llamacpp_model().await {
                                    Ok(model) => model,
                                    Err(error) => return Err(chat_error_message(&error)),
                                };
                                self.model.model = model.clone();
                                active.request.model = model;
                            }
                            active.content.clear();
                            active.fragments.clear();
                            recover_llamacpp_messages(&mut active.request.messages);
                            active.stream = self.chat.stream(active.request.clone());
                            active.retried = true;
                            self.active_stream = Some(active);
                            continue;
                        }
                        return Err(chat_error_message(&error));
                    }
                    None => return Err("research model stream ended without a finish event".to_owned()),
                }
            }

            if let Some(calls) = self.pending_tool_calls.take() {
                if !calls.is_empty() {
                    let events = self.execute_tool_calls(calls).await;
                    self.pending_events.extend(events);
                    continue;
                }
            }

            if self.mode == AgentMode::Done {
                if self.final_events_queued {
                    return Ok(None);
                }
                self.finish_answer().await;
                self.queue_final_events();
                self.final_events_queued = true;
                continue;
            }

            let call_mode = self.mode;
            let request = self.request_for_mode(call_mode);
            self.active_stream = Some(ActiveChatStream {
                stream: self.chat.stream(request.clone()),
                request,
                mode: call_mode,
                content: String::new(),
                fragments: HashMap::new(),
                retried: false,
                sent_visible_delta: false,
            });
        }
    }

    fn queue_tool_start_event(&mut self, call: &ChatToolCall, action: &str) {
        let timestamp = timestamp();
        self.pending_events.push_back(json!({
            "type": "status",
            "message": tool_status_message(&call.name, &call.arguments),
            "timestamp": timestamp
        }));
        self.pending_events.push_back(json!({
            "type": "tool_start",
            "tool": call.name,
            "args": call.arguments,
            "timestamp": timestamp
        }));
        if self.include_thinking {
            self.pending_events.push_back(json!({
                "type": "thinking_step",
                "step": {
                    "type": "tool_start",
                    "content": action,
                    "timestamp": timestamp
                },
                "timestamp": timestamp
            }));
        }
    }

    fn queue_tool_result_event(&mut self, tool_name: &str, content: &str) {
        let timestamp = timestamp();
        let snippet = take_chars(content, TOOL_RESULT_EVENT_CHARS);
        self.pending_events.push_back(json!({
            "type": "status",
            "message": "Reviewing results.",
            "timestamp": timestamp
        }));
        self.pending_events.push_back(json!({
            "type": "tool_result",
            "tool": tool_name,
            "content": snippet,
            "timestamp": timestamp
        }));
        if self.include_thinking {
            self.pending_events.push_back(json!({
                "type": "thinking_step",
                "step": {
                    "type": "observation",
                    "content": snippet,
                    "timestamp": timestamp
                },
                "timestamp": timestamp
            }));
        }
    }

    fn queue_final_events(&mut self) {
        let timestamp = timestamp();
        self.pending_events.push_back(json!({
            "type": "referenced_articles",
            "articles": self.referenced_articles,
            "timestamp": timestamp
        }));
        let structured = structured_articles_payload(
            &self.query,
            &self.referenced_articles,
            &self.source_providers,
        );
        let structured_block = structured
            .as_ref()
            .map(pretty_structured_articles_block)
            .unwrap_or_default();
        if let Some(payload) = structured {
            self.pending_events.push_back(json!({
                "type": "articles_json",
                "data": serde_json::to_string(&payload).expect("JSON values are serializable"),
                "timestamp": timestamp()
            }));
        }
        self.pending_events.push_back(json!({
            "type": "complete",
            "result": {
                "success": !self.final_answer.trim().is_empty(),
                "query": self.query,
                "answer": self.final_answer,
                "structured_articles": structured_block,
                "articles_searched": self.articles_searched,
                "referenced_articles": self.referenced_articles,
                "source_providers": self.source_providers
            },
            "timestamp": timestamp()
        }));
    }
}

impl ResearchAgent {
    async fn execute_tool_calls(&mut self, calls: Vec<ChatToolCall>) -> Vec<Value> {
        let mut events = Vec::new();
        for call in calls {
            let tool_key = tool_call_key(&call.name, &call.arguments);
            let block_reason = self.external_search_block_reason(&call.name);
            let duplicate_key = if block_reason.is_none() {
                self.find_duplicate_tool_key(&call.name, &call.arguments)
            } else {
                None
            };
            let result = if let Some(reason) = block_reason {
                reason
            } else if self.tool_history.len() >= MAX_RESEARCH_STREAM_TOOL_CALLS
                && duplicate_key.is_none()
            {
                format!(
                    "Tool call limit reached ({MAX_TOOL_CALLS_PER_SESSION} unique calls per session). Synthesize an answer from the evidence already gathered."
                )
            } else if let Some(previous_key) = duplicate_key {
                self.tool_results
                    .get(&previous_key)
                    .cloned()
                    .unwrap_or_else(|| {
                        "This or a very similar search was already run. Reuse prior results from the conversation."
                            .to_owned()
                    })
            } else {
                self.tool_history.insert(tool_key.clone());
                if let Some(query) = search_query_for_tool(&call.name, &call.arguments) {
                    self.search_query_keys
                        .insert(normalize_search_query(query));
                }
                let result = self.execute_tool(&call.name, &call.arguments).await;
                let result = self
                    .run_auto_fallback(&call.name, &call.arguments, result)
                    .await;
                self.tool_results.insert(tool_key, result.clone());
                result
            };
            let bounded_result = take_chars(&result, INTERNAL_ARTICLE_CHARS);
            self.tool_snippets.push(bounded_result.clone());
            self.thinking_steps.push(ThinkingStep {
                r#type: "observation".to_owned(),
                content: bounded_result.clone(),
                timestamp: timestamp(),
            });
            self.messages.push(ChatMessage {
                role: ChatRole::Tool,
                content: Some(bounded_result.clone()),
                tool_calls: Vec::new(),
                tool_call_id: Some(call.id.clone()),
                name: Some(call.name.clone()),
            });
            let result_event_count = self.pending_events.len();
            self.queue_tool_result_event(&call.name, &bounded_result);
            events.extend(self.pending_events.drain(result_event_count..));
        }
        events
    }

    fn has_internal_search(&self) -> bool {
        self.internal_search_done
    }

    fn external_search_block_reason(&self, tool_name: &str) -> Option<String> {
        if !is_external_search_tool(tool_name) {
            return None;
        }
        if !self.has_internal_search() {
            return Some(
                "Use search_internal_news first. Check the internal archive before using external search."
                    .to_owned(),
            );
        }
        let required_fetches = if self.internal_search_succeeded {
            self.internal_search_hits.min(2)
        } else {
            0
        };
        if self.internal_fetch_urls.len() < required_fetches {
            return Some(
                "Internal search found relevant archive coverage. Read the internal article URLs with fetch_article_content before using external search."
                    .to_owned(),
            );
        }
        None
    }

    async fn run_auto_fallback(
        &mut self,
        tool_name: &str,
        arguments: &Value,
        mut result: String,
    ) -> String {
        let fallbacks: &[&str] = match tool_name {
            "gdelt_context_search" => &["gdelt_doc_search", "news_search"],
            "gdelt_doc_search" => &["news_search"],
            _ => return result,
        };
        let mut current_name = tool_name;
        let mut current_result = result.clone();
        for fallback_name in fallbacks {
            if !tool_result_needs_fallback(current_name, &current_result) {
                break;
            }
            if self.tool_history.len() >= MAX_RESEARCH_STREAM_TOOL_CALLS {
                break;
            }
            let Some(fallback_arguments) =
                fallback_tool_arguments(fallback_name, arguments)
            else {
                continue;
            };
            let fallback_key = tool_call_key(fallback_name, &fallback_arguments);
            if !self.tool_history.insert(fallback_key) {
                continue;
            }
            let fallback_result = self
                .execute_tool(fallback_name, &fallback_arguments)
                .await;
            result = format!(
                "{result}\n\nAutomatic fallback via {fallback_name}:\n{fallback_result}"
            );
            current_name = fallback_name;
            current_result = fallback_result;
        }
        result
    }

    fn find_duplicate_tool_key(&self, name: &str, arguments: &Value) -> Option<String> {
        let key = tool_call_key(name, arguments);
        if self.tool_history.contains(&key) {
            return Some(key);
        }
        let Some(query) = search_query_for_tool(name, arguments) else {
            return None;
        };
        let query = normalize_search_query(query);
        self.search_query_keys
            .iter()
            .find(|previous| search_queries_similar(&query, previous))
            .map(|previous| format!("search_query:{previous}"))
    }

    async fn execute_tool(&mut self, name: &str, arguments: &Value) -> String {
        match name {
            "search_internal_news" => {
                let query = argument_string(arguments, "query").unwrap_or(&self.query);
                let top_k = argument_usize(arguments, "top_k", 5)
                    .clamp(1, INTERNAL_KEYWORD_LIMIT as usize);
                match self.search_internal_news(query, top_k).await {
                    Ok(results) if results.is_empty() => {
                        "No relevant articles found in internal archive.".to_owned()
                    }
                    Ok(results) => {
                        serde_json::to_string(&results).expect("JSON values are serializable")
                    }
                    Err(error) => format!("Internal article search failed: {error}"),
                }
            }
            "gdelt_context_search" => {
                let query = argument_string(arguments, "query").unwrap_or(&self.query);
                let limit = argument_usize(arguments, "max_results", 10).clamp(1, 10);
                let timespan = argument_string(arguments, "timespan")
                    .unwrap_or(GDELT_DEFAULT_TIMESPAN);
                let results = self.gdelt_search(query, limit, timespan, "context").await;
                self.search_tool_result("gdelt", "GDELT context search", results)
            }
            "gdelt_doc_search" => {
                let query = argument_string(arguments, "query").unwrap_or(&self.query);
                let limit = argument_usize(arguments, "max_results", 10).clamp(1, 10);
                let timespan = argument_string(arguments, "timespan")
                    .unwrap_or(GDELT_DEFAULT_TIMESPAN);
                let results = self.gdelt_search(query, limit, timespan, "doc").await;
                self.search_tool_result("gdelt", "GDELT doc search", results)
            }
            "web_search" => {
                let query = argument_string(arguments, "query").unwrap_or(&self.query);
                let limit = argument_usize(arguments, "num_results", 10).clamp(1, 10);
                let results = self.duckduckgo_search(query, limit, None, "web").await;
                self.search_tool_result("duckduckgo", "Web search", results)
            }
            "news_search" => {
                let query = argument_string(arguments, "keywords").unwrap_or(&self.query);
                let limit = argument_usize(arguments, "max_results", 10).clamp(1, 10);
                let region = argument_string(arguments, "region").unwrap_or("wt-wt");
                let results = self.search_current_news(query, limit, region).await;
                self.search_tool_result("gdelt", "News search", results)
            }
            "fetch_article_content" => {
                let Some(url) = argument_string(arguments, "url") else {
                    return "URL is required.".to_owned();
                };
                let canonical = normalize_url(url);
                if !canonical.is_empty() && self.article_lookup.contains_key(&canonical) {
                    self.internal_fetch_urls.insert(canonical);
                }
                match self.fetch_article_content(url).await {
                    Ok(article) => {
                        self.add_reference(&article);
                        article_fetch_output(&article, url)
                    }
                    Err(error) => format!("Error fetching {url}: {error}"),
                }
            }
            "rag_index_documents" => {
                let Some(documents) = arguments.get("documents").and_then(Value::as_array) else {
                    return "Invalid documents payload.".to_owned();
                };
                match self.index_documents(documents).await {
                    Ok(indexed) if indexed > 0 => {
                        format!("Successfully indexed {indexed} documents.")
                    }
                    Ok(_) => "No documents were indexed.".to_owned(),
                    Err(error) => format!("RAG indexing failed: {error}"),
                }
            }
            _ => format!("Unknown research tool: {name}"),
        }
    }

    async fn search_internal_news(
        &mut self,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<Value>, String> {
        self.internal_search_done = true;
        let terms = extract_query_terms(query);
        if terms.is_empty() {
            self.internal_search_succeeded = false;
            self.internal_search_hits = 0;
            return Ok(Vec::new());
        }
        let records = match self
            .provider
            .database
            .search_news_articles_by_keyword(query.trim(), top_k as i64)
            .await
        {
            Ok(records) => records,
            Err(error) => {
                warn!(%error, "news research internal DB search failed; using cached retrieval");
                Vec::new()
            }
        };
        let matches = if records.is_empty() {
            let mut ranked = self
                .articles
                .iter()
                .map(|article| {
                    (
                        article_search_score(article, &terms),
                        article.clone(),
                    )
                })
                .filter(|(score, _)| *score > 0)
                .collect::<Vec<_>>();
            ranked.sort_by(|left, right| right.0.cmp(&left.0));
            let cached = if ranked.is_empty() {
                self.articles.iter().take(top_k).cloned().collect::<Vec<_>>()
            } else {
                ranked
                    .into_iter()
                    .take(top_k)
                    .map(|(_, article)| article)
                    .collect::<Vec<_>>()
            };
            cached
        } else {
            records
                .iter()
                .map(|record| {
                    let mut article = article_record_to_value(record);
                    if let Some(object) = article.as_object_mut() {
                        object.insert(
                            "retrieval_method".to_owned(),
                            json!("keyword_postgres"),
                        );
                    }
                    article
                })
                .collect::<Vec<_>>()
        };
        let mut deduper = ArticleDeduper::new(top_k);
        deduper.add_bucket(&matches);
        let matches = deduper.finish();
        self.internal_search_hits = matches.len();
        self.internal_search_succeeded = !matches.is_empty();
        if !matches.is_empty() {
            self.source_providers.insert("internal".to_owned());
        }
        let mut results = Vec::with_capacity(matches.len());
        for article in &matches {
            register_article_lookup(&mut self.article_lookup, article);
            self.add_reference(article);
            results.push(internal_result_payload(article));
        }
        Ok(results)
    }

    fn search_tool_result(
        &mut self,
        provider: &str,
        label: &str,
        result: Result<Vec<Value>, String>,
    ) -> String {
        match result {
            Ok(results) if results.is_empty() => "No results found.".to_owned(),
            Ok(results) => {
                self.add_references(&results);
                let mut found_provider = false;
                for result in &results {
                    if let Some(source) = truthy_string(result.get("provider")) {
                        self.source_providers.insert(source);
                        found_provider = true;
                    }
                }
                if !found_provider {
                    self.source_providers.insert(provider.to_owned());
                }
                serde_json::to_string(&results).expect("JSON values are serializable")
            }
            Err(error) => format!("{label} failed: {error}"),
        }
    }


    async fn search_current_news(
        &self,
        query: &str,
        limit: usize,
        region: &str,
    ) -> Result<Vec<Value>, String> {
        let context = match self
            .gdelt_search(query, limit, GDELT_DEFAULT_TIMESPAN, "context")
            .await
        {
            Ok(results) => results,
            Err(error) => {
                warn!(%error, "news research GDELT context query failed");
                Vec::new()
            }
        };
        let documents = if context.len() < limit {
            match self
                .gdelt_search(query, limit, GDELT_DEFAULT_TIMESPAN, "doc")
                .await
            {
                Ok(results) => results,
                Err(error) => {
                    warn!(%error, "news research GDELT document query failed");
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };
        let results = dedupe_search_results(&context, &documents, limit);
        if !results.is_empty() {
            return Ok(results);
        }
        self.duckduckgo_search(query, limit, Some(region), "news")
            .await
    }

    async fn gdelt_search(
        &self,
        query: &str,
        limit: usize,
        timespan: &str,
        search_type: &str,
    ) -> Result<Vec<Value>, String> {
        let endpoint = match search_type {
            "context" => GDELT_CONTEXT_URL,
            _ => GDELT_DOC_URL,
        };
        let mut url = Url::parse(endpoint).map_err(|error| error.to_string())?;
        url.query_pairs_mut()
            .append_pair("query", query)
            .append_pair("mode", "artlist")
            .append_pair("maxrecords", &limit.to_string())
            .append_pair("timespan", timespan)
            .append_pair("sort", "datedesc")
            .append_pair("format", "json");
        let response = self
            .provider
            .clients
            .http
            .get(url)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = read_limited_body(response, MAX_GDELT_RESPONSE_BYTES).await?;
        if !status.is_success() {
            let detail = String::from_utf8_lossy(&body);
            return Err(format!("GDELT returned HTTP {status}: {}", take_chars(&detail, 300)));
        }
        let payload: Value = serde_json::from_slice(&body)
            .map_err(|error| format!("GDELT returned invalid JSON: {error}"))?;
        let articles = payload
            .get("articles")
            .and_then(Value::as_array)
            .map(|articles| normalize_gdelt_articles(articles, search_type, limit))
            .unwrap_or_default();
        Ok(articles)
    }

    async fn duckduckgo_search(
        &self,
        query: &str,
        limit: usize,
        region: Option<&str>,
        result_type: &str,
    ) -> Result<Vec<Value>, String> {
        let response = self
            .provider
            .clients
            .http
            .post(DDG_SEARCH_URL)
            .timeout(Duration::from_secs(20))
            .form(&[
                ("q", query),
                ("kl", region.unwrap_or("wt-wt")),
                ("ia", result_type),
                ("iar", result_type),
            ])
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = read_limited_body(response, MAX_DDG_RESPONSE_BYTES).await?;
        if !status.is_success() {
            return Err(format!("DuckDuckGo returned HTTP {status}"));
        }
        let html = String::from_utf8_lossy(&body);
        if is_ddg_challenge(&html) {
            return Err("DuckDuckGo returned a challenge page; search is unavailable.".to_owned());
        }
        Ok(parse_duckduckgo_results(&html, limit, result_type))
    }

    async fn fetch_article_content(&mut self, url: &str) -> Result<Value, String> {
        let canonical = normalize_url(url);
        if canonical.is_empty() {
            return Err("URL is not valid.".to_owned());
        }
        if let Some(article) = self.fetched_urls.get(&canonical) {
            return Ok(article.clone());
        }
        if let Some(article) = self.article_lookup.get(&canonical).cloned() {
            if let Some(content) = article_content(&article) {
                let fetched = json!({
                    "url": article_url(&article).unwrap_or_else(|| url.to_owned()),
                    "title": article.get("title").cloned().unwrap_or(Value::Null),
                    "source": article.get("source").cloned().unwrap_or(Value::Null),
                    "published": article.get("published").cloned().unwrap_or(Value::Null),
                    "content": take_chars(content, INTERNAL_ARTICLE_CHARS),
                    "provider": "internal"
                });
                self.fetched_urls.insert(canonical.clone(), fetched.clone());
                return Ok(fetched);
            }
        }

        let response = self
            .provider
            .clients
            .safe_http
            .fetch(
                url,
                Duration::from_secs(20),
                3,
                MAX_ARTICLE_HTML_BYTES,
                Some(&["text/html", "application/xhtml+xml"]),
            )
            .await
            .map_err(|error| error.to_string())?;
        if !response.status.is_success() {
            return Err(format!("publisher returned HTTP {}", response.status));
        }
        let html = String::from_utf8_lossy(&response.body);
        let extraction = extract_article_response(&html, Some(response.status.as_u16()));
        if !extraction.has_usable_text() {
            return Err(extraction
                .error
                .unwrap_or_else(|| "no readable article text was extracted".to_owned()));
        }
        let content = take_chars(
            extraction.text.as_deref().unwrap_or_default(),
            INTERNAL_ARTICLE_CHARS,
        );
        let title = extraction.title.unwrap_or_else(|| "Untitled article".to_owned());
        let article = json!({
            "url": response.final_url,
            "link": response.final_url,
            "title": title,
            "source": Url::parse(&response.final_url)
                .ok()
                .and_then(|parsed| parsed.host_str().map(str::to_owned))
                .unwrap_or_else(|| "External source".to_owned()),
            "content": content,
            "summary": take_chars(&content, ARTICLE_SUMMARY_CHARS),
            "description": take_chars(&content, ARTICLE_SUMMARY_CHARS),
            "published": extraction.publish_date,
            "image": extraction.top_image,
            "provider": "publisher"
        });
        self.fetched_urls.insert(canonical, article.clone());
        Ok(article)
    }

    async fn index_documents(&self, documents: &[Value]) -> Result<usize, String> {
        let mut entries = Vec::new();
        for document in documents {
            let Some(object) = document.as_object() else {
                continue;
            };
            let content = ["content", "text"]
                .iter()
                .find_map(|key| truthy_string(object.get(*key)))
                .map(|value| take_chars(&value, INTERNAL_ARTICLE_CHARS));
            let Some(content) = content.filter(|content| !content.trim().is_empty()) else {
                continue;
            };
            let mut metadata = object
                .get("metadata")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            for (key, value) in object {
                if !matches!(key.as_str(), "content" | "text" | "metadata")
                    && matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
                {
                    metadata.entry(key.clone()).or_insert_with(|| value.clone());
                }
            }
            metadata
                .entry("summary".to_owned())
                .or_insert_with(|| Value::String(take_chars(&content, ARTICLE_SUMMARY_CHARS)));
            metadata
                .entry("title".to_owned())
                .or_insert_with(|| json!("External Article"));
            metadata.retain(|_, value| {
                matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
            });
            entries.push((document.clone(), content, metadata));
        }
        if entries.is_empty() {
            return Ok(0);
        }
        let content = entries
            .iter()
            .map(|(_, content, _)| content.clone())
            .collect::<Vec<_>>();
        let embedded = self
            .provider
            .clients
            .embedding
            .embed(&content, 32)
            .await
            .map_err(|error| error.to_string())?;
        if embedded.embeddings.len() != entries.len() {
            return Err("embedding service returned an incomplete batch".to_owned());
        }
        let ids = entries
            .iter()
            .map(|(document, content, metadata)| {
                let identity = metadata
                    .get("url")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| article_url(document))
                    .unwrap_or_else(|| content.clone());
                format!("article_{}", numeric_article_id(&identity))
            })
            .collect::<Vec<_>>();
        let metadatas = entries
            .into_iter()
            .map(|(_, _, metadata)| Some(metadata))
            .collect::<Vec<_>>();
        let indexed_count = metadatas.len();
        let collection = self
            .provider
            .clients
            .chroma
            .get_collection()
            .await
            .map_err(|error| error.to_string())?;
        collection
            .upsert(ChromaUpsertRequest {
                ids,
                embeddings: embedded.embeddings,
                metadatas: Some(metadatas),
                documents: Some(content.into_iter().map(Some).collect()),
            })
            .await
            .map_err(|error| error.to_string())?;
        Ok(indexed_count)
    }

    fn add_references(&mut self, articles: &[Value]) {
        for article in articles.iter().take(MAX_REFERENCED_SEARCH_RESULTS) {
            self.add_reference(article);
        }
    }

    fn add_reference(&mut self, article: &Value) {
        if !article.is_object() || self.referenced_articles.len() >= MAX_TOTAL_REFERENCED_ARTICLES {
            return;
        }
        let url = article_url(article).map(|url| normalize_url(&url));
        let id = article
            .get("id")
            .or_else(|| article.get("article_id"))
            .map(value_to_string);
        let duplicate = self.referenced_articles.iter().any(|existing| {
            (id.is_some()
                && existing
                    .get("id")
                    .or_else(|| existing.get("article_id"))
                    .map(value_to_string)
                    == id)
                || (url.is_some()
                    && article_url(existing)
                        .map(|url| normalize_url(&url))
                        .as_ref()
                        == url.as_ref())
        });
        if duplicate {
            return;
        }
        let mut article = article.clone();
        if let Some(object) = article.as_object_mut() {
            object.entry("title").or_insert_with(|| json!("Untitled article"));
            object.entry("category").or_insert_with(|| json!("external"));
        }
        self.referenced_articles.push(article);
    }

}

fn initial_messages(query: &str, history: Option<Value>, provider: &str) -> Vec<ChatMessage> {
    let mut messages = vec![message(ChatRole::System, research_system_prompt())];
    if let Some(history) = history.and_then(|value| value.as_array().cloned()) {
        for entry in history.iter().rev().take(12).collect::<Vec<_>>().into_iter().rev() {
            let role = match entry.get("role").and_then(Value::as_str) {
                Some("user") => ChatRole::User,
                Some("assistant") => ChatRole::Assistant,
                _ => continue,
            };
            let Some(content) = entry.get("content").and_then(Value::as_str) else {
                continue;
            };
            let content = take_chars(content.trim(), 4_000);
            if !content.is_empty() {
                messages.push(message(role, content));
            }
        }
    }
    messages.push(message(ChatRole::User, query.to_owned()));
    sanitize_messages_for_provider(&mut messages, provider);
    messages
}

fn message(role: ChatRole, content: impl Into<String>) -> ChatMessage {
    ChatMessage {
        role,
        content: Some(content.into()),
        tool_calls: Vec::new(),
        tool_call_id: None,
        name: None,
    }
}

fn replace_system_message(messages: &mut Vec<ChatMessage>, content: String) {
    if let Some(index) = messages.iter().position(|message| message.role == ChatRole::System) {
        messages[index].content = Some(content);
        messages[index].tool_calls.clear();
        messages[index].tool_call_id = None;
        messages[index].name = None;
        let mut found_system = false;
        messages.retain(|message| {
            if message.role != ChatRole::System {
                return true;
            }
            if !found_system {
                found_system = true;
                true
            } else {
                false
            }
        });
    } else {
        messages.insert(0, message(ChatRole::System, content));
    }
}

fn final_model_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut result = messages
        .iter()
        .filter(|message| {
            message.role == ChatRole::System
                || message.role == ChatRole::User
                || message.role == ChatRole::Assistant
        })
        .cloned()
        .collect::<Vec<_>>();
    for message in &mut result {
        message.tool_calls.clear();
        message.tool_call_id = None;
        message.name = None;
    }
    result.retain(|message| {
        message.content.as_deref().is_some_and(|content| !content.trim().is_empty())
    });
    replace_system_message(&mut result, finalizer_system_prompt());
    result
}

fn sanitize_messages_for_provider(messages: &mut Vec<ChatMessage>, provider: &str) {
    messages.retain(|message| {
        message.content.as_deref().is_some_and(|content| !content.trim().is_empty())
            || !message.tool_calls.is_empty()
    });
    if provider == "llamacpp" {
        recover_llamacpp_messages(messages);
    }
}

fn recover_llamacpp_messages(messages: &mut Vec<ChatMessage>) {
    let mut recovered = Vec::<ChatMessage>::with_capacity(messages.len());
    for mut current in messages.drain(..) {
        if current.role == ChatRole::Tool {
            let label = current.name.as_deref().unwrap_or("tool");
            let call_id = current.tool_call_id.as_deref().unwrap_or("unknown");
            current.role = ChatRole::User;
            current.content = Some(format!(
                "Tool {label} result ({call_id}):\n{}",
                current.content.take().unwrap_or_default()
            ));
            current.tool_calls.clear();
            current.tool_call_id = None;
            current.name = None;
        }
        if current.role == ChatRole::System {
            if let Some(system) = recovered
                .iter_mut()
                .find(|message| message.role == ChatRole::System)
            {
                let additional = current.content.take().unwrap_or_default();
                if let Some(content) = system.content.as_mut() {
                    content.push_str("\n\n");
                    content.push_str(&additional);
                }
                continue;
            }
        }
        if let Some(previous) = recovered.last_mut() {
            if previous.role == current.role && current.role != ChatRole::System {
                let additional = current.content.take().unwrap_or_default();
                if let Some(content) = previous.content.as_mut() {
                    if !content.is_empty() && !additional.is_empty() {
                        content.push_str("\n\n");
                    }
                    content.push_str(&additional);
                } else {
                    previous.content = Some(additional);
                }
                previous.tool_calls.append(&mut current.tool_calls);
                continue;
            }
        }
        recovered.push(current);
    }
    if let Some(index) = recovered
        .iter()
        .position(|message| message.role == ChatRole::System)
    {
        if index != 0 {
            let system = recovered.remove(index);
            recovered.insert(0, system);
        }
    }
    *messages = recovered;
}

fn new_research_session_id() -> String {
    let sequence = RESEARCH_SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let high = nanos as u64;
    let low = sequence ^ high.rotate_left(17);
    format!(
        "{:08x}-{:04x}-4{:03x}-a{:03x}-{:012x}",
        high >> 32,
        (high >> 16) & 0xffff,
        high & 0x0fff,
        (low >> 48) & 0x0fff,
        low & 0x0000_ffff_ffff_ffff
    )
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_tool_calls(
    calls: &[ChatToolCall],
    logged: &mut HashSet<String>,
) -> Vec<ChatToolCall> {
    calls
        .iter()
        .filter(|call| logged.insert(format!("{}:{}", call.id, tool_call_key(&call.name, &call.arguments))))
        .cloned()
        .collect()
}

fn assemble_tool_call_fragments(
    fragments: HashMap<usize, ToolCallFragment>,
) -> Result<Vec<ChatToolCall>, String> {
    let mut ordered = fragments.into_iter().collect::<Vec<_>>();
    ordered.sort_by_key(|(index, _)| *index);
    ordered
        .into_iter()
        .map(|(_, fragment)| {
            let name = fragment
                .name
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(|| "streamed tool call did not include a name".to_owned())?;
            let arguments = if fragment.arguments.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str(&fragment.arguments)
                    .map_err(|_| format!("tool {name} returned invalid JSON arguments"))?
            };
            Ok(ChatToolCall {
                id: fragment.id.unwrap_or_else(|| format!("research-{name}")),
                name,
                arguments,
            })
        })
        .collect()
}

fn tool_call_key(name: &str, arguments: &Value) -> String {
    let query_key = match name {
        "search_internal_news" | "gdelt_context_search" | "gdelt_doc_search" | "web_search" => {
            argument_string(arguments, "query")
        }
        "news_search" => argument_string(arguments, "keywords"),
        "fetch_article_content" => argument_string(arguments, "url"),
        _ => None,
    };
    if let Some(query) = query_key {
        format!("{name}:{}", normalize_search_query(query))
    } else {
        format!(
            "{name}:{}",
            serde_json::to_string(arguments).expect("JSON values are serializable")
        )
    }
}

fn is_external_search_tool(name: &str) -> bool {
    matches!(
        name,
        "gdelt_context_search" | "gdelt_doc_search" | "web_search" | "news_search"
    )
}

fn argument_string<'a>(arguments: &'a Value, key: &str) -> Option<&'a str> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn argument_usize(arguments: &Value, key: &str, default: usize) -> usize {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
}

fn normalize_search_query(query: &str) -> String {
    query
        .chars()
        .filter_map(|character| {
            if character.is_alphanumeric() {
                Some(character.to_lowercase().collect::<String>())
            } else if character.is_whitespace() {
                Some(" ".to_owned())
            } else {
                None
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_queries_similar(left: &str, right: &str) -> bool {
    let left = left.split_whitespace().collect::<HashSet<_>>();
    let right = right.split_whitespace().collect::<HashSet<_>>();
    if left.is_empty() || right.is_empty() {
        return false;
    }
    let intersection = left.intersection(&right).count() as f64;
    let union = left.union(&right).count() as f64;
    intersection / union >= QUERY_SIMILARITY_THRESHOLD
}

fn tool_status_message(name: &str, arguments: &Value) -> String {
    match name {
        "search_internal_news" => "Searching internal coverage.".to_owned(),
        "gdelt_context_search" => "Searching current-event context.".to_owned(),
        "gdelt_doc_search" => "Searching current news articles.".to_owned(),
        "web_search" => "Searching the web.".to_owned(),
        "news_search" => "Searching news coverage.".to_owned(),
        "fetch_article_content" => "Reading an article.".to_owned(),
        "rag_index_documents" => "Saving useful documents to the archive.".to_owned(),
        _ => {
            let query = argument_string(arguments, "query").unwrap_or_default();
            if query.is_empty() {
                format!("Running {name}.")
            } else {
                format!("Searching for {}.", take_chars(query, 80))
            }
        }
    }
}

fn chat_error_message(error: &ChatClientError) -> String {
    let fallback = error.to_string();
    let message = error.upstream_message().unwrap_or(&fallback).trim();
    let message = take_chars(message, 500);
    match error.upstream_status() {
        Some(status) if !message.contains(&status.to_string()) => {
            format!("HTTP {status}: {message}")
        }
        _ => message,
    }
}

fn is_recoverable_llamacpp_error(error: &ChatClientError) -> bool {
    let message = chat_error_message(error).to_lowercase();
    [
        "cannot have 2 or more assistant messages at the end of the list",
        "jinja",
        "chat template",
        "template error",
        "system message must be",
        "conversation roles must alternate",
    ]
    .iter()
    .any(|term| message.contains(term))
        || (message.contains("invalid_request_error")
            && message.contains("model")
            && message.contains("not found"))
}

fn llama_model_not_found(error: &ChatClientError) -> bool {
    let message = chat_error_message(error).to_lowercase();
    message.contains("model") && message.contains("not found")
}

fn needs_final_answer(answer: &str) -> bool {
    answer.chars().count() < MIN_FINAL_ANSWER_CHARS || !has_answer_section(answer)
}

fn has_answer_section(answer: &str) -> bool {
    answer.lines().any(|line| {
        let heading = line.trim().trim_start_matches('#').trim();
        heading.eq_ignore_ascii_case("answer")
            || heading
                .get(..7)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("answer:"))
    })
}

fn answer_denies_available_context(answer: &str) -> bool {
    let lowered = answer.to_lowercase();
    [
        "no context was provided",
        "no articles were provided",
        "i don't have access to",
        "i do not have access to",
        "there is no context",
        "cannot access the articles",
        "can't access the articles",
    ]
    .iter()
    .any(|phrase| lowered.contains(phrase))
}

fn sanitize_final_answer(answer: &str) -> String {
    let cleaned = answer
        .replace('—', "-")
        .replace('–', "-")
        .replace("```markdown", "")
        .replace("```", "")
        .trim()
        .to_owned();
    if has_answer_section(&cleaned) {
        cleaned
    } else if cleaned.is_empty() {
        "## Answer\n\nNo usable research answer was produced.".to_owned()
    } else {
        format!("## Answer\n\n{cleaned}")
    }
}

fn grounded_fallback_answer(query: &str, articles: &[Value]) -> String {
    if articles.is_empty() {
        format!(
            "## Answer\n\nThe research run did not produce a supported answer to \"{}\". The available search results did not provide enough verified detail to make a factual claim without guessing. Try a narrower query or another configured model, then compare the returned source material before drawing a conclusion.",
            take_chars(query.trim(), 160)
        )
    } else {
        format!(
            "## Answer\n\nThe research run collected {} source article(s) for \"{}\", but did not produce enough checked detail to answer confidently. I have not added outside facts or treated headlines as confirmation. Review the cited articles for the claims and dates needed to complete the comparison.",
            articles.len(),
            take_chars(query.trim(), 160)
        )
    }
}

fn context_snippet_line(article: &Value) -> String {
    let title = truthy_string(article.get("title")).unwrap_or_else(|| "Untitled article".to_owned());
    let source = truthy_string(article.get("source")).unwrap_or_else(|| "Unknown source".to_owned());
    let date = truthy_string(article.get("published"))
        .or_else(|| truthy_string(article.get("published_at")))
        .unwrap_or_default();
    let url = article_url(article).unwrap_or_default();
    let excerpt = article_content(article)
        .map(|content| take_chars(content, ARTICLE_PREVIEW_CHARS))
        .unwrap_or_default();
    let mut line = format!("- {title} | {source}");
    if !date.is_empty() {
        line.push_str(" | ");
        line.push_str(&date);
    }
    if !url.is_empty() {
        line.push_str("\n  URL: ");
        line.push_str(&url);
    }
    if !excerpt.is_empty() {
        line.push_str("\n  ");
        line.push_str(&take_chars(&excerpt, 1_200));
    }
    line
}

fn structured_articles_payload(
    query: &str,
    articles: &[Value],
    providers: &BTreeSet<String>,
) -> Option<Value> {
    (!articles.is_empty()).then(|| {
        json!({
            "total": articles.len(),
            "query": query,
            "source_providers": providers,
            "articles": articles
        })
    })
}

fn pretty_structured_articles_block(payload: &Value) -> String {
    if payload
        .get("articles")
        .and_then(Value::as_array)
        .map_or(true, Vec::is_empty)
    {
        return String::new();
    }
    let serialized = serde_json::to_string_pretty(payload).expect("JSON values are serializable");
    format!("\n```json:articles\n{serialized}\n```\n")
}

fn structured_articles_block(
    query: &str,
    articles: &[Value],
    providers: &BTreeSet<String>,
) -> String {
    structured_articles_payload(query, articles, providers)
        .as_ref()
        .map(pretty_structured_articles_block)
        .unwrap_or_default()
}

fn register_article_lookup(lookup: &mut HashMap<String, Value>, article: &Value) {
    if let Some(url) = article_url(article) {
        let key = normalize_url(&url);
        if !key.is_empty() {
            lookup.entry(key).or_insert_with(|| article.clone());
        }
    }
    if let Some(id) = article
        .get("id")
        .or_else(|| article.get("article_id"))
        .map(value_to_string)
        .filter(|id| !id.is_empty())
    {
        lookup.entry(format!("id:{id}")).or_insert_with(|| article.clone());
    }
}

fn article_url(article: &Value) -> Option<String> {
    truthy_string(article.get("url")).or_else(|| truthy_string(article.get("link")))
}

fn article_content(article: &Value) -> Option<&str> {
    ["content", "text", "summary", "description", "context_snippet", "sentence"]
        .iter()
        .find_map(|key| article.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|content| !content.is_empty())
}

fn search_query_for_tool<'a>(name: &str, arguments: &'a Value) -> Option<&'a str> {
    match name {
        "web_search" | "gdelt_context_search" | "gdelt_doc_search" => {
            argument_string(arguments, "query")
        }
        "news_search" => argument_string(arguments, "keywords"),
        _ => None,
    }
}

fn extract_query_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    for character in query.chars() {
        if character.is_alphanumeric() || character == '-' {
            current.extend(character.to_lowercase());
        } else if !current.is_empty() {
            if current.chars().count() > 2 {
                terms.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }
    if current.chars().count() > 2 {
        terms.push(current);
    }
    terms
}

fn article_search_score(article: &Value, terms: &[String]) -> usize {
    let search_text = ["title", "summary", "description", "content"]
        .iter()
        .filter_map(|field| article.get(*field).and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    terms
        .iter()
        .filter(|term| search_text.contains(term.as_str()))
        .count()
}

fn internal_result_payload(article: &Value) -> Value {
    json!({
        "title": article.get("title").cloned().unwrap_or(Value::Null),
        "source": article.get("source").cloned().unwrap_or(Value::Null),
        "url": article_url(article).unwrap_or_default(),
        "published": article.get("published").cloned().unwrap_or(Value::Null),
        "summary": truthy_value(article.get("summary"))
            .or_else(|| truthy_value(article.get("description")))
            .cloned()
            .unwrap_or(Value::Null),
        "provider": "internal",
        "result_type": "internal"
    })
}

fn article_fetch_output(article: &Value, requested_url: &str) -> String {
    let title = truthy_string(article.get("title")).unwrap_or_else(|| "Untitled".to_owned());
    let content = article_content(article).unwrap_or_default();
    if article.get("provider").and_then(Value::as_str) == Some("internal") {
        let source = truthy_string(article.get("source")).unwrap_or_else(|| "Unknown".to_owned());
        let published = truthy_string(article.get("published"))
            .or_else(|| truthy_string(article.get("published_at")))
            .unwrap_or_default();
        format!(
            "URL: {requested_url}\nTitle: {title}\nSource: {source}\nPublished: {published}\nArchive text (may be an excerpt):\n{}",
            take_chars(content, INTERNAL_ARTICLE_CHARS)
        )
    } else {
        format!(
            "Title: {title}\nContent: {}",
            take_chars(content, INTERNAL_ARTICLE_CHARS)
        )
    }
}

fn dedupe_search_results(first: &[Value], second: &[Value], limit: usize) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for article in first.iter().chain(second) {
        let Some(url) = article_url(article) else {
            continue;
        };
        if !seen.insert(normalize_url(&url)) {
            continue;
        }
        results.push(article.clone());
        if results.len() >= limit {
            break;
        }
    }
    results
}

fn tool_result_needs_fallback(tool_name: &str, result: &str) -> bool {
    let text = result.trim();
    let empty_array = serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .is_some_and(|results| results.is_empty());
    if empty_array || text.is_empty() || text == "No results found." {
        return matches!(tool_name, "gdelt_context_search" | "gdelt_doc_search");
    }
    match tool_name {
        "gdelt_context_search" => text.starts_with("GDELT context search failed:"),
        "gdelt_doc_search" => text.starts_with("GDELT doc search failed:"),
        _ => false,
    }
}

fn fallback_tool_arguments(name: &str, arguments: &Value) -> Option<Value> {
    let limit = argument_usize(arguments, "max_results", 10).clamp(1, 10);
    match name {
        "gdelt_doc_search" => {
            let query = argument_string(arguments, "query")
                .or_else(|| argument_string(arguments, "keywords"))?;
            let mut fallback = json!({"query": query, "max_results": limit});
            if let Some(timespan) = argument_string(arguments, "timespan") {
                fallback["timespan"] = json!(timespan);
            }
            Some(fallback)
        }
        "news_search" => {
            let keywords = argument_string(arguments, "keywords")
                .or_else(|| argument_string(arguments, "query"))?;
            Some(json!({
                "keywords": keywords,
                "max_results": limit,
                "region": argument_string(arguments, "region").unwrap_or("wt-wt")
            }))
        }
        _ => None,
    }
}

fn normalize_url(url: &str) -> String {
    Url::parse(url.trim())
        .map(|mut parsed| {
            parsed.set_fragment(None);
            parsed.to_string().trim_end_matches('/').to_owned()
        })
        .unwrap_or_else(|_| url.trim().trim_end_matches('/').to_lowercase())
}

fn stable_hash(value: &str) -> String {
    let hash = value
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
        });
    format!("{hash:016x}")
}

fn numeric_article_id(identity: &str) -> i64 {
    let value = u64::from_str_radix(&stable_hash(identity), 16).unwrap_or(1);
    (value & i64::MAX as u64).max(1) as i64
}


#[cfg(test)]
mod tests {
    use super::{
        final_model_messages, has_answer_section, normalize_gdelt_articles, normalize_search_query,
        parse_duckduckgo_results, recover_llamacpp_messages, sanitize_final_answer,
        search_queries_similar, structured_articles_payload, tool_call_key, ChatRole,
    };
    use serde_json::json;
    use std::collections::BTreeSet;

    #[test]
    fn internal_search_keys_normalize_equivalent_queries() {
        let first = tool_call_key(
            "search_internal_news",
            &json!({"query": "  Climate  CHANGE "}),
        );
        let second = tool_call_key(
            "search_internal_news",
            &json!({"query": "climate change"}),
        );

        assert_eq!(first, second);
        assert!(search_queries_similar(
            &normalize_search_query("climate policy report"),
            &normalize_search_query("report climate policy")
        ));
        assert!(!search_queries_similar(
            &normalize_search_query("climate policy"),
            &normalize_search_query("local election")
        ));
    }

    #[test]
    fn duckduckgo_parser_resolves_redirects_and_extracts_result_text() {
        let html = r#"
            <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freport&amp;rut=token">
                Climate &amp; policy update
            </a>
            <a class="result__snippet">A new policy was announced today.</a>
        "#;
        let results = parse_duckduckgo_results(html, 5, "web");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["url"], "https://example.com/report");
        assert_eq!(results[0]["title"], "Climate & policy update");
        assert_eq!(
            results[0]["summary"],
            "A new policy was announced today."
        );
        assert_eq!(results[0]["provider"], "duckduckgo");
    }

    #[test]
    fn gdelt_context_projection_keeps_citation_and_snippet_fields() {
        let results = normalize_gdelt_articles(
            &[
                json!({
                    "url": "https://example.com/story",
                    "title": "Climate outlook",
                    "domain": "example.com",
                    "sentence": "The agency updated its forecast.",
                    "context": "The updated forecast covers the next quarter.",
                    "seendate": "20260101T120000Z",
                    "language": "English"
                }),
                json!({"title": "Missing URL"}),
            ],
            "context",
            10,
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["summary"], "The updated forecast covers the next quarter.");
        assert_eq!(results[0]["context_snippet"], "The updated forecast covers the next quarter.");
        assert_eq!(results[0]["provider"], "gdelt");
        assert_eq!(results[0]["url"], results[0]["link"]);
    }

    #[test]
    fn llama_sanitizer_converts_tool_messages_and_merges_repeated_roles() {
        let mut messages = vec![
            super::message(ChatRole::System, "system"),
            super::message(ChatRole::Assistant, "tool calls"),
            super::ChatMessage {
                role: ChatRole::Tool,
                content: Some("first result".to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-1".to_owned()),
                name: Some("search_internal_news".to_owned()),
            },
            super::ChatMessage {
                role: ChatRole::Tool,
                content: Some("second result".to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-2".to_owned()),
                name: Some("gdelt_context_search".to_owned()),
            },
            super::message(ChatRole::Assistant, "short answer"),
            super::message(ChatRole::Assistant, "more detail"),
        ];

        recover_llamacpp_messages(&mut messages);

        assert_eq!(
            messages.iter().map(|message| message.role.clone()).collect::<Vec<_>>(),
            vec![
                ChatRole::System,
                ChatRole::Assistant,
                ChatRole::User,
                ChatRole::Assistant
            ]
        );
        assert!(messages[2]
            .content
            .as_deref()
            .is_some_and(|content| content.contains("first result") && content.contains("second result")));
        assert!(messages[3]
            .content
            .as_deref()
            .is_some_and(|content| content.contains("short answer") && content.contains("more detail")));
    }

    #[test]
    fn final_model_messages_remove_orphaned_tool_calls() {
        let messages = vec![
            super::message(ChatRole::System, "research system"),
            super::message(ChatRole::User, "research question"),
            super::ChatMessage {
                role: ChatRole::Assistant,
                content: Some("Draft synthesis".to_owned()),
                tool_calls: vec![super::ChatToolCall {
                    id: "call-1".to_owned(),
                    name: "search_internal_news".to_owned(),
                    arguments: json!({"query": "topic"}),
                }],
                tool_call_id: None,
                name: None,
            },
            super::ChatMessage {
                role: ChatRole::Tool,
                content: Some("tool result".to_owned()),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-1".to_owned()),
                name: Some("search_internal_news".to_owned()),
            },
        ];

        let final_messages = final_model_messages(&messages);

        assert_eq!(final_messages.len(), 3);
        assert!(final_messages.iter().all(|message| message.role != ChatRole::Tool));
        assert!(final_messages[0]
            .content
            .as_deref()
            .is_some_and(|content| content.contains("news analyst")));
        assert!(final_messages[2].tool_calls.is_empty());
        assert!(final_messages[2].tool_call_id.is_none());
        assert!(final_messages[2].name.is_none());
    }

    #[test]
    fn final_answer_sanitizer_requires_an_answer_section() {
        let answer = sanitize_final_answer("A finding — with a source.");

        assert!(has_answer_section(&answer));
        assert!(answer.starts_with("## Answer"));
        assert!(answer.contains("finding - with a source."));
        assert!(!has_answer_section("The word answer appears in this paragraph."));
    }

    #[test]
    fn structured_article_payload_is_absent_without_references() {
        let providers = BTreeSet::from(["gdelt".to_owned()]);
        assert!(structured_articles_payload("query", &[], &providers).is_none());

        let payload = structured_articles_payload(
            "query",
            &[json!({"url": "https://example.com/story"})],
            &providers,
        )
        .expect("a cited article creates the structured result");
        assert_eq!(payload["query"], "query");
        assert_eq!(payload["total"], 1);
        assert_eq!(payload["articles"].as_array().map(Vec::len), Some(1));
        assert_eq!(payload["source_providers"][0], "gdelt");
    }
}
