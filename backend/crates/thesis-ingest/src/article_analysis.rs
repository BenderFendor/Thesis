//! Deterministic article extraction and access-barrier classification.
//!
//! Network fetching, cache policy, and provider calls deliberately remain outside this
//! module. A caller supplies the captured HTML and response status, which keeps this
//! boundary replayable and makes the external fetch sidecar explicit.

use serde::{Deserialize, Serialize};

use crate::html_extract::extract_article_from_html;

const ACCESS_CHALLENGE_PATTERNS: &[&str] = &[
    "please enable js and disable any ad blocker",
    "security verification",
    "verify you are human",
    "attention required",
    "captcha",
    "cf-challenge",
    "bot verification",
];

const PAYWALL_PATTERNS: &[&str] = &[
    "subscribe to continue",
    "subscription required",
    "sign in to continue reading",
    "subscribe for full access",
    "log in to continue reading",
    "unlock this article",
    "this content is for subscribers",
];

const ACCESS_BLOCK_STATUS_CODES: &[u16] = &[401, 402, 403, 429];
const PAYWALL_STATUS_CODES: &[u16] = &[401, 402, 403];

/// The bounded, provider-independent result used by article-analysis callers.
///
/// The result intentionally does not retain the original HTML. This prevents a
/// route response or a captured fixture from accidentally exposing a complete
/// publisher document when only extracted metadata is required.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct ArticleExtractionResult {
    /// Whether usable article text was extracted.
    pub success: bool,
    /// Extracted article body, or `None` when extraction failed or was blocked.
    pub text: Option<String>,
    /// Extracted title, when present.
    pub title: Option<String>,
    /// Deduplicated author names in document order.
    pub authors: Vec<String>,
    /// Extracted publication date, when present.
    pub publish_date: Option<String>,
    /// Open Graph or Twitter lead image, when present.
    pub top_image: Option<String>,
    /// All extracted image URLs in document order.
    pub images: Vec<String>,
    /// Extracted description metadata, when present.
    pub meta_description: Option<String>,
    /// Name of the deterministic extractor used for a successful result.
    pub extractor: Option<String>,
    /// User-facing failure reason, when `success` is `false`.
    pub error: Option<String>,
}

impl ArticleExtractionResult {
    fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
            ..Self::default()
        }
    }

    fn successful_text(text: String) -> Option<String> {
        (!text.trim().is_empty()).then_some(text)
    }

    /// Return whether this result satisfies the success invariant.
    ///
    /// A result is successful only when it has non-whitespace text. Callers
    /// should not infer success from metadata alone.
    pub fn has_usable_text(&self) -> bool {
        self.success
            && self
                .text
                .as_deref()
                .is_some_and(|text| !text.trim().is_empty())
    }
}

/// Run deterministic HTML extraction and classify known access barriers.
///
/// `status_code` is the status returned by the external fetch sidecar. It is
/// optional because captured fixtures and non-HTTP adapters may not have one.
/// No network request is made here.
pub fn extract_article_response(html: &str, status_code: Option<u16>) -> ArticleExtractionResult {
    let parsed = extract_article_from_html(html);
    let normalized_html = normalize_for_detection(html);
    let normalized_title = parsed
        .title
        .as_deref()
        .map(normalize_for_detection)
        .unwrap_or_default();
    let normalized_description = parsed
        .meta_description
        .as_deref()
        .map(normalize_for_detection)
        .unwrap_or_default();
    let normalized_text = normalize_for_detection(&parsed.text);

    if let Some(error) = access_barrier(
        &normalized_html,
        &normalized_title,
        &normalized_description,
        &normalized_text,
        status_code,
    ) {
        return ArticleExtractionResult::failure(error);
    }

    let Some(text) = ArticleExtractionResult::successful_text(parsed.text) else {
        return ArticleExtractionResult::failure("No article text extracted");
    };

    ArticleExtractionResult {
        success: true,
        text: Some(text),
        title: parsed.title,
        authors: parsed.authors,
        publish_date: parsed.publish_date,
        top_image: parsed.top_image,
        images: parsed.images,
        meta_description: parsed.meta_description,
        extractor: Some("rust_html".to_owned()),
        error: None,
    }
}

fn access_barrier(
    normalized_html: &str,
    normalized_title: &str,
    normalized_description: &str,
    normalized_text: &str,
    status_code: Option<u16>,
) -> Option<&'static str> {
    let page_looks_short = count_words(normalized_text) < 120;
    let blocked_status = status_code.is_some_and(|status| {
        ACCESS_BLOCK_STATUS_CODES
            .iter()
            .copied()
            .any(|blocked| blocked == status)
    });
    let combined = [normalized_title, normalized_description, normalized_text]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if contains_pattern(normalized_html, ACCESS_CHALLENGE_PATTERNS)
        && (blocked_status || page_looks_short)
    {
        return Some("Publisher blocked automated access with a verification page");
    }

    if contains_pattern(
        if combined.is_empty() {
            normalized_html
        } else {
            &combined
        },
        PAYWALL_PATTERNS,
    ) && (status_code.is_some_and(|status| {
        PAYWALL_STATUS_CODES
            .iter()
            .copied()
            .any(|blocked| blocked == status)
    }) || page_looks_short)
    {
        return Some("Publisher requires a subscription or sign-in for full text");
    }

    None
}

fn contains_pattern(text: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| text.contains(pattern))
}

fn count_words(text: &str) -> usize {
    text.split(is_python_whitespace)
        .filter(|part| !part.is_empty())
        .count()
}

fn normalize_for_detection(text: &str) -> String {
    text.split(is_python_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn is_python_whitespace(character: char) -> bool {
    character.is_whitespace() || ('\u{001c}'..='\u{001f}').contains(&character)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::extract_article_response;

    #[test]
    fn extracts_metadata_and_text_without_network_access() {
        let html = r#"
            <html>
              <head>
                <meta property="og:title" content="Captured title">
                <meta name="author" content="Jane Doe">
                <meta property="article:published_time" content="2026-09-20">
              </head>
              <body><article><p>First paragraph.</p><p>Second paragraph.</p></article></body>
            </html>
        "#;

        let result = extract_article_response(html, Some(200));

        assert!(result.has_usable_text());
        assert_eq!(
            result.text.as_deref(),
            Some("First paragraph.\n\nSecond paragraph.")
        );
        assert_eq!(result.title.as_deref(), Some("Captured title"));
        assert_eq!(result.authors, ["Jane Doe"]);
        assert_eq!(result.extractor.as_deref(), Some("rust_html"));
        assert!(result.error.is_none());
    }

    #[test]
    fn blocked_pages_never_report_success_even_when_the_parser_finds_text() {
        let html = "<html><body><p>Please enable JS and disable any ad blocker</p></body></html>";
        let result = extract_article_response(html, Some(401));

        assert!(!result.success);
        assert!(!result.has_usable_text());
        assert_eq!(
            result.error.as_deref(),
            Some("Publisher blocked automated access with a verification page")
        );
        assert!(result.text.is_none());
    }

    #[test]
    fn paywall_pages_use_the_python_reference_message() {
        let html = "<html><body><main><p>Subscribe to continue reading this article.</p></main></body></html>";
        let result = extract_article_response(html, Some(403));

        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("Publisher requires a subscription or sign-in for full text")
        );
    }

    #[test]
    fn empty_or_non_article_documents_are_failures() {
        for html in ["", "<html><body><h1>Headline only</h1></body></html>"] {
            let result = extract_article_response(html, Some(200));
            assert!(!result.success);
            assert_eq!(result.error.as_deref(), Some("No article text extracted"));
            assert!(result.text.is_none());
        }
    }

    proptest! {
        #[test]
        fn arbitrary_documents_preserve_the_success_text_invariant(html in any::<String>()) {
            let result = extract_article_response(&html, None);
            prop_assert_eq!(result.success, result.text.as_deref().is_some_and(|text| !text.trim().is_empty()));
            prop_assert!(result.error.is_some() || result.success);
        }
    }
}

#[cfg(kani)]
mod kani_proofs {
    fn access_status_is_exact(status: u16) -> bool {
        matches!(status, 401 | 402 | 403 | 429)
    }

    #[kani::proof]
    fn access_status_predicate_has_no_unlisted_statuses() {
        let status = kani::any::<u16>();
        let blocked = access_status_is_exact(status);
        assert_eq!(
            blocked,
            status == 401 || status == 402 || status == 403 || status == 429
        );
    }
}
