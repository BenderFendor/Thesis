use std::time::Duration;

use feed_rs::parser;
use thesis_api::source_catalog::{
    RssFeedProvider, RssFeedSnapshot, RssValidationInput, SampleArticle, SourceCatalogFuture,
};
use thesis_ingest::cleaner::clean_html;

use super::super::safe_http::{SafeHttpError, SafeHttpFetcher};

const RSS_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const RSS_MAX_REDIRECTS: u8 = 5;
const RSS_MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

/// RSS validation backed by bounded, DNS-pinned HTTP and feed-rs parsing.
pub(crate) struct SafeRssFeedProvider {
    fetcher: SafeHttpFetcher,
}

impl SafeRssFeedProvider {
    pub(crate) fn new(fetcher: SafeHttpFetcher) -> Self {
        Self { fetcher }
    }
}

impl RssFeedProvider for SafeRssFeedProvider {
    fn validate(&self, input: RssValidationInput) -> SourceCatalogFuture<RssFeedSnapshot> {
        let fetcher = self.fetcher;
        Box::pin(async move {
            let response = match fetcher
                .fetch(
                    &input.url,
                    RSS_REQUEST_TIMEOUT,
                    RSS_MAX_REDIRECTS,
                    RSS_MAX_RESPONSE_BYTES,
                    None,
                )
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    return Ok(transport_failure_snapshot(input.source_name, error));
                }
            };
            if !response.status.is_success() {
                return Ok(failure_snapshot(
                    input.source_name,
                    "warning",
                    format!("RSS fetch failed with HTTP {}", response.status),
                ));
            }
            match parse_feed(&input.source_name, &response.body) {
                Ok(snapshot) => Ok(snapshot),
                Err(error) => Ok(failure_snapshot(input.source_name, "warning", error)),
            }
        })
    }
}

fn is_policy_rejection(error: SafeHttpError) -> bool {
    matches!(
        error,
        SafeHttpError::InvalidUrl
            | SafeHttpError::UnsafeAddress
            | SafeHttpError::RedirectLimit
            | SafeHttpError::UnsupportedContentType
            | SafeHttpError::BodyTooLarge
    )
}
fn transport_failure_snapshot(source_name: String, error: SafeHttpError) -> RssFeedSnapshot {
    let status = if is_policy_rejection(error) {
        "error"
    } else {
        "warning"
    };
    failure_snapshot(source_name, status, error.to_string())
}

fn failure_snapshot(source_name: String, status: &str, error_message: String) -> RssFeedSnapshot {
    RssFeedSnapshot {
        feed_title: source_name,
        article_count: 0,
        status: status.to_owned(),
        error_message: Some(error_message),
        sample_articles: Vec::new(),
    }
}

fn parse_feed(source_name: &str, response_body: &[u8]) -> Result<RssFeedSnapshot, String> {
    let parse_bytes = match std::str::from_utf8(response_body) {
        Ok(xml) => trim_to_feed_document(xml).as_bytes(),
        Err(_) => response_body,
    };
    let feed = parser::parse(parse_bytes).map_err(|error| format!("Parse error: {error}"))?;
    let articles = feed
        .entries
        .into_iter()
        .filter_map(|entry| {
            let title = clean_html(entry.title.as_ref()?.content.as_ref());
            let url = entry.links.first()?.href.clone();
            Some(SampleArticle {
                title,
                url,
                source: source_name.to_owned(),
            })
        })
        .collect::<Vec<_>>();
    let article_count = articles.len();
    Ok(RssFeedSnapshot {
        feed_title: source_name.to_owned(),
        article_count,
        status: "success".to_owned(),
        error_message: None,
        sample_articles: articles.into_iter().take(5).collect(),
    })
}

fn trim_to_feed_document(xml: &str) -> &str {
    ["</rss>", "</feed>"]
        .iter()
        .filter_map(|closing_tag| last_case_insensitive_end(xml, closing_tag))
        .max()
        .map_or(xml, |end| &xml[..end])
}

fn last_case_insensitive_end(xml: &str, closing_tag: &str) -> Option<usize> {
    xml.char_indices()
        .filter_map(|(start, _)| {
            let candidate = xml.get(start..)?;
            candidate
                .get(..closing_tag.len())
                .filter(|value| value.eq_ignore_ascii_case(closing_tag))
                .map(|_| start + closing_tag.len())
        })
        .last()
}

#[cfg(test)]
mod tests {
    use super::super::super::safe_http::SafeHttpError;
    use super::{parse_feed, trim_to_feed_document};
    use thesis_api::source_catalog::RssFeedSnapshot;
    const ATOM_FIXTURE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Example publication</title>
          <id>https://news.example/</id>
          <updated>2026-01-01T00:00:00Z</updated>
          <entry><id>tag:news.example,2026:1</id><title>&lt;em&gt;Story 1&lt;/em&gt;</title><updated>2026-01-01T00:00:00Z</updated><link href="https://news.example/1"/></entry>
          <entry><id>tag:news.example,2026:2</id><title>Story 2</title><updated>2026-01-01T00:00:00Z</updated><link href="https://news.example/2"/></entry>
          <entry><id>tag:news.example,2026:3</id><title>Story 3</title><updated>2026-01-01T00:00:00Z</updated><link href="https://news.example/3"/></entry>
          <entry><id>tag:news.example,2026:4</id><title>Story 4</title><updated>2026-01-01T00:00:00Z</updated><link href="https://news.example/4"/></entry>
          <entry><id>tag:news.example,2026:5</id><title>Story 5</title><updated>2026-01-01T00:00:00Z</updated><link href="https://news.example/5"/></entry>
          <entry><id>tag:news.example,2026:6</id><title>Story 6</title><updated>2026-01-01T00:00:00Z</updated><link href="https://news.example/6"/></entry>
        </feed> trailing text
    "#;

    #[test]
    fn parses_feed_rs_articles_and_returns_only_five_samples() {
        let snapshot = parse_feed("Example News", ATOM_FIXTURE.as_bytes()).expect("parse feed");
        assert_eq!(
            snapshot,
            RssFeedSnapshot {
                feed_title: "Example News".to_owned(),
                article_count: 6,
                status: "success".to_owned(),
                error_message: None,
                sample_articles: vec![
                    sample("Story 1", "https://news.example/1", "Example News"),
                    sample("Story 2", "https://news.example/2", "Example News"),
                    sample("Story 3", "https://news.example/3", "Example News"),
                    sample("Story 4", "https://news.example/4", "Example News"),
                    sample("Story 5", "https://news.example/5", "Example News"),
                ],
            }
        );
    }

    #[test]
    fn parse_failure_is_a_warning_without_fabricated_articles() {
        let error = parse_feed("Example News", b"not an RSS or Atom document")
            .expect_err("invalid feed must fail parsing");
        let snapshot = super::failure_snapshot("Example News".to_owned(), "warning", error);
        assert_eq!(snapshot.status, "warning");
        assert_eq!(snapshot.article_count, 0);
        assert!(snapshot.sample_articles.is_empty());
    }
    #[test]
    fn private_addresses_and_fetch_policy_failures_are_rejected() {
        for error in [
            SafeHttpError::InvalidUrl,
            SafeHttpError::UnsafeAddress,
            SafeHttpError::RedirectLimit,
            SafeHttpError::UnsupportedContentType,
            SafeHttpError::BodyTooLarge,
        ] {
            let snapshot = super::transport_failure_snapshot("Example News".to_owned(), error);
            assert_eq!(snapshot.status, "error");
            assert_eq!(snapshot.article_count, 0);
        }
        for error in [
            SafeHttpError::Timeout,
            SafeHttpError::Resolve,
            SafeHttpError::Request,
        ] {
            let snapshot = super::transport_failure_snapshot("Example News".to_owned(), error);
            assert_eq!(snapshot.status, "warning");
        }
    }

    #[test]
    fn trims_trailing_content_at_a_case_insensitive_feed_close() {
        assert_eq!(
            trim_to_feed_document("<RSS><channel/></RSS>ignored"),
            "<RSS><channel/></RSS>"
        );
    }

    fn sample(title: &str, url: &str, source: &str) -> thesis_api::source_catalog::SampleArticle {
        thesis_api::source_catalog::SampleArticle {
            title: title.to_owned(),
            url: url.to_owned(),
            source: source.to_owned(),
        }
    }
}
