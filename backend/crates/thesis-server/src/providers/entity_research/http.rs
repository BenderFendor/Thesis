use std::time::Duration;

use reqwest::{StatusCode, Url};
use serde_json::Value;

use crate::providers::SafeHttpFetcher;

pub(super) const JSON_CONTENT_TYPES: &[&str] =
    &["application/json", "application/sparql-results+json"];
pub(super) const HTML_CONTENT_TYPES: &[&str] = &["text/html", "application/xhtml+xml"];
pub(super) const TEXT_CONTENT_TYPES: &[&str] = &["text/plain", "application/octet-stream"];
pub(super) const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const JSON_MAX_BYTES: usize = 5 * 1024 * 1024;
pub(super) const HTML_MAX_BYTES: usize = 100_000;
pub(super) const TEXT_MAX_BYTES: usize = 200_000;
pub(super) const MAX_REDIRECTS: u8 = 5;

pub(super) async fn get_json(fetcher: &SafeHttpFetcher, url: &str) -> Option<Value> {
    let response = fetcher
        .fetch(
            url,
            DEFAULT_TIMEOUT,
            MAX_REDIRECTS,
            JSON_MAX_BYTES,
            Some(JSON_CONTENT_TYPES),
        )
        .await
        .ok()?;
    successful_json(response.status, &response.body)
}

pub(super) async fn get_html(fetcher: &SafeHttpFetcher, url: &str) -> Option<(String, String)> {
    let response = fetcher
        .fetch(
            url,
            DEFAULT_TIMEOUT,
            MAX_REDIRECTS,
            HTML_MAX_BYTES,
            Some(HTML_CONTENT_TYPES),
        )
        .await
        .ok()?;
    if !response.status.is_success() {
        return None;
    }
    let text = String::from_utf8_lossy(&response.body).into_owned();
    Some((text, response.final_url))
}

pub(super) async fn get_text(fetcher: &SafeHttpFetcher, url: &str) -> Option<(String, String)> {
    let response = fetcher
        .fetch(
            url,
            DEFAULT_TIMEOUT,
            MAX_REDIRECTS,
            TEXT_MAX_BYTES,
            Some(TEXT_CONTENT_TYPES),
        )
        .await
        .ok()?;
    if !response.status.is_success() {
        return None;
    }
    let text = String::from_utf8_lossy(&response.body).into_owned();
    Some((text, response.final_url))
}

pub(super) fn api_url(endpoint: &str, pairs: &[(&str, &str)]) -> String {
    let mut url = Url::parse(endpoint).expect("fixed upstream endpoint URL");
    url.query_pairs_mut().extend_pairs(pairs.iter().copied());
    url.to_string()
}

pub(super) fn site_url(value: &str) -> Option<Url> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let candidate = if value.contains("://") {
        value.to_owned()
    } else {
        format!("https://{value}")
    };
    let url = Url::parse(&candidate).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url)
}

fn successful_json(status: StatusCode, body: &[u8]) -> Option<Value> {
    if !status.is_success() {
        return None;
    }
    serde_json::from_slice(body).ok()
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use serde_json::json;

    use super::{api_url, site_url, successful_json};

    #[test]
    fn fixed_endpoint_query_encodes_route_values() {
        let url = api_url(
            "https://www.wikidata.org/w/api.php",
            &[("search", "A&B + C")],
        );
        let parsed = reqwest::Url::parse(&url).expect("URL");
        assert_eq!(
            parsed
                .query_pairs()
                .find(|(key, _)| key == "search")
                .unwrap()
                .1,
            "A&B + C"
        );
    }

    #[test]
    fn site_url_accepts_http_schemes_without_credentials() {
        assert_eq!(
            site_url("example.org").unwrap().as_str(),
            "https://example.org/"
        );
        assert!(site_url("javascript:alert(1)").is_none());
        assert!(site_url("https://user@example.org").is_none());
    }

    #[test]
    fn upstream_json_requires_success_status_and_valid_json() {
        assert_eq!(
            successful_json(StatusCode::OK, br#"{"answer":42}"#),
            Some(json!({"answer":42}))
        );
        assert!(successful_json(StatusCode::BAD_GATEWAY, br#"{"answer":42}"#).is_none());
        assert!(successful_json(StatusCode::OK, b"not JSON").is_none());
    }
}
