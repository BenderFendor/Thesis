use std::collections::{HashMap, HashSet};
use std::time::Instant;

use feed_rs::model::Content;
use feed_rs::parser;
use rayon::prelude::*;
use regex::Regex;

use crate::cleaner::clean_html;
use crate::fetcher::fetch_all;
use crate::types::{
    FetchResult, ParseResult, ParsedArticle, SourceRequest, SourceStats, SubFeedStat,
};

#[derive(Debug, Default)]
struct RssItemMetadata {
    title: Option<String>,
    link: Option<String>,
    authors: Vec<String>,
}

fn push_unique_author(value: &str, seen: &mut HashSet<String>, authors: &mut Vec<String>) {
    let cleaned = clean_html(value).trim().to_string();
    if cleaned.is_empty() {
        return;
    }

    let lowered = cleaned.to_lowercase();
    if seen.insert(lowered) {
        authors.push(cleaned);
    }
}

fn looks_like_email(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains(char::is_whitespace) {
        return false;
    }

    let Some((_, domain)) = trimmed.rsplit_once('@') else {
        return false;
    };

    !domain.is_empty() && domain.contains('.')
}

fn normalize_rss_author_value(value: &str) -> Option<String> {
    let cleaned = clean_html(value).trim().to_string();
    if cleaned.is_empty() {
        return None;
    }

    if let Some((prefix, suffix)) = cleaned.rsplit_once('(') {
        let prefix = prefix.trim();
        let maybe_name = suffix.trim_end_matches(')').trim();
        if looks_like_email(prefix) && !maybe_name.is_empty() {
            return Some(maybe_name.to_string());
        }
    }

    if looks_like_email(&cleaned) {
        return None;
    }

    Some(cleaned)
}

fn extract_entry_authors(entry: &feed_rs::model::Entry) -> Vec<String> {
    let mut authors = Vec::new();
    let mut seen = HashSet::new();

    for person in &entry.authors {
        push_unique_author(person.name.trim(), &mut seen, &mut authors);
    }

    authors
}

fn extract_tag_value(item_xml: &str, regex: &Regex) -> Option<String> {
    let captures = regex.captures(item_xml)?;
    let value = captures
        .name("cdata")
        .or_else(|| captures.name("plain"))?
        .as_str();
    let cleaned = clean_html(value).trim().to_string();
    if cleaned.is_empty() {
        return None;
    }
    Some(cleaned)
}

fn extract_rss_item_metadata(xml: &str) -> Vec<RssItemMetadata> {
    let item_re = Regex::new(r#"(?is)<item\b.*?</item>"#).expect("valid item regex");
    let title_re = Regex::new(
        r#"(?is)<title[^>]*><!\[CDATA\[(?P<cdata>.*?)\]\]></title>|<title[^>]*>(?P<plain>.*?)</title>"#,
    )
    .expect("valid title regex");
    let link_re = Regex::new(
        r#"(?is)<link[^>]*><!\[CDATA\[(?P<cdata>.*?)\]\]></link>|<link[^>]*>(?P<plain>.*?)</link>"#,
    )
    .expect("valid link regex");
    let creator_re = Regex::new(
        r#"(?is)<dc:creator[^>]*><!\[CDATA\[(?P<cdata>.*?)\]\]></dc:creator>|<dc:creator[^>]*>(?P<plain>.*?)</dc:creator>"#,
    )
    .expect("valid creator regex");
    let author_re = Regex::new(
        r#"(?is)<author[^>]*><!\[CDATA\[(?P<cdata>.*?)\]\]></author>|<author[^>]*>(?P<plain>.*?)</author>"#,
    )
    .expect("valid author regex");

    item_re
        .find_iter(xml)
        .map(|item_match| {
            let item_xml = item_match.as_str();
            let mut authors = Vec::new();
            let mut seen = HashSet::new();

            for captures in creator_re.captures_iter(item_xml) {
                let value = captures
                    .name("cdata")
                    .or_else(|| captures.name("plain"))
                    .map(|item| item.as_str())
                    .unwrap_or_default();
                push_unique_author(value, &mut seen, &mut authors);
            }

            for captures in author_re.captures_iter(item_xml) {
                let value = captures
                    .name("cdata")
                    .or_else(|| captures.name("plain"))
                    .map(|item| item.as_str())
                    .unwrap_or_default();
                if let Some(normalized) = normalize_rss_author_value(value) {
                    push_unique_author(&normalized, &mut seen, &mut authors);
                }
            }

            RssItemMetadata {
                title: extract_tag_value(item_xml, &title_re),
                link: extract_tag_value(item_xml, &link_re),
                authors,
            }
        })
        .collect()
}

fn find_rss_item_authors(
    item_metadata: &[RssItemMetadata],
    link: &str,
    title: &str,
    index: usize,
) -> Vec<String> {
    if let Some(metadata) = item_metadata
        .iter()
        .find(|item| item.link.as_deref() == Some(link) || item.title.as_deref() == Some(title))
    {
        return metadata.authors.clone();
    }

    item_metadata
        .get(index)
        .map(|item| item.authors.clone())
        .unwrap_or_default()
}

pub async fn parse_sources(sources: Vec<SourceRequest>, max_concurrent: usize) -> ParseResult {
    let start = Instant::now();

    let fetch_start = Instant::now();
    let fetch_results = fetch_all(sources.clone(), max_concurrent).await;
    let fetch_duration = fetch_start.elapsed();

    let parse_start = Instant::now();
    let (articles, source_stats) = parse_results(fetch_results, sources);
    let parse_duration = parse_start.elapsed();

    ParseResult {
        metrics: crate::types::RustMetrics {
            total_duration_ms: start.elapsed().as_millis(),
            fetch_duration_ms: fetch_duration.as_millis(),
            parse_duration_ms: parse_duration.as_millis(),
            articles_parsed: articles.len(),
        },
        articles,
        source_stats,
    }
}

fn parse_results(
    fetch_results: Vec<FetchResult>,
    original_sources: Vec<SourceRequest>,
) -> (Vec<ParsedArticle>, HashMap<String, SourceStats>) {
    let mut grouped: HashMap<String, Vec<FetchResult>> = HashMap::new();
    for result in fetch_results {
        match &result {
            FetchResult::Success(raw) => {
                grouped
                    .entry(raw.source_name.clone())
                    .or_default()
                    .push(result);
            }
            FetchResult::Error(err) => {
                grouped
                    .entry(err.source_name.clone())
                    .or_default()
                    .push(result);
            }
        }
    }

    let articles_stats: Vec<_> = grouped
        .par_iter()
        .map(|(source_name, results)| parse_source_group(source_name, results))
        .collect();

    let mut articles = Vec::new();
    let mut stats = HashMap::new();
    for (mut source_articles, stat) in articles_stats {
        articles.append(&mut source_articles);
        stats.insert(stat.name.clone(), stat);
    }

    // Ensure sources without fetch attempt still have stats
    for source in original_sources {
        stats
            .entry(source.name.clone())
            .or_insert_with(|| SourceStats {
                name: source.name,
                status: "warning".to_string(),
                article_count: 0,
                error_message: Some("No fetch attempts".to_string()),
                sub_feeds: None,
            });
    }

    (articles, stats)
}

fn parse_source_group(
    source_name: &str,
    results: &[FetchResult],
) -> (Vec<ParsedArticle>, SourceStats) {
    let mut articles = Vec::new();
    let mut sub_stats = Vec::new();
    let mut top_status = "success".to_string();
    let mut errors = Vec::new();

    for result in results {
        match result {
            FetchResult::Success(raw) => match parser::parse(raw.xml.as_bytes()) {
                Ok(feed) => {
                    let parsed_articles = extract_articles(feed.entries, &raw.xml, source_name);
                    let count = parsed_articles.len();
                    articles.extend(parsed_articles);
                    sub_stats.push(SubFeedStat {
                        url: raw.url.clone(),
                        status: "success".to_string(),
                        article_count: count,
                        error_message: None,
                    });
                }
                Err(err) => {
                    top_status = "warning".to_string();
                    let msg = format!("Parse error: {err}");
                    errors.push(msg.clone());
                    sub_stats.push(SubFeedStat {
                        url: raw.url.clone(),
                        status: "error".to_string(),
                        article_count: 0,
                        error_message: Some(msg),
                    });
                }
            },
            FetchResult::Error(err) => {
                top_status = "warning".to_string();
                errors.push(err.message.clone());
                sub_stats.push(SubFeedStat {
                    url: err.url.clone(),
                    status: "error".to_string(),
                    article_count: 0,
                    error_message: Some(err.message.clone()),
                });
            }
        }
    }

    let stat = SourceStats {
        name: source_name.to_string(),
        status: top_status,
        article_count: articles.len(),
        error_message: if errors.is_empty() {
            None
        } else {
            Some(errors.join("; "))
        },
        sub_feeds: if sub_stats.is_empty() {
            None
        } else {
            Some(sub_stats)
        },
    };

    (articles, stat)
}

fn extract_articles(
    entries: Vec<feed_rs::model::Entry>,
    raw_xml: &str,
    source_name: &str,
) -> Vec<ParsedArticle> {
    let item_metadata = extract_rss_item_metadata(raw_xml);
    entries
        .into_par_iter()
        .enumerate()
        .filter_map(|entry| {
            let (index, entry) = entry;
            let title = clean_html(entry.title.as_ref()?.content.as_ref());
            let link = entry.links.first()?.href.clone();

            let description = pick_description(&entry).unwrap_or_default();
            let description = clean_html(&description);

            let published = entry
                .published
                .or(entry.updated)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

            let image = pick_image(&entry);
            let category = entry
                .categories
                .first()
                .and_then(|c| c.label.clone())
                .or_else(|| entry.categories.first().map(|c| c.term.clone()));

            let mut authors = extract_entry_authors(&entry);
            if authors.is_empty() {
                authors = find_rss_item_authors(&item_metadata, &link, &title, index);
            }

            Some(ParsedArticle {
                title,
                link,
                description,
                published,
                source: source_name.to_string(),
                authors,
                image,
                category,
            })
        })
        .collect()
}

fn pick_description(entry: &feed_rs::model::Entry) -> Option<String> {
    if let Some(summary) = &entry.summary {
        return Some(summary.content.clone());
    }

    if let Some(Content {
        body: Some(body), ..
    }) = &entry.content
    {
        return Some(body.clone());
    }

    entry
        .links
        .first()
        .map(|link| link.title.clone().unwrap_or_default())
}

fn pick_image(entry: &feed_rs::model::Entry) -> Option<String> {
    if let Some(media) = entry.media.first() {
        if let Some(content) = media.content.first() {
            if let Some(url) = &content.url {
                return Some(url.to_string());
            }
        }
    }

    if let Some(link) = entry
        .links
        .iter()
        .find(|l| matches_media_image(l.media_type.as_deref()))
    {
        return Some(link.href.clone());
    }

    None
}

fn matches_media_image(media_type: Option<&str>) -> bool {
    media_type
        .map(|t| t.starts_with("image/") || t == "application/octet-stream")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::extract_rss_item_metadata;

    #[test]
    fn extracts_dc_creator_authors_from_rss_items() {
        let xml = r#"
        <rss><channel>
          <item>
            <title>Example One</title>
            <link>https://example.com/one</link>
            <dc:creator><![CDATA[Jane Reporter]]></dc:creator>
          </item>
          <item>
            <title>Example Two</title>
            <link>https://example.com/two</link>
            <dc:creator>John Analyst</dc:creator>
          </item>
        </channel></rss>
        "#;

        let items = extract_rss_item_metadata(xml);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].authors, vec!["Jane Reporter"]);
        assert_eq!(items[1].authors, vec!["John Analyst"]);
    }

    #[test]
    fn extracts_rss_author_name_from_email_wrapper() {
        let xml = r#"
        <rss><channel>
          <item>
            <title>Example</title>
            <link>https://example.com/item</link>
            <author>editor@example.com (Taylor Smith)</author>
          </item>
        </channel></rss>
        "#;

        let items = extract_rss_item_metadata(xml);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].authors, vec!["Taylor Smith"]);
    }

    #[test]
    fn ignores_plain_rss_author_email_addresses() {
        let xml = r#"
        <rss><channel>
          <item>
            <title>Example</title>
            <link>https://example.com/item</link>
            <author>editor@example.com</author>
          </item>
        </channel></rss>
        "#;

        let items = extract_rss_item_metadata(xml);

        assert_eq!(items.len(), 1);
        assert!(items[0].authors.is_empty());
    }
}
