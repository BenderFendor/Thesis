use std::collections::{HashMap, HashSet};

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use once_cell::sync::Lazy;
use pyo3::prelude::*;
use pyo3::types::PyDict;

static TOKEN_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"[\w']+").expect("valid token regex"));

struct CountryAliasData {
    automaton: AhoCorasick,
    pattern_to_codes: HashMap<u32, HashSet<String>>,
    unique_alias_to_code: HashMap<Vec<String>, String>,
    unique_exact_alias_to_code: HashMap<Vec<String>, String>,
    max_alias_tokens: usize,
    #[allow(dead_code)]
    case_sensitive_patterns: Vec<String>,
}

impl CountryAliasData {
    fn new(raw_aliases: &HashMap<String, Vec<String>>) -> Self {
        let mut all_patterns: Vec<String> = Vec::new();
        let mut pattern_to_codes: HashMap<u32, HashSet<String>> = HashMap::new();
        let mut unique_alias_to_code: HashMap<Vec<String>, String> = HashMap::new();
        let mut unique_exact_alias_to_code: HashMap<Vec<String>, String> = HashMap::new();
        let mut case_sensitive_patterns: Vec<String> = Vec::new();

        for (code, aliases) in raw_aliases {
            let mut sorted_aliases: Vec<String> = aliases
                .iter()
                .filter(|a| !a.trim().is_empty())
                .map(|a| a.trim().to_string())
                .collect();
            sorted_aliases.sort_by_key(|a| -(a.len() as i64));

            for alias in &sorted_aliases {
                if !is_textual_alias(alias) {
                    continue;
                }

                if requires_exact_token_match(alias) {
                    let tokens = original_tokens(alias);
                    if !tokens.is_empty() {
                        case_sensitive_patterns.push(alias.clone());
                        let entry = unique_exact_alias_to_code
                            .entry(tokens)
                            .or_insert_with(|| code.clone());
                        if entry != code {
                            unique_exact_alias_to_code.remove(&original_tokens(alias));
                        }
                    }
                } else {
                    let pattern_id = all_patterns.len() as u32;
                    let lowered = alias.to_lowercase();
                    all_patterns.push(lowered);
                    pattern_to_codes
                        .entry(pattern_id)
                        .or_default()
                        .insert(code.clone());

                    let tokens = lowered_tokens(alias);
                    if !tokens.is_empty() {
                        let entry = unique_alias_to_code
                            .entry(tokens)
                            .or_insert_with(|| code.clone());
                        if entry != code {
                            unique_alias_to_code.remove(&lowered_tokens(alias));
                        }
                    }
                }
            }
        }

        let automaton = AhoCorasickBuilder::new()
            .match_kind(MatchKind::LeftmostLongest)
            .ascii_case_insensitive(true)
            .build(&all_patterns)
            .expect("valid Aho-Corasick patterns");

        let max_alias_tokens = unique_alias_to_code
            .keys()
            .chain(unique_exact_alias_to_code.keys())
            .map(|t| t.len())
            .max()
            .unwrap_or(1);

        CountryAliasData {
            automaton,
            pattern_to_codes,
            unique_alias_to_code,
            unique_exact_alias_to_code,
            max_alias_tokens,
            case_sensitive_patterns,
        }
    }
}

fn is_textual_alias(alias: &str) -> bool {
    let stripped = alias.trim();
    if stripped.len() < 4 { // Why is this hard coded are this the only 6 countries that have this?
        return matches!(stripped, "U.K." | "UK" | "USA" | "UAE" | "PRC" | "DPRK");
    }
    if stripped.contains(',') || stripped.contains('/') {
        return false;
    }
    if stripped.chars().all(|ch| ch.is_uppercase()) && stripped.len() <= 3 {
        return false;
    }
    stripped.chars().any(|ch| ch.is_alphabetic())
}

fn requires_exact_token_match(alias: &str) -> bool {
    let stripped = alias.trim();
    if stripped.is_empty() {
        return false;
    }
    let alpha_only: String = stripped.chars().filter(|ch| ch.is_alphabetic()).collect();
    if alpha_only.is_empty() || alpha_only.len() > 4 {
        return false;
    }
    stripped == stripped.to_uppercase()
}

fn tokens(value: &str, casefold: bool) -> Vec<String> {
    TOKEN_RE
        .find_iter(value)
        .map(|m| {
            let token = m.as_str();
            if casefold {
                token.to_lowercase()
            } else {
                token.to_string()
            }
        })
        .collect()
}

fn lowered_tokens(value: &str) -> Vec<String> {
    tokens(value, true)
}

fn original_tokens(value: &str) -> Vec<String> {
    tokens(value, false)
}

static COUNTRY_ALIAS_DATA: Lazy<Option<CountryAliasData>> = Lazy::new(load_country_aliases);

fn load_country_aliases() -> Option<CountryAliasData> {
    let data_dir =
        std::env::var("RSS_PARSER_DATA_DIR").unwrap_or_else(|_| "backend/app/data".to_string());

    let path = std::path::Path::new(&data_dir).join("country_aliases.json");
    let content = std::fs::read_to_string(&path).ok()?;
    let raw: HashMap<String, Vec<String>> = serde_json::from_str(&content).ok()?;
    Some(CountryAliasData::new(&raw))
}

fn get_alias_data() -> Option<&'static CountryAliasData> {
    COUNTRY_ALIAS_DATA.as_ref()
}

/// Scans the given text for country name mentions using a pre-loaded
/// Aho-Corasick automaton and multi-token alias matching against the
/// `country_aliases.json` dataset.
///
/// Returns a sorted list of unique ISO country codes (e.g. `["FR", "GB",
/// "US"]`).
#[pyfunction]
pub fn rust_extract_mentioned_countries(text: &str) -> Vec<String> {
    if text.trim().is_empty() {
        return vec![];
    }

    let data = match get_alias_data() {
        Some(d) => d,
        None => return vec![],
    };

    let mut mentions: HashSet<String> = HashSet::new();

    for mat in data.automaton.find_iter(text) {
        let pattern_id = mat.pattern().as_u32();
        if let Some(codes) = data.pattern_to_codes.get(&pattern_id) {
            for code in codes {
                mentions.insert(code.clone());
            }
        }
    }

    let original_tokens_vec: Vec<String> = TOKEN_RE
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect();
    let lowered_tokens_vec: Vec<String> = original_tokens_vec
        .iter()
        .map(|t| t.to_lowercase())
        .collect();

    for i in 0..lowered_tokens_vec.len() {
        let max_width = data.max_alias_tokens.min(lowered_tokens_vec.len() - i);
        for width in (1..=max_width).rev() {
            let exact_slice: Vec<String> = original_tokens_vec[i..i + width].to_vec();
            if let Some(code) = data.unique_exact_alias_to_code.get(&exact_slice) {
                mentions.insert(code.clone());
                break;
            }

            let lowered_slice: Vec<String> = lowered_tokens_vec[i..i + width].to_vec();
            if let Some(code) = data.unique_alias_to_code.get(&lowered_slice) {
                mentions.insert(code.clone());
                break;
            }
        }
    }

    let mut sorted: Vec<String> = mentions.into_iter().collect();
    sorted.sort();
    sorted
}

/// Joins an article's optional title, summary, and body content into a
/// single whitespace-separated string suitable for country-mention
/// extraction.
#[pyfunction]
pub fn rust_build_article_text(
    title: Option<String>,
    summary: Option<String>,
    content: Option<String>,
) -> String {
    let parts: Vec<String> = vec![title, summary, content]
        .into_iter()
        .filter_map(|p| p.filter(|s| !s.trim().is_empty()))
        .collect();
    parts.join(" ")
}

/// Convenience function that builds a combined article text from title,
/// summary, and content, then extracts mentioned country codes from it.
#[pyfunction]
pub fn rust_extract_article_mentioned_countries(
    title: Option<String>,
    summary: Option<String>,
    content: Option<String>,
) -> Vec<String> {
    let text = rust_build_article_text(title, summary, content);
    rust_extract_mentioned_countries(&text)
}

/// Reloads the `country_aliases.json` data file and returns a Python dict
/// with `loaded` (bool) and `countries` (int) keys, indicating the number
/// of country entries loaded.
#[pyfunction]
pub fn rust_reload_country_aliases<'py>(py: Python<'py>) -> PyResult<Bound<'py, PyDict>> {
    let data_dir =
        std::env::var("RSS_PARSER_DATA_DIR").unwrap_or_else(|_| "backend/app/data".to_string());

    let path = std::path::Path::new(&data_dir).join("country_aliases.json");
    let content = std::fs::read_to_string(&path).map_err(|e| {
        PyErr::new::<pyo3::exceptions::PyIOError, _>(format!("Failed to read: {e}"))
    })?;
    let raw: HashMap<String, Vec<String>> = serde_json::from_str(&content).map_err(|e| {
        PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("Invalid JSON: {e}"))
    })?;

    let count = raw.len();
    let dict = PyDict::new_bound(py);
    dict.set_item("loaded", true)?;
    dict.set_item("countries", count)?;
    Ok(dict)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_data() -> HashMap<String, Vec<String>> {
        let mut data = HashMap::new();
        data.insert(
            "US".to_string(),
            vec![
                "United States".to_string(),
                "United States of America".to_string(),
                "USA".to_string(),
                "U.S.".to_string(),
                "US".to_string(),
                "American".to_string(),
            ],
        );
        data.insert(
            "GB".to_string(),
            vec![
                "United Kingdom".to_string(),
                "Great Britain".to_string(),
                "UK".to_string(),
                "Britain".to_string(),
                "GB".to_string(),
                "U.K.".to_string(),
                "British".to_string(),
            ],
        );
        data.insert(
            "FR".to_string(),
            vec![
                "France".to_string(),
                "French Republic".to_string(),
                "FR".to_string(),
                "French".to_string(),
            ],
        );
        data
    }

    #[test]
    fn extracts_multiple_countries() {
        let data = test_data();
        let alias_data = CountryAliasData::new(&data);

        let text = "The United States and France signed a trade agreement, while Britain expressed concerns.";
        let result = extract_countries_with(&alias_data, text);
        assert!(result.contains(&"US".to_string()));
        assert!(result.contains(&"FR".to_string()));
        assert!(result.contains(&"GB".to_string()));
    }

    #[test]
    fn handles_empty_text() {
        let data = test_data();
        let alias_data = CountryAliasData::new(&data);
        let result = extract_countries_with(&alias_data, "");
        assert!(result.is_empty());
    }

    fn extract_countries_with(data: &CountryAliasData, text: &str) -> Vec<String> {
        let original_tokens_vec: Vec<String> = TOKEN_RE
            .find_iter(text)
            .map(|m| m.as_str().to_string())
            .collect();
        let lowered_tokens_vec: Vec<String> = original_tokens_vec
            .iter()
            .map(|t| t.to_lowercase())
            .collect();

        let mut mentions: HashSet<String> = HashSet::new();
        let token_count = lowered_tokens_vec.len();

        for i in 0..token_count {
            let max_width = data.max_alias_tokens.min(token_count - i);
            for width in (1..=max_width).rev() {
                let exact_slice: Vec<String> = original_tokens_vec[i..i + width].to_vec();
                if let Some(code) = data.unique_exact_alias_to_code.get(&exact_slice) {
                    mentions.insert(code.clone());
                    break;
                }

                let lowered_slice: Vec<String> = lowered_tokens_vec[i..i + width].to_vec();
                if let Some(code) = data.unique_alias_to_code.get(&lowered_slice) {
                    mentions.insert(code.clone());
                    break;
                }
            }
        }

        let mut sorted: Vec<String> = mentions.into_iter().collect();
        sorted.sort();
        sorted
    }

    #[test]
    fn case_insensitive_matching() {
        let data = test_data();
        let alias_data = CountryAliasData::new(&data);

        let result = extract_countries_with(&alias_data, "american and french officials met");
        assert!(result.contains(&"US".to_string()));
        assert!(result.contains(&"FR".to_string()));
    }
}
