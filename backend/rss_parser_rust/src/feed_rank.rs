use std::collections::{HashMap, HashSet};

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use serde::Serialize;

const STOP_WORDS: &[&str] = &[
    "about", "after", "amid", "also", "and", "are", "been", "before", "from", "have",
    "into", "more", "news", "over", "said", "some", "than", "that", "their", "them",
    "there", "these", "they", "this", "through", "today", "were", "what", "when", "with", "would",
];

const KEYWORD_SCORE_CAP: f64 = 10.0;
const CATEGORY_SCORE_CAP: f64 = 4.0;
const SOURCE_SCORE_CAP: f64 = 2.0;

const PROFILE_CATEGORY_BOOKMARK_WEIGHT: f64 = 2.0;
const PROFILE_CATEGORY_LIKE_WEIGHT: f64 = 1.0;
const PROFILE_SOURCE_BOOKMARK_WEIGHT: f64 = 2.0;
const PROFILE_SOURCE_LIKE_WEIGHT: f64 = 1.0;
const PROFILE_KEYWORD_BOOKMARK_WEIGHT: f64 = 3.0;
const PROFILE_KEYWORD_LIKE_WEIGHT: f64 = 1.5;

#[derive(Debug, Clone)]
struct ArticleMeta {
    id: i64,
    title: String,
    summary: String,
    category: String,
    source: String,
    source_id: String,
    tags: Vec<String>,
    image: String,
}

#[derive(Debug, Clone, Default)]
struct InterestProfile {
    keyword_weights: HashMap<String, f64>,
    category_weights: HashMap<String, f64>,
    source_weights: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RankedResult {
    pub article_id: i64,
    pub total_score: f64,
    pub bucket_rank: i64,
    pub bucket_label: String,
    pub keyword_score: f64,
    pub category_score: f64,
    pub source_score: f64,
    pub matched_keywords: Vec<String>,
    pub matched_categories: Vec<String>,
    pub matched_source: Option<String>,
}

fn normalize_token(value: &str) -> String {
    value.trim().to_lowercase()
}

fn stop_words_set() -> HashSet<&'static str> {
    STOP_WORDS.iter().copied().collect()
}

fn tokenize(texts: &[&str]) -> Vec<String> {
    let stops = stop_words_set();
    let combined = texts.join(" ");
    let lower = combined.to_lowercase();
    let cleaned = lower.replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), " ");
    let mut seen = HashSet::new();

    cleaned
        .split_whitespace()
        .map(normalize_token)
        .filter(|t| t.len() > 2 && !stops.contains(t.as_str()))
        .filter(|t| seen.insert(t.clone()))
        .collect()
}

fn has_real_image(image: &str) -> bool {
    if image.is_empty() {
        return false;
    }
    let trimmed = image.trim();
    if trimmed.is_empty() || trimmed == "none" {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if lower.contains("placeholder") || lower.ends_with(".svg") {
        return false;
    }
    !lower.contains("logo") && !lower.contains("punch") && !lower.contains("header") && !lower.contains("icon")
}

fn get_bucket(article: &ArticleMeta, favorite_source_ids: &HashSet<String>) -> (i64, String) {
    let favorite = favorite_source_ids.contains(&article.source_id);
    let has_image = has_real_image(&article.image);

    if favorite && has_image {
        (3, "favorite source + image".to_string())
    } else if favorite {
        (2, "favorite source".to_string())
    } else if has_image {
        (1, "image".to_string())
    } else {
        (0, "default".to_string())
    }
}

fn build_interest_profile(
    seeds: &[&ArticleMeta],
    liked_ids: &HashSet<i64>,
    bookmarked_ids: &HashSet<i64>,
) -> InterestProfile {
    let mut profile = InterestProfile::default();

    for article in seeds {
        let category_key = normalize_token(&article.category);
        let source_key = normalize_token(if !article.source_id.is_empty() {
            &article.source_id
        } else {
            &article.source
        });
        let tags_strs: Vec<&str> = article.tags.iter().map(|s| s.as_str()).collect();
        let mut token_inputs: Vec<&str> = vec![
            &article.title,
            &article.summary,
            &article.category,
            &article.source,
        ];
        token_inputs.extend(&tags_strs);
        let keywords = tokenize(&token_inputs);

        if bookmarked_ids.contains(&article.id) {
            if !category_key.is_empty() {
                *profile.category_weights.entry(category_key.clone()).or_insert(0.0) +=
                    PROFILE_CATEGORY_BOOKMARK_WEIGHT;
            }
            if !source_key.is_empty() {
                *profile.source_weights.entry(source_key.clone()).or_insert(0.0) +=
                    PROFILE_SOURCE_BOOKMARK_WEIGHT;
            }
            for kw in &keywords {
                *profile.keyword_weights.entry(kw.clone()).or_insert(0.0) +=
                    PROFILE_KEYWORD_BOOKMARK_WEIGHT;
            }
        }

        if liked_ids.contains(&article.id) {
            if !category_key.is_empty() {
                *profile.category_weights.entry(category_key.clone()).or_insert(0.0) +=
                    PROFILE_CATEGORY_LIKE_WEIGHT;
            }
            if !source_key.is_empty() {
                *profile.source_weights.entry(source_key.clone()).or_insert(0.0) +=
                    PROFILE_SOURCE_LIKE_WEIGHT;
            }
            for kw in &keywords {
                *profile.keyword_weights.entry(kw.clone()).or_insert(0.0) +=
                    PROFILE_KEYWORD_LIKE_WEIGHT;
            }
        }
    }

    profile
}

fn score_article(
    article: &ArticleMeta,
    profile: &InterestProfile,
    favorite_source_ids: &HashSet<String>,
) -> RankedResult {
    let (bucket_rank, bucket_label) = get_bucket(article, favorite_source_ids);
    let tags_strs: Vec<&str> = article.tags.iter().map(|s| s.as_str()).collect();
    let mut token_inputs: Vec<&str> = vec![
        &article.title,
        &article.summary,
        &article.category,
        &article.source,
    ];
    token_inputs.extend(&tags_strs);
    let tokens = tokenize(&token_inputs);
    let normalized_category = normalize_token(&article.category);
    let normalized_source = normalize_token(if !article.source_id.is_empty() {
        &article.source_id
    } else {
        &article.source
    });

    let matched_keywords: Vec<String> = tokens
        .iter()
        .filter(|t| profile.keyword_weights.get(*t).copied().unwrap_or(0.0) > 0.0)
        .cloned()
        .collect();

    let keyword_score = matched_keywords
        .iter()
        .map(|t| profile.keyword_weights.get(t).copied().unwrap_or(0.0))
        .sum::<f64>()
        .min(KEYWORD_SCORE_CAP);

    let matched_categories: Vec<String> = if !normalized_category.is_empty()
        && profile.category_weights.get(&normalized_category).copied().unwrap_or(0.0) > 0.0
    {
        vec![normalized_category.clone()]
    } else {
        vec![]
    };

    let category_score = profile
        .category_weights
        .get(&normalized_category)
        .copied()
        .unwrap_or(0.0)
        .min(CATEGORY_SCORE_CAP);

    let matched_source = if !normalized_source.is_empty()
        && profile.source_weights.get(&normalized_source).copied().unwrap_or(0.0) > 0.0
    {
        Some(normalized_source.clone())
    } else {
        None
    };

    let source_score = profile
        .source_weights
        .get(&normalized_source)
        .copied()
        .unwrap_or(0.0)
        .min(SOURCE_SCORE_CAP);

    let personalized_score = (keyword_score + category_score + source_score * 100.0).round() / 100.0;

    RankedResult {
        article_id: article.id,
        total_score: personalized_score,
        bucket_rank,
        bucket_label,
        keyword_score: (keyword_score * 100.0).round() / 100.0,
        category_score: (category_score * 100.0).round() / 100.0,
        source_score: (source_score * 100.0).round() / 100.0,
        matched_keywords: matched_keywords.into_iter().take(6).collect(),
        matched_categories,
        matched_source,
    }
}

fn extract_article_meta_from_dict(dict: &Bound<PyDict>) -> Option<ArticleMeta> {
    let id: i64 = dict.get_item("id").ok()?.and_then(|v| v.extract().ok())?;
    let title: String = dict
        .get_item("title")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();
    let summary: String = dict
        .get_item("summary")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();
    let category: String = dict
        .get_item("category")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();
    let source: String = dict
        .get_item("source")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();
    let source_id: String = dict
        .get_item("source_id")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();
    let tags: Vec<String> = dict
        .get_item("tags")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();
    let image: String = dict
        .get_item("image")
        .ok()?
        .and_then(|v| v.extract().ok())
        .unwrap_or_default();

    Some(ArticleMeta {
        id,
        title,
        summary,
        category,
        source,
        source_id,
        tags,
        image,
    })
}

#[pyfunction]
pub fn rank_articles<'py>(
    py: Python<'py>,
    articles: Bound<'py, PyList>,
    liked_article_ids: Vec<i64>,
    bookmarked_article_ids: Vec<i64>,
    favorite_source_ids: Vec<String>,
) -> PyResult<Bound<'py, PyList>> {
    let liked_set: HashSet<i64> = liked_article_ids.into_iter().collect();
    let bookmarked_set: HashSet<i64> = bookmarked_article_ids.into_iter().collect();
    let favorite_set: HashSet<String> = favorite_source_ids.into_iter().collect();

    let mut metas: Vec<ArticleMeta> = Vec::new();
    for item in articles.iter() {
        let dict = item.downcast::<PyDict>()?;
        if let Some(meta) = extract_article_meta_from_dict(&dict) {
            metas.push(meta);
        }
    }

    let seeds: Vec<&ArticleMeta> = metas
        .iter()
        .filter(|a| liked_set.contains(&a.id) || bookmarked_set.contains(&a.id))
        .collect();

    let profile = if seeds.is_empty() {
        InterestProfile::default()
    } else {
        build_interest_profile(&seeds, &liked_set, &bookmarked_set)
    };

    let mut results: Vec<RankedResult> = metas
        .iter()
        .map(|a| score_article(a, &profile, &favorite_set))
        .collect();

    results.sort_by(|a, b| {
        b.bucket_rank
            .cmp(&a.bucket_rank)
            .then_with(|| {
                b.total_score
                    .partial_cmp(&a.total_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let list = PyList::empty_bound(py);
    for r in &results {
        let d = PyDict::new_bound(py);
        d.set_item("article_id", r.article_id)?;
        d.set_item("total_score", r.total_score)?;
        d.set_item("bucket_rank", r.bucket_rank)?;
        d.set_item("bucket_label", &r.bucket_label)?;
        d.set_item("keyword_score", r.keyword_score)?;
        d.set_item("category_score", r.category_score)?;
        d.set_item("source_score", r.source_score)?;
        d.set_item("matched_keywords", &r.matched_keywords)?;
        d.set_item("matched_categories", &r.matched_categories)?;
        d.set_item("matched_source", &r.matched_source)?;
        list.append(d)?;
    }

    Ok(list)
}
