use serde_json::{json, Map, Value};

use super::{ChatClientError, ChatCompletion, ChatCompletionRequest, ChatMessage, ChatToolCall};

pub(super) fn request_body(request: &ChatCompletionRequest, model: &str) -> Value {
    let mut body = Map::new();
    body.insert("model".to_owned(), Value::String(model.to_owned()));
    body.insert(
        "messages".to_owned(),
        Value::Array(request.messages.iter().map(message_json).collect()),
    );
    if let Some(max_tokens) = request.max_tokens {
        body.insert("max_tokens".to_owned(), json!(max_tokens));
    }
    if let Some(temperature) = request.temperature {
        body.insert("temperature".to_owned(), json!(temperature));
    }
    if let Some(response_format) = &request.response_format {
        body.insert("response_format".to_owned(), response_format.clone());
    }
    if !request.tools.is_empty() {
        body.insert(
            "tools".to_owned(),
            Value::Array(
                request
                    .tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "type": "function",
                            "function": {
                                "name": tool.name,
                                "description": tool.description,
                                "parameters": tool.parameters,
                            }
                        })
                    })
                    .collect(),
            ),
        );
    }
    if let Some(tool_choice) = &request.tool_choice {
        body.insert("tool_choice".to_owned(), tool_choice.clone());
    }
    if let Some(parallel_tool_calls) = request.parallel_tool_calls {
        body.insert("parallel_tool_calls".to_owned(), json!(parallel_tool_calls));
    }
    Value::Object(body)
}

pub(super) fn message_json(message: &ChatMessage) -> Value {
    let mut value = Map::new();
    value.insert("role".to_owned(), Value::String(message.role.openai_name().to_owned()));
    if let Some(content) = &message.content {
        value.insert("content".to_owned(), Value::String(content.clone()));
    }
    if let Some(name) = &message.name {
        value.insert("name".to_owned(), Value::String(name.clone()));
    }
    if let Some(tool_call_id) = &message.tool_call_id {
        value.insert("tool_call_id".to_owned(), Value::String(tool_call_id.clone()));
    }
    if !message.tool_calls.is_empty() {
        value.insert(
            "tool_calls".to_owned(),
            Value::Array(
                message
                    .tool_calls
                    .iter()
                    .map(|call| {
                        json!({
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": call.arguments.to_string(),
                            }
                        })
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(value)
}

pub(super) fn first_model_id(payload: &Value) -> Option<String> {
    for (key, id_key) in [("data", "id"), ("models", "model"), ("models", "name")] {
        if let Some(model) = payload
            .get(key)
            .and_then(Value::as_array)
            .and_then(|models| {
                models
                    .iter()
                    .find_map(|candidate| candidate.get(id_key).and_then(Value::as_str))
            })
        {
            return Some(model.to_owned());
        }
    }
    None
}

pub(super) fn parse_completion(
    payload: &Value,
    request_id: &str,
) -> Result<ChatCompletion, ChatClientError> {
    let choice = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or(ChatClientError::InvalidResponse)?;
    let message = choice.get("message").ok_or(ChatClientError::InvalidResponse)?;
    let content = text_content(message.get("content"));
    let mut tool_calls = Vec::new();
    if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, call) in calls.iter().enumerate() {
            let function = call.get("function").ok_or(ChatClientError::InvalidResponse)?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or(ChatClientError::InvalidResponse)?;
            let arguments = function
                .get("arguments")
                .map(parse_arguments)
                .transpose()?
                .unwrap_or_else(|| json!({}));
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("{request_id}-{index}"));
            tool_calls.push(ChatToolCall {
                id,
                name: name.to_owned(),
                arguments,
            });
        }
    }
    let finish_reason = choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(ChatCompletion {
        content,
        tool_calls,
        finish_reason,
    })
}

fn text_content(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<String>();
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn parse_arguments(value: &Value) -> Result<Value, ChatClientError> {
    match value {
        Value::String(raw) => serde_json::from_str(raw).map_err(|_| ChatClientError::InvalidResponse),
        other => Ok(other.clone()),
    }
}
