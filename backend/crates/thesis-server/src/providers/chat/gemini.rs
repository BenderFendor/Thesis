use reqwest::Url;
use serde_json::{json, Map, Value};

use super::{ChatClientError, ChatCompletion, ChatCompletionRequest, ChatMessage, ChatRole, ChatToolCall};

pub(super) fn request_body(
    request: &ChatCompletionRequest,
    _model: &str,
) -> Result<Value, ChatClientError> {
    let mut system_parts = Vec::new();
    let mut contents = Vec::new();
    for message in &request.messages {
        match message.role {
            ChatRole::System => {
                if let Some(content) = &message.content {
                    system_parts.push(json!({"text": content}));
                }
            }
            ChatRole::User | ChatRole::Assistant => {
                let mut parts = Vec::new();
                if let Some(content) = &message.content {
                    parts.push(json!({"text": content}));
                }
                if message.role == ChatRole::Assistant {
                    for call in &message.tool_calls {
                        parts.push(json!({
                            "functionCall": {
                                "name": call.name,
                                "args": call.arguments,
                            }
                        }));
                    }
                }
                if !parts.is_empty() {
                    contents.push(json!({
                        "role": if message.role == ChatRole::Assistant { "model" } else { "user" },
                        "parts": parts,
                    }));
                }
            }
            ChatRole::Tool => {
                let name = message.name.as_deref().ok_or(ChatClientError::InvalidRequest)?;
                let mut response = Map::new();
                response.insert(
                    "content".to_owned(),
                    Value::String(message.content.clone().unwrap_or_default()),
                );
                if let Some(call_id) = &message.tool_call_id {
                    response.insert("id".to_owned(), Value::String(call_id.clone()));
                }
                contents.push(json!({
                    "role": "user",
                    "parts": [{"functionResponse": {"name": name, "response": response}}],
                }));
            }
        }
    }

    let mut body = Map::new();
    body.insert("contents".to_owned(), Value::Array(contents));
    if !system_parts.is_empty() {
        body.insert(
            "systemInstruction".to_owned(),
            json!({"parts": system_parts}),
        );
    }
    if !request.tools.is_empty() {
        body.insert(
            "tools".to_owned(),
            Value::Array(vec![json!({
                "functionDeclarations": request.tools.iter().map(|tool| json!({
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                })).collect::<Vec<_>>(),
            })]),
        );
        if let Some(tool_choice) = &request.tool_choice {
            body.insert("toolConfig".to_owned(), tool_config(tool_choice)?);
        }
    }

    let mut generation = Map::new();
    if let Some(max_tokens) = request.max_tokens {
        generation.insert("maxOutputTokens".to_owned(), json!(max_tokens));
    }
    if let Some(temperature) = request.temperature {
        generation.insert("temperature".to_owned(), json!(temperature));
    }
    if let Some(response_format) = &request.response_format {
        if response_format.get("type").and_then(Value::as_str) != Some("json_object") {
            return Err(ChatClientError::UnsupportedResponseFormat);
        }
        generation.insert("responseMimeType".to_owned(), json!("application/json"));
    }
    if !generation.is_empty() {
        body.insert("generationConfig".to_owned(), Value::Object(generation));
    }
    Ok(Value::Object(body))
}

fn tool_config(tool_choice: &Value) -> Result<Value, ChatClientError> {
    let mode = match tool_choice.as_str() {
        Some("auto") => "AUTO",
        Some("required") => "ANY",
        Some("none") => "NONE",
        Some(_) => return Err(ChatClientError::InvalidRequest),
        None => {
            let name = tool_choice
                .pointer("/function/name")
                .and_then(Value::as_str)
                .ok_or(ChatClientError::InvalidRequest)?;
            return Ok(json!({
                "functionCallingConfig": {
                    "mode": "ANY",
                    "allowedFunctionNames": [name],
                }
            }));
        }
    };
    Ok(json!({"functionCallingConfig": {"mode": mode}}))
}

pub(super) fn endpoint(
    base_url: &str,
    model: &str,
    api_key: &str,
    streaming: bool,
) -> Result<Url, ChatClientError> {
    let mut url = Url::parse(base_url).map_err(|_| ChatClientError::InvalidConfiguration)?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(ChatClientError::InvalidConfiguration);
    }
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| ChatClientError::InvalidConfiguration)?;
        segments.pop_if_empty();
        segments.push("models");
        segments.push(model);
        segments.push(if streaming {
            "streamGenerateContent"
        } else {
            "generateContent"
        });
    }
    url.query_pairs_mut().append_pair("key", api_key);
    if streaming {
        url.query_pairs_mut().append_pair("alt", "sse");
    }
    Ok(url)
}

pub(super) fn parse_completion(
    payload: &Value,
    request_id: &str,
) -> Result<ChatCompletion, ChatClientError> {
    let candidate = payload
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())
        .ok_or(ChatClientError::InvalidResponse)?;
    let parts = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .ok_or(ChatClientError::InvalidResponse)?;
    let mut content = String::new();
    let mut tool_calls = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            if part.get("thought").and_then(Value::as_bool) != Some(true) {
                content.push_str(text);
            }
        }
        if let Some(function) = part.get("functionCall") {
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or(ChatClientError::InvalidResponse)?;
            tool_calls.push(ChatToolCall {
                id: format!("{request_id}-{index}"),
                name: name.to_owned(),
                arguments: function.get("args").cloned().unwrap_or_else(|| json!({})),
            });
        }
    }
    let finish_reason = candidate
        .get("finishReason")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(ChatCompletion {
        content: (!content.is_empty()).then_some(content),
        tool_calls,
        finish_reason,
    })
}
