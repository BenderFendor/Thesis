use std::collections::HashMap;
use std::time::Instant;

use feed_rs::model::Content;
use feed_rs::parser;
use rayon::prelude::*;

use crate::cleaner::clean_html;
use crate::fetcher::fetch_all;
use crate::types::{
    FetchResult, ParsedArticle, ParseResult, SourceRequest, SourceStats, SubFeedStat,
};

pub async fn parse_sources(
    sources: Vec<SourceRequest>,
    max_concurrent: usize,
) -> ParseResult {
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
        stats.entry(source.name.clone()).or_insert_with(|| SourceStats {
            name: source.name,
            status: "warning".to_string(),
            article_count: 0,
            error_message: Some("No fetch attempts".to_string()),
            sub_feeds: None,
        });
    }

    (articles, stats)
}

fn parse_source_group(source_name: &str, results: &[FetchResult]) -> (Vec<ParsedArticle>, SourceStats) {
    let mut articles = Vec::new();
    let mut sub_stats = Vec::new();
    let mut top_status = "success".to_string();
    let mut errors = Vec::new();

    for result in results {
        match result {
            FetchResult::Success(raw) => match parser::parse(raw.xml.as_bytes()) {
                Ok(feed) => {
                    let parsed_articles = extract_articles(feed.entries, source_name);
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

fn extract_articles(entries: Vec<feed_rs::model::Entry>, source_name: &str) -> Vec<ParsedArticle> {
    entries
        .into_par_iter()
        .filter_map(|entry| {
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

            Some(ParsedArticle {
                title,
                link,
                description,
                published,
                source: source_name.to_string(),
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

    if let Some(Content { body: Some(body), .. }) = &entry.content {
        return Some(body.clone());
    }

    entry.links.first().map(|link| link.title.clone().unwrap_or_default())
}

fn pick_image(entry: &feed_rs::model::Entry) -> Option<String> {
    if let Some(media) = entry.media.first() {
        if let Some(content) = media.content.first() {
            if let Some(url) = &content.url {
                return Some(url.to_string());
            }
        }
    }

    if let Some(link) = entry.links.iter().find(|l| matches_media_image(l.media_type.as_deref())) {
        return Some(link.href.clone());
    }

    None
}

fn matches_media_image(media_type: Option<&str>) -> bool {
    media_type
        .map(|t| t.starts_with("image/") || t == "application/octet-stream")
        .unwrap_or(false)
}
