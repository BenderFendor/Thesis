use super::*;
pub(super) enum ProviderStreamState {
    Starting {
        provider: NewsResearchProviderImpl,
        input: NewsResearchStreamRequest,
    },
    Retrieving {
        provider: NewsResearchProviderImpl,
        input: NewsResearchStreamRequest,
    },
    Initializing {
        provider: NewsResearchProviderImpl,
        input: NewsResearchStreamRequest,
        retrieval: RetrievalResult,
    },
    Agent(ResearchAgent),
    Done,
}

impl ProviderStreamState {
    pub(super) async fn next_chunk(self) -> Option<(Result<Bytes, Infallible>, Self)> {
        match self {
            Self::Starting { provider, input } => {
                let event = json!({
                    "type": "status",
                    "message": "Starting research.",
                    "model": input.model,
                    "timestamp": timestamp()
                });
                Some((
                    Ok(sse_chunk(&event)),
                    Self::Retrieving { provider, input },
                ))
            }
            Self::Retrieving { provider, input } => {
                match provider.retrieve(&input.query).await {
                    Ok(retrieval) => {
                        let summary = retrieval.summary;
                        let event = json!({
                            "type": "status",
                            "message": format!(
                                "Reviewing {} articles (semantic: {}, keyword: {}, recent: {})",
                                summary.total,
                                summary.semantic_count,
                                summary.keyword_count,
                                summary.recent_count
                            ),
                            "vector_enabled": summary.vector_enabled,
                            "timestamp": timestamp()
                        });
                        Some((
                            Ok(sse_chunk(&event)),
                            Self::Initializing {
                                provider,
                                input,
                                retrieval,
                            },
                        ))
                    }
                    Err(error) => {
                        let message = news_research_error_message(&error);
                        let event = research_error_event(&message, input.model.as_deref());
                        Some((Ok(sse_chunk(&event)), Self::Done))
                    }
                }
            }
            Self::Initializing {
                provider,
                input,
                retrieval,
            } => {
                let model = match provider.resolve_model(input.model.as_deref()) {
                    Ok(model) => model,
                    Err(error) => {
                        let message = news_research_error_message(&error);
                        let event = research_error_event(&message, input.model.as_deref());
                        return Some((Ok(sse_chunk(&event)), Self::Done));
                    }
                };
                let chat = match provider.chat_client() {
                    Ok(chat) => chat,
                    Err(error) => {
                        let message = news_research_error_message(&error);
                        let event = research_error_event(&message, input.model.as_deref());
                        return Some((Ok(sse_chunk(&event)), Self::Done));
                    }
                };
                let requested_model = input.model.clone();
                let agent = ResearchAgent::new(
                    provider,
                    chat,
                    model,
                    requested_model,
                    input.query,
                    retrieval.articles,
                    input.include_thinking,
                    input.history,
                );
                match agent.next_stream_event().await {
                    Ok(Some(event)) => Some((Ok(sse_chunk(&event)), Self::Agent(agent))),
                    Ok(None) => None,
                    Err(message) => {
                        let event =
                            research_error_event(&message, agent.requested_model.as_deref());
                        Some((Ok(sse_chunk(&event)), Self::Done))
                    }
                }
            }
            Self::Agent(mut agent) => match agent.next_stream_event().await {
                Ok(Some(event)) => Some((Ok(sse_chunk(&event)), Self::Agent(agent))),
                Ok(None) => None,
                Err(message) => {
                    let event =
                        research_error_event(&message, agent.requested_model.as_deref());
                    Some((Ok(sse_chunk(&event)), Self::Done))
                }
            },
            Self::Done => None,
        }
    }
}


fn sse_chunk(event: &Value) -> Bytes {
    let data = serde_json::to_string(event).expect("JSON values are serializable");
    Bytes::from(format!("data: {data}\n\n"))
}

fn news_research_error_message(error: &NewsResearchError) -> String {
    match error {
        NewsResearchError::ProviderUnavailable => {
            "Research agent provider is not available".to_owned()
        }
        NewsResearchError::ProviderFailed(message) => message.clone(),
    }
}

fn research_error_event(message: &str, model: Option<&str>) -> Value {
    let lowered = message.to_lowercase();
    let rate_limited = ["rate limit", "quota", "429", "too many requests"]
        .iter()
        .any(|needle| lowered.contains(needle));
    let timed_out = lowered.contains("timeout");
    let unavailable = ["503", "502", "endpoint is unavailable"]
        .iter()
        .any(|needle| lowered.contains(needle));
    let (code, friendly) = if unavailable {
        (
            "provider_unavailable",
            "The model provider is temporarily unavailable. Your research activity has been kept. Retry or choose another model.",
        )
    } else if rate_limited {
        (
            "rate_limit",
            "The selected model is rate-limited. Choose another model or try again later.",
        )
    } else if timed_out {
        (
            "research_error",
            "Request Timeout: The research took too long. Try a simpler query.",
        )
    } else {
        ("research_error", message)
    };
    json!({
        "type": "error",
        "message": friendly,
        "code": code,
        "model": model,
        "retryable": rate_limited || timed_out || unavailable,
        "timestamp": timestamp()
    })
}
