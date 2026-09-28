use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use serde::Serialize;

const DEFAULT_CHAR_NGRAM: usize = 5;
const DEFAULT_SEED: u64 = 42;
const EMPTY_SIGNATURE_VALUE: u128 = u128::MAX;

/// A pair of documents whose MinHash signatures meet the requested threshold.
#[derive(Debug, Clone, Serialize)]
pub struct DuplicatePair {
    /// Identifier of the first document in the pair.
    pub doc_id_1: String,
    /// Identifier of the second document in the pair.
    pub doc_id_2: String,
    /// Estimated Jaccard similarity in the range `[0.0, 1.0]`.
    pub similarity: f64,
}

#[derive(Debug)]
struct ExactGroup {
    representative: String,
    text: String,
    members: HashSet<String>,
}

#[derive(Debug)]
struct DisjointSets {
    parent: Vec<usize>,
    size: Vec<usize>,
}

impl DisjointSets {
    fn new(count: usize) -> Self {
        Self {
            parent: (0..count).collect(),
            size: vec![1; count],
        }
    }

    fn root(&mut self, mut index: usize) -> usize {
        let mut root = index;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        while self.parent[index] != index {
            let next = self.parent[index];
            self.parent[index] = root;
            index = next;
        }
        root
    }

    fn join(&mut self, left: usize, right: usize) {
        let mut left_root = self.root(left);
        let mut right_root = self.root(right);
        if left_root == right_root {
            return;
        }
        if self.size[left_root] < self.size[right_root] {
            std::mem::swap(&mut left_root, &mut right_root);
        }
        self.parent[right_root] = left_root;
        self.size[left_root] += self.size[right_root];
    }
}

/// Converts text into a set of normalized character n-grams.
///
/// Text shorter than `n` produces one shingle. Empty text or `n == 0`
/// produces an empty set.
pub fn shingle_text(text: &str, n: usize) -> HashSet<String> {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() || n == 0 {
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
            let hash_seed = seed.wrapping_add(idx as u64);
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

/// Computes a MinHash signature using character five-grams.
pub fn compute_minhash_signature(text: &str, num_hashes: usize, seed: u64) -> Vec<u128> {
    let shingles = shingle_text(text, DEFAULT_CHAR_NGRAM);
    if shingles.is_empty() {
        return vec![EMPTY_SIGNATURE_VALUE; num_hashes];
    }

    hash_params(num_hashes, seed)
        .into_par_iter()
        .map(|(a, b)| {
            shingles
                .iter()
                .map(|shingle| {
                    let digest = md5::compute(format!("{shingle}:{a}:{b}"));
                    u128::from_be_bytes(digest.0)
                })
                .min()
                .unwrap_or(EMPTY_SIGNATURE_VALUE)
        })
        .collect()
}

/// Estimates Jaccard similarity from two MinHash signatures.
///
/// Returns `0.0` when either signature is empty or their lengths differ.
pub fn estimate_jaccard_similarity(left: &[u128], right: &[u128]) -> f64 {
    if left.is_empty() || left.len() != right.len() {
        return 0.0;
    }

    let matches = left.iter().zip(right).filter(|(a, b)| a == b).count();
    matches as f64 / left.len() as f64
}

fn duplicate_indexes(signatures: &[Vec<u128>], threshold: f64) -> Vec<(usize, usize, f64)> {
    // ponytail: O(n²) pair scan; add an LSH candidate index if measured batches exceed their latency target.
    let mut pairs = Vec::new();
    for left in 0..signatures.len() {
        for right in left + 1..signatures.len() {
            let similarity = estimate_jaccard_similarity(&signatures[left], &signatures[right]);
            if similarity >= threshold {
                pairs.push((left, right, similarity));
            }
        }
    }
    pairs.sort_by(|left, right| right.2.total_cmp(&left.2));
    pairs
}

/// Finds document pairs whose MinHash similarity meets `threshold`.
///
/// Empty IDs and empty text are ignored. Pair ordering is similarity
/// descending, with input order preserved for ties.
pub fn find_duplicate_pairs(
    documents: &[(String, String)],
    threshold: f64,
    num_hashes: usize,
) -> Vec<DuplicatePair> {
    let retained: Vec<&(String, String)> = documents
        .iter()
        .filter(|(id, text)| !id.trim().is_empty() && !text.trim().is_empty())
        .collect();
    let signatures: Vec<Vec<u128>> = retained
        .par_iter()
        .map(|(_, text)| compute_minhash_signature(text, num_hashes.max(1), DEFAULT_SEED))
        .collect();

    duplicate_indexes(&signatures, threshold)
        .into_iter()
        .map(|(left, right, similarity)| DuplicatePair {
            doc_id_1: retained[left].0.clone(),
            doc_id_2: retained[right].0.clone(),
            similarity,
        })
        .collect()
}

/// Groups exact and near-duplicate articles by connected similarity links.
///
/// Exact text is grouped without hashing text into a lossy identity. The first
/// input ID in each resulting component is its representative.
pub fn deduplicate_article_groups(
    articles: &[(String, String)],
    threshold: f64,
    num_hashes: usize,
) -> HashMap<String, HashSet<String>> {
    let mut text_indexes = HashMap::<&str, usize>::new();
    let mut exact_groups = Vec::<ExactGroup>::new();

    for (doc_id, text) in articles {
        if doc_id.trim().is_empty() || text.trim().is_empty() {
            continue;
        }
        if let Some(&index) = text_indexes.get(text.as_str()) {
            exact_groups[index].members.insert(doc_id.clone());
            continue;
        }

        let index = exact_groups.len();
        text_indexes.insert(text.as_str(), index);
        exact_groups.push(ExactGroup {
            representative: doc_id.clone(),
            text: text.clone(),
            members: HashSet::from([doc_id.clone()]),
        });
    }

    let signatures: Vec<Vec<u128>> = exact_groups
        .par_iter()
        .map(|group| compute_minhash_signature(&group.text, num_hashes.max(1), DEFAULT_SEED))
        .collect();
    let pairs = duplicate_indexes(&signatures, threshold);
    let mut components = DisjointSets::new(exact_groups.len());
    for (left, right, _) in pairs {
        components.join(left, right);
    }

    let mut canonical_by_root = vec![None; exact_groups.len()];
    for index in 0..exact_groups.len() {
        let root = components.root(index);
        if canonical_by_root[root].is_none() {
            canonical_by_root[root] = Some(index);
        }
    }

    let mut members_by_canonical = vec![HashSet::new(); exact_groups.len()];
    for (index, group) in exact_groups.iter().enumerate() {
        let root = components.root(index);
        if let Some(canonical) = canonical_by_root[root] {
            members_by_canonical[canonical].extend(group.members.iter().cloned());
        }
    }

    exact_groups
        .into_iter()
        .enumerate()
        .filter_map(|(index, group)| {
            (!members_by_canonical[index].is_empty()).then(|| {
                (
                    group.representative,
                    std::mem::take(&mut members_by_canonical[index]),
                )
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{deduplicate_article_groups, estimate_jaccard_similarity, shingle_text};
    use proptest::prelude::*;

    #[test]
    fn zero_length_shingles_are_empty_without_panicking() {
        assert!(shingle_text("text", 0).is_empty());
    }

    #[test]
    fn duplicate_links_merge_existing_groups() {
        let articles = vec![
            ("first".to_owned(), "Alpha article text".to_owned()),
            (
                "second".to_owned(),
                "Alpha article text with one added clause".to_owned(),
            ),
            (
                "third".to_owned(),
                "Alpha article text with one added clause and another".to_owned(),
            ),
        ];
        let groups = deduplicate_article_groups(&articles, 0.0, 8);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups["first"].len(), 3);
    }

    proptest! {
        #[test]
        fn signature_is_invariant_to_ascii_case_and_outer_whitespace(
            text in "[A-Za-z0-9][A-Za-z0-9 ]{0,60}",
        ) {
            let normalized = format!("  {}  ", text.to_ascii_uppercase());
            prop_assert_eq!(
                super::compute_minhash_signature(&text, 16, 42),
                super::compute_minhash_signature(&normalized, 16, 42),
            );
        }

        #[test]
        fn estimated_similarity_is_symmetric_and_bounded(
            left in prop::collection::vec(any::<u128>(), 0..32),
            right in prop::collection::vec(any::<u128>(), 0..32),
        ) {
            let forward = estimate_jaccard_similarity(&left, &right);
            let reverse = estimate_jaccard_similarity(&right, &left);
            prop_assert_eq!(forward, reverse);
            prop_assert!((0.0..=1.0).contains(&forward));
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::estimate_jaccard_similarity;

    #[kani::proof]
    #[kani::unwind(5)]
    fn production_similarity_estimator_stays_in_unit_interval() {
        let left: [u128; 4] = kani::any();
        let right: [u128; 4] = kani::any();
        let score = estimate_jaccard_similarity(&left, &right);
        assert!((0.0..=1.0).contains(&score));
    }

    #[kani::proof]
    fn mismatched_signature_lengths_never_match() {
        let left: [u128; 2] = kani::any();
        let right: [u128; 3] = kani::any();
        assert_eq!(estimate_jaccard_similarity(&left, &right), 0.0);
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn identical_signatures_reach_perfect_similarity() {
        let signature = [17_u128; 4];
        assert_eq!(estimate_jaccard_similarity(&signature, &signature), 1.0);
    }
}
