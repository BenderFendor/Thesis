use std::collections::{HashMap, HashSet};

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use rayon::prelude::*;
use serde::Serialize;
use strsim::normalized_levenshtein;

const DEFAULT_NUM_HASHES: usize = 128;
const DEFAULT_CHAR_NGRAM: usize = 5;
const DEFAULT_SEED: u64 = 42;
const EMPTY_SIGNATURE_VALUE: u128 = u128::MAX;
const SENTENCE_MATCH_THRESHOLD: f64 = 0.6;
const SENTENCE_WORD_OVERLAP_THRESHOLD: f64 = 0.5;
const MAX_SIMILAR_SENTENCES: usize = 10;

#[derive(Debug, Clone, Serialize)]
pub struct DuplicatePair {
    pub doc_id_1: String,
    pub doc_id_2: String,
    pub similarity: f64,
}

#[derive(Debug, Clone)]
struct DocumentInput {
    doc_id: String,
    text: String,
}

#[derive(Debug, Clone)]
struct DocSignature {
    doc_id: String,
    signature: Vec<u128>,
}

#[derive(Debug, Clone)]
struct SentenceMatch {
    source_1_index: usize,
    source_2_index: usize,
    source_1_text: String,
    source_2_text: String,
    similarity: f64,
}

#[derive(Debug, Clone)]
struct SentenceOnly {
    index: usize,
    text: String,
    kind: &'static str,
}

pub fn shingle_text(text: &str, n: usize) -> HashSet<String> {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return HashSet::new();
    }
    if normalized.chars().count() < n {
        return HashSet::from([normalized]);
    }

    let chars: Vec<char> = normalized.chars().collect();
    chars
        .windows(n)
        .map(|window| window.iter().collect::<String>())
        .collect()
}

fn hash_params(num_hashes: usize, seed: u64) -> Vec<(u64, u64)> {
    (0..num_hashes)
        .map(|idx| {
            let hash_seed = seed + idx as u64;
            let a = hash_seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let b = hash_seed
                .wrapping_mul(3_410_719_502)
                .wrapping_add(3_141_592_653);
            (a, b)
        })
        .collect()
}

pub fn compute_minhash_signature(text: &str, num_hashes: usize, seed: u64) -> Vec<u128> {
    let shingles = shingle_text(text, DEFAULT_CHAR_NGRAM);
    if shingles.is_empty() {
        return vec![EMPTY_SIGNATURE_VALUE; num_hashes];
    }

    let params = hash_params(num_hashes, seed);
    params
        .into_par_iter()
        .map(|(a, b)| {
            shingles
                .iter()
                .map(|shingle| {
                    let digest = md5::compute(format!("{shingle}:{a}:{b}"));
                    let bytes = digest.0;
                    u128::from_be_bytes(bytes)
                })
                .min()
                .unwrap_or(EMPTY_SIGNATURE_VALUE)
        })
        .collect()
}

pub fn estimate_jaccard_similarity(sig1: &[u128], sig2: &[u128]) -> f64 {
    if sig1.is_empty() || sig2.is_empty() || sig1.len() != sig2.len() {
        return 0.0;
    }

    let matches = sig1
        .iter()
        .zip(sig2.iter())
        .filter(|(left, right)| left == right)
        .count();
    matches as f64 / sig1.len() as f64
}

fn build_signatures(documents: Vec<DocumentInput>, num_hashes: usize) -> Vec<DocSignature> {
    documents
        .into_par_iter()
        .map(|doc| DocSignature {
            doc_id: doc.doc_id,
            signature: compute_minhash_signature(&doc.text, num_hashes, DEFAULT_SEED),
        })
        .collect()
}

fn find_duplicate_pairs(docs: &[DocSignature], threshold: f64) -> Vec<DuplicatePair> {
    let mut pairs = Vec::new();
    for i in 0..docs.len() {
        for j in (i + 1)..docs.len() {
            let similarity = estimate_jaccard_similarity(&docs[i].signature, &docs[j].signature);
            if similarity >= threshold {
                pairs.push(DuplicatePair {
                    doc_id_1: docs[i].doc_id.clone(),
                    doc_id_2: docs[j].doc_id.clone(),
                    similarity,
                });
            }
        }
    }
    pairs.sort_by(|left, right| right.similarity.total_cmp(&left.similarity));
    pairs
}

fn sentence_split(text: &str) -> Vec<String> {
    text.split_inclusive(['.', '!', '?'])
        .map(str::trim)
        .filter(|chunk| !chunk.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize_similarity_input(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn sentence_word_overlap(text1: &str, text2: &str) -> f64 {
    let left = text1
        .split_whitespace()
        .map(|token| {
            token
                .trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect::<HashSet<_>>();
    let right = text2
        .split_whitespace()
        .map(|token| {
            token
                .trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect::<HashSet<_>>();

    if left.is_empty() || right.is_empty() {
        return 0.0;
    }

    let intersection = left.intersection(&right).count() as f64;
    intersection / left.len().max(right.len()) as f64
}

pub fn calculate_text_similarity(text1: &str, text2: &str) -> f64 {
    if text1.trim().is_empty() || text2.trim().is_empty() {
        return 0.0;
    }

    let left = normalize_similarity_input(text1);
    let right = normalize_similarity_input(text2);
    normalized_levenshtein(&left, &right)
}

fn generate_sentence_diff(
    text1: &str,
    text2: &str,
) -> (Vec<SentenceOnly>, Vec<SentenceOnly>, Vec<SentenceMatch>) {
    let sentences1 = sentence_split(text1);
    let sentences2 = sentence_split(text2);

    let mut removed = Vec::new();
    let mut similar = Vec::new();

    for (i, sentence1) in sentences1.iter().enumerate() {
        let mut best_match: Option<(usize, &String, f64)> = None;
        for (j, sentence2) in sentences2.iter().enumerate() {
            let ratio = calculate_text_similarity(sentence1, sentence2);
            let overlap = sentence_word_overlap(sentence1, sentence2);
            if ratio > SENTENCE_MATCH_THRESHOLD && overlap >= SENTENCE_WORD_OVERLAP_THRESHOLD {
                match best_match {
                    Some((_, _, best_ratio)) if ratio <= best_ratio => {}
                    _ => best_match = Some((j, sentence2, ratio)),
                }
            }
        }

        if let Some((matched_index, matched_sentence, ratio)) = best_match {
            similar.push(SentenceMatch {
                source_1_index: i,
                source_2_index: matched_index,
                source_1_text: sentence1.clone(),
                source_2_text: matched_sentence.clone(),
                similarity: ratio,
            });
        } else {
            removed.push(SentenceOnly {
                index: i,
                text: sentence1.clone(),
                kind: "unique_to_source_1",
            });
        }
    }

    let matched_indices: HashSet<usize> = similar.iter().map(|item| item.source_2_index).collect();
    let added = sentences2
        .into_iter()
        .enumerate()
        .filter(|(index, _)| !matched_indices.contains(index))
        .map(|(index, text)| SentenceOnly {
            index,
            text,
            kind: "unique_to_source_2",
        })
        .collect::<Vec<_>>();

    similar.sort_by(|left, right| right.similarity.total_cmp(&left.similarity));
    if similar.len() > MAX_SIMILAR_SENTENCES {
        similar.truncate(MAX_SIMILAR_SENTENCES);
    }

    (added, removed, similar)
}

#[pyfunction]
pub fn minhash_duplicate_pairs<'py>(
    py: Python<'py>,
    documents: Vec<(String, String)>,
    threshold: Option<f64>,
    num_hashes: Option<usize>,
) -> PyResult<Bound<'py, PyList>> {
    let threshold = threshold.unwrap_or(0.85);
    let num_hashes = num_hashes.unwrap_or(DEFAULT_NUM_HASHES).max(1);
    let doc_inputs = documents
        .into_iter()
        .filter(|(doc_id, text)| !doc_id.trim().is_empty() && !text.trim().is_empty())
        .map(|(doc_id, text)| DocumentInput { doc_id, text })
        .collect::<Vec<_>>();
    let signatures = build_signatures(doc_inputs, num_hashes);
    let duplicates = find_duplicate_pairs(&signatures, threshold);

    let result = PyList::empty_bound(py);
    for item in duplicates {
        let pair = PyDict::new_bound(py);
        pair.set_item("doc_id_1", item.doc_id_1)?;
        pair.set_item("doc_id_2", item.doc_id_2)?;
        pair.set_item("similarity", item.similarity)?;
        result.append(pair)?;
    }
    Ok(result)
}

#[pyfunction]
pub fn text_similarity(text1: &str, text2: &str) -> f64 {
    calculate_text_similarity(text1, text2)
}

#[pyfunction]
pub fn sentence_diff<'py>(
    py: Python<'py>,
    text1: &str,
    text2: &str,
) -> PyResult<Bound<'py, PyDict>> {
    let (added, removed, similar) = generate_sentence_diff(text1, text2);
    let result = PyDict::new_bound(py);

    let added_list = PyList::empty_bound(py);
    for item in added {
        let entry = PyDict::new_bound(py);
        entry.set_item("index", item.index)?;
        entry.set_item("text", item.text)?;
        entry.set_item("type", item.kind)?;
        added_list.append(entry)?;
    }

    let removed_list = PyList::empty_bound(py);
    for item in removed {
        let entry = PyDict::new_bound(py);
        entry.set_item("index", item.index)?;
        entry.set_item("text", item.text)?;
        entry.set_item("type", item.kind)?;
        removed_list.append(entry)?;
    }

    let similar_list = PyList::empty_bound(py);
    for item in similar {
        let entry = PyDict::new_bound(py);
        entry.set_item("source_1_index", item.source_1_index)?;
        entry.set_item("source_2_index", item.source_2_index)?;
        entry.set_item("source_1_text", item.source_1_text)?;
        entry.set_item("source_2_text", item.source_2_text)?;
        entry.set_item("similarity", item.similarity)?;
        similar_list.append(entry)?;
    }

    result.set_item("added", added_list)?;
    result.set_item("removed", removed_list)?;
    result.set_item("similar", similar_list)?;
    Ok(result)
}

#[pyfunction]
pub fn deduplicate_article_groups<'py>(
    py: Python<'py>,
    articles: Vec<(String, String)>,
    threshold: Option<f64>,
    num_hashes: Option<usize>,
) -> PyResult<Bound<'py, PyDict>> {
    let threshold = threshold.unwrap_or(0.85);
    let num_hashes = num_hashes.unwrap_or(DEFAULT_NUM_HASHES).max(1);
    let mut text_to_ids: HashMap<String, Vec<String>> = HashMap::new();
    let mut text_by_hash: HashMap<String, String> = HashMap::new();

    for (doc_id, text) in articles {
        if doc_id.trim().is_empty() || text.trim().is_empty() {
            continue;
        }
        let text_hash = format!("{:x}", md5::compute(text.as_bytes()));
        text_by_hash.entry(text_hash.clone()).or_insert(text);
        text_to_ids.entry(text_hash).or_default().push(doc_id);
    }

    let mut representatives = Vec::new();
    let mut groups: HashMap<String, HashSet<String>> = HashMap::new();
    for (text_hash, ids) in &text_to_ids {
        if ids.is_empty() {
            continue;
        }
        let representative = ids[0].clone();
        groups.insert(representative.clone(), ids.iter().cloned().collect());
        let representative_text = text_by_hash.get(text_hash).cloned().unwrap_or_default();
        representatives.push(DocumentInput {
            doc_id: representative,
            text: representative_text,
        });
    }

    let signatures = build_signatures(representatives, num_hashes);
    let duplicates = find_duplicate_pairs(&signatures, threshold);

    for pair in duplicates {
        let target_rep = groups
            .iter()
            .find(|(_, members)| members.contains(&pair.doc_id_1))
            .map(|(rep, _)| rep.clone());
        if let Some(rep) = target_rep {
            if let Some(group) = groups.get_mut(&rep) {
                group.insert(pair.doc_id_2);
            }
        } else {
            groups.insert(
                pair.doc_id_1.clone(),
                HashSet::from([pair.doc_id_1, pair.doc_id_2]),
            );
        }
    }

    let result = PyDict::new_bound(py);
    for (representative, group) in groups {
        let members = PyList::empty_bound(py);
        let mut sorted_members = group.into_iter().collect::<Vec<_>>();
        sorted_members.sort();
        for member in sorted_members {
            members.append(member)?;
        }
        result.set_item(representative, members)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_text_similarity, compute_minhash_signature, estimate_jaccard_similarity,
        generate_sentence_diff, sentence_word_overlap, shingle_text,
    };

    #[test]
    fn shingles_handle_short_inputs() {
        let shingles = shingle_text("abc", 5);
        assert_eq!(shingles.len(), 1);
        assert!(shingles.contains("abc"));
    }

    #[test]
    fn identical_signatures_match_perfectly() {
        let left = compute_minhash_signature("alpha beta gamma", 32, 42);
        let right = compute_minhash_signature("alpha beta gamma", 32, 42);
        assert_eq!(estimate_jaccard_similarity(&left, &right), 1.0);
    }

    #[test]
    fn text_similarity_respects_empty_inputs() {
        assert_eq!(calculate_text_similarity("", "alpha"), 0.0);
    }

    #[test]
    fn sentence_diff_reports_unique_sentences() {
        let (added, removed, similar) =
            generate_sentence_diff("Alpha wins. Beta holds.", "Alpha wins. Gamma reacts.");
        assert_eq!(similar.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(added.len(), 1);
    }

    #[test]
    fn sentence_overlap_requires_shared_terms() {
        let overlap = sentence_word_overlap("Beta calls for a recount.", "Gamma calls for reform.");
        assert!(overlap < 0.5);
    }
}
