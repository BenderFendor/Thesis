use super::super::query_source_name;
use super::{
    calculate_measurement_writes, trace_id, MediaArticle, MediaArticleAuthor,
    MediaMeasurementInput, MediaOwnerEntity, MediaOwnershipRelationship,
};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::{json, Value};
use std::collections::HashMap;

fn timestamp(day: u32) -> NaiveDateTime {
    NaiveDateTime::new(
        NaiveDate::from_ymd_opt(2026, 7, day).unwrap(),
        NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
    )
}

fn source_scoped_fixture() -> MediaMeasurementInput {
    MediaMeasurementInput {
        articles: vec![
            MediaArticle {
                id: 101,
                title: "Original report".to_owned(),
                source: "Example News".to_owned(),
                content: Some("Original reporting.".to_owned()),
                published_at: timestamp(1),
                author: Some("Alice Editor".to_owned()),
                tags: Some(Vec::new()),
            },
            MediaArticle {
                id: 102,
                title: "Correction: wire report".to_owned(),
                source: "Example News".to_owned(),
                content: Some("Corrected: This Reuters report was updated.".to_owned()),
                published_at: timestamp(3),
                author: Some("Zoe Reporter".to_owned()),
                tags: Some(Vec::new()),
            },
        ],
        article_authors: vec![
            MediaArticleAuthor {
                article_id: 101,
                reporter_name: "Alice Editor".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 101,
                reporter_name: "Zoe Reporter".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 102,
                reporter_name: "Alice Editor".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 102,
                reporter_name: "Zoe Reporter".to_owned(),
            },
        ],
        ownership_relationships: vec![
            MediaOwnershipRelationship {
                id: "b-rel".to_owned(),
                object_entity_id: "owner-b".to_owned(),
            },
            MediaOwnershipRelationship {
                id: "a-rel".to_owned(),
                object_entity_id: "owner-a".to_owned(),
            },
        ],
        owner_entities: vec![
            MediaOwnerEntity {
                id: "owner-a".to_owned(),
                canonical_name: "Owner A".to_owned(),
            },
            MediaOwnerEntity {
                id: "owner-b".to_owned(),
                canonical_name: "Owner B".to_owned(),
            },
        ],
    }
}
fn all_articles_fixture() -> MediaMeasurementInput {
    let mut input = source_scoped_fixture();
    input.articles.push(MediaArticle {
        id: 103,
        title: "Follow-up".to_owned(),
        source: "Other Outlet".to_owned(),
        content: Some("Independent follow-up.".to_owned()),
        published_at: timestamp(4),
        author: Some("Alice Editor".to_owned()),
        tags: Some(Vec::new()),
    });
    input.article_authors.extend([
        MediaArticleAuthor {
            article_id: 103,
            reporter_name: "Alice Editor".to_owned(),
        },
        MediaArticleAuthor {
            article_id: 103,
            reporter_name: "Zoe Reporter".to_owned(),
        },
    ]);
    input
}

#[test]
fn measurements_preserve_six_trace_semantics_for_source_scoped_input() {
    let writes = calculate_measurement_writes(source_scoped_fixture(), Some("Example News"));
    let repeated = calculate_measurement_writes(source_scoped_fixture(), Some("Example News"));
    let names = writes
        .iter()
        .map(|write| write.measurement_name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "publication_cadence",
            "corrections_retractions",
            "byline_coauthor_network",
            "original_vs_syndicated",
            "reporter_movement",
            "ownership_concentration",
        ]
    );
    assert_eq!(
        writes.iter().map(|write| &write.id).collect::<Vec<_>>(),
        repeated.iter().map(|write| &write.id).collect::<Vec<_>>()
    );
    assert_eq!(writes[0].result["article_count"], 2);
    assert_eq!(writes[0].subgraph["source_name"], "Example News");
    assert_eq!(
        writes[0].result["corpus_window"]["start"],
        "2026-07-01T12:00:00"
    );
    assert_eq!(writes[1].result["correction_count"], 1);
    assert_eq!(
        writes[1].result["coverage"],
        json!({"numerator": 2, "denominator": 2})
    );
    assert_eq!(writes[2].result["coauthor_edges"][0]["article_count"], 2);
    assert_eq!(writes[3].result["syndicated_count"], 1);
    assert_eq!(writes[4].result["movement_count"], 0);
    assert_eq!(writes[5].result["herfindahl_hirschman_index"], "0.500000");
    assert_eq!(writes[5].result["owners"][0]["entity_id"], "owner-b");
    assert_eq!(writes[5].result["owners"][1]["entity_id"], "owner-a");
    assert_eq!(
        writes[5].subgraph["relationship_ids"],
        json!(["b-rel", "a-rel"])
    );
    let all_articles = calculate_measurement_writes(all_articles_fixture(), Some(""));
    assert_eq!(all_articles[0].subgraph["source_name"], "");
    assert_eq!(all_articles[0].result["article_count"], 3);
    assert_eq!(all_articles[4].result["movement_count"], 2);
    assert_eq!(
        all_articles[4].result["observed_movements"][0]["reporter"],
        "Alice Editor"
    );
    assert_eq!(
        all_articles[4].result["observed_movements"][1]["reporter"],
        "Zoe Reporter"
    );
}

#[test]
fn byline_trace_hash_matches_python_numeric_key_ordering() {
    let result = json!({
        "corpus_window": {"start": null, "end": null},
        "denominator": 2,
        "coverage": {"numerator": 2, "denominator": 2},
        "method_version": "media_measurements/1.0",
        "unique_reporters": 2,
        "coauthor_edges": [],
    });
    let subgraph = json!({
        "article_authors": {
            "2": ["Reporter B"],
            "10": ["Reporter A"],
        },
    });
    assert_eq!(
        trace_id("byline_coauthor_network", &result, &subgraph),
        "calc_caec68386d72934d90b0733625034a5d"
    );
}
#[test]
fn byline_hash_preserves_input_author_order_duplicates_and_numeric_keys() {
    let input = MediaMeasurementInput {
        articles: vec![
            MediaArticle {
                id: 2,
                title: "Article two".to_owned(),
                source: "Outlet".to_owned(),
                content: None,
                published_at: timestamp(2),
                author: None,
                tags: None,
            },
            MediaArticle {
                id: 10,
                title: "Article ten".to_owned(),
                source: "Outlet".to_owned(),
                content: None,
                published_at: timestamp(10),
                author: None,
                tags: None,
            },
        ],
        article_authors: vec![
            MediaArticleAuthor {
                article_id: 2,
                reporter_name: "Zoe".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 2,
                reporter_name: "Alice".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 2,
                reporter_name: "Alice".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 10,
                reporter_name: "Bob".to_owned(),
            },
            MediaArticleAuthor {
                article_id: 10,
                reporter_name: "Alice".to_owned(),
            },
        ],
        ownership_relationships: Vec::new(),
        owner_entities: Vec::new(),
    };
    let writes = calculate_measurement_writes(input, None);
    let byline = &writes[2];

    assert_eq!(
        byline.subgraph["article_authors"]["2"],
        json!(["Zoe", "Alice", "Alice"])
    );
    assert_eq!(
        byline.subgraph["article_authors"]["10"],
        json!(["Bob", "Alice"])
    );
    assert_eq!(byline.result["unique_reporters"], 3);
    assert_eq!(
        byline.result["coauthor_edges"],
        json!([
            {"reporter_a": "Alice", "reporter_b": "Bob", "article_count": 1},
            {"reporter_a": "Alice", "reporter_b": "Zoe", "article_count": 1},
        ])
    );
    // Computed with app.services.evidence_spine.stable_hash on the same payload.
    assert_eq!(byline.id, "calc_49d68713d940be8c94e44b1c793e3148");
}
#[test]
fn reporter_movement_preserves_input_author_row_order() {
    let writes = calculate_measurement_writes(
        MediaMeasurementInput {
            articles: vec![
                MediaArticle {
                    id: 1,
                    title: "First report".to_owned(),
                    source: "First Outlet".to_owned(),
                    content: None,
                    published_at: timestamp(1),
                    author: None,
                    tags: None,
                },
                MediaArticle {
                    id: 2,
                    title: "Second report".to_owned(),
                    source: "Second Outlet".to_owned(),
                    content: None,
                    published_at: timestamp(2),
                    author: None,
                    tags: None,
                },
            ],
            article_authors: vec![
                MediaArticleAuthor {
                    article_id: 1,
                    reporter_name: "Zoe".to_owned(),
                },
                MediaArticleAuthor {
                    article_id: 1,
                    reporter_name: "Alice".to_owned(),
                },
                MediaArticleAuthor {
                    article_id: 2,
                    reporter_name: "Alice".to_owned(),
                },
                MediaArticleAuthor {
                    article_id: 2,
                    reporter_name: "Zoe".to_owned(),
                },
            ],
            ownership_relationships: Vec::new(),
            owner_entities: Vec::new(),
        },
        None,
    );
    assert_eq!(
        writes[2].subgraph["article_authors"]["1"],
        json!(["Zoe", "Alice"])
    );
    assert_eq!(writes[4].result["movement_count"], 2);
    assert_eq!(writes[4].result["observed_movements"][0]["reporter"], "Zoe");
    assert_eq!(
        writes[4].result["observed_movements"][1]["reporter"],
        "Alice"
    );
}

#[test]
fn empty_corpus_still_emits_all_measurements_with_zero_denominators() {
    let writes = calculate_measurement_writes(
        MediaMeasurementInput {
            articles: Vec::new(),
            article_authors: Vec::new(),
            ownership_relationships: Vec::new(),
            owner_entities: Vec::new(),
        },
        None,
    );
    assert_eq!(writes.len(), 6);
    for write in &writes {
        assert_eq!(write.result["denominator"], 0);
        assert_eq!(write.result["coverage"]["denominator"], 0);
    }
    assert_eq!(writes[0].result["active_days"], 0);
    assert_eq!(writes[0].result["span_days"], 0);
    assert_eq!(writes[0].result["articles_per_day"], Value::Null);
    assert_eq!(writes[5].result["herfindahl_hirschman_index"], Value::Null);
    assert_eq!(writes[5].result["owners"], json!([]));
}

#[test]
fn source_name_query_contract_accepts_empty_and_200_characters_but_rejects_longer_values() {
    assert_eq!(query_source_name(&HashMap::new()).unwrap(), None);
    assert_eq!(
        query_source_name(&HashMap::from([("source_name".to_owned(), String::new())])).unwrap(),
        Some(String::new())
    );
    assert_eq!(
        query_source_name(&HashMap::from([(
            "source_name".to_owned(),
            "é".repeat(200)
        )]))
        .unwrap(),
        Some("é".repeat(200))
    );
    let error = query_source_name(&HashMap::from([(
        "source_name".to_owned(),
        "x".repeat(201),
    )]))
    .unwrap_err();
    assert_eq!(error.detail[0].error_type, "string_too_long");
    assert_eq!(error.detail[0].ctx.as_ref().unwrap()["max_length"], 200);
}
#[test]
fn syndication_coverage_counts_a_nonempty_tag_list_with_empty_values() {
    let writes = calculate_measurement_writes(
        MediaMeasurementInput {
            articles: vec![MediaArticle {
                id: 1,
                title: String::new(),
                source: "Outlet".to_owned(),
                content: None,
                published_at: timestamp(1),
                author: None,
                tags: Some(vec![String::new()]),
            }],
            article_authors: Vec::new(),
            ownership_relationships: Vec::new(),
            owner_entities: Vec::new(),
        },
        None,
    );
    assert_eq!(writes[3].result["coverage"]["numerator"], 1);
    assert_eq!(writes[3].result["coverage"]["denominator"], 1);
    assert_eq!(writes[3].result["syndicated_count"], 0);
}
