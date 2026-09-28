use std::future::Future;
use std::pin::Pin;

use std::sync::Arc;

use serde_json::Value;

pub(crate) mod enrichment;
pub(crate) mod indexer;
pub(crate) mod scorer;

pub(crate) use enrichment::ReporterWikiEnrichmentProvider;
pub(crate) use indexer::WikiIndexerProvider;
pub(crate) use scorer::ConfiguredWikiSourceScorer;

pub(crate) type WikiScoreFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// Scoring metadata assembled by the FastAPI source indexer.
#[derive(Clone, Debug, Default)]
pub(crate) struct WikiSourceScoringMetadata {
    pub country: String,
    pub funding_type: String,
    pub political_bias: String,
    pub source_type: String,
    pub site_url: String,
}

/// The five persisted source-analysis axes. The scorer must return one result for
/// every axis; it owns the FastAPI-compatible LLM/defaulting policy.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum WikiSourceAnalysisAxis {
    Funding,
    SourceNetwork,
    PoliticalBias,
    Credibility,
    FramingOmission,
}

impl WikiSourceAnalysisAxis {
    pub(crate) const ALL: [Self; 5] = [
        Self::Funding,
        Self::SourceNetwork,
        Self::PoliticalBias,
        Self::Credibility,
        Self::FramingOmission,
    ];

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Funding => "funding",
            Self::SourceNetwork => "source_network",
            Self::PoliticalBias => "political_bias",
            Self::Credibility => "credibility",
            Self::FramingOmission => "framing_omission",
        }
    }

    const fn index(self) -> usize {
        match self {
            Self::Funding => 0,
            Self::SourceNetwork => 1,
            Self::PoliticalBias => 2,
            Self::Credibility => 3,
            Self::FramingOmission => 4,
        }
    }
}

pub(crate) fn validate_source_scores(scores: &[WikiSourceAxisScore]) -> Result<(), &'static str> {
    if scores.len() != WikiSourceAnalysisAxis::ALL.len() {
        return Err("source scorer must return all five analysis axes");
    }
    let mut seen = [false; 5];
    for score in scores {
        if !(1..=5).contains(&score.score) {
            return Err("source analysis score must be between 1 and 5");
        }
        let index = score.axis.index();
        if seen[index] {
            return Err("source scorer returned a duplicate analysis axis");
        }
        seen[index] = true;
    }
    if seen.iter().any(|present| !present) {
        return Err("source scorer omitted a required analysis axis");
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub(crate) struct WikiSourceAxisScore {
    pub axis: WikiSourceAnalysisAxis,
    pub score: i32,
    pub confidence: Option<String>,
    pub prose_explanation: Option<String>,
    pub citations: Option<Value>,
    pub empirical_basis: Option<String>,
    pub scored_by: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct WikiSourceOrganizationUpdates {
    pub funding_type: Option<String>,
    pub parent_org: Option<String>,
    pub media_bias_rating: Option<String>,
    pub factual_reporting: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct WikiSourceScoringRequest {
    pub source_name: String,
    /// Organization research from `EntityResearchProvider::research_organization`.
    pub organization_data: Arc<Value>,
    pub source_metadata: WikiSourceScoringMetadata,
}

#[derive(Clone, Debug)]
pub(crate) struct WikiSourceScoringResult {
    pub scores: Vec<WikiSourceAxisScore>,
    pub organization_updates: Option<WikiSourceOrganizationUpdates>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum WikiSourceScoringError {
    Unavailable,
    Failed(String),
}

/// Production source scorer boundary. Implementations must match the live
/// FastAPI route: deterministic funding and credibility axes always, three
/// configured-LLM axes when available, neutral defaults for those three only
/// when the configured LLM is unavailable or yields invalid output, and only
/// the four supported organization-update fields. There is intentionally no
/// default implementation so missing scoring cannot be treated as success.
pub(crate) trait WikiSourceScorer: Send + Sync {
    fn score_source(
        &self,
        request: WikiSourceScoringRequest,
    ) -> WikiScoreFuture<Result<WikiSourceScoringResult, WikiSourceScoringError>>;
}
#[cfg(test)]
mod tests {
    use super::{validate_source_scores, WikiSourceAnalysisAxis, WikiSourceAxisScore};

    fn scores() -> Vec<WikiSourceAxisScore> {
        WikiSourceAnalysisAxis::ALL
            .into_iter()
            .map(|axis| WikiSourceAxisScore {
                axis,
                score: 3,
                confidence: None,
                prose_explanation: None,
                citations: None,
                empirical_basis: None,
                scored_by: None,
            })
            .collect()
    }

    #[test]
    fn validation_requires_each_persisted_axis_once_and_in_range() {
        let valid = scores();
        assert!(validate_source_scores(&valid).is_ok());

        let mut missing = valid.clone();
        missing.pop();
        assert_eq!(
            validate_source_scores(&missing),
            Err("source scorer must return all five analysis axes")
        );

        let mut duplicate = valid.clone();
        duplicate[4].axis = duplicate[0].axis;
        assert_eq!(
            validate_source_scores(&duplicate),
            Err("source scorer returned a duplicate analysis axis")
        );

        let mut out_of_range = valid;
        out_of_range[0].score = 6;
        assert_eq!(
            validate_source_scores(&out_of_range),
            Err("source analysis score must be between 1 and 5")
        );
    }
}
