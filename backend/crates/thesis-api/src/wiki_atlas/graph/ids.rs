pub(super) use thesis_search::entity_id::{
    casefold, hex_prefix, normalize_entity_label, sha1_digest, stable_source_id,
};

use super::super::AtlasConfidenceTier;

pub(super) fn edge_id(
    source_id: &str,
    target_id: &str,
    relation: &str,
    discriminator: &str,
) -> String {
    let raw = format!("{source_id}|{target_id}|{relation}|{discriminator}");
    format!("edge:{}", hex_prefix(&sha1_digest(raw.as_bytes()), 8))
}

pub(super) fn confidence_tier(value: Option<f64>) -> AtlasConfidenceTier {
    match value {
        Some(score) if score >= 0.9 => AtlasConfidenceTier::Verified,
        Some(score) if score >= 0.75 => AtlasConfidenceTier::Strong,
        Some(score) if score >= 0.5 => AtlasConfidenceTier::Likely,
        Some(_) => AtlasConfidenceTier::Unresolved,
        None => AtlasConfidenceTier::Unresolved,
    }
}
