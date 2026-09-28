use std::borrow::Cow;
use std::collections::BTreeMap;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};
use utoipa::openapi::schema::{AdditionalProperties, ArrayBuilder, Object, ObjectBuilder, Type};
use utoipa::openapi::{RefOr, Schema};
use utoipa::ToSchema;

use crate::models::{HttpValidationError, ValidationError, ValidationLocation};

const DIGEST_FAILURE_DETAIL: &str = "Failed to generate digest";
const COPY_STYLE_GUIDE: &str = "Write direct prose. Keep sentences short and plain. Use a modern, casual tone. Do not use emojis or em dashes. Avoid expectation flips and contrast framing. Do not add meta commentary about the writing process. Do not write listicles or stack fragments. Do not claim that facts show or reveal anything. Do not use the following words in prose unless they are part of quoted source material, fixed field names, or required schema keys: align, crucial, delve, emphasize, enduring, enhance, fostering, garnered, highlight, interplay, intricate, pivotal, showcase, tapestry, underscore. Keep qualifiers light and avoid jargon.";

/// A future returned by the external queue-digest provider.
pub type QueueDigestFuture<T> = Pin<Box<dyn Future<Output = Result<T, QueueDigestError>> + Send>>;

/// An opaque provider failure. Internal credentials and upstream error bodies never cross the API boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QueueDigestError;

/// External text-generation boundary for the queue digest operation.
pub trait QueueDigestProvider: Send + Sync {
    /// Generate a digest from the already formatted system and user prompts.
    fn generate(&self, system_prompt: String, user_prompt: String) -> QueueDigestFuture<String>;
}

/// State for the optional queue-digest provider.
#[derive(Clone)]
pub struct QueueDigestState {
    provider: Option<Arc<dyn QueueDigestProvider>>,
}

impl QueueDigestState {
    /// Attach a configured digest provider.
    pub fn with_provider(provider: impl QueueDigestProvider + 'static) -> Self {
        Self {
            provider: Some(Arc::new(provider)),
        }
    }

    /// Represent a deployment where no digest provider is configured.
    pub fn unavailable() -> Self {
        Self { provider: None }
    }
}

impl Default for QueueDigestState {
    fn default() -> Self {
        Self::unavailable()
    }
}

/// Request shape used for the OpenAPI contract. Runtime parsing below preserves
/// category insertion order, as Python's dictionary iteration does.
#[derive(ToSchema)]
#[schema(
    as = QueueDigestRequest,
    title = "QueueDigestRequest",
    description = "Request for generating AI digest."
)]
pub struct QueueDigestRequestSchema {
    #[schema(schema_with = free_form_articles_schema)]
    pub articles: Vec<Value>,
    #[schema(schema_with = grouped_articles_schema)]
    pub grouped: BTreeMap<String, Vec<Value>>,
}

/// Successful digest response.
#[derive(Serialize, ToSchema)]
#[schema(
    as = QueueDigestResponse,
    title = "QueueDigestResponse",
    description = "Response containing generated digest."
)]
pub(crate) struct QueueDigestResponse {
    #[schema(schema_with = digest_string_schema)]
    digest: String,
}

struct OrderedStringMap<T>(Vec<(String, T)>);

impl<'de, T> Deserialize<'de> for OrderedStringMap<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct OrderedStringMapVisitor<T>(PhantomData<T>);

        impl<'de, T> Visitor<'de> for OrderedStringMapVisitor<T>
        where
            T: Deserialize<'de>,
        {
            type Value = OrderedStringMap<T>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A>(self, mut access: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut entries: Vec<(String, T)> =
                    Vec::with_capacity(access.size_hint().unwrap_or_default());
                while let Some((key, value)) = access.next_entry::<String, T>()? {
                    if let Some((_, previous)) = entries
                        .iter_mut()
                        .find(|(entry, _)| entry.as_str() == key.as_str())
                    {
                        *previous = value;
                    } else {
                        entries.push((key, value));
                    }
                }
                Ok(OrderedStringMap(entries))
            }
        }

        deserializer.deserialize_map(OrderedStringMapVisitor(PhantomData))
    }
}

#[derive(Deserialize)]
struct RawQueueDigestRequest {
    articles: Vec<Value>,
    grouped: OrderedStringMap<Vec<Value>>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum FallbackQueueDigestValue {
    Object(OrderedStringMap<FallbackQueueDigestValue>),
    Other(Value),
}

struct ParsedQueueDigestRequest {
    articles: Vec<Value>,
    grouped: OrderedStringMap<Vec<Value>>,
}

#[utoipa::path(
    post,
    path = "/api/queue/digest",
    operation_id = "generate_ai_digest_api_queue_digest_post",
    tag = "reading_queue",
    summary = "Generate Ai Digest",
    description = "Generate an AI-powered reading digest from queued articles.",
    request_body = QueueDigestRequestSchema,
    responses(
        (status = 200, description = "Successful Response", body = QueueDigestResponse),
        (status = 422, description = "Validation Error", body = HttpValidationError)
    )
)]
pub(crate) async fn generate_ai_digest(
    State(state): State<QueueDigestState>,
    body: Bytes,
) -> Response {
    let request = match parse_request(&body) {
        Ok(request) => request,
        Err(error) => return error.into_response(),
    };
    let Some(provider) = state.provider else {
        return digest_failure();
    };

    let system_prompt = system_prompt();
    let user_prompt = user_prompt(&request.articles, &request.grouped.0);
    match provider.generate(system_prompt, user_prompt).await {
        Ok(content) => {
            let digest = content.trim();
            let structured = structured_articles_block(&request.articles);
            Json(QueueDigestResponse {
                digest: format!("{digest}\n\n{structured}"),
            })
            .into_response()
        }
        Err(_) => digest_failure(),
    }
}

fn digest_failure() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "detail": DIGEST_FAILURE_DETAIL })),
    )
        .into_response()
}

fn parse_request(body: &[u8]) -> Result<ParsedQueueDigestRequest, HttpValidationError> {
    match serde_json::from_slice::<RawQueueDigestRequest>(body) {
        Ok(request) => validate_request(request.articles, request.grouped),
        Err(error) => match serde_json::from_slice::<FallbackQueueDigestValue>(body) {
            Ok(value) => validate_fallback_request(value),
            Err(_) => Err(json_decode_error(error)),
        },
    }
}

fn json_decode_error(error: serde_json::Error) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc: vec![ValidationLocation::Text("body".to_owned())],
            msg: "JSON decode error".to_owned(),
            error_type: "json_invalid".to_owned(),
            input: Value::Null,
            ctx: Some(Map::from_iter([(
                "error".to_owned(),
                Value::String(error.to_string()),
            )])),
        }],
    }
}

fn validate_fallback_request(
    value: FallbackQueueDigestValue,
) -> Result<ParsedQueueDigestRequest, HttpValidationError> {
    let request_input = fallback_value_to_json(&value);
    let FallbackQueueDigestValue::Object(fields) = value else {
        return Err(HttpValidationError::body(
            request_input,
            "model_type",
            "Input should be a valid dictionary or object to extract fields from",
        ));
    };
    let Some((_, articles_value)) = fields.0.iter().find(|(name, _)| name == "articles") else {
        return Err(HttpValidationError::field(
            request_input,
            "articles",
            "missing",
            "Field required",
        ));
    };
    let articles = validate_articles(fallback_value_to_json(articles_value))?;

    let Some((_, grouped_value)) = fields.0.iter().find(|(name, _)| name == "grouped") else {
        return Err(HttpValidationError::field(
            request_input,
            "grouped",
            "missing",
            "Field required",
        ));
    };
    let FallbackQueueDigestValue::Object(categories) = grouped_value else {
        return Err(HttpValidationError::field(
            fallback_value_to_json(grouped_value),
            "grouped",
            "dict_type",
            "Input should be a valid dictionary",
        ));
    };
    let grouped = OrderedStringMap(
        categories
            .0
            .iter()
            .map(|(category, articles)| (category.clone(), fallback_value_to_json(articles)))
            .collect(),
    );
    let grouped = validate_categories(grouped)?;
    Ok(ParsedQueueDigestRequest { articles, grouped })
}

fn fallback_value_to_json(value: &FallbackQueueDigestValue) -> Value {
    match value {
        FallbackQueueDigestValue::Object(fields) => {
            let mut object = Map::new();
            for (key, value) in &fields.0 {
                object.insert(key.clone(), fallback_value_to_json(value));
            }
            Value::Object(object)
        }
        FallbackQueueDigestValue::Other(value) => value.clone(),
    }
}

fn validate_request(
    articles: Vec<Value>,
    grouped: OrderedStringMap<Vec<Value>>,
) -> Result<ParsedQueueDigestRequest, HttpValidationError> {
    let articles = validate_article_items(
        articles,
        vec![
            ValidationLocation::Text("body".to_owned()),
            ValidationLocation::Text("articles".to_owned()),
        ],
    )?;
    let mut validated = Vec::with_capacity(grouped.0.len());
    for (category, articles) in grouped.0 {
        let articles = validate_article_items(
            articles,
            vec![
                ValidationLocation::Text("body".to_owned()),
                ValidationLocation::Text("grouped".to_owned()),
                ValidationLocation::Text(category.clone()),
            ],
        )?;
        validated.push((category, articles));
    }
    Ok(ParsedQueueDigestRequest {
        articles,
        grouped: OrderedStringMap(validated),
    })
}

fn validate_articles(articles: Value) -> Result<Vec<Value>, HttpValidationError> {
    let articles = match articles {
        Value::Array(items) => items,
        value => {
            return Err(HttpValidationError::field(
                value,
                "articles",
                "list_type",
                "Input should be a valid list",
            ))
        }
    };
    validate_article_items(
        articles,
        vec![
            ValidationLocation::Text("body".to_owned()),
            ValidationLocation::Text("articles".to_owned()),
        ],
    )
}

fn validate_categories(
    grouped: OrderedStringMap<Value>,
) -> Result<OrderedStringMap<Vec<Value>>, HttpValidationError> {
    let mut validated = Vec::with_capacity(grouped.0.len());
    for (category, value) in grouped.0 {
        let articles = match value {
            Value::Array(items) => items,
            value => {
                return Err(validation_error(
                    vec![
                        ValidationLocation::Text("body".to_owned()),
                        ValidationLocation::Text("grouped".to_owned()),
                        ValidationLocation::Text(category),
                    ],
                    value,
                    "list_type",
                    "Input should be a valid list",
                ))
            }
        };
        let articles = validate_article_items(
            articles,
            vec![
                ValidationLocation::Text("body".to_owned()),
                ValidationLocation::Text("grouped".to_owned()),
                ValidationLocation::Text(category.clone()),
            ],
        )?;
        validated.push((category, articles));
    }
    Ok(OrderedStringMap(validated))
}

fn validate_article_items(
    articles: Vec<Value>,
    mut location: Vec<ValidationLocation>,
) -> Result<Vec<Value>, HttpValidationError> {
    for (index, article) in articles.iter().enumerate() {
        if !article.is_object() {
            location.push(ValidationLocation::Index(index as i64));
            return Err(validation_error(
                location,
                article.clone(),
                "dict_type",
                "Input should be a valid dictionary",
            ));
        }
    }
    Ok(articles)
}

fn validation_error(
    loc: Vec<ValidationLocation>,
    input: Value,
    error_type: &str,
    message: &str,
) -> HttpValidationError {
    HttpValidationError {
        detail: vec![ValidationError {
            loc,
            msg: message.to_owned(),
            error_type: error_type.to_owned(),
            input,
            ctx: None,
        }],
    }
}

fn system_prompt() -> String {
    let identity = format!(
        "Current date is {}. You are Scoop's news digest writer.",
        Utc::now().format("%Y-%m-%d")
    );
    [
        identity.as_str(),
        "Write a clean reading digest from the supplied article set.",
        "Use the provided context first. Do not invent facts. If something is uncertain, say so plainly. Cite URLs when they are available.",
        COPY_STYLE_GUIDE,
        "Write in markdown.\n\nKeep the digest skimmable without listicle filler.",
    ]
    .join("\n\n")
}

fn user_prompt(articles: &[Value], grouped: &[(String, Vec<Value>)]) -> String {
    let sections = category_sections(grouped);
    let references = reference_links(articles);
    format!(
        "You are a personal research assistant creating a daily briefing for a busy professional.\n\nSynthesize the following {} articles across {} topics into a well-organized, \nskimmable \"Daily Reading Digest\" that identifies key themes and provides actionable insights.\n\nARTICLES BY CATEGORY:\n{sections}\n\nWhen you mention or summarize articles in the executive summary or in the category overviews,\ninclude a Markdown link using the article title that points to the article URL (for example:\n[Article Title](https://...)). If an article does not have a URL, include its source name in\nparentheses after the title.\n\nCreate a professional digest that:\n1. Starts with an executive summary (2-3 sentences noting the day's key themes)\n2. Organizes insights by category/theme with clear subheadings\n3. Uses bullet points for easy scanning\n4. Highlights 3-5 key takeaways and implications\n5. Includes recommended next actions or areas for deeper research\n6. Notes any significant disagreements or diverging perspectives across sources\n\nFormat using clean Markdown for maximum readability. Focus on synthesizing connections\nbetween articles rather than summarizing each individually.\n\nREFERENCE LINKS:\n{references}\n",
        articles.len(),
        grouped.len()
    )
}

fn category_sections(grouped: &[(String, Vec<Value>)]) -> String {
    grouped
        .iter()
        .filter(|(_, articles)| !articles.is_empty())
        .map(|(category, articles)| {
            let article_text = articles
                .iter()
                .map(|article| {
                    format!(
                        "Title: {}\nSource: {}\nURL: {}\nSummary: {}",
                        value_string(article.get("title"), "Untitled"),
                        value_string(article.get("source"), "Unknown"),
                        value_string(
                            truthy_value(article.get("url"))
                                .or_else(|| truthy_value(article.get("link"))),
                            "N/A",
                        ),
                        value_string(
                            truthy_value(article.get("summary"))
                                .or_else(|| truthy_value(article.get("description"))),
                            "",
                        ),
                    )
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            format!(
                "## {category} ({} articles)\n\nArticles:\n{article_text}",
                articles.len()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn reference_links<'a>(articles: &'a [Value]) -> String {
    let mut seen: Vec<(Option<&'a Value>, &'a Value)> = Vec::new();
    let mut lines = Vec::new();
    for article in articles {
        let title =
            truthy_value(article.get("title")).filter(|title| title.as_str() != Some("Untitled"));
        let Some(url) =
            truthy_value(article.get("url")).or_else(|| truthy_value(article.get("link")))
        else {
            continue;
        };
        if seen.contains(&(title, url)) {
            continue;
        }
        lines.push(format!(
            "- [{}]({})",
            value_string(title, "Untitled"),
            value_string(Some(url), "")
        ));
        seen.push((title, url));
    }
    lines.join("\n")
}

#[derive(Serialize)]
struct StructuredArticles<'a> {
    articles: Vec<NormalizedArticle<'a>>,
    total: usize,
    clusters: Vec<Value>,
}

#[derive(Serialize)]
struct NormalizedArticle<'a> {
    title: Cow<'a, Value>,
    summary: Cow<'a, Value>,
    url: Cow<'a, Value>,
    image: Cow<'a, Value>,
    source: Cow<'a, Value>,
    published: Cow<'a, Value>,
    category: Cow<'a, Value>,
    author: Cow<'a, Value>,
    meta: ArticleMetadata<'a>,
}

#[derive(Serialize)]
struct ArticleMetadata<'a> {
    retrieval_method: Cow<'a, Value>,
    chroma_id: Cow<'a, Value>,
    semantic_score: Cow<'a, Value>,
}

fn structured_articles_block(articles: &[Value]) -> String {
    let normalized = articles.iter().map(normalize_article).collect::<Vec<_>>();
    let payload = StructuredArticles {
        total: normalized.len(),
        articles: normalized,
        clusters: Vec::new(),
    };
    let json_text = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_owned());
    format!("```json:articles\n{json_text}\n```")
}

fn normalize_article(article: &Value) -> NormalizedArticle<'_> {
    NormalizedArticle {
        title: first_value(article, &["title", "headline"], "Untitled"),
        summary: first_value(article, &["summary", "description"], ""),
        url: first_value(article, &["url", "link"], ""),
        image: first_value(article, &["image", "image_url"], "/placeholder.svg"),
        source: first_value(article, &["source", "publisher"], "Unknown"),
        published: value_or_null(optional_first_value(
            article,
            &["published", "published_at"],
        )),
        category: first_value(article, &["category"], "general"),
        author: value_or_null(article.get("author")),
        meta: ArticleMetadata {
            retrieval_method: value_or_null(article.get("retrieval_method")),
            chroma_id: value_or_null(article.get("chroma_id")),
            semantic_score: value_or_null(article.get("semantic_score")),
        },
    }
}

fn first_value<'a>(article: &'a Value, keys: &[&str], default: &str) -> Cow<'a, Value> {
    optional_first_value(article, keys)
        .map(Cow::Borrowed)
        .unwrap_or_else(|| Cow::Owned(Value::String(default.to_owned())))
}

fn optional_first_value<'a>(article: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| article.get(*key))
        .find(|value| is_truthy(value))
}

fn value_or_null(value: Option<&Value>) -> Cow<'_, Value> {
    value
        .map(Cow::Borrowed)
        .unwrap_or_else(|| Cow::Owned(Value::Null))
}

fn truthy_value(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| is_truthy(value))
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => {
            value.as_i64() != Some(0) && value.as_u64() != Some(0) && value.as_f64() != Some(0.0)
        }
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn value_string<'a>(value: Option<&'a Value>, default: &'a str) -> Cow<'a, str> {
    match value {
        None => Cow::Borrowed(default),
        Some(Value::Null) => Cow::Borrowed("None"),
        Some(Value::Bool(true)) => Cow::Borrowed("True"),
        Some(Value::Bool(false)) => Cow::Borrowed("False"),
        Some(Value::String(value)) => Cow::Borrowed(value.as_str()),
        Some(value @ (Value::Array(_) | Value::Object(_))) => Cow::Owned(python_repr(value)),
        Some(value) => Cow::Owned(value.to_string()),
    }
}

fn python_string_repr(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn python_repr(value: &Value) -> String {
    match value {
        Value::Null => "None".to_owned(),
        Value::Bool(true) => "True".to_owned(),
        Value::Bool(false) => "False".to_owned(),
        Value::String(value) => python_string_repr(value),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(python_repr)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Value::Object(values) => format!(
            "{{{}}}",
            values
                .iter()
                .map(|(key, value)| {
                    format!("{}: {}", python_string_repr(key), python_repr(value))
                })
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Value::Number(value) => value.to_string(),
    }
}

fn free_form_article_object_schema() -> Object {
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
}

fn free_form_articles_schema() -> RefOr<Schema> {
    ArrayBuilder::new()
        .items(free_form_article_object_schema())
        .title(Some("Articles"))
        .build()
        .into()
}

fn grouped_articles_schema() -> RefOr<Schema> {
    let articles = Schema::from(
        ArrayBuilder::new()
            .items(free_form_article_object_schema())
            .build(),
    );
    ObjectBuilder::new()
        .schema_type(Type::Object)
        .additional_properties(Some(AdditionalProperties::from(articles)))
        .title(Some("Grouped"))
        .build()
        .into()
}

fn digest_string_schema() -> RefOr<Schema> {
    ObjectBuilder::new()
        .schema_type(Type::String)
        .title(Some("Digest"))
        .build()
        .into()
}
