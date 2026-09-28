//! Frequency-based keywords used by the article comparison endpoint.

use std::cmp::Ordering;
use std::collections::HashMap;

use unicode_general_category::{get_general_category, GeneralCategory};

fn is_python_word_character(character: char, unicode_15_1: bool) -> bool {
    // The base category table is Unicode 15.0; Python 3.13 adds Extension I in Unicode 15.1.
    character == '_'
        || (unicode_15_1 && ('\u{2EBF0}'..='\u{2EE5D}').contains(&character))
        || matches!(
            get_general_category(character),
            GeneralCategory::UppercaseLetter
                | GeneralCategory::LowercaseLetter
                | GeneralCategory::TitlecaseLetter
                | GeneralCategory::ModifierLetter
                | GeneralCategory::OtherLetter
                | GeneralCategory::DecimalNumber
                | GeneralCategory::LetterNumber
                | GeneralCategory::OtherNumber
        )
}

fn add_word<'a>(
    text: &'a str,
    start: usize,
    end: usize,
    right_is_word: bool,
    unicode_15_1: bool,
    words: &mut Vec<&'a str>,
) {
    let left_is_word = text[..start]
        .chars()
        .next_back()
        .is_some_and(|character| is_python_word_character(character, unicode_15_1));
    if end - start >= 3 && !left_is_word && !right_is_word {
        words.push(&text[start..end]);
    }
}

fn comparison_words(text: &str, unicode_15_1: bool) -> Vec<&str> {
    let mut words = Vec::new();
    let mut run = None;

    for (index, character) in text.char_indices() {
        if character.is_ascii_lowercase() {
            if run.is_none() {
                run = Some(index);
            }
        } else if let Some(start) = run.take() {
            add_word(
                text,
                start,
                index,
                is_python_word_character(character, unicode_15_1),
                unicode_15_1,
                &mut words,
            );
        }
    }

    if let Some(start) = run {
        add_word(text, start, text.len(), false, unicode_15_1, &mut words);
    }
    words
}

const STOP_WORDS: &[&str] = &[
    "a",
    "about",
    "above",
    "according",
    "after",
    "again",
    "all",
    "also",
    "among",
    "an",
    "and",
    "any",
    "are",
    "at",
    "be",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "down",
    "during",
    "each",
    "few",
    "for",
    "further",
    "had",
    "has",
    "have",
    "he",
    "her",
    "here",
    "him",
    "his",
    "how",
    "i",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "may",
    "me",
    "might",
    "more",
    "most",
    "must",
    "my",
    "need",
    "no",
    "nor",
    "not",
    "now",
    "of",
    "off",
    "on",
    "once",
    "only",
    "or",
    "other",
    "our",
    "out",
    "over",
    "own",
    "said",
    "same",
    "say",
    "says",
    "shall",
    "she",
    "should",
    "so",
    "some",
    "such",
    "tell",
    "tells",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "told",
    "too",
    "under",
    "up",
    "us",
    "very",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "why",
    "will",
    "with",
    "within",
    "without",
    "would",
    "you",
    "your",
];

fn keyword_priority(
    left_count: usize,
    left_first_seen: usize,
    right_count: usize,
    right_first_seen: usize,
) -> Ordering {
    right_count
        .cmp(&left_count)
        .then_with(|| left_first_seen.cmp(&right_first_seen))
}

/// Extracts the most frequent comparison keywords, preserving first-seen order for ties.
///
/// Tokens match Python's `\\b[a-z]{3,}\\b` after lowercasing. Nonpositive Python limits are
/// normalized by the PyO3 adapter before this function is called. `unicode_15_1` enables the
/// CJK Extension I letters introduced after the base Unicode 15.0 category table.
pub fn extract_keywords(text: &str, top_n: usize, unicode_15_1: bool) -> Vec<(String, usize)> {
    if top_n == 0 {
        return Vec::new();
    }

    let lowered = text.to_lowercase();
    let mut counts: HashMap<String, (usize, usize)> = HashMap::new();
    for (position, word) in comparison_words(&lowered, unicode_15_1)
        .into_iter()
        .enumerate()
    {
        if STOP_WORDS.binary_search(&word).is_ok() {
            continue;
        }
        let entry = counts.entry(word.to_owned()).or_insert((0, position));
        entry.0 += 1;
    }

    let mut keywords: Vec<_> = counts
        .into_iter()
        .map(|(word, (count, first_seen))| (word, count, first_seen))
        .collect();
    keywords.sort_unstable_by(|left, right| keyword_priority(left.1, left.2, right.1, right.2));
    keywords.truncate(top_n);
    keywords
        .into_iter()
        .map(|(word, count, _)| (word, count))
        .collect()
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::{extract_keywords, STOP_WORDS};

    #[test]
    fn frequency_ties_follow_first_occurrence() {
        assert_eq!(
            extract_keywords("zebra yak zebra yak", 2, false),
            vec![("zebra".to_owned(), 2), ("yak".to_owned(), 2)]
        );
    }

    #[test]
    fn punctuation_and_stop_words_match_the_comparison_contract() {
        assert_eq!(
            extract_keywords("The, election! was about policy and reform.", 20, false),
            vec![
                ("election".to_owned(), 1),
                ("policy".to_owned(), 1),
                ("reform".to_owned(), 1),
            ]
        );
    }

    #[test]
    fn unicode_word_boundaries_follow_the_python_unicode_version() {
        assert_eq!(
            extract_keywords("\u{0345}abc \u{2160}def", 20, false),
            vec![("abc".to_owned(), 1)]
        );
        assert_eq!(
            extract_keywords("\u{2EBF0}abc", 20, false),
            vec![("abc".to_owned(), 1)]
        );
        assert!(extract_keywords("\u{2EBF0}abc", 20, true).is_empty());
    }

    proptest! {
        #[test]
        fn ascii_case_changes_do_not_change_keywords(text in ".{0,512}") {
            prop_assert_eq!(
                extract_keywords(&text, 20, false),
                extract_keywords(&text.to_ascii_uppercase(), 20, false),
            );
        }

        #[test]
        fn result_length_and_frequency_order_follow_limit(
            text in ".{0,512}",
            limit in 0usize..40,
        ) {
            let result = extract_keywords(&text, limit, false);
            prop_assert!(result.len() <= limit);
            prop_assert!(result.windows(2).all(|pair| pair[0].1 >= pair[1].1));
            prop_assert!(result.iter().all(|(word, _)| STOP_WORDS.binary_search(&word.as_str()).is_err()));
        }

        #[test]
        fn smaller_limits_are_prefixes_of_larger_limits(
            text in ".{0,512}",
            small in 0usize..20,
            extra in 0usize..20,
        ) {
            let narrow = extract_keywords(&text, small, false);
            let wide = extract_keywords(&text, small + extra, false);
            prop_assert_eq!(&narrow[..], &wide[..narrow.len()]);
        }
    }
}

#[cfg(kani)]
mod kani_proofs {
    use std::cmp::Ordering;

    use super::keyword_priority;

    #[kani::proof]
    fn frequency_priority_is_descending_and_ties_are_stable() {
        let left_count = kani::any::<usize>();
        let left_position = kani::any::<usize>();
        let right_count = kani::any::<usize>();
        let right_position = kani::any::<usize>();
        let order = keyword_priority(left_count, left_position, right_count, right_position);

        if left_count > right_count {
            assert_eq!(order, Ordering::Less);
        } else if left_count < right_count {
            assert_eq!(order, Ordering::Greater);
        } else if left_position < right_position {
            assert_eq!(order, Ordering::Less);
        } else if left_position > right_position {
            assert_eq!(order, Ordering::Greater);
        } else {
            assert_eq!(order, Ordering::Equal);
        }
    }

    #[kani::proof]
    fn keyword_priority_is_transitive() {
        let a_count = kani::any::<usize>();
        let a_position = kani::any::<usize>();
        let b_count = kani::any::<usize>();
        let b_position = kani::any::<usize>();
        let c_count = kani::any::<usize>();
        let c_position = kani::any::<usize>();

        if keyword_priority(a_count, a_position, b_count, b_position) == Ordering::Less
            && keyword_priority(b_count, b_position, c_count, c_position) == Ordering::Less
        {
            assert_eq!(
                keyword_priority(a_count, a_position, c_count, c_position),
                Ordering::Less
            );
        }
    }
}
