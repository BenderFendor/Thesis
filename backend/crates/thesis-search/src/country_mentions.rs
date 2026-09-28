//! Country alias matching over article text.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ops::Range;

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use once_cell::sync::Lazy;

static TOKEN_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"[\w']+").expect("valid token regex"));

/// Immutable country aliases prepared for repeated text scans.
pub struct CountryAliases {
    automaton: Option<AhoCorasick>,
    pattern_to_codes: Vec<HashSet<String>>,
    unique_alias_to_codes: HashMap<Vec<String>, HashSet<String>>,
    unique_exact_alias_to_codes: HashMap<Vec<String>, HashSet<String>>,
    max_alias_tokens: usize,
}

impl CountryAliases {
    /// Build alias indexes from the repository's country-code to alias map.
    pub fn new(raw_aliases: &HashMap<String, Vec<String>>) -> Self {
        let mut pattern_to_codes: BTreeMap<String, HashSet<String>> = BTreeMap::new();
        let mut unique_alias_to_codes = HashMap::new();
        let mut unique_exact_alias_to_codes = HashMap::new();

        for (code, aliases) in raw_aliases {
            let mut sorted_aliases: Vec<&str> = aliases
                .iter()
                .map(String::as_str)
                .map(str::trim)
                .filter(|alias| !alias.is_empty())
                .collect();
            sorted_aliases.sort_by_key(|alias| Reverse(alias.len()));

            for alias in sorted_aliases {
                add_alias(
                    alias,
                    code,
                    &mut pattern_to_codes,
                    &mut unique_alias_to_codes,
                    &mut unique_exact_alias_to_codes,
                );
            }
        }

        let patterns: Vec<String> = pattern_to_codes.keys().cloned().collect();
        let pattern_to_codes: Vec<HashSet<String>> = pattern_to_codes.into_values().collect();
        let automaton = if patterns.is_empty() {
            None
        } else {
            Some(
                AhoCorasickBuilder::new()
                    .match_kind(MatchKind::LeftmostLongest)
                    .ascii_case_insensitive(true)
                    .build(&patterns)
                    .expect("country aliases are valid Aho-Corasick patterns"),
            )
        };
        let max_alias_tokens = unique_alias_to_codes
            .keys()
            .chain(unique_exact_alias_to_codes.keys())
            .map(Vec::len)
            .max()
            .unwrap_or(1);

        Self {
            automaton,
            pattern_to_codes,
            unique_alias_to_codes,
            unique_exact_alias_to_codes,
            max_alias_tokens,
        }
    }

    /// Return sorted, unique codes for aliases present in `text`.
    pub fn extract(&self, text: &str) -> Vec<String> {
        if text.trim().is_empty() {
            return Vec::new();
        }

        let mut mentions = HashSet::new();
        let token_matches: Vec<_> = TOKEN_RE.find_iter(text).collect();
        let original_tokens: Vec<String> = token_matches
            .iter()
            .map(|matched| matched.as_str().to_string())
            .collect();
        let token_ranges: Vec<Range<usize>> = token_matches
            .iter()
            .map(|matched| matched.range())
            .collect();
        let lowered_tokens: Vec<String> = original_tokens
            .iter()
            .map(|token| token.to_lowercase())
            .collect();
        let alias_ranges = self.add_token_mentions(
            &original_tokens,
            &lowered_tokens,
            &token_ranges,
            &mut mentions,
        );
        self.add_pattern_mentions(text, &alias_ranges, &mut mentions);

        let mut sorted: Vec<String> = mentions.into_iter().collect();
        sorted.sort();
        sorted
    }

    fn add_pattern_mentions(
        &self,
        text: &str,
        alias_ranges: &[Range<usize>],
        mentions: &mut HashSet<String>,
    ) {
        if let Some(automaton) = &self.automaton {
            for matched in automaton.find_iter(text) {
                if is_inside_alias_range(matched.start()..matched.end(), alias_ranges) {
                    continue;
                }
                if let Some(codes) = self
                    .pattern_to_codes
                    .get(matched.pattern().as_u32() as usize)
                {
                    mentions.extend(codes.iter().cloned());
                }
            }
        }
    }

    fn add_token_mentions(
        &self,
        original_tokens: &[String],
        lowered_tokens: &[String],
        token_ranges: &[Range<usize>],
        mentions: &mut HashSet<String>,
    ) -> Vec<Range<usize>> {
        let mut alias_ranges = Vec::new();
        let mut start = 0;
        while start < lowered_tokens.len() {
            if let Some((codes, width)) =
                self.match_alias_at(original_tokens, lowered_tokens, start)
            {
                mentions.extend(codes.iter().cloned());
                alias_ranges.push(token_ranges[start].start..token_ranges[start + width - 1].end);
                start += width;
            } else {
                start += 1;
            }
        }
        alias_ranges
    }

    fn match_alias_at<'a>(
        &'a self,
        original_tokens: &[String],
        lowered_tokens: &[String],
        start: usize,
    ) -> Option<(&'a HashSet<String>, usize)> {
        let max_width = self.max_alias_tokens.min(lowered_tokens.len() - start);
        (1..=max_width).rev().find_map(|width| {
            let end = start + width;
            self.unique_exact_alias_to_codes
                .get(&original_tokens[start..end])
                .or_else(|| self.unique_alias_to_codes.get(&lowered_tokens[start..end]))
                .map(|codes| (codes, width))
        })
    }

    /// Join non-empty title, summary, and content in that order.
    pub fn extract_article(
        &self,
        title: Option<&str>,
        summary: Option<&str>,
        content: Option<&str>,
    ) -> Vec<String> {
        self.extract(&build_article_text(title, summary, content))
    }
}

/// Join non-empty title, summary, and content in that order.
pub fn build_article_text(
    title: Option<&str>,
    summary: Option<&str>,
    content: Option<&str>,
) -> String {
    [title, summary, content]
        .into_iter()
        .flatten()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn add_alias(
    alias: &str,
    code: &str,
    pattern_to_codes: &mut BTreeMap<String, HashSet<String>>,
    unique_alias_to_codes: &mut HashMap<Vec<String>, HashSet<String>>,
    unique_exact_alias_to_codes: &mut HashMap<Vec<String>, HashSet<String>>,
) {
    if !is_textual_alias(alias) {
        return;
    }
    if requires_exact_token_match(alias) {
        insert_alias(unique_exact_alias_to_codes, original_tokens(alias), code);
        return;
    }

    pattern_to_codes
        .entry(alias.to_lowercase())
        .or_default()
        .insert(code.to_string());
    insert_alias(unique_alias_to_codes, lowered_tokens(alias), code);
}

fn insert_alias(
    aliases: &mut HashMap<Vec<String>, HashSet<String>>,
    tokens: Vec<String>,
    code: &str,
) {
    if !tokens.is_empty() {
        aliases.entry(tokens).or_default().insert(code.to_string());
    }
}

fn is_textual_alias(alias: &str) -> bool {
    let stripped = alias.trim();
    if stripped.len() < 4 {
        return matches!(stripped, "U.K." | "UK" | "USA" | "UAE" | "PRC" | "DPRK");
    }
    if stripped.contains(',') || stripped.contains('/') {
        return false;
    }
    if stripped.chars().all(char::is_uppercase) && stripped.len() <= 3 {
        return false;
    }
    stripped.chars().any(char::is_alphabetic)
}

fn requires_exact_token_match(alias: &str) -> bool {
    let stripped = alias.trim();
    if stripped.is_empty() {
        return false;
    }
    let alpha_only: String = stripped
        .chars()
        .filter(|character| character.is_alphabetic())
        .collect();
    !alpha_only.is_empty() && alpha_only.len() <= 4 && stripped == stripped.to_uppercase()
}

fn tokens(value: &str, casefold: bool) -> Vec<String> {
    TOKEN_RE
        .find_iter(value)
        .map(|matched| {
            let token = matched.as_str();
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

fn is_inside_alias_range(candidate: Range<usize>, aliases: &[Range<usize>]) -> bool {
    aliases
        .iter()
        .any(|alias| alias.start <= candidate.start && candidate.end <= alias.end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn aliases(entries: &[(&str, &[&str])]) -> CountryAliases {
        let raw = entries
            .iter()
            .map(|(code, values)| {
                (
                    (*code).to_string(),
                    values.iter().map(|alias| (*alias).to_string()).collect(),
                )
            })
            .collect();
        CountryAliases::new(&raw)
    }

    #[test]
    fn extracts_sorted_unique_matches_and_preserves_exact_acronym_case() {
        let aliases = aliases(&[
            ("US", &["United States", "USA", "US"]),
            ("FR", &["France", "FR"]),
            ("GB", &["United Kingdom", "U.K.", "UK"]),
        ]);

        assert_eq!(
            aliases.extract("UK officials in the UNITED STATES met France; USA."),
            ["FR", "GB", "US"]
        );
        assert_eq!(aliases.extract("United States Uk Usa"), ["US"]);
    }

    #[test]
    fn ambiguous_alias_keeps_every_matching_country_code() {
        let aliases = aliases(&[
            ("AA", &["Shared Name"]),
            ("BB", &["Shared Name"]),
            ("CC", &["Shared Name"]),
        ]);

        assert_eq!(aliases.extract("shared name"), ["AA", "BB", "CC"]);
        assert_eq!(
            aliases.extract("prefixShared NameSuffix"),
            ["AA", "BB", "CC"]
        );
    }

    #[test]
    fn alias_filter_preserves_short_exact_forms_and_rejects_punctuation_lists() {
        let aliases = aliases(&[
            ("GB", &["U.K."]),
            ("NT", &["NATO"]),
            ("KP", &["NORTH KOREA"]),
            ("XX", &["Foo/Bar", "Foo, Bar"]),
        ]);

        assert_eq!(
            aliases.extract("U.K., NATO, and north korea; foo bar."),
            ["GB", "KP", "NT"]
        );
    }

    #[test]
    fn longest_alias_does_not_add_codes_from_nested_aliases() {
        let aliases = aliases(&[
            ("SD", &["Sudanese"]),
            ("SS", &["Sudanese", "South Sudanese"]),
        ]);

        assert_eq!(aliases.extract("South Sudanese officials met"), ["SS"]);
        assert_eq!(aliases.extract("Sudanese officials met"), ["SD", "SS"]);
    }

    #[test]
    fn accented_longest_alias_suppresses_nested_ascii_alias() {
        let aliases = aliases(&[
            ("GN", &["Guinea"]),
            ("GQ", &["República de Guinea Ecuatorial"]),
        ]);

        assert_eq!(aliases.extract("REPÚBLICA DE GUINEA ECUATORIAL"), ["GQ"]);
        assert_eq!(aliases.extract("República de Guinea Ecuatorial"), ["GQ"]);
    }

    #[test]
    fn pattern_suppression_requires_full_alias_range_containment() {
        let alias_ranges = [3..12, 20..25];

        assert!(is_inside_alias_range(5..10, &alias_ranges));
        assert!(is_inside_alias_range(22..24, &alias_ranges));
        assert!(!is_inside_alias_range(1..8, &alias_ranges));
        assert!(!is_inside_alias_range(8..15, &alias_ranges));
        assert!(!is_inside_alias_range(12..17, &alias_ranges));
    }

    #[test]
    fn empty_alias_map_and_empty_article_text_are_safe() {
        let empty = HashMap::new();
        let aliases = CountryAliases::new(&empty);
        assert!(aliases.extract("country text").is_empty());
        assert_eq!(build_article_text(None, Some("  "), None), "");
        assert!(aliases.extract_article(None, Some("  "), None).is_empty());
    }

    #[test]
    fn article_text_keeps_title_summary_content_order_and_spacing() {
        assert_eq!(
            build_article_text(Some(" Title "), Some("Summary"), Some("Body")),
            " Title  Summary Body"
        );
    }

    proptest! {
        #[test]
        fn adding_a_country_mention_never_removes_existing_matches(
            prefix in any::<String>(),
            suffix in any::<String>(),
        ) {
            let aliases = aliases(&[
                ("US", &["United States"]),
                ("NZ", &["New Zealand"]),
            ]);
            let before = aliases.extract(&format!(" {prefix} United States {suffix} "));
            let after = aliases.extract(&format!(" {prefix} United States {suffix} New Zealand "));

            prop_assert!(before.iter().all(|code| after.contains(code)));
            prop_assert!(after.contains(&"NZ".to_string()));
        }

        #[test]
        fn nested_alias_span_suppression_is_transitive(
            mut endpoints in prop::array::uniform6(0usize..256),
        ) {
            endpoints.sort_unstable();
            let outer = endpoints[0]..endpoints[5];
            let middle = endpoints[1]..endpoints[4];
            let inner = endpoints[2]..endpoints[3];

            prop_assert!(is_inside_alias_range(
                middle.clone(),
                std::slice::from_ref(&outer),
            ));
            prop_assert!(is_inside_alias_range(
                inner.clone(),
                std::slice::from_ref(&middle),
            ));
            prop_assert!(is_inside_alias_range(
                inner,
                std::slice::from_ref(&outer),
            ));
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::is_inside_alias_range;

    #[kani::proof]
    fn nested_alias_suppression_is_transitive() {
        let inner_start = kani::any::<usize>();
        let inner_end = kani::any::<usize>();
        let middle_start = kani::any::<usize>();
        let middle_end = kani::any::<usize>();
        let outer_start = kani::any::<usize>();
        let outer_end = kani::any::<usize>();

        kani::assume(inner_start <= inner_end);
        kani::assume(middle_start <= middle_end);
        kani::assume(outer_start <= outer_end);
        let middle = [middle_start..middle_end];
        let outer = [outer_start..outer_end];
        kani::assume(is_inside_alias_range(inner_start..inner_end, &middle));
        kani::assume(is_inside_alias_range(middle_start..middle_end, &outer));

        assert!(is_inside_alias_range(inner_start..inner_end, &outer));
    }

    #[kani::proof]
    fn nested_alias_suppression_assumptions_have_a_concrete_witness() {
        let inner = 3..4;
        let middle = [2..8];
        let outer = [0..10];

        assert!(is_inside_alias_range(inner, &middle));
        assert!(is_inside_alias_range(middle[0].clone(), &outer));
        assert!(is_inside_alias_range(3..4, &outer));
    }
}
