use std::collections::{BTreeMap, VecDeque};
use std::time::Instant;

use reqwest::header::CONTENT_TYPE;
use reqwest::Response;
use serde_json::{json, Value};

use super::super::llm_logs::next_request_id;
use super::openai;
use super::{
    elapsed_millis, error_log_message, map_reqwest_error, ChatBackend, ChatClientError,
    ChatCompletionClient, ChatCompletionRequest, ChatMessage, ChatStreamEvent, ChatToolCall,
};

#[derive(Default)]
struct PartialToolCall {
    id: Option<String>,
    name: String,
    arguments: String,
    parsed_arguments: Option<Value>,
}

pub(super) struct ChatStreamState {
    client: ChatCompletionClient,
    request: ChatCompletionRequest,
    request_id: String,
    messages: Vec<Value>,
    started: Option<Instant>,
    model: Option<String>,
    response: Option<Response>,
    buffer: Vec<u8>,
    event_data: Vec<String>,
    pending: VecDeque<ChatStreamEvent>,
    tool_calls: BTreeMap<usize, PartialToolCall>,
    finish_reason: Option<String>,
    message_id: Option<String>,
    initialized: bool,
    logged: bool,
    done: bool,
}

impl ChatStreamState {
    pub(super) fn new(client: ChatCompletionClient, request: ChatCompletionRequest) -> Self {
        let messages = request
            .messages
            .iter()
            .map(openai::message_json)
            .collect();
        Self {
            client,
            request,
            request_id: next_request_id(),
            messages,
            started: None,
            model: None,
            response: None,
            buffer: Vec::new(),
            event_data: Vec::new(),
            pending: VecDeque::new(),
            tool_calls: BTreeMap::new(),
            finish_reason: None,
            message_id: None,
            initialized: false,
            logged: false,
            done: false,
        }
    }

    pub(super) async fn next_event(&mut self) -> Option<Result<ChatStreamEvent, ChatClientError>> {
        if let Err(error) = self.initialize_if_needed().await {
            return Some(Err(self.record_error(error)));
        }

        loop {
            if let Some(result) = self.take_pending_event() {
                return Some(result);
            }
            if self.done {
                return None;
            }
            if let Some(line) = take_sse_line(&mut self.buffer) {
                if let Err(error) = self.consume_line(&line) {
                    return Some(Err(self.record_error(error)));
                }
                continue;
            }
            if let Err(error) = self.read_next_chunk().await {
                return Some(Err(self.record_error(error)));
            }
        }
    }

    async fn initialize_if_needed(&mut self) -> Result<(), ChatClientError> {
        if self.initialized {
            return Ok(());
        }
        self.initialized = true;
        self.initialize().await
    }

    async fn initialize(&mut self) -> Result<(), ChatClientError> {
        self.client.validate_request(&self.request)?;
        let model = self.client.resolve_model(&self.request.model).await?;
        let body = self.client.request_body(&self.request, &model)?;
        let response = self
            .client
            .request_builder(&self.request, &model, &self.request_id, true, body)?
            .send()
            .await
            .map_err(|error| map_reqwest_error(&error))?;
        let response = self.client.check_status(response).await?;
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(ChatClientError::UnsupportedContentType)?;
        if !content_type.eq_ignore_ascii_case("text/event-stream") {
            return Err(ChatClientError::UnsupportedContentType);
        }
        self.model = Some(model);
        self.started = Some(Instant::now());
        self.response = Some(response);
        Ok(())
    }

    async fn read_next_chunk(&mut self) -> Result<(), ChatClientError> {
        let chunk = match self.response.as_mut() {
            Some(response) => response
                .chunk()
                .await
                .map_err(|error| map_reqwest_error(&error))?,
            None => {
                self.done = true;
                return Ok(());
            }
        };
        match chunk {
            Some(chunk) => self.buffer.extend_from_slice(&chunk),
            None => self.consume_eof()?,
        }
        Ok(())
    }

    fn consume_eof(&mut self) -> Result<(), ChatClientError> {
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.consume_line(&line)?;
        }
        if !self.event_data.is_empty() {
            self.consume_data_event()?;
        }
        if !self.done {
            self.done = true;
            self.pending.push_back(self.finish_event()?);
        }
        Ok(())
    }

    fn take_pending_event(&mut self) -> Option<Result<ChatStreamEvent, ChatClientError>> {
        let event = self.pending.pop_front()?;
        if matches!(event, ChatStreamEvent::Finished { .. }) {
            if let Err(error) = self.record_success() {
                return Some(Err(self.record_error(error)));
            }
        }
        Some(Ok(event))
    }

    fn consume_line(&mut self, raw_line: &[u8]) -> Result<(), ChatClientError> {
        let raw_line = raw_line.strip_suffix(b"\r").unwrap_or(raw_line);
        if raw_line.is_empty() {
            return self.consume_data_event();
        }
        if let Some(data) = raw_line.strip_prefix(b"data:") {
            let data = data.strip_prefix(b" ").unwrap_or(data);
            self.event_data.push(String::from_utf8_lossy(data).into_owned());
        }
        Ok(())
    }

    fn consume_data_event(&mut self) -> Result<(), ChatClientError> {
        if self.event_data.is_empty() {
            return Ok(());
        }
        let data = self.event_data.drain(..).collect::<Vec<_>>().join("\n");
        if data.trim() == "[DONE]" {
            self.done = true;
            self.pending.push_back(self.finish_event()?);
            return Ok(());
        }
        let value: Value = serde_json::from_str(&data).map_err(|_| ChatClientError::InvalidResponse)?;
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            self.message_id = Some(id.to_owned());
        }
        match self.client.backend {
            ChatBackend::Gemini => self.consume_gemini_chunk(&value),
            ChatBackend::OpenRouter | ChatBackend::LlamaCpp | ChatBackend::OpenCode => {
                self.consume_openai_chunk(&value)
            }
        }
    }

    fn consume_openai_chunk(&mut self, value: &Value) -> Result<(), ChatClientError> {
        let Some(choice) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return Ok(());
        };
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }
        let Some(delta) = choice.get("delta") else {
            return Ok(());
        };
        let content = delta
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let mut reasoning = delta
            .get("reasoning")
            .or_else(|| delta.get("reasoning_content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if let Some(details) = delta.get("reasoning_details") {
            reasoning.push_str(&reasoning_text(details));
        }
        if !content.is_empty() || !reasoning.is_empty() {
            self.pending.push_back(ChatStreamEvent::ContentDelta {
                message_id: self.message_id.clone(),
                content,
                reasoning,
            });
        }
        if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for call in calls {
                let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let partial = self.tool_calls.entry(index).or_default();
                let id = call.get("id").and_then(Value::as_str).map(str::to_owned);
                if let Some(id) = &id {
                    partial.id = Some(id.clone());
                }
                let function = call.get("function");
                let name = function
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if let Some(name) = &name {
                    partial.name.push_str(name);
                }
                let arguments = function
                    .and_then(|function| function.get("arguments"))
                    .map(|value| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()))
                    .unwrap_or_default();
                partial.arguments.push_str(&arguments);
                self.pending.push_back(ChatStreamEvent::ToolCallDelta {
                    index,
                    id,
                    name,
                    arguments,
                });
            }
        }
        Ok(())
    }

    fn consume_gemini_chunk(&mut self, value: &Value) -> Result<(), ChatClientError> {
        let Some(candidate) = value
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
        else {
            return Ok(());
        };
        if let Some(reason) = candidate.get("finishReason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }
        let Some(parts) = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
        else {
            return Ok(());
        };
        for (index, part) in parts.iter().enumerate() {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                let (content, reasoning) = if part.get("thought").and_then(Value::as_bool) == Some(true) {
                    (String::new(), text.to_owned())
                } else {
                    (text.to_owned(), String::new())
                };
                if !content.is_empty() || !reasoning.is_empty() {
                    self.pending.push_back(ChatStreamEvent::ContentDelta {
                        message_id: self.message_id.clone(),
                        content,
                        reasoning,
                    });
                }
            }
            if let Some(call) = part.get("functionCall") {
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or(ChatClientError::InvalidResponse)?;
                let arguments_value = call.get("args").cloned().unwrap_or_else(|| json!({}));
                let arguments = arguments_value.to_string();
                let partial = self.tool_calls.entry(index).or_default();
                let id = Some(format!("{}-{index}", self.request_id));
                partial.id = id.clone();
                partial.name = name.to_owned();
                partial.parsed_arguments = Some(arguments_value);
                self.pending.push_back(ChatStreamEvent::ToolCallDelta {
                    index,
                    id,
                    name: Some(name.to_owned()),
                    arguments,
                });
            }
        }
        Ok(())
    }

    fn finish_event(&self) -> Result<ChatStreamEvent, ChatClientError> {
        let mut calls = Vec::with_capacity(self.tool_calls.len());
        for (index, partial) in &self.tool_calls {
            if partial.name.is_empty() {
                return Err(ChatClientError::InvalidResponse);
            }
            let arguments = if let Some(arguments) = &partial.parsed_arguments {
                arguments.clone()
            } else if partial.arguments.is_empty() {
                json!({})
            } else {
                serde_json::from_str(&partial.arguments).map_err(|_| ChatClientError::InvalidResponse)?
            };
            calls.push(ChatToolCall {
                id: partial
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("{}-{index}", self.request_id)),
                name: partial.name.clone(),
                arguments,
            });
        }
        Ok(ChatStreamEvent::Finished {
            finish_reason: self.finish_reason.clone(),
            tool_calls: calls,
        })
    }

    fn record_success(&mut self) -> Result<(), ChatClientError> {
        if self.logged {
            return Ok(());
        }
        let duration = elapsed_millis(self.started.unwrap_or_else(Instant::now));
        self.client
            .logs
            .success(
                &self.request_id,
                &self.request.service,
                self.model.as_deref().unwrap_or(&self.request.model),
                &self.messages,
                duration,
                self.finish_reason.as_deref(),
            )
            .map_err(|_| ChatClientError::Logging)?;
        self.logged = true;
        Ok(())
    }

    fn record_error(&mut self, error: ChatClientError) -> ChatClientError {
        self.done = true;
        if !self.logged {
            let duration = self.started.map(elapsed_millis).unwrap_or_default();
            let message = error_log_message(&error);
            if self
                .client
                .logs
                .failure(
                    &self.request_id,
                    &self.request.service,
                    self.model.as_deref().unwrap_or(&self.request.model),
                    &self.messages,
                    duration,
                    error.error_type(),
                    &message,
                )
                .is_err()
            {
                self.logged = true;
                return ChatClientError::Logging;
            }
            self.logged = true;
        }
        error
    }
}

impl Drop for ChatStreamState {
    fn drop(&mut self) {
        if self.started.is_none() || self.logged {
            return;
        }
        let duration = self.started.map(elapsed_millis).unwrap_or_default();
        let _ = self.client.logs.failure(
            &self.request_id,
            &self.request.service,
            self.model.as_deref().unwrap_or(&self.request.model),
            &self.messages,
            duration,
            "Cancelled",
            "chat response stream was cancelled before completion",
        );
        self.logged = true;
    }
}

fn take_sse_line(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let newline = buffer.iter().position(|byte| *byte == b'\n')?;
    let mut line = buffer.drain(..=newline).collect::<Vec<_>>();
    line.pop();
    Some(line)
}

fn reasoning_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| item.as_str())
            })
            .collect(),
        _ => String::new(),
    }
}
