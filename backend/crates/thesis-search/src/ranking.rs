use std::collections::{HashMap, HashSet};

use serde::Serialize;

const STOP_WORDS: &[&str] = &[
    "about", "after", "amid", "also", "and", "are", "been", "before", "from", "have", "into",
    "more", "news", "over", "said", "some", "than", "that", "their", "them", "there", "these",
    "they", "this", "through", "today", "were", "what", "when", "with", "would",
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

/// Article fields consumed by the pure personalized ranking algorithm.
#[derive(Debug, Clone)]
pub struct ArticleInput {
    /// Unique article identifier.
    pub id: i64,
    /// Headline used for keyword extraction.
    pub title: String,
    /// Summary text used for keyword extraction.
    pub summary: String,
    /// Editorial category used for profile matching.
    pub category: String,
    /// Display name of the publisher.
    pub source: String,
    /// Stable source identity, preferred over its display name.
    pub source_id: String,
    /// Article tags used as additional ranking terms.
    pub tags: Vec<String>,
    /// Image URL or image-state marker used for priority bucketing.
    pub image: String,
}

#[derive(Debug, Clone, Default)]
struct InterestProfile {
    keyword_weights: HashMap<String, f64>,
    category_weights: HashMap<String, f64>,
    source_weights: HashMap<String, f64>,
}

/// Represents the computed ranking score and metadata for a single article
/// after evaluation against a user interest profile.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RankedResult {
    /// Unique identifier of the ranked article.
    pub article_id: i64,
    /// Aggregate personalized score combining keyword, category, and source
    /// signals.
    pub total_score: f64,
    /// Priority bucket rank (higher is better), derived from favorite source
    /// and image presence.
    pub bucket_rank: i64,
    /// Human-readable label for the priority bucket.
    pub bucket_label: String,
    /// Contribution from keyword matches against the interest profile.
    pub keyword_score: f64,
    /// Contribution from category matching against the interest profile.
    pub category_score: f64,
    /// Contribution from source matching against the interest profile.
    pub source_score: f64,
    /// Keywords from the article that matched the user's interest profile,
    /// limited to the top 6.
    pub matched_keywords: Vec<String>,
    /// Categories from the article that matched the user's interest profile.
    pub matched_categories: Vec<String>,
    /// Source name that matched the user's interest profile, if any.
    pub matched_source: Option<String>,
}

fn normalize_token(value: &str) -> String {
    value.trim().to_lowercase()
}

fn cap_score(value: f64, maximum: f64) -> f64 {
    if value.is_nan() || value <= 0.0 {
        0.0
    } else if value >= maximum {
        maximum
    } else {
        value
    }
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

fn article_keywords(article: &ArticleInput) -> Vec<String> {
    let tags: Vec<&str> = article.tags.iter().map(|s| s.as_str()).collect();
    let mut inputs: Vec<&str> = vec![
        &article.title,
        &article.summary,
        &article.category,
        &article.source,
    ];
    inputs.extend(&tags);
    tokenize(&inputs)
}

fn source_key(article: &ArticleInput) -> String {
    normalize_token(if !article.source_id.is_empty() {
        &article.source_id
    } else {
        &article.source
    })
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
    !lower.contains("logo")
        && !lower.contains("punch")
        && !lower.contains("header")
        && !lower.contains("icon")
}

fn priority_bucket(favorite: bool, has_image: bool) -> (i64, &'static str) {
    match (favorite, has_image) {
        (true, true) => (3, "favorite source + image"),
        (true, false) => (2, "favorite source"),
        (false, true) => (1, "image"),
        (false, false) => (0, "default"),
    }
}

fn get_bucket(article: &ArticleInput, favorite_source_ids: &HashSet<String>) -> (i64, String) {
    let (rank, label) = priority_bucket(
        favorite_source_ids.contains(&article.source_id),
        has_real_image(&article.image),
    );
    (rank, label.to_string())
}

fn add_profile_weights(
    profile: &mut InterestProfile,
    category_key: &str,
    source_key: &str,
    keywords: &[String],
    category_weight: f64,
    source_weight: f64,
    keyword_weight: f64,
) {
    if !category_key.is_empty() {
        *profile
            .category_weights
            .entry(category_key.to_string())
            .or_insert(0.0) += category_weight;
    }
    if !source_key.is_empty() {
        *profile
            .source_weights
            .entry(source_key.to_string())
            .or_insert(0.0) += source_weight;
    }
    for keyword in keywords {
        *profile
            .keyword_weights
            .entry(keyword.clone())
            .or_insert(0.0) += keyword_weight;
    }
}

fn build_interest_profile(
    seeds: &[&ArticleInput],
    liked_ids: &HashSet<i64>,
    bookmarked_ids: &HashSet<i64>,
) -> InterestProfile {
    let mut profile = InterestProfile::default();

    for article in seeds {
        let category_key = normalize_token(&article.category);
        let source_key = source_key(article);
        let keywords = article_keywords(article);

        let member_weights = [
            (
                bookmarked_ids.contains(&article.id),
                PROFILE_CATEGORY_BOOKMARK_WEIGHT,
                PROFILE_SOURCE_BOOKMARK_WEIGHT,
                PROFILE_KEYWORD_BOOKMARK_WEIGHT,
            ),
            (
                liked_ids.contains(&article.id),
                PROFILE_CATEGORY_LIKE_WEIGHT,
                PROFILE_SOURCE_LIKE_WEIGHT,
                PROFILE_KEYWORD_LIKE_WEIGHT,
            ),
        ];
        for (is_member, category_weight, source_weight, keyword_weight) in member_weights {
            if !is_member {
                continue;
            }
            add_profile_weights(
                &mut profile,
                &category_key,
                &source_key,
                &keywords,
                category_weight,
                source_weight,
                keyword_weight,
            );
        }
    }

    profile
}

fn score_article(
    article: &ArticleInput,
    profile: &InterestProfile,
    favorite_source_ids: &HashSet<String>,
) -> RankedResult {
    let (bucket_rank, bucket_label) = get_bucket(article, favorite_source_ids);
    let tokens = article_keywords(article);
    let normalized_category = normalize_token(&article.category);
    let normalized_source = source_key(article);

    let matched_keywords: Vec<String> = tokens
        .iter()
        .filter(|t| profile.keyword_weights.get(*t).copied().unwrap_or(0.0) > 0.0)
        .cloned()
        .collect();

    let keyword_score = cap_score(
        matched_keywords
            .iter()
            .map(|t| profile.keyword_weights.get(t).copied().unwrap_or(0.0))
            .sum(),
        KEYWORD_SCORE_CAP,
    );

    let matched_categories: Vec<String> = if !normalized_category.is_empty()
        && profile
            .category_weights
            .get(&normalized_category)
            .copied()
            .unwrap_or(0.0)
            > 0.0
    {
        vec![normalized_category.clone()]
    } else {
        vec![]
    };

    let category_score = cap_score(
        profile
            .category_weights
            .get(&normalized_category)
            .copied()
            .unwrap_or(0.0),
        CATEGORY_SCORE_CAP,
    );

    let matched_source = if !normalized_source.is_empty()
        && profile
            .source_weights
            .get(&normalized_source)
            .copied()
            .unwrap_or(0.0)
            > 0.0
    {
        Some(normalized_source.clone())
    } else {
        None
    };

    let source_score = cap_score(
        profile
            .source_weights
            .get(&normalized_source)
            .copied()
            .unwrap_or(0.0),
        SOURCE_SCORE_CAP,
    );

    let personalized_score =
        (keyword_score + category_score + source_score * 100.0).round() / 100.0;

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

/// Scores articles against liked/bookmarked seeds and sorts by priority bucket,
/// then personalized score in descending order.
pub fn rank_articles(
    articles: &[ArticleInput],
    liked_ids: &HashSet<i64>,
    bookmarked_ids: &HashSet<i64>,
    favorite_source_ids: &HashSet<String>,
) -> Vec<RankedResult> {
    let seeds: Vec<&ArticleInput> = articles
        .iter()
        .filter(|article| liked_ids.contains(&article.id) || bookmarked_ids.contains(&article.id))
        .collect();
    let profile = if seeds.is_empty() {
        InterestProfile::default()
    } else {
        build_interest_profile(&seeds, liked_ids, bookmarked_ids)
    };

    let mut results: Vec<RankedResult> = articles
        .iter()
        .map(|article| score_article(article, &profile, favorite_source_ids))
        .collect();
    results.sort_by(|left, right| {
        right.bucket_rank.cmp(&left.bucket_rank).then_with(|| {
            right
                .total_score
                .partial_cmp(&left.total_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    results
}

#[cfg(test)]
mod tests {
    use super::{rank_articles, ArticleInput};
    use proptest::prelude::*;
    use std::collections::HashSet;

    fn article(id: i64, source_id: &str, image: &str) -> ArticleInput {
        ArticleInput {
            id,
            title: "climate policy".into(),
            summary: "latest climate policy details".into(),
            category: "world".into(),
            source: format!("Outlet {source_id}"),
            source_id: source_id.into(),
            tags: vec!["climate".into()],
            image: image.into(),
        }
    }

    #[test]
    fn buckets_sort_favorite_images_first() {
        let articles = vec![
            article(1, "favorite", "https://image.example/story.jpg"),
            article(2, "favorite", "none"),
            article(3, "other", "https://image.example/story.jpg"),
            article(4, "other", "none"),
        ];
        let favorites = HashSet::from(["favorite".to_string()]);
        let results = rank_articles(&articles, &HashSet::new(), &HashSet::new(), &favorites);

        assert_eq!(
            results
                .iter()
                .map(|result| result.bucket_rank)
                .collect::<Vec<_>>(),
            vec![3, 2, 1, 0]
        );
        assert_eq!(
            results
                .iter()
                .map(|result| result.article_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
    }

    #[test]
    fn tokenization_normalizes_deduplicates_and_filters_short_stop_words() {
        assert_eq!(
            super::tokenize(&[" Climate, climate POLICY and on 2026! "]),
            vec!["climate", "policy", "2026"]
        );
    }

    #[test]
    fn source_key_prefers_identity_and_falls_back_to_display_name() {
        let mut item = article(1, "wire", "none");
        assert_eq!(super::source_key(&item), "wire");

        item.source_id.clear();
        item.source = " Example Wire ".into();
        assert_eq!(super::source_key(&item), "example wire");
    }

    #[test]
    fn image_presence_rejects_placeholders_and_brand_art() {
        for image in [
            "",
            "  ",
            "none",
            "https://example.org/placeholder.jpg",
            "https://example.org/logo.jpg",
            "https://example.org/punch.jpg",
            "https://example.org/header.jpg",
            "https://example.org/icon.jpg",
            "https://example.org/graphic.svg",
        ] {
            assert!(!super::has_real_image(image), "{image:?}");
        }
        assert!(super::has_real_image("https://example.org/article.jpg"));
    }

    #[test]
    fn seeded_ranking_reports_expected_scores_and_matches() {
        let seed = ArticleInput {
            id: 1,
            title: "Climate policy report".into(),
            summary: "Climate policy latest".into(),
            category: "World".into(),
            source: "Example Wire".into(),
            source_id: "wire".into(),
            tags: vec!["climate".into()],
            image: "none".into(),
        };
        let candidate = ArticleInput {
            id: 2,
            image: "https://image.example/story.jpg".into(),
            ..seed.clone()
        };
        let results = rank_articles(
            &[seed, candidate],
            &HashSet::from([1]),
            &HashSet::new(),
            &HashSet::from(["wire".to_owned()]),
        );

        assert_eq!(results[0].article_id, 2);
        assert_eq!(results[0].bucket_rank, 3);
        assert_eq!(results[0].bucket_label, "favorite source + image");
        assert_eq!(results[0].keyword_score, 10.0);
        assert_eq!(results[0].category_score, 1.0);
        assert_eq!(results[0].source_score, 1.0);
        assert_eq!(results[0].total_score, 1.11);
        assert_eq!(
            results[0].matched_keywords,
            vec!["climate", "policy", "report", "latest", "world", "example"]
        );
        assert_eq!(results[0].matched_categories, vec!["world"]);
        assert_eq!(results[0].matched_source.as_deref(), Some("wire"));
    }

    #[test]
    fn no_seed_articles_have_no_personalized_matches() {
        let results = rank_articles(
            &[article(1, "wire", "https://image.example/story.jpg")],
            &HashSet::new(),
            &HashSet::new(),
            &HashSet::new(),
        );

        assert_eq!(results[0].total_score, 0.0);
        assert_eq!(results[0].keyword_score, 0.0);
        assert_eq!(results[0].category_score, 0.0);
        assert_eq!(results[0].source_score, 0.0);
        assert!(results[0].matched_keywords.is_empty());
        assert!(results[0].matched_categories.is_empty());
        assert_eq!(results[0].matched_source, None);
    }

    #[test]
    fn score_cap_handles_zero_maximum_and_nan_boundaries() {
        assert_eq!(super::cap_score(-1.0, 10.0), 0.0);
        assert_eq!(super::cap_score(0.0, 10.0), 0.0);
        assert_eq!(super::cap_score(10.0, 10.0), 10.0);
        assert_eq!(super::cap_score(11.0, 10.0), 10.0);
        assert_eq!(super::cap_score(1.0, 0.0), 0.0);
        assert_eq!(super::cap_score(f64::NAN, 10.0), 0.0);
    }

    proptest! {
        #[test]
        fn score_components_stay_within_caps_and_results_remain_sorted(
            records in prop::collection::vec(
                (
                    "[a-z]{4,10}",
                    "[a-z]{4,10}",
                    0u8..4,
                    any::<bool>(),
                    any::<bool>(),
                    any::<bool>(),
                    any::<bool>(),
                ),
                0..20,
            ),
        ) {
            let mut articles = Vec::with_capacity(records.len());
            let mut liked = HashSet::new();
            let mut bookmarked = HashSet::new();
            let mut favorites = HashSet::new();
            for (index, (topic, category, source_number, is_liked, is_bookmarked, is_favorite, has_image))
                in records.iter().enumerate()
            {
                let id = index as i64;
                let source_id = source_number.to_string();
                articles.push(ArticleInput {
                    id,
                    title: format!("{topic} headline"),
                    summary: format!("latest {topic} details"),
                    category: category.clone(),
                    source: format!("Outlet {source_id}"),
                    source_id: source_id.clone(),
                    tags: vec![format!("{topic}tag")],
                    image: if *has_image {
                        "https://image.example/story.jpg".into()
                    } else {
                        "none".into()
                    },
                });
                if *is_liked {
                    liked.insert(id);
                }
                if *is_bookmarked {
                    bookmarked.insert(id);
                }
                if *is_favorite {
                    favorites.insert(source_id);
                }
            }

            let results = rank_articles(&articles, &liked, &bookmarked, &favorites);
            prop_assert_eq!(results.len(), articles.len());
            for result in &results {
                prop_assert!(result.keyword_score.is_finite());
                prop_assert!((0.0..=10.0).contains(&result.keyword_score));
                prop_assert!((0.0..=4.0).contains(&result.category_score));
                prop_assert!((0.0..=2.0).contains(&result.source_score));
                prop_assert!((0.0..=2.14).contains(&result.total_score));
                prop_assert!((0..=3).contains(&result.bucket_rank));
                prop_assert!(result.matched_keywords.len() <= 6);
            }
            for pair in results.windows(2) {
                prop_assert!(
                    pair[0].bucket_rank > pair[1].bucket_rank
                        || (pair[0].bucket_rank == pair[1].bucket_rank
                            && pair[0].total_score >= pair[1].total_score)
                );
            }
        }
    }
}

#[cfg(kani)]
mod kani_proofs {
    #[kani::proof]
    fn score_caps_all_floating_point_inputs() {
        let input = kani::any::<f64>();
        let score = super::cap_score(input, 10.0);

        assert!(score.is_finite());
        assert!(score >= 0.0);
        assert!(score <= 10.0);
    }

    #[kani::proof]
    fn bucket_rank_encodes_favorite_and_image_signals() {
        let favorite = kani::any::<bool>();
        let has_image = kani::any::<bool>();
        let (rank, _) = super::priority_bucket(favorite, has_image);

        assert_eq!(rank & 2 != 0, favorite);
        assert_eq!(rank & 1 != 0, has_image);
        assert!(rank >= 0);
        assert!(rank <= 3);
    }
}
