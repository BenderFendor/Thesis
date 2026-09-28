use crate::models::Rejection;
use std::collections::HashMap;
use std::time::Instant;

use axum::extract::{Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use utoipa::IntoParams;

use super::{DebugProviderError, DebugState, ParsedFeed};

const PARSING_UNAVAILABLE_DETAIL: &str = "Debug parsing provider is not available";
const ARTICLE_PARSE_FAILED_DETAIL: &str = "Article image parser provider request failed";
const SOURCE_INSPECTION_FAILED_DETAIL: &str = "Source parser provider request failed";

pub(super) fn router(state: DebugState) -> Router {
    Router::new()
        .route("/debug/parser/test/rss", post(test_rss_parser))
        .route("/debug/parser/test/article", post(test_article_parser))
        .route("/debug/sources/{source_name}", get(get_source_debug_data))
        .with_state(state)
}

/// OpenAPI query parameters for the RSS parser test route.
#[derive(IntoParams)]
#[into_params(parameter_in = Query)]
struct RssParserTestParameters {
    /// RSS feed URL to test
    url: String,
    #[param(required = false, default = 5, minimum = 1, maximum = 20)]
    max_entries: i64,
}

#[utoipa::path(
    post,
    path = "/debug/parser/test/rss",
    operation_id = "test_rss_parser_debug_parser_test_rss_post",
    tag = "debug",
    params(RssParserTestParameters),
    responses(
        (status = 200, description = "RSS parser result", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = super::HttpValidationError),
        (status = 503, description = "Parser provider unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn test_rss_parser(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let url = match required_query(&params, "url") {
        Ok(url) => url,
        Err(response) => return response.into_response(),
    };
    let max_entries = match super::parse_integer_query(&params, "max_entries", 5, 1, 20) {
        Ok(value) => value as usize,
        Err(error) => return super::query_validation_response(error),
    };
    let Some(provider) = state.providers.parsing.as_ref() else {
        return super::provider_unavailable(PARSING_UNAVAILABLE_DETAIL);
    };

    let started = Instant::now();
    let parsed = match provider.parse_feed(url.clone(), 4).await {
        Ok(parsed) => parsed,
        Err(DebugProviderError::Unavailable) => {
            return super::provider_failed(
                DebugProviderError::Unavailable,
                PARSING_UNAVAILABLE_DETAIL,
            );
        }
        Err(DebugProviderError::Failed(message)) => {
            return (
                StatusCode::OK,
                Json(json!({
                    "url": url,
                    "success": false,
                    "error": message,
                    "parse_time_seconds": started.elapsed().as_secs_f64(),
                })),
            )
                .into_response();
        }
    };

    let parse_time_seconds = (started.elapsed().as_secs_f64() * 1_000.0).round() / 1_000.0;
    let parser_status = parsed.source_stats.get(&url);
    let bozo = parser_status
        .and_then(|status| status.get("status"))
        .and_then(Value::as_str)
        == Some("error");
    let bozo_exception = parser_status
        .and_then(|status| status.get("error_message"))
        .filter(|value| json_truthy(value))
        .and_then(value_as_python_string)
        .unwrap_or_default();
    let entries_count = parsed.articles.len();
    let sample_entries = parsed
        .articles
        .iter()
        .take(max_entries)
        .enumerate()
        .map(|(index, article)| {
            let image = article.get("image").cloned().unwrap_or(Value::Null);
            let selected_source = json_truthy(&image).then_some("rust_feed");
            json!({
                "index": index,
                "title": article.get("title").cloned().unwrap_or_else(|| json!("")),
                "link": article.get("link").cloned().unwrap_or_else(|| json!("")),
                "published": article.get("published").cloned().unwrap_or_else(|| json!("")),
                "image_extraction": {
                    "image_url": image,
                    "image_candidates": [],
                    "image_error": null,
                    "image_error_details": null,
                    "selected_source": selected_source,
                },
            })
        })
        .collect::<Vec<_>>();

    (
        StatusCode::OK,
        Json(json!({
            "url": url,
            "parse_time_seconds": parse_time_seconds,
            "success": !bozo,
            "feed_info": {
                "title": url,
                "description": "",
                "link": url,
                "language": "",
            },
            "status": {
                "http_status": 200,
                "bozo": bozo,
                "bozo_exception": bozo_exception,
                "entries_count": entries_count,
            },
            "sample_entries": sample_entries,
            "image_error_taxonomy": image_error_taxonomy(),
        })),
    )
        .into_response()
}

#[utoipa::path(
    post,
    path = "/debug/parser/test/article",
    operation_id = "test_article_parser_debug_parser_test_article_post",
    tag = "debug",
    params(("url" = String, Query, description = "Article page URL to test image extraction")),
    responses(
        (status = 200, description = "Article image parser result", body = inline(super::FreeFormObjectSchema)),
        (status = 422, description = "Validation Error", body = super::HttpValidationError),
        (status = 500, description = "Parser provider failure", body = inline(super::FreeFormObjectSchema)),
        (status = 503, description = "Parser provider unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn test_article_parser(
    State(state): State<DebugState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let url = match required_query(&params, "url") {
        Ok(url) => url,
        Err(response) => return response.into_response(),
    };
    let Some(provider) = state.providers.parsing.as_ref() else {
        return super::provider_unavailable(PARSING_UNAVAILABLE_DETAIL);
    };

    let parsed = match provider.parse_article(url.clone()).await {
        Ok(parsed) => parsed,
        Err(error) => return super::provider_failed(error, ARTICLE_PARSE_FAILED_DETAIL),
    };
    let candidates = parsed
        .candidates
        .iter()
        .map(|candidate| {
            json!({
                "url": candidate.get("url").cloned().unwrap_or(Value::Null),
                "source": candidate.get("source").cloned().unwrap_or(Value::Null),
                "priority": candidate.get("priority").cloned().unwrap_or(Value::Null),
            })
        })
        .collect::<Vec<_>>();
    (
        StatusCode::OK,
        Json(json!({
            "url": url,
            "success": parsed.image_url.is_some(),
            "image_url": parsed.image_url,
            "candidates": candidates,
            "error": parsed.error,
            "error_details": parsed.error_details,
        })),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/debug/sources/{source_name}",
    operation_id = "get_source_debug_data_debug_sources__source_name__get",
    tag = "debug",
    params(("source_name" = String, Path, description = "RSS source name")),
    responses(
        (status = 200, description = "Source parser debug data", body = inline(super::FreeFormObjectSchema)),
        (status = 404, description = "Source not found", body = inline(super::FreeFormObjectSchema)),
        (status = 500, description = "Parser provider failure", body = inline(super::FreeFormObjectSchema)),
        (status = 503, description = "Parser provider unavailable", body = inline(super::FreeFormObjectSchema))
    )
)]
pub(crate) async fn get_source_debug_data(
    State(state): State<DebugState>,
    AxumPath(source_name): AxumPath<String>,
) -> Response {
    let Some(source_config) = state.config.rss_sources.get(&source_name) else {
        return super::not_found(&format!("Source '{source_name}' not found"));
    };
    let Some((rss_url, all_urls)) = source_urls(source_config) else {
        return super::internal_error("RSS source configuration is invalid");
    };
    let Some(provider) = state.providers.parsing.as_ref() else {
        return super::provider_unavailable(PARSING_UNAVAILABLE_DETAIL);
    };

    let inspected = match provider
        .inspect_source(source_name.clone(), rss_url.clone())
        .await
    {
        Ok(inspected) => inspected,
        Err(error) => return super::provider_failed(error, SOURCE_INSPECTION_FAILED_DETAIL),
    };
    let ParsedFeed {
        source_stats,
        articles,
    } = inspected.parsed;
    let source_articles = articles
        .into_iter()
        .filter(|article| {
            article.get("source").and_then(Value::as_str) == Some(source_name.as_str())
        })
        .collect::<Vec<_>>();
    let feed_stat = source_stats.get(&source_name);
    let bozo = feed_stat
        .and_then(|status| status.get("status"))
        .and_then(Value::as_str)
        == Some("error");
    let bozo_exception = feed_stat
        .and_then(|status| status.get("error_message"))
        .filter(|value| json_truthy(value))
        .map(|value| value_as_python_string(value).unwrap_or_else(|| "None".to_owned()))
        .unwrap_or_else(|| "None".to_owned());

    let mut image_analysis = Vec::with_capacity(source_articles.len() * 3);
    let mut parsed_entries = Vec::with_capacity(source_articles.len().min(10));
    let mut entries_with_images = 0usize;
    for (index, article) in source_articles.iter().take(10).enumerate() {
        let image_sources = article
            .get("image")
            .and_then(Value::as_str)
            .filter(|image_url| !image_url.is_empty())
            .map(|image_url| vec![json!({"type": "rust_image", "url": image_url})])
            .unwrap_or_default();
        let description = article.get("description").and_then(Value::as_str);
        let description_images = description.map(extract_html_image_urls).unwrap_or_default();
        let has_images = !image_sources.is_empty() || !description_images.is_empty();
        entries_with_images += usize::from(has_images);
        image_analysis.push(json!({
            "entry_index": index,
            "source": "content",
            "urls": description_images,
        }));
        image_analysis.push(json!({
            "entry_index": index,
            "source": "description",
            "urls": description_images,
        }));
        image_analysis.push(json!({
            "entry_index": index,
            "source": "metadata",
            "data": image_sources,
        }));

        let author = article
            .get("author")
            .filter(|value| json_truthy(value))
            .cloned()
            .unwrap_or_else(|| json!("No author"));
        let tags = article
            .get("tags")
            .filter(|value| json_truthy(value))
            .cloned()
            .unwrap_or_else(|| json!([]));
        parsed_entries.push(json!({
            "index": index,
            "title": article.get("title").cloned().unwrap_or_else(|| json!("No title")),
            "link": article.get("link").cloned().unwrap_or_else(|| json!("")),
            "description": description_preview(description),
            "published": article.get("published").cloned().unwrap_or_else(|| json!("No date")),
            "author": author,
            "tags": tags,
            "has_images": has_images,
            "image_sources": image_sources,
            "content_images": description_images,
            "description_images": description_images,
            "raw_entry_keys": article.keys().cloned().collect::<Vec<_>>(),
        }));
    }

    let snapshot = state.cache_stream.snapshot();
    let cached_articles = snapshot
        .articles
        .iter()
        .filter(|article| {
            article.get("source").and_then(Value::as_str) == Some(source_name.as_str())
        })
        .collect::<Vec<_>>();
    let source_statistics = snapshot
        .source_stats
        .iter()
        .find(|item| item.get("name").and_then(Value::as_str) == Some(source_name.as_str()));

    (
        StatusCode::OK,
        Json(json!({
            "source_name": source_name,
            "source_config": source_config,
            "rss_url": rss_url,
            "all_urls": all_urls,
            "feed_metadata": {
                "title": source_name,
                "description": "",
                "link": rss_url,
                "language": "N/A",
                "updated": "N/A",
                "generator": "rss_parser_rust",
            },
            "feed_status": {
                "http_status": 200,
                "bozo": bozo,
                "bozo_exception": bozo_exception,
                "entries_count": source_articles.len(),
            },
            "parsed_entries": parsed_entries,
            "cached_articles": cached_articles,
            "source_statistics": source_statistics,
            "debug_timestamp": Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false),
            "image_analysis": {
                "total_entries": source_articles.len(),
                "entries_with_images": entries_with_images,
                "image_sources": image_analysis,
            },
            "raw_feed_preview": inspected.raw_feed.chars().take(1_000).collect::<String>(),
        })),
    )
        .into_response()
}

fn required_query(params: &HashMap<String, String>, field: &str) -> Result<String, Rejection> {
    params.get(field).cloned().ok_or_else(|| {
        Rejection::from(super::query_validation_response(
            super::HttpValidationError {
                detail: vec![super::ValidationError {
                    loc: vec![
                        super::ValidationLocation::Text("query".to_owned()),
                        super::ValidationLocation::Text(field.to_owned()),
                    ],
                    msg: "Field required".to_owned(),
                    error_type: "missing".to_owned(),
                    input: Value::Null,
                    ctx: None,
                }],
            },
        ))
    })
}

fn source_urls(source_config: &Value) -> Option<(String, Vec<String>)> {
    let configured_urls = source_config.get("url")?;
    let urls = match configured_urls {
        Value::String(url) => vec![url.clone()],
        Value::Array(urls) => urls
            .iter()
            .map(|url| url.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let rss_url = urls.first()?.clone();
    Some((rss_url, urls))
}

fn value_as_python_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Bool(value) => Some(if *value { "True" } else { "False" }.to_owned()),
        Value::Null => Some("None".to_owned()),
        _ => Some(value.to_string()),
    }
}

fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|number| number != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn description_preview(description: Option<&str>) -> String {
    let Some(description) = description.filter(|description| !description.is_empty()) else {
        return "No description".to_owned();
    };
    let mut characters = description.chars();
    let preview = characters.by_ref().take(200).collect::<String>();
    if characters.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn extract_html_image_urls(html: &str) -> Vec<String> {
    let bytes = html.as_bytes();
    let mut image_urls = Vec::new();
    let mut search_from = 0;
    while search_from < bytes.len() {
        let Some(offset) = find_ascii_case_insensitive(&bytes[search_from..], b"<img") else {
            break;
        };
        let tag_start = search_from + offset + 4;
        let Some(tag_length) = bytes[tag_start..].iter().position(|byte| *byte == b'>') else {
            break;
        };
        let tag = &bytes[tag_start..tag_start + tag_length];
        if let Some(image_url) = last_src_attribute(tag) {
            image_urls.push(String::from_utf8_lossy(image_url).into_owned());
        }
        search_from = tag_start + tag_length + 1;
    }
    image_urls
}

fn last_src_attribute(tag: &[u8]) -> Option<&[u8]> {
    if tag.len() <= 4 {
        return None;
    }
    for start in (1..=tag.len() - 4).rev() {
        if !tag[start..start + 4].eq_ignore_ascii_case(b"src=") || start + 4 >= tag.len() {
            continue;
        }
        if !matches!(tag[start + 4], b'"' | b'\'') {
            continue;
        }
        let value_start = start + 5;
        let Some(value_length) = tag[value_start..]
            .iter()
            .position(|byte| matches!(byte, b'"' | b'\''))
        else {
            continue;
        };
        if value_length > 0 {
            return Some(&tag[value_start..value_start + value_length]);
        }
    }
    None
}

fn find_ascii_case_insensitive(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

fn image_error_taxonomy() -> Vec<Value> {
    [
        "NO_IMAGE_IN_FEED",
        "IMAGE_URL_INVALID",
        "IMAGE_FETCH_FAILED",
        "IMAGE_FETCH_TIMEOUT",
        "IMAGE_UNSUPPORTED_TYPE",
        "MIXED_CONTENT_BLOCKED",
        "FRONTEND_RENDER_FAILED",
        "OG_IMAGE_NOT_FOUND",
        "ARTICLE_FETCH_FAILED",
    ]
    .into_iter()
    .map(|code| json!({"code": code}))
    .collect()
}
