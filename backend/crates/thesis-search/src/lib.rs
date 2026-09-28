#![deny(missing_docs)]

//! Typed article search, ranking, and topic clustering functions.

/// Deterministic article-to-article comparison logic and response types.
pub mod article_comparison;
/// Frequency-based keyword extraction for article comparison.
pub mod comparison_keywords;
/// Country alias matching and article text composition.
pub mod country_mentions;
/// Contingency tables and Cramer's V for catalog analysis.
pub mod funding_bias;
/// Deterministic sentence-level diagnostics for article language.
pub mod language_diagnostics;
/// MinHash duplicate detection and article grouping.
pub mod minhash;
/// Personalized article ranking and priority bucketing.
pub mod ranking;
/// Lexical topic clustering and title keyword extraction.
pub mod topics;
