use std::collections::HashSet;

use scraper::{Html, Selector};

use crate::cleaner::clean_html;

#[derive(Debug, Default)]
pub struct ArticleExtraction {
    pub text: String,
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub publish_date: Option<String>,
    pub top_image: Option<String>,
    pub images: Vec<String>,
    pub meta_description: Option<String>,
}

#[derive(Debug, Default)]
pub struct OgImageExtraction {
    pub image_url: Option<String>,
    pub candidates: Vec<ImageCandidate>,
}

#[derive(Debug, Clone)]
pub struct ImageCandidate {
    pub url: String,
    pub source: String,
    pub priority: usize,
}

fn selector(selector: &str) -> Option<Selector> {
    Selector::parse(selector).ok()
}

fn meta_contents(document: &Html, selector_str: &str) -> Vec<String> {
    let Some(sel) = selector(selector_str) else {
        return Vec::new();
    };

    document
        .select(&sel)
        .filter_map(|el| el.value().attr("content").map(|val| val.to_string()))
        .filter(|val| !val.trim().is_empty())
        .collect()
}

fn first_meta_content(document: &Html, selectors: &[&str]) -> Option<String> {
    for selector_str in selectors {
        for value in meta_contents(document, selector_str) {
            let cleaned = value.trim();
            if !cleaned.is_empty() {
                return Some(cleaned.to_string());
            }
        }
    }
    None
}

fn collect_meta_contents(document: &Html, selectors: &[&str]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for selector_str in selectors {
        for value in meta_contents(document, selector_str) {
            let cleaned = value.trim();
            if cleaned.is_empty() {
                continue;
            }
            if seen.insert(cleaned.to_string()) {
                results.push(cleaned.to_string());
            }
        }
    }
    results
}

fn extract_title(document: &Html) -> Option<String> {
    if let Some(meta_title) = first_meta_content(
        document,
        &[
            "meta[property='og:title']",
            "meta[name='twitter:title']",
        ],
    ) {
        return Some(meta_title);
    }

    let Some(sel) = selector("title") else {
        return None;
    };
    document
        .select(&sel)
        .next()
        .map(|el| clean_html(&el.text().collect::<Vec<_>>().join(" ")))
        .filter(|val| !val.is_empty())
}

fn extract_meta_description(document: &Html) -> Option<String> {
    first_meta_content(
        document,
        &[
            "meta[name='description']",
            "meta[property='og:description']",
            "meta[name='twitter:description']",
        ],
    )
}

fn extract_publish_date(document: &Html) -> Option<String> {
    first_meta_content(
        document,
        &[
            "meta[property='article:published_time']",
            "meta[name='pubdate']",
            "meta[name='date']",
            "meta[itemprop='datePublished']",
            "meta[name='DC.date.issued']",
        ],
    )
}

fn extract_authors(document: &Html) -> Vec<String> {
    collect_meta_contents(
        document,
        &[
            "meta[name='author']",
            "meta[property='article:author']",
            "meta[name='parsely-author']",
        ],
    )
}

fn extract_top_image(document: &Html) -> Option<String> {
    first_meta_content(
        document,
        &[
            "meta[property='og:image']",
            "meta[name='twitter:image']",
        ],
    )
}

fn extract_images(document: &Html) -> Vec<String> {
    let Some(sel) = selector("img") else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut images = Vec::new();
    for img in document.select(&sel) {
        if let Some(src) = img.value().attr("src") {
            let cleaned = src.trim();
            if cleaned.is_empty() {
                continue;
            }
            if seen.insert(cleaned.to_string()) {
                images.push(cleaned.to_string());
            }
        }
    }
    images
}

fn extract_text_from_selectors(document: &Html, selectors: &[&str]) -> String {
    for selector_str in selectors {
        let Some(sel) = selector(selector_str) else {
            continue;
        };
        let mut chunks = Vec::new();
        for el in document.select(&sel) {
            let text = el.text().collect::<Vec<_>>().join(" ");
            let cleaned = clean_html(&text);
            if !cleaned.is_empty() {
                chunks.push(cleaned);
            }
        }
        if !chunks.is_empty() {
            return chunks.join("\n\n");
        }
    }
    String::new()
}

pub fn extract_article_from_html(html: &str) -> ArticleExtraction {
    let document = Html::parse_document(html);

    let text = extract_text_from_selectors(&document, &["article p", "main p", "body p"]);
    let title = extract_title(&document);
    let authors = extract_authors(&document);
    let publish_date = extract_publish_date(&document);
    let top_image = extract_top_image(&document);
    let images = extract_images(&document);
    let meta_description = extract_meta_description(&document);

    ArticleExtraction {
        text,
        title,
        authors,
        publish_date,
        top_image,
        images,
        meta_description,
    }
}

pub fn extract_og_image_from_html(html: &str) -> OgImageExtraction {
    let document = Html::parse_document(html);
    let mut candidates = Vec::new();

    let og_images = meta_contents(&document, "meta[property='og:image']");
    for url in og_images {
        candidates.push(ImageCandidate {
            url,
            source: "og:image".to_string(),
            priority: 1,
        });
    }

    let twitter_images = meta_contents(&document, "meta[name='twitter:image']");
    for url in twitter_images {
        candidates.push(ImageCandidate {
            url,
            source: "twitter:image".to_string(),
            priority: 2,
        });
    }

    if let Some(sel) = selector("link[rel='image_src']") {
        for link in document.select(&sel) {
            if let Some(href) = link.value().attr("href") {
                let cleaned = href.trim();
                if cleaned.is_empty() {
                    continue;
                }
                candidates.push(ImageCandidate {
                    url: cleaned.to_string(),
                    source: "link:image_src".to_string(),
                    priority: 3,
                });
            }
        }
    }

    let image_url = candidates.first().map(|candidate| candidate.url.clone());

    OgImageExtraction { image_url, candidates }
}
