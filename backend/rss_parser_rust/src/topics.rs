use std::collections::{HashMap, HashSet};

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;

const MIN_CLUSTER_SIZE: usize = 2;
const LEXICAL_MIN_TOKEN_OVERLAP: usize = 2;
const LEXICAL_MIN_JACCARD: f64 = 0.18;
const LEXICAL_MAX_TOKEN_POSTINGS: usize = 250;
const MAX_KEYWORDS_PER_ARTICLE: usize = 10;

#[derive(Debug, Clone, Serialize)]
pub struct ClusterCandidate {
    pub anchor_id: i64,
    pub member_ids: Vec<i64>,
    pub similarities: HashMap<i64, f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArticleInput {
    pub article_id: i64,
    pub title: String,
    pub order_index: u32,
}

#[derive(Debug, Clone)]
struct ArticleKeywords {
    article_id: i64,
    tokens: Vec<String>,
    token_set: HashSet<String>,
}

fn stopwords() -> &'static HashSet<&'static str> {
    static INSTANCE: once_cell::sync::Lazy<HashSet<&'static str>> =
        once_cell::sync::Lazy::new(|| {
            let words = [
                "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of",
                "with", "by", "and", "or", "but", "not", "its", "into", "their", "than", "that",
                "have", "has", "had", "from",
            ];
            words.iter().copied().collect()
        });
    &INSTANCE
}

fn generic_cluster_tokens() -> &'static HashSet<&'static str> {
    static INSTANCE: once_cell::sync::Lazy<HashSet<&'static str>> =
        once_cell::sync::Lazy::new(|| {
            let words = [
                "about",
                "after",
                "amid",
                "against",
                "along",
                "also",
                "around",
                "been",
                "between",
                "could",
                "despite",
                "direct",
                "during",
                "east",
                "first",
                "follow",
                "following",
                "from",
                "home",
                "including",
                "into",
                "latest",
                "middle",
                "more",
                "most",
                "much",
                "news",
                "over",
                "part",
                "report",
                "reportedly",
                "return",
                "said",
                "since",
                "some",
                "states",
                "than",
                "that",
                "their",
                "them",
                "there",
                "these",
                "they",
                "this",
                "through",
                "today",
                "united",
                "week",
                "weekend",
                "week's",
                "west",
                "what",
                "will",
                "with",
                "would",
            ];
            words.iter().copied().collect()
        });
    &INSTANCE
}

fn normalize_keyword(value: &str) -> String {
    let normalized = value.trim_matches(|ch: char| ch == '-' || ch == '\'' || ch == '"');
    if normalized.len() > 5 && normalized.ends_with("ies") {
        return format!("{}y", &normalized[..normalized.len() - 3]);
    }
    if normalized.len() > 5 && normalized.ends_with("es") {
        return normalized[..normalized.len() - 2].to_string();
    }
    if normalized.len() > 4 && normalized.ends_with('s') {
        return normalized[..normalized.len() - 1].to_string();
    }
    if normalized.len() > 5 && normalized.ends_with("ian") {
        return normalized[..normalized.len() - 3].to_string();
    }
    normalized.to_string()
}

pub fn extract_keywords(title: &str) -> Vec<String> {
    let text = title.to_lowercase();
    let stopwords = stopwords();
    let generic_tokens = generic_cluster_tokens();
    let word_re = Regex::new(r"[a-z0-9][a-z0-9'\-/]+").expect("valid word regex");

    let mut seen: HashSet<String> = HashSet::new();
    let mut keywords: Vec<String> = Vec::new();

    for word_match in word_re.find_iter(&text) {
        let word = word_match.as_str();
        let normalized = normalize_keyword(word);
        if normalized.len() <= 3 {
            continue;
        }
        if stopwords.contains(normalized.as_str()) || generic_tokens.contains(normalized.as_str()) {
            continue;
        }
        if normalized.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        if seen.insert(normalized.clone()) {
            keywords.push(normalized);
        }
        if keywords.len() >= MAX_KEYWORDS_PER_ARTICLE {
            break;
        }
    }
    keywords
}

fn build_article_keywords(articles: &[ArticleInput]) -> Vec<ArticleKeywords> {
    articles
        .par_iter()
        .map(|article| {
            let tokens = extract_keywords(&article.title);
            let token_set = tokens.iter().cloned().collect::<HashSet<_>>();
            ArticleKeywords {
                article_id: article.article_id,
                tokens,
                token_set,
            }
        })
        .collect()
}

fn passes_lexical_match(base_tokens: &HashSet<String>, candidate_tokens: &HashSet<String>) -> bool {
    if base_tokens.is_empty() || candidate_tokens.is_empty() {
        return false;
    }
    let overlap = base_tokens.intersection(candidate_tokens).count();
    if overlap < LEXICAL_MIN_TOKEN_OVERLAP {
        return false;
    }
    let union_size = base_tokens.len() + candidate_tokens.len() - overlap;
    let jaccard = overlap as f64 / union_size.max(1) as f64;
    jaccard >= LEXICAL_MIN_JACCARD || overlap > LEXICAL_MIN_TOKEN_OVERLAP
}

pub fn cluster_articles_lexical(articles: Vec<ArticleInput>) -> Vec<ClusterCandidate> {
    if articles.is_empty() {
        return vec![];
    }

    let order_index: HashMap<i64, u32> = articles
        .iter()
        .map(|a| (a.article_id, a.order_index))
        .collect();

    let keyword_data = build_article_keywords(&articles);
    let keywords_by_id: HashMap<i64, &ArticleKeywords> =
        keyword_data.iter().map(|k| (k.article_id, k)).collect();

    let mut token_to_article_ids: HashMap<String, Vec<i64>> = HashMap::new();
    for kw in &keyword_data {
        for token in &kw.tokens {
            token_to_article_ids
                .entry(token.clone())
                .or_default()
                .push(kw.article_id);
        }
    }

    let ids: Vec<i64> = articles.iter().map(|a| a.article_id).collect();
    let mut parent: HashMap<i64, i64> = HashMap::new();
    for &id in &ids {
        parent.insert(id, id);
    }

    fn find(parent: &mut HashMap<i64, i64>, x: i64) -> i64 {
        let root = {
            let mut current = x;
            loop {
                let p = parent[&current];
                if p == current {
                    break current;
                }
                current = p;
            }
        };
        let mut current = x;
        while parent[&current] != current {
            let next = parent[&current];
            parent.insert(current, root);
            current = next;
        }
        root
    }

    fn union(parent: &mut HashMap<i64, i64>, a: i64, b: i64) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent.insert(rb, ra);
        }
    }

    for article in &articles {
        let article_id = article.article_id;
        let kw = match keywords_by_id.get(&article_id) {
            Some(k) => k,
            None => continue,
        };
        if kw.tokens.len() < LEXICAL_MIN_TOKEN_OVERLAP {
            continue;
        }

        let base_index = *order_index.get(&article_id).unwrap_or(&0);
        let mut candidate_overlaps: HashMap<i64, usize> = HashMap::new();

        for token in &kw.tokens {
            let neighbors = match token_to_article_ids.get(token) {
                Some(n) => n,
                None => continue,
            };
            if neighbors.len() > LEXICAL_MAX_TOKEN_POSTINGS {
                continue;
            }
            for &neighbor_id in neighbors {
                let neighbor_index = *order_index.get(&neighbor_id).unwrap_or(&0);
                if neighbor_index <= base_index {
                    continue;
                }
                *candidate_overlaps.entry(neighbor_id).or_default() += 1;
            }
        }

        for (&neighbor_id, &overlap) in &candidate_overlaps {
            if overlap < LEXICAL_MIN_TOKEN_OVERLAP {
                continue;
            }
            let neighbor_kw = match keywords_by_id.get(&neighbor_id) {
                Some(k) => k,
                None => continue,
            };
            if passes_lexical_match(&kw.token_set, &neighbor_kw.token_set) {
                union(&mut parent, article_id, neighbor_id);
            }
        }
    }

    let mut components: HashMap<i64, HashSet<i64>> = HashMap::new();
    for &id in &ids {
        let root = find(&mut parent, id);
        components.entry(root).or_default().insert(id);
    }

    let mut clusters: Vec<ClusterCandidate> = Vec::new();
    for members in components.values() {
        if members.len() < MIN_CLUSTER_SIZE {
            continue;
        }

        let mut ordered_members: Vec<i64> = members.iter().copied().collect();
        ordered_members.sort_by_key(|id| order_index.get(id).copied().unwrap_or(0));

        let anchor_id = ordered_members[0];
        let anchor_kw = keywords_by_id.get(&anchor_id);
        let anchor_tokens: HashSet<String> =
            anchor_kw.map(|k| k.token_set.clone()).unwrap_or_default();

        let filtered_members: Vec<i64> = ordered_members
            .iter()
            .filter(|&&member_id| {
                if member_id == anchor_id {
                    return true;
                }
                let member_kw = keywords_by_id.get(&member_id);
                let member_tokens: HashSet<String> =
                    member_kw.map(|k| k.token_set.clone()).unwrap_or_default();
                passes_lexical_match(&anchor_tokens, &member_tokens)
            })
            .copied()
            .collect();

        if filtered_members.len() < MIN_CLUSTER_SIZE {
            continue;
        }

        let mut similarities: HashMap<i64, f64> = HashMap::new();
        for &member_id in &filtered_members {
            if member_id == anchor_id {
                similarities.insert(member_id, 1.0);
                continue;
            }
            let member_kw = keywords_by_id.get(&member_id);
            let member_tokens: HashSet<String> =
                member_kw.map(|k| k.token_set.clone()).unwrap_or_default();
            if anchor_tokens.is_empty() || member_tokens.is_empty() {
                similarities.insert(member_id, 0.0);
                continue;
            }
            let overlap = anchor_tokens.intersection(&member_tokens).count();
            let union_size = anchor_tokens.len() + member_tokens.len() - overlap;
            let sim = if union_size > 0 {
                (overlap as f64 / union_size as f64 * 1000.0).round() / 1000.0
            } else {
                0.0
            };
            similarities.insert(member_id, sim);
        }

        clusters.push(ClusterCandidate {
            anchor_id,
            member_ids: filtered_members,
            similarities,
        });
    }

    clusters
}

pub fn generate_cluster_label(title_scores: Vec<(String, f64)>) -> String {
    if title_scores.is_empty() {
        return "Topic".to_string();
    }

    let mut scored: Vec<(String, f64)> = title_scores;
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));

    if scored[0].1 > 5.0 {
        return scored[0].0.clone();
    }

    for (title, _) in &scored {
        if title.len() > 10 {
            return title.clone();
        }
    }

    "Topic".to_string()
}

pub fn extract_keywords_from_titles(titles: Vec<String>) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut seen_set: HashSet<String> = HashSet::new();

    for title in titles {
        for keyword in extract_keywords(&title) {
            if seen_set.insert(keyword.clone()) {
                seen.push(keyword);
            }
            if seen.len() >= MAX_KEYWORDS_PER_ARTICLE {
                return seen;
            }
        }
    }
    seen
}

#[pyfunction]
pub fn rust_lexical_cluster<'py>(
    py: Python<'py>,
    articles: Vec<(i64, String, u32)>,
) -> PyResult<Bound<'py, PyList>> {
    let inputs: Vec<ArticleInput> = articles
        .into_iter()
        .map(|(article_id, title, order_index)| ArticleInput {
            article_id,
            title,
            order_index,
        })
        .collect();

    let clusters = cluster_articles_lexical(inputs);
    let result = PyList::empty_bound(py);

    for cluster in clusters {
        let entry = PyDict::new_bound(py);
        entry.set_item("anchor_id", cluster.anchor_id)?;

        let member_list = PyList::empty_bound(py);
        for member_id in &cluster.member_ids {
            member_list.append(member_id)?;
        }
        entry.set_item("member_ids", member_list)?;

        let sim_dict = PyDict::new_bound(py);
        for (k, v) in &cluster.similarities {
            sim_dict.set_item(*k, *v)?;
        }
        entry.set_item("similarities", sim_dict)?;

        result.append(entry)?;
    }

    Ok(result)
}

#[pyfunction]
pub fn rust_extract_keywords(title: String) -> Vec<String> {
    extract_keywords(&title)
}

#[pyfunction]
pub fn rust_extract_keywords_from_titles(titles: Vec<String>) -> Vec<String> {
    extract_keywords_from_titles(titles)
}

#[pyfunction]
pub fn rust_generate_cluster_label(title_scores: Vec<(String, f64)>) -> String {
    generate_cluster_label(title_scores)
}

#[cfg(test)]
mod tests {
    use super::{cluster_articles_lexical, extract_keywords, generate_cluster_label, ArticleInput};

    #[test]
    fn extracts_keywords_from_title() {
        let keywords = extract_keywords("Trump signs executive order on immigration policy");
        assert!(!keywords.is_empty());
        assert!(keywords.contains(&"trump".to_string()));
        assert!(keywords.contains(&"executive".to_string()));
    }

    #[test]
    fn clusters_similar_articles() {
        let articles = vec![
            ArticleInput {
                article_id: 1,
                title: "Trump signs executive order on border security".into(),
                order_index: 0,
            },
            ArticleInput {
                article_id: 2,
                title: "President Trump executive order targets immigration".into(),
                order_index: 1,
            },
            ArticleInput {
                article_id: 3,
                title: "New climate report shows rising temperatures".into(),
                order_index: 2,
            },
            ArticleInput {
                article_id: 4,
                title: "Climate scientists warn about global warming impact".into(),
                order_index: 3,
            },
        ];
        let clusters = cluster_articles_lexical(articles);
        assert_eq!(clusters.len(), 2);
        for c in &clusters {
            assert!(c.member_ids.len() >= 2);
        }
    }

    #[test]
    fn label_picks_best_title() {
        let label = generate_cluster_label(vec![
            ("Breaking: something happened".into(), 2.0),
            (
                "President Signs Executive Order on Immigration Reform".into(),
                15.0,
            ),
            ("Short".into(), 3.0),
        ]);
        assert!(label.contains("Executive Order"));
    }

    #[test]
    fn empty_inputs_produce_empty_clusters() {
        let clusters = cluster_articles_lexical(vec![]);
        assert!(clusters.is_empty());
    }
}
