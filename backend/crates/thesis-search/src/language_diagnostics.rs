//! Deterministic sentence-level diagnostics for article language.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use unicode_general_category::{get_general_category, GeneralCategory};

/// Severity emitted for a diagnostic metric or the overall result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticStatus {
    /// The observed rate is below the medium threshold.
    Low,
    /// The observed rate reaches the medium threshold.
    Medium,
    /// The observed rate reaches the high threshold.
    High,
}

/// One sentence-level example associated with a diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiagnosticExample {
    /// The matching sentence, truncated to 280 Unicode scalar values.
    pub sentence: String,
    /// Matched euphemism or sanitized term, when applicable.
    pub term: Option<String>,
    /// Matched passive phrase or actor-omission explanation, when applicable.
    pub pattern: Option<String>,
    /// The diagnostic category assigned to this example.
    pub category: Option<String>,
}

/// Count, normalized rate, status, and examples for one diagnostic category.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiagnosticMetric {
    /// Number of examples, capped at five by the analyzer.
    pub count: usize,
    /// Example count divided by the sentence count, rounded to three places.
    pub rate: f64,
    /// Severity derived from the category-specific rate thresholds.
    pub status: DiagnosticStatus,
    /// Up to five examples in source order.
    pub examples: Vec<DiagnosticExample>,
}

/// Aggregate diagnostic score and user-facing summary.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiagnosticOverall {
    /// Weighted score in the inclusive range from zero to one.
    pub score: f64,
    /// Severity derived from the aggregate score.
    pub status: DiagnosticStatus,
    /// Short explanation of the aggregate result.
    pub summary: String,
}

/// Complete language-diagnostics payload returned by the analyzer.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LanguageDiagnosticsPayload {
    /// Number of sentences after whitespace normalization and splitting.
    pub sentence_count: usize,
    /// Number of matches for Python's `\\b[\\w'-]+\\b` expression.
    pub word_count: usize,
    /// Passive-voice examples and metric.
    pub passive_voice: DiagnosticMetric,
    /// Passive harm language without an explicit `by ...` actor.
    pub actor_omission: DiagnosticMetric,
    /// Euphemism examples and metric.
    pub euphemisms: DiagnosticMetric,
    /// Sanitized-language examples and metric.
    pub sanitized_language: DiagnosticMetric,
    /// Weighted aggregate score and summary.
    pub overall: DiagnosticOverall,
}

static PASSIVE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:am|are|is|was|were|be|been|being|got|gets|get)\s+(?:\w+\s+){0,3}?(?:[a-z]+ed|accused|arrested|beaten|born|detained|displaced|driven|found|hit|hurt|injured|killed|left|made|reported|seen|shot|struck|told|wounded)\b",
    )
    .expect("static passive-voice regex is valid")
});
static BY_ACTOR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bby\s+(?:the\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,5}\b")
        .expect("static actor regex is valid")
});
static HARM_ACTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:accused|arrested|attacked|beaten|blamed|charged|detained|displaced|fired|hit|injured|killed|removed|shot|struck|targeted|wounded)\b",
    )
    .expect("static harm-action regex is valid")
});
static REGEX_WORD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\A\w\z").expect("static regex word-character expression is valid"));
static WORD_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[\w'-]+\b").expect("static Python-compatible word regex is valid"));

const EUPHEMISMS: &[(&str, &str)] = &[
    ("administrative detention", "state power"),
    ("area denial", "military action"),
    ("collateral damage", "civilian harm"),
    ("enhanced interrogation", "state violence"),
    ("kinetic action", "military action"),
    ("neutralized", "lethal force"),
    ("pacification", "state power"),
    ("regrettable incident", "accountability"),
    ("security operation", "state power"),
    ("surgical strike", "military action"),
    ("targeted killing", "lethal force"),
];

const SANITIZED_TERMS: &[(&str, &str)] = &[
    ("clashes", "agent ambiguity"),
    ("incident", "agent ambiguity"),
    ("mistakes were made", "accountability"),
    ("officer-involved shooting", "agent omission"),
    ("unrest", "agent ambiguity"),
];

/// Analyze passive constructions, actor omission, euphemisms, and sanitized framing.
///
/// `title` is currently ignored by the Python reference implementation and is
/// retained here to preserve its call signature.
pub fn analyze_language_diagnostics(text: &str, title: Option<&str>) -> LanguageDiagnosticsPayload {
    let _ = title;
    let clean_text = normalize_whitespace(text);
    let sentences = split_sentences(&clean_text);
    let sentence_count = sentences.len();
    let word_count = count_python_word_matches(&clean_text);

    let passive_examples = find_passive_examples(&sentences);
    let actor_omission_examples = find_actor_omission_examples(&sentences);
    let euphemism_examples = find_term_examples(&sentences, EUPHEMISMS);
    let sanitized_examples = find_term_examples(&sentences, SANITIZED_TERMS);

    let passive_voice = build_metric(passive_examples, sentence_count, (0.08, 0.18));
    let actor_omission = build_metric(actor_omission_examples, sentence_count, (0.04, 0.1));
    let euphemisms = build_metric(euphemism_examples, sentence_count, (0.03, 0.08));
    let sanitized_language = build_metric(sanitized_examples, sentence_count, (0.03, 0.08));

    let score = overall_score(&[
        (&passive_voice, 0.35),
        (&actor_omission, 0.35),
        (&euphemisms, 0.2),
        (&sanitized_language, 0.1),
    ]);
    let status = status_for_score(score);
    let summary = summary_for_status(
        status,
        passive_voice.count,
        actor_omission.count,
        euphemisms.count,
    );

    LanguageDiagnosticsPayload {
        sentence_count,
        word_count,
        passive_voice,
        actor_omission,
        euphemisms,
        sanitized_language,
        overall: DiagnosticOverall {
            score,
            status,
            summary,
        },
    }
}

fn is_python_whitespace(character: char) -> bool {
    character.is_whitespace() || ('\u{001c}'..='\u{001f}').contains(&character)
}

fn normalize_whitespace(text: &str) -> String {
    text.split(is_python_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_sentences(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }

    // The Python expression uses lookbehind and lookahead, which Rust's regex
    // crate does not support. Whitespace normalization guarantees one ASCII
    // space at each candidate boundary, so this byte scan is equivalent.
    let bytes = text.as_bytes();
    let mut sentences = Vec::new();
    let mut start = 0;
    for index in 1..bytes.len().saturating_sub(1) {
        let next_starts_sentence =
            matches!(bytes[index + 1], b'A'..=b'Z' | b'0'..=b'9' | b'"' | b'\'');
        if bytes[index] == b' '
            && matches!(bytes[index - 1], b'.' | b'!' | b'?')
            && next_starts_sentence
        {
            sentences.push(text[start..index].to_owned());
            start = index + 1;
        }
    }
    sentences.push(text[start..].to_owned());
    sentences
}

fn is_python_word_character(character: char) -> bool {
    character == '_'
        || ('\u{2ebf0}'..='\u{2ee5d}').contains(&character)
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

struct PythonRegexInput {
    normalized: String,
    byte_offsets: Vec<(usize, usize)>,
}

impl PythonRegexInput {
    fn new(text: &str) -> Self {
        let mut normalized = String::with_capacity(text.len());
        let mut byte_offsets = Vec::with_capacity(text.chars().count() + 1);
        for (original_offset, character) in text.char_indices() {
            byte_offsets.push((normalized.len(), original_offset));
            let mut encoded = [0; 4];
            let character_text = character.encode_utf8(&mut encoded);
            let rust_word = REGEX_WORD_RE.is_match(character_text);
            let python_word = is_python_word_character(character);
            normalized.push(match character {
                // Python's Unicode IGNORECASE also folds these four characters
                // into ASCII ranges; Rust regex deliberately uses simpler folding.
                '\u{0130}' | '\u{0131}' => 'i',
                '\u{017f}' => 's',
                '\u{212a}' => 'k',
                _ if python_word && !rust_word => '_',
                _ if !python_word && rust_word => '\0',
                _ => character,
            });
        }
        byte_offsets.push((normalized.len(), text.len()));
        Self {
            normalized,
            byte_offsets,
        }
    }

    fn find<'a>(&self, regex: &Regex, original: &'a str) -> Option<&'a str> {
        let matched = regex.find(&self.normalized)?;
        let original_start = self.original_offset(matched.start())?;
        let original_end = self.original_offset(matched.end())?;
        original.get(original_start..original_end)
    }

    fn original_offset(&self, normalized_offset: usize) -> Option<usize> {
        self.byte_offsets
            .binary_search_by_key(&normalized_offset, |(normalized, _)| *normalized)
            .ok()
            .map(|index| self.byte_offsets[index].1)
    }
}

fn count_python_word_matches(text: &str) -> usize {
    let input = PythonRegexInput::new(text);
    WORD_RE.find_iter(&input.normalized).count()
}

fn find_passive_examples(sentences: &[String]) -> Vec<DiagnosticExample> {
    sentences
        .iter()
        .filter_map(|sentence| {
            let input = PythonRegexInput::new(sentence);
            input
                .find(&PASSIVE_RE, sentence)
                .map(|matched| DiagnosticExample {
                    sentence: truncate_sentence(sentence),
                    term: None,
                    pattern: Some(matched.to_owned()),
                    category: Some("passive_voice".to_owned()),
                })
        })
        .take(5)
        .collect()
}

fn find_actor_omission_examples(sentences: &[String]) -> Vec<DiagnosticExample> {
    sentences
        .iter()
        .filter(|sentence| {
            let input = PythonRegexInput::new(sentence);
            input.find(&PASSIVE_RE, sentence).is_some()
                && input.find(&BY_ACTOR_RE, sentence).is_none()
                && input.find(&HARM_ACTION_RE, sentence).is_some()
        })
        .take(5)
        .map(|sentence| DiagnosticExample {
            sentence: truncate_sentence(sentence),
            term: None,
            pattern: Some("passive without named actor".to_owned()),
            category: Some("actor_omission".to_owned()),
        })
        .collect()
}

fn find_term_examples(sentences: &[String], terms: &[(&str, &str)]) -> Vec<DiagnosticExample> {
    let mut examples = Vec::new();
    let mut seen = HashSet::new();
    for sentence in sentences {
        let lowercase = sentence.to_lowercase();
        for (term_index, &(term, category)) in terms.iter().enumerate() {
            if !lowercase.contains(term) || !seen.insert((term_index, sentence.as_str())) {
                continue;
            }
            examples.push(DiagnosticExample {
                sentence: truncate_sentence(sentence),
                term: Some(term.to_owned()),
                pattern: None,
                category: Some(category.to_owned()),
            });
            if examples.len() == 5 {
                return examples;
            }
        }
    }
    examples
}

fn build_metric(
    examples: Vec<DiagnosticExample>,
    sentence_count: usize,
    thresholds: (f64, f64),
) -> DiagnosticMetric {
    let count = examples.len();
    let rate = if sentence_count == 0 {
        0.0
    } else {
        round_to_three_places(count as f64 / sentence_count as f64)
    };
    DiagnosticMetric {
        count,
        rate,
        status: status_for_rate(rate, thresholds),
        examples,
    }
}

fn round_to_three_places(value: f64) -> f64 {
    format!("{value:.3}").parse().unwrap_or(value)
}

fn status_for_rate(rate: f64, (medium, high): (f64, f64)) -> DiagnosticStatus {
    if rate >= high {
        DiagnosticStatus::High
    } else if rate >= medium {
        DiagnosticStatus::Medium
    } else {
        DiagnosticStatus::Low
    }
}

fn overall_score(metrics: &[(&DiagnosticMetric, f64)]) -> f64 {
    let weighted = metrics
        .iter()
        .map(|(metric, weight)| metric.rate * weight)
        .sum::<f64>();
    round_to_three_places((weighted * 5.0).min(1.0))
}

fn status_for_score(score: f64) -> DiagnosticStatus {
    if score >= 0.45 {
        DiagnosticStatus::High
    } else if score >= 0.2 {
        DiagnosticStatus::Medium
    } else {
        DiagnosticStatus::Low
    }
}

fn summary_for_status(
    status: DiagnosticStatus,
    passive_count: usize,
    actor_omission_count: usize,
    euphemism_count: usize,
) -> String {
    match status {
        DiagnosticStatus::High => format!(
            "Language diagnostics found repeated passive framing, actor omission, or sanitized terms across {} passages.",
            passive_count + actor_omission_count + euphemism_count
        ),
        DiagnosticStatus::Medium => "Language diagnostics found some framing patterns worth comparing against other coverage.".to_owned(),
        DiagnosticStatus::Low => "Language diagnostics found limited passive or sanitized framing in the available text.".to_owned(),
    }
}

fn truncate_sentence(sentence: &str) -> String {
    let mut characters = sentence.chars();
    let truncated: String = characters.by_ref().take(280).collect();
    if characters.next().is_none() {
        return truncated;
    }
    let prefix: String = sentence.chars().take(277).collect();
    format!("{}...", prefix.trim_end_matches(is_python_whitespace))
}

#[cfg(test)]
mod tests {
    use super::{analyze_language_diagnostics, DiagnosticStatus};

    #[test]
    fn flags_passive_actor_omission_and_terms_in_source_order() {
        let result = analyze_language_diagnostics(
            "The neighborhood was struck before dawn. Five residents were killed during what officials called a surgical strike. The ministry said collateral damage was regrettable. Witnesses said the army fired from the ridge.",
            None,
        );

        assert_eq!(result.sentence_count, 4);
        assert_eq!(result.passive_voice.count, 2);
        assert_eq!(result.actor_omission.count, 2);
        assert_eq!(result.euphemisms.count, 2);
        assert_eq!(
            result.actor_omission.examples[0].pattern.as_deref(),
            Some("passive without named actor")
        );
        assert_eq!(
            result.euphemisms.examples[0].term.as_deref(),
            Some("surgical strike")
        );
    }

    #[test]
    fn direct_attribution_stays_low_and_title_is_ignored() {
        let text = "The city council approved the budget after a public vote. The mayor signed the ordinance on Tuesday.";
        let without_title = analyze_language_diagnostics(text, None);
        let with_title = analyze_language_diagnostics(text, Some("were killed"));
        assert_eq!(without_title, with_title);
        assert_eq!(without_title.passive_voice.count, 0);
        assert_eq!(without_title.actor_omission.count, 0);
        assert_eq!(without_title.overall.status, DiagnosticStatus::Low);
    }

    #[test]
    fn whitespace_sentence_boundaries_follow_python_reference_rules() {
        let result = analyze_language_diagnostics(
            "One. Two.\u{001c}Three. lower case continues.\n\tFour! 'Five'",
            None,
        );
        assert_eq!(result.sentence_count, 5);
    }

    #[test]
    fn repeated_identical_term_sentences_are_deduplicated_and_capped() {
        let text = "Clashes were reported. Clashes were reported. Incident was reported. Unrest was reported. Mistakes were made. Officer-involved shooting was reported. A security operation was reported.";
        let result = analyze_language_diagnostics(text, None);
        assert_eq!(result.sanitized_language.count, 5);
        assert_eq!(result.sanitized_language.examples.len(), 5);
        assert!(result.overall.score <= 1.0);
    }

    #[test]
    fn sentence_examples_truncate_by_unicode_scalar_value() {
        let sentence = format!("The subject was {} killed.", "é".repeat(300));
        let result = analyze_language_diagnostics(&sentence, None);
        let example = &result.passive_voice.examples[0].sentence;
        assert_eq!(example.chars().count(), 280);
        assert!(example.ends_with("..."));
    }
}

#[cfg(kani)]
mod kani_proofs {
    use super::{status_for_rate, status_for_score, DiagnosticStatus};

    #[kani::proof]
    fn increasing_rate_never_reduces_diagnostic_severity() {
        let lower = kani::any::<f64>();
        let upper = kani::any::<f64>();
        if lower <= upper {
            assert!(status_for_rate(lower, (0.08, 0.18)) <= status_for_rate(upper, (0.08, 0.18)));
            assert!(status_for_score(lower) <= status_for_score(upper));
        }
        assert!(DiagnosticStatus::Low < DiagnosticStatus::Medium);
        assert!(DiagnosticStatus::Medium < DiagnosticStatus::High);
    }
}
