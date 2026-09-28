//! Deterministic article-to-article comparison used by the comparison API.

mod entities;
mod text;

#[cfg(test)]
#[path = "article_comparison/tests.rs"]
mod tests;

#[cfg(kani)]
#[path = "article_comparison/kani.rs"]
mod kani_proofs;

pub use entities::{ArticleEntities, EntityRelations};
pub use text::{
    calculate_text_similarity, generate_sentence_diff, SentenceDiff, SentenceMatch, SentenceOnly,
};

use std::cmp::Ordering;
use std::collections::HashMap;

use serde::Serialize;

use crate::comparison_keywords;

use entities::{compare_entities, entity_count, extract_entities};

const MAX_COMMON_KEYWORDS: usize = 15;
const MAX_UNIQUE_KEYWORDS: usize = 15;

/// Similarity scores rounded to the public API's precision.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SimilarityComparison {
    /// Normalized content similarity, rounded to two decimal places.
    pub content_similarity: f64,
    /// Normalized title similarity, rounded to two decimal places.
    pub title_similarity: f64,
    /// Content match percentage, rounded to one decimal place.
    pub overall_match_percent: f64,
}

/// One keyword shared by both article keyword lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommonKeyword {
    /// The shared keyword.
    pub keyword: String,
    /// Keyword count in the first article.
    pub source_1_freq: usize,
    /// Keyword count in the second article.
    pub source_2_freq: usize,
    /// Signed first-minus-second frequency difference.
    pub difference: i128,
    /// Which article gives the keyword greater emphasis.
    pub emphasis: KeywordEmphasis,
}

/// Which article contains a higher frequency of a common keyword.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum KeywordEmphasis {
    /// The first article has more occurrences.
    #[serde(rename = "source_1")]
    Source1,
    /// The second article has more occurrences.
    #[serde(rename = "source_2")]
    Source2,
    /// Both articles have the same number of occurrences.
    #[serde(rename = "equal")]
    Equal,
}

/// A keyword present in only one article's top-keyword list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UniqueKeyword {
    /// The keyword.
    pub keyword: String,
    /// The keyword frequency in its article.
    pub frequency: usize,
}

/// Comparison of the two articles' top keyword lists.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct KeywordComparison {
    /// Shared keywords ordered by absolute frequency difference, then keyword.
    pub common_keywords: Vec<CommonKeyword>,
    /// Keywords found only in the first article, ordered by frequency then keyword.
    pub unique_to_source_1: Vec<UniqueKeyword>,
    /// Keywords found only in the second article, ordered by frequency then keyword.
    pub unique_to_source_2: Vec<UniqueKeyword>,
}

/// Entity data and cross-article entity relationships.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct EntityComparison {
    /// Extracted entities for the first article.
    pub source_1: ArticleEntities,
    /// Extracted entities for the second article.
    pub source_2: ArticleEntities,
    /// Common and unique entities.
    pub comparison: EntityRelations,
}

/// The keyword data returned by article comparison.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct KeywordComparisonResponse {
    /// Top frequency-ranked keywords for the first article.
    pub source_1_top: Vec<TopKeyword>,
    /// Top frequency-ranked keywords for the second article.
    pub source_2_top: Vec<TopKeyword>,
    /// Common and unique keyword frequencies.
    pub comparison: KeywordComparison,
}

/// One top keyword and its frequency.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TopKeyword {
    /// The keyword text.
    pub word: String,
    /// Number of occurrences in the article.
    pub count: usize,
}

/// Aggregate list counts returned alongside detailed comparison data.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ArticleComparisonSummary {
    /// Number of entities present in both articles.
    pub common_entities_count: usize,
    /// Number of entities unique to the first article.
    pub unique_entities_source_1: usize,
    /// Number of entities unique to the second article.
    pub unique_entities_source_2: usize,
    /// Number of shared keywords returned by the capped comparison.
    pub common_keywords_count: usize,
    /// Number of unique keywords returned for the first article.
    pub unique_keywords_source_1: usize,
    /// Number of unique keywords returned for the second article.
    pub unique_keywords_source_2: usize,
}

/// Complete deterministic comparison response.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ArticleComparisonResponse {
    /// Content and title similarity scores.
    pub similarity: SimilarityComparison,
    /// Extracted and compared named entities.
    pub entities: EntityComparison,
    /// Extracted and compared keywords.
    pub keywords: KeywordComparisonResponse,
    /// Sentence-level changes between article bodies.
    pub diff: SentenceDiff,
    /// Counts of the entities and keywords in the response.
    pub summary: ArticleComparisonSummary,
}

/// Compare two article bodies and their titles.
///
/// Entity arrays preserve first occurrence order, resolving the source Python
/// set iteration's nondeterministic output. Equal-priority keyword results use
/// lexical order, giving the API a stable order across processes.
pub fn compare_articles(
    content_1: &str,
    content_2: &str,
    title_1: &str,
    title_2: &str,
) -> ArticleComparisonResponse {
    let entities_1 = extract_entities(content_1);
    let entities_2 = extract_entities(content_2);
    let keywords_1 = comparison_keywords::extract_keywords(content_1, 20, true);
    let keywords_2 = comparison_keywords::extract_keywords(content_2, 20, true);
    let relations = compare_entities(&entities_1, &entities_2);
    let keyword_comparison = compare_keywords(&keywords_1, &keywords_2);
    let common_keyword_count = keyword_comparison.common_keywords.len();
    let unique_keyword_count_1 = keyword_comparison.unique_to_source_1.len();
    let unique_keyword_count_2 = keyword_comparison.unique_to_source_2.len();

    let content_similarity = if content_1.is_empty() || content_2.is_empty() {
        0.0
    } else {
        calculate_text_similarity(content_1, content_2)
    };
    let title_similarity = if title_1.is_empty() || title_2.is_empty() {
        0.0
    } else {
        calculate_text_similarity(title_1, title_2)
    };

    let common_entity_count = entity_count(&relations.common_entities);
    let unique_entity_count_1 = entity_count(&relations.unique_to_source_1);
    let unique_entity_count_2 = entity_count(&relations.unique_to_source_2);
    let diff = generate_sentence_diff(content_1, content_2);

    ArticleComparisonResponse {
        similarity: SimilarityComparison {
            content_similarity: round_decimal(content_similarity, 2),
            title_similarity: round_decimal(title_similarity, 2),
            overall_match_percent: round_decimal(content_similarity * 100.0, 1),
        },
        entities: EntityComparison {
            source_1: entities_1,
            source_2: entities_2,
            comparison: relations,
        },
        keywords: KeywordComparisonResponse {
            source_1_top: top_keywords(&keywords_1),
            source_2_top: top_keywords(&keywords_2),
            comparison: keyword_comparison,
        },
        diff,
        summary: ArticleComparisonSummary {
            common_entities_count: common_entity_count,
            unique_entities_source_1: unique_entity_count_1,
            unique_entities_source_2: unique_entity_count_2,
            common_keywords_count: common_keyword_count,
            unique_keywords_source_1: unique_keyword_count_1,
            unique_keywords_source_2: unique_keyword_count_2,
        },
    }
}

/// Calculate the normalized Levenshtein similarity shared by the Python adapter and service.
fn compare_keywords(left: &[(String, usize)], right: &[(String, usize)]) -> KeywordComparison {
    let left_map: HashMap<&str, usize> = left
        .iter()
        .map(|(word, count)| (word.as_str(), *count))
        .collect();
    let right_map: HashMap<&str, usize> = right
        .iter()
        .map(|(word, count)| (word.as_str(), *count))
        .collect();

    let mut common_keywords = left_map
        .iter()
        .filter_map(|(word, count_1)| {
            let count_2 = right_map.get(word)?;
            let difference = *count_1 as i128 - *count_2 as i128;
            Some(CommonKeyword {
                keyword: (*word).to_owned(),
                source_1_freq: *count_1,
                source_2_freq: *count_2,
                difference,
                emphasis: keyword_emphasis(*count_1, *count_2),
            })
        })
        .collect::<Vec<_>>();
    common_keywords.sort_by(|a, b| {
        b.difference
            .unsigned_abs()
            .cmp(&a.difference.unsigned_abs())
            .then_with(|| a.keyword.cmp(&b.keyword))
    });
    common_keywords.truncate(MAX_COMMON_KEYWORDS);

    let mut unique_to_source_1 = left
        .iter()
        .filter(|(word, _)| !right_map.contains_key(word.as_str()))
        .map(|(keyword, frequency)| UniqueKeyword {
            keyword: keyword.clone(),
            frequency: *frequency,
        })
        .collect::<Vec<_>>();
    unique_to_source_1.sort_by(unique_keyword_order);
    unique_to_source_1.truncate(MAX_UNIQUE_KEYWORDS);

    let mut unique_to_source_2 = right
        .iter()
        .filter(|(word, _)| !left_map.contains_key(word.as_str()))
        .map(|(keyword, frequency)| UniqueKeyword {
            keyword: keyword.clone(),
            frequency: *frequency,
        })
        .collect::<Vec<_>>();
    unique_to_source_2.sort_by(unique_keyword_order);
    unique_to_source_2.truncate(MAX_UNIQUE_KEYWORDS);

    KeywordComparison {
        common_keywords,
        unique_to_source_1,
        unique_to_source_2,
    }
}

fn unique_keyword_order(left: &UniqueKeyword, right: &UniqueKeyword) -> Ordering {
    right
        .frequency
        .cmp(&left.frequency)
        .then_with(|| left.keyword.cmp(&right.keyword))
}

fn keyword_emphasis(source_1: usize, source_2: usize) -> KeywordEmphasis {
    match source_1.cmp(&source_2) {
        Ordering::Greater => KeywordEmphasis::Source1,
        Ordering::Less => KeywordEmphasis::Source2,
        Ordering::Equal => KeywordEmphasis::Equal,
    }
}

fn top_keywords(keywords: &[(String, usize)]) -> Vec<TopKeyword> {
    keywords
        .iter()
        .take(10)
        .map(|(word, count)| TopKeyword {
            word: word.clone(),
            count: *count,
        })
        .collect()
}

fn round_decimal(value: f64, precision: usize) -> f64 {
    format!("{value:.precision$}")
        .parse()
        .expect("formatted finite similarity is a number")
}
