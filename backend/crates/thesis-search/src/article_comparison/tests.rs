use proptest::prelude::*;

use super::text::{best_sentence_match, sentence_word_overlap};
use super::{
    calculate_text_similarity, compare_articles, compare_keywords, extract_entities,
    generate_sentence_diff, KeywordEmphasis,
};

#[test]
fn similarity_distinguishes_empty_strings_from_whitespace() {
    assert_eq!(calculate_text_similarity("", ""), 1.0);
    assert_eq!(calculate_text_similarity("", " "), 0.0);
    assert_eq!(calculate_text_similarity("  ", "\t"), 0.0);
    assert_eq!(calculate_text_similarity("   ", "!!!"), 0.0);
    assert_eq!(calculate_text_similarity(" ", " "), 1.0);
}

#[test]
fn missing_article_and_title_scores_are_zero_and_percent_uses_content_score() {
    let missing = compare_articles("", "a report was published", "", "Report Update");
    assert_eq!(missing.similarity.content_similarity, 0.0);
    assert_eq!(missing.similarity.title_similarity, 0.0);

    let both_missing = compare_articles("", "", "", "");
    assert_eq!(both_missing.similarity.content_similarity, 0.0);
    assert_eq!(both_missing.similarity.title_similarity, 0.0);

    let scored = compare_articles("alpha", "alpha beta", "", "");
    assert_eq!(scored.similarity.content_similarity, 0.5);
    assert_eq!(scored.similarity.overall_match_percent, 50.0);
}

#[test]
fn entity_extraction_excludes_short_and_common_words_before_classifying() {
    let entities = extract_entities("Dr. US traveled. Dr. May spoke.");
    assert!(entities.persons.is_empty());
    assert!(entities.organizations.is_empty());
    assert!(entities.locations.is_empty());
}

#[test]
fn repeated_entity_uses_its_first_occurrence_context() {
    let entities = extract_entities("Alice arrived. Dr. Alice returned.");
    assert!(entities.persons.is_empty());
}

#[test]
fn entities_are_first_seen_deduplicated_and_grouped() {
    let entities = extract_entities(
        "Dr. Alice Smith spoke with Acme Corporation in New York City on January 3, 2025.",
    );
    assert_eq!(entities.persons, ["Alice Smith"]);
    assert_eq!(entities.organizations, ["Acme Corporation"]);
    assert_eq!(entities.locations, ["New York City"]);
    assert_eq!(entities.dates, ["January 3, 2025"]);
}

#[test]
fn comparison_keeps_api_shape_and_rounding() {
    let result = compare_articles(
        "The Acme Company issued a report. Alice Smith spoke.",
        "The Acme Company issued a report. Bob Jones spoke.",
        "Acme Report",
        "Acme Report Update",
    );
    let json = serde_json::to_value(&result).expect("response serializes");
    assert_eq!(
        json["entities"]["source_1"]["organizations"][0],
        "The Acme Company"
    );
    assert_eq!(
        json["entities"]["comparison"]["common_entities"]["organizations"][0],
        "The Acme Company"
    );
    assert_eq!(json["similarity"]["content_similarity"], 0.81);
    assert_eq!(json["similarity"]["overall_match_percent"], 80.8);
    assert_eq!(json["diff"]["added"][0]["type"], "unique_to_source_2");
}

#[test]
fn sentence_diff_returns_the_unmatched_sentences_from_each_side() {
    let diff = generate_sentence_diff("Alpha wins. Beta holds.", "Alpha wins. Gamma reacts.");
    assert_eq!(diff.added.len(), 1);
    assert_eq!(diff.added[0].text, "Gamma reacts.");
    assert_eq!(diff.added[0].kind, "unique_to_source_2");
    assert_eq!(diff.removed.len(), 1);
    assert_eq!(diff.removed[0].text, "Beta holds.");
    assert_eq!(diff.removed[0].kind, "unique_to_source_1");
    assert_eq!(diff.similar.len(), 1);
    assert_eq!(diff.similar[0].source_1_text, "Alpha wins.");
    assert_eq!(diff.similar[0].source_2_text, "Alpha wins.");
}

#[test]
fn sentence_overlap_is_unique_word_intersection_over_larger_set() {
    assert_eq!(
        sentence_word_overlap(
            "internationally significant",
            "internationally significant x y",
        ),
        0.5
    );
}

#[test]
fn punctuation_only_sentences_do_not_overlap_or_match() {
    assert_eq!(sentence_word_overlap("!!!", "???"), 0.0);

    let diff = generate_sentence_diff("!!!", "???");
    assert!(diff.similar.is_empty());
}

#[test]
fn sentence_match_accepts_exact_overlap_boundary_but_rejects_exact_score_boundary() {
    let overlap_boundary = "internationally significant x y.".to_owned();
    assert_eq!(
        sentence_word_overlap("internationally significant.", &overlap_boundary),
        0.5
    );
    assert!(best_sentence_match("internationally significant.", &[overlap_boundary]).is_some());

    let score_boundary = "abcdefghijk sharedxx".to_owned();
    let score = calculate_text_similarity("abc sharedxx", &score_boundary);
    assert!((score - 0.6).abs() < f64::EPSILON);
    assert!(best_sentence_match("abc sharedxx", &[score_boundary]).is_none());
}

#[test]
fn sentence_match_chooses_the_best_candidate_and_keeps_the_first_tie() {
    let original = "Alpha reported stable gains in regional markets.";
    let candidates = vec![
        "Alpha reported stable gains in regional market.".to_owned(),
        original.to_owned(),
    ];
    let best = best_sentence_match(original, &candidates).expect("exact sentence matches");
    assert_eq!(best.0, 1);
    assert_eq!(best.1, original);
    assert_eq!(best.2, 1.0);

    let duplicates = vec![original.to_owned(), original.to_owned()];
    assert_eq!(
        best_sentence_match(original, &duplicates)
            .expect("identical sentence matches")
            .0,
        0
    );
    assert!(best_sentence_match("Alpha wins.", &["Beta loses.".to_owned()]).is_none());
}

#[test]
fn keyword_comparison_reports_signed_differences_emphasis_and_unique_order() {
    let left = vec![
        ("shared-high".to_owned(), 7),
        ("shared-low".to_owned(), 2),
        ("source1-z".to_owned(), 3),
        ("source1-a".to_owned(), 3),
        ("source1-b".to_owned(), 1),
    ];
    let right = vec![
        ("shared-high".to_owned(), 4),
        ("shared-low".to_owned(), 5),
        ("source2-other".to_owned(), 6),
        ("source2-only".to_owned(), 6),
    ];
    let comparison = compare_keywords(&left, &right);

    assert_eq!(comparison.common_keywords.len(), 2);
    assert_eq!(comparison.common_keywords[0].keyword, "shared-high");
    assert_eq!(comparison.common_keywords[0].difference, 3);
    assert_eq!(
        comparison.common_keywords[0].emphasis,
        KeywordEmphasis::Source1
    );
    assert_eq!(comparison.common_keywords[1].keyword, "shared-low");
    assert_eq!(comparison.common_keywords[1].difference, -3);
    assert_eq!(
        comparison.common_keywords[1].emphasis,
        KeywordEmphasis::Source2
    );

    let unique_1 = comparison
        .unique_to_source_1
        .iter()
        .map(|item| (item.keyword.as_str(), item.frequency))
        .collect::<Vec<_>>();
    assert_eq!(
        unique_1,
        [("source1-a", 3), ("source1-z", 3), ("source1-b", 1)]
    );
    let unique_2 = comparison
        .unique_to_source_2
        .iter()
        .map(|item| (item.keyword.as_str(), item.frequency))
        .collect::<Vec<_>>();
    assert_eq!(unique_2, [("source2-only", 6), ("source2-other", 6)]);
}

proptest! {
    #[test]
    fn similarity_is_symmetric_and_bounded(left in any::<String>(), right in any::<String>()) {
        let forward = calculate_text_similarity(&left, &right);
        let reverse = calculate_text_similarity(&right, &left);
        prop_assert!(forward.is_finite() && (0.0..=1.0).contains(&forward));
        prop_assert_eq!(forward, reverse);
    }

    #[test]
    fn summary_counts_equal_returned_lists(left in ".{0,180}", right in ".{0,180}") {
        let response = compare_articles(&left, &right, "", "");
        let relations = &response.entities.comparison;
        prop_assert_eq!(response.summary.common_entities_count,
            relations.common_entities.persons.len()
            + relations.common_entities.organizations.len()
            + relations.common_entities.locations.len()
            + relations.common_entities.dates.len());
        prop_assert_eq!(response.summary.common_keywords_count,
            response.keywords.comparison.common_keywords.len());
        prop_assert_eq!(response.summary.unique_keywords_source_1,
            response.keywords.comparison.unique_to_source_1.len());
        prop_assert_eq!(response.summary.unique_keywords_source_2,
            response.keywords.comparison.unique_to_source_2.len());
    }
}
