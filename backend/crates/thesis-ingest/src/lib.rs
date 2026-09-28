#![deny(missing_docs)]

//! Pure HTML, article metadata, and GDELT domain logic for ingestion.

/// Deterministic article extraction and access-barrier classification for fetched HTML.
pub mod article_analysis;
/// HTML text cleanup shared by feed parsing and article extraction.
pub mod cleaner;
/// Deterministic parsing and filtering of GDELT event exports.
pub mod gdelt;
/// CAMEO root labels, GDELT scale buckets, and stable root aggregation.
pub mod gdelt_taxonomy;
/// Article body, metadata, and image extraction from HTML documents.
pub mod html_extract;
/// Host normalization and source-host identity matching.
pub mod source_url_guard;
