//! Text similarity and sentence-level comparison.

use std::collections::HashSet;

use serde::Serialize;

const MAX_SIMILAR_SENTENCES: usize = 10;
const SENTENCE_MATCH_THRESHOLD: f64 = 0.6;
const SENTENCE_WORD_OVERLAP_THRESHOLD: f64 = 0.5;

/// One sentence present in only one article.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SentenceOnly {
    /// Zero-based sentence position in its source article.
    pub index: usize,
    /// The sentence text.
    pub text: String,
    /// Existing API marker describing the unique source.
    #[serde(rename = "type")]
    pub kind: &'static str,
}

/// A pair of sentences judged similar by the comparison heuristic.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SentenceMatch {
    /// Zero-based sentence position in the first article.
    pub source_1_index: usize,
    /// Zero-based sentence position in the second article.
    pub source_2_index: usize,
    /// Matched sentence from the first article.
    pub source_1_text: String,
    /// Matched sentence from the second article.
    pub source_2_text: String,
    /// Normalized similarity for this sentence pair.
    pub similarity: f64,
}

/// Added, removed, and similar sentence groups.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SentenceDiff {
    /// Sentences unique to the second article.
    pub added: Vec<SentenceOnly>,
    /// Sentences unique to the first article.
    pub removed: Vec<SentenceOnly>,
    /// Similar sentence pairs, highest similarity first.
    pub similar: Vec<SentenceMatch>,
}

/// Calculate normalized Levenshtein similarity for the supplied text.
pub fn calculate_text_similarity(text_1: &str, text_2: &str) -> f64 {
    if text_1 == text_2 {
        return 1.0;
    }
    if text_1.trim().is_empty() || text_2.trim().is_empty() {
        return 0.0;
    }

    let left = normalize_similarity_input(text_1);
    let right = normalize_similarity_input(text_2);
    if left == right {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    strsim::normalized_levenshtein(&left, &right)
}

/// Generate the sentence-level diff between two article bodies.
pub fn generate_sentence_diff(text_1: &str, text_2: &str) -> SentenceDiff {
    let sentences_1 = sentence_split(text_1);
    let sentences_2 = sentence_split(text_2);
    let mut removed = Vec::new();
    let mut similar = Vec::new();

    for (index_1, sentence_1) in sentences_1.iter().enumerate() {
        if let Some((index_2, sentence_2, score)) = best_sentence_match(sentence_1, &sentences_2) {
            similar.push(SentenceMatch {
                source_1_index: index_1,
                source_2_index: index_2,
                source_1_text: sentence_1.clone(),
                source_2_text: sentence_2.clone(),
                similarity: score,
            });
        } else {
            removed.push(SentenceOnly {
                index: index_1,
                text: sentence_1.clone(),
                kind: "unique_to_source_1",
            });
        }
    }

    let matched_indices: HashSet<usize> = similar.iter().map(|item| item.source_2_index).collect();
    let added = sentences_2
        .into_iter()
        .enumerate()
        .filter(|(index, _)| !matched_indices.contains(index))
        .map(|(index, text)| SentenceOnly {
            index,
            text,
            kind: "unique_to_source_2",
        })
        .collect();

    similar.sort_by(|left, right| {
        right
            .similarity
            .total_cmp(&left.similarity)
            .then(left.source_1_index.cmp(&right.source_1_index))
            .then(left.source_2_index.cmp(&right.source_2_index))
    });
    similar.truncate(MAX_SIMILAR_SENTENCES);
    SentenceDiff {
        added,
        removed,
        similar,
    }
}

fn normalize_similarity_input(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn sentence_split(text: &str) -> Vec<String> {
    text.split_inclusive(['.', '!', '?'])
        .map(str::trim)
        .filter(|chunk| !chunk.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn word_set(text: &str) -> HashSet<String> {
    text.split_whitespace()
        .map(|token| {
            token
                .trim_matches(|character: char| !character.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

pub(super) fn sentence_word_overlap(text_1: &str, text_2: &str) -> f64 {
    let left = word_set(text_1);
    let right = word_set(text_2);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    left.intersection(&right).count() as f64 / left.len().max(right.len()) as f64
}

pub(super) fn best_sentence_match(
    sentence_1: &str,
    sentences_2: &[String],
) -> Option<(usize, String, f64)> {
    let mut best: Option<(usize, String, f64)> = None;
    for (index, sentence_2) in sentences_2.iter().enumerate() {
        if sentence_word_overlap(sentence_1, sentence_2) < SENTENCE_WORD_OVERLAP_THRESHOLD {
            continue;
        }
        let score = calculate_text_similarity(sentence_1, sentence_2);
        if score > SENTENCE_MATCH_THRESHOLD
            && best
                .as_ref()
                .is_none_or(|(_, _, best_score)| score > *best_score)
        {
            best = Some((index, sentence_2.clone(), score));
        }
    }
    best
}
